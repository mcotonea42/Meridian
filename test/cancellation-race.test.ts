import { DatabaseSync } from "node:sqlite";
import { CyccleError } from "@cyccle/server";
import { describe, expect, it, vi } from "vitest";
import {
  cancellationAttemptRepository,
  startBillingCancellation,
  type CancellationClient,
} from "@/server/cyccle";
import { migrateDatabase } from "@/server/db";
import { userRepository } from "@/server/users";

const session = {
  id: "00000000-0000-4000-8000-000000000001",
  url: `https://cancel-staging.cyccle.co/start#cl_${"a".repeat(43)}`,
  expiresAt: "2026-09-29T12:00:00.000Z",
};

describe("concurrent cancellation recovery", () => {
  it("preserves a session persisted before a stale request receives claimed", async () => {
    const connection = databaseWithUser();
    const attempts = cancellationAttemptRepository(connection);
    const created = deferred<typeof session>();
    const claimed = deferred<typeof session>();
    const create = vi.fn()
      .mockImplementationOnce(() => created.promise)
      .mockImplementationOnce(() => claimed.promise);
    const retrieve = vi.fn(async () => ({
      id: session.id,
      status: "pending" as const,
      outcome: null,
      expiresAt: session.expiresAt,
      completedAt: null,
    }));
    const cancellations: CancellationClient = { create, retrieve };
    const dependencies = {
      users: userRepository(connection),
      attempts,
      cancellations,
    };

    const requestA = startBillingCancellation("usr_demo", dependencies);
    const requestB = startBillingCancellation("usr_demo", dependencies);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const pending = await attempts.findLatest("usr_demo", "sub_demo");

    created.resolve(session);
    await expect(requestA).resolves.toEqual({ kind: "hosted", url: session.url });
    claimed.reject(new CyccleError("api", "safe", {
      status: 409,
      code: "idempotency_resource_claimed",
    }));
    await expect(requestB).resolves.toEqual({ kind: "billing" });

    const recovered = await attempts.findLatest("usr_demo", "sub_demo");
    const rowCount = connection.prepare("select count(*) as count from cancellation_attempts").get();
    expect(recovered).toMatchObject({
      id: pending?.id,
      idempotencyKey: pending?.idempotencyKey,
      cyccleSessionId: session.id,
      status: "created",
      cyccleStatus: "pending",
    });
    expect(rowCount).toMatchObject({ count: 1 });
    expect(retrieve).toHaveBeenCalledWith(session.id);
    connection.close();
  });
});

function databaseWithUser(): DatabaseSync {
  const connection = new DatabaseSync(":memory:");
  connection.exec("PRAGMA foreign_keys = ON");
  migrateDatabase(connection);
  connection.prepare(`
    insert into users (
      id, email, stripe_customer_id, stripe_subscription_id, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?)
  `).run(
    "usr_demo",
    "demo@meridian.local",
    "cus_demo",
    "sub_demo",
    "2026-09-29T08:00:00.000Z",
    "2026-09-29T08:00:00.000Z",
  );
  return connection;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
