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
