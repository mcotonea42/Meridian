import Link from "next/link";

type AppShellProps = {
  activeTab: "dashboard" | "billing";
  userEmail: string;
  children: React.ReactNode;
};

export function AppShell({ activeTab, userEmail, children }: AppShellProps) {
  return (
    <div className="app-frame">
      <header className="app-header">
        <Link className="wordmark" href="/dashboard" aria-label="Mailflow home">
          <span className="wordmark-icon" aria-hidden="true">m</span>
          <span>mailflow</span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link
            className={activeTab === "dashboard" ? "nav-link is-active" : "nav-link"}
            href="/dashboard"
            aria-current={activeTab === "dashboard" ? "page" : undefined}
          >
            Dashboard
          </Link>
          <Link
            className={activeTab === "billing" ? "nav-link is-active" : "nav-link"}
            href="/billing"
            aria-current={activeTab === "billing" ? "page" : undefined}
          >
            Billing
          </Link>
        </nav>
        <div className="account-chip">
          <span className="avatar" aria-hidden="true">{userEmail.charAt(0).toUpperCase()}</span>
          <span className="account-email">{userEmail}</span>
        </div>
      </header>
      <main className="main-content">{children}</main>
      <footer className="app-footer">
        <span>Mailflow</span>
        <span>Simple email marketing for growing businesses</span>
      </footer>
    </div>
  );
}
