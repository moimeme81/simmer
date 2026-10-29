/* Meal plan: a week at a time. Any meal can be shared with specific people, and shows up in their plan too. */
(() => {
  'use strict';
  const { $, t, esc, api, ic } = S;
  const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let weekStart = mondayOf(new Date());
  let recipes = null;
  const loadRecipes = async () => (recipes = recipes || (await api('/api/recipes')));
  const yieldNumber = (y) => Scale.parseYield(y);

  /** Add or edit a meal. opts: { meal } to edit, or { date, recipe } to create. onDone() refreshes the caller. */
  S.mealSheet = async (opts, onDone) => {
    const list = await loadRecipes();
    const m = opts.meal;
    const mine = !m || m.mine;
    const recipeId = m ? m.recipeId : opts.recipe?.id || null;
    const startTitle = m ? m.title : opts.recipe?.title || '';
    const share = m ? m.sharedWith : { users: [], households: (S.me.autoShare || []) };
    const date = m ? m.date : opts.date || S.ymd(new Date());
    S.modal(`<h2 class="sec">${t(m ? 'meal.editTitle' : 'meal.newTitle')}</h2>
      <form id="mf" class="stack">
        <div class="two"><div><label for="md">${t('meal.date')}</label><input id="md" type="date" value="${date}" required ${mine ? '' : 'disabled'}></div>
          <div><label for="ms">${t('meal.slot')}</label><select id="ms" ${mine ? '' : 'disabled'}>${SLOTS.map((s) => `<option value="${s}" ${(m?.slot || 'dinner') === s ? 'selected' : ''}>${t('slot.' + s)}</option>`).join('')}</select></div></div>
        <label for="mt">${t('meal.what')}</label>
        <input id="mt" list="mrecipes" value="${esc(startTitle)}" autocomplete="off" required ${mine ? '' : 'disabled'}>
        <datalist id="mrecipes">${list.map((r) => `<option value="${esc(r.title)}"></option>`).join('')}</datalist>
        <small class="muted">${t('meal.whatHelp')}</small>
        <div class="two"><div><label for="mv">${t('meal.servings')}</label><input id="mv" type="number" min="1" max="100" step="1" value="${m?.servings || (opts.recipe ? yieldNumber(opts.recipe.yield) || '' : '')}" ${mine ? '' : 'disabled'}></div></div>
        <label for="mn">${t('meal.note')}</label><input id="mn" value="${esc(m?.note || '')}" ${mine ? '' : 'disabled'}>
        ${m && (m.attendees || []).length > 1 ? `<div class="who"><b>${t('meal.who')}</b><ul class="plain">${m.attendees.map((a) => `<li class="row">${S.avatar(a, 30)}<span>${esc(a.you ? t('acct.you') : a.name)}${a.id === m.owner ? ` <small class="muted">${t('meal.host')}</small>` : ''}</span></li>`).join('')}</ul></div>` : ''}
        ${mine ? `<h3 class="sub">${t('meal.share')}</h3><p class="muted" style="margin:0">${t('meal.shareHelp')}</p><div id="msh">${S.shareFields(share, 'meal')}</div>` : `<p class="muted">${t('meal.from', { name: m.ownerName })}</p>`}
        <p class="err" id="merr" hidden></p>
        <div class="row between wrap">
          <span class="row">${m ? `<button type="button" class="quiet" data-del>${t(mine ? 'meal.remove' : 'meal.removeMine')}</button>` : ''}${m?.recipe ? `<a class="btnlike" href="#/r/${m.recipe.id}" data-x>${t('meal.open')}</a>` : ''}</span>
          <span class="row"><button type="button" class="quiet" data-x>${t('share.cancel')}</button>${mine ? `<button class="primary">${t('share.save')}</button>` : ''}</span></div>
      </form>`, (el, close) => {
      el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
      $('[data-del]', el)?.addEventListener('click', async () => { await S.del('/api/meals/' + m.id); close(); onDone?.(); });
      // Picking a recipe fills in its servings.
      $('#mt', el).addEventListener('input', () => {
        const r = list.find((x) => x.title === $('#mt', el).value);
        if (r && !$('#mv', el).value) $('#mv', el).value = yieldNumber(r.yield) || '';
      });
      $('#mf', el).onsubmit = async (e) => {
        e.preventDefault();
        if (!mine) return;
        const text = $('#mt', el).value.trim();
        const r = list.find((x) => x.title === text);
        const body = {
          date: $('#md', el).value, slot: $('#ms', el).value, servings: $('#mv', el).value || null, note: $('#mn', el).value,
          ...S.readShare($('#msh', el), 'meal'),
          ...(r ? { recipeId: r.id, title: '' } : { recipeId: null, title: text }),
        };
        try {
          if (m) await S.put('/api/meals/' + m.id, body); else await S.post('/api/meals', body);
          close(); onDone?.();
        } catch (x) { const er = $('#merr', el); er.textContent = x.message; er.hidden = false; }
      };
    });
  };

  S.views.plan = async () => {
    const from = S.ymd(weekStart), to = S.ymd(addDays(weekStart, 6));
    const [meals] = await Promise.all([api(`/api/meals?from=${from}&to=${to}`), S.refreshMe()]);
    const todayStr = S.ymd(new Date());
    const days = Array.from({ length: 7 }, (_, n) => addDays(weekStart, n));
    const refresh = () => S.views.plan();
    const mealCard = (m) => {
      const hh = (m.householdNames || (m.sharedWith.households || []).map((h) => S.me.households.find((x) => x.id === h)?.name)).filter(Boolean);
      const people = (m.attendees || []).filter((a) => m.mine ? !a.you : !a.you && a.id !== m.owner);
      const withNames = [...people.map((a) => a.name), ...hh];
      return `<button class="meal ${m.mine ? '' : 'guest'}" data-m="${m.id}">
        <span class="slot">${t('slot.' + m.slot)}</span><b>${esc(m.title)}</b>
        ${m.servings ? `<small>${m.servings} ${esc(t('meal.servings').toLowerCase())}</small>` : ''}
        ${!m.mine ? `<small class="by">${esc(t('meal.from', { name: m.ownerName }))}${withNames.length ? esc(' · ' + t('meal.withLower', { names: withNames.join(', ') })) : ''}</small>` : ''}
        ${(m.attendees || []).length > 1 || hh.length ? `<span class="faces" title="${esc(t('meal.with', { names: [...(m.attendees || []).map((a) => a.you ? t('acct.you') : a.name), ...hh].join(', ') }))}">${(m.attendees || []).map((a) => S.avatar(a, 24)).join('')}${hh.map((n) => `<span class="hhtag">${esc(n)}</span>`).join('')}</span>` : ''}</button>`;
    };
    S.app.innerHTML = `
      <div class="row between wrap planhead">
        <h1 class="rtitle" style="margin:0;font-size:30px">${t('plan.title')}</h1>
        <div class="row"><button id="prev" aria-label="${esc(t('plan.prev'))}">${ic('up').replace('<path d="m6 15 6-6 6 6"/>', '<path d="m15 6-6 6 6 6"/>')}</button>
          <button id="now">${t('plan.today')}</button>
          <button id="next" aria-label="${esc(t('plan.next'))}">${ic('up').replace('<path d="m6 15 6-6 6 6"/>', '<path d="m9 6 6 6-6 6"/>')}</button></div>
      </div>
      <p class="muted" style="margin:6px 0 16px">${esc(S.dateLabel(days[0]))} – ${esc(S.dateLabel(days[6]))}</p>
      <div class="week">${days.map((d) => {
        const key = S.ymd(d), ms = meals.filter((m) => m.date === key).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
        return `<section class="day ${key === todayStr ? 'today' : ''}" data-d="${key}">
          <header><b><span class="wl">${esc(S.weekday(d))}</span><span class="ws">${esc(S.weekday(d, 'short'))}</span></b><span class="dl">${esc(S.dateLabel(d))}</span><button class="addm" data-add="${key}" aria-label="${esc(t('plan.add'))} ${esc(S.weekday(d))}">${ic('plus')}</button></header>
          ${ms.map(mealCard).join('') || `<p class="muted none">${t('plan.empty')}</p>`}</section>`;
      }).join('')}</div>
      <div class="cta" style="margin-top:20px"><button id="tolist" ${meals.some((m) => m.recipe) ? '' : 'disabled'}>${ic('basket')} ${t('plan.toList')}</button></div>`;

    $('#prev').onclick = () => { weekStart = addDays(weekStart, -7); refresh(); };
    $('#next').onclick = () => { weekStart = addDays(weekStart, 7); refresh(); };
    $('#now').onclick = () => { weekStart = mondayOf(new Date()); refresh(); };
    S.app.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => S.mealSheet({ date: b.dataset.add }, refresh)));
    S.app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => S.mealSheet({ meal: meals.find((m) => m.id === b.dataset.m) }, refresh)));
    $('#tolist').onclick = async () => {
      const lists = await api('/api/lists');
      S.modal(`<h2 class="sec">${t('plan.toList')}</h2><form id="tl" class="stack"><label for="tls">${t('plan.pickList')}</label>
        <select id="tls">${lists.map((l) => `<option value="${l.id}">${esc(S.listName(l))}</option>`).join('')}</select><p id="tlm" class="ok" hidden></p>
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('plan.go')}</button></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('#tl', el).onsubmit = async (e) => {
          e.preventDefault();
          const r = await S.post('/api/meals/to-list', { from, to, listId: $('#tls', el).value, lang: I18n.lang });
          $('#tlm', el).textContent = t('plan.listed', { n: r.added, list: S.listName(r.list) }); $('#tlm', el).hidden = false;
        };
      });
    };
  };
})();
