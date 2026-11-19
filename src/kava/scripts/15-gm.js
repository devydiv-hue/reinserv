/* ======================================================================
   КАВАЛЕРИЯ — ЭКРАН ЛЕТОПИСЦА. Вкладки: «Тандемы» — карточки игроков вживую (СТК Спектра и Катафракта, кР, кС,
   Удача, МОБ, повреждения, в Утробе ли, последний бросок) с действиями: запросить бросок, преимущество/препятствие
   на следующий к20, нанести урон, открыть лист; «Копьё» — ресурсы (Запасы, Батареи, Материалы, Богатства, Люди,
   Слава), свита и техника, расход за сутки, стартовые броски; «Броски» — тайные броски и таблицы книги.
   Копьё хранится у Летописца (reincarnator_kava_lance_v1, по коду стола) и рассылается игрокам.
   ====================================================================== */
const Gm = (function(){
  const esc = kvEsc, int = (v, d)=>Pilot.int(v, d);
  const LKEY = 'reincarnator_kava_lance_v1';
  let root = null, tab = 'battle', secret = false;
  const RES = [['supplies', 'Запасы', 'найм и содержание свиты и Спектров; 1 в сутки на каждые 10 человек'], ['batteries', 'Батареи', 'передвижение техники: 1 за квадрат на единицу'],
    ['materials', 'Материалы', 'расходники, ремонт, техника; 1 Мат = 1 СЛ'], ['wealth', 'Богатства', 'обмен, подкуп, дары'], ['people', 'Люди', 'особый ресурс войска'], ['fame', 'Слава', 'Слава Копья']];
  const RETINUE = [
    {name:'Отряд оружейников', stk:'2к6', mob:11, note:'Обслуживает один Катафракт: перезарядка модулей, капитальный ремонт, восстановление, создание модулей. +3 к проверкам ремонта.'},
    {name:'Специалист', stk:'к6', mob:13, note:'1 Человек и 1 Запас. Офицер, Целитель, Толкователь, Разведчик, Кастелян, Эмиссар, Археотехник, Купец, Проводник.'},
    {name:'Оруженосец', stk:'6+к6', mob:10, note:'Служит одному Спектру, сопровождает в бою, управляет техникой; занимает место погибшего Спектра. СТК и МОБ — как у Спектров.'},
    {name:'Отряд воинов', stk:'6+2к6', mob:13, note:'+1 к атаке; функции зависят от оснастки.'}];
  const TECH = [
    {name:'Ковчег', stk:'3к6', mob:10, note:'Броня к6, экипаж 10, Медленный. Ремонтный цех и четыре «люльки» для Катафрактов.'},
    {name:'Говеркарго', stk:'к6', mob:13, note:'СЛ 10, экипаж 2. Антигравитационный транспорт: тягач, инженерная, медицинская или штабная машина.'},
    {name:'Рейдер', stk:'к6', mob:15, note:'Броня к6, СЛ 6, экипаж 3, Быстрый. Магнитно-подушечная машина.'},
    {name:'Бронетехника', stk:'6+2к6', mob:13, note:'Броня 2к6, СЛ 8, экипаж 4. Тяжёлое вооружение.'},
    {name:'Шаговая платформа «Тура»', stk:'2к6', mob:12, note:'кВ брони к6, СЛ 4, экипаж 3. Гексапод для тяжёлого вооружения, перевозит отряд пехоты, игнорирует сложный ландшафт.'},
    {name:'«Гаскаур»', stk:'к6+1', mob:17, note:'СЛ 3, экипаж 1, МОТ +3, Быстрый. Герметичные доспехи штурмовых групп.'},
    {name:'«Носитель меча»', stk:'2к6', mob:17, note:'СЛ 6, экипаж 1. Тетрапод поддержки: расходники и запасное вооружение для Катафракта.'},
    {name:'Лёгкий вездеход', stk:'к3', mob:15, note:'СЛ 3, экипаж 1, Быстрый.'},
    {name:'Разведывательный дрон', stk:'к3', mob:15, note:'Оперативные Сенсоры, наблюдает за квадратом 4 вахты.'},
    {name:'Колёсный грузовик', stk:'к3', mob:11, note:'СЛ 5, экипаж 2. Грузы, модули или 2 отряда.'},
    {name:'Коптер', stk:'к6', mob:17, note:'СЛ 5, экипаж 3. Модули, два отряда или техника.'}];
  const lanceKey = ()=>(Table.S.code || 'solo');
  function loadLance(){ let all = {}; try{ all = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; }catch(e){} return all[lanceKey()] || {name:'', res:{supplies:0, batteries:0, materials:0, wealth:0, people:0, fame:0}, units:[], notes:''}; }
  function saveLance(L){ let all = {}; try{ all = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; }catch(e){} all[lanceKey()] = L; try{ localStorage.setItem(LKEY, JSON.stringify(all)); }catch(e){} Table.setLance(L); }
  let lance = null;
  const L = ()=>lance || (lance = loadLance());

  // бросок Летописца: тайный — только у себя
  function roll(e){ if(!e) return; if(secret){ e.secret = true; } Fx.play(e); if(!secret) Table.rolled(e); }

  // ---------- тандемы ----------
  function players(){ return Object.entries(Table.S.peers).filter(([, x])=>x.role==='player'); }
  function card(id, x){
    const p = x.pilot ? Pilot.fix(JSON.parse(JSON.stringify(x.pilot))) : null;
    if(!p) return `<div class="kv-gcard"><div class="kv-gcard-head"><b>${esc(x.name || 'Игрок')}</b><span class="kv-note">лист ещё не пришёл</span></div></div>`;
    const m = p.mech, built = m.built || m.name || m.items.length, krIdx = Dice.STEPS.indexOf(+m.kr);
    const hp = (cur, max)=>`<span class="kv-hp"><i style="width:${max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0}%"></i></span>`;
    return `<div class="kv-gcard${p.inWomb ? ' womb' : ''}" data-pid="${id}">
      <div class="kv-gcard-head"><b>${esc(p.name || x.name || 'Спектр')}</b>${built ? `<span>${esc(m.name || 'Катафракт')}</span>` : ''}${p.inWomb ? '<em class="kv-badge">в Утробе</em>' : ''}</div>
      <div class="kv-gcard-grid">
        <div><small>СТК Спектра</small><b>${int(p.stk)}/${Pilot.stkMax(p)}</b>${hp(int(p.stk), Pilot.stkMax(p))}</div>
        ${built ? `<div><small>СТК Катафракта</small><b>${int(m.stk)}/${int(m.stkMax)}</b>${hp(int(m.stk), int(m.stkMax))}</div>` : ''}
        <div><small>МОБ</small><b>${Pilot.mob(p).total}${built ? ' / ' + Pilot.mechMob(p).total : ''}</b></div>
        <div><small>Удача · кС</small><b>${Pilot.luck(p)} · к${p.ks}</b></div>
        ${built ? `<div class="${krIdx >= 3 ? 'hot' : ''}"><small>кР</small><b>к${m.kr}</b></div>` : ''}
        <div><small>${KAVA.STATS.map(s=>s.short).join(' ')}</small><b>${KAVA.STATS.map(s=>UI.plus(Pilot.stat(p, s.key))).join(' ')}</b></div>
      </div>
      ${p.injuries.length || m.crits.length ? `<div class="kv-note">${p.injuries.length ? 'Травм: ' + p.injuries.length : ''}${p.injuries.length && m.crits.length ? ' · ' : ''}${m.crits.length ? 'Крит. повреждений: ' + m.crits.length : ''}</div>` : ''}
      ${x.last ? `<div class="kv-glast tone-${x.last.tone}"><b>${esc(x.last.big!=null ? x.last.big : '')}</b> ${esc(x.last.title)} — ${esc(x.last.verdict || '')}</div>` : ''}
      <div class="kv-gcard-btns"><button type="button" class="kv-btn kv-sm kv-primary" data-g="ask" data-id="${id}">Запросить бросок</button>
        <button type="button" class="kv-btn kv-sm" data-g="adv" data-id="${id}" title="Следующий к20 игрока — с преимуществом">Преим.</button><button type="button" class="kv-btn kv-sm" data-g="dis" data-id="${id}" title="Следующий к20 игрока — с препятствием">Препятст.</button>
        <button type="button" class="kv-btn kv-sm" data-g="hurt" data-id="${id}">Урон</button><button type="button" class="kv-btn kv-sm" data-g="sheet" data-id="${id}">Лист</button></div>
    </div>`;
  }
  function tandems(){
    const list = players();
    return `<div class="kv-gm-tools"><button type="button" class="kv-btn kv-primary" data-g="ask-all"${list.length ? '' : ' disabled'}>Бросок всем</button><button type="button" class="kv-btn" data-g="link">Ссылка для игроков</button></div>
      <div class="kv-gcards">${list.map(([id, x])=>card(id, x)).join('') || `<div class="kv-empty">За столом пока нет игроков. ${Table.S.role==='gm' ? 'Отправьте им ссылку стола.' : 'Создайте стол в «Стол» в шапке.'}</div>`}</div>`;
  }
  function askSheet(ids){
    const one = ids.length===1 ? Table.S.peers[ids[0]] : null;
    UI.sheet({title:'Запросить бросок', sub:one ? (one.pilot && one.pilot.name) || one.name : `всем игрокам (${ids.length})`, html:`
      <div class="kv-chips2" data-chips="one">${KAVA.STATS.map((s, i)=>UI.chip('check:' + s.key, 'Проверка ' + s.short, i===0)).join('')}${UI.chip('luck', 'Испытание Удачи')}${UI.chip('sensors', 'Сенсоры')}${UI.chip('alien', 'Отчуждённость')}${UI.chip('connect', 'Подключение')}${UI.chip('backlash', 'Отдача')}${UI.chip('init', 'Инициатива к6')}</div>
      <div class="kv-sheet-grid">${UI.stepper('dc', 13, 1, 40, 'Сложность')}<div class="kv-chips2" data-chips="mode">${UI.chip('adv', 'Преимущество')}${UI.chip('dis', 'Препятствие')}</div></div>
      <label class="kv-stepper kv-wide"><span>Пояснение игроку (необязательно)</span><input name="note" placeholder="Например: удержаться на обломке"></label>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="send" autofocus>Отправить</button></div>`,
      onAction(a, btn, close, panel){
        const k = panel.querySelector('[data-chips="one"] .on').dataset.chip.split(':'), modes = [...panel.querySelectorAll('[data-chips="mode"] .on')].map(c=>c.dataset.chip);
        const msg = {type:'request', rid:Date.now().toString(36), kind:k[0], stat:k[1] || '', dc:UI.num(panel, 'dc', 13), mode:modes.length===1 ? modes[0] : 'norm', note:panel.querySelector('[name=note]').value.trim()};
        ids.forEach(id=>Table.send(Object.assign({}, msg), id));
        close(); UI.toast(`Запрос отправлен: ${ids.length===1 ? '1 игроку' : ids.length + ' игрокам'}`, 'ok');
      }});
    // выбор режима — независимые чипы, но взаимоисключающие
    setTimeout(()=>{ const g = document.querySelector('.kv-sheet [data-chips="mode"]'); if(g) g.addEventListener('click', (e)=>{ const c = e.target.closest('[data-chip]'); if(c) g.querySelectorAll('[data-chip]').forEach(x=>{ if(x!==c) x.classList.remove('on'); }); }); }, 0);
  }
  function hurtSheet(id){
    const x = Table.S.peers[id] || {};
    UI.sheet({title:'Нанести урон', sub:(x.pilot && x.pilot.name) || x.name, html:`
      <div class="kv-chips2" data-chips="one">${UI.chip('p', 'Спектру', !(x.pilot && x.pilot.inWomb))}${UI.chip('m', 'Катафракту', !!(x.pilot && x.pilot.inWomb))}</div>
      <div class="kv-sheet-grid">${UI.stepper('amount', 1, 0, 200, 'Урон')}</div><div class="kv-chips2">${UI.chip('pierce', 'Бронебойное')}</div>
      <p class="kv-note">Игрок получит окно урона с этим числом: бросит броню (расходник или кВ) и применит урон сам.</p>
      <div class="kv-sheet-btns"><button type="button" class="kv-btn kv-primary kv-grow2" data-a="send">Отправить</button></div>`,
      onAction(a, btn, close, panel){ Table.send({type:'hurt', side:panel.querySelector('[data-chips="one"] .on').dataset.chip, amount:UI.num(panel, 'amount', 1), pierce:UI.chipOn(panel, 'pierce')}, id); close(); UI.toast('Урон отправлен', 'ok'); }});
  }
  function sheetView(id){
    const x = Table.S.peers[id]; if(!x || !x.pilot) return;
    const p = Pilot.fix(JSON.parse(JSON.stringify(x.pilot))), m = p.mech;
    const li = (arr, f)=>arr.length ? `<ul class="kv-list2">${arr.map(f).join('')}</ul>` : '<div class="kv-empty">—</div>';
    UI.sheet({title:p.name || 'Спектр', sub:[p.culture.split(':')[0], m.name].filter(Boolean).join(' · '), html:`
      <div class="kv-fe kv-wide"><span>Оружие Спектра</span>${li(Pilot.weapons(p), w=>`<li>${esc(w.name)} — ${esc(w.dmg)} ${esc(w.range || '')} ${esc(w.tags || '')}</li>`)}</div>
      <div class="kv-fe kv-wide"><span>Снаряжение</span>${li(p.items.filter(i=>i.kind!=='weapon'), i=>`<li>${esc(i.name)} (${int(i.sl)} СЛ, метки ${int(i.marks)})</li>`)}</div>
      <div class="kv-fe kv-wide"><span>Травмы</span>${li(p.injuries, i=>`<li>${esc(i.text)}</li>`)}</div>
      <div class="kv-fe kv-wide"><span>Воспоминания</span>${li(p.memories, i=>`<li class="${i.lost ? 'kv-lost' : ''}">${esc(i.a || '—')}</li>`)}</div>
      <div class="kv-fe kv-wide"><span>Катафракт: вооружение и модули</span>${li(m.items, i=>`<li>${esc(i.name)}${i.dmg ? ' — ' + esc(i.dmg) : ''}${i.kind==='consumable' ? ` (метки ${int(i.marks)}/3)` : ''}${i.off ? ' · отключён' : ''}</li>`)}</div>
      <div class="kv-fe kv-wide"><span>Критические повреждения</span>${li(m.crits, i=>`<li>${esc(i.text)}</li>`)}</div>`});
  }

  // ---------- Копьё ----------
  function lanceView(){
    const l = L(), r = l.res, perDay = Math.ceil(int(r.people) / 10);
    return `<div class="kv-gm-tools"><input class="kv-grow2" data-l="name" value="${esc(l.name)}" placeholder="Название Свободного Копья"><button type="button" class="kv-btn" data-g="lance-roll" title="6+2к6 Запасов, 6+2к6 Батарей, 6+3к6 Материалов, к6 Богатств, 40+2к6 Людей">⚄ Стартовые ресурсы</button></div>
      <div class="kv-res">${RES.map(([k, n, h])=>`<div class="kv-res-i" title="${esc(h)}"><small>${n}</small><div class="kv-step"><button type="button" data-g="res" data-k="${k}" data-d="-1">−</button><input type="number" data-r="${k}" value="${int(r[k])}"><button type="button" data-g="res" data-k="${k}" data-d="1">+</button></div></div>`).join('')}</div>
      <div class="kv-gm-tools"><button type="button" class="kv-btn" data-g="day">Прошли сутки: −${perDay} Запасов</button><span class="kv-note">Каждые 10 человек — 1 Запас в сутки; техника — 1 Батарея за квадрат пути.</span></div>
      <div class="kv-sec2"><h3>Свита и техника</h3>
        <div class="kv-units">${l.units.map(u=>`<div class="kv-unit"><input data-u="${u.id}" data-uf="name" value="${esc(u.name)}"><span class="kv-mini">СТК <input type="number" data-u="${u.id}" data-uf="stk" value="${int(u.stk)}"></span><span class="kv-mini">МОБ <input type="number" data-u="${u.id}" data-uf="mob" value="${int(u.mob)}"></span>
          <button type="button" class="kv-x" data-g="unit-del" data-id="${u.id}">✕</button>${u.note ? `<div class="kv-note">${esc(u.note)}</div>` : ''}</div>`).join('') || '<div class="kv-empty">Пусто. Копьё начинает с двумя отрядами оружейников, Ковчегом и оруженосцем для каждого Спектра.</div>'}</div>
        <div class="kv-row2"><select data-l="addunit" class="kv-grow2"><optgroup label="Свита">${RETINUE.map((u, i)=>`<option value="r${i}">${esc(u.name)} (СТК ${u.stk}, МОБ ${u.mob})</option>`).join('')}</optgroup><optgroup label="Техника">${TECH.map((u, i)=>`<option value="t${i}">${esc(u.name)} (СТК ${u.stk}, МОБ ${u.mob})</option>`).join('')}</optgroup></select><button type="button" class="kv-btn" data-g="unit-add">Добавить (СТК броском)</button></div></div>
      <label class="kv-fe kv-wide"><span>Заметки Копья: покровители, контракты, долги, Слава</span><textarea data-l="notes" rows="3">${esc(l.notes)}</textarea></label>`;
  }
  // ---------- броски Летописца ----------
  function rollsView(){
    return `<div class="kv-gm-tools"><label class="kv-chk"><input type="checkbox" data-g="secret"${secret ? ' checked' : ''}> Тайно — броски видите только вы</label></div>
      <div class="kv-act-grid">
        <button type="button" class="kv-act" data-g="r-reaction"><b>Реакция</b><span>2к6: враждебная … дружеская</span></button>
        <button type="button" class="kv-act" data-g="r-init"><b>Инициатива</b><span>к6 лидера стороны</span></button>
        <button type="button" class="kv-act" data-g="r-morale"><b>Боевой дух</b><span>2к6 против БД (по умолчанию 7)</span></button>
        <button type="button" class="kv-act" data-g="r-salvage"><b>Утилизация обломков</b><span>к6: Материалы и реликтовые детали</span></button>
        <button type="button" class="kv-act" data-g="r-salvage-m"><b>Утилизация Катафракта</b><span>2к6: что удалось снять</span></button>
        <button type="button" class="kv-act" data-g="r-wreck"><b>Оценка разрушений</b><span>2к6: можно ли восстановить</span></button>
        <button type="button" class="kv-act" data-g="r-crit"><b>Крит. травма</b><span>к20</span></button>
        <button type="button" class="kv-act" data-g="r-mcrit"><b>Крит. повреждение</b><span>к20</span></button>
        <button type="button" class="kv-act" data-g="r-tables"><b>Ещё броски</b><span>торги, шанс, свободный бросок</span></button>
      </div>
      <div class="kv-sec2"><h3>Генераторы Летописца</h3><div class="kv-act-grid">
        <button type="button" class="kv-act" data-g="lore-seed"><b>Завязка приключения</b><span>тип, причина, действующие лица, амплуа, Катафракты, провал, награда</span></button>
        <button type="button" class="kv-act" data-g="lore-system"><b>Звёздная система</b><span>звезда, удалённость, маршруты, объекты и планеты</span></button>
        <button type="button" class="kv-act" data-g="lore-relic-r"><b>Реликтовое оружие</b><span>стрелковое, с прихотью</span></button>
        <button type="button" class="kv-act" data-g="lore-relic-m"><b>Реликтовое оружие</b><span>ближнего боя, с прихотью</span></button></div>
        <div class="kv-chips2" style="margin-top:8px">${Object.keys(LORE.SEEDS).map(k=>`<button type="button" class="kv-chip" data-g="lore-t" data-k="${k}">${esc(LORE.SEEDS[k].name)}</button>`).join('')}</div></div>`;
  }
  const SALVAGE = ['Ничего ценного, только ржавчина и лом.', 'к3 Мат.', 'к6 Мат.', '2к6 Мат.', 'к3 Реликтовых деталей.', 'к3 Реликтовые детали + к6 Мат.'];
  const SALVAGE_M = {2:'Ничего ценного, только ржавчина и лом.', 3:'Утроба.', 4:'Брось дважды.', 5:'Каркас.', 6:'Вооружение.', 7:'Модуль.', 8:'6 Мат.', 9:'Сенсоры.', 10:'к3 Реликтовых деталей.', 11:'Реактор.', 12:'Ядро.'};
  const WRECK = {2:'Критические компоненты не пострадали.', 3:'Будет много кропотливой работы. Время × 1,5.', 4:'Брось дважды с +1.', 5:'Утроба уничтожена.', 6:'Реактор полностью испарился.', 7:'Каркас не восстановить.', 8:'Сенсоры разорвало на куски.', 9:'Ядро — обломки, которые не собрать.', 10:'Сложный случай. Мат × 1,5.', 11:'Нужна редкая реликтовая деталь.', 12:'Понадобится 2к6 Реликтовых деталей.'};
  function tableRoll(title, sides, n, map){
    const ds = []; for(let i = 0; i < n; i++) ds.push(Dice.rnd(sides));
    const v = ds.reduce((a, b)=>a + b, 0), text = typeof map==='function' ? map(v) : map[v];
    return Rolls.push({who:'Летописец', kind:'gm', title, tone:'info', big:v, verdict:text, lines:[`${n > 1 ? n : ''}к${sides}: [${ds.join(', ')}] = ${v}`], dice:ds.map(x=>({sides, value:x}))});
  }

  function render(){
    if(!root) return;
    root.innerHTML = `<div class="kv-gm"><div class="kv-gm-tabs kv-seg">${[['battle', 'Бой'], ['tandems', 'Тандемы'], ['lance', 'Копьё'], ['rolls', 'Броски']].map(([k, n])=>`<button type="button" data-gtab="${k}" class="${tab===k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="kv-gm-body">${tab==='battle' ? '<div data-battle-root></div>' : tab==='tandems' ? tandems() : tab==='lance' ? lanceView() : rollsView()}</div></div>`;
    const br = root.querySelector('[data-battle-root]'); if(br) Battle.mount(br);
  }
  function onClick(e){
    const t = e.target.closest('[data-gtab]'); if(t){ tab = t.dataset.gtab; render(); return; }
    const b = e.target.closest('[data-g]'); if(!b) return;
    const a = b.dataset.g, id = b.dataset.id, l = L();
    switch(a){
      case 'ask': askSheet([id]); return;
      case 'ask-all': askSheet(players().map(([pid])=>pid)); return;
      case 'adv': case 'dis': Table.send({type:'mods', mode:a}, id); UI.toast(a==='adv' ? 'Преимущество на следующий бросок' : 'Препятствие на следующий бросок', 'ok'); return;
      case 'hurt': hurtSheet(id); return;
      case 'sheet': sheetView(id); return;
      case 'link': TableUI.sheet(); return;
      case 'secret': secret = b.checked; return;
      case 'res': l.res[b.dataset.k] = Math.max(0, int(l.res[b.dataset.k]) + int(b.dataset.d)); saveLance(l); render(); return;
      case 'day': { const n = Math.ceil(int(l.res.people) / 10); l.res.supplies = Math.max(0, int(l.res.supplies) - n); saveLance(l); render(); UI.toast(`Сутки: −${n} Запасов${int(l.res.supplies)===0 ? '. Запасы кончились!' : ''}`, int(l.res.supplies) ? 'ok' : 'fail'); return; }
      case 'lance-roll': {
        const r = (s)=>Dice.roll(s), s = r('6+2к6'), bt = r('6+2к6'), mt = r('6+3к6'), w = r('к6'), pp = r('40+2к6');
        Object.assign(l.res, {supplies:s.total, batteries:bt.total, materials:mt.total, wealth:w.total, people:pp.total});
        if(!l.units.length) [RETINUE[0], RETINUE[0], TECH[0]].forEach(u=>l.units.push(unitFrom(u)));
        saveLance(l); render();
        roll(Rolls.push({who:'Летописец', kind:'gm', title:'Стартовые ресурсы Копья', tone:'info', big:'', verdict:`Запасы ${s.total} · Батареи ${bt.total} · Материалы ${mt.total} · Богатства ${w.total} · Люди ${pp.total}`, lines:[s.text, bt.text, mt.text, w.text, pp.text]})); return; }
      case 'unit-add': { const v = root.querySelector('[data-l="addunit"]').value, u = (v[0]==='r' ? RETINUE : TECH)[+v.slice(1)]; l.units.push(unitFrom(u)); saveLance(l); render(); return; }
      case 'unit-del': l.units = l.units.filter(u=>u.id!==id); saveLance(l); render(); return;
      case 'r-reaction': roll(Rolls.reaction(0)); return;
      case 'r-init': roll(Rolls.initiative('Летописец')); return;
      case 'r-morale': roll(Rolls.morale(7)); return;
      case 'r-salvage': roll(tableRoll('Утилизация обломков', 6, 1, (v)=>SALVAGE[v - 1])); return;
      case 'r-salvage-m': roll(tableRoll('Утилизация Катафракта', 6, 2, SALVAGE_M)); return;
      case 'r-wreck': roll(tableRoll('Оценка разрушений', 6, 2, WRECK)); return;
      case 'r-crit': { const v = Dice.rnd(20); roll(Rolls.push({who:'Летописец', kind:'gm', title:'Критическая травма', tone:'crit', big:v, verdict:KAVA.CRIT_INJURIES[v - 1], lines:[], dice:[{sides:20, value:v, tint:'bad'}]})); return; }
      case 'r-mcrit': { const v = Dice.rnd(20); roll(Rolls.push({who:'Летописец', kind:'gm', title:'Критическое повреждение', tone:'crit', big:v, verdict:MECH.CRITS[v - 1], lines:[], dice:[{sides:20, value:v, tint:'bad'}]})); return; }
      case 'r-tables': Actions.tablesSheet(Tandem.pilot); return;
      case 'lore-seed': case 'lore-system': case 'lore-relic-r': case 'lore-relic-m': case 'lore-t': {
        const x = a==='lore-seed' ? LORE.seed() : a==='lore-system' ? LORE.system() : a==='lore-t' ? LORE.table(b.dataset.k) : LORE.relic(a==='lore-relic-m' ? 'melee' : 'ranged');
        roll(Rolls.push({who:'Летописец', kind:'lore', title:x.title, tone:'info', big:x.big, verdict:x.verdict, lines:x.lines, dice:x.dice})); return; }
    }
  }
  function unitFrom(u){ const r = Dice.roll(u.stk); return {id:Pilot.uid(), name:u.name, stk:r ? r.total : 0, mob:u.mob, note:u.note}; }
  function onInput(e){
    const l = L(), el = e.target;
    if(el.dataset.r){ l.res[el.dataset.r] = Math.max(0, int(el.value)); saveLance(l); return; }
    if(el.dataset.l==='name' || el.dataset.l==='notes'){ l[el.dataset.l] = el.value; clearTimeout(onInput.t); onInput.t = setTimeout(()=>saveLance(l), 600); return; }
    if(el.dataset.u){ const u = l.units.find(x=>x.id===el.dataset.u); if(u){ u[el.dataset.uf] = el.type==='number' ? int(el.value) : el.value; clearTimeout(onInput.t); onInput.t = setTimeout(()=>saveLance(l), 600); } }
  }
  function mount(el){ root = el; root.addEventListener('click', onClick); root.addEventListener('input', onInput); Table.onChange(()=>{ lance = null; if(document.body.classList.contains('gm-view') && tab!=='battle' && !root.contains(document.activeElement)) render(); }); render(); }
  return {mount, render};
})();
