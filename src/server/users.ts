import type { DatabaseSync } from "node:sqlite";
import { database, newId, nowIso, rowToUser, type MeridianUser } from "@/server/db";

export interface UserRepository {
  findById(id: string): Promise<MeridianUser | null>;
  findDemoUser(): Promise<MeridianUser | null>;
  upsertDemoUser(input: {
    email: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  }): Promise<MeridianUser>;
}

export const DEMO_EMAIL = "demo@meridian.local";

export function userRepository(connection: DatabaseSync = database()): UserRepository {
  return {
    async findById(id) {
      const row = connection.prepare("select * from users where id = ?").get(id);
      return row ? rowToUser(row as Record<string, unknown>) : null;
    },
    async findDemoUser() {
      const row = connection.prepare("select * from users where email = ?").get(DEMO_EMAIL);
      return row ? rowToUser(row as Record<string, unknown>) : null;
    },
    async upsertDemoUser(input) {
      const existing = await this.findDemoUser();
      const timestamp = nowIso();
      if (existing) {
        connection
          .prepare(`
            update users
            set stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ?
            where id = ?
          `)
          .run(input.stripeCustomerId, input.stripeSubscriptionId, timestamp, existing.id);
        return (await this.findById(existing.id))!;
      }
      const id = newId("usr");
      connection
        .prepare(`
          insert into users (id, email, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?)
        `)
        .run(id, input.email, input.stripeCustomerId, input.stripeSubscriptionId, timestamp, timestamp);
      return (await this.findById(id))!;
    },
  };
}
