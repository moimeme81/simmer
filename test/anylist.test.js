'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'simmer-al-'));
const anylist = require('../src/anylist');
const app = require('../src/server');

const fake = {
  login: async () => {},
  teardown: () => {},
  getRecipes: async () => [
    { identifier: 'r1', name: 'Soupe', ingredients: [{ toJSON: () => ({ rawIngredient: '2 carottes' }) }, { toJSON: () => ({ quantity: '1 L', name: 'eau', note: 'froide' }) }], preparationSteps: ['Couper', 'Cuire'], prepTime: 600, cookTime: 1800, servings: '4', photoUrls: [] },
    { identifier: 'r2', name: 'Vide', ingredients: [], preparationSteps: [], photoUrls: [] },
  ],
  getLists: async () => [{ identifier: 'l1', name: 'Epicerie', items: [{ name: 'Lait', quantity: '2', checked: false }] }],
};

test('web AnyList import: success, idempotent, bad login', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }); const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]; return r; };
  const get = (p) => fetch(base + p, { headers: { cookie } });
  const waitDone = async () => { for (let i = 0; i < 50; i++) { const s = await (await get('/api/import/anylist/status')).json(); if (s.state !== 'running') return s; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  try {
    assert.equal((await post('/api/import/anylist', { email: 'a@b.c', password: 'pw' })).status, 401, 'login required');
    assert.equal((await post('/api/auth/setup', { name: 'T', username: 'tester', password: 'password123' })).status, 200);
    assert.equal((await post('/api/import/anylist', { email: '' })).status, 400);

    anylist.setClientFactory(() => fake);
    assert.equal((await post('/api/import/anylist', { email: 'a@b.c', password: 'pw' })).status, 202);
    let s = await waitDone();
    assert.equal(s.state, 'done');
    assert.equal(s.done, 1); assert.equal(s.skipped, 1); assert.equal(s.lists, 1);

    await post('/api/import/anylist', { email: 'a@b.c', password: 'pw' }); await waitDone();   // run again
    const recipes = await (await get('/api/recipes')).json();
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].cookMinutes, 30);
    assert.deepEqual(recipes[0].ingredients, ['2 carottes', '1 L eau (froide)']);

    anylist.setClientFactory(() => ({ ...fake, login: async () => { throw new Error('HTTPError: 401 Unauthorized secret-pw'); } }));
    await post('/api/import/anylist', { email: 'a@b.c', password: 'secret-pw' });
    s = await waitDone();
    assert.equal(s.state, 'error');
    assert.ok(!JSON.stringify(s).includes('secret-pw'));
  } finally { server.close(); }
});
