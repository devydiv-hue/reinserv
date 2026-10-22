/* ======================================================================
   СОВМЕСТНАЯ СЕССИЯ: общий лог бросков + правки листа от ГМ — через WebSocket к серверу,
   который ГМ запускает у себя (server.js + start.bat, отдельные файлы рядом с этим листом).
   Сервер — тупая рассылка: у каждого клиента есть id, сообщение с полем "to" доходит только до
   одного адресата, без "to" — рассылается всем остальным. Вся игровая логика (кто Мастер, кто
   каким игроком представился, дедупликация бросков и т.д.) — здесь, в браузере, сервер о ней не
   знает вообще. И сервер, и сам лист персонажа при этом отдаются с одной и той же машины ГМа —
   игроку достаточно открыть присланную ссылку в браузере, ничего скачивать/устанавливать не нужно.
   Лог бросков пишется в localStorage сразу и локально (работает и без связи); рассылка/синхронизация —
   уже поверх этого, не вместо. Правки от ГМа — вариант «целиком»: Мастер открывает лист игрока в своём
   же редакторе, правит как обычно, отправляет — у игрока лист перезаписывается целиком (как при
   загрузке сохранения), а не накатывается точечными командами.
   ====================================================================== */
function sessionAvailable(){ return typeof WebSocket !== 'undefined'; }

/* ======================================================================
   НАЧИСЛЕНИЕ ОПЫТА — вкладка #xpTabView (переключается вместе с #sheetTabView, см. toggleMainTab).
   Текст деяний — книга, +1 опыта каждому подключённому игроку за пункт; "Большая пятёрка" — отдельный
   список, +2 за пункт (см. XP_DEED_WEIGHT). Отмечает только Мастер (см. renderXpChecklist/toggleXpDeed
   — disabled у игрока), отметка сразу шлёт дельту ВСЕМ подключённым игрокам разом (see broadcastXp) —
   не по одному, как у "Выдать удачу" одному игроку, потому что книга явно про группу целиком.
   ====================================================================== */
const XP_DEEDS_MINOR = [
  'Группа участвовала в сражении, которое двигало сюжетную арку вперёд, а не носило лишь ситуативный характер.',
  'Группа участвовала в социальной сцене, которая двигала сюжетную арку вперёд, а не носила ситуативный характер.',
  'Группа преодолела небоевой, несоциальный вызов (побег, расследование, путешествие и т.д.), который двигал сюжетную арку вперёд и не был ситуативным.',
  'Персонажи игроков провели суммарно 4 дня и более в путешествии по Равнине или за исследованием руин.',
  'Группа смогла найти 2 и более Находок.',
  'Хоть один персонаж игрока поговорил по душам с персонажем другого игрока.',
  'Хоть один недостаток персонажа игрока создал сложности группе по инициативе самого игрока.',
  'Хоть один персонаж игрока получил заражение и отыграл его влияние.',
  'За игровую встречу в мире «Реинкарнатора» прошло 10 и более дней.',
  'Мастер считает, что в имеющей последствия ситуации игрок придумал, как оригинально использовать предмет, и получил от этого выгоду.',
];
const XP_DEEDS_MINOR_NOTE = 'Примечание. Для соблюдения десятого деяния мастеру не стоит требовать от игроков совсем уж уникальных задумок. Игра поощряет ношение и творческое использование даже бесполезного хлама.';
const XP_DEEDS_MAJOR = [
  'Мастер может без тени сомнений утверждать, что игроки не вели удручающих совещаний длиной более 15 минут.',
  'Хоть один из персонажей игроков сменил мировоззрение, достоинство или недостаток.',
  'Группа противостояла в сцене хоть одной пустоте или нашла хоть одну реликвию.',
  'Хоть в одной сцене группа лицом к лицу противостояла антагонисту, которого персонажи знают 2 игровые встречи и дольше.',
  'Хоть один из персонажей игроков погиб.',
];
const XP_DEED_WEIGHT = { minor:1, major:2 };
const XP_CHECKLIST_KEY = 'reincarnator_xp_checklist_v1';
function blankXpChecklist(){ return { minor: XP_DEEDS_MINOR.map(()=>false), major: XP_DEEDS_MAJOR.map(()=>false) }; }
function loadXpChecklist(){
  try{
    const v = JSON.parse(localStorage.getItem(XP_CHECKLIST_KEY)||'null');
    if(v && Array.isArray(v.minor) && Array.isArray(v.major) && v.minor.length===XP_DEEDS_MINOR.length && v.major.length===XP_DEEDS_MAJOR.length) return v;
  }catch(e){}
  return blankXpChecklist();
}
function saveXpChecklist(){ try{ localStorage.setItem(XP_CHECKLIST_KEY, JSON.stringify(session.xpChecklist)); }catch(e){} }
function renderXpChecklistGroup(containerId, group, deeds){
  const editable = session.role !== 'player';
  const box = document.getElementById(containerId);
  box.innerHTML = deeds.map((text,i)=>{
    const checked = !!session.xpChecklist[group][i];
    return `<label class="xp-deed-row${checked?' checked':''}">
      <input type="checkbox" data-xp-group="${group}" data-xp-index="${i}" ${checked?'checked':''} ${editable?'':'disabled'}>
      <span class="xp-deed-num">${i+1}.</span><span class="xp-deed-text">${escapeHtml(text)}</span>
    </label>`;
  }).join('') + (group==='minor' ? `<div class="muted" style="margin-top:8px;">${escapeHtml(XP_DEEDS_MINOR_NOTE)}</div>` : '');
  if(!editable) return;
  box.querySelectorAll('[data-xp-group]').forEach(cb=>{
    cb.addEventListener('change', ()=>toggleXpDeed(cb.dataset.xpGroup, parseInt(cb.dataset.xpIndex,10)));
  });
}
function renderXpChecklist(){
  renderXpChecklistGroup('xpChecklistMinor', 'minor', XP_DEEDS_MINOR);
  renderXpChecklistGroup('xpChecklistMajor', 'major', XP_DEEDS_MAJOR);
  document.getElementById('btnXpReset').disabled = session.role==='player';
  // Подытоги разделов и итог встречи: деяние +1, пункт большой пятёрки +2 (максимум 10 + 10)
  const a = session.xpChecklist.minor.filter(Boolean).length, b = session.xpChecklist.major.filter(Boolean).length;
  const pa = a*XP_DEED_WEIGHT.minor, pb = b*XP_DEED_WEIGHT.major, max = XP_DEEDS_MINOR.length*XP_DEED_WEIGHT.minor + XP_DEEDS_MAJOR.length*XP_DEED_WEIGHT.major;
  document.getElementById('xpSubMinor').textContent = `${a} из ${XP_DEEDS_MINOR.length} · +${pa}`;
  document.getElementById('xpSubMajor').textContent = `${b} из ${XP_DEEDS_MAJOR.length} · +${pb}`;
  document.getElementById('xpTotal').textContent = `+${pa + pb} опыта`;
  document.getElementById('xpTotalRow').title = `Деяния +${pa} и большая пятёрка +${pb} — из ${max} возможных за встречу`;
}
// Дельта опыта — каждому игроку этой встречи отдельной выдачей с подтверждением (см. sendGrant: она же
// сразу обновляет копию листа у Мастера и дойдёт даже до того, кто прямо сейчас переподключается), плюс
// сам чек-лист отдельным сообщением, чтобы у игрока обновилось read-only отображение отметок. Точечная
// дельта, а не sheet-push — не трогает остальной лист игрока, тот же принцип, что у giveLuckToPlayer.
function broadcastXp(delta){
  // Все на связи + все из состава встречи (см. xpRoster) — отключившемуся выдача дождётся его в очереди
  new Set([...Object.keys(session.players), ...Object.keys(xpRoster)]).forEach(id=>sendGrant(id, {kind:'xp', delta}));
  sendMsg({type:'xp-checklist-sync', checklist: session.xpChecklist});
  renderPlayersList(); // ⏳ у тех, до кого выдача ещё не дошла
}
function toggleXpDeed(group, index){
  if(session.role==='player') return; // страховка — сам чекбокс и так disabled у игрока, но событие могло прийти и в обход разметки
  const weight = XP_DEED_WEIGHT[group] || 1;
  const checked = !session.xpChecklist[group][index];
  session.xpChecklist[group][index] = checked;
  saveXpChecklist();
  renderXpChecklist();
  broadcastXp(checked ? weight : -weight);
}
// (Мастер) Состав встречи: все игроки, подключавшиеся с последнего сброса чек-листа, id -> имя.
// session.players — только те, кто на связи прямо сейчас (через 8 с после обрыва игрок оттуда удаляется),
// а опыт за деяние положен всей группе, включая того, у кого в этот момент отвалилась сеть: ему выдача
// ждёт в очереди (см. sendGrant) и дойдёт при переподключении. Сброс чек-листа (новая встреча) —
// состав заново, из тех, кто на связи.
const XP_ROSTER_KEY = 'reincarnator_xp_roster_v1';
let xpRoster = (function(){
  try{ const v = JSON.parse(localStorage.getItem(XP_ROSTER_KEY)||'{}'); return v && typeof v==='object' && !Array.isArray(v) ? v : {}; }
  catch(e){ return {}; }
})();
function saveXpRoster(){ try{ localStorage.setItem(XP_ROSTER_KEY, JSON.stringify(xpRoster)); }catch(e){} }
function addToXpRoster(id, name){ if(!id) return; xpRoster[id] = String(name||'Игрок').slice(0,60); saveXpRoster(); }
async function resetXpChecklist(){
  if(session.role==='player') return;
  if(!(await uiConfirm('Снять все отметки в чек-листе начисления опыта? Уже начисленный игрокам опыт это не тронет — только сами галочки, для новой игровой встречи.', {ok:'Да', danger:true}))) return;
  session.xpChecklist = blankXpChecklist();
  xpRoster = {};
  Object.keys(session.players).forEach(id=>{ xpRoster[id] = session.players[id].name || 'Игрок'; });
  saveXpRoster();
  saveXpChecklist();
  renderXpChecklist();
  sendMsg({type:'xp-checklist-sync', checklist: session.xpChecklist});
}
const MAIN_TABS = { sheet:['sheetTabView','tabBtnSheet'], xp:['xpTabView','tabBtnXp'], table:['tableTabView','tabBtnTable'], maps:['mapEditorView','tabBtnMaps'], sound:['soundTabView','tabBtnSound'], bestiary:['bestiaryTabView','tabBtnBestiary'] };
function toggleMainTab(tab){
  Object.keys(MAIN_TABS).forEach(k=>{
    const [view, btn] = MAIN_TABS[k];
    document.getElementById(view).style.display = k===tab ? '' : 'none';
    document.getElementById(btn).classList.toggle('active', k===tab);
  });
  { // на телефоне вкладки — лентой: активную прокрутить в видимую часть ленты
    const bar = document.getElementById('mainTabBar'), b = document.getElementById(MAIN_TABS[tab][1]);
    if(bar && b && bar.scrollWidth > bar.clientWidth + 2){ const br = bar.getBoundingClientRect(), r = b.getBoundingClientRect();
      if(r.left < br.left + 8 || r.right > br.right - 34) bar.scrollLeft += r.left - br.left - (br.width - r.width)/2; }
  }
  // кнопки действий с персонажем: на листе — под «Сохранениями», на остальных вкладках — в шапке
  const ctl = document.getElementById('sheetControls');
  if(ctl){ if(tab==='sheet'){ const sp = document.getElementById('savesPanel'); if(sp && ctl.previousElementSibling!==sp) sp.after(ctl); } else { const tb = document.querySelector('.topbar'); if(tb && ctl.parentElement!==tb) tb.appendChild(ctl); } }
  { const tb = document.querySelector('.topbar'); if(tb){ tb.classList.toggle('has-ctl', tab!=='sheet'); tb.classList.remove('ctl-open'); } } // на узком экране кнопки свёрнуты в «⚙ Персонаж ▾»
  document.body.classList.toggle('table-mode', tab==='table'); // шапка и вкладки уходят вверх, стол — на весь экран
  document.body.classList.toggle('editor-mode', tab==='maps');  // редактор карт — так же на весь экран
  if(typeof MapEditor!=='undefined'){ try{ MapEditor.setVisible(tab==='maps'); }catch(e){ console.error('[Редактор карт]', e); } }
  gtHook(g=>g.setVisible(tab==='table')); // стол рисует canvas только пока виден (размер поля известен только тогда)
  sbHook(s=>s.setVisible(tab==='sound'));
  if(typeof Bestiary!=='undefined') Bestiary.setVisible(tab==='bestiary');
  if(typeof Onboarding!=='undefined') Onboarding.onTab(tab);
  if(tab==='xp') if(typeof GmAdvice!=='undefined') GmAdvice.event('xp');
}
document.getElementById('tabBtnSheet').addEventListener('click', ()=>toggleMainTab('sheet'));
document.getElementById('tabBtnXp').addEventListener('click', ()=>toggleMainTab('xp'));
document.getElementById('tabBtnTable').addEventListener('click', ()=>toggleMainTab('table'));
document.getElementById('tabBtnSound').addEventListener('click', ()=>toggleMainTab('sound'));
document.getElementById('tabBtnMaps').addEventListener('click', ()=>toggleMainTab('maps'));
document.getElementById('tabBtnBestiary').addEventListener('click', ()=>toggleMainTab('bestiary'));
document.getElementById('btnCharMenu').addEventListener('click', ()=>document.querySelector('.topbar').classList.toggle('ctl-open'));
document.getElementById('btnStartGM').addEventListener('click', ()=>setTimeout(()=>{ if(typeof GmAdvice!=='undefined') GmAdvice.event('session-gm'); }, 2500)); // перед игрой — чек-лист подготовки
document.getElementById('gtBackToSheet').addEventListener('click', ()=>toggleMainTab('sheet'));
document.getElementById('btnXpReset').addEventListener('click', resetXpChecklist);

