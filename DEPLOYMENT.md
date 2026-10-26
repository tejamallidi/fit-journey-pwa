# Fit Journey: GitHub Actions → Personal Cloudflare account

The workflow validates on every push and pull request. **Deployment is OFF by default.** It deploys from main only when the GitHub Actions repository variable `FIT_JOURNEY_DEPLOY_ENABLED` is set to `true`.

## One-time setup

1. In your **personal** Cloudflare account, create an API token scoped only to that account, with Workers Scripts edit, D1 edit (as needed for bindings), and Workers Routes edit only if using routes. Avoid global API keys. Store it as GitHub Actions secret `CLOUDFLARE_API_TOKEN`.
2. Find the personal Cloudflare account ID and store it as GitHub Actions secret `CLOUDFLARE_ACCOUNT_ID`. The account ID is not itself a password.
3. In Cloudflare Worker settings, configure two **encrypted Worker secrets**: `SESSION_SECRET` (32+ random characters) and `SETUP_TOKEN` (a different 32+ character one-time bootstrap value). Never add these to source or GitHub commits.
4. Finish password setup UI, secure login throttling, notification delivery, and integration tests before production enablement.
5. When ready, add GitHub Actions **repository variable** `FIT_JOURNEY_DEPLOY_ENABLED=true`. Optionally require manual reviewers for the GitHub `production` environment.
6. GitHub Actions then deploys automatically on successful main pushes; pull requests only validate.

## CI pipeline
- `npm run validate` checks JS syntax, runs API security smoke tests, and assembles `public/` assets.
- Wrangler dry-run checks Worker bundling without deploying.
- Deploy job runs only after successful validation and explicit opt-in variable.

## Important

The existing GitHub Pages PWA remains operational until Cloudflare cutover. The Worker backend is still under development. Do not enter sensitive health data into the cloud version until security and backup verification are complete.

## Database migration 002

Before testing cloud login or backup, run `db/migration_002.sql` in the **personal Cloudflare D1 database console**. It adds login-attempt throttling, session revocation, and private snapshot backup tables. The SQL is idempotent.

## Authentication secrets

Set independent encrypted Worker secrets `SESSION_SECRET` and `SETUP_TOKEN` (each at least 32 random characters) in the **personal Cloudflare Worker**, not in GitHub source. After initial setup, delete `SETUP_TOKEN`. These are distinct from the GitHub Actions Cloudflare API token.

## Current boundaries

- Password UI is only visible when the Cloudflare Worker API is reachable. GitHub Pages continues operating locally.
- Cloud backups are **manual** and overwrite the previous snapshot; no background sync, merge, or cross-device conflict resolution yet.
- Password login uses a single-owner account and a database-backed lockout after repeated failures.
- Web Push, email recovery, and production readiness/security validation are not complete. Deployment stays gated.
