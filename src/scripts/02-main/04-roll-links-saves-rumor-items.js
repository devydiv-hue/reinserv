/* ======================================================================
   Ссылки на бросок характеристики внутри текста способностей: "Бросок <характеристика> (<модификатор>)"
   — жирным (как просили) и, где характеристика узнаётся однозначно, кликабельным — тем же жестом, что
   у строк характеристик выше (openRollPicker), только курсор при открытии встаёт на гекс "0", а не
   "−3": число в скобках у способности — это ПОДСКАЗКА игроку (часто ещё и условная, не всегда
   применимая буквально), а не готовый модификатор для автоподстановки.
   ====================================================================== */
// Родительный падеж названия характеристики → её ключ (character.stats), как он встречается в
// реальных текстах книги после "Бросок " ("Бросок воли", "Бросок ловкости рук" и т.д.) — собрано по
// всем 28 характеристикам, даже по тем, что в паттерне "Бросок X (...)" пока не встретились (вреда от
// лишних записей нет, а новые способности с такими фразами могут появиться).
const ABILITY_ROLL_STAT_GENITIVE = {
  'выносливости':'vynoslivost', 'лёгкой атлетики':'legkaya_atletika', 'рефлексов':'refleksy', 'силы':'sila',
  'артистизма':'artistizm', 'воли':'volya', 'духа':'duh', 'понимания людей':'ponimanie_lyudey', 'понимание людей':'ponimanie_lyudey',
  'смекалки':'smekalka', 'убеждения':'ubezhdenie', 'восприятия':'vospriyatie', 'ловкости рук':'lovkost_ruk',
  'ловушек':'lovushki', 'скрытности':'skrytnost', 'архаичного оружия':'arhaichnoe_oruzhie',
  'безоружного боя':'bezoruzhny_boy', 'лёгкого оружия':'legkoe_oruzhie', 'тяжёлого оружия':'tyazheloe_oruzhie',
  'голосов улиц':'golosa_ulic', 'жизни высшего света':'zhizn_vysshego_sveta', 'пересудов люда':'peresudy_lyuda',
  'учения дикарей':'uchenie_dikarey', 'искажений и реликвий':'iskazheniya_i_relikvii', 'мистики':'mistika',
  'опыта диггера':'opyt_diggera', 'путника на Равнине':'putnik_na_ravnine', 'медицины':'medicina',
  'техники':'tehnika', 'учёности':'uchenost', 'цифровых систем':'cifrovye_sistemy',
};
// Встречаются и фразы, где конкретная характеристика по тексту не определена однозначно ("Бросок
// подходящей характеристики", "Бросок знания культуры" — это группа из нескольких характеристик
// сразу) — их тоже находим и делаем жирными, но НЕ кликабельными (гадать, какую именно бросать, не
// стал — то же правило "не додумывать за книгу", что и у ПР(X) с формулой у "Баллона с воздухом").
const ABILITY_ROLL_UNRESOLVED_PHRASES = ['подходящей характеристики','знания культуры'];
const ABILITY_ROLL_PHRASE_LIST = [...Object.keys(ABILITY_ROLL_STAT_GENITIVE), ...ABILITY_ROLL_UNRESOLVED_PHRASES]
  .sort((a,b)=>b.length-a.length) // длинные фразы раньше коротких — иначе "ловкости" перехватит начало "ловкости рук"
  .map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