const ROLL_LOG_KEY = 'reincarnator_roll_log_v1';
function loadRollLog(){
  // Через тот же sanitizeRollEntry, что и записи из сети: лог, уже отравленный до этой проверки
  // (чужой HTML или запись без нужных полей), при следующей загрузке страницы вычищается сам.
  try{
    const raw = JSON.parse(localStorage.getItem(ROLL_LOG_KEY)||'[]');
    return Array.isArray(raw) ? raw.map(sanitizeRollEntry).filter(Boolean) : [];
  }catch(e){ return []; }
}
// Граница доверия для записей лога бросков. Всё, что пришло не из этой вкладки (WebSocket 'roll' и
// 'roll-sync', DataChannel dice_roll, сохранённый localStorage), пересобирается по белому списку:
// числа — только числа, строки — обрезанные строки (их экранирует уже сам рендер), неизвестные поля
// отбрасываются. Раньше запись с HTML в числовом поле (например count) рендерилась через innerHTML у
// Мастера, рассылалась им всем и сохранялась — а запись без rolls роняла renderRollLog так рано при
// загрузке, что не восстанавливались ни персонаж, ни сессия. Возвращает null для явного мусора.
function sanitizeRollEntry(e){
  if(!e || typeof e!=='object' || Array.isArray(e)) return null;
  if(typeof e.id!=='string' || !e.id || e.id.length>120) return null;
  const str = (v, n)=> v==null ? '' : String(v).slice(0, n);
  const int = (v, d)=>{ const x = Number(v); return Number.isFinite(x) ? Math.round(x) : d; };
  const ints = (a, n)=> Array.isArray(a) ? a.slice(0, n).map(x=>int(x, 0)) : [];
  const bool = (v)=> v===true ? true : v===false ? false : null;
  const rollMode = (v)=> v==='advantage' || v==='disadvantage' ? v : 'plain';
  const out = { id:e.id, player:str(e.player, 60) };
  if(e.kind==='quick'){
    out.kind = 'quick';
    if(e.mapAttack){ // итог атаки с игрового стола (считает Мастер, см. GameTable.resolveAttack)
      Object.assign(out, { mapAttack:true, attackId:str(e.attackId, 64), attacker:str(e.attacker, 60), target:str(e.target, 60),
        weaponName:str(e.weaponName, 120), fireMode: ['attack','burst','suppress'].indexOf(e.fireMode)>=0 ? e.fireMode : 'attack',
        rolls:ints(e.rolls, 2), roll:int(e.roll, 0), mode:rollMode(e.mode), success:bool(e.success), category:int(e.category, null),
        jammed:!!e.jammed, unprotected:!!e.unprotected, outOfRange:!!e.outOfRange, slow:!!e.slow, total:Math.max(0, int(e.total, 0)), robot:!!e.robot,
        aim: ['golova','plechi','ruki','bedra','nogi'].indexOf(e.aim)>=0 ? e.aim : null, dual:!!e.dual, line:!!e.line, parried:!!e.parried, series:Math.max(0, Math.min(5, int(e.series, 0))),
        hits:(Array.isArray(e.hits) ? e.hits : []).slice(0, 60).map(h=>{
          const o = { k12:int(h && h.k12, 0), pen:!!(h && h.pen), wounds:Math.max(0, int(h && h.wounds, 0)), trauma:!!(h && h.trauma), red:!!(h && h.red) };
          if(h && Array.isArray(h.rolls12)) o.rolls12 = ints(h.rolls12, 30);
          if(h && h.zap) o.zap = true; // разряд («Электропрут»)
          if(h && h.aim) o.aim = true; // прицельное попадание — по защите зоны
          return o;
        }) });
      if(e.sec && typeof e.sec==='object') out.sec = { max:int(e.sec.max, 0), max12: e.sec.max12==null ? null : int(e.sec.max12, 0), aim12: e.sec.aim12==null ? null : int(e.sec.aim12, 0) }; // пороги — только допущенным Мастером
      return out;
    }
    if(e.mapManeuver){ // манёвр с игрового стола: схватить / толкнуть / освободиться (GameTable.resolveManeuver)
      Object.assign(out, { mapManeuver:true, attackId:str(e.attackId, 64), attacker:str(e.attacker, 60), target:str(e.target, 60),
        mv: ['grab','push','escape','parry'].indexOf(e.mv)>=0 ? e.mv : 'grab', rolls:ints(e.rolls, 2), roll:int(e.roll, 0), mode:rollMode(e.mode),
        success:bool(e.success), category:int(e.category, null), sizeCmp:Math.max(-1, Math.min(1, int(e.sizeCmp, 0))) });
      if(e.sec && typeof e.sec==='object') out.sec = { max:int(e.sec.max, 0) };
      return out;
    }
    if(e.mapGrenade){ // итог броска гранаты с игрового стола (см. GameTable.resolveGrenade)
      Object.assign(out, { mapGrenade:true, attackId:str(e.attackId, 64), attacker:str(e.attacker, 60), target:str(e.target, 60),
        weaponName:str(e.weaponName, 120), rolls:ints(e.rolls, 2), roll:int(e.roll, 0), mode:rollMode(e.mode), success:bool(e.success),
        category:int(e.category, null), outcome: ['hit','frag','none'].indexOf(e.outcome)>=0 ? e.outcome : 'none', slow:!!e.slow,
        victims:(Array.isArray(e.victims) ? e.victims : []).slice(0, 40).map(v=>({ name:str(v && v.name, 60),
          bN:Math.max(0, int(v && v.bN, 0)), bP:Math.max(0, int(v && v.bP, 0)), fN:Math.max(0, int(v && v.fN, 0)), fP:Math.max(0, int(v && v.fP, 0)),
          total:Math.max(0, int(v && v.total, 0)), trauma:Math.max(0, int(v && v.trauma, 0)), robot:!!(v && v.robot), burn:Math.max(0, int(v && v.burn, 0)), immune:!!(v && v.immune) })) });
      if(e.sec && typeof e.sec==='object') out.sec = { max:int(e.sec.max, 0), max12: e.sec.max12==null ? null : int(e.sec.max12, 0) }; // пороги — только допущенным Мастером
      return out;
    }
    if(e.mapAttackUndo){ Object.assign(out, { mapAttackUndo:true, attackId:str(e.attackId, 64), text:str(e.text, 200) }); return out; }
    if(e.initiative){ // проверки инициативы трекера боя (GameTable.rollInitiative)
      Object.assign(out, { initiative:true, title:str(e.title, 120), list:(Array.isArray(e.list) ? e.list : []).slice(0, 80).map(x=>({ name:str(x && x.name, 60),
        roll:int(x && x.roll, 0), rolls:ints(x && x.rolls, 2), max:int(x && x.max, 0), mode:rollMode(x && x.mode), success:!!(x && x.success), auto:!!(x && x.auto), notes:str(x && x.notes, 160) })) });
      return out;
    }
    if(e.loot){ Object.assign(out, { loot:true, target:str(e.target, 60), text:str(e.text, 700) }); return out; } // находка (см. lootGive)
    if(e.weaponJam){ out.weaponJam = true; out.weaponName = str(e.weaponName, 120); return out; }
    if(e.weaponHits){
      out.weaponHits = true; out.weaponName = str(e.weaponName, 120); out.fireMode = str(e.fireMode, 20);
      out.hits = (Array.isArray(e.hits) ? e.hits : []).slice(0, 60).map(h=>{
        const o = { location:int(h && h.location, 0), wounds:Math.max(1, int(h && h.wounds, 1)) }; // попадание — минимум 1 рана
        if(h && Array.isArray(h.rolls12)) o.rolls12 = ints(h.rolls12, 30);
        return o;
      });
      return out;
    }
    if(e.itemCheck){
      Object.assign(out, { itemCheck:true, diceType:'d6', sides:6, itemName:str(e.itemName, 120), max:int(e.max, 0),
        mode:rollMode(e.mode), count:int(e.count, 0), kept:ints(e.kept, 60), usesLost:int(e.usesLost, 0), palba:!!e.palba });
      return out;
    }
    if(e.diceType==='d20'){
      Object.assign(out, { diceType:'d20', mode:rollMode(e.mode), max:int(e.max, 0), rolls:ints(e.rolls, 2), roll:int(e.roll, 0),
        success:bool(e.success), category:int(e.category, null) });
      if(!out.rolls.length) out.rolls = [out.roll];
      return out;
    }
    out.diceType = ['d4','d6','d12'].indexOf(e.diceType)>=0 ? e.diceType : 'd6';
    out.sides = int(e.sides, 6);
    if(e.mode==='max'){ Object.assign(out, { mode:'max', max:int(e.max, 0), roll:int(e.roll, 0), success:bool(e.success) }); return out; }
    Object.assign(out, { count:int(e.count, 0), rolls:ints(e.rolls, 100), sum:int(e.sum, 0) });
    return out;
  }
  // Основной бросок характеристики (recordAndShareRoll)
  Object.assign(out, { statLabel:str(e.statLabel, 80), mod:int(e.mod, 0), roll:int(e.roll, 0), max:int(e.max, 0),
    success:bool(e.success), category:int(e.category, null), mode:rollMode(e.mode), rolls:ints(e.rolls, 2) });
  if(!out.rolls.length) out.rolls = [out.roll];
  return out;
}
/* ---------- ПОДРОБНЫЙ ВИД ЛОГА (опция Мастера): «к20≤14 → 10 — Успех, КУ2 · к12≤7 → [4, 7]→7 пробило · итого 7 ран» ----------
   Мастер включает его на экране Мастера → «Игроки» и сам решает, кто из игроков видит пороги. Пороги атак с карты
   (полный Макс. с секретными модификаторами и «МУ − Защита цели») лежат в записи в поле sec и уходят только допущенным
   игрокам; остальным — та же запись без sec и стандартный вид. Стандартный вид не меняется. */
