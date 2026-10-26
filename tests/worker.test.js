import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }, ASSETS: { fetch: () => new Response('site') } };
test('health endpoint is available', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/health'), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});
test('protected logs require sign-in', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/logs'), env);
  assert.equal(res.status, 401);
});
test('cross-origin writes are rejected', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/auth/login', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: '{}' }), env);
  assert.equal(res.status, 403);
});
test('static assets are served through asset binding', async () => {
  const res = await worker.fetch(new Request('https://fit.example/'), env);
  assert.equal(await res.text(), 'site');
});

test('first-time authentication status reports uninitialized', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/auth/status'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { initialized: false, authenticated: false });
});
test('account setup refuses missing server secrets', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/auth/setup', {
    method: 'POST', headers: { origin: 'https://fit.example', 'content-type': 'application/json' },
    body: JSON.stringify({ setupToken: 'not-secret', password: 'long-password-123' })
  }), env);
  assert.equal(res.status, 503);
});
test('invalid sign-in is rejected without configured secret', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/auth/login', {
    method: 'POST', headers: { origin: 'https://fit.example' }, body: JSON.stringify({ password: 'test' })
  }), env);
  assert.equal(res.status, 503);
});
test('cloud backups require a session for reading and writing', async () => {
  const read = await worker.fetch(new Request('https://fit.example/api/snapshot'), env);
  assert.equal(read.status, 401);
  const write = await worker.fetch(new Request('https://fit.example/api/snapshot', {
    method: 'PUT', headers: { origin: 'https://fit.example', 'content-type': 'application/json' },
    body: JSON.stringify({ data: { start: 88, goal: 70, weights: [], waists: [], days: {} } })
  }), env);
  assert.equal(write.status, 401);
});
test('unsafe cross-origin backup updates are rejected', async () => {
  const res = await worker.fetch(new Request('https://fit.example/api/snapshot', {
    method: 'PUT', headers: { origin: 'https://malicious.example' }, body: '{}'
  }), env);
  assert.equal(res.status, 403);
});
