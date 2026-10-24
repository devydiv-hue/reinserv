/* ======================================================================
   Всплывающее окно переброса — после броска характеристики (executeRoll ниже), если у персонажа есть
   хоть один потенциальный источник переброса:
   - непотраченная способность с "перебросить"/"переброс" в тексте (abilityGrantsReroll, флажок у неё
     — см. renderAbilities) — цена: только сама способность (флажок "потрачено");
   - флажок бодрости напрямую (по умолчанию включён при создании персонажа) — цена: сам флажок;
   - любое достоинство или карьера — книга не даёт единого правила "какое именно достоинство/карьера
     даёт переброс" (текст у каждого свой), поэтому показываются ВСЕ с их описанием, решение — за
     игроком; цена за них общая: бодрость, если она ещё активна, иначе — отметка истощения; если
     бодрости уже нет И истощение уже отмечено — этим кнопкам взять цену неоткуда, не показываются.
   Окно крупное, по центру экрана — НЕ исчезает само по таймеру (так просили): курсор считается
   "вошедшим" в его зону автоматически и мгновенно в момент появления (реальный курсор двигать
   программно нельзя, поэтому это просто начальное состояние отслеживания, а не всамделишное
   перемещение) — исчезает только по первому ДВИЖЕНИЮ мыши, уводящему её за пределы окна, либо по
   входу в полноэкранный режим камер (клавиша Q — см. toggleForced в RoomFocusMode выше).
   ====================================================================== */
let _rerollPopupEl = null, _rerollDismissCleanup = null;
function closeRerollPopup(){
  if(_rerollPopupEl){ _rerollPopupEl.remove(); _rerollPopupEl = null; }
  if(_rerollDismissCleanup){ _rerollDismissCleanup(); _rerollDismissCleanup = null; }
}
// Цена переброса за достоинство/карьеру: бодрость, если есть, иначе истощение. Не путать со ставкой
// напрямую за саму бодрость (отдельная кнопка ниже) — там цена всегда бодрость, без резервного варианта.
function spendGenericRerollCost(){
  if(character.states.bodrost){
    character.states.bodrost = false;
    logEvent(character, 'Бодрость потрачена на переброс.');
  } else {
    character.states.istoshenie = true;
    logEvent(character, 'Истощение отмечено — потрачено на переброс (бодрости уже не было).');
  }
}
function showRerollPopup(statKey, mod, mode){
  closeRerollPopup();
  if(!character) return;
  const abilities = character.abilities.filter(a=>abilityGrantsReroll(a.text) && !a.spent);
  const bodrostActive = !!(character.states && character.states.bodrost);
  const istoshenieActive = !!(character.states && character.states.istoshenie);
  const genericCostAvailable = bodrostActive || !istoshenieActive; // см. комментарий у spendGenericRerollCost
  const advantages = genericCostAvailable ? (character.advantages||[]) : [];
  const careerKey = genericCostAvailable ? character.careerKey : null;
  const career = careerKey && CAREERS[careerKey] ? CAREERS[careerKey] : null;
  const luckAvailable = (character.luck||0) > 0; // удача — универсальный источник, годится для ЛЮБОГО броска, независимо от способностей/бодрости
  // шаман: раз в сцену повысить кость духов на 1 и перебросить проверку мистики (своя или способность с Броском мистики)
  const isMist = statKey==='mistika' || (statKey==='map_ability' && _mapAbilityCtx && _mapAbilityCtx.stat==='mistika' && !_mapAbilityCtx.opp);
  const spiritAvailable = isShaman(character) && isMist && !character.spiritSceneUsed;
  if(!abilities.length && !bodrostActive && !advantages.length && !career && !luckAvailable && !spiritAvailable) return; // нечем перебрасывать — не показываем пустую подсказку

  const doReroll = (spendFn)=>{
    spendFn();
    renderAll();
    closeRerollPopup();
    _rerollingKey = {key:statKey==='map_ability' && isMist ? 'mistika' : statKey, at:Date.now()}; // исход нового броска заменит прежний (кость духов, саматха)
    openRollPicker(statKey, window.innerWidth/2, window.innerHeight/2, mod); // тот же модификатор, что и у перебрасываемого броска
  };
  const el = document.createElement('div');
  el.className = 'reroll-popup';
  let html = `<div class="reroll-title">🔄 Перебросить «${escapeHtml(STAT_LABELS[statKey]||statKey)}»?</div>`;
  if(luckAvailable){
    html += `<div class="reroll-option"><button class="small" id="rerollLuckBtn">Удача (−1, сейчас ${character.luck})</button></div>`;
  }
  if(spiritAvailable){
    html += `<div class="reroll-option"><button class="small" id="rerollSpiritBtn">Кость духов +1 (сейчас ${spiritDieOf(character)})</button><div class="reroll-desc">Раз в сцену шаман сам повышает кость духов на 1 и перебрасывает проверку мистики.</div></div>`;
  }
  if(bodrostActive){
    html += `<div class="reroll-option"><button class="small" id="rerollBodrostBtn">Бодрость (снять флажок)</button></div>`;
  }
  abilities.forEach(a=>{
    html += `<div class="reroll-option"><button class="small" data-ability="${a.id}">${escapeHtml(a.name||'Способность')}</button>
      <div class="reroll-desc">${escapeHtml(a.text||'')}</div></div>`;
  });
  advantages.forEach(a=>{
    html += `<div class="reroll-option"><button class="small" data-advantage="${a.id}">Достоинство: ${escapeHtml((a.text||'').split(':')[0].slice(0,40))}</button>
      <div class="reroll-desc">${escapeHtml(a.text||'')}</div></div>`;
  });
  if(career){
    html += `<div class="reroll-option"><button class="small" id="rerollCareerBtn">Карьера: ${escapeHtml(career.name)}</button>
      <div class="reroll-desc">${escapeHtml(CAREER_DESCRIPTIONS[careerKey]||'')}</div></div>`;
  }
  html += `<button class="small reroll-close" id="rerollCloseBtn">✕</button>`;
  el.innerHTML = html;
  document.body.appendChild(el);
  _rerollPopupEl = el;

  if(luckAvailable){
    el.querySelector('#rerollLuckBtn').onclick = ()=>doReroll(()=>{
      character.luck -= 1;
      logEvent(character, `Удача потрачена на переброс — осталось ${character.luck}.`);
    });
  }
  if(spiritAvailable){
    el.querySelector('#rerollSpiritBtn').onclick = ()=>doReroll(()=>{ character.spiritSceneUsed = true; bumpSpiritDie(character, 'переброс мистики, раз в сцену'); });
  }
  if(bodrostActive){
    el.querySelector('#rerollBodrostBtn').onclick = ()=>doReroll(()=>{
      character.states.bodrost = false;
      logEvent(character, 'Бодрость потрачена на переброс.');
    });
  }
  el.querySelectorAll('button[data-ability]').forEach(btn=>{
    btn.onclick = ()=>doReroll(()=>{
      const a = character.abilities.find(x=>x.id===btn.dataset.ability);
      if(a){ a.spent = true; logEvent(character, `Способность «${a.name||'?'}» потрачена на переброс.`); }
    });
  });
  el.querySelectorAll('button[data-advantage]').forEach(btn=>{
    btn.onclick = ()=>doReroll(()=>{
      const a = character.advantages.find(x=>x.id===btn.dataset.advantage);
      logEvent(character, `Переброс за достоинство «${a?a.text:'?'}».`);
      spendGenericRerollCost();
    });
  });
  if(career){
    el.querySelector('#rerollCareerBtn').onclick = ()=>doReroll(()=>{
      logEvent(character, `Переброс за карьеру «${career.name}».`);
      spendGenericRerollCost();
    });
  }
  el.querySelector('#rerollCloseBtn').onclick = closeRerollPopup;

  // "Мышь мгновенно и автоматически внутри окна" — реальный курсор программно не переместить, поэтому
  // это просто НАЧАЛЬНОЕ состояние отслеживания (inside=true с самого показа), а не всамделишное
  // перемещение; закрываем только на первое движение, где курсор действительно вне рамки окна.
  // Настоящий курсор программно не подвинуть — "мгновенно внутри" на практике означало закрытие от
  // ПЕРВОГО же шевеления мыши где угодно на странице (курсор почти никогда физически не находится в
  // центре экрана, где появляется окно, — так и обнаружился баг при живой проверке). Слежение теперь
  // по-честному включается только ПОСЛЕ того, как курсор действительно окажется над окном хотя бы
  // одним настоящим движением — а закрывает только движение, действительно выводящее его оттуда.
  let entered = false;
  const onMove = (e)=>{
    const r = el.getBoundingClientRect();
    const inside = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
    if(!entered){ if(inside) entered = true; return; }
    if(!inside) closeRerollPopup();
  };
  window.addEventListener('mousemove', onMove);
  _rerollDismissCleanup = ()=>window.removeEventListener('mousemove', onMove);
}

/* ---- Кость духов шамана (стр. 208, «Саматха») ----
   В начале игровой встречи к6 ставится на 1; каждый проваленный Бросок мистики шамана — +1 (переброс той же проверки —
   не новый провал). Дошла до 6 — снова 1, а шаман в саматхе (к6 часов в мире Нарра-Ка): Бросок духа (−3) — провал: −2 пси,
   успех: +[категория успеха] пси и ОЗ. Провал с 13 на к20 — «Врата для демона»: из шамана исторгается случайная пустота (к6),
   даже если бросок потом перебросят. Раз в сцену шаман сам повышает кость на 1 и перебрасывает проверку мистики (окно переброса). */