const LOG_VIEW_KEY = 'reincarnator_log_view_v1';
const logView = (function(){ try{ const v = JSON.parse(localStorage.getItem(LOG_VIEW_KEY) || '{}') || {}; return {on:!!v.on, allow:v.allow && typeof v.allow==='object' ? v.allow : {}}; }catch(e){ return {on:false, allow:{}}; } })();
function saveLogView(){ try{ localStorage.setItem(LOG_VIEW_KEY, JSON.stringify(logView)); }catch(e){} }
function logViewAllowed(pid){ return logView.on && !!logView.allow[pid]; }
function logDetailed(){ return session.role==='player' ? !!session.logDetailed : logView.on; }
function rollEntryFor(e, pid){ if(!e || (!e.sec && !e.pnote)) return e; const o = Object.assign({}, e); delete o.pnote; if(!logViewAllowed(pid)) delete o.sec; return o; }
// Личное (шёпот, тайный бросок) — только автору и адресату; pid=null — «всем сразу», личное не уходит вовсе
function rollVisibleTo(e, pid){ if(!e.priv) return true; if(!pid) return false; if(e.secret) return e.to===pid; return e.to===pid || e.fromId===pid; } // тайный бросок не возвращается даже автору
function rollEntriesFor(list, pid){ return (list || []).filter(e=>rollVisibleTo(e, pid)).map(e=>rollEntryFor(e, pid)); }
function sendLogView(pid){
  if(session.role!=='gm') return;
  (pid ? [pid] : Object.keys(session.players || {})).forEach(id=>{
    const on = logViewAllowed(id);
    sendMsg({type:'log-view', detailed:on}, id);
    // допустили во время сессии — пороги уже прошедших атак досылаются, их записи у игрока перерисуются
    if(on){ const sec = session.log.filter(e=>e.sec).slice(-150).map(e=>({id:e.id, sec:e.sec})); if(sec.length) sendMsg({type:'roll-sec', list:sec}, id); }
  });
}
function setLogViewOn(on){ logView.on = !!on; saveLogView(); sendLogView(); renderRollLog(); }
function setLogViewAllow(pid, on){ if(on) logView.allow[pid] = true; else delete logView.allow[pid]; saveLogView(); sendLogView(pid); }
/* ---------- ТАЙНЫЙ БРОСОК: игрок не видит результат, его видит только Мастер; остальные — «бросил тайно» ---------- */
let secretRollOn = false;
function secretRollActive(){ return secretRollOn && !!session.role && (session.role==='gm' || !!session.gmId); }
function shareSecretRoll(entry, label){
  entry.priv = true; entry.secret = true; entry.to = 'gm'; entry.fromId = session.myId || '';
  const stub = {id:entry.id + 's', kind:'quick', secretStub:true, player:entry.player, label:String(label || 'к20').slice(0, 60)};
  if(session.role==='gm') addRollLogEntry(entry); // Мастер свой тайный бросок видит
  else sendMsg({type:'roll', entry}, session.gmId);
  addRollLogEntry(stub); sendMsg({type:'roll', entry:stub});
}
// Записи, которых нет в белом списке ниже: сообщения и заглушки тайных бросков; плюс поля «личного» у любых записей
const _sanitizeRollEntryBase = sanitizeRollEntry;
sanitizeRollEntry = function(e){
  if(!e || typeof e!=='object' || Array.isArray(e) || typeof e.id!=='string' || !e.id || e.id.length>120) return null;
  const str = (v, n)=> v==null ? '' : String(v).slice(0, n);
  let out;
  if(e.chat){ const text = str(e.text, 500).trim(); if(!text) return null; out = {id:e.id, player:str(e.player, 60), kind:'quick', chat:true, text, toName:str(e.toName, 60)}; }
  else if(e.secretStub) out = {id:e.id, player:str(e.player, 60), kind:'quick', secretStub:true, label:str(e.label, 60)};
  else if(e.abilityUse){ const text = str(e.text, 900).trim(); if(!text) return null; out = {id:e.id, player:str(e.player, 60), kind:'quick', abilityUse:true, text}; }
  else { out = _sanitizeRollEntryBase(e); if(!out) return null; if(e.secret) out.secret = true; if(e.pnote && (e.mapAttack || e.mapGrenade)) out.pnote = str(e.pnote, 240); }
  if(e.priv){ out.priv = true; out.to = str(e.to, 64); out.fromId = str(e.fromId, 64); }
  return out;
};
// постоянные модификаторы существ в атаке (Ирреальный −13, Инфлятор −1 рана…) — только Мастеру: игроку они секрет
const _formatQuickRollEntryBase = formatQuickRollEntry;
formatQuickRollEntry = function(e, undone){ const f = _formatQuickRollEntryBase(e, undone);
  if(f && e && e.pnote && session.role!=='player') f.html = f.html.replace(/<\/span>$/, ` <span class="muted">· ${escapeHtml(e.pnote)}</span></span>`); return f; };
