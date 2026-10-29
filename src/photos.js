'use strict';
/**
 * Finds pictures for recipes that were saved without one (AnyList imports often have none).
 * For each recipe that has a source link, it reads the page, takes the Recipe image or the
 * social preview image, downloads it (same private-address guard as every other fetch) and saves it.
 * A recipe that fails is retried later with a growing delay, so a dead link is not hammered.
 */
const { fetchHtml, pageImage } = require('./extract');
const { downloadPhoto } = require('./anylist');

const DAY = 24 * 3600 * 1000;
const BACKOFF_DAYS = [1, 3, 7, 14, 30];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PhotoFinder {
  constructor({ store, allowPrivate = false, delayMs = 1500, intervalMs = 6 * 3600 * 1000, firstRunMs = 2 * 60 * 1000 }) {
    Object.assign(this, { store, allowPrivate, delayMs, intervalMs, firstRunMs });
    this.running = false;
    this.lastRun = null;
    this.lastFound = 0;
    this.timers = [];
  }

  wanted(r) { return !r.image && /^https?:\/\//.test(r.sourceUrl || ''); }
  /** Recipes with a link and no photo, optionally restricted to some ids. */
  missing(ids) { return this.store.list().filter((r) => this.wanted(r) && (!ids || ids.has(r.id))); }

  /** Try one recipe. Returns the updated recipe; throws with a readable message when no picture can be found. */
  async tryOne(id) {
    const rec = this.store.get(id);
    if (!rec || !this.wanted(rec)) return rec;
    try {
      const { html, finalUrl } = await fetchHtml(rec.sourceUrl, { allowPrivate: this.allowPrivate });
      const url = pageImage(html, finalUrl);
      if (!url) throw new Error('That page has no picture');
      const buf = await downloadPhoto(url, this.allowPrivate);
      if (!buf) throw new Error('The picture could not be downloaded');
      const path = this.store.saveImage(rec.id, buf);
      if (!path) throw new Error('The picture is not a JPEG, PNG or WebP image');
      const cur = this.store.get(id) || rec;          // keep edits made while we were fetching
      const { imageCheck, ...rest } = cur;
      this.store.write({ ...rest, image: path });
      return this.store.get(id);
    } catch (e) {
      const cur = this.store.get(id);
      if (cur) {
        const tries = (cur.imageCheck?.tries || 0) + 1;
        this.store.write({ ...cur, imageCheck: { at: new Date().toISOString(), tries, next: Date.now() + BACKOFF_DAYS[Math.min(tries - 1, BACKOFF_DAYS.length - 1)] * DAY, error: String(e.message).slice(0, 200) } });
      }
      throw e;
    }
  }

  /** One pass. force ignores the retry delay; ids limits it to some recipes. */
  async run({ force = false, ids = null, max = 25 } = {}) {
    if (this.running) return { checked: 0, found: 0, busy: true };
    this.running = true;
    let checked = 0, found = 0;
    try {
      const due = this.missing(ids).filter((r) => force || !r.imageCheck || r.imageCheck.next <= Date.now()).slice(0, max);
      for (const r of due) {
        if (checked) await sleep(this.delayMs);
        checked++;
        try { await this.tryOne(r.id); found++; } catch { /* recorded on the recipe, retried later */ }
      }
    } finally {
      this.running = false;
      this.lastRun = new Date().toISOString();
      this.lastFound = found;
    }
    return { checked, found };
  }

  status(ids) { return { running: this.running, lastRun: this.lastRun, lastFound: this.lastFound, missing: this.missing(ids).length }; }

  start() {
    const go = () => this.run().catch(() => {});
    const first = setTimeout(() => { go(); const iv = setInterval(go, this.intervalMs); iv.unref?.(); this.timers.push(iv); }, this.firstRunMs);
    first.unref?.();
    this.timers.push(first);
  }
  stop() { this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); this.timers = []; }
}

module.exports = { PhotoFinder };
