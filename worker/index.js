const encoder = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const unb64 = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4)), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
const compare = (a, b) => { const aa = encoder.encode(a), bb = encoder.encode(b); let mismatch = aa.length ^ bb.length; for (let i = 0; i < Math.max(aa.length, bb.length); i++) mismatch |= (aa[i] || 0) ^ (bb[i] || 0); return mismatch === 0; };
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
async function mac(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}
const cookie = (token, age) => 'fj_session=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age;
async function session(req, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return false;
  const token = /(?:^|; )fj_session=([^;]+)/.exec(req.headers.get('cookie') || '')?.[1];
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !compare(await mac(env.SESSION_SECRET, payload), signature)) return false;
  try { const obj = JSON.parse(new TextDecoder().decode(unb64(payload))); return obj.sub === 'owner' && Number.isSafeInteger(obj.exp) && obj.exp > Date.now() && obj.v === (await sessionVersion(env)); } catch { return false; }
}
async function body(req) {
  if (Number(req.headers.get('content-length') || 0) > 12000) throw Error('Payload too large');
  const text = await req.text();
  if (text.length > 12000) throw Error('Payload too large');
  return JSON.parse(text);
}
async function sessionVersion(env) {
  const row = await env.DB.prepare('SELECT version FROM auth_session_versions WHERE profile_id=?').bind('owner').first();
  return row?.version ?? 1;
}
async function account(env) { return env.DB.prepare('SELECT salt, password_hash FROM auth_users WHERE id = ?').bind('owner').first(); }
const security = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: 'Database unavailable' }, 503, security);
    if (path === '/api/health' && method === 'GET') return json({ ok: true, app: 'fit-journey' }, 200, security);
    if (method !== 'GET' && request.headers.get('origin') !== url.origin) return json({ error: 'Invalid origin' }, 403, security);
    try {
      if (path === '/api/auth/status' && method === 'GET') return json({ initialized: Boolean(await account(env)), authenticated: await session(request, env) }, 200, security);
      if (path === '/api/auth/setup' && method === 'POST') {
        if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 32 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: 'Server secrets not configured' }, 503, security);
        const input = await body(request);
        if (!input || !compare(String(input.setupToken || ''), env.SETUP_TOKEN)) return json({ error: 'Not authorized' }, 403, security);
        if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return json({ error: 'Password must be 12–128 characters' }, 400, security);
        const salt = random(), hash = await derive(input.password, salt);
        const inserted = await env.DB.prepare('INSERT OR IGNORE INTO auth_users (id, salt, password_hash) VALUES (?, ?, ?)').bind('owner', salt, hash).run();
        return json({ created: inserted.meta.changes === 1 }, inserted.meta.changes === 1 ? 201 : 409, security);
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const attempt = await env.DB.prepare('SELECT failed_count, blocked_until FROM auth_attempts WHERE id=?').bind('owner').first();
        if (attempt && attempt.blocked_until > Date.now()) return json({ error: 'Too many attempts. Try again later.' }, 429, { ...security, 'retry-after': String(Math.ceil((attempt.blocked_until - Date.now()) / 1000)) });
        if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: 'Server secret missing' }, 503, security);
        const input = await body(request), user = await account(env);
        if (typeof input?.password !== 'string' || input.password.length > 128) return json({ error: 'Invalid credentials' }, 401, security);
        const salt = user?.salt || random(), hash = await derive(input.password, salt);
        if (!user || !compare(hash, user.password_hash)) {
          const failed = (attempt?.failed_count ?? 0) + 1;
          const blocked = failed >= 5 ? Date.now() + 15 * 60000 : 0;
          await env.DB.prepare('INSERT INTO auth_attempts (id, failed_count, blocked_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET failed_count=excluded.failed_count, blocked_until=excluded.blocked_until').bind('owner', failed >= 5 ? 0 : failed, blocked).run();
          return json({ error: 'Invalid credentials' }, 401, security);
        }
        await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind('owner').run();
        const payload = b64(encoder.encode(JSON.stringify({ sub: 'owner', v: await sessionVersion(env), exp: Date.now() + 30 * 86400000 })));
        return json({ ok: true }, 200, { ...security, 'set-cookie': cookie(payload + '.' + await mac(env.SESSION_SECRET, payload), 30 * 86400) });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        if (await session(request, env)) await env.DB.prepare('INSERT INTO auth_session_versions (profile_id, version) VALUES (?, 2) ON CONFLICT(profile_id) DO UPDATE SET version=version+1').bind('owner').run();
        return json({ ok: true }, 200, { ...security, 'set-cookie': cookie('', 0) });
      }
      if (!(await session(request, env))) return json({ error: 'Sign in required' }, 401, security);
      if (path === '/api/snapshot' && method === 'GET') {
        const record = await env.DB.prepare('SELECT data_json, updated_at FROM snapshots WHERE profile_id=?').bind('owner').first();
        return json({ data: record ? JSON.parse(record.data_json) : null, updatedAt: record?.updated_at || null }, 200, security);
      }
      if (path === '/api/snapshot' && method === 'PUT') {
        const input = await body(request);
        const data = input?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.weights) || !Array.isArray(data.waists) || !data.days || typeof data.days !== 'object' || Array.isArray(data.days) || !Number.isFinite(data.start) || !Number.isFinite(data.goal)) return json({ error: 'Invalid backup format' }, 400, security);
        const serialized = JSON.stringify(data);
        if (serialized.length > 10000) return json({ error: 'Backup exceeds 10 KB limit' }, 413, security);
        await env.DB.prepare('INSERT INTO snapshots (profile_id, data_json) VALUES (?, ?) ON CONFLICT(profile_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP').bind('owner', serialized).run();
        return json({ ok: true }, 200, security);
      }
      if (path === '/api/logs' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT log_date, walk_minutes, walk_completed, chai_count, notes FROM daily_logs WHERE profile_id = ? ORDER BY log_date DESC LIMIT 90').bind('owner').all();
        return json({ logs: rows.results }, 200, security);
      }
      if (path === '/api/logs' && method === 'PUT') {
        const input = await body(request);
        if (!validDate(input?.date) || !Number.isInteger(input.walkMinutes) || input.walkMinutes < 0 || input.walkMinutes > 600 || typeof input.walkCompleted !== 'boolean' || !Number.isInteger(input.chaiCount) || input.chaiCount < 0 || input.chaiCount > 20 || (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000))) return json({ error: 'Invalid log' }, 400, security);
        await env.DB.prepare('INSERT INTO daily_logs (profile_id, log_date, walk_minutes, walk_completed, chai_count, notes) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, log_date) DO UPDATE SET walk_minutes=excluded.walk_minutes, walk_completed=excluded.walk_completed, chai_count=excluded.chai_count, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP').bind('owner', input.date, input.walkMinutes, Number(input.walkCompleted), input.chaiCount, input.notes || null).run();
        return json({ ok: true }, 200, security);
      }
      if (path === '/api/measurements' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, log_date, weight_kg, waist_cm FROM measurements WHERE profile_id=? ORDER BY log_date DESC LIMIT 100').bind('owner').all();
        return json({ measurements: rows.results }, 200, security);
      }
      if (path === '/api/measurements' && method === 'POST') {
        const input = await body(request);
        if (!validDate(input?.date) || (input.weightKg == null && input.waistCm == null) || (input.weightKg != null && (!Number.isFinite(input.weightKg) || input.weightKg < 25 || input.weightKg > 350)) || (input.waistCm != null && (!Number.isFinite(input.waistCm) || input.waistCm < 30 || input.waistCm > 200))) return json({ error: 'Invalid measurement' }, 400, security);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO measurements (id, profile_id, log_date, weight_kg, waist_cm) VALUES (?, ?, ?, ?, ?)').bind(id, 'owner', input.date, input.weightKg ?? null, input.waistCm ?? null).run();
        return json({ id }, 201, security);
      }
      if (path === '/api/meals' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, log_date, name, portion FROM meals WHERE profile_id=? ORDER BY created_at DESC LIMIT 200').bind('owner').all();
        return json({ meals: rows.results }, 200, security);
      }
      if (path === '/api/meals' && method === 'POST') {
        const input = await body(request);
        if (!validDate(input?.date) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || (input.portion != null && (typeof input.portion !== 'string' || input.portion.length > 80))) return json({ error: 'Invalid meal' }, 400, security);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO meals (id, profile_id, log_date, name, portion) VALUES (?, ?, ?, ?, ?)').bind(id, 'owner', input.date, input.name.trim(), input.portion || null).run();
        return json({ id }, 201, security);
      }
      return json({ error: 'Not found' }, 404, security);
    } catch (err) { console.error('Fit Journey API error', { path, method, type: err?.name || 'Error', message: err?.message || 'Unknown error' }); return json({ error: 'Server request failed. Check Worker logs or contact support.' }, 500, security); }
  },
  async scheduled(event, env, ctx) {
    // Push delivery is intentionally disabled until VAPID, user opt-in,
    // Pacific timezone scheduling and deduplication are implemented.
  }
};
