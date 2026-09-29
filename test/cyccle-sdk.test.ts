import { CyccleError } from "@cyccle/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/env";
import type { CancellationAttempt } from "@/server/db";
import type { CancellationAttemptRepository, CancellationClient } from "@/server/cyccle";
import { reconcileLatestCancellation, startBillingCancellation } from "@/server/cyccle";
import type { UserRepository } from "@/server/users";

const createdSession = {
  id: "00000000-0000-4000-8000-000000000001",
  url: `https://cancel-staging.cyccle.co/start#cl_${"a".repeat(43)}`,
  expiresAt: "2026-09-29T12:00:00.000Z",
};

describe("Cyccle SDK cancellation orchestration", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
    process.env.CYCCLE_API_BASE_URL = "https://api-staging.cyccle.co";
    process.env.CYCCLE_API_KEY = "ck_test_secret";
    process.env.MERIDIAN_SESSION_SECRET = "test-secret-that-is-long-enough-for-meridian";
    process.env.MERIDIAN_BASE_URL = "http://localhost:3000";
    process.env.DATABASE_URL = "file::memory:";
    resetEnvCacheForTests();
  });

  it("refuses unauthenticated cancellation before looking up a user", async () => {
    const deps = dependencies();

    await expect(startBillingCancellation(null, deps)).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
    expect(deps.users.findById).not.toHaveBeenCalled();
  });

  it("creates from server-owned references and persists only the session id", async () => {
    const attempts = attemptRepository();
    const cancellations = cancellationClient();

    const result = await startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    expect(cancellations.create).toHaveBeenCalledWith({
      customerId: "cus_server",
      subscriptionId: "sub_server",
      idempotencyKey: "idem_persisted",
    });
    expect(attempts.markCreated).toHaveBeenCalledWith(
      "cat_existing",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result).toEqual({ kind: "hosted", url: createdSession.url });
  });

  it("replays an existing session with the same persisted key and session id", async () => {
    const attempts = attemptRepository({
      cyccleSessionId: createdSession.id,
      status: "created",
      cyccleStatus: "pending",
    });
    const cancellations = cancellationClient();

    await startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    expect(cancellations.create).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "idem_persisted",
    }));
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });

  it("fails an attempt when replay returns a different session id", async () => {
    const attempts = attemptRepository({
      cyccleSessionId: "00000000-0000-4000-8000-000000000099",
      status: "created",
      cyccleStatus: "pending",
    });

    await expect(startBillingCancellation("usr_demo", dependencies({ attempts }))).rejects.toMatchObject({
      code: "cyccle_session_mismatch",
    });
    expect(attempts.markFailed).toHaveBeenCalledWith("cat_existing", "cyccle_session_mismatch");
  });

  it.each([
    ["idempotency_resource_claimed", "pending", null],
    ["idempotency_resource_expired", "expired", null],
  ] as const)("reconciles a known session after %s", async (code, status, outcome) => {
    const attempts = attemptRepository({
      cyccleSessionId: createdSession.id,
      status: "created",
      cyccleStatus: "pending",
    });
    const cancellations = cancellationClient();
    vi.mocked(cancellations.create).mockRejectedValueOnce(
      new CyccleError("api", "safe upstream message", { status: 409, code }),
    );
    vi.mocked(cancellations.retrieve).mockResolvedValueOnce({
      id: createdSession.id,
      status,
      outcome,
      expiresAt: createdSession.expiresAt,
      completedAt: null,
    });

    const result = await startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    expect(cancellations.retrieve).toHaveBeenCalledWith(createdSession.id);
    expect(attempts.updateCyccleResource).toHaveBeenCalledWith(
      "cat_existing",
      expect.objectContaining({ status, outcome }),
    );
    expect(attempts.markFailed).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "billing" });
  });

  it.each([
    "idempotency_resource_claimed",
    "idempotency_resource_expired",
  ] as const)("fails %s when no session id is available to reconcile", async (code) => {
    const attempts = attemptRepository();
    const cancellations = cancellationClient();
    vi.mocked(cancellations.create).mockRejectedValueOnce(
      new CyccleError("api", "upstream secret", { status: 409, code }),
    );

    const result = startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    await expect(result).rejects.toMatchObject({ code, status: 409 });
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining("upstream secret") });
    expect(cancellations.retrieve).not.toHaveBeenCalled();
    expect(attempts.markFailedIfPendingWithoutSession).toHaveBeenCalledWith(
      "cat_existing",
      code,
    );
  });

  it("retrieves a pending session once and persists its terminal outcome", async () => {
    const attempts = attemptRepository({
      cyccleSessionId: createdSession.id,
      status: "created",
      cyccleStatus: "pending",
    });
    vi.mocked(attempts.findLatest).mockResolvedValueOnce(
      await vi.mocked(attempts.getOrCreateReplayable)("usr_demo", "sub_server"),
    );
    const cancellations = cancellationClient();
    vi.mocked(cancellations.retrieve).mockResolvedValueOnce({
      id: createdSession.id,
      status: "completed",
      outcome: "cancelled",
      expiresAt: createdSession.expiresAt,
      completedAt: "2026-09-29T12:05:00.000Z",
    });

    await reconcileLatestCancellation(
      await vi.mocked(userRepository().findById)("usr_demo") as NonNullable<Awaited<ReturnType<UserRepository["findById"]>>>,
      { attempts, cancellations },
    );

    expect(cancellations.retrieve).toHaveBeenCalledTimes(1);
    expect(cancellations.retrieve).toHaveBeenCalledWith(createdSession.id);
    expect(attempts.updateCyccleResource).toHaveBeenCalledWith(
      "cat_existing",
      expect.objectContaining({ status: "completed", outcome: "cancelled" }),
    );
  });

  it("does not retrieve a terminal session again", async () => {
    const attempts = attemptRepository({
      cyccleSessionId: createdSession.id,
      status: "created",
      cyccleStatus: "completed",
      cyccleOutcome: "saved",
    });
    vi.mocked(attempts.findLatest).mockResolvedValueOnce(
      await vi.mocked(attempts.getOrCreateReplayable)("usr_demo", "sub_server"),
    );
    const cancellations = cancellationClient();

    await reconcileLatestCancellation(
      await vi.mocked(userRepository().findById)("usr_demo") as NonNullable<Awaited<ReturnType<UserRepository["findById"]>>>,
      { attempts, cancellations },
    );

    expect(cancellations.retrieve).not.toHaveBeenCalled();
  });

  it("keeps a pending session replayable when retrieve is ambiguous", async () => {
    const attempts = attemptRepository({
      cyccleSessionId: createdSession.id,
      status: "created",
      cyccleStatus: "pending",
    });
    vi.mocked(attempts.findLatest).mockResolvedValueOnce(
      await vi.mocked(attempts.getOrCreateReplayable)("usr_demo", "sub_server"),
    );
    const cancellations = cancellationClient();
    vi.mocked(cancellations.retrieve).mockRejectedValueOnce(
      new CyccleError("network", "upstream secret"),
    );

    await expect(reconcileLatestCancellation(
      await vi.mocked(userRepository().findById)("usr_demo") as NonNullable<Awaited<ReturnType<UserRepository["findById"]>>>,
      { attempts, cancellations },
    )).resolves.toBeUndefined();

    expect(attempts.recordError).toHaveBeenCalledWith("cat_existing", "retrieve_network");
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });

  it.each([
    ["network", new CyccleError("network", "upstream secret")],
    ["timeout", new CyccleError("timeout", "upstream secret")],
    ["aborted", new CyccleError("aborted", "upstream secret")],
    ["invalid_response", new CyccleError("invalid_response", "upstream secret")],
    ["api_503", new CyccleError("api", "upstream secret", { status: 503, code: "server_error" })],
    ["api_429", new CyccleError("api", "upstream secret", { status: 429, code: "rate_limited" })],
    ["unexpected", new Error("upstream secret")],
  ])("keeps ambiguous %s failures replayable without exposing their cause", async (code, failure) => {
    const attempts = attemptRepository();
    const cancellations = cancellationClient();
    vi.mocked(cancellations.create).mockRejectedValueOnce(failure);

    const result = startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    await expect(result).rejects.toMatchObject({
      code: "cyccle_ambiguous",
      message: "Unable to confirm whether Cyccle created the cancellation session.",
    });
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining("upstream secret") });
    expect(attempts.recordError).toHaveBeenCalledWith("cat_existing", code);
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });

  it.each([
    [
      "validation",
      new CyccleError("validation", "upstream secret", { code: "invalid_request" }),
      "cyccle_request_rejected",
      "invalid_request",
    ],
    [
      "api_400",
      new CyccleError("api", "upstream secret", { status: 400, code: "invalid_request" }),
      "cyccle_request_rejected",
      "invalid_request",
    ],
    [
      "idempotency_conflict",
      new CyccleError("api", "upstream secret", { status: 409, code: "idempotency_conflict" }),
      "idempotency_conflict",
      "idempotency_conflict",
    ],
  ])("marks deterministic %s failures terminal", async (_name, failure, publicCode, storedCode) => {
    const attempts = attemptRepository();
    const cancellations = cancellationClient();
    vi.mocked(cancellations.create).mockRejectedValueOnce(failure);

    const result = startBillingCancellation("usr_demo", dependencies({ attempts, cancellations }));

    await expect(result).rejects.toMatchObject({ code: publicCode });
    await expect(result).rejects.not.toMatchObject({ message: expect.stringContaining("upstream secret") });
    expect(attempts.markFailed).toHaveBeenCalledWith("cat_existing", storedCode);
    expect(attempts.recordError).not.toHaveBeenCalled();
  });
});