function d20Part(max, rolls, roll){ return `к20≤${max} → ${rolls && rolls.length>1 ? `[${rolls.join(', ')}]→${roll}` : roll}`; }
function detailedRegularEntry(e){
  if(e.max==null || !e.roll || e.secret) return null;
  const cls = e.success===true?'success':e.success===false?'failure':'';
  const outcome = e.success===true?`Успех, КУ${e.category}`:e.success===false?'Провал':'';
  const modeTxt = e.mode==='advantage' ? ', Преимущество' : e.mode==='disadvantage' ? ', Помеха' : '';
  const special = e.success!=null ? natTagText(e.roll, e.success, evaluateD20Check(e.roll, e.max).natConsequences) : '';
  return `<div class="roll-log-entry ${cls}"><span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">${escapeHtml(e.statLabel)} (${(e.mod>=0?'+':'')+e.mod}${modeTxt}): ${d20Part(e.max, e.rolls, e.roll)} — ${outcome}${special}</span></div>`;
}
function detailedQuickEntry(e, undoneAttacks){
  const modeTxt = e.mode==='advantage' ? ', Преимущество' : e.mode==='disadvantage' ? ', Помеха' : '';
  if(e.mapAttack){
    if(!e.sec) return null;
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    const modeName = e.fireMode==='burst' ? 'очередь' : e.fireMode==='suppress' ? 'подавление' : 'атака';
    let body = `→ ${escapeHtml(e.target)}: «${escapeHtml(e.weaponName)}» (${modeName}${e.unprotected?', по незащищённым':''}${mapAttackExtras(e)}${modeTxt}): ${d20Part(e.sec.max, e.rolls, e.roll)} — `;
    if(e.jammed) body += 'оружие заклинило (нат.13)';
    else if(!e.success) body += 'промах';
    else {
      const many = e.hits.length > 1; // вариант «Б»: порог один раз, дальше — броски попаданий
      const hitsTxt = e.hits.map(h=>{
        const k = hitPrefix(h) + (h.rolls12 ? `[${h.rolls12.join(', ')}]→${h.k12}` : String(h.k12));
        const bone = h.trauma ? ' ' + traumaIconHtml(e.robot, h.red) : '';
        return `${k} ${h.pen ? 'пробило' : 'не пробило'}${many && h.pen ? ` (${h.wounds} ${woundsWord(h.wounds)})` : ''}${bone}`;
      }).join('; ');
      body += `Успех, КУ${e.category}` + (e.hits.length ? ` · к12≤${e.sec.max12==null ? '?' : e.sec.max12}${e.aim && e.sec.aim12!=null ? ` (🎯 прицельное ≤${e.sec.aim12})` : ''} → ${hitsTxt}` : '') + ` · итого ${e.total} ${woundsWord(e.total)}`;
    }
    if(e.success && !e.jammed) body += natTagText(e.roll, e.success, evaluateD20Check(e.roll, e.sec.max).natConsequences);
    if(e.slow) body += ' · ⚡ медленное — цель может отреагировать';
    if(undone) body += ' · <b>отменено Мастером</b>';
    return {cls:(e.success && !e.jammed ? 'success' : 'failure') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable:!undone};
  }
  if(e.mapManeuver){
    if(!e.sec) return null;
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    const md = e.mode==='advantage' ? ', Упрощённо' : e.mode==='disadvantage' ? ', Осложнённо' : '';
    const body = `🤼 → ${escapeHtml(e.target)}: ${MANEUVER_WHAT[e.mv]}${md}${e.sizeCmp>0 ? ' (крупнее цели)' : e.sizeCmp<0 ? ' (мельче цели)' : ''}: ${d20Part(e.sec.max, e.rolls, e.roll)} — ${maneuverOutcome(e)}${undone ? ' · <b>отменено Мастером</b>' : ''}`;
    return {cls:(e.success ? 'success' : 'failure') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable:!undone};
  }
  if(e.mapGrenade){
    if(!e.sec) return null;
    const std = null; // остальное (жертвы, осколки) — как в стандартном виде: подменяем только кусок с к20
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    let body = `💣 → ${escapeHtml(e.target)}: «${escapeHtml(e.weaponName)}»${modeTxt ? ' ('+modeTxt.slice(2)+')' : ''}: ${d20Part(e.sec.max, e.rolls, e.roll)} — `;
    body += e.outcome==='hit' ? `Успех, КУ${e.category}` : e.outcome==='frag' ? 'Провал (16+) — осколки всё равно задели' : 'Провал — урона нет, Мастер может дать Невзгоды';
    if(e.victims.length) body += ' · ' + e.victims.map(v=>{
      if(v.immune) return `${escapeHtml(v.name)}: защита от температуры выдержала`;
      const parts = []; if(v.bN) parts.push(`взрыв ${v.bP}/${v.bN}`); if(v.fN) parts.push(`осколки ${v.fP}/${v.fN}`);
      return `${escapeHtml(v.name)}: ${parts.length ? parts.join(', ')+' — ' : ''}${v.total} ${woundsWord(v.total)}${v.trauma ? ' ' + traumaIconHtml(v.robot, false, v.trauma) : ''}${v.burn ? ` 🔥${v.burn}` : ''}`;
    }).join('; ');
    if(e.slow) body += ' · ⚡ медленное — цель может отреагировать';
    if(undone) body += ' · <b>отменено Мастером</b>';
    return {cls:(e.outcome==='none' ? 'failure' : 'success') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable:!undone};
  }
  if(e.initiative){
    const items = (e.list||[]).map(x=>{
      if(x.auto) return `${escapeHtml(x.name)}: ⚡ сюрприз — успех`;
      const md = x.mode==='advantage' ? ', Упрощена' : x.mode==='disadvantage' ? ', Осложнена' : '';
      return `${escapeHtml(x.name)}${md}: ${d20Part(x.max, x.rolls, x.roll)} — ${x.success ? 'успех' : '<b>провал: без действия в этом круге</b>'}${x.notes ? ` <span class="muted">(${escapeHtml(x.notes)})</span>` : ''}`;
    });
    return {cls:'', html:`<span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">⚔ ${escapeHtml(e.title||'Инициатива')}${items.length ? ': ' + items.join('; ') : ''}</span>`};
  }
  if(e.diceType==='d20' && !e.itemCheck && e.max!=null){
    const outcome = e.success===true?`Успех, КУ${e.category}`:'Провал';
    const special = natTagText(e.roll, e.success, evaluateD20Check(e.roll, e.max).natConsequences);
    return {cls: e.success?'success':'failure', html:`<span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">D20${modeTxt ? ' ('+modeTxt.slice(2)+')' : ''}: ${d20Part(e.max, e.rolls, e.roll)} — ${outcome}${special}</span>`};
  }
  return null;
}
function saveRollLog(){ try{ localStorage.setItem(ROLL_LOG_KEY, JSON.stringify(session.log.slice(-500))); }catch(e){} }

