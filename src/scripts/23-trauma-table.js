/* ======================================================================
   ТАБЛИЦА ТРАВМ И ПОЛОМОК (стр. 42 и «Поломка гумоида (или иного робота)») — у существ Мастера.
   Жетон Мастера получил травму 🦴 (атака с карты, граната, способность, «+» в карточке) — приложение само бросает к12
   по таблице травм: 1 — погибает; 2–3 — тяжёлая травма: истощён и в конце каждого круга спасбросок от смерти (к20,
   Максимум 9), пока не стабилизирован; 4–6 — травма: истощение и кровотечение (каждый час −1 ОЗ и спасбросок от
   смерти); 7–9 — шок до конца боя (или пока не снимут Броском медицины); 10–12 — без последствий. Травма и тяжёлая
   травма уточняются вторым к12: часть тела и травма (у тяжёлой — «… и смерть» тоже смерть).
   Гумоиды и роботы (природа «робот») — к20 по таблице поломок: 20 — возгорание (−1к6 ОЗ в конце круга, пока не
   потушат), 19 — роняет оружие, 17–18 — нога (лёгкая атлетика и рефлексы Осложнены), 16 — тело (−[размер + 1к6] ОЗ,
   сила Осложнена), 15 — рука (−[размер + 1] ОЗ), 14 — обездвижен, 13 — располовинен (−50% максимума ОЗ), 12 —
   внеочередное действие Упрощённо, 10–11 — реактор (−[размер + 1к6] ОЗ каждый круг, при гибели — взрыв МУ 16, раны
   [размер + 4]), 6–9 — без последствий, 1–5 — ещё [размер + 1] ран. У пустот травм нет.
   Последствия — сразу на жетон (ОЗ, отметки «Истощён», «Шок», «Обездвижен», «Погиб», Осложнения — усилением
   AbilityKit), список — в карточке существа (✕ — снять); результат — в лог (скрытого существа — только Мастеру) и
   подсказкой. «Стальной череп», «Протоплазма Эмира» («перебросить бросок по таблице травм») — до применения
   подсказка с кнопкой переброса. Попадание в голову приложение не различает — Осложнённый бросок (голова) не делается.
   ====================================================================== */
