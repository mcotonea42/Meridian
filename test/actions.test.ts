import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/env";

const mocks = vi.hoisted(() => ({
  provisionDemoAccount: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/provisioning", () => ({
  createOrResetDemoAccount: mocks.provisionDemoAccount,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import { resetDemoAction } from "@/app/actions";

describe("resetDemoAction", () => {
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
    vi.stubEnv("MERIDIAN_DEMO_RESET_ENABLED", "true");
    resetEnvCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("provisions and redirects when explicitly enabled in production", async () => {
    await resetDemoAction();

    expect(mocks.provisionDemoAccount).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/billing");
  });

  it.each(["false", undefined])(
    "refuses reset when the feature flag is %s",
    async (featureFlag) => {
      vi.stubEnv("MERIDIAN_DEMO_RESET_ENABLED", featureFlag);
      resetEnvCacheForTests();

      await expect(resetDemoAction()).rejects.toThrow("Reset demo is disabled.");
      expect(mocks.provisionDemoAccount).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
