import { NextResponse } from "next/server";
import { startBillingCancellation, BillingCancellationError } from "@/server/cyccle";
import { currentUserId } from "@/server/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await startBillingCancellation(await currentUserId());
    return NextResponse.redirect(result.url, { status: 303 });
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
