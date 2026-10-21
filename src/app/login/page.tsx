import Link from "next/link";
import { redirect } from "next/navigation";
import { loginDemoAction } from "@/app/actions";
import { currentUserId } from "@/server/session";
import { userRepository } from "@/server/users";

export default async function LoginPage() {
  const userId = await currentUserId();
  const user = userId ? await userRepository().findById(userId) : null;
  if (user) redirect("/dashboard");

  return (
    <main className="login-page">
      <header className="login-header">
        <Link className="wordmark" href="/login" aria-label="Mailflow">
          <span className="wordmark-icon" aria-hidden="true">m</span>
          <span>mailflow</span>
        </Link>
        <span className="login-caption">A calmer way to reach your audience</span>
      </header>
      <section className="login-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Your email, in good company.</h1>
        <p className="login-copy">
          A simple workspace for the updates your customers look forward to.
        </p>
        <form action={loginDemoAction}>
          <button className="button button-primary login-button" type="submit">
            Continue to Mailflow
            <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="demo-note">This presentation opens a shared demo workspace.</p>
      </section>
      <p className="login-footer">Made for thoughtful, useful email.</p>
    </main>
  );
}
