/* ======================================================================
   Зоны защиты брони — "Надеть" из инвентаря + силуэт человечка. Шесть зон встречаются в тексте
   каталога брони (проверено по всем 45 позициям + таблицам генерации): торс, руки, голова, ноги,
   плечи, бёдра — плюс "всё тело" как готовая комбинация всех шести сразу (просили именно так: "«Всё
   тело» — комбинация всех доступных зон защиты"). "Бёдра" в исходном перечне от игрока не звучали
   (только "Торс/Руки/Голова/Ноги/Всё тело/Торс и Плечи"), но реально встречаются в тексте книги
   отдельно от "ног" (например, «Кинезис-латы» — торс, руки и БЁДРА; «Панцирь висельника» — торс,
   руки и НОГИ — разные предметы, разное покрытие) — добавлены как седьмая по счёту, но полноценная
   зона, а не смешаны с "ногами", чтобы не терять эту реальную разницу.
   ====================================================================== */
const ARMOR_ZONES = ['golova','plechi','tors','ruki','bedra','nogi'];
const ARMOR_ZONE_LABELS = { golova:'Голова', plechi:'Плечи', tors:'Торс', ruki:'Руки', bedra:'Бёдра', nogi:'Ноги' };
// Цвет каждой зоны на силуэте — шесть разных, узнаваемых оттенков (не полутона одного цвета), поверх
// того же тёплого пергаментного языка, что и весь лист (см. var(--stamp) у торса — тот же акцент, что
// и везде на листе, остальные пять — подобраны отдельно, но в той же тональности).
const ARMOR_ZONE_COLORS = {
  golova:'#b6852c', plechi:'#3f7a6e', tors:'#9c2f1c', ruki:'#4f7a3a', bedra:'#6a4a8a', nogi:'#2f5f8a'
};
// Пытается прочитать зоны из текста предмета по тому же шаблону книги, что и у "Защита N (...) /
// зона1, зона2 / СК..." — если распознать не удалось (свободная формулировка, кастомный предмет
// игрока и т.п.), возвращает пустой список, а не гадает: при надевании игрок увидит пустые галочки
// и отметит зоны сам, вместо того чтобы молча приписать предмету неверное покрытие.
function parseArmorZones(name){
  const m = /Защита[^/]*\/\s*([^/]+)\s*\//.exec(name||'');
  if(!m) return [];
  const text = m[1].toLowerCase();
  if(text.includes('всё тело')) return ARMOR_ZONES.slice();
  const found = [];
  if(/голов/.test(text)) found.push('golova');
  if(/плеч/.test(text)) found.push('plechi');
  if(/торс/.test(text)) found.push('tors');
  if(/рук/.test(text)) found.push('ruki');
  if(/бёдр|бедр/.test(text)) found.push('bedra');
  if(/ног/.test(text)) found.push('nogi');
  return found;
}
// Цвета для типовых сокращений урона в скобках у "Защита N (Эн6, Уд5...)" — сами названия типов
// (Эн/Уд/Вз/Пт/Тм и т.д.) не расшифровываем и не придумываем: в книге они не разжёваны, показываем
// ровно тем сокращением, что в тексте, просто раскрашиваем узнаваемо. Неизвестное сокращение — серый.
const ARMOR_SUBTYPE_COLORS = { 'Эн':'#7a4fae', 'Уд':'#b6852c', 'Вз':'#9c2f1c', 'Пт':'#2f5f8a', 'Тм':'#3f7a6e', _default:'#6b6456' };
// Читает числовые показатели защиты из полного текста предмета (name+desc уже объединены в
// item.name, см. строку добавления из каталога): базовое "Защита N", разбивку по типам урона в
// скобках как есть в тексте, СИЗ и — отдельно — защиту головы, если книга указывает её отдельной
// фразой поверх основной ("У шлема защита N (...)" — абсолютное значение у брони, которая иначе
// целиком идёт одним числом на "всё тело"/"торс"/и т.д., например у «Брони расхитителей»; или
// "Защита шлема +N" — бонус к базовой защите, как у «Мехдоспеха первых»). Ничего не гадаем: если
// фраза не совпала по формату книги — соответствующее поле просто отсутствует.
function parseArmorStats(name){
  if(!name) return null;
  const m = /Защита\s*(\d+)\s*(?:\(([^)]+)\))?/.exec(name);
  if(!m) return null;
  const base = parseInt(m[1],10);
  const subs = m[2] ? m[2].split(',').map(s=>s.trim()).filter(Boolean) : [];
  const sizM = /СИЗ\s*(±0|[+\-−]\d+)?/.exec(name);
  const siz = sizM ? (sizM[1] ? sizM[1].replace('−','-') : true) : null;
  // Защита шлема в тексте встречается тремя формулировками: "У шлема защита N (...)" (абсолютное
  // значение, основной блок при этом на "всё тело"/"торс"), "Защита шлема N (...)" (тоже абсолютное,
  // просто порядок слов другой — как у «Панцирьхода») и "Защита шлема +N" (бонус к базовой, знак
  // обязателен — как у «Мехдоспеха первых»). Определяем по знаку у числа, а не гадаем по формулировке.
  let helmet = null;
  const helmM = /защита шлема\s*([+\-−]?\d+)\s*(?:\(([^)]+)\))?/i.exec(name);
  const helmAltM = !helmM ? /у шлема защита\s*(\d+)\s*(?:\(([^)]+)\))?/i.exec(name) : null;
  if(helmM){
    const raw = helmM[1];
    if(/^[+\-−]/.test(raw)){
      helmet = { mode:'mod', value: parseInt(raw.replace('−','-'),10) };
    } else {
      helmet = { mode:'abs', value: parseInt(raw,10), subs: helmM[2] ? helmM[2].split(',').map(s=>s.trim()).filter(Boolean) : [] };
    }
  } else if(helmAltM){
    helmet = { mode:'abs', value: parseInt(helmAltM[1],10), subs: helmAltM[2] ? helmAltM[2].split(',').map(s=>s.trim()).filter(Boolean) : [] };
  }
  return { base, subs, siz, helmet };
}
function armorSubChipHtml(s, extraClass){
  const sm = /^([А-Яа-яЁё]+)\s*(±0|[+\-−]?\d+)$/.exec(s);
  if(!sm) return `<span class="armor-stat-chip ${extraClass||''}">${escapeHtml(s)}</span>`;
  const abbr = sm[1], val = sm[2].replace('−','-');
  const color = ARMOR_SUBTYPE_COLORS[abbr] || ARMOR_SUBTYPE_COLORS._default;
  return `<span class="armor-stat-chip ${extraClass||''}" style="--chip:${color}">${abbr} ${val}</span>`;
}
// "±0" — 0, "+3"/"-2" (знак уже нормализован на "-" в parseArmorStats) — число, true (голый флаг
// "СИЗ" без цифры в тексте, как у «Костюма «Странник»») — 0, его нельзя просуммировать, т.к. книга не
// даёт числа.
function sizStrToNumber(siz){
  if(siz==null || siz===true || siz==='±0') return 0;
  return parseInt(siz,10) || 0;
}
// Автосумма СИЗ и пси-экрана со ВСЕХ надетых предметов брони (см. getWornArmorItems) — используется в
// спасбросках "Вредная среда"/"Пси-поле" (см. SAVE_ROLL_DEFS) в ДОПОЛНЕНИЕ к ручным полям fSiz/
// fPsiSoprot, а не вместо них: ручные поля остаются как были (мало ли что там у игрока ещё числится —
// маски, фильтры и т.п. без "Защита" в тексте, их эта автоматика не видит и не должна видеть молча).
function getWornArmorSizBonus(){
  let sum = 0;
  getWornArmorItems().forEach(it=>{ const st = parseArmorStats(it.name); if(st) sum += sizStrToNumber(st.siz); });
  return sum;
}
function getWornArmorPsiScreenBonus(){
  let sum = 0;
  getWornArmorItems().forEach(it=>{
    const re = /пси-экран\s*\+\s*(\d+)/gi;
    let m; while((m = re.exec(it.name))) sum += parseInt(m[1],10);
  });
  return sum;
}
// Есть ли у надетой брони СИЗ вообще (число или голый флаг без числа — оба считаются) — используется
// на объёмной фигуре: под шлемом показывается противогаз, если хоть один надетый предмет брони даёт
// СИЗ (см. следующий раздел).
function getWornArmorHasSiz(){
  return getWornArmorItems().some(it=>{ const st = parseArmorStats(it.name); return st && st.siz!=null; });
}
// СК — сквозная характеристика прочности снаряжения (и у брони, и у обуви), используется для проверки
// кислотности: берём ПЕРВОЕ число после "СК" в тексте предмета — у части брони встречается второе,
// уточняющее число в скобках именно для обуви ("СК19 (СК24 для ботинок)" у «Панциря висельника») —
// его не трогаем, второе число не для основного слота брони.
function parseSK(name){
  const m = /СК\s*(\d+)/.exec(name||'');
  return m ? parseInt(m[1],10) : null;
}

