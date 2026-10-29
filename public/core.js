/* Shared front-end helpers. Other scripts attach their views to window.S. */
(() => {
  'use strict';
  const S = (window.S = { views: {}, me: null, people: [], aisles: [] });
  const $ = (s, r = document) => r.querySelector(s);
  const t = (k, v) => I18n.t(k, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const api = async (url, opts) => {
    const r = await fetch(url, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
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
    const box = (kind, id, label, on) => `<label class="pick"><input type="checkbox" data-${name}="${kind}" value="${esc(id)}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    return `${hh.length ? `<fieldset><legend>${t('share.households')}</legend>${hh.map((h) => box('households', h.id, h.name, share.households?.includes(h.id))).join('')}</fieldset>` : ''}
      <fieldset><legend>${t('share.people')}</legend>${ppl.length ? ppl.map((p) => box('users', p.id, p.name, share.users?.includes(p.id))).join('') : `<p class="muted">${t('share.noPeople')}</p>`}</fieldset>`;
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

  async function refreshMe() {
    S.me = await api('/api/me');
    S.people = await api('/api/people');
  }
  const aisleLabel = (a) => t('aisle.' + a);
  const weekday = (d, style = 'long') => new Intl.DateTimeFormat(I18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { weekday: style }).format(d);
  const dateLabel = (d, o = { month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat(I18n.lang === 'fr' ? 'fr-CA' : 'en-CA', o).format(d);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  Object.assign(S, { $, t, esc, fold, api, get: (u) => api(u), post: send('POST'), put: send('PUT'), patch: send('PATCH'), del: send('DELETE'), mins, ic, modal, shareText, shareFields, readShare, shareDialog, refreshMe, personName, aisleLabel, weekday, dateLabel, ymd, parseYmd, app: $('#app') });
})();
