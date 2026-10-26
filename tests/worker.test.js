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
