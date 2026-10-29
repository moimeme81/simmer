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

let A, B, peerOnA, peerOnB, aliceRecipe, marieId;
test.before(async () => {
  const [a, b] = [await start('A'), await start('B')];
  A = client(a); B = client(b);
  await A.post('/api/auth/setup', { name: 'Chris', username: 'chris', password: 'correct horse' });
  await B.post('/api/auth/setup', { name: 'Bob', username: 'bob', password: 'staple battery' });
});
test.after(() => procs.forEach((p) => p.kill()));

test('each Simmer has its own key; linking needs both admins to enter the other\'s key', async () => {
  const keyA = (await A.get('/api/admin/federation')).json.key, keyB = (await B.get('/api/admin/federation')).json.key;
  assert.ok(keyA.length >= 64 && keyB.length >= 64 && keyA !== keyB);
  assert.equal((await A.get('/api/admin/federation')).json.key, keyA, 'the key is stable');
  // A asks to link with a wrong key: refused, nothing waits on either side
  const wrong = await A.post('/api/admin/peers', { url: B.base, key: 'x'.repeat(64) });
  assert.equal(wrong.status, 502); assert.match(wrong.json.error, /did not accept the key/);
  assert.equal((await B.get('/api/admin/federation')).json.pending.length, 0);
  assert.equal((await A.post('/api/admin/peers', { url: 'not a url', key: keyB })).status, 400);
  assert.equal((await A.post('/api/admin/peers', { url: B.base, key: 'short' })).status, 400);
  // A enters B's key: B is told, A waits
  const started = (await A.post('/api/admin/peers', { url: B.base, key: keyB })).json;
  assert.equal(started.peers[0].state, 'waiting'); peerOnA = started.peers[0].id;
  assert.equal(started.peers[0].name, 'Bob’s Simmer', 'A learned B’s name from B');
  const onB = (await B.get('/api/admin/federation')).json;
  assert.equal(onB.pending.length, 1); assert.equal(onB.pending[0].name, 'Chris’s Simmer');
  assert.equal((await B.get('/api/me')).json.pendingLinks, 1, 'B’s admin is notified');
  assert.equal((await A.post(`/api/admin/peers/${peerOnA}/test`)).json.ok, false, 'not linked until B answers');
  assert.equal((await A.get('/api/people')).json.some((p) => p.remote), false);
  // B enters A's key: a wrong one is refused and the request stays
  const bad = await B.post(`/api/admin/pending/${onB.pending[0].id}/accept`, { key: 'y'.repeat(64) });
  assert.equal(bad.status, 502); assert.match(bad.json.error, /did not accept that key/);
  assert.equal((await B.get('/api/admin/federation')).json.pending.length, 1);
  const done = await B.post(`/api/admin/pending/${onB.pending[0].id}/accept`, { key: keyA });
  assert.equal(done.status, 200);
  assert.equal(done.json.peers[0].state, 'active'); peerOnB = done.json.peers[0].id;
  assert.equal(done.json.pending.length, 0);
  assert.equal((await A.get('/api/admin/federation')).json.peers[0].state, 'active', 'A is active too');
  assert.equal((await A.post(`/api/admin/peers/${peerOnA}/test`)).json.ok, true);
  assert.equal((await B.post(`/api/admin/peers/${peerOnB}/test`)).json.ok, true);
  assert.equal((await A.get('/api/me')).json.linkedSimmers, 1);
  // the server key alone no longer works for the day-to-day calls, and neither does nothing
  assert.equal((await fetch(B.base + '/api/federation/people', { headers: { authorization: 'Bearer ' + keyB } })).status, 401);
  assert.equal((await fetch(B.base + '/api/federation/people')).status, 401);
  assert.equal((await A.post('/api/admin/peers', { url: B.base, key: keyB })).status, 400, 'already linked');
});