// ---- «Страховка»: пережить обновление/случайное закрытие вкладки без потери персонажа или сессии.
// Два независимых localStorage-ключа: сам лист (автосохранение, для всех, не только для сессии) и
// то, в какую сессию был подключён этот браузер (роль + имя) — оба восстанавливаются при следующем
// открытии страницы, без каких-либо действий от игрока или ГМа.
const AUTOSAVE_KEY = 'reincarnator_autosave_v1';
const SESSION_STATE_KEY = 'reincarnator_session_state_v1';
function saveAutosave(){
  // Не перезаписывать автосохранение персонажем ИГРОКА, пока ГМ временно держит его в своём
  // редакторе (см. enterGmEditMode) — иначе при обновлении страницы ГМ увидел бы у себя чужого
  // персонажа вместо своего собственного.
  if(!character || (typeof session!=='undefined' && session.editingPlayerId)) return;
  try{ localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildSavePayload())); }catch(e){}
}
function loadAutosaveIfPresent(){
  let payload;
  try{ payload = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)||'null'); }catch(e){ return; }
  if(!isValidPayload(payload)) return;
  applyLoadedPayload(payload);
}
// Роль сессии хранится и в sessionStorage (своя у каждой вкладки, переживает её перезагрузку), и в
// localStorage (общий — чтобы сессия восстановилась и в новой вкладке, и после перезапуска браузера).
// При восстановлении своя вкладочная запись важнее: раньше Мастер и игрок в двух вкладках одного
// браузера перезаписывали общий ключ друг другу, и после перезагрузки вкладка Мастера могла подняться
// игроком (и наоборот).
function saveSessionState(){
  const v = JSON.stringify({role:session.role, ownName:session.ownName, room:currentRoomCode || ''});
  try{ sessionStorage.setItem(SESSION_STATE_KEY, v); }catch(e){}
  try{ localStorage.setItem(SESSION_STATE_KEY, v); }catch(e){}
}
function clearSessionState(){
  try{ sessionStorage.removeItem(SESSION_STATE_KEY); }catch(e){}
  try{ localStorage.removeItem(SESSION_STATE_KEY); }catch(e){}
}
// Вкладки одного браузера узнают друг о друге через BroadcastChannel: подключённая вкладка отвечает на
// вопрос «кто уже в сессии?» своей ролью. Нужно новой вкладке (см. restoreSessionIfPresent), чтобы не
// подключаться автоматически в роли, которую уже держит соседняя, — иначе она сразу вытесняла бы её
// (тот же id), например, открыв вторую вкладку, чтобы стать в ней Мастером, игрок терял свою.
const _sessionTabs = (typeof BroadcastChannel!=='undefined') ? new BroadcastChannel('reincarnator_session_tabs') : null;
if(_sessionTabs) _sessionTabs.onmessage = (ev)=>{
  const m = ev.data || {};
  if(m.type==='who-is-connected' && session.role && session.ws && session.ws.readyState===WebSocket.OPEN) _sessionTabs.postMessage({type:'connected', role:session.role});
};
function otherTabHoldsRole(role){
  return new Promise(resolve=>{
    if(!_sessionTabs) return resolve(false);
    let done = false;
    const finish = (v)=>{ if(done) return; done = true; _sessionTabs.removeEventListener('message', onMsg); resolve(v); };
    const onMsg = (ev)=>{ const m = ev.data || {}; if(m.type==='connected' && m.role===role) finish(true); };
    _sessionTabs.addEventListener('message', onMsg);
    _sessionTabs.postMessage({type:'who-is-connected'});
    setTimeout(()=>finish(false), 400);
  });
}
function restoreSessionIfPresent(){
  if(!sessionAvailable() || location.protocol==='file:') return; // same conditions connectSession itself checks — skip silently instead of surfacing its alert unprompted on a plain page load
  let own, shared;
  try{
    own = JSON.parse(sessionStorage.getItem(SESSION_STATE_KEY) || 'null');   // эта же вкладка до перезагрузки
    shared = JSON.parse(localStorage.getItem(SESSION_STATE_KEY) || 'null');  // последняя сессия этого браузера
  }catch(e){ return; }
  const state = own || shared;
  if(!state || !state.role) return;
  // Стол: адрес без кода — вернуться за свой последний стол; адрес другого стола — не подключаться самому
  const savedRoom = typeof state.room==='string' ? state.room : '';
  if(!currentRoomCode && savedRoom) setRoomCode(savedRoom);
  else if(currentRoomCode !== savedRoom){ document.getElementById('sessionOwnName').value = state.ownName || ''; return; }
  document.getElementById('sessionOwnName').value = state.ownName || '';
  if(own){ connectSession(state.role); return; } // перезагрузка своей вкладки — сразу, тем же путём, что кнопки
  otherTabHoldsRole(state.role).then(busy=>{
    if(session.role) return; // за эти доли секунды уже подключились вручную
    if(!busy){ connectSession(state.role); return; }
    document.getElementById('sessionSetupHint').textContent =
      `Сессия (${state.role==='gm'?'Мастер':'игрок'}) уже открыта в другой вкладке этого браузера. Чтобы подключиться здесь — нажмите «Я — Мастер» или «Я — игрок». Второй игрок в том же браузере — через приватное окно.`;
  });
}

const session = {
  role: null,             // 'gm' | 'player' | null
  ws: null,
  myId: null,              // assigned by the server on connect
  ownName: '',
  gmId: null,               // (player only) the GM's server-assigned id
  gmName: null,              // (player only)
  players: {},                // (GM only) playerId -> {name, character, extra}
  log: loadRollLog(),
  xpChecklist: loadXpChecklist(), // см. НАЧИСЛЕНИЕ ОПЫТА выше — {minor:[bool*10], major:[bool*5]}
  rollCounter: 0,
  editingPlayerId: null,       // (GM only) which player's sheet is currently loaded into `character` for editing
  editingBackup: null,          // (GM only) GM's own character+name+player, stashed while editing someone else's
};
const _rollLogSeenIds = new Set(session.log.map(e=>e.id));

