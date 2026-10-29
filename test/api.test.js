'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simmer-'));
process.env.DATA_DIR = dir;
const app = require('../src/server');
let base, server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

// A tiny client that keeps a cookie jar per person.
const person = () => {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  return { call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u) => call('DELETE', u) };
};
const chris = person(), mom = person(), sis = person(), anon = person();
let invite, hh, recipeId, listId, mealId;

test('everything is locked until setup, then the first user becomes admin', async () => {
  assert.equal((await anon.get('/api/recipes')).status, 401);
  assert.equal((await anon.get('/api/auth/state')).json.setup, true);
  assert.equal((await chris.post('/api/auth/setup', { name: 'Chris', username: 'chris', password: 'short' })).status, 400);
  const r = await chris.post('/api/auth/setup', { name: 'Chris', username: 'chris', password: 'correct horse' });
  assert.equal(r.status, 200);
  assert.equal(r.json.admin, true);
  assert.equal((await anon.post('/api/auth/setup', { name: 'X', username: 'xxx', password: 'password1' })).status, 403);
});

test('login works and a wrong password is refused', async () => {
  assert.equal((await anon.post('/api/auth/login', { username: 'chris', password: 'nope nope' })).status, 401);
  assert.equal((await anon.post('/api/auth/login', { username: 'CHRIS', password: 'correct horse' })).status, 200);
  assert.equal((await anon.get('/api/me')).json.username, 'chris');
});

test('only admins can invite; an invite creates an account once', async () => {
  const fresh = person();
  assert.equal((await fresh.post('/api/admin/invites')).status, 401);
  hh = (await chris.post('/api/households', { name: 'Home' })).json;
  invite = (await chris.post('/api/admin/invites', { householdId: hh.id })).json.code;
  assert.ok(invite.startsWith('inv_'));
  assert.equal((await mom.post('/api/auth/register', { invite: 'inv_bad', name: 'Mom', username: 'mom', password: 'longpassword' })).status, 400);
  const r = await mom.post('/api/auth/register', { invite, name: 'Mom', username: 'mom', password: 'longpassword' });
  assert.equal(r.status, 200);
  assert.equal(r.json.admin, false);
  assert.equal((await sis.post('/api/auth/register', { invite, name: 'Sis', username: 'sis', password: 'longpassword' })).status, 400, 'invite is single use');
  assert.equal((await mom.get('/api/households')).json[0].members.length, 2, 'invite put Mom in the household');
  const sisInvite = (await chris.post('/api/admin/invites')).json.code;
  assert.equal((await sis.post('/api/auth/register', { invite: sisInvite, name: 'Sis', username: 'sis', password: 'longpassword' })).status, 200);
});

test('a recipe is private until shared, and guests cannot delete it', async () => {
  const bulk = await chris.post('/api/import/bulk/recipe', { title: 'Pâtes Alfredo', yield: '4 portions', ingredients: ['350 g (¾ lb) de pâtes', '1 tasse d’eau', '3 gousses d’ail'], steps: ['Cuire 10 minutes.'] });
  recipeId = bulk.json.id;
  assert.equal((await mom.get('/api/recipes/' + recipeId)).status, 404);
  assert.equal((await mom.get('/api/recipes')).json.length, 0);
  const sh = await chris.put(`/api/recipes/${recipeId}/share`, { households: [hh.id], users: [] });
  assert.equal(sh.status, 200);
  assert.equal((await mom.get('/api/recipes/' + recipeId)).status, 200);
  assert.equal((await sis.get('/api/recipes/' + recipeId)).status, 404, 'sister is not in the household');
  assert.equal((await mom.del('/api/recipes/' + recipeId)).status, 403);
  assert.equal((await mom.put(`/api/recipes/${recipeId}/share`, { users: [] })).status, 403);
  // Guests may add notes but not rewrite the recipe.
  const put = await mom.put('/api/recipes/' + recipeId, { notes: 'Less salt', title: 'Hacked' });
  assert.equal(put.json.notes, 'Less salt');
  assert.equal(put.json.title, 'Pâtes Alfredo');
});

test('sharing ignores households the sharer is not in', async () => {
  const other = (await sis.post('/api/households', { name: 'Sis only' })).json;
  const r = await chris.put(`/api/recipes/${recipeId}/share`, { households: [hh.id, other.id], users: [] });
  assert.deepEqual(r.json.sharedWith.households, [hh.id]);
});

test('adding recipe ingredients recognizes items, skips water, and merges duplicates', async () => {
  const lists = (await chris.get('/api/lists')).json;
  listId = lists[0].id;
  const r = await chris.post(`/api/recipes/${recipeId}/to-list`, { listId, ingredients: ['350 g (¾ lb) de pâtes', '1 tasse d’eau', '3 gousses d’ail', '2 gousses d’ail'] });
  const items = r.json.items;
  assert.equal(items.length, 2, 'water skipped, garlic merged');
  const garlic = items.find((i) => i.key === 'garlic');
  assert.equal(garlic.quantity, '5 gousses');
  assert.equal(garlic.aisle, 'produce');
  assert.equal(items.find((i) => i.key === 'pasta').aisle, 'grains');
  const typed = await chris.post(`/api/lists/${listId}/items`, { name: 'brocoli' });
  assert.equal(typed.json.items.find((i) => i.name === 'Brocoli').aisle, 'produce');
});

