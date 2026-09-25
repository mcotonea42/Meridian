import Stripe from "stripe";
import { env } from "@/env";

let stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!stripe) {
    stripe = new Stripe(env().STRIPE_SECRET_KEY, {
      typescript: true,
    });
  }
  return stripe;
}

export function resetStripeClientForTests(): void {
  stripe = null;
}
