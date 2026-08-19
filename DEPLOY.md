# Deploying Killbill (Railway)

The app is an Astro server build (`@astrojs/node`, standalone) behind Cloudflare,
with managed Postgres. It compiles to a long-running Node process
(`node ./dist/server/entry.mjs`), so it needs a container/VM host, not serverless.

## 1. One-time setup

1. Push this repo to GitHub.
2. **Railway → New Project → Deploy from GitHub repo** → pick this repo.
   Nixpacks + `railway.json` handle build (`npm run build`) and start (`npm start`).
3. **Set a spending limit first:** Project → Settings → Usage → hard cap. This is
   what guarantees no surprise bill.
4. **Add Postgres:** New → Database → Postgres. Railway auto-injects `DATABASE_URL`
   into the service; `src/lib/db.js` switches to Postgres automatically and tables
   self-create on first boot. Nothing to migrate by hand.
5. Add the custom domain (`kill-bill.app`) under Settings → Networking, and put
   Cloudflare in front of it (matches the CSP / origin-verify env ladder).

## 2. Environment variables (service → Variables)

Production values, NOT the local ones.

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | (auto) | Injected by Railway Postgres. Do not set by hand. |
| `HOST` | `0.0.0.0` | Required so Railway can reach the listener. |
| `PORT` | (auto) | Injected by Railway. Do not set. |
| `BETTER_AUTH_URL` | `https://kill-bill.app` | Exact public https origin. |
| `BETTER_AUTH_SECRET` | fresh random | `openssl rand -hex 32`. Not the local one. Required in prod. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | prod OAuth app | Separate from localhost creds. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | prod OAuth app | Optional (only if GitHub login is offered). |
| `SITE_URL` | `https://kill-bill.app` | Payment return URLs. |
| `DODO_MODE` | `live` | `test` in dev; `live` in production. |
| `DODO_PAYMENTS_API_KEY` | live API key | Sponsor checkout (Dodo Payments). |
| `DODO_WEBHOOK_SECRET` | webhook signing secret | Verifies the sponsor webhook. |
| `DODO_PRODUCT_ID` | live PWYW product id | The single pay-what-you-want product. |
| `ADMIN_TOKEN` | fresh random | Gates `/admin/sponsors?token=…`. |
| `SPONSOR_SIGNING_SECRET` | fresh random | Signs sponsor email links (falls back to `ADMIN_TOKEN`). |
| `RESEND_API_KEY` / `RESEND_AUDIENCE_ID` | Resend | Digest emails (optional). |
| `POSTHOG_KEY` / `POSTHOG_UI_HOST` | PostHog | Analytics (optional). |
| `CSP_ENFORCE`, `ORIGIN_VERIFY_SECRET`, `ORIGIN_VERIFY_ENFORCE` | `1` to enforce | Leave unset to observe first; enable once verified. |

Do **not** set `DATA_DIR` — Postgres is the store in production.

## 3. Post-deploy wiring

- **OAuth redirect URIs** (Google Cloud Console → your prod OAuth client):
  add `https://kill-bill.app/api/auth/callback/google`. `BETTER_AUTH_URL` must
  equal `https://kill-bill.app` exactly. Same shape for GitHub if used.
- **Dodo webhook:** in the Dodo dashboard (live mode) register an endpoint at
  `https://kill-bill.app/api/sponsor/webhook` subscribed to `payment.succeeded`,
  `payment.failed`, `payment.cancelled`, then paste its signing secret into
  `DODO_WEBHOOK_SECRET`, or checkout won't confirm.
- **Admin access:** `https://kill-bill.app/admin/sponsors?token=<ADMIN_TOKEN>`.

## 4. Known cost/perf note: OG image build

`npm run build` runs `scripts/generate-og.mjs`, which renders ~1000 OG PNGs.
Railway builds in a fresh container each deploy and `.og-cache.json` is
gitignored, so the cache starts empty and every deploy re-renders all of them.
This makes deploys slow and memory-hungry.

If builds time out or OOM: commit `public/og/*.png` (and the cache) so the build
step short-circuits, or move OG generation out of the deploy build.