test('stores: an item remembers its store and aisle rules apply to new items', async () => {
  let l = (await chris.put(`/api/lists/${listId}/settings`, { stores: [{ id: 'butcher', name: 'Butcher' }, { id: 'super', name: 'Supermarket' }] })).json;
  assert.equal(l.stores.length, 2);
  l = (await chris.put(`/api/lists/${listId}/settings`, { aisleStores: { meat: 'butcher' }, aisleOrder: ['produce', 'meat'] })).json;
  assert.deepEqual(l.aisleOrder, ['produce', 'meat']);
  const added = (await chris.post(`/api/lists/${listId}/items`, { name: '500 g poulet haché' })).json;
  assert.equal(added.items.find((i) => i.key === 'ground chicken').store, 'butcher');
  const broc = added.items.find((i) => i.key === 'broccoli');
  await chris.call('PATCH', `/api/lists/${listId}/items/${broc.id}`, { store: 'super' });
  await chris.del(`/api/lists/${listId}/items/${broc.id}`);
  const again = (await chris.post(`/api/lists/${listId}/items`, { name: 'Brocoli' })).json;
  assert.equal(again.items.find((i) => i.key === 'broccoli').store, 'super', 'remembered by item');
});

test('a list is private until shared with a user', async () => {
  assert.equal((await sis.post(`/api/lists/${listId}/items`, { name: 'x' })).status, 404);
  await chris.put(`/api/lists/${listId}/share`, { users: [(await sis.get('/api/me')).json.id] });
  assert.equal((await sis.post(`/api/lists/${listId}/items`, { name: 'Lait' })).status, 200);
  assert.ok((await chris.get('/api/lists')).json.find((l) => l.id === listId).items.some((i) => i.key === 'milk'), 'Chris sees what Sis added');
});

test('a meal shared with one person appears in both plans, and brings the recipe along', async () => {
  const sisId = (await sis.get('/api/me')).json.id;
  // Make a recipe only Chris owns.
  const secret = (await chris.post('/api/import/bulk/recipe', { title: 'Secret stew', yield: '4', ingredients: ['2 carottes'], steps: ['Cook.'] })).json.id;
  assert.equal((await sis.get('/api/recipes/' + secret)).status, 404);
  const m = await chris.post('/api/meals', { date: '2026-11-02', slot: 'dinner', recipeId: secret, servings: 8, users: [sisId] });
  assert.equal(m.status, 200);
  mealId = m.json.id;
  const sisPlan = (await sis.get('/api/meals?from=2026-11-01&to=2026-11-07')).json;
  assert.equal(sisPlan.length, 1);
  assert.equal(sisPlan[0].title, 'Secret stew');
  assert.equal(sisPlan[0].recipe.id, secret);
  assert.equal((await sis.get('/api/recipes/' + secret)).status, 200, 'sharing the meal shares the recipe');
  assert.equal((await mom.get('/api/meals')).json.length, 0, 'Mom was not invited');
  // Free-text meal that is private.
  await chris.post('/api/meals', { date: '2026-11-03', slot: 'lunch', title: 'Leftovers' });
  assert.equal((await sis.get('/api/meals')).json.length, 1);
  assert.equal((await chris.get('/api/meals')).json.length, 2);
  // A guest cannot edit, but can take it off her own plan without deleting it for Chris.
  assert.equal((await sis.put('/api/meals/' + mealId, { slot: 'lunch' })).status, 403);
  await sis.del('/api/meals/' + mealId);
  assert.equal((await sis.get('/api/meals')).json.length, 0);
  assert.equal((await chris.get('/api/meals')).json.length, 2);
});

test('the week goes to the list, scaled to the planned servings', async () => {
  const r = await chris.post('/api/meals/to-list', { from: '2026-11-01', to: '2026-11-07', listId });
  assert.equal(r.json.added, 1);
  const carrot = r.json.list.items.find((i) => i.key === 'carrot');
  assert.ok(carrot, 'carrots were added');
  assert.match(carrot.quantity, /^4/, '2 carrots for 4 servings, 8 servings planned');
});

test('API tokens let scripts in without a cookie, and can be revoked', async () => {
  const { token } = (await chris.post('/api/tokens', { name: 'Home Assistant' })).json;
  const res = await fetch(base + '/api/ha/summary', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const sum = await res.json();
  assert.equal(sum.user.name, 'Chris');
  assert.ok(sum.lists.length >= 1);
  const id = (await chris.get('/api/tokens')).json[0].id;
  await chris.del('/api/tokens/' + id);
  assert.equal((await fetch(base + '/api/ha/summary', { headers: { authorization: `Bearer ${token}` } })).status, 401);
});

test('a request from another site with a login cookie is refused', async () => {
  const r = await chris.call('POST', '/api/lists', { name: 'evil' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('logging out ends the session', async () => {
  const bob = person();
  await bob.post('/api/auth/login', { username: 'mom', password: 'longpassword' });
  assert.equal((await bob.get('/api/me')).status, 200);
  await bob.post('/api/auth/logout');
  assert.equal((await bob.get('/api/me')).status, 401);
});

test('five wrong passwords lock the account for a minute', async () => {
  const x = person();
  for (let i = 0; i < 5; i++) await x.post('/api/auth/login', { username: 'sis', password: 'wrong wrong' });
  assert.equal((await x.post('/api/auth/login', { username: 'sis', password: 'longpassword' })).status, 429);
});