/* ======================================================================
   ОРУЖИЕ — «Экипировать»/«Снять»/«Заменить» у предметов инвентаря (invRowHtml, см. ниже), заполняет
   карточки "Оружие 1/2" (см. renderWeapons). Тот же принцип, что и у брони (parseArmorStats выше) —
   текст самого предмета читается по формату книги, ничего не гадаем: не распознали — кнопка просто не
   появляется, как и у "Надеть" для брони.
   ====================================================================== */
// Слово сразу после "МУ<число>" — тип попадания; и оно, и теги-свойства (пул/разрыв/... ), и "раны N"
// просто ПОДСВЕЧИВАЮТСЯ в исходном тексте (см. highlightWeaponTags), а не выносятся в отдельные поля —
// в отличие от Дл, которое книга даёт отдельным числом и которое действительно нужно как отдельный
// стат карточки (см. parseWeaponStats).
const WEAPON_HIT_TYPES = ['удар','патрон','энергия','температура'];
const WEAPON_TAG_WORDS = ['пул','разрыв','травма','клинит','медленное','автомат','скорость','однозарядное','оптика','пальба','высокие технологии','ксенотех','мощь'];
function highlightWeaponTags(text){
  const html = escapeHtml(text);
  const alt = [...WEAPON_HIT_TYPES, ...WEAPON_TAG_WORDS, 'раны\\s*\\d+', 'Сл\\d+'].join('|');
  return html.replace(new RegExp('(' + alt + ')', 'gi'), '<span class="tag">$1</span>');
}
// Проверка конкретной черты оружия (см. "Черты оружия" в памятке книги) — тег должен быть отдельным
// словом/фразой, отграниченной запятой/точкой/границей строки, а не подстрокой внутри другого слова
// (важно для коротких тегов вроде "пул" — не должен ловить, например, "пуля", если такое слово когда-
// нибудь встретится в тексте предмета). Проверяется по statText (стат-блок), а не по имени/cleanName —
// у оружия вроде «Автомат «Бархан»» слово "автомат" в САМОМ НАЗВАНИИ не должно считаться чертой само
// по себе, черта определяется только явным тегом в стат-блоке.
function hasWeaponTag(statText, word){
  return new RegExp('(^|[,.;]\\s*)' + word + '(\\s*[,.;]|$)', 'i').test(statText||'');
}
// Ат/МУ — обязательные признаки "это оружие" (нет совпадения — кнопка не показывается, предмет как
// был просто текстом, так и остаётся). Пр — ИМЕННО "Пр" с маленькой "р" (Парирование, встречается не у
// всякого оружия) — специально НЕ "ПР" заглавными: та же аббревиатура заглавными — это "Проверка
// Ресурса" патронов/зарядов (см. parseResourceCheck, кнопка ⚄ ПР(X) у того же предмета) — регистр в
// тексте книги — единственное, что их отличает друг от друга, поэтому регэксп регистрозависим намеренно
// (без флага i), не опечатка.
const WEAPON_AT_RE = /Ат\s*([+−-]\s*\d+)/;
const WEAPON_MU_RE = /МУ\s*(\d+)\s*(удар|патрон|энергия|температура)?/;
const WEAPON_PR_RE = /Пр\s*([+−-]\s*\d+)/;
const WEAPON_DL_RE = /Дл\s*(\d+)/;
// "Сл<N>" — ЗХ силы для комфортного боя этим оружием (см. памятку "Технические характеристики
// оружия") — не просто тег для подсветки: это и есть число, которым книга различает Лёгкое (Сл≤3) и
// Тяжёлое (Сл4+) оружие для навыка боя (см. weaponCombatSkill ниже).
const WEAPON_SL_RE = /Сл\s*(\d+)/;
// "раны N" — базовое число ран за попадание (см. черту "Раны Х" в памятке: без неё — 1 рана за
// попадание, с ней — указанное число). Используется в резолве попаданий (см. resolveWeaponAttackOutcome).
const WEAPON_WOUNDS_RE = /раны\s*(\d+)/i;
function parseWeaponStats(fullName){
  if(!fullName) return null;
  const atM = WEAPON_AT_RE.exec(fullName), muM = WEAPON_MU_RE.exec(fullName);
  if(!atM || !muM) return null;
  const normSigned = s => parseInt(s.replace(/\s+/g,'').replace('−','-'),10);
  // Имя vs. текст свойств — два формата, встречающихся в данных: "Имя — текст." (предмет добавлен из
  // каталога, см. btnAddFromCatalog — там name и desc склеиваются через " — ") или "Имя (текст)"
  // (стартовые таблицы, см. JUNK_GEN_WEAPON_TABLE и т.п. — там стат-блок в скобках в конце названия).
  // Если ни один шаблон не совпал (нестандартно вписанное игроком оружие) — показываем всю строку и
  // как имя, и как текст: лучше повториться, чем молча обрезать реальное название.
  const dashIdx = fullName.indexOf(' — ');
  let cleanName, statText;
  if(dashIdx !== -1){ cleanName = fullName.slice(0,dashIdx).trim(); statText = fullName.slice(dashIdx+3).trim(); }
  else {
    const pm = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(fullName);
    if(pm){ cleanName = pm[1].trim(); statText = pm[2].trim(); }
    else { cleanName = fullName.trim(); statText = fullName.trim(); }
  }
  const prM = WEAPON_PR_RE.exec(fullName), dlM = WEAPON_DL_RE.exec(fullName), slM = WEAPON_SL_RE.exec(fullName);
  const woundsM = WEAPON_WOUNDS_RE.exec(statText);
  return {
    cleanName, statText,
    at: normSigned(atM[1]), mu: parseInt(muM[1],10), hitType: muM[2]||null,
    pr: prM ? normSigned(prM[1]) : null, dl: dlM ? parseInt(dlM[1],10) : null, sl: slM ? parseInt(slM[1],10) : null,
    wounds: woundsM ? parseInt(woundsM[1],10) : 1, // "Раны Х" — X, иначе по умолчанию 1 (см. черту "Раны Х")
    hasExplicitWounds: !!woundsM, // отличает реальную черту "Раны Х" от дефолта 1 — нужно для приоритета над "Мощь" (см. moshh/resolveWeaponAttackOutcome)
    // Черты, влияющие на бросок атаки/резолв попаданий (см. "Черты оружия" в памятке книги) —
    // все проверяются по statText, см. комментарий у hasWeaponTag выше.
    klinit: hasWeaponTag(statText, 'клинит'),
    razryv: hasWeaponTag(statText, 'разрыв'),
    pul: hasWeaponTag(statText, 'пул'),
    avtomat: hasWeaponTag(statText, 'автомат'),
    optika: hasWeaponTag(statText, 'оптика'),
    odnozaryadnoe: hasWeaponTag(statText, 'однозарядное'),
    palba: hasWeaponTag(statText, 'пальба'),
    highTech: hasWeaponTag(statText, 'высокие технологии'),
    xenoteh: hasWeaponTag(statText, 'ксенотех'),
    // "Мощь" — раны за попадание = выпавший к12 (см. resolveWeaponAttackOutcome) ВМЕСТО плоского числа;
    // если у оружия при этом явно указаны и "раны N", и "мощь" — по решению игрока раны побеждают,
    // мощь в резолве игнорируется (см. hasExplicitWounds выше), но сам факт конфликта подсвечивается
    // предупреждением на карточке (см. renderWeapons), а не тихо проглатывается.
    moshh: hasWeaponTag(statText, 'мощь'),
    // "Скорость" — первая успешная атака В БОЮ наносит на 1 попадание больше (см. resolveWeaponAttackOutcome).
    // Этот лист не отслеживает начало/конец боя сам — "доступность" бонуса живёт как ручной чекбокс на
    // карточке (см. speedBonusAvailable у слота/toggleWeaponSpeedBonus), который игрок сам отмечает
    // обратно после боя, а не автоматический таймер/счётчик ходов.
    skorost: hasWeaponTag(statText, 'скорость'),
  };
}
// Навык боя по оружию (см. памятку "Архаичное/Безоружный/Лёгкое/Тяжёлое" — используется для бросков
// атаки, см. SAVE_ROLL_DEFS.attack_weapon0/1): нет Дальности → холодное оружие → архаичное; есть
// Дальность, но это лук/арбалет по названию → архаичное стрелковое (несмотря на Дл — книга прямо
// исключает луки/арбалеты из лёгкого/тяжёлого); иначе — порох/энергия, Лёгкое при Сл≤3 (или Сл не
// указана), Тяжёлое при Сл 4+.
function weaponCombatSkill(w){
  if(!w || !w.name) return null;
  if(w.dl == null) return 'arhaichnoe_oruzhie';
  if(/лук|арбалет|чакра/i.test(w.name)) return 'arhaichnoe_oruzhie'; // чакра — метательное: Дл есть (30 м), но навык архаичный, как и до появления Дл
  return (w.sl!=null && w.sl>=4) ? 'tyazheloe_oruzhie' : 'legkoe_oruzhie';
}
function blankWeaponSlot(){
  return {name:'',properties:'',at:0,mu:0,dl:null,pr:null,sl:null,wounds:1,hasExplicitWounds:false,
    klinit:false,razryv:false,pul:false,avtomat:false,optika:false,odnozaryadnoe:false,palba:false,highTech:false,xenoteh:false,moshh:false,skorost:false,
    loaded:true, // "заряжено" — только у однозарядное/пальба показывается как переключатель (см. renderWeapons), ручной, не влияет на бросок
    speedBonusAvailable:true, // "Скорость" — доступность бонусного попадания, см. skorost выше; ручной чекбокс, не сбрасывается автоматически
    itemId:null,itemCategory:null,itemNameSnapshot:null};
}
// Бросок атаки экипированным оружием — заведён как ещё два SAVE_ROLL_DEFS (тот же приём, что и у
// raspr_sluh_* выше: несколько записей регистрируются в цикле, base()/tags() читают текущее состояние
// персонажа при каждом вызове, а не на момент регистрации) — переиспользует ВЕСЬ существующий
// механизм броска (openRollPicker/openSaveRollPicker/гекс-жест Помеха-Преимущество-Чистый/лог/
// WS-рассылку) без единой новой строчки в нём самом. Максимум = 10 + навык боя (по оружию, см.
// weaponCombatSkill) + Ат оружия — сам навык боя игрок при этом продолжает выбирать жестом как
// обычный модификатор поверх этой базы (anchorMod:0, как у остальных небазовых бросков).
// Штраф Ат от "Высокие технологии"/"Ксенотех" (см. "Черты оружия") — если у персонажа нет требуемого
// навыка 2+, Ат оружия падает на 2 (а МУ на 1, но МУ ни на что механически не влияет в этом листе, см.
// комментарий у parseWeaponStats выше про его роль как чисто информационного стата — штраф к МУ поэтому
// только упоминается тегом-предупреждением на карточке, не пересчитывает что-либо).
// (штраф Высоких технологий/Ксенотеха — Ат −2 и МУ −1 — считает applyWielder ниже по файлу)
// Подписи броска атаки из листа: навык, Ат (уже с чертами) и что именно его изменило
function weaponAttackTags(idx, extraFn){
  const e = sheetWeaponEffective(character, idx), sk = weaponCombatSkill(e);
  if(!sk) return [];
  const t = [`${STAT_LABELS[sk]}: ${10 + character.stats[sk]}`, `Ат оружия: ${e.at>=0?'+':''}${e.at}`];
  e.techNotes.concat(e.condNotes.filter(n=>/Ат/.test(n))).forEach(n=>t.push(n));
  return t.concat(extraFn(e));
}
[0,1].forEach(idx=>{
  STAT_LABELS['attack_weapon'+idx] = `Атака — Оружие ${idx+1}`;
  SAVE_ROLL_DEFS['attack_weapon'+idx] = {
    label: `Атака — Оружие ${idx+1}`, anchorMod: 0,
    base(){
      const e = sheetWeaponEffective(character, idx), sk = weaponCombatSkill(e);
      if(!sk) return 10;
      const optikaOn = e.optika && checkboxOn('weaponOptika'+idx);
      return 10 + character.stats[sk] + e.at + (optikaOn?6:0); // e.at — уже с тех-штрафом и условными чертами
    },
    tags(){ return weaponAttackTags(idx, (e)=> e.optika && checkboxOn('weaponOptika'+idx) ? ['Оптика (30м+, реакция): +6'] : []); },
    blocked(){ return weaponBlockedReason(character, idx); },
    formula(){ return 'Навык боя (по оружию) + Ат оружия ± черты'; }
  };
  // Автоматическое оружие (см. "Черты оружия" → "Автоматическое оружие") — два дополнительных режима
  // огня поверх обычной прицельной атаки выше, оба заведены тем же приёмом SAVE_ROLL_DEFS.
  STAT_LABELS['burst_weapon'+idx] = `Длинная очередь — Оружие ${idx+1}`;
  SAVE_ROLL_DEFS['burst_weapon'+idx] = {
    label: `Длинная очередь — Оружие ${idx+1}`, anchorMod: 0,
    base(){
      const e = sheetWeaponEffective(character, idx), sk = weaponCombatSkill(e);
      if(!sk) return 10;
      const far = checkboxOn('weaponBurstFar'+idx);
      return 10 + character.stats[sk] + e.at + (far?-6:0);
    },
    tags(){ return weaponAttackTags(idx, ()=> checkboxOn('weaponBurstFar'+idx) ? ['Дистанция >12м: −6'] : []); },
    blocked(){ return weaponBlockedReason(character, idx); },
    formula(){ return 'Навык боя + Ат оружия (−6, если дистанция >12м); успех даёт [КУ+3] попаданий'; }
  };
  // Подавляющий огонь — отдельный спасброс атаки с ФИКСИРОВАННЫМ Максимумом 12 (книга прямо говорит
  // "фиксированным" — ни навык боя, ни Ат оружия сюда не идут, в отличие от обычной атаки/очереди выше).
  STAT_LABELS['suppress_weapon'+idx] = `Подавляющий огонь — Оружие ${idx+1}`;
  SAVE_ROLL_DEFS['suppress_weapon'+idx] = {
    label: `Подавляющий огонь — Оружие ${idx+1}`, anchorMod: 0,
    base(){ return 12; },
    tags(){ return ['Фиксированный Максимум: 12']; },
    blocked(){ return weaponBlockedReason(character, idx); },
    formula(){ return 'Фиксированный Максимум 12; успех даёт [КУ] попаданий по каждой цели в зоне'; }
  };
});
function findInventoryItemById(itemId){
  if(!character) return null;
  for(const cat of ['on_body','pockets','backpack','tiny']){
    const item = character.inventory[cat].find(x=>x.id===itemId);
    if(item) return {item, category:cat};
  }
  return null;
}
function weaponSlotFromItem(item, category, stats){
  return { name:stats.cleanName, properties:highlightWeaponTags(stats.statText), at:stats.at, mu:stats.mu, dl:stats.dl, pr:stats.pr, sl:stats.sl,
    wounds:stats.wounds, hasExplicitWounds:stats.hasExplicitWounds, klinit:stats.klinit, razryv:stats.razryv, pul:stats.pul, avtomat:stats.avtomat, optika:stats.optika,
    odnozaryadnoe:stats.odnozaryadnoe, palba:stats.palba, highTech:stats.highTech, xenoteh:stats.xenoteh, moshh:stats.moshh, skorost:stats.skorost,
    loaded:true, speedBonusAvailable:true,
    itemId:item.id, itemCategory:category, itemNameSnapshot:item.name };
}
// Держит слоты в синхроне с реальным инвентарём при КАЖДОЙ отрисовке (см. renderWeapons) — вместо
// точечных хуков в removeInventoryItem/rerollInventoryItem/onInvDrop/editInventoryItem (пришлось бы
// помнить про экипировку в каждом из них по отдельности, легко забыть при следующей правке). Правка
// ручных полей карточки (updateWeaponField) саму запись предмета в инвентаре не трогает — снапшот
// itemNameSnapshot и текущее item.name совпадают, resync её не перезатирает.
function resyncWeaponSlots(){
  if(!character) return;
  character.weapons.forEach((w,i)=>{
    if(!w.itemId) return;
    const found = findInventoryItemById(w.itemId);
    if(!found){ character.weapons[i] = blankWeaponSlot(); return; } // предмет удалён из инвентаря — слот пустеет
    const {item, category} = found;
    if(item.name === w.itemNameSnapshot){ w.itemCategory = category; return; } // предмет не менялся (разве что переложен в другой отсек) — ручные правки карточки не трогаем
    const stats = parseWeaponStats(item.name);
    character.weapons[i] = stats ? weaponSlotFromItem(item, category, stats) : blankWeaponSlot(); // переброшен в другой предмет (⚄ Переброс) и/или больше не похож на оружие
  });
}
window.equipWeapon = function(category, itemId, slotIdx){
  if(!character) return;
  const item = character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  const stats = item && parseWeaponStats(item.name);
  if(!item || !stats) return;
  const prevName = character.weapons[slotIdx].name;
  character.weapons[slotIdx] = weaponSlotFromItem(item, category, stats);
  logEvent(character, prevName
    ? `Оружие заменено (слот ${slotIdx+1}): «${prevName}» → «${stats.cleanName}».`
    : `Экипировано оружие (слот ${slotIdx+1}): «${stats.cleanName}».`);
  renderAll();
};
window.unequipWeapon = function(slotIdx){
  if(!character) return;
  const prevName = character.weapons[slotIdx].name;
  character.weapons[slotIdx] = blankWeaponSlot();
  if(prevName) logEvent(character, `Оружие снято (слот ${slotIdx+1}): «${prevName}».`);
  renderAll();
};
// "Заменить" — оба слота заняты, нужно явно выбрать, какой: два гекса "1"/"2" (тот же визуальный
// язык/размер, что у гексов-модификаторов брoска — просто наведение здесь только подсвечивает и
// показывает подсказку, выбор — обычным кликом, без протяжного жеста, т.к. выбор всего из двух
// вариантов). Переиспользует общий слот оверлея бросков/каталога (_rollOverlayEl/closeRollOverlay) —
// то же самое Esc/клик-по-фону/блокировка кликов "сквозь" попап получаются бесплатно.
function openWeaponSlotPicker(category, itemId, clientX, clientY){
  if(!character) return;
  closeRollOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'roll-overlay';
  const popup = document.createElement('div');
  popup.className = 'roll-popup';
  popup.style.visibility = 'hidden';
  popup.innerHTML = `<div class="quad-title">Оба слота заняты — заменить какой?</div>
    <div class="hex-line" style="justify-content:center;">
      <div class="hex" data-slot="0">1</div><div class="hex" data-slot="1">2</div>
    </div>
    <div class="roll-max-preview" id="weaponSlotHint"></div>`;
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
  const hint = popup.querySelector('#weaponSlotHint');
  const hexes = [...popup.querySelectorAll('.hex')];
  const updateHint = (i)=>{ hint.innerHTML = character.weapons[i].name ? `Сейчас: <b>${escapeHtml(character.weapons[i].name)}</b>` : 'Слот пуст'; };
  hexes.forEach(hex=>{
    const i = parseInt(hex.dataset.slot,10);
    hex.addEventListener('mouseenter', ()=>{
      hexes.forEach(h=>h.classList.remove('hovered'));
      hex.classList.add('hovered'); updateHint(i);
      hex.classList.remove('hex-shine'); void hex.offsetWidth; hex.classList.add('hex-shine');
    });
    hex.addEventListener('click', ()=>{ equipWeapon(category, itemId, i); closeRollOverlay(); });
  });
  updateHint(0);
  overlay.addEventListener('pointerdown',(e)=>{ if(e.target===overlay) closeRollOverlay(); });
  document.addEventListener('keydown', _rollEscHandler);
}
window.openWeaponSlotPicker = openWeaponSlotPicker;
// Кнопка у предмета инвентаря (см. invRowHtml) — три состояния по месту, как и просили: свободный слот
// есть и предмет не экипирован → "Экипировать" (заполняет его автоматически, без выбора — выбирать
// нечего); предмет уже в одном из слотов → "Снять"; оба слота заняты и предмет не в них → "Заменить"
// (открывает гекс-выбор слота выше).
function weaponEquipButtonHtml(category, item, stats){
  const slotIdx = character.weapons.findIndex(w=>w.itemId===item.id);
  if(slotIdx !== -1) return `<button class="small" onclick="unequipWeapon(${slotIdx})">⚔ Снять</button>`;
  const freeIdx = character.weapons.findIndex(w=>!w.itemId);
  if(freeIdx !== -1) return `<button class="small" onclick="equipWeapon('${category}','${item.id}',${freeIdx})">⚔ Экипировать</button>`;
  return `<button class="small" onpointerdown="event.preventDefault();openWeaponSlotPicker('${category}','${item.id}',event.clientX,event.clientY)">⚔ Заменить</button>`;
}
// "Заряжено/Разряжено" — ручной переключатель у Однозарядное/Пальба (см. "Черты оружия": оба требуют
// перезарядку между атаками, но тратят на это ИГРОВОЕ действие — этот лист не отслеживает ходы/действия
// вообще, поэтому переключатель информационный, не блокирует сам бросок атаки, просто напоминание для
// игрока/Мастера, кто уже перезарядился в этом кругу).
window.toggleWeaponLoaded = function(idx){
  if(!character) return;
  character.weapons[idx].loaded = !character.weapons[idx].loaded;
  renderAll();
};
window.toggleWeaponSpeedBonus = function(idx){
  if(!character) return;
  character.weapons[idx].speedBonusAvailable = !character.weapons[idx].speedBonusAvailable;
  renderAll();
};
// Резолв попаданий после УСПЕШНОЙ атаки (или клинит-замятия) — вызывается из executeRoll ниже для
// любого броска с statKey вида attack_weapon*/burst_weapon*/suppress_weapon*. Не трогает d20-часть
// (это уже сделал executeRoll/recordAndShareRoll) — только то, что происходит ПОСЛЕ: сколько попаданий,
// сколько ран каждое наносит, и бросок к12 за попадание (расположение/тяжесть — см. "Пул"/по умолчанию
// в памятке), результат уходит в общий лог тем же путём, что и любой другой быстрый бросок (recordAndShareQuickRoll).
// Возвращает 'jammed', если сработал Клинит — вызывающий код (executeRoll) по этому сигналу не
// показывает попап переброса (клинит прямо запрещает переброс итога).
// Состояние чекбокса по id — без ?. (optional chaining), чтобы скрипт разбирался и старыми Safari.
function checkboxOn(id){ const el = document.getElementById(id); return !!(el && el.checked); }
const WEAPON_ATTACK_KEY_RE = /^(attack|burst|suppress)_weapon(\d)$/;
function resolveWeaponAttackOutcome(statKey, roll, success, category){
  const m = WEAPON_ATTACK_KEY_RE.exec(statKey);
  if(!m || !character) return;
  const fireMode = m[1], idx = parseInt(m[2],10);
  const slot = character.weapons[idx];
  if(!slot || !slot.name) return;
  const w = sheetWeaponEffective(character, idx); // условные черты по силе, раны кубиками и т.п.
  // Однозарядное: выстрел разряжает оружие, до перезарядки (действие, кнопка на карточке) атаковать им нельзя
  if(slot.odnozaryadnoe && slot.loaded!==false){ slot.loaded = false; setTimeout(()=>renderAll(), 0); }
  if(w.klinit && roll===13){
    recordAndShareQuickRoll({weaponJam:true, weaponName:w.name});
    return 'jammed';
  }
  if(!success) return;
  const plan = weaponHitPlan(w, fireMode, roll, category);
  if(plan.speedUsed) slot.speedBonusAvailable = false;
  const hits = [];
  for(let i=0;i<plan.hits;i++){
    const rolls12 = Array.from({length:plan.rollsPerHit}, ()=>randInt(12));
    const best = Math.max(...rolls12);
    const h = {location: best, wounds: plan.woundsFor(best)};
    if(plan.pulShot) h.rolls12 = rolls12;
    hits.push(h);
  }
  recordAndShareQuickRoll({weaponHits:true, weaponName:w.name, fireMode, hits});
  if(plan.speedUsed) renderWeapons(); // сразу отражает снятый чекбокс "Скорость" на карточке, не дожидаясь следующего несвязанного renderAll()
}
// Правила попаданий после УСПЕШНОЙ атаки — одни и те же для броска из листа (resolveWeaponAttackOutcome выше)
// и для атаки с игрового стола (GameTable, там к12 ещё сверяется с МУ − защита цели). w — слот оружия листа
// или те же поля, разобранные из текста оружия (parseWeaponStats). Возвращает, сколько попаданий, сколько к12
// бросать на каждое и сколько ран даёт выпавший к12; саму «Скорость» (снятие чекбокса) делает вызывающий код.
function weaponHitPlan(w, fireMode, roll, category, opts){
  let hitCount;
  if(fireMode==='burst') hitCount = category+3;
  else if(fireMode==='suppress') hitCount = category;
  else hitCount = (w.razryv || w.pul) ? 1 : category; // Разрыв/Пул — "оружие наносит лишь одно попадание"
  // "Скорость" — первая успешная атака В БОЮ наносит на 1 попадание больше. Бой этот лист не
  // отслеживает — "доступность" живёт как ручной чекбокс на карточке (см. speedBonusAvailable),
  // включённый по умолчанию при экипировке/замене оружия, снимается при использовании и
  // возвращается игроком вручную после боя (см. toggleWeaponSpeedBonus/renderWeapons).
  const speedUsed = !!(w.skorost && w.speedBonusAvailable);
  if(speedUsed) hitCount += 1;
  // "Мощь позволяет наносить к12 ран" — раны за попадание берутся из уже брошенного к12 (тот самый,
  // что и так кидается на каждое попадание) ВМЕСТО плоского wounds; отдельного броска на раны это не
  // требует, к12 просто служит и локацией, и раной одновременно. Не работает, если у оружия явно указаны
  // "раны N" — hasExplicitWounds тогда побеждает (см. её назначение в parseWeaponStats).
  const moshhActive = w.moshh && !w.hasExplicitWounds;
  const razryvBonus = (fireMode==='attack' && w.razryv && roll>=11) ? 4 : 0; // Разрыв: успех (к20) 11+ → +4 раны, поверх любого источника ран
  // Минимум по умолчанию — 1 рана за 1 попадание. «Раны Х» из текста оружия берутся как есть, но слот,
  // сохранённый до появления ран в листе (или заполненный вручную), поля wounds не имеет — раньше это
  // давало «NaN ран» у бросающего и «0 ран» у остальных в логе.
  const baseWounds = Math.max(1, Math.round(Number(w.wounds)) || 1);
  // "Пул": "Проверяя попадания, вы бросаете [категория успеха × к12] и выбираете лучший" — одно попадание,
  // но [КУ] бросков к12 за него. Пул+Мощь: тот же лучший бросок идёт и на раны.
  const pulShot = !!(fireMode==='attack' && w.pul);
  return {
    hits: pulShot ? 1 : Math.max(1, hitCount || 0), // успешная атака — хотя бы одно попадание
    rollsPerHit: pulShot ? Math.max(1, category || 0) : 1,
    pulShot, speedUsed,
    woundsFor: (k12)=> Math.max(1, (moshhActive ? k12 : rollBaseWounds()) + razryvBonus)
  };
  // «Раны N» — число; «раны 2к6» — кубики на каждое попадание; «раны 4 (6, если у цели 10+ ОЗ)» — по HP цели
  // (известно только при атаке с игрового стола — opts.targetHp)
  function rollBaseWounds(){
    if(w.woundsVsHp && opts && opts.targetHp!=null && opts.targetHp >= w.woundsVsHp.hp) return w.woundsVsHp.wounds;
    if(w.woundsDice){ let sum = 0; for(let i=0;i<w.woundsDice.n;i++) sum += randInt(w.woundsDice.sides); return sum; }
    return baseWounds;
  }
}

