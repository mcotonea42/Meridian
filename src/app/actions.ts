"use server";

import { redirect } from "next/navigation";
import { env } from "@/env";
import { createOrResetDemoAccount } from "@/server/provisioning";
import { setSessionCookie } from "@/server/session";
import { userRepository } from "@/server/users";

export async function loginDemoAction() {
  const demoUser = await userRepository().findDemoUser();
  if (demoUser) {
    await setSessionCookie(demoUser.id);
  } else {
    await createOrResetDemoAccount();
  }
  redirect("/dashboard");
}

export async function resetDemoAction() {
  if (!env().MERIDIAN_DEMO_RESET_ENABLED) {
    throw new Error("Reset demo is disabled.");
  }
  await createOrResetDemoAccount();
  redirect("/billing");
}
