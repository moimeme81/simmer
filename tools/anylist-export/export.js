#!/usr/bin/env node
'use strict';
/*
 * Copy your AnyList recipes (with photos) and shopping lists into Simmer.
 *
 *   ANYLIST_EMAIL=you@example.com ANYLIST_PASSWORD=... \
 *   node export.js --to http://unraid.local:3000 [--user U --pass P] [--backup anylist-backup.json] [--dry-run]
 *
 * Runs on your own computer: your AnyList password never reaches the Simmer server.
 * Safe to re-run: recipes/lists are matched by their AnyList id and updated, not duplicated.
 * Uses the unofficial `anylist` client (AnyList has no public API or export button).
 */
const fs = require('node:fs');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const email = process.env.ANYLIST_EMAIL;
const password = process.env.ANYLIST_PASSWORD;
const target = (arg('to') || '').toString().replace(/\/+$/, '');
const dry = !!arg('dry-run', false);
const backup = arg('backup');
const authUser = arg('user'), authPass = arg('pass');

if (!email || !password || (!target && !dry && !backup)) {
  console.error('Usage: ANYLIST_EMAIL=… ANYLIST_PASSWORD=… node export.js --to http://HOST:3000 [--user U --pass P] [--backup file.json] [--dry-run]');
  process.exit(1);
}

const headers = { 'content-type': 'application/json' };
if (authUser && authPass) headers.authorization = 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64');

async function post(path, body) {
  const r = await fetch(target + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status} ${j.error || ''}`);
  return j;
}

async function download(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length <= 12 * 1024 * 1024 ? buf : null;
  } catch { return null; }
}

const ingredientLine = (i) => {
  const j = i.toJSON ? i.toJSON() : i;
  if (j.rawIngredient) return String(j.rawIngredient).trim();
  return [j.quantity, j.name, j.note ? `(${j.note})` : ''].filter(Boolean).join(' ').trim();
};
// AnyList stores prep/cook time in seconds.
const toMinutes = (s) => (Number(s) > 0 ? Math.round(Number(s) / 60) : null);

(async () => {
  const AnyList = require('anylist');
  const any = new AnyList({ email, password });
  console.log('Logging in to AnyList…');
  await any.login(false);

  const recipes = await any.getRecipes();
  const lists = await any.getLists();
  console.log(`Found ${recipes.length} recipes and ${lists.length} shopping lists.`);

  const mapped = recipes.map((r) => ({
    externalId: `anylist:${r.identifier}`,
    importedFrom: 'anylist',
    title: r.name,
    ingredients: (r.ingredients || []).map(ingredientLine).filter(Boolean),
    steps: r.preparationSteps || [],
    notes: [r.note, r.nutritionalInfo ? `Nutrition: ${r.nutritionalInfo}` : ''].filter(Boolean).join('\n\n'),
    yield: r.servings || null,
    prepMinutes: toMinutes(r.prepTime),
    cookMinutes: toMinutes(r.cookTime),
    rating: r.rating || null,
    sourceName: r.sourceName || null,
    sourceUrl: r.sourceUrl || null,
    photoUrls: r.photoUrls || [],
  }));
  const mappedLists = lists.map((l) => ({
    externalId: `anylist:${l.identifier}`,
    name: l.name,
    items: (l.items || []).map((i) => ({ name: i.name, quantity: i.quantity || '', details: i.details || '', checked: !!i.checked })),
  }));

  if (backup) {
    fs.writeFileSync(backup, JSON.stringify({ exportedAt: new Date().toISOString(), recipes: mapped, lists: mappedLists }, null, 2));
    console.log(`Backup (without photos) written to ${backup}`);
  }
  if (dry || !target) { console.log(dry ? 'Dry run: nothing sent.' : 'No --to given: nothing sent.'); return; }

  let ok = 0, failed = 0, photos = 0;
  for (const [n, r] of mapped.entries()) {
    try {
      const { photoUrls, ...body } = r;
      const buf = photoUrls[0] ? await download(photoUrls[0]) : null;
      if (buf) body.photoBase64 = buf.toString('base64');
      const res = await post('/api/import/bulk/recipe', body);
      ok++; if (res.image) photos++;
      process.stdout.write(`\r  recipes ${n + 1}/${mapped.length}`);
    } catch (e) { failed++; console.error(`\n  ✗ "${r.title}": ${e.message}`); }
  }
  console.log(`\nRecipes: ${ok} imported (${photos} with photos), ${failed} failed.`);

  for (const l of mappedLists) {
    try { const res = await post('/api/import/bulk/list', l); console.log(`List "${l.name}": ${res.items} items`); }
    catch (e) { console.error(`✗ list "${l.name}": ${e.message}`); }
  }
  any.teardown?.();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
