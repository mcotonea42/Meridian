import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CancellationAttemptRepository, CyccleClient } from "@/server/cyccle";
import {
  assertHostedUrl,
  BillingCancellationError,
  cyccleClient,
  startBillingCancellation,
} from "@/server/cyccle";
import { resetEnvCacheForTests } from "@/env";
import type { UserRepository } from "@/server/users";

const user = {
  id: "usr_demo",
  email: "demo@meridian.local",
  stripeCustomerId: "cus_demo",
  stripeSubscriptionId: "sub_demo",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Cyccle cancellation boundary", () => {
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

  it("refuses unauthenticated cancellation", async () => {
    await expect(startBillingCancellation(null, deps())).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
  });

  it("loads Stripe references from the server-side user, not the browser", async () => {
    const cyccle: CyccleClient = {
      createCancelSession: vi.fn().mockResolvedValue(createdResponse()),
    };

    await startBillingCancellation("usr_demo", deps({ cyccle }));

    expect(cyccle.createCancelSession).toHaveBeenCalledWith({
      customerId: "cus_demo",
      subscriptionId: "sub_demo",
      idempotencyKey: "idem_123",
    });
  });

  it("sends the Cyccle API key server-side with Idempotency-Key", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createdResponse(),
    });
    const client = cyccleClient(fetcher as unknown as typeof fetch);

    await client.createCancelSession({
      customerId: "cus_demo",
      subscriptionId: "sub_demo",
      idempotencyKey: "idem_123",
    });

    expect(fetcher).toHaveBeenCalledWith(new URL("/v1/cancel-sessions", "https://api-staging.cyccle.co"), {
      method: "POST",
      headers: {
        Authorization: "Bearer ck_test_secret",
        "Content-Type": "application/json",
        "Idempotency-Key": "idem_123",
      },
      body: JSON.stringify({ customerId: "cus_demo", subscriptionId: "sub_demo" }),
      cache: "no-store",
    });
  });

  it("validates the Cyccle response and hosted URL before redirecting", async () => {
    expect(() => assertHostedUrl("https://cancel-staging.cyccle.co/start#cl_abc")).not.toThrow();
    expect(() => assertHostedUrl("http://cancel-staging.cyccle.co/start#cl_abc")).toThrow(BillingCancellationError);
    expect(() => assertHostedUrl("https://cancel-staging.cyccle.co/start")).toThrow(BillingCancellationError);
  });

  it("marks the attempt failed when Cyccle rejects the request", async () => {
    const attempts = attemptRepo();
    const cyccle: CyccleClient = {
      createCancelSession: vi.fn().mockRejectedValue(new BillingCancellationError("cyccle_error", "nope", 409)),
    };

    await expect(startBillingCancellation("usr_demo", deps({ attempts, cyccle }))).rejects.toMatchObject({
      code: "cyccle_error",
    });
    expect(attempts.markFailed).toHaveBeenCalledWith("attempt_123", "cyccle_error");
  });
});

function deps(overrides: Partial<Parameters<typeof startBillingCancellation>[1]> = {}) {
  return {
    users: userRepo(),
    attempts: attemptRepo(),
    cyccle: {
      createCancelSession: vi.fn().mockResolvedValue(createdResponse()),
    },
    ...overrides,
  };
}

function userRepo(): UserRepository {
  return {
    findById: vi.fn(async (id: string) => (id === user.id ? user : null)),
    findDemoUser: vi.fn(async () => user),
    upsertDemoUser: vi.fn(),
  };
}

function attemptRepo(): CancellationAttemptRepository {
  return {
    getOrCreatePending: vi.fn(async () => ({
      id: "attempt_123",
      userId: user.id,
      subscriptionId: "sub_demo",
      idempotencyKey: "idem_123",
      cyccleSessionId: null,
      hostedUrl: null,
      status: "pending" as const,
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    markCreated: vi.fn(),
    markFailed: vi.fn(),
  };
}

function createdResponse() {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://cancel-staging.cyccle.co/start#cl_abc",
    expiresAt: "2026-09-24T12:00:00.000Z",
  };
}
