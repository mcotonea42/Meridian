import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/env";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(async () => "usr_demo"),
  findById: vi.fn(async () => ({
    id: "usr_demo",
    email: "demo@meridian.local",
    stripeCustomerId: "cus_demo",
    stripeSubscriptionId: "sub_demo",
    createdAt: "2026-09-29T08:00:00.000Z",
    updatedAt: "2026-09-29T08:00:00.000Z",
  })),
  reconcileLatestCancellation: vi.fn(),
  loadBillingSummary: vi.fn(),
}));

vi.mock("@/server/session", () => ({
  currentUserId: mocks.currentUserId,
}));

vi.mock("@/server/users", () => ({
  userRepository: () => ({ findById: mocks.findById }),
}));

vi.mock("@/server/cyccle", () => ({
  reconcileLatestCancellation: mocks.reconcileLatestCancellation,
}));

vi.mock("@/server/billing", () => ({
  loadBillingSummary: mocks.loadBillingSummary,
}));

import BillingPage from "@/app/billing/page";

describe("BillingPage subscription presentation", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter");
    vi.stubEnv("CYCCLE_API_BASE_URL", "https://api-staging.cyccle.co");
    vi.stubEnv("CYCCLE_API_KEY", "ck_test_secret");
    vi.stubEnv("MERIDIAN_SESSION_SECRET", "test-secret-that-is-long-enough-for-meridian");
    vi.stubEnv("MERIDIAN_BASE_URL", "https://meridian.example");
    vi.stubEnv("DATABASE_URL", "file::memory:");
    resetEnvCacheForTests();
    mocks.loadBillingSummary.mockResolvedValue(activeBillingSummary());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("shows the real active Pro price, benefits, usage, and cancellation POST", async () => {
    const html = renderToStaticMarkup(await BillingPage());

    expect(html).toContain("Mailflow Pro");
    expect(html).toContain("€49");
    expect(html).toContain("/ month");
    expect(html).toContain("Active");
    expect(html).toContain("Up to 5,000 subscribers");
    expect(html).toContain("Unlimited campaigns");
    expect(html).toContain("Advanced analytics");
    expect(html).toContain("324 / 5,000");
    expect(html).toContain("3</strong>");
    expect(html).toContain("action=\"/api/billing/cancel\" method=\"post\"");
  });

  it("shows a scheduled downgrade without implying it is already active", async () => {
    mocks.loadBillingSummary.mockResolvedValueOnce({
      ...activeBillingSummary(),
      scheduledDowngradePlan: "Mailflow Starter",
      scheduledChangeDate: "2026-11-02T00:00:00.000Z",
    });

    const html = renderToStaticMarkup(await BillingPage());

    expect(html).toContain("Plan change scheduled");
    expect(html).toContain("Mailflow Starter takes effect Nov 2, 2026");
    expect(html).toContain("Mailflow Pro access continues until then.");
    expect(html).toContain("Up to 500 subscribers");
    expect(html).toContain("Up to 5 campaigns/month");
    expect(html).toContain("Basic analytics");
  });

  it("shows scheduled cancellation while the Stripe subscription remains active", async () => {
    mocks.loadBillingSummary.mockResolvedValueOnce({
      ...activeBillingSummary(),
      renewsOn: null,
      cancelAtPeriodEnd: true,
      cancellationScheduled: true,
    });

    const html = renderToStaticMarkup(await BillingPage());

    expect(html).toContain("Cancellation scheduled");
    expect(html).toContain("Mailflow Pro remains active until Oct 29, 2026.");
    expect(html).toContain("No future renewal will occur after that date.");
    expect(html).toContain("No future renewal");
    expect(html).toContain("Access through");
  });

  it.each([
    ["true", true],
    ["false", false],
    [undefined, false],
  ])("renders reset only when the feature flag is %s", async (featureFlag, visible) => {
    vi.stubEnv("MERIDIAN_DEMO_RESET_ENABLED", featureFlag);
    resetEnvCacheForTests();

    const html = renderToStaticMarkup(await BillingPage());

    expect(html.includes("Reset demo")).toBe(visible);
  });
});

function activeBillingSummary() {
  return {
    planName: "Mailflow Pro",
    currentPriceAmount: 4900,
    currentPriceCurrency: "eur",
    billingInterval: "month",
    billingIntervalCount: 1,
    status: "active",
    renewsOn: "2026-10-29T08:00:00.000Z",
    accessUntil: "2026-10-29T08:00:00.000Z",
    cancelAtPeriodEnd: false,
    scheduleId: null,
    scheduledDowngradePlan: null,
    scheduledChangeDate: null,
    cancellationScheduled: false,
  };
}
