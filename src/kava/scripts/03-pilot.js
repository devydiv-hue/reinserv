/* ======================================================================
   КАВАЛЕРИЯ — СПЕКТР (лист пилота): модель, хранение в браузере, производные значения.
   Хранение: localStorage reincarnator_kava_pilots_v1 = {current, list:{id: pilot}} — префикс reincarnator_ нужен,
   чтобы пилоты попадали в общую резервную копию («Данные и резервная копия» в Реинкарнаторе).
   Производные по книге: СТК = 6 + СОМ, МОБ = 10 + МОТ (+ доспех, − нагрузка), Испытание Удачи — 13,
   кС — к6. Нагрузка: 4 СЛ — 1 пункт, далее +1 за каждые 3 СЛ; СОМ позволяет игнорировать 1–3 пункта.
   ====================================================================== */
const Pilot = (function(){
  const KEY = 'reincarnator_kava_pilots_v1';
  const uid = ()=>Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const int = (v, d)=>{ const n = parseInt(v, 10); return Number.isFinite(n) ? n : (d || 0); };

  function blank(){
    return {
      v:1, id:uid(), name:'', created:new Date().toISOString(),
      stats:{som:0, mot:0, kog:0, emp:0}, bonus:{som:0, mot:0, kog:0, emp:0},
      stk:6, stkMaxMod:0, mobMod:0, luckMod:0, scars:0, // scars — травмы, взятые чтобы избежать смерти (+1 к Удаче каждая)
      ks:6, ksBonus:0, // кость синхронизации и накопленный +1 к следующему броску роста
      culture:'', craft:'', craft2:'', awakening:'', ritual:'',
      look:'', talisman:'', memories:KAVA.MEMORY_QUESTIONS.map(q=>({q, a:'', lost:false})),
      augments:'', campaigns:0, reputation:'', notes:'',
      atkRanged:0, atkMelee:0, // постоянные бонусы к атакам (например, от аугментаций: стрелковые +1, рукопашные +1)
      injuries:[], // [{id, text}] — каждая занимает 1 СЛ
      items:[],    // [{id, kind, name, sl, marks, ...}]
      inWomb:false, // «В Утробе»: атаки, урон и МОБ по умолчанию — Катафракта
      mech:blankMech()
    };
  }
  // Катафракт тандема. Каркас/утроба/ядро/реактор/сенсоры — ключи таблиц MECH; кР — текущая кость реактора.
  function blankMech(){
    return {name:'', cls:'', frame:'fighter', womb:'restored', core:'elder', nature:'', reactor:'kugel', sensors:'tac', sensorBonus:0, sensorSl:0, sensorModules:[],
      stk:0, stkMax:0, mobMod:0, kr:6, explode:0, items:[], crits:[], quirk:'', origin:'', camo:'', inside:'', marks:'', gifts:'', nodes:'', notes:'', built:false};
  }
  const sensorOf = (m)=>MECH.SENSORS.find(s=>s.key===m.sensors) || MECH.SENSORS[0];
  const frameOf = (m)=>MECH.FRAMES.find(f=>f.key===m.frame) || MECH.FRAMES[0];
  const reactorOf = (m)=>MECH.REACTORS.find(r=>r.key===m.reactor) || MECH.REACTORS[0];
  const coreOf = (m)=>MECH.CORES.find(c=>c.key===m.core) || MECH.CORES[0];
  const womb = (m)=>MECH.WOMBS.find(w=>w.key===m.womb) || MECH.WOMBS[0];
  // предмет из таблицы книги → предмет листа
  function itemFrom(t){
    const it = Object.assign({id:uid(), marks:0}, JSON.parse(JSON.stringify(t)));
    if(it.kind==='armor') it.worn = true;
    return it;
  }
  function starter(){ const p = blank(); KAVA.START_KIT.forEach(t=>p.items.push(itemFrom(t))); return p; }

  // ---- хранение ----
  let store = {current:'', list:{}};
  try{ store = JSON.parse(localStorage.getItem(KEY) || 'null') || store; }catch(e){}
  if(!store.list || typeof store.list!=='object') store.list = {};
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(store)); }catch(e){ console.warn('[Кавалерия] не удалось сохранить', e); } }
  function current(){
    let p = store.list[store.current];
    if(!p){ const ids = Object.keys(store.list); p = ids.length ? store.list[ids[0]] : null; }
    if(!p){ p = starter(); store.list[p.id] = p; }
    store.current = p.id; return fix(p);
  }
  function setCurrent(id){ if(store.list[id]){ store.current = id; save(); } return current(); }
  // нетронутый пустой лист (создаётся сам при первом открытии) — не копится рядом с новым пилотом
  const pristine = (p)=>p && !p.name && !p.culture && !p.craft && !p.look && !p.notes && !p.injuries.length && p.items.length===KAVA.START_KIT.length &&
    KAVA.STATS.every(s=>!int(p.stats[s.key]) && !int(p.bonus[s.key]));
  function add(p){
    Object.keys(store.list).forEach(id=>{ if(id!==p.id && pristine(store.list[id])) delete store.list[id]; });
    store.list[p.id] = fix(p); store.current = p.id; save(); return p;
  }
  function remove(id){ delete store.list[id]; if(store.current===id) store.current = ''; save(); return current(); }
  function all(){ return Object.values(store.list).sort((a, b)=>String(b.created || '').localeCompare(String(a.created || ''))); }
  // починка старых или импортированных данных
  function fix(p){
    const b = blank();
    Object.keys(b).forEach(k=>{ if(p[k]===undefined) p[k] = b[k]; });
    ['stats', 'bonus'].forEach(k=>KAVA.STATS.forEach(s=>{ p[k][s.key] = int(p[k][s.key]); }));
    if(!Array.isArray(p.items)) p.items = [];
    if(!Array.isArray(p.injuries)) p.injuries = [];
    if(!Array.isArray(p.memories) || p.memories.length!==5) p.memories = b.memories;
    p.items.forEach(it=>{ if(!it.id) it.id = uid(); it.sl = Math.max(0, int(it.sl, 1)); it.marks = Math.min(3, Math.max(0, int(it.marks))); });
    p.injuries.forEach(x=>{ if(!x.id) x.id = uid(); });
    if(Dice.STEPS.indexOf(+p.ks) < 0) p.ks = 6;
    // Катафракт (пилоты первой версии листа были без него)
    const bm = blankMech();
    if(!p.mech || typeof p.mech!=='object') p.mech = bm;
    Object.keys(bm).forEach(k=>{ if(p.mech[k]===undefined) p.mech[k] = bm[k]; });
    if(!Array.isArray(p.mech.items)) p.mech.items = [];
    if(!Array.isArray(p.mech.crits)) p.mech.crits = [];
    if(!Array.isArray(p.mech.sensorModules)) p.mech.sensorModules = [];
    p.mech.items.forEach(it=>{ if(!it.id) it.id = uid(); it.sl = Math.max(0, int(it.sl, 1)); it.marks = Math.min(3, Math.max(0, int(it.marks))); });
    p.mech.crits.forEach(x=>{ if(!x.id) x.id = uid(); });
    if(Dice.STEPS.indexOf(+p.mech.kr) < 0) p.mech.kr = 6;
    p.inWomb = !!p.inWomb;
    p.watches = Math.max(0, int(p.watches));
    return p;
  }
  // Вахты в Утробе (часть 2): после 3 + СОМ вахт подключения без перерыва — бросок Отдачи каждые СОМ вахт,
  // +1 к броску за каждую сверхурочную вахту. Древняя Утроба, Полиорганическая мембрана, Нейрометаболический
  // медиатор — +1 вахта; каприз «Удручающая тишина» — не дольше 3 вахт.
  function wombLimit(p){
    const som = stat(p, 'som', true), parts = [`3 + СОМ ${som}`];
    let limit = 3 + som;
    if(p.mech && p.mech.womb==='ancient'){ limit++; parts.push('Древняя Утроба +1'); }
    if((p.items || []).some(it=>/полиорганическая мембрана/i.test(it.name || ''))){ limit++; parts.push('Полиорганическая мембрана +1'); }
    if(/нейрометаболическ/i.test(p.augments || '')){ limit++; parts.push('Нейрометаболический медиатор +1'); }
    if(p.mech && /^Удручающая тишина/i.test(p.mech.quirk || '') && limit > 3){ limit = 3; parts.push('Удручающая тишина: не больше 3'); }
    limit = Math.max(0, limit);
    const every = Math.max(1, som), over = Math.max(0, int(p.watches) - limit);
    // бросок Отдачи на вахте limit + every, limit + 2·every…
    const due = over > 0 && over % every===0;
    const everyText = every===1 ? 'каждую вахту' : every < 5 ? `каждые ${every} вахты` : `каждые ${every} вахт`;
    return {limit, every, everyText, over, due, parts, next:over ? limit + (Math.floor(over / every) + 1) * every : limit + every};
  }

  // ---- Дары Ядра (часть 8), которые учитываются в бросках: узнаются по началу текста; повторные получения
  // складываются, если Дар это допускает. Характеристики (+1 МОТ/ЭМП/КОГ/СОМ) и Удача — только пока Спектр в Утробе.
  const GIFT_FX = [[/^Рефлекторный катализатор/, 'mot', '+1 МОТ в Утробе'], [/^Эмпатичная инкапсуляция/, 'emp', '+1 ЭМП в Утробе'],
    [/^Когнитивный субинтеллект/, 'kog', '+1 КОГ в Утробе'], [/^Соматический усилитель/, 'som', '+1 СОМ в Утробе'], [/^Второй умопоток/, 'mob', '+1 МОБ Катафракта'],
    [/^Баллистический оракул/, 'ranged', '+1 к стрелковым атакам Катафракта'], [/^Боевое программирование/, 'melee', '+1 к атакам ближнего боя Катафракта'],
    [/^Асинхронное распознавание/, 'sensors', '+1 к Сенсорам'], [/^Рациональная защита/, 'armor', '+1 к кости Брони'], [/^Эмпатический ИИ/, 'alien', 'Отчуждённость −1'],
    [/^Отбор вероятностей/, 'luck', 'Удача −1 в Утробе'], [/^Оптимизация сверхпроводников/, 'beamKr', 'кР лучевого оружия −1'],
    [/^Рекогнитивная баллистика/, 'crit19', 'крит на 19–20'], [/^Оптимизация наноструктуры/, 'sl', '+1 доступный СЛ', true]];
  const giftFx = (text)=>GIFT_FX.find(([re])=>re.test(String(text || ''))) || null;
  function gifts(p){
    const g = {}; (p.mech && Array.isArray(p.mech.giftList) ? p.mech.giftList : []).forEach(x=>{ const f = giftFx(x.text); if(f) g[f[1]] = (g[f[1]] || 0) + (x.stack || f[3] ? Math.max(1, int(x.n, 1)) : 1); });
    return g;
  }
  const gift = (p, k)=>gifts(p)[k] || 0;

  // ---- Катафракт: производные ----
  // СЛ: реактор + сенсоры + оборудование + критические повреждения (каждое занимает 1 СЛ)
  function mechSlots(p){ const m = p.mech; return reactorOf(m).sl + (int(m.sensorSl) || sensorOf(m).sl) + m.items.reduce((s, it)=>s + Math.max(0, int(it.sl)), 0) + m.crits.length; }
  function mechLoad(p){
    const sl = mechSlots(p), free = gift(p, 'sl'), points = KAVA.loadPoints(Math.max(0, sl - free)), ignore = frameOf(p.mech).ignore, eff = Math.max(0, points - ignore);
    return {sl, free, points, ignore, eff, name:KAVA.LOAD[eff], penalty:eff, krMod:eff >= 6 ? 3 : eff >= 4 ? 2 : eff >= 2 ? 1 : 0};
  }
  // МОБ Катафракта считается для Спектра в Утробе: Дары на МОТ и МОБ учитываются всегда
  function mechMob(p){
    const f = frameOf(p.mech), l = mechLoad(p), mot = stat(p, 'mot', true), g = gift(p, 'mob');
    return {total:f.mob + mot - l.penalty + int(p.mech.mobMod) + g, base:f.mob, mot, load:l.penalty, mod:int(p.mech.mobMod), gift:g};
  }
  const sensorBonus = (p)=>(int(p.mech.sensorBonus) || sensorOf(p.mech).bonus) + gift(p, 'sensors');
  const alien = (p)=>Math.max(1, coreOf(p.mech).alien - gift(p, 'alien'));
  const mechWeapons = (p)=>p.mech.items.filter(it=>it.kind==='weapon');
  const consumables = (p, key)=>p.mech.items.filter(it=>it.kind==='consumable' && (!key || it.ckey===key));
  const hasModule = (p, flag)=>p.mech.items.some(it=>it.kind==='module' && it[flag] && !it.off);
  // свободная кость расходника (первая с незачёркнутыми метками)
  const freeConsumable = (p, key)=>consumables(p, key).find(it=>int(it.marks) < 3) || null;
  function mechItemFrom(t){ const it = Object.assign({id:uid(), marks:0}, JSON.parse(JSON.stringify(t))); return it; }

  // ---- производные ----
  // inside — считать как в Утробе (по умолчанию — как отмечено в листе)
  const stat = (p, k, inside)=>int(p.stats[k]) + int(p.bonus[k]) + ((inside==null ? p.inWomb : inside) ? gift(p, k) : 0);
  function slotsUsed(p){ return p.items.reduce((s, it)=>s + Math.max(0, int(it.sl)), 0) + p.injuries.length; }
  function load(p){
    const sl = slotsUsed(p), points = KAVA.loadPoints(sl), ignore = KAVA.loadIgnore(int(p.stats.som));
    const eff = Math.max(0, points - ignore);
    return {sl, points, ignore, eff, name:KAVA.LOAD[eff], penalty:eff};
  }
  const worn = (p)=>p.items.filter(it=>it.kind==='armor' && it.worn);
  function mob(p){
    const armor = worn(p).reduce((s, it)=>s + int(it.mob), 0), l = load(p);
    return {total:10 + stat(p, 'mot') + armor - l.penalty + int(p.mobMod), base:10, mot:stat(p, 'mot'), armor, load:l.penalty, mod:int(p.mobMod)};
  }
  const stkMax = (p)=>6 + int(p.stats.som) + int(p.stkMaxMod);
  const luck = (p)=>KAVA.LUCK_BASE + int(p.scars) + int(p.luckMod) - (p.inWomb ? gift(p, 'luck') : 0);
  // кости брони надетых доспехов: [{item, dice:'2к6', left:3 - marks}]
  const armorDice = (p)=>worn(p).filter(it=>it.armor && Dice.parse(it.armor)).map(it=>({item:it, dice:it.armor, left:3 - int(it.marks)}));
  const weapons = (p)=>p.items.filter(it=>it.kind==='weapon');
  const tagList = (it)=>String(it.tags || '').split(',').map(s=>s.trim()).filter(Boolean);
  const hasTag = (it, re)=>tagList(it).some(t=>re.test(t));
  function cluster(it){ const t = tagList(it).find(x=>/^кластер/i.test(x)); const m = t && t.match(/(\d+)/); return t ? (m ? +m[1] : 99) : 0; }

  return {blank, starter, itemFrom, current, setCurrent, add, remove, all, save, fix, uid, int,
    stat, slotsUsed, load, mob, stkMax, luck, armorDice, weapons, tagList, hasTag, cluster, worn,
    blankMech, sensorOf, frameOf, reactorOf, coreOf, womb, mechSlots, mechLoad, mechMob, sensorBonus, mechWeapons, consumables, hasModule, freeConsumable, mechItemFrom,
    gifts, gift, giftFx, alien, wombLimit};
})();