// Четыре формы одной и той же фразы "Бросок <характеристика>" встречаются по всему каталогу способностей:
//   A) "Бросок X (мод)" — со скобкой-модификатором книги (как было раньше) — этот модификатор НЕ
//      используется как якорь гекса (он часто условный, "подсказка игроку", а не готовое число, см.
//      исходный комментарий у openAbilityRollPicker) — просто требуем скобку, чтобы отличить от формы C.
//   B) "Бросок X против Y" — без скобки, но с "против Y" сразу после X (Y — цель, её не разбираем, это
//      может быть не характеристика листа вовсе, а сопротивление персонажа мастера). По просьбе игрока
//      — якорный гекс здесь по умолчанию −3, а не 0, отдельно для этого случая.
//   C) "голый" "Бросок X" — ни скобки, ни "против" не следует сразу же (и не "равен(а)" — констатация
//      факта, а не команда бросить, "Бросок медицины равен 13" — статичное число персонажа).
//   D) "Бросок X или Y" — где Y ТОЖЕ распознанная характеристика (единственный такой случай в тексте —
//      способность "Найти особое" странника, "Бросок путника на Равнине или опыта диггера, на выбор
//      мастера") — по просьбе игрока обе стороны кликабельны отдельно, каждая — на свой бросок; если
//      же после "или" стоит НЕ распознанная фраза, D не сработает и вся конструкция останется простым
//      текстом (намеренно, см. README — не гадаем).
// Все четыре — ОДНИМ regex'ом с ветвлением через alternation, а не последовательными .replace() —
// иначе повторный проход мог бы повторно найти уже обёрнутый <b class="ability-roll-ref">Бросок X</b>
// ВНУТРИ готовой разметки предыдущего прохода (видимый текст тега — это просто "Бросок X" в исходной
// строке) и обернуть его ещё раз, создавая вложенный/битый HTML.
const ABILITY_ROLL_PHRASE_RE = new RegExp(
  'Бросок\\s+(?:на\\s+)?(' + ABILITY_ROLL_PHRASE_LIST.join('|') + ')' +
  '(?:' +
    '(\\s+[а-яёА-ЯЁ]+)?\\s*\\(([+\\u2212\\-]?\\d+)\\)' +               // A: со скобкой
    '|(?=\\s+против\\s)' +                                              // B: перед "против" (не поглощаем его)
    '|\\s+или\\s+(' + ABILITY_ROLL_PHRASE_LIST.join('|') + ')' +        // D: "или" + распознанная фраза
    '|(?!\\s*\\(|\\s+против\\s|\\s+или\\s|\\s+рав(?:ен|на))' +          // C: голая форма, без скобки/против/или/"равен(а)"
  ')',
  'g'
);
function abilityRollLinkHtml(label, statKey, vs){
  if(!statKey) return escapeHtml(label);
  const fn = vs ? 'openAbilityRollPickerVs' : 'openAbilityRollPicker';
  const suffix = vs ? ' (против цели)' : '';
  return `<b class="ability-roll-ref" onpointerdown="event.preventDefault();${fn}('${statKey}',event.clientX,event.clientY)" title="Нажмите и протяните — бросок ${escapeAttr(STAT_LABELS[statKey])}${suffix}">${escapeHtml(label)}</b>`;
}
function linkifyAbilityRollRefs(text){
  if(!text) return text;
  let out = text.replace(ABILITY_ROLL_PHRASE_RE, (whole, phrase, extraWord, mod, orPhrase, offset, full)=>{
    const statKey = ABILITY_ROLL_STAT_GENITIVE[phrase];
    if(!statKey && !orPhrase) return `<b>${escapeHtml(whole)}</b>`;
    if(orPhrase){
      // Ветка D — "или" делит совпадение на X и Y, обе части линкуются отдельно (см. комментарий выше).
      const sepIdx = whole.indexOf(' или ');
      const xLabel = whole.slice(0, sepIdx), yLabel = whole.slice(sepIdx + ' или '.length);
      return abilityRollLinkHtml(xLabel, statKey, false) + ' или ' + abilityRollLinkHtml(yLabel, ABILITY_ROLL_STAT_GENITIVE[orPhrase], false);
    }
    // Ветку B отличаем от A/C по отсутствию скобки-модификатора (mod===undefined) + реальному "против"
    // сразу после совпадения в ИСХОДНОЙ строке (ветка C такую проверку уже гарантированно проходит по
    // лукахеду самого regex'а, но явно перепроверяем на всякий случай, а не полагаемся молча).
    const isAgainst = mod==null && /^\s+против\s/.test(full.slice(offset+whole.length, offset+whole.length+20));
    return abilityRollLinkHtml(whole, statKey, isAgainst);
  });
  // "Распространить слух" (лицедей) — единственный во всём каталоге случай формулы "проверка к20 с
  // Максимумом [X + одно из нескольких]" — не общий паттерн (regex под него плодить не стал, встречается
  // ровно один раз), просто точечная подмена конкретной фразы на жест-триггер квадрата гексов (см.
  // openCultureRollQuad). indexOf/slice, а не .replace(string,...), — чтобы не занести это в HTML дважды
  // при повторном рендере (маловероятно, но replace со строкой и так заменяет только первое вхождение —
  // на всякий случай явная проверка, что ссылка ещё не вставлена).
  const rumorPhrase = 'проверку к20 с Максимумом [артистизм + знания окружающей культуры]';
  if(out.includes(rumorPhrase) && !out.includes('openCultureRollQuad')){
    out = out.replace(rumorPhrase, `<b class="ability-roll-ref" onpointerdown="event.preventDefault();openCultureRollQuad(event.clientX,event.clientY)" title="Нажмите и протяните — выбрать знание культуры, затем бросок">${escapeHtml(rumorPhrase)}</b>`);
  }
  return out;
}
function openAbilityRollPicker(statKey, clientX, clientY, anchorMod){
  if(!character) return;
  openRollPicker(statKey, clientX, clientY, anchorMod==null?0:anchorMod); // якорь "0" по умолчанию — см. комментарий выше
}
window.openAbilityRollPicker = openAbilityRollPicker;
// "Бросок X против Y" — тот же жест, только якорный гекс по умолчанию −3 (попросили отдельно для
// этого паттерна), а не "0", как у остальных форм "Бросок X" выше.
function openAbilityRollPickerVs(statKey, clientX, clientY){
  openAbilityRollPicker(statKey, clientX, clientY, -3);
}
window.openAbilityRollPickerVs = openAbilityRollPickerVs;

