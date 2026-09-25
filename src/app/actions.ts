"use server";

import { redirect } from "next/navigation";
import { createOrResetDemoAccount } from "@/server/provisioning";

export async function createDemoAccountAction() {
  await createOrResetDemoAccount();
  redirect("/billing");
}

export async function resetDemoAction() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Reset demo is disabled in production.");
  }
  await createOrResetDemoAccount();
  redirect("/billing");
}