const VOID_GATE_TABLE = [['Удильщик', 295], ['Пустотник', 298], ['Зубная фея', 296], ['Идол', 300], ['Скорбящий', 297], ['Собиратель', 301]]; // к6
let _rerollingKey = null; // {key, at}: какой бросок сейчас перебрасывается (doReroll) — его исход заменяет прежний
function isShaman(c){ return !!(c && c.archetypeKey==='shaman'); }
function spiritDieOf(c){ return Math.max(1, Math.min(6, Math.round(+c.spiritDie || 1))); }
const sheetName = ()=>{ const el = document.getElementById('fName'); return (el && el.value.trim()) || 'Шаман'; };
function bumpSpiritDie(c, why){
  const was = spiritDieOf(c), v = was + 1;
  if(v < 6){ c.spiritDie = v; logEvent(c, `Кость духов: ${was} → ${v} (${why}).`); return; }
  c.spiritDie = 1;
  const hours = randInt(6);
  c.samatha = {hours};
  logEvent(c, `Кость духов дошла до 6 (${why}) — снова 1. Саматха: ${hours} ч (к6) в мире Нарра-Ка, Бросок духа (−3).`);
  recordAndShareQuickRoll({abilityUse:true, text:`${sheetName()}: саматха — кость духов дошла до 6, духи застилают разум на ${hours} ч (к6). Нужен Бросок духа (−3).`});
  uiToast('Саматха: кость духов дошла до 6 — Бросок духа (−3) в «Самочувствии»', {icon:'🜂', ms:7000});
}
STAT_LABELS['samatha_duh'] = 'Саматха — Бросок духа';
SAVE_ROLL_DEFS['samatha_duh'] = {
  label:'Саматха — Бросок духа (−3)', anchorMod:-3,
  base(){ return 10 + ((character && character.stats.duh) || 0); },
  tags(){ return [`Дух: ${10 + ((character && character.stats.duh) || 0)}`, 'Саматха: −3']; },
  formula(){ return '10 + дух − 3; провал — −2 пси, успех — +[КУ] пси и ОЗ, провал с 13 — «Врата для демона»'; }
};
// Исход броска для кости духов: провал мистики — +1; Бросок духа в саматхе — пси/ОЗ и «Врата для демона». Переброс заменяет прежний исход.
function resolveSpiritOutcome(statKey, roll, success, category){
  const reroll = !!(_rerollingKey && _rerollingKey.key===statKey && Date.now() - _rerollingKey.at < 120000); if(reroll) _rerollingKey = null;
  if(!character || !isShaman(character)) return;
  if(statKey==='mistika'){ if(!success && !reroll) bumpSpiritDie(character, 'провал мистики'); return; }
  if(statKey!=='samatha_duh') return;
  const c = character, prev = reroll ? c._samathaLast : null;
  if(!c.samatha && !prev) return;
  if(prev){ c.psiCurrent = (+c.psiCurrent || 0) - prev.psi; c.hpCurrent = (+c.hpCurrent || 0) - prev.hp; } // переброс: прежний исход отменяется
  const p0 = +c.psiCurrent || 0, h0 = +c.hpCurrent || 0;
  let gate = prev ? prev.gate : null, text;
  if(success){
    c.psiCurrent = Math.max(p0, Math.min(psiMax(c), p0 + category)); c.hpCurrent = Math.max(h0, Math.min(hpMax(c), h0 + category));
    text = `духи научили новому — +${c.psiCurrent - p0} пси, +${c.hpCurrent - h0} ОЗ`;
  } else {
    c.psiCurrent = clampLower(p0 - 2, psiMax(c));
    text = 'кошмар саматхи — −2 пси';
    if(roll===13 && !gate){ const k = randInt(6); gate = {k, name:VOID_GATE_TABLE[k - 1][0], page:VOID_GATE_TABLE[k - 1][1]}; }
  }
  c._samathaLast = {psi:c.psiCurrent - p0, hp:c.hpCurrent - h0, gate};
  c.samatha = null;
  if(gate && !(prev && prev.gate)) text += `. ВРАТА ДЛЯ ДЕМОНА: шаман поднимается в воздух, тело выворачивается — исторгается пустота «${gate.name}» (к6 = ${gate.k}, стр. ${gate.page})`;
  else if(gate) text += `. Пустота «${gate.name}» уже исторглась — она знает о первом результате 13`;
  logEvent(c, `Саматха, Бросок духа: к20=${roll} — ${text}.`);
  recordAndShareQuickRoll({abilityUse:true, text:`${sheetName()}: саматха, Бросок духа (к20=${roll}${reroll ? ', переброс' : ''}) — ${text}.`});
  renderAll();
}
// Способности, двигающие кость духов (по тексту): «Песнь мира» — при успехе −1, «Лечащий ритуал» — при провале +1
function spiritAbilityOutcome(text, success){
  if(!character || !isShaman(character)) return;
  const t = String(text || '');
  if(success && /(?:снижая|снижает)\s+значение\s+кости\s+духов\s+на\s+1/i.test(t)){
    const was = spiritDieOf(character); character.spiritDie = Math.max(1, was - 1);
    if(character.spiritDie!==was) logEvent(character, `Кость духов: ${was} → ${character.spiritDie} (способность: успех).`);
    renderAll();
  }
  if(!success && /при\s+провале[^.]*повышает\s+кость\s+духов\s+на\s+1/i.test(t)){ bumpSpiritDie(character, 'провал способности'); renderAll(); }
}
window.spiritDieAct = function(act){
  if(!character || !isShaman(character)) return;
  const c = character;
  if(act==='plus') bumpSpiritDie(c, 'вручную');
  else if(act==='minus'){ const was = spiritDieOf(c); c.spiritDie = Math.max(1, was - 1); if(c.spiritDie!==was) logEvent(c, `Кость духов: ${was} → ${c.spiritDie} (вручную).`); }
  else if(act==='meeting'){ c.spiritDie = 1; c.spiritSceneUsed = false; logEvent(c, 'Кость духов: новая игровая встреча — 1.'); }
  else if(act==='scene'){ c.spiritSceneUsed = false; }
  else if(act==='samatha'){ const r = document.getElementById('spiritDieBox').getBoundingClientRect(); openRollPicker('samatha_duh', r.left + r.width/2, r.top + 20, -3); return; }
  else if(act==='samatha-off'){ c.samatha = null; logEvent(c, 'Саматха снята вручную.'); }
  renderAll();
};
function renderSpiritDie(){
  const box = document.getElementById('spiritDieBox'); if(!box) return;
  if(!character || !isShaman(character)){ box.style.display = 'none'; box.innerHTML = ''; return; }
  const c = character, v = spiritDieOf(c);
  box.style.display = '';
  box.innerHTML = `<h3 style="margin-top:14px;">Кость духов</h3>
    <div class="spirit-die-row"><span class="spirit-die-face" title="к6 духов: каждый проваленный Бросок мистики +1, на 6 — саматха">${v}</span>
      <button class="small" onclick="spiritDieAct('minus')" title="−1 (например, «Песнь мира»)">−</button><button class="small" onclick="spiritDieAct('plus')">+</button>
      <button class="small" onclick="spiritDieAct('meeting')" title="Начало игровой встречи: кость на 1">Новая встреча</button>
      <span class="muted">${c.spiritSceneUsed ? '+1 и переброс мистики — уже в этой сцене <button class="small" onclick="spiritDieAct(\'scene\')" title="Новая сцена">↺</button>' : '+1 и переброс мистики — в окне переброса (раз в сцену)'}</span></div>
    ${c.samatha ? `<div class="spirit-samatha">🜂 <b>Саматха</b> — ${c.samatha.hours} ч в мире Нарра-Ка, тело прорастает псевдоплотью.
      <button class="small" onclick="spiritDieAct('samatha')">🎲 Бросок духа (−3)</button> <button class="small" onclick="spiritDieAct('samatha-off')" title="Снять вручную">✕</button></div>` : ''}`;
}

// mode: 'plain' (один к20, как раньше) | 'advantage' | 'disadvantage' (см. openRollPicker — зона
// жеста вне поля гексов, справа/слева) — два к20, выбор лучшего/худшего через pickD20ForMode (тем же
// правилом, что и у боковой панели бросков кубов, см. compareD20Outcomes выше).
function executeRoll(statKey, base, mod, popup, mode){
  if(statKey==='map_attack') return executeMapAttackRoll(base, mod, popup, mode); // атака с игрового стола — см. там
  if(statKey==='map_ability') return executeMapAbilityRoll(base, mod, popup, mode); // способность персонажа со стола
  mode = mode || 'plain';
  const max = base + mod;
  const rolls = mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)];
  const roll = pickD20ForMode(rolls[0], rolls[1], max, mode);
  const {success, category, natConsequences} = evaluateD20Check(roll, max);
  if(statKey==='creature_roll' && !success) if(typeof GmAdvice!=='undefined') GmAdvice.event('miss'); // проваленный бросок существа
  if(typeof recordAndShareRoll==='function') recordAndShareRoll(statKey, mod, roll, max, success, category, mode, rolls); // общий лог сессии, см. её раздел внизу файла
  resolveSpiritOutcome(statKey, roll, success, category); // кость духов шамана: провал мистики, саматха
  // эпичный бросок (EpicRolls): метка Мастера или автоправило — сцена на весь экран у всех вместо полёта кости
  const epic = statKey!=='creature_roll' && typeof EpicRolls!=='undefined'
    ? EpicRolls.forOwnRoll({value:roll, max, success, category, label:STAT_LABELS[statKey] || statKey, death:statKey==='save_smert', secret:secretRollActive()}) : null;
  if(statKey!=='creature_roll' && session.role==='player' && secretRollActive()){ // тайный бросок: результат знает только Мастер
    if(epic){ closeRollOverlay(); return; } // в сцене вместо числа — «?»
    popup.querySelector('.hex-field').remove(); popup.querySelector('.roll-max-preview').remove(); popup.querySelector('.roll-tags').remove();
    const st = document.createElement('div'); st.innerHTML = '<div class="roll-outcome secret"><span class="verdict">🤫 Тайный бросок</span>ушёл Мастеру — результат знает только он</div>';
    popup.appendChild(st); setTimeout(closeRollOverlay, 1600); return;
  }

  // Анимация полёта/приземления кости — ТА ЖЕ launchRollAnimation, что и у боковой панели бросков
  // кубов (см. её определение выше, до DicePanel — вынесена специально ради этого переиспользования,
  // чтобы не плодить вторую, отдельную реализацию того же самого крутящегося-и-приземляющегося к20).
  // Сам поповер больше не строит собственную 3D-модель — только текст исхода, известный уже сейчас
  // (успех/провал/категория посчитаны выше), показанный сразу и остающийся на экране, пока кость
  // летит где-то поверх всего; оба закрываются вместе, когда анимация долетает и пауза заканчивается.
  popup.querySelector('.hex-field').remove();
  popup.querySelector('.roll-max-preview').remove();
  popup.querySelector('.roll-tags').remove();
  if(_rollOverlayEl) _rollOverlayEl.querySelectorAll('.roll-side-hint').forEach(h=>h.remove());
  const startRect = popup.getBoundingClientRect(); // кость "вылетает" из места, где стоял поповер
  const special = natTagText(roll, success, natConsequences);
  const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
  const rollsTxt = rolls.length>1 ? ` [к20: ${rolls.join(', ')} → взят ${roll}]` : '';
  const stage=document.createElement('div');
  stage.innerHTML = `<div class="roll-outcome ${success?'success':'failure'}"><span class="verdict">${success?`Успех, КУ${category}`:'Провал'}</span>к20=${roll} / Макс.${max}${special}${modeTxt}${rollsTxt}</div>`;
  popup.appendChild(stage);
  // popup was sized for the hex field — re-centre it on screen now that content changed shape.
  const pr2 = popup.getBoundingClientRect();
  popup.style.left = Math.max(6, Math.min(parseFloat(popup.style.left), window.innerWidth - pr2.width - 6)) + 'px';
  popup.style.top = Math.max(6, Math.min(parseFloat(popup.style.top), window.innerHeight - pr2.height - 6)) + 'px';

  const after = ()=>{
    // Атака оружием — резолв попаданий/ран/к12 (см. resolveWeaponAttackOutcome) ПОСЛЕ обычного d20,
    // не вместо него; 'jammed' (Клинит на нат.13) — единственный случай, когда переброс не предлагается,
    // остальные statKey (не про атаку) resolveWeaponAttackOutcome просто игнорирует (return без действий).
    const attackOutcome = resolveWeaponAttackOutcome(statKey, roll, success, category);
    if(attackOutcome!=='jammed' && statKey!=='creature_roll') showRerollPopup(statKey, mod, mode);
  };
  if(epic){ closeRollOverlay(); epic.then(after); return; }
  launchRollAnimation({diceType:'d20', mode, max, rolls, roll}, startRect).then(()=>{
    closeRollOverlay();
    after();
  });
}

