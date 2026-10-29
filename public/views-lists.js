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
  const orderFor = (l, storeId) => {
    const own = l.stores.find((s) => s.id === storeId)?.order;
    const first = (own?.length ? own : l.aisleOrder) || [];
    return [...new Set([...first, ...DEFAULT_ORDER])];
  };

  S.views.lists = async (selected) => {
    clearInterval(timer);
    let all = await api('/api/lists');
    let cur = all.find((l) => l.id === (selected || pref('list', ''))) || all[0];
    let filter = '';           // '' all, 'none', or a store id
    let editing = '';          // item id with its sheet open

    const replace = (l) => { all[all.findIndex((x) => x.id === l.id)] = l; cur = l; };
    const storeName = (id) => cur.stores.find((s) => s.id === id)?.name || '';

    const itemRow = (i) => `<li class="${i.checked ? 'done' : ''}" data-id="${i.id}">
      <input type="checkbox" ${i.checked ? 'checked' : ''} aria-label="${esc(i.name)}">
      <button class="n linklike" data-edit>${esc(i.name)}${i.quantity ? ` <span class="qty">${esc(i.quantity)}</span>` : ''}${i.details ? `<small>${esc(i.details)}</small>` : ''}</button>
      ${!filter && i.store ? `<span class="chip soft">${esc(storeName(i.store))}</span>` : ''}</li>`;

    const draw = () => {
      setPref('list', cur.id);
      const visible = (i) => !filter || (filter === 'none' ? !i.store : i.store === filter);
      const open = cur.items.filter((i) => !i.checked && visible(i));
      const done = cur.items.filter((i) => i.checked && visible(i));
      const byAisle = new Map();
      for (const i of open) (byAisle.get(i.aisle || 'other') || byAisle.set(i.aisle || 'other', []).get(i.aisle || 'other')).push(i);
      const aisles = orderFor(cur, filter).filter((a) => byAisle.has(a));
      const chips = cur.stores.length
        ? `<div class="chips filters" role="group" aria-label="${esc(t('lists.store'))}">${[['', t('lists.allStores')], ...cur.stores.map((s) => [s.id, s.name]), ['none', t('lists.noStore')]]
            .map(([id, label]) => `<button class="fchip ${filter === id ? 'on' : ''}" data-f="${esc(id)}">${esc(label)}</button>`).join('')}</div>` : '';
      S.app.innerHTML = `
        <div class="tabs">${all.map((l) => `<button data-l="${l.id}" class="${l.id === cur.id ? 'on' : ''}">${esc(listName(l))}</button>`).join('')}<button class="quiet" id="newList">${t('lists.new')}</button></div>
        <div class="row between wrap listhead">
          <div><h1 class="rtitle" style="margin:0;font-size:30px">${esc(listName(cur))}</h1>
            <small class="muted">${cur.mine ? esc(S.shareText(cur)) : esc(t('lists.ofOwner', { name: cur.ownerName }))}</small></div>
          <div class="row">${cur.mine ? `<button id="shareBtn">${ic('share')} ${t('share.button')}</button>` : ''}<button id="setBtn">${ic('gear')} ${t('lists.settings')}</button></div>
        </div>
        ${chips}
        <form class="field" id="addItem" style="margin:12px 0"><input type="text" required placeholder="${esc(t('lists.addPh'))}" aria-label="${esc(t('lists.addPh'))}" autocomplete="off"><button class="primary">${t('lists.add')}</button></form>
        ${aisles.map((a) => `<section class="aisle"><h2 class="aislehead">${esc(S.aisleLabel(a))}<span>${byAisle.get(a).length}</span></h2><ul class="items">${byAisle.get(a).sort((x, y) => x.name.localeCompare(y.name)).map(itemRow).join('')}</ul></section>`).join('') || `<p class="muted">${t('lists.nothing')}</p>`}
        ${done.length ? `<h2 class="sec" style="margin-top:22px">${t('lists.inCart', { n: done.length })} <button class="quiet" id="clear">${t('lists.clear')}</button></h2><ul class="items">${done.map(itemRow).join('')}</ul>` : ''}`;
      wire();
    };

    const wire = () => {
      const app = S.app;
      app.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { cur = all.find((l) => l.id === b.dataset.l); filter = ''; draw(); }));
      app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
      $('#newList').onclick = async () => { const n = prompt(t('lists.newName')); if (!n) return; const l = await S.post('/api/lists', { name: n }); all.push(l); cur = l; filter = ''; draw(); };
      $('#addItem').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('input', e.target).value.trim(); if (!name) return;
        replace(await S.post(`/api/lists/${cur.id}/items`, { name, ...(filter && filter !== 'none' ? { store: filter } : {}) }));
        draw(); $('#addItem input').focus();
      };
      app.querySelectorAll('ul.items li[data-id]').forEach((li) => {
        const id = li.dataset.id;
        $('input', li).onchange = async (e) => { const it = cur.items.find((x) => x.id === id); it.checked = e.target.checked; draw(); await S.patch(`/api/lists/${cur.id}/items/${id}`, { checked: it.checked }); };
        $('[data-edit]', li).onclick = () => itemSheet(cur.items.find((x) => x.id === id));
      });
      $('#clear')?.addEventListener('click', async () => { replace(await S.post(`/api/lists/${cur.id}/clear-checked`)); draw(); });
      $('#shareBtn')?.addEventListener('click', () => S.shareDialog(cur, async (share) => { replace(await S.put(`/api/lists/${cur.id}/share`, share)); draw(); }));
      $('#setBtn').onclick = settingsSheet;
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
      S.modal('<div id="setbody"></div>', (el, close) => {
        const render = () => {
          $('#setbody', el).innerHTML = `
            <h2 class="sec">${t('lists.settings')}</h2>
            <form id="sf" class="stack">
              <label for="sn">${t('lists.rename')}</label><input id="sn" value="${esc(cur.name)}" required>
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
          $('#nsb', el).onclick = () => { sync(); const v = $('#ns', el).value.trim(); if (v) { stores.push({ id: crypto.randomUUID(), name: v, order: null }); render(); } };
          el.querySelectorAll('[data-sdel]').forEach((b) => (b.onclick = () => { sync(); const [gone] = stores.splice(+b.dataset.sdel, 1); delete rules[Object.keys(rules).find((k) => rules[k] === gone.id)]; for (const k of Object.keys(rules)) if (rules[k] === gone.id) delete rules[k]; render(); }));
          const move = (n, d) => { sync(); [order[n], order[n + d]] = [order[n + d], order[n]]; render(); };
          el.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(+b.dataset.up, -1)));
          el.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(+b.dataset.down, 1)));
          $('[data-delist]', el)?.addEventListener('click', async () => {
            if (!confirm(t('lists.confirmDelete', { name: listName(cur) }))) return;
            await S.del(`/api/lists/${cur.id}`); all = all.filter((l) => l.id !== cur.id); cur = all[0]; close(); draw();
          });
          $('#sf', el).onsubmit = async (e) => {
            e.preventDefault(); sync();
            try {
              const named = stores.filter((s) => s.name.trim());
              const ids = new Set(named.map((s) => s.id));
              const l = await S.put(`/api/lists/${cur.id}/settings`, {
                name: $('#sn', el).value, aisleOrder: order, stores: named,
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
