import Link from "next/link";
import { redirect } from "next/navigation";
import { resetDemoAction } from "@/app/actions";
import { env } from "@/env";
import { loadBillingSummary } from "@/server/billing";
import { reconcileLatestCancellation } from "@/server/cyccle";
import { currentUserId } from "@/server/session";
import { userRepository } from "@/server/users";
import { AppShell } from "@/app/components/app-shell";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const userId = await currentUserId();
  const user = userId ? await userRepository().findById(userId) : null;
  if (!user) redirect("/login");
  await reconcileLatestCancellation(user);
  const billing = await loadBillingSummary(user);

  if (!billing) {
    return (
      <AppShell activeTab="billing" userEmail={user.email}>
        <section className="page-heading">
          <p className="eyebrow">Workspace</p>
          <h1>Billing</h1>
        </section>
        <section className="surface empty-state">
          <p>No subscription is linked to this demo account.</p>
          <Link href="/dashboard">Return to dashboard</Link>
        </section>
      </AppShell>
    );
  }
  const demoResetEnabled = env().MERIDIAN_DEMO_RESET_ENABLED;

  return (
    <AppShell activeTab="billing" userEmail={user.email}>
      <section className="page-heading page-heading-with-action">
        <div>
          <p className="eyebrow">Subscription</p>
          <h1>Billing</h1>
        </div>
      </section>
      <div className="billing-layout">
        <section className="surface billing-panel" aria-labelledby="current-plan-title">
          <div className="billing-title">
            <div>
              <p className="eyebrow">Current plan</p>
              <h2 id="current-plan-title">{billing.planName}</h2>
              <p className="plan-price">
                {formatPrice(billing.currentPriceAmount, billing.currentPriceCurrency)}
                {billing.billingInterval ? (
                  <span> / {formatInterval(billing.billingInterval, billing.billingIntervalCount)}</span>
                ) : null}
              </p>
            </div>
            <span className={`status ${billing.cancelAtPeriodEnd || billing.cancellationScheduled ? "status-warning" : ""}`}>
              {headlineStatus(billing)}
            </span>
          </div>
          {billing.cancellationScheduled ? (
            <div className="billing-notice cancellation-notice" role="status">
              <strong>Cancellation scheduled</strong>
              <p>
                {cancellationMessage(billing)}
              </p>
            </div>
          ) : billing.scheduledDowngradePlan ? (
            <div className="billing-notice downgrade-notice" role="status">
              <strong>Plan change scheduled</strong>
              <p>
                {billing.scheduledDowngradePlan} takes effect {formatDate(billing.scheduledChangeDate)}.
                {" "}{billing.planName} access continues until then.
              </p>
            </div>
          ) : null}
          <dl className="details">
            <div>
              <dt>Subscription status</dt>
              <dd>{capitalize(billing.status)}</dd>
            </div>
            <div>
              <dt>Billing interval</dt>
              <dd>{billing.billingInterval ? formatInterval(billing.billingInterval, billing.billingIntervalCount) : "Not available"}</dd>
            </div>
            <div>
              <dt>Next billing date</dt>
              <dd>{billing.cancellationScheduled ? "No future renewal" : formatDate(billing.renewsOn)}</dd>
            </div>
            {billing.cancellationScheduled ? (
              <div>
                <dt>Access through</dt>
                <dd>{formatDate(billing.accessUntil)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="plan-benefits">
            <p className="eyebrow">{billing.planName} includes</p>
            <ul>{benefitsFor(billing.planName).map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
          </div>
          <form action="/api/billing/cancel" method="post">
            <button className="button button-quiet cancel-button" type="submit">Cancel subscription</button>
          </form>
        </section>

        {billing.scheduledDowngradePlan ? (
          <section className="surface next-plan-panel" aria-labelledby="next-plan-title">
            <div>
              <p className="eyebrow">Coming next</p>
              <h2 id="next-plan-title">{billing.scheduledDowngradePlan}</h2>
              <p className="next-plan-date">Effective {formatDate(billing.scheduledChangeDate)}</p>
            </div>
            <ul>
              {benefitsFor(billing.scheduledDowngradePlan).map((benefit) => <li key={benefit}>{benefit}</li>)}
            </ul>
          </section>
        ) : null}

        <section className="usage-panel" aria-labelledby="usage-title">
          <div className="usage-heading">
            <div>
              <p className="eyebrow">Demo product usage</p>
              <h2 id="usage-title">Current usage</h2>
            </div>
            <span className="usage-note">Sample Mailflow workspace data</span>
          </div>
          <div className="usage-metrics">
            <div>
              <span>Subscribers</span>
              <strong>{formatSubscriberUsage(subscriberLimitFor(billing.planName))}</strong>
            </div>
            <div>
              <span>Campaigns this month</span>
              <strong>3</strong>
            </div>
            <div>
              <span>Average open rate</span>
              <strong>42%</strong>
            </div>
          </div>
        </section>
      </div>

      {demoResetEnabled ? (
        <section className="demo-controls">
          <div>
            <strong>Demo controls</strong>
            <span>Prepare a fresh subscription for another run.</span>
          </div>
          <form action={resetDemoAction}>
            <button className="button button-quiet" type="submit">Reset demo</button>
          </form>
        </section>
      ) : null}
    </AppShell>
  );
}

function headlineStatus(billing: Awaited<ReturnType<typeof loadBillingSummary>>) {
  if (!billing) return "Unknown";
  if (billing.cancellationScheduled) return "Cancellation scheduled";
  if (billing.scheduledDowngradePlan) return "Plan change scheduled";
  return capitalize(billing.status);
}

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null || !currency) return "Price unavailable";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function formatInterval(interval: string, count: number | null): string {
  const labels: Record<string, string> = {
    day: "day",
    week: "week",
    month: "month",
    year: "year",
  };
  const unit = labels[interval] ?? interval;
  return count === 1 || count === null ? unit : `every ${count} ${unit}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function benefitsFor(planName: string): string[] {
  if (planName === "Mailflow Pro") {
    return ["Up to 5,000 subscribers", "Unlimited campaigns", "Advanced analytics"];
  }
  if (planName === "Mailflow Starter") {
    return ["Up to 500 subscribers", "Up to 5 campaigns/month", "Basic analytics"];
  }
  return [];
}

function subscriberLimitFor(planName: string): number | null {
  if (planName === "Mailflow Starter") return 500;
  if (planName === "Mailflow Pro") return 5_000;
  return null;
}

function formatSubscriberUsage(limit: number | null): string {
  return limit === null ? "324 subscribers" : `324 / ${limit.toLocaleString("en-US")}`;
}

function cancellationMessage(billing: Awaited<ReturnType<typeof loadBillingSummary>>): string {
  if (!billing) return "This subscription is scheduled to end with its current billing period. No future renewal will occur.";
  const endDate = billing.accessUntil ? formatDate(billing.accessUntil) : null;
  if (endDate) {
    const accessMessage = billing.status === "active"
      ? `${billing.planName} remains active until ${endDate}.`
      : `${billing.planName} is scheduled to end on ${endDate}.`;
    return `${accessMessage} No future renewal will occur after that date.`;
  }
  return `${billing.planName} is scheduled to end with its current billing period. No future renewal will occur.`;
}
