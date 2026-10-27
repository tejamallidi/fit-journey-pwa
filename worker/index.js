import { sendPush } from './push.js';
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
  try { const obj = JSON.parse(new TextDecoder().decode(unb64(payload))); return typeof obj.sub === 'string' && (obj.sub === 'owner' || /^member:[0-9a-f-]{36}$/.test(obj.sub)) && Number.isSafeInteger(obj.exp) && obj.exp > Date.now() && obj.v === (await sessionVersion(env, obj.sub)) ? obj.sub : false; } catch { return false; }
}
async function body(req) {
  if (Number(req.headers.get('content-length') || 0) > 100000) throw Error('Payload too large');
  const text = await req.text();
  if (text.length > 100000) throw Error('Payload too large');
  return JSON.parse(text);
}
async function sessionVersion(env, profileId = 'owner') {
  const row = await env.DB.prepare('SELECT version FROM auth_session_versions WHERE profile_id=?').bind(profileId).first();
  return row?.version ?? 1;
}
async function account(env) { return env.DB.prepare('SELECT salt, password_hash FROM auth_users WHERE id = ?').bind('owner').first(); }
const emailValid = s => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const displayValid = s => typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 60;
const tokenHash = async s => b64(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
const loginCookie = async (env, id) => { const payload=b64(encoder.encode(JSON.stringify({sub:id,v:await sessionVersion(env,id),exp:Date.now()+30*86400000})));return cookie(payload+'.'+await mac(env.SESSION_SECRET,payload),30*86400); };
const security = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: 'Database unavailable' }, 503, security);
    if (path === '/api/health' && method === 'GET') return json({ ok: true, app: 'fit-journey' }, 200, security);
    if (method !== 'GET' && request.headers.get('origin') !== url.origin) return json({ error: 'Invalid origin' }, 403, security);
    try {
      if (path === '/api/auth/status' && method === 'GET') { const profileId=await session(request,env); return json({initialized:Boolean(await account(env)),authenticated:Boolean(profileId),...(profileId?{profileId}:{})},200,security); }
      if (path === '/api/auth/register' && method === 'POST') {
        const input=await body(request);
        if(!emailValid(input?.email)||!displayValid(input?.name)||typeof input.password!=='string'||input.password.length<12||input.password.length>128)return json({error:'Valid email, name and password of 12–128 characters required'},400,security);
        // New accounts require an existing group invitation. No open public registration.
        if(typeof input.inviteCode!=='string'||input.inviteCode.length<16)return json({error:'Invitation required'},403,security);
        const group=await env.DB.prepare('SELECT id FROM family_groups WHERE invite_code_hash=?').bind(await tokenHash(input.inviteCode)).first();
        if(!group)return json({error:'Invalid invitation'},403,security);
        const id='member:'+crypto.randomUUID(),salt=random(),hash=await derive(input.password,salt);
        try{
          await env.DB.batch([
            env.DB.prepare('INSERT INTO family_accounts (id,email,display_name,salt,password_hash) VALUES (?,?,?,?,?)').bind(id,input.email.trim().toLowerCase(),input.name.trim(),salt,hash),
            env.DB.prepare('INSERT INTO family_memberships (group_id,profile_id) VALUES (?,?)').bind(group.id,id)
          ]);
        }catch{return json({error:'Email already registered or account creation failed'},409,security)}
        return json({ok:true},201,security);
      }
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
        const loginInput=await body(request);
        const attemptId=loginInput?.email && emailValid(loginInput.email) ? 'login:'+loginInput.email.trim().toLowerCase() : 'owner';
        const attempt = await env.DB.prepare('SELECT failed_count, blocked_until FROM auth_attempts WHERE id=?').bind(attemptId).first();
        if (attempt && attempt.blocked_until > Date.now()) return json({ error: 'Too many attempts. Try again later.' }, 429, { ...security, 'retry-after': String(Math.ceil((attempt.blocked_until - Date.now()) / 1000)) });
        if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: 'Server secret missing' }, 503, security);
        const input = loginInput, user = input?.email ? (emailValid(input.email) ? await env.DB.prepare('SELECT id,salt,password_hash FROM family_accounts WHERE email=?').bind(input.email.trim().toLowerCase()).first() : null) : await account(env);
        const loginId=user?.id||'owner';
        if (typeof input?.password !== 'string' || input.password.length > 128) return json({ error: 'Invalid credentials' }, 401, security);
        const salt = user?.salt || random(), hash = await derive(input.password, salt);
        if (!user || !compare(hash, user.password_hash)) {
          const failed = (attempt?.failed_count ?? 0) + 1;
          const blocked = failed >= 5 ? Date.now() + 15 * 60000 : 0;
          await env.DB.prepare('INSERT INTO auth_attempts (id, failed_count, blocked_until) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET failed_count=excluded.failed_count, blocked_until=excluded.blocked_until').bind(attemptId, failed >= 5 ? 0 : failed, blocked).run();
          return json({ error: 'Invalid credentials' }, 401, security);
        }
        await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(attemptId).run();
        return json({ok:true},200,{...security,'set-cookie':await loginCookie(env,loginId)});
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const active=await session(request,env);if(active) await env.DB.prepare('INSERT INTO auth_session_versions (profile_id, version) VALUES (?, 2) ON CONFLICT(profile_id) DO UPDATE SET version=version+1').bind(active).run();
        return json({ ok: true }, 200, { ...security, 'set-cookie': cookie('', 0) });
      }
      const profileId=await session(request,env);
      if(!profileId)return json({error:'Sign in required'},401,security);
      if(path==='/api/groups' && method==='GET'){
        const groups=await env.DB.prepare('SELECT g.id,g.name,g.created_by FROM family_groups g JOIN family_memberships m ON m.group_id=g.id WHERE m.profile_id=? ORDER BY g.created_at DESC').bind(profileId).all();
        return json({groups:groups.results},200,security);
      }
      if(path==='/api/groups' && method==='POST'){
        const input=await body(request);
        if(!displayValid(input?.name))return json({error:'Group name must be 2–60 characters'},400,security);
        const id=crypto.randomUUID(),code=random();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO family_groups (id,name,created_by,invite_code_hash) VALUES (?,?,?,?)').bind(id,input.name.trim(),profileId,await tokenHash(code)),
          env.DB.prepare('INSERT INTO family_memberships (group_id,profile_id) VALUES (?,?)').bind(id,profileId)
        ]);
        return json({id,inviteCode:code},201,security);
      }
      if(path==='/api/groups/manage' && method==='PATCH'){
        const input=await body(request);
        const group=await env.DB.prepare('SELECT created_by FROM family_groups WHERE id=?').bind(input?.groupId).first();
        if(!group)return json({error:'Group not found'},404,security);
        if(group.created_by!==profileId)return json({error:'Only the group creator can edit'},403,security);
        if(!displayValid(input?.name))return json({error:'Invalid group name'},400,security);
        await env.DB.prepare('UPDATE family_groups SET name=? WHERE id=?').bind(input.name.trim(),input.groupId).run();
        return json({ok:true},200,security);
      }
      if(path==='/api/groups/manage' && method==='DELETE'){
        const input=await body(request);
        const group=await env.DB.prepare('SELECT created_by FROM family_groups WHERE id=?').bind(input?.groupId).first();
        if(!group)return json({error:'Group not found'},404,security);
        if(group.created_by!==profileId)return json({error:'Only the group creator can delete'},403,security);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM family_memberships WHERE group_id=?').bind(input.groupId),
          env.DB.prepare('DELETE FROM family_groups WHERE id=?').bind(input.groupId)
        ]);
        return json({ok:true},200,security);
      }
      if(path==='/api/groups/join' && method==='POST'){
        const input=await body(request);
        if(typeof input?.inviteCode!=='string'||input.inviteCode.length<16)return json({error:'Invalid invitation'},400,security);
        const group=await env.DB.prepare('SELECT id FROM family_groups WHERE invite_code_hash=?').bind(await tokenHash(input.inviteCode)).first();
        if(!group)return json({error:'Invalid invitation'},404,security);
        await env.DB.prepare('INSERT OR IGNORE INTO family_memberships (group_id,profile_id) VALUES (?,?)').bind(group.id,profileId).run();
        return json({ok:true,groupId:group.id},200,security);
      }
      if(path==='/api/groups/invite' && method==='POST'){
        const groupId=url.searchParams.get('groupId');
        const member=await env.DB.prepare('SELECT 1 FROM family_memberships WHERE group_id=? AND profile_id=?').bind(groupId,profileId).first();
        if(!member)return json({error:'Not a group member'},403,security);
        const inviteCode=random();await env.DB.prepare('UPDATE family_groups SET invite_code_hash=? WHERE id=?').bind(await tokenHash(inviteCode),groupId).run();return json({inviteCode},200,security);
      }
      if(path==='/api/groups/leaderboard' && method==='GET'){
        const groupId=url.searchParams.get('groupId');
        const member=await env.DB.prepare('SELECT 1 FROM family_memberships WHERE group_id=? AND profile_id=?').bind(groupId,profileId).first();
        if(!member)return json({error:'Not a group member'},403,security);
        const rows=await env.DB.prepare("SELECT m.profile_id, COALESCE(a.display_name, 'Owner') AS name, s.data_json FROM family_memberships m LEFT JOIN family_accounts a ON a.id=m.profile_id LEFT JOIN snapshots s ON s.profile_id=m.profile_id WHERE m.group_id=?").bind(groupId).all();
        const today=new Date();const weekday=(today.getUTCDay()+6)%7;const monday=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-weekday));const dates=Array.from({length:7},(_,i)=>new Date(monday.getTime()+i*86400000).toISOString().slice(0,10));
        const streakFor=days=>{let date=new Date();date.setUTCHours(12,0,0,0);let count=0;for(let i=0;i<366;i++){const key=date.toISOString().slice(0,10),d=days[key];if(!d||!Object.values(d.habits||{}).some(Boolean)){if(i!==0)break}else count++;date.setUTCDate(date.getUTCDate()-1)}return count};
        const leaderboard=rows.results.map(row=>{let days={};try{days=JSON.parse(row.data_json||'{}').days||{}}catch{}
          let points=0,walks=0,active=0;
          for(const date of dates){if(date>today.toISOString().slice(0,10))continue;const d=days[date];if(!d)continue;
            if(d.habits?.walk){points+=10;walks++}
            if(Array.isArray(d.meals)&&d.meals.length>=2)points+=5;
            if(Object.values(d.habits||{}).filter(Boolean).length>=3){points+=5;active++}
          }
          if(walks>=5)points+=20;
          return {name:row.name,points,walks,activeDays:active,streak:streakFor(days),profileId:row.profile_id};
        }).sort((a,b)=>b.points-a.points);
        return json({weekStart:dates[0],leaderboard},200,security);
      }
      if (path === '/api/push/config' && method === 'GET') return json({enabled:Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),publicKey:env.VAPID_PUBLIC_KEY||null},200,security);
      if (path === '/api/push/subscriptions' && method === 'POST') {
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json({error:'Push not configured'},503,security);
        const input=await body(request);
        const endpoint=input?.endpoint,p256dh=input?.keys?.p256dh,auth=input?.keys?.auth;
        if(typeof endpoint!=='string'||endpoint.length>2048||!endpoint.startsWith('https://')||typeof p256dh!=='string'||p256dh.length>256||typeof auth!=='string'||auth.length>256)return json({error:'Invalid subscription'},400,security);
        await env.DB.prepare('INSERT INTO push_subscriptions (id,profile_id,endpoint,p256dh,auth) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET profile_id=excluded.profile_id,p256dh=excluded.p256dh,auth=excluded.auth').bind(crypto.randomUUID(),profileId,endpoint,p256dh,auth).run();
        return json({ok:true},201,security);
      }
      if (path === '/api/push/subscriptions' && method === 'DELETE') {
        const input=await body(request);if(typeof input?.endpoint!=='string')return json({error:'Invalid endpoint'},400,security);
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE profile_id=? AND endpoint=?').bind(profileId,input.endpoint).run();
        return json({ok:true},200,security);
      }
      if (path === '/api/snapshot' && method === 'GET') {
        const record = await env.DB.prepare('SELECT data_json, updated_at FROM snapshots WHERE profile_id=?').bind(profileId).first();
        return json({ data: record ? JSON.parse(record.data_json) : null, updatedAt: record?.updated_at || null }, 200, security);
      }
      if (path === '/api/snapshot' && method === 'PUT') {
        const input = await body(request);
        const data = input?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.weights) || !Array.isArray(data.waists) || !data.days || typeof data.days !== 'object' || Array.isArray(data.days) || !Number.isFinite(data.start) || !Number.isFinite(data.goal)) return json({ error: 'Invalid backup format' }, 400, security);
        const serialized = JSON.stringify(data);
        if (serialized.length > 90000) return json({ error: 'Backup exceeds 90 KB limit' }, 413, security);
        await env.DB.prepare('INSERT INTO snapshots (profile_id, data_json) VALUES (?, ?) ON CONFLICT(profile_id) DO UPDATE SET data_json=excluded.data_json, updated_at=CURRENT_TIMESTAMP').bind(profileId, serialized).run();
        return json({ ok: true }, 200, security);
      }
      if (path === '/api/logs' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT log_date, walk_minutes, walk_completed, chai_count, notes FROM daily_logs WHERE profile_id = ? ORDER BY log_date DESC LIMIT 90').bind(profileId).all();
        return json({ logs: rows.results }, 200, security);
      }
      if (path === '/api/logs' && method === 'PUT') {
        const input = await body(request);
        if (!validDate(input?.date) || !Number.isInteger(input.walkMinutes) || input.walkMinutes < 0 || input.walkMinutes > 600 || typeof input.walkCompleted !== 'boolean' || !Number.isInteger(input.chaiCount) || input.chaiCount < 0 || input.chaiCount > 20 || (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000))) return json({ error: 'Invalid log' }, 400, security);
        await env.DB.prepare('INSERT INTO daily_logs (profile_id, log_date, walk_minutes, walk_completed, chai_count, notes) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, log_date) DO UPDATE SET walk_minutes=excluded.walk_minutes, walk_completed=excluded.walk_completed, chai_count=excluded.chai_count, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP').bind(profileId, input.date, input.walkMinutes, Number(input.walkCompleted), input.chaiCount, input.notes || null).run();
        return json({ ok: true }, 200, security);
      }
      if (path === '/api/measurements' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, log_date, weight_kg, waist_cm FROM measurements WHERE profile_id=? ORDER BY log_date DESC LIMIT 100').bind(profileId).all();
        return json({ measurements: rows.results }, 200, security);
      }
      if (path === '/api/measurements' && method === 'POST') {
        const input = await body(request);
        if (!validDate(input?.date) || (input.weightKg == null && input.waistCm == null) || (input.weightKg != null && (!Number.isFinite(input.weightKg) || input.weightKg < 25 || input.weightKg > 350)) || (input.waistCm != null && (!Number.isFinite(input.waistCm) || input.waistCm < 30 || input.waistCm > 200))) return json({ error: 'Invalid measurement' }, 400, security);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO measurements (id, profile_id, log_date, weight_kg, waist_cm) VALUES (?, ?, ?, ?, ?)').bind(id, profileId, input.date, input.weightKg ?? null, input.waistCm ?? null).run();
        return json({ id }, 201, security);
      }
      if (path === '/api/meals' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, log_date, name, portion FROM meals WHERE profile_id=? ORDER BY created_at DESC LIMIT 200').bind(profileId).all();
        return json({ meals: rows.results }, 200, security);
      }
      if (path === '/api/meals' && method === 'POST') {
        const input = await body(request);
        if (!validDate(input?.date) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 || (input.portion != null && (typeof input.portion !== 'string' || input.portion.length > 80))) return json({ error: 'Invalid meal' }, 400, security);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO meals (id, profile_id, log_date, name, portion) VALUES (?, ?, ?, ?, ?)').bind(id, profileId, input.date, input.name.trim(), input.portion || null).run();
        return json({ id }, 201, security);
      }
      return json({ error: 'Not found' }, 404, security);
    } catch (err) { console.error('Fit Journey API error', { path, method, type: err?.name || 'Error', message: err?.message || 'Unknown error' }); return json({ error: 'Server request failed. Check Worker logs or contact support.' }, 500, security); }
  },
  async scheduled(event, env, ctx) {
    if(!env.DB||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return;
    const now=new Date(event.scheduledTime||Date.now());
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const date=parts.year+'-'+parts.month+'-'+parts.day;
    const clock=parts.hour+':'+parts.minute;
    const type=clock==='07:30'?'morning':clock==='19:00'?'evening':null;
    if(!type)return;
    const profiles=await env.DB.prepare('SELECT DISTINCT profile_id FROM push_subscriptions').all();
    for(const profileId of profiles.results.map(r=>r.profile_id)){
    const snapshot=await env.DB.prepare('SELECT data_json FROM snapshots WHERE profile_id=?').bind(profileId).first();
    let day={};
    try{day=JSON.parse(snapshot?.data_json||'{}').days?.[date]||{}}catch{}
    if(type==='evening'&&day.habits?.walk)continue;
    const subscriptions=await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE profile_id=?').bind(profileId).all();
    if(!subscriptions.results?.length)continue;
    const prior=await env.DB.prepare('SELECT 1 FROM notification_deliveries WHERE profile_id=? AND log_date=? AND reminder_type=?').bind(profileId,date,type).first();
    if(prior)continue;
    const message=type==='morning'?{title:'Good morning! Time to walk 🚶',body:'A comfortable walk is a great start to your day.',tag:'walk-'+date+'-morning'}:{title:'Your evening walking check-in 🚶',body:'Your walk is still incomplete. Even a short walk counts!',tag:'walk-'+date+'-evening'};
    let delivered=false;
    for(const sub of subscriptions.results){
      try{
        const status=await sendPush(sub,env,message);
        if(status>=200&&status<300)delivered=true;
        if(status===404||status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE id=?').bind(sub.id).run();
        if(status>=400&&status!==404&&status!==410)console.error('Push service rejected request',{status});
      }catch(e){console.error('Push delivery failed',e?.message)}
    }
    if(delivered)await env.DB.prepare('INSERT OR IGNORE INTO notification_deliveries (profile_id,log_date,reminder_type) VALUES (?,?,?)').bind(profileId,date,type).run();
    }
  }
};