function renderPending(){
  // Drop any dynamically-rebuilt choice that no longer has anything to offer (see rebuildOptions
  // below) — e.g. a psi discipline-upgrade pick queued before an earlier, related discipline pick was
  // actually resolved by the player now correctly sees that discipline as no longer "new".
  pendingChoices = pendingChoices.filter(p=> !p.rebuildOptions || !character || p.rebuildOptions(character).length>0 );
  const box = document.getElementById('pendingBox');
  let html = '';
  { const lp = document.getElementById('levelProgress');
    if(lp) lp.textContent = !character ? ''
      : character._levelUpTarget > character.level ? `⏫ Идёт повышение: ${character.level} → ${character._levelUpTarget} — сделайте выборы выше ↑`
      : character._backfillTarget ? `⏫ Восполнение уровней: ${character._backfillProgress||0} → ${character._backfillTarget} — выборы выше ↑` : ''; }
  if(pendingItemRolls.length){
    html += `<div class="pending pending-progress">🎒 Ждёт выбора предметов по таблице: <b>${pendingItemRolls.length}</b> — <a href="#pendingItemRollsBox" onclick="event.preventDefault();document.getElementById('pendingItemRollsBox').scrollIntoView({behavior:'smooth',block:'center'})">в разделе «Инвентарь»</a>. Повышению уровня это не мешает.</div>`;
  }
  if(lostPendingNotice){
    html += `<div class="pending pending-progress">⚠ До обновления страницы оставались несделанные выборы (${lostPendingNotice}) при создании персонажа — их нельзя восстановить из сохранения. Если они важны, сгенерируйте персонажа заново. <button class="small" onclick="lostPendingNotice=0;renderAll()">Понятно</button></div>`;
  }
  if(!pendingRoleplayChoices.length && !pendingChoices.length){ box.innerHTML = html; return; }
  if(pendingRoleplayChoices.length){
    html += `<div class="pending"><h3>⚠ Требуется решение игрока (зависит от отыгрыша)</h3>
      <div class="muted">Эти поля правила прямо запрещают выбирать случайно — система их не решает за вас.</div>
      <div id="pendingList"></div></div>`;
  }
  if(pendingChoices.length){
    html += `<div class="pending"><h3>✋ Ручное распределение</h3>
      <div class="muted">Включён ручной режим — эти бонусы нужно распределить самостоятельно.</div>
      <div id="pendingChoicesList"></div></div>`;
  }
  box.innerHTML = html;
  if(pendingRoleplayChoices.length){
    const list = document.getElementById('pendingList');
    pendingRoleplayChoices.forEach(p=>{
      const row = document.createElement('div');
      row.style.marginTop='10px';
      row.innerHTML = `<div><b>${p.label}</b> <span class="muted">(источник: ${p.source})</span></div>`;
      const btns = document.createElement('div'); btns.className='choice-btns';
      p.among.forEach(stat=>{
        const label = STAT_LABELS[stat] || stat;
        const b = document.createElement('button'); b.className='small';
        b.textContent = label;
        b.onclick = ()=>{
          addLog(character, stat, 1, p.source+' (отыгрыш игрока)');
          logEvent(character, `Отыгрыш: «${p.label}» → ${label} +1 (источник: ${p.source}).`);
          pendingRoleplayChoices = pendingRoleplayChoices.filter(x=>x.id!==p.id);
          renderAll();
        };
        btns.appendChild(b);
      });
      row.appendChild(btns);
      list.appendChild(row);
    });
  }
  if(pendingChoices.length){
    const list2 = document.getElementById('pendingChoicesList');
    pendingChoices.forEach(p=>{
      const row = document.createElement('div');
      row.style.marginTop='10px';
      row.innerHTML = `<div><b>${p.title}</b></div>`;
      const btns = document.createElement('div'); btns.className='choice-btns';
      const opts = p.rebuildOptions ? p.rebuildOptions(character) : p.options;
      opts.forEach(opt=>{
        const b = document.createElement('button'); b.className='small';
        b.textContent = opt.label;
        b.onclick = ()=>{
          opt.apply(character);
          logEvent(character, `Ручной выбор: «${p.title}» → ${opt.label}.`);
          pendingChoices = pendingChoices.filter(x=>x.id!==p.id);
          renderAll();
        };
        btns.appendChild(b);
      });
      row.appendChild(btns);
      list2.appendChild(row);
    });
  }
}

