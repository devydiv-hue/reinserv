/* ======================================================================
   КАВАЛЕРИЯ — БОЙ НА СХЕМЕ ЗОН (часть 2 книги). Поле боя — Зоны; дистанции абстрактные: в одной Зоне — ближняя (>)
   или контактная (⁕, вплотную), между Зонами — средняя (>>), до Зон на краю поля (отмечены «дальняя») — дальняя (>>>).
   Укрытие в Зоне — +3 МОБ против дальнобойных атак. Стороны: Копьё (тандемы игроков, союзники) и Враги. Каждый раунд
   лидеры сторон бросают к6 — от большего к меньшему, при ничьей одновременно; застигнутая врасплох сторона пропускает
   первый раунд. Боевой Дух: 2к6 больше БД — отступает; после двух удачных проверок — до конца. Поводы для проверки
   (подсказка «БД!» сама): потеря половины СТК, критическое повреждение, гибель лидера или половины группы.
   Состояние боя ведёт Летописец (reincarnator_kava_battle_v1 по коду стола) и рассылает всем (battle). Игроки
   двигают свой жетон (battle-move) и сообщают о попадании по врагу (battle-hit) — Летописец применяет: броня врага,
   «игнорирует урон меньше 5», «4+ на броне — попадание игнорируется».
   ====================================================================== */
