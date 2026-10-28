(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const t = (k, v) => I18n.t(k, v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const api = async (url, opts) => {
  const r = await fetch(url, opts && { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(I18n.err(j.error || r.statusText));
  return j;
};
const mins = (m) => !m ? null : m >= 60 ? (m % 60 ? t('time.hm', { h: Math.floor(m / 60), m: m % 60 }) : t('time.h', { h: m / 60 })) : t('time.min', { n: m });
const listName = (l) => (l.name === 'Groceries' && !l.externalId ? t('lists.groceries') : l.name);

const ICONS = {
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5"/><path d="M9.5 2h5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  basket: '<path d="M4 9h16l-1.6 10a2 2 0 0 1-2 1.7H7.6a2 2 0 0 1-2-1.7z"/><path d="M8.5 9 11 3.5M15.5 9 13 3.5"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const app = $('#app');

/* ---------- chrome: nav, tab bar, language ---------- */
function chrome() {
  const h = location.hash;
  const cur = h.startsWith('#/lists') ? 'lists' : h.startsWith('#/import') ? 'import' : 'recipes';
  const items = [['recipes', '#/', 'book', t('nav.recipes')], ['lists', '#/lists', 'list', t('nav.lists')], ['import', '#/import', 'import', t('nav.import')]];
  $('#topnav').innerHTML = items.map(([id, href, , label]) => `<a href="${href}" ${id === cur ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  $('#tabbar').innerHTML = items.map(([id, href, icon, label]) => `<a href="${href}" ${id === cur ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></a>`).join('');
  $('#lang').textContent = t('lang.other');
  document.documentElement.lang = I18n.lang;
}
$('#lang').onclick = () => { I18n.set(I18n.lang === 'fr' ? 'en' : 'fr'); route(); footer(); };

/* ---------- timers dock ---------- */
const dock = $('#dock');
const RING = 2 * Math.PI * 19;
let dockSig = '';
const timerCard = (x) => {
  const cls = x.done ? 'done' + (x.silenced ? ' silenced' : '') : x.paused != null ? 'paused' : 'run';
  const main = x.done
    ? `${x.silenced ? '' : `<button data-act="silence" aria-label="${esc(t('timer.stop'))}">${esc(t('timer.stop'))}</button>`}<button data-act="plus">${t('timer.plus')}</button><button data-act="remove" aria-label="${esc(t('timer.dismiss'))}">${ic('close')}</button>`
    : `<button data-act="${x.paused != null ? 'resume' : 'pause'}" aria-label="${esc(t(x.paused != null ? 'timer.resume' : 'timer.pause'))}">${ic(x.paused != null ? 'play' : 'pause')}</button><button data-act="plus">${t('timer.plus')}</button><button data-act="remove" aria-label="${esc(t('timer.dismiss'))}">${ic('close')}</button>`;
  return `<div class="tcard ${cls}" data-id="${x.id}"><svg class="ring" viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="arc" cx="22" cy="22" r="19" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
    <div><div class="clock" role="timer">0:00</div><div class="lbl">${esc(x.done ? t('timer.ready') + ': ' + x.label : x.label)}</div></div><div class="btns">${main}</div></div>`;
};
function renderDock() {
  const list = Timers.list();
  const sig = I18n.lang + list.map((x) => x.id + (x.done ? 'd' : '') + (x.silenced ? 's' : '') + (x.paused != null ? 'p' : 'r')).join('|');
  if (sig !== dockSig) { dockSig = sig; dock.innerHTML = list.map(timerCard).join(''); }
  let soonest = null;
  for (const x of list) {
    const card = dock.querySelector(`[data-id="${x.id}"]`);
    if (!card) continue;
    const left = Timers.remaining(x);
    const c = $('.clock', card); const txt = Durations.clock(left);
    if (c.textContent !== txt) c.textContent = txt;
    $('.arc', card).style.strokeDashoffset = x.done ? 0 : String(RING * (1 - left / Math.max(1, x.total)));
    if (!x.done && x.paused == null && (soonest === null || left < soonest)) soonest = left;
  }
  document.title = soonest === null ? 'Simmer' : `${Durations.clock(soonest)} Simmer`;
}
dock.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.tcard').dataset.id;
  ({ pause: () => Timers.pause(id), resume: () => Timers.resume(id), plus: () => Timers.addTime(id, 60), remove: () => Timers.remove(id), silence: () => Timers.silence(id) })[b.dataset.act]?.();
});
Timers.subscribe(renderDock);

/* ---------- steps with tap-to-start timers ---------- */
function stepHTML(text, n) {
  let out = '', pos = 0;
  for (const h of Durations.findDurations(text)) {
    out += esc(text.slice(pos, h.start)) + `<button class="dur" data-s="${h.seconds}" data-n="${n}" data-t="${esc(h.text)}" title="${esc(t('timer.label'))}">${ic('timer')}${esc(h.text)}</button>`;
    pos = h.end;
  }
  return out + esc(text.slice(pos));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.dur'); if (!b) return;
  Timers.add({ label: t('timer.stepLabel', { n: b.dataset.n, time: b.dataset.t }), seconds: +b.dataset.s });
  b.classList.add('started'); setTimeout(() => b.classList.remove('started'), 1500);
});

/* ---------- home ---------- */
const TILES = ['#1F4E96', '#2F7D6B', '#7A4B8F', '#B8741A', '#4F6B2E', '#9B3D52'];
const tileOf = (id) => TILES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length];

async function home() {
  app.innerHTML = `
    <div class="finder">
      <form class="field" id="imp"><input type="url" required placeholder="${esc(t('home.placeholder'))}" aria-label="${esc(t('home.placeholder'))}"><button class="primary">${t('home.import')}</button></form>
      <div class="err" id="imperr" hidden></div>
      <div class="field"><input type="search" id="q" placeholder="${esc(t('home.search'))}" aria-label="${esc(t('home.search'))}"></div>
    </div>
    <p class="count" id="count"></p><div id="cards"></div>`;
  const form = $('#imp'), err = $('#imperr');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', form); btn.disabled = true; btn.textContent = t('home.importing'); err.hidden = true;
    try { const r = await api('/api/import', { method: 'POST', body: { url: $('input', form).value } }); location.hash = '#/r/' + r.id; }
    catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = t('home.import'); }
  };
  const all = await api('/api/recipes');
  const show = () => {
    const q = fold($('#q').value.trim());
    const list = q ? all.filter((r) => fold(r.title).includes(q) || r.ingredients.some((i) => fold(i).includes(q))) : all;
    $('#count').textContent = all.length ? (q ? '' : t('home.count', { n: all.length })) : '';
    $('#cards').innerHTML = !all.length
      ? `<div class="empty"><img src="icon-192.png" alt=""><h2 class="sec">${t('home.emptyTitle')}</h2><p>${t('home.empty')}</p></div>`
      : !list.length ? `<p class="empty">${t('home.noMatch', { q: esc($('#q').value) })}</p>`
      : `<div class="grid">${list.map((r) => `<a class="rcard" href="#/r/${r.id}"><div class="pic" style="--tile:${tileOf(r.id)};${r.image ? `background-image:url('${esc(r.image)}')` : ''}">${r.image ? '' : esc([...r.title][0] || '')}</div><b>${esc(r.title)}</b><small>${esc(r.host)}</small></a>`).join('')}</div>`;
  };
  $('#q').oninput = show; show();
}

/* ---------- recipe ---------- */
async function recipe(id) {
  const r = await api('/api/recipes/' + id);
  const lang = I18n.lang;
  const base = Scale.parseYield(r.yield);
  let target = base, factor = 1;
  const checked = new Set();
  const sc = (line) => Scale.scaleLine(line, factor, { lang });
  const st = { r, sc: (l) => sc(l), checked };
  const facts = () => [[t('recipe.prep'), mins(r.prepMinutes)], [t('recipe.cook'), mins(r.cookMinutes)], [t('recipe.total'), mins(r.totalMinutes)], [t('recipe.serves'), r.yield ? sc(r.yield) : null]].filter((x) => x[1]);

  app.innerHTML = `
    <a class="back" href="#/">${t('recipe.back')}</a>
    ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : ''}
    <h1 class="rtitle">${esc(r.title)}</h1>
    ${r.description ? `<p class="rdesc">${esc(r.description)}</p>` : ''}
    <div class="facts" id="facts"></div>
    <div class="cta"><button class="primary" id="cookBtn">${t('recipe.cookBtn')}</button><button id="toList">${t('recipe.toList')}</button><button class="quiet" id="del">${t('recipe.delete')}</button></div>
    <div class="rbody">
      <aside><h2 class="sec">${t('recipe.ingredients')}</h2><div class="scaler" id="scaler"></div><ul class="ing" id="ing"></ul></aside>
      <section><h2 class="sec">${t('recipe.method')}</h2><ol class="steps">${r.steps.map((s, n) => `<li>${stepHTML(s, n + 1)}</li>`).join('')}</ol>
        <h2 class="sec" style="margin-top:26px">${t('recipe.notes')}</h2><textarea id="notes" placeholder="${esc(t('recipe.notesPh'))}">${esc(r.notes)}</textarea></section>
    </div>`;

  const draw = () => {
    factor = base ? target / base : factor;
    $('#facts').innerHTML = facts().map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join('') +
      `<div class="src">${t('recipe.from')} ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.host)}</a>` : esc(r.host)}</div>`;
    $('#ing').innerHTML = r.ingredients.map((i, n) => `<li><label><input type="checkbox" data-n="${n}" ${checked.has(n) ? 'checked' : ''}><span>${esc(sc(i))}</span></label></li>`).join('');
    $('#ing').querySelectorAll('input').forEach((c) => (c.onchange = () => (c.checked ? checked.add(+c.dataset.n) : checked.delete(+c.dataset.n))));
    const box = $('#scaler');
    if (base) {
      const shown = Number.isInteger(target) ? target : Math.round(target * 10) / 10;
      box.innerHTML = `<b>${t('recipe.servings')}</b><button class="step" id="dec" aria-label="${esc(t('recipe.decrease'))}">−</button><span class="val">${shown}</span><button class="step" id="inc" aria-label="${esc(t('recipe.increase'))}">+</button>
        ${target !== base ? `<small>${t('recipe.original', { n: base })} <button class="quiet" id="rst" style="min-height:32px;padding:0 8px">${t('recipe.reset')}</button></small>` : ''}`;
      $('#dec').onclick = () => { target = Math.max(1, Math.round(target) - 1); draw(); };
      $('#inc').onclick = () => { target = Math.round(target) + 1; draw(); };
      $('#rst')?.addEventListener('click', () => { target = base; draw(); });
    } else {
      box.innerHTML = `<b>${t('recipe.scaleBy')}</b>` + [[0.5, '½×'], [1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']].map(([f, l]) => `<button class="mult ${f === factor ? 'on' : ''}" data-f="${f}">${l}</button>`).join('');
      box.querySelectorAll('.mult').forEach((b) => (b.onclick = () => { factor = +b.dataset.f; draw(); }));
    }
  };
  draw();

  let tm; $('#notes').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => api('/api/recipes/' + id, { method: 'PUT', body: { notes: e.target.value } }), 600); };
  $('#del').onclick = async () => { if (confirm(t('recipe.confirmDelete'))) { await api('/api/recipes/' + id, { method: 'DELETE' }); location.hash = '#/'; } };
  $('#cookBtn').onclick = () => cook(st);
  $('#toList').onclick = async () => {
    const ls = await api('/api/lists');
    const lines = r.ingredients.map((i, n) => (checked.has(n) ? null : sc(i))).filter(Boolean);
    let to = ls[0];
    if (ls.length > 1) { const pick = prompt(t('recipe.pickList') + '\n' + ls.map((l, n) => `${n + 1}. ${listName(l)}`).join('\n'), '1'); if (!pick) return; to = ls[+pick - 1] || ls[0]; }
    await api(`/api/recipes/${id}/to-list`, { method: 'POST', body: { listId: to.id, ingredients: lines } });
    $('#toList').textContent = t('recipe.added', { n: lines.length, list: listName(to) });
  };
}

/* ---------- cook mode ---------- */
let wake = null;
const lockScreen = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.classList.contains('cooking')) lockScreen(); });

