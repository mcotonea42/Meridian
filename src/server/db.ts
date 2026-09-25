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
  hostedUrl: string | null;
  status: "pending" | "created" | "failed";
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (!db) {
    const path = databasePath(env().DATABASE_URL);
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
  }
  return db;
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

function migrate(connection: DatabaseSync): void {
  connection.exec(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      stripe_customer_id text,
      stripe_subscription_id text,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists cancellation_attempts (
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

    create index if not exists cancellation_attempts_lookup_idx
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
    hostedUrl: row.hosted_url === null ? null : String(row.hosted_url),
    status: row.status as CancellationAttempt["status"],
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