/* ======================================================================
   АТАКА С ИГРОВОГО СТОЛА — части, которые живут рядом с оружием листа (сама механика цели, дистанции и
   применения ран — в модуле GameTable). Защита цели вычитается из МУ оружия: к12 попадания ≤ (МУ − защита)
   — попадание пробило. Если у брони указана защита по типу урона («Защита 2 (Пт1)» — против патронов 1),
   берётся она, иначе общая.
   ====================================================================== */
const ARMOR_SUB_BY_MU = { 'патрон':'Пт', 'удар':'Уд', 'энергия':'Эн', 'температура':'Тм' };
function defenseAgainst(base, subs, muType){
  const abbr = muType && ARMOR_SUB_BY_MU[muType];
  if(abbr && subs && Number.isFinite(subs[abbr])) return subs[abbr];
  return base || 0;
}
// "Уд5" → {Уд:5}; неизвестные/кривые куски пропускаются
function armorSubsObject(list){
  const out = {};
  (list||[]).forEach(s=>{ const m = /^([А-Яа-яЁё]+)\s*([+\-−]?\d+)$/.exec(String(s).trim()); if(m) out[m[1]] = parseInt(m[2].replace('−','-'),10); });
  return out;
}
// Защита торса персонажа игрока (c — его лист: у Мастера это копия из session.players): наибольшая защита
// среди надетой брони, покрывающей торс (по типу урона, если указан), иначе ручное поле «Защита (тело)».
function characterTorsoDefense(c, muType){
  if(!c) return 0;
  let best = null;
  ['on_body','pockets','backpack','tiny'].forEach(cat=>{
    ((c.inventory && c.inventory[cat]) || []).forEach(it=>{
      if(!it.wornZones || it.wornZones.indexOf('tors')<0) return;
      const st = parseArmorStats(it.name);
      if(!st) return;
      const d = defenseAgainst(st.base, armorSubsObject(st.subs), muType);
      if(best===null || d>best) best = d;
    });
  });
  if(best!==null) return best;
  return (c.armor && Number(c.armor.body)) || 0;
}
// Слот оружия листа → те же поля плюс тип урона МУ и черта «травма» (для атаки с карты): берём из полного
// текста предмета, с которого слот экипирован; у вручную заполненного слота — из его текста свойств.
function weaponFullStats(w){
  if(!w || !w.name) return null;
  const parsed = w.itemNameSnapshot ? parseWeaponStats(w.itemNameSnapshot) : null;
  const text = parsed ? parsed.statText : String(w.properties||'').replace(/<[^>]*>/g,'');
  const muM = WEAPON_MU_RE.exec(text);
  return Object.assign({}, w, { statText:text, muType: parsed ? parsed.hitType : (muM && muM[2]) || null, travma: hasWeaponTag(text, 'травма') });
}
/* ======================================================================
   ОРУЖИЕ В РУКАХ КОНКРЕТНОГО ПЕРСОНАЖА. Часть свойств оружия зависит от того, кто им пользуется, — это
   считается здесь, одинаково для листа и для атаки с игрового стола:
   - условные черты из текста: «если сила 4+, то пул», «если сила 4+, получает МУ+1» / «МУ на 1 выше»,
     «при силе 2 и ниже — медленное (и наносит раны 2)», «если сила не 6+, то медленное», «медленное при
     силе < 8», «если смекалка меньше 4, то Ат снижается на 3»;
   - Высокие технологии / Ксенотех без нужного навыка 2+ — Ат −2 и МУ −1 (книга);
   - раны кубиками («раны 2к6», «раны к6») и «раны 4 (6, если у цели 10+ ОЗ)»;
   - доступность: сила ниже Сл, а штрафа за низкую силу в тексте нет, — оружие недоступно, если его не выдал
     Мастер (флажок «Выдано Мастером» на карточке; оружие жетона Мастера выдано всегда).
   st — {sila, smekalka, uchenost, tehnika, iskazheniya}: у персонажа из листа, у NPC — 3 (сила меняется в жетоне).
   ====================================================================== */