function cook(st) {
  const el = $('#cook');
  const steps = st.r.steps.length ? st.r.steps : [''];
  let i = 0, ingOpen = false, panel = false;
  document.body.classList.add('cooking'); el.classList.add('on'); lockScreen();

  const close = () => { el.classList.remove('on'); document.body.classList.remove('cooking'); wake?.release(); document.removeEventListener('keydown', key); el.innerHTML = ''; };
  const go = (n) => { i = Math.min(steps.length - 1, Math.max(0, n)); panel = false; draw(); };
  const key = (e) => { if (e.target.matches('input,textarea')) return; if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === 'Escape') close(); };

  function draw() {
    const last = i === steps.length - 1;
    el.innerHTML = `
      <div class="cook-top"><button id="cx" aria-label="${esc(t('cook.close'))}">${ic('close')}</button><div class="ttl">${esc(st.r.title)}</div>
        <button id="cookIngBtn" aria-label="${esc(t('cook.ingredients'))}">${ic('basket')}</button><button id="ctimer" aria-label="${esc(t('cook.addTimer'))}">${ic('timer')}</button></div>
      <div class="segs" aria-hidden="true">${steps.map((_, n) => `<i class="${n < i ? 'on' : n === i ? 'cur' : ''}"></i>`).join('')}</div>
      <div class="cook-main">
        <aside class="cook-ing ${ingOpen ? 'open' : ''}"><h2 class="sec">${t('cook.ingredients')}</h2><ul class="ing">${st.r.ingredients.map((x, n) => `<li><label><input type="checkbox" data-n="${n}" ${st.checked.has(n) ? 'checked' : ''}><span>${esc(st.sc(x))}</span></label></li>`).join('')}</ul></aside>
        <section class="cook-step" id="cstep"><div class="num">${t('cook.step', { n: i + 1, m: steps.length })}</div><div class="txt">${stepHTML(steps[i], i + 1)}</div></section>
      </div>
      <div class="cook-nav"><button id="cp" ${i ? '' : 'disabled'}>${t('cook.back')}</button><button class="primary" id="cn">${last ? t('cook.finish') : t('cook.next')}</button></div>
      ${panel ? `<div class="addtimer"><b>${t('cook.presets')}</b><div class="presets">${[1, 5, 10, 15, 20, 30, 45, 60].map((m) => `<button data-m="${m}">${m} ${t('cook.minutes')}</button>`).join('')}</div>
        <form id="cform"><input type="number" min="1" max="600" inputmode="numeric" placeholder="${esc(t('cook.custom'))}" aria-label="${esc(t('cook.custom'))}" required><button class="primary">${t('cook.start')}</button></form></div>` : ''}`;
    $('#cx', el).onclick = close;
    $('#cp', el).onclick = () => go(i - 1);
    $('#cn', el).onclick = () => (last ? close() : go(i + 1));
    $('#cookIngBtn', el).onclick = () => { ingOpen = !ingOpen; $('.cook-ing', el).classList.toggle('open', ingOpen); };
    $('#ctimer', el).onclick = () => { panel = !panel; draw(); };
    el.querySelectorAll('.cook-ing input').forEach((c) => (c.onchange = () => (c.checked ? st.checked.add(+c.dataset.n) : st.checked.delete(+c.dataset.n))));
    el.querySelectorAll('.addtimer [data-m]').forEach((b) => (b.onclick = () => { Timers.add({ label: t('timer.label'), seconds: +b.dataset.m * 60 }); panel = false; draw(); }));
    $('#cform', el)?.addEventListener('submit', (e) => { e.preventDefault(); const m = +$('input', e.target).value; if (m > 0) { Timers.add({ label: t('timer.label'), seconds: Math.round(m * 60) }); panel = false; draw(); } });
    // swipe between steps
    let x0 = null;
    const stepEl = $('#cstep', el);
    stepEl.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stepEl.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 70) go(i + (dx < 0 ? 1 : -1)); }, { passive: true });
  }
  document.addEventListener('keydown', key);
  draw();
}

