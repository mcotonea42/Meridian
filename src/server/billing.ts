import type Stripe from "stripe";
import { env } from "@/env";
import type { MeridianUser } from "@/server/db";
import { stripeClient } from "@/server/stripe";

export interface BillingSummary {
  planName: string;
  status: string;
  renewsOn: string | null;
  accessUntil: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationScheduled: boolean;
  scheduleId: string | null;
  scheduledDowngradePlan: string | null;
  scheduledChangeDate: string | null;
}

export async function loadBillingSummary(
  user: MeridianUser,
  stripe: Pick<Stripe, "subscriptions" | "subscriptionSchedules"> = stripeClient(),
): Promise<BillingSummary | null> {
  if (!user.stripeSubscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  const scheduleId = typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id ?? null;
  const schedule = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : null;
  const currentPriceId = subscription.items.data[0]?.price.id ?? null;
  const scheduled = schedule ? scheduledPlan(schedule, currentPriceId) : null;
  const currentPeriodEnd = timestampToIso(currentPeriodEndFromItems(subscription));
  const cancelAt = timestampToIso(subscription.cancel_at ?? null);

  return {
    planName: planName(currentPriceId),
    status: subscription.status,
    renewsOn: subscription.cancel_at_period_end ? null : currentPeriodEnd,
    accessUntil: cancelAt ?? (subscription.cancel_at_period_end ? currentPeriodEnd : null),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    cancellationScheduled: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    scheduleId,
    scheduledDowngradePlan: scheduled?.planName ?? null,
    scheduledChangeDate: scheduled?.effectiveOn ?? null,
  };
}

function scheduledPlan(
  schedule: Stripe.SubscriptionSchedule,
  currentPriceId: string | null,
): { planName: string; effectiveOn: string | null } | null {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nextPhase = schedule.phases.find((phase) => {
    const start = typeof phase.start_date === "number" ? phase.start_date : 0;
    return start > nowSeconds;
  });
  const nextPrice = nextPhase?.items[0]?.price;
  const nextPriceId = typeof nextPrice === "string" ? nextPrice : nextPrice?.id ?? null;
  if (!nextPriceId || nextPriceId === currentPriceId) return null;
  return {
    planName: planName(nextPriceId),
    effectiveOn: timestampToIso(typeof nextPhase?.start_date === "number" ? nextPhase.start_date : null),
  };
}

export function planName(priceId: string | null): string {
  if (priceId === env().STRIPE_PRO_PRICE_ID) return "Meridian Pro";
  if (priceId === env().STRIPE_STARTER_PRICE_ID) return "Meridian Starter";
  return "Unknown plan";
}

export function timestampToIso(timestamp: number | null): string | null {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function currentPeriodEndFromItems(subscription: Stripe.Subscription): number | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");
  return ends.length > 0 ? Math.max(...ends) : null;
}
