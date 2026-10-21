/* ======================================================================
   СПОСОБНОСТИ ПЕРСОНАЖЕЙ НА ИГРОВОМ СТОЛЕ.
   Меню жетона персонажа → «✦ Способности…» — окно со способностями листа, у которых есть что делать на столе
   (AbilityKit.parse в режиме персонажа): встречная («Бросок мистики против воли цели»), свой бросок, а при успехе — цели
   («псионик совершает Бросок мистики (−6), в случае успеха … [категория успеха] попаданий»), бросок цели («Бросок
   рефлексов против мистики персонажа»), урон без броска. Пси-дисциплина с несколькими техниками («Пирокинез: …»,
   «Бытовой пирокинез: …») — по строке на технику.
   - ⚔ — цели на карте (область — шаблоном, иначе кликом по жетонам), затем бросок персонажа тем же окном с гексами, что
     в листе (Максимум — 10 + характеристика, модификатор способности подсвечен); пси из цены списываются после броска.
     Свой бросок провален — на этом всё (способность, которая «при провале расходуется», отмечается потраченной).
     Иначе у Мастера открывается панель «Бросок цели» с этим броском: встречная — те же к20 против Максимума минус
     характеристика каждой цели, броски целей, последствия — после «Применить».
   - 🎲 — способность без целей: только свой бросок (итог — в общем логе).
   - ★ — только у Мастера: форма «Бросок цели», заполненная по тексту, — креативное применение.
   Мастер применяет способности и за персонажей игроков (по копии листа) — тогда бросает приложение.
   «Раз в день / сцену» — счётчик ◷ (у каждого участника свой, ↺ — сбросить).
   Сообщение: pc-abil (игрок → Мастер).
   ====================================================================== */
