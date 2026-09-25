import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/server/session";

const secret = "test-secret-that-is-long-enough-for-meridian";

describe("signed Meridian session", () => {
  it("round-trips the user id", () => {
    const cookie = signSession("usr_123", secret);
    expect(verifySession(cookie, secret)).toBe("usr_123");
  });

  it("rejects tampered cookies", () => {
    const [body, signature] = signSession("usr_123", secret).split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ userId: "usr_other", issuedAt: new Date().toISOString() })).toString("base64url");
    expect(verifySession(`${tamperedBody}.${signature ?? ""}`, secret)).toBeNull();
    expect(body).not.toBe(tamperedBody);
  });
});
