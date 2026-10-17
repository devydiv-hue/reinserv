/* ======================================================================
   НАХОДКИ — лопата у каждого подключённого игрока в списке Мастера.
   Мастер выбирает куб (к20 или к12) таблицы «Определите таблицу Находок», затем идёт бросок по
   выпавшей таблице (LOOT_TABLES). На 12 («Вещи мертвецов») — сначала категория: Мастер выбирает её
   сам или бросает по книге (к12 дважды, меньший, +0/+1/+2). Вложенные броски строки (подбросок к6,
   «умножьте вес и цену на 1к6», «1к6 штук», «шанс 2 из 6», «один из артефактов») докидываются сами.
   Опционально — «Состояние Находки» (к12). Предмет уходит игроку только по «Выдать» — той же очередью
   с подтверждением, что удача и опыт (sendGrant, kind:'item'); в общий лог пишется итог.
   ====================================================================== */
function lootRollExpr(expr){ // '1к6', '2к20', '1к6+2', '4к6'
  const m = String(expr).match(/^(\d*)к(\d+)(?:\+(\d+))?$/);
  if(!m) return {total:1, text:String(expr)};
  const n = Number(m[1]||1), sides = Number(m[2]), add = Number(m[3]||0);
  const rolls = []; for(let i=0;i<n;i++) rolls.push(randInt(sides));
  const total = rolls.reduce((a,b)=>a+b, 0) + add;
  return {total, text:`${expr}=${rolls.length>1?'['+rolls.join('+')+']':rolls[0]}${add?'+'+add:''}${rolls.length>1||add?'='+total:''}`};
}
function lootFind(rows, r){ return rows.find(x=>r>=x[0] && r<=x[1]); }
function lootParseWeight(w){
  if(w===''||w==null) return null;
  if(typeof w==='number') return {n:w, unit:'Вещь'};
  const m = String(w).match(/^(\d+)?\s*(Крш|Огр)$/);
  return m ? {n:Number(m[1]||1), unit:m[2]} : null;
}
function lootFormatWeight(w){
  if(!w) return '—';
  if(w.unit==='Крш') return `${w.n} Крш.`;
  if(w.unit==='Огр') return `${w.n} Огр.`;
  const a = w.n%10, b = w.n%100;
  return `${w.n} ${a===1&&b!==11 ? 'Вещь' : (a>=2&&a<=4&&(b<12||b>14)) ? 'Вещи' : 'Вещей'}`;
}
// Строки «Вещей мертвецов» со ссылкой «(см. стр. N)» по возможности берут полное описание из каталога
// книги (ITEM_CATALOG) — тогда оружие и броня сразу работают в листе (атака, «Надеть» и т.п.).
const _lootNorm = (s)=>String(s).toLowerCase().replace(/ё/g,'е').replace(/[«»"]/g,'').replace(/[\s\-‑–—]+/g,' ').trim();
let _lootCatalogIndex = null;
function lootCatalogItem(name){
  if(!_lootCatalogIndex){
    _lootCatalogIndex = new Map();
    Object.values(ITEM_CATALOG).forEach(g=>Object.values(g.categories).forEach(c=>Object.values(c.items).forEach(it=>{
      const k = _lootNorm(it.name); if(!_lootCatalogIndex.has(k)) _lootCatalogIndex.set(k, it);
    })));
  }
  return _lootCatalogIndex.get(_lootNorm(name)) || null;
}
// Разворачивает строку таблицы в предмет: {text, weight:{n,unit}|null, price, notes[], pick?, gmText?}.
// steps — человекочитаемая цепочка бросков для окна и лога.
function lootResolveRow(row, steps){
  const extra = row[5] || {};
  if(extra.sub){
    const r = randInt(extra.sub.die);
    const sub = lootFind(extra.sub.rows, r);
    steps.push(`подбросок к${extra.sub.die}=${r}`);
    return lootResolveRow(sub, steps);
  }
  if(extra.roll){
    const t = LOOT_TABLES[extra.roll];
    const r = randInt(t.die);
    steps.push(`«${t.title}» к${t.die}=${r}`);
    return lootResolveRow(lootFind(t.rows, r), steps);
  }
  const item = {text:row[4], weight:lootParseWeight(row[2]), price:row[3], notes:[], pick:extra.pick||null, gmText:!!extra.gmText};
  item.text = item.text.replace(/\{([^}]+)\}/g, (all, expr)=>{ const x = lootRollExpr(expr); item.notes.push(x.text); return String(x.total); });
  if(extra.mul){
    const x = lootRollExpr(extra.mul);
    item.notes.push(`вес и цена ×${x.text}`);
    item.text += ` ×${x.total}`;
    if(item.weight) item.weight = {n:item.weight.n*x.total, unit:item.weight.unit};
    if(typeof item.price==='number') item.price *= x.total;
  }
  if(extra.mulPrice){
    const x = lootRollExpr(extra.mulPrice);
    item.notes.push(`цена ×${x.text}`);
    if(typeof item.price==='number') item.price *= x.total;
  }
  const cat = lootCatalogItem(extra.cat || row[4].replace(/\s*\(см\. стр\.[^)]*\)/g,'').replace(/\{[^}]*\}\s*/g,''));
  if(cat && cat.desc) item.text = `${item.text.replace(/\s*\(см\. стр\.[^)]*\)/g,'')} — ${cat.desc.replace(/\.\s*$/,'')}`;
  if(extra.chance){
    const r = randInt(extra.chance.die), ok = r<=extra.chance.max;
    item.notes.push(`к${extra.chance.die}=${r}`);
    item.text += ` (${ok ? extra.chance.yes : extra.chance.no})`;
  }
  return item;
}

