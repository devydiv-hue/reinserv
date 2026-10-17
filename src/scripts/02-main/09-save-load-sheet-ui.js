/* ======================================================================
   SAVE / LOAD — localStorage slots + JSON file export/import.
   Payload = { schema:1, character, extra:{name,player} }. `character` is
   plain data (no functions/circular refs — see newCharacter()), so it
   round-trips through JSON.stringify/parse without special handling.
   `fName`/`fPlayer` are page-local inputs, never written onto `character`
   anywhere else in the app, so they're captured/restored separately.
   ====================================================================== */
const SAVE_STORE_KEY = 'reincarnator_char_saves_v1';
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function getSavesStore(){ try{ return JSON.parse(localStorage.getItem(SAVE_STORE_KEY)||'{}'); }catch(e){ return {}; } }
function setSavesStore(obj){ try{ localStorage.setItem(SAVE_STORE_KEY, JSON.stringify(obj)); }catch(e){ uiAlert('Не удалось сохранить в хранилище браузера: '+e.message, {title:'Сохранение', icon:'⚠'}); } }
function buildSavePayload(){
  return { schema:1, character, extra:{ name:document.getElementById('fName').value, player:document.getElementById('fPlayer').value,
    pendingCount: pendingChoices.length + pendingRoleplayChoices.length + pendingItemRolls.length } };
}
function isValidPayload(p){ return !!(p && p.character && p.character.stats && p.character.abilities); }
function applyLoadedPayload(payload){
  const hadPending = !!(payload.extra && payload.extra.pendingCount);
  const pc0 = payload.character;
  const hadCheckpoint = !!(pc0 && ((pc0._lvlCheckpoint && (pc0._levelUpTarget || pc0._backfillTarget)) || (pc0._genCheckpoint && pc0._levelUpTarget)));
  pendingRoleplayChoices=[]; pendingChoices=[]; pendingItemRolls=[];
  character = restoreLevelCheckpoint(pc0);
  lostPendingNotice = hadPending && !hadCheckpoint ? payload.extra.pendingCount : 0;
  document.getElementById('fName').value = (payload.extra && payload.extra.name) || '';
  document.getElementById('fPlayer').value = (payload.extra && payload.extra.player) || '';
  document.getElementById('fLevel').value = character.level; // not auto-synced by renderAll()
  logEvent(character, 'Персонаж загружен из сохранения.');
  renderAll();
}
function saveCurrentAs(slotName){
  if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
  const store = getSavesStore();
  store[slotName] = { savedAt:new Date().toISOString(), payload:buildSavePayload() };
  setSavesStore(store);
  renderSavesList();
}
function loadSlot(slotName){
  const store = getSavesStore();
  const entry = store[slotName];
  if(!entry || !isValidPayload(entry.payload)){ uiAlert('Сохранение повреждено или не найдено.'); return; }
  applyLoadedPayload(entry.payload);
}
async function deleteSlot(slotName){
  if(!(await uiConfirm(`Удалить сохранение «${slotName}»? Это необратимо.`, {title:'Удалить сохранение', ok:'Удалить', danger:true}))) return;
  const store = getSavesStore();
  delete store[slotName];
  setSavesStore(store);
  renderSavesList();
}
function renderSavesList(){
  const el = document.getElementById('savesListBox');
  const store = getSavesStore();
  const names = Object.keys(store).sort((a,b)=>(store[b].savedAt||'').localeCompare(store[a].savedAt||''));
  if(!names.length){ el.innerHTML = '<span class="muted">Нет сохранений в этом браузере.</span>'; return; }
  el.innerHTML = names.map(n=>{
    const d = new Date(store[n].savedAt);
    return `<div class="item-line" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <span><b>${escapeHtml(n)}</b> <span class="muted">(${escapeHtml(d.toLocaleString())})</span></span>
      <span class="choice-btns"><button class="small" data-load="${encodeURIComponent(n)}">Загрузить</button><button class="small" data-del="${encodeURIComponent(n)}">Удалить</button></span>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-load]').forEach(b=>b.addEventListener('click', ()=>loadSlot(decodeURIComponent(b.dataset.load))));
  el.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ()=>deleteSlot(decodeURIComponent(b.dataset.del))));
}
function exportCharacterToFile(){
  if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
  const payload = buildSavePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const rawName = document.getElementById('fName').value || 'personazh';
  const safeName = rawName.trim().replace(/[^\wа-яА-ЯёЁ\- ]+/g,'').replace(/\s+/g,'_') || 'personazh';
  const a = document.createElement('a');
  a.href = url; a.download = `reincarnator_${safeName}_ur${character.level}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importCharacterFromFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    let payload;
    try{ payload = JSON.parse(reader.result); }
    catch(e){ uiAlert('Не удалось прочитать файл: это не корректный JSON.'); return; }
    if(!isValidPayload(payload)){ uiAlert('Файл не похож на сохранение персонажа «Реинкарнатора».'); return; }
    applyLoadedPayload(payload);
  };
  reader.onerror = ()=> uiAlert('Не удалось прочитать файл.');
  reader.readAsText(file, 'utf-8');
}
document.getElementById('btnSaveAs').onclick = async ()=>{
  if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
  const def = `${document.getElementById('fName').value || 'Без имени'} — ур.${character.level}`;
  const name = await uiPrompt('Название сохранения:', def, {title:'Сохранить как…', ok:'Сохранить'});
  if(!name || !name.trim()) return;
  saveCurrentAs(name.trim());
};
document.getElementById('btnExportFile').onclick = exportCharacterToFile;
document.getElementById('fileImportInput').addEventListener('change', (e)=>{
  const f = e.target.files[0];
  if(f) importCharacterFromFile(f);
  e.target.value = ''; // allow importing the same filename again later
});
document.getElementById('btnRefreshSaves').onclick = renderSavesList;
renderSavesList();

document.getElementById('fLevel').addEventListener('change', (e)=>{
  if(!character) return;
  const newLvl = parseInt(e.target.value,10);
  if(newLvl > character.level){ applyLevelUp(character, newLvl); }
  else if(newLvl < character.level){ applyLevelDown(character, newLvl); }
  renderAll();
});
// Populate the one-click subtype/origin/career selects (option lists, kept in sync with the current
// archetype/career via refreshCareerOptions()/refreshOriginOptions() below).
(function(){
  const genLevelSel = document.getElementById('fLevel');
  for(let i=1;i<=20;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; genLevelSel.appendChild(o); }
  genLevelSel.value = '1';
  refreshArchetypeOptions();
  refreshSubtypeOptions();
  refreshCareerOptions();
  refreshOriginOptions();
})();
// Sets both the displayed label (.value) and the internal key (.dataset.key) for one of the four
// hover-hint dropdowns below — their .value alone can't hold the key once it's a free label string
// (see wireSuggestDropdown), so the key needs somewhere else to live.
function setFieldKeyValue(id, key, label){
  const el = document.getElementById(id);
  el.value = label || '';
  el.dataset.key = key || '';
}
// Archetype: a static list of 7, but still needs the same confirm/switch/revert dance as the other
// three once a character exists, so it's wired the same way rather than kept as the old hardcoded
// <select>.
function refreshArchetypeOptions(){
  const archSel = document.getElementById('fArchetypeSelect');
  const keys = Object.keys(ARCHETYPES);
  const names = keys.map(k=>ARCHETYPES[k].name);
  wireSuggestDropdown('fArchetypeSelect', 'fArchetypeSelectDropdown', names, name=>ARCHETYPE_DESCRIPTIONS[keys[names.indexOf(name)]],
    null, 'Наведите на вариант, чтобы увидеть, кто это — по описанию архетипов книги.',
    async (name)=>{
      const newKey = keys[names.indexOf(name)];
      setFieldKeyValue('fArchetypeSelect', newKey, name);
      refreshSubtypeOptions(); refreshCareerOptions(); refreshOriginOptions();
      if(!character) return; // pre-generation: just refresh the preview lists, nothing to switch yet
      if(newKey === character.archetypeKey) return;
      if(!(await uiConfirm(`Сменить архетип на «${name}»? Все бонусы текущего архетипа и подтипа будут убраны, подтип будет выбран заново случайно.`, {title:'Смена архетипа', ok:'Сменить'}))){
        refreshArchetypeOptions(); refreshSubtypeOptions(); refreshCareerOptions(); refreshOriginOptions();
        return;
      }
      switchArchetype(newKey);
    });
  const desiredKey = character ? character.archetypeKey : (archSel.dataset.key || keys[0]);
  setFieldKeyValue('fArchetypeSelect', desiredKey, ARCHETYPES[desiredKey].name);
}
// Repopulates the "Подтип" hint dropdown from whichever archetype is currently selected/active —
// subtype names are archetype-specific, so this list must be rebuilt whenever the archetype changes.
function refreshSubtypeOptions(){
  const archKey = document.getElementById('fArchetypeSelect').dataset.key || 'avantyurist';
  const arch = ARCHETYPES[archKey] || ARCHETYPE_ADVENTURER;
  const subSel = document.getElementById('fSubtypeSelect');
  const prevKey = subSel.dataset.key;
  const keys = Object.keys(arch.subtypes);
  const names = keys.map(k=>arch.subtypes[k].name);
  wireSuggestDropdown('fSubtypeSelect', 'fSubtypeSelectDropdown', names, name=>hintForSubtype(keys[names.indexOf(name)])||'Нет данных.',
    null, 'Наведите на вариант, чтобы увидеть бонусы подтипа (4-й уровень).',
    async (name)=>{
      const newKey = keys[names.indexOf(name)];
      setFieldKeyValue('fSubtypeSelect', newKey, name);
      if(!character) return;
      if(newKey === character.subtypeKey) return;
      if(!(await uiConfirm(`Сменить подтип на «${name}»? Все бонусы текущего подтипа (случайные, выбранные и фиксированные) будут убраны и пересчитаны заново.`, {title:'Смена подтипа', ok:'Сменить'}))){
        refreshSubtypeOptions();
        return;
      }
      switchSubtype(newKey);
    });
  const desiredKey = (character && character.subtypeKey && keys.includes(character.subtypeKey)) ? character.subtypeKey
    : (keys.includes(prevKey) ? prevKey : '');
  setFieldKeyValue('fSubtypeSelect', desiredKey, desiredKey ? arch.subtypes[desiredKey].name : '');
}
// Careers whose `archetypes` list (per the character creation table, стр. 51) includes this archetype.
function careersForArchetype(archName){
  return Object.keys(CAREERS).filter(k => CAREERS[k].archetypes.some(a=>a.includes(archName)));
}
// Repopulates the "Карьера" hint dropdown to only offer careers compatible with the currently selected
// archetype, per the character creation table (стр. 51) — this is what actually prevents picking a
// career the book doesn't allow for that archetype, rather than just warning about it afterward.
// If the character already has a careerKey that isn't in that list (an older save, or a value set
// before this filtering existed), it's kept as an extra option rather than silently dropped, so the
// field still reflects the truth and the existing "Внимание: ..." warning in switchCareer/generateCharacter
// still has a value to warn about.
function refreshCareerOptions(){
  const archKey = document.getElementById('fArchetypeSelect').dataset.key || 'avantyurist';
  const arch = ARCHETYPES[archKey] || ARCHETYPE_ADVENTURER;
  const allowed = careersForArchetype(arch.name);
  const careerSel = document.getElementById('fCareerSelect');
  const prevKey = careerSel.dataset.key;
  const keys = allowed.slice();
  if(character && character.careerKey && !keys.includes(character.careerKey)) keys.push(character.careerKey);
  const names = keys.map(k=>CAREERS[k].name);
  // Bold = recommended (the archetype appears with "(осн.)" in this career's list — the book's own
  // bold styling in the character creation table, стр. 51); italic = available but not recommended
  // (the archetype is listed without it — grey in the book). Best-practice-for-beginners distinction,
  // not a hard restriction — both are still pickable.
  const formatCareer = (name)=>{
    const k = keys[names.indexOf(name)];
    return CAREERS[k].archetypes.includes(arch.name+'(осн.)') ? 'bold' : 'italic';
  };
  wireSuggestDropdown('fCareerSelect', 'fCareerSelectDropdown', names, name=>CAREER_DESCRIPTIONS[keys[names.indexOf(name)]]||'Нет данных.',
    null, 'Наведите на вариант, чтобы увидеть описание карьеры. Жирным — рекомендованные архетипу карьеры, курсивом — доступные, но не основные.',
    async (name)=>{
      const newKey = keys[names.indexOf(name)];
      setFieldKeyValue('fCareerSelect', newKey, name);
      refreshOriginOptions(); // origin options depend on career — keep the "Происхождение" field in sync
      if(!character) return; // pre-generation: keep the origin preview list in sync, nothing to switch yet
      if(newKey === character.careerKey) return;
      if(!(await uiConfirm(`Сменить карьеру на «${name}»? Все бонусы текущей карьеры (случайные, выбранные и фиксированные) будут убраны и пересчитаны заново.`, {title:'Смена карьеры', ok:'Сменить'}))){
        refreshCareerOptions();
        return;
      }
      switchCareer(newKey);
    }, formatCareer);
  // Keep the previous selection only if it's still valid for the (possibly just-changed) archetype;
  // otherwise reset to "—" so an incompatible combination can't linger in the field. If a character
  // exists, its own careerKey always wins over whatever the field happened to show before — this is
  // what actually syncs the field after a random (unlocked) generation, not just a manual pick.
  const desiredKey = (character && character.careerKey && keys.includes(character.careerKey)) ? character.careerKey
    : (keys.includes(prevKey) ? prevKey : '');
  setFieldKeyValue('fCareerSelect', desiredKey, desiredKey ? CAREERS[desiredKey].name : '');
}
// Origins whose career (per the same table) lists them as compatible.
function refreshOriginOptions(){
  const careerKey = document.getElementById('fCareerSelect').dataset.key;
  const career = CAREERS[careerKey];
  const allowed = career ? career.origins.slice() : Object.keys(ORIGINS);
  const originSel = document.getElementById('fOriginSelect');
  const prevKey = originSel.dataset.key;
  const keys = allowed.slice();
  if(character && character.originKey && !keys.includes(character.originKey)) keys.push(character.originKey);
  const names = keys.map(k=>ORIGINS[k].name);
  wireSuggestDropdown('fOriginSelect', 'fOriginSelectDropdown', names, name=>ORIGIN_DESCRIPTIONS[keys[names.indexOf(name)]],
    null, 'Наведите на вариант, чтобы увидеть описание происхождения.',
    async (name)=>{
      const newKey = keys[names.indexOf(name)];
      setFieldKeyValue('fOriginSelect', newKey, name);
      if(!character) return;
      if(newKey === character.originKey) return;
      if(!(await uiConfirm(`Сменить происхождение на «${name}»? Все бонусы текущего происхождения (случайные, выбранные и фиксированные) будут убраны и пересчитаны заново.`, {title:'Смена происхождения', ok:'Сменить'}))){
        refreshOriginOptions();
        return;
      }
      switchOrigin(newKey);
    });
  const desiredKey = (character && character.originKey && keys.includes(character.originKey)) ? character.originKey
    : (keys.includes(prevKey) ? prevKey : '');
  setFieldKeyValue('fOriginSelect', desiredKey, desiredKey ? ORIGINS[desiredKey].name : '');
}

// ---- Item catalog picker: «Поколение / Категория» via the hex interface, «Предмет» stays a
// dropdown (see openCatalogPicker). Selected pair lives on catGenCatField's own dataset since there's
// no longer a native <select> to read it from.
const CATEGORY_HEX_LABELS = { // short label shown on the hexagon itself; hover shows the full category name
  rations:'Еда', bakaleya:'Еда', armor:'Броня', gear:'Снаряж.', weapons:'Оружие', ammo:'Заряды', medical:'Медиц.', drugs:'Нарк.'
};
function refreshCatalogItems(){
  const field = document.getElementById('catGenCatField');
  const itemSel = document.getElementById('catItemSelect');
  const gen = ITEM_CATALOG[field.dataset.gen];
  const cat = gen && gen.categories[field.dataset.cat];
  itemSel.innerHTML = '';
  if(!cat || !cat.items.length){
    itemSel.innerHTML = '<option value="">—</option>';
    document.getElementById('btnAddFromCatalog').disabled = true;
  } else {
    cat.items.forEach((it,i)=>{
      const o = document.createElement('option'); o.value = i; o.textContent = `${it.name} — ${it.price} кр. (${it.avail})`; itemSel.appendChild(o);
    });
    document.getElementById('btnAddFromCatalog').disabled = false;
  }
  refreshCatalogPreview();
}
function refreshCatalogPreview(){
  const field = document.getElementById('catGenCatField');
  const itemSel = document.getElementById('catItemSelect');
  const preview = document.getElementById('catItemPreview');
  const gen = ITEM_CATALOG[field.dataset.gen];
  const cat = gen && gen.categories[field.dataset.cat];
  const item = cat && cat.items[itemSel.value];
  preview.textContent = item ? `${item.desc} (вес: ${item.weight})` : '';
  const price = item ? catalogPrice(item) : 0, buy = document.getElementById('btnBuyFromCatalog');
  if(buy) buy.disabled = !item || !price;
  if(item && price){
    const line = document.createElement('div'); line.className = 'cat-price-line';
    const have = character ? (Number(character.credits) || 0) : null;
    line.innerHTML = `💰 Цена: <b>${price.toLocaleString('ru-RU')} кр.</b>` + (have==null ? '' : have >= price
      ? ` · у вас ${have.toLocaleString('ru-RU')}, останется ${(have - price).toLocaleString('ru-RU')}`
      : ` · <span class="cat-short">у вас ${have.toLocaleString('ru-RU')} — не хватает ${(price - have).toLocaleString('ru-RU')}</span>`);
    preview.appendChild(line);
  }
}
function quoteName(n){ n = String(n || ''); return /^«.*»$/.test(n) || /[«»]/.test(n) ? n : '«' + n + '»'; } // «Автомат «Бархан»» → Автомат «Бархан»
function catalogPrice(item){ const n = parseInt(String(item && item.price!=null ? item.price : '').replace(/[\s\u00a0]/g, ''), 10); return isFinite(n) && n > 0 ? n : 0; }
// Same press → hexagons appear at cursor → drag → release → commit gesture as the main d20 roll
// (openRollPicker) — reused deliberately, not a new interaction to learn. Hexagons stay the same
// equilateral shape and size; grouped into one row per поколение (with a small heading above each
// row) since «поколение» and «категория» are picked together in one gesture but read more clearly
// grouped than mixed into one undifferentiated field of 25 hexagons.
function openCatalogPicker(clientX, clientY){
  closeRollOverlay(); // shares the same single overlay slot/Esc handler as the dice-roll picker
  const overlay = document.createElement('div');
  overlay.className = 'roll-overlay';
  const popup = document.createElement('div');
  popup.className = 'roll-popup';
  popup.style.visibility = 'hidden';
  const field = document.getElementById('catGenCatField');
  popup.innerHTML = `<div class="hex-field" style="align-items:flex-start;"></div><div class="roll-max-preview"></div>`;
  const hexField = popup.querySelector('.hex-field');
  const preview = popup.querySelector('.roll-max-preview');
  let anchorHex = null;
  Object.keys(ITEM_CATALOG).forEach(genKey=>{
    const gen = ITEM_CATALOG[genKey];
    const catKeys = Object.keys(gen.categories);
    if(!catKeys.length) return;
    const group = document.createElement('div'); group.className = 'cat-picker-group';
    const heading = document.createElement('div'); heading.className = 'cat-picker-group-label'; heading.textContent = gen.label;
    const line = document.createElement('div'); line.className = 'hex-line';
    catKeys.forEach(catKey=>{
      const hex = document.createElement('div'); hex.className = 'hex';
      hex.textContent = CATEGORY_HEX_LABELS[catKey] || gen.categories[catKey].label;
      hex.dataset.mod = genKey+'|'+catKey;
      hex.dataset.full = `${gen.label} — ${gen.categories[catKey].label}`;
      line.appendChild(hex);
      if(genKey===field.dataset.gen && catKey===field.dataset.cat) anchorHex = hex;
    });
    group.appendChild(heading); group.appendChild(line); hexField.appendChild(group);
  });
  preview.textContent = field.textContent==='—' ? 'Наведите на гексагон, чтобы увидеть категорию целиком' : field.textContent;
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  _rollOverlayEl = overlay;
  document.body.classList.add('roll-modal-active');

  const anchorPoint = anchorHex || hexField.querySelector('.hex'); // fall back to the first hex if nothing was picked yet
  const pr = popup.getBoundingClientRect(), hr = anchorPoint.getBoundingClientRect();
  const hexCenterX = hr.left - pr.left + hr.width/2, hexCenterY = hr.top - pr.top + hr.height/2;
  let left = clientX - hexCenterX, top = clientY - hexCenterY;
  left = Math.max(6, Math.min(left, window.innerWidth - pr.width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - pr.height - 6));
  popup.style.left = left+'px'; popup.style.top = top+'px';
  popup.style.visibility = 'visible';

  const hexAt=(x,y)=>{ const el=document.elementFromPoint(x,y); return el&&el.classList&&el.classList.contains('hex')?el:null; };
  const setHovered=(hex)=>{
    hexField.querySelectorAll('.hex.hovered').forEach(h=>h.classList.remove('hovered'));
    if(hex){ hex.classList.add('hovered'); preview.textContent = hex.dataset.full; }
  };
  setHovered(hexAt(clientX, clientY) || anchorPoint);
  let moved = false, tapMode = false;
  const onMove=(e)=>{ if(Math.hypot(e.clientX - clientX, e.clientY - clientY) > 8) moved = true; setHovered(hexAt(e.clientX,e.clientY)); };
  const onUp=(e)=>{
    // Короткий тап (тачпад, телефон): палец отпустили там же, где нажали — окно остаётся, выбор — следующим тапом
    if(!moved && !tapMode){ tapMode = true; preview.textContent = 'Нажмите на нужную категорию'; return; }
    const hex = hexAt(e.clientX,e.clientY) || (tapMode ? null : hexField.querySelector('.hex.hovered'));
    if(tapMode && !hex) return; // тап мимо гексов — ждём дальше (закрыть — тап по фону или Esc)
    closeRollOverlay(); // снимает и window-обработчики жеста через _rollOverlayCleanup, см. его назначение ниже
    if(!hex) return; // released off every hex — cancelled, keep the previous selection
    const [genKey, catKey] = hex.dataset.mod.split('|');
    field.dataset.gen = genKey; field.dataset.cat = catKey;
    field.textContent = hex.dataset.full;
    refreshCatalogItems();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  _rollOverlayCleanup = ()=>{ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  overlay.addEventListener('pointerdown',(e)=>{ if(e.target===overlay) closeRollOverlay(); });
  document.addEventListener('keydown', _rollEscHandler);
}
document.getElementById('catGenCatField').addEventListener('pointerdown', (e)=>{ openCatalogPicker(e.clientX, e.clientY); e.preventDefault(); });
(function(){
  const first = ITEM_CATALOG[Object.keys(ITEM_CATALOG)[0]];
  const firstCatKey = Object.keys(first.categories)[0];
  const field = document.getElementById('catGenCatField');
  field.dataset.gen = Object.keys(ITEM_CATALOG)[0]; field.dataset.cat = firstCatKey;
  field.textContent = `${first.label} — ${first.categories[firstCatKey].label}`;
  refreshCatalogItems();
})();
document.getElementById('catItemSelect').addEventListener('change', refreshCatalogPreview);
function selectedCatalogItem(){
  const field = document.getElementById('catGenCatField');
  const gen = ITEM_CATALOG[field.dataset.gen];
  const cat = gen && gen.categories[field.dataset.cat];
  const item = cat && cat.items[document.getElementById('catItemSelect').value];
  return item ? {gen, cat, item} : null;
}
function addCatalogItem(sel, source){
  const category = sel.item.weight.includes('Крш') ? 'tiny' : 'backpack';
  character.inventory[category].push({id:uid(), name:`${sel.item.name} — ${sel.item.desc}`, weight:sel.item.weight, source});
}
document.getElementById('btnAddFromCatalog').addEventListener('click', ()=>{
  if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
  const sel = selectedCatalogItem(); if(!sel) return;
  addCatalogItem(sel, 'Добавлено из каталога (книга)');
  logEvent(character, `Предмет добавлен из каталога (${sel.gen.label} / ${sel.cat.label}): ${quoteName(sel.item.name)}.`);
  renderAll();
  uiToast(`В инвентарь: ${quoteName(sel.item.name)} (без оплаты)`, {icon:'+'});
});
// Покупка: предмет — в инвентарь, цена — с кредитов (запись в журнале кредитов, как и у остальных изменений).
// Не хватает — предупреждение с выбором: отказаться или взять без оплаты (находка, подарок, долг на словах).
document.getElementById('btnBuyFromCatalog').addEventListener('click', async ()=>{
  if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
  const sel = selectedCatalogItem(); if(!sel) return;
  const price = catalogPrice(sel.item), have = Number(character.credits) || 0;
  if(!price) return;
  if(have < price){
    const r = await uiDialog({title:'Не хватает кредитов', icon:'💰', danger:true,
      text:`${quoteName(sel.item.name)} стоит ${price.toLocaleString('ru-RU')} кр., у вас ${have.toLocaleString('ru-RU')} — не хватает ${(price - have).toLocaleString('ru-RU')} кр.`,
      cancelValue:null, buttons:[{label:'Взять без оплаты', value:'free'}, {label:'Не покупать', value:null, primary:true}]});
    if(r!=='free') return;
    addCatalogItem(sel, 'Из каталога (книга), без оплаты');
    logEvent(character, `Предмет взят из каталога без оплаты (не хватило кредитов): ${quoteName(sel.item.name)}, цена ${price} кр.`);
    renderAll(); uiToast(`В инвентарь: ${quoteName(sel.item.name)} (без оплаты)`, {icon:'+'});
    return;
  }
  addCatalogItem(sel, `Куплено за ${price} кр. (каталог книги)`);
  character.creditsLog.push({source:`Покупка: ${sel.item.name}`, amount:-price});
  character.credits = have - price;
  logEvent(character, `Куплено из каталога (${sel.gen.label} / ${sel.cat.label}): ${quoteName(sel.item.name)} за ${price} кр. Осталось ${character.credits} кр.`);
  renderAll();
  uiToast(`Куплено: ${quoteName(sel.item.name)} за ${price.toLocaleString('ru-RU')} кр. · осталось ${character.credits.toLocaleString('ru-RU')}`, {icon:'💰'});
});
document.getElementById('fReligionText').addEventListener('input', (e)=>{
  if(character) character.religionText = e.target.value;
});
// Reusable "free text + suggestion dropdown" wiring — used for Мировоззрение (стр. 78, 8 options),
// Религия (стр. 197-198, 6 options), Возраст (стр. 73, 4 options), Архетип/Подтип/Карьера/Происхождение.
// The field is normally a plain text input the player can type anything into; the dropdown (shown
// while focused, via CSS :focus-within — see .align-dropdown) is just a shortcut, with each option's
// description swapped into a footer strip on hover. `onPick(name)`, when given, replaces the default
// "just store the picked text on the character" behavior — Возраст (and the four key-backed fields)
// need this since their field must resolve to one of a fixed set of internal keys (they drive real
// mechanics), not hold whatever free text was last picked. `formatFn(name)`, when given, returns a CSS
// class ('bold'/'italic'/'') applied to that option's row — used for the career list's recommended
// (bold, стр. 51) vs merely-available (italic) archetype synergy, per the book's own table styling.
function wireSuggestDropdown(inputId, dropdownId, names, describe, charField, placeholderDesc, onPick, formatFn){
  const dropdown = document.getElementById(dropdownId);
  const input = document.getElementById(inputId);
  const descId = dropdownId+'Desc';
  const listHtml = names.map((n,i)=>{
    const cls = formatFn ? formatFn(n) : '';
    return `<div class="align-dropdown-item${cls?' '+cls:''}" data-i="${i}">${n}</div>`;
  }).join('');
  dropdown.innerHTML = `<div class="align-dropdown-list">${listHtml}</div><div class="align-dropdown-desc" id="${descId}">${placeholderDesc}</div>`;
  const descEl = document.getElementById(descId);
  dropdown.querySelectorAll('.align-dropdown-item').forEach(item=>{
    const n = names[parseInt(item.dataset.i,10)];
    item.addEventListener('mouseenter', ()=>{ descEl.textContent = describe(n); });
    item.addEventListener('mouseleave', ()=>{ descEl.textContent = placeholderDesc; });
    // mousedown (not click) + preventDefault: click alone would first fire blur on the input, which
    // hides this dropdown (:focus-within) before the click lands — mousedown fires first and, with
    // default prevented, never moves focus away, so the dropdown stays open through the whole pick.
    item.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      input.value = n;
      if(onPick) onPick(n);
      else if(character) character[charField] = n;
      input.blur();
    });
  });
}
wireSuggestDropdown('fAlignment', 'fAlignmentDropdown', ALIGNMENTS.map(a=>a.name), n=>ALIGNMENTS.find(a=>a.name===n).text, 'alignment',
  'Наведите на вариант, чтобы увидеть описание — или впишите своё мировоззрение.');
document.getElementById('fAlignment').addEventListener('input', (e)=>{
  if(character) character.alignment = e.target.value;
});
wireSuggestDropdown('fReligionText', 'fReligionDropdown', CULTIST_RELIGIONS, n=>RELIGION_DESCRIPTIONS[n], 'religionText',
  'Наведите на вариант, чтобы увидеть описание — или впишите свою религию.');
wireSuggestDropdown('fAge', 'fAgeDropdown', Object.values(AGE_BRACKETS).map(b=>b.label),
  label=>Object.values(AGE_BRACKETS).find(b=>b.label===label).desc, null,
  'Наведите на вариант, чтобы увидеть, что получает персонаж за этот возраст.',
  (label)=>{
    if(!character) return;
    const newKey = Object.keys(AGE_BRACKETS).find(k=>AGE_BRACKETS[k].label===label);
    if(!newKey || newKey===character.ageKey) return;
    const oldLabel = (AGE_BRACKETS[character.ageKey] || AGE_BRACKETS.y20_29).label;
    character.ageKey = newKey;
    logEvent(character, `Возраст изменён: ${oldLabel} → ${label}.`);
    renderAll();
  });
document.getElementById('fHugeCapacity').addEventListener('input', (e)=>{
  if(character) character.hugeItemsCapacity = e.target.value;
});
document.getElementById('fAppearanceNum').addEventListener('change', (e)=>{
  if(!character) return;
  const v = parseInt(e.target.value,10);
  if(Number.isNaN(v)){ renderAll(); return; }
  if(v !== character.appearance){ logEvent(character, `Внешний вид изменён вручную: ${character.appearance} → ${v}.`); character.appearance = v; }
  renderAll();
});
document.getElementById('fSizeNum').addEventListener('change', (e)=>{
  if(!character) return;
  const v = parseInt(e.target.value,10);
  if(Number.isNaN(v)){ renderAll(); return; }
  if(v !== character.size){ logEvent(character, `Размер изменён вручную: ${character.size} → ${v}.`); character.size = v; reclampVitals(character); }
  renderAll();
});
document.getElementById('fLuckNum').addEventListener('change', (e)=>{
  if(!character) return;
  const v = parseInt(e.target.value,10);
  if(Number.isNaN(v)){ renderAll(); return; }
  if(v !== character.luck){ logEvent(character, `Удача изменена вручную: ${character.luck} → ${v}.`); character.luck = v; }
  renderAll();
});
document.getElementById('fXpNum').addEventListener('change', (e)=>{
  if(!character) return;
  const v = parseInt(e.target.value,10);
  if(Number.isNaN(v)){ renderAll(); return; }
  const cur = character.xp||0;
  if(v !== cur){ logEvent(character, `Опыт изменён вручную: ${cur} → ${v}.`); character.xp = v; }
  renderAll();
});
document.getElementById('fCredits').addEventListener('change', (e)=>{
  if(!character) return;
  const v = parseInt(e.target.value,10);
  if(Number.isNaN(v)){ renderAll(); return; }
  const delta = v - character.credits;
  if(delta !== 0){
    character.creditsLog.push({source:'Игрок (ручное изменение)', amount:delta});
    character.credits = v;
    logEvent(character, `Кредиты изменены вручную: ${v-delta} → ${v}.`);
  }
  renderAll();
});
document.getElementById('fSiz').addEventListener('input', (e)=>{
  if(!character) return;
  character.siz = parseInt(e.target.value,10)||0;
  renderSaves();
});
document.getElementById('fPsiSoprot').addEventListener('input', (e)=>{
  if(!character) return;
  character.psiSoprot = parseInt(e.target.value,10)||0;
  renderSaves();
});
document.getElementById('fRestEquipMod').addEventListener('input', (e)=>{
  if(!character) return;
  character.restEquipMod = parseInt(e.target.value,10)||0;
  renderRest();
});
document.getElementById('fArmorBody').addEventListener('input', (e)=>{ if(character) character.armor.body = parseInt(e.target.value,10)||0; });
document.getElementById('fArmorHelmet').addEventListener('input', (e)=>{ if(character) character.armor.helmet = parseInt(e.target.value,10)||0; });
document.getElementById('fArmorProps').addEventListener('input', (e)=>{ if(character) character.armor.properties = e.target.value; });
document.getElementById('fConditionsNotes').addEventListener('input', (e)=>{ if(character) character.conditionsNotes = e.target.value; });
(function(){
  const map = [['stBodrost','bodrost'],['stIstoshenie','istoshenie'],['stIspug','ispug'],['stStress','stress']];
  map.forEach(([id,key])=>{
    document.getElementById(id).addEventListener('change', (e)=>{
      if(!character) return;
      character.states[key] = e.target.checked;
      logEvent(character, `Состояние «${key}»: ${e.target.checked ? 'включено' : 'выключено'}.`);
      renderAll();
    });
  });
})();
function wireMetricDial(inputId, label, getMax, getCurrent, setCurrent){
  const el = document.getElementById(inputId);
  el.addEventListener('focus', ()=>{
    if(!character) return;
    el.value = getCurrent(character); // show the raw number for editing
    el.select();
  });
  el.addEventListener('blur', ()=>{
    if(!character) return;
    const raw = el.value.trim();
    const parsed = parseInt(raw, 10);
    if(raw === '' || Number.isNaN(parsed)){
      // impossible/unparseable value entered -> revert to whatever it was before
      renderAll();
      return;
    }
    const before = getCurrent(character);
    const after = clampLower(parsed, getMax(character));
    if(after !== before){
      setCurrent(character, after);
      logEvent(character, `${label}: ${before} → ${after}.`);
    }
    renderAll();
  });
  el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') el.blur(); });
}
wireMetricDial('hpValue', 'Здоровье', hpMax, c=>c.hpCurrent, (c,v)=>{ c.hpCurrent = v; });
wireMetricDial('psiValue', 'Пси-запас', psiMax, c=>c.psiCurrent, (c,v)=>{ c.psiCurrent = v; });
document.querySelectorAll('button[data-inv]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    if(!character){ uiAlert('Сначала сгенерируйте персонажа.'); return; }
    const cat = btn.dataset.inv;
    const r = await uiForm('Новый предмет', [{name:'name', label:'Название', value:'', placeholder:'например, «Верёвка 10 м»'},
      {name:'weight', label:'Вес (как в книге: число, «к6», «1 Крш.» — можно пусто)', value:''}], {ok:'Добавить'});
    if(!r) return;
    const name = r.name, weight = r.weight;
    if(!name || !name.trim()) return;
    character.inventory[cat].push({id:uid(), name:name.trim(), weight:(weight&&weight.trim())?weight.trim():'—', source:'Игрок'});
    logEvent(character, `Предмет добавлен в инвентарь (${cat}): «${name.trim()}».`);
    renderAll();
  });
});
document.getElementById('btnClearHistory').addEventListener('click', async ()=>{
  if(!character) return;
  if(await uiConfirm('Очистить журнал изменений для этого персонажа?', {title:'Журнал изменений', ok:'Очистить', danger:true})){
    character.history = [];
    renderAll();
  }
});

