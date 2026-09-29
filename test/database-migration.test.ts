import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "@/server/db";

describe("cancellation attempt migrations", () => {
  it("removes persisted capability URLs and makes created sessions reconcilable", () => {
    const connection = legacyDatabase();

    migrateDatabase(connection);

    const columns = connection.prepare("pragma table_info(cancellation_attempts)").all();
    const row = connection.prepare("select * from cancellation_attempts where id = ?").get("cat_legacy");
    expect(columns.map((column) => String(column.name))).not.toContain("hosted_url");
    expect(row).toMatchObject({
      id: "cat_legacy",
      cyccle_session_id: "00000000-0000-4000-8000-000000000001",
      status: "created",
      cyccle_status: "pending",
      cyccle_outcome: null,
    });
    expect(connection.prepare("pragma user_version").get()).toMatchObject({ user_version: 1 });
    connection.close();
  });
});

function legacyDatabase(): DatabaseSync {
  const connection = new DatabaseSync(":memory:");
  connection.exec(`
    PRAGMA foreign_keys = ON;
    create table users (
      id text primary key,
      email text not null unique,
      stripe_customer_id text,
      stripe_subscription_id text,
      created_at text not null,
      updated_at text not null
    );
    create table cancellation_attempts (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      subscription_id text not null,
      idempotency_key text not null unique,
      cyccle_session_id text,
      hosted_url text,
      status text not null check (status in ('pending', 'created', 'failed')),
      error_code text,
      created_at text not null,
      updated_at text not null
    );
    insert into users values (
      'usr_demo', 'demo@meridian.local', 'cus_demo', 'sub_demo',
      '2026-09-24T12:00:00.000Z', '2026-09-24T12:00:00.000Z'
    );
    insert into cancellation_attempts values (
      'cat_legacy', 'usr_demo', 'sub_demo', 'idem_legacy',
      '00000000-0000-4000-8000-000000000001',
      'https://cancel.example/start#cl_secret', 'created', null,
      '2026-09-24T12:00:00.000Z', '2026-09-24T12:00:00.000Z'
    );
  `);
  return connection;
}