function weaponConditionals(statText, st){
  const t = String(statText||''), out = {addPul:false, muDelta:0, atDelta:0, slow:false, woundsOverride:null, lowStrPenaltyDefined:false, notes:[]};
  let m;
  const rePul = /если сила (\d+)\+,?\s*(?:то\s*)?(?:ещё\s*)?пул/gi;
  while((m = rePul.exec(t))){ if(st.sila >= +m[1]){ out.addPul = true; out.notes.push(`сила ${m[1]}+: пул`); } }
  const reMu = /если сила (\d+)\+,?\s*(?:получает\s*МУ\s*\+\s*(\d+)|МУ на (\d+) выше)/gi;
  while((m = reMu.exec(t))){ if(st.sila >= +m[1]){ const d = +(m[2]||m[3]); out.muDelta += d; out.notes.push(`сила ${m[1]}+: МУ+${d}`); } }
  const reLe = /при силе (\d+) и (?:ниже|менее)\s*[—–-]\s*медленное(?:\s*и наносит раны (\d+))?/gi;
  while((m = reLe.exec(t))){
    out.lowStrPenaltyDefined = true;
    if(st.sila <= +m[1]){ out.slow = true; out.notes.push(`сила ${m[1]} и ниже: медленное${m[2] ? ', раны '+m[2] : ''}`); if(m[2]) out.woundsOverride = +m[2]; }
  }
  const reNot = /если сила не (\d+)\+,?\s*то медленное/gi;
  while((m = reNot.exec(t))){ out.lowStrPenaltyDefined = true; if(st.sila < +m[1]){ out.slow = true; out.notes.push(`сила ниже ${m[1]}: медленное`); } }
  const reLt = /медленное при силе\s*<\s*(\d+)/gi;
  while((m = reLt.exec(t))){ out.lowStrPenaltyDefined = true; if(st.sila < +m[1]){ out.slow = true; out.notes.push(`сила ниже ${m[1]}: медленное`); } }
  const reSmek = /если смекалка меньше (\d+),?\s*то Ат снижается на (\d+)/gi;
  while((m = reSmek.exec(t))){ if(st.smekalka < +m[1]){ out.atDelta -= +m[2]; out.notes.push(`смекалка меньше ${m[1]}: Ат−${m[2]}`); } }
  return out;
}
function wielderStats(c){
  if(!c || !c.stats) return {sila:0, smekalka:0, uchenost:0, tehnika:0, iskazheniya:0};
  return {sila:c.stats.sila||0, smekalka:c.stats.smekalka||0, uchenost:c.stats.uchenost||0, tehnika:c.stats.tehnika||0, iskazheniya:c.stats.iskazheniya_i_relikvii||0};
}
function npcWielderStats(strength){ const s = (strength==null || !isFinite(strength)) ? 3 : strength; return {sila:s, smekalka:3, uchenost:3, tehnika:3, iskazheniya:3}; }
// w — оружие с полем statText (weaponFullStats слота листа или разбор текста оружия жетона Мастера)
function applyWielder(w, st, gmIssued){
  if(!w) return null;
  const e = Object.assign({}, w), text = w.statText || '';
  const cond = weaponConditionals(text, st);
  if(cond.addPul) e.pul = true;
  e.at = (Number(e.at)||0) + cond.atDelta;
  e.mu = (Number(e.mu)||0) + cond.muDelta;
  if(cond.woundsOverride!=null){ e.wounds = cond.woundsOverride; e.hasExplicitWounds = true; }
  const dm = /раны\s*(\d*)\s*к\s*(\d+)/i.exec(text);
  if(dm && cond.woundsOverride==null){ e.woundsDice = {n: parseInt(dm[1],10) || 1, sides: parseInt(dm[2],10)}; e.hasExplicitWounds = true; }
  const hm = /раны\s*(\d+)\s*\((\d+),?\s*если у цели (\d+)\+\s*ОЗ\)/i.exec(text);
  if(hm) e.woundsVsHp = {wounds:+hm[2], hp:+hm[3]};
  e.slow = hasWeaponTag(text, 'медленное') || cond.slow;
  const tech = [];
  if(w.highTech && !(st.uchenost>=2 || st.tehnika>=2)){ e.at -= 2; e.mu -= 1; tech.push('Высокие технологии: нет учёности/техники 2+ — Ат−2, МУ−1'); }
  if(w.xenoteh && !(st.iskazheniya>=2)){ e.at -= 2; e.mu -= 1; tech.push('Ксенотех: нет искажений и реликвий 2+ — Ат−2, МУ−1'); }
  e.condNotes = cond.notes; e.techNotes = tech;
  e.unavailable = (w.sl!=null && st.sila < w.sl && !cond.lowStrPenaltyDefined && !gmIssued)
    ? `Сила ${st.sila} ниже Сл${w.sl} — без разрешения Мастера оружие недоступно` : null;
  return e;
}
function weaponSlotGmIssued(c, slot){
  if(!slot) return false;
  if(slot.gmIssued) return true;
  if(!c || !slot.itemId) return false;
  for(const cat of ['on_body','pockets','backpack','tiny']){ const it = ((c.inventory && c.inventory[cat]) || []).find(x=>x.id===slot.itemId); if(it) return !!it.gmIssued; }
  return false;
}
// Слот оружия листа c (свой character или, у Мастера, копия листа игрока) — со всеми правилами выше
function sheetWeaponEffective(c, idx){
  const slot = c && c.weapons && c.weapons[idx];
  const w = weaponFullStats(slot);
  return w ? applyWielder(w, wielderStats(c), weaponSlotGmIssued(c, slot)) : null;
}
// Почему атаковать этим слотом сейчас нельзя (или null): недоступно по силе / однозарядное не заряжено
function weaponBlockedReason(c, idx){
  const e = sheetWeaponEffective(c, idx);
  if(!e) return 'Нет оружия';
  if(e.unavailable) return e.unavailable;
  if(e.odnozaryadnoe && e.loaded===false) return 'Однозарядное оружие не заряжено — перезарядите (действие)';
  return null;
}
window.toggleWeaponGmIssued = function(idx){
  if(!character) return;
  const slot = character.weapons[idx];
  if(!slot) return;
  const now = !weaponSlotGmIssued(character, slot);
  slot.gmIssued = now;
  const found = slot.itemId ? findInventoryItemById(slot.itemId) : null;
  if(found) found.item.gmIssued = now;
  logEvent(character, `Оружие «${slot.name}»: ${now ? 'выдано Мастером — доступно и при силе ниже Сл' : 'разрешение Мастера снято'}.`);
  renderAll();
};
/* ======================================================================
   ГРАНАТЫ — метание с игрового стола (стр. 142, 147; «Бросок лёгкой атлетики против рефлексов цели»).
   Максимум = 10 + лёгкая атлетика − рефлексы цели (у NPC — 3, меняется в жетоне); дальше 12 м — −6.
   Дальность: Крошечная Вещь — 30 м, обычная Вещь — 15 м, +3 м за каждую единицу силы, начиная с 4.
   Успех — граната взрывается под целью (взрыв + осколки), провал с итогом 16+ — осколки всё равно задевают
   всех в радиусе, провал 15− — урона нет (Мастер может дать Невзгоды). Считает Мастер (GameTable.resolveGrenade).
   blast.edge — «в метре от цели» (от края до края жетонов); radius — сфера с центром в точке взрыва.
   ====================================================================== */