/* ======================================================================
   Спасброски от вредной среды ("Вредная среда"/"Прямой контакт"/"Пси-поле"/"Кислотность") — те же
   броски, что и у характеристик/способностей (тот же жест openRollPicker), просто их "Максимум"
   считается отдельной формулой, а не ЗХ+10 из character.stats — см. ветку saveDef в openRollPicker.
   Якорный гекс по умолчанию: 0 у первых трёх (как у способностей), −6 у кислотности — это стандартный
   ситуативный штраф Гекса, указанный отдельно для неё; он не входит в Максимум, только предвыбирает
   гекс, как и везде — игрок всегда может выбрать другой.
   ====================================================================== */
const SAVE_ROLL_DEFS = {
  // Спасбросок от смерти — всегда к20 с Максимумом 9, от характеристик и снаряжения не зависит.
  // «Непреклонность» («вместо спасброска от смерти … спасбросок воли (−3)») — только подсказка: волю игрок бросает сам
  save_smert: {
    label: 'Спасбросок от смерти', anchorMod: 0,
    base(){ return 9; },
    tags(){
      const t = ['Максимум всегда 9'];
      const alt = (character.abilities || []).find(a=>/вместо\s+спасброска\s+от\s+смерти[^.]*спасбросок\s+воли/i.test(a.text || ''));
      if(alt){ const m = /спасбросок\s+воли\s*\(\s*([−+-]\s*\d+)\s*\)/i.exec(alt.text); t.push(`${alt.name}: можно вместо него Бросок воли${m ? ' (' + m[1].replace(/\s/g, '') + ')' : ''}`); }
      return t;
    },
    formula(){ return 'к20, Максимум 9'; }
  },
  save_vrednaya_sreda: {
    label: 'Вредная среда', anchorMod: 0,
    base(){ return 10 + character.stats.vynoslivost + (character.siz||0) + getWornArmorSizBonus(); },
    tags(){
      const t = [`Бросок вын.: ${10 + character.stats.vynoslivost}`];
      if(character.siz) t.push(`СИЗ (поле): ${character.siz>0?'+':''}${character.siz}`);
      const ab = getWornArmorSizBonus();
      if(ab) t.push(`СИЗ (надетая броня): +${ab}`);
      return t;
    },
    formula(){ const ab=getWornArmorSizBonus(); return `Бросок вын. + СИЗ${ab?` (+${ab} от надетой брони)`:''}`; }
  },
  save_pryamoy_kontakt: {
    label: 'Прямой контакт', anchorMod: 0,
    base(){ return 10 + character.stats.vynoslivost - 6; },
    tags(){ return [`Бросок вын.: ${10 + character.stats.vynoslivost}`, `Штраф книги: −6`]; },
    formula(){ return 'Бросок вын. −6'; }
  },
  save_psi_pole: {
    label: 'Пси-поле', anchorMod: 0,
    base(){ return (character.psiSoprot||0) + getWornArmorPsiScreenBonus(); },
    tags(){
      const t = [`Пси-сопротивление: ${character.psiSoprot||0}`];
      const pb = getWornArmorPsiScreenBonus();
      if(pb) t.push(`Пси-экран (надетая броня): +${pb}`);
      return t;
    },
    formula(){ const pb=getWornArmorPsiScreenBonus(); return `Максимум = Пси-сопротивление${pb?` (+${pb} от надетой брони)`:''}`; }
  },
  save_kislotnost: {
    label: 'Кислотность', anchorMod: -6,
    base(){ const v = getAcidCheckMax(); return v==null ? 0 : v; },
    tags(){
      const {armorSK, bootsSK} = getAcidCheckParts();
      const t = [];
      if(armorSK!=null) t.push(`СК брони: ${armorSK}`);
      if(bootsSK!=null) t.push(`СК сапог: ${bootsSK}`);
      return t;
    },
    formula(){ return 'Меньшее из СК надетой брони и надетых сапог'; }
  },
  save_rest_dvor: {
    label: 'Отдых в постоялом дворе', anchorMod: 0,
    base(){ return 10 + character.stats.vynoslivost; },
    tags(){ return [`Бросок вын.: ${10 + character.stats.vynoslivost}`]; },
    formula(){ return 'Бросок вын.'; }
  },
  save_rest_ravnina: {
    label: 'Отдых на Равнине', anchorMod: 0,
    base(){ return 10 + character.stats.vynoslivost + (character.restEquipMod||0) + getActiveRestModSum(); },
    tags(){
      const t = [`Бросок вын.: ${10 + character.stats.vynoslivost}`];
      const manualMod = character.restEquipMod||0;
      if(manualMod) t.push(`Мод. снаряжения (поле): ${manualMod>=0?'+':''}${manualMod}`);
      const itemsMod = getActiveRestModSum();
      if(itemsMod) t.push(`Включённые предметы: ${itemsMod>=0?'+':''}${itemsMod}`);
      return t;
    },
    formula(){ return 'Бросок вын. + мод. снаряжения'; }
  }
};
// "Распространить слух" (способность лицедея) — Максимум формулой [артистизм + одно из 4 знаний
// культуры], книга явно не называет, какое именно (зависит от происхождения персонажа) — четыре
// синтетических записи, по одной на каждый возможный выбор, выбирается жестом (см. CULTURE_KNOWLEDGE_
// CHOICES/openCultureRollQuad ниже). ВАЖНО: тут Максимум = СУММА сырых значений характеристик, БЕЗ
// обычного "+10" ("ЗХ+10" — формула броска характеристики, а не этой формулы книги — игрок явно
// уточнил числовым примером: артистизм 4 + голоса улиц 4 = 8, не 18).
['golosa_ulic','zhizn_vysshego_sveta','peresudy_lyuda','uchenie_dikarey'].forEach(cultKey=>{
  SAVE_ROLL_DEFS['raspr_sluh_'+cultKey] = {
    label: STAT_LABELS['raspr_sluh_'+cultKey], anchorMod: 0,
    base(){ return character.stats.artistizm + character.stats[cultKey]; },
    tags(){ return [`Артистизм: ${character.stats.artistizm}`, `${STAT_LABELS[cultKey]}: ${character.stats[cultKey]}`]; },
    formula(){ return `Артистизм + ${STAT_LABELS[cultKey]}`; }
  };
});
function openSaveRollPicker(saveKey, clientX, clientY){
  if(!character) return;
  const def = SAVE_ROLL_DEFS[saveKey];
  if(!def) return;
  const blocked = def.blocked ? def.blocked() : null; // например, оружие недоступно по силе или не заряжено
  if(blocked){ uiAlert(blocked, {title:'Бросок недоступен', icon:'⚠'}); return; }
  openRollPicker(saveKey, clientX, clientY, def.anchorMod);
}
window.openSaveRollPicker = openSaveRollPicker;
function saveRollLinkHtml(saveKey){
  const def = SAVE_ROLL_DEFS[saveKey];
  return `<b class="ability-roll-ref" onpointerdown="event.preventDefault();openSaveRollPicker('${saveKey}',event.clientX,event.clientY)" title="Нажмите и протяните — бросок «${escapeAttr(def.label)}»">${def.label}</b> <span class="muted">(${def.formula()})</span>`;
}
/* ======================================================================
   "Распространить слух" — квадрат из 4 гексов-иконок вместо обычного гекс-ряда с модификаторами: тут
   выбирается не модификатор, а КАКОЕ из 4 знаний культуры складывается с артистизмом (книга явно не
   называет одно конкретное — см. SAVE_ROLL_DEFS.raspr_sluh_* выше). Жест — тот же "нажми-и-протяни",
   но финальный выбор определяется НЕ гексом под курсором в момент отпускания, а ПОСЛЕДНИМ гексом,
   который курсор покинул перед тем, как окончательно выйти за пределы всего квадрата целиком — так
   специально попросили. Если отпустили прямо на гексе, не выходя за пределы квадрата — берём его же.
   ====================================================================== */
