import Link from "next/link";
import { createDemoAccountAction } from "@/app/actions";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">Meridian</div>
        <Link href="/billing">Billing</Link>
      </header>
      <section className="panel stack">
        <p className="kicker">Demo merchant account</p>
        <h1>Create a Meridian demo user</h1>
        <p>
          Meridian will create a Stripe Test customer and a Meridian Pro
          subscription server-side, then store those references for the signed
          demo session.
        </p>
        <form action={createDemoAccountAction}>
          <button type="submit">Create demo account</button>
        </form>
      </section>
    </main>
  );
}
