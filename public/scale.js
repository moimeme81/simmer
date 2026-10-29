/*
 * Recipe quantity scaling for Simmer. Works in the browser (window.Scale) and Node (require).
 *
 * Unlike most apps it scales EVERY quantity on an ingredient line, not just the first one:
 *   "1 tasse (250 ml) de lait"   x2 -> "2 tasses (500 ml) de lait"
 *   "250 ml / 1 cup milk"        x1.5 -> "375 ml / 1 ½ cups milk"
 * It understands English and French units, fractions (1/2, ½, 1 1/2, 1½), decimals (1.5 and 1,5)
 * and ranges (2-3, 2 à 3, 2 to 3). Things that must NOT scale are left alone:
 *   - package sizes:  "1 can (400 ml) coconut milk" x2 -> "2 cans (400 ml) coconut milk"
 *   - percentages and temperatures: "2 % milk", "350 °F"
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FRAC = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6 };
  const FR_CH = Object.keys(FRAC).join('');
  const GLYPH = { 0.5: '½', 0.25: '¼', 0.75: '¾', [1 / 3]: '⅓', [2 / 3]: '⅔', 0.125: '⅛', 0.375: '⅜', 0.625: '⅝', 0.875: '⅞' };

  /* ---------- units ---------- */
  // dim: vol | mass | len | pkg (container whose size is stated separately) | count
  // sys: imp | met (only used to pick fraction vs decimal display)
  const UNITS = [
    { id: 'tsp', dim: 'vol', sys: 'imp', re: 'c\\.?\\s*à\\s*(?:thé|café|c\\.?|t\\.?)|cuill[eè]res?\\s*à\\s*(?:thé|café)|càc|c\\.\\s*c\\.|teaspoons?|tsp\\.?' },
    { id: 'tbsp', dim: 'vol', sys: 'imp', re: 'c\\.?\\s*à\\s*(?:soupe|table|s\\.?)|cuill[eè]res?\\s*à\\s*(?:soupe|table)|càs|c\\.\\s*s\\.|tablespoons?|tbsp\\.?|tbs\\.?' },
    { id: 'cup', dim: 'vol', sys: 'imp', re: 'tasses?|cups?' },
    { id: 'floz', dim: 'vol', sys: 'imp', re: 'fl\\.?\\s*oz\\.?|oz\\.?\\s*liq(?:uides?|\\.)?|onces?\\s+liquides?' },
    { id: 'pint', dim: 'vol', sys: 'imp', re: 'pintes?|pints?' },
    { id: 'quart', dim: 'vol', sys: 'imp', re: 'quarts?' },
    { id: 'gallon', dim: 'vol', sys: 'imp', re: 'gallons?' },
    { id: 'ml', dim: 'vol', sys: 'met', re: 'ml|millilit(?:re|er)s?' },
    { id: 'cl', dim: 'vol', sys: 'met', re: 'cl|centilit(?:re|er)s?' },
    { id: 'dl', dim: 'vol', sys: 'met', re: 'dl|décilit(?:re|er)s?|decilit(?:re|er)s?' },
    { id: 'l', dim: 'vol', sys: 'met', re: 'l|lit(?:re|er)s?' },
    { id: 'mg', dim: 'mass', sys: 'met', re: 'mg|milligramm?es?|milligrams?' },
    { id: 'g', dim: 'mass', sys: 'met', re: 'g|gr\\.?|gramm?es?|grams?' },
    { id: 'kg', dim: 'mass', sys: 'met', re: 'kg|kilos?|kilogramm?es?|kilograms?' },
    { id: 'oz', dim: 'mass', sys: 'imp', re: 'oz\\.?|onces?|ounces?' },
    { id: 'lb', dim: 'mass', sys: 'imp', re: 'lbs?\\.?|livres?|pounds?' },
    { id: 'mm', dim: 'len', sys: 'met', re: 'mm' },
    { id: 'cm', dim: 'len', sys: 'met', re: 'cm|centim[eè]tres?|centimeters?' },
    { id: 'in', dim: 'len', sys: 'imp', re: 'po|pouces?|inch(?:es)?' },
    { id: 'pkg', dim: 'pkg', sys: null, re: 'bo[iî]tes?(?:\\s+de\\s+conserve)?|conserves?|cans?|paquets?|packages?|pkgs?\\.?|sachets?|bouteilles?|bottles?|pots?|jars?|sacs?|bags?|contenants?|containers?|tubes?|enveloppes?|cartons?' },
    { id: 'count', dim: 'count', sys: null, re: 'gousses?|cloves?|tranches?|slices?|branches?|tiges?|stalks?|feuilles?|leaves|leaf|pinc[ée]es?|pinch(?:es)?|bottes?|bunch(?:es)?|t[êe]tes?|heads?|morceaux?|pi[eè]ces?|pieces?|sprigs?|brins?|bâtons?|sticks?' },
  ];
  const byId = Object.fromEntries(UNITS.map((u) => [u.id, u]));
  const UNIT_RE = UNITS.map((u) => `(?<u_${u.id}>${u.re})`).join('|');

  // nouns that take a plural s ("tasse"/"tasses", "cup"/"cups"); the rest (ml, tsp, c. à soupe...) never change
  const FR_NOUNS = new Set(['tasse', 'cuillère', 'cuillere', 'once', 'livre', 'litre', 'gramme', 'pouce', 'boîte', 'boite', 'paquet', 'sachet', 'bouteille', 'pot', 'gousse', 'tranche', 'branche', 'tige', 'feuille', 'pincée', 'pincee', 'botte', 'tête', 'tete', 'morceau', 'pièce', 'piece', 'conserve', 'sac', 'contenant', 'enveloppe', 'carton', 'pinte', 'brin', 'bâton', 'millilitre', 'centilitre', 'décilitre', 'kilogramme', 'milligramme', 'centimètre', 'centimetre', 'kilo']);
  const EN_NOUNS = new Set(['cup', 'tablespoon', 'teaspoon', 'ounce', 'pound', 'liter', 'litre', 'gram', 'inch', 'can', 'package', 'bottle', 'jar', 'bag', 'container', 'tube', 'clove', 'slice', 'stalk', 'leaf', 'pinch', 'bunch', 'head', 'piece', 'sprig', 'stick', 'pint', 'quart', 'gallon', 'milliliter', 'centiliter', 'deciliter', 'kilogram', 'milligram', 'centimeter']);

  /* ---------- numbers ---------- */
  const NUM = `(?:\\d+[\\s-]\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?\\s?[${FR_CH}]|\\d+(?:[.,]\\d+)?|[${FR_CH}])`;
  const SEP = '\\s*(?:-|–|—|à|to|ou|or)\\s*';
  const MATCH_RE = new RegExp(`(?<![\\p{L}\\d.,/])(?<num>${NUM}(?:${SEP}${NUM})?)(?<sp>\\s*)(?:(?<unit>${UNIT_RE})(?![\\p{L}]))?`, 'giu');
  const RANGE_RE = new RegExp(`^(${NUM})(${SEP})(${NUM})$`, 'iu');

  function toNumber(s) {
    s = s.trim();
    let m;
    if ((m = s.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s?([${FR_CH}])$`)))) return parseFloat(m[1].replace(',', '.')) + FRAC[m[2]];
    if (FRAC[s] !== undefined) return FRAC[s];
    if ((m = s.match(/^(\d+)[\s-](\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
    if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
    return parseFloat(s.replace(',', '.'));
  }

  /* ---------- formatting ---------- */
  function frac(v, denoms) {
    const whole = Math.floor(v + 1e-9);
    const rem = v - whole;
    let best = null;
    for (const d of denoms) for (let n = 0; n <= d; n++) {
      const err = Math.abs(rem - n / d);
      if (!best || err < best.err - 1e-9) best = { n, d, err };
    }
    if (best.err > 0.02) return null;
    let w = whole;
    let glyph = '';
    if (best.n === best.d) w += 1;
    else if (best.n > 0) glyph = GLYPH[Object.keys(GLYPH).find((k) => Math.abs(k - best.n / best.d) < 1e-6)] || '';
    if (best.n > 0 && best.n < best.d && !glyph) return null;
    if (w === 0 && !glyph) return null;
    return (w ? String(w) : '') + (w && glyph ? ' ' : '') + glyph;
  }

  function decimal(v, places, lang) {
    const s = (Math.round(v * 10 ** places) / 10 ** places).toString();
    return lang === 'fr' ? s.replace('.', ',') : s;
  }

  function format(v, unit, lang) {
    const dim = unit?.dim;
    const useFraction = !unit || dim === 'count' || dim === 'pkg' || (unit.sys === 'imp');
    if (useFraction) {
      const denoms = unit && ['tsp', 'tbsp', 'cup', 'oz', 'in'].includes(unit.id) ? [2, 3, 4, 8] : [2, 3, 4];
      const f = frac(v, denoms);
      if (f) return f;
      return decimal(v, v < 10 ? 1 : 0, lang);
    }
    // metric
    if (unit && (unit.id === 'kg' || unit.id === 'l')) return decimal(v, v < 10 ? 2 : 1, lang);
    if (v >= 100) return decimal(Math.round(v / 5) * 5, 0, lang);
    if (v >= 20) return decimal(v, 0, lang);
    if (v >= 5) return decimal(Math.round(v * 2) / 2, 1, lang);
    return decimal(v, v < 1 ? 2 : 1, lang);
  }

  /* ---------- plural / unit swaps ---------- */
  function nounOf(surface) {
    const first = surface.trim().split(/\s+/)[0].toLowerCase().replace(/[.,]$/, '');
    for (const cand of [first, first.replace(/es$/, ''), first.replace(/s$/, '')]) {
      if (FR_NOUNS.has(cand)) return { cand, lang: 'fr', plural: cand !== first };
      if (EN_NOUNS.has(cand)) return { cand, lang: 'en', plural: cand !== first };
    }
    return null;
  }

  function pluralize(surface, value) {
    const n = nounOf(surface);
    if (!n) return surface;
    const wantPlural = n.lang === 'fr' ? value >= 2 : value > 1;
    if (wantPlural === n.plural) return surface;
    const words = surface.split(/(\s+)/);
    const first = words[0];
    const stem = n.cand;
    const plural = /(ch|sh|s|x)$/.test(stem) ? stem + 'es' : stem + 's';
    const keepCase = (src, out) => (src[0] === src[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out);
    words[0] = keepCase(first, wantPlural ? plural : stem);
    return words.join('');
  }

  const PROMOTE = {
    ml: (v) => (v >= 1000 ? { id: 'l', v: v / 1000 } : null),
    g: (v) => (v >= 1000 ? { id: 'kg', v: v / 1000 } : null),
    tsp: (v) => (v >= 3 && Math.abs(v / 3 - Math.round(v / 3)) < 1e-6 ? { id: 'tbsp', v: v / 3 } : null),
    tbsp: (v) => (v >= 16 && Math.abs(v / 16 - Math.round(v / 16)) < 1e-6 ? { id: 'cup', v: v / 16 } : null),
    oz: (v) => (v >= 16 && Math.abs(v / 16 - Math.round(v / 16)) < 1e-6 ? { id: 'lb', v: v / 16 } : null),
  };
  // Awkward amounts read better in a smaller unit: 1/8 cup is 2 tbsp, 3/8 lb is 6 oz.
  const near = (x) => Math.abs(x - Math.round(x)) < 0.02;
  const nice = (v) => Math.round(v * 2) / 2;
  const DEMOTE = {
    cup: (v) => (!(near(v * 4) || near(v * 3)) && v < 1 ? { id: 'tbsp', v: nice(v * 16) } : null),
    lb: (v) => (!(near(v * 4) || near(v * 3)) && v < 1 ? { id: 'oz', v: nice(v * 16) } : null),
  };
  const SURFACE = {
    en: { l: 'L', kg: 'kg', tbsp: 'tbsp', cup: 'cups', lb: 'lb', oz: 'oz' },
    fr: { l: 'L', kg: 'kg', tbsp: 'c. à soupe', cup: 'tasses', lb: 'lb', oz: 'oz' },
  };
  const isFrenchLine = (s) => /[àâçéèêëîïôûùü]|\b(?:tasses?|cuill\w*|de|d'|du|des|et|ou|au|le|la|les|une?|pour)\b/i.test(s);

  /* ---------- scanning ---------- */
  function enclosing(str, idx) {
    let depth = 0, start = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (str[i] === ')') depth++;
      else if (str[i] === '(') { if (depth === 0) { start = i; break; } depth--; }
    }
    if (start < 0) return null;
    depth = 0;
    for (let i = idx; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') { if (depth === 0) return { start, end: i }; depth--; }
    }
    return { start, end: str.length };
  }

  const PKG_AFTER = new RegExp(`^\\s*(?:${UNITS.find((u) => u.id === 'pkg').re})(?![\\p{L}])`, 'iu');
  const EACH = /\b(?:chacune?|chaque|each|per|par)\b/i;

  function scan(str) {
    const found = [];
    MATCH_RE.lastIndex = 0;
    let m;
    while ((m = MATCH_RE.exec(str))) {
      if (m[0].length === 0) { MATCH_RE.lastIndex++; continue; }
      const unitId = m.groups.unit ? UNITS.find((u) => m.groups['u_' + u.id])?.id : null;
      let numText = m.groups.num;
      let sp = m.groups.sp;
      let end = m.index + m[0].length;
      // "2 %" / "350 °F" are not quantities
      const tail = str.slice(m.index + numText.length);
      const noScale = !unitId && /^\s*(?:%|°|º|˚)/.test(tail);
      if (!m.groups.unit) { sp = ''; end = m.index + numText.length; }
      found.push({ index: m.index, end, numText, sp, unit: unitId ? byId[unitId] : null, unitText: m.groups.unit || '', noScale });
      MATCH_RE.lastIndex = Math.max(end, m.index + 1);
    }
    for (const f of found) {
      f.paren = enclosing(str, f.index);
    }
    for (const f of found) {
      f.scale = !f.noScale;
      if (f.scale && f.paren) {
        const inside = str.slice(f.paren.start + 1, f.paren.end);
        const before = [...found].reverse().find((o) => o.index < f.paren.start && !o.paren);
        const after = str.slice(f.paren.end + 1);
        if (EACH.test(inside) || PKG_AFTER.test(after) || (before && before.unit && before.unit.dim === 'pkg')) f.scale = false;
      }
    }
    return found;
  }

  /* ---------- public API ---------- */
  function scaleNumberText(numText, factor, unit, lang) {
    const range = numText.match(RANGE_RE);
    if (range) {
      const a = toNumber(range[1]) * factor, b = toNumber(range[3]) * factor;
      return { text: `${format(a, unit, lang)}${range[2]}${format(b, unit, lang)}`, last: b };
    }
    const v = toNumber(numText) * factor;
    return { text: format(v, unit, lang), last: v };
  }

  function scaleLine(line, factor, opts) {
    const lang = opts?.lang === 'fr' ? 'fr' : 'en';
    if (!line || !Number.isFinite(factor) || Math.abs(factor - 1) < 1e-9) return line;
    const items = scan(line);
    let out = '';
    let pos = 0;
    for (const f of items) {
      out += line.slice(pos, f.index);
      pos = f.end;
      if (!f.scale) { out += line.slice(f.index, f.end); continue; }
      let unit = f.unit;
      let { text, last } = scaleNumberText(f.numText, factor, unit, lang);
      let unitText = f.unitText;
      const promo = unit && (PROMOTE[unit.id]?.(last) || DEMOTE[unit.id]?.(last));
      if (promo && !/[–—-]/.test(f.numText.replace(/^\d+[\s-]\d+\/\d+$/, ''))) {
        const range = f.numText.match(RANGE_RE);
        if (!range) {
          unit = byId[promo.id];
          last = promo.v;
          text = format(promo.v, unit, lang);
          const l = isFrenchLine(line) ? 'fr' : 'en';
          unitText = SURFACE[l][promo.id] || f.unitText;
        }
      }
      unitText = unitText ? pluralize(unitText, last) : unitText;
      out += text + f.sp + unitText;
    }
    return out + line.slice(pos);
  }

  /** First number in a yield string ("4 portions", "Makes 24", "4-6 servings") or null. */
  function parseYield(str) {
    if (!str) return null;
    const m = new RegExp(`(?<![\\p{L}\\d.,/])(${NUM})`, 'iu').exec(String(str));
    if (!m) return null;
    const v = toNumber(m[1]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /* ---------- unit conversion ---------- */
  // Cooking-friendly equivalents (Canadian/metric kitchen sizes): 1 cup = 250 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml.
  const BASE = { tsp: 5, tbsp: 15, cup: 250, floz: 30, pint: 500, quart: 1000, gallon: 4000, ml: 1, cl: 10, dl: 100, l: 1000, mg: 0.001, g: 1, kg: 1000, oz: 28.35, lb: 453.6, mm: 1, cm: 10, in: 25.4 };
  const nearestOf = (v, steps) => { let best = steps[0]; for (const x of steps) if (Math.abs(x - v) < Math.abs(best - v) - 1e-9) best = x; return best; };
  const grid = (v, parts, max) => { const w = Math.floor(v); const r = nearestOf(v - w, parts); return Math.min(max, w + r); };
  const EIGHTHS = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];
  const QUARTERS = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
  const HALVES = [0, 1 / 2, 1];
  const roundTo = (v, id) => {
    if (id === 'cup') return v < 1 ? grid(v, EIGHTHS, 99) : grid(v, QUARTERS, 9999);
    if (id === 'tbsp') return v < 3 ? grid(v, HALVES, 99) : Math.round(v);
    if (id === 'tsp') return v < 1 ? grid(v, EIGHTHS.filter((x) => [0, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1].includes(x)), 99) : grid(v, QUARTERS, 99);
    if (id === 'oz') return v < 4 ? grid(v, QUARTERS, 99) : Math.round(v * 2) / 2;
    if (id === 'lb') return grid(v, QUARTERS, 9999);
    if (id === 'in') return v < 1 ? grid(v, EIGHTHS, 99) : grid(v, QUARTERS, 9999);
    if (id === 'ml' || id === 'g') return v >= 100 ? Math.round(v / 10) * 10 : v >= 20 ? Math.round(v / 5) * 5 : v >= 5 ? Math.round(v * 2) / 2 : Math.round(v * 4) / 4;
    return v;
  };
  // pick a sensible unit in the wanted system for an amount of `base` (ml, g or mm)
  function toSystem(base, dim, sys) {
    if (dim === 'vol') {
      if (sys === 'met') return base >= 1000 ? { id: 'l', v: base / 1000 } : { id: 'ml', v: base };
      if (base < 15 * 0.9) return { id: 'tsp', v: base / 5 };
      if (base < 60) return { id: 'tbsp', v: base / 15 };
      return { id: 'cup', v: base / 250 };
    }
    if (dim === 'mass') {
      if (sys === 'met') return base >= 1000 ? { id: 'kg', v: base / 1000 } : { id: 'g', v: base };
      return base >= 454 * 0.9 ? { id: 'lb', v: base / 453.6 } : { id: 'oz', v: base / 28.35 };
    }
    if (sys === 'met') return base >= 10 ? { id: 'cm', v: base / 10 } : { id: 'mm', v: base };
    return { id: 'in', v: base / 25.4 };
  }
  const UNIT_ONE = {
    en: { tsp: 'tsp', tbsp: 'tbsp', cup: 'cup', oz: 'oz', lb: 'lb', in: 'inch', ml: 'ml', l: 'L', g: 'g', kg: 'kg', mm: 'mm', cm: 'cm' },
    fr: { tsp: 'c. à thé', tbsp: 'c. à soupe', cup: 'tasse', oz: 'oz', lb: 'lb', in: 'po', ml: 'ml', l: 'L', g: 'g', kg: 'kg', mm: 'mm', cm: 'cm' },
  };
  const DIM_KEY = { vol: 'vol', mass: 'mass', len: 'len' };

  function convertAmount(numText, unit, sys, l) {
    const range = numText.match(RANGE_RE);
    const parts = range ? [toNumber(range[1]), toNumber(range[3])] : [toNumber(numText)];
    if (parts.some((x) => !Number.isFinite(x))) return null;
    const bases = parts.map((x) => x * BASE[unit.id]);
    const target = toSystem(Math.max(...bases), unit.dim, sys);
    const tu = byId[target.id];
    const vals = bases.map((b) => roundTo(b / BASE[target.id], target.id));
    const fmt = (v) => (target.id === 'in' || target.id === 'cup' || target.id === 'tbsp' || target.id === 'tsp' || target.id === 'oz' || target.id === 'lb' ? format(v, { ...tu, sys: 'imp' }, l) : format(v, tu, l));
    const text = range ? `${fmt(vals[0])}${range[2]}${fmt(vals[1])}` : fmt(vals[0]);
    const last = vals[vals.length - 1];
    const name = UNIT_ONE[l][target.id];
    const word = ['cup', 'inch', 'tasse', 'po'].includes(name) ? pluralize(name, last) : name;
    return `${text} ${word}`;
  }

  const GAP_PAIR = /^\s*(?:[/|]|ou|or)\s*$/i;
  /** Converts the measurements in one line (ingredient or step) as the settings say. prefs: { mass, vol, len, temp } each 'orig' | 'metric' | 'imperial' | 'both'. */
  function convertLine(line, prefs, opts) {
    if (!line || !prefs) return line;
    const l = isFrenchLine(line) ? 'fr' : (opts?.lang === 'fr' && !/[a-z]{4,}/i.test(line.replace(/\b(?:tsp|tbsp|cups?|oz|lbs?|ml)\b/gi, '')) ? 'fr' : 'en');
    let out = line;
    // --- quantities ---
    const items = scan(out).filter((f) => f.unit && DIM_KEY[f.unit.dim] && !f.noScale);
    const edits = [];
    const used = new Set();
    for (const a of items) {
      if (used.has(a)) continue;
      const mode = prefs[DIM_KEY[a.unit.dim]] || 'orig';
      if (mode === 'orig') continue;
      const sysA = a.unit.sys;
      // an amount already written in both systems: "1 cup (250 ml)" or "1 cup / 250 ml"
      const b = items.find((o) => o !== a && !used.has(o) && o.unit.dim === a.unit.dim && o.unit.sys !== sysA && o.index > a.end && (
        (o.paren && o.paren.start >= a.end && /^\s*$/.test(out.slice(a.end, o.paren.start)) && out.slice(o.paren.start + 1, o.paren.end).trim() === out.slice(o.index, o.end).trim()) ||
        (!o.paren && GAP_PAIR.test(out.slice(a.end, o.index)))));
      if (b) {
        used.add(a); used.add(b);
        if (mode === 'both') continue;
        const keep = (mode === 'metric') === (sysA === 'met') ? a : b;
        edits.push({ start: a.index, end: b.paren ? b.paren.end + 1 : b.end, text: out.slice(keep.index, keep.end) });
        continue;
      }
      if (mode === 'both') {
        const conv = convertAmount(a.numText, a.unit, sysA === 'met' ? 'imp' : 'met', l);
        if (conv) edits.push({ start: a.end, end: a.end, text: a.paren ? ` / ${conv}` : ` (${conv})` });
        continue;
      }
      if ((mode === 'metric') === (sysA === 'met')) continue;   // already in the wanted system
      const conv = convertAmount(a.numText, a.unit, mode === 'metric' ? 'met' : 'imp', l);
      if (conv) edits.push({ start: a.index, end: a.end, text: conv });
    }
    edits.sort((x, y) => y.start - x.start).forEach((e) => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });

    // --- temperatures ---
    const tmode = prefs.temp || 'orig';
    if (tmode !== 'orig') out = convertTemps(out, tmode, l);
    return out;
  }

  /* ---------- temperatures ---------- */
  const OVEN_F2C = { 200: 95, 225: 110, 250: 120, 275: 140, 300: 150, 325: 160, 350: 175, 375: 190, 400: 200, 425: 220, 450: 230, 475: 240, 500: 260 };
  const OVEN_C2F = { 95: 200, 110: 225, 120: 250, 140: 275, 150: 300, 160: 325, 175: 350, 180: 350, 190: 375, 200: 400, 220: 425, 230: 450, 240: 475, 260: 500 };
  const f2c = (f) => OVEN_F2C[f] ?? Math.round(((f - 32) * 5) / 9 / 5) * 5;
  const c2f = (c) => OVEN_C2F[c] ?? (c >= 120 ? Math.round((c * 1.8 + 32) / 25) * 25 : Math.round((c * 1.8 + 32) / 5) * 5);
  const TEMP_RE = /(?<![\d.,])(\d{2,3})(?:(\s*(?:-|–|à|to)\s*)(\d{2,3}))?\s*(?:(?:°|º|˚)\s*|\s+degrees?\s*|\s+degrés?\s*)([CF])(?![\p{L}\d])|(?<![\d.,])(\d{3})(?:(\s*(?:-|–|à|to)\s*)(\d{3}))?\s?(F)(?![\p{L}\d])/giu;

  function convertTemps(str, mode, l) {
    const toks = [];
    TEMP_RE.lastIndex = 0;
    let m;
    while ((m = TEMP_RE.exec(str))) {
      const a = +(m[1] || m[5]), sep = m[2] || m[6] || '', b = m[3] || m[7] ? +(m[3] || m[7]) : null, u = (m[4] || m[8]).toUpperCase();
      toks.push({ i: m.index, e: m.index + m[0].length, a, sep, b, u });
    }
    const show = (a, sep, b, u) => `${a}${b != null ? sep + b : ''}${l === 'fr' ? ' ' : ''}°${u}`;
    const conv = (t) => { const to = t.u === 'F' ? 'C' : 'F', fn = t.u === 'F' ? f2c : c2f; return { text: show(fn(t.a), t.sep, t.b != null ? fn(t.b) : null, to), u: to }; };
    const edits = [];
    for (let n = 0; n < toks.length; n++) {
      const t = toks[n], nx = toks[n + 1];
      const gap = nx ? str.slice(t.e, nx.i) : '';
      const paired = nx && nx.u !== t.u && (GAP_PAIR.test(gap) || /^\s*\(\s*$/.test(gap));
      if (paired) {
        n++;
        if (mode === 'both') continue;
        const keep = (mode === 'metric') === (t.u === 'C') ? t : nx;
        const end = /^\s*\(\s*$/.test(gap) && str[nx.e] === ')' ? nx.e + 1 : nx.e;
        edits.push({ start: t.i, end, text: str.slice(keep.i, keep.e) });
        continue;
      }
      if (mode === 'both') edits.push({ start: t.e, end: t.e, text: ` (${conv(t).text})` });
      else if ((mode === 'metric') === (t.u === 'F')) edits.push({ start: t.i, end: t.e, text: conv(t).text });
    }
    edits.sort((x, y) => y.start - x.start).forEach((e) => { str = str.slice(0, e.start) + e.text + str.slice(e.end); });
    return str;
  }

  return { scaleLine, convertLine, parseYield, scan, toNumber };

});
