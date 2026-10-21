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
          <p className="eyebrow">Workspace</p>
          <h1>Billing</h1>
        </div>
        {demoResetEnabled ? (
          <form action={resetDemoAction}>
            <button className="button button-quiet" type="submit">Reset demo</button>
          </form>
        ) : null}
      </section>
      <section className="surface billing-panel">
        <div className="billing-title">
          <div>
            <p className="eyebrow">Current subscription</p>
            <h2>{billing.planName}</h2>
          </div>
          <span className="status">{headlineStatus(billing)}</span>
        </div>
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
          <button className="button button-danger" type="submit">Cancel subscription</button>
        </form>
      </section>
    </AppShell>
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
