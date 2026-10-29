'use strict';
const { assertPublic } = require('./extract');

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
let clientFactory = null; // tests inject a fake client here

function createClient(email, password) {
  if (clientFactory) return clientFactory(email, password);
  const AnyList = require('anylist');
  // No credentialsFile option on purpose: nothing about the account is written to disk.
  return new AnyList({ email, password });
}

const ingredientLine = (i) => {
  const j = i.toJSON ? i.toJSON() : i;
  if (j.rawIngredient) return String(j.rawIngredient).trim();
  return [j.quantity, j.name, j.note ? `(${j.note})` : ''].filter(Boolean).join(' ').trim();
};
// AnyList stores prep/cook time in seconds.
const toMinutes = (s) => (Number(s) > 0 ? Math.round(Number(s) / 60) : null);

/** AnyList keeps recipe collections ("Dinner", "Desserts"…) next to the recipes. Returns recipe id -> collection names. */
async function collectionsByRecipe(any) {
  const out = new Map();
  try {
    const cols = any.recipeCollections || (await any._getUserData(false))?.recipeDataResponse?.recipeCollections || [];
    for (const c of cols) for (const id of c.recipeIds || []) out.set(id, [...(out.get(id) || []), c.name].filter(Boolean));
  } catch { /* collections are a bonus: recipes still import without them */ }
  return out;
}

function mapRecipe(r) {
  return {
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
  };
}

/** Download a photo, following at most 3 redirects and refusing private addresses (recipes can be shared by other people). */
async function downloadPhoto(url, allowPrivate) {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(current, allowPrivate);
      const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }
      if (!res.ok) return null;
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_PHOTO_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
  } catch { /* a missing photo should never fail the recipe */ }
  return null;
}

/** One import job at a time; progress is polled by the web UI. Credentials live only in this closure. */
class AnyListImport {
  constructor({ upsertRecipe, importList, allowPrivate }) {
    this.upsertRecipe = upsertRecipe;
    this.importList = importList;
    this.allowPrivate = allowPrivate;
    this.state = { state: 'idle' };
  }
  status() { return { ...this.state, errors: [...(this.state.errors || [])] }; }
  set(patch) { this.state = { ...this.state, ...patch }; }

  start(email, password) {
    if (this.state.state === 'running') throw Object.assign(new Error('An import is already running'), { status: 409 });
    this.state = { state: 'running', phase: 'login', total: 0, done: 0, failed: 0, photos: 0, lists: 0, errors: [], startedAt: new Date().toISOString() };
    this.run(email, password).catch((e) => this.set({ state: 'error', error: e.message }));
  }

  friendly(e, password) {
    let msg = String(e?.message || e);
    if (password) msg = msg.split(password).join('***');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(msg)) return 'Simmer could not reach AnyList. Check the server\'s internet connection.';
    if (/401|403|unauthor|forbidden|invalid|incorrect/i.test(msg)) return 'AnyList rejected that email or password.';
    return msg.slice(0, 300);
  }

  async run(email, password) {
    let any;
    try {
      any = createClient(email, password);
      await any.login(false);
      this.set({ phase: 'fetching' });
      const recipes = await any.getRecipes();
      const lists = await any.getLists();
      const inCollections = await collectionsByRecipe(any);
      this.set({ phase: 'recipes', total: recipes.length, listsTotal: lists.length });

      for (const r of recipes) {
        try {
          const mapped = mapRecipe(r);
          const cols = inCollections.get(r.identifier);
          if (cols) mapped.collections = cols;
          if (!mapped.title || (!mapped.ingredients.length && !mapped.steps.length)) { this.set({ skipped: (this.state.skipped || 0) + 1 }); continue; }
          const photo = r.photoUrls?.[0] ? await downloadPhoto(r.photoUrls[0], this.allowPrivate) : null;
          const res = this.upsertRecipe(mapped, photo);
          this.set({ done: this.state.done + 1, photos: this.state.photos + (res.image ? 1 : 0) });
        } catch (e) {
          const errors = this.state.errors.length < 20 ? [...this.state.errors, `${r.name || 'Untitled'}: ${this.friendly(e, password)}`] : this.state.errors;
          this.set({ failed: this.state.failed + 1, errors });
        }
      }

      this.set({ phase: 'lists' });
      for (const l of lists) {
        try {
          this.importList({
            externalId: `anylist:${l.identifier}`,
            name: l.name,
            items: (l.items || []).map((i) => ({ name: i.name, quantity: i.quantity || '', details: i.details || '', checked: !!i.checked })),
          });
          this.set({ lists: this.state.lists + 1 });
        } catch (e) {
          this.set({ errors: [...this.state.errors, `List ${l.name}: ${this.friendly(e, password)}`].slice(0, 20) });
        }
      }
      this.set({ state: 'done', phase: 'done', finishedAt: new Date().toISOString() });
    } catch (e) {
      this.set({ state: 'error', error: this.friendly(e, password) });
    } finally {
      try { any?.teardown?.(); } catch { /* ignore */ }
    }
  }
}

module.exports = { AnyListImport, mapRecipe, downloadPhoto, setClientFactory: (f) => { clientFactory = f; } };