// Формат для бросков боковой панели кубов (DicePanel, см. её раздел ниже) — отдельная ветка формата
// строки лога, но ТОТ ЖЕ массив session.log/тот же рендер-цикл, не второй лог. Записи основного
// броска характеристики (без поля kind) продолжают форматироваться старой веткой ниже без изменений.
// подписи атаки с карты: прицельно (зона), двумя оружиями, номер атаки в серии одного действия; у попаданий — разряд и прицельное
function mapAttackExtras(e){ return (e.aim ? `, прицельно: ${String(ARMOR_ZONE_LABELS[e.aim] || e.aim).toLowerCase()}` : '') + (e.dual ? ', двумя оружиями' : '') + (e.series > 1 ? `, ${e.series}-я атака действия` : '') + (e.line ? ', по линии' : '') + (e.parried ? ', цель парировала — Осложнено' : ''); }
function hitPrefix(h){ return h.zap ? '⚡разряд ' : h.aim ? '🎯' : ''; }
const MANEUVER_WHAT = {grab:'схватить', push:'толкнуть', escape:'освободиться из захвата', parry:'парировать атаку'};
function maneuverOutcome(e){ return e.success ? `Успех, КУ${e.category} — ${e.mv==='grab' ? 'цель схвачена: обездвижена, простые действия одной рукой Осложнены' : e.mv==='push' ? 'цель отброшена на 3 м' : e.mv==='parry' ? 'его рукопашные атаки по парирующему в этом ходу Осложнены' : 'освободился'}` : 'провал'; }
function woundsWord(n){ const a = n%10, b = n%100; return a===1 && b!==11 ? 'рана' : (a>=2 && a<=4 && (b<12 || b>14)) ? 'раны' : 'ран'; }
function formatQuickRollEntry(e, undoneAttacks){
  if(e.chat){ // сообщение в логе: всем или лично
    const toTxt = !e.priv ? '' : e.fromId && e.fromId===session.myId ? ` → ${e.to==='gm' || e.to===session.gmId ? 'Мастеру' : escapeHtml(e.toName || 'игроку')}` : session.role==='gm' && e.to!=='gm' && e.to!==session.myId ? ` → ${escapeHtml(e.toName || 'игроку')}` : ' (лично вам)';
    return {cls:'chat' + (e.priv ? ' whisper' : ''), html:`<span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">${e.priv ? '🤫' : '💬'}${toTxt ? toTxt + ':' : ''} ${escapeHtml(e.text)}</span>`};
  }
  if(e.abilityUse) return {cls:'ability', html:`<span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">🎯 ${escapeHtml(e.text)}</span>`};
  if(e.secretStub) return {cls:'secret', html:`<span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">🤫 бросок тайно: ${escapeHtml(e.label || 'к20')} — результат у Мастера</span>`};
  if(logDetailed()){ const d = detailedQuickEntry(e, undoneAttacks); if(d) return d; }
  const who = escapeHtml(e.player||'?');
  if(e.mapAttack){
    // Итог атаки с карты: без модификаторов и защиты цели (они секретны) — только вердикт, попадания и раны
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    const modeName = e.fireMode==='burst' ? 'очередь' : e.fireMode==='suppress' ? 'подавление' : 'атака';
    const modeTxt = e.mode==='advantage' ? ', Преимущество' : e.mode==='disadvantage' ? ', Помеха' : '';
    const rollsTxt = e.rolls && e.rolls.length>1 ? ` [${e.rolls.join(', ')}]` : '';
    let body = `→ ${escapeHtml(e.target)}: «${escapeHtml(e.weaponName)}» (${modeName}${e.unprotected?', по незащищённым':''}${mapAttackExtras(e)}${modeTxt}) — к20=${e.roll}${rollsTxt} — `;
    if(e.jammed) body += 'оружие заклинило (нат.13)';
    else if(!e.success) body += 'промах';
    else {
      const hitsTxt = e.hits.map(h=>{
        const k = hitPrefix(h) + (h.rolls12 ? `к12=[${h.rolls12.join(', ')}]→${h.k12}` : `к12=${h.k12}`);
        if(!h.pen) return `${k} не пробило`;
        const bone = h.trauma ? ' ' + traumaIconHtml(e.robot, h.red) : '';
        return `${k} пробило (${h.wounds} ${woundsWord(h.wounds)})${bone}`;
      }).join('; ');
      body += `Успех, КУ${e.category} · ${hitsTxt} · итого ${e.total} ${woundsWord(e.total)}`;
    }
    if(e.slow) body += ' · ⚡ медленное — цель может отреагировать';
    if(undone) body += ' · <b>отменено Мастером</b>';
    return {cls: (e.success && !e.jammed ? 'success' : 'failure') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable: !undone};
  }
  if(e.mapManeuver){
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    const md = e.mode==='advantage' ? ', Упрощённо' : e.mode==='disadvantage' ? ', Осложнённо' : '';
    const rollsTxt = e.rolls && e.rolls.length>1 ? ` [${e.rolls.join(', ')}]` : '';
    const body = `🤼 → ${escapeHtml(e.target)}: ${MANEUVER_WHAT[e.mv]}${md}${e.sizeCmp>0 ? ' (крупнее цели)' : e.sizeCmp<0 ? ' (мельче цели)' : ''} — к20=${e.roll}${rollsTxt} — ${maneuverOutcome(e)}${undone ? ' · <b>отменено Мастером</b>' : ''}`;
    return {cls:(e.success ? 'success' : 'failure') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable:!undone};
  }
  if(e.mapGrenade){
    const undone = undoneAttacks && undoneAttacks.has(e.attackId);
    const modeTxt = e.mode==='advantage' ? ', Преимущество' : e.mode==='disadvantage' ? ', Помеха' : '';
    const rollsTxt = e.rolls && e.rolls.length>1 ? ` [${e.rolls.join(', ')}]` : '';
    let body = `💣 → ${escapeHtml(e.target)}: «${escapeHtml(e.weaponName)}»${modeTxt ? ' ('+modeTxt.slice(2)+')' : ''} — к20=${e.roll}${rollsTxt} — `;
    body += e.outcome==='hit' ? `Успех, КУ${e.category}` : e.outcome==='frag' ? 'Провал (16+) — осколки всё равно задели' : 'Провал — урона нет, Мастер может дать Невзгоды';
    if(e.victims.length) body += ' · ' + e.victims.map(v=>{
      if(v.immune) return `${escapeHtml(v.name)}: защита от температуры выдержала`;
      const parts = [];
      if(v.bN) parts.push(`взрыв ${v.bP}/${v.bN}`);
      if(v.fN) parts.push(`осколки ${v.fP}/${v.fN}`);
      const burn = v.burn ? ` 🔥${v.burn}` : '';
      const bone = v.trauma ? ' ' + traumaIconHtml(v.robot, false, v.trauma) : '';
      return `${escapeHtml(v.name)}: ${parts.length ? parts.join(', ')+' — ' : ''}${v.total} ${woundsWord(v.total)}${bone}${burn}`;
    }).join('; ');
    if(e.slow) body += ' · ⚡ медленное — цель может отреагировать';
    if(undone) body += ' · <b>отменено Мастером</b>';
    return {cls: (e.outcome==='none' ? 'failure' : 'success') + (undone ? ' undone' : ''),
      html:`<span class="who">${escapeHtml(e.attacker||e.player||'?')}</span><span class="rest">${body}</span>`, undoable: !undone};
  }
  if(e.loot){
    return {cls:'', html:`<span class="who">${who}</span><span class="rest">${LOOT_SHOVEL_SVG} Находка → ${escapeHtml(e.target)}: ${escapeHtml(e.text)}</span>`};
  }
  if(e.initiative){
    const items = (e.list||[]).map(x=>{
      if(x.auto) return `${escapeHtml(x.name)}: ⚡ сюрприз — успех`;
      const md = x.mode==='advantage' ? ', Упрощена' : x.mode==='disadvantage' ? ', Осложнена' : '';
      const rl = x.rolls && x.rolls.length>1 ? ` [${x.rolls.join(', ')}]` : '';
      return `${escapeHtml(x.name)}: к20=${x.roll}${rl} / Макс.${x.max}${md} — ${x.success ? 'успех' : '<b>провал: без действия в этом круге</b>'}${x.notes ? ` <span class="muted">(${escapeHtml(x.notes)})</span>` : ''}`;
    });
    return {cls:'', html:`<span class="who">${who}</span><span class="rest">⚔ ${escapeHtml(e.title||'Инициатива')}${items.length ? ': ' + items.join('; ') : ''}</span>`};
  }
  if(e.mapAttackUndo){
    return {cls:'', html:`<span class="who">${who}</span><span class="rest">↶ Отменил атаку: ${escapeHtml(e.text)}</span>`};
  }
  if(e.weaponJam){
    return {cls:'failure', html:`<span class="who">${who}</span><span class="rest">Оружие «${escapeHtml(e.weaponName)}» заклинило (нат.13) — переброс невозможен</span>`};
  }
  if(e.weaponHits){
    // Каждое попадание — к12 (расположение/тяжесть, см. "Пул" в памятке для режима "лучший из
    // [категория] бросков") рядом с готовым числом ран этого попадания (см. resolveWeaponAttackOutcome
    // — уже посчитано там, включая бонус Разрыва при успехе 11+; здесь только форматирование).
    const hitsTxt = e.hits.map(h=>{
      const locTxt = h.rolls12 ? `к12=[${h.rolls12.join(', ')}]→${h.location}` : `к12=${h.location}`;
      return `${locTxt} (${h.wounds} ${h.wounds===1?'рана':h.wounds<5?'раны':'ран'})`;
    }).join('; ');
    return {cls:'success', html:`<span class="who">${who}</span><span class="rest">Попадания «${escapeHtml(e.weaponName)}»: ${hitsTxt}</span>`};
  }
  if(e.itemCheck){
    const modeLabel = e.mode==='advantage'?'Преимущество':e.mode==='disadvantage'?'Помеха':'Чистый';
    return {cls: e.usesLost?'failure':'success',
      html:`<span class="who">${who}</span><span class="rest">ПР «${escapeHtml(e.itemName)}» ${e.count}×D6 (${modeLabel}, Макс.${e.max}): ${e.kept.join(', ')}${e.usesLost?` — израсходовано ${e.usesLost}${e.palba?' (пальба ×3)':''}`:' — без потерь'}</span>`};
  }
  if(e.diceType==='d20'){
    const modeLabel = e.mode==='advantage'?'Преимущество':e.mode==='disadvantage'?'Помеха':'Чистый';
    const outcome = e.success===true?`Успех, КУ${e.category}`:'Провал';
    const rollsTxt = e.rolls && e.rolls.length>1 ? ` [бросков: ${e.rolls.join(', ')}]` : '';
    const special = natTagText(e.roll, e.success, evaluateD20Check(e.roll, e.max).natConsequences);
    return {cls: e.success?'success':'failure',
      html:`<span class="who">${who}</span><span class="rest">D20 (${modeLabel}, Макс.${e.max})${rollsTxt} — к20=${e.roll} — ${outcome}${special}</span>`};
  }
  if(e.mode==='max'){
    const outcome = e.success?'Успех':'Провал';
    return {cls: e.success?'success':'failure',
      html:`<span class="who">${who}</span><span class="rest">D${e.sides} (Макс.${e.max}) — бросок=${e.roll} — ${outcome}</span>`};
  }
  return {cls:'',
    html:`<span class="who">${who}</span><span class="rest">${e.count}×D${e.sides} — [${e.rolls.join(', ')}] = ${e.sum}</span>`};
}
function renderRollLog(){
  const el = document.getElementById('rollLogList');
  if(!session.log.length){ el.innerHTML = '<span class="muted">Пока пусто.</span>'; return; }
  const entries = session.log.slice(-150).slice().reverse();
  // Ошибка в одной записи пропускает только её — раньше она роняла весь рендер лога, а он вызывается
  // при загрузке страницы раньше восстановления персонажа и сессии (см. updateSessionStatusUI).
  const undoneAttacks = new Set(session.log.filter(x=>x.mapAttackUndo).map(x=>x.attackId)); // отменённые атаки с карты — зачёркиваются у всех
  el.innerHTML = entries.map(e=>{ try{ return renderRollLogEntry(e, undoneAttacks); }catch(err){ console.warn('[Лог бросков] запись пропущена', e && e.id, err); return ''; } }).join('');
  // ↶ у атаки с карты — только Мастеру (см. renderRollLogEntry): отменяет её раны и травмы
  el.onclick = (ev)=>{ const b = ev.target.closest && ev.target.closest('[data-undo-attack]'); if(b) gtHook(g=>g.undoAttack(b.dataset.undoAttack)); };
}
function renderRollLogEntry(e, undoneAttacks){
  if(e.kind!=='quick' && logDetailed()){ const d = detailedRegularEntry(e); if(d) return d; }
  if(e.kind==='quick'){
    const f = formatQuickRollEntry(e, undoneAttacks);
    const canUndo = (e.mapAttack || e.mapGrenade || e.mapManeuver) && f.undoable && session.role==='gm' && typeof GameTable!=='undefined' && GameTable.canUndoAttack(e.attackId);
    const undoBtn = canUndo ? `<button type="button" class="small log-undo" data-undo-attack="${escapeHtml(e.attackId)}" title="Отменить эту атаку: вернуть раны и травмы">↶</button>` : '';
    return `<div class="roll-log-entry ${f.cls}${e.secret ? ' secret' : ''}">${e.secret ? f.html.replace('<span class="rest">', '<span class="rest">🤫 ') : f.html}${undoBtn}</div>`;
  }
  const cls = e.success===true?'success':e.success===false?'failure':'';
  const outcome = e.success===true?`Успех, КУ${e.category}`:e.success===false?'Провал':'';
  const modTxt = (e.mod>=0?'+':'')+e.mod;
  const modeTxt = e.mode==='advantage' ? ' · Преимущество' : e.mode==='disadvantage' ? ' · Помеха' : '';
  const rollsTxt = e.rolls && e.rolls.length>1 ? ` [к20: ${e.rolls.join(', ')} → взят ${e.roll}]` : '';
  const special = e.success!=null ? natTagText(e.roll, e.success, evaluateD20Check(e.roll, e.max).natConsequences) : '';
  return `<div class="roll-log-entry ${cls}${e.secret ? ' secret' : ''}"><span class="who">${escapeHtml(e.player||'?')}</span><span class="rest">${e.secret ? '🤫 ' : ''}${escapeHtml(e.statLabel)} (${modTxt})${modeTxt}${rollsTxt} — к20=${e.roll} / Макс.${e.max} — ${outcome}${special}</span></div>`;
}
// Local store+render is unconditional (offline-first); relay is a separate, explicit step so a
// received entry never bounces back out to whoever just sent it.
// silent=true skips the (relatively expensive — full localStorage write + full DOM re-render of
// the log) save/render step, for callers that add many entries in one go and do it once at the end
// themselves (see roll-sync handling below — a naive per-entry save+render there was the actual
// cause of the multi-second UI freeze on player connect: syncing a few hundred saved rolls meant a
// few hundred full localStorage.setItem + innerHTML rebuilds firing back-to-back, synchronously).
function addRollLogEntry(entry, silent){
  if(_rollLogSeenIds.has(entry.id)) return false;
  _rollLogSeenIds.add(entry.id);
  session.log.push(entry);
  if(session.log.length>500) session.log = session.log.slice(-500);
  if(!silent){ saveRollLog(); renderRollLog(); }
  return true;
}
// Все вызовы игрового стола (модуль GameTable в отдельном блоке script в конце файла) из существующего кода
// идут только через эту обёртку: стол может ещё не существовать (ранние renderAll при загрузке) и никакая
// его ошибка не должна прервать обработку сессии/листа персонажа.
// То же для саундпада (модуль Soundboard в отдельном блоке script в конце файла): его ошибка не должна ломать сессию.
function sbHook(fn){
  if(typeof Soundboard==='undefined') return;
  try{ fn(Soundboard); }catch(e){ console.error('[Саундпад]', e); }
}
function gtHook(fn){
  if(typeof GameTable==='undefined') return;
  try{ fn(GameTable); }catch(e){ console.error('[Игровой стол]', e); }
}
function sendMsg(msg, toId){
  if(!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  const out = Object.assign({}, msg);
  if(toId) out.to = toId;
  try{ session.ws.send(JSON.stringify(out)); }catch(e){}
}
function relayRollToAllPlayersExcept(exceptId, entry){
  // No "to" field = server broadcasts to everyone except the sender — exactly what's needed here,
  // the GM doesn't need to know each player's id individually to fan a roll back out to the rest.
  sendMsg({type:'roll', entry});
}
// Called from executeRoll() (основной бросок) with the outcome it just computed — this is the only
// hook point; nothing else needs to know a session might be active. mode/rolls — Преимущество/Помеха
// через жест вне поля гексов (см. openRollPicker); по умолчанию 'plain'/[roll] — старые записи в
// логе (сохранённые до этой доработки) читаются renderRollLog так же: mode там просто отсутствует
// и трактуется как 'plain' (см. проверку e.mode && e.mode!=='plain' ниже).
function recordAndShareRoll(statKey, mod, roll, max, success, category, mode, rolls){
  session.rollCounter++;
  const entry = {
    id: getDeviceId()+':'+session.rollCounter,
    player: session.ownName || document.getElementById('fName').value || 'Аноним',
    statLabel: STAT_LABELS[statKey]||statKey, mod, roll, max, success, category,
    mode: mode||'plain', rolls: rolls||[roll]
  };
  if(secretRollActive() && statKey!=='creature_roll' && statKey!=='map_attack' && statKey!=='map_ability'){ shareSecretRoll(entry, entry.statLabel); return; }
  addRollLogEntry(entry);
  if(statKey!=='map_attack' && (roll===12 || (roll===13 && !success)) && typeof Reactions!=='undefined') // реакция «Крит!» / «Провал!» над бросившим
    Reactions.rollEvent(roll===12 ? 'crit' : 'fumble', statKey==='creature_roll' && _creatureRollCtx ? _creatureRollCtx.tokId : null);
  if(statKey==='creature_roll' && !(_creatureRollCtx && _creatureRollCtx.pub)) return; // бросок существа — только в своём логе Мастера
  if(typeof Onboarding!=='undefined' && Onboarding.busy()) return; // учебный бросок — другим участникам не уходит
  if(session.role){
    const wsOpen = !!(session.ws && session.ws.readyState===WebSocket.OPEN);
    console.log('[Бросок] отправляю', entry.id, wsOpen?'(WS открыт)':'(WS НЕ открыт — не уйдёт!)');
    sendMsg({type:'roll', entry}); // broadcast either way — GM's own copy already stored above
  }
  RoomTransport.sendGameEvent({type:'dice_roll', entry}); // best-effort доп. доставка через DataChannel, тот же id — дедуп в addRollLogEntry гасит повтор
}
// Минимальный адаптер для боковой панели бросков кубов (DicePanel, см. её раздел ниже): та же
// цепочка id/сохранение/рассылка/DataChannel, что и у recordAndShareRoll выше, но принимает уже
// готовую запись (кубик может быть не привязан к конкретной характеристике персонажа — statKey тут
// не подходит по смыслу) вместо пересобирания её внутри функции. НЕ второй лог: тот же session.log,
// тот же addRollLogEntry/дедуп/WS-рассылка/RoomTransport — просто другой вызывающий код.
function recordAndShareQuickRoll(entry){
  session.rollCounter++;
  entry.id = getDeviceId()+':'+session.rollCounter;
  entry.player = session.ownName || document.getElementById('fName').value || 'Аноним';
  entry.kind = 'quick';
  if(secretRollActive() && entry.diceType && !entry.mapAttack && !entry.mapGrenade && !entry.initiative){ shareSecretRoll(entry, entry.diceType==='d20' ? 'к20' : (entry.count || 1) + '×' + (entry.diceType || '').toUpperCase()); return entry; }
  addRollLogEntry(entry);
  if(entry.diceType==='d20' && entry.max!=null && (entry.roll===12 || (entry.roll===13 && entry.success===false)) && typeof Reactions!=='undefined')
    Reactions.rollEvent(entry.roll===12 ? 'crit' : 'fumble', null);
  if(typeof Onboarding!=='undefined' && Onboarding.busy()) return entry; // учебный бросок — другим участникам не уходит
  if(entry.sec && session.role==='gm'){ // пороги (Макс., МУ−Защита) — секрет: каждому игроку своя копия, без DataChannel
    Object.keys(session.players || {}).forEach(id=>sendMsg({type:'roll', entry:rollEntryFor(entry, id)}, id));
    return entry;
  }
  if(session.role){
    const wsOpen = !!(session.ws && session.ws.readyState===WebSocket.OPEN);
    console.log('[Бросок] отправляю', entry.id, wsOpen?'(WS открыт)':'(WS НЕ открыт — не уйдёт!)');
    sendMsg({type:'roll', entry});
  }
  RoomTransport.sendGameEvent({type:'dice_roll', entry});
  return entry;
}
const DEVICE_ID_KEY = 'reincarnator_device_id_v1';
// ВАЖНО: sessionStorage, не localStorage. localStorage общий на все вкладки одного браузерного
// профиля — если Мастер и Игрок открыты как две вкладки на одном компьютере (обычное дело при
// сольном тестировании до того, как появятся реальные удалённые тестировщики), обе вкладки получали
// бы ОДИН И ТОТ ЖЕ deviceId. А счётчик бросков (session.rollCounter) в каждой вкладке свой,
// в памяти, и стартует с нуля — значит первый бросок в каждой вкладке получал бы одинаковый id
// (deviceId:1), и когда чужой бросок с таким же id прилетал по сети, дедуп (_rollLogSeenIds) тихо
// его отбрасывал как "уже видели" — бросок молча не появлялся в общем логе, хотя на самом деле
// это был не сетевой сбой, а коллизия id. sessionStorage у каждой вкладки свой собственный —
// коллизия между разными вкладками физически невозможна, а id всё ещё переживает обновление СВОЕЙ
// же вкладки (что и требовалось — чтобы reconnect после F5 не путал уже отправленные броски).
function getDeviceId(){
  // Safari с «Блокировать все cookie» выбрасывает ошибку уже при обращении к sessionStorage — а эта функция
  // вызывается при загрузке (initRollCounterFromLog), и без защиты падал весь основной скрипт страницы.
  let id = null;
  try{ id = sessionStorage.getItem(DEVICE_ID_KEY); }catch(e){ id = window.__deviceIdFallback || null; }
  if(!id){ id = 'd'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); window.__deviceIdFallback = id; try{ sessionStorage.setItem(DEVICE_ID_KEY, id); }catch(e){} }
  return id;
}
// rollCounter не может просто начинаться с 0 при каждой перезагрузке страницы: deviceId стабилен
// (sessionStorage переживает обновление той же вкладки), а session.log уже восстановлен из
// localStorage при самом создании session (см. log: loadRollLog() в её определении выше) — значит
// первый же новый бросок после ЛЮБОГО обновления страницы получал бы id "тотЖеDeviceId:1", который
// уже есть в _rollLogSeenIds (это же самый первый когда-либо сделанный бросок этого устройства), и
// тихо отбрасывался бы дедупом как повтор — настоящий бросок исчезал бы бесследно, без единой
// ошибки (воспроизведено вживую при тестировании DicePanel). Стартуем счётчик от максимума уже
// виденных номеров этого устройства в восстановленном логе, а не от нуля.
(function initRollCounterFromLog(){
  const prefix = getDeviceId()+':';
  let max = 0;
  session.log.forEach(e=>{
    if(typeof e.id==='string' && e.id.indexOf(prefix)===0){
      const n = parseInt(e.id.slice(prefix.length),10);
      if(!isNaN(n) && n>max) max = n;
    }
  });
  session.rollCounter = max;
})();

