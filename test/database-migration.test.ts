import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "@/server/db";

describe("cancellation attempt migrations", () => {
  it("creates a fresh database once and preserves it on the next startup", () => {
    const directory = mkdtempSync(join(tmpdir(), "meridian-fresh-migration-"));
    const databasePath = join(directory, "fresh.db");
    let connection = new DatabaseSync(databasePath);

    try {
      connection.exec("PRAGMA journal_mode = WAL");
      migrateDatabase(connection);
      connection.prepare(`
        insert into users values (?, ?, ?, ?, ?, ?)
      `).run(
        "usr_fresh",
        "fresh@meridian.local",
        "cus_fresh",
        "sub_fresh",
        "2026-09-29T08:00:00.000Z",
        "2026-09-29T08:00:00.000Z",
      );
      const firstRootPage = connection.prepare(
        "select rootpage from sqlite_schema where type = 'table' and name = 'cancellation_attempts'",
      ).get();
      connection.close();

      connection = new DatabaseSync(databasePath);
      connection.exec("PRAGMA journal_mode = WAL");
      migrateDatabase(connection);

      const columns = connection.prepare("pragma table_info(cancellation_attempts)").all();
      expect(columns.map((column) => String(column.name))).toEqual([
        "id",
        "user_id",
        "subscription_id",
        "idempotency_key",
        "cyccle_session_id",
        "status",
        "cyccle_status",
        "cyccle_outcome",
        "error_code",
        "created_at",
        "updated_at",
      ]);
      expect(connection.prepare("select id from users").get()).toMatchObject({ id: "usr_fresh" });
      expect(connection.prepare(
        "select rootpage from sqlite_schema where type = 'table' and name = 'cancellation_attempts'",
      ).get()).toEqual(firstRootPage);
      expect(connection.prepare("pragma user_version").get()).toMatchObject({ user_version: 1 });
      expect(connection.prepare("pragma secure_delete").get()).toMatchObject({ secure_delete: 1 });
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it("physically erases a legacy capability from the database and WAL", () => {
    const directory = mkdtempSync(join(tmpdir(), "meridian-capability-erasure-"));
    const databasePath = join(directory, "legacy.db");
    const walPath = `${databasePath}-wal`;
    const token = `cl_${"E".repeat(43)}`;
    const connection = legacyDatabase(databasePath, `https://cancel.example/start#${token}`);

    try {
      connection.prepare("pragma wal_checkpoint(truncate)").get();
      expect(readFileSync(databasePath).includes(Buffer.from(token))).toBe(true);

      migrateDatabase(connection);

      const columns = connection.prepare("pragma table_info(cancellation_attempts)").all();
      const migrated = connection.prepare(
        "select id, cyccle_session_id, status, cyccle_status, cyccle_outcome, error_code from cancellation_attempts",
      ).get();
      expect(columns.map((column) => String(column.name))).not.toContain("hosted_url");
      expect(migrated).toMatchObject({
        id: "cat_legacy",
        cyccle_session_id: "00000000-0000-4000-8000-000000000001",
        status: "created",
        cyccle_status: "pending",
        cyccle_outcome: null,
        error_code: null,
      });
      expect(connection.prepare("pragma integrity_check").get()).toMatchObject({
        integrity_check: "ok",
      });
      expect(connection.prepare("pragma secure_delete").get()).toMatchObject({ secure_delete: 1 });
    } finally {
      connection.close();
    }

    try {
      expect(readFileSync(databasePath).includes(Buffer.from(token))).toBe(false);
      if (existsSync(walPath)) {
        expect(readFileSync(walPath).includes(Buffer.from(token))).toBe(false);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function legacyDatabase(
  path = ":memory:",
  hostedUrl = "https://cancel.example/start#cl_secret",
): DatabaseSync {
  const connection = new DatabaseSync(path);
  connection.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  connection.prepare(`
    insert into cancellation_attempts values (
      'cat_legacy', 'usr_demo', 'sub_demo', 'idem_legacy',
      '00000000-0000-4000-8000-000000000001', ?, 'created', null,
      '2026-09-24T12:00:00.000Z', '2026-09-24T12:00:00.000Z'
    )
  `).run(hostedUrl);
  return connection;
}
