import { NextResponse } from "next/server";
import { env } from "@/env";
import { startBillingCancellation, BillingCancellationError } from "@/server/cyccle";
import { currentUserId } from "@/server/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await startBillingCancellation(await currentUserId());
    const destination = result.kind === "hosted"
      ? result.url
      : new URL("/billing", env().MERIDIAN_BASE_URL);
    const response = NextResponse.redirect(destination, { status: 303 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof BillingCancellationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: { code: "unexpected_error", message: "Unable to start cancellation." } },
      { status: 500 },
    );
  }
}
