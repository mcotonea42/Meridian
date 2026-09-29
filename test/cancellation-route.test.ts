import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/env";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  startBillingCancellation: vi.fn(),
}));

vi.mock("@/server/session", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("@/server/cyccle", () => ({
  BillingCancellationError: class BillingCancellationError extends Error {},
  startBillingCancellation: mocks.startBillingCancellation,
}));

import { POST } from "@/app/api/billing/cancel/route";

describe("billing cancellation route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_STARTER_PRICE_ID = "price_starter";
    process.env.CYCCLE_API_BASE_URL = "https://api-staging.cyccle.co";
    process.env.CYCCLE_API_KEY = "ck_test_secret";
    process.env.MERIDIAN_SESSION_SECRET = "test-secret-that-is-long-enough-for-meridian";
    process.env.MERIDIAN_BASE_URL = "https://meridian.example";
    process.env.DATABASE_URL = "file::memory:";
    resetEnvCacheForTests();
    mocks.currentUserId.mockResolvedValue("usr_server");
  });

  it("redirects a newly issued capability URL with 303", async () => {
    const hostedUrl = `https://cancel-staging.cyccle.co/start#cl_${"a".repeat(43)}`;
    mocks.startBillingCancellation.mockResolvedValue({ kind: "hosted", url: hostedUrl });

    const request = new Request("https://meridian.example/api/billing/cancel", {
      method: "POST",
      body: JSON.stringify({ customerId: "cus_browser", subscriptionId: "sub_browser" }),
    });
    const response = await (POST as unknown as (request: Request) => Promise<Response>)(request);

    expect(mocks.startBillingCancellation).toHaveBeenCalledWith("usr_server");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(hostedUrl);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns to billing when a known claimed or expired session was reconciled", async () => {
    mocks.startBillingCancellation.mockResolvedValue({ kind: "billing" });

    const response = await POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://meridian.example/billing");
  });
});