const GRENADE_SPECS = {
  g3:      { name:'Граната Г3', range:30, slow:true,
             blast:{edge:1, hitsFromCategory:true, mu:14, muType:'взрыв', wounds:3}, frag:{radius:3, hits:6, mu:9, muType:'патрон', wounds:1} },
  m:       { name:'Граната М', range:15, slow:true,
             blast:{targetOnly:true, hits:2, mu:15, muType:'взрыв', wounds:4}, frag:{radius:6, hits:6, mu:10, muType:'патрон', wounds:1} },
  thermal: { name:'Термическая граната', range:15, slow:false, thermal:{radius:6, wounds:4, maxDefense:6} },
};
function grenadeSpecKey(text){
  const s = ' ' + String(text||'').toLowerCase().replace(/ё/g,'е').split(' — ')[0] + ' ';
  if(/термическая граната/.test(s)) return 'thermal';
  if(/граната г ?3/.test(s)) return 'g3';
  if(/(^|[^а-я])граната м([^а-я]|$)/.test(s)) return 'm';
  return null;
}
// Гранаты в инвентаре листа: [{itemId, key, name, count}] — по одной записи на предмет
function grenadeItemsOf(c){
  const out = [];
  if(!c || !c.inventory) return out;
  ['on_body','pockets','backpack','tiny'].forEach(cat=>((c.inventory[cat])||[]).forEach(it=>{
    const key = grenadeSpecKey(it.name);
    if(key) out.push({itemId:it.id, key, name:GRENADE_SPECS[key].name, count: it.uses>1 ? it.uses : 1});
  }));
  return out;
}
// Брошенная граната списывается: у стопки (uses > 1) — минус одна, последняя уходит из инвентаря
function consumeGrenade(c, itemId){
  if(!c || !c.inventory) return false;
  for(const cat of ['on_body','pockets','backpack','tiny']){
    const list = c.inventory[cat] || [];
    const it = list.find(x=>x.id===itemId);
    if(!it) continue;
    if(it.uses>1){ it.uses -= 1; logEvent(c, `Граната брошена: «${it.name.split(' — ')[0]}» — осталось ${it.uses}.`); }
    else { c.inventory[cat] = list.filter(x=>x.id!==itemId); logEvent(c, `Граната брошена: «${it.name.split(' — ')[0]}» — убрана из инвентаря.`); }
    return true;
  }
  return false;
}
// Бросок атаки с карты — тот же жест с гексами (openRollPicker), что и у всех бросков листа. Максимум,
// подписи и дальнейшую отправку задаёт GameTable через _mapAttackCtx перед открытием жеста. Игрок видит
// только известную ему часть Максимума: модификаторы цели секретны и добавляются у Мастера.
let _mapAttackCtx = null;
Object.defineProperty(STAT_LABELS, 'map_attack', { enumerable:true, configurable:true,
  get(){ return _mapAttackCtx && _mapAttackCtx.fireMode==='grenade' ? 'Бросок гранаты' : 'Атака с карты'; } });
