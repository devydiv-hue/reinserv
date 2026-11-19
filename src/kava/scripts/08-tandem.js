/* ======================================================================
   КАВАЛЕРИЯ — ЛИСТ ТАНДЕМА. Как на чарнике: слева Спектр, в центре «хребет» (СОМ/МОТ/КОГ/ЭМП, Удача, кС, кР),
   справа Катафракт. Режим «Игра» — крупные значения и действия в одно касание (data-a), «Правка» — поля (data-f,
   путь в модели: name, stats.som, items.<id>.name, mech.items.<id>.dmg …). На телефоне колонки — вкладки
   (body[data-tab]), хребет — полоса сверху. Производные значения (data-d) пересчитываются без перерисовки.
   ====================================================================== */
const Tandem = (function(){
  let root = null, p = null, mode = 'play', saveTimer = 0;
  const int = (v, d)=>Pilot.int(v, d), esc = kvEsc, plus = UI.plus;
  const statShort = (k)=>(KAVA.STATS.find(s=>s.key===k) || {}).short || k;
  const tags = (s)=>String(s || '').split(',').map(x=>x.trim()).filter(Boolean).map(t=>`<span class="kv-tag">${esc(t)}</span>`).join('');
  const bar = (cur, max, cls)=>{ const pc = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0; return `<span class="kv-hp ${cls || ''}"><i style="width:${pc}%"></i></span>`; };
  const field = (path, val, attrs)=>`<input data-f="${path}" value="${esc(val)}" ${attrs || ''}>`;
  const numF = (path, val, attrs)=>`<input type="number" inputmode="numeric" data-f="${path}" data-num="1" value="${esc(val)}" ${attrs || ''}>`;
  const area = (path, val, rows, ph)=>`<textarea data-f="${path}" rows="${rows || 2}" placeholder="${esc(ph || '')}">${esc(val)}</textarea>`;
  const sel = (path, list, cur, attrs)=>`<select data-f="${path}" ${attrs || ''}>${list.map(o=>`<option value="${esc(o[0])}"${String(o[0])===String(cur) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  const sec = (title, body, extra)=>`<section class="kv-sec2"><h3>${title}${extra || ''}</h3>${body}</section>`;
  const fold = (key, title, body)=>`<details class="kv-fold" data-fold="${key}"${App.folded(key) ? '' : ' open'}><summary>${title}</summary>${body}</details>`;

  // ---------- хребет ----------
  function spine(){
    const m = p.mech, krIdx = Dice.STEPS.indexOf(+m.kr), heatPc = Math.max(0, (krIdx - 1) / 3 * 100);
    return `<div class="kv-spine">
      <div class="kv-stats4">${KAVA.STATS.map(s=>`<button type="button" class="kv-stat4" data-a="check" data-k="${s.key}" title="Проверка ${s.name}: к20 + ${s.short} против сложности. ${esc(s.hint)}">
        <b>${s.short}</b><span data-d="stat-${s.key}">${plus(Pilot.stat(p, s.key))}</span></button>`).join('')}</div>
      <div class="kv-spine-row">
        <button type="button" class="kv-pill" data-a="luck" title="Испытание Удачи: к20 против сложности"><small>Удача</small><b data-d="luck">${Pilot.luck(p)}</b></button>
        <button type="button" class="kv-pill kv-ks" data-a="ks" title="Синхронизация: подключение, Отдача, рост, погружение"><small>кС</small><b>к${p.ks}</b></button>
        <button type="button" class="kv-pill kv-kr${krIdx >= 3 ? ' hot' : krIdx >= 2 ? ' warm' : ''}" data-a="kr" title="Реактор: Форсаж, модули, радиаторы, остыть"><small>кР</small><b>к${m.kr}</b><span class="kv-heat"><i style="width:${heatPc}%"></i></span></button>
      </div>
    </div>`;
  }

  // ---------- Спектр: игра ----------
  function pilotPlay(){
    const mob = Pilot.mob(p), L = Pilot.load(p), max = Pilot.stkMax(p), ws = Pilot.weapons(p), gear = p.items.filter(it=>it.kind!=='weapon');
    const down = int(p.stk) <= 0;
    return `<div class="kv-col kv-col-p" data-col="p">
      <div class="kv-head"><div class="kv-kicker">Спектр</div><h2>${esc(p.name || 'Безымянный Спектр')}</h2>
        <div class="kv-sub">${esc([p.culture.split(':')[0], (p.craft || '').split(' – ')[0]].filter(Boolean).join(' · ') || 'Нажмите «Правка», чтобы заполнить, или создайте Спектра по книге')}</div></div>
      <div class="kv-vitals2">
        <div class="kv-vit${down ? ' danger' : ''}"><small>СТК</small><div class="kv-vit-row"><button type="button" class="kv-mini-btn" data-a="p-stk" data-d="-1" aria-label="минус 1">−</button><b>${int(p.stk)}<span>/${max}</span></b><button type="button" class="kv-mini-btn" data-a="p-stk" data-d="1" aria-label="плюс 1">+</button></div>${bar(int(p.stk), max)}
          <button type="button" class="kv-link" data-a="p-hurt">Получить урон</button></div>
        <div class="kv-vit" title="10 + МОТ ${mob.mot}${mob.armor ? ' + доспех ' + mob.armor : ''}${mob.load ? ' − нагрузка ' + mob.load : ''}"><small>МОБ</small><b class="kv-big2">${mob.total}</b><span class="kv-why">${mob.armor ? 'доспех +' + mob.armor : ''}${mob.load ? ' нагрузка −' + mob.load : ''}</span></div>
      </div>
      ${down ? `<div class="kv-alert">0 СТК — Спектр без сознания. <button type="button" class="kv-btn" data-a="scar">Травма вместо смерти</button></div>` : ''}
      ${sec('Вооружение', ws.length ? `<div class="kv-cards">${ws.map(w=>weaponCard(w, 'p')).join('')}</div>` : '<div class="kv-empty">Нет оружия</div>')}
      ${sec('Снаряжение', `<div class="kv-gear">${gear.map(it=>gearRow(it, 'p')).join('') || '<div class="kv-empty">Пусто</div>'}</div>
        <div class="kv-load-line">${L.sl} из ${KAVA.SLOTS} СЛ · нагрузка ${L.eff} — ${L.name}${L.eff ? `, −${L.eff} МОБ` : ''}</div>`)}
      ${p.injuries.length ? sec('Критические травмы', `<ul class="kv-list2">${p.injuries.map(x=>`<li>${esc(x.text)}</li>`).join('')}</ul>`) : ''}
      ${fold('p-mem', 'Воспоминания', `<ol class="kv-mems">${p.memories.map((m, i)=>`<li class="${m.lost ? 'lost' : ''}"><span>${esc(m.q)}</span><b>${esc(m.a || '—')}</b>
        <button type="button" class="kv-link" data-a="mem" data-i="${i}">${m.lost ? 'вернуть' : 'утрачено'}</button></li>`).join('')}</ol>`)}
      ${fold('p-bio', 'Предыстория и детали', `<dl class="kv-dl">${[['Культура', p.culture], ['Ремесло', p.craft], ['Общее ремесло', p.craft2], ['Пробуждение', p.awakening], ['Ритуал декомпрессии', p.ritual],
        ['Облик', p.look], ['Талисман', p.talisman], ['Аугментации', p.augments], ['Репутация', (int(p.campaigns) ? `походов: ${p.campaigns}. ` : '') + (p.reputation || '')], ['Заметки', p.notes]]
        .filter(x=>x[1]).map(x=>`<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join('') || '<div class="kv-empty">Пусто</div>'}</dl>`)}
    </div>`;
  }
  function weaponCard(w, side){
    const st = w.stat || 'mot', bonus = Pilot.stat(p, st);
    const type = w.type ? MECH.WEAPON_TYPES[w.type] : '';
    return `<button type="button" class="kv-wcard" data-a="${side}-weapon" data-id="${w.id}">
      <span class="kv-wcard-top"><b>${esc(w.name || 'Оружие')}</b><span class="kv-dmg">${esc(w.dmg || '—')}</span></span>
      <span class="kv-wcard-meta"><span>${esc(w.range || '')} ${KAVA.RANGES[w.range] || ''}</span><span class="kv-acc">${statShort(st)} ${plus(bonus)}</span>${type ? `<span>${type}</span>` : ''}</span>
      ${w.tags ? `<span class="kv-tags">${tags(w.tags)}</span>` : ''}</button>`;
  }
  function gearRow(it, side){
    const cap = Rolls.itemCap(it), armor = it.kind==='armor';
    return `<div class="kv-grow-row${armor && !it.worn ? ' off' : ''}">
      <button type="button" class="kv-gname" data-a="${side}-item" data-id="${it.id}">${esc(it.name || 'Предмет')}${armor ? `<small>${it.mob ? '+' + it.mob + ' МОБ ' : ''}${it.armor ? it.armor + ' кВ' : ''}${it.worn ? '' : ' · не надет'}</small>` : ''}</button>
      <span class="kv-sl">${int(it.sl)} СЛ</span>${UI.dots(int(it.marks), cap, side + '-mark', it.id)}
      <button type="button" class="kv-die" data-a="${side}-kv" data-id="${it.id}" title="Кость расхода: к6, метка на 4+">⚄</button></div>`;
  }

  // ---------- Катафракт: игра ----------
  function mechPlay(){
    const m = p.mech;
    if(!m.built && !m.name && !m.items.length) return `<div class="kv-col kv-col-m" data-col="m"><div class="kv-head"><div class="kv-kicker">Катафракт</div><h2>Нет Катафракта</h2></div>
      <div class="kv-cta"><p>Соберите машину по книге: Каркас, Утроба, Ядро, Реактор и Сенсоры — или возьмите один из шести готовых классов.</p>
      <button type="button" class="kv-btn kv-primary" data-a="wizard-m">Собрать по книге</button><button type="button" class="kv-btn" data-a="class-m">Готовый класс</button></div></div>`;
    const f = Pilot.frameOf(m), core = Pilot.coreOf(m), R = Pilot.reactorOf(m), S = Pilot.sensorOf(m), mob = Pilot.mechMob(p), L = Pilot.mechLoad(p);
    const ws = Pilot.mechWeapons(p), mods = m.items.filter(it=>it.kind==='module'), down = int(m.stk) <= 0;
    const cons = MECH.CONSUMABLES.map(c=>{ const list = Pilot.consumables(p, c.ckey); if(!list.length) return '';
      const left = list.reduce((s, it)=>s + 3 - int(it.marks), 0);
      return `<button type="button" class="kv-cons${left ? '' : ' empty'}" data-a="m-cons" data-k="${c.ckey}" title="${esc(c.text)}"><b>${c.name}</b><span>${list.length > 1 ? list.length + ' × ' : ''}к6 · ${left} из ${list.length * 3}</span></button>`; }).join('');
    return `<div class="kv-col kv-col-m" data-col="m">
      <div class="kv-head"><div class="kv-kicker">Катафракт</div><h2>${esc(m.name || 'Безымянный Катафракт')}</h2>
        <div class="kv-sub">${esc([m.cls, f.name + (f.fast ? ' · Быстрый' : f.slow ? ' · Медленный' : ''), `Ядро ${core.name}`, R.name].filter(Boolean).join(' · '))}</div></div>
      <div class="kv-vitals2">
        <div class="kv-vit${down ? ' danger' : ''}"><small>СТК</small><div class="kv-vit-row"><button type="button" class="kv-mini-btn" data-a="m-stk" data-d="-1" aria-label="минус 1">−</button><b>${int(m.stk)}<span>/${int(m.stkMax)}</span></b><button type="button" class="kv-mini-btn" data-a="m-stk" data-d="1" aria-label="плюс 1">+</button></div>${bar(int(m.stk), int(m.stkMax))}
          <button type="button" class="kv-link" data-a="m-hurt">Получить урон</button></div>
        <div class="kv-vit" title="Каркас ${mob.base} + МОТ ${mob.mot}${mob.load ? ' − нагрузка ' + mob.load : ''}"><small>МОБ</small><b class="kv-big2">${mob.total}</b><span class="kv-why">${mob.load ? 'нагрузка −' + mob.load : ''}</span></div>
        <button type="button" class="kv-vit kv-vit-btn" data-a="m-sensors" title="Проверка Сенсоров: к20 + бонус Сенсоров"><small>Сенсоры</small><b class="kv-big2">${plus(Pilot.sensorBonus(p))}</b><span class="kv-why">${esc(S.name)}</span></button>
      </div>
      ${down ? `<div class="kv-alert">0 СТК — каждое новое попадание наносит Критическое повреждение.</div>` : ''}
      ${f.fast || f.slow ? `<button type="button" class="kv-btn kv-wide" data-a="m-frame">${f.fast ? 'Рывок Скаута: +кР к МОБ на ход' : 'Ремонт Дредноута: +кР к СТК'}</button>` : ''}
      ${cons ? sec('Расходники', `<div class="kv-cons-row">${cons}</div>`) : ''}
      ${sec('Вооружение', ws.length ? `<div class="kv-cards">${ws.map(w=>weaponCard(w, 'm')).join('')}</div>` : '<div class="kv-empty">Нет вооружения</div>')}
      ${mods.length ? sec('Модули', `<div class="kv-gear">${mods.map(it=>`<div class="kv-grow-row${it.off ? ' off' : ''}">
        <button type="button" class="kv-gname" data-a="m-module" data-id="${it.id}">${esc(it.name)}<small>${int(it.sl)} СЛ${it.off ? ' · отключён' : ''}${it.kr ? ' · кР' : ''}${it.used ? ' · использован' : ''}</small></button>
        ${it.kv ? UI.dots(int(it.marks), 3, 'm-mark', it.id) : ''}
        ${it.kr || it.kv ? `<button type="button" class="kv-btn kv-sm" data-a="m-use" data-id="${it.id}">${it.kv ? 'к6' : 'Включить'}</button>` : ''}</div>`).join('')}</div>`) : ''}
      ${m.crits.length ? sec('Критические повреждения', `<ul class="kv-list2">${m.crits.map(x=>`<li>${esc(x.text)}</li>`).join('')}</ul>`) : ''}
      <div class="kv-load-line">${L.sl} СЛ · нагрузка ${L.eff} — ${L.name}${L.eff ? `, −${L.eff} МОБ` : ''}${L.krMod ? `, +${L.krMod} к броскам кР` : ''}</div>
      ${fold('m-core', `Ядро · Отчуждённость ${core.alien}`, `<p class="kv-p">${esc(m.nature || 'Характер не определён')}</p>
        <div class="kv-row2"><button type="button" class="kv-btn kv-primary" data-a="m-divesheet">${m.dive && m.dive.active ? 'Погружение: Измерение ' + m.dive.dim : 'Погружение в Ядро'}</button><button type="button" class="kv-btn" data-a="m-alien">Испытание Отчуждённости</button></div>
        ${(m.giftList || []).length ? `<ul class="kv-list2">${m.giftList.map(g=>`<li>${esc(g.text)}${g.n > 1 ? ' <b>×' + g.n + '</b>' : ''}</li>`).join('')}</ul>` : ''}
        <dl class="kv-dl">${[['Дары Ядра (заметки)', m.gifts], ['Узлы', m.nodes]].filter(x=>x[1]).map(x=>`<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl>`)}
      ${fold('m-bio', 'Конструкция и детали', `<dl class="kv-dl">${[['Каркас', `${f.name} (${f.mass}), МОБ ${f.mob}${f.note ? '. ' + f.note : ''}`], ['Утроба', Pilot.womb(m).name + ': ' + Pilot.womb(m).text],
        ['Реактор', `${R.name}, ${R.sl} СЛ${R.note ? '. ' + R.note : ''}`], ['Сенсоры', `${S.name} ${plus(Pilot.sensorBonus(p))}, дистанция ${S.range}${m.sensorModules.length ? '. Модули: ' + m.sensorModules.join(', ') : ''}`],
        ['Каприз', m.quirk], ['Происхождение', m.origin], ['Камуфляж', m.camo], ['Внутри Утробы', m.inside], ['Отметины', m.marks], ['Заметки', m.notes]]
        .filter(x=>x[1]).map(x=>`<dt>${x[0]}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl>`)}
    </div>`;
  }

  // ---------- правка ----------
  function pilotEdit(){
    const L = Pilot.load(p);
    return `<div class="kv-col kv-col-p kv-edit" data-col="p">
      <div class="kv-head"><div class="kv-kicker">Спектр · правка</div>${field('name', p.name, 'class="kv-name-in" placeholder="Имя Спектра" maxlength="80"')}
        <div class="kv-row2"><button type="button" class="kv-btn kv-primary" data-a="wizard-p">Создать по книге (по шагам)</button></div></div>
      ${sec('Характеристики', `<div class="kv-grid4e">${KAVA.STATS.map(s=>`<label class="kv-fe"><span>${s.short} <em>${s.name}</em></span>${numF('stats.' + s.key, p.stats[s.key], 'min="-5" max="12"')}<span class="kv-mini">бонус ${numF('bonus.' + s.key, p.bonus[s.key])}</span></label>`).join('')}</div>
        <div class="kv-grid4e"><label class="kv-fe"><span>СТК сейчас</span>${numF('stk', p.stk)}</label><label class="kv-fe"><span>макс. СТК ±</span>${numF('stkMaxMod', p.stkMaxMod)}</label>
        <label class="kv-fe"><span>МОБ ±</span>${numF('mobMod', p.mobMod)}</label><label class="kv-fe"><span>Удача ±</span>${numF('luckMod', p.luckMod)}</label>
        <label class="kv-fe"><span>кС</span>${sel('ks', Dice.STEPS.filter(x=>x >= 6).map(x=>[x, 'к' + x]), p.ks, 'data-num="1"')}</label><label class="kv-fe"><span>+ к росту кС</span>${numF('ksBonus', p.ksBonus)}</label>
        <label class="kv-fe"><span>травм вместо смерти</span>${numF('scars', p.scars, 'min="0"')}</label><label class="kv-fe"><span>военных походов</span>${numF('campaigns', p.campaigns, 'min="0"')}</label></div>
        <div class="kv-grid4e"><label class="kv-fe"><span>атаки стрелковым ±</span>${numF('atkRanged', p.atkRanged)}</label><label class="kv-fe"><span>рукопашные ±</span>${numF('atkMelee', p.atkMelee)}</label></div>`)}
      ${sec('Предыстория', ['culture:Культура', 'craft:Ремесло', 'craft2:Общее ремесло', 'awakening:Становление: пробуждение', 'ritual:Ритуал декомпрессии'].map(x=>{ const [k, l] = x.split(':'); return `<label class="kv-fe kv-wide"><span>${l}</span>${area(k, p[k], 2)}</label>`; }).join(''))}
      ${sec('Детали', `<label class="kv-fe kv-wide"><span>Облик</span>${area('look', p.look, 2)}</label><label class="kv-fe kv-wide"><span>Талисман</span>${area('talisman', p.talisman, 2)}</label>
        ${p.memories.map((m, i)=>`<label class="kv-fe kv-wide"><span>${i + 1}. ${esc(m.q)}</span>${area('memories.' + i + '.a', m.a, 2, 'Это Воспоминание')}</label>`).join('')}`)}
      ${sec('Особенности', `<label class="kv-fe kv-wide"><span>Аугментации <button type="button" class="kv-die" data-a="augment" title="Случайная аугментация (к66)">⚄</button></span>${area('augments', p.augments, 3)}</label>
        <label class="kv-fe kv-wide"><span>Репутация</span>${area('reputation', p.reputation, 2)}</label><label class="kv-fe kv-wide"><span>Заметки</span>${area('notes', p.notes, 3)}</label>`)}
      ${sec('Критические травмы', `${p.injuries.map(x=>`<div class="kv-li2">${field('injuries.' + x.id + '.text', x.text)}<button type="button" class="kv-x" data-a="del" data-list="injuries" data-id="${x.id}">✕</button></div>`).join('')}
        <button type="button" class="kv-btn kv-sm" data-a="add-injury">+ Травма</button>`)}
      ${sec('Оборудование', `<div class="kv-items-e">${p.items.map(it=>itemEdit(it, 'items')).join('')}</div>
        <div class="kv-row2"><select class="kv-cat" data-cat="p">${catalogP()}</select><button type="button" class="kv-btn kv-sm" data-a="add-cat" data-side="p">Добавить</button><button type="button" class="kv-btn kv-sm" data-a="add-item" data-side="p">+ Свой</button></div>
        <div class="kv-load-line">${L.sl} из ${KAVA.SLOTS} СЛ · нагрузка ${L.eff} — ${L.name}</div>`)}
    </div>`;
  }
  function mechEdit(){
    const m = p.mech, L = Pilot.mechLoad(p), S = Pilot.sensorOf(m);
    const opt = (rows)=>rows.map(r=>[r.key, r.name]);
    return `<div class="kv-col kv-col-m kv-edit" data-col="m">
      <div class="kv-head"><div class="kv-kicker">Катафракт · правка</div>${field('mech.name', m.name, 'class="kv-name-in" placeholder="Имя Катафракта"')}
        <div class="kv-row2"><button type="button" class="kv-btn kv-primary" data-a="wizard-m">Собрать по книге</button><button type="button" class="kv-btn" data-a="class-m">Готовый класс</button></div></div>
      ${sec('Конструкция', `<div class="kv-grid4e">
        <label class="kv-fe"><span>Каркас</span>${sel('mech.frame', opt(MECH.FRAMES), m.frame)}</label><label class="kv-fe"><span>Утроба</span>${sel('mech.womb', opt(MECH.WOMBS), m.womb)}</label>
        <label class="kv-fe"><span>Ядро</span>${sel('mech.core', MECH.CORES.map(c=>[c.key, `${c.name} (${c.alien})`]), m.core)}</label><label class="kv-fe"><span>Реактор</span>${sel('mech.reactor', MECH.REACTORS.map(r=>[r.key, `${r.name} (${r.sl} СЛ)`]), m.reactor)}</label>
        <label class="kv-fe"><span>Сенсоры</span>${sel('mech.sensors', MECH.SENSORS.map(s=>[s.key, `${s.name} +${s.bonus}`]), m.sensors)}</label><label class="kv-fe"><span>бонус Сенсоров (0 — по типу)</span>${numF('mech.sensorBonus', m.sensorBonus)}</label>
        <label class="kv-fe"><span>СТК сейчас</span>${numF('mech.stk', m.stk)}</label><label class="kv-fe"><span>макс. СТК</span>${numF('mech.stkMax', m.stkMax)}</label>
        <label class="kv-fe"><span>МОБ ±</span>${numF('mech.mobMod', m.mobMod)}</label><label class="kv-fe"><span>кР сейчас</span>${sel('mech.kr', Dice.STEPS.filter(x=>x >= 6).map(x=>[x, 'к' + x]), m.kr, 'data-num="1"')}</label></div>
        <label class="kv-fe kv-wide"><span>Характер Ядра</span>${area('mech.nature', m.nature, 2)}</label>
        <div class="kv-fe kv-wide"><span>Сенсорные модули (по типу — ${S.modules})</span><div class="kv-chips2">${MECH.SENSOR_MODULES.map(x=>`<button type="button" class="kv-chip${m.sensorModules.includes(x.name) ? ' on' : ''}" data-a="sensor-mod" data-n="${esc(x.name)}" title="${esc(x.text)}">${esc(x.name)}</button>`).join('')}</div></div>`)}
      ${sec('Оборудование', `<div class="kv-items-e">${m.items.map(it=>itemEdit(it, 'mech.items')).join('') || '<div class="kv-empty">Пусто</div>'}</div>
        <div class="kv-row2"><select class="kv-cat" data-cat="m">${catalogM()}</select><button type="button" class="kv-btn kv-sm" data-a="add-cat" data-side="m">Добавить</button><button type="button" class="kv-btn kv-sm" data-a="add-item" data-side="m">+ Своё</button></div>
        <div class="kv-load-line">${L.sl} СЛ (реактор ${Pilot.reactorOf(m).sl}, сенсоры ${int(m.sensorSl) || S.sl}) · нагрузка ${L.eff} — ${L.name}</div>`)}
      ${sec('Критические повреждения', `${m.crits.map(x=>`<div class="kv-li2">${field('mech.crits.' + x.id + '.text', x.text)}<button type="button" class="kv-x" data-a="del" data-list="mech.crits" data-id="${x.id}">✕</button></div>`).join('')}
        <button type="button" class="kv-btn kv-sm" data-a="add-crit">+ Повреждение</button>`)}
      ${sec('Особенности и детали', ['quirk:Каприз', 'gifts:Дары Ядра', 'nodes:Узлы', 'origin:Происхождение', 'camo:Камуфляж', 'inside:Внутри Утробы', 'marks:Отметины', 'notes:Заметки']
        .map(x=>{ const [k, l] = x.split(':'); return `<label class="kv-fe kv-wide"><span>${l}</span>${area('mech.' + k, m[k], 2)}</label>`; }).join(''))}
    </div>`;
  }
  function itemEdit(it, list){
    const b = `${list}.${it.id}.`, mech = list==='mech.items';
    const kinds = mech ? [['weapon', 'Оружие'], ['module', 'Модуль'], ['consumable', 'Расходник']] : [['gear', 'Снаряжение'], ['armor', 'Доспех'], ['weapon', 'Оружие']];
    let extra = '';
    if(it.kind==='weapon') extra = `<label class="kv-mini">вред ${field(b + 'dmg', it.dmg || '', 'size="4"')}</label>
      <label class="kv-mini">дист. ${sel(b + 'range', Object.keys(KAVA.RANGES).map(r=>[r, r + ' ' + KAVA.RANGES[r]]), it.range || '>')}</label>
      ${mech ? `<label class="kv-mini">тип ${sel(b + 'type', Object.keys(MECH.WEAPON_TYPES).map(k=>[k, MECH.WEAPON_TYPES[k]]), it.type || 'kinetic', 'data-restruct="1"')}</label>`
        : `<label class="kv-mini">атака ${sel(b + 'stat', ['som', 'mot', 'kog'].map(k=>[k, statShort(k) + ' — ' + KAVA.STAT_FOR_ATTACK[k]]), it.stat || 'mot')}</label>`}
      <label class="kv-mini kv-grow2">метки ${field(b + 'tags', it.tags || '', 'placeholder="Лёгкое, Каскад, Кластер/6…"')}</label>`;
    if(it.kind==='armor') extra = `<label class="kv-mini">МОБ + ${numF(b + 'mob', it.mob || 0)}</label><label class="kv-mini">кВ брони ${field(b + 'armor', it.armor || '', 'size="4" placeholder="к6"')}</label>
      <label class="kv-chk"><input type="checkbox" data-f="${b}worn"${it.worn ? ' checked' : ''}> надет</label>`;
    if(it.kind==='consumable') extra = `<label class="kv-mini">вид ${sel(b + 'ckey', MECH.CONSUMABLES.map(c=>[c.ckey, c.name]), it.ckey || 'ammo')}</label>`;
    if(it.kind==='module') extra = `<label class="kv-chk"><input type="checkbox" data-f="${b}off"${it.off ? ' checked' : ''}> отключён</label>${it.shield ? `<label class="kv-chk"><input type="checkbox" data-f="${b}used"${it.used ? ' checked' : ''}> щит использован</label>` : ''}`;
    return `<div class="kv-item-e kind-${it.kind}"><div class="kv-row2">${field(b + 'name', it.name, 'class="kv-grow2" placeholder="Название"')}
      ${sel(b + 'kind', kinds, it.kind, 'data-restruct="1"')}<label class="kv-mini">СЛ ${numF(b + 'sl', it.sl, 'min="0" max="12"')}</label>
      <button type="button" class="kv-x" data-a="del" data-list="${list}" data-id="${it.id}" title="Убрать">✕</button></div>
      ${extra ? `<div class="kv-row2">${extra}</div>` : ''}${it.text || it.note ? `<div class="kv-note">${esc(it.text || it.note)}</div>` : ''}</div>`;
  }
  const og = (label, list, key)=>`<optgroup label="${esc(label)}">${list.map((t, i)=>`<option value="${key}:${i}">${esc(t.name)}${t.dmg ? ` (${esc(t.dmg)})` : ''}${t.sl ? ` · ${t.sl} СЛ` : ''}</option>`).join('')}</optgroup>`;
  const gearList = ()=>Object.keys(KAVA.START_GEAR).map(k=>KAVA.START_GEAR[k]);
  const catalogP = ()=>'<option value="">— из книги —</option>' + og('Доспехи', KAVA.ARMOR, 'armor') + og('Стрелковое', KAVA.RANGED, 'ranged') + og('Холодное', KAVA.MELEE, 'melee') + og('Тяжёлое', KAVA.HEAVY, 'heavy') + og('Снаряжение', gearList(), 'gear') + og('Стартовый набор', KAVA.START_KIT, 'kit');
  const catalogM = ()=>'<option value="">— из книги —</option>' + og('Расходники', MECH.CONSUMABLES, 'cons') + og('Кинетическое', MECH.KINETIC, 'kin') + og('Ракетное', MECH.MISSILES, 'mis') + og('Лучевое', MECH.BEAMS, 'beam') + og('Ближний бой', MECH.MELEE, 'mel') + og('Реликтовое (приложение 1)', LORE.RELIC_RANGED.concat(LORE.RELIC_MELEE), 'relic') + og('Модули', MECH.MODULES, 'mod');
  function fromCatalog(v){
    const [k, i] = String(v).split(':');
    const src = {armor:KAVA.ARMOR, ranged:KAVA.RANGED, melee:KAVA.MELEE, heavy:KAVA.HEAVY, gear:gearList(), kit:KAVA.START_KIT,
      cons:MECH.CONSUMABLES, kin:MECH.KINETIC, mis:MECH.MISSILES, beam:MECH.BEAMS, mel:MECH.MELEE, mod:MECH.MODULES, relic:LORE.RELIC_RANGED.concat(LORE.RELIC_MELEE)}[k];
    const t = src && src[+i]; if(!t) return null;
    return ['armor', 'ranged', 'melee', 'heavy', 'gear', 'kit'].includes(k) ? Pilot.itemFrom(t) : Pilot.mechItemFrom(t);
  }

  // ---------- отрисовка ----------
  function render(pilot){
    p = pilot || p; if(!root || !p) return;
    const keepY = window.scrollY, edit = mode==='edit';
    root.className = 'kv-tandem' + (edit ? ' is-edit' : '') + (p.inWomb ? ' in-womb' : '');
    root.innerHTML = (edit ? pilotEdit() : pilotPlay()) + spine() + (edit ? mechEdit() : mechPlay());
    window.scrollTo(0, keepY);
    if(typeof App!=='undefined') App.refresh();
  }
  function derived(){
    if(!root || !p) return;
    KAVA.STATS.forEach(s=>{ const el = root.querySelector(`[data-d="stat-${s.key}"]`); if(el) el.textContent = plus(Pilot.stat(p, s.key)); });
    const l = root.querySelector('[data-d="luck"]'); if(l) l.textContent = Pilot.luck(p);
  }
  // путь в модели: "stats.som", "items.<id>.name", "mech.items.<id>.dmg", "memories.2.a"
  function setPath(path, v){
    const parts = path.split('.'); let o = p;
    for(let i = 0; i < parts.length - 1; i++){ const k = parts[i]; o = Array.isArray(o) && !/^\d+$/.test(k) ? o.find(x=>x && x.id===k) : o[k]; if(o == null) return; }
    o[parts[parts.length - 1]] = v;
  }
  const saveSoon = ()=>{ clearTimeout(saveTimer); saveTimer = setTimeout(()=>{ Pilot.save(); if(typeof Table!=='undefined') Table.pilotChanged(); }, 300); };
  function onField(e){
    const el = e.target.closest('[data-f]'); if(!el || !p) return;
    let v = el.type==='checkbox' ? el.checked : el.value;
    if(el.dataset.num) v = int(v);
    setPath(el.dataset.f, v);
    if(el.dataset.f==='name' || el.dataset.f==='mech.name') App.names();
    if(el.dataset.f.startsWith('mech.items.') && el.dataset.f.endsWith('.type')){ const it = p.mech.items.find(x=>x.id===el.dataset.f.split('.')[2]); if(it) it.stat = {kinetic:'mot', missile:'kog', beam:'kog', melee:'som'}[v]; }
    saveSoon();
    if(e.type==='change' && (el.dataset.restruct || el.tagName==='SELECT' || el.type==='checkbox')) render(); else derived();
  }
  function onClick(e){
    const fold = e.target.closest('summary'); if(fold){ const d = fold.parentNode; if(d.dataset.fold) setTimeout(()=>App.fold(d.dataset.fold, !d.open), 0); return; }
    const b = e.target.closest('[data-a]'); if(!b || !p) return;
    const a = b.dataset.a, id = b.dataset.id;
    const after = Actions.handle(a, b, p);
    if(after==='render') render();
  }
  function mount(el){ root = el; root.addEventListener('input', onField); root.addEventListener('change', onField); root.addEventListener('click', onClick); }
  function setMode(m){ mode = m==='edit' ? 'edit' : 'play'; render(); }
  return {mount, render, setMode, fromCatalog, get mode(){ return mode; }, get pilot(){ return p; }};
})();