const lootDig = { playerId:null, die:20, cond:true, steps:[], tableKey:null, item:null, condRow:null, condRoll:null, phase:'die', deadMod:0, relicText:'' };
function openLootDig(playerId){
  if(session.role!=='gm' || !session.players[playerId]) return;
  Object.assign(lootDig, { playerId, steps:[], tableKey:null, item:null, condRow:null, condRoll:null, phase:'die', relicText:'', pickedArtifact:null });
  renderLootDig();
}
function closeLootDig(){
  const el = document.getElementById('lootDigPopup'); if(el) el.remove();
  const bd = document.getElementById('lootDigBackdrop'); if(bd) bd.remove();
  lootDig.playerId = null;
}
function lootRollMain(die){
  lootDig.die = die;
  const r = randInt(die);
  const key = lootFind(LOOT_MAIN, r)[2];
  lootDig.steps = [`к${die}=${r} → ${key==='dead' ? '«Вещи мертвецов»' : '«'+LOOT_TABLES[key].title+'»'}`];
  if(key==='dead'){ lootDig.phase = 'dead'; renderLootDig(); return; }
  lootRollTable(key);
}
function lootPickDeadCategory(key, how){
  lootDig.steps = lootDig.steps.slice(0, 1);
  lootDig.steps.push(how ? `${how} → «${LOOT_TABLES[key].title.replace('Вещи мертвецов: ','')}»` : `категория на выбор Мастера → «${LOOT_TABLES[key].title.replace('Вещи мертвецов: ','')}»`);
  lootRollTable(key);
}
function lootRollDeadByBook(){
  const a = randInt(12), b = randInt(12), mod = lootDig.deadMod;
  const v = Math.min(12, Math.min(a, b) + mod);
  lootPickDeadCategory(lootFind(LOOT_DEAD_CATEGORIES, v)[2], `2к12=[${a}, ${b}] меньший${mod?` +${mod}`:''} = ${v}`);
}
function lootRollTable(key){
  const t = LOOT_TABLES[key];
  lootDig.tableKey = key;
  const base = lootDig.steps.filter(s=>!s.startsWith('·'));
  const steps = [];
  const r = randInt(t.die);
  steps.push(`· к${t.die}=${r}`);
  const item = lootResolveRow(lootFind(t.rows, r), steps);
  lootDig.steps = base.concat(steps.length>1 ? [steps[0] + ', ' + steps.slice(1).join(', ')] : steps);
  lootDig.item = item;
  lootDig.condRow = null; lootDig.condRoll = null; lootDig.pickedArtifact = null;
  if(lootDig.cond && !item.pick && !item.gmText){
    lootDig.condRoll = randInt(12);
    lootDig.condRow = lootFind(LOOT_CONDITION, lootDig.condRoll);
  }
  lootDig.phase = 'result';
  renderLootDig();
}
function lootChooseArtifact(idx){
  const row = LOOT_TABLES.artifacts.rows[idx];
  if(!row) return;
  const steps = [];
  lootDig.item = lootResolveRow(row, steps);
  lootDig.pickedArtifact = idx; // список выбора остаётся на экране — Мастер может передумать
  lootDig.item.notes = lootDig.item.notes.concat(['выбор Мастера']);
  if(lootDig.cond){ lootDig.condRoll = randInt(12); lootDig.condRow = lootFind(LOOT_CONDITION, lootDig.condRoll); }
  renderLootDig();
}
// Итоговая строка инвентаря: текст, цена (с учётом состояния), состояние.
function lootFinalItem(){
  const it = lootDig.item; if(!it) return null;
  let text = it.gmText ? (lootDig.relicText.trim() ? `Реликвия: ${lootDig.relicText.trim()}` : '') : it.text;
  if(it.pick) return null;
  if(!text) return null;
  let price = it.price;
  if(lootDig.condRow){
    const div = lootDig.condRow[3];
    text += ` [состояние: ${lootDig.condRow[2]}${div>1?`, цена продажи ÷${div}`:''}]`;
    if(div>1 && typeof price==='number') price = Math.round(price/div);
  }
  if(price!=='' && price!=null) text += ` (цена ${price})`;
  const weight = lootFormatWeight(it.weight);
  return { name:text.slice(0, 2000), weight, category: it.weight && it.weight.unit==='Крш' ? 'tiny' : 'backpack' };
}
function lootGive(){
  const p = session.players[lootDig.playerId];
  const fin = lootFinalItem();
  if(!fin) return;
  sendGrant(lootDig.playerId, {kind:'item', item:fin});
  if(typeof GmAdvice!=='undefined') GmAdvice.event('loot');
  const short = fin.name.length>140 ? fin.name.slice(0, 140)+'…' : fin.name;
  const chain = lootDig.steps.map(s=>s.replace(/^· /,'')).join(' → ');
  recordAndShareQuickRoll({loot:true, target:(p && p.name) || xpRoster[lootDig.playerId] || 'игрок',
    text:`${chain}${lootDig.condRow?` → состояние к12=${lootDig.condRoll}`:''} → «${short}» (${fin.weight})`});
  closeLootDig();
  renderPlayersList();
}
function renderLootDig(){
  const p = session.players[lootDig.playerId];
  if(!p){ closeLootDig(); return; }
  let bd = document.getElementById('lootDigBackdrop');
  if(!bd){ bd = document.createElement('div'); bd.id = 'lootDigBackdrop'; bd.className = 'loot-backdrop'; bd.onclick = closeLootDig; document.body.appendChild(bd); }
  let el = document.getElementById('lootDigPopup');
  if(!el){ el = document.createElement('div'); el.id = 'lootDigPopup'; el.className = 'reroll-popup loot-popup'; document.body.appendChild(el); }
  const stepsHtml = lootDig.steps.length ? `<div class="loot-steps">${lootDig.steps.map(s=>`<div>${escapeHtml(s.replace(/^· /,''))}</div>`).join('')}</div>` : '';
  let body = '';
  if(lootDig.phase==='die'){
    body = `<div class="reroll-desc">Определите таблицу Находок</div>
      <div class="loot-dice"><button type="button" data-loot-die="20">к20</button><button type="button" data-loot-die="12">к12</button></div>
      <label class="loot-cond"><input type="checkbox" id="lootCondChk" ${lootDig.cond?'checked':''}> Бросать состояние Находки (к12)</label>`;
  } else if(lootDig.phase==='dead'){
    body = `${stepsHtml}<div class="reroll-desc">Категория «Вещей мертвецов»: выберите сами или бросьте по книге (к12 дважды, меньший).</div>
      <div class="loot-cats">${LOOT_DEAD_CATEGORIES.map(c=>`<button type="button" data-loot-cat="${c[2]}">${c[0]===c[1]?c[0]:c[0]+'–'+c[1]} · ${escapeHtml(LOOT_TABLES[c[2]].title.replace('Вещи мертвецов: ',''))}</button>`).join('')}</div>
      <div class="loot-book"><button type="button" data-loot-book="1">🎲 Бросить по книге</button>
        <label>модификатор <select id="lootDeadMod">${[0,1,2].map(m=>`<option value="${m}" ${lootDig.deadMod===m?'selected':''}>+${m}</option>`).join('')}</select></label></div>`;
  } else {
    const it = lootDig.item;
    const fin = lootFinalItem();
    let pickHtml = '';
    if(it.pick || lootDig.pickedArtifact!=null) pickHtml = `<div class="loot-pick"><label>Артефакт на выбор Мастера: <select id="lootArtifactSel"><option value="">— выберите —</option>${
      LOOT_TABLES.artifacts.rows.map((r, i)=>`<option value="${i}" ${lootDig.pickedArtifact===i?"selected":""}>${escapeHtml(r[4].split(/ — |\. /)[0].slice(0, 60))}</option>`).join('')}</select></label></div>`;
    if(it.gmText) pickHtml = `<div class="loot-pick"><label>Реликвия на выбор Мастера (стр. 242): <input type="text" id="lootRelicText" value="${escapeHtml(lootDig.relicText)}" placeholder="название и свойства"></label></div>`;
    const cond = lootDig.condRow ? `<div class="loot-meta">Состояние (к12=${lootDig.condRoll}): ${escapeHtml(lootDig.condRow[2])}${lootDig.condRow[3]>1?` — цена продажи ÷${lootDig.condRow[3]}`:''}</div>` : '';
    const notes = it.notes.length ? `<div class="loot-meta">Броски: ${escapeHtml(it.notes.join('; '))}</div>` : '';
    body = `${stepsHtml}
      <div class="loot-item">${fin ? escapeHtml(fin.name) : '<span class="muted">'+escapeHtml(it.text)+'</span>'}</div>
      ${fin ? `<div class="loot-meta">Вес: ${escapeHtml(fin.weight)} · в «${fin.category==='tiny'?'Крошечные вещи':'Вещи в рюкзаке'}»</div>` : ''}
      ${notes}${cond}${pickHtml}
      <div class="loot-actions">
        <button type="button" data-loot-give="1" ${fin?'':'disabled'}>✔ Выдать</button>
        <button type="button" data-loot-reroll="1" title="Ещё раз по той же таблице">🎲 Перебросить</button>
        <button type="button" data-loot-restart="1">↺ Сначала</button>
      </div>`;
  }
  el.innerHTML = `<button type="button" class="reroll-close" title="Закрыть">✕</button>
    <div class="reroll-title">${LOOT_SHOVEL_SVG} Находка — ${escapeHtml(p.name||'игрок')}</div>${body}`;
  el.querySelector('.reroll-close').onclick = closeLootDig;
  el.querySelectorAll('[data-loot-die]').forEach(b=>b.onclick = ()=>lootRollMain(Number(b.dataset.lootDie)));
  const chk = el.querySelector('#lootCondChk'); if(chk) chk.onchange = ()=>{ lootDig.cond = chk.checked; };
  el.querySelectorAll('[data-loot-cat]').forEach(b=>b.onclick = ()=>lootPickDeadCategory(b.dataset.lootCat));
  const modSel = el.querySelector('#lootDeadMod'); if(modSel) modSel.onchange = ()=>{ lootDig.deadMod = Number(modSel.value)||0; };
  const book = el.querySelector('[data-loot-book]'); if(book) book.onclick = lootRollDeadByBook;
  const art = el.querySelector('#lootArtifactSel'); if(art) art.onchange = ()=>{ if(art.value!=='') lootChooseArtifact(Number(art.value)); };
  const relic = el.querySelector('#lootRelicText');
  if(relic) relic.oninput = ()=>{ lootDig.relicText = relic.value; const give = el.querySelector('[data-loot-give]'); if(give) give.disabled = !relic.value.trim(); };
  const give = el.querySelector('[data-loot-give]'); if(give) give.onclick = lootGive;
  const reroll = el.querySelector('[data-loot-reroll]'); if(reroll) reroll.onclick = ()=>lootRollTable(lootDig.tableKey);
  const restart = el.querySelector('[data-loot-restart]'); if(restart) restart.onclick = ()=>{ lootDig.phase = 'die'; lootDig.steps = []; lootDig.item = null; renderLootDig(); };
}
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && lootDig.playerId) closeLootDig(); });