const Battle = (function(){
  const KEY = 'reincarnator_kava_battle_v1', esc = kvEsc, int = (v, d)=>Pilot.int(v, d);
  const SIDES = {lance:'Копьё', enemy:'Враги'};
  let B = null, roots = [], sendTimer = 0;
  const isGm = ()=>Table.S.role==='gm';
  const uid = ()=>Pilot.uid();
  function blank(){ return {active:true, round:0, surprise:'', order:[], showMob:true, zones:[{id:uid(), name:'Зона 1', far:false, cover:false, smoke:false, rough:false}], units:[]}; }
  // ---- хранение и рассылка (Летописец) ----
  function key(){ return Table.S.code || 'solo'; }
  function load(){ let all = {}; try{ all = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){} return all[key()] || null; }
  function persist(){ let all = {}; try{ all = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){} all[key()] = B; try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){} }
  function changed(){
    if(isGm() || !Table.S.role){ persist(); clearTimeout(sendTimer); sendTimer = setTimeout(()=>{ if(isGm()) Table.send({type:'battle', state:wire()}); }, 250); }
    renderAll();
    if(typeof App!=='undefined') App.battleChanged();
  }
  // что уходит игрокам: тандемы — с текущими значениями; враги — без чисел, если Летописец их скрыл
  function wire(){
    if(!B) return null;
    const s = JSON.parse(JSON.stringify(B));
    s.units.forEach(u=>{ const v = view(u); u.view = {name:v.name, stk:v.stk, stkMax:v.stkMax, mob:v.mob, scale:v.scale};
      if(u.side==='enemy' && !B.showMob){ u.view.mob = null; u.view.stk = null; u.hp = v.stkMax ? Math.round(v.stk / v.stkMax * 100) : 100; u.mob = null; u.stk = null; u.bd = null; } });
    return s;
  }
  // ---- значения жетона: тандем берёт данные из листа игрока (или своего) ----
  function tandemOf(u){
    if(u.self) return Tandem.pilot;
    if(isGm()){ const x = Table.S.peers[u.peer]; return x && x.pilot ? Pilot.fix(JSON.parse(JSON.stringify(x.pilot))) : null; }
    if(u.peer && u.peer===Table.S.myId) return Tandem.pilot;
    return null;
  }
  function view(u){
    if(u.kind==='tandem'){
      const p = tandemOf(u);
      if(!p) return u.view || {name:u.name, stk:0, stkMax:0, mob:10, scale:'personal'};
      const womb = p.inWomb && (p.mech.built || p.mech.name);
      return womb ? {name:`${p.mech.name || 'Катафракт'} (${p.name || 'Спектр'})`, stk:int(p.mech.stk), stkMax:int(p.mech.stkMax), mob:Pilot.mechMob(p).total, scale:'strategic', womb:true, p}
        : {name:p.name || u.name, stk:int(p.stk), stkMax:Pilot.stkMax(p), mob:Pilot.mob(p).total, scale:'personal', womb:false, p};
    }
    if(u.view && !isGm()) return Object.assign({}, u.view, {name:u.name});
    return {name:u.name, stk:int(u.stk), stkMax:int(u.stkMax), mob:u.mob, scale:u.scale || 'strategic'};
  }
  const zoneOf = (u)=>B.zones.find(z=>z.id===u.zone) || null;
  // дистанция между жетонами
  function distance(a, b){
    const za = zoneOf(a), zb = zoneOf(b);
    if(!za || !zb) return '>>';
    if(za.id===zb.id) return '>';
    return za.far || zb.far ? '>>>' : '>>';
  }
  const RANK = {'⁕':0, '>':1, '>>':2, '>>>':3};
  const DIST_NAME = {'⁕':'контактная', '>':'ближняя', '>>':'средняя', '>>>':'дальняя'};

  // ---- действия Летописца ----
  function start(){ B = load() || blank(); B.active = true; if(!B.zones.length) B.zones.push({id:uid(), name:'Зона 1'}); changed(); }
  function end(){ if(!B) return; B.active = false; changed(); Table.send({type:'battle', state:{active:false}}); }
  function addZone(){ B.zones.push({id:uid(), name:'Зона ' + (B.zones.length + 1), far:false, cover:false, smoke:false, rough:false}); changed(); }
  function addEnemy(e, count, zone, custom){
    const n = Math.max(1, Math.min(30, int(count, 1))), group = n > 1 ? uid() : '';
    for(let i = 0; i < n; i++){
      const r = Dice.roll(e.stk) || {total:int(e.stk, 6)};
      B.units.push({id:uid(), side:'enemy', kind:'enemy', ekey:e.key || '', name:e.name + (n > 1 ? ' ' + (i + 1) : ''), zone:zone || B.zones[0].id, stk:r.total, stkMax:r.total, mob:int(e.mob, 13),
        bd:int(e.bd, 7), atk:int(e.atk), weapons:JSON.parse(JSON.stringify(e.weapons || [{name:'Оружие', dmg:'к6'}])), armor:e.armor || '', marks:0, scale:e.scale || 'strategic',
        feats:(e.feats || []).slice(), ignoreBelow:e.ignoreBelow || 0, ignore4:!!e.ignore4, group, groupSize:n, leader:false, acted:false, status:'ok', moraleOk:0, moraleDue:'', custom:!!custom});
    }
    changed();
  }
  function addTandems(){
    Object.entries(Table.S.peers).forEach(([id, x])=>{
      if(x.role!=='player' || B.units.some(u=>u.kind==='tandem' && u.peer===id)) return;
      B.units.push({id:uid(), side:'lance', kind:'tandem', peer:id, name:(x.pilot && x.pilot.name) || x.name || 'Спектр', zone:B.zones[0].id, acted:false, status:'ok'});
    });
    if(!Table.S.role && !B.units.some(u=>u.self)) B.units.push({id:uid(), side:'lance', kind:'tandem', self:true, name:(Tandem.pilot && Tandem.pilot.name) || 'Спектр', zone:B.zones[0].id, acted:false, status:'ok'});
    changed();
  }
  function addAlly(t){ const r = Dice.roll(t.stk) || {total:int(t.stk, 6)}; B.units.push({id:uid(), side:'lance', kind:'ally', name:t.name, zone:B.zones[0].id, stk:r.total, stkMax:r.total, mob:int(t.mob, 13), bd:7, atk:0, weapons:[{name:'Оружие', dmg:'к6'}], scale:'personal', acted:false, status:'ok', moraleOk:0, moraleDue:''}); changed(); }
  function newRound(){
    B.round = int(B.round) + 1;
    const ds = [], order = [];
    Object.keys(SIDES).forEach(s=>{
      if(!B.units.some(u=>u.side===s && u.status!=='dead')) return;
      if(B.round===1 && B.surprise===s){ order.push({side:s, roll:0, skip:true}); return; }
      const v = Dice.rnd(6); ds.push({sides:6, value:v, label:SIDES[s]}); order.push({side:s, roll:v});
    });
    order.sort((a, b)=>b.roll - a.roll);
    B.order = order; B.units.forEach(u=>{ u.acted = false; });
    const text = order.map(o=>o.skip ? `${SIDES[o.side]} — застигнуты врасплох, пропускают раунд` : `${SIDES[o.side]} ${o.roll}`).join(' · ');
    const tie = order.length > 1 && !order[0].skip && order[1] && order[0].roll===order[1].roll;
    changed();
    return Rolls.push({who:'Летописец', kind:'init', title:`Раунд ${B.round}: инициатива`, tone:'info', big:B.round, verdict:text + (tie ? ' — ничья: одновременно' : ''), lines:['Лидеры сторон бросают к6; внутри стороны первыми действуют те, у кого выше МОБ.'], dice:ds});
  }
  // урон по жетону врага/союзника (Летописец): броня, особенности, Боевой Дух
  function applyHit(id, dmg, o){
    o = o || {}; const u = B.units.find(x=>x.id===id); if(!u || u.kind==='tandem') return null;
    dmg = Math.max(0, int(dmg)); const lines = [`${o.from ? o.from + ': ' : ''}урон ${dmg}${o.pierce ? ' (бронебойное)' : ''}`], dice = [];
    let taken = dmg;
    if(u.ignore4 && int(u.marks) < 3){ const v = Dice.rnd(6); dice.push({sides:6, value:v, label:'броня'}); if(v >= 4){ u.marks = int(u.marks) + 1; taken = 0; lines.push(`Архаическая броня: к6 [${v}] — попадание проигнорировано (метка ${u.marks}/3)`); } else lines.push(`Архаическая броня: к6 [${v}] — не сработала`); }
    if(taken && u.armor){ const a = Dice.roll(u.armor); if(a){ const block = o.pierce ? Math.floor(a.total / 2) : a.total; taken = Math.max(0, taken - block); lines.push(`Броня ${u.armor}: ${a.total}${o.pierce ? ' → половина ' + block : ''}`); a.dice.forEach(v=>dice.push({sides:a.max, value:v, label:'броня'})); } }
    if(taken && u.ignoreBelow && taken < u.ignoreBelow){ lines.push(`Повреждение меньше ${u.ignoreBelow} — игнорируется`); taken = 0; }
    const before = int(u.stk); u.stk = Math.max(0, before - taken); lines.push(`СТК ${before} → ${u.stk}`);
    if(before > u.stkMax / 2 && u.stk <= u.stkMax / 2 && u.stk > 0) due(u, 'потеря половины СТК');
    if(o.crit) due(u, 'критическое повреждение');
    if(u.stk <= 0 && before > 0) killed(u, lines);
    changed();
    return Rolls.push({who:'Летописец', kind:'bhit', title:`Попадание: ${u.name}`, tone:u.stk <= 0 ? 'crit' : taken ? 'fail' : 'ok', big:taken ? '−' + taken : '0', verdict:u.stk <= 0 ? 'Выведен из боя' : `СТК ${u.stk} из ${u.stkMax}`, lines, dice});
  }
  const due = (u, why)=>{ if(u.status==='ok' && int(u.moraleOk) < 2 && u.bd) u.moraleDue = why; };
  function killed(u, lines){
    u.status = 'dead'; u.moraleDue = '';
    lines.push(`${u.name} выведен из боя.`);
    if(u.group){
      const g = B.units.filter(x=>x.group===u.group), alive = g.filter(x=>x.status!=='dead');
      if(u.leader){ alive.forEach(x=>due(x, 'гибель лидера')); lines.push('Погиб лидер группы — проверка Боевого Духа.'); }
      else if(alive.length <= Math.floor(u.groupSize / 2) && !g.halfDone){ alive.forEach(x=>due(x, 'потеря половины группы')); lines.push('Группа потеряла половину — проверка Боевого Духа.'); }
      if(u.ekey==='vpered') alive.forEach(x=>{ x.mob = int(x.mob) - 1; });
    }
  }
  function morale(id){
    const u = B.units.find(x=>x.id===id); if(!u) return null;
    const r = Dice.roll('2к6'), fail = r.total > int(u.bd, 7);
    if(fail){ u.status = 'retreat'; u.moraleDue = ''; } else { u.moraleOk = int(u.moraleOk) + 1; u.moraleDue = ''; }
    changed();
    return Rolls.push({who:'Летописец', kind:'morale', title:`Боевой Дух: ${u.name}`, tone:fail ? 'fail' : 'ok', big:r.total, verdict:fail ? 'Провал — отступает' : int(u.moraleOk) >= 2 ? 'Держится — теперь бьётся до конца' : 'Держится',
      lines:[`${r.text} против БД ${u.bd}`], dice:r.dice.map(v=>({sides:6, value:v}))});
  }
  // атака жетона (враг/союзник) по цели: тандем игрока — ему уходит окно урона; другой жетон — урон сразу
  function unitAttack(id, wi, targetId, mode, extra){
    const u = B.units.find(x=>x.id===id), t = B.units.find(x=>x.id===targetId); if(!u || !t) return null;
    const w = (u.weapons || [])[wi] || {name:'Оружие', dmg:'к6'}, tv = view(t), zt = zoneOf(t), dist = distance(u, t);
    // оружие ближнего боя достаёт только в своей Зоне
    if((w.melee || /клинок|фальшион|тесак|молот|кулак|мацак/i.test(w.name)) && dist!=='>'){
      UI.toast(`${w.name}: цель в другой Зоне — ближним боем не достать`, 'fail'); return null; }
    let mob = int(tv.mob, 10); const lines = [];
    if(zt && zt.cover && !w.melee && dist!=='>'){ mob += 3; lines.push('Цель в укрытии: +3 МОБ против дальнобойной атаки'); }
    const r = Dice.check(int(u.atk) + int(extra), mob, mode || 'norm');
    lines.unshift(`${u.name} — ${w.name}: к20${r.rolls.length > 1 ? ` [${r.rolls.join(', ')}] → ${r.nat}` : ` [${r.nat}]`} + ${int(u.atk) + int(extra)} = ${r.total} против МОБ ${mob} (${tv.name}, дистанция ${DIST_NAME[dist]})`);
    const dice = r.rolls.map(v=>({sides:20, value:v, label:'атака', tint:v===r.nat ? (r.auto==='success' ? 'good' : r.auto==='fail' ? 'bad' : '') : '', dim:r.rolls.length > 1 && v!==r.nat}));
    let dmg = 0;
    if(r.ok){
      const d = Dice.roll(w.dmg || 'к6') || {total:0, dice:[], text:'—'}; dmg = d.total; lines.push('Вред ' + d.text); d.dice.slice(0, 4).forEach(v=>dice.push({sides:d.max || 6, value:v, label:'вред'}));
      if(u.scale==='strategic' && tv.scale==='personal'){ dmg *= 10; lines.push(`Техника по цели персонального масштаба: × 10 = ${dmg}`); }
      if(r.auto==='success') lines.push('20 — цель получает Критическую травму (Критическое повреждение)');
    }
    u.acted = true; changed();
    const e = Rolls.push({who:'Летописец', kind:'battack', title:`${u.name} атакует: ${tv.name}`, tone:r.ok ? (r.auto==='success' ? 'crit' : 'fail') : 'ok', big:r.ok ? dmg : r.total,
      verdict:r.ok ? `Попадание: ${dmg} урона` : 'Промах', lines, dice, fx:r.auto==='success' ? {nat20:true} : r.auto==='fail' ? {nat1:true} : null});
    if(r.ok && dmg){
      if(t.kind==='tandem' && t.peer) Table.send({type:'hurt', side:tv.womb ? 'm' : 'p', amount:dmg, pierce:!!/бронебойн/i.test(w.name + (w.tags || ''))}, t.peer);
      else if(t.kind==='tandem' && t.self){ setTimeout(()=>Prompts.hurt({side:tv.womb ? 'm' : 'p', amount:dmg}), 2600); }
      else applyHit(t.id, dmg, {from:u.name, crit:r.auto==='success'});
    }
    return e;
  }
  // ---- сообщения стола ----
  function receive(state){ if(isGm()) return; B = state && state.active!==false ? state : null; renderAll(); if(typeof App!=='undefined') App.battleChanged(); }
  function onMove(from, m){ if(!isGm() || !B) return; const u = B.units.find(x=>x.id===m.unit); if(u && u.kind==='tandem' && u.peer===from && B.zones.some(z=>z.id===m.zone)){ u.zone = m.zone; changed(); } }
  function onHit(from, m){ if(!isGm() || !B) return; const who = (Table.S.peers[from] || {}).name; const e = applyHit(m.unit, m.dmg, {pierce:m.pierce, crit:m.crit, from:who}); if(e) Table.rolled(e); }
  function sync(to){ if(isGm() && B) Table.send({type:'battle', state:wire()}, to); }
  // попадание игрока по врагу из карточки атаки
  function reportHit(targetId, dmg, o){
    if(!B || !targetId || !dmg) return;
    if(isGm() || !Table.S.role){ const e = applyHit(targetId, dmg, Object.assign({from:(Tandem.pilot && Tandem.pilot.name) || 'Спектр'}, o)); if(e && isGm()) Table.rolled(e); }
    else Table.send({type:'battle-hit', unit:targetId, dmg, pierce:!!o.pierce, crit:!!o.crit}, Table.S.gmId);
  }
  function myUnit(){ if(!B) return null; return B.units.find(u=>u.kind==='tandem' && (u.self || (u.peer && u.peer===Table.S.myId))) || null; }
  // цели для карточки атаки игрока: враги с дистанцией от моего жетона
  function targets(){
    if(!B || !B.active) return [];
    const me = myUnit();
    return B.units.filter(u=>u.side==='enemy' && u.status!=='dead').map(u=>{ const v = view(u), z = zoneOf(u); return {id:u.id, name:u.name, mob:v.mob, scale:v.scale || 'strategic', dist:me ? distance(me, u) : '>>', cover:!!(z && z.cover), hp:u.hp}; });
  }

  // ---------- отрисовка ----------
  function token(u){
    const v = view(u), me = myUnit(), mine = me && me.id===u.id, hp = v.stkMax ? Math.max(0, Math.min(100, v.stk / v.stkMax * 100)) : (u.hp!=null ? u.hp : 100);
    return `<button type="button" class="kv-token side-${u.side} st-${u.status}${u.acted ? ' acted' : ''}${mine ? ' mine' : ''}${u.moraleDue ? ' due' : ''}" data-unit="${u.id}" draggable="${isGm() || mine || !Table.S.role ? 'true' : 'false'}" title="${esc(v.name)}">
      <span class="kv-tk-name">${u.leader ? '★ ' : ''}${esc(v.name)}</span>
      <span class="kv-tk-stats">${v.stk!=null && v.stkMax ? `${v.stk}/${v.stkMax}` : ''}${v.mob!=null ? ` · МОБ ${v.mob}` : ''}${u.status==='retreat' ? ' · отступает' : u.status==='dead' ? ' · выбыл' : ''}</span>
      <span class="kv-hp"><i style="width:${hp}%"></i></span>${u.moraleDue ? '<span class="kv-tk-due">БД!</span>' : ''}</button>`;
  }
  function boardHtml(){
    if(!B || !B.active) return isGm() || !Table.S.role ? `<div class="kv-cta"><p>Боя нет. Поле боя делится на Зоны, дистанции абстрактные: внутри Зоны — ближняя, между Зонами — средняя, до краёв поля — дальняя.</p><button type="button" class="kv-btn kv-primary" data-b="start">Начать бой</button></div>` : '<div class="kv-empty">Сейчас боя нет</div>';
    const gm = isGm() || !Table.S.role, lead = B.order[0];
    const orderHtml = B.order.length ? B.order.map((o, i)=>`<span class="kv-chip ${i===0 && !o.skip ? 'on' : ''}">${SIDES[o.side]}${o.skip ? ' — врасплох' : ' ' + o.roll}</span>`).join('') : '<span class="kv-note">Раунд ещё не начат</span>';
    return `<div class="kv-b-top"><b>Раунд ${int(B.round)}</b><span class="kv-chips2">${orderHtml}</span>
        ${gm ? `<button type="button" class="kv-btn kv-primary" data-b="round">Новый раунд</button>
          <label class="kv-mini">врасплох <select data-bf="surprise"><option value="">никто</option>${Object.keys(SIDES).map(s=>`<option value="${s}"${B.surprise===s ? ' selected' : ''}>${SIDES[s]}</option>`).join('')}</select></label>
          <label class="kv-chk"><input type="checkbox" data-bf="showMob"${B.showMob ? ' checked' : ''}> игроки видят МОБ и СТК врагов</label>
          <button type="button" class="kv-btn kv-sm" data-b="end">Закончить бой</button>` : (lead ? `<span class="kv-note">Ходят: ${SIDES[lead.side]}</span>` : '')}</div>
      <div class="kv-zones">${B.zones.map(z=>`<div class="kv-zone${z.far ? ' far' : ''}" data-zone="${z.id}">
        <div class="kv-zone-head">${gm ? `<input data-zf="${z.id}" data-k="name" value="${esc(z.name)}">` : `<b>${esc(z.name)}</b>`}
          ${gm ? `<button type="button" class="kv-x" data-b="zdel" data-id="${z.id}" title="Убрать зону">✕</button>` : ''}</div>
        <div class="kv-zone-props">${[['far', 'дальняя >>>'], ['cover', 'укрытие +3'], ['smoke', 'задымление'], ['rough', 'сложный ландшафт']].map(([k, n])=>gm ? `<button type="button" class="kv-chip${z[k] ? ' on' : ''}" data-b="zprop" data-id="${z.id}" data-k="${k}">${n}</button>` : z[k] ? `<span class="kv-chip on">${n}</span>` : '').join('')}</div>
        <div class="kv-zone-units">${B.units.filter(u=>u.zone===z.id).sort((a, b)=>(a.side===b.side ? 0 : a.side==='lance' ? -1 : 1)).map(token).join('') || '<span class="kv-note">пусто</span>'}</div></div>`).join('')}
        ${gm ? '<button type="button" class="kv-zone kv-zone-add" data-b="zadd">+ Зона</button>' : ''}</div>
      ${gm ? `<div class="kv-gm-tools"><button type="button" class="kv-btn" data-b="tandems">+ Тандемы игроков</button><button type="button" class="kv-btn" data-b="enemy">+ Враг из кодекса</button>
        <button type="button" class="kv-btn" data-b="custom">+ Свой враг</button><button type="button" class="kv-btn" data-b="ally">+ Союзник из Копья</button>
        ${B.units.some(u=>u.moraleDue) ? '<button type="button" class="kv-btn kv-primary" data-b="morale-all">Проверить Боевой Дух у всех с «БД!»</button>' : ''}</div>` :
        `<p class="kv-note">Перетащите свой жетон в другую Зону, чтобы переместиться (действие). Нажмите на врага, чтобы атаковать.</p>`}`;
  }
  function render(root){ root.innerHTML = `<div class="kv-battle">${boardHtml()}</div>`; }
  function renderAll(){ roots = roots.filter(r=>document.body.contains(r)); roots.forEach(r=>{ if(!r.contains(document.activeElement) || document.activeElement.tagName!=='INPUT') render(r); }); }

  // ---------- карточки жетонов ----------
  function unitSheet(id){
    const u = B.units.find(x=>x.id===id); if(!u) return;
    const v = view(u), gm = isGm() || !Table.S.role, me = myUnit(), mine = me && me.id===u.id;
    const zones = B.zones.map(z=>`<button type="button" class="kv-chip${z.id===u.zone ? ' on' : ''}" data-a="move" data-z="${z.id}">${esc(z.name)}</button>`).join('');
    if(!gm){
      if(mine) UI.sheet({title:v.name, sub:'ваш жетон', html:`<div class="kv-fe kv-wide"><span>Переместиться в Зону</span><div class="kv-chips2">${zones}</div></div>`,
        onAction(a, b, close){ if(a==='move'){ Table.send({type:'battle-move', unit:u.id, zone:b.dataset.z}, Table.S.gmId); close(); } }});
      else if(u.side==='enemy') attackFromSheet(u.id);
      return;
    }
    const foes = B.units.filter(x=>x.side!==u.side && x.status!=='dead');
    UI.sheet({title:v.name, sub:`${SIDES[u.side]}${u.kind==='enemy' ? ' · ' + (u.scale==='personal' ? 'персональный масштаб' : 'стратегический масштаб') : ''}`, html:`
      ${u.kind!=='tandem' ? `<div class="kv-sheet-grid">${UI.stepper('stk', u.stk, 0, 999, `СТК (из ${u.stkMax})`)}${UI.stepper('mob', u.mob, 0, 40, 'МОБ')}${UI.stepper('bd', u.bd, 2, 12, 'БД')}${UI.stepper('atk', u.atk, -5, 15, 'АТК +')}</div>
        ${(u.weapons || []).length ? `<div class="kv-fe kv-wide"><span>Оружие</span>${u.weapons.map((w, i)=>`<label class="kv-mini">${esc(w.name)} <input data-w="${i}" value="${esc(w.dmg)}" size="5"></label>`).join('')}</div>` : ''}
        ${(u.feats || []).length ? `<ul class="kv-list2 kv-note">${u.feats.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        ${foes.length ? `<div class="kv-fe kv-wide"><span>Атаковать: оружие и цель</span><div class="kv-chips2" data-chips="one" data-grp="w">${(u.weapons || []).map((w, i)=>UI.chip('w' + i, esc(w.name) + ' ' + esc(w.dmg), i===0)).join('')}</div>
          <div class="kv-chips2" data-chips="one" data-grp="t">${foes.map((f, i)=>UI.chip('t:' + f.id, esc(view(f).name) + ` · МОБ ${view(f).mob} · ${DIST_NAME[distance(u, f)]}`, i===0)).join('')}</div>
          <div class="kv-chips2" data-grp="m">${UI.chip('adv', 'Преимущество')}${UI.chip('dis', 'Препятствие')}</div></div>` : ''}` : `<p class="kv-p">Тандем игрока: СТК ${v.stk}/${v.stkMax}, МОБ ${v.mob}${v.womb ? ', в Утробе' : ''}.</p>`}
      <div class="kv-fe kv-wide"><span>Зона</span><div class="kv-chips2">${zones}</div></div>
      <div class="kv-sheet-btns">
        ${u.kind!=='tandem' && foes.length ? '<button type="button" class="kv-btn kv-primary" data-a="attack">Атаковать</button>' : ''}
        ${u.kind!=='tandem' ? `<button type="button" class="kv-btn${u.moraleDue ? ' kv-primary' : ''}" data-a="morale">Боевой Дух${u.moraleDue ? ' (' + esc(u.moraleDue) + ')' : ''}</button><button type="button" class="kv-btn" data-a="hit">Урон…</button>` : ''}
        <button type="button" class="kv-btn" data-a="acted">${u.acted ? 'Ещё не ходил' : 'Сходил'}</button>
        ${u.group ? `<button type="button" class="kv-btn" data-a="leader">${u.leader ? 'Не лидер' : 'Лидер группы'}</button>` : ''}
        ${u.kind!=='tandem' ? `<button type="button" class="kv-btn" data-a="status">${u.status==='ok' ? 'Отступает' : 'В строю'}</button>` : ''}
        <button type="button" class="kv-btn kv-danger" data-a="remove">Убрать</button></div>`,
      onInput(panel){
        if(u.kind==='tandem' || !panel._ready){ panel._ready = true; return; }
        ['stk', 'mob', 'bd', 'atk'].forEach(k=>{ const i = panel.querySelector(`[name="${k}"]`); if(i) u[k] = int(i.value); });
        panel.querySelectorAll('[data-w]').forEach(i=>{ u.weapons[+i.dataset.w].dmg = i.value; });
        changed();
      },
      onAction(a, b, close, panel){
        if(u.kind!=='tandem') ['stk', 'mob', 'bd', 'atk'].forEach(k=>{ const i = panel.querySelector(`[name="${k}"]`); if(i) u[k] = int(i.value); });
        if(a==='move'){ u.zone = b.dataset.z; changed(); unitSheet(id); return; }
        if(a==='attack'){
          const wc = panel.querySelector('[data-grp="w"] .on'), tc = panel.querySelector('[data-grp="t"] .on'), mods = [...panel.querySelectorAll('[data-grp="m"] .on')].map(c=>c.dataset.chip);
          const e = unitAttack(id, wc ? +wc.dataset.chip.slice(1) : 0, tc.dataset.chip.slice(2), mods.length===1 ? mods[0] : 'norm');
          if(!e) return; close(); Fx.play(e); Table.rolled(e); return; }
        if(a==='morale'){ const e = morale(id); close(); Fx.play(e); Table.rolled(e); return; }
        if(a==='hit'){ close(); hitSheet(id); return; }
        if(a==='acted') u.acted = !u.acted;
        if(a==='leader') u.leader = !u.leader;
        if(a==='status') u.status = u.status==='ok' ? 'retreat' : 'ok';
        if(a==='remove'){ B.units = B.units.filter(x=>x.id!==id); close(); changed(); return; }
        changed(); unitSheet(id);
      }});
  }
  function hitSheet(id){
    const u = B.units.find(x=>x.id===id); if(!u) return;
    UI.sheet({title:'Урон: ' + u.name, sub:`СТК ${u.stk} из ${u.stkMax}${u.armor ? ' · броня ' + u.armor : ''}`, html:`<div class="kv-sheet-grid">${UI.stepper('dmg', 1, 0, 999, 'Урон')}</div>
      <div class="kv-chips2">${UI.chip('pierce', 'Бронебойное')}${UI.chip('crit', 'Критическое (20)')}</div>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Нанести</button></div>`,
      onAction(a, b, close, panel){ const e = applyHit(id, UI.num(panel, 'dmg', 0), {pierce:UI.chipOn(panel, 'pierce'), crit:UI.chipOn(panel, 'crit')}); close(); Fx.play(e); if(isGm()) Table.rolled(e); }});
  }
  // игрок нажал на врага: выбрать оружие → карточка атаки с этой целью
  function attackFromSheet(targetId){
    const p = Tandem.pilot, mech = p.inWomb && (p.mech.built || p.mech.name), ws = mech ? Pilot.mechWeapons(p) : Pilot.weapons(p);
    if(!ws.length){ UI.toast('Нет оружия', 'fail'); return; }
    if(ws.length===1){ Actions.attackSheet(p, mech ? 'm' : 'p', ws[0].id, targetId); return; }
    UI.sheet({title:'Чем атаковать?', sub:mech ? 'вооружение Катафракта' : 'оружие Спектра', html:`<div class="kv-act-grid">${ws.map(w=>`<button type="button" class="kv-act" data-a="w" data-id="${w.id}"><b>${esc(w.name)}</b><span>${esc(w.dmg)} · ${esc(w.range || '')} ${KAVA.RANGES[w.range] || ''}</span></button>`).join('')}</div>`,
      onAction(a, b){ Actions.attackSheet(p, mech ? 'm' : 'p', b.dataset.id, targetId); }});
  }
  function enemySheet(){
    UI.sheet({title:'Враг из кодекса', sub:'СТК бросается для каждого', html:`<div class="kv-act-grid">${ENEMIES.CODEX.map(e=>`<button type="button" class="kv-act" data-a="pick" data-k="${e.key}"><b>${esc(e.name)}</b><span>${esc(e.kind)} · СТК ${esc(e.stk)} · МОБ ${e.mob} · БД ${e.bd} · АТК +${e.atk} · группа ${esc(e.group || '?')}</span></button>`).join('')}</div>
      <div class="kv-sheet-grid">${UI.stepper('count', 1, 1, 30, 'Сколько')}<label class="kv-stepper"><span>Зона</span><select name="zone">${B.zones.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></label><button type="button" class="kv-btn" data-a="group">⚄ Бросить группу</button></div>`,
      onInput(panel){ panel._sel = panel._sel || ''; },
      onAction(a, b, close, panel){
        if(a==='pick'){ panel.querySelectorAll('[data-a="pick"]').forEach(x=>x.classList.toggle('on', x===b)); panel._sel = b.dataset.k; return; }
        const e = ENEMIES.byKey(panel._sel || ''); if(!e){ UI.toast('Выберите врага', 'fail'); return; }
        if(a==='group'){ const r = Dice.roll(e.group); if(r){ panel.querySelector('[name=count]').value = r.total; UI.toast(`Группа ${e.group}: ${r.total}`); } else UI.toast('Размер группы в книге не задан — укажите сами', 'fail'); return; }
      }});
    // кнопка «Добавить» — отдельно, чтобы выбор врага не закрывал окно
    setTimeout(()=>{ const body = document.querySelector('.kv-sheet-body'); if(!body) return; const btn = document.createElement('div'); btn.className = 'kv-sheet-btns'; btn.innerHTML = '<button type="button" class="kv-btn kv-primary kv-grow2" data-x="add">Добавить на поле</button>'; body.appendChild(btn);
      btn.addEventListener('click', ()=>{ const panel = body.closest('.kv-sheet'), e = ENEMIES.byKey(panel._sel || ''); if(!e){ UI.toast('Выберите врага', 'fail'); return; } addEnemy(e, UI.num(panel, 'count', 1), panel.querySelector('[name=zone]').value); UI.close(); }); }, 0);
  }
  function customSheet(){
    UI.sheet({title:'Свой враг', sub:'например, пехота, техника или Спектр-изгой', html:`
      <label class="kv-stepper kv-wide"><span>Название</span><input name="name" value="Пехотный отряд" autofocus></label>
      <div class="kv-sheet-grid"><label class="kv-stepper"><span>СТК (число или бросок)</span><input name="stk" value="2к6"></label>${UI.stepper('mob', 12, 0, 40, 'МОБ')}${UI.stepper('bd', 7, 2, 12, 'БД')}${UI.stepper('atk', 1, -5, 15, 'АТК +')}</div>
      <div class="kv-sheet-grid"><label class="kv-stepper"><span>Оружие</span><input name="wname" value="Винтовки"></label><label class="kv-stepper"><span>Вред</span><input name="dmg" value="к6" size="5"></label><label class="kv-stepper"><span>Броня (кВ)</span><input name="armor" placeholder="к6" size="5"></label>${UI.stepper('count', 1, 1, 30, 'Сколько')}</div>
      <div class="kv-chips2" data-chips="one">${UI.chip('personal', 'Персональный масштаб', true)}${UI.chip('strategic', 'Стратегический (техника)')}</div>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="add">Добавить на поле</button></div>`,
      onAction(a, b, close, panel){
        const v = (n)=>panel.querySelector(`[name="${n}"]`).value;
        addEnemy({name:v('name') || 'Враг', stk:v('stk') || '6', mob:UI.num(panel, 'mob', 12), bd:UI.num(panel, 'bd', 7), atk:UI.num(panel, 'atk', 0), weapons:[{name:v('wname') || 'Оружие', dmg:v('dmg') || 'к6'}],
          armor:v('armor').trim(), scale:panel.querySelector('[data-chips="one"] .on').dataset.chip, feats:[]}, UI.num(panel, 'count', 1), B.zones[0].id, true);
        close();
      }});
  }
  function allySheet(){
    const units = ((Table.S.lance || {}).units || []).concat((function(){ try{ return ((JSON.parse(localStorage.getItem('reincarnator_kava_lance_v1') || '{}') || {})[Table.S.code || 'solo'] || {}).units || []; }catch(e){ return []; } })());
    const uniq = units.filter((u, i)=>units.findIndex(x=>x.id===u.id)===i);
    UI.sheet({title:'Союзник из Копья', html:uniq.length ? `<div class="kv-act-grid">${uniq.map((u, i)=>`<button type="button" class="kv-act" data-a="add" data-i="${i}"><b>${esc(u.name)}</b><span>СТК ${int(u.stk)} · МОБ ${int(u.mob)}</span></button>`).join('')}</div>` : '<div class="kv-empty">В Копье пока нет свиты и техники</div>',
      onAction(a, b, close){ const u = uniq[+b.dataset.i]; B.units.push({id:uid(), side:'lance', kind:'ally', name:u.name, zone:B.zones[0].id, stk:int(u.stk), stkMax:int(u.stk), mob:int(u.mob), bd:7, atk:0, weapons:[{name:'Оружие', dmg:'к6'}], scale:'personal', acted:false, status:'ok', moraleOk:0, moraleDue:''}); close(); changed(); }});
  }

  // ---------- события ----------
  function onClick(e){
    const t = e.target.closest('[data-unit]'); if(t && B){ unitSheet(t.dataset.unit); return; }
    const b = e.target.closest('[data-b]'); if(!b) return;
    const a = b.dataset.b, id = b.dataset.id;
    if(a==='start'){ start(); return; }
    if(!B) return;
    switch(a){
      case 'round': { const en = newRound(); Fx.play(en); Table.rolled(en); return; }
      case 'end': if(confirm('Закончить бой? Поле и жетоны сохранятся до следующего боя.')) end(); return;
      case 'zadd': addZone(); return;
      case 'zdel': if(B.units.some(u=>u.zone===id)){ UI.toast('Сначала уберите жетоны из Зоны', 'fail'); return; } B.zones = B.zones.filter(z=>z.id!==id); changed(); return;
      case 'zprop': { const z = B.zones.find(x=>x.id===id); z[b.dataset.k] = !z[b.dataset.k]; changed(); return; }
      case 'tandems': addTandems(); return;
      case 'enemy': enemySheet(); return;
      case 'custom': customSheet(); return;
      case 'ally': allySheet(); return;
      case 'morale-all': B.units.filter(u=>u.moraleDue).forEach(u=>{ const en = morale(u.id); Table.rolled(en); }); UI.toast('Боевой Дух проверен — итоги в журнале', 'ok'); return;
    }
  }
  function onInput(e){
    if(!B) return;
    const z = e.target.closest('[data-zf]'); if(z){ const zone = B.zones.find(x=>x.id===z.dataset.zf); if(zone){ zone.name = z.value; persist(); clearTimeout(onInput.t); onInput.t = setTimeout(()=>{ if(isGm()) Table.send({type:'battle', state:wire()}); }, 600); } return; }
    const f = e.target.closest('[data-bf]'); if(f){ B[f.dataset.bf] = f.type==='checkbox' ? f.checked : f.value; changed(); }
  }
  // перетаскивание жетона в другую Зону
  let dragId = '';
  function onDragStart(e){ const t = e.target.closest('[data-unit]'); if(!t) return; dragId = t.dataset.unit; e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e){ const z = e.target.closest('[data-zone]'); if(z && dragId){ e.preventDefault(); z.classList.add('drop'); } }
  function onDragLeave(e){ const z = e.target.closest('[data-zone]'); if(z) z.classList.remove('drop'); }
  function onDrop(e){
    const z = e.target.closest('[data-zone]'); if(!z || !dragId || !B) return; e.preventDefault(); z.classList.remove('drop');
    const u = B.units.find(x=>x.id===dragId); dragId = '';
    if(!u || u.zone===z.dataset.zone) return;
    if(isGm() || !Table.S.role){ u.zone = z.dataset.zone; changed(); }
    else if(myUnit() && myUnit().id===u.id){ Table.send({type:'battle-move', unit:u.id, zone:z.dataset.zone}, Table.S.gmId); }
  }
  function mount(el){
    roots.push(el);
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onInput);
    el.addEventListener('dragstart', onDragStart); el.addEventListener('dragover', onDragOver); el.addEventListener('dragleave', onDragLeave); el.addEventListener('drop', onDrop);
    render(el);
  }
  function init(){ if(isGm() || !Table.S.role){ const s = load(); if(s && s.active) B = s; } }
  Table.onChange(()=>{ if(isGm() && !B){ const s = load(); if(s && s.active){ B = s; sync(); } } renderAll(); });
  return {mount, init, receive, onMove, onHit, sync, reportHit, targets, myUnit, distance, start, get active(){ return !!(B && B.active); }, get state(){ return B; }, RANK, DIST_NAME, renderAll};
})();