/* ---------- shopping lists ---------- */
let listTimer;
async function listsView(selected) {
  clearInterval(listTimer);
  let all = await api('/api/lists');
  let cur = all.find((l) => l.id === selected) || all[0];
  const draw = () => {
    const open = cur.items.filter((i) => !i.checked), done = cur.items.filter((i) => i.checked);
    const row = (i) => `<li class="${i.checked ? 'done' : ''}" data-id="${i.id}"><input type="checkbox" ${i.checked ? 'checked' : ''} aria-label="${esc(i.name)}"><span class="n">${esc(i.name)}${i.quantity ? ' ' + esc(i.quantity) : ''}${i.details ? `<small>${esc(i.details)}</small>` : ''}</span><button class="x" aria-label="${esc(t('lists.remove'))}">${ic('close')}</button></li>`;
    app.innerHTML = `
      <div class="tabs">${all.map((l) => `<button data-l="${l.id}" class="${l.id === cur.id ? 'on' : ''}">${esc(listName(l))}</button>`).join('')}<button class="quiet" id="newList">${t('lists.new')}</button></div>
      <form class="field" id="addItem" style="margin-bottom:12px"><input type="text" required placeholder="${esc(t('lists.addPh'))}" aria-label="${esc(t('lists.addPh'))}"><button class="primary">${t('lists.add')}</button></form>
      <ul class="items">${open.map(row).join('') || `<li class="muted">${t('lists.nothing')}</li>`}</ul>
      ${done.length ? `<h2 class="sec" style="margin-top:22px">${t('lists.inCart', { n: done.length })} <button class="quiet" id="clear">${t('lists.clear')}</button></h2><ul class="items">${done.map(row).join('')}</ul>` : ''}
      ${all.length > 1 ? `<p><button class="quiet" id="delList">${t('lists.delete')}</button></p>` : ''}`;
    app.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { cur = all.find((l) => l.id === b.dataset.l); draw(); }));
    $('#newList').onclick = async () => { const n = prompt(t('lists.newName')); if (!n) return; const l = await api('/api/lists', { method: 'POST', body: { name: n } }); all.push({ ...l, items: [] }); cur = all.at(-1); draw(); };
    $('#addItem').onsubmit = async (e) => { e.preventDefault(); const name = $('input', e.target).value.trim(); if (!name) return; cur = await api(`/api/lists/${cur.id}/items`, { method: 'POST', body: { name } }); all[all.findIndex((l) => l.id === cur.id)] = cur; draw(); $('#addItem input').focus(); };
    app.querySelectorAll('ul.items li[data-id]').forEach((li) => {
      const id = li.dataset.id;
      $('input', li).onchange = async (e) => { const it = cur.items.find((x) => x.id === id); it.checked = e.target.checked; draw(); await api(`/api/lists/${cur.id}/items/${id}`, { method: 'PATCH', body: { checked: it.checked } }); };
      $('.x', li).onclick = async () => { cur.items = cur.items.filter((x) => x.id !== id); draw(); await api(`/api/lists/${cur.id}/items/${id}`, { method: 'DELETE' }); };
    });
    $('#clear')?.addEventListener('click', async () => { cur = await api(`/api/lists/${cur.id}/clear-checked`, { method: 'POST' }); all[all.findIndex((l) => l.id === cur.id)] = cur; draw(); });
    $('#delList')?.addEventListener('click', async () => { if (!confirm(t('lists.confirmDelete', { name: listName(cur) }))) return; await api(`/api/lists/${cur.id}`, { method: 'DELETE' }); all = all.filter((l) => l.id !== cur.id); cur = all[0]; draw(); });
  };
  draw();
  listTimer = setInterval(async () => {
    if (!location.hash.startsWith('#/lists') || document.activeElement?.tagName === 'INPUT') return;
    try { const fresh = await api('/api/lists'); if (JSON.stringify(fresh) !== JSON.stringify(all)) { all = fresh; cur = all.find((l) => l.id === cur.id) || all[0]; draw(); } } catch { /* offline */ }
  }, 5000);
}

