# Meridian Demo

Meridian is an independent demo merchant app for testing Cyccle Merchant V1
hosted cancellation flows without manually copying Stripe IDs.

It intentionally lives outside `cyccle-mono` and behaves like an external
merchant:

- provisions a Stripe Test customer and Meridian Pro subscription;
- stores the Stripe references server-side in SQLite;
- launches `POST /v1/cancel-sessions` from the Meridian backend only;
- redirects the browser to Cyccle's hosted cancellation URL;
- reloads Stripe on `/billing` to show the real subscription state.

## Cyccle Contract Confirmed From `cyccle-mono`

Read-only sources inspected:

- `apps/api/src/routes/cancel-sessions.ts`
- `apps/api/src/routes/merchant-cancel-sessions.ts`
- `apps/api/src/hosted-cancellation/hosted-cancellation-service.ts`
- `apps/api/src/hosted-cancellation/hosted-link-issuance.ts`
- `apps/api/src/hosted-cancellation/merchant-cancellation-session-service.ts`
- `packages/schema/src/hosted-cancellation.ts`
- `apps/api/test/hosted-cancellation.test.ts`
- `docs/merchant-v1-staging-validation.md`

Confirmed behavior:

- `POST /v1/cancel-sessions` uses `Authorization: Bearer <key>` where the key
  must be a cancellation API key or legacy unrestricted key.
- Request body is strict: `{ "customerId": "...", "subscriptionId": "..." }`.
  `subscriptionId` is optional in the schema but Meridian always sends it.
- There is no `returnUrl` in this Merchant V1 POST. The hosted return URL is
  workspace hosted-cancellation configuration in Cyccle.
- Response status is `201` with `{ id, url, expiresAt }`.
- `url` is an opaque one-shot hosted link shaped like
  `https://cancel-staging.cyccle.co/start#cl_...`.
- Same `Idempotency-Key` plus same normalized body reuses the same cancellation
  session resource and returns a fresh one-shot URL while unclaimed.
- Reusing an idempotency key with a different body returns `409
  idempotency_conflict`.
- Replaying after the hosted link has been opened returns `409
  idempotency_resource_claimed`; replaying after expiry returns `409
  idempotency_resource_expired`.
- `GET /v1/cancel-sessions/:id` returns `{ id, status, outcome, expiresAt,
  completedAt }` and is workspace-scoped.
- Public statuses are `pending`, `completed`, `expired`, `failed`.
- Public outcomes are `saved`, `deflected`, `cancelled`, `abandoned`,
  `execution_failed`.
- Cyccle Merchant V1 is Test-mode only at this boundary.

## Setup

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Fill `.env.local` with Stripe Test and Cyccle staging values. Do not use Stripe
Live keys.

## Environment

```sh
STRIPE_SECRET_KEY=
STRIPE_PRO_PRICE_ID=
STRIPE_STARTER_PRICE_ID=

CYCCLE_API_BASE_URL=https://api-staging.cyccle.co
CYCCLE_API_KEY=

MERIDIAN_SESSION_SECRET=
MERIDIAN_BASE_URL=http://localhost:3000
DATABASE_URL=file:./data/meridian.db
```

`MERIDIAN_SESSION_SECRET` should be at least 32 characters.

## Return URL Note

Cyccle decides the hosted flow return URL from the workspace hosted settings.
Meridian does not send a `returnUrl` during cancellation session creation. For
local testing, the Cyccle staging workspace must already be configured to return
to a URL that can reach this app, such as a staging Meridian deployment or a
tunnel. If the workspace returns to a staging URL, localhost will not receive the
browser automatically.

## Scripts

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm check
```
