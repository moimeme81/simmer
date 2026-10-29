(() => {
'use strict';
const { $, t, esc, fold, api, mins, ic } = S;
const app = S.app;

/* ---------- chrome: nav, tab bar, language ---------- */
function chrome() {
  const h = location.hash;
  const cur = h.startsWith('#/lists') ? 'lists' : h.startsWith('#/plan') ? 'plan' : h.startsWith('#/import') ? 'import' : h.startsWith('#/account') ? 'account' : 'recipes';
  const items = [['recipes', '#/', 'book', t('nav.recipes')], ['plan', '#/plan', 'cal', t('nav.plan')], ['lists', '#/lists', 'list', t('nav.lists')], ['import', '#/import', 'import', t('nav.import')], ['account', '#/account', 'user', S.me ? S.me.name.split(' ')[0] : t('nav.account')]];
  $('#topnav').innerHTML = items.filter((x) => x[0] !== 'account').map(([id, href, , label]) => `<a href="${href}" ${id === cur ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  $('#whoami').innerHTML = S.me ? `<a href="#/account" ${cur === 'account' ? 'aria-current="page"' : ''}>${S.me.avatar ? S.avatar(S.me, 28) : ic('user')} ${esc(S.me.name.split(' ')[0])}</a>` : '';
  $('#tabbar').innerHTML = items.filter((x) => x[0] !== 'import').map(([id, href, icon, label]) => `<a href="${href}" ${id === cur ? 'aria-current="page"' : ''}>${ic(icon)}<span>${esc(id === 'account' ? t('nav.account') : label)}</span></a>`).join('');
  $('#lang').textContent = t('lang.other');
  document.documentElement.lang = I18n.lang;
}
S.chrome = chrome;
$('#lang').onclick = () => { I18n.set(I18n.lang === 'fr' ? 'en' : 'fr'); if (S.me) S.put('/api/me', { lang: I18n.lang }).catch(() => {}); route(); footer(); };

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
  Timers.add({ label: (curTitle ? short(curTitle) + ' · ' : '') + t('timer.stepLabel', { n: b.dataset.n, time: b.dataset.t }), seconds: +b.dataset.s });
  b.classList.add('started'); setTimeout(() => b.classList.remove('started'), 1500);
});

/* ---------- recipes being cooked right now (several at once) ---------- */
const sessions = {
  read() { try { return JSON.parse(localStorage.getItem('simmer-cooking') || '{}'); } catch { return {}; } },
  write(o) { try { localStorage.setItem('simmer-cooking', JSON.stringify(o)); } catch { /* private mode */ } renderCookBar(); },
  set(id, v) { const o = this.read(); o[id] = { ...o[id], ...v }; this.write(o); },
  end(id) { const o = this.read(); delete o[id]; this.write(o); },
};
let curTitle = '';
const short = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function renderCookBar() {
  let bar = $('#cookbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'cookbar'; $('.topbar').after(bar); bar.addEventListener('click', (e) => { const x = e.target.closest('[data-end]'); if (x) sessions.end(x.dataset.end); }); }
  const all = Object.entries(sessions.read());
  bar.hidden = !all.length;
  bar.innerHTML = all.length ? `<span class="muted">${t('cook.now')}</span>${all.map(([id, v]) => `<span class="cookchip"><a href="#/r/${id}/cook">${ic('timer')} ${esc(short(v.title, 30))} <small>${t('cook.step', { n: v.step + 1, m: v.total })}</small></a><button data-end="${id}" aria-label="${esc(t('cook.end'))}: ${esc(v.title)}">${ic('close')}</button></span>`).join('')}` : '';
}

/* ---------- home ---------- */
const TILES = ['#1F4E96', '#2F7D6B', '#7A4B8F', '#B8741A', '#4F6B2E', '#9B3D52'];
const tileOf = (id) => TILES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length];

async function home() {
  app.innerHTML = `
    <div class="finder">
      <form class="field" id="imp"><input type="url" required placeholder="${esc(t('home.placeholder'))}" aria-label="${esc(t('home.placeholder'))}"><button class="primary">${t('home.import')}</button></form>
      <div class="err" id="imperr" hidden></div>
      <div class="row" style="margin-bottom:8px"><button id="newRecipe" type="button">${ic('plus')} ${t('home.new')}</button></div>
      <div class="field"><input type="search" id="q" placeholder="${esc(t('home.search'))}" aria-label="${esc(t('home.search'))}"></div>
    </div>
    <div class="chips filters" id="cols" role="group" aria-label="${esc(t('col.title'))}"></div>
    <p class="count" id="count"></p><div id="cards"></div>`;
  const form = $('#imp'), err = $('#imperr');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', form); btn.disabled = true; btn.textContent = t('home.importing'); err.hidden = true;
    try { const r = await api('/api/import', { method: 'POST', body: { url: $('input', form).value } }); location.hash = '#/r/' + r.id; }
    catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = t('home.import'); }
  };
  $('#newRecipe').onclick = () => S.recipeEditor(null, (r) => (location.hash = '#/r/' + r.id));
  const all = await api('/api/recipes');
  let col = ''; try { col = localStorage.getItem('simmer-col') || ''; } catch { /* private mode */ }
  const names = () => {
    const used = [...new Set(all.flatMap((r) => r.collections || []))].sort((a, b) => a.localeCompare(b, I18n.lang));
    return [...new Set([...(S.me.collections || []), ...used])];   // your own order first
  };
  if (col && !names().includes(col)) col = '';
  const manage = () => {
    const rows = names().map((n) => ({ was: n, name: n }));
    const count = (n) => all.filter((r) => (r.collections || []).includes(n)).length;
    S.modal('<div id="mb"></div>', (el, close) => {
      const render = () => {
        $('#mb', el).innerHTML = `<h2 class="sec">${t('col.manage')}</h2><p class="muted">${t('col.help')}</p><form id="mf2" class="stack">
          <ol class="order cats">${rows.map((x, n) => `<li><input data-n="${n}" value="${esc(x.name)}" maxlength="40" aria-label="${esc(t('col.rename'))}"><small class="muted">${x.was ? count(x.was) : 0}</small>
            <span class="row"><button type="button" class="quiet" data-up="${n}" ${n ? '' : 'disabled'} aria-label="${esc(t('lists.up'))}">${ic('up')}</button><button type="button" class="quiet" data-down="${n}" ${n < rows.length - 1 ? '' : 'disabled'} aria-label="${esc(t('lists.down'))}">${ic('down')}</button><button type="button" class="quiet" data-del="${n}" aria-label="${esc(t('col.delete'))}">${ic('close')}</button></span></li>`).join('')}</ol>
          <div class="row"><input id="nn" maxlength="40" placeholder="${esc(t('col.newPh'))}" aria-label="${esc(t('col.add2'))}"><button type="button" id="nb">${t('col.add2')}</button></div>
          <p class="err" id="me" hidden></p>
          <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('share.save')}</button></div></form>`;
        const sync = () => el.querySelectorAll('[data-n]').forEach((i) => (rows[+i.dataset.n].name = i.value.trim()));
        $('[data-x]', el).onclick = close;
        const add = () => { sync(); const v = $('#nn', el).value.trim(); if (v && !rows.some((x) => x.name === v)) rows.push({ was: '', name: v }); render(); };
        $('#nb', el).onclick = add; $('#nn', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
        const move = (n, d) => { sync(); [rows[n], rows[n + d]] = [rows[n + d], rows[n]]; render(); };
        el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(+b.dataset.up, -1)));
        el.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(+b.dataset.down, 1)));
        el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
          sync(); const x = rows[+b.dataset.del];
          if (x.was && count(x.was) && !confirm(t('col.confirmDelete', { name: x.was }))) return;
          rows.splice(+b.dataset.del, 1); render(); (el.querySelector('#mb')); gone.push(x.was);
        }));
        $('#mf2', el).onsubmit = async (e) => {
          e.preventDefault(); sync();
          try {
            for (const g of gone) if (g && !rows.some((x) => x.was === g)) await S.post('/api/collections/delete', { name: g });
            for (const x of rows) if (x.was && x.name && x.name !== x.was) await S.post('/api/collections/rename', { from: x.was, to: x.name });
            await S.put('/api/collections', { names: rows.map((x) => x.name).filter(Boolean) });
            await S.refreshMe(); close(); home();
          } catch (x) { $('#me', el).textContent = x.message; $('#me', el).hidden = false; }
        };
      };
      const gone = [];
      render();
    });
  };
  const drawCols = () => {
    const ns = names();
    $('#cols').innerHTML = ns.length ? [['', t('col.all'), all.length], ...ns.map((n) => [n, n, all.filter((r) => (r.collections || []).includes(n)).length])]
      .map(([id, label, n]) => `<button class="fchip ${col === id ? 'on' : ''}" data-c="${esc(id)}">${esc(label)} <small>${n}</small></button>`).join('') : '';
    $('#cols').insertAdjacentHTML('beforeend', `<button class="quiet" id="colManage">${ic('gear')} ${t('col.manage')}</button>`);
    $('#colManage').onclick = manage;
    if (col && S.me.linkedSimmers) { $('#cols').insertAdjacentHTML('beforeend', S.remoteShareButton('collection', col, col, 'quiet')); S.wireRemoteShare($('#cols')); }
    $('#cols').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { col = b.dataset.c; try { localStorage.setItem('simmer-col', col); } catch { /* private mode */ } drawCols(); show(); }));
  };
  const show = () => {
    const q = fold($('#q').value.trim());
    const inCol = col ? all.filter((r) => (r.collections || []).includes(col)) : all;
    const list = q ? inCol.filter((r) => fold(r.title).includes(q) || r.ingredients.some((i) => fold(i).includes(q))) : inCol;
    $('#count').textContent = all.length ? (q ? '' : t('home.count', { n: inCol.length })) : '';
    $('#cards').innerHTML = !all.length
      ? `<div class="empty"><img src="icon-192.png" alt=""><h2 class="sec">${t('home.emptyTitle')}</h2><p>${t('home.empty')}</p></div>`
      : !list.length ? `<p class="empty">${t('home.noMatch', { q: esc($('#q').value) })}</p>`
      : `<div class="grid">${list.map((r) => `<a class="rcard" href="#/r/${r.id}"><div class="pic" style="--tile:${tileOf(r.id)};${r.image ? `background-image:url('${esc(r.image)}')` : ''}">${r.image ? '' : esc([...r.title][0] || '')}</div><b>${esc(r.title)}</b><small>${esc(r.host)}</small></a>`).join('')}</div>`;
  };
  $('#q').oninput = show; drawCols(); show();
}

/* ---------- recipe ---------- */
async function recipe(id, opts = {}) {
  const [r, meal] = await Promise.all([api('/api/recipes/' + id), opts.meal ? api('/api/meals/' + opts.meal).catch(() => null) : null]);
  const forMeal = meal && meal.recipeId === id ? meal : null;
  curTitle = r.title;
  const lang = I18n.lang;
  const base = Scale.parseYield(r.yield);
  let target = forMeal?.servings && base ? forMeal.servings : base, factor = 1;
  const checked = new Set();
  const page = (S.me?.cookStyle || 'focus') === 'page';
  let cookingHere = !!opts.cook && page;     // in "on the page" mode the page becomes the cooking screen
  const sc = (line) => Scale.scaleLine(line, factor, { lang });
  let unitMode = null;   // null = my own measurement settings; otherwise 'orig' | 'metric' | 'imperial' | 'both' for this view only
  const prefs = () => (unitMode ? { mass: unitMode, vol: unitMode, len: unitMode, temp: unitMode } : S.me?.units);
  const cv = (line) => Scale.convertLine(line, prefs(), { lang });
  const view = (line) => cv(sc(line));
  const st = { r, sc: (l) => view(l), cv: (l) => cv(l), checked };
  const mealDate = forMeal ? S.dateLabel(S.parseYmd(forMeal.date), { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const facts = () => [[t('recipe.prep'), mins(r.prepMinutes)], [t('recipe.cook'), mins(r.cookMinutes)], [t('recipe.total'), mins(r.totalMinutes)], [t('recipe.serves'), r.yield ? sc(r.yield) : null]].filter((x) => x[1]);

  app.innerHTML = `
    <a class="back" href="#/">${t('recipe.back')}</a>
    ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">${r.imageCredit ? `<small class="muted credit">${t('photo.credit')} ${esc(r.imageCredit)}</small>` : ''}${r.mine ? `<button class="quiet changephoto" id="webPhoto">${ic('search')} ${t('photo.change')}</button>` : ''}` : r.mine ? `<div class="nophoto">${ic('image')}<span>${t('photo.missingHere')}</span>${/^https?:/.test(r.sourceUrl || '') ? `<button id="findPhoto">${t('photo.find')}</button>` : ''}<button id="webPhoto">${ic('search')} ${t('photo.search')}</button><small class="err" id="fpErr" hidden></small></div>` : ''}
    <h1 class="rtitle">${esc(r.title)}</h1>
    ${forMeal ? `<p class="mealbanner">${ic('cal')} <span>${esc(t('recipe.forMeal', { date: mealDate, slot: t('slot.' + forMeal.slot) }))}${forMeal.servings ? ' · ' + esc(t('recipe.mealServings', { n: forMeal.servings })) : ''}</span></p>` : ''}
    ${r.description ? `<p class="rdesc">${esc(r.description)}</p>` : ''}
    <div class="chips colrow" id="colrow"></div>
    <div class="facts" id="facts"></div>
    <div class="cta"><button class="primary" id="cookBtn"></button><button id="toList">${ic('basket')} ${t('recipe.toList')}</button><button id="toPlan">${ic('cal')} ${t('recipe.toPlan')}</button><button id="printBtn">${ic('print')} ${t('print.button')}</button>${r.mine ? `<button id="editBtn">${ic('edit')} ${t('recipe.edit')}</button><button id="shareBtn">${ic('share')} ${t('share.button')}</button><button class="quiet" id="del">${t('recipe.delete')}</button>` : ''}</div>
    <p class="muted sharedline" id="sharedline">${esc(r.mine ? S.shareText(r) : t('recipe.guest', { name: r.ownerName }))}</p>
    <div class="rbody">
      <aside><h2 class="sec">${t('recipe.ingredients')}</h2><div class="scaler" id="scaler"></div><div class="unitbox" id="unitbox" role="group" aria-label="${esc(t('units.view'))}"></div><ul class="ing" id="ing"></ul></aside>
      <section><h2 class="sec">${t('recipe.method')}</h2><ol class="steps" id="steps"></ol>
        <h2 class="sec" style="margin-top:26px">${t('recipe.notes')}</h2><textarea id="notes" placeholder="${esc(t('recipe.notesPh'))}">${esc(r.notes)}</textarea></section>
    </div>
    <p class="printonly pfoot">${esc(t('print.footer', { date: new Date().toLocaleDateString(I18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) }))}</p>`;

  const drawCook = () => {
    $('#cookBtn').innerHTML = cookingHere ? t('cook.finish') : t('recipe.cookBtn');
    $('#steps').innerHTML = r.steps.map((s, n) => `<li>${cookingHere ? stepHTML(cv(s), n + 1) : esc(cv(s))}</li>`).join('');
    $('#ing').classList.toggle('plain-ing', !cookingHere);
    $('#ing').innerHTML = r.ingredients.map((i, n) => cookingHere
      ? `<li><label><input type="checkbox" data-n="${n}" ${checked.has(n) ? 'checked' : ''}><span>${esc(view(i))}</span></label></li>`
      : `<li><span>${esc(view(i))}</span></li>`).join('');
    $('#ing').querySelectorAll('input').forEach((c) => (c.onchange = () => (c.checked ? checked.add(+c.dataset.n) : checked.delete(+c.dataset.n))));
  };
  const draw = () => {
    factor = base ? target / base : factor;
    $('#facts').innerHTML = facts().map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join('') +
      (r.host || r.sourceUrl ? `<div class="src">${t('recipe.from')} ${r.sourceUrl ? `<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.host)}</a>` : esc(r.host)}</div>` : '');
    drawCook();
    $('#unitbox').innerHTML = `<small class="muted">${t('units.view')}</small>` + [[null, 'units.mine'], ['orig', 'units.orig'], ['metric', 'units.metric'], ['imperial', 'units.imperial'], ['both', 'units.both']].map(([v, k]) => `<button type="button" class="mult ${unitMode === v ? 'on' : ''}" data-u="${v || ''}">${t(k)}</button>`).join('');
    $('#unitbox').querySelectorAll('button').forEach((b) => (b.onclick = () => { unitMode = b.dataset.u || null; draw(); }));
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
  if (cookingHere) sessions.set(id, { title: r.title, step: 0, total: r.steps.length || 1 });
  const drawCols = () => {
    $('#colrow').innerHTML = (r.collections || []).map((c) => `<span class="chip">${esc(c)}</span>`).join('') + (r.mine ? `<button class="quiet" id="colEdit">${ic('plus')} ${t(r.collections?.length ? 'col.edit' : 'col.add')}</button>` : '');
    $('#colEdit')?.addEventListener('click', async () => {
      await S.refreshMe();
      const known = [...new Set([...(S.me.collections || []), ...(await api('/api/recipes')).flatMap((x) => x.collections || [])])];
      const mineNow = new Set(r.collections || []);
      S.modal(`<h2 class="sec">${t('col.title')}</h2><form id="cf" class="stack">${known.map((n) => `<label class="pick"><input type="checkbox" value="${esc(n)}" ${mineNow.has(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}
        <label for="cn">${t('col.new')}</label><input id="cn" maxlength="40" autocomplete="off" placeholder="${esc(t('col.newPh'))}">
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('share.save')}</button></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('#cf', el).onsubmit = async (e) => {
          e.preventDefault();
          const picked = [...el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value), extra = $('#cn', el).value.trim();
          const u = await api('/api/recipes/' + id, { method: 'PUT', body: { collections: extra ? [...picked, extra] : picked } });
          r.collections = u.collections; close(); drawCols();
        };
      });
    });
  };
  drawCols();

  let tm; $('#notes').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => api('/api/recipes/' + id, { method: 'PUT', body: { notes: e.target.value } }), 600); };
  $('#editBtn')?.addEventListener('click', () => S.recipeEditor(r, () => recipe(id, opts)));
  $('#del')?.addEventListener('click', async () => { if (confirm(t('recipe.confirmDelete'))) { await api('/api/recipes/' + id, { method: 'DELETE' }); location.hash = '#/'; } });
  $('#toPlan').onclick = () => S.mealSheet({ recipe: r, date: S.ymd(new Date()) }, () => { $('#toPlan').textContent = t('share.save') + ' ✓'; });
  $('#printBtn').onclick = () => S.printPage(r.title);
  $('#shareBtn')?.addEventListener('click', () => S.shareDialog(r, async (share) => { const u = await S.put(`/api/recipes/${id}/share`, share); r.sharedWith = u.sharedWith; $('#sharedline').textContent = S.shareText(r); }));
  $('#webPhoto')?.addEventListener('click', () => S.photoPicker(r.title, async (p) => {
    try { await S.post(`/api/recipes/${id}/image-from-url`, { url: p.url, alt: p.alt, credit: p.credit }); recipe(id, opts); }
    catch (x) { $('#fpErr').textContent = x.message; $('#fpErr').hidden = false; }
  }));
  $('#findPhoto')?.addEventListener('click', async (e) => {
    const b = e.target; b.disabled = true; b.textContent = t('photo.finding'); $('#fpErr').hidden = true;
    try { await S.post(`/api/recipes/${id}/find-photo`); recipe(id, opts); }
    catch (x) {
      b.disabled = false; b.textContent = t('photo.find'); $('#fpErr').textContent = x.message; $('#fpErr').hidden = false;
      $('#webPhoto')?.click();   // the source site would not give a picture: search the web instead
    }
  });

  /* Start cooking: full screen or on this page, whichever the person chose in their account. */
  $('#cookBtn').onclick = () => {
    if (!page) return cook(st);
    cookingHere = !cookingHere;
    if (cookingHere) sessions.set(id, { title: r.title, step: 0, total: r.steps.length || 1 }); else sessions.end(id);
    drawCook();
  };
  if (opts.cook) { history.replaceState(null, '', '#/r/' + id + (opts.meal ? '?meal=' + opts.meal : '')); if (!page) cook(st); }

  /* Add ingredients to lists: pick a list first, then the ingredients for it. Repeat for other lists. */
  const added = {};   // ingredient index -> names of lists it went to
  $('#toList').onclick = async () => {
    const lists = await api('/api/lists');
    const note = forMeal ? t('recipe.forDate', { date: mealDate }) : '';
    let justAdded = '';
    S.modal('<div id="tlb"></div>', (el, close) => {
      const body = $('#tlb', el);
      const chooseList = () => {
        body.innerHTML = `<h2 class="sec">${t('recipe.toList')}</h2>
          <p class="muted" style="margin:0 0 10px">${esc(forMeal ? t('recipe.pickWhichMeal', { date: mealDate, n: Math.round(target) || '' }) : t('recipe.pickWhich'))}</p>
          ${justAdded ? `<p class="ok">${esc(justAdded)}</p>` : ''}
          <div class="stack pickl">${lists.map((l) => `<button class="pickrow" data-l="${l.id}">${S.listBadge(l, 36)}<span>${esc(S.listName(l))}</span></button>`).join('')}</div>
          <div class="row end" style="margin-top:12px"><button class="primary" data-x>${t('recipe.listDone')}</button></div>`;
        $('[data-x]', body).onclick = close;
        body.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => chooseItems(lists.find((l) => l.id === b.dataset.l))));
      };
      const chooseItems = (to) => {
        body.innerHTML = `<div class="row"><button class="quiet" data-back aria-label="${esc(t('recipe.backToLists'))}">${ic('back')}</button><h2 class="sec" style="margin:0">${S.listBadge(to, 28)} ${esc(S.listName(to))}</h2></div>
          <p class="muted" style="margin:8px 0">${esc(t('recipe.pickItems'))}${note ? ' · ' + esc(note) : ''}</p>
          <div class="row"><button type="button" class="quiet" data-all>${t('recipe.selectAll')}</button><button type="button" class="quiet" data-none>${t('recipe.selectNone')}</button></div>
          <ul class="ing pickings">${r.ingredients.map((i, n) => `<li><label><input type="checkbox" data-n="${n}"><span>${esc(view(i))}</span></label>${added[n]?.length ? `<small class="chip soft">✓ ${esc(added[n].join(', '))}</small>` : ''}</li>`).join('')}</ul>
          <div class="row end" style="margin-top:12px"><button class="primary" id="addN" disabled></button></div>`;
        const boxes = [...body.querySelectorAll('input[type=checkbox]')];
        const sync = () => { const n = boxes.filter((c) => c.checked).length; const b = $('#addN', body); b.disabled = !n; b.textContent = t('recipe.addN', { n, list: S.listName(to) }); };
        boxes.forEach((c) => (c.onchange = sync));
        $('[data-all]', body).onclick = () => { boxes.forEach((c) => (c.checked = true)); sync(); };
        $('[data-none]', body).onclick = () => { boxes.forEach((c) => (c.checked = false)); sync(); };
        $('[data-back]', body).onclick = chooseList;
        $('#addN', body).onclick = async () => {
          const picked = boxes.filter((c) => c.checked).map((c) => +c.dataset.n);
          $('#addN', body).disabled = true;
          const fresh = await api(`/api/recipes/${id}/to-list`, { method: 'POST', body: { listId: to.id, ingredients: picked.map((n) => view(r.ingredients[n])), note } });
          lists[lists.findIndex((l) => l.id === to.id)] = fresh;
          for (const n of picked) (added[n] = added[n] || []).push(S.listName(to));
          justAdded = t('recipe.added', { n: picked.length, list: S.listName(to) });
          chooseList();
        };
        sync();
      };
      chooseList();
    });
  };
}

/* ---------- cook mode ---------- */
let wake = null;
const lockScreen = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
document.addEventListener('visibilitychange', () => { if (!document.hidden && document.body.classList.contains('cooking')) lockScreen(); });

function cook(st) {
  const el = $('#cook');
  const steps = st.r.steps.length ? st.r.steps.map((x) => st.cv(x)) : [''];
  const rid = st.r.id, resumed = sessions.read()[rid];
  let i = Math.min(Math.max(0, resumed?.step || 0), steps.length - 1), ingOpen = false, panel = false;
  curTitle = st.r.title;
  const remember = () => sessions.set(rid, { title: st.r.title, step: i, total: steps.length });
  remember();
  document.body.classList.add('cooking'); el.classList.add('on'); lockScreen();

  const close = () => { el.classList.remove('on'); document.body.classList.remove('cooking'); wake?.release(); document.removeEventListener('keydown', key); el.innerHTML = ''; };
  const go = (n) => { i = Math.min(steps.length - 1, Math.max(0, n)); panel = false; remember(); draw(); };
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
    $('#cn', el).onclick = () => (last ? (sessions.end(rid), close()) : go(i + 1));
    $('#cookIngBtn', el).onclick = () => { ingOpen = !ingOpen; $('.cook-ing', el).classList.toggle('open', ingOpen); };
    $('#ctimer', el).onclick = () => { panel = !panel; draw(); };
    el.querySelectorAll('.cook-ing input').forEach((c) => (c.onchange = () => (c.checked ? st.checked.add(+c.dataset.n) : st.checked.delete(+c.dataset.n))));
    el.querySelectorAll('.addtimer [data-m]').forEach((b) => (b.onclick = () => { Timers.add({ label: (curTitle ? short(curTitle) + ' · ' : '') + t('timer.label'), seconds: +b.dataset.m * 60 }); panel = false; draw(); }));
    $('#cform', el)?.addEventListener('submit', (e) => { e.preventDefault(); const m = +$('input', e.target).value; if (m > 0) { Timers.add({ label: (curTitle ? short(curTitle) + ' · ' : '') + t('timer.label'), seconds: Math.round(m * 60) }); panel = false; draw(); } });
    // swipe between steps
    let x0 = null;
    const stepEl = $('#cstep', el);
    stepEl.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stepEl.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 70) go(i + (dx < 0 ? 1 : -1)); }, { passive: true });
  }
  document.addEventListener('keydown', key);
  draw();
}

/* ---------- import ---------- */
let importTimer;
/** Recipes saved without a picture: Simmer keeps looking at their source page. */
async function photoCard() {
  const box = $('#photos');
  if (!box) return;
  const draw = (p) => {
    if (!$('#photos')) return;
    box.innerHTML = `<h2 class="sec">${t('photo.title')}</h2><p class="muted" style="margin:0 0 8px">${t(p.enabled ? 'photo.blurb' : 'photo.off')}</p>
      <p style="margin:6px 0"><b>${esc(p.missing ? t('photo.missing', { n: p.missing }) : t('photo.allGood'))}</b>${p.lastRun ? ` <span class="muted">· ${esc(t('photo.last', { n: p.lastFound || 0 }))}</span>` : ''}</p>
      ${p.missing ? `<div class="cta" style="margin:10px 0 0"><button class="primary" id="pgo" ${p.running ? 'disabled' : ''}>${t(p.running ? 'photo.running' : 'photo.run')}</button></div>` : ''}
      <p class="err" id="perr" hidden></p>`;
    $('#pgo')?.addEventListener('click', async () => {
      try { await S.post('/api/photos/check'); } catch (x) { $('#perr').textContent = x.message; $('#perr').hidden = false; return; }
      const tick = async () => { const n = await api('/api/photos/status'); draw(n); if (n.running && $('#photos')) setTimeout(tick, 1200); };
      draw({ ...p, running: true }); setTimeout(tick, 1200);
    });
  };
  try { draw(await api('/api/photos/status')); } catch { box.hidden = true; }
}
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
    <p class="muted" style="max-width:540px">${t('import.note')}</p>
    <div class="panel" id="photos" style="margin-top:18px"></div>
    <h1 class="rtitle" style="margin-top:28px">${t('xch.title')}</h1><div id="exch"></div>`;
  photoCard();
  S.exchangePanel($('#exch'));
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

/* ---------- router and boot ---------- */
/** Banner for admins when another Simmer has asked to link. Checked on every page change and once a minute. */
function noticeDraw() {
  const el = $('#notice');
  if (!el) return;
  const n = S.me?.pendingLinks || 0;
  el.hidden = !n || location.hash.startsWith('#/account');
  el.innerHTML = n ? `<a href="#/account">${ic('globe')} ${t('fed.notice', { n })}</a>` : '';
}
async function notice() {
  noticeDraw();
  if (!S.me?.admin) return;
  try { const me = await api('/api/me'); if (S.me) { S.me.pendingLinks = me.pendingLinks; S.me.linkedSimmers = me.linkedSimmers; noticeDraw(); } } catch { /* offline */ }
}
setInterval(() => { if (!document.hidden) notice(); }, 60_000);
function route() {
  S.stopLists?.(); clearInterval(importTimer);
  const h = location.hash;
  const join = h.match(/^#\/join\/([\w-]+)/);
  if (join && !S.me) { S.authScreen('join', join[1]); return; }
  chrome(); notice(); dockSig = ''; renderDock(); renderCookBar();
  const m = h.match(/^#\/r\/([\w-]+)(\/cook)?(?:\?meal=([\w-]+))?/);
  const view = h.startsWith('#/lists') ? () => S.views.lists((h.match(/^#\/lists\/([\w-]+)/) || [])[1]) : h.startsWith('#/plan') ? () => S.views.plan() : h.startsWith('#/account') ? () => S.views.account()
    : h.startsWith('#/import') ? importView : m ? () => recipe(m[1], { cook: !!m[2], meal: m[3] }) : home;
  view().catch((e) => (app.innerHTML = `<p class="err">${esc(e.message)}</p>`));
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

S.onSignedOut = () => { if (S.me) { S.me = null; S.boot(); } };
S.boot = async () => {
  const st = await api('/api/auth/state');
  if (st.setup) { S.me = null; document.body.classList.add('auth'); return S.authScreen('setup'); }
  if (!st.user) { S.me = null; document.body.classList.add('auth'); const j = location.hash.match(/^#\/join\/([\w-]+)/); return S.authScreen(j ? 'join' : 'login', j && j[1]); }
  document.body.classList.remove('auth');
  await S.refreshMe();
  if (st.user.lang && !localStorage.getItem('simmer-lang')) I18n.set(st.user.lang);
  route(); footer();
};
S.boot().catch((e) => (app.innerHTML = `<p class="err">${esc(e.message)}</p>`));
})();
