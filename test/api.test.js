'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simmer-'));
process.env.DATA_DIR = dir;
process.env.ALLOW_PRIVATE_URLS = 'true'; // the photo finder test talks to a local fake recipe site
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
  return { fetchRaw: (u) => fetch(base + u, { headers: { cookie } }), call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u) => call('DELETE', u) };
};
const chris = person(), mom = person(), sis = person(), anon = person();
const sisFetch = (u) => sis.fetchRaw(u);
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
  assert.deepEqual(l.aisleOrder.slice(0, 2), ['produce', 'meat']); assert.equal(l.categories.length, 19);
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

/* ---------- later additions ---------- */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString('base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

test('who a shared meal is with: every guest sees everyone invited, by name', async () => {
  const sisId = (await sis.get('/api/me')).json.id, momId = (await mom.get('/api/me')).json.id;
  const m = (await chris.post('/api/meals', { date: '2026-11-04', slot: 'dinner', title: 'Raclette', users: [sisId, momId] })).json;
  assert.deepEqual(m.attendees.map((a) => a.name), ['Chris', 'Sis', 'Maman'.replace('Maman', 'Mom')]);
  const seen = (await sis.get('/api/meals?from=2026-11-04&to=2026-11-04')).json[0];
  assert.deepEqual(seen.attendees.map((a) => [a.name, a.you]), [['Chris', false], ['Sis', true], ['Mom', false]]);
});

test('profile photos: upload, serve to signed-in people only, remove', async () => {
  assert.equal((await chris.put('/api/me/avatar', { image: 'bm90IGFuIGltYWdl' })).status, 400);
  const up = await chris.put('/api/me/avatar', { image: PNG });
  assert.equal(up.status, 200);
  assert.match(up.json.avatar, /^\/avatars\/[\w-]{36}\?v=\d+$/);
  assert.equal((await sis.get('/api/people')).json.find((p) => p.name === 'Chris').avatar, up.json.avatar);
  const bytes = await fetch(base + up.json.avatar.split('?')[0], { headers: { cookie: (await sis.call('GET', '/api/me')) && '' } });
  assert.equal(bytes.status, 401, 'not signed in');
  // sis is signed in through her own cookie jar: use the client to fetch the file
  const withCookie = await sisFetch(up.json.avatar);
  assert.equal(withCookie.status, 200);
  assert.equal(withCookie.headers.get('content-type'), 'image/png');
  await chris.del('/api/me/avatar');
  assert.equal((await sis.get('/api/people')).json.find((p) => p.name === 'Chris').avatar, null);
});

test('lists carry an icon and a colour, and ignore a bad colour', async () => {
  const l = (await chris.post('/api/lists', { name: 'Costco', icon: '🛒', color: '#2F7D6B' })).json;
  assert.equal(l.icon, '🛒'); assert.equal(l.color, '#2F7D6B');
  const bad = (await chris.put(`/api/lists/${l.id}/settings`, { color: 'red; background:url(x)' })).json;
  assert.equal(bad.color, '');
});

test('photo finder: fills in missing pictures from the source page and retries failures later', async () => {
  const http = require('node:http');
  const site = http.createServer((req, res) => {
    if (req.url === '/og') return res.end('<html><head><meta property="og:image" content="/pic.jpg"></head></html>');
    if (req.url === '/ld') return res.end('<script type="application/ld+json">{"@type":"Recipe","name":"X","image":["/pic.jpg"],"recipeIngredient":["a"],"recipeInstructions":"b"}</script>');
    if (req.url === '/nopic') return res.end('<html><body>no picture here</body></html>');
    if (req.url === '/pic.jpg') { res.setHeader('content-type', 'image/jpeg'); return res.end(JPG); }
    res.statusCode = 404; res.end('gone');
  });
  await new Promise((r) => site.listen(0, r));
  const root = `http://127.0.0.1:${site.address().port}`;
  const add = async (title, path) => (await chris.post('/api/import/bulk/recipe', { title, ingredients: ['x'], steps: ['y'], sourceUrl: root + path })).json.id;
  const [og, ld, nopic, gone] = [await add('OG', '/og'), await add('LD', '/ld'), await add('NoPic', '/nopic'), await add('Gone', '/gone')];
  require('../src/server').photos.delayMs = 0;
  try {
    assert.equal((await chris.get('/api/photos/status')).json.missing, 4);
    assert.equal((await chris.post('/api/photos/check')).status, 202);
    for (let i = 0; i < 50 && (await chris.get('/api/photos/status')).json.running; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    const get = async (id) => (await chris.get('/api/recipes/' + id)).json;
    assert.match((await get(og)).image, /^\/images\//);
    assert.match((await get(ld)).image, /^\/images\//);
    const np = await get(nopic);
    assert.equal(np.image, null);
    assert.equal(np.imageCheck.tries, 1);
    assert.ok(np.imageCheck.next > Date.now(), 'a failed recipe waits before it is tried again');
    assert.equal((await chris.get('/api/photos/status')).json.missing, 2);
    // The manual button explains why it failed.
    const r = await chris.post(`/api/recipes/${gone}/find-photo`);
    assert.equal(r.status, 422);
    assert.match(r.json.error, /HTTP 404/);
    // Images are private to signed-in people.
    assert.equal((await fetch(base + (await get(og)).image)).status, 401);
  } finally { site.close(); }
});

test('recipe collections: set by the owner, cleaned, ignored from guests', async () => {
  const rid = (await chris.post('/api/import/bulk/recipe', { title: 'Tarte', ingredients: ['a'], steps: ['b'], collections: [' Desserts ', 'Desserts', '', 'Fête'] })).json.id;
  assert.deepEqual((await chris.get('/api/recipes/' + rid)).json.collections, ['Desserts', 'Fête']);
  const put = await chris.put('/api/recipes/' + rid, { collections: ['Dinner', 'x'.repeat(100)] });
  assert.deepEqual(put.json.collections, ['Dinner', 'x'.repeat(40)]);
  const sisId = (await sis.get('/api/me')).json.id;
  await chris.put(`/api/recipes/${rid}/share`, { users: [sisId], households: [] });
  const g = await sis.put('/api/recipes/' + rid, { collections: ['Mine'] });
  assert.deepEqual(g.json.collections, ['Dinner', 'x'.repeat(40)], 'guests cannot recategorise');
});

test('each list has its own categories; changing one never touches another', async () => {
  const groc = (await chris.get('/api/lists')).json.find((l) => l.auto);
  const hw = (await chris.post('/api/lists', { name: 'Hardware store', template: 'hardware', lang: 'fr' })).json;
  assert.equal(hw.auto, false);
  assert.deepEqual(hw.categories.slice(0, 2).map((c) => c.name), ['Outils', 'Bois']);
  // Nothing is recognised as a grocery aisle on a custom list.
  let l = (await chris.post(`/api/lists/${hw.id}/items`, { name: 'Broccoli' })).json;
  assert.equal(l.items[0].aisle, '');
  const tools = hw.categories[0].id;
  const patch = (id, b) => chris.call('PATCH', `/api/lists/${hw.id}/items/${id}`, b);
  await patch(l.items[0].id, { aisle: tools });
  assert.equal((await patch(l.items[0].id, { aisle: 'produce' })).json.aisle, tools, 'a category this list does not have is refused');
  // The list remembers where "broccoli" goes, but only itself.
  await patch(l.items[0].id, { checked: true });
  await chris.post(`/api/lists/${hw.id}/clear-checked`);
  l = (await chris.post(`/api/lists/${hw.id}/items`, { name: 'Broccoli' })).json;
  assert.equal(l.items.at(-1).aisle, tools, 'memory is per list');
  // Rename, add and delete categories.
  const cats = [...l.categories.map((c) => (c.id === tools ? { ...c, name: 'Power tools' } : c)).filter((c) => c.name !== 'Bois'), { name: 'Cabinets', color: '#2F7D6B' }];
  l = (await chris.put(`/api/lists/${hw.id}/settings`, { categories: cats })).json;
  assert.ok(l.categories.some((c) => c.name === 'Power tools') && l.categories.at(-1).name === 'Cabinets' && !l.categories.some((c) => c.name === 'Bois'));
  const after = (await chris.get('/api/lists')).json.find((x) => x.id === groc.id);
  assert.deepEqual(after.categories.map((c) => c.id), groc.categories.map((c) => c.id), 'grocery list untouched');
  // Deleting a category un-files its items instead of losing them.
  l = (await chris.put(`/api/lists/${hw.id}/settings`, { categories: l.categories.filter((c) => c.id !== tools) })).json;
  assert.ok(l.items.length && l.items.every((i) => i.aisle === ''));
  // Blank and to-do templates.
  assert.equal((await chris.post('/api/lists', { name: 'Blank', template: 'blank' })).json.categories.length, 0);
  assert.deepEqual((await chris.post('/api/lists', { name: 'Todo', template: 'todo' })).json.categories.map((c) => c.name), ['Today', 'This week', 'Later']);
});

test('recipe collections can be ordered, renamed (merging) and deleted', async () => {
  const mk = async (title, cols) => (await chris.post('/api/import/bulk/recipe', { title, ingredients: ['a'], steps: ['b'], collections: cols })).json.id;
  const a = await mk('R1', ['Souper']), b = await mk('R2', ['Soupers', 'Rapide']);
  await chris.put('/api/collections', { names: ['Rapide', 'Soupers', 'Vide'] });
  assert.deepEqual((await chris.get('/api/me')).json.collections, ['Rapide', 'Soupers', 'Vide']);
  const r = await chris.post('/api/collections/rename', { from: 'Souper', to: 'Soupers' });
  assert.deepEqual((await chris.get('/api/recipes/' + a)).json.collections, ['Soupers']);
  assert.deepEqual((await chris.get('/api/recipes/' + b)).json.collections, ['Soupers', 'Rapide']);
  await chris.post('/api/collections/delete', { name: 'Soupers' });
  assert.deepEqual((await chris.get('/api/recipes/' + b)).json.collections, ['Rapide']);
  assert.deepEqual((await chris.get('/api/me')).json.collections, ['Rapide', 'Vide']);
  assert.equal(r.status, 200);
});

test('recipes can be created by hand, edited, and their picture replaced', async () => {
  const made = (await chris.post('/api/recipes', { title: 'Mamie’s tarte', ingredients: ['2 tasses farine', ' ', '1 oeuf'], steps: ['Mélanger', 'Cuire 30 minutes'], yield: '8 portions', prepMinutes: '15', cookMinutes: 30 })).json;
  assert.equal(made.ingredients.length, 2); assert.equal(made.prepMinutes, 15); assert.equal(made.method, 'manual');
  assert.equal((await chris.post('/api/recipes', { title: '  ' })).status, 400);
  const edited = (await chris.put('/api/recipes/' + made.id, { title: 'Tarte', ingredients: ['3 tasses farine'], sourceUrl: 'https://example.com/x', prepMinutes: '', description: 'Bonne' })).json;
  assert.deepEqual([edited.title, edited.ingredients, edited.prepMinutes, edited.host, edited.description], ['Tarte', ['3 tasses farine'], null, 'example.com', 'Bonne']);
  assert.equal((await chris.put('/api/recipes/' + made.id, { sourceUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await chris.put('/api/recipes/' + made.id, { title: '' })).status, 400);
  const a = (await chris.put(`/api/recipes/${made.id}/image`, { image: PNG })).json;
  assert.match(a.image, /^\/images\/[\w-]+\.png\?v=\d+$/);
  assert.equal((await chris.put(`/api/recipes/${made.id}/image`, { image: 'bm90IGFuIGltYWdl' })).status, 400);
  assert.equal((await chris.del(`/api/recipes/${made.id}/image`)).json.image, null);
  // Guests can add notes but not edit.
  const sisId = (await sis.get('/api/me')).json.id;
  await chris.put(`/api/recipes/${made.id}/share`, { users: [sisId], households: [] });
  const g = (await sis.put('/api/recipes/' + made.id, { title: 'Hacked', notes: 'ok' })).json;
  assert.deepEqual([g.title, g.notes], ['Tarte', 'ok']);
  assert.equal((await sis.put(`/api/recipes/${made.id}/image`, { image: PNG })).status, 403);
});

test('web photo search: results from an Openverse-style server, and picking one downloads it', async () => {
  const http = require('node:http');
  let port;
  const fake = http.createServer((req, res) => {
    if (req.url.startsWith('/search')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ results: [{ thumbnail: `http://127.0.0.1:${port}/pic.jpg`, url: `http://127.0.0.1:${port}/pic.jpg`, title: 'Soup', creator: 'Ann', license: 'by', license_version: '2.0', foreign_landing_url: 'http://x/y' }] })); }
    if (req.url === '/pic.jpg') { res.setHeader('content-type', 'image/jpeg'); return res.end(JPG); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => fake.listen(0, r)); port = fake.address().port;
  process.env.IMAGE_SEARCH_URL = `http://127.0.0.1:${port}/search`;
  try {
    const rid = (await chris.post('/api/recipes', { title: 'Soupe', ingredients: ['a'], steps: ['b'] })).json.id;
    const found = (await chris.get('/api/image-search?q=soup')).json.results;
    assert.equal(found.length, 1); assert.match(found[0].credit, /Ann · CC BY 2\.0/);
    await new Promise((r) => setTimeout(r, 450));
    const done = await chris.post(`/api/recipes/${rid}/image-from-url`, { url: found[0].url, credit: found[0].credit });
    assert.equal(done.status, 200); assert.match(done.json.image, /^\/images\//); assert.match(done.json.imageCredit, /Ann/);
    assert.equal((await chris.post(`/api/recipes/${rid}/image-from-url`, { url: 'file:///etc/passwd' })).status, 400);
    assert.equal((await chris.post(`/api/recipes/${rid}/image-from-url`, { url: `http://127.0.0.1:${port}/nope` })).status, 422);
    assert.equal((await sis.post(`/api/recipes/${rid}/image-from-url`, { url: found[0].url })).status, 404, 'not visible to others');
    assert.equal((await fetch(base + '/api/image-search?q=x')).status, 401);
    // Replacing the picture by upload drops the old credit.
    assert.equal((await chris.put(`/api/recipes/${rid}/image`, { image: PNG })).json.imageCredit, undefined);
  } finally { delete process.env.IMAGE_SEARCH_URL; fake.close(); }
});

test('measurement settings are saved per user, one kind at a time, and bad values are ignored', async () => {
  const me = (await chris.get('/api/me')).json;
  assert.deepEqual(me.units, { mass: 'orig', vol: 'orig', len: 'orig', temp: 'orig' });
  let r = (await chris.put('/api/me', { units: { mass: 'metric', temp: 'imperial' } })).json;
  assert.deepEqual(r.units, { mass: 'metric', vol: 'orig', len: 'orig', temp: 'imperial' });
  r = (await chris.put('/api/me', { units: { vol: 'both', mass: 'nonsense' } })).json;
  assert.deepEqual(r.units, { mass: 'orig', vol: 'both', len: 'orig', temp: 'imperial' });
});

test('the page revalidates and script URLs are fingerprinted so caches cannot serve an old version', async () => {
  const page = await fetch(base + '/');
  assert.match(page.headers.get('cache-control'), /no-cache/);
  const html = await page.text();
  assert.match(html, /<script src="app\.js\?v=[0-9a-f]{10}"><\/script>/);
  assert.match(html, /href="app\.css\?v=[0-9a-f]{10}"/);
  const js = await fetch(base + '/app.js?v=anything');
  assert.equal(js.status, 200); assert.match(js.headers.get('cache-control'), /no-cache/);
});
