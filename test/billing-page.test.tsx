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
  loadBillingSummary: vi.fn(async () => ({
    planName: "Meridian Pro",
    status: "active",
    renewsOn: "2026-10-29T08:00:00.000Z",
    accessUntil: "2026-10-29T08:00:00.000Z",
    cancelAtPeriodEnd: false,
    scheduleId: null,
    scheduledDowngradePlan: null,
    scheduledChangeDate: null,
    cancellationScheduled: false,
  })),
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

describe("BillingPage demo reset control", () => {
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
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