// ---- Undo (Ctrl+Z): snapshots `character` (plus the live pendingChoices/pendingRoleplayChoices/
// pendingItemRolls arrays) right before they're about to render differently than last time, so every
// discrete action (choice resolutions, level up/down, generate, switch archetype/career/origin,
// specialization picks, inventory add/remove, etc. — anything that calls renderAll()) becomes one undo
// step automatically, without instrumenting each of those call sites by hand. Continuous typing (fName,
// ability notes, weapon fields, ...) never calls renderAll() on its own, so it never spams the stack.
// The pending arrays are kept as live references (not JSON) since their `apply(ch)` closures only ever
// act on whatever character is passed to them at call time — see renderPending() — never a captured
// character from outside, so they stay valid to reuse even after `character` itself gets swapped out
// on restore. Only `character` needs JSON round-tripping, since only it needs a true deep copy.
let undoStack = [];
let lastRenderedCharacterJSON = undefined; // undefined = "renderAll() hasn't run yet", vs 'null' = "character was null"
let lastRenderedPendingKey = '';
let lastRenderedPendingChoices = [], lastRenderedPendingRoleplayChoices = [], lastRenderedPendingItemRolls = [];
const UNDO_STACK_LIMIT = 50;
function captureUndoSnapshotIfChanged(){
  const nowJSON = character ? JSON.stringify(character) : 'null';
  // Cheap fingerprint of the pending arrays for change-detection only (functions drop out of
  // JSON.stringify silently, which is fine here — id/title/label is enough to detect a change).
  const nowPendingKey = JSON.stringify([pendingChoices, pendingRoleplayChoices, pendingItemRolls]);
  const changed = lastRenderedCharacterJSON !== undefined && (nowJSON !== lastRenderedCharacterJSON || nowPendingKey !== lastRenderedPendingKey);
  if(changed){
    undoStack.push({
      characterJSON: lastRenderedCharacterJSON,
      pendingChoices: lastRenderedPendingChoices,
      pendingRoleplayChoices: lastRenderedPendingRoleplayChoices,
      pendingItemRolls: lastRenderedPendingItemRolls
    });
    if(undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  }
  lastRenderedCharacterJSON = nowJSON;
  lastRenderedPendingKey = nowPendingKey;
  lastRenderedPendingChoices = pendingChoices.slice();
  lastRenderedPendingRoleplayChoices = pendingRoleplayChoices.slice();
  lastRenderedPendingItemRolls = pendingItemRolls.slice();
  document.getElementById('btnUndo').disabled = undoStack.length===0;
  // Player → GM sheet sync piggybacks on this same change-detection (see session section at the end
  // of the file) — only actually sends when the character really changed, same as the undo snapshot.
  // Autosave (see saveAutosave, same section) piggybacks here too, for everyone, session or not.
  if(changed){
    if(typeof session!=='undefined' && session.role==='player') sendSheetSnapshotToGM();
    if(typeof saveAutosave==='function') saveAutosave();
    gtHook(g=>g.onLocalCharacterChanged()); // HP/Psi своего жетона на игровом столе читаются прямо из character
  }
}
function performUndo(){
  if(!undoStack.length) return;
  const prev = undoStack.pop();
  character = prev.characterJSON === 'null' ? null : JSON.parse(prev.characterJSON);
  pendingChoices = prev.pendingChoices;
  pendingRoleplayChoices = prev.pendingRoleplayChoices;
  pendingItemRolls = prev.pendingItemRolls;
  if(character) logEvent(character, 'Последнее действие отменено (Ctrl+Z).');
  // Baseline includes the log line above and the restored pending arrays, so this restore isn't
  // immediately re-captured as yet another change on the very next render.
  lastRenderedCharacterJSON = character ? JSON.stringify(character) : 'null';
  lastRenderedPendingKey = JSON.stringify([pendingChoices, pendingRoleplayChoices, pendingItemRolls]);
  lastRenderedPendingChoices = pendingChoices.slice();
  lastRenderedPendingRoleplayChoices = pendingRoleplayChoices.slice();
  lastRenderedPendingItemRolls = pendingItemRolls.slice();
  renderAll();
}
window.addEventListener('keydown', (e)=>{
  // e.code (physical key position) is used instead of/alongside e.key (the character the layout
  // produces) because e.key changes with keyboard layout — on a Cyrillic (ЙЦУКЕН) layout, physically
  // pressing the Z key reports e.key as "я", not "z", so a check on e.key alone silently never fires
  // for such a layout. e.code stays "KeyZ" regardless of layout, so it's the reliable one to check;
  // e.key is kept as a fallback for setups where e.code might be unavailable or unusual.
  const isZ = e.code === 'KeyZ' || e.key.toLowerCase() === 'z';
  if(!((e.ctrlKey||e.metaKey) && !e.shiftKey && isZ)) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if(tag==='INPUT' || tag==='TEXTAREA') return; // let the browser's native text-undo work inside a field
  e.preventDefault();
  performUndo();
});

function renderAll(){
  captureUndoSnapshotIfChanged();
  if(typeof PlayMode!=='undefined') PlayMode.schedule(); // полоска режима «Игра» — после перерисовки листа
  if(typeof SheetExtras!=='undefined') SheetExtras.schedule(); // портрет персонажа
  renderPending();
  // Resume a level-by-level advance the moment nothing's pending anymore (see processNextLevelIfReady)
  // — covers both mid-generation and a post-generation level-up. processNextLevelIfReady itself now
  // fires the starting-gear roll generateCharacter() deferred, once levelling actually reaches target
  // (that check used to live here too, redundantly and unreliably — see its own comment).
  if(character && character._levelUpTarget && !pendingChoices.length && !pendingRoleplayChoices.length){
    processNextLevelIfReady(character, character._levelUpFullHeal);
    renderAll();
    return;
  }
  // Same, for backfilling a switched archetype's/subtype's past-level bonuses (see
  // processNextBackfillLevelIfReady) — character.level doesn't move here, only _backfillProgress does.
  if(character && character._backfillTarget && !pendingChoices.length && !pendingRoleplayChoices.length){
    processNextBackfillLevelIfReady(character);
    renderAll();
    return;
  }
  if(!character){
    ['statsBody','statsPersonality','statsAdvSkills','statsCombatSkills','statsCulture','statsNewWorld','statsOldWorld']
      .forEach(id=>document.getElementById(id).innerHTML='<span class="muted">—</span>');
    document.getElementById('hpValue').value='–'; document.getElementById('hpValue').disabled=true;
    document.getElementById('psiValue').value='–'; document.getElementById('psiValue').disabled=true;
    document.getElementById('religionBox').innerHTML='—';
    document.getElementById('progressionBox').innerHTML='<span class="muted">Сгенерируйте персонажа, чтобы увидеть прогрессию.</span>';
    // Subtype/origin/career/alignment stay enabled and keep whatever the player has already set here
    // even with no character yet — these are exactly the fields meant to be configured and locked
    // BEFORE generating (see the 🔒 toggles), so renderAll() must never blank or disable them itself;
    // only an explicit "Сбросить" click does that (see its own handler).
    document.getElementById('fReligionText').value=''; document.getElementById('fReligionText').disabled=true;
    document.getElementById('fAppearanceNum').value=''; document.getElementById('fAppearanceNum').disabled=true;
    document.getElementById('fSizeNum').value=''; document.getElementById('fSizeNum').disabled=true;
    document.getElementById('fLuckNum').value=''; document.getElementById('fLuckNum').disabled=true;
    document.getElementById('fXpNum').value=''; document.getElementById('fXpNum').disabled=true;
    document.getElementById('specializationsBox').innerHTML='';
    document.getElementById('fSiz').value=''; document.getElementById('fPsiSoprot').value='';
    document.getElementById('fRestEquipMod').value='';
    document.getElementById('fArmorBody').value=''; document.getElementById('fArmorHelmet').value=''; document.getElementById('fArmorProps').value='';
    document.getElementById('fConditionsNotes').value='';
    ['stBodrost','stIstoshenie','stIspug','stStress'].forEach(id=>{ document.getElementById(id).checked=false; document.getElementById(id).disabled=true; });
    renderAdvFlaw(); renderAbilities(); renderInventory(); renderHistory(); renderSaves(); renderRest(); renderWeapons(); renderSpiritDie();
    return;
  }
  renderStatBlock('statsBody', BODY);
  renderStatBlock('statsPersonality', PERSONALITY);
  renderStatBlock('statsAdvSkills', ADV_SKILLS);
  renderStatBlock('statsCombatSkills', COMBAT_SKILLS);
  renderStatBlock('statsCulture', CULTURE);
  renderStatBlock('statsNewWorld', NEWWORLD);
  renderStatBlock('statsOldWorld', OLDWORLD);

  {
    const hMax = hpMax(character), pMax = psiMax(character);
    const hpInput = document.getElementById('hpValue');
    hpInput.disabled = false;
    if(document.activeElement !== hpInput) hpInput.value = formatMetric(character.hpCurrent, hMax);
    const psiInput = document.getElementById('psiValue');
    psiInput.disabled = false;
    if(document.activeElement !== psiInput) psiInput.value = formatMetric(character.psiCurrent, pMax);
  }

  {
    // Always force-sync archetype (not just when unfocused): a native confirm() dialog around
    // archetype switching can disrupt focus tracking across browsers in ways that made the old
    // "only sync when not focused" guard unreliable here, leaving the old archetype name displayed.
    refreshArchetypeOptions(); // sets .value/.dataset.key from character.archetypeKey internally
    const subSel = document.getElementById('fSubtypeSelect');
    if(document.activeElement !== subSel){
      subSel.disabled=false;
      refreshSubtypeOptions(); // options are archetype-specific — keep them in sync with the character
    }
    const careerSel = document.getElementById('fCareerSelect'); careerSel.disabled=false;
    if(document.activeElement !== careerSel){
      refreshCareerOptions(); // options are archetype-specific (стр. 51) — keep them in sync with the character
    }
    const originSel = document.getElementById('fOriginSelect'); originSel.disabled=false;
    if(document.activeElement !== originSel){
      refreshOriginOptions(); // options are career-specific (стр. 51) — keep them in sync with the character
    }
  }
  { const el = document.getElementById('fAlignment'); el.disabled=false; if(document.activeElement !== el) el.value = character.alignment || ''; }
  document.getElementById('fAge').value = (AGE_BRACKETS[character.ageKey] || AGE_BRACKETS.y20_29).label;
  { const el = document.getElementById('fReligionText'); el.disabled=false; if(document.activeElement !== el) el.value = character.religionText; }

  {
    const appEl = document.getElementById('fAppearanceNum'); appEl.disabled=false;
    if(document.activeElement !== appEl) appEl.value = character.appearance;
    const sizeEl = document.getElementById('fSizeNum'); sizeEl.disabled=false;
    if(document.activeElement !== sizeEl) sizeEl.value = character.size;
    const luckEl = document.getElementById('fLuckNum'); luckEl.disabled=false;
    if(document.activeElement !== luckEl) luckEl.value = character.luck;
    const xpEl = document.getElementById('fXpNum'); xpEl.disabled=false;
    if(document.activeElement !== xpEl) xpEl.value = character.xp||0;
  }
  renderSpecializations();
  { const el = document.getElementById('fSiz'); if(document.activeElement !== el) el.value = character.siz; }
  { const el = document.getElementById('fPsiSoprot'); if(document.activeElement !== el) el.value = character.psiSoprot; }
  { const el = document.getElementById('fRestEquipMod'); if(document.activeElement !== el) el.value = character.restEquipMod; }
  { const el = document.getElementById('fArmorBody'); if(document.activeElement !== el) el.value = character.armor.body; }
  { const el = document.getElementById('fArmorHelmet'); if(document.activeElement !== el) el.value = character.armor.helmet; }
  { const el = document.getElementById('fArmorProps'); if(document.activeElement !== el) el.value = character.armor.properties; }
  { const el = document.getElementById('fConditionsNotes'); if(document.activeElement !== el) el.value = character.conditionsNotes; }
  document.getElementById('stBodrost').disabled=false; document.getElementById('stBodrost').checked = character.states.bodrost;
  document.getElementById('stIstoshenie').disabled=false; document.getElementById('stIstoshenie').checked = character.states.istoshenie;
  document.getElementById('stIspug').disabled=false; document.getElementById('stIspug').checked = character.states.ispug;
  document.getElementById('stStress').disabled=false; document.getElementById('stStress').checked = character.states.stress;

  renderAdvFlaw();
  document.getElementById('religionBox').innerHTML = character.notes.filter(n=>n.text.startsWith('Религия')).map(n=>n.text).join('<br>') || '<span class="muted">не определена карьерой/происхождением — впишите по отыгрышу</span>';
  renderAbilities();
  renderInventory();
  renderHistory();
  renderSaves();
  renderRest();
  renderWeapons();
  renderSpiritDie();

  // progression display
  const progArch = currentArchetype(character);
  let prog = `<h3>Базовая прогрессия архетипа «${progArch.name}»</h3><ul class="plain">`;
  Object.keys(progArch.baseLevels).forEach(l=>{
    const applied = parseInt(l,10) <= character.level;
    prog += `<li>${applied?'✅':'⬜'} <b>Ур. ${l}</b> — ${progArch.baseLevels[l].filter(m=>m.t!=='choice'&&m.t!=='fixed').length ? '' : ''}${summarizeMods(progArch.baseLevels[l])}</li>`;
  });
  prog += '</ul>';
  if(character.subtypeKey){
    const sub = progArch.subtypes[character.subtypeKey];
    prog += `<h3>Подтип: ${sub.name}</h3><ul class="plain">`;
    Object.keys(sub.levels).forEach(l=>{
      const applied = parseInt(l,10) <= character.level;
      prog += `<li>${applied?'✅':'⬜'} <b>Ур. ${l}</b> — ${summarizeMods(sub.levels[l])}</li>`;
    });
    prog += '</ul>';
  }
  document.getElementById('progressionBox').innerHTML = prog;

  // level selector
  const lvlSel = document.getElementById('fLevel');
  if(lvlSel.options.length===0){
    for(let i=0;i<=20;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; lvlSel.appendChild(o); }
  }
  lvlSel.value = character.level;
}

/* ---- Достоинства / недостатки: render + edit/reroll/remove/add ---- */
function renderAdvFlaw(){
  const el = document.getElementById('advFlawBox');
  if(!character){ el.innerHTML = '<span class="muted">—</span>'; return; }
  const bracket = AGE_BRACKETS[character.ageKey] || AGE_BRACKETS.y20_29;
  const cap = bracket.required + bracket.extra;
  const flawVoluntary = character.flaws.filter(f=>!f.forced);
  const flawForced = character.flaws.filter(f=>f.forced);

  let html = `<h3>Достоинства <span class="muted">(${character.advantages.length} / ${cap})</span></h3>`;
  html += character.advantages.length ? character.advantages.map(a=>`
    <div class="item-line">
      ${a.text} <span class="tag">${a.source}</span>
      <div class="choice-btns" style="margin-top:4px;">
        <button class="small" onclick="editAdvantage('${a.id}')">✎ Изменить</button>
        <button class="small" onclick="rerollAdvantage('${a.id}')">⚄ Заменить случайно</button>
      </div>
    </div>`).join('') : '<div class="muted">нет</div>';
  html += `<div class="choice-btns" style="margin-top:10px;">
    <button class="small" onclick="addAdvantageRandom()">+ Случайное достоинство</button>
    <button class="small" onclick="addAdvantageCustom()">+ Своё достоинство</button>
  </div>`;

  html += `<hr class="divider"><h3>Недостатки <span class="muted">(${flawVoluntary.length} / ${cap}${flawForced.length ? ` + ${flawForced.length} вынужд.` : ''})</span></h3>`;
  html += character.flaws.length ? character.flaws.map(f=>`
    <div class="item-line">
      ${f.text} <span class="tag">${f.source}</span>${f.forced?' <span class="tag" style="color:var(--stamp);border-color:var(--stamp);">вынужденно (уродство/безумство)</span>':''}
      <div class="choice-btns" style="margin-top:4px;">
        <button class="small" onclick="editFlaw('${f.id}')">✎ Изменить</button>
        <button class="small" onclick="rerollFlaw('${f.id}')">⚄ Заменить случайно</button>
        <button class="small" onclick="removeFlaw('${f.id}')">✕ Убрать</button>
      </div>
    </div>`).join('') : '<div class="muted">нет</div>';

  html += `<div class="choice-btns" style="margin-top:10px;">
    <button class="small" onclick="addFlawRandom()">+ Случайный недостаток</button>
    <button class="small" onclick="addFlawCustom()">+ Свой недостаток</button>
  </div>`;
  html += `<div class="muted" style="margin-top:8px;">Возраст определяет обязательное и максимальное число (стр. 75). Уродства/безумства из карьеры и происхождения добавляются в недостатки принудительно и в лимит не считаются.</div>`;
  el.innerHTML = html;
}
window.editAdvantage = async function(id){
  const a = character.advantages.find(x=>x.id===id); if(!a) return;
  const val = await uiPrompt('Текст достоинства:', a.text, {title:'Достоинство', multiline:true});
  if(val!==null && val.trim()!==''){
    logEvent(character, `Достоинство изменено: «${a.text}» → «${val.trim()}».`);
    a.text = val.trim(); a.source='Игрок (изменено)'; renderAll();
  }
};
window.rerollAdvantage = function(id){
  const a = character.advantages.find(x=>x.id===id); if(!a) return;
  const oldText = a.text;
  a.text = rollTable(ADVANTAGE_TABLE,20).text; a.source='Случайно (переброс)';
  logEvent(character, `Достоинство переброшено: «${oldText}» → «${a.text}».`);
  renderAll();
};
async function advantageCapCheck(){
  const bracket = AGE_BRACKETS[character.ageKey] || AGE_BRACKETS.y20_29;
  const cap = bracket.required + bracket.extra;
  if(character.advantages.length >= cap){
    return uiConfirm('Достигнут лимит достоинств для текущего возраста ('+cap+'). Добавить всё равно?', {title:'Лимит достоинств', ok:'Добавить'});
  }
  return true;
}
window.addAdvantageRandom = async function(){
  if(!character || !(await advantageCapCheck())) return;
  const text = rollTable(ADVANTAGE_TABLE,20).text;
  character.advantages.push({id:uid(), text, source:'Случайно (добавлено)', forced:false});
  logEvent(character, `Добавлено случайное достоинство: «${text}».`);
  renderAll();
};
window.addAdvantageCustom = async function(){
  if(!character || !(await advantageCapCheck())) return;
  const val = await uiPrompt('Впишите своё достоинство:', '', {title:'Своё достоинство', multiline:true});
  if(val && val.trim()!==''){
    character.advantages.push({id:uid(), text: val.trim(), source:'Игрок', forced:false});
    logEvent(character, `Добавлено своё достоинство: «${val.trim()}».`);
    renderAll();
  }
};
window.editFlaw = async function(id){
  const f = character.flaws.find(x=>x.id===id); if(!f) return;
  const val = await uiPrompt('Текст недостатка:', f.text, {title:'Недостаток', multiline:true});
  if(val!==null && val.trim()!==''){
    logEvent(character, `Недостаток изменён: «${f.text}» → «${val.trim()}».`);
    f.text = val.trim(); f.source='Игрок (изменено)'; renderAll();
  }
};
window.rerollFlaw = function(id){
  const f = character.flaws.find(x=>x.id===id); if(!f) return;
  const oldText = f.text;
  f.text = rollTable(FLAW_TABLE,12).text; f.source='Случайно (переброс)';
  logEvent(character, `Недостаток переброшен: «${oldText}» → «${f.text}».`);
  renderAll();
};
window.removeFlaw = function(id){
  const f = character.flaws.find(x=>x.id===id);
  if(f) logEvent(character, `Недостаток убран: «${f.text}».`);
  character.flaws = character.flaws.filter(x=>x.id!==id);
  renderAll();
};
async function flawCapCheck(){
  const bracket = AGE_BRACKETS[character.ageKey] || AGE_BRACKETS.y20_29;
  const cap = bracket.required + bracket.extra;
  const voluntary = character.flaws.filter(f=>!f.forced).length;
  if(voluntary >= cap){
    return uiConfirm('Достигнут лимит недостатков для текущего возраста ('+cap+'). Добавить всё равно?', {title:'Лимит недостатков', ok:'Добавить'});
  }
  return true;
}
window.addFlawRandom = async function(){
  if(!character || !(await flawCapCheck())) return;
  const text = rollTable(FLAW_TABLE,12).text;
  character.flaws.push({id:uid(), text, source:'Случайно (добавлено)', forced:false});
  logEvent(character, `Добавлен случайный недостаток: «${text}».`);
  renderAll();
};
window.addFlawCustom = async function(){
  if(!character || !(await flawCapCheck())) return;
  const val = await uiPrompt('Впишите свой недостаток:', '', {title:'Свой недостаток', multiline:true});
  if(val && val.trim()!==''){
    character.flaws.push({id:uid(), text: val.trim(), source:'Игрок', forced:false});
    logEvent(character, `Добавлен свой недостаток: «${val.trim()}».`);
    renderAll();
  }
};

/* ---- Способности: render + append a free-text note ---- */
// Способность даёт переброс, если в её тексте встречается "перебросить"/"переброс" — используется и
// для флажка "потрачено" в самом списке способностей (см. ниже), и для всплывающей кнопки переброса
// после броска (см. showRerollPopup).
function abilityGrantsReroll(text){ return /перебросить|переброс/i.test(text||''); }
function abilityFlagHtml(a){
  if(!abilityGrantsReroll(a.text) && !a.spent) return ''; // потраченная (провал «расходуется до конца дня» на столе) — тоже, чтобы вернуть
  return `<button class="small" onclick="toggleAbilitySpent('${a.id}')">${a.spent?'✓ Потрачено (сбросить)':'○ Доступна (отметить потраченной)'}</button>`;
}
// См. ABILITY_NOTE_LINKS выше — заметки вида "Сила во мне" считаются заново при каждой отрисовке (не
// запекаются на объект способности), поэтому здесь просто фильтруются по факту владения способностью-
// источником (ownedNames — все имена character.abilities, собирается один раз в renderAbilities).
function abilityNoteLinksHtml(name, ownedNames){
  const links = ABILITY_NOTE_LINKS[name];
  if(!links) return '';
  return links.filter(l=>ownedNames.has(l.source)).map(l=>`<div><b><i>Усилено (${escapeHtml(l.source)}): ${linkifyAbilityRollRefs(l.text)}</i></b></div>`).join('');
}
function renderAbilities(){
  const el=document.getElementById('abilitiesBox');
  if(!character){el.innerHTML='<span class="muted">—</span>';return;}
  const ordinary=[], groups={};
  character.abilities.forEach(a=>{ if(a.abilityGroup){const k=a.abilitySource||'Источник';(groups[k] = groups[k] || []).push(a);} else ordinary.push(a); });
  const ownedNames = new Set(character.abilities.map(a=>a.name));
  // Каждая способность — отдельная карточка с подписью источника и уровня; карточки раскладываются по колонкам
  // целиком (layoutAbilityCards): ни заголовок без текста в конце колонки, ни разрыв способности посередине.
  const cards=[], keys=Object.keys(groups);
  keys.forEach(k=>{ const tiers={}; groups[k].forEach(a=>(tiers[a.abilityTier||a.abilityGroup||''] = tiers[a.abilityTier||a.abilityGroup||''] || []).push(a));
    Object.keys(tiers).forEach(t=>tiers[t].forEach(a=>cards.push(`<div class="ab-card ab-card-src"><div class="ab-src"><b>${k}</b>${t ? ' · ' + t : ''}</div><div><b>${a.name}</b>${a.text?': '+linkifyAbilityRollRefs(a.text):''}</div>${a.enhancedText?`<div><b><i>Усилено (${escapeHtml(a.enhancedSource||'')}): ${linkifyAbilityRollRefs(a.enhancedText)}</i></b></div>`:''}${abilityNoteLinksHtml(a.name,ownedNames)}${a.userNote?`<div class="muted">Заметка: ${a.userNote}</div>`:''}<div class="choice-btns"><button class="small" onclick="editAbilityNote('${a.id}')">${a.userNote?'✎ Изменить заметку':'+ Заметка'}</button>${abilityFlagHtml(a)}</div></div>`))); });
  ordinary.forEach(a=>cards.push(`<div class="ab-card"><div class="ab-src"><b>Другие способности</b></div><div><b>${a.name||'Способность'}</b>${a.text?': '+linkifyAbilityRollRefs(a.text):''} <span class="tag">${a.source}</span></div>${a.userNote?`<div class="muted">Заметка: ${a.userNote}</div>`:''}<div class="choice-btns"><button class="small" onclick="editAbilityNote('${a.id}')">${a.userNote?'✎ Изменить заметку':'+ Заметка'}</button>${abilityFlagHtml(a)}</div></div>`));
  if(!cards.length){ el.innerHTML='<span class="muted">—</span>'; return; }
  el.innerHTML=(keys.length ? '<div class="muted" style="margin-bottom:6px;">Предписанные способности — получены из архетипа и его источников.</div>' : '') + '<div class="ab-cols" data-ab-cols>' + cards.join('') + '</div>';
  layoutAbilityCards();
}
// Раскладка карточек способностей: 3 колонки (2 на средних, 1 на узких), каждая карточка — в самую короткую
// колонку (длинные — первыми), внутри колонки — в исходном порядке; колонки почти одной высоты, без пустот посреди текста.
function layoutAbilityCards(){
  const box = document.querySelector('#abilitiesBox [data-ab-cols]'); if(!box || !box.offsetParent) return;
  const cards = Array.from(box.querySelectorAll('.ab-card')); if(!cards.length) return;
  const w = box.clientWidth, k = w >= 900 ? 3 : w >= 560 ? 2 : 1;
  if(+box.dataset.k === k && box.dataset.n === String(cards.length) && box.dataset.w === String(w)) return;
  box.querySelectorAll(':scope > .ab-col').forEach(c=>c.remove());
  const cols = []; for(let i=0;i<k;i++){ const c = document.createElement('div'); c.className = 'ab-col'; box.appendChild(c); cols.push(c); }
  cards.forEach(c=>cols[0].appendChild(c)); const hs = cards.map(c=>c.offsetHeight), h = new Array(k).fill(0);
  // сначала самые длинные — каждая в самую короткую колонку (так колонки выравниваются лучше всего), внутри колонки — исходный порядок
  const to = new Array(cards.length); cards.map((c, i)=>i).sort((x, y)=>hs[y] - hs[x]).forEach(i=>{ let best = 0; for(let j=1;j<k;j++) if(h[j] < h[best] - 1) best = j; to[i] = best; h[best] += hs[i] + 10; });
  cards.forEach((c, i)=>cols[to[i]].appendChild(c));
  box.dataset.k = k; box.dataset.n = cards.length; box.dataset.w = w;
}
window.addEventListener('resize', ()=>{ clearTimeout(window.__abT); window.__abT = setTimeout(layoutAbilityCards, 120); });
// лист мог быть скрыт при отрисовке (другая вкладка) — разложить, когда раздел получит размер
if(window.ResizeObserver){ const abBox = document.getElementById('abilitiesBox'); if(abBox) new ResizeObserver(()=>{ clearTimeout(window.__abT); window.__abT = setTimeout(layoutAbilityCards, 60); }).observe(abBox); }
window.toggleAbilitySpent = function(id){
  const a = character.abilities.find(x=>x.id===id); if(!a) return;
  a.spent = !a.spent;
  logEvent(character, `Способность «${a.name||'?'}»: отмечена как ${a.spent?'потраченная':'снова доступная'}.`);
  renderAll();
};
// "↺ Сбросить все" рядом с заголовком блока способностей — возвращает флажок ВСЕХ потраченных
// способностей (не только тех, что дают переброс — способность может быть отмечена потраченной и без
// переброса, если игрок сам когда-то щёлкнул флажок) обратно в "Доступна" одним нажатием, а не по
// одной. Ничего, кроме флажка a.spent, не трогает.
window.resetAllAbilitySpent = function(){
  if(!character) return;
  const spentAbilities = character.abilities.filter(a=>a.spent);
  if(!spentAbilities.length) return;
  spentAbilities.forEach(a=>{ a.spent = false; });
  logEvent(character, `Способности: сброшен флажок "потрачено" у всех (${spentAbilities.length}).`);
  renderAll();
};
window.editAbilityNote = async function(id){
  const a = character.abilities.find(x=>x.id===id); if(!a) return;
  const val = await uiPrompt('Заметка к способности «'+(a.name||'')+'»:', a.userNote||'', {title:'Заметка к способности', multiline:true});
  if(val!==null){
    a.userNote = val.trim();
    logEvent(character, `Заметка к способности «${a.name||''}»: ${a.userNote ? '«'+a.userNote+'»' : '(очищена)'}.`);
    renderAll();
  }
};

/* ---- Specializations: render 4 slots (hidden until level unlocks them) ---- */
function renderSpecializations(){
  const el = document.getElementById('specializationsBox');
  if(!character){ el.innerHTML = '<span class="muted">—</span>'; return; }
  el.innerHTML = character.specializationPicks.map((slot, i)=>{
    if(character.level < slot.level){
      return `<div class="col-3"><div class="item-line muted">Слот ${i+1} (с ${slot.level} ур.) — пока недоступен.</div></div>`;
    }
    const options = computeSlotOptions(character, i);
    const currentValue = slot.key ? `${slot.key}:${slot.tier}` : '';
    // make sure the currently-picked option is present even if computeSlotOptions (built with this
    // slot excluded from the taken-map) would otherwise offer a different tier for it
    let optsHtml = `<option value="">— не выбрано —</option>`;
    optsHtml += options.map(o=>`<option value="${o.value}" ${o.value===currentValue?'selected':''}>${o.label}</option>`).join('');
    const spec = slot.key ? SPECIALIZATIONS[slot.key] : null;
    const desc = spec ? summarizeSpecTier(spec, slot.tier) : '';
    return `<div class="col-3">
      <div class="muted" style="margin-bottom:3px;">Специализация ${i+1} (ур.${slot.level})</div>
      <select onchange="pickSpecSlot(${i}, this.value)">${optsHtml}</select>
      ${desc ? `<div class="muted" style="margin-top:4px;">${desc}</div>` : ''}
    </div>`;
  }).join('');
}
function summarizeSpecTier(spec, tier){
  const mods = tier===1 ? spec.tier1 : spec.tier2;
  return mods.map(m=>{
    if(m.t==='ability') return `<i>${m.name}</i>`;
    if(m.t==='fixed') return `${STAT_LABELS[m.stat]} ${m.delta>0?'+':''}${m.delta}`;
    if(m.t==='note') return m.text;
    if(m.t==='roleplay') return `${m.label} <span class="pill">выбор игрока</span>`;
    if(m.t==='hpBySize') return `Максимум ОЗ +[размер${m.plus ? ' + ' + m.plus : ''}]`;
    if(m.t==='sturdyWeapon') return '«Любимое оружие», а если уже есть — навык боя +2 (не выше 4)';
    return '';
  }).filter(Boolean).join('; ');
}

/* ---- Инвентарь: render 4 sections + capacity ---- */
function invRowHtml(item, category){
  const rerollBtn = item.fromTable
    ? `<button class="small" onclick="rerollInventoryItem('${category}','${item.id}')">⚄ Переброс</button>`
    : '';
  // ПР(X) — «Проверка Ресурса»: у предмета в тексте встречается "ПР N" (Максимум к6-проверки, см.
  // parseResourceCheck). Кнопка запускает тот же жест, что и основной бросок характеристики, просто
  // гексы выбирают количество кубиков вместо модификатора (см. openItemRollPicker) — счётчик рядом
  // сокращается сам при провале (executeItemRoll), но его можно поправить и вручную ±/по клику.
  const prMax = parseResourceCheck(item.name);
  const prControls = prMax==null ? '' : (()=>{
    const uses = item.uses==null?1:item.uses;
    return `<button class="small" onpointerdown="event.preventDefault();openItemRollPicker('${category}','${item.id}',event.clientX,event.clientY)" title="Проверка ресурса: к6 с Максимумом ${prMax}">⚄ ПР(${prMax})</button>
      <span class="item-uses" title="Количество — сокращается при провале ПР">
        <button class="small" onclick="adjustItemUses('${category}','${item.id}',-1)">−</button>
        <b onclick="editItemUses('${category}','${item.id}')">${uses}</b>
        <button class="small" onclick="adjustItemUses('${category}','${item.id}',1)">+</button>
      </span>`;
  })();
  // "Надеть" — только у предметов, где в тексте встречается "Защита" (реальная броня по формату
  // книги, см. parseArmorZones) — остальные вещи (еда, инструменты и т.д.) кнопку не получают, чтобы
  // не загромождать список. worn — зоны уже надетого предмета, если есть, показаны прямо в кнопке.
  const isArmorLike = /Защита/.test(item.name);
  const worn = item.wornZones && item.wornZones.length;
  const wearBtn = !isArmorLike ? '' : `<button class="small" onclick="openEquipZonesPicker('${category}','${item.id}')" title="${worn?('Надето: '+item.wornZones.map(z=>ARMOR_ZONE_LABELS[z]).join(', ')):'Отметить зоны и надеть'}">${worn?'🛡 Надето ✎':'🛡 Надеть'}</button>`;
  // Сапоги — отдельный слот от зон брони (см. isBootLike/toggleWearBoots): по названию "ботинки"/
  // "сапоги", простой тумблер вместо попапа, т.к. пара всего одна и выбирать нечего.
  const bootLike = isBootLike(item.name);
  const bootBtn = !bootLike ? '' : `<button class="small" onclick="toggleWearBoots('${category}','${item.id}')">${item.wornBoots?'🥾 Снять':'🥾 Надеть'}</button>`;
  // Модификатор отдыха ("Ближайший отдых +1" и т.п., см. parseRestMod) — включается/выключается
  // отдельно от "надето": может быть и разовой едой, а не только снаряжением.
  const restMod = parseRestMod(item.name);
  const restModBtn = restMod==null ? '' : `<button class="small" onclick="toggleRestMod('${category}','${item.id}')" title="Отдых ${restMod>=0?'+':''}${restMod} на Равнине, если включено">${item.restModActive?'Не использовать':'Использовать'} (отдых ${restMod>=0?'+':''}${restMod})</button>`;
  // "Экипировать"/"Снять"/"Заменить" — только у предметов, где в тексте узнаётся оружейный стат-блок
  // (Ат.../МУ..., см. parseWeaponStats) — тот же принцип, что и isArmorLike выше для "Надеть".
  const weaponStats = parseWeaponStats(item.name);
  const weaponBtn = weaponStats ? weaponEquipButtonHtml(category, item, weaponStats) : '';
  // Щиты-приборы («Кинетический щит», «Генератор щита») — стол учитывает их в атаках, пока включены (characterGearEffects);
  // «Кинезис-латы» (надетые) — кнопка «+2 временных ОЗ», раз в бой
  const gearBtn = !GEAR_TOGGLE_RE.test(item.name) ? '' : `<button class="small" onclick="toggleGearActive('${category}','${item.id}')" title="Пока включено, стол снижает МУ атак по персонажу и его собственных атак (см. текст предмета)">${item.gearActive?'🛡 Убрать':'🛡 Использовать'}</button>`;
  const tempHpM = worn ? /даёт\s+(\d+)\s+временн\S*\s+ОЗ/i.exec(item.name) : null;
  const tempHpBtn = !tempHpM ? '' : `<button class="small" onclick="useItemTempHp('${category}','${item.id}')" title="Раз в бой, в свой ход">⚡ +${tempHpM[1]} врем. ОЗ</button>`;
  return `<div class="item-line" draggable="true" ondragstart="onInvDragStart(event,'${category}','${item.id}')">
    <b>${item.name}</b> <span class="muted">(вес: ${item.weight})</span> <span class="tag">${item.source}</span>${worn?` <span class="tag worn-tag">Надето: ${item.wornZones.map(z=>ARMOR_ZONE_LABELS[z]).join(', ')}</span>`:''}${item.wornBoots?` <span class="tag worn-tag">Надето (сапоги)</span>`:''}${item.restModActive?` <span class="tag worn-tag">Отдых ${restMod>=0?'+':''}${restMod} включён</span>`:''}${item.gearActive && gearBtn?` <span class="tag worn-tag">Используется</span>`:''}
    <div class="choice-btns" style="margin-top:4px;">
      <button class="small" onclick="editInventoryItem('${category}','${item.id}')">✎ Изменить</button>
      ${wearBtn}
      ${gearBtn}
      ${tempHpBtn}
      ${bootBtn}
      ${restModBtn}
      ${weaponBtn}
      ${prControls}
      ${rerollBtn}
      <button class="small" onclick="removeInventoryItem('${category}','${item.id}')">✕</button>
    </div>
  </div>`;
}
function renderInventory(){
  const cats = [['on_body','invOnBody'],['pockets','invPockets'],['backpack','invBackpack'],['tiny','invTiny']];
  cats.forEach(([key,elId])=>{
    const el = document.getElementById(elId);
    if(!character){ el.innerHTML = '<span class="muted">—</span>'; return; }
    const list = character.inventory[key];
    el.innerHTML = list.length ? list.map(it=>invRowHtml(it,key)).join('') : '<div class="muted">пусто</div>';
  });
  const cap = document.getElementById('invCapacity');
  const hugeInput = document.getElementById('fHugeCapacity');
  const creditsInput = document.getElementById('fCredits');
  if(!character){ cap.textContent=''; hugeInput.value=''; creditsInput.value=''; creditsInput.disabled=true; document.getElementById('pendingItemRollsBox').innerHTML=''; renderArmorZones(); return; }
  cap.textContent = `Вещей (сила + 12): ${character.stats.sila + 12}`;
  hugeInput.value = character.hugeItemsCapacity || '';
  creditsInput.disabled = false;
  if(document.activeElement !== creditsInput) creditsInput.value = character.credits;
  refreshCatalogPreview(); // «хватает ли кредитов» под каталогом — по свежему остатку
  renderPendingItemRolls();
  renderArmorZones(); // зависит от wornZones предметов инвентаря — пересчитывается вместе с ним
}
function renderPendingItemRolls(){
  const box = document.getElementById('pendingItemRollsBox');
  if(!pendingItemRolls.length){ box.innerHTML=''; return; }
  box.innerHTML = `<div class="pending"><h3>🎲 Выбор предмета по таблице</h3>
    <div class="muted">Включён ручной режим — выберите, что персонаж получает вместо случайного броска.</div>
    <div id="pendingItemRollsList"></div></div>`;
  const list = document.getElementById('pendingItemRollsList');
  pendingItemRolls.forEach(p=>{
    const row = document.createElement('div');
    row.style.marginTop = '10px';
    row.innerHTML = `<div><b>${p.title}</b></div>`;
    const btns = document.createElement('div'); btns.className = 'choice-btns';
    p.options.forEach(opt=>{
      const b = document.createElement('button'); b.className = 'small';
      b.textContent = opt.label;
      b.onclick = ()=>{
        opt.apply(character);
        pendingItemRolls = pendingItemRolls.filter(x=>x.id!==p.id);
        logEvent(character, `Предмет выбран по таблице «${p.title}»: ${opt.label}.`);
        renderAll();
      };
      btns.appendChild(b);
    });
    row.appendChild(btns);
    list.appendChild(row);
  });
}
window.rerollInventoryItem = function(category, id){
  const item = character.inventory[category].find(x=>x.id===id);
  if(!item || !item.fromTable) return;
  // find the original table data by matching label — tables are attached to their modifier definitions,
  // so re-resolve via the same tables used at generation time.
  const tableMap = {
    'Предмет аристократа': ARISTOKRAT_ITEM_TABLE,
    'Снаряжение (общий выбор)': STARTING_GEAR_CHOICE_TABLE,
    'Медикаменты (Хлам)': JUNK_GEN_MEDS_TABLE
    // 'Диггерское снаряжение' теперь itemBundle (несколько предметов на строку), переброс не применяется — см. case 'itemBundle'.
    // 'Оружие (Хлам)' и 'Снаряжение 2-5 ур. (выбор)' теперь itemBundle (несколько предметов на строку) —
    // у их результатов больше нет fromTable-метки, переброс к ним не применяется, см. case 'itemBundle'.
  };
  const rows = tableMap[item.fromTable.label];
  if(!rows) return;
  // undo any credits this specific item previously carried (e.g. a weapon-table row bundled with money)
  const oldCreditsEntry = character.creditsLog.find(e=>e.itemId===id);
  if(oldCreditsEntry){
    character.credits -= oldCreditsEntry.amount;
    character.creditsLog = character.creditsLog.filter(e=>e!==oldCreditsEntry);
  }
  const oldName = item.name;
  const row = rollTable(rows, item.fromTable.diceMax);
  let creditsGained = 0;
  if(row.credits !== undefined){
    creditsGained = typeof row.credits==='function' ? row.credits() : row.credits;
    character.creditsLog.push({source:item.source, amount:creditsGained, itemId: row.creditsOnly ? null : id});
    character.credits += creditsGained;
  }
  if(row.creditsOnly){
    // this row is pure money with no physical item — the inventory row it used to occupy goes away
    character.inventory[category] = character.inventory[category].filter(x=>x.id!==id);
    logEvent(character, `Переброс предмета (${item.fromTable.label}): «${oldName}» → деньги (+${creditsGained}).`);
  } else {
    item.name = row.text;
    item.weight = extractItemWeight(row.text);
    logEvent(character, `Переброс предмета (${item.fromTable.label}): «${oldName}» → «${row.text}»${creditsGained?` (+${creditsGained} кредитов)`:''}.`);
  }
  renderAll();
};
window.editInventoryItem = async function(category, id){
  const item = character.inventory[category].find(x=>x.id===id);
  if(!item) return;
  const r = await uiForm('Предмет', [{name:'name', label:'Название / описание', value:item.name, multiline:true},
    {name:'weight', label:'Вес (число + «Вещь»/«Вещи»/«Крш.»)', value:item.weight}], {ok:'Сохранить'});
  if(!r || r.name.trim()==='') return;
  const newName = r.name, newWeight = r.weight;
  const oldSummary = `${item.name} (вес: ${item.weight})`;
  item.name = newName.trim();
  if(newWeight!==null && newWeight.trim()!=='') item.weight = newWeight.trim();
  logEvent(character, `Предмет изменён (${category}): «${oldSummary}» → «${item.name} (вес: ${item.weight})».`);
  renderAll();
};
// Счётчик количества у предметов с ПР(X) (см. parseResourceCheck/invRowHtml) — сокращается сам при
// провале проверки ресурса (executeItemRoll), но игрок может поправить его и вручную: ±1 кнопками или
// точным числом по клику на само значение.
window.adjustItemUses = function(category, id, delta){
  const item = character.inventory[category].find(x=>x.id===id);
  if(!item) return;
  item.uses = Math.max(0, (item.uses==null?1:item.uses) + delta);
  renderInventory();
};
window.editItemUses = async function(category, id){
  const item = character.inventory[category].find(x=>x.id===id);
  if(!item) return;
  const val = await uiPrompt('Количество (сокращается при провале ПР):', String(item.uses==null?1:item.uses), {title:'Количество', type:'number'});
  if(val===null) return;
  const n = parseInt(val,10);
  if(!isNaN(n) && n>=0) item.uses = n;
  renderInventory();
};
window.onInvDragStart = function(ev, category, id){
  ev.dataTransfer.setData('text/plain', JSON.stringify({category, id}));
  ev.dataTransfer.effectAllowed = 'move';
};
window.onInvDragOver = function(ev){
  ev.preventDefault();
  ev.currentTarget.classList.add('drag-over');
};
window.onInvDrop = function(ev, targetCategory){
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  let data;
  try { data = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch(e) { return; }
  if(!data || !data.category || data.category===targetCategory) return;
  const idx = character.inventory[data.category].findIndex(it=>it.id===data.id);
  if(idx===-1) return;
  const [item] = character.inventory[data.category].splice(idx,1);
  character.inventory[targetCategory].push(item);
  const catLabels = {on_body:'Вещи на себе/в руках', pockets:'В карманах и подсумках', backpack:'Вещи в рюкзаке', tiny:'Крошечные вещи'};
  logEvent(character, `Предмет перемещён: «${item.name}» (${catLabels[data.category]} → ${catLabels[targetCategory]}).`);
  renderAll();
};
window.removeInventoryItem = function(category, id){
  logEvent(character, `Предмет убран из инвентаря (${category}): ${(character.inventory[category].find(x=>x.id===id) || {}).name || '?'}.`);
  character.inventory[category] = character.inventory[category].filter(x=>x.id!==id);
  renderAll();
};

function escapeAttr(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

/* ---- Спасброски: от смерти и от вредной среды ---- */
function renderSaves(){
  const el = document.getElementById('savesBox');
  if(!character){ el.innerHTML=''; return; }
  const acidMax = getAcidCheckMax();
  el.innerHTML = `
    <div class="item-line">${saveRollLinkHtml('save_smert')}: <b>${SAVE_ROLL_DEFS.save_smert.base()}</b></div>
    <div class="item-line">${saveRollLinkHtml('save_vrednaya_sreda')}: <b>${SAVE_ROLL_DEFS.save_vrednaya_sreda.base()}</b></div>
    <div class="item-line">${saveRollLinkHtml('save_pryamoy_kontakt')}: <b>${SAVE_ROLL_DEFS.save_pryamoy_kontakt.base()}</b></div>
    <div class="item-line">${saveRollLinkHtml('save_psi_pole')}: <b>${SAVE_ROLL_DEFS.save_psi_pole.base()}</b></div>
    ${acidMax!=null
      ? `<div class="item-line">${saveRollLinkHtml('save_kislotnost')}: <b>${acidMax}</b></div>`
      : `<div class="item-line muted">Кислотность: наденьте броню и/или сапоги с указанным в тексте СК — Максимум посчитается сам.</div>`}
  `;
}

/* ---- Отдых ---- */
function renderRest(){
  const el = document.getElementById('restBox');
  if(!character){ el.innerHTML=''; return; }
  el.innerHTML = `
    <div class="item-line">${saveRollLinkHtml('save_rest_dvor')}: <b>${SAVE_ROLL_DEFS.save_rest_dvor.base()}</b></div>
    <div class="item-line">${saveRollLinkHtml('save_rest_ravnina')}: <b>${SAVE_ROLL_DEFS.save_rest_ravnina.base()}</b></div>
  `;
}

/* ---- Атака / оружие ---- */
function renderWeapons(){
  const el = document.getElementById('weaponsBox');
  if(!character){ el.innerHTML=''; return; }
  resyncWeaponSlots(); // подхватывает экипировку из инвентаря (снятие/переброс/перемещение предмета) перед отрисовкой
  el.innerHTML = character.weapons.map((w,i)=>{
    const skill = weaponCombatSkill(w);
    const eff = w.name ? sheetWeaponEffective(character, i) : null;
    const blockedWhy = w.name ? weaponBlockedReason(character, i) : null; // недоступно по силе / не заряжено — кнопки атаки неактивны
    const attackBtn = skill ? `<button class="small" ${blockedWhy?`disabled title="${escapeAttr(blockedWhy)}"`:''} onpointerdown="event.preventDefault();openSaveRollPicker('attack_weapon${i}',event.clientX,event.clientY)" title="Нажмите и протяните — бросок атаки: ${escapeAttr(STAT_LABELS[skill])} ${character.stats[skill]+10>=0?'+':''}${character.stats[skill]+10}, Ат оружия ${w.at>=0?'+':''}${w.at}">🎯 Атака</button>` : '';
    // Автоматическое оружие — два доп. режима огня (см. SAVE_ROLL_DEFS.burst_weapon*/suppress_weapon*
    // выше), плюс чекбокс дистанции >12м, который читает base() очереди при открытии поповера.
    const autoBtns = (skill && w.avtomat) ? `
      <div class="field-row" style="margin-top:4px; align-items:center; gap:10px;">
        <button class="small" ${blockedWhy?'disabled':''} onpointerdown="event.preventDefault();openSaveRollPicker('burst_weapon${i}',event.clientX,event.clientY)" title="Длинная очередь: успех даёт [КУ+3] попаданий">💥 Очередь</button>
        <button class="small" ${blockedWhy?'disabled':''} onpointerdown="event.preventDefault();openSaveRollPicker('suppress_weapon${i}',event.clientX,event.clientY)" title="Подавляющий огонь: фикс. Максимум 12, успех даёт [КУ] попаданий по каждой цели в зоне">🌫 Подавление</button>
        <label style="font-size:11px; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="weaponBurstFar${i}"> дистанция &gt;12м (−6 к очереди)</label>
      </div>` : '';
    // Оптика — необязательный +6, включённый чекбоксом читается тем же base() атаки/очереди выше в
    // момент открытия поповера (то есть до жеста, не задним числом).
    const optikaToggle = (skill && w.optika) ? `
      <div class="field-row" style="margin-top:4px; align-items:center;">
        <label style="font-size:11px; display:flex; align-items:center; gap:4px;"><input type="checkbox" id="weaponOptika${i}"> 🔭 Оптика: цель 30м+, реакция (+6 к атаке)</label>
      </div>` : '';
    // Однозарядное/Пальба — требуют перезарядку действием между атаками (см. "Черты оружия"), этот
    // лист не считает ходы/действия — переключатель чисто информационный (см. toggleWeaponLoaded).
    const reloadToggle = w.odnozaryadnoe ? `<button class="small" onclick="toggleWeaponLoaded(${i})">${w.loaded?'🔋 Заряжено':'🪫 Разряжено — перезарядить (действие)'}</button>` : '';
    // "Скорость" — доступность бонусного попадания на первую атаку в бою (см. skorost/speedBonusAvailable,
    // снимается в resolveWeaponAttackOutcome) — ручной чекбокс, игрок сам возобновляет после боя.
    const skorostToggle = w.skorost ? `<label style="font-size:11px; display:flex; align-items:center; gap:4px; margin:2px 0;"><input type="checkbox" ${w.speedBonusAvailable?'checked':''} onchange="toggleWeaponSpeedBonus(${i})"> ⚡ Скорость: бонусное попадание на первую атаку в бою доступно</label>` : '';
    const notes = eff ? eff.techNotes.concat(eff.condNotes.map(n=>n.charAt(0).toUpperCase()+n.slice(1))) : [];
    if(eff && eff.slow) notes.push('Медленное — цель может отреагировать');
    if(eff && eff.woundsDice) notes.push(`Раны ${eff.woundsDice.n>1?eff.woundsDice.n:''}к${eff.woundsDice.sides} — бросаются на каждое попадание`);
    if(eff && eff.woundsVsHp) notes.push(`Раны ${eff.woundsVsHp.wounds}, если у цели ${eff.woundsVsHp.hp}+ ОЗ (считается при атаке с игрового стола)`);
    if(w.palba) notes.push('Пальба — ПР боеприпаса этого оружия тратит 3 вместо 1, пока оно экипировано');
    // Сила ниже Сл без штрафа в тексте — недоступно, пока Мастер не выдаст (флажок меняет Мастер в правке листа)
    const canGrant = !session.role || !!session.editingPlayerId; // Мастер в правке листа игрока (или лист без сессии)
    const issued = w.name ? weaponSlotGmIssued(character, w) : false;
    const needsGrant = w.name && w.sl!=null && (character.stats.sila||0) < w.sl && eff && (eff.unavailable || issued);
    const grantHtml = needsGrant
      ? (canGrant ? `<label style="font-size:11px; display:flex; align-items:center; gap:4px; margin:2px 0;"><input type="checkbox" ${issued?'checked':''} onchange="toggleWeaponGmIssued(${i})"> 🛡 Выдано Мастером (можно при силе ниже Сл${w.sl})</label>`
                  : (issued ? '<div class="muted" style="margin:2px 0;">🛡 Выдано Мастером — доступно при силе ниже Сл</div>' : ''))
      : '';
    if(blockedWhy && !/Нет оружия/.test(blockedWhy)) notes.unshift(blockedWhy);
    // "Мощь не работает, если указаны раны" — оба тега сейчас не должны встречаться на одном оружии
    // одновременно (проверено по всему каталогу), но если игрок впишет такое вручную — раны побеждают
    // молча (см. moshhActive в resolveWeaponAttackOutcome), а карточка явно предупреждает об этом,
    // а не просто тихо игнорирует один из тегов.
    if(w.moshh && w.hasExplicitWounds) notes.push('Мощь не применяется — у оружия явно указаны раны, раны побеждают');
    const techWarning = notes.length ? `<div class="muted" style="margin-top:4px;">⚠ ${notes.map(escapeHtml).join(' · ')}</div>` : '';
    return `
    <div class="item-line">
      <div class="field-row" style="align-items:center; justify-content:space-between; margin-bottom:0;">
        <b>Оружие ${i+1}</b>
        <span>${attackBtn} ${reloadToggle} ${w.itemId ? `<button class="small" onclick="unequipWeapon(${i})">⚔ Снять</button>` : ''}</span>
      </div>
      <div class="field-row" style="margin-top:4px;">
        <div class="field"><label>Название</label><input type="text" value="${escapeAttr(w.name)}" oninput="updateWeaponField(${i},'name',this.value)"></div>
      </div>
      ${w.properties ? `<div class="muted" style="margin:2px 0 6px;">${w.properties}</div>` : ''}
      ${skorostToggle}
      <div class="field-row">
        <div class="field" style="max-width:90px;"><label>Ат</label><input type="number" value="${w.at}" oninput="updateWeaponField(${i},'at',this.value)"></div>
        <div class="field" style="max-width:90px;"><label>МУ</label><input type="number" value="${w.mu}" oninput="updateWeaponField(${i},'mu',this.value)"></div>
        ${w.dl!=null ? `<div class="field" style="max-width:90px;"><label>Дл</label><input type="number" value="${w.dl}" oninput="updateWeaponField(${i},'dl',this.value)"></div>` : ''}
        ${w.pr!=null ? `<div class="field" style="max-width:90px;"><label>Пр</label><input type="number" value="${w.pr}" oninput="updateWeaponField(${i},'pr',this.value)"></div>` : ''}
      </div>
      ${autoBtns}
      ${optikaToggle}
      ${grantHtml}
      ${techWarning}
    </div>`;
  }).join('');
}
window.updateWeaponField = function(idx, field, value){
  if(!character) return;
  character.weapons[idx][field] = ['at','mu','dl','pr'].includes(field) ? (parseInt(value,10)||0) : value;
};

function renderHistory(){
  const el = document.getElementById('historyBox');
  if(!character || !character.history || !character.history.length){
    el.innerHTML = '<span class="muted">—</span>';
    return;
  }
  el.innerHTML = character.history.slice().reverse().map(h=>
    `<div class="item-line"><span class="tag">${h.t}</span> ${h.text}</div>`
  ).join('');
}

function summarizeMods(mods){
  return mods.map(m=>{
    if(m.t==='note') return `<span class="${m.text.startsWith('TODO')?'todo':''}">${m.text}</span>`;
    if(m.t==='ability') return `<i>${m.name}</i>`;
    if(m.t==='roleplay') return `<span class="pill">требует выбора игрока</span> ${m.label}`;
    if(m.t==='fixed') return `${STAT_LABELS[m.stat]} ${m.delta>0?'+':''}${m.delta}`;
    if(m.t==='distribute') return `распределить ${m.points} очк. (макс ${m.maxPer}/хар-ку)`;
    return '';
  }).filter(Boolean).join('; ') || '<span class="muted">—</span>';
}

