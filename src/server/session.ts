import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/env";

export const SESSION_COOKIE = "meridian_session";

interface SessionPayload {
  userId: string;
  issuedAt: string;
}

export function signSession(userId: string, secret = env().MERIDIAN_SESSION_SECRET): string {
  const payload: SessionPayload = { userId, issuedAt: new Date().toISOString() };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export function verifySession(value: string | undefined, secret = env().MERIDIAN_SESSION_SECRET): string | null {
  if (!value) return null;
  const [body, receivedSignature] = value.split(".");
  if (!body || !receivedSignature) return null;
  const expectedSignature = signature(body, secret);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    return typeof payload.userId === "string" && payload.userId.length > 0 ? payload.userId : null;
  } catch {
    return null;
  }
}

export async function currentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return verifySession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().MERIDIAN_BASE_URL.startsWith("https://"),
    path: "/",
  });
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
