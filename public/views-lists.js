/* Shopping lists: grouped by aisle, filtered by store, shared with other people. */
(() => {
  'use strict';
  const { $, t, esc, api, ic } = S;
  const DEFAULT_ORDER = ['produce', 'meat', 'seafood', 'deli', 'dairy', 'bakery', 'frozen', 'canned', 'grains', 'baking', 'spices', 'condiments', 'breakfast', 'snacks', 'drinks', 'household', 'personal', 'pets', 'other'];
  const listName = (l) => (l.name === 'Groceries' && !l.externalId ? t('lists.groceries') : l.name);
  S.listName = listName;
  let timer;
  const pref = (k, d) => { try { return localStorage.getItem('simmer-' + k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('simmer-' + k, v); } catch { /* private mode */ } };

  const AISLE_COLORS = { produce: '#4C9A5B', meat: '#C0453A', seafood: '#3C8DB6', deli: '#D1618A', dairy: '#7FA7D6', bakery: '#D9A441', frozen: '#5FA3C7', canned: '#B5723C', grains: '#C9A66B', baking: '#D8B05A', spices: '#B8522B', condiments: '#8A6A3C', breakfast: '#7A5A3A', snacks: '#E08A3B', drinks: '#3F8FA8', household: '#7A8794', personal: '#A06AB4', pets: '#8A6D4F', other: '#8A8F98' };
  const COLORS = ['#2F7D6B', '#D9822B', '#C0453A', '#3C6FB6', '#7A52A3', '#B8892F', '#4A5A6A', '#D1618A'];
  const ICONS = ['🛒', '🥦', '🥩', '🧀', '🍞', '🏠', '🎁', '🥳', '💊', '🐶'];
  const fg = (c) => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? '#1B1B1B' : '#fff'; };
  const badge = (l, size = 44) => { const c = l.color || COLORS[0]; return `<span class="lbadge" style="--s:${size}px;background:${c};color:${fg(c)}">${l.icon ? esc(l.icon) : ic('list')}</span>`; };
  /** Icon and colour pickers, shared by the new-list and settings dialogs. */
  const looksFields = (icon, color) => `<div class="looks"><label>${t('lists.icon')}</label>
    <div class="swatches" role="radiogroup" aria-label="${esc(t('lists.icon'))}"><button type="button" class="sw ${icon ? '' : 'on'}" data-icon="" aria-label="${esc(t('lists.noIcon'))}">${ic('list')}</button>${ICONS.map((e) => `<button type="button" class="sw ${e === icon ? 'on' : ''}" data-icon="${e}">${e}</button>`).join('')}</div>
    <label>${t('lists.color')}</label>
    <div class="swatches" role="radiogroup" aria-label="${esc(t('lists.color'))}">${COLORS.map((c, n) => `<button type="button" class="sw dot ${(color || COLORS[0]) === c ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="${esc(t('lists.color'))} ${n + 1}"></button>`).join('')}</div></div>`;
  const wireLooks = (el, onChange) => {
    let icon = el.querySelector('[data-icon].on')?.dataset.icon || '', color = el.querySelector('[data-color].on')?.dataset.color || '';
    el.querySelectorAll('[data-icon]').forEach((b) => (b.onclick = () => { icon = b.dataset.icon; el.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b)); onChange(icon, color); }));
    el.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => { color = b.dataset.color; el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); onChange(icon, color); }));
  };

  S.listBadge = badge;
  const PALETTE = ['#4C9A5B', '#C0453A', '#3C8DB6', '#D9A441', '#7A52A3', '#D1618A', '#B5723C', '#4A5A6A'];
  /** Display name of a category: the person's own name, or the translated built-in aisle. */
  const catLabel = (c) => c.name || t('aisle.' + c.id);
  const catColor = (c, n) => c.color || AISLE_COLORS[c.id] || PALETTE[n % PALETTE.length];
  /** Categories in walking order: the store's own order if it has one, else the list's. */
  const orderFor = (l, storeId) => {
    const own = l.stores.find((s) => s.id === storeId)?.order;
    if (!own?.length) return l.categories;
    const rank = new Map(own.map((id, n) => [id, n]));
    return [...l.categories].sort((x, y) => (rank.get(x.id) ?? 1e6) - (rank.get(y.id) ?? 1e6));
  };
  S.catLabel = catLabel;

  const AISLE_IDS = Object.keys(AISLE_COLORS);
  const remaining = (l) => l.items.filter((i) => !i.checked).length;

  /** Lists as a list of lists: an index on the left, the chosen list on the right. On a phone they are two screens. */
  S.views.lists = async (selected) => {
    clearInterval(timer);
    let all = await api('/api/lists');
    let cur = all.find((l) => l.id === selected) || (!selected && all.find((l) => l.id === pref('list', ''))) || all[0];
    const detailOnly = !!selected && all.some((l) => l.id === selected);
    let filter = '';           // '' all, 'none', or a store id
    let query = '';            // search box over the index
    let addCat = '';           // category chosen in the add box of a custom list
    const hideKey = () => 'hide-' + cur.id;
    const hiding = () => pref(hideKey(), '') === '1';

    const replace = (l) => { all[all.findIndex((x) => x.id === l.id)] = l; cur = l; };
    const storeName = (id) => cur.stores.find((s) => s.id === id)?.name || '';

    const itemRow = (i) => `<li class="${i.checked ? 'done' : ''}" data-id="${i.id}">
      <input type="checkbox" ${i.checked ? 'checked' : ''} aria-label="${esc(i.name)}">
      <span class="n">${esc(i.name)}${i.quantity ? ` <span class="qty">${esc(i.quantity)}</span>` : ''}${i.details ? `<small>${esc(i.details)}</small>` : ''}</span>
      ${!filter && i.store ? `<span class="chip soft">${esc(storeName(i.store))}</span>` : ''}
      <button class="quiet editbtn" data-edit aria-label="${esc(t('lists.edit'))}: ${esc(i.name)}" title="${esc(t('lists.edit'))}">${ic('edit')}</button></li>`;

    S.app.innerHTML = `<div class="lists ${detailOnly ? 'show-detail' : ''}">
      <nav class="lindex" aria-label="${esc(t('nav.lists'))}">
        <div class="row between"><h1 class="rtitle" style="margin:0;font-size:30px">${t('nav.lists')}</h1><button id="newList" class="primary">${ic('plus')} ${t('lists.create')}</button></div>
        <label class="lsearch">${ic('search')}<input id="lq" type="search" placeholder="${esc(t('lists.search'))}" aria-label="${esc(t('lists.search'))}" autocomplete="off"></label>
        <ul class="lrows" id="lrows"></ul></nav>
      <section class="ldetail" id="ldetail"></section></div>`;

    const drawIndex = () => {
      const q = S.fold(query);
      const rows = all.filter((l) => !q || S.fold(listName(l)).includes(q));
      $('#lrows').innerHTML = rows.map((l) => {
        const n = remaining(l);
        return `<li><a class="lrow ${l.id === cur.id ? 'on' : ''}" href="#/lists/${l.id}" ${l.id === cur.id ? 'aria-current="true"' : ''}>${badge(l)}
          <span class="ltxt"><b>${esc(listName(l))}</b><small>${esc(n ? t(n === 1 ? 'lists.remaining1' : 'lists.remaining', { n }) : t('lists.noItems'))}</small>
          <small class="muted">${esc(l.mine ? S.shareText(l) : t('lists.ofOwner', { name: l.ownerName }))}</small></span></a></li>`;
      }).join('') || `<li class="muted" style="padding:10px">${t('lists.noMatch')}</li>`;
    };

    const drawDetail = () => {
      setPref('list', cur.id);
      const visible = (i) => !filter || (filter === 'none' ? !i.store : i.store === filter);
      const open = cur.items.filter((i) => !i.checked && visible(i));
      const done = cur.items.filter((i) => i.checked && visible(i));
      const known = new Set(cur.categories.map((c) => c.id));
      const byAisle = new Map();
      for (const i of open) { const k = known.has(i.aisle) ? i.aisle : ''; (byAisle.get(k) || byAisle.set(k, []).get(k)).push(i); }
      const groups = [...orderFor(cur, filter).map((c, n) => ({ id: c.id, label: catLabel(c), color: catColor(c, n) })), { id: '', label: cur.categories.length ? t('lists.uncat') : '', color: '#8A8F98' }].filter((g) => byAisle.has(g.id));
      const hide = hiding();
      const chips = cur.stores.length
        ? `<div class="chips filters" role="group" aria-label="${esc(t('lists.store'))}">${[['', t('lists.allStores')], ...cur.stores.map((s) => [s.id, s.name]), ['none', t('lists.noStore')]]
            .map(([id, label]) => `<button class="fchip ${filter === id ? 'on' : ''}" data-f="${esc(id)}">${esc(label)}</button>`).join('')}</div>` : '';
      $('#ldetail').innerHTML = `
        <a class="back lback" href="#/lists">${ic('back')} ${t('lists.back')}</a>
        <div class="row between wrap listhead">
          <div class="row" style="gap:14px">${badge(cur, 52)}<div><h2 class="rtitle" style="margin:0;font-size:30px">${esc(listName(cur))}</h2>
            <small class="muted">${cur.mine ? esc(S.shareText(cur)) : esc(t('lists.ofOwner', { name: cur.ownerName }))}</small></div></div>
          <div class="row toolbar">
            <button id="hideBtn" aria-pressed="${hide}" title="${esc(t(hide ? 'lists.showChecked' : 'lists.hideChecked'))}" aria-label="${esc(t(hide ? 'lists.showChecked' : 'lists.hideChecked'))}">${ic(hide ? 'eyeoff' : 'eye')}</button>
            ${cur.mine ? `<button id="shareBtn" aria-label="${esc(t('share.button'))}" title="${esc(t('share.button'))}">${ic('share')}</button>` : ''}
            ${cur.mine && S.me.linkedSimmers ? `<button id="rshareBtn" aria-label="${esc(t('fed.button'))}" title="${esc(t('fed.button'))}" data-rshare data-kind="list" data-ref="${esc(cur.id)}" data-title="${esc(cur.name)}">${ic('globe')}</button>` : ''}
            <button id="setBtn" aria-label="${esc(t('lists.settings'))}" title="${esc(t('lists.settings'))}">${ic('gear')}</button></div>
        </div>
        ${chips}
        <form class="field" id="addItem" style="margin:12px 0"><input type="text" required placeholder="${esc(t('lists.addPh'))}" aria-label="${esc(t('lists.addPh'))}" autocomplete="off">
          ${!cur.auto && cur.categories.length ? `<select id="addCat" aria-label="${esc(t('lists.aisle'))}" style="max-width:190px"><option value="">${t('lists.noCategory')}</option>${cur.categories.map((c) => `<option value="${c.id}" ${c.id === addCat ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select>` : ''}
          <button class="primary">${t('lists.add')}</button></form>
        ${groups.map((g) => `<section class="aisle ${g.label ? '' : 'nohead'}" style="--ac:${g.color}">${g.label ? `<h3 class="aislehead">${esc(g.label)}<span>${byAisle.get(g.id).length}</span></h3>` : ''}<ul class="items">${byAisle.get(g.id).sort((x, y) => x.name.localeCompare(y.name)).map(itemRow).join('')}</ul></section>`).join('') || `<p class="muted">${t('lists.nothing')}</p>`}
        ${done.length && !hide ? `<h3 class="sec" style="margin-top:22px">${t('lists.inCart', { n: done.length })} <button class="quiet" id="clear">${t('lists.clear')}</button></h3><ul class="items">${done.map(itemRow).join('')}</ul>` : ''}
        ${done.length && hide ? `<p class="muted hiddenn">${t('lists.hiddenN', { n: done.length })} <button class="quiet" id="clear">${t('lists.clear')}</button></p>` : ''}`;
      wireDetail();
    };
    const draw = () => { drawIndex(); drawDetail(); };

    const wireDetail = () => {
      const app = $('#ldetail');
      app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; drawDetail(); }));
      $('#hideBtn').onclick = () => { setPref(hideKey(), hiding() ? '' : '1'); drawDetail(); };
      $('#addItem').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('input', e.target).value.trim(); if (!name) return;
        addCat = $('#addCat')?.value || '';
        replace(await S.post(`/api/lists/${cur.id}/items`, { name, ...(addCat ? { aisle: addCat } : {}), ...(filter && filter !== 'none' ? { store: filter } : {}) }));
        draw(); $('#addItem input').focus();
      };
      app.querySelectorAll('ul.items li[data-id]').forEach((li) => {
        const id = li.dataset.id;
        $('input', li).onchange = async (e) => { const it = cur.items.find((x) => x.id === id); it.checked = e.target.checked; draw(); await S.patch(`/api/lists/${cur.id}/items/${id}`, { checked: it.checked }); };
        // Tapping anywhere on the line crosses the item off; the pencil at the end opens the editor.
        li.onclick = (e) => { if (e.target.closest('[data-edit]') || e.target === $('input', li)) return; $('input', li).click(); };
        $('[data-edit]', li).onclick = (e) => { e.stopPropagation(); itemSheet(cur.items.find((x) => x.id === id)); };
      });
      $('#clear')?.addEventListener('click', async () => { replace(await S.post(`/api/lists/${cur.id}/clear-checked`)); draw(); });
      S.wireRemoteShare(S.app);
      $('#shareBtn')?.addEventListener('click', () => S.shareDialog(cur, async (share) => { replace(await S.put(`/api/lists/${cur.id}/share`, share)); draw(); }));
      $('#setBtn').onclick = settingsSheet;
    };

    $('#lq').oninput = (e) => { query = e.target.value; drawIndex(); };
    $('#newList').onclick = async () => {
      const templates = await api('/api/list-templates?lang=' + I18n.lang).catch(() => []);
      let icon = '', color = COLORS[0], template = 'grocery';
      S.modal(`<h2 class="sec">${t('lists.newTitle')}</h2><form id="nlf" class="stack"><label for="nln">${t('lists.newName')}</label><input id="nln" required maxlength="60" autocomplete="off">
        <label>${t('lists.kind')}</label>
        <div class="kinds" role="radiogroup" aria-label="${esc(t('lists.kind'))}">${templates.map((x) => `<button type="button" class="fchip ${x.id === template ? 'on' : ''}" data-tpl="${x.id}" role="radio" aria-checked="${x.id === template}">${x.icon ? esc(x.icon) + ' ' : ''}${esc(t('tpl.' + x.id))}</button>`).join('')}</div>
        <small class="muted" id="kinddesc"></small>
        <div id="looks">${looksFields(icon, color)}</div><p class="err" id="nle" hidden></p>
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.create')}</button></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        const wire = () => wireLooks($('#looks', el), (i, c) => { icon = i; color = c; });
        const describe = () => { const x = templates.find((y) => y.id === template); $('#kinddesc', el).textContent = x?.categories ? (x.categories.length ? x.categories.map((c) => c.name).join(', ') : t('lists.noCategories')) : t('lists.groceryDesc'); };
        el.querySelectorAll('[data-tpl]').forEach((b) => (b.onclick = () => {
          template = b.dataset.tpl; icon = templates.find((y) => y.id === template)?.icon || '';
          el.querySelectorAll('[data-tpl]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
          $('#looks', el).innerHTML = looksFields(icon, color); wire(); describe();
        }));
        wire(); describe();
        $('#nlf', el).onsubmit = async (e) => {
          e.preventDefault();
          try { const l = await S.post('/api/lists', { name: $('#nln', el).value, icon, color, template, lang: I18n.lang }); close(); location.hash = '#/lists/' + l.id; }
          catch (x) { const er = $('#nle', el); er.textContent = x.message; er.hidden = false; }
        };
      });
    };

    function itemSheet(it) {
      if (!it) return;
      S.modal(`<h2 class="sec">${t('lists.item')}</h2><form id="itf" class="stack">
        <label for="in">${t('lists.item')}</label><input id="in" value="${esc(it.name)}" required>
        <label for="iq">${t('lists.quantity')}</label><input id="iq" value="${esc(it.quantity)}">
        ${cur.categories.length ? `<label for="ia">${t('lists.aisle')}</label><select id="ia"><option value="">${t('lists.noCategory')}</option>${cur.categories.map((c) => `<option value="${c.id}" ${c.id === it.aisle ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select>` : ''}
        ${cur.stores.length ? `<label for="is">${t('lists.store')}</label><select id="is"><option value="">${t('lists.noStore')}</option>${cur.stores.map((s) => `<option value="${s.id}" ${s.id === it.store ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        <div class="row between"><button type="button" class="quiet" data-del>${t('meal.remove')}</button><span class="row"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.save')}</button></span></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('[data-del]', el).onclick = async () => { cur.items = cur.items.filter((x) => x.id !== it.id); close(); draw(); await S.del(`/api/lists/${cur.id}/items/${it.id}`); };
        $('#itf', el).onsubmit = async (e) => {
          e.preventDefault();
          const patch = { name: $('#in', el).value, quantity: $('#iq', el).value };
          if ($('#ia', el)) patch.aisle = $('#ia', el).value;
          if ($('#is', el)) patch.store = $('#is', el).value;
          Object.assign(it, await S.patch(`/api/lists/${cur.id}/items/${it.id}`, patch));
          close(); draw();
        };
      });
    }

    function settingsSheet() {
      let cats = cur.categories.map((c) => ({ ...c }));
      const stores = cur.stores.map((s) => ({ ...s }));
      const rules = { ...cur.aisleStores };
      let icon = cur.icon || '', color = cur.color || '', auto = cur.auto, name = cur.name;
      S.modal('<div id="setbody"></div>', async (el, close) => {
        const templates = await api('/api/list-templates?lang=' + I18n.lang).catch(() => []);
        const render = () => {
          $('#setbody', el).innerHTML = `
            <h2 class="sec">${t('lists.settings')}</h2>
            <form id="sf" class="stack">
              <label for="sn">${t('lists.rename')}</label><input id="sn" value="${esc(name)}" required>
              ${looksFields(icon, color)}
              <h3 class="sub">${t('lists.categories')}</h3><p class="muted">${t('lists.categoriesHelp')}</p>
              <label class="pick"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}><span>${t('lists.auto')}</span></label>
              <ol class="order cats">${cats.map((c, n) => `<li><input type="color" data-ccolor="${n}" value="${c.color || AISLE_COLORS[c.id] || PALETTE[n % PALETTE.length]}" aria-label="${esc(t('lists.color'))}"><input data-cname="${n}" value="${esc(c.name || S.aisleLabel(c.id))}" aria-label="${esc(t('lists.categoryName'))}">
                <span class="row"><button type="button" class="quiet" data-up="${n}" ${n ? '' : 'disabled'} aria-label="${esc(t('lists.up'))}">${ic('up')}</button><button type="button" class="quiet" data-down="${n}" ${n < cats.length - 1 ? '' : 'disabled'} aria-label="${esc(t('lists.down'))}">${ic('down')}</button><button type="button" class="quiet" data-cdel="${n}" aria-label="${esc(t('meal.remove'))}">${ic('close')}</button></span></li>`).join('') || `<li class="muted">${t('lists.noCategories')}</li>`}</ol>
              <div class="row"><input id="nc" placeholder="${esc(t('lists.newCategory'))}" aria-label="${esc(t('lists.newCategory'))}" maxlength="40"><button type="button" id="ncb">${t('lists.addCategory')}</button></div>
              <div class="row"><select id="tpl" aria-label="${esc(t('lists.template'))}"><option value="">${t('lists.template')}</option>${templates.map((x) => `<option value="${x.id}">${esc(t('tpl.' + x.id))}</option>`).join('')}</select><button type="button" id="tplb">${t('lists.applyTemplate')}</button></div>
              <h3 class="sub">${t('lists.stores')}</h3>
              ${stores.map((s, n) => `<div class="row"><input data-sname="${n}" value="${esc(s.name)}" aria-label="${esc(t('lists.storeName'))}"><button type="button" class="quiet" data-sdel="${n}" aria-label="${esc(t('meal.remove'))}">${ic('close')}</button></div>`).join('')}
              <div class="row"><input id="ns" placeholder="${esc(t('lists.storeName'))}" aria-label="${esc(t('lists.storeName'))}"><button type="button" id="nsb">${t('lists.addStore')}</button></div>
              ${stores.length && cats.length ? `<h3 class="sub">${t('lists.rules')}</h3><p class="muted">${t('lists.rulesHelp')}</p>
                <div class="rules">${cats.map((c) => `<label class="rule"><span>${esc(c.name || S.aisleLabel(c.id))}</span><select data-rule="${c.id}"><option value="">${t('lists.noRule')}</option>${stores.map((s) => `<option value="${s.id}" ${rules[c.id] === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
              <p class="err" id="serr" hidden></p>
              <div class="row between">${cur.mine && all.length > 1 ? `<button type="button" class="quiet" data-delist>${t('lists.delete')}</button>` : '<span></span>'}<span class="row"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.save')}</button></span></div>
            </form>`;
          const sync = () => {
            name = $('#sn', el).value; auto = $('#auto', el).checked;
            el.querySelectorAll('[data-cname]').forEach((i) => { const c = cats[+i.dataset.cname], v = i.value.trim(); c.name = AISLE_COLORS[c.id] && v === S.aisleLabel(c.id) ? '' : v; });
            el.querySelectorAll('[data-ccolor]').forEach((i) => { const c = cats[+i.dataset.ccolor]; c.color = i.value.toLowerCase() === (AISLE_COLORS[c.id] || PALETTE[+i.dataset.ccolor % PALETTE.length]).toLowerCase() ? '' : i.value; });
            el.querySelectorAll('[data-sname]').forEach((i) => (stores[+i.dataset.sname].name = i.value));
            el.querySelectorAll('[data-rule]').forEach((x) => { if (x.value) rules[x.dataset.rule] = x.value; else delete rules[x.dataset.rule]; });
          };
          $('[data-x]', el).onclick = close;
          wireLooks(el, (i, c) => { sync(); icon = i; color = c; });
          const addCat = () => { sync(); const v = $('#nc', el).value.trim(); if (v) { cats.push({ id: crypto.randomUUID(), name: v, color: '' }); render(); $('#nc', el).focus(); } };
          $('#ncb', el).onclick = addCat;
          $('#nc', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } };
          $('#tplb', el).onclick = () => {
            const x = templates.find((y) => y.id === $('#tpl', el).value); if (!x) return;
            if (!confirm(t('lists.confirmTemplate', { name: t('tpl.' + x.id) }))) return;
            sync(); auto = x.auto;
            cats = x.categories ? x.categories.map((c) => ({ id: crypto.randomUUID(), name: c.name, color: c.color || '' })) : AISLE_IDS.map((id) => ({ id, name: '', color: '' }));
            for (const k of Object.keys(rules)) delete rules[k];
            if (!icon) icon = x.icon || '';
            render();
          };
          el.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = () => { sync(); const [gone] = cats.splice(+b.dataset.cdel, 1); delete rules[gone.id]; render(); }));
          const move = (n, d) => { sync(); [cats[n], cats[n + d]] = [cats[n + d], cats[n]]; render(); };
          el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(+b.dataset.up, -1)));
          el.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(+b.dataset.down, 1)));
          $('#nsb', el).onclick = () => { sync(); const v = $('#ns', el).value.trim(); if (v) { stores.push({ id: crypto.randomUUID(), name: v, order: null }); render(); } };
          el.querySelectorAll('[data-sdel]').forEach((b) => (b.onclick = () => { sync(); const [gone] = stores.splice(+b.dataset.sdel, 1); for (const k of Object.keys(rules)) if (rules[k] === gone.id) delete rules[k]; render(); }));
          $('[data-delist]', el)?.addEventListener('click', async () => {
            if (!confirm(t('lists.confirmDelete', { name: listName(cur) }))) return;
            await S.del(`/api/lists/${cur.id}`); close(); location.hash = '#/lists';
          });
          $('#sf', el).onsubmit = async (e) => {
            e.preventDefault(); sync();
            try {
              const named = stores.filter((s) => s.name.trim());
              const ids = new Set(named.map((s) => s.id));
              const l = await S.put(`/api/lists/${cur.id}/settings`, {
                name, icon, color, auto, categories: cats.filter((c) => c.name || AISLE_COLORS[c.id]), stores: named,
                aisleStores: Object.fromEntries(Object.entries(rules).filter(([, s]) => ids.has(s))),
              });
              replace(l); if (filter && filter !== 'none' && !l.stores.some((s) => s.id === filter)) filter = '';
              close(); draw();
            } catch (x) { const er = $('#serr', el); er.textContent = x.message; er.hidden = false; }
          };
        };
        render();
      });
    }

    draw();
    timer = setInterval(async () => {
      if (!location.hash.startsWith('#/lists') || document.querySelector('.modal') || document.activeElement?.tagName === 'INPUT') return;
      try { const fresh = await api('/api/lists'); if (JSON.stringify(fresh) !== JSON.stringify(all)) { all = fresh; cur = all.find((l) => l.id === cur.id) || all[0]; draw(); } } catch { /* offline */ }
    }, 5000);
  };
  S.stopLists = () => clearInterval(timer);
})();