test('people on the other Simmer show up in every people list, and only admins manage links', async () => {
  const people = (await A.get('/api/people')).json;
  const bob = people.find((p) => p.remote && p.name === 'Bob');
  assert.ok(bob, 'Chris sees Bob'); assert.equal(bob.server, 'Bob’s Simmer'); assert.match(bob.id, /^r:/);
  marieId = bob.id;
  assert.ok((await B.get('/api/people')).json.some((p) => p.remote && p.name === 'Chris'));
  const inv = (await B.post('/api/admin/invites')).json.code;
  const eve = client(B.base);
  assert.equal((await eve.post('/api/auth/register', { invite: inv, name: 'Eve', username: 'eve', password: 'longpassword' })).status, 200);
  assert.equal((await eve.get('/api/admin/federation')).status, 403);
  assert.equal((await eve.post('/api/admin/peers', { url: A.base, key: 'z'.repeat(64) })).status, 403);
  assert.equal((await eve.get('/api/peers')).json.length, 1);
  assert.equal((await eve.get('/api/peers')).json[0].url, undefined, 'members see names only');
});

test('a recipe shared with someone on another Simmer shows up there, read-only, and follows changes', async () => {
  aliceRecipe = (await A.post('/api/recipes', { title: 'Shared soup', ingredients: ['1 onion'], steps: ['Simmer.'], collections: ['Soups'] })).json;
  const ghost = await A.post('/api/remote-shares', { peerId: peerOnA, toUser: 'nobody', kind: 'recipe', ref: aliceRecipe.id });
  assert.equal(ghost.status, 200, 'the share is created');
  assert.match(ghost.json.error, /no one called/i, 'but says why it did not arrive');
  await A.del('/api/remote-shares/' + ghost.json.id);
  // the ordinary Share dialog covers people on the other Simmer: they are just more people
  const viaShare = (await A.put('/api/recipes/' + aliceRecipe.id + '/share', { users: [marieId], households: [] })).json;
  assert.deepEqual(viaShare.sharedWith.users, [marieId]);
  assert.equal((await A.get('/api/recipes/' + aliceRecipe.id)).json.sharedWith.users[0], marieId);
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
  // un-ticking them in the Share dialog stops it
  await A.put('/api/recipes/' + aliceRecipe.id + '/share', { users: [], households: [] });
  assert.ok(!(await B.get('/api/recipes')).json.some((r) => r.remote), 'gone from Bob');
  await A.put('/api/recipes/' + aliceRecipe.id + '/share', { users: [marieId], households: [] });
  await until(async () => (await B.get('/api/recipes')).json.some((r) => r.remote));
});

test('a shared shopping list is live in both directions', async () => {
  const l = (await A.post('/api/lists', { name: 'Party' })).json;
  await A.post(`/api/lists/${l.id}/items`, { name: 'Chips' });
  const sh = (await A.put(`/api/lists/${l.id}/share`, { users: [marieId], households: [] })).json;
  assert.deepEqual(sh.sharedWith.users, [marieId]);
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
  await A.put('/api/meals/' + m.id, { users: [marieId] });
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
  assert.equal((await A.get('/api/me')).json.linkedSimmers, 0, 'the other side was told');
  assert.equal((await A.get('/api/people')).json.some((p) => p.remote), false);
  assert.equal((await A.get('/api/lists')).json.length >= 1, true);
});

test('a link request can be declined, and a waiting request can be cancelled', async () => {
  const keyB = (await B.get('/api/admin/federation')).json.key;
  await A.post('/api/admin/peers', { url: B.base, key: keyB });
  const pend = (await B.get('/api/admin/federation')).json.pending[0];
  assert.equal((await B.del('/api/admin/pending/' + pend.id)).json.pending.length, 0);
  const waiting = (await A.get('/api/admin/federation')).json.peers[0];
  assert.equal(waiting.state, 'waiting');
  assert.equal((await A.del('/api/admin/peers/' + waiting.id)).json.peers.length, 0);
  // a new key invalidates old requests' handshake but not existing links
  const old = (await A.get('/api/admin/federation')).json.key;
  assert.notEqual((await A.post('/api/admin/federation/new-key')).json.key, old);
  assert.equal((await B.post('/api/admin/peers', { url: A.base, key: old })).status, 502, 'the old key no longer works');
});
