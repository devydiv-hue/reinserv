/* ======================================================================
   КАВАЛЕРИЯ — СОЗДАНИЕ ПО КНИГЕ: шаги Спектра (часть 3) и Катафракта (часть 5). Каждый шаг — функция,
   возвращающая {apply(p) — записать в тандем, lines — что выпало, dice — кости для анимации, summary}.
   Мастер создания (08-ui) показывает шаги по одному, бросает кости с анимацией, даёт перебросить или вписать вручную.
   Спектр: характеристики (3к6 каждая: +1 за 4–5, +2 за 6) → Культура 2к6, Ремесло к6, общее к66 → Пробуждение и Ритуал
   к66 → экипировка (6 бросков между таблицами) → СТК 6 + СОМ, МОБ 10 + МОТ, Удача 13, кС к6 → имя, облик, талисман.
   Катафракт: Каркас к6 (+ СТК по каркасу), Утроба к6, Ядро к6 и характер к12, Реактор к6, Сенсоры к6 (+ модули),
   или готовый класс; затем оборудование, Каприз к66, имя (к6 + части к66), детали к20.
   ====================================================================== */
const Create = (function(){
  const d66 = ()=>{ const a = Dice.rnd(6), b = Dice.rnd(6); return {v:a * 10 + b, text:`к66: ${a} и ${b} → ${a}${b}`, dice:[{sides:6, value:a, label:'десятки'}, {sides:6, value:b, label:'единицы'}]}; };
  const d = (n, label)=>{ const v = Dice.rnd(n); return {v, dice:[{sides:n, value:v, label}]}; };

  // ---------- Спектр ----------
  function stats(){
    const vals = {}, dice = [], lines = [];
    KAVA.STATS.forEach(s=>{
      const ds = [Dice.rnd(6), Dice.rnd(6), Dice.rnd(6)], v = ds.reduce((a, x)=>a + (x===6 ? 2 : x >= 4 ? 1 : 0), 0);
      vals[s.key] = v; lines.push(`${s.short}: 3к6 [${ds.join(', ')}] → ${v}`);
      ds.forEach(x=>dice.push({sides:6, value:x, label:s.short, tint:x===6 ? 'good' : x >= 4 ? '' : '', dim:x < 4}));
    });
    return {lines, dice, summary:KAVA.STATS.map(s=>`${s.short} ${vals[s.key]}`).join(' · '), vals,
      apply(p){ Object.assign(p.stats, vals); p.stk = Pilot.stkMax(p); }};
  }
  function culture(){
    const a = Dice.rnd(6), b = Dice.rnd(6), c = Dice.pick(KAVA.CULTURES, a + b), k = Dice.rnd(6);
    let craft = c.crafts[k - 1];
    const lines = [`Культура — 2к6: [${a}, ${b}] = ${a + b} → ${c.name}`, `Ремесло — к6: [${k}] → ${craft}`], dice = [{sides:6, value:a, label:'культура'}, {sides:6, value:b, label:'культура'}, {sides:6, value:k, label:'ремесло'}];
    if(/\*/.test(craft)){ const x = Dice.rnd(6), dyn = Dice.pick(KAVA.DYNASTY, x); craft = craft.replace('*', '') + ` Служил ${dyn.name}.`; lines.push(`Династия — к6: [${x}] → ${dyn.name}`); dice.push({sides:6, value:x, label:'династия'}); }
    const g = d66(), general = KAVA.GENERAL_CRAFTS[g.v]; lines.push(`Общее ремесло — ${g.text} → ${general}`); g.dice.forEach(x=>dice.push(Object.assign(x, {label:'общее'})));
    return {lines, dice, summary:`${c.name} · ${craft.split(' – ')[0]} · ${general.split(' – ')[0]}`, culture:c, craft, general,
      apply(p){ p.culture = `${c.name}: ${c.desc}`; p.craft = craft; p.craft2 = general; }};
  }
  function becoming(){
    const a = d66(), b = d66(), aw = Dice.pick(KAVA.AWAKENING, a.v), ri = Dice.pick(KAVA.RITUAL, b.v);
    return {lines:[`Пробуждение — ${a.text} → ${aw.text}`, `Ритуал декомпрессии — ${b.text} → ${ri.text}`],
      dice:a.dice.map(x=>Object.assign(x, {label:'пробужд.'})).concat(b.dice.map(x=>Object.assign(x, {label:'ритуал'}))), summary:aw.text.split(' – ')[0] + ' · ' + ri.text.split('.')[0],
      awakening:aw.text, ritual:ri.text, apply(p){ p.awakening = aw.text; p.ritual = ri.text; }};
  }
  // экипировка: n бросков в каждую таблицу; пояс, мембрана и Урс — всегда
  function gear(nArmor, nWeapons, nGear){
    const items = [], lines = [], dice = [];
    for(let i = 0; i < nArmor; i++){ const v = Dice.rnd(6), t = KAVA.START_ARMOR[v - 1]; items.push(Pilot.itemFrom(t)); lines.push(`Доспехи — к6: [${v}] → ${t.name}`); dice.push({sides:6, value:v, label:'доспех'}); }
    for(let i = 0; i < nWeapons; i++){ const v = Dice.rnd(6), t = KAVA.START_WEAPONS[v - 1]; items.push(Pilot.itemFrom(t)); lines.push(`Вооружение — к6: [${v}] → ${t.name}`); dice.push({sides:6, value:v, label:'оружие'}); }
    for(let i = 0; i < nGear; i++){ const r = d66(), t = KAVA.START_GEAR[r.v]; items.push(Pilot.itemFrom(t)); lines.push(`Снаряжение — ${r.text} → ${t.name}`); }
    let first = true; items.forEach(it=>{ if(it.kind==='armor'){ it.worn = first; first = false; } });
    return {lines, dice, items, summary:items.map(it=>it.name).join(', '),
      apply(p){ p.items = KAVA.START_KIT.map(t=>Pilot.itemFrom(t)).concat(items); }};
  }
  function name(gender){
    const g = gender==='m' || gender==='f' ? gender : (Dice.rnd(2)===1 ? 'm' : 'f'), r = d66(), v = (g==='m' ? KAVA.NAMES_M : KAVA.NAMES_F)[r.v];
    return {v, lines:[`Имя (${g==='m' ? 'мужское' : 'женское'}) — ${r.text} → ${v}`], dice:r.dice, summary:v, apply(p){ p.name = v; }};
  }
  function look(){ const x = d(20, 'облик'), v = KAVA.LOOKS[x.v - 1]; return {v, lines:[`Черта внешности — к20: [${x.v}] → ${v}`], dice:x.dice, summary:v, apply(p){ p.look = v; }}; }
  function talisman(){ const x = d(20, 'талисман'), v = KAVA.TALISMANS[x.v - 1]; return {v, lines:[`Талисман — к20: [${x.v}] → ${v}`], dice:x.dice, summary:v, apply(p){ p.talisman = v; }}; }
  function augment(){ const r = d66(), t = KAVA.AUGMENTS[r.v]; return {v:t, lines:[`Аугментация — ${r.text} → ${t || 'строки ' + r.v + ' в книге нет'}`], dice:r.dice, summary:t || '—', apply(p){ if(t) p.augments = (p.augments ? p.augments.trim() + '\n' : '') + t; }}; }

  // ---------- Катафракт ----------
  const pickRow = (rows, label)=>{ const x = d(6, label); return {row:Dice.pick(rows, x.v), v:x.v, dice:x.dice}; };
  function frame(){
    const f = pickRow(MECH.FRAMES, 'каркас'), stk = Dice.roll(f.row.stk);
    return {lines:[`Каркас — к6: [${f.v}] → ${f.row.name} (${f.row.mass}): МОБ ${f.row.mob}${f.row.note ? '. ' + f.row.note : ''}`, `СТК — ${stk.text}`],
      dice:f.dice.concat(stk.dice.map(v=>({sides:6, value:v, label:'СТК'}))), summary:`${f.row.name}, СТК ${stk.total}`,
      apply(p){ const m = p.mech; m.frame = f.row.key; m.stkMax = stk.total; m.stk = stk.total; m.cls = ''; }};
  }
  function wombRoll(){ const w = pickRow(MECH.WOMBS, 'утроба'); return {lines:[`Утроба — к6: [${w.v}] → ${w.row.name}: ${w.row.text}`], dice:w.dice, summary:w.row.name, apply(p){ p.mech.womb = w.row.key; }}; }
  function core(){
    const c = pickRow(MECH.CORES, 'ядро'), n = d(12, 'характер'), nature = MECH.CORE_NATURE[n.v - 1];
    return {lines:[`Ядро — к6: [${c.v}] → ${c.row.name}, Отчуждённость ${c.row.alien}`, `Характер — к12: [${n.v}] → ${nature}`], dice:c.dice.concat(n.dice),
      summary:`${c.row.name} (${c.row.alien}) · ${nature.split(' – ')[0]}`, apply(p){ p.mech.core = c.row.key; p.mech.nature = nature; }};
  }
  function reactorRoll(){ const r = pickRow(MECH.REACTORS, 'реактор'); return {lines:[`Реактор — к6: [${r.v}] → ${r.row.name} (${r.row.sl} СЛ)${r.row.note ? '. ' + r.row.note : ''}`], dice:r.dice, summary:r.row.name, apply(p){ p.mech.reactor = r.row.key; }}; }
  function sensorsRoll(){
    const s = pickRow(MECH.SENSORS, 'сенсоры'), pool = MECH.SENSOR_MODULES.map(x=>x.name), mods = [];
    while(mods.length < s.row.modules){ const x = pool.splice(Dice.rnd(pool.length) - 1, 1)[0]; mods.push(x); }
    return {lines:[`Сенсоры — к6: [${s.v}] → ${s.row.name}: +${s.row.bonus}, ${s.row.sl} СЛ, дистанция ${s.row.range}`, `Модули (можно заменить): ${mods.join(', ')}`], dice:s.dice,
      summary:`${s.row.name} +${s.row.bonus} · ${mods.join(', ')}`, apply(p){ const m = p.mech; m.sensors = s.row.key; m.sensorBonus = 0; m.sensorSl = 0; m.sensorModules = mods; }};
  }
  // готовый класс
  function applyClass(p, c){
    const m = p.mech, f = MECH.FRAMES.find(x=>x.key===c.frame);
    Object.assign(m, {cls:c.name, frame:c.frame, stk:c.stk, stkMax:c.stk, core:c.core, reactor:c.reactor, sensors:c.sensors, sensorBonus:c.sensorBonus || 0, sensorSl:c.sensorSl || 0,
      sensorModules:c.sensorModules.slice(), items:[], built:true, kr:6});
    c.equip.forEach(n=>{
      const t = MECH.byName(n) || MECH.MODULES.find(x=>x.name===n) || MECH.CONSUMABLES.find(x=>x.name===n);
      m.items.push(Pilot.mechItemFrom(t || {kind:'weapon', type:'missile', name:n, dmg:'', sl:1, range:'>>', tags:'', stat:'kog', note:'характеристик в книге нет — задайте сами'}));
    });
    if(!m.name) m.name = c.name.replace(/[«»"]/g, '').split(' ').pop();
    return f;
  }
  function quirk(){ const r = d66(), t = MECH.QUIRKS[r.v]; return {lines:[`Каприз — ${r.text} → ${t}`], dice:r.dice, summary:t.split(':')[0], apply(p){ p.mech.quirk = t; }}; }
  function mechName(){
    const k = Dice.rnd(6), a = d66(), b = d66(), c = d66();
    const p1 = MECH.NAME1[a.v], p2 = MECH.NAME2[b.v], p3 = MECH.NAME3[c.v];
    const v = k <= 3 ? `${p1} ${p2}` : k <= 5 ? `${p2} ${p3}` : `${p1} ${p2} ${p3}`;
    return {v, lines:[`Имя — к6: [${k}] → ${k <= 3 ? 'часть 1 + часть 2' : k <= 5 ? 'часть 2 + часть 3' : 'все три части'}`, `Части — ${a.v}: ${p1}…, ${b.v}: ${p2}, ${c.v}: …${p3}`],
      dice:[{sides:6, value:k, label:'формула'}].concat(a.dice, b.dice).slice(0, 5), summary:v, apply(p){ p.mech.name = v; }};
  }
  function details(){
    const o = d(20), c1 = d(20), c2 = d(20), i = d(20), mk = d(20), mrow = MECH.MARKS[mk.v - 1];
    let mark = mrow.t, subv = 0;
    if(mrow.sub){ subv = Dice.rnd(6); mark += ': ' + mrow.sub[subv - 1]; }
    const origin = MECH.ORIGIN[o.v - 1], camo = `${MECH.CAMO[c1.v - 1]} в тонах ${MECH.TONES[c2.v - 1]}`, inside = MECH.INSIDE[i.v - 1];
    return {lines:[`Происхождение — к20: [${o.v}] → ${origin}`, `Камуфляж — к20: [${c1.v}] и тон к20: [${c2.v}] → ${camo}`, `Внутри Утробы — к20: [${i.v}] → ${inside}`, `Отметины — к20: [${mk.v}]${subv ? ` и к6: [${subv}]` : ''} → ${mark}`],
      dice:[{sides:20, value:o.v, label:'происх.'}, {sides:20, value:c1.v, label:'камуфляж'}, {sides:20, value:c2.v, label:'тон'}, {sides:20, value:i.v, label:'утроба'}, {sides:20, value:mk.v, label:'отметины'}],
      summary:camo, apply(p){ Object.assign(p.mech, {origin, camo, inside, marks:mark}); }};
  }
  return {stats, culture, becoming, gear, name, look, talisman, augment, frame, womb:wombRoll, core, reactor:reactorRoll, sensors:sensorsRoll, applyClass, quirk, mechName, details, d66};
})();