const PcAbilities = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const AK = ()=>typeof AbilityKit!=='undefined' ? AbilityKit : null;
  const isGm = ()=>{ const gt = GT(); return !!gt && gt.netRole()!=='player'; };
  const FIRE = ['save', 'opposed', 'attack', 'auto'];
  const cleanTitle = (n)=>String(n || '').replace(/\s*\([^)]*\)\s*$/, '');
  const sgn = (n)=>(n >= 0 ? '+' : '−') + Math.abs(n);
  const useKey = (key)=>'pc' + key;

  /* ---------- способности листа ---------- */
  function partsOf(c){
    const ak = AK(), out = []; if(!ak || !c || !Array.isArray(c.abilities)) return out;
    c.abilities.forEach(a=>ak.pcParts(a.name || '', a.text || '').forEach(p=>{
      const s = ak.parse(p.name, p.text, {pc:true}), fire = FIRE.indexOf(s.kind) >= 0;
      if(fire || s.selfCheck) out.push({key:a.id + ':' + p.i, abilityId:a.id, name:p.name, text:p.text, s, fire, spent:!!a.spent});
    }));
    return out;
  }
  const ownSheet = (t)=>{ const gt = GT(); return !!t && t.ownerId===gt.ownerIdHere() && typeof character!=='undefined' && !!character; };
  // Максимум своего броска персонажа (без модификатора): 10 + характеристика; хладнокровие — по воле
  function baseOf(c, stat){ const k = stat==='hladnokrovie' ? 'volya' : stat; return c && c.stats && isFinite(+c.stats[k]) ? 10 + +c.stats[k] : null; }
  // чем бросает персонаж: встречная против цели или свой бросок до эффекта; null — броска нет (или он не по листу)
  function rollSpec(c, s){
    const ak = AK(), r = s.opp && s.opp.pc ? {stat:s.opp.stat, mod:s.opp.mod || 0, opp:true, vs:s.opp.vs} : s.selfCheck ? {stat:s.selfCheck.stat, mod:s.selfCheck.mod || 0, opp:false} : null;
    if(!r || baseOf(c, r.stat)==null) return null;
    r.label = ak.CHECK_LABEL({stat:r.stat, mod:r.mod}) + (r.opp ? ` против ${ak.STAT_NAME[r.vs] || r.vs} цели` : '');
    return r;
  }

  /* ---------- окно способностей ---------- */
  let listEl = null, listTok = null, drag = null;
  function closeList(){ if(listEl){ listEl.remove(); listEl = null; listTok = null; } }
  function openList(tokId, x, y){
    const gt = GT(), t = gt && gt.getToken(tokId); if(!t || !gt.sheetOfToken(t)) return;
    closeList(); listTok = tokId;
    listEl = document.createElement('div'); listEl.className = 'pa-list gt-ui';
    document.body.appendChild(listEl);
    listEl.addEventListener('click', onListClick);
    listEl.addEventListener('pointerdown', onDragStart);
    renderList();
    const w = listEl.offsetWidth, h = listEl.offsetHeight;
    listEl.style.left = Math.max(8, Math.min((x || 40) + 6, innerWidth - w - 8)) + 'px';
    listEl.style.top = Math.max(8, Math.min((y || 60) + 6, innerHeight - h - 8)) + 'px';
  }
  function renderList(){
    if(!listEl) return;
    const gt = GT(), t = gt.getToken(listTok), c = t && gt.sheetOfToken(t), ak = AK();
    if(!c || !ak){ closeList(); return; }
    const gm = isGm(), parts = partsOf(c), name = (gt.vitalsOf(t) || {}).name || c.name || 'Персонаж';
    const rows = parts.map(p=>{
      const s = p.s, rs = rollSpec(c, s), used = ak.usedOf(t.id, useKey(p.key)), left = s.uses ? s.uses.n - used : 0;
      const usesHtml = s.uses ? `<span class="ak-count${left <= 0 ? ' out' : ''}" title="Использовано ${used} из ${s.uses.n} (${esc(s.uses.per)}). ↺ — сбросить">◷ ${Math.max(0, left)}/${s.uses.n}<button type="button" class="ak-mini" data-pa="reset" data-k="${esc(p.key)}">↺</button></span>` : '';
      const chips = s.chips.filter(ch=>ch[0]!=='uses' && !(ch[0]==='help' && /^📖/.test(ch[1])));
      const btns = [];
      if(p.fire) btns.push(`<button type="button" class="bst-mini ak-atk" data-pa="fire" data-k="${esc(p.key)}" title="Цели — на карте${s.areaSpec && s.areaSpec.shape!=='all' ? ' (область)' : ''}, затем ${rs ? 'бросок: ' + esc(rs.label) : 'к Мастеру'}">⚔</button>`);
      if(p.fire && gm) btns.push(`<button type="button" class="bst-mini ak-go" data-pa="form" data-k="${esc(p.key)}" title="Креативное использование способности">★</button>`);
      if(!p.fire && rs) btns.push(`<button type="button" class="bst-mini" data-pa="roll" data-k="${esc(p.key)}" title="Свой бросок: ${esc(rs.label)}">🎲</button>`);
      if(!btns.length) return '';
      return `<div class="pa-row${p.spent ? ' spent' : ''}" title="${esc(p.text.slice(0, 700))}"><div class="pa-name">${esc(p.name)}${p.spent ? ' <span class="pa-spent">потрачена</span>' : ''}</div>
        <span class="ak-row">${ak.chipsHtml(Object.assign({}, s, {chips}))}${usesHtml}${btns.join('')}</span></div>`;
    }).filter(Boolean);
    const rest = (c.abilities || []).length - new Set(parts.map(p=>p.abilityId)).size;
    listEl.innerHTML = `<div class="pa-head"><b>✦ ${esc(name)}: способности</b><button type="button" class="pa-x" data-pa="close" title="Закрыть">✕</button></div>
      <div class="pa-body">${rows.join('') || '<div class="gs-muted">Нет способностей с бросками или целями на столе.</div>'}
      <div class="pa-foot">⚔ — цели на карте, затем бросок${gm ? '; ★ — форма «Бросок цели» для креативного применения' : ''}; 🎲 — только свой бросок.${rest > 0 ? ` Ещё ${rest} — без действий на столе (см. лист).` : ''}</div></div>`;
  }
  function onListClick(e){
    const b = e.target.closest('[data-pa]'); if(!b) return;
    const a = b.dataset.pa, key = b.dataset.k, tokId = listTok;
    if(a==='close'){ closeList(); return; }
    if(a==='reset'){ const ak = AK(); ak.bump(tokId, useKey(key), -ak.usedOf(tokId, useKey(key))); renderList(); return; }
    if(a==='fire') fire(tokId, key);
    else if(a==='form') creative(tokId, key);
    else if(a==='roll') rollOnly(tokId, key);
  }
  // окно перетаскивается за заголовок
  function onDragStart(e){
    if(!e.target.closest('.pa-head') || e.target.closest('button') || e.button!==0) return;
    const r = listEl.getBoundingClientRect(); drag = {dx:e.clientX - r.left, dy:e.clientY - r.top};
    listEl.setPointerCapture(e.pointerId); listEl.classList.add('dragging');
    const move = (ev)=>{ if(!drag || !listEl) return; listEl.style.left = Math.max(0, Math.min(ev.clientX - drag.dx, innerWidth - 60)) + 'px'; listEl.style.top = Math.max(0, Math.min(ev.clientY - drag.dy, innerHeight - 30)) + 'px'; };
    const up = ()=>{ drag = null; if(listEl){ listEl.classList.remove('dragging'); listEl.removeEventListener('pointermove', move); } };
    listEl.addEventListener('pointermove', move); listEl.addEventListener('pointerup', up, {once:true}); listEl.addEventListener('pointercancel', up, {once:true});
  }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && listEl && !document.querySelector('.ui-dlg-back, .roll-overlay')) closeList(); });

  /* ---------- применение ---------- */
  function find(tokId, key){
    const gt = GT(), t = gt && gt.getToken(tokId), c = t && gt.sheetOfToken(t), p = c && partsOf(c).find(x=>x.key===key);
    return p ? {gt, t, c, p} : null;
  }
  async function checkUse(t, p){
    const s = p.s, ak = AK(), left = s.uses ? s.uses.n - ak.usedOf(t.id, useKey(p.key)) : 1;
    if(p.spent && !(await uiConfirm(`«${p.name}» отмечена потраченной. Применить всё равно?`, {title:'Способность', ok:'Применить'}))) return false;
    if(left <= 0 && !(await uiConfirm(`«${p.name}» уже использована ${s.uses.n} раз (${s.uses.per}). Применить всё равно?`, {title:'Способность', ok:'Применить'}))) return false;
    return true;
  }
  // цели на карте: область — шаблоном, «все видящие» — все видимые чужие жетоны, иначе — кликом по жетонам
  function pickTargetsFor(t, s, title){
    return new Promise((res)=>{
      const gt = GT(), ak = AK(), a = s.areaSpec;
      if(a && a.shape==='all'){ res(Object.values(gt.state.tokens || {}).filter(x=>x.id!==t.id && x.kind!=='player' && !x.hidden && gt.tokenWorld(x.id)).map(x=>x.id)); return; }
      const hidden = [...document.querySelectorAll('.bst-float, .tr-panel, #gmScreen.open, .pa-list')].filter(el=>el.style.visibility!=='hidden'); // не закрывают стол
      hidden.forEach(el=>{ el.style.visibility = 'hidden'; });
      if(typeof toggleMainTab==='function') toggleMainTab('table');
      const done = (ids)=>{ hidden.forEach(el=>{ el.style.visibility = ''; }); res(ids); };
      setTimeout(()=>{ if(a && typeof AreaTemplates!=='undefined') AreaTemplates.pick(a, t.id, title, done);
        else gt.pickTargets({srcId:t.id, n:ak.targetsWanted(s), title, rangeM:ak.rangeOf(s.text), done}); }, 120);
    });
  }
  function payPsi(t, n, what){
    if(!n) return '';
    if(ownSheet(t)){ const b = +character.psiCurrent || 0; character.psiCurrent = clampLower(b - n, psiMax(character));
      logEvent(character, `«${what}»: −${n} пси (${b} → ${character.psiCurrent}).`); renderAll(); return `−${n} пси`; }
    if(isGm() && typeof sendGrant==='function'){ sendGrant(t.ownerId, {kind:'vitals', which:'psi', mode:'delta', value:-n}); return `−${n} пси`; }
    return '';
  }
  function afterFail(t, p){
    if(!p.s.spendOnFail) return;
    if(ownSheet(t)){ const a = character.abilities.find(x=>x.id===p.abilityId); if(a && !a.spent){ a.spent = true; logEvent(character, `«${p.name}»: провал — способность расходуется, отмечена потраченной.`); renderAll(); renderList(); } }
    else uiToast(`«${p.name}» при провале расходуется — отметьте у игрока`, {icon:'✦'});
  }
  // бросок персонажа: свой — окном с гексами (как в листе), за чужого персонажа (Мастер) — приложение
  function rollFor(t, c, rs, title, done){
    const label = `${title}: ${rs.label}`;
    if(ownSheet(t) && character===c && typeof openRollPicker==='function'){
      _mapAbilityCtx = {label, base:baseOf(c, rs.stat), opp:rs.opp, tags:[label], done:(r)=>done(Object.assign({label:rs.label, opp:rs.opp}, r))};
      openRollPicker('map_ability', innerWidth/2, innerHeight/2, Math.max(-21, Math.min(21, rs.mod)));
      uiToast(`Нажмите на модификатор — подсвечен ${sgn(rs.mod)}`, {icon:'🎲', ms:4000});
      return;
    }
    const base = baseOf(c, rs.stat) + rs.mod, roll = 1 + Math.floor(Math.random()*20), ev = evaluateD20Check(roll, base);
    done({label:rs.label, opp:rs.opp, rolls:[roll], mode:'plain', chosenMod:rs.mod, base, roll, success:ev.success, cat:ev.category, byGm:true});
  }
  const charName = (t, c)=>{ const v = GT().vitalsOf(t); return (v && v.name) || (c && c.name) || 'Персонаж'; };
  async function fire(tokId, key){
    const f = find(tokId, key); if(!f || !AK()) return;
    const {t, c, p} = f, s = p.s, title = cleanTitle(p.name), rs = rollSpec(c, s);
    if(!(await checkUse(t, p))) return;
    const ids = await pickTargetsFor(t, s, title); if(!ids) return;
    if(!ids.length){ uiToast(s.areaSpec ? 'В области нет целей' : 'Нет целей', {icon:'✦'}); return; }
    if(ownSheet(t) && character===c){ // свой персонаж: подтверждение — цели, бросок, цена
      const names = ids.map(id=>{ const x = GT().getToken(id); return x ? ((GT().vitalsOf(x) || {}).name || x.name || 'жетон') : '?'; });
      const go = await uiDialog({title, icon:'✦', html:`<div class="pa-ask"><div><b>Цели:</b> ${esc(names.join(', '))}</div>`+
        (rs ? `<div><b>Бросок:</b> ${esc(rs.label)} — Максимум ${baseOf(c, rs.stat)}${rs.opp ? ' − характеристика цели' : ''}, модификатор ${sgn(rs.mod)} подсвечен</div>` : '<div>Без своего броска — решает Мастер.</div>')+
        (s.psiCost ? `<div><b>Цена:</b> ${s.psiCost} пси (сейчас ${+character.psiCurrent || 0})</div>` : '')+`</div>`,
        cancelValue:false, buttons:[{label:'Отмена', value:false}, {label:rs ? '🎲 Бросок' : '✦ Применить', value:true, primary:true}]});
      if(!go) return;
    }
    const deliver = (pr)=>{
      if(s.uses) AK().bump(t.id, useKey(key), 1);
      const paid = payPsi(t, s.psiCost, title); renderList();
      if(pr && !pr.opp && !pr.success){ // свой бросок провален — эффекта нет
        if(pr.byGm) recordAndShareQuickRoll({abilityUse:true, text:`${charName(t, c)} — «${title}»: ${rs.label}: к20=${pr.roll} / Макс.${pr.base} — провал${paid ? '. ' + paid : ''}`});
        uiToast(`«${title}»: провал — способность не сработала`, {icon:'✦'}); afterFail(t, p); return; }
      if(isGm()){ openPanel(t.id, p.name, p.text, ids, pr); return; }
      if(typeof session==='undefined' || !session.gmId){ uiToast('Мастер не в сети — способность не отправлена', {icon:'✦'}); return; }
      sendMsg({type:'pc-abil', req:{tokId:t.id, key, name:p.name, text:p.text.slice(0, 4000), ids:ids.slice(0, 40), roll:pr}}, session.gmId);
      uiToast('Ушло Мастеру — итог появится в общем логе', {icon:'✦'});
    };
    if(rs) rollFor(t, c, rs, title, deliver); else deliver(null);
  }
  function rollOnly(tokId, key){
    const f = find(tokId, key); if(!f) return;
    const {t, c, p} = f, title = cleanTitle(p.name), rs = rollSpec(c, p.s); if(!rs) return;
    checkUse(t, p).then(ok=>{ if(!ok) return;
      rollFor(t, c, rs, title, (pr)=>{
        if(p.s.uses) AK().bump(t.id, useKey(key), 1);
        const paid = payPsi(t, p.s.psiCost, title); renderList();
        if(pr.byGm) recordAndShareQuickRoll({abilityUse:true, text:`${charName(t, c)} — «${title}»: ${rs.label}: к20=${pr.roll} / Макс.${pr.base} — ${pr.success ? 'успех, КУ' + pr.cat : 'провал'}${paid ? '. ' + paid : ''}`});
        if(!pr.success) afterFail(t, p);
      }); });
  }
  // ★ — форма «Бросок цели» по тексту способности; цели — выделенные жетоны
  function creative(tokId, key){
    const f = find(tokId, key); if(!f || !isGm() || typeof TargetRolls==='undefined') return;
    const gt = f.gt, sel = gt.selectedIds ? gt.selectedIds().filter(id=>id!==tokId) : [];
    TargetRolls.open({src:tokId, targets:sel, title:cleanTitle(f.p.name), prefill:prefillOf(f.p.name, f.p.text)});
  }
  // «все на поле» цели уже выбраны — область форме не нужна
  function prefillOf(name, text){ const s = AK().parse(name, text, {pc:true}); return s.areaSpec && s.areaSpec.shape==='all' ? Object.assign({}, s, {areaSpec:null}) : s; }
  function openPanel(tokId, name, text, ids, pr){
    if(typeof TargetRolls==='undefined') return;
    TargetRolls.open({src:tokId, targets:ids, title:cleanTitle(name), prefill:prefillOf(name, text), auto:true, pcRoll:pr || null});
  }

  /* ---------- Мастер: способность от игрока ---------- */
  function cleanRoll(r){
    if(!r || typeof r!=='object') return null;
    const d20 = (v)=>Math.max(1, Math.min(20, Math.round(+v || 1))), rolls = (Array.isArray(r.rolls) ? r.rolls : [r.roll]).slice(0, 2).map(d20);
    return {label:String(r.label || 'Бросок').slice(0, 160), opp:!!r.opp, rolls, mode:['advantage', 'disadvantage'].indexOf(r.mode) >= 0 && rolls.length===2 ? r.mode : 'plain',
      base:Math.max(-30, Math.min(60, Math.round(+r.base || 0))), roll:d20(r.roll), success:!!r.success, cat:Math.max(0, Math.min(5, Math.round(+r.cat || 0)))};
  }
  function handle(msg){
    if(!msg || msg.type!=='pc-abil') return false;
    if(typeof session==='undefined' || session.role!=='gm' || !msg.from || !msg.req || typeof msg.req!=='object') return true;
    const gt = GT(), q = msg.req, t = gt && gt.getToken(String(q.tokId || ''));
    if(!t || t.kind!=='player' || t.ownerId!==msg.from) return true; // только своим жетоном
    // текст — из копии листа у Мастера; нет такой способности (лист ещё не пришёл) — присланный
    const c = gt.sheetOfToken(t), p = c && partsOf(c).find(x=>x.key===String(q.key || ''));
    const name = p ? p.name : String(q.name || 'Способность').slice(0, 120), text = p ? p.text : String(q.text || '').slice(0, 4000);
    const ids = (Array.isArray(q.ids) ? q.ids : []).map(String).filter(id=>{ const x = gt.getToken(id); return x && !x.hidden && id!==t.id; }).slice(0, 40);
    if(!ids.length) return true;
    openPanel(t.id, name, text, ids, cleanRoll(q.roll));
    return true;
  }
  // лист поменялся (потрачена, сброшена) — окно перерисовать
  setInterval(()=>{ if(listEl && listEl.style.visibility!=='hidden' && !listEl.matches(':hover')) renderList(); }, 3000);

  return { openList, closeList, handle, partsOf };
})();
