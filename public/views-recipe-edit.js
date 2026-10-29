/* Recipe editor: type a recipe in by hand, or fix one that was imported. */
(() => {
  'use strict';
  const { $, t, esc, api, ic } = S;

  /** Shrink a picked photo to at most `max` px on its longest side and return base64 JPEG. */
  async function shrink(file, max = 1400) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.84));
    return await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
  }
  const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);


  /**
   * Search the web for a picture. onPick({ url, thumb, credit }) runs when one is chosen.
   * Also accepts a pasted image link.
   */
  S.photoPicker = (query, onPick) => {
    S.modal(`<h2 class="sec">${t('photo.search')}</h2>
      <form id="pf2" class="row" role="search"><input id="pq" type="search" value="${esc(query || '')}" aria-label="${esc(t('photo.search'))}" autocomplete="off"><button class="primary">${t('photo.go')}</button></form>
      <p class="muted" id="pstat" style="margin:8px 0">${t('photo.searchHelp')}</p>
      <div class="pgrid" id="pgrid"></div>
      <form id="pl" class="row" style="margin-top:12px"><input id="pu" type="url" placeholder="https://…" aria-label="${esc(t('photo.link'))}"><button>${t('photo.useLink')}</button></form>
      <div class="row end" style="margin-top:12px"><button type="button" class="quiet" data-x>${t('share.cancel')}</button></div>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      const stat = $('#pstat', el);
      const run = async () => {
        const q = $('#pq', el).value.trim(); if (!q) return;
        stat.textContent = t('photo.finding'); $('#pgrid', el).innerHTML = '';
        try {
          const { results } = await api('/api/image-search?q=' + encodeURIComponent(q));
          stat.textContent = results.length ? t('photo.pick') : t('photo.noResults');
          $('#pgrid', el).innerHTML = results.map((r, n) => `<button type="button" class="pcell" data-n="${n}" title="${esc(r.title)}"><img src="${esc(r.thumb)}" alt="${esc(r.title)}" loading="lazy" referrerpolicy="no-referrer"><small>${esc(r.source)}</small></button>`).join('');
          el.querySelectorAll('.pcell').forEach((b) => (b.onclick = () => { const r = results[+b.dataset.n]; close(); onPick({ url: r.url, alt: r.alt, thumb: r.thumb, credit: [r.credit, r.source].filter(Boolean).join(' · ') }); }));
        } catch (x) { stat.textContent = x.message; stat.className = 'err'; }
      };
      $('#pf2', el).onsubmit = (e) => { e.preventDefault(); run(); };
      $('#pl', el).onsubmit = (e) => { e.preventDefault(); const u = $('#pu', el).value.trim(); if (u) { close(); onPick({ url: u, thumb: u, credit: '' }); } };
      if (query) run();
    });
  };

  /** r = the recipe to edit, or null to write a new one. onDone(recipe) runs after saving. */
  S.recipeEditor = (r, onDone) => {
    const fresh = !r;
    let pending = null;   // base64 of a newly chosen photo, or 'remove'
    const num = (v) => (v == null ? '' : v);
    S.modal(`<h2 class="sec">${t(fresh ? 'edit.newTitle' : 'edit.title')}</h2>
      <form id="rf" class="stack">
        <label for="rt">${t('edit.titleField')}</label><input id="rt" value="${esc(r?.title || '')}" maxlength="300" required autocomplete="off">
        <label>${t('edit.photo')}</label>
        <div class="photoedit"><div class="thumb" id="rthumb">${r?.image ? `<img src="${esc(r.image)}" alt="">` : ic('image')}</div>
          <div class="row wrap"><button type="button" id="rpick">${ic('camera')} ${t('edit.choose')}</button><button type="button" id="rweb">${ic('search')} ${t('photo.search')}</button><button type="button" class="quiet" id="rrm" ${r?.image ? '' : 'hidden'}>${t('edit.remove')}</button><input id="rfile" type="file" accept="image/*" hidden></div></div>
        <label for="rd">${t('edit.description')}</label><textarea id="rd" rows="2" maxlength="3000">${esc(r?.description || '')}</textarea>
        <div class="two"><div><label for="ry">${t('edit.servings')}</label><input id="ry" value="${esc(r?.yield || '')}" placeholder="${esc(t('edit.servingsPh'))}" maxlength="100"></div>
          <div><label for="rs">${t('edit.source')}</label><input id="rs" type="url" value="${esc(r?.sourceUrl || '')}" placeholder="https://" autocomplete="off"></div></div>
        <div class="three"><div><label for="rp">${t('recipe.prep')}</label><input id="rp" type="number" min="0" inputmode="numeric" value="${num(r?.prepMinutes)}" placeholder="min"></div>
          <div><label for="rc">${t('recipe.cook')}</label><input id="rc" type="number" min="0" inputmode="numeric" value="${num(r?.cookMinutes)}" placeholder="min"></div>
          <div><label for="rto">${t('recipe.total')}</label><input id="rto" type="number" min="0" inputmode="numeric" value="${num(r?.totalMinutes)}" placeholder="min"></div></div>
        <label for="ri">${t('recipe.ingredients')}</label><textarea id="ri" rows="8" spellcheck="false">${esc((r?.ingredients || []).join('\n'))}</textarea><small class="muted">${t('edit.ingredientsHelp')}</small>
        <label for="rm">${t('recipe.method')}</label><textarea id="rm" rows="8">${esc((r?.steps || []).join('\n'))}</textarea><small class="muted">${t('edit.stepsHelp')}</small>
        <p class="err" id="rerr" hidden></p>
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary" id="rsave">${t('share.save')}</button></div>
      </form>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#rpick', el).onclick = () => $('#rfile', el).click();
      $('#rfile', el).onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { pending = await shrink(f); $('#rthumb', el).innerHTML = `<img src="data:image/jpeg;base64,${pending}" alt="">`; $('#rrm', el).hidden = false; }
        catch { const er = $('#rerr', el); er.textContent = t('acct.photoBad'); er.hidden = false; }
      };
      $('#rweb', el).onclick = () => S.photoPicker($('#rt', el).value, (p) => { pending = { url: p.url, alt: p.alt, credit: p.credit }; $('#rthumb', el).innerHTML = `<img src="${esc(p.thumb)}" alt="" referrerpolicy="no-referrer">`; $('#rrm', el).hidden = false; });
      $('#rrm', el).onclick = () => { pending = 'remove'; $('#rthumb', el).innerHTML = ic('image'); $('#rrm', el).hidden = true; };
      $('#rf', el).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('#rsave', el); btn.disabled = true;
        const body = {
          title: $('#rt', el).value, description: $('#rd', el).value, yield: $('#ry', el).value, sourceUrl: $('#rs', el).value,
          prepMinutes: $('#rp', el).value, cookMinutes: $('#rc', el).value, totalMinutes: $('#rto', el).value,
          ingredients: lines($('#ri', el).value), steps: lines($('#rm', el).value),
        };
        try {
          let saved = fresh ? await S.post('/api/recipes', body) : await S.put('/api/recipes/' + r.id, body);
          if (pending === 'remove') { if (!fresh) saved = await S.del(`/api/recipes/${r.id}/image`); }
          else if (pending?.url) saved = await S.post(`/api/recipes/${saved.id}/image-from-url`, pending);
          else if (pending) saved = await S.put(`/api/recipes/${saved.id}/image`, { image: pending });
          close(); onDone?.(saved);
        } catch (x) { btn.disabled = false; const er = $('#rerr', el); er.textContent = x.message; er.hidden = false; }
      };
    });
  };
})();
