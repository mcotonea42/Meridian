import { createDemoAccountAction, resetDemoAction } from "@/app/actions";
import { loadBillingSummary } from "@/server/billing";
import { reconcileLatestCancellation } from "@/server/cyccle";
import { currentUserId } from "@/server/session";
import { userRepository } from "@/server/users";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const userId = await currentUserId();
  const user = userId ? await userRepository().findById(userId) : null;
  if (user) await reconcileLatestCancellation(user);
  const billing = user ? await loadBillingSummary(user) : null;

  if (!user || !billing) {
    return (
      <main className="shell">
        <header className="topbar">
          <div className="brand">Meridian</div>
        </header>
        <section className="panel stack">
          <p className="kicker">No active Meridian session</p>
          <h1>Billing</h1>
          <p>Create the demo account to provision Stripe Test billing data.</p>
          <form action={createDemoAccountAction}>
            <button type="submit">Create demo account</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">Meridian</div>
          <p className="kicker">{user.email}</p>
        </div>
        <form action={resetDemoAction}>
          <button className="secondary" type="submit">Reset demo</button>
        </form>
      </header>
      <section className="panel stack">
        <p className="kicker">Billing</p>
        <h1>{billing.planName}</h1>
        <span className="status">{headlineStatus(billing)}</span>
        <dl className="details">
          <div>
            <dt>Status</dt>
            <dd>{billing.status}</dd>
          </div>
          <div>
            <dt>Renews on</dt>
            <dd>{formatDate(billing.renewsOn)}</dd>
          </div>
          <div>
            <dt>Access until</dt>
            <dd>{formatDate(billing.accessUntil)}</dd>
          </div>
          <div>
            <dt>Cancel at period end</dt>
            <dd>{billing.cancelAtPeriodEnd ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Subscription schedule</dt>
            <dd>{billing.scheduleId ?? "None"}</dd>
          </div>
          <div>
            <dt>Scheduled change</dt>
            <dd>
              {billing.scheduledDowngradePlan
                ? `${billing.scheduledDowngradePlan} on ${formatDate(billing.scheduledChangeDate)}`
                : "None"}
            </dd>
          </div>
        </dl>
        <form action="/api/billing/cancel" method="post">
          <button className="danger" type="submit">Cancel subscription</button>
        </form>
      </section>
    </main>
  );
}

function headlineStatus(billing: Awaited<ReturnType<typeof loadBillingSummary>>) {
  if (!billing) return "Unknown";
  if (billing.scheduledDowngradePlan) return `Scheduled change: ${billing.scheduledDowngradePlan}`;
  if (billing.cancellationScheduled) return "Cancellation scheduled";
  return billing.status.charAt(0).toUpperCase() + billing.status.slice(1);
}

function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
