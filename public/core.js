/* Shared front-end helpers. Other scripts attach their views to window.S. */
(() => {
  'use strict';
  const S = (window.S = { views: {}, me: null, people: [], aisles: [] });

  // Installable app: keep the browser's install offer for the Account page, and register the service worker.
  S.installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; });
  window.addEventListener('appinstalled', () => { S.installPrompt = null; });
  S.isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if ('serviceWorker' in navigator) window.addEventListener('load', () => { try { navigator.serviceWorker.register('/sw.js').catch(() => {}); } catch { /* not available here */ } });
  const $ = (s, r = document) => r.querySelector(s);
  const t = (k, v) => I18n.t(k, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Embedded in another site (the Home Assistant panel) the browser may refuse the login cookie, so there the
  // page signs in with an app token it keeps in its own storage and sends as a header.
  const KEY = 'simmer-embed-token';
  const mem = {};
  const store = (fn) => { try { return fn(localStorage); } catch { try { return fn(sessionStorage); } catch { return fn({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] }); } } };
  S.embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();
  S.embedToken = () => (S.embedded ? JSON.parse(store((b) => b.getItem(KEY)) || 'null') : null);
  S.setEmbedToken = (v) => store((b) => (v ? b.setItem(KEY, JSON.stringify(v)) : b.removeItem(KEY)));
  const api = async (url, opts) => {
    const tok = S.embedToken()?.token;
    const r = await fetch(url, (opts || tok) && { ...opts, headers: { ...(opts && { 'content-type': 'application/json' }), ...(tok && { authorization: 'Bearer ' + tok }) }, body: opts?.body && JSON.stringify(opts.body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.startsWith('/api/auth/')) { S.onSignedOut?.(); throw new Error(I18n.err(j.error || 'Sign in required')); }
    if (!r.ok) throw new Error(I18n.err(j.error || r.statusText));
    return j;
  };
  const send = (method) => (url, body) => api(url, { method, body: body || {} });
  const mins = (m) => (!m ? null : m >= 60 ? (m % 60 ? t('time.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('time.h', { h: m / 60 })) : t('time.min', { n: m }));

  const ICONS = {
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5"/><path d="M9.5 2h5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    basket: '<path d="M4 9h16l-1.6 10a2 2 0 0 1-2 1.7H7.6a2 2 0 0 1-2-1.7z"/><path d="M8.5 9 11 3.5M15.5 9 13 3.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>',
    share: '<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 2.5-2.5L20 18"/>',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

  /** Modal sheet. mount(el, close) wires the content. Returns close(). */
  function modal(html, mount) {
    const o = document.createElement('div');
    o.className = 'modal';
    o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    const prev = document.activeElement;
    const close = () => { o.remove(); document.removeEventListener('keydown', key); prev?.focus?.(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
    document.body.appendChild(o);
    mount?.($('.sheet', o), close);
    ($('[autofocus]', o) || $('input,select,textarea', o))?.focus();
    return close;
  }

  const personName = (id) => (id === S.me?.id ? t('acct.you') : S.people.find((p) => p.id === id)?.name || '?');
  const hhName = (id) => S.me?.households.find((h) => h.id === id)?.name || '';
  /** "Shared with Home, Sis" or "Private". */
  const shareText = (o) => {
    const names = [...(o.sharedWith?.households || []).map(hhName), ...(o.sharedWith?.users || []).map(personName)].filter(Boolean);
    return names.length ? t('share.with', { names: names.join(', ') }) : t('share.private');
  };

  /** Checkbox groups for households and people. Read the result with readShare(el). */
  function shareFields(share = {}, name = 'share') {
    const hh = S.me.households, ppl = S.people.filter((p) => p.id !== S.me.id);
    const box = (kind, id, label, on, person) => `<label class="pick"><input type="checkbox" data-${name}="${kind}" value="${esc(id)}" ${on ? 'checked' : ''}>${person ? avatar(person, 26) : ''}<span>${esc(label)}</span></label>`;
    return `${hh.length ? `<fieldset><legend>${t('share.households')}</legend>${hh.map((h) => box('households', h.id, h.name, share.households?.includes(h.id))).join('')}</fieldset>` : ''}
      <fieldset><legend>${t('share.people')}</legend>${ppl.length ? ppl.map((p) => box('users', p.id, p.name, share.users?.includes(p.id), p)).join('') : `<p class="muted">${t('share.noPeople')}</p>`}</fieldset>`;
  }
  const readShare = (el, name = 'share') => ({
    households: [...el.querySelectorAll(`[data-${name}=households]:checked`)].map((c) => c.value),
    users: [...el.querySelectorAll(`[data-${name}=users]:checked`)].map((c) => c.value),
  });

  /** Dialog to change who an object is shared with. onSave(share) returns the updated object. */
  function shareDialog(obj, onSave) {
    modal(`<h2 class="sec">${t('share.title')}</h2><form id="shf">${shareFields(obj.sharedWith)}<p class="err" id="sherr" hidden></p>
      <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('share.save')}</button></div></form>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#shf', el).onsubmit = async (e) => {
        e.preventDefault();
        try { await onSave(readShare(el)); close(); } catch (x) { const er = $('#sherr', el); er.textContent = x.message; er.hidden = false; }
      };
    });
  }

  /** Round profile picture, or coloured initials when the person has none. p: { id, name, avatar }. */
  function avatar(p, size = 32) {
    if (!p) return '';
    let h = 0; for (const c of String(p.id || p.name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
    const initials = String(p.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<span class="av" style="--s:${size}px;--h:${h}" title="${esc(p.name)}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy">` : esc(initials)}</span>`;
  }
  /** Crop a picked image to a centred square, shrink it to 256 px and return it as base64 JPEG. */
  async function squarePhoto(file, px = 256) {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
    return await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
  }

  async function refreshMe() {
    S.me = await api('/api/me');
    S.people = await api('/api/people');
  }
  const aisleLabel = (a) => t('aisle.' + a);
  const weekday = (d, style = 'long') => new Intl.DateTimeFormat(I18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { weekday: style }).format(d);
  const dateLabel = (d, o = { month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat(I18n.lang === 'fr' ? 'fr-CA' : 'en-CA', o).format(d);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  Object.assign(S, { $, t, esc, fold, api, get: (u) => api(u), post: send('POST'), put: send('PUT'), patch: send('PATCH'), del: send('DELETE'), mins, ic, modal, shareText, avatar, squarePhoto, shareFields, readShare, shareDialog, refreshMe, personName, aisleLabel, weekday, dateLabel, ymd, parseYmd, app: $('#app') });
})();
