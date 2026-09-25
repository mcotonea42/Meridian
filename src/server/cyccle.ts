import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
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

const CyccleCreateResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
});

export type CyccleCreateResponse = z.infer<typeof CyccleCreateResponseSchema>;

export class BillingCancellationError extends Error {
  constructor(
    readonly code:
      | "unauthenticated"
      | "missing_stripe_reference"
      | "cyccle_error"
      | "invalid_cyccle_response"
      | "invalid_hosted_url",
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface CancellationAttemptRepository {
  getOrCreatePending(userId: string, subscriptionId: string): Promise<CancellationAttempt>;
  markCreated(id: string, response: CyccleCreateResponse): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}

export interface CyccleClient {
  createCancelSession(input: {
    customerId: string;
    subscriptionId: string;
    idempotencyKey: string;
  }): Promise<CyccleCreateResponse>;
}

export interface BillingCancellationDependencies {
  users: UserRepository;
  attempts: CancellationAttemptRepository;
  cyccle: CyccleClient;
}

export function cancellationAttemptRepository(connection: DatabaseSync = database()): CancellationAttemptRepository {
  return {
    async getOrCreatePending(userId, subscriptionId) {
      const row = connection
        .prepare(`
          select * from cancellation_attempts
          where user_id = ? and subscription_id = ? and status in ('pending', 'created')
          order by created_at desc
          limit 1
        `)
        .get(userId, subscriptionId);
      if (row) return rowToAttempt(row as Record<string, unknown>);

      const id = newId("cat");
      const timestamp = nowIso();
      const idempotencyKey = `meridian:${userId}:${subscriptionId}:${id}`;
      connection
        .prepare(`
          insert into cancellation_attempts (
            id, user_id, subscription_id, idempotency_key, status, created_at, updated_at
          ) values (?, ?, ?, ?, 'pending', ?, ?)
        `)
        .run(id, userId, subscriptionId, idempotencyKey, timestamp, timestamp);
      return rowToAttempt(
        connection.prepare("select * from cancellation_attempts where id = ?").get(id) as Record<string, unknown>,
      );
    },
    async markCreated(id, response) {
      connection
        .prepare(`
          update cancellation_attempts
          set cyccle_session_id = ?, hosted_url = ?, status = 'created', error_code = null, updated_at = ?
          where id = ?
        `)
        .run(response.id, response.url, nowIso(), id);
    },
    async markFailed(id, errorCode) {
      connection
        .prepare(`
          update cancellation_attempts
          set status = 'failed', error_code = ?, updated_at = ?
          where id = ?
        `)
        .run(errorCode, nowIso(), id);
    },
  };
}

export function cyccleClient(fetcher: typeof fetch = fetch): CyccleClient {
  return {
    async createCancelSession(input) {
      const response = await fetcher(new URL("/v1/cancel-sessions", env().CYCCLE_API_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env().CYCCLE_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          customerId: input.customerId,
          subscriptionId: input.subscriptionId,
        }),
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const code = z
          .object({ error: z.object({ code: z.string() }) })
          .safeParse(json).data?.error.code ?? "cyccle_error";
        throw new BillingCancellationError("cyccle_error", `Cyccle rejected the cancellation session: ${code}`, response.status);
      }
      const parsed = CyccleCreateResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new BillingCancellationError("invalid_cyccle_response", "Cyccle returned an invalid cancellation session response", 502);
      }
      assertHostedUrl(parsed.data.url);
      return parsed.data;
    },
  };
}

export async function startBillingCancellation(
  userId: string | null,
  deps: BillingCancellationDependencies = {
    users: userRepository(),
    attempts: cancellationAttemptRepository(),
    cyccle: cyccleClient(),
  },
): Promise<CyccleCreateResponse> {
  if (!userId) {
    throw new BillingCancellationError("unauthenticated", "Sign in to Meridian before cancelling.", 401);
  }
  const user = await deps.users.findById(userId);
  if (!user) {
    throw new BillingCancellationError("unauthenticated", "Session user was not found.", 401);
  }
  requireStripeReferences(user);
  const attempt = await deps.attempts.getOrCreatePending(user.id, user.stripeSubscriptionId);
  try {
    const response = await deps.cyccle.createCancelSession({
      customerId: user.stripeCustomerId,
      subscriptionId: user.stripeSubscriptionId,
      idempotencyKey: attempt.idempotencyKey,
    });
    assertHostedUrl(response.url);
    await deps.attempts.markCreated(attempt.id, response);
    return response;
  } catch (error) {
    await deps.attempts.markFailed(attempt.id, error instanceof BillingCancellationError ? error.code : "cyccle_error");
    throw error;
  }
}

export function assertHostedUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingCancellationError("invalid_hosted_url", "Cyccle returned a malformed hosted URL.", 502);
  }
  if (url.protocol !== "https:") {
    throw new BillingCancellationError("invalid_hosted_url", "Cyccle hosted URL must be HTTPS.", 502);
  }
  if (!url.hash.startsWith("#cl_")) {
    throw new BillingCancellationError("invalid_hosted_url", "Cyccle hosted URL did not include an opaque launch token.", 502);
  }
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
