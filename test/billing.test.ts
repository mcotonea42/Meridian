import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBillingSummary } from "@/server/billing";
import { resetEnvCacheForTests } from "@/env";

describe("Billing summary", () => {
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

  it("uses Stripe as the source of truth for cancellation state", async () => {
    const billing = await loadBillingSummary(user(), {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: "sub_demo",
          status: "active",
          cancel_at_period_end: true,
          cancel_at: null,
          schedule: null,
          items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_pro" } }] },
        })),
      },
      subscriptionSchedules: {
        retrieve: vi.fn(),
      },
    } as never);

    expect(billing).toMatchObject({
      planName: "Meridian Pro",
      status: "active",
      cancellationScheduled: true,
      accessUntil: "2027-01-15T08:00:00.000Z",
    });
  });

  it("shows a scheduled downgrade from a Stripe subscription schedule", async () => {
    const billing = await loadBillingSummary(user(), {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: "sub_demo",
          status: "active",
          cancel_at_period_end: false,
          cancel_at: null,
          schedule: "sub_sched_123",
          items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_pro" } }] },
        })),
      },
      subscriptionSchedules: {
        retrieve: vi.fn(async () => ({
          id: "sub_sched_123",
          phases: [
            { start_date: 1_700_000_000, items: [{ price: "price_pro" }] },
            { start_date: 1_900_000_000, items: [{ price: "price_starter" }] },
          ],
        })),
      },
    } as never);

    expect(billing).toMatchObject({
      scheduledDowngradePlan: "Meridian Starter",
      scheduledChangeDate: "2030-03-17T17:46:40.000Z",
    });
  });
});

function user() {
  return {
    id: "usr_demo",
    email: "demo@meridian.local",
    stripeCustomerId: "cus_demo",
    stripeSubscriptionId: "sub_demo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
