import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrResetDemoAccount } from "@/server/provisioning";
import { resetEnvCacheForTests } from "@/env";
import type { ProvisioningDependencies } from "@/server/provisioning";

describe("Stripe provisioning", () => {
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

  it("creates customer, payment method, and Pro subscription server-side", async () => {
    const stripe = fakeStripe();
    const users = fakeUsers(null);

    const user = await createOrResetDemoAccount({
      stripe,
      users,
      setSession: vi.fn(),
    });

    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
      email: "demo@meridian.local",
    }));
    expect(stripe.paymentMethods.attach).toHaveBeenCalledWith("pm_card_visa", { customer: "cus_new" });
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({
      customer: "cus_new",
      items: [{ price: "price_pro" }],
      payment_behavior: "error_if_incomplete",
    }));
    expect(user.stripeCustomerId).toBe("cus_new");
    expect(user.stripeSubscriptionId).toBe("sub_new");
  });

  it("reset cancels the old test subscription before replacing references", async () => {
    const stripe = fakeStripe();
    await createOrResetDemoAccount({
      stripe,
      users: fakeUsers({
        id: "usr_old",
        email: "demo@meridian.local",
        stripeCustomerId: "cus_old",
        stripeSubscriptionId: "sub_old",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      setSession: vi.fn(),
    });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_old", {
      invoice_now: false,
      prorate: false,
    });
  });
});

function fakeStripe() {
  return {
    customers: {
      create: vi.fn(async () => ({ id: "cus_new" })),
      update: vi.fn(async () => ({})),
    },
    paymentMethods: {
      attach: vi.fn(async () => ({ id: "pm_attached" })),
    },
    subscriptions: {
      create: vi.fn(async () => ({ id: "sub_new" })),
      cancel: vi.fn(async () => ({})),
    },
  } as unknown as ProvisioningDependencies["stripe"];
}

function fakeUsers(existing: Awaited<ReturnType<typeof fakeUser>> | null) {
  let current = existing;
  return {
    findById: vi.fn(async (id: string) => (current?.id === id ? current : null)),
    findDemoUser: vi.fn(async () => current),
    upsertDemoUser: vi.fn(async (input) => {
      current = await fakeUser(input.stripeCustomerId, input.stripeSubscriptionId);
      return current;
    }),
  };
}

async function fakeUser(stripeCustomerId = "cus_new", stripeSubscriptionId = "sub_new") {
  return {
    id: "usr_demo",
    email: "demo@meridian.local",
    stripeCustomerId,
    stripeSubscriptionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
