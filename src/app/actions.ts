"use server";

import { redirect } from "next/navigation";
import { env } from "@/env";
import { createOrResetDemoAccount } from "@/server/provisioning";

export async function createDemoAccountAction() {
  await createOrResetDemoAccount();
  redirect("/billing");
}

export async function resetDemoAction() {
  if (!env().MERIDIAN_DEMO_RESET_ENABLED) {
    throw new Error("Reset demo is disabled.");
  }
  await createOrResetDemoAccount();
  redirect("/billing");
}
