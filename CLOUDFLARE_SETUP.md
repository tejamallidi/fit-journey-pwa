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
