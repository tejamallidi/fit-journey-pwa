// Fit Journey Worker foundation. Authentication and Web Push must be configured
// before enabling cloud writes or notifications. Never expose private health data
// through a public endpoint.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, app: 'fit-journey', databaseConfigured: Boolean(env.DB) });
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Authentication and API setup pending' }, { status: 503 });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    // Placeholder: scheduled notifications require Web Push signing, opt-in
    // subscriptions, authenticated per-user state, and DST-safe local time.
  }
};