const CULTURE_KNOWLEDGE_CHOICES = [
  { key:'golosa_ulic', icon:'🏙️', label:'Мегаполис — Голоса улиц' },
  { key:'zhizn_vysshego_sveta', icon:'🧐', label:'Монокль — Жизнь высшего света' },
  { key:'peresudy_lyuda', icon:'🤫', label:'Шёпот на ухо — Пересуды люда' },
  { key:'uchenie_dikarey', icon:'🍃', label:'Листик — Учение дикарей' },
];
function openCultureRollQuad(clientX, clientY){
  if(!character) return;
  closeRollOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'roll-overlay';
  const popup = document.createElement('div');
  popup.className = 'roll-popup quad-popup';
  popup.style.visibility = 'hidden';
  popup.innerHTML = `<div class="quad-title">Какое знание культуры?</div>
    <div class="quad-grid">${CULTURE_KNOWLEDGE_CHOICES.map(c=>
      `<div class="quad-cell" data-key="${c.key}" title="${escapeAttr(c.label)}"><span class="quad-icon">${c.icon}</span></div>`
    ).join('')}</div>`;
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  _rollOverlayEl = overlay;
  document.body.classList.add('roll-modal-active');

  const pr = popup.getBoundingClientRect();
  let left = clientX - pr.width/2, top = clientY - pr.height/2;
  left = Math.max(6, Math.min(left, window.innerWidth - pr.width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - pr.height - 6));
  popup.style.left = left+'px'; popup.style.top = top+'px';
  popup.style.visibility = 'visible';

  const cellAt = (x,y)=>{ const el=document.elementFromPoint(x,y); return el ? el.closest('.quad-cell') : null; };
  let lastInside = cellAt(clientX, clientY);
  const setHovered = (cell)=>{
    popup.querySelectorAll('.quad-cell.hovered').forEach(c=>c.classList.remove('hovered'));
    if(cell){ cell.classList.add('hovered'); lastInside = cell; }
  };
  setHovered(lastInside);

  const finish = (cell, ex, ey)=>{
    closeRollOverlay(); // снимает и window-обработчики жеста через _rollOverlayCleanup, см. его назначение ниже
    const chosen = cell || lastInside;
    if(!chosen) return; // ни разу не побывали ни на одном гексе — считаем жест отменённым
    openRollPicker('raspr_sluh_'+chosen.dataset.key, ex, ey, 0);
  };
  let moved = false, tapMode = false;
  const onMove = (e)=>{
    if(Math.hypot(e.clientX - clientX, e.clientY - clientY) > 8) moved = true;
    const cell = cellAt(e.clientX, e.clientY);
    if(cell) setHovered(cell);
    if(tapMode) return; // в режиме тапов выход курсора за край ничего не выбирает
    const r = popup.querySelector('.quad-grid').getBoundingClientRect();
    const outside = e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom;
    if(outside && lastInside) finish(lastInside, e.clientX, e.clientY);
  };
  const onUp = (e)=>{
    if(!moved && !tapMode){ tapMode = true; popup.querySelector('.quad-title').textContent = 'Нажмите на нужное знание'; return; } // короткий тап — выбор следующим тапом
    const cell = cellAt(e.clientX, e.clientY);
    if(tapMode && !cell) return;
    finish(cell, e.clientX, e.clientY);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  // Обычно снимается через finish() выше (closeRollOverlay ЕЁ и вызывает); назначено сюда же на
  // случай, если оверлей закроют ДРУГИМ путём — Esc/клик по фону — пока жест ещё не завершился.
  _rollOverlayCleanup = ()=>{ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  overlay.addEventListener('pointerdown', (e)=>{ if(e.target===overlay) closeRollOverlay(); });
  document.addEventListener('keydown', _rollEscHandler);
}
window.openCultureRollQuad = openCultureRollQuad;

/* ======================================================================
   Проверка ресурса предмета — ПР(X): у многих предметов книги в тексте встречается "ПР N" (Проверка
   Ресурса) — к6 с Максимумом N, при провале расходуется единица предмета/заряда. Регулярное
   выражение ниже — case-sensitive: "ПР" (обе заглавные) не путается с "Пр" (параметр брони/оружия у
   некоторых предметов, например «Ат+3, Пр−3» — другая буква р, другое значение). Допускает и "ПР 5",
   и "ПР5" (в тексте книги оба варианта встречаются вперемешку).
   Один предмет в каталоге (Баллон с воздухом) задаёт Максимум ФОРМУЛОЙ — «ПР[3−размер персонажа]» —
   уточнено игроком: это 3 минус характеристика "Размер" (см. поле fSizeNum/character.size). Считается
   заново при каждом обращении (не кешируется), чтобы изменение размера персонажа (уродства/мутации
   меняют его автоматически, см. комментарий у fSizeNum) сразу отражалось на кнопке проверки ресурса.
   ====================================================================== */
const RESOURCE_CHECK_RE = /ПР\s*(\d+)/;
// "N−размер персонажа" внутри квадратных скобок — единственная встретившаяся в каталоге формула
// (Баллон с воздухом); в общем виде на случай, если появится другой предмет с той же формой, но иной
// константой, а не только "3".
const RESOURCE_CHECK_FORMULA_RE = /ПР\[(\d+)\s*[−-]\s*размер персонажа\]/;
function parseResourceCheck(name){
  if(!name) return null;
  const fm = RESOURCE_CHECK_FORMULA_RE.exec(name);
  if(fm){
    const constant = parseInt(fm[1],10);
    const size = (character && typeof character.size==='number') ? character.size : 0;
    return constant - size;
  }
  const m = RESOURCE_CHECK_RE.exec(name);
  return m ? parseInt(m[1],10) : null;
}

