import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';

const ORIGIN = 'https://fit.example';
const SECRET = 'fit-journey-integration-secret-12345678901234567890';
const TOKEN = 'fit-journey-setup-token-123456789012345678901234';
const snapshot = (weight, walk = false) => ({
  start: weight, goal: weight - 10,
  weights: [{ date: '2026-10-26', value: weight }],
  waists: [],
  days: { '2026-10-26': { habits: { walk }, meals: ['Private meal'], walkMinutes: walk ? 30 : 0 } }
});

function createEnvironment() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['db/schema.sql', 'db/migration_002.sql', 'db/migration_003_family.sql']) {
    db.exec(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  }
  const prepare = (sql, params = []) => ({
    bind: (...args) => prepare(sql, args),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } })
  });
  const env = {
    DB: {
      prepare,
      batch: async (statements) => {
        db.exec('BEGIN');
        try {
          const result = [];
          for (const statement of statements) result.push(await statement.run());
          db.exec('COMMIT');
          return result;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
    },
    ASSETS: { fetch: () => new Response('site') },
    SESSION_SECRET: SECRET,
    SETUP_TOKEN: TOKEN,
    VAPID_PUBLIC_KEY: 'test-public',
    VAPID_PRIVATE_KEY: 'test-private'
  };
  return { env, db };
}
async function request(env, path, method = 'GET', data, cookie) {
  const response = await worker.fetch(new Request(ORIGIN + '/api/' + path, {
    method,
    headers: {
      ...(method !== 'GET' ? { origin: ORIGIN } : {}),
      ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {})
  }), env);
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(env, email, password) {
  const result = await request(env, 'auth/login', 'POST', { ...(email ? { email } : {}), password });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.cookie, /^fj_session=/);
  return result.cookie;
}

test('real SQL migrations support invite-only accounts and private, isolated records', async () => {
  const { env, db } = createEnvironment();
  try {
    assert.equal((await request(env, 'auth/setup', 'POST', { setupToken: TOKEN, password: 'Owner-password-1234' })).status, 201);
    const ownerCookie = await login(env, undefined, 'Owner-password-1234');
    const ownerHistory = snapshot(88, true);
    assert.equal((await request(env, 'snapshot', 'PUT', { data: ownerHistory }, ownerCookie)).status, 200);
    const created = await request(env, 'groups', 'POST', { name: 'Family walking' }, ownerCookie);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { id: groupId, inviteCode } = created.body;

    const newMember = (email, name, code = inviteCode) => request(env, 'auth/register', 'POST', {
      email, name, password: 'Member-password-1234', inviteCode: code
    });
    assert.equal((await newMember('a@example.invalid', 'Member A', 'wrong-invite-token-123')).status, 403);
    assert.equal((await newMember('a@example.invalid', 'Member A', '')).status, 403);
    assert.equal((await newMember('a@example.invalid', 'Member A')).status, 201);
    assert.equal((await newMember('b@example.invalid', 'Member B')).status, 201);
    assert.equal((await newMember('a@example.invalid', 'Duplicate')).status, 409);
    assert.equal((await request(env, 'auth/login', 'POST', { email: 'a@example.invalid', password: 'wrong' })).status, 401);
    const a = await login(env, 'a@example.invalid', 'Member-password-1234');
    const b = await login(env, 'b@example.invalid', 'Member-password-1234');
    const aId = (await request(env, 'auth/status', 'GET', undefined, a)).body.profileId;
    const bId = (await request(env, 'auth/status', 'GET', undefined, b)).body.profileId;
    assert.notEqual(aId, bId);
    assert.notEqual(aId, 'owner');

    assert.equal((await request(env, 'snapshot', 'GET', undefined, b)).body.data, null);
    assert.equal((await request(env, 'snapshot', 'PUT', { data: snapshot(72, true) }, a)).status, 200);
    assert.equal((await request(env, 'snapshot', 'GET', undefined, b)).body.data, null);
    assert.equal((await request(env, 'snapshot', 'PUT', { data: snapshot(65) }, b)).status, 200);
    assert.equal((await request(env, 'snapshot', 'GET', undefined, a)).body.data.start, 72);
    assert.equal((await request(env, 'snapshot', 'GET', undefined, b)).body.data.start, 65);
    assert.deepEqual((await request(env, 'snapshot', 'GET', undefined, ownerCookie)).body.data, ownerHistory);

    const date = '2026-10-26';
    assert.equal((await request(env, 'logs', 'PUT', { date, walkMinutes: 30, walkCompleted: true, chaiCount: 1 }, a)).status, 200);
    assert.equal((await request(env, 'logs', 'GET', undefined, b)).body.logs.length, 0);
    assert.equal((await request(env, 'meals', 'POST', { date, name: 'A private meal' }, a)).status, 201);
    assert.equal((await request(env, 'meals', 'GET', undefined, b)).body.meals.length, 0);
    assert.equal((await request(env, 'measurements', 'POST', { date, weightKg: 72 }, a)).status, 201);
    assert.equal((await request(env, 'measurements', 'GET', undefined, b)).body.measurements.length, 0);

    const leaderboard = await request(env, 'groups/leaderboard?groupId=' + groupId, 'GET', undefined, a);
    assert.equal(leaderboard.status, 200);
    assert.equal(leaderboard.body.leaderboard.length, 3);
    assert.equal(JSON.stringify(leaderboard.body).includes('Private meal'), false);
    assert.equal(JSON.stringify(leaderboard.body).includes('weight'), false);

    const otherGroup = await request(env, 'groups', 'POST', { name: 'Other group' }, ownerCookie);
    assert.equal(otherGroup.status, 201);
    assert.equal((await request(env, 'groups/leaderboard?groupId=' + otherGroup.body.id, 'GET', undefined, a)).status, 403);
    assert.equal((await request(env, 'snapshot', 'GET')).status, 401);
    assert.equal((await request(env, 'snapshot', 'PUT', { data: snapshot(50) })).status, 401);

    assert.equal((await request(env, 'auth/logout', 'POST', {}, a)).status, 200);
    assert.equal((await request(env, 'snapshot', 'GET', undefined, a)).status, 401);
    assert.equal((await request(env, 'snapshot', 'GET', undefined, b)).body.data.start, 65);
  } finally { db.close(); }
});
