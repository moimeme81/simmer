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
          <div class="row wrap"><button type="button" id="rpick">${ic('camera')} ${t('edit.choose')}</button><button type="button" class="quiet" id="rrm" ${r?.image ? '' : 'hidden'}>${t('edit.remove')}</button><input id="rfile" type="file" accept="image/*" hidden></div></div>
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
          else if (pending) saved = await S.put(`/api/recipes/${saved.id}/image`, { image: pending });
          close(); onDone?.(saved);
        } catch (x) { btn.disabled = false; const er = $('#rerr', el); er.textContent = x.message; er.hidden = false; }
      };
    });
  };
})();
