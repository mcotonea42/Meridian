import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { cancellationAttemptRepository } from "@/server/cyccle";
import { migrateDatabase } from "@/server/db";

describe("cancellation attempt repository", () => {
  it("replays an ambiguous attempt with the same id and idempotency key", async () => {
    const connection = databaseWithUser();
    const attempts = cancellationAttemptRepository(connection);

    const first = await attempts.getOrCreateReplayable("usr_demo", "sub_demo");
    await attempts.recordError(first.id, "network");
    const replay = await attempts.getOrCreateReplayable("usr_demo", "sub_demo");

    expect(replay.id).toBe(first.id);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(replay.status).toBe("pending");
    expect(replay.errorCode).toBe("network");
    connection.close();
  });

  it("persists status and outcome without a hosted capability URL", async () => {
    const connection = databaseWithUser();
    const attempts = cancellationAttemptRepository(connection);
    const first = await attempts.getOrCreateReplayable("usr_demo", "sub_demo");

    await attempts.markCreated(first.id, "00000000-0000-4000-8000-000000000001");
    await attempts.updateCyccleResource(first.id, {
      id: "00000000-0000-4000-8000-000000000001",
      status: "completed",
      outcome: "cancelled",
      expiresAt: "2026-09-29T12:00:00.000Z",
      completedAt: "2026-09-29T11:55:00.000Z",
    });

    const stored = await attempts.findLatest("usr_demo", "sub_demo");
    const columns = connection.prepare("pragma table_info(cancellation_attempts)").all();
    expect(stored).toMatchObject({
      status: "created",
      cyccleStatus: "completed",
      cyccleOutcome: "cancelled",
      errorCode: null,
    });
    expect(columns.map((column) => String(column.name))).not.toContain("hosted_url");

    const next = await attempts.getOrCreateReplayable("usr_demo", "sub_demo");
    expect(next.id).not.toBe(first.id);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
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