/* ---------- import ---------- */
let importTimer;
async function importView() {
  clearInterval(importTimer);
  app.innerHTML = `
    <h1 class="rtitle" style="margin-top:0">${t('import.title')}</h1>
    <div class="panel">
      <h2 class="sec">${t('import.anylist')}</h2>
      <p class="muted" style="margin:0 0 8px">${t('import.blurb')}</p>
      <form id="al">
        <label for="alm">${t('import.email')}</label><input id="alm" type="email" name="email" required autocomplete="off">
        <label for="alp">${t('import.password')}</label><input id="alp" type="password" name="password" required autocomplete="off">
        <div class="cta" style="margin:16px 0 0"><button class="primary" id="go">${t('import.start')}</button></div>
      </form>
      <div id="prog" hidden></div>
    </div>
    <p class="muted" style="max-width:540px">${t('import.note')}</p>`;
  const prog = $('#prog'), form = $('#al'), go = $('#go');
  const draw = (stt) => {
    if (stt.state === 'idle') return;
    form.hidden = stt.state === 'running';
    prog.hidden = false;
    const finished = stt.done + stt.failed + (stt.skipped || 0);
    const pct = stt.total ? Math.round((finished / stt.total) * 100) : 0;
    const label = { login: t('import.login'), fetching: t('import.fetching'), recipes: t('import.recipes', { n: finished, total: stt.total }), lists: t('import.lists'), done: t('import.done') }[stt.phase] || '';
    if (stt.state === 'error') prog.innerHTML = `<p class="err">${esc(I18n.err(stt.error))}</p>`;
    else prog.innerHTML = `<p style="margin:14px 0 0"><b>${esc(label)}</b></p><div class="bar"><i style="width:${stt.state === 'done' ? 100 : pct}%"></i></div>
      <div class="chips"><span class="chip">${t('import.cRecipes', { n: stt.done })}</span><span class="chip">${t('import.cPhotos', { n: stt.photos })}</span><span class="chip">${t('import.cLists', { n: stt.lists || 0 })}</span>${stt.failed ? `<span class="chip bad">${t('import.failed', { n: stt.failed })}</span>` : ''}${stt.skipped ? `<span class="chip">${t('import.skipped', { n: stt.skipped })}</span>` : ''}</div>
      ${(stt.errors || []).length ? `<ul class="err" style="font-size:15px">${stt.errors.map((e) => `<li>${esc(I18n.err(e))}</li>`).join('')}</ul>` : ''}
      ${stt.state === 'done' ? `<div class="cta"><a href="#/"><button class="primary" type="button">${t('import.view')}</button></a></div>` : ''}`;
    if (stt.state !== 'running') { clearInterval(importTimer); go.disabled = false; if (stt.state === 'error') form.hidden = false; }
  };
  const poll = async () => { try { draw(await api('/api/import/anylist/status')); } catch { /* retry on next tick */ } };
  const first = await api('/api/import/anylist/status');
  if (first.state === 'running') { draw(first); importTimer = setInterval(poll, 1000); }
  form.onsubmit = async (e) => {
    e.preventDefault(); go.disabled = true;
    const f = new FormData(form);
    try { await api('/api/import/anylist', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); form.reset(); prog.hidden = false; prog.innerHTML = `<p>${t('import.starting')}</p>`; form.hidden = true; importTimer = setInterval(poll, 1000); poll(); }
    catch (x) { prog.hidden = false; prog.innerHTML = `<p class="err">${esc(x.message)}</p>`; go.disabled = false; }
  };
}