function dependencies(overrides: {
  attempts?: CancellationAttemptRepository;
  cancellations?: CancellationClient;
} = {}) {
  return {
    users: userRepository(),
    attempts: overrides.attempts ?? attemptRepository(),
    cancellations: overrides.cancellations ?? cancellationClient(),
  };
}

function userRepository(): UserRepository {
  const user = {
    id: "usr_demo",
    email: "demo@meridian.local",
    stripeCustomerId: "cus_server",
    stripeSubscriptionId: "sub_server",
    createdAt: "2026-09-29T08:00:00.000Z",
    updatedAt: "2026-09-29T08:00:00.000Z",
  };
  return {
    findById: vi.fn(async (id: string) => id === user.id ? user : null),
    findDemoUser: vi.fn(async () => user),
    upsertDemoUser: vi.fn(),
  };
}

function attemptRepository(overrides: Partial<CancellationAttempt> = {}): CancellationAttemptRepository {
  const attempt = () => ({
    id: "cat_existing",
    userId: "usr_demo",
    subscriptionId: "sub_server",
    idempotencyKey: "idem_persisted",
    cyccleSessionId: null,
    status: "pending" as const,
    cyccleStatus: null,
    cyccleOutcome: null,
    errorCode: null,
    createdAt: "2026-09-29T08:00:00.000Z",
    updatedAt: "2026-09-29T08:00:00.000Z",
    ...overrides,
  });
  return {
    getOrCreateReplayable: vi.fn(async () => attempt()),
    findById: vi.fn(async () => attempt()),
    findLatest: vi.fn(async () => null),
    markCreated: vi.fn(),
    recordError: vi.fn(),
    markFailed: vi.fn(),
    markFailedIfPendingWithoutSession: vi.fn(async () => true),
    updateCyccleResource: vi.fn(),
  };
}

function cancellationClient(): CancellationClient {
  return {
    create: vi.fn(async () => createdSession),
    retrieve: vi.fn(),
  };
}
