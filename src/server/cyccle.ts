import type { DatabaseSync } from "node:sqlite";
import {
  Cyccle,
  CyccleError,
  type HostedCancellationLink,
  type MerchantCancellationResource,
} from "@cyccle/server";
import { env } from "@/env";
import {
  database,
  newId,
  nowIso,
  rowToAttempt,
  type CancellationAttempt,
  type MeridianUser,
} from "@/server/db";
import { userRepository, type UserRepository } from "@/server/users";

export type CancellationClient = Pick<Cyccle["cancellations"], "create" | "retrieve">;

export class BillingCancellationError extends Error {
  constructor(
    readonly code:
      | "unauthenticated"
      | "missing_stripe_reference"
      | "cyccle_request_rejected"
      | "cyccle_ambiguous"
      | "idempotency_conflict"
      | "idempotency_resource_claimed"
      | "idempotency_resource_expired"
      | "cyccle_session_mismatch"
      | "cancellation_attempt_state_conflict",
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface CancellationAttemptRepository {
  getOrCreateReplayable(userId: string, subscriptionId: string): Promise<CancellationAttempt>;
  findById(id: string): Promise<CancellationAttempt | null>;
  findLatest(userId: string, subscriptionId: string): Promise<CancellationAttempt | null>;
  markCreated(id: string, sessionId: string): Promise<void>;
  recordError(id: string, errorCode: string): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
  markFailedIfPendingWithoutSession(id: string, errorCode: string): Promise<boolean>;
  updateCyccleResource(id: string, resource: MerchantCancellationResource): Promise<void>;
}

export interface BillingCancellationDependencies {
  users: UserRepository;
  attempts: CancellationAttemptRepository;
  cancellations: CancellationClient;
}

export type CancellationReconciliationDependencies = Pick<
  BillingCancellationDependencies,
  "attempts" | "cancellations"
>;

export type BillingCancellationStartResult =
  | { readonly kind: "hosted"; readonly url: string }
  | { readonly kind: "billing" };

export function cancellationAttemptRepository(
  connection: DatabaseSync = database(),
): CancellationAttemptRepository {
  return {
    async getOrCreateReplayable(userId, subscriptionId) {
      const existing = findReplayableAttempt(connection, userId, subscriptionId);
      if (existing) return existing;
      const id = newId("cat");
      const timestamp = nowIso();
      const idempotencyKey = `meridian:${userId}:${subscriptionId}:${id}`;
      connection.prepare(`
        insert into cancellation_attempts (
          id, user_id, subscription_id, idempotency_key, status, created_at, updated_at
        ) values (?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, userId, subscriptionId, idempotencyKey, timestamp, timestamp);
      return readAttempt(connection, id);
    },
    async findById(id) {
      const row = connection.prepare("select * from cancellation_attempts where id = ?").get(id);
      return row ? rowToAttempt(row as Record<string, unknown>) : null;
    },
    async findLatest(userId, subscriptionId) {
      const row = connection.prepare(`
        select * from cancellation_attempts
        where user_id = ? and subscription_id = ?
        order by created_at desc
        limit 1
      `).get(userId, subscriptionId);
      return row ? rowToAttempt(row as Record<string, unknown>) : null;
    },
    async markCreated(id, sessionId) {
      connection.prepare(`
        update cancellation_attempts
        set cyccle_session_id = ?, status = 'created', cyccle_status = 'pending',
          cyccle_outcome = null, error_code = null, updated_at = ?
        where id = ?
      `).run(sessionId, nowIso(), id);
    },
    async recordError(id, errorCode) {
      connection.prepare(`
        update cancellation_attempts
        set error_code = ?, updated_at = ?
        where id = ?
      `).run(errorCode, nowIso(), id);
    },
    async markFailed(id, errorCode) {
      connection.prepare(`
        update cancellation_attempts
        set status = 'failed', error_code = ?, updated_at = ?
        where id = ?
      `).run(errorCode, nowIso(), id);
    },
    async markFailedIfPendingWithoutSession(id, errorCode) {
      const result = connection.prepare(`
        update cancellation_attempts
        set status = 'failed', error_code = ?, updated_at = ?
        where id = ? and status = 'pending' and cyccle_session_id is null
      `).run(errorCode, nowIso(), id);
      return Number(result.changes) === 1;
    },
    async updateCyccleResource(id, resource) {
      connection.prepare(`
        update cancellation_attempts
        set cyccle_status = ?, cyccle_outcome = ?, error_code = null, updated_at = ?
        where id = ?
      `).run(resource.status, resource.outcome, nowIso(), id);
    },
  };
}

export async function startBillingCancellation(
  userId: string | null,
  deps: BillingCancellationDependencies = defaultDependencies(),
): Promise<BillingCancellationStartResult> {
  if (!userId) {
    throw new BillingCancellationError("unauthenticated", "Sign in to Meridian before cancelling.", 401);
  }
  const user = await deps.users.findById(userId);
  if (!user) {
    throw new BillingCancellationError("unauthenticated", "Session user was not found.", 401);
  }
  requireStripeReferences(user);
  const attempt = await deps.attempts.getOrCreateReplayable(user.id, user.stripeSubscriptionId);
  let session: HostedCancellationLink;
  try {
    session = await deps.cancellations.create({
      customerId: user.stripeCustomerId,
      subscriptionId: user.stripeSubscriptionId,
      idempotencyKey: attempt.idempotencyKey,
    });
  } catch (error) {
    const reconciled = await reconcileKnownIdempotencyResource(error, attempt, deps);
    if (reconciled) return reconciled;
    const deterministic = deterministicFailure(error);
    if (deterministic) {
      await deps.attempts.markFailed(attempt.id, deterministic.storedCode);
      throw new BillingCancellationError(
        deterministic.publicCode,
        deterministic.message,
        deterministic.status,
      );
    }
    const errorCode = ambiguousErrorCode(error);
    if (!errorCode) throw error;
    await deps.attempts.recordError(attempt.id, errorCode);
    throw new BillingCancellationError(
      "cyccle_ambiguous",
      "Unable to confirm whether Cyccle created the cancellation session.",
      error instanceof CyccleError && error.kind === "timeout" ? 504 : 502,
    );
  }
  if (attempt.cyccleSessionId && attempt.cyccleSessionId !== session.id) {
    await deps.attempts.markFailed(attempt.id, "cyccle_session_mismatch");
    throw new BillingCancellationError(
      "cyccle_session_mismatch",
      "Cyccle returned a different session for an existing cancellation attempt.",
      502,
    );
  }
  await deps.attempts.markCreated(attempt.id, session.id);
  return { kind: "hosted", url: session.url };
}

export async function reconcileLatestCancellation(
  user: MeridianUser,
  deps: CancellationReconciliationDependencies = defaultReconciliationDependencies(),
): Promise<void> {
  if (!user.stripeSubscriptionId) return;
  const attempt = await deps.attempts.findLatest(user.id, user.stripeSubscriptionId);
  if (
    !attempt?.cyccleSessionId
    || attempt.status !== "created"
    || attempt.cyccleStatus !== "pending"
  ) {
    return;
  }
  try {
    const resource = await deps.cancellations.retrieve(attempt.cyccleSessionId);
    if (resource.id !== attempt.cyccleSessionId) {
      await deps.attempts.markFailed(attempt.id, "cyccle_session_mismatch");
      return;
    }
    await deps.attempts.updateCyccleResource(attempt.id, resource);
  } catch (error) {
    const ambiguous = ambiguousErrorCode(error);
    if (ambiguous) {
      await deps.attempts.recordError(attempt.id, `retrieve_${ambiguous}`);
      return;
    }
    const deterministic = deterministicFailure(error);
    await deps.attempts.markFailed(
      attempt.id,
      deterministic?.storedCode ?? "retrieve_rejected",
    );
  }
}

async function reconcileKnownIdempotencyResource(
  error: unknown,
  attempt: CancellationAttempt,
  deps: BillingCancellationDependencies,
): Promise<{ readonly kind: "billing" } | undefined> {
  if (
    !(error instanceof CyccleError)
    || error.kind !== "api"
    || error.status !== 409
    || (error.code !== "idempotency_resource_claimed"
      && error.code !== "idempotency_resource_expired")
  ) {
    return undefined;
  }
  let sessionId = attempt.cyccleSessionId;
  if (!sessionId) {
    const markedFailed = await deps.attempts.markFailedIfPendingWithoutSession(
      attempt.id,
      error.code,
    );
    if (markedFailed) throw unrecoverableIdempotencyResource(error.code);
    const currentAttempt = await deps.attempts.findById(attempt.id);
    if (currentAttempt?.status === "failed") {
      throw unrecoverableIdempotencyResource(error.code);
    }
    if (!currentAttempt?.cyccleSessionId || currentAttempt.status !== "created") {
      throw new BillingCancellationError(
        "cancellation_attempt_state_conflict",
        "The cancellation attempt changed to an incompatible state.",
        409,
      );
    }
    sessionId = currentAttempt.cyccleSessionId;
  }
  try {
    const resource = await deps.cancellations.retrieve(sessionId);
    if (resource.id !== sessionId) {
      await deps.attempts.markFailed(attempt.id, "cyccle_session_mismatch");
      throw new BillingCancellationError(
        "cyccle_session_mismatch",
        "Cyccle returned a different session for an existing cancellation attempt.",
        502,
      );
    }
    await deps.attempts.updateCyccleResource(attempt.id, resource);
    return { kind: "billing" };
  } catch (retrieveError) {
    if (retrieveError instanceof BillingCancellationError) throw retrieveError;
    const errorCode = ambiguousErrorCode(retrieveError);
    if (errorCode) {
      await deps.attempts.recordError(attempt.id, `retrieve_${errorCode}`);
      throw new BillingCancellationError(
        "cyccle_ambiguous",
        "Unable to confirm the current Cyccle cancellation status.",
        retrieveError instanceof CyccleError && retrieveError.kind === "timeout" ? 504 : 502,
      );
    }
    const deterministic = deterministicFailure(retrieveError);
    await deps.attempts.markFailed(
      attempt.id,
      deterministic?.storedCode ?? "retrieve_rejected",
    );
    throw new BillingCancellationError(
      "cyccle_request_rejected",
      "Cyccle rejected the cancellation status request.",
      502,
    );
  }
}

function unrecoverableIdempotencyResource(
  code: "idempotency_resource_claimed" | "idempotency_resource_expired",
): BillingCancellationError {
  return new BillingCancellationError(
    code,
    "Cyccle cannot replay this cancellation attempt without its session reference.",
    409,
  );
}

function deterministicFailure(error: unknown): {
  storedCode: string;
  publicCode: "cyccle_request_rejected" | "idempotency_conflict";
  message: string;
  status: number;
} | undefined {
  if (!(error instanceof CyccleError)) return undefined;
  if (error.kind === "validation") {
    return rejectedFailure(error.code ?? "validation");
  }
  if (error.kind !== "api" || error.status === undefined) return undefined;
  if (error.code === "idempotency_conflict") {
    return {
      storedCode: error.code,
      publicCode: "idempotency_conflict",
      message: "The cancellation attempt conflicts with an existing Cyccle request.",
      status: 409,
    };
  }
  if (error.status >= 400 && error.status < 500 && error.status !== 429) {
    return rejectedFailure(error.code ?? `api_${error.status}`);
  }
  return undefined;
}

function rejectedFailure(storedCode: string) {
  return {
    storedCode,
    publicCode: "cyccle_request_rejected" as const,
    message: "Cyccle rejected the cancellation request.",
    status: 502,
  };
}

function ambiguousErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CyccleError)) return "unexpected";
  if (error.kind !== "api") return error.kind === "validation" ? undefined : error.kind;
  if (error.status === 429 || (error.status !== undefined && error.status >= 500)) {
    return `api_${error.status}`;
  }
  return undefined;
}

function defaultDependencies(): BillingCancellationDependencies {
  return {
    users: userRepository(),
    attempts: cancellationAttemptRepository(),
    cancellations: defaultCancellationClient(),
  };
}

function defaultReconciliationDependencies(): CancellationReconciliationDependencies {
  return {
    attempts: cancellationAttemptRepository(),
    cancellations: defaultCancellationClient(),
  };
}

function defaultCancellationClient(): CancellationClient {
  return new Cyccle({
    apiKey: env().CYCCLE_API_KEY,
    baseUrl: env().CYCCLE_API_BASE_URL,
  }).cancellations;
}

function findReplayableAttempt(
  connection: DatabaseSync,
  userId: string,
  subscriptionId: string,
): CancellationAttempt | null {
  const row = connection.prepare(`
    select * from cancellation_attempts
    where user_id = ? and subscription_id = ?
      and (status = 'pending' or (status = 'created' and cyccle_status = 'pending'))
    order by created_at desc
    limit 1
  `).get(userId, subscriptionId);
  return row ? rowToAttempt(row as Record<string, unknown>) : null;
}

function readAttempt(connection: DatabaseSync, id: string): CancellationAttempt {
  const row = connection.prepare("select * from cancellation_attempts where id = ?").get(id);
  if (!row) throw new Error("Cancellation attempt was not persisted");
  return rowToAttempt(row as Record<string, unknown>);
}

function requireStripeReferences(
  user: MeridianUser,
): asserts user is MeridianUser & { stripeCustomerId: string; stripeSubscriptionId: string } {
  if (!user.stripeCustomerId || !user.stripeSubscriptionId) {
    throw new BillingCancellationError(
      "missing_stripe_reference",
      "The Meridian user does not have Stripe references yet.",
      409,
    );
  }
}
