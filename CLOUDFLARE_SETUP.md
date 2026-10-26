# Fit Journey Cloudflare migration

This is the initial Cloudflare Worker + D1 scaffold, **not a deployed production application**.

## Required setup

1. Create a Cloudflare D1 database named `fit-journey-db`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the actual database ID.
3. Create the `public/` asset directory by copying `index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, and `icon.svg` into it.
4. Apply the schema: `npx wrangler d1 execute fit-journey-db --remote --file=db/schema.sql`.
5. Do not deploy publicly with cloud data features until authentication, access control, data migration, push subscriptions, VAPID signing, and tests are complete.

## Intended functionality

- iPhone Home Screen PWA, private account, offline-capable daily tracking.
- One-tap walk completion, Indian meals, chai, weight and waist.
- Rules-based coaching using daily logs and weekly trends.
- Web Push at 07:30 America/Los_Angeles, and 19:00 only if no walk logged.
- Scheduled Worker checks both UTC hours to handle Pacific daylight saving time.
- Keep all data private; never put health records or credentials in the public repository.

The existing GitHub Pages app continues to run unchanged during migration.

## Password authentication implementation (in progress)

The Worker now supports `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/status`, and authenticated meal, log and measurement endpoints.

Run this additional SQL in your personal Cloudflare D1 console:

```sql
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Before deployment, configure **Worker secrets** `SETUP_TOKEN` (random 32+ character setup-only token) and `SESSION_SECRET` (independent random 32+ character signing secret) in your personal Cloudflare account. Never commit either value or your password to GitHub. Initial setup requires a same-origin authenticated bootstrap request with the setup token; no user-facing setup UI exists yet. After initial setup, remove the `SETUP_TOKEN` secret.

Security work still required before public launch: login rate limiting, session revocation/password reset strategy, tests, a login/setup UI, cloud sync migration, proper Web Push implementation, and deploying static assets under `public/`. Existing PWA local data is unaffected.
