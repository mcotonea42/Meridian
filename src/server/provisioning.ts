import type Stripe from "stripe";
import { env } from "@/env";
import { setSessionCookie } from "@/server/session";
import { stripeClient } from "@/server/stripe";
import { DEMO_EMAIL, userRepository, type UserRepository } from "@/server/users";

export interface ProvisioningDependencies {
  stripe: Pick<Stripe, "customers" | "paymentMethods" | "subscriptions">;
  users: UserRepository;
  setSession: (userId: string) => Promise<void>;
}

export async function createOrResetDemoAccount(
  deps: ProvisioningDependencies = {
    stripe: stripeClient(),
    users: userRepository(),
    setSession: setSessionCookie,
  },
) {
  const existing = await deps.users.findDemoUser();
  if (existing?.stripeSubscriptionId) {
    await cancelOldSubscription(deps.stripe, existing.stripeSubscriptionId);
  }

  const customer = await deps.stripe.customers.create({
    email: DEMO_EMAIL,
    name: "Meridian Demo User",
    metadata: { app: "meridian-demo" },
  });
  const paymentMethod = await deps.stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  await deps.stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  const subscription = await deps.stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: env().STRIPE_PRO_PRICE_ID }],
    default_payment_method: paymentMethod.id,
    payment_behavior: "error_if_incomplete",
    metadata: { app: "meridian-demo", plan: "pro" },
  });

  const user = await deps.users.upsertDemoUser({
    email: DEMO_EMAIL,
    stripeCustomerId: customer.id,
    stripeSubscriptionId: subscription.id,
  });
  await deps.setSession(user.id);
  return user;
}

async function cancelOldSubscription(
  stripe: Pick<Stripe, "subscriptions">,
  subscriptionId: string,
): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subscriptionId, {
      invoice_now: false,
      prorate: false,
    });
  } catch (error) {
    const stripeError = error as { code?: string; statusCode?: number };
    if (stripeError.statusCode !== 404 && stripeError.code !== "resource_missing") throw error;
  }
}
