import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { env } from "@/env";

export interface MeridianUser {
  id: string;
  email: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CancellationAttempt {
  id: string;
  userId: string;
  subscriptionId: string;
  idempotencyKey: string;
  cyccleSessionId: string | null;
  status: "pending" | "created" | "failed";
  cyccleStatus: "pending" | "completed" | "expired" | "failed" | null;
  cyccleOutcome: "saved" | "deflected" | "cancelled" | "abandoned" | "execution_failed" | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (db) return db;
  const path = databasePath(env().DATABASE_URL);
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  try {
    connection.exec("PRAGMA journal_mode = WAL");
    connection.exec("PRAGMA foreign_keys = ON");
    migrateDatabase(connection);
  } catch (error) {
    try {
      connection.close();
    } catch {
      // Preserve the initialization error that prevented a usable database.
    }
    throw error;
  }
  db = connection;
  return connection;
}

export function resetDatabaseForTests(nextDb: DatabaseSync | null = null): void {
  db?.close();
  db = nextDb;
}

function databasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use file: SQLite format, for example file:./data/meridian.db");
  }
  const rawPath = databaseUrl.slice("file:".length);
  if (rawPath === ":memory:") return ":memory:";
  if (rawPath.startsWith("/")) return rawPath;
  return resolve(/* turbopackIgnore: true */ process.cwd(), rawPath);
}

export function migrateDatabase(connection: DatabaseSync): void {
  connection.exec("PRAGMA secure_delete = ON");
  const journalModeRow = connection.prepare("pragma journal_mode").get() as {
    journal_mode: string;
  };
  const versionRow = connection.prepare("pragma user_version").get() as { user_version: number };
  if (versionRow.user_version >= 1) {
    checkpointWal(connection, journalModeRow.journal_mode);
    return;
  }
  const foreignKeysRow = connection.prepare("pragma foreign_keys").get() as { foreign_keys: number };
  connection.exec("PRAGMA foreign_keys = OFF");
  try {
    connection.exec("BEGIN IMMEDIATE");
    connection.exec(`
      create table if not exists users (
        id text primary key,
        email text not null unique,
        stripe_customer_id text,
        stripe_subscription_id text,
        created_at text not null,
        updated_at text not null
      );
    `);
    const columns = connection.prepare("pragma table_info(cancellation_attempts)").all();
    if (columns.length === 0) createCancellationAttemptsTable(connection);
    else if (columns.some((column) => column.name === "hosted_url")) {
      migrateLegacyCancellationAttempts(connection);
    }
    connection.exec("PRAGMA user_version = 1");
    connection.exec("COMMIT");
  } catch (error) {
    try {
      connection.exec("ROLLBACK");
    } catch {
      // The original migration error is more useful than a rollback failure.
    }
    throw error;
  } finally {
    if (foreignKeysRow.foreign_keys === 1) connection.exec("PRAGMA foreign_keys = ON");
  }
  checkpointWal(connection, journalModeRow.journal_mode);
}

function checkpointWal(connection: DatabaseSync, journalMode: string): void {
  if (journalMode.toLowerCase() !== "wal") return;
  const checkpoint = connection.prepare("pragma wal_checkpoint(truncate)").get() as {
    busy: number;
  };
  if (checkpoint.busy !== 0) {
    throw new Error("SQLite WAL checkpoint remained busy after migration");
  }
}

function createCancellationAttemptsTable(connection: DatabaseSync): void {
  connection.exec(`
    create table cancellation_attempts (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      subscription_id text not null,
      idempotency_key text not null unique,
      cyccle_session_id text,
      status text not null check (status in ('pending', 'created', 'failed')),
      cyccle_status text check (cyccle_status in ('pending', 'completed', 'expired', 'failed')),
      cyccle_outcome text check (cyccle_outcome in ('saved', 'deflected', 'cancelled', 'abandoned', 'execution_failed')),
      error_code text,
      created_at text not null,
      updated_at text not null
    );
    create index cancellation_attempts_lookup_idx
      on cancellation_attempts(user_id, subscription_id, created_at desc);
  `);
}

function migrateLegacyCancellationAttempts(connection: DatabaseSync): void {
  connection.exec(`
    create table cancellation_attempts_next (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      subscription_id text not null,
      idempotency_key text not null unique,
      cyccle_session_id text,
      status text not null check (status in ('pending', 'created', 'failed')),
      cyccle_status text check (cyccle_status in ('pending', 'completed', 'expired', 'failed')),
      cyccle_outcome text check (cyccle_outcome in ('saved', 'deflected', 'cancelled', 'abandoned', 'execution_failed')),
      error_code text,
      created_at text not null,
      updated_at text not null
    );
    insert into cancellation_attempts_next (
      id, user_id, subscription_id, idempotency_key, cyccle_session_id,
      status, cyccle_status, cyccle_outcome, error_code, created_at, updated_at
    )
    select id, user_id, subscription_id, idempotency_key, cyccle_session_id,
      status, case when status = 'created' then 'pending' else null end,
      null, error_code, created_at, updated_at
    from cancellation_attempts;
    drop table cancellation_attempts;
    alter table cancellation_attempts_next rename to cancellation_attempts;
    create index cancellation_attempts_lookup_idx
      on cancellation_attempts(user_id, subscription_id, created_at desc);
  `);
}

export function rowToUser(row: Record<string, unknown>): MeridianUser {
  return {
    id: String(row.id),
    email: String(row.email),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id),
    stripeSubscriptionId: row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function rowToAttempt(row: Record<string, unknown>): CancellationAttempt {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    subscriptionId: String(row.subscription_id),
    idempotencyKey: String(row.idempotency_key),
    cyccleSessionId: row.cyccle_session_id === null ? null : String(row.cyccle_session_id),
    status: row.status as CancellationAttempt["status"],
    cyccleStatus: row.cyccle_status === null ? null : row.cyccle_status as CancellationAttempt["cyccleStatus"],
    cyccleOutcome: row.cyccle_outcome === null ? null : row.cyccle_outcome as CancellationAttempt["cyccleOutcome"],
    errorCode: row.error_code === null ? null : String(row.error_code),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const projectRoot = dirname(fileURLToPath(import.meta.url));
