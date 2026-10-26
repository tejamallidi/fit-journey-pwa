// Production smoke test: use disposable invitation-only accounts, verify isolation,
// and always delete synthetic data from D1. Never touch real user records.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.FIT_JOURNEY_URL || 'https://fit-journey.suryateja3614.workers.dev';
const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
for (const key of required) if (!process.env[key]) throw Error('Missing ' + key);
const groupId = randomUUID();
const code = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(code).digest('base64url');
const nonce = randomBytes(8).toString('hex');
const emails = ['fj-smoke-a-' + nonce + '@example.invalid', 'fj-smoke-b-' + nonce + '@example.invalid'];
const password = randomBytes(24).toString('base64url');
const directory = mkdtempSync(join(tmpdir(), 'fit-journey-smoke-'));
let createdGroup = false;
function sql(statement) {
  const file = join(directory, 'query.sql');
  writeFileSync(file, statement, { mode: 0o600 });
  execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'fit-journey-db', '--remote', '--file=' + file], {
    env: process.env, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe']
  });
}
async function api(path, method = 'GET', data, cookie) {
  const response = await fetch(base + '/api/' + path, {
    method,
    headers: {
      ...(method !== 'GET' ? { Origin: base } : {}),
      ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, body: result, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const backup = value => ({ start: value, goal: value - 10, weights: [{ date: '2026-10-26', value }], waists: [], days: {} });
async function main() {
  let health;
  for (let i = 0; i < 8; i++) {
    try {
      health = await api('health');
      if (health.status === 200 && health.body.ok === true) break;
    } catch (error) { if (i === 7) throw error; }
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  assert.equal(health?.status, 200, 'Live Worker health must be reachable');
  const status = await api('auth/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.authenticated, false);
  const noInvite = await api('auth/register', 'POST', {
    email: emails[0], name: 'Smoke A', password, inviteCode: 'invalid-invitation-code'
  });
  assert.equal(noInvite.status, 403, 'Unknown invitation must not register');

  sql("INSERT INTO family_groups (id,name,created_by,invite_code_hash) VALUES ('" + groupId + "','Synthetic verification group','owner','" + hash + "');");
  createdGroup = true;
  for (const [index, email] of emails.entries()) {
    const registered = await api('auth/register', 'POST', { email, name: 'Synthetic member ' + index, password, inviteCode: code });
    assert.equal(registered.status, 201, 'Invitation registration must succeed: ' + JSON.stringify(registered.body));
  }
  const cookies = [];
  for (const email of emails) {
    const login = await api('auth/login', 'POST', { email, password });
    assert.equal(login.status, 200, 'New member must sign in');
    assert.match(login.cookie || '', /^fj_session=/);
    cookies.push(login.cookie);
  }
  assert.equal((await api('snapshot', 'GET', undefined, cookies[1])).body.data, null);
  assert.equal((await api('snapshot', 'PUT', { data: backup(71) }, cookies[0])).status, 200);
  assert.equal((await api('snapshot', 'GET', undefined, cookies[1])).body.data, null, 'Member B must not see A data');
  assert.equal((await api('snapshot', 'PUT', { data: backup(63) }, cookies[1])).status, 200);
  assert.equal((await api('snapshot', 'GET', undefined, cookies[0])).body.data.start, 71);
  assert.equal((await api('snapshot', 'GET', undefined, cookies[1])).body.data.start, 63);
  assert.equal((await api('snapshot', 'GET')).status, 401);
  const board = await api('groups/leaderboard?groupId=' + groupId, 'GET', undefined, cookies[0]);
  assert.equal(board.status, 200);
  assert.equal(board.body.leaderboard.length, 2);
  assert.equal(JSON.stringify(board.body).includes('weight'), false);
  console.log('PASS: live health, remote migration, invite-only registration, two logins, private snapshots, protected routes and leaderboard.');
}
try {
  await main();
} finally {
  try {
    if (createdGroup) {
      const members = "SELECT id FROM family_accounts WHERE email IN ('" + emails.join("','") + "')";
      sql([
        'DELETE FROM push_subscriptions WHERE profile_id IN (' + members + ');',
        'DELETE FROM notification_deliveries WHERE profile_id IN (' + members + ');',
        'DELETE FROM daily_logs WHERE profile_id IN (' + members + ');',
        'DELETE FROM meals WHERE profile_id IN (' + members + ');',
        'DELETE FROM measurements WHERE profile_id IN (' + members + ');',
        'DELETE FROM snapshots WHERE profile_id IN (' + members + ');',
        'DELETE FROM auth_session_versions WHERE profile_id IN (' + members + ');',
        "DELETE FROM auth_attempts WHERE id IN ('login:" + emails.join("','login:") + "');",
        "DELETE FROM family_memberships WHERE group_id='" + groupId + "';",
        "DELETE FROM family_accounts WHERE email IN ('" + emails.join("','") + "');",
        "DELETE FROM family_groups WHERE id='" + groupId + "';"
      ].join('\n'));
      console.log('PASS: synthetic production records removed.');
    }
  } catch (error) {
    console.error('CRITICAL: synthetic test cleanup failed:', error.message);
    process.exitCode = 1;
  }
  rmSync(directory, { recursive: true, force: true });
}
