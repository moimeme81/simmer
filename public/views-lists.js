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

  /** Aisles in walking order: the store's own order, else the list's, else the default. */
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
  const orderFor = (l, storeId) => {
    const own = l.stores.find((s) => s.id === storeId)?.order;
    const first = (own?.length ? own : l.aisleOrder) || [];
    return [...new Set([...first, ...DEFAULT_ORDER])];
  };

  const remaining = (l) => l.items.filter((i) => !i.checked).length;

  /** Lists as a list of lists: an index on the left, the chosen list on the right. On a phone they are two screens. */
  S.views.lists = async (selected) => {
    clearInterval(timer);
    let all = await api('/api/lists');
    let cur = all.find((l) => l.id === selected) || (!selected && all.find((l) => l.id === pref('list', ''))) || all[0];
    const detailOnly = !!selected && all.some((l) => l.id === selected);
    let filter = '';           // '' all, 'none', or a store id
    let query = '';            // search box over the index
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
      const byAisle = new Map();
      for (const i of open) (byAisle.get(i.aisle || 'other') || byAisle.set(i.aisle || 'other', []).get(i.aisle || 'other')).push(i);
      const aisles = orderFor(cur, filter).filter((a) => byAisle.has(a));
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
            <button id="setBtn" aria-label="${esc(t('lists.settings'))}" title="${esc(t('lists.settings'))}">${ic('gear')}</button></div>
        </div>
        ${chips}
        <form class="field" id="addItem" style="margin:12px 0"><input type="text" required placeholder="${esc(t('lists.addPh'))}" aria-label="${esc(t('lists.addPh'))}" autocomplete="off"><button class="primary">${t('lists.add')}</button></form>
        ${aisles.map((a) => `<section class="aisle" style="--ac:${AISLE_COLORS[a] || '#8A8F98'}"><h3 class="aislehead">${esc(S.aisleLabel(a))}<span>${byAisle.get(a).length}</span></h3><ul class="items">${byAisle.get(a).sort((x, y) => x.name.localeCompare(y.name)).map(itemRow).join('')}</ul></section>`).join('') || `<p class="muted">${t('lists.nothing')}</p>`}
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
        replace(await S.post(`/api/lists/${cur.id}/items`, { name, ...(filter && filter !== 'none' ? { store: filter } : {}) }));
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
      $('#shareBtn')?.addEventListener('click', () => S.shareDialog(cur, async (share) => { replace(await S.put(`/api/lists/${cur.id}/share`, share)); draw(); }));
      $('#setBtn').onclick = settingsSheet;
    };

    $('#lq').oninput = (e) => { query = e.target.value; drawIndex(); };
    $('#newList').onclick = () => {
      let icon = '', color = COLORS[0];
      S.modal(`<h2 class="sec">${t('lists.newTitle')}</h2><form id="nlf" class="stack"><label for="nln">${t('lists.newName')}</label><input id="nln" required maxlength="60" autocomplete="off">
        ${looksFields(icon, color)}<p class="err" id="nle" hidden></p>
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.create')}</button></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        wireLooks(el, (i, c) => { icon = i; color = c; });
        $('#nlf', el).onsubmit = async (e) => {
          e.preventDefault();
          try { const l = await S.post('/api/lists', { name: $('#nln', el).value, icon, color }); close(); location.hash = '#/lists/' + l.id; }
          catch (x) { const er = $('#nle', el); er.textContent = x.message; er.hidden = false; }
        };
      });
    };

    function itemSheet(it) {
      if (!it) return;
      S.modal(`<h2 class="sec">${t('lists.item')}</h2><form id="itf" class="stack">
        <label for="in">${t('lists.item')}</label><input id="in" value="${esc(it.name)}" required>
        <label for="iq">${t('lists.quantity')}</label><input id="iq" value="${esc(it.quantity)}">
        <label for="ia">${t('lists.aisle')}</label><select id="ia">${DEFAULT_ORDER.map((a) => `<option value="${a}" ${a === it.aisle ? 'selected' : ''}>${esc(S.aisleLabel(a))}</option>`).join('')}</select>
        ${cur.stores.length ? `<label for="is">${t('lists.store')}</label><select id="is"><option value="">${t('lists.noStore')}</option>${cur.stores.map((s) => `<option value="${s.id}" ${s.id === it.store ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        <div class="row between"><button type="button" class="quiet" data-del>${t('meal.remove')}</button><span class="row"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.save')}</button></span></div></form>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('[data-del]', el).onclick = async () => { cur.items = cur.items.filter((x) => x.id !== it.id); close(); draw(); await S.del(`/api/lists/${cur.id}/items/${it.id}`); };
        $('#itf', el).onsubmit = async (e) => {
          e.preventDefault();
          const patch = { name: $('#in', el).value, quantity: $('#iq', el).value, aisle: $('#ia', el).value };
          if ($('#is', el)) patch.store = $('#is', el).value;
          Object.assign(it, await S.patch(`/api/lists/${cur.id}/items/${it.id}`, patch));
          close(); draw();
        };
      });
    }

    function settingsSheet() {
      const order = orderFor(cur, '').filter((a) => DEFAULT_ORDER.includes(a));
      const stores = cur.stores.map((s) => ({ ...s }));
      const rules = { ...cur.aisleStores };
      let icon = cur.icon || '', color = cur.color || '';
      S.modal('<div id="setbody"></div>', (el, close) => {
        const render = () => {
          $('#setbody', el).innerHTML = `
            <h2 class="sec">${t('lists.settings')}</h2>
            <form id="sf" class="stack">
              <label for="sn">${t('lists.rename')}</label><input id="sn" value="${esc(cur.name)}" required>
              ${looksFields(icon, color)}
              <h3 class="sub">${t('lists.stores')}</h3>
              ${stores.map((s, n) => `<div class="row"><input data-sname="${n}" value="${esc(s.name)}" aria-label="${esc(t('lists.storeName'))}"><button type="button" class="quiet" data-sdel="${n}" aria-label="${esc(t('meal.remove'))}">${ic('close')}</button></div>`).join('')}
              <div class="row"><input id="ns" placeholder="${esc(t('lists.storeName'))}" aria-label="${esc(t('lists.storeName'))}"><button type="button" id="nsb">${t('lists.addStore')}</button></div>
              ${stores.length ? `<h3 class="sub">${t('lists.rules')}</h3><p class="muted">${t('lists.rulesHelp')}</p>
                <div class="rules">${order.filter((a) => a !== 'other' || true).map((a) => `<label class="rule"><span>${esc(S.aisleLabel(a))}</span><select data-rule="${a}"><option value="">${t('lists.noRule')}</option>${stores.map((s) => `<option value="${s.id}" ${rules[a] === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
              <h3 class="sub">${t('lists.order')}</h3><p class="muted">${t('lists.orderHelp')}</p>
              <ol class="order">${order.map((a, n) => `<li><span>${esc(S.aisleLabel(a))}</span><span class="row"><button type="button" class="quiet" data-up="${n}" ${n ? '' : 'disabled'} aria-label="${esc(t('lists.up'))}">${ic('up')}</button><button type="button" class="quiet" data-down="${n}" ${n < order.length - 1 ? '' : 'disabled'} aria-label="${esc(t('lists.down'))}">${ic('down')}</button></span></li>`).join('')}</ol>
              <p class="err" id="serr" hidden></p>
              <div class="row between">${cur.mine && all.length > 1 ? `<button type="button" class="quiet" data-delist>${t('lists.delete')}</button>` : '<span></span>'}<span class="row"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('lists.save')}</button></span></div>
            </form>`;
          const sync = () => {
            el.querySelectorAll('[data-sname]').forEach((i) => (stores[+i.dataset.sname].name = i.value));
            el.querySelectorAll('[data-rule]').forEach((s) => { if (s.value) rules[s.dataset.rule] = s.value; else delete rules[s.dataset.rule]; });
          };
          $('[data-x]', el).onclick = close;
          wireLooks(el, (i, c) => { sync(); icon = i; color = c; });
          $('#nsb', el).onclick = () => { sync(); const v = $('#ns', el).value.trim(); if (v) { stores.push({ id: crypto.randomUUID(), name: v, order: null }); render(); } };
          el.querySelectorAll('[data-sdel]').forEach((b) => (b.onclick = () => { sync(); const [gone] = stores.splice(+b.dataset.sdel, 1); delete rules[Object.keys(rules).find((k) => rules[k] === gone.id)]; for (const k of Object.keys(rules)) if (rules[k] === gone.id) delete rules[k]; render(); }));
          const move = (n, d) => { sync(); [order[n], order[n + d]] = [order[n + d], order[n]]; render(); };
          el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(+b.dataset.up, -1)));
          el.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(+b.dataset.down, 1)));
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
                name: $('#sn', el).value, icon, color, aisleOrder: order, stores: named,
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
