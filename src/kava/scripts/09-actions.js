/* ======================================================================
   КАВАЛЕРИЯ — ДЕЙСТВИЯ: всё, что запускается с листа (data-a). Короткие действия бросают сразу (проверка
   характеристики, Удача, кость расхода); действия с выбором открывают карточку только с нужным: атака (цель, залп,
   боеприпасы, кР, вплотную), урон по Спектру или Катафракту, реактор, синхронизация, предмет, модуль, расходник,
   броски по таблицам книги. Каждый бросок → Fx.play (3D-кости и итог) → перерисовка листа → стол (если подключён).
   Сложность и режим к20 (преимущество/препятствие) берутся из панели над листом; режим действует на один бросок.
   ====================================================================== */
const Actions = (function(){
  const int = (v, d)=>Pilot.int(v, d), esc = kvEsc;
  let lastMob = 10;
  try{ lastMob = int(JSON.parse(localStorage.getItem('reincarnator_kava_app_v1') || '{}').tmob, 10); }catch(e){}
  // итог броска: анимация, перерисовка, рассылка на стол
  function done(e, keepSheet){
    if(!e) return;
    if(!keepSheet) UI.close();
    Fx.play(e);
    Tandem.render();
    if(typeof Table!=='undefined'){ Table.rolled(e); Table.pilotChanged(); }
  }
  const d20 = ()=>App.useMode();
  const modeChips = ()=>`<div class="kv-chips2" data-chips="one">${UI.chip('norm', 'Обычный', App.mode()==='norm')}${UI.chip('adv', 'Преимущество', App.mode()==='adv', '2к20, больший')}${UI.chip('dis', 'Препятствие', App.mode()==='dis', '2к20, меньший')}</div>`;
  const pickMode = (panel)=>{ const c = panel.querySelector('[data-chips="one"] .on'); return c ? c.dataset.chip : 'norm'; };

  // ---------- атака ----------
  function attackSheet(p, side, id, targetId){
    const mech = side==='m', list = mech ? Pilot.mechWeapons(p) : Pilot.weapons(p), w = list.find(x=>x.id===id); if(!w) return;
    // цели из боя: МОБ (+3 за укрытие против дальнобойного), дистанция, масштаб
    const tg = typeof Battle!=='undefined' ? Battle.targets() : [], ranged = w.range && w.range!=='⁕', heavy = Pilot.hasTag(w, /^тяж[её]л/i);
    const tSel = targetId || (tg[0] && tg[0].id) || '';
    const tMob = (t)=>t && t.mob!=null ? t.mob + (t.cover && ranged && t.dist!=='>' ? 3 : 0) : lastMob;
    const tInfo = (t)=>!t ? '' : [t.mob==null ? 'МОБ скрыт — введите сами' : '', t.cover && ranged && t.dist!=='>' ? 'укрытие +3 МОБ' : '',
      Battle.RANK[t.dist] > Battle.RANK[w.range || '>'] ? (w.range==='⁕' || w.range==='>' ? 'цель в другой Зоне — оружию не достать' : 'вне дальности оружия — препятствие') : '',
      !mech && t.scale==='strategic' && !heavy ? 'по технике ранит только Тяжёлое оружие' : '', mech && t.scale==='personal' ? 'цель персонального масштаба — урон ×10' : ''].filter(Boolean).join(' · ');
    const ammoLeft = Pilot.consumables(p, 'ammo').reduce((s, it)=>s + 3 - int(it.marks), 0);
    const usesAmmo = mech && (w.type==='kinetic' || w.type==='missile'), usesKr = mech && (w.type==='beam' || w.type==='melee');
    const others = list.filter(x=>x.id!==id);
    UI.sheet({help:'battle', title:'Атака: ' + w.name, sub:`${w.dmg || '—'} · ${w.range || ''} ${KAVA.RANGES[w.range] || ''}${w.tags ? ' · ' + w.tags : ''}`, cls:'kv-sheet-attack', html:`
      ${tg.length ? `<label class="kv-stepper kv-wide"><span>Цель</span><select name="target"><option value="">— без цели (МОБ вручную) —</option>${tg.map(t=>`<option value="${t.id}"${t.id===tSel ? ' selected' : ''}>${esc(t.name)} · ${Battle.DIST_NAME[t.dist]} дистанция${t.mob!=null ? ' · МОБ ' + t.mob : ''}</option>`).join('')}</select></label><div class="kv-note" data-tinfo>${esc(tInfo(tg.find(t=>t.id===tSel)))}</div>` : ''}
      <div class="kv-sheet-grid">${UI.stepper('mob', tSel ? tMob(tg.find(t=>t.id===tSel)) : lastMob, 0, 40, 'МОБ цели')}${UI.stepper('extra', 0, -20, 20, 'Доп. бонус')}</div>
      ${modeChips()}
      <div class="kv-chips2">
        ${usesAmmo ? UI.chip('ammo', `+ кость боеприпасов (${ammoLeft ? 'осталось ' + ammoLeft : 'нет'})`, ammoLeft > 0, 'к6 расходника добавляется к атаке') : ''}
        ${usesKr ? UI.chip('kr', `+ кР к атаке (к${p.mech.kr})`, false, (w.type==='beam' ? 'Энерговооружение' : 'Удар') + ': бросок кР — бонус к атаке; кР растёт, 7+ — перегрев') : ''}
        ${w.range!=='⁕' ? UI.chip('contact', 'Цель вплотную (⁕)', false, 'Стрельба вплотную не Лёгким оружием — с препятствием') : ''}
        ${UI.chip('out', 'Вне дальности', (()=>{ const t = tg.find(x=>x.id===tSel); return !!(t && Battle.RANK[t.dist] > Battle.RANK[w.range || '>'] && ranged); })(), 'Атака за пределы дальности — с препятствием')}
        ${mech ? UI.chip('personal', 'Цель — пехота/Спектр (×10)', (()=>{ const t = tg.find(x=>x.id===tSel); return !!(t && t.scale==='personal'); })(), 'Урон Катафракта по цели персонального масштаба ×10') : ''}
      </div>
      ${others.length ? `<div class="kv-fe kv-wide"><span>Залп — добавить оружие (мультиатака: берётся наибольший вред, совпадение — удвоение)</span><div class="kv-chips2">${others.map(x=>UI.chip('w:' + x.id, esc(x.name), false)).join('')}</div></div>` : ''}
      ${w.note || w.onMax ? `<div class="kv-note">${esc([w.note, w.onMax].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="maneuver" title="Атака с препятствием без урона: оба броска удались — успех, один — успех и контратака">Маневр</button>
        ${w.heavy || w.crew ? `<button type="button" class="kv-btn" data-a="reload">Перезарядка</button>` : ''}
        ${w.relic ? `<button type="button" class="kv-btn" data-a="evolve" title="Потратить кС: бросок по таблице эволюции (+1 за каждого уничтоженного этим оружием)">Эволюция (кС)</button><button type="button" class="kv-btn" data-a="whim" title="Первый контакт, новая реликтовая деталь, критическая травма Спектра">Прихоть</button>` : ''}
        <button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Атаковать</button></div>`,
      onInput(panel){
        const sel = panel.querySelector('[name=target]'); if(!sel || sel.dataset.v===sel.value) return; sel.dataset.v = sel.value;
        const t = tg.find(x=>x.id===sel.value), info = panel.querySelector('[data-tinfo]'); if(info) info.textContent = tInfo(t);
        if(t){ panel.querySelector('[name=mob]').value = tMob(t);
          const set = (k, on)=>{ const c = panel.querySelector(`[data-chip="${k}"]`); if(c) c.classList.toggle('on', !!on); };
          set('out', Battle.RANK[t.dist] > Battle.RANK[w.range || '>'] && ranged); set('personal', mech && t.scale==='personal'); }
      },
      onAction(a, btn, close, panel){
        const mob = UI.num(panel, 'mob', 10); lastMob = mob; App.pref('tmob', mob);
        const sel = panel.querySelector('[name=target]'), target = sel && sel.value;
        const extra = UI.num(panel, 'extra', 0), mode = pickMode(panel); App.setMode('norm');
        if(a==='reload'){ done(Rolls.reload(p, id, w.crew || 1)); return; }
        if(a==='evolve'){ const kills = int(w.kills), v = Dice.rnd(+p.ks || 6), t = Math.max(1, Math.min(10, v + kills)), text = LORE.EVOLUTION[t - 1];
          w.evo = (w.evo || []).concat(text); w.note = [String(w.note || '').split(' · Эволюция:')[0], 'Эволюция: ' + w.evo.join('; ')].join(' · '); Pilot.save();
          done(Rolls.push({who:p.name, kind:'relic', title:'Эволюция: ' + w.name, tone:'ok', big:t, verdict:text, lines:[`кС к${p.ks}: [${v}]${kills ? ' + ' + kills + ' (уничтожено)' : ''} = ${t}`], dice:[{sides:+p.ks || 6, value:v, label:'кС'}]})); return; }
        if(a==='whim'){ const v = Dice.rnd(6); done(Rolls.push({who:p.name, kind:'relic', title:'Прихоть: ' + w.name, tone:'info', big:v, verdict:LORE.WHIMS[v - 1], lines:[], dice:[{sides:6, value:v}]})); return; }
        if(a==='maneuver'){ done(Rolls.maneuver(p, id, {mob, extra, mech})); return; }
        const ids = [id].concat([...panel.querySelectorAll('[data-chip^="w:"].on')].map(c=>c.dataset.chip.slice(2)));
        const e = Rolls.attack(p, ids, {mob, extra, mode, mech, ammo:UI.chipOn(panel, 'ammo'), kr:UI.chipOn(panel, 'kr'), contact:UI.chipOn(panel, 'contact'), outOfRange:UI.chipOn(panel, 'out'), personal:UI.chipOn(panel, 'personal')});
        if(e && target){ const t = tg.find(x=>x.id===target); e.title += t ? ' → ' + t.name : '';
          if(e.dmg > 0){ Battle.reportHit(target, e.dmg, {pierce:Pilot.hasTag(w, /^бронебойн/i), crit:!!(e.fx && e.fx.nat20)}); e.verdict += Table.S.role==='player' ? ' — урон отправлен Летописцу' : ' — урон нанесён'; } }
        done(e);
      }});
  }
  // ---------- урон ----------
  function hurtSheet(p, side){
    const mech = side==='m', m = p.mech;
    const armorLeft = mech ? Pilot.consumables(p, 'armor').reduce((s, it)=>s + 3 - int(it.marks), 0) : 0;
    const shields = mech ? m.items.filter(it=>it.kind==='module' && it.shield && !it.used && !it.off).length : 0;
    const pArmor = !mech ? Pilot.armorDice(p).map(a=>`${a.item.name} ${a.dice}`).join(', ') : '';
    UI.sheet({help:'death', title:mech ? 'Урон по Катафракту' : 'Урон по Спектру', sub:mech ? `СТК ${int(m.stk)} из ${int(m.stkMax)}` : `СТК ${int(p.stk)} из ${Pilot.stkMax(p)}`, html:`
      <div class="kv-sheet-grid">${UI.stepper('dmg', 1, 0, 200, 'Урон')}${!mech ? UI.stepper('reduce', 0, 0, 20, 'Снижение') : ''}</div>
      <div class="kv-chips2">${UI.chip('pierce', 'Бронебойное', false, 'Броня учитывает половину броска')}
        ${mech ? UI.chip('armor', `Бросить Броню (${armorLeft ? 'осталось ' + armorLeft : 'нет'})`, armorLeft > 0) + (shields ? UI.chip('shield', `Штурмовой щит (${shields})`, false, 'Проигнорировать атаку') : '')
          : UI.chip('noarmor', pArmor ? `Без брони (${esc(pArmor)})` : 'Брони нет', !pArmor)}</div>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="heal">${mech ? 'Ремонт +' : 'Лечение +'}</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Получить урон</button></div>`,
      onAction(a, btn, close, panel){
        const dmg = UI.num(panel, 'dmg', 0);
        if(a==='heal'){
          const obj = mech ? m : p, max = mech ? int(m.stkMax) : Pilot.stkMax(p), before = int(obj.stk); obj.stk = Math.min(max, before + dmg); Pilot.save();
          done(Rolls.push({who:p.name, kind:'heal', title:mech ? 'Ремонт Катафракта' : 'Лечение Спектра', tone:'ok', big:'+' + (obj.stk - before), verdict:`СТК ${before} → ${obj.stk}`, lines:[]})); return;
        }
        done(mech ? Rolls.mechDamage(p, dmg, {pierce:UI.chipOn(panel, 'pierce'), armor:UI.chipOn(panel, 'armor'), shield:UI.chipOn(panel, 'shield')})
          : Rolls.takeDamage(p, dmg, {pierce:UI.chipOn(panel, 'pierce'), noArmor:UI.chipOn(panel, 'noarmor'), reduce:UI.num(panel, 'reduce', 0)}));
      }});
  }
  // ---------- реактор ----------
  function krSheet(p){
    const m = p.mech, L = Pilot.mechLoad(p), R = Pilot.reactorOf(m), rad = Pilot.consumables(p, 'radiator').reduce((s, it)=>s + 3 - int(it.marks), 0);
    const mods = m.items.filter(it=>it.kind==='module' && it.kr && !it.off);
    UI.sheet({help:'reactor', title:`Реактор: к${m.kr}`, sub:`${R.name}${L.krMod ? ` · нагрузка +${L.krMod} к броску` : ''}${R.krMod ? ` · ${R.krMod} к броску` : ''}${int(m.explode) ? ` · шанс взрыва ${m.explode}-з-6` : ''}`, html:`
      <p class="kv-note">Бросок кР: при 4+${Pilot.hasModule(p, 'reactor5') ? ' (с Изоляцией — 5+)' : ''} кость растёт на степень (к6 → к8 → к10 → к12); итог 7+ — перегрев. Энерговооружение и Удар — в карточке атаки.</p>
      <div class="kv-act-grid">
        <button type="button" class="kv-act" data-a="forsage"><b>Форсаж</b><span>ещё одно действие в раунде</span></button>
        ${mods.map(it=>`<button type="button" class="kv-act" data-a="mod" data-id="${it.id}"><b>${esc(it.name)}</b><span>модуль · кР</span></button>`).join('')}
        <button type="button" class="kv-act" data-a="thermo"><b>Попадание Термо</b><span>цель бросает кР${Pilot.hasModule(p, 'thermoAdv') ? ' (с преимуществом)' : ''}</span></button>
        <button type="button" class="kv-act" data-a="radiator"${rad ? '' : ' disabled'}><b>Радиаторы</b><span>−1 степень кР · осталось ${rad}</span></button>
        <button type="button" class="kv-act" data-a="cool"><b>Остыть</b><span>вахта без нагрузки → к6</span></button>
        ${int(m.explode) ? `<button type="button" class="kv-act kv-danger" data-a="boom"><b>Шанс взрыва ${m.explode}-з-6</b><span>бросок к6</span></button>` : ''}
      </div>`,
      onAction(a, btn){
        if(a==='forsage') done(Rolls.reactor(p, 'forsage').entry);
        else if(a==='mod') done(Rolls.moduleUse(p, btn.dataset.id));
        else if(a==='thermo') done(Rolls.reactor(p, 'thermo').entry);
        else if(a==='radiator') done(Rolls.cool(p, false));
        else if(a==='cool') done(Rolls.cool(p, true));
        else if(a==='boom'){ const v = Dice.rnd(6), ok = v <= int(m.explode); done(Rolls.push({who:p.name, kind:'reactor', title:'Шанс взрыва реактора', tone:ok ? 'crit' : 'ok', big:v,
          verdict:ok ? 'Реактор взрывается: 4к12 повреждений всем на ближней дистанции' : 'Пронесло', lines:[`к6 [${v}] ${ok ? '≤' : '>'} ${m.explode}`], dice:[{sides:6, value:v, tint:ok ? 'bad' : 'good'}], fx:ok ? {boom:true} : null})); }
      }});
  }
  // ---------- синхронизация ----------
  function ksSheet(p){
    UI.sheet({help:'sync', title:`Синхронизация: к${p.ks}`, sub:int(p.ksBonus) ? `+${p.ksBonus} к следующему броску роста` : '', html:`
      <div class="kv-act-grid">
        <button type="button" class="kv-act" data-a="connect"><b>Подключение</b><span>кС, соединение на 4+</span></button>
        <button type="button" class="kv-act" data-a="dive"><b>Погружение в Ядро</b><span>Узлы, Измерения, Дары</span></button>
        <button type="button" class="kv-act" data-a="grow" data-x="0"><b>Рост кС</b><span>изучение техники, анализ информации</span></button>
        <button type="button" class="kv-act" data-a="grow" data-x="1"><b>Пожирание ИИ</b><span>ограниченный: преимущество</span></button>
        <button type="button" class="kv-act" data-a="grow" data-x="2"><b>Пожирание Ядра</b><span>полный ИИ: ×2</span></button>
        <button type="button" class="kv-act" data-a="grow" data-x="3"><b>Пожирание Супер-ИИ</b><span>×3, «1» — Удача или смерть</span></button>
      </div>
      <div class="kv-sheet-grid">${UI.stepper('ot', p.inWomb ? Pilot.wombLimit(p).over : 0, 0, 20, 'Сверхурочные вахты')}<button type="button" class="kv-btn kv-primary" data-a="backlash">Отдача</button></div>`,
      onAction(a, btn, close, panel){
        if(a==='dive'){ close(); Dive.sheet(p); return; }
        if(a==='connect') done(Rolls.connect(p));
        else if(a==='grow') done(Rolls.syncGrowth(p, +btn.dataset.x));
        else if(a==='backlash') done(Rolls.backlash(p, UI.num(panel, 'ot', 0)));
      }});
  }
  function alienSheet(p, dive){
    UI.sheet({help:'sync', title:dive ? 'Выход из погружения' : 'Испытание Отчуждённости', sub:`к20 + ЭМП против Отчуждённости ${Pilot.alien(p)}${dive ? ' + Измерение' : ''}`, html:`
      ${dive ? `<div class="kv-sheet-grid">${UI.stepper('depth', 1, 0, 20, 'Измерение')}</div>` : ''}${modeChips()}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Бросить</button></div>`,
      onAction(a, btn, close, panel){ App.setMode('norm'); done(Rolls.alienation(p, dive ? UI.num(panel, 'depth', 0) : 0, pickMode(panel))); }});
  }
  // сверхурочная вахта в Утробе: пора бросать Отдачу (кС + сверхурочные)
  function overtimeSheet(p){
    const W = Pilot.wombLimit(p);
    UI.sheet({help:'backlash', title:'Сверхурочная вахта', sub:`${p.watches} вахт в Утробе без перерыва · предел ${W.limit}`, html:`<p class="kv-p">После ${W.limit} вахт подключения Спектр бросает Отдачу ${W.everyText}: кС к${p.ks} + ${W.over} за сверхурочные вахты.</p>
      ${p.ritual ? `<p class="kv-note">Ритуал декомпрессии, проведённый до наступления эффекта, преодолевает его: ${esc(p.ritual)}</p>` : '<p class="kv-note">Ритуал декомпрессии, проведённый до наступления эффекта, преодолевает Отдачу.</p>'}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="leave">Выйти из Утробы</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Отдача: кС + ${W.over}</button></div>`,
      onAction(a, b, close){
        if(a==='go'){ close(); done(Rolls.backlash(p, W.over)); }
        if(a==='leave'){ close(); App.leaveWomb(); }
      }});
  }
  // ---------- предметы ----------
  function itemSheet(p, side, id){
    const list = side==='m' ? p.mech.items : p.items, it = list.find(x=>x.id===id); if(!it) return;
    const cap = Rolls.itemCap(it);
    UI.sheet({help:'load', title:it.name || 'Предмет', sub:`${int(it.sl)} СЛ${it.value ? ' · ' + it.value : ''}`, html:`
      ${it.text || it.note ? `<p class="kv-p">${esc(it.text || it.note)}</p>` : ''}
      ${it.kind==='armor' ? `<p class="kv-p">${it.mob ? `+${it.mob} МОБ. ` : ''}${it.armor ? `Броня ${esc(it.armor)} кВ: кости вычитаются из урона, каждая на 4+ теряет метку.` : ''}</p>` : ''}
      <div class="kv-fe kv-wide"><span>Метки расхода (${int(it.marks)} из ${cap})</span>${UI.dots(int(it.marks), cap, 'mark', it.id)}</div>
      <div class="kv-sheet-btns">${it.kind==='armor' ? `<button type="button" class="kv-btn" data-a="wear">${it.worn ? 'Снять' : 'Надеть'}</button>` : ''}
        <button type="button" class="kv-btn" data-a="fix">Восстановить метки</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="kv">Кость расхода к6</button></div>`,
      onAction(a, btn, close, panel){
        if(a==='kv'){ done(Rolls.kv(p, id, side==='m')); return; }
        if(a==='mark'){ const i = +btn.dataset.i; it.marks = int(it.marks)===i + 1 ? i : i + 1; }
        if(a==='fix') it.marks = 0;
        if(a==='wear') it.worn = !it.worn;
        Pilot.save(); Tandem.render(); itemSheet(p, side, id);
      }});
  }
  function moduleSheet(p, id){
    const it = p.mech.items.find(x=>x.id===id); if(!it) return;
    UI.sheet({title:it.name, sub:`Модуль · ${int(it.sl)} СЛ · ${it.value || ''}`, html:`<p class="kv-p">${esc(it.text || '')}</p>
      ${it.kv ? `<div class="kv-fe kv-wide"><span>Метки (${int(it.marks)} из 3)</span>${UI.dots(int(it.marks), 3, 'mark', it.id)}</div>` : ''}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="toggle">${it.off ? 'Включить обратно' : 'Отключён (повреждение, перегрев)'}</button>
        ${it.shield ? `<button type="button" class="kv-btn" data-a="shield">${it.used ? 'Щит восстановлен' : 'Щит использован'}</button>` : ''}
        ${it.kr || it.kv ? `<button type="button" class="kv-btn kv-primary kv-grow2" data-a="use">${it.kv ? 'Бросок к6 расходника' : 'Активировать (бросок кР)'}</button>` : ''}</div>`,
      onAction(a, btn){
        if(a==='use'){ done(Rolls.moduleUse(p, id)); return; }
        if(a==='mark'){ const i = +btn.dataset.i; it.marks = int(it.marks)===i + 1 ? i : i + 1; }
        if(a==='toggle') it.off = !it.off;
        if(a==='shield') it.used = !it.used;
        Pilot.save(); Tandem.render(); moduleSheet(p, id);
      }});
  }
  function consSheet(p, key){
    const c = MECH.CONSUMABLES.find(x=>x.ckey===key), list = Pilot.consumables(p, key);
    const act = key==='radiator' ? ['radiator', 'Снизить кР на степень'] : key==='repair' ? ['repair', 'Ремкассеты: +к6 СТК'] : null;
    UI.sheet({help:'repair', title:c.name, sub:'Кость расхода к6 с тремя метками, метка — на 4+', html:`<p class="kv-p">${esc(c.text)}</p>
      ${list.map((it, i)=>`<div class="kv-fe kv-wide"><span>Блок ${i + 1}</span>${UI.dots(int(it.marks), 3, 'mark', it.id)}</div>`).join('')}
      <div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="fix">Пополнить (1 Мат за кость)</button>${act ? `<button type="button" class="kv-btn kv-primary kv-grow2" data-a="${act[0]}">${act[1]}</button>` : ''}</div>`,
      onAction(a, btn, close){
        if(a==='radiator'){ done(Rolls.cool(p, false)); return; }
        if(a==='repair'){ done(Rolls.repairKit(p)); return; }
        if(a==='mark'){ const it = list.find(x=>x.id===btn.dataset.id); const i = +btn.dataset.i; it.marks = int(it.marks)===i + 1 ? i : i + 1; }
        if(a==='fix'){ const ids = list.filter(it=>int(it.marks) > 0).map(it=>it.id); if(!ids.length){ UI.toast('Все кости полны', 'ok'); return; } close(); Maint.refill(p, ids); return; }
        Pilot.save(); Tandem.render(); consSheet(p, key);
      }});
  }
  // ---------- броски по таблицам ----------
  function tablesSheet(p){
    UI.sheet({help:'social', title:'Броски', sub:'таблицы книги и свободный бросок', html:`
      <div class="kv-act-grid">
        <button type="button" class="kv-act" data-a="reaction"><b>Реакция</b><span>2к6</span></button>
        <button type="button" class="kv-act" data-a="fame"><b>Слава</b><span>к20 + походы против сложности</span></button>
        <button type="button" class="kv-act" data-a="init"><b>Инициатива</b><span>к6 лидера стороны</span></button>
        <button type="button" class="kv-act" data-a="crit"><b>Крит. травма</b><span>к20 по таблице</span></button>
        <button type="button" class="kv-act" data-a="mcrit"><b>Крит. повреждение</b><span>к20, в лист Катафракта</span></button>
      </div>
      <div class="kv-sheet-grid">${UI.stepper('morale', 7, 2, 12, 'Боевой дух')}<button type="button" class="kv-btn" data-a="morale">Проверка 2к6</button></div>
      <div class="kv-sheet-grid"><label class="kv-stepper"><span>Торги</span><select name="trade">${KAVA.TRADE.map(t=>`<option value="${t.key}">${t.name} (${t.dice})</option>`).join('')}</select></label>${UI.stepper('tmod', 0, -6, 6, '±')}<button type="button" class="kv-btn" data-a="trade">Торги</button></div>
      <div class="kv-sheet-grid">${UI.stepper('chance', 2, 1, 5, 'Шанс Х-з-6')}<button type="button" class="kv-btn" data-a="chance">Бросок шанса</button></div>
      <div class="kv-sheet-grid"><label class="kv-stepper kv-grow2"><span>Свободный бросок</span><input name="free" value="${esc(App.pref('free') || 'к20')}" placeholder="к20, 2к6+1, к66, к100"></label><button type="button" class="kv-btn kv-primary" data-a="free">Бросить</button></div>
      <div class="kv-chips2">${['к4', 'к6', 'к8', 'к10', 'к12', 'к20', 'к66', 'к100'].map(x=>`<button type="button" class="kv-chip" data-a="quick" data-f="${x}">${x}</button>`).join('')}</div>`,
      onAction(a, btn, close, panel){
        const r = {reaction:()=>Rolls.reaction(0), fame:()=>Rolls.fame(p, App.dc(), d20()), init:()=>Rolls.initiative(), crit:()=>Rolls.crit(p), mcrit:()=>Rolls.mechCrit(p),
          morale:()=>Rolls.morale(UI.num(panel, 'morale', 7)), trade:()=>Rolls.trade(panel.querySelector('[name=trade]').value, UI.num(panel, 'tmod', 0)),
          chance:()=>Rolls.chance(UI.num(panel, 'chance', 2)), free:()=>{ const f = panel.querySelector('[name=free]').value; App.pref('free', f); return Rolls.free(f); }, quick:()=>Rolls.free(btn.dataset.f)}[a];
        if(r) done(r());
      }});
  }

  // ---------- диспетчер data-a с листа ----------
  function handle(a, b, p){
    const id = b.dataset.id, toggleMark = (list)=>{ const it = list.find(x=>x.id===id); if(!it) return; const i = +b.dataset.i; it.marks = int(it.marks)===i + 1 ? i : i + 1; Pilot.save(); };
    switch(a){
      case 'check': done(Rolls.check(p, b.dataset.k, App.dc(), d20())); return;
      case 'luck': done(Rolls.luck(p, d20())); return;
      case 'ks': ksSheet(p); return;
      case 'kr': krSheet(p); return;
      case 'p-stk': p.stk = int(p.stk) + int(b.dataset.d); Pilot.save(); if(typeof Table!=='undefined') Table.pilotChanged(); return 'render';
      case 'm-stk': p.mech.stk = Math.max(0, int(p.mech.stk) + int(b.dataset.d)); Pilot.save(); if(typeof Table!=='undefined') Table.pilotChanged(); return 'render';
      case 'p-hurt': hurtSheet(p, 'p'); return;
      case 'm-hurt': hurtSheet(p, 'm'); return;
      case 'm-maint': Maint.sheet(p); return;
      case 'watch': { p.watches = int(p.watches) + 1; Pilot.save(); const W = Pilot.wombLimit(p);
        if(W.due) setTimeout(()=>overtimeSheet(p), 30); else UI.toast(p.watches===W.limit ? `Вахта ${p.watches} — предел: дальше Отдача ${W.everyText}` : W.over ? `Сверхурочная вахта ${W.over}; Отдача — на вахте ${W.next}` : `Вахта ${p.watches} из ${W.limit}`, W.over || p.watches===W.limit ? 'fail' : 'ok');
        Table.pilotChanged(); return 'render'; }
      case 'watch-reset': p.watches = 0; Pilot.save(); Table.pilotChanged(); UI.toast('Перерыв в подключении — вахты считаются заново', 'ok'); return 'render';
      case 'p-weapon': attackSheet(p, 'p', id); return;
      case 'm-weapon': attackSheet(p, 'm', id); return;
      case 'p-item': itemSheet(p, 'p', id); return;
      case 'p-kv': done(Rolls.kv(p, id)); return;
      case 'p-mark': toggleMark(p.items); return 'render';
      case 'm-mark': toggleMark(p.mech.items); return 'render';
      case 'm-module': moduleSheet(p, id); return;
      case 'm-use': done(Rolls.moduleUse(p, id)); return;
      case 'm-cons': consSheet(p, b.dataset.k); return;
      case 'm-frame': done(Rolls.frameAbility(p)); return;
      case 'm-sensors': done(Rolls.sensors(p, App.dc(), d20())); return;
      case 'm-alien': alienSheet(p, false); return;
      case 'm-dive': alienSheet(p, true); return;
      case 'm-divesheet': Dive.sheet(p); return;
      case 'scar': done(Rolls.scar(p)); return;
      case 'mem': { const m = p.memories[+b.dataset.i]; if(m){ m.lost = !m.lost; Pilot.save(); } return 'render'; }
      case 'wizard-p': Wizard.pilot(p); return;
      case 'wizard-m': Wizard.mech(p); return;
      case 'class-m': Wizard.classes(p); return;
      case 'augment': { const x = Create.augment(); x.apply(p); Pilot.save(); done(Rolls.push({who:p.name, kind:'create', title:'Аугментация', tone:'info', big:'к66', verdict:x.summary, lines:x.lines, dice:x.dice})); return; }
      case 'add-injury': p.injuries.push({id:Pilot.uid(), text:''}); Pilot.save(); return 'render';
      case 'add-crit': p.mech.crits.push({id:Pilot.uid(), text:''}); Pilot.save(); return 'render';
      case 'add-item': (b.dataset.side==='m' ? p.mech.items : p.items).push(b.dataset.side==='m' ? {id:Pilot.uid(), kind:'module', name:'', sl:1, marks:0} : {id:Pilot.uid(), kind:'gear', name:'', sl:1, marks:0}); Pilot.save(); return 'render';
      case 'add-cat': { const s = document.querySelector(`.kv-cat[data-cat="${b.dataset.side}"]`), it = s && Tandem.fromCatalog(s.value); if(it){ (b.dataset.side==='m' ? p.mech.items : p.items).push(it); Pilot.save(); } return 'render'; }
      case 'del': { const path = b.dataset.list.split('.'); let o = p; path.forEach(k=>{ o = o[k]; }); const i = o.findIndex(x=>x.id===id); if(i >= 0) o.splice(i, 1); Pilot.save(); return 'render'; }
      case 'sensor-mod': { const n = b.dataset.n, list = p.mech.sensorModules, i = list.indexOf(n); if(i >= 0) list.splice(i, 1); else list.push(n); Pilot.save(); return 'render'; }
    }
  }
  return {handle, done, tablesSheet, attackSheet, hurtSheet};
})();
