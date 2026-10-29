'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORTS = { A: 3961, B: 3962 };
const procs = [];
const start = async (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `simmer-fed-${name}-`));
  const p = spawn('node', ['src/server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORTS[name]), DATA_DIR: dir, ALLOW_PRIVATE_URLS: 'true', PHOTO_CHECK: 'false', AUTO_UPDATE: 'false', FEDERATION_DEBOUNCE_MS: '50' }, stdio: 'ignore' });
  procs.push(p);
  const base = `http://127.0.0.1:${PORTS[name]}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  return base;
};
const client = (base) => {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  return { base, call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), patch: (u, b) => call('PATCH', u, b || {}), del: (u) => call('DELETE', u) };
};
const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, 80)); } throw new Error('timed out waiting'); };

let A, B, SECRET, peerOnA, peerOnB, aliceRecipe;
test.before(async () => {
  const [a, b] = [await start('A'), await start('B')];
  A = client(a); B = client(b);
  await A.post('/api/auth/setup', { name: 'Chris', username: 'chris', password: 'correct horse' });
  await B.post('/api/auth/setup', { name: 'Bob', username: 'bob', password: 'staple battery' });
});
test.after(() => procs.forEach((p) => p.kill()));

test('two admins link their Simmers with a shared token, and a wrong token is refused', async () => {
  const added = (await A.post('/api/admin/peers', { name: 'Bob’s Simmer', url: B.base })).json;
  assert.ok(added.secret && added.secret.length >= 16);
  SECRET = added.secret; peerOnA = added.id;
  assert.equal((await A.get('/api/peers')).json[0].secretEnd, SECRET.slice(-4));
  assert.equal((await A.post(`/api/admin/peers/${peerOnA}/test`)).json.ok, false, 'Bob has not added Chris yet');
  const back = (await B.post('/api/admin/peers', { name: 'Chris’s Simmer', url: A.base, secret: SECRET })).json;
  assert.equal(back.secret, SECRET); peerOnB = back.id;
  assert.equal((await A.post(`/api/admin/peers/${peerOnA}/test`)).json.ok, true);
  assert.equal((await B.post(`/api/admin/peers/${peerOnB}/test`)).json.ok, true);
  assert.equal((await fetch(B.base + '/api/federation/ping', { headers: { authorization: 'Bearer nope-nope-nope-nope' } })).status, 401);
  assert.equal((await fetch(B.base + '/api/federation/ping')).status, 401);
  assert.equal((await A.post('/api/admin/peers', { name: 'Dup', url: 'http://127.0.0.1:1', secret: SECRET })).status, 400, 'a token cannot be reused');
  assert.equal((await A.post('/api/admin/peers', { name: 'x', url: 'not a url' })).status, 400);
  assert.equal((await B.get('/api/me')).json.linkedSimmers, 1);
});

test('only admins manage links', async () => {
  const inv = (await B.post('/api/admin/invites')).json.code;
  const eve = client(B.base);
  assert.equal((await eve.post('/api/auth/register', { invite: inv, name: 'Eve', username: 'eve', password: 'longpassword' })).status, 200);
  assert.equal((await eve.post('/api/admin/peers', { name: 'x', url: A.base })).status, 403);
  const list = (await eve.get('/api/peers')).json;
  assert.equal(list.length, 1); assert.equal(list[0].secretEnd, undefined, 'members see names only');
});

test('a recipe shared with someone on another Simmer shows up there, read-only, and follows changes', async () => {
  aliceRecipe = (await A.post('/api/recipes', { title: 'Shared soup', ingredients: ['1 onion'], steps: ['Simmer.'], collections: ['Soups'] })).json;
  const bad = await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'nobody', kind: 'recipe', ref: aliceRecipe.id });
  assert.equal(bad.status, 200, 'the share is created');
  assert.match(bad.json.error, /no one called/i, 'but says why it did not arrive');
  await A.del('/api/remote-shares/' + bad.json.id);
  const ok = await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'Bob', kind: 'recipe', ref: aliceRecipe.id });
  assert.equal(ok.json.error, '');
  const got = (await B.get('/api/recipes')).json.find((r) => r.title === 'Shared soup');
  assert.ok(got); assert.equal(got.mine, false); assert.match(got.ownerName, /Chris/);
  assert.deepEqual(got.ingredients, ['1 onion']);
  // Bob can keep notes but cannot change the recipe
  await B.put('/api/recipes/' + got.id, { title: 'Hacked', notes: 'Needs salt' });
  assert.equal((await B.get('/api/recipes/' + got.id)).json.title, 'Shared soup');
  assert.equal((await B.get('/api/recipes/' + got.id)).json.notes, 'Needs salt');
  // Chris edits it: Bob sees the change, and keeps his notes
  await A.put('/api/recipes/' + aliceRecipe.id, { title: 'Shared soup v2', ingredients: ['2 onions'] });
  await until(async () => (await B.get('/api/recipes/' + got.id)).json.title === 'Shared soup v2');
  const after = (await B.get('/api/recipes/' + got.id)).json;
  assert.deepEqual(after.ingredients, ['2 onions']); assert.equal(after.notes, 'Needs salt');
  assert.equal((await B.post('/api/remote-shares', { peerId: peerOnB, toUser: 'chris', kind: 'recipe', ref: got.id })).status, 403, 'a copy cannot be passed on');
});

test('a shared shopping list is live in both directions', async () => {
  const l = (await A.post('/api/lists', { name: 'Party' })).json;
  await A.post(`/api/lists/${l.id}/items`, { name: 'Chips' });
  const sh = (await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'bob', kind: 'list', ref: l.id })).json;
  assert.equal(sh.error, '');
  const mine = (await B.get('/api/lists')).json.find((x) => x.name === 'Party');
  assert.ok(mine); assert.equal(mine.mine, false); assert.equal(mine.items[0].name, 'Chips');
  // Bob adds and ticks
  const added = (await B.post(`/api/lists/${mine.id}/items`, { name: 'Salsa' })).json;
  assert.ok(added.items.some((i) => i.name === 'Salsa'));
  const onA = (await A.get('/api/lists')).json.find((x) => x.id === l.id);
  assert.ok(onA.items.some((i) => i.name === 'Salsa'), 'reached the owner at once');
  const salsa = onA.items.find((i) => i.name === 'Salsa');
  assert.equal((await B.patch(`/api/lists/${mine.id}/items/${salsa.id}`, { checked: true })).json.checked, true);
  assert.equal((await A.get('/api/lists')).json.find((x) => x.id === l.id).items.find((i) => i.name === 'Salsa').checked, true);
  // Chris adds; Bob receives it
  await A.post(`/api/lists/${l.id}/items`, { name: 'Dip' });
  await until(async () => (await B.get('/api/lists')).json.find((x) => x.id === mine.id).items.some((i) => i.name === 'Dip'));
  // Bob's recipe-to-list works on a shared list too
  await B.post('/api/recipes/' + (await B.get('/api/recipes')).json.find((r) => r.title === 'Shared soup v2').id + '/to-list', { listId: mine.id });
  assert.ok((await A.get('/api/lists')).json.find((x) => x.id === l.id).items.some((i) => /onion/i.test(i.name)));
  assert.equal((await B.put(`/api/lists/${mine.id}/settings`, { name: 'Mine now' })).status, 403);
  await B.post(`/api/lists/${mine.id}/clear-checked`);
  assert.ok(!(await A.get('/api/lists')).json.find((x) => x.id === l.id).items.some((i) => i.name === 'Salsa'));
});

test('a meal appears in the other plan with its recipe, and a whole collection can be shared', async () => {
  const r2 = (await A.post('/api/recipes', { title: 'Second soup', ingredients: ['1 leek'], steps: ['Boil.'], collections: ['Soups'] })).json;
  const m = (await A.post('/api/meals', { date: '2026-11-05', slot: 'dinner', recipeId: aliceRecipe.id, servings: 4 })).json;
  assert.equal((await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'bob', kind: 'meal', ref: m.id })).json.error, '');
  const theirs = (await B.get('/api/meals?from=2026-11-01&to=2026-11-30')).json;
  assert.equal(theirs.length, 1); assert.equal(theirs[0].mine, false); assert.ok(theirs[0].recipe, 'its recipe came along');
  assert.match(theirs[0].ownerName, /Chris/);
  await A.put('/api/meals/' + m.id, { date: '2026-11-06' });
  await until(async () => (await B.get('/api/meals?from=2026-11-01&to=2026-11-30')).json[0]?.date === '2026-11-06');

  const col = (await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'bob', kind: 'collection', ref: 'Soups' })).json;
  assert.equal(col.error, '');
  const titles = async () => (await B.get('/api/recipes')).json.map((r) => r.title);
  assert.ok((await titles()).includes('Second soup'));
  // taking one out of the collection removes it for Bob
  await A.put('/api/recipes/' + r2.id, { collections: [] });
  await until(async () => !(await titles()).includes('Second soup'));
  assert.ok((await titles()).includes('Shared soup v2'), 'the other one stays');
});

test('removing a copy stops it coming back, and stopping a share removes it on the other side', async () => {
  const bobsCopy = (await B.get('/api/recipes')).json.find((r) => r.title === 'Shared soup v2');
  assert.equal((await B.del('/api/recipes/' + bobsCopy.id)).status, 200);
  await until(async () => (await A.get('/api/remote-shares?kind=recipe')).json.some((s) => s.declined));
  await A.put('/api/recipes/' + aliceRecipe.id, { title: 'Changed again' });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!(await B.get('/api/recipes')).json.some((r) => /soup/i.test(r.title) && r.title.includes('Changed')), 'did not come back');
  const col = (await A.get('/api/remote-shares?kind=collection')).json[0];
  assert.equal((await A.del('/api/remote-shares/' + col.id)).status, 200);
  assert.equal((await B.get('/api/recipes')).json.filter((r) => r.remote).length, 0);
  const mealShare = (await A.get('/api/remote-shares?kind=meal')).json[0];
  await A.del('/api/remote-shares/' + mealShare.id);
  assert.equal((await B.get('/api/meals?from=2026-11-01&to=2026-11-30')).json.length, 0);
});

test('sharing something that is not yours, or with no link, is refused; unlinking cleans up', async () => {
  assert.equal((await B.post('/api/remote-shares', { peerId: peerOnB, toUser: 'chris', kind: 'recipe', ref: aliceRecipe.id })).status, 403);
  assert.equal((await A.post('/api/remote-shares', { peerId: 'nope', toUser: 'bob', kind: 'recipe', ref: aliceRecipe.id })).status, 400);
  const lst = (await B.get('/api/lists')).json.filter((l) => l.name === 'Party');
  assert.equal(lst.length, 1);
  assert.equal((await B.del('/api/admin/peers/' + peerOnB)).status, 200);
  assert.equal((await B.get('/api/lists')).json.filter((l) => l.name === 'Party').length, 0, 'mirrors from an unlinked Simmer are removed');
});
