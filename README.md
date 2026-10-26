# Fit Journey PWA

Offline-first personal weight and Indian diet habit tracker. Open the deployed site in Safari and choose Share → Add to Home Screen.

Records are stored only in browser localStorage. Export backups regularly; clearing site data removes records. No authentication or backend.

Host the repository on Cloudflare Pages with framework preset None, no build command, and output directory `/`.

Web Push deployment requires GitHub Actions repository **secrets** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. After adding them, rerun the Cloudflare workflow and enable reminders from the installed iPhone PWA.