const TraumaTable = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const AK = ()=>typeof AbilityKit!=='undefined' ? AbilityKit : null;
  const isGm = ()=>{ const gt = GT(); return !!gt && gt.netRole()!=='player'; };
  const d = (n)=>1 + Math.floor(Math.random()*n);
  const KEY = 'reincarnator_trauma_v1';
  let store = {}; try{ store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){}
  const save = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(store)); }catch(e){} };
  const listOf = (id)=>(store[id] || (store[id] = []));
  const newId = ()=>'tt' + Math.random().toString(36).slice(2, 8);
  const refresh = ()=>{ if(typeof Bestiary!=='undefined' && Bestiary.refreshFloat) Bestiary.refreshFloat(); };

  /* ---------- таблицы книги ---------- */
  const EFFECT = [[1, 1, 'dead', 'погибает'], [2, 3, 'heavy', 'тяжёлая травма'], [4, 6, 'trauma', 'травма'], [7, 9, 'shock', 'шок'], [10, 12, 'none', 'без последствий']];
  // к12 — часть тела, травма, тяжёлая травма (смерть — у «… и смерть»)
  const INJURY = [[1, 'голова', 'Выбит глаз', 'Обезглавливание и смерть'], [2, 'голова', 'ЧМТ (сотрясение)', 'ЧМТ с компрессией мозга'], [3, 'голова', 'Рваная рана головы', 'Контузия'],
    [4, 'торс', 'Сквозное ранение груди', 'Ранение в сердце и смерть'], [5, 'торс', 'Ранение в живот', 'Внутреннее кровотечение'], [6, 'торс', 'Прострел ключицы', 'Раздроблённые рёбра'],
    [7, 'торс', 'Контузия грудной клетки', 'Пробитое лёгкое'], [8, 'нога', 'Разрыв сосудов бедра', 'Травматичная ампутация'], [9, 'нога', 'Ранение колена', 'Сложный перелом бедра'],
    [10, 'нога', 'Раздроблена ступня', 'Разрушение колена'], [11, 'рука', 'Разрыв бицепса', 'Травматичная ампутация'], [12, 'рука', 'Пробитие кисти', 'Глубокая рана плеча']];
  const BREAK = [[20, 20, 'fire', 'Возгорание: −1к6 ОЗ в конце круга, пока не потушат удачной проверкой'], [19, 19, 'drop', 'Поломки нет, но роняет оружие'],
    [17, 18, 'leg', 'Повреждена нога: проверки лёгкой атлетики и рефлексов Осложнены'], [16, 16, 'body', 'Повреждено тело: −[размер + 1к6] ОЗ, быстрые действия и сила Осложнены'],
    [15, 15, 'arm', 'Повреждена рука: −[размер + 1] ОЗ, проверки с этой рукой Осложнены'], [14, 14, 'legs', 'Серьёзно повреждены ноги — обездвижен'],
    [13, 13, 'half', 'Располовинен: теряет ОЗ = 50% от максимальных'], [12, 12, 'ai', 'Импульс разгоняет ИИ: 1 внеочередное действие, Упрощённо'],
    [10, 11, 'reactor', 'Возгорание реактора: −[размер + 1к6] ОЗ в конце каждого круга, пока не починят; гибель от этого — взрыв МУ 16, раны [размер + 4]'],
    [6, 9, 'none', 'Без последствий'], [1, 5, 'extra', 'Поломки нет, но попадание наносит ещё [размер + 1] ран']];
  const row = (tb, r)=>tb.find(x=>r >= x[0] && r <= x[1]);
  const sizeOf = (t)=>t && t.creature && isFinite(+t.creature.rz) ? +t.creature.rz : ({small:-2, normal:0, large:2, huge:3})[t && t.size] || 0;
  const nameOf = (t)=>{ const gt = GT(), v = gt && gt.vitalsOf(t); return (v && v.name) || t.name || 'Существо'; };
  const robotOf = (t)=>typeof tokenNature==='function' && tokenNature(t)==='robot';
  const sizeExpr = (rz)=>'к6' + (rz ? (rz > 0 ? '+' + rz : String(rz)) : '');

  /* ---------- лог и подсказки ---------- */
  function log(t, text){
    if(t.hidden){ // скрытое существо — только в логе Мастера
      if(typeof session!=='undefined') session.rollCounter++;
      if(typeof addRollLogEntry==='function') addRollLogEntry({id:getDeviceId() + ':' + session.rollCounter, player:session.ownName || 'Мастер', kind:'quick', abilityUse:true, text:String(text).slice(0, 900)});
      return; }
    if(typeof recordAndShareQuickRoll==='function') recordAndShareQuickRoll({abilityUse:true, text:String(text).slice(0, 900)});
  }
  const alert = (a)=>{ const ak = AK(); if(ak) ak.alert(Object.assign({ms:120000}, a)); };
  function hpDelta(id, n){ const gt = GT(), t = gt.getToken(id); if(!t || t.hp==null || !n) return; gt.updateToken(id, {hp:t.hp - n}); }
  function kill(id){ const gt = GT(), t = gt.getToken(id); if(!t) return; if(t.hp!=null && t.hp > 0) gt.updateToken(id, {hp:0}); gt.addMarkTo(id, 'dead', 0);
    store[id] = listOf(id).filter(x=>x.kind!=='dying'); save(); }
  function addItem(id, item){ listOf(id).push(Object.assign({id:newId()}, item)); save(); }

  /* ---------- травма ---------- */
  // o.dis — Осложнённо (голова, черта «травма»): из двух к12 худший (меньший); o.head — травма головы: строка по к6 (1–2, 3–4, 5–6)
  function rollTrauma(t, o){ o = o || {}; const a = d(12), b = o.dis ? d(12) : 0, r = o.dis ? Math.min(a, b) : a, e = row(EFFECT, r);
    let inj = 0, k6 = 0; if(e[2]==='heavy' || e[2]==='trauma'){ if(o.head){ k6 = d(6); inj = k6 <= 2 ? 1 : k6 <= 4 ? 2 : 3; } else inj = d(12); }
    return {r, rolls:o.dis ? [a, b] : null, e, inj, k6, head:!!o.head, i:inj ? row(INJURY.map(x=>[x[0], x[0]].concat(x.slice(1))), inj) : null}; }
  function traumaText(t, x, red){
    const injury = x.i ? (x.e[2]==='heavy' ? x.i[4] : x.i[3]) + ` (${x.i[2]})` : '';
    const why = [x.head ? 'попадание в голову' : '', red ? 'черта оружия «травма»' : ''].filter(Boolean).join(', ');
    return `${nameOf(t)} — таблица травм${why ? ` (${why}, Осложнённо)` : ''}: к12=${x.rolls ? `[${x.rolls.join(', ')}]→` : ''}${x.r} — ${x.e[3]}${injury ? `; ${x.head ? `к6=${x.k6}` : `к12=${x.inj}`}: ${injury}` : ''}`; }
  function applyTrauma(id, x, red){
    const gt = GT(), t = gt.getToken(id); if(!t) return;
    const kind = x.e[2], injury = x.i ? (kind==='heavy' ? x.i[4] : x.i[3]) : '', death = kind==='dead' || /смерть/i.test(injury);
    let fx = '';
    if(death){ kill(id); fx = 'погибает'; }
    else if(kind==='heavy'){ gt.addMarkTo(id, 'exhausted', 0); addItem(id, {kind:'injury', icon:'🦴', text:`${injury} (${x.i[2]}) — тяжёлая травма`});
      addItem(id, {kind:'dying', icon:'⚠', text:'в конце каждого круга — спасбросок от смерти (9), пока не стабилизирован'}); fx = 'истощён; спасбросок от смерти в конце каждого круга'; }
    else if(kind==='trauma'){ gt.addMarkTo(id, 'exhausted', 0); addItem(id, {kind:'injury', icon:'🦴', text:`${injury} (${x.i[2]}) — травма; кровотечение: каждый час −1 ОЗ и спасбросок от смерти, пока не стабилизирован`}); fx = 'истощение, кровотечение'; }
    else if(kind==='shock'){ gt.addMarkTo(id, 'shock', 0); fx = 'шок до конца боя (или пока не снимут Броском медицины)'; }
    log(t, traumaText(t, x, red) + (fx && kind!=='shock' && kind!=='none' ? '. ' + fx[0].toUpperCase() + fx.slice(1) : ''));
    if(kind!=='none') alert({kind:'trig', title:`🦴 ${nameOf(t)}: ${death ? 'погибает' : x.e[3]}`, text:traumaText(t, x, red).replace(/^[^—]+—\s*/, '') + (fx ? '. ' + fx[0].toUpperCase() + fx.slice(1) + '.' : '') + (kind==='shock' || kind==='trauma' ? ' Незначительная для истории цель может сразу выбыть из боя (на выбор Мастера).' : ''), actions:[{label:'Понятно', run:()=>{}}]});
    refresh();
  }
  // «Стальной череп», «Протоплазма Эмира»: перебросить бросок по таблице травм — до применения результата
  function traumaRerolls(t){
    const ak = AK(); if(!ak || !t.creature) return [];
    return (t.creature.abil || []).map((a, i)=>({a, key:'a' + i})).filter(o=>/перебросить\s+бросок\s+по\s+таблице\s+травм/i.test(o.a[1] || '')).map(o=>{
      const s = ak.parse(o.a[0], o.a[1]), left = s.uses ? s.uses.n - ak.usedOf(t.id, o.key) : Infinity; return {name:String(o.a[0]).replace(/\s*\([^)]*\)\s*$/, ''), key:o.key, left, total:s.uses ? s.uses.n : null}; }).filter(o=>o.left > 0);
  }
  function onTrauma(id, red, head){
    const gt = GT(), t = gt.getToken(id); if(!t) return;
    if(robotOf(t)){ if(head) robotHead(id); else onBreak(id, red); return; }
    const x = rollTrauma(t, {dis:red || head, head}), re = x.e[2]==='none' ? [] : traumaRerolls(t);
    if(!re.length){ applyTrauma(id, x, red); return; }
    alert({kind:'re', title:`🦴 ${nameOf(t)}: ${x.e[3]}`, text:traumaText(t, x, red).replace(/^[^—]+—\s*/, '') + '. Перебросить?', ms:300000,
      actions:[{label:'Применить', run:()=>applyTrauma(id, x, red)}].concat(re.map(o=>({label:`↻ ${o.name}${o.total ? ` ${o.left}/${o.total}` : ''}`, run:()=>{
        AK().bump(id, o.key, 1); const y = rollTrauma(t, {dis:red || head, head}); log(t, `${nameOf(t)} — «${o.name}»: переброс таблицы травм (было к12=${x.r})`); applyTrauma(id, y, red); }})))});
  }

  // попадание в голову робота: к20 с Максимумом 9, провал — повреждение ИИ: все проверки характеристик Осложнены
  function robotHead(id){
    const gt = GT(), t = gt.getToken(id); if(!t) return; const r = d(20), ev = evaluateD20Check(r, 9);
    if(!ev.success){ const ak = AK(); if(ak) ak.addBuff(id, 'tthead' + newId(), 'Поломка: ИИ', {mods:{dis:['volya', 'refleksy', 'vynoslivost', 'sila', 'duh', 'smekalka', 'legkaya_atletika', 'lovkost_ruk', 'vospriyatie', 'mistika', 'tehnika', 'ubezhdenie']}, rounds:null, oneShot:false});
      addItem(id, {kind:'injury', icon:'🔧', text:'повреждение ИИ — все проверки характеристик Осложнены'}); }
    const text = `${nameOf(t)} — попадание в голову: к20=${r} / Макс.9 — ${ev.success ? 'ИИ цел' : 'повреждение ИИ: все проверки характеристик Осложнены'}`;
    log(t, text); if(!ev.success) alert({kind:'trig', title:`🔧 ${nameOf(t)}: повреждение ИИ`, text:text.replace(/^[^—]+—\s*/, ''), actions:[{label:'Понятно', run:()=>{}}]}); refresh();
  }
  /* ---------- поломка робота ---------- */
  function onBreak(id, red){
    const gt = GT(), t = gt.getToken(id); if(!t) return;
    const r = d(20), b = row(BREAK, r), rz = sizeOf(t), ak = AK(); let fx = '';
    switch(b[2]){
      case 'fire': addItem(id, {kind:'fire', icon:'🔥', text:'возгорание: −1к6 ОЗ в конце круга, пока не потушат', expr:'к6'}); fx = 'горит'; break;
      case 'leg': if(ak) ak.addBuff(id, 'tt' + r + newId(), 'Поломка: нога', {mods:{dis:['legkaya_atletika', 'refleksy']}, rounds:null, oneShot:false});
        addItem(id, {kind:'injury', icon:'🔧', text:'повреждена нога — лёгкая атлетика и рефлексы Осложнены'}); break;
      case 'body': { const v = Math.max(0, gt.rollWoundsExpr(sizeExpr(rz))); hpDelta(id, v); if(ak) ak.addBuff(id, 'tt' + r + newId(), 'Поломка: тело', {mods:{dis:['sila']}, rounds:null, oneShot:false});
        addItem(id, {kind:'injury', icon:'🔧', text:'повреждено тело — быстрые действия и сила Осложнены'}); fx = `−${v} ОЗ`; break; }
      case 'arm': { const v = Math.max(0, rz + 1); hpDelta(id, v); addItem(id, {kind:'injury', icon:'🔧', text:'повреждена рука — проверки с её использованием Осложнены'}); fx = `−${v} ОЗ`; break; }
      case 'legs': gt.addMarkTo(id, 'immobile', 0); addItem(id, {kind:'injury', icon:'🔧', text:'серьёзно повреждены ноги — обездвижен'}); break;
      case 'half': { const mx = t.hpMax!=null ? t.hpMax : t.hp; const v = Math.ceil((+mx || 0)/2); hpDelta(id, v); addItem(id, {kind:'injury', icon:'🔧', text:'располовинен'}); fx = `−${v} ОЗ`; break; }
      case 'reactor': addItem(id, {kind:'reactor', icon:'☢', text:`реактор горит: −[размер + 1к6] ОЗ в конце каждого круга, пока не починят; гибель — взрыв МУ 16, раны ${rz + 4}`, expr:sizeExpr(rz), boom:rz + 4}); fx = 'реактор горит'; break;
      case 'extra': { const v = Math.max(0, rz + 1); hpDelta(id, v); fx = `ещё −${v} ОЗ`; break; }
    }
    const text = `${nameOf(t)} — таблица поломок${red ? ' (оружие с чертой «травма»)' : ''}: к20=${r} — ${b[3]}${fx ? ` (${fx})` : ''}`;
    log(t, text);
    if(b[2]!=='none') alert({kind:'trig', title:`🔧 ${nameOf(t)}: поломка`, text:text.replace(/^[^—]+—\s*/, ''), actions:[{label:'Понятно', run:()=>{}}]});
    refresh();
  }

  // «Непреклонность»: вместо спасброска от смерти — спасбросок воли (−3), если так лучше
  function deathAlt(t){ const a = t.creature && (t.creature.abil || []).find(x=>/вместо\s+спасброска\s+от\s+смерти[^.]*спасбросок\s+воли/i.test(x[1] || '')); if(!a || typeof TargetRolls==='undefined') return null;
    const m = /спасбросок\s+воли\s*\(\s*([−+-]\s*\d+)\s*\)/i.exec(a[1]), mod = m ? +m[1].replace(/\s/g, '').replace('−', '-') : 0;
    return {max:10 + TargetRolls.npcStat(t, 'volya') + mod, name:String(a[0]).replace(/\s*\([^)]*\)\s*$/, ''), label:`воля${mod ? ` (${mod < 0 ? '−' : '+'}${Math.abs(mod)})` : ''}`}; }
  /* ---------- новый круг: спасбросок от смерти, возгорание, реактор ---------- */
  function onRound(){
    const gt = GT();
    Object.keys(store).forEach(id=>{
      const t = gt.getToken(id); if(!t){ delete store[id]; return; }
      listOf(id).slice().forEach(it=>{
        if(it.kind==='dying'){ const alt = deathAlt(t), mx = Math.max(9, alt ? alt.max : 0), r = d(20), ev = evaluateD20Check(r, mx);
          const how = alt && alt.max > 9 ? ` («${alt.name}»: ${alt.label})` : '';
          if(ev.success) log(t, `${nameOf(t)} — спасбросок от смерти${how}: к20=${r} / Макс.${mx} — держится`);
          else { log(t, `${nameOf(t)} — спасбросок от смерти${how}: к20=${r} / Макс.${mx} — провал, погибает`); kill(id);
            alert({kind:'trig', title:`⚠ ${nameOf(t)}: погибает`, text:`Спасбросок от смерти в конце круга: к20=${r} при Максимуме ${mx} — провал.`, actions:[{label:'Понятно', run:()=>{}}]}); } }
        if(it.kind==='fire' || it.kind==='reactor'){ const t2 = gt.getToken(id); if(!t2 || t2.hp==null) return;
          const v = Math.max(0, gt.rollWoundsExpr(it.expr)); hpDelta(id, v); const hp = t2.hp - v;
          log(t2, `${nameOf(t2)} — ${it.kind==='fire' ? 'возгорание' : 'реактор'}: −${v} ОЗ (осталось ${hp})`);
          if(it.kind==='reactor' && hp <= 0 && t2.hp > 0){ store[id] = listOf(id).filter(x=>x.id!==it.id);
            alert({kind:'trig', title:`💥 ${nameOf(t2)}: реактор взрывается`, text:`Гибель от возгорания реактора — взрыв с МУ 16 взрыв, раны ${it.boom}. Отметьте задетых.`, ms:300000,
              actions:[{label:'💥 Цели взрыва', run:()=>{ if(typeof TargetRolls==='undefined') return; const C = ()=>({hits:null, hp:'', psi:0, states:[], marks:[], note:''});
                TargetRolls.open({src:id, targets:[], title:`${nameOf(t2)}: взрыв реактора`, prefill:{kind:'auto', always:Object.assign(C(), {hits:{n:1, mu:16, muType:'взрыв', wounds:String(Math.max(1, it.boom))}}), cons:C(), extras:[], notes:[], areaSpec:null}}); }},
                {label:'Понятно', run:()=>{}}]}); } }
      });
    });
    save(); refresh();
  }
  let lastRound = null;
  setInterval(()=>{ const gt = GT(); if(!gt || !isGm()){ lastRound = null; return; } const c = gt.state && gt.state.combat, r = c ? c.round : null;
    if(r!=null && lastRound!=null && r!==lastRound) try{ onRound(); }catch(e){ console.warn('[Травмы]', e); }
    lastRound = r; }, 1500);

  /* ---------- новые травмы на жетонах Мастера ---------- */
  // стол сообщает, какие из новых травм — в голову и от черты «травма» (по порядку попаданий)
  const pending = {};
  function noteHits(id, list){ if(list && list.length) pending[id] = (pending[id] || []).concat(list); }
  let known = null;
  const totalOf = (t)=>({n:(+t.trauma || 0) + (+t.traumaRed || 0), red:+t.traumaRed || 0});
  setInterval(()=>{
    const gt = GT(); if(!gt || !gt.state || !isGm()){ known = null; return; }
    const toks = Object.values(gt.state.tokens || {});
    if(!known){ known = {}; toks.forEach(t=>{ known[t.id] = totalOf(t); }); return; } // уже бывшие при загрузке — не бросаем
    toks.forEach(t=>{ const now = totalOf(t), was = known[t.id]; known[t.id] = now; if(!was || t.kind!=='gm' || now.n <= was.n) return;
      if(typeof tokenNature==='function' && tokenNature(t)==='void') return;
      const n = Math.min(6, now.n - was.n), redN = Math.max(0, now.red - was.red), q = pending[t.id] || []; delete pending[t.id];
      for(let i=0; i<n; i++){ const f = q[i] || {head:false, red:i < redN}; try{ onTrauma(t.id, !!f.red, !!f.head); }catch(e){ console.warn('[Травмы]', e); } } });
  }, 700);

  /* ---------- карточка существа: список, ✕ — снять ---------- */
  function cardHtml(tok){
    if(!tok || !isGm()) return '';
    const list = (store[tok.id] || []), bf = AK() ? AK().buffsOf(tok.id).filter(b=>/^tt/.test(b.key)) : [];
    if(!list.length) return '';
    return `<div class="bst-inst-row tt-list"><b>${robotOf(tok) ? 'Поломки' : 'Травмы'}:</b> ${list.map(it=>`<span class="tt-i" title="${esc(it.text)}">${it.icon} ${esc(it.text)}<button type="button" class="ak-mini" data-tt-del="${esc(it.id)}" data-tok="${esc(tok.id)}" title="${it.kind==='dying' ? 'Стабилизирован — больше не бросать' : it.kind==='fire' ? 'Потушен' : it.kind==='reactor' ? 'Починен' : 'Снять'}">✕</button></span>`).join('')}${bf.length ? ` <span class="bst-muted">(Осложнения: ${bf.map(b=>esc(b.name)).join(', ')})</span>` : ''}</div>`;
  }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-tt-del]'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.tok, it = listOf(id).find(x=>x.id===b.dataset.ttDel); if(!it) return;
    store[id] = listOf(id).filter(x=>x.id!==it.id);
    // снятая поломка ноги/тела — снять и её Осложнение
    if(it.kind==='injury' && /нога|тело|ИИ/.test(it.text) && AK()){ const bf = AK().buffsOf(id).find(x=>/^tt/.test(x.key) && (/нога/.test(it.text) ? /нога/i.test(x.name) : /ИИ/.test(it.text) ? /ИИ/.test(x.name) : /тело/i.test(x.name))); if(bf) AK().dropBuff(id, bf.key); }
    save(); refresh();
  }, true);

  function clear(id){ delete store[id]; save(); refresh(); } // «Встань и иди»: травмы сняты
  return { cardHtml, onTrauma, onRound, listOf, clear, noteHits };
})();