/* ======================================================================
   ВЫДАЧИ МАСТЕРА С ПОДТВЕРЖДЕНИЕМ — удача, опыт, правка HP/Psi с игрового стола.
   Раньше это были разовые сообщения: если игрок в этот момент был отключён (сеть моргнула, ноутбук
   уснул), сервер молча отбрасывал сообщение, а копия листа у Мастера, обновлённая сразу, при следующем
   листе от игрока тихо откатывалась — Мастер думал, что выдал, игрок не получал ничего.
   Теперь каждая выдача — запись с уникальным gid в очереди Мастера (localStorage, переживает и его
   перезагрузку). Она досылается, пока игрок её не подтвердит (grant-ack), — при каждом его
   (пере)подключении и приходе его листа. Игрок применяет выдачу ровно один раз (помнит gid), повтор
   просто подтверждает ещё раз.
   ====================================================================== */
const GRANT_OUTBOX_KEY = 'reincarnator_grant_outbox_v1';     // (Мастер) playerId -> [выдачи в порядке создания]
const GRANT_APPLIED_KEY = 'reincarnator_grants_applied_v1';  // (игрок) gid уже применённых выдач
let grantOutbox = (function(){
  try{ const v = JSON.parse(localStorage.getItem(GRANT_OUTBOX_KEY)||'{}'); return v && typeof v==='object' && !Array.isArray(v) ? v : {}; }
  catch(e){ return {}; }
})();
function saveGrantOutbox(){ try{ localStorage.setItem(GRANT_OUTBOX_KEY, JSON.stringify(grantOutbox)); }catch(e){} }
function pendingGrants(playerId){ return grantOutbox[playerId] || []; }
function loadAppliedGrants(){ try{ const v = JSON.parse(localStorage.getItem(GRANT_APPLIED_KEY)||'[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
function grantAlreadyApplied(gid){ return loadAppliedGrants().indexOf(gid)>=0; }
function markGrantApplied(gid){
  const list = loadAppliedGrants();
  if(list.indexOf(gid)<0) list.push(gid);
  try{ localStorage.setItem(GRANT_APPLIED_KEY, JSON.stringify(list.slice(-500))); }catch(e){}
}
function sanitizeGrant(g){
  if(!g || typeof g!=='object' || typeof g.gid!=='string' || !g.gid || g.gid.length>64) return null;
  const int = (v)=>{ const x = Number(v); return Number.isFinite(x) ? Math.round(x) : null; };
  if(g.kind==='luck' || g.kind==='xp'){ const delta = int(g.delta); return delta ? {gid:g.gid, kind:g.kind, delta} : null; }
  if(g.kind==='vitals'){
    const value = int(g.value);
    if(value===null) return null;
    return {gid:g.gid, kind:'vitals', which: g.which==='psi' ? 'psi' : 'hp', mode: g.mode==='delta' ? 'delta' : 'set', value};
  }
  if(g.kind==='item'){ // находка (см. НАХОДКИ)
    const it = g.item;
    if(!it || typeof it!=='object' || typeof it.name!=='string' || !it.name.trim()) return null;
    return {gid:g.gid, kind:'item', item:{ name:it.name.slice(0, 2000), weight:String(it.weight==null?'—':it.weight).slice(0, 30), category: it.category==='tiny' ? 'tiny' : 'backpack' }};
  }
  return null;
}
// Одна и та же арифметика и для самого игрока, и для копии листа у Мастера. Возвращает строку для журнала
// изменений листа или '' (ничего не изменилось).
function applyGrant(c, g){
  if(!c || !g) return '';
  if(g.kind==='luck'){
    c.luck = (c.luck==null ? 1 : c.luck) + g.delta;
    return `Мастер выдал удачу (${g.delta>=0?'+':''}${g.delta}) — теперь ${c.luck}.`;
  }
  if(g.kind==='xp'){
    c.xp = (c.xp||0) + g.delta;
    return `Мастер начислил опыт (${g.delta>=0?'+':''}${g.delta}) — теперь ${c.xp}.`;
  }
  if(g.kind==='vitals'){
    const key = g.which==='psi' ? 'psiCurrent' : 'hpCurrent';
    const max = g.which==='psi' ? psiMax(c) : hpMax(c);
    const before = c[key];
    const after = clampLower(Math.round(g.mode==='delta' ? (Number(before)||0) + g.value : g.value), max);
    if(after===before) return '';
    c[key] = after;
    return `Мастер изменил ${g.which==='psi'?'пси-запас':'здоровье'} на игровом столе: ${before} → ${after}.`;
  }
  if(g.kind==='item'){
    // id предмета выводится из gid — копия Мастера и лист игрока получают одну и ту же запись, а повторное
    // наложение неподтверждённой выдачи (reapplyPendingGrants) поверх листа, где она уже есть, ничего не дублирует.
    const id = 'loot-' + g.gid;
    const inv = c.inventory || (c.inventory = {on_body:[], backpack:[], tiny:[], pockets:[]});
    if(['on_body','pockets','backpack','tiny'].some(k=>(inv[k]||[]).some(x=>x.id===id))) return '';
    (inv[g.item.category] || (inv[g.item.category] = [])).push({id, name:g.item.name, weight:g.item.weight, source:'Находка (выдал Мастер)'});
    const short = g.item.name.length>80 ? g.item.name.slice(0, 80)+'…' : g.item.name;
    return `Мастер выдал находку: «${short}».`;
  }
  return '';
}
function sendGrant(playerId, fields){
  const g = Object.assign({gid:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}, fields);
  const list = grantOutbox[playerId] || (grantOutbox[playerId] = []);
  list.push(g);
  if(list.length>200) list.splice(0, list.length-200);
  saveGrantOutbox();
  const p = session.players[playerId];
  if(p && p.character) applyGrant(p.character, g); // копия Мастера — сразу, не дожидаясь подтверждения
  sendMsg({type:'grant', grant:g}, playerId);
}
const _grantResentAt = {};
function resendPendingGrants(playerId, force){
  const list = pendingGrants(playerId);
  if(!list.length) return;
  const now = Date.now();
  if(!force && _grantResentAt[playerId] && now - _grantResentAt[playerId] < 3000) return; // лист игрока приходит часто — не засыпаем его повторами
  _grantResentAt[playerId] = now;
  list.forEach(g=>sendMsg({type:'grant', grant:g}, playerId));
}
// Свежий лист от игрока ещё не содержит того, что он не успел получить, — поверх него заново накладываем
// неподтверждённые выдачи, чтобы копия Мастера (и жетон на столе) не «откатывались» на время доставки.
function reapplyPendingGrants(playerId){
  const p = session.players[playerId];
  if(p && p.character) pendingGrants(playerId).forEach(g=>applyGrant(p.character, g));
}
function acknowledgeGrant(playerId, gid){
  const list = grantOutbox[playerId];
  if(!list) return;
  const i = list.findIndex(g=>g.gid===gid);
  if(i<0) return;
  list.splice(i, 1);
  if(!list.length) delete grantOutbox[playerId];
  saveGrantOutbox();
  renderPlayersList();
}
// (игрок) Применить выдачу от Мастера. Подтверждение уходит ДО renderAll — тот сам шлёт Мастеру свежий
// лист, и по одному и тому же сокету подтверждение приходит раньше листа (см. reapplyPendingGrants).
function receiveGrant(raw, gmId){
  const g = sanitizeGrant(raw);
  if(!g || !character) return; // нет листа — не подтверждаем, Мастер дошлёт позже
  if(!grantAlreadyApplied(g.gid)){
    const text = applyGrant(character, g);
    markGrantApplied(g.gid);
    sendMsg({type:'grant-ack', gid:g.gid}, gmId);
    if(text) logEvent(character, text);
    renderAll();
  } else {
    sendMsg({type:'grant-ack', gid:g.gid}, gmId);
  }
}

