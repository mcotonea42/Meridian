import { redirect } from "next/navigation";
import { AppShell } from "@/app/components/app-shell";
import { currentUserId } from "@/server/session";
import { userRepository } from "@/server/users";

const campaigns = [
  { name: "October Update", sent: "Oct 18", openRate: "43%" },
  { name: "Product Launch", sent: "Oct 11", openRate: "41%" },
  { name: "Weekly Digest", sent: "Oct 04", openRate: "42%" },
];

export default async function DashboardPage() {
  const userId = await currentUserId();
  const user = userId ? await userRepository().findById(userId) : null;
  if (!user) redirect("/login");

  return (
    <AppShell activeTab="dashboard" userEmail={user.email}>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Good to see you again.</h1>
          <p className="welcome-copy">Here’s how your audience is doing this month.</p>
        </div>
        <span className="workspace-label"><span className="live-dot" /> All systems looking good</span>
      </section>

      <section className="metrics-grid" aria-label="Audience overview">
        <article className="metric-card">
          <span className="metric-label">Subscribers</span>
          <strong>324</strong>
          <span className="metric-caption">Your growing audience</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Campaigns this month</span>
          <strong>3</strong>
          <span className="metric-caption">Thoughtful notes, sent</span>
        </article>
        <article className="metric-card metric-card-accent">
          <span className="metric-label">Average open rate</span>
          <strong>42<span>%</span></strong>
          <span className="metric-caption">Across recent campaigns</span>
        </article>
      </section>

      <section className="campaign-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The latest</p>
            <h2>Recent campaigns</h2>
          </div>
          <span className="section-count">3 campaigns</span>
        </div>
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <article className="campaign-row" key={campaign.name}>
              <span className="campaign-mark" aria-hidden="true">✳</span>
              <div className="campaign-name">
                <strong>{campaign.name}</strong>
                <span>Sent {campaign.sent}</span>
              </div>
              <span className="campaign-status"><span className="status-dot" /> Sent</span>
              <div className="campaign-opens">
                <strong>{campaign.openRate}</strong>
                <span>opened</span>
              </div>
            </article>
          ))}
        </div>
        <p className="fixture-note">Workspace activity shown for this demo.</p>
      </section>
    </AppShell>
  );
}
