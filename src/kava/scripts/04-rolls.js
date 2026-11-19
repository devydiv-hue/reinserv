/* ======================================================================
   КАВАЛЕРИЯ — БРОСКИ ПО ПРАВИЛАМ КНИГИ и журнал. Каждый бросок — запись журнала:
   {who, kind, title, tone ok|fail|crit|heat|info, big (крупное число), verdict, lines (подробности), dice (для 3D-костей:
   [{sides, value, label, tint, dim}]), fx (overheat, boom, nat20, nat1, collapse — для сцен)}.
   Спектр: проверка к20 + характеристика ≥ сложности (вне боя — Удача, 13); атака ≥ МОБ цели (СОМ — ближний,
   МОТ — кинетическое, КОГ — лучевое и ракетное); 20 — автоуспех и критическая травма цели, 1 — провал.
   Катафракт: к атаке кинетическим и ракетным можно добавить кость боеприпасов (к6 расходника), лучевым и ближним —
   кР (кость реактора растёт на степень при 4+, при итоге 7+ — перегрев). Урон: броня-расходник вычитается,
   при 0 СТК каждое попадание — критическое повреждение (занимает 1 СЛ). Броня Спектра 2к6/3к6 — по 3 метки на кость.
   Журнал — reincarnator_kava_log_v1 (последние 200 записей).
   ====================================================================== */
