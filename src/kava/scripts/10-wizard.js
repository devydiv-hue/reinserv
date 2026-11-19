/* ======================================================================
   КАВАЛЕРИЯ — МАСТЕР СОЗДАНИЯ ПО ШАГАМ КНИГИ. Спектр: 1 характеристики, 2 происхождение, 3 становление,
   4 экипировка, 5 итоговые параметры, 6 личность. Катафракт: путь (конструктор или готовый класс) → конструкция
   (каркас, утроба, ядро, реактор, сенсоры — каждый можно перебросить) → сенсорные модули → оборудование →
   особенности (каприз, имя, детали). Кости летят в 3D, результат остаётся на шаге; всё выпавшее — в журнал.
   Работает над черновиком: «Готово» записывает его в тандем (новый Спектр — новым тандемом).
   ====================================================================== */
const Wizard = (function(){
  const esc = kvEsc, int = (v, d)=>Pilot.int(v, d);
  let ov = null, st = null;
  const clone = (x)=>JSON.parse(JSON.stringify(x));
  function open(state){
    st = state; close(true);
    ov = document.createElement('div'); ov.className = 'kv-sheet-back kv-wiz-back';
    ov.innerHTML = '<div class="kv-sheet kv-wizard" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(ov); requestAnimationFrame(()=>ov && ov.classList.add('show'));
    ov.addEventListener('click', onClick); ov.addEventListener('input', onInput);
    draw();
  }
  function close(silent){ if(!ov) return; const o = ov; ov = null; o.classList.remove('show'); setTimeout(()=>o.remove(), 180); if(!silent) st = null; }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && ov && !UI.isOpen){ if(confirm('Закрыть мастер? Несохранённые шаги пропадут.')) close(); } });
  const log = (title, x)=>Rolls.push({who:st.draft.name || (st.kind==='m' ? 'Катафракт' : 'Спектр'), kind:'create', title, tone:'info', big:'', verdict:x.summary || '', lines:x.lines, dice:x.dice});
  // бросок шага: анимация, запись в черновик и журнал
  function rollStep(key, fn, title){
    const x = fn(); x.apply(st.draft); st.res[key] = x; log(title, x);
    draw();
    if(x.dice && x.dice.length) Dice3D.roll(x.dice.slice(0, 8), {dim:false}).then(t=>setTimeout(()=>Dice3D.clear(t), 900));
  }
  const res = (key)=>st.res[key] ? `<div class="kv-wiz-res">${st.res[key].lines.map(l=>`<div>${esc(l)}</div>`).join('')}</div>` : '';
  const rollBtn = (act, label, done)=>`<button type="button" class="kv-btn ${done ? '' : 'kv-primary'}" data-w="${act}">${done ? '⚄ Перебросить' : '⚄ ' + (label || 'Бросить')}</button>`;

  // ---------- Спектр ----------
  const P_STEPS = [
    {t:'Характеристики', body(){ const d = st.draft;
      return `<p class="kv-p">Начальное значение 0. Для каждой характеристики бросьте к6 три раза: +1 за каждую 4 или 5, +2 за 6.</p>
        ${rollBtn('stats', 'Бросить характеристики', st.res.stats)}${res('stats')}
        <div class="kv-wiz-stats">${KAVA.STATS.map(s=>`<label><b>${s.short}</b><em>${s.name}</em><input type="number" data-wf="stats.${s.key}" value="${int(d.stats[s.key])}"></label>`).join('')}</div>`; }},
    {t:'Происхождение', body(){ const d = st.draft;
      return `<p class="kv-p">Культура — 2к6, её Ремесло — к6, дополнительное Ремесло из Общих — к66. Культура или Ремесло дают успех без проверки в тривиальном для такого опыта деле или преимущество там, где опыт помогает.</p>
        ${rollBtn('culture', 'Бросить Культуру и Ремёсла', st.res.culture)}${res('culture')}
        <label class="kv-fe kv-wide"><span>Культура</span><textarea data-wf="culture" rows="2">${esc(d.culture)}</textarea></label>
        <label class="kv-fe kv-wide"><span>Ремесло</span><textarea data-wf="craft" rows="2">${esc(d.craft)}</textarea></label>
        <label class="kv-fe kv-wide"><span>Общее ремесло</span><textarea data-wf="craft2" rows="2">${esc(d.craft2)}</textarea></label>`; }},
    {t:'Становление', body(){ const d = st.draft;
      return `<p class="kv-p">Как персонаж стал Спектром — Пробуждение (к66) — и как он избавляется от Отдачи — Ритуал декомпрессии (к66).</p>
        ${rollBtn('becoming', 'Бросить Становление', st.res.becoming)}${res('becoming')}
        <label class="kv-fe kv-wide"><span>Пробуждение</span><textarea data-wf="awakening" rows="2">${esc(d.awakening)}</textarea></label>
        <label class="kv-fe kv-wide"><span>Ритуал декомпрессии</span><textarea data-wf="ritual" rows="3">${esc(d.ritual)}</textarea></label>`; }},
    {t:'Экипировка', body(){ const g = st.gear;
      return `<p class="kv-p">У каждого Спектра — боевой пояс (набор выживания), мембрана и ритуальный клинок Урс. Распределите 6 бросков между таблицами.</p>
        <div class="kv-sheet-grid">${UI.stepper('ga', g.a, 0, 6, 'Доспехи к6')}${UI.stepper('gw', g.w, 0, 6, 'Вооружение к6')}${UI.stepper('gg', g.g, 0, 6, 'Снаряжение к66')}</div>
        <div class="kv-note ${g.a + g.w + g.g===6 ? '' : 'kv-warn'}">Бросков: ${g.a + g.w + g.g} из 6</div>
        ${g.a + g.w + g.g===6 ? rollBtn('gear', 'Бросить экипировку', st.res.gear) : ''}${res('gear')}`; }},
    {t:'Параметры', body(){ const d = st.draft, m = Pilot.mob(d);
      return `<p class="kv-p">СТК = 6 + СОМ, МОБ = 10 + МОТ (доспехи и нагрузка учтены), Испытание Удачи — 13, кость синхронизации — к6.</p>
        <div class="kv-wiz-stats"><label><b>${Pilot.stkMax(d)}</b><em>СТК</em></label><label><b>${m.total}</b><em>МОБ</em></label><label><b>${Pilot.luck(d)}</b><em>Удача</em></label><label><b>к6</b><em>кС</em></label></div>
        <div class="kv-note">Нагрузка: ${Pilot.load(d).eff} — ${Pilot.load(d).name} (${Pilot.slotsUsed(d)} СЛ)</div>`; }},
    {t:'Личность', body(){ const d = st.draft;
      return `<div class="kv-row2"><input class="kv-name-in kv-grow2" data-wf="name" value="${esc(d.name)}" placeholder="Имя Спектра"><div class="kv-chips2" data-wchips="g">${['any:любое', 'm:мужское', 'f:женское'].map(x=>{ const [k, l] = x.split(':'); return `<button type="button" class="kv-chip${st.gender===k ? ' on' : ''}" data-wg="${k}">${l}</button>`; }).join('')}</div>${rollBtn('name', 'Имя', st.res.name)}</div>
        <div class="kv-row2">${rollBtn('look', 'Облик', st.res.look)}${rollBtn('talisman', 'Талисман', st.res.talisman)}</div>
        <label class="kv-fe kv-wide"><span>Облик</span><textarea data-wf="look" rows="2">${esc(d.look)}</textarea></label>
        <label class="kv-fe kv-wide"><span>Талисман</span><textarea data-wf="talisman" rows="2">${esc(d.talisman)}</textarea></label>
        <p class="kv-p">Пять ответов — Воспоминания Спектра. Утратив все, он станет Опустошённым.</p>
        ${d.memories.map((m, i)=>`<label class="kv-fe kv-wide"><span>${i + 1}. ${esc(m.q)}</span><textarea data-wf="memories.${i}.a" rows="2">${esc(m.a)}</textarea></label>`).join('')}`; }}
  ];
  // ---------- Катафракт ----------
  const M_STEPS = [
    {t:'Путь', body(){ return `<p class="kv-p">Соберите новую машину бросками по таблицам — или возьмите готовый класс и продолжите с оборудования.</p>
      <div class="kv-act-grid"><button type="button" class="kv-act${st.path==='build' ? ' on' : ''}" data-w="path" data-v="build"><b>Конструктор</b><span>Каркас, Утроба, Ядро, Реактор, Сенсоры — броски к6</span></button>
      ${MECH.CLASSES.map((c, i)=>`<button type="button" class="kv-act${st.path==='c' + i ? ' on' : ''}" data-w="path" data-v="c${i}"><b>${esc(c.name)}</b><span>${esc(MECH.FRAMES.find(f=>f.key===c.frame).name)} · СТК ${c.stk} · ${esc(c.desc.split('.').slice(-2, -1)[0] || '')}</span></button>`).join('')}</div>`; }},
    {t:'Конструкция', skip:()=>st.path!=='build', body(){ const m = st.draft.mech, row = (k, l, val)=>`<div class="kv-wiz-row"><b>${l}</b><span>${esc(val)}</span><button type="button" class="kv-die" data-w="${k}" title="Перебросить">⚄</button></div>`;
      const f = Pilot.frameOf(m), c = Pilot.coreOf(m), R = Pilot.reactorOf(m), S = Pilot.sensorOf(m), W = Pilot.womb(m);
      return `<p class="kv-p">Каркас определяет МОБ и СТК, Утроба — что будет при её повреждении, Ядро — Отчуждённость и характер, Реактор — СЛ и особенности кР, Сенсоры — бонус и дополнительные модули.</p>
        ${rollBtn('all', 'Бросить всё', st.res.frame)}
        ${st.res.frame ? row('frame', 'Каркас', `${f.name}: МОБ ${f.mob}, СТК ${m.stkMax}${f.note ? '. ' + f.note : ''}`) + row('womb', 'Утроба', `${W.name}: ${W.text}`) + row('core', 'Ядро', `${c.name}, Отчуждённость ${c.alien}. ${m.nature}`)
          + row('reactor', 'Реактор', `${R.name}, ${R.sl} СЛ${R.note ? '. ' + R.note : ''}`) + row('sensors', 'Сенсоры', `${S.name} +${S.bonus}, ${S.sl} СЛ, ${S.range}`) : ''}`; }},
    {t:'Сенсоры', skip:()=>st.path!=='build', body(){ const m = st.draft.mech, S = Pilot.sensorOf(m);
      return `<p class="kv-p">${esc(S.name)} сенсоры — ${S.modules} доп. модул${S.modules===1 ? 'ь' : 'я'}. Все детекторы уже имеют аудиовизуальный модуль и радар.</p>
        <div class="kv-act-grid">${MECH.SENSOR_MODULES.map(x=>`<button type="button" class="kv-act${m.sensorModules.includes(x.name) ? ' on' : ''}" data-w="smod" data-v="${esc(x.name)}"><b>${esc(x.name)}</b><span>${esc(x.text)}</span></button>`).join('')}</div>
        <div class="kv-note ${m.sensorModules.length===S.modules ? '' : 'kv-warn'}">Выбрано ${m.sensorModules.length} из ${S.modules}</div>`; }},
    {t:'Оборудование', body(){ const d = st.draft, m = d.mech, L = Pilot.mechLoad(d), mob = Pilot.mechMob(d), all = st.allValues;
      const ok = (t)=>all || !t.value || /хлам|находка/i.test(t.value);
      const group = (label, list, key)=>`<optgroup label="${label}">${list.map((t, i)=>ok(t) ? `<option value="${key}:${i}">${esc(t.name)}${t.dmg ? ' (' + esc(t.dmg) + ')' : ''} · ${t.sl} СЛ${t.value ? ' · ' + t.value : ''}</option>` : '').join('')}</optgroup>`;
      return `<p class="kv-p">Заполните СЛ Вооружением, Модулями (Хлам и Находка) и расходниками. Нагрузка снижает МОБ и добавляет к броскам кР; каркас игнорирует часть нагрузки.</p>
        <div class="kv-row2"><select class="kv-grow2" data-wsel="1"><option value="">— добавить —</option>${group('Расходники', MECH.CONSUMABLES, 'cons')}${group('Кинетическое', MECH.KINETIC, 'kin')}${group('Ракетное', MECH.MISSILES, 'mis')}${group('Лучевое', MECH.BEAMS, 'beam')}${group('Ближний бой', MECH.MELEE, 'mel')}${group('Модули', MECH.MODULES, 'mod')}</select>
          <button type="button" class="kv-btn kv-primary" data-w="add">Добавить</button></div>
        <label class="kv-chk"><input type="checkbox" data-wall="1"${all ? ' checked' : ''}> показывать Редкость и Реликт</label>
        <div class="kv-wiz-items">${m.items.map(it=>`<div class="kv-wiz-row"><b>${esc(it.name)}</b><span>${it.kind==='weapon' ? esc(it.dmg) + ' · ' : ''}${int(it.sl)} СЛ</span><button type="button" class="kv-x" data-w="del" data-id="${it.id}">✕</button></div>`).join('') || '<div class="kv-empty">Пока пусто</div>'}</div>
        <div class="kv-note">${L.sl} СЛ · нагрузка ${L.eff} — ${L.name} · МОБ ${mob.total}${L.krMod ? ` · +${L.krMod} к броскам кР` : ''}</div>`; }},
    {t:'Особенности', body(){ const m = st.draft.mech;
      return `<div class="kv-row2"><input class="kv-name-in kv-grow2" data-wf="mech.name" value="${esc(m.name)}" placeholder="Имя Катафракта">${rollBtn('mname', 'Имя', st.res.mname)}</div>
        <div class="kv-row2">${rollBtn('quirk', 'Каприз', st.res.quirk)}${rollBtn('details', 'Детали', st.res.details)}</div>
        ${['quirk:Каприз', 'origin:Происхождение', 'camo:Камуфляж', 'inside:Внутри Утробы', 'marks:Отметины'].map(x=>{ const [k, l] = x.split(':'); return `<label class="kv-fe kv-wide"><span>${l}</span><textarea data-wf="mech.${k}" rows="2">${esc(m[k])}</textarea></label>`; }).join('')}`; }}
  ];
  const steps = ()=>(st.kind==='p' ? P_STEPS : M_STEPS);
  function draw(){
    if(!ov) return;
    const list = steps(), s = list[st.i], vis = list.filter(x=>!x.skip || !x.skip()), n = vis.indexOf(s) + 1;
    ov.querySelector('.kv-wizard').innerHTML = `<div class="kv-sheet-head"><div class="kv-sheet-title">${st.kind==='p' ? (st.fresh ? 'Новый Спектр' : 'Спектр по книге') : 'Катафракт по книге'}<small>Шаг ${n} из ${vis.length}: ${s.t}</small></div><button type="button" class="kv-x" data-w="close" aria-label="Закрыть">✕</button></div>
      <div class="kv-wiz-dots">${vis.map((x, i)=>`<span class="${i + 1 < n ? 'done' : i + 1===n ? 'on' : ''}">${esc(x.t)}</span>`).join('')}</div>
      <div class="kv-sheet-body">${s.body()}</div>
      <div class="kv-sheet-btns kv-wiz-nav"><button type="button" class="kv-btn" data-w="back"${n===1 ? ' disabled' : ''}>Назад</button>
        <button type="button" class="kv-btn kv-primary kv-grow2" data-w="next">${n===vis.length ? 'Готово' : 'Дальше'}</button></div>`;
  }
  function move(dir){
    const list = steps(); let i = st.i;
    do{ i += dir; }while(i >= 0 && i < list.length && list[i].skip && list[i].skip());
    if(i < 0) return;
    if(i >= list.length){ finish(); return; }
    st.i = i; draw(); ov.querySelector('.kv-sheet-body').scrollTop = 0;
  }
  function finish(){
    const d = st.draft;
    if(st.kind==='p'){
      d.stk = Pilot.stkMax(d);
      if(st.fresh){ Pilot.add(d); App.show(d); }
      else { const keep = st.target.mech; Object.assign(st.target, d, {id:st.target.id, mech:keep}); Pilot.save(); App.show(st.target); }
    } else {
      d.mech.built = true; if(!d.mech.stk) d.mech.stk = d.mech.stkMax;
      st.target.mech = d.mech; Pilot.save(); App.show(st.target);
    }
    UI.toast(st.kind==='p' ? 'Спектр готов' : 'Катафракт готов', 'ok');
    if(typeof Table!=='undefined') Table.pilotChanged();
    close();
  }
  function setW(path, v){ const parts = path.split('.'); let o = st.draft; for(let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = v; }
  function onInput(e){
    const f = e.target.closest('[data-wf]'); if(f){ setW(f.dataset.wf, f.type==='number' ? int(f.value) : f.value); return; }
    if(e.target.name==='ga' || e.target.name==='gw' || e.target.name==='gg'){ st.gear = {a:int(ov.querySelector('[name=ga]').value), w:int(ov.querySelector('[name=gw]').value), g:int(ov.querySelector('[name=gg]').value)}; delete st.res.gear; draw(); }
    if(e.target.dataset.wall){ st.allValues = e.target.checked; draw(); }
  }
  function onClick(e){
    if(e.target===ov){ return; }
    const stp = e.target.closest('[data-step]');
    if(stp){ const inp = stp.parentNode.querySelector('input'); inp.value = Math.max(0, Math.min(6, int(inp.value) + (+stp.dataset.step))); inp.dispatchEvent(new Event('input', {bubbles:true})); return; }
    const g = e.target.closest('[data-wg]'); if(g){ st.gender = g.dataset.wg; draw(); return; }
    const b = e.target.closest('[data-w]'); if(!b) return;
    const a = b.dataset.w, d = st.draft, m = d.mech;
    switch(a){
      case 'close': if(confirm('Закрыть мастер? Несохранённые шаги пропадут.')) close(); return;
      case 'back': move(-1); return;
      case 'next': move(1); return;
      case 'stats': rollStep('stats', Create.stats, 'Характеристики'); return;
      case 'culture': rollStep('culture', Create.culture, 'Культура и Ремёсла'); return;
      case 'becoming': rollStep('becoming', Create.becoming, 'Становление'); return;
      case 'gear': rollStep('gear', ()=>Create.gear(st.gear.a, st.gear.w, st.gear.g), 'Экипировка'); return;
      case 'name': rollStep('name', ()=>Create.name(st.gender), 'Имя'); return;
      case 'look': rollStep('look', Create.look, 'Облик'); return;
      case 'talisman': rollStep('talisman', Create.talisman, 'Талисман'); return;
      case 'path':
        st.path = b.dataset.v;
        if(st.path==='build'){ d.mech = Object.assign(Pilot.blankMech(), {name:m.cls ? '' : m.name}); delete st.res.frame; }
        else { const c = MECH.CLASSES[+st.path.slice(1)]; Create.applyClass(d, c); st.res.frame = {lines:[c.desc], dice:[]}; }
        draw(); return;
      case 'all': { const parts = [Create.frame(), Create.womb(), Create.core(), Create.reactor(), Create.sensors()]; parts.forEach(x=>x.apply(d));
        const x = {lines:[].concat(...parts.map(q=>q.lines)), dice:[].concat(...parts.map(q=>q.dice)).slice(0, 8), summary:parts.map(q=>q.summary).join(' · ')};
        st.res.frame = x; log('Конструкция Катафракта', x); draw(); Dice3D.roll(x.dice, {dim:false}).then(t=>setTimeout(()=>Dice3D.clear(t), 900)); return; }
      case 'frame': case 'womb': case 'core': case 'reactor': case 'sensors': {
        const x = Create[a](); x.apply(d); log('Катафракт: ' + a, x); st.res.frame = st.res.frame || x; draw(); Dice3D.roll(x.dice, {dim:false}).then(t=>setTimeout(()=>Dice3D.clear(t), 900)); return; }
      case 'smod': { const n = b.dataset.v, l = m.sensorModules, i = l.indexOf(n); if(i >= 0) l.splice(i, 1); else l.push(n); draw(); return; }
      case 'add': { const s = ov.querySelector('[data-wsel]'), it = s && Tandem.fromCatalog(s.value); if(it){ m.items.push(it); draw(); } return; }
      case 'del': m.items = m.items.filter(x=>x.id!==b.dataset.id); draw(); return;
      case 'mname': rollStep('mname', Create.mechName, 'Имя Катафракта'); return;
      case 'quirk': rollStep('quirk', Create.quirk, 'Каприз'); return;
      case 'details': rollStep('details', Create.details, 'Детали Катафракта'); return;
    }
  }
  // ---------- точки входа ----------
  function pilot(p, opts){
    const fresh = !!(opts && opts.fresh), draft = fresh ? Pilot.starter() : clone(p);
    if(fresh) draft.id = Pilot.uid();
    let g = {a:2, w:2, g:2}; try{ const pr = JSON.parse(localStorage.getItem('reincarnator_kava_app_v1') || '{}'); if(pr.armor!=null) g = {a:int(pr.armor), w:int(pr.weapons), g:int(pr.gear)}; }catch(e){}
    open({kind:'p', i:0, draft, target:p, fresh, res:{}, gear:g, gender:'any'});
  }
  function mech(p){ const draft = clone(p); if(!draft.mech.built){ draft.mech = Pilot.blankMech(); } open({kind:'m', i:0, draft, target:p, res:{}, path:'build', allValues:false}); }
  function classes(p){ const draft = clone(p); draft.mech = Pilot.blankMech(); draft.mech.name = p.mech.name; Create.applyClass(draft, MECH.CLASSES[0]); open({kind:'m', i:0, draft, target:p, res:{frame:{lines:[MECH.CLASSES[0].desc], dice:[]}}, path:'c0', allValues:false}); }
  return {pilot, mech, classes};
})();