SAVE_ROLL_DEFS['map_attack'] = {
  get label(){ return _mapAttackCtx && _mapAttackCtx.fireMode==='grenade' ? 'Бросок гранаты (лёгкая атлетика)' : 'Атака с карты'; }, anchorMod: 0,
  base(){ return _mapAttackCtx ? _mapAttackCtx.knownBase : 10; },
  tags(){ return _mapAttackCtx ? _mapAttackCtx.tags.slice() : []; },
  formula(){ return _mapAttackCtx && _mapAttackCtx.fireMode==='grenade' ? '10 + лёгкая атлетика − рефлексы цели; дальше 12 м −6' : 'Навык боя + Ат оружия + дистанция; модификаторы цели учитывает Мастер'; }
};
// Бросок существа из бестиария (клик по числу в скобках на карточке): Максимум — из книги. Переброс ресурсами
// листа не предлагается (это не персонаж), в общий лог уходит, только если Мастер включил «броски видны игрокам».
let _creatureRollCtx = null;
function setCreatureRollCtx(ctx){ _creatureRollCtx = ctx; }
Object.defineProperty(STAT_LABELS, 'creature_roll', { enumerable:true, configurable:true, get(){ return _creatureRollCtx ? _creatureRollCtx.label : 'Бросок существа'; } });
SAVE_ROLL_DEFS['creature_roll'] = {
  get label(){ return _creatureRollCtx ? _creatureRollCtx.label : 'Бросок существа'; }, anchorMod: 0,
  base(){ return _creatureRollCtx ? _creatureRollCtx.base : 10; },
  tags(){ return _creatureRollCtx ? [_creatureRollCtx.label + ': ' + _creatureRollCtx.base] : []; },
  formula(){ return 'Максимум из карточки существа'; }
};
// Бросок способности персонажа с игрового стола (PcAbilities): тот же жест, Максимум — 10 + характеристика, модификатор
// способности подсвечен. Встречная («против воли цели») — вердикт у Мастера: из Максимума вычитается характеристика цели.
let _mapAbilityCtx = null;
Object.defineProperty(STAT_LABELS, 'map_ability', { enumerable:true, configurable:true, get(){ return _mapAbilityCtx ? _mapAbilityCtx.label : 'Способность'; } });
SAVE_ROLL_DEFS['map_ability'] = {
  get label(){ return _mapAbilityCtx ? _mapAbilityCtx.label : 'Способность'; }, anchorMod: 0,
  base(){ return _mapAbilityCtx ? _mapAbilityCtx.base : 10; },
  tags(){ return _mapAbilityCtx ? _mapAbilityCtx.tags.slice() : []; },
  formula(){ return _mapAbilityCtx && _mapAbilityCtx.opp ? '10 + характеристика; характеристику цели вычтет Мастер' : '10 + характеристика + модификатор способности'; }
};
function executeMapAbilityRoll(base, mod, popup, mode){
  mode = mode || 'plain';
  const ctx = _mapAbilityCtx, max = base + mod, rolls = mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)];
  const roll = pickD20ForMode(rolls[0], rolls[1], max, mode), ev = evaluateD20Check(roll, max), opp = !!(ctx && ctx.opp);
  if(!opp && typeof recordAndShareRoll==='function') recordAndShareRoll('map_ability', mod, roll, max, ev.success, ev.category, mode, rolls); // встречную запишет Мастер — с итогом по целям
  popup.querySelector('.hex-field').remove();
  popup.querySelector('.roll-max-preview').remove();
  popup.querySelector('.roll-tags').remove();
  if(_rollOverlayEl) _rollOverlayEl.querySelectorAll('.roll-side-hint').forEach(h=>h.remove());
  const startRect = popup.getBoundingClientRect();
  const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
  const stage = document.createElement('div');
  stage.innerHTML = opp ? `<div class="roll-outcome"><span class="verdict">к20: ${rolls.join(', ')}</span>Макс. ${max} − характеристика цели — итог у Мастера${modeTxt}</div>`
    : `<div class="roll-outcome ${ev.success?'success':'failure'}"><span class="verdict">${ev.success?`Успех, КУ${ev.category}`:'Провал'}</span>к20=${roll} / Макс.${max}${modeTxt}</div>`;
  popup.appendChild(stage);
  launchRollAnimation({diceType:'d20', mode, max, rolls, roll}, startRect).then(()=>{
    closeRollOverlay();
    if(ctx && ctx.done) ctx.done({rolls, mode, chosenMod:mod, base:max, roll, success:ev.success, cat:ev.category});
  });
}
// Вместо обычного executeRoll для 'map_attack': кости бросаются здесь (с той же анимацией), но успех и
// попадания считает Мастер — у игрока нет модификаторов цели, поэтому вердикт тут не показывается.
function executeMapAttackRoll(base, mod, popup, mode){
  mode = mode || 'plain';
  const knownMax = base + mod;
  const rolls = mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)];
  const shown = pickD20ForMode(rolls[0], rolls[1], knownMax, mode); // только для анимации — окончательный выбор делает Мастер
  popup.querySelector('.hex-field').remove();
  popup.querySelector('.roll-max-preview').remove();
  popup.querySelector('.roll-tags').remove();
  if(_rollOverlayEl) _rollOverlayEl.querySelectorAll('.roll-side-hint').forEach(h=>h.remove());
  const startRect = popup.getBoundingClientRect();
  const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
  const stage = document.createElement('div');
  stage.innerHTML = `<div class="roll-outcome"><span class="verdict">к20: ${rolls.join(', ')}</span>Результат атаки — в общем логе${modeTxt}</div>`;
  popup.appendChild(stage);
  const ctx = _mapAttackCtx;
  launchRollAnimation({diceType:'d20', mode, max:knownMax, rolls, roll:shown}, startRect).then(()=>{
    closeRollOverlay();
    gtHook(g=>g.submitMapAttack(ctx, {rolls, mode, chosenMod: mod}));
  });
}
let _zonePickerEl = null;
function closeZonePicker(){ if(_zonePickerEl){ _zonePickerEl.remove(); _zonePickerEl=null; } }
// "Надеть" — открывает список из 6 галочек (предзаполнен распознанными зонами, если предмет уже
// надет — текущими надетыми зонами), подтверждение сохраняет их на item.wornZones. Несколько разных
// предметов можно надеть одновременно (шлем + бронежилет и т.д.) — силуэт (renderArmorZones) просто
// объединяет зоны со ВСЕХ надетых предметов инвентаря, не только последнего.
function openEquipZonesPicker(category, itemId){
  const item = character && character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  if(!item) return;
  closeZonePicker();
  const isWorn = !!(item.wornZones && item.wornZones.length);
  const current = isWorn ? item.wornZones : parseArmorZones(item.name);
  const el = document.createElement('div');
  el.className = 'reroll-popup zone-picker';
  let html = `<div class="reroll-title">🛡 Надеть предмет</div>
    <div class="reroll-desc" style="margin-bottom:10px;">${escapeHtml(item.name)}</div>
    <div class="zone-check-list">`;
  ARMOR_ZONES.forEach(z=>{
    html += `<label class="zone-check"><input type="checkbox" value="${z}" ${current.includes(z)?'checked':''}><span style="color:${ARMOR_ZONE_COLORS[z]}">●</span> ${ARMOR_ZONE_LABELS[z]}</label>`;
  });
  html += `</div><div class="reroll-option" style="border:none; padding-top:10px;">
    <button class="small" id="zoneWearBtn">${isWorn?'Обновить':'Надеть'}</button>
    ${isWorn ? `<button class="small" id="zoneRemoveBtn">Снять</button>` : ''}
    <button class="small" id="zoneCancelBtn">Отмена</button>
  </div>`;
  html += `<button class="small reroll-close" id="zoneCloseBtn">✕</button>`;
  el.innerHTML = html;
  document.body.appendChild(el);
  _zonePickerEl = el;
  el.querySelector('#zoneWearBtn').onclick = ()=>{
    const picked = [...el.querySelectorAll('input[type=checkbox]:checked')].map(cb=>cb.value);
    item.wornZones = picked.length ? picked : null;
    logEvent(character, picked.length
      ? `Надето: «${item.name}» — ${picked.map(z=>ARMOR_ZONE_LABELS[z]).join(', ')}.`
      : `Снято: «${item.name}».`);
    closeZonePicker();
    renderAll();
  };
  if(isWorn){
    el.querySelector('#zoneRemoveBtn').onclick = ()=>{
      item.wornZones = null;
      logEvent(character, `Снято: «${item.name}».`);
      closeZonePicker();
      renderAll();
    };
  }
  el.querySelector('#zoneCancelBtn').onclick = closeZonePicker;
  el.querySelector('#zoneCloseBtn').onclick = closeZonePicker;
}
window.openEquipZonesPicker = openEquipZonesPicker;
// Все надетые предметы (wornZones непусты) во ВСЕХ отсеках инвентаря — и для объединения зон на
// силуэте, и для карточек с показателями защиты ниже.
function getWornArmorItems(){
  const items = [];
  if(!character) return items;
  ['on_body','pockets','backpack','tiny'].forEach(cat=>{
    (character.inventory[cat]||[]).forEach(it=>{ if(it.wornZones && it.wornZones.length) items.push(it); });
  });
  return items;
}
// Объединение зон со ВСЕХ надетых предметов во всех отсеках инвентаря — силуэт показывает итоговое
// покрытие персонажа, а не покрытие одного конкретного предмета.
function getWornArmorZones(){
  const zones = new Set();
  getWornArmorItems().forEach(it=>it.wornZones.forEach(z=>zones.add(z)));
  return zones;
}
// Обувь ("ботинки"/"сапоги" в названии) — отдельный слот от брони по зонам: одна пара сапог
// одновременно (не список зон, просто булев флаг item.wornBoots), нужна только для проверки
// кислотности (см. SAVE_ROLL_DEFS.save_kislotnost) — сравнение её СК с СК надетой брони.
function isBootLike(name){ return /ботинк|сапог/i.test(name||''); }
function getWornBootsItem(){
  if(!character) return null;
  let found = null;
  ['on_body','pockets','backpack','tiny'].forEach(cat=>{
    (character.inventory[cat]||[]).forEach(it=>{ if(it.wornBoots) found = it; });
  });
  return found;
}
function toggleWearBoots(category, itemId){
  if(!character) return;
  const item = character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  if(!item) return;
  const nowWearing = !item.wornBoots;
  // Только одна пара сапог одновременно — надевание новой автоматически снимает предыдущую.
  ['on_body','pockets','backpack','tiny'].forEach(cat=>{
    (character.inventory[cat]||[]).forEach(it=>{ if(it.wornBoots) it.wornBoots = false; });
  });
  item.wornBoots = nowWearing;
  logEvent(character, nowWearing ? `Надето (сапоги): «${item.name}».` : `Снято (сапоги): «${item.name}».`);
  renderAll();
}
window.toggleWearBoots = toggleWearBoots;
// Проверка кислотности (стр. книги про Равнину) — Максимум = МЕНЬШЕЕ из СК надетой брони и СК
// надетых сапог, если оба присутствуют; если есть только один — берётся он; если ни одного —
// проверку посчитать нечем (см. muted-заглушку в renderSaves). Среди нескольких одновременно
// надетых предметов брони берём худшее (минимальное) СК — в книге не описан случай "разное СК на
// разных зонах", так что это наша договорённость на такой случай, а не факт из текста.
function getAcidCheckParts(){
  let armorSK = null;
  getWornArmorItems().forEach(it=>{
    const sk = parseSK(it.name);
    if(sk!=null && (armorSK==null || sk<armorSK)) armorSK = sk;
  });
  const bootsItem = getWornBootsItem();
  const bootsSK = bootsItem ? parseSK(bootsItem.name) : null;
  return { armorSK, bootsSK };
}
function getAcidCheckMax(){
  const {armorSK, bootsSK} = getAcidCheckParts();
  if(armorSK==null && bootsSK==null) return null;
  if(armorSK==null) return bootsSK;
  if(bootsSK==null) return armorSK;
  return Math.min(armorSK, bootsSK);
}
// Модификатор отдыха от предметов инвентаря ("Ближайший отдых +1", "Штраф на отдых −4", "отдых со
// штрафом −2", "проверки отдыха −2", а у части предметов число стоит ДО слова — "модификатор −4 на
// проверку отдыха" — формулировки в книге не унифицированы) — ищем слово "отдых" и БЛИЖАЙШЕЕ по
// расстоянию знаковое число в окне вокруг него (до и после), а не жёсткий шаблон в одну сторону,
// иначе часть формулировок не распознаётся. Игрок включает/выключает эффект конкретного предмета
// кнопкой (см. toggleRestMod) — не считается автоматически "надет" он или нет, т.к. это не только
// снаряжение, но и разовая еда.
function parseRestMod(name){
  if(!name) return null;
  const idx = name.search(/отдых/i);
  if(idx<0) return null;
  const windowStart = Math.max(0, idx-25);
  const windowStr = name.slice(windowStart, idx+30);
  const relIdx = idx - windowStart;
  let best = null, bestDist = Infinity;
  for(const m of windowStr.matchAll(/([+\-−]\d+)/g)){
    const dist = Math.abs(m.index - relIdx);
    if(dist < bestDist){ bestDist = dist; best = m[1]; }
  }
  return best ? parseInt(best.replace('−','-'),10) : null;
}
function toggleRestMod(category, itemId){
  if(!character) return;
  const item = character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  if(!item) return;
  item.restModActive = !item.restModActive;
  logEvent(character, `${item.restModActive?'Включён':'Выключен'} модификатор отдыха от «${item.name}».`);
  renderAll();
}
window.toggleRestMod = toggleRestMod;
function getActiveRestModSum(){
  let sum = 0;
  if(!character) return sum;
  ['on_body','pockets','backpack','tiny'].forEach(cat=>{
    (character.inventory[cat]||[]).forEach(it=>{
      if(it.restModActive){ const v = parseRestMod(it.name); if(v!=null) sum += v; }
    });
  });
  return sum;
}
// Карточки показателей защиты — по одной на каждый надетый предмет (не сводная сумма: доспехи не
// складываются друг с другом, а разный предмет может давать разную защиту разным зонам, поэтому
// честнее показать "что от чего" отдельными карточками, а не одним слитным числом). Каждая карточка:
// имя предмета, базовая "Защита N", чипы по типам урона как в тексте книги (см. ARMOR_SUBTYPE_COLORS),
// СИЗ, и — если в тексте отдельно указана защита шлема поверх основного числа — отдельная строка
// "Голова отдельно", чтобы её не путали с общим числом брони (см. parseArmorStats).
function armorStatCardHtml(item){
  const stats = parseArmorStats(item.name);
  if(!stats) return '';
  const shortName = escapeHtml(item.name.split(' — ')[0].trim());
  const chips = stats.subs.map(s=>armorSubChipHtml(s)).join('')
    + (stats.siz ? `<span class="armor-stat-chip armor-stat-chip--siz">СИЗ${stats.siz===true?'':' '+stats.siz}</span>` : '');
  let helmetLine = '';
  if(stats.helmet){
    const h = stats.helmet;
    const val = h.mode==='abs' ? `Защита ${h.value}` : `${h.value>=0?'+':''}${h.value} к базовой`;
    const hsubs = h.mode==='abs' && h.subs.length ? ' ' + h.subs.map(s=>armorSubChipHtml(s)).join('') : '';
    helmetLine = `<div class="armor-stat-helmet">🪖 Голова отдельно: ${val}${hsubs}</div>`;
  }
  const zonesLabel = item.wornZones.map(z=>ARMOR_ZONE_LABELS[z]).join(', ');
  return `<div class="armor-stat-card">
    <div class="armor-stat-head"><b>${shortName}</b><span class="armor-stat-base">Защита ${stats.base}</span></div>
    <div class="armor-stat-zones">${zonesLabel}</div>
    ${chips ? `<div class="armor-stat-chips">${chips}</div>` : ''}
    ${helmetLine}
  </div>`;
}