/* ---------- footer: version and self-update ---------- */
async function footer() {
  const el = $('#foot');
  try {
    const u = await api('/api/update/status');
    const v = u.current && u.current !== 'bundled' ? u.current.slice(0, 7) : t('foot.builtin');
    if (!u.enabled) { el.innerHTML = `<span>${t('foot.version', { v: esc(v) })}</span><span>${t('foot.off')}</span>`; return; }
    const msg = { checking: t('foot.checking'), updated: t('foot.updated'), idle: t('foot.idle'), 'needs-rebuild': t('foot.rebuild') }[u.state] || esc(u.message || '');
    el.innerHTML = `<span>${t('foot.version', { v: esc(v) })}</span><span>${t('foot.auto')}</span>${msg ? `<span>${msg}</span>` : ''}<button id="chk">${t('foot.check')}</button>`;
    $('#chk').onclick = async () => {
      $('#chk').disabled = true;
      try { await api('/api/update/check', { method: 'POST', body: {} }); } catch (x) { el.textContent = x.message; return; }
      setTimeout(footer, 2500);
      setTimeout(() => location.reload(), 9000);
    };
  } catch { el.textContent = ''; }
}

/* ---------- router ---------- */
function route() {
  clearInterval(listTimer); clearInterval(importTimer);
  chrome(); dockSig = ''; renderDock();
  const m = location.hash.match(/^#\/r\/([\w-]+)/);
  (location.hash.startsWith('#/lists') ? listsView() : location.hash.startsWith('#/import') ? importView() : m ? recipe(m[1]) : home())
    .catch((e) => (app.innerHTML = `<p class="err">${esc(e.message)}</p>`));
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
route(); footer();
})();
