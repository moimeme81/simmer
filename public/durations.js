/*
 * Finds cooking times in recipe step text (English and French) so they can become tap-to-start timers.
 *   "Cuire 6 minutes"            -> 360 s
 *   "Bake 20 to 25 minutes"      -> 1200 s (lower bound, flagged as a range)
 *   "Laisser lever 1 h 30"       -> 5400 s
 *   "mijoter une demi-heure"     -> 1800 s
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Durations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GLYPH = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
  const N = '(?:\\d+\\s?[¼½¾]|\\d+(?:[.,]\\d+)?|[¼½¾]|\\d+/\\d+)';
  const RANGE = '\\s*(?:-|–|—|à|to|or|ou)\\s*';
  const WORDS = {
    'une demi-heure': 1800, 'un quart d\'heure': 900, 'une heure': 3600, 'une minute': 60, 'un quart d’heure': 900,
    'half an hour': 1800, 'a quarter of an hour': 900, 'an hour': 3600, 'one hour': 3600, 'a minute': 60, 'one minute': 60,
  };
  const WORD_RE = new RegExp(`(?<![\\p{L}])(?<w>${Object.keys(WORDS).join('|').replace(/'/g, "['’]")})(?![\\p{L}])`, 'giu');
  const HM_RE = new RegExp(`(?<![\\p{L}\\d])(?<h>${N})\\s*(?:h|heures?|hours?|hrs?)(?![\\p{L}])(?:\\s*(?:et\\s*)?(?<m>\\d{1,2})(?:\\s*min(?:utes?)?(?![\\p{L}]))?)?`, 'giu');
  const UNIT_RE = new RegExp(`(?<![\\p{L}\\d])(?<a>${N})(?:${RANGE}(?<b>${N}))?\\s*(?<u>heures?|hours?|hrs?|minutes?|mins?|secondes?|seconds?|secs?)(?![\\p{L}])`, 'giu');

  function num(s) {
    s = s.trim();
    let m;
    if ((m = s.match(/^(\d+)\s?([¼½¾])$/))) return +m[1] + GLYPH[m[2]];
    if (GLYPH[s] !== undefined) return GLYPH[s];
    if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
    return parseFloat(s.replace(',', '.'));
  }
  const perUnit = (u) => (/^h|^hr/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1);

  function findDurations(text) {
    const hits = [];
    const add = (m, seconds, ranged) => { if (seconds > 0 && seconds <= 24 * 3600) hits.push({ start: m.index, end: m.index + m[0].length, text: m[0], seconds: Math.round(seconds), ranged: !!ranged }); };
    for (const m of text.matchAll(WORD_RE)) add(m, WORDS[m.groups.w.toLowerCase().replace('’', "'")] ?? WORDS[m.groups.w.toLowerCase()]);
    for (const m of text.matchAll(HM_RE)) add(m, num(m.groups.h) * 3600 + (m.groups.m ? +m.groups.m * 60 : 0));
    for (const m of text.matchAll(UNIT_RE)) add(m, num(m.groups.a) * perUnit(m.groups.u), !!m.groups.b);
    // keep the longest non-overlapping matches, in reading order
    hits.sort((x, y) => x.start - y.start || y.end - x.end);
    const out = [];
    for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
    return out;
  }

  /** Format seconds as 1:05:00 / 12:34 / 0:45. */
  function clock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  return { findDurations, clock };
});