const Rolls = (function(){
  const LOG_KEY = 'reincarnator_kava_log_v1';
  let log = [];
  try{ log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; }catch(e){}
  const listeners = [];
  const int = (v, d)=>Pilot.int(v, d);
  function push(e){
    e = Object.assign({id:Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t:Date.now()}, e);
    log.push(e); if(log.length > 200) log = log.slice(-200);
    try{ localStorage.setItem(LOG_KEY, JSON.stringify(log)); }catch(err){}
    listeners.forEach(f=>{ try{ f(e); }catch(err){ console.error(err); } });
    return e;
  }
  function clear(){ log = []; try{ localStorage.removeItem(LOG_KEY); }catch(e){} listeners.forEach(f=>f(null)); }
  const onLog = (f)=>listeners.push(f);
  const who = (p)=>p && p.name ? p.name : 'Спектр';
  const sgn = (n)=>(n >= 0 ? '+ ' : '− ') + Math.abs(n);
  const MODE = {norm:'', adv:' с преимуществом', dis:' с препятствием'};
  // преимущество и препятствие гасят друг друга
  const combine = (mode, obstacle)=>obstacle ? (mode==='adv' ? 'norm' : 'dis') : mode;
  const d20Text = (r)=>`к20${MODE[r.mode] || ''}: ${r.rolls.length > 1 ? `[${r.rolls.join(', ')}] → ${r.nat}` : `[${r.nat}]`}${r.bonus ? ' ' + sgn(r.bonus) : ''} = ${r.total}`;
  // кости к20 для анимации: при 2к20 невыбранная — тусклая
  function d20Dice(r, label){
    const tint = r.auto==='success' ? 'good' : r.auto==='fail' ? 'bad' : '';
    if(r.rolls.length < 2) return [{sides:20, value:r.nat, label, tint}];
    let used = false;
    return r.rolls.map(v=>{ const pick = !used && v===r.nat; if(pick) used = true; return {sides:20, value:v, label, tint:pick ? tint : '', dim:!pick}; });
  }
  const sumDice = (roll, label, max)=>roll && roll.dice ? roll.dice.slice(0, max || 6).map(v=>({sides:roll.max || 6, value:v, label})) : [];
  const verdictOf = (r)=>r.auto==='success' ? 'Автоуспех · 20' : r.auto==='fail' ? 'Провал · 1' : r.ok ? 'Успех' : 'Неудача';
  const fxOf = (r)=>r.auto==='success' ? {nat20:true} : r.auto==='fail' ? {nat1:true} : null;

  // ---------- Спектр ----------
  function check(p, key, dc, mode, extra){
    const s = KAVA.STATS.find(x=>x.key===key), bonus = Pilot.stat(p, key) + (extra || 0), r = Dice.check(bonus, dc, mode);
    return push({who:who(p), kind:'check', title:`Проверка ${s.short}`, tone:r.ok ? 'ok' : 'fail', big:r.total, verdict:verdictOf(r) + ` (сложность ${dc})`,
      lines:[d20Text(r) + ` (${s.short} ${Pilot.stat(p, key)}${extra ? ', бонус ' + extra : ''}) против ${dc}`].concat(giftNote(p, key)), dice:d20Dice(r), fx:fxOf(r)});
  }
  // Дар Ядра, учтённый в характеристике (только в Утробе)
  const giftNote = (p, key, inside)=>(inside || p.inWomb) && Pilot.gift(p, key) ? [`Дар Ядра: +${Pilot.gift(p, key)} ${KAVA.STATS.find(x=>x.key===key).short} в Утробе — уже в бонусе`] : [];
  function luck(p, mode){
    const dc = Pilot.luck(p), r = Dice.check(0, dc, mode);
    return push({who:who(p), kind:'luck', title:'Испытание Удачи', tone:r.ok ? 'ok' : 'fail', big:r.total, verdict:(r.ok ? 'Худшего удалось избежать' : 'Провал') + ` (сложность ${dc})`,
      lines:[d20Text(r) + ` против ${dc}`].concat(p.inWomb && Pilot.gift(p, 'luck') ? [`Дар Ядра «Отбор вероятностей»: сложность −${Pilot.gift(p, 'luck')} в Катафракте`] : []), dice:d20Dice(r), fx:fxOf(r)});
  }
  // испытание Отчуждённости / выход из погружения: к20 + ЭМП против Отчуждённости Ядра (+ Измерение)
  function alienation(p, depth, mode){
    const dc = Pilot.alien(p) + int(depth), r = Dice.check(Pilot.stat(p, 'emp', true), dc, mode);
    return push({who:who(p), kind:'alien', title:depth ? `Выход из погружения (Измерение ${depth})` : 'Испытание Отчуждённости', tone:r.ok ? 'ok' : 'fail', big:r.total,
      verdict:(r.ok ? 'Успех' : depth ? 'Выход с Отдачей' : 'Провал') + ` (Отчуждённость ${dc})`, lines:[d20Text(r) + ` (ЭМП) против ${dc}`, 'Выход из погружения сбрасывает кС до начального значения.'].concat(Pilot.gift(p, 'alien') ? [`Дар Ядра «Эмпатический ИИ»: Отчуждённость −${Pilot.gift(p, 'alien')}`] : [], giftNote(p, 'emp', true)), dice:d20Dice(r), fx:fxOf(r)});
  }
  function damageOf(w){ return Dice.roll(w.dmg || '1', {cascade:Pilot.hasTag(w, /^каскад/i)}) || {total:0, dice:[], text:'вред не задан'}; }
  // одна атака (Спектра или Катафракта). bonusDice — добавочные кости к атаке (боеприпасы, кР)
  function strike(p, w, mob, mode, extra, addLines, scaleMul, crit19, mech){
    const bonus = Pilot.stat(p, w.stat || 'mot', mech || undefined) + (extra || 0), r = Dice.check(bonus, mob, mode);
    const out = {w, r, hit:r.ok, dice:d20Dice(r, 'атака'), lines:[`${w.name}: ${d20Text(r)} против МОБ ${mob} — ${r.auto==='success' ? 'автопопадание (20)' : r.auto==='fail' ? 'промах (1)' : r.ok ? 'попадание' : 'промах'}`].concat(addLines || [])};
    if(!r.ok) return out;
    const dmg = damageOf(w), n = Pilot.cluster(w);
    let total = dmg.total;
    out.lines.push(`Вред ${dmg.text}`); out.dice = out.dice.concat(sumDice(dmg, 'вред', 5));
    if(n){ const hits = Math.max(1, Math.min(n, r.total - mob)); total = dmg.total * hits; out.lines.push(`Кластер${n < 99 ? '/' + n : ''}: попаданий ${hits} (${r.total} − ${mob}) → ${dmg.total} × ${hits} = ${total}`); }
    if(scaleMul > 1){ total *= scaleMul; out.lines.push(`Катафракт по цели персонального масштаба: × ${scaleMul} = ${total}`); }
    out.dmg = total;
    const spec = Dice.parse(w.dmg) || {}, max = dmg.max && dmg.dice.slice(0, spec.n || 1).some(v=>v===dmg.max);
    if(max && w.onMax) out.lines.push('Максимальный вред: ' + w.onMax);
    if(Pilot.hasTag(w, /^бронебойн/i)) out.lines.push('Бронебойное: броня цели учитывает половину своего броска');
    if(Pilot.hasTag(w, /^термо/i)) out.lines.push('Термо: цель делает бросок кР');
    if(Pilot.hasTag(w, /^зона/i)) out.lines.push('Зона: поражает все цели в Зоне попадания');
    if(w.crit5 && r.total >= mob + 5) out.lines.push('На 5 выше МОБ цели — атака критическая');
    if(r.auto==='success') out.lines.push('20 — цель получает Критическую травму (или Критическое повреждение)');
    else if(crit19 && r.nat===19){ out.crit = true; out.lines.push('19 — критическое попадание (Дар «Рекогнитивная баллистика»): Критическая травма или Критическое повреждение'); }
    return out;
  }
  // opts: {mob, mode, extra, contact, outOfRange, mech:true — оружие Катафракта, ammo — добавить кость боеприпасов, kr — добавить кР, personal — цель персонального масштаба}
  function attack(p, ids, opts){
    const mech = !!opts.mech, list = mech ? p.mech.items : p.items;
    const ws = ids.map(id=>list.find(it=>it.id===id)).filter(Boolean);
    if(!ws.length) return null;
    const mob = int(opts.mob, 10), extra = int(opts.extra), res = [], pre = [], preDice = [];
    let heat = null;
    ws.forEach((w, i)=>{
      const ranged = w.range && w.range!=='⁕';
      const obstacle = !!opts.outOfRange || (opts.contact && ranged && !Pilot.hasTag(w, /^л[её]гкое/i));
      let add = mech ? 0 : (ranged ? int(p.atkRanged) : int(p.atkMelee));
      const lines = [];
      if(mech){ const g = Pilot.gift(p, ranged ? 'ranged' : 'melee'); if(g){ add += g; lines.push(`Дар Ядра: +${g} к ${ranged ? 'стрелковой атаке' : 'атаке ближнего боя'}`); } }
      if(mech && opts.ammo && (w.type==='kinetic' || w.type==='missile')){
        const a = useConsumable(p, 'ammo', Pilot.hasModule(p, 'ammo5') ? 5 : 4);
        if(a){ add += a.value; lines.push(`Боеприпасы: к6 [${a.value}] → +${a.value}${a.spent ? `, метка (${a.item.marks}/3)` : ''}${a.empty ? ` — блок исчерпан, осталось выстрелов: ${a.value}` : ''}`); preDice.push({sides:6, value:a.value, label:'боеприп.'}); }
        else lines.push('Боеприпасов нет — кость не добавлена');
      }
      if(mech && opts.kr && (w.type==='beam' || w.type==='melee') && i===0){
        heat = reactor(p, w.type==='beam' ? 'energy' : 'strike', {silent:true});
        add += heat.value; lines.push(`кР ${heat.text} → +${heat.value} к атаке`); preDice.push({sides:heat.sides, value:heat.value, label:'кР', tint:heat.overheat ? 'heat' : ''});
        if(heat.lines.length) lines.push(...heat.lines);
      }
      const x = strike(p, w, mob, combine(opts.mode, obstacle), extra + add, lines, mech && opts.personal ? 10 : 1, mech && Pilot.gift(p, 'crit19') > 0, mech);
      if(obstacle) x.lines[0] += ' · препятствие';
      res.push(x);
    });
    const hits = res.filter(x=>x.hit), lines = [];
    res.forEach(x=>lines.push(...x.lines));
    let big, verdict, tone;
    if(ws.length===1){ const x = res[0]; big = x.hit ? x.dmg : x.r.total; verdict = x.hit ? `Попадание: ${x.dmg} урона` : `Промах (${x.r.total} против МОБ ${mob})`; tone = x.hit ? (x.r.auto==='success' || x.crit ? 'crit' : 'ok') : 'fail'; }
    else if(!hits.length){ big = '—'; verdict = 'Залп: все промахнулись'; tone = 'fail'; }
    else {
      const top = Math.max(...hits.map(x=>x.dmg)), same = hits.filter(x=>x.dmg===top).length;
      big = same > 1 ? top * 2 : top; verdict = same > 1 ? `Залп: наибольший вред ${top} совпал у ${same} — удвоение` : `Залп: наибольший вред ${top}`; tone = hits.some(x=>x.r.auto==='success' || x.crit) ? 'crit' : 'ok';
    }
    if(heat && heat.overheat) tone = 'heat';
    const dice = preDice.concat(...res.map(x=>x.dice)).slice(0, 8);
    Pilot.save();
    return push({who:who(p), kind:'attack', title:(ws.length > 1 ? 'Залп' : 'Атака: ' + ws[0].name) + (mech ? ' · Катафракт' : ''), tone, big, verdict, lines, dice,
      dmg:typeof big==='number' && tone!=='fail' ? big : 0, fx:Object.assign({}, res.length===1 ? fxOf(res[0].r) : null, heat && heat.fx)});
  }
  // Боевой маневр: атака с препятствием без урона — оба броска к20 против МОБ
  function maneuver(p, id, opts){
    const w = (opts.mech ? p.mech.items : p.items).find(it=>it.id===id); if(!w) return null;
    const ranged = w.range && w.range!=='⁕', g = opts.mech ? Pilot.gift(p, ranged ? 'ranged' : 'melee') : 0;
    const mob = int(opts.mob, 10), bonus = Pilot.stat(p, w.stat || 'som', opts.mech || undefined) + int(opts.extra) + g, a = Dice.rnd(20), b = Dice.rnd(20);
    const ok = (v)=>v===20 || (v!==1 && v + bonus >= mob), n = [a, b].filter(ok).length;
    return push({who:who(p), kind:'maneuver', title:'Боевой маневр', tone:n===2 ? 'ok' : n ? 'info' : 'fail', big:n + ' из 2',
      verdict:n===2 ? 'Маневр удался' : n ? 'Удался, но противник контратакует' : 'Маневр не удался',
      lines:[`${w.name}: 2к20 [${a}, ${b}] ${sgn(bonus)} → ${a + bonus} и ${b + bonus} против МОБ ${mob}`].concat(g ? [`Дар Ядра: +${g} к атаке`] : []), dice:[{sides:20, value:a, label:'1', tint:ok(a) ? 'good' : 'bad'}, {sides:20, value:b, label:'2', tint:ok(b) ? 'good' : 'bad'}]});
  }
  // урон по Спектру: кости брони надетых доспехов, СТК
  function takeDamage(p, dmg, opts){
    dmg = Math.max(0, int(dmg)); opts = opts || {};
    const lines = [`Урон ${dmg}`], dice = []; let armorSum = 0;
    if(!opts.noArmor) Pilot.armorDice(p).forEach(({item})=>{
      const spec = Dice.parse(item.armor); if(!spec || spec.kind!=='sum') return;
      const marks = int(item.marks), alive = Math.max(0, spec.n - Math.floor(marks / 3));
      if(!alive){ lines.push(`${item.name}: броня исчерпана`); return; }
      const ds = []; for(let i = 0; i < alive; i++) ds.push(Dice.d(spec.sides));
      const sum = ds.reduce((a, b)=>a + b, 0), spent = ds.filter(v=>v >= 4).length;
      item.marks = Math.min(spec.n * 3, marks + spent); armorSum += sum;
      ds.forEach(v=>dice.push({sides:spec.sides, value:v, label:'броня'}));
      lines.push(`${item.name}: ${alive}к${spec.sides} [${ds.join(', ')}] = ${sum}${spent ? `, метки кВ +${spent} (${item.marks}/${spec.n * 3})` : ''}`);
    });
    let block = armorSum;
    if(opts.pierce && armorSum){ block = Math.floor(armorSum / 2); lines.push(`Бронебойное: броня учитывает половину — ${block}`); }
    const reduce = int(opts.reduce), taken = Math.max(0, dmg - block - reduce);
    if(reduce) lines.push(`Снижение урона −${reduce}`);
    const before = int(p.stk); p.stk = before - taken; lines.push(`СТК Спектра: ${before} → ${p.stk}`);
    const down = p.stk <= 0;
    if(down) lines.push(`0 СТК: Спектр без сознания и умирает через ${int(p.stats.som)} раунд(ов) (СОМ) без помощи или от повторного повреждения. Можно взять случайную Травму и избежать смерти.`);
    Pilot.save();
    return push({who:who(p), kind:'damage', title:'Урон по Спектру', tone:down ? 'crit' : taken ? 'fail' : 'ok', big:'−' + taken, verdict:down ? 'Без сознания' : `СТК ${p.stk} из ${Pilot.stkMax(p)}`, lines, dice, down});
  }
  function scar(p){
    const v = Dice.rnd(20), text = KAVA.CRIT_INJURIES[v - 1];
    p.injuries.push({id:Pilot.uid(), text:`${v}. ${text}`}); p.scars = int(p.scars) + 1;
    if(int(p.stk) < 1) p.stk = 1;
    Pilot.save();
    return push({who:who(p), kind:'scar', title:'Травма вместо смерти', tone:'crit', big:v, verdict:text, lines:[`Сложность Испытания Удачи теперь ${Pilot.luck(p)}; травма занимает 1 СЛ`], dice:[{sides:20, value:v, tint:'bad'}]});
  }
  function crit(p){
    const v = Dice.rnd(20);
    return push({who:who(p), kind:'crit', title:'Критическая травма', tone:'crit', big:v, verdict:KAVA.CRIT_INJURIES[v - 1], lines:[], dice:[{sides:20, value:v, tint:'bad'}]});
  }
  // кость расхода предмета Спектра: к6, метка на 4+
  const itemCap = (it)=>{ const s = it.kind==='armor' && it.armor ? Dice.parse(it.armor) : null; return s && s.kind==='sum' ? s.n * 3 : 3; };
  function kv(p, id, mech){
    const it = (mech ? p.mech.items : p.items).find(x=>x.id===id); if(!it) return null;
    const cap = itemCap(it), before = int(it.marks);
    if(before >= cap) return push({who:who(p), kind:'kv', title:it.name, tone:'fail', big:'0', verdict:'Ресурс закончился', lines:['Все метки уже зачёркнуты']});
    const v = Dice.rnd(6), spent = v >= 4;
    if(spent) it.marks = before + 1;
    Pilot.save();
    return push({who:who(p), kind:'kv', title:'Расход: ' + it.name, tone:spent ? (it.marks >= cap ? 'fail' : 'info') : 'ok', big:v,
      verdict:it.marks >= cap ? 'Ресурс закончился' : spent ? `Метка зачёркнута (${it.marks}/${cap})` : 'Без расхода', lines:[], dice:[{sides:6, value:v, tint:spent ? 'bad' : 'good'}]});
  }
  function reload(p, id, crew){
    const it = p.items.find(x=>x.id===id) || p.mech.items.find(x=>x.id===id); if(!it) return null;
    crew = Math.max(1, int(crew, it.crew || 1)); const v = Dice.rnd(6), ok = v <= crew;
    return push({who:who(p), kind:'reload', title:'Перезарядка: ' + it.name, tone:ok ? 'ok' : 'fail', big:v, verdict:ok ? 'Готово к выстрелу в следующем раунде' : 'Перезарядка не удалась',
      lines:[`к6: [${v}] ${ok ? '≤' : '>'} экипаж ${crew}`], dice:[{sides:6, value:v}]});
  }

  // ---------- синхронизация ----------
  function connect(p){
    const v = Dice.rnd(p.ks), ok = v >= 4;
    return push({who:who(p), kind:'connect', title:'Подключение к Катафракту', tone:ok ? 'ok' : 'fail', big:v, verdict:ok ? 'Соединение установлено' : 'Не удалось — повторить в следующем раунде',
      lines:[`кС к${p.ks}: [${v}] ${ok ? '≥' : '<'} 4. Подключение и отключение длятся один раунд.`], dice:[{sides:p.ks, value:v, label:'кС', tint:ok ? 'good' : 'bad'}]});
  }
  function backlash(p, overtime){
    overtime = Math.max(0, int(overtime));
    const v = Dice.rnd(p.ks), total = v + overtime, row = Dice.pick(KAVA.BACKLASH, total);
    const lines = [`кС к${p.ks}: [${v}]${overtime ? ` + ${overtime} (сверхурочные вахты)` : ''} = ${total}`];
    if(p.ritual) lines.push('Ритуал декомпрессии до наступления эффекта преодолевает его: ' + p.ritual);
    return push({who:who(p), kind:'backlash', title:'Отдача', tone:total >= 11 ? 'crit' : 'fail', big:total, verdict:row ? row.text : '—', lines,
      dice:[{sides:p.ks, value:v, label:'кС', tint:'bad'}], fx:total >= 12 ? {collapse:true} : null});
  }
  function syncGrowth(p, extra){
    extra = Math.max(0, Math.min(3, int(extra)));
    const ds = []; for(let i = 0; i <= extra; i++) ds.push(Dice.rnd(p.ks));
    const best = Math.max(...ds), bonus = int(p.ksBonus), total = best + bonus, before = p.ks, grow = total >= p.ks && p.ks < 12;
    const lines = [`кС к${before}${extra ? ` с преимуществом ×${extra}` : ''}: [${ds.join(', ')}]${extra ? ' → ' + best : ''}${bonus ? ` + ${bonus} (накоплено)` : ''} = ${total}`];
    if(grow){ p.ks = Dice.stepUp(p.ks); p.ksBonus = 0; } else if(p.ks < 12) p.ksBonus = bonus + 1;
    if(extra && ds.some(v=>v===1)) lines.push('Выпала «1» при Пожирании — Испытание Удачи, иначе смерть от перегрузки');
    Pilot.save();
    return push({who:who(p), kind:'sync', title:'Рост синхронизации', tone:grow ? 'ok' : 'info', big:'к' + p.ks,
      verdict:before >= 12 ? 'кС уже к12' : grow ? `кС растёт: к${before} → к${p.ks}` : `кС к${p.ks}, +${p.ksBonus} к следующему броску роста`, lines,
      dice:ds.map(v=>({sides:before, value:v, label:'кС', dim:v!==best}))});
  }

  // ---------- Катафракт: реактор ----------
  // Бросок кР: кость растёт на степень при 4+ (5+ с Изоляцией реактора); итог (с нагрузкой и реактором) 7+ — перегрев.
  // use: forsage | energy | strike | module | scout | dread | thermo. opts.silent — не писать отдельную запись (часть атаки).
  function reactor(p, use, opts){
    opts = opts || {}; const m = p.mech, sides = +m.kr || 6, L = Pilot.mechLoad(p), R = Pilot.reactorOf(m);
    const adv = use==='thermo' && Pilot.hasModule(p, 'thermoAdv');
    const ds = [Dice.rnd(sides)]; if(adv) ds.push(Dice.rnd(sides));
    const value = adv ? Math.min(...ds) : ds[0];
    const need = Pilot.hasModule(p, 'reactor5') ? 5 : 4, grow = value >= need && sides < 12;
    const gb = use==='energy' ? Pilot.gift(p, 'beamKr') : 0, mod = L.krMod + R.krMod - gb, total = value + mod;
    const row = total >= 7 ? Dice.pick(MECH.OVERHEAT, total) : null;
    if(grow) m.kr = Dice.stepUp(sides);
    const lines = [];
    if(mod) lines.push(`кР к${sides}: [${ds.join(', ')}]${adv ? ' → ' + value + ' (Термостабилизатор)' : ''} ${mod > 0 ? '+ ' + mod : '− ' + (-mod)} (${[L.krMod ? 'нагрузка +' + L.krMod : '', R.krMod ? 'реактор ' + R.krMod : '', gb ? 'Дар −' + gb : ''].filter(Boolean).join(', ')}) = ${total}`);
    if(grow) lines.push(`Выпало ${value} ≥ ${need}: кР растёт к${sides} → к${m.kr}`);
    let fx = null;
    if(row){
      lines.push(`Перегрев (${total}): ${row.text}`);
      fx = {overheat:total, boom:!!row.boom};
      if(total===12){ m.explode = Math.max(1, int(m.explode) + 1); lines.push(`Шанс взрыва теперь ${m.explode}-з-6 — растёт на +1 за раунд использования реактора`); }
      if(row.boom && R.key==='heavy') lines.push('Тяжёлый коллапсар: эффект взрыва игнорируется при успешном Испытании Удачи');
    }
    Pilot.save();
    const res = {value, total, sides, grow, overheat:row, fx, lines, text:`к${sides} [${ds.join(', ')}]`};
    if(opts.silent) return res;
    const use1 = MECH.KR_USES.find(u=>u.key===use);
    const title = use1 ? 'кР: ' + use1.name : use==='scout' ? 'кР: рывок Скаута' : use==='dread' ? 'кР: ремонт Дредноута' : use==='thermo' ? 'кР от Термо' : 'Бросок кР';
    return Object.assign(res, {entry:push({who:who(p), kind:'reactor', title, tone:row ? 'heat' : grow ? 'info' : 'ok', big:total, verdict:row ? 'Перегрев: ' + row.text : grow ? `кР растёт до к${m.kr}` : `кР остаётся к${m.kr}`,
      lines:lines.length ? lines : [`кР к${sides}: [${value}]`], dice:ds.map(v=>({sides, value:v, label:'кР', tint:row ? 'heat' : '', dim:adv && v!==value})), fx})});
  }
  // рывок Скаута (+кР к МОБ на один ход) и ремонт Дредноута (+кР к СТК)
  function frameAbility(p){
    const f = Pilot.frameOf(p.mech);
    if(f.fast){ const r = reactor(p, 'scout'); r.entry.verdict = `МОБ +${r.value} на один ход` + (r.overheat ? ' · перегрев: ' + r.overheat.text : ''); return r.entry; }
    if(f.slow){ const r = reactor(p, 'dread'), m = p.mech, before = int(m.stk); m.stk = Math.min(int(m.stkMax), before + r.value); Pilot.save();
      r.entry.verdict = `СТК ${before} → ${m.stk}` + (r.overheat ? ' · перегрев: ' + r.overheat.text : ''); return r.entry; }
    return null;
  }
  function cool(p, full){
    const m = p.mech, before = m.kr;
    if(full){ m.kr = 6; m.explode = 0; Pilot.save(); return push({who:who(p), kind:'reactor', title:'Реактор остыл', tone:'ok', big:'к6', verdict:`Вахта без нагрузки: к${before} → к6`, lines:[]}); }
    const a = useConsumable(p, 'radiator', 4);
    if(!a) return push({who:who(p), kind:'reactor', title:'Радиаторы', tone:'fail', big:'—', verdict:'Нет Радиаторов с незачёркнутыми метками', lines:[]});
    m.kr = Math.max(6, Dice.STEPS[Dice.STEPS.indexOf(+m.kr) - 1] || 6); Pilot.save();
    return push({who:who(p), kind:'reactor', title:'Радиаторы', tone:'ok', big:'к' + m.kr, verdict:`кР снижен: к${before} → к${m.kr}`, lines:[`Расходник: к6 [${a.value}]${a.spent ? `, метка (${a.item.marks}/3)` : ''}`], dice:[{sides:6, value:a.value, label:'радиат.'}]});
  }
  // расходник Катафракта: бросок к6, метка на need+ → {item, value, spent, empty}
  function useConsumable(p, key, need){
    const it = Pilot.freeConsumable(p, key); if(!it) return null;
    const v = Dice.rnd(6), spent = v >= (need || 4);
    if(spent) it.marks = int(it.marks) + 1;
    return {item:it, value:v, spent, empty:int(it.marks) >= 3};
  }
  function repairKit(p){
    const a = useConsumable(p, 'repair', 4), m = p.mech;
    if(!a) return push({who:who(p), kind:'repair', title:'Ремкассеты', tone:'fail', big:'—', verdict:'Нет Ремкассет с незачёркнутыми метками', lines:[]});
    const before = int(m.stk); m.stk = Math.min(int(m.stkMax), before + a.value); Pilot.save();
    return push({who:who(p), kind:'repair', title:'Ремкассеты', tone:'ok', big:'+' + (m.stk - before), verdict:`СТК Катафракта ${before} → ${m.stk}`, lines:[`к6 [${a.value}]${a.spent ? `, метка (${a.item.marks}/3)` : ''}`], dice:[{sides:6, value:a.value, label:'ремкасс.', tint:'good'}]});
  }
  // урон по Катафракту: opts {pierce, armor — бросить Броню, shield — штурмовой щит, personal — урон от персонального оружия (только Тяжёлое)}
  function mechDamage(p, dmg, opts){
    dmg = Math.max(0, int(dmg)); opts = opts || {}; const m = p.mech, lines = [`Урон ${dmg}`], dice = [];
    if(opts.shield){
      const sh = m.items.find(it=>it.kind==='module' && it.shield && !it.used && !it.off);
      if(sh){ sh.used = true; Pilot.save(); return push({who:who(p), kind:'mdamage', title:'Урон по Катафракту', tone:'ok', big:'0', verdict:'Атака проигнорирована штурмовым щитом', lines:[`${sh.name}: использован (восстанавливается обслуживанием)`]}); }
      lines.push('Свободного штурмового щита нет');
    }
    if(opts.pierce && dmg % 2===1 && m.items.some(it=>it.kind==='module' && /углесеточ/i.test(it.name) && !it.off)){
      return push({who:who(p), kind:'mdamage', title:'Урон по Катафракту', tone:'ok', big:'0', verdict:'Углесеточные щиты: нечётный бронебойный вред полностью проигнорирован', lines});
    }
    let block = 0;
    if(opts.armor){
      const a = useConsumable(p, 'armor', 4);
      if(a){ const g = Pilot.gift(p, 'armor'), v = a.value + g; block = opts.pierce ? Math.floor(v / 2) : v; dice.push({sides:6, value:a.value, label:'броня'});
        lines.push(`Броня: к6 [${a.value}]${g ? ` + ${g} (Дар) = ${v}` : ''}${opts.pierce ? ` → половина ${block} (Бронебойное)` : ''}${a.spent ? `, метка (${a.item.marks}/3)` : ''}`); }
      else lines.push('Брони с незачёркнутыми метками нет');
    }
    const taken = Math.max(0, dmg - block), before = int(m.stk);
    let crit = null;
    if(before <= 0 && taken > 0){
      const v = Dice.rnd(20); crit = MECH.CRITS[v - 1]; m.crits.push({id:Pilot.uid(), text:`${v}. ${crit}`}); dice.push({sides:20, value:v, label:'крит', tint:'bad'});
      lines.push(`СТК уже 0 — Критическое повреждение (к20 = ${v}): ${crit}`, 'Повреждение занимает 1 СЛ и отключает модуль в этом слоте.');
    } else {
      m.stk = before - taken; lines.push(`СТК Катафракта: ${before} → ${Math.max(0, m.stk)}`);
      if(m.stk <= 0){ m.stk = 0; lines.push('0 СТК: Катафракт может продолжать бой, но каждое новое попадание — Критическое повреждение.'); }
    }
    Pilot.save();
    return push({who:who(p), kind:'mdamage', title:'Урон по Катафракту', tone:crit ? 'crit' : taken ? 'fail' : 'ok', big:crit ? 'КРИТ' : '−' + taken, verdict:crit || `СТК ${m.stk} из ${m.stkMax}`, lines, dice});
  }
  function mechCrit(p){
    const v = Dice.rnd(20), t = MECH.CRITS[v - 1]; p.mech.crits.push({id:Pilot.uid(), text:`${v}. ${t}`}); Pilot.save();
    return push({who:who(p), kind:'mcrit', title:'Критическое повреждение', tone:'crit', big:v, verdict:t, lines:['Занимает 1 СЛ и отключает модуль в этом слоте.'], dice:[{sides:20, value:v, tint:'bad'}], fx:v===20 ? {boom:true} : null});
  }
  function sensors(p, dc, mode){
    const b = Pilot.sensorBonus(p), r = Dice.check(b, dc, mode);
    return push({who:who(p), kind:'sensors', title:'Проверка Сенсоров', tone:r.ok ? 'ok' : 'fail', big:r.total, verdict:verdictOf(r) + ` (сложность ${dc})`,
      lines:[d20Text(r) + ` (Сенсоры +${b}) против ${dc}`], dice:d20Dice(r), fx:fxOf(r)});
  }
  function moduleUse(p, id){
    const it = p.mech.items.find(x=>x.id===id); if(!it) return null;
    if(it.kv) return kv(p, id, true);
    const r = reactor(p, 'module', {silent:true});
    return push({who:who(p), kind:'reactor', title:'Модуль: ' + it.name, tone:r.overheat ? 'heat' : 'info', big:r.value,
      verdict:(it.mobKr ? `МОБ +${r.value} в момент использования` : 'Модуль активирован') + (r.overheat ? ' · перегрев: ' + r.overheat.text : ''),
      lines:[`кР ${r.text}`].concat(r.lines, [it.text || '']), dice:[{sides:r.sides, value:r.value, label:'кР', tint:r.overheat ? 'heat' : ''}], fx:r.fx});
  }

  // ---------- прочие броски книги ----------
  function reaction(mod){
    mod = int(mod); const r = Dice.roll('2к6'), v = Math.max(2, Math.min(12, r.total + mod)), row = Dice.pick(KAVA.REACTION, v);
    return push({kind:'reaction', title:'Бросок реакции', tone:'info', big:r.total + mod, verdict:row.text, lines:[`${r.text}${mod ? ' ' + sgn(mod) + ' = ' + (r.total + mod) : ''}`], dice:sumDice(r, '')});
  }
  function fame(p, dc, mode){
    const n = int(p.campaigns), r = Dice.check(n, dc, mode);
    return push({who:who(p), kind:'fame', title:'Слава', tone:r.ok ? 'ok' : 'fail', big:r.total, verdict:r.ok ? 'Слава опередила Спектров' : 'О них здесь не слышали', lines:[d20Text(r) + ` (походов: ${n}) против ${dc}`], dice:d20Dice(r)});
  }
  function morale(value){
    value = int(value, 7); const r = Dice.roll('2к6'), fail = r.total > value;
    return push({kind:'morale', title:'Боевой дух', tone:fail ? 'fail' : 'ok', big:r.total, verdict:fail ? 'Провал — отступает' : 'Держится', lines:[`${r.text} против Боевого Духа ${value}`], dice:sumDice(r, '')});
  }
  function initiative(label){ const v = Dice.rnd(6); return push({kind:'init', title:'Инициатива' + (label ? ': ' + label : ''), tone:'info', big:v, verdict:'Стороны действуют от большего к меньшему', lines:[], dice:[{sides:6, value:v}]}); }
  function trade(cls, mod){
    const t = KAVA.TRADE.find(x=>x.key===cls) || KAVA.TRADE[0]; mod = int(mod); const r = Dice.roll(t.dice);
    return push({kind:'trade', title:'Торги: ' + t.name, tone:'info', big:r.total + mod, verdict:'Итог торгов', lines:[`${r.text}${mod ? ' ' + sgn(mod) + ' = ' + (r.total + mod) : ''}`], dice:sumDice(r, '')});
  }
  function chance(x){
    x = Math.max(1, Math.min(6, int(x, 1))); const r = Dice.roll(x + '-з-6');
    return push({kind:'chance', title:`Шанс ${x}-з-6`, tone:r.ok ? 'ok' : 'fail', big:r.total, verdict:r.ok ? 'Случилось' : 'Не случилось', lines:[r.text], dice:[{sides:6, value:r.total, tint:r.ok ? 'good' : 'bad'}]});
  }
  function free(formula, label){
    const r = Dice.roll(formula);
    if(!r) return push({kind:'free', title:'Бросок', tone:'fail', big:'?', verdict:`Не понял запись «${formula}»`, lines:['Примеры: к20, 2к6+1, 3к4, к66, к100, к3, 2-з-6']});
    const p = Dice.parse(formula), dice = p.kind==='d66' ? r.dice.map(v=>({sides:6, value:v})) : p.kind==='d100' ? r.dice.map(v=>({sides:10, value:v || 10})) : p.kind==='sum' ? r.dice.slice(0, 8).map(v=>({sides:p.sides, value:v})) : [];
    return push({kind:'free', title:label || 'Бросок ' + formula, tone:'info', big:r.total, verdict:r.text, lines:[], dice});
  }
  return {check, luck, alienation, attack, maneuver, takeDamage, scar, crit, kv, itemCap, reload, connect, backlash, syncGrowth,
    reactor, frameAbility, cool, repairKit, mechDamage, mechCrit, sensors, moduleUse, useConsumable,
    reaction, fame, morale, initiative, trade, chance, free, push, clear, onLog, get log(){ return log; }};
})();