function updateSessionStatusUI(){
  const dot = document.getElementById('sessionStatusDot');
  const setup = document.getElementById('sessionSetup');
  const active = document.getElementById('sessionActive');
  const connected = !!(session.ws && session.ws.readyState===WebSocket.OPEN);
  dot.className = 'session-status-dot ' + (connected ? 'on' : 'off');
  if(session.role){
    setup.style.display='none'; active.style.display='block';
    const who = session.role==='gm' ? 'Вы — Мастер' : `Вы — игрок «${session.ownName}»${session.gmName ? ' (у Мастера «'+session.gmName+'»)' : ''}`;
    // Обрыв связи (не явный выход) — переподключение уже планируется отдельно (см. scheduleReconnect
    // в connectSession), тут только статус на экране, чтобы не выглядело зависшим молча.
    document.getElementById('sessionRoleLabel').textContent = connected ? who : who + ' — переподключение…';
    document.getElementById('sessionRoomCode').textContent = currentRoomCode ? '«' + currentRoomCode + '»' : 'общий (без кода)';
    document.getElementById('btnCopyRoomLink').style.display = currentRoomCode ? '' : 'none';
    document.getElementById('sessionPlayersBox').style.display = session.role==='gm' ? 'block' : 'none';
    if(session.role==='gm') renderPlayersList();
  } else {
    setup.style.display='block'; active.style.display='none';
  }
  renderRollLog();
  renderXpChecklist(); // роль (и то, чьи это отметки) могла только что смениться — переключает disabled у чекбоксов
  gtHook(g=>g.refreshRole());
  sbHook(s=>s.refreshRole());
  if(typeof Bestiary!=='undefined') Bestiary.refreshRole(); // бестиарий — только у Мастера / на локальном столе
}
function renderPlayersList(){
  if(typeof GmScreen!=='undefined') setTimeout(()=>GmScreen.refresh(), 0); // экран Мастера — те же данные игроков
  const el = document.getElementById('playersList');
  const ids = Object.keys(session.players);
  // Отключившиеся, которым ещё что-то не дошло (удача/опыт/HP) — Мастер видит, что выдача в пути, а не пропала
  const offline = Object.keys(grantOutbox).filter(id=>!session.players[id] && pendingGrants(id).length);
  const offlineHtml = offline.length ? `<div class="muted" style="margin-top:4px;">Не на связи, дойдёт при подключении: ${
    offline.map(id=>`${escapeHtml(xpRoster[id]||'игрок')} ⏳${pendingGrants(id).length}`).join(', ')}</div>` : '';
  if(!ids.length){ el.innerHTML = '<span class="muted">Пока никто не подключился.</span>' + offlineHtml; return; }
  el.innerHTML = offlineHtml + ids.map(id=>{
    const p = session.players[id];
    const disabled = p.character ? '' : 'disabled title="Ждём лист от игрока…"';
    const luckNow = p.character ? (p.character.luck==null?1:p.character.luck) : null;
    const pending = pendingGrants(id).length; // выдачи, которые игрок ещё не подтвердил (см. sendGrant)
    const pendingTxt = pending ? `<span class="muted" title="Выдачи (удача/опыт/HP), которые ещё не дошли до игрока — дойдут сами, как только он будет на связи">⏳${pending}</span>` : '';
    return `<div class="player-row"><span class="session-status-dot on"></span><span class="name">${escapeHtml(p.name||'(без имени)')} <button type="button" class="small loot-dig-btn" data-lootdig="${id}" ${disabled} title="Находка: бросок по таблицам Находок">${LOOT_SHOVEL_SVG}</button></span>${pendingTxt}
      <button class="small" data-giveluck="${id}" ${disabled} title="Выдать 1 удачу">🍀+1${luckNow!=null?` (сейчас ${luckNow})`:''}</button>
      <button class="small" data-editplayer="${id}" ${disabled}>Править лист</button></div>`;
  }).join('');
  el.querySelectorAll('[data-editplayer]').forEach(btn=>{
    btn.onclick = ()=>enterGmEditMode(btn.dataset.editplayer);
  });
  el.querySelectorAll('[data-giveluck]').forEach(btn=>{
    btn.onclick = ()=>giveLuckToPlayer(btn.dataset.giveluck);
  });
  el.querySelectorAll('[data-lootdig]').forEach(btn=>{
    btn.onclick = ()=>openLootDig(btn.dataset.lootdig);
  });
}
// Быстрая выдача удачи игроку БЕЗ входа в полный режим правки листа (см. enterGmEditMode) — точечное
// сообщение с дельтой, а не полный sheet-push всего листа, чтобы не затереть несохранённые правки
// игрока в других полях, если те у него в этот момент есть.
function giveLuckToPlayer(playerId){
  const p = session.players[playerId];
  if(!p || !p.character) return;
  sendGrant(playerId, {kind:'luck', delta:1}); // копия ГМа отражает выдачу сразу (см. sendGrant)
  renderPlayersList();
}
