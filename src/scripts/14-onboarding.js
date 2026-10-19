/* ======================================================================
   ОБУЧЕНИЕ — экскурсии и пошаговые обучения по главам (игрок / Мастер) и одноразовые подсказки «впервые здесь».
   Ничего не блокирует: подсветка не перехватывает клики, можно сразу делать то, о чём говорит шаг (шаг
   «нажмите…» сам перейдёт дальше). «Сделать за меня» выполняет действие шага, «Закончить» — на любом шаге.
   Безопасность: обучение, которое создаёт персонажей, сначала запоминает текущего персонажа и настройки создания
   и в конце предлагает его вернуть; главы на игровом столе идут на временном (учебном) столе — настоящий
   откладывается и возвращается после обучения, игроки учебный стол не видят.
   Кнопка «ЧЗХ❓❓❓» — в строке вкладок, а на игровом столе и в редакторе карт — в их верхней строке.
   ====================================================================== */
const Onboarding = (function(){
  const KEY = 'reincarnator_onboarding_v1';
  let st = (function(){ try{ return Object.assign({seen:false, done:{}, hints:{}, hintsOff:false}, JSON.parse(localStorage.getItem(KEY) || '{}')); }catch(e){ return {seen:false, done:{}, hints:{}, hintsOff:false}; } })();
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} }
  const $ = (s)=>s==null ? null : typeof s==='function' ? s() : document.querySelector(s);
  const T = (touch, mouse)=>IS_TOUCH_UI ? touch : mouse;
  const panelOf = (sel)=>()=>{ const e = document.querySelector(sel); return e ? (e.closest('.panel') || e) : null; };
  const fieldOf = (sel)=>()=>{ const e = document.querySelector(sel); return e ? (e.closest('.field') || e) : null; };
  const near = (sel, up)=>()=>{ const e = document.querySelector(sel); return e ? (e.closest(up) || e) : null; };
  const hasText = (sel)=>()=>{ const e = document.querySelector(sel); return !!(e && e.innerText.trim()); };

  /* ---------- действия «Сделать за меня» и подготовка шагов ---------- */
  const A = {
    mode(m){ if(typeof setGenMode==='function') setGenMode(m); },
    level(n){ const f = document.getElementById('fLevel'), l = document.getElementById('fLevelLock'); if(l) l.checked = true; if(f) f.value = String(n); },
    generate(){ document.getElementById('btnGenerate').click(); },
    // все ожидающие выборы — случайно (как сделал бы игрок), пока они не кончатся
    resolveAll(){ for(let k=0; k<600; k++){ const g = document.querySelector('#pendingBox .choice-btns'); if(!g) break; const bs = [...g.querySelectorAll('button')]; if(!bs.length) break; bs[Math.floor(Math.random()*bs.length)].click(); } },
    resolveItems(){ for(let k=0; k<60; k++){ const bs = [...document.querySelectorAll('#pendingItemRollsBox button')]; if(!bs.length) break; bs[Math.floor(Math.random()*bs.length)].click(); } },
    catalog(gen, cat){ const f = document.getElementById('catGenCatField'); if(!f || typeof ITEM_CATALOG==='undefined' || !ITEM_CATALOG[gen] || !ITEM_CATALOG[gen].categories[cat]) return;
      f.dataset.gen = gen; f.dataset.cat = cat; f.textContent = `${ITEM_CATALOG[gen].label} — ${ITEM_CATALOG[gen].categories[cat].label}`; if(typeof refreshCatalogItems==='function') refreshCatalogItems(); },
    sandbox(){ if(typeof GameTable!=='undefined' && GameTable.enterSandbox && !GameTable.inSandbox()){ A.calm(); GameTable.enterSandbox(); } }, // на учебный стол — без открытых панелей
    demo(){ A.sandbox(); if(typeof GameTable!=='undefined' && GameTable.sandboxDemo) GameTable.sandboxDemo(); },
    combat(){ A.sandbox(); if(typeof GameTable!=='undefined' && GameTable.sandboxCombat) GameTable.sandboxCombat(); },
    dock(on){ if(typeof Bestiary!=='undefined') Bestiary.toggleDock(on); },
    calm(){ if(typeof Bestiary!=='undefined'){ Bestiary.closeFloat(); if(Bestiary.dockOpen) Bestiary.toggleDock(false); } }, // карточка и панель существ не закрывают трекер
    soundSec(k){ const b = document.querySelector(`#soundTabView [data-sec="${k}"]`); if(b) b.click(); }
  };
  const tokEl = (kind)=>()=>{ const s = typeof GameTable!=='undefined' && GameTable.state; if(!s) return null;
    const t = Object.values(s.tokens).find(x=>kind==='player' ? x.kind==='player' : !!x.creature); return t ? document.querySelector(`.gt-token[data-id="${t.id}"]`) : null; };

  /* ---------- главы ---------- */
  const CH = {
    // --- игрок ---
    'p-intro':{title:'Начало', steps:[
      {title:'Обучение игрока', text:'Создадим персонажа 5 уровня тремя способами — от «всё решают кости» до «всё решаю я», поработаем с каталогом, бросками, учебным игровым столом и звуком. Закончить можно на любом шаге. Ваш текущий персонаж запомнен — в конце его можно вернуть.'}]},
    'p-random':{title:'Быстро: случайный режим', steps:[
      {tab:'sheet', sel:'#btnMode', before:()=>A.mode('random'), title:'Режим «случайный»', text:'Кости решают всё, кроме выборов «по отыгрышу» — их делаете вы. Самый быстрый путь к персонажу. Режим выбирается из меню этой кнопки и запоминается.'},
      {tab:'sheet', sel:fieldOf('#fLevel'), before:()=>A.level(5), title:'Уровень при создании', text:'Отметьте 🔒 у поля «Уровень» и выберите его — генерация сразу создаст персонажа этого уровня со всеми бонусами и стартовым снаряжением. Мы выставили 5.'},
      {tab:'sheet', sel:'#btnGenerate', click:true, doIt:A.generate, title:'Создайте персонажа', text:'Нажмите «Сгенерировать персонажа».'},
      {tab:'sheet', sel:'#pendingBox', need:hasText('#pendingBox .choice-btns'), doIt:A.resolveAll, title:'Выборы по отыгрышу', text:'Эти решения правила оставляют игроку — выберите по характеру персонажа. Пока они не сделаны, повышение уровня ждёт. «Сделать за меня» выберет случайно.'},
      {tab:'sheet', sel:panelOf('#statsBody'), title:'Характеристики', text:T('Значение и Бросок (значение + 10). Тап по строке — бросок; в окне броска «ⓘ Откуда бонусы».', 'Значение и Бросок (значение + 10). Наведите на строку — увидите, откуда бонусы; нажмите — бросок.')},
      {tab:'sheet', sel:panelOf('#abilitiesBox'), title:'Способности', text:'Всё, что дали архетип, карьера и происхождение. У способностей «раз в день» отмечайте «потрачено» — «↺ Сбросить все» после отдыха.'},
      {tab:'sheet', sel:near('#invOnBody', '.grid'), title:'Инвентарь', text:'Стартовое снаряжение по уровню уже здесь: на теле, в карманах, в рюкзаке, мелочи. Вес и вместимость считаются сами.'},
      {tab:'sheet', sel:'#btnPlayMode', click:true, doIt:()=>PlayMode.set(true), title:'Режим «Игра»', text:'Персонаж готов — переключите лист в режим «Игра» кнопкой с d20: останется только нужное за столом. Включённая кнопка горит красным.'},
      {tab:'sheet', play:true, sel:'#playBar', title:'Полоска персонажа', text:'Закреплена сверху: −/+ меняют ОЗ, пси и удачу, нажатие на состояние включает его. Ещё нажатие на d20 — полный лист (дальше обучение вернёт его само).'}]},
    'p-random2':{title:'Мгновенно: случайный⚡', steps:[
      {tab:'sheet', sel:'#btnMode', before:()=>A.mode('random2'), title:'Режим «случайный⚡»', text:'Как «случайный», но и выборы по отыгрышу делают кости — персонаж готов за одно нажатие. Удобно для NPC и быстрых проб.'},
      {tab:'sheet', sel:'#btnGenerate', before:()=>A.level(5), click:true, doIt:A.generate, title:'Ещё раз', text:'Нажмите «Сгенерировать» — 5 уровень (замок 🔒 стоит), ни одного вопроса.'},
      {tab:'sheet', sel:panelOf('#progressionBox'), title:'Прогрессия', text:'Что дал каждый уровень. Отсюда видно, откуда у персонажа его бонусы.'}]},
    'p-manual':{title:'Всё сам: ручной режим', steps:[
      {tab:'sheet', sel:'#btnMode', before:()=>A.mode('manual'), title:'Режим «ручной»', text:'Все выборы ваши: распределение очков, бонусы, способности, снаряжение — при создании и при каждом повышении уровня.'},
      {tab:'sheet', sel:'#btnGenerate', before:()=>A.level(5), click:true, doIt:A.generate, title:'Создайте персонажа', text:'Нажмите «Сгенерировать» — сначала появятся выборы создания.'},
      {tab:'sheet', sel:fieldOf('#fLevel'), need:hasText('#levelProgress'), title:'Прогресс уровня', text:'Строка под уровнем: до какого уровня идёт повышение. Уровни повышаются по одному, когда сделаны выборы текущего.'},
      {tab:'sheet', sel:'#pendingBox', need:hasText('#pendingBox .choice-btns'), doIt:A.resolveAll, title:'Ваши решения', text:'Каждое решение — кнопкой. Сделайте несколько сами, а остальные можно доверить «Сделать за меня» (выберет случайно, до 5 уровня).'},
      {tab:'sheet', sel:'#pendingItemRollsBox', need:hasText('#pendingItemRollsBox'), doIt:A.resolveItems, title:'Снаряжение по таблице', text:'Вместо броска по таблице снаряжения — выбор. Повышению уровня это не мешает.'},
      {tab:'sheet', sel:'#btnUndo', title:'Отменить', text:'Ошиблись с выбором — «↶ Отменить» (Ctrl+Z) вернёт предыдущий шаг.'}]},
    'p-catalog':{title:'Каталог и покупки', steps:[
      {tab:'sheet', sel:'.identity-row', title:'Нестандартная генерация', text:'Выберите архетип, подтип, карьеру или происхождение и отметьте 🔒 — генерация подставит их, а остальное решат кости или вы. Так собирается персонаж под задумку.'},
      {tab:'sheet', sel:'#catGenCatField', doIt:()=>A.catalog('svalka', 'weapons'), title:'Каталог книги', text:T('Поколение (Хлам, Свалка, Княжества, Земли Страха) и категория: тап — выбор, ещё тап — нужная категория.', 'Поколение (Хлам, Свалка, Княжества, Земли Страха) и категория: нажмите и выберите (можно нажать и протянуть).') + ' «Сделать за меня» откроет «Свалка — оружие».'},
      {tab:'sheet', sel:fieldOf('#catItemSelect'), title:'Предмет', text:'Список с ценой и доступностью, под ним — описание и вес выбранного.'},
      {tab:'sheet', sel:'#btnBuyFromCatalog', click:true, doIt:()=>document.getElementById('btnBuyFromCatalog').click(), title:'Купить', text:'«💰 Купить» — предмет в инвентарь, цена — с кредитов. Не хватает — предупредим и предложим взять без оплаты. Цена и остаток — под списком.'},
      {tab:'sheet', sel:'#btnAddFromCatalog', title:'Получить без оплаты', text:'«+ Добавить» — находка, подарок, трофей: в инвентарь, кредиты не трогает.'},
      {tab:'sheet', sel:near('#fCredits', '.item-line'), title:'Кредиты', text:'Остаток денег: покупки списываются сами, награды и находки впишите сюда.'},
      {tab:'sheet', sel:'[data-inv="backpack"]', title:'Своё, не из каталога', text:'«+ Добавить предмет» — вписать любую вещь в нужный раздел инвентаря.'},
      {tab:'sheet', sel:panelOf('#weaponsBox'), title:'Оружие в руки', text:'У оружия в инвентаре — «⚔ Экипировать»: оно встанет в слот атаки, и броски атаки готовы.'}]},
    'p-rolls':{title:'Броски', steps:[
      {tab:'sheet', sel:'#statsBody .stat-row', title:'Бросок характеристики', text:T('Тап по строке — гексы модификаторов; кнопки «Помеха / Чистый / Преимущество»; тап по гексу — бросок к20.', 'Нажмите на строку и, не отпуская, потяните к гексу модификатора — отпустите, и кость брошена. Увести курсор за левый/правый край окна — Помеха/Преимущество.')},
      {tab:'sheet', sel:'#diceFab', title:'Просто кости', text:'Быстрые к4–к20 без привязки к листу — для урона, таблиц, чего угодно.'},
      {tab:'sheet', sel:()=>{ const e = document.getElementById('hpValue'); return e ? (e.closest('.panel') || e) : null; }, title:'ОЗ, пси и состояния', text:'Меняйте ОЗ и пси прямо в полях («−3», «+2» или число), отмечайте бодрость, испуг, истощение.'}]},
    'p-table':{title:'Учебный игровой стол', steps:[
      {tab:'table', before:A.sandbox, sel:'#gtToolbar', title:'Учебный стол', text:'Это временный стол для обучения: настоящий отложен и вернётся после обучения, никто его не видит.'},
      {tab:'table', sel:'#gtToolbar [data-act="my-token"]', doIt:A.demo, title:'Мой жетон', text:'Ставит вашего персонажа на поле. «Сделать за меня» поставит и вас, и учебного противника.'},
      {tab:'table', before:A.demo, sel:tokEl('player'), title:'Ваш жетон', text:T('Перетащите пальцем — ход. Тап — выделить, второй тап — меню: атака с карты, перемещение.', 'Перетащите мышью — ход. Правый клик — меню: атака с карты, перемещение. Под жетоном — ОЗ и пси из листа.')},
      {tab:'table', sel:'#gtToolbar [data-tool="pan"]', title:'Рука', text:T('Двигать поле — инструмент «Рука» или двумя пальцами; щипок — масштаб.', 'Двигать поле: «Рука» (H), пробел + перетаскивание или средняя кнопка; колесо — масштаб.')},
      {tab:'table', sel:'#gtToolbar [data-tool="ruler"]', title:'Измерение', text:'Протяните — расстояние в метрах (клетка — 3 м); клик без протягивания — по точкам.'},
      {tab:'table', sel:'#gtToolbar [data-tool="ping"]', title:'Ping', text:'Показать точку на поле всем (G или Alt+клик).'},
      {tab:'table', sel:'#gtZoombar', title:'Масштаб', text:'Приблизить, отдалить, «показать все жетоны»; ⇅ — как работает прокрутка (авто / мышь / тачпад).'},
      {tab:'table', sel:()=>{ const t = document.getElementById('gtLogToggle'); return t && t.offsetWidth ? t : document.querySelector('.gt-logdock'); }, title:'Лог бросков', text:'Все броски сессии — у всех одинаковые, с итогами атак с карты.'},
      {tab:'table', doIt:A.combat, sel:'#gtToolbar', need:()=>!(typeof GameTable!=='undefined' && GameTable.state && GameTable.state.combat), title:'Бой', text:'Бой ведёт Мастер. «Сделать за меня» начнёт учебный бой с противником.'},
      {tab:'table', before:A.combat, sel:'#gtCombat', title:'Трекер боя', text:'Стороны ходят по очереди. Отмечайте «Д» (действие) и «Р» (реакция) у своего персонажа; когда ход вашей стороны — придёт сигнал.'}]},
    'p-sound':{title:'Звук и громкость', steps:[
      {tab:'sound', sel:'#soundTabView .sb-mixer', title:'Громкость — своя', text:'Музыка, атмосфера, эффекты — ползунки только у вас. Звук включает Мастер, у вас он играет сам.'},
      {tab:'sound', sel:'#soundTabView .sb-mute-all', title:'Заглушить всё', text:'Тишина у вас — на других не влияет.'},
      {tab:'sound', sel:'#sbUnlock', optional:true, title:'Если звука нет', text:'Браузер не даёт играть звук без нажатия — нажмите «🔊 Включить звук».'}]},
    'p-saves':{title:'Сохранения', steps:[
      {tab:'sheet', sel:'#btnSaveAs', title:'Сохранить как…', text:'Слот в этом браузере под вашим именем. Лист ещё и сам сохраняется при каждом изменении.'},
      {tab:'sheet', sel:'#btnExportFile', title:'Экспорт в файл', text:'Файл персонажа — для другого устройства или резервной копии; «Импорт из файла» — обратно.'},
      {tab:'sheet', sel:'#savesPanel', title:'Сохранения', text:'Загрузить или удалить сохранённых персонажей.'},
      {sel:'.chzh-btn', title:'Готово!', text:'Любую главу можно повторить из «ЧЗХ❓❓❓». Удачной игры!'}]},
    // --- Мастер ---
    'g-session':{title:'Сессия и игроки', steps:[
      {tab:'sheet', sel:'#sessionSetup', optional:true, title:'Стол Мастера', text:'Введите имя и нажмите «Я — Мастер»: появится ваш стол со своей ссылкой (код из 6 символов в конце адреса). Её и отправляйте игрокам — у каждой группы свой стол, они не пересекаются. Мастером стола можно войти только из этого браузера.'},
      {tab:'sheet', sel:'#btnCopyRoomLink', optional:true, title:'Ссылка на стол', text:'«⧉ Ссылка для игроков» копирует адрес вашего стола — отправьте его в чат группы. Игроки открывают ссылку и нажимают «Я — игрок».'},
      {tab:'sheet', sel:'#sessionPlayersBox', optional:true, title:'Игроки', text:'Подключившиеся игроки: «Править лист» открывает их лист у вас, «🍀+1» выдаёт удачу.'},
      {tab:'sheet', sel:'#btnRoomJoin', optional:true, title:'Голос и видео', text:'Комната со связью прямо в браузере — без сторонних программ.'},
      {sel:'.chzh-btn', title:'Подготовка', text:'В «ЧЗХ❓❓❓» → «Мастеру» — чек-лист подготовки к игре, памятка и советы по ситуации.'}]},
    'g-screen':{title:'Экран Мастера', steps:[
      {tab:'table', before:()=>GmScreen.close(), sel:'#gmFab', doIt:()=>GmScreen.open('players'), click:true, title:'Экран Мастера', text:'Капля у правого края (кубы — у левого): игроки, сцены и заметки — на любой вкладке. Поднесите к ней курсор или нажмите. ✥ в панели — перетащить к любому краю, булавка — капли ползают по краям.'},
      {before:()=>GmScreen.open('players'), sel:'#gmScreen', title:'Игроки', text:'Все подключённые игроки разом: ОЗ и пси полосками, удача, опыт, состояния. 🍀+1, ✎ лист, ⛏ находка, 📍 — найти жетон на столе.'},
      {before:()=>GmScreen.open('scenes'), sel:()=>document.querySelector('#gmScreen [data-s="save"]') || document.querySelector('#gmScreen .gs-body'), title:'Сцены', text:'Подготовили стол — «Сохранить стол как сцену»: карта, жетоны NPC, рисунки и, если отметить, звук. Во время игры «▶ Включить» — и всё на столе, жетоны игроков остаются.'},
      {before:()=>GmScreen.open('scenes'), sel:'#gmScreen [data-s="draft"]', optional:true, title:'Черновой стол', text:'Собрать следующую сцену прямо во время игры: пустой стол, который игроки не видят. Собрали — «Сохранить», и вы снова за настоящим столом.'},
      {before:()=>GmScreen.open('notes'), sel:'#gmScreen', title:'Заметки', text:'План встречи, NPC, ловушки. «Взлом замка 4(14)» становится броском — нажмите и протяните, как в бестиарии; «2к6+1» — бросок костей. Видно только вам.'},
      {before:()=>GmScreen.open('reactions'), sel:'#gmScreen', title:'Реакции', text:'Анимации на жетонах: жетон ненадолго вырастает кругом и показывает её внутри — у всех за столом. Встроенный набор уже назначен на события: нат. 12 — «Крит!», нат. 13 — «Провал!», травма, «повержен», удача, инициатива, бой, уровень. Включайте и выключайте события, добавляйте свои гифки и ролики, решайте, могут ли игроки показывать реакции сами.'},
      {before:()=>GmScreen.close(), sel:'#gmFab', title:'Готово', text:'Esc или ✕ — закрыть экран. Сцены и заметки можно перенести на другое устройство: «⬇ Подготовка в файл».'}]},
    'g-xp':{title:'Начисление опыта', steps:[
      {tab:'xp', sel:'#xpChecklistMinor', title:'Деяния', text:'Отметка начисляет опыт сразу всем подключённым игрокам (+1 за пункт); снятая — отменяет. Игроки видят отметки, но ставить их не могут.'},
      {tab:'xp', sel:'#xpChecklistMajor', title:'Большая пятёрка', text:'Главные достижения встречи — по +2 опыта.'},
      {tab:'xp', sel:'#btnXpReset', title:'Новая встреча', text:'Снимает отметки перед следующей встречей — уже начисленный опыт остаётся.'}]},
    'g-table':{title:'Игровой стол', steps:[
      {tab:'table', before:A.sandbox, sel:'#gtToolbar', title:'Учебный стол', text:'Временный стол для обучения: настоящий отложен и вернётся после обучения, игроки ничего не видят.'},
      {tab:'table', sel:'#gtToolbar [data-tool="token"]', title:'Жетон', text:'Клик по полю — новый NPC: имя, ОЗ, размер, оружие и броня из каталога, «скрыт от игроков».'},
      {tab:'table', sel:'#gtToolbar [data-tool="draw"]', title:'Рисование и текст', text:'Карандаш, линии, стрелки, фигуры, ластик; рядом — «Текст». Всё видно игрокам.'},
      {tab:'table', sel:'#gtToolbar [data-act="more"]', title:'Ещё', text:'Фон карты по ссылке, карта из редактора, стереть рисунки, очистить стол.'},
      {tab:'table', sel:'#gtToolbar [data-act="bestiary"]', doIt:()=>A.dock(true), title:'Бестиарий на столе', text:'Панель существ: перетащите на поле или «＋» — в центр. «Сделать за меня» откроет панель.'},
      {tab:'table', before:A.demo, sel:tokEl('creature'), doIt:()=>{ const e = tokEl('creature')(); if(e && typeof Bestiary!=='undefined') Bestiary.openFloat(e.dataset.id); }, title:'Жетон существа', text:T('Двойной тап', 'Двойной клик') + ' — живая карточка: ОЗ, травмы, броски по клику на числа, оружие ⚔, снаряжение по кости. Игроки видят только имя.'},
      {tab:'table', sel:'.bst-float', optional:true, title:'Карточка существа', text:'«+ Из каталога книги» — добавить предмет; ⚔ у оружия — атаковать с карты; «🎲 Ход по кости» — у существ с ходами.'},
      {tab:'table', sel:'#gtToolbar [data-act="gm-advice"]', title:'Советы', text:'Чек-лист подготовки и памятка Мастера — под рукой во время игры.'}]},
    'g-combat':{title:'Бой', steps:[
      {tab:'table', before:()=>{ A.calm(); A.demo(); }, sel:'#gtToolbar [data-act="combat"]', doIt:A.combat, title:'Начать бой', text:'Стороны, кто начал, ход сюрприза — и проверка инициативы за всех. «Сделать за меня» начнёт учебный бой.'},
      {tab:'table', before:A.combat, sel:'#gtCombat', title:'Трекер', text:'Ходит сторона целиком. Провалившие инициативу — «без действия» в этом круге. «Д», «Р», «⇄» — действие, реакция, обмен.'},
      {tab:'table', sel:'#gtCombat [data-cbh="next"]', title:'Передать ход', text:'После последней стороны — новый круг: сброс отметок, эффекты ⏳ и горение 🔥 уменьшаются, напоминания «в начале круга».'},
      {tab:'table', sel:'#gtCombat [data-cbh="scene"]', title:'Смена сцены', text:'Обрушилась крыша, вмешалась третья сторона — заново проверка инициативы.'},
      {tab:'table', sel:'#gtCombat [data-cbh="end"]', title:'Завершить', text:'Итог боя — в лог. Эффекты на N кругов — в меню жетона.'}]},
    'g-bestiary':{title:'Бестиарий', steps:[
      {tab:'bestiary', sel:'.bst-side', title:'Библиотека', text:'Поиск, группы по разделам книги: Свалка, Феодальные княжества, Пустоты.'},
      {tab:'bestiary', sel:'.bst-main .bst-card', title:'Карточка', text:'Как в книге. Клик по числу в скобках — бросок тем же жестом, что в листе; броски видите только вы, пока не включите «видны игрокам».'},
      {tab:'bestiary', sel:'[data-m="edit"]', title:'Конструктор', text:'Изменить существо или создать своё («+ Существо»); встроенное сохранится вашей версией.'},
      {tab:'bestiary', sel:'[data-m="quick"]', title:'Быстрый противник', text:'Враг без статов: ОЗ и помеха 3/6 на броски против него — для неважных встреч.'},
      {tab:'bestiary', sel:'.bst-side .bst-gen', optional:true, title:'Случайная пустота', text:'Генератор по правилам книги: размер, облик, грех, 3 хода.'},
      {tab:'bestiary', sel:'[data-m="place"]', title:'На стол', text:'Ставит существо жетоном в центр игрового стола.'}]},
    'g-maps':{title:'Редактор карт', steps:[
      {tab:'maps', sel:'.me-topline [data-act="new"]', title:'Карты', text:'«Новая», «Открыть…» (библиотека этого браузера), «Сохранить» — карта ещё и сама сохраняется.'},
      {tab:'maps', sel:'.me-topline [data-act="gen"]', title:'Генерация', text:'Квартал, бункер, лагерь и другое — с параметрами и зерном; отдельное здание или комнату можно перегенерировать.'},
      {tab:'maps', sel:'#meTools', title:'Инструменты', text:'Выбор, рука, стены, пол, пути, объекты, текст. Подсказки по клавишам — в строке над картой.'},
      {tab:'maps', sel:'.me-side', title:'Библиотека и свойства', text:'Объекты по категориям — перетащите на карту; «Свойства» — масштаб, поворот; «Слои» и «Карта» — настройки.'},
      {tab:'maps', sel:'.me-topline [data-act="table"]', title:'На игровой стол', text:'Показать карту всем игрокам — она ляжет под жетоны.'}]},
    'g-sound':{title:'Саундпад', steps:[
      {tab:'sound', before:()=>A.soundSec('pad'), sel:'#soundTabView .sb-sections', title:'Разделы', text:'Саундпад, Музыка, Плейлисты, Мои звуки.'},
      {tab:'sound', sel:'#sbGrid', title:'Звуки', text:'Кнопка — звук у всех участников; ∞ — атмосфера (петля, нажмите ещё раз — выключить); ⭐ — в избранное.'},
      {tab:'sound', sel:'#soundTabView .sb-transport', optional:true, title:'Музыка', text:'Играть, пауза, следующий трек; «⏹ Остановить всё» — у всех.'},
      {tab:'sound', sel:'#soundTabView .sb-mixer', title:'Громкость', text:'Ползунки и «заглушить» — только у вас; у игроков свои.'},
      {tab:'sound', sel:'#soundTabView [data-sec="mine"]', title:'Мои звуки', text:'Загрузите свои звуки и музыку — файлом или по ссылке.'}]}
  };
  const TOURS = {
    'player':{title:'Краткий обзор', role:'Игрок', steps:[
      {tab:'sheet', sel:'#sessionSetup', title:'Подключение к столу', text:'Введите имя за столом и нажмите «Я — игрок» — вы подключитесь к столу Мастера (Мастер даст ссылку). Без сессии лист тоже работает.'},
      {tab:'sheet', sel:'#btnMode', title:'Режим создания', text:'«Случайный» — кости решают всё, кроме выборов по отыгрышу; «ручной» — все выборы ваши. Режим запоминается.'},
      {tab:'sheet', sel:'#btnGenerate', title:'Создание', text:'«Сгенерировать персонажа». Чтобы начать не с 1 уровня, отметьте 🔒 у поля «Уровень» и выберите его.'},
      {tab:'sheet', sel:panelOf('#statsBody'), title:'Броски', text:T('Тап по характеристике — гексы, тап по гексу — бросок.', 'Нажмите на характеристику и потяните к гексу модификатора.')},
      {tab:'sheet', sel:'#btnPlayMode', title:'Режим «Игра»', text:'Кнопка с d20: компактный лист для игры за столом и полоска ОЗ/пси/удачи. Горит красным — включён.'},
      {tab:'sheet', sel:'#tabBtnTable', title:'Игровой стол', text:'«Мой жетон», атака с карты из меню жетона, трекер боя.'},
      {sel:'.chzh-btn', title:'Подробнее', text:'«🎓 Полное обучение» в этом меню проведёт по всему — по шагам.'}]},
    'gm':{title:'Краткий обзор', role:'Мастер', steps:[
      {tab:'sheet', sel:'#sessionSetup', title:'Стол Мастера', text:'«Я — Мастер» создаёт ваш стол со своей ссылкой для игроков.'},
      {tab:'sheet', sel:'#gmFab', title:'Экран Мастера', text:'Капля справа: игроки (ОЗ, пси, удача), готовые сцены одной кнопкой и заметки с бросками.'},
      {tab:'sheet', sel:'#tabBtnXp', title:'Опыт', text:'Отметки после встречи — опыт всем сразу.'},
      {tab:'sheet', sel:'#tabBtnTable', title:'Стол', text:'Жетоны, рисование, бестиарий, бой.'},
      {tab:'sheet', sel:'#tabBtnBestiary', title:'Бестиарий', text:'Существа книги, конструктор, случайная пустота.'},
      {tab:'sheet', sel:'#tabBtnMaps', title:'Карты', text:'Генерация и рисование локаций.'},
      {tab:'sheet', sel:'#tabBtnSound', title:'Звук', text:'Музыка и звуки для всех.'},
      {sel:'.chzh-btn', title:'Подробнее', text:'«🎓 Полное обучение» и главы по вкладкам — в этом меню.'}]}
  };
  const P_CH = ['p-random', 'p-random2', 'p-manual', 'p-catalog', 'p-rolls', 'p-table', 'p-sound', 'p-saves'];
  const G_CH = ['g-session', 'g-screen', 'g-xp', 'g-table', 'g-combat', 'g-bestiary', 'g-maps', 'g-sound'];
  const CHAR_CH = ['p-random', 'p-random2', 'p-manual', 'p-catalog', 'p-rolls'];
  function buildTour(id){
    if(TOURS[id]) return Object.assign({id}, TOURS[id], {steps:TOURS[id].steps.map(s=>Object.assign({chapter:TOURS[id].title}, s))});
    const ids = id==='p-full' ? ['p-intro'].concat(P_CH) : id==='g-full' ? G_CH : [id];
    if(!ids.every(k=>CH[k])) return null;
    const steps = []; ids.forEach(k=>CH[k].steps.forEach(s=>steps.push(Object.assign({chapter:CH[k].title}, s))));
    return {id, role:id[0]==='g' ? 'Мастер' : 'Игрок', steps, usesChar:ids.some(k=>CHAR_CH.indexOf(k)>=0)};
  }
  const HINTS = {
    table: IS_TOUCH_UI ? 'Игровой стол: тап по жетону — выделить, ещё тап — его меню; два пальца — масштаб и сдвиг поля.'
      : 'Игровой стол: правый клик по жетону — меню, колесо — масштаб, «Рука» (H) или пробел+перетаскивание — сдвиг поля.',
    bestiary:'Бестиарий: клик по числу в скобках — бросок; «⬇ На стол» ставит существо жетоном.',
    maps:'Редактор карт: «Генерация…» соберёт местность за вас, «На игровой стол» покажет карту всем игрокам.',
    sound:'Саундпад: звуки и музыку слышат все участники сессии.',
    xp:'Начисление опыта: отметки ставит Мастер, у игрока опыт обновится сам.'
  };

  /* ---------- снимок персонажа (вернуть после обучения; переживает и перезагрузку страницы посреди обучения) ---------- */
  const SNAP_KEY = 'reincarnator_onboarding_snapshot_v1';
  let snap = null;
  function takeSnapshot(){
    if(typeof buildSavePayload!=='function') return null;
    const f = document.getElementById('fLevel'), l = document.getElementById('fLevelLock');
    const s = {payload:character ? JSON.parse(JSON.stringify(buildSavePayload())) : null, mode:typeof currentGenMode==='function' ? currentGenMode() : null, level:f && f.value, lock:l && l.checked};
    try{ localStorage.setItem(SNAP_KEY, JSON.stringify(s)); }catch(e){}
    return s;
  }
  function settleSnapshot(){
    const s = snap; snap = null; try{ localStorage.removeItem(SNAP_KEY); }catch(e){}
    if(!s) return;
    if(s.mode) A.mode(s.mode);
    const f = document.getElementById('fLevel'), l = document.getElementById('fLevelLock');
    if(l) l.checked = !!s.lock;
    if(!s.payload){
      if(!character) return;
      const el0 = bubble(`<div class="ob-title">Персонаж</div><div class="ob-text">До обучения лист был пустым. Оставить учебного персонажа или очистить лист?</div>
        <div class="ob-btns"><button type="button" class="small" data-r="clear">Очистить лист</button><button type="button" class="small primary" data-r="keep">Оставить</button></div>`, 'ob-welcome');
      el0.addEventListener('click', (e)=>{ const b = e.target.closest('[data-r]'); if(!b) return; el0.remove();
        if(b.dataset.r==='clear') document.getElementById('btnReset').click(); else if(f) f.value = character.level; });
      return; }
    const el = bubble(`<div class="ob-title">Персонаж</div><div class="ob-text">Вернуть персонажа, который был до обучения, или оставить учебного?</div>
      <div class="ob-btns"><button type="button" class="small primary" data-r="back">Вернуть прежнего</button><button type="button" class="small" data-r="keep">Оставить учебного</button></div>`, 'ob-welcome');
    el.addEventListener('click', (e)=>{ const b = e.target.closest('[data-r]'); if(!b) return; el.remove();
      if(b.dataset.r==='back' && typeof applyLoadedPayload==='function'){ applyLoadedPayload(s.payload); toastLine('Прежний персонаж возвращён.'); }
      else if(f && character) f.value = character.level; });
  }

  /* ---------- оформление ---------- */
  let ring = null, card = null, tour = null, idx = 0, target = null, raf = 0, clickHook = null, goTimer = 0, dockWas = null, playWas = null, gsWas = null;
  function els(){
    if(ring) return;
    ring = document.createElement('div'); ring.className = 'ob-ring'; document.body.appendChild(ring);
    card = document.createElement('div'); card.className = 'ob-card'; document.body.appendChild(card);
    card.addEventListener('click', (e)=>{ const b = e.target.closest('[data-ob]'); if(!b || !tour) return;
      const a = b.dataset.ob;
      if(a==='next') go(idx + 1, 1); else if(a==='prev') go(idx - 1, -1); else if(a==='close') stop();
      else if(a==='do'){ const at = idx, s = tour.steps[at]; // шаг «нажмите…» может перейти дальше и сам — не перескочить через следующий
        try{ s.doIt && s.doIt(); }catch(err){ console.warn('[Обучение]', err); } setTimeout(()=>{ if(tour && idx===at) go(at + 1, 1); }, 500); }
      else if(a==='mini'){ card.classList.toggle('ob-mini'); schedule(); } });
    window.addEventListener('resize', ()=>schedule()); window.addEventListener('scroll', ()=>schedule(), true);
    setInterval(()=>{ if(tour && target) schedule(); }, 400); // подсвеченный жетон двигается вместе с камерой стола
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && tour) stop(); });
  }
  function currentTab(){ return typeof MAIN_TABS==='undefined' ? 'sheet' : (Object.keys(MAIN_TABS).find(k=>{ const v = document.getElementById(MAIN_TABS[k][0]); return v && v.style.display!=='none'; }) || 'sheet'); }
  function shown(el){ if(!el) return false; const r = el.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=='hidden'; }
  function start(id){
    const t = buildTour(id); if(!t) return;
    if(typeof GameTable!=='undefined' && GameTable.inSandbox && GameTable.inSandbox()==='draft'){
      uiAlert('Сейчас открыт черновой стол сцены. Сохраните его или выйдите (экран Мастера → «Сцены»), затем запустите обучение.', {title:'Обучение', icon:'✎'}); return; }
    if(tour){ const keep = snap; snap = null; stop(true); snap = keep; } // переход в другую главу: снимок прежнего персонажа и режим листа — дальше с нами
    els(); closeMenu(); hideHint();
    tour = t; if(t.usesChar && !snap) snap = takeSnapshot();
    dockWas = typeof Bestiary!=='undefined' ? Bestiary.dockOpen : null; // панель существ после обучения — как была
    if(playWas===null && typeof PlayMode!=='undefined') playWas = PlayMode.on; // и режим «Игра» — тоже
    if(gsWas===null && typeof GmScreen!=='undefined') gsWas = GmScreen.isOpen;
    go(0, 1);
  }
  function go(i, dir){
    if(!tour) return;
    const steps = tour.steps; dir = dir || 1;
    if(i<0){ i = 0; dir = 1; }
    if(i>=steps.length){ st.done[tour.id] = true; save(); stop(); toastLine('Обучение пройдено. Любую главу можно повторить из «ЧЗХ❓❓❓».'); return; }
    idx = i; const s = steps[i];
    // учебный стол живёт только пока идут шаги на столе
    if(s.tab && s.tab!=='table' && typeof GameTable!=='undefined' && GameTable.inSandbox && GameTable.inSandbox()==='tutorial') GameTable.exitSandbox();
    if(s.tab && currentTab()!==s.tab && typeof toggleMainTab==='function') toggleMainTab(s.tab);
    if(typeof PlayMode!=='undefined' && (s.play || s.tab==='sheet') && PlayMode.on!==!!s.play) PlayMode.set(!!s.play, true); // шагам листа нужен полный лист, шагам «Игры» — компактный
    try{ s.before && s.before(); }catch(err){ console.warn('[Обучение]', err); }
    clearTimeout(goTimer);
    goTimer = setTimeout(()=>{
      if(!tour || idx!==i) return;
      const el = $(s.sel);
      if(s.sel!=null && (!shown(el) || (s.need && !s.need()))) return go(i + dir, dir); // шаг сейчас не к месту — дальше
      if(s.sel==null && s.need && !s.need()) return go(i + dir, dir);
      target = el || null;
      if(el) el.scrollIntoView({block:'center', inline:'nearest'});
      if(clickHook){ clickHook.el.removeEventListener('click', clickHook.fn, true); clickHook = null; }
      if(s.click && el){ const fn = ()=>setTimeout(()=>{ if(tour && idx===i) go(i + 1, 1); }, 500); el.addEventListener('click', fn, true); clickHook = {el, fn}; }
      card.classList.remove('ob-mini');
      const last = i + 1>=steps.length;
      card.innerHTML = `<div class="ob-step">${i + 1} / ${steps.length} · ${tour.role}${s.chapter ? ' · ' + s.chapter : ''}</div><div class="ob-title">${s.title}</div><div class="ob-text">${s.text}</div>
        <div class="ob-btns"><button type="button" data-ob="close" class="small" title="Закончить обучение (Esc)">Закончить</button><button type="button" data-ob="mini" class="small" title="Свернуть карточку, чтобы она ничего не закрывала">▁</button>${i>0 ? '<button type="button" data-ob="prev" class="small" title="Предыдущий шаг">←</button>' : ''}${s.doIt ? '<button type="button" data-ob="do" class="small" title="Выполнить действие этого шага и перейти дальше">Сделать за меня</button>' : ''}<button type="button" data-ob="next" class="small primary" title="Следующий шаг">${last ? 'Готово' : (s.click ? 'Пропустить →' : 'Далее →')}</button></div>`;
      ring.style.display = el ? 'block' : 'none'; card.style.display = 'block';
      schedule();
    }, (s.tab || s.before) ? 420 : 60);
  }
  function schedule(){ if(!raf) raf = requestAnimationFrame(place); }
  // Карточка шага: перебираем места вокруг подсвеченного элемента и по углам экрана и берём то, где она
  // меньше всего закрывает кнопки, поля и сам подсвеченный элемент — чтобы обучение не мешало пользоваться листом.
  function place(){
    raf = 0; if(!tour || !card || card.style.display!=='block') return;
    const W = window.innerWidth, H = window.innerHeight, cw = Math.min(330, W - 24); card.style.width = cw + 'px';
    const ch = card.offsetHeight || 140;
    if(!target){ Object.assign(card.style, {left:Math.round((W - cw)/2) + 'px', top:Math.round((H - ch)/2) + 'px'}); return; }
    const r = target.getBoundingClientRect(), pad = 6, g = 14;
    Object.assign(ring.style, {left:(r.left - pad) + 'px', top:(r.top - pad) + 'px', width:(r.width + pad*2) + 'px', height:(r.height + pad*2) + 'px'});
    const clampX = (x)=>Math.max(10, Math.min(x, W - cw - 10)), clampY = (y)=>Math.max(10, Math.min(y, H - ch - 10));
    const cands = [
      [clampX(r.left), r.bottom + g], [clampX(r.left), r.top - ch - g],
      [r.right + g, clampY(r.top)], [r.left - cw - g, clampY(r.top)],
      [W - cw - 12, H - ch - 12], [12, H - ch - 12], [W - cw - 12, 12], [12, 12]
    ].filter(([x, y])=>x>=6 && y>=6 && x + cw <= W - 6 && y + ch <= H - 6);
    const busy = [...document.querySelectorAll('button, input, select, textarea, a, .button-like, .tab-btn')].filter(el=>!card.contains(el)).map(el=>el.getBoundingClientRect())
      .filter(b=>b.width && b.height && b.bottom>0 && b.top<H);
    const over = (x, y, b)=>Math.max(0, Math.min(x + cw, b.right) - Math.max(x, b.left)) * Math.max(0, Math.min(y + ch, b.bottom) - Math.max(y, b.top));
    let best = cands[0] || [clampX(r.left), clampY(r.bottom + g)], bestScore = Infinity;
    cands.forEach(([x, y], i)=>{
      let sc = over(x, y, r) * 50; busy.forEach(b=>{ sc += over(x, y, b); });
      sc += i * 40 + Math.hypot(x + cw/2 - (r.left + r.width/2), y + ch/2 - (r.top + r.height/2)) * 0.5;
      if(sc < bestScore){ bestScore = sc; best = [x, y]; }
    });
    Object.assign(card.style, {left:best[0] + 'px', top:best[1] + 'px'});
  }
  function stop(keepPlay){
    clearTimeout(goTimer);
    const wasTour = tour; tour = null; target = null;
    if(clickHook){ clickHook.el.removeEventListener('click', clickHook.fn, true); clickHook = null; }
    if(ring){ ring.style.display = 'none'; card.style.display = 'none'; }
    if(typeof GameTable!=='undefined' && GameTable.inSandbox && GameTable.inSandbox()==='tutorial'){ GameTable.exitSandbox(); if(typeof Bestiary!=='undefined'){ Bestiary.closeFloat(); } }
    if(wasTour && gsWas===false && typeof GmScreen!=='undefined' && GmScreen.isOpen) GmScreen.close();
    if(wasTour && dockWas!==null && typeof Bestiary!=='undefined' && Bestiary.dockOpen!==dockWas) Bestiary.toggleDock(dockWas);
    if(wasTour && playWas!==null && typeof PlayMode!=='undefined' && PlayMode.on!==playWas && !keepPlay) PlayMode.set(playWas, true);
    if(!keepPlay){ playWas = null; gsWas = null; }
    if(wasTour) settleSnapshot();
  }

  /* ---------- первая встреча, подсказки «впервые здесь», короткие уведомления ---------- */
  let hintEl = null;
  function bubble(html, cls){
    const el = document.createElement('div'); el.className = 'ob-bubble' + (cls ? ' ' + cls : ''); el.innerHTML = html; document.body.appendChild(el); return el;
  }
  function welcome(){
    if(st.seen) return;
    if(document.querySelector('.join-back')){ setTimeout(welcome, 4000); return; } // сначала — экран входа за стол
    const el = bubble(`<div class="ob-title">Впервые здесь?</div><div class="ob-text">Короткий обзор — минута; полное обучение — по шагам, в «ЧЗХ❓❓❓».</div>
      <div class="ob-btns"><button type="button" class="small primary" data-w="player">Я игрок</button><button type="button" class="small primary" data-w="gm">Я Мастер</button><button type="button" class="small" data-w="later">Позже</button></div>`, 'ob-welcome');
    el.addEventListener('click', (e)=>{ const b = e.target.closest('[data-w]'); if(!b) return;
      st.seen = true; save(); el.remove(); if(b.dataset.w!=='later') start(b.dataset.w); else toastLine('Обучение — в кнопке «ЧЗХ❓❓❓».'); });
  }
  function hideHint(){ if(hintEl){ hintEl.remove(); hintEl = null; } }
  function onTab(tab){
    if(tour || st.hintsOff || !st.seen || st.hints[tab] || !HINTS[tab]) return;
    if(tab==='bestiary' && typeof session!=='undefined' && session.role==='player') return;
    st.hints[tab] = true; save(); hideHint();
    hintEl = bubble(`<div class="ob-text">💡 ${HINTS[tab]}</div><div class="ob-btns"><button type="button" class="small" data-h="ok">Понятно</button></div>`, 'ob-hint');
    hintEl.addEventListener('click', (e)=>{ if(e.target.closest('[data-h]')) hideHint(); });
    setTimeout(()=>{ if(hintEl) hideHint(); }, 12000);
  }
  function toastLine(text){ const el = bubble(`<div class="ob-text">${text}</div>`, 'ob-toast'); setTimeout(()=>el.remove(), 4500); }

  /* ---------- кнопка «ЧЗХ❓❓❓» и её меню ---------- */
  let menuEl = null;
  function closeMenu(){ if(menuEl){ menuEl.remove(); menuEl = null; } }
  const chips = (ids)=>`<div class="ob-chips">${ids.map(k=>`<button type="button" class="ob-chip${st.done[k] ? ' done' : ''}" data-m="${k}" title="Глава «${CH[k].title}»${st.done[k] ? ' — пройдена' : ''}">${st.done[k] ? '✓ ' : ''}${CH[k].title}</button>`).join('')}</div>`;
  function openMenu(btn){
    if(menuEl){ closeMenu(); return; }
    const r = btn.getBoundingClientRect(), gm = typeof GmAdvice==='undefined' || GmAdvice.isGm();
    menuEl = document.createElement('div'); menuEl.className = 'ob-menu';
    menuEl.innerHTML = `<div class="ob-menu-sep">Игроку</div>
      <button type="button" data-m="p-full"><b>🎓 Полное обучение игрока</b><span>персонаж 5 ур. в трёх режимах, каталог, броски, стол, звук — по шагам</span></button>
      <button type="button" data-m="player"><b>🧭 Краткий обзор</b><span>минута: где что находится</span></button>
      ${chips(P_CH)}` +
      (gm ? `<div class="ob-menu-sep">Мастеру</div>
      <button type="button" data-m="g-full"><b>🎓 Полное обучение Мастера</b><span>сессия, экран Мастера, опыт, стол, бой, бестиарий, карты, звук</span></button>
      <button type="button" data-m="gm"><b>🧭 Краткий обзор</b><span>минута: вкладки Мастера</span></button>
      ${chips(G_CH)}` : '') +
      `<div class="ob-menu-sep">Справка</div>
      <button type="button" data-m="keys"><b>⌨ Горячие клавиши</b><span>лист, стол, редактор карт, броски · Ctrl+/</span></button>
      <div class="ob-menu-sep">Настройки</div>
      ${typeof Pwa!=='undefined' && !Pwa.installed ? '<button type="button" data-m="install"><b>📲 Установить как приложение</b><span>значок на рабочем столе или экране телефона, работает и без сети</span></button>' : ''}
      ${typeof Theme!=='undefined' ? `<button type="button" data-m="theme"><b>🌗 Тема: ${Theme.label()}</b><span>светлая (пергамент) → тёмная (обсидиан) → как в системе</span></button>` : ''}
      <button type="button" data-m="live"><b>🔔 Броски на столе и «Ваш ход»</b><span>крупные броски поверх стола, уведомление о вашем ходе в бою</span></button>
      <button type="button" data-m="archive"><b>📜 Раздатки и итоги встреч</b><span>всё, что присылал Мастер: раздатки, итоги встреч</span></button>
      <button type="button" data-m="lite"><b>🪶 Облегчённый режим</b><span>без фактур и анимаций — для слабых телефонов</span></button>
      <button type="button" data-m="problem"><b>🐞 Сообщить о проблеме</b><span>готовый отчёт: что случилось, связь, браузер, ошибки</span></button>
      <button type="button" data-m="data"><b>💾 Данные и резервная копия</b><span>место в браузере, скачать всё одним файлом, восстановить</span></button>
      <button type="button" data-m="hints"><b>💡 Подсказки «впервые здесь»: ${st.hintsOff ? 'выкл' : 'вкл'}</b><span>одна строка при первом открытии вкладки</span></button>` +
      (typeof GmAdvice!=='undefined' && GmAdvice.isGm() ? `
      <button type="button" data-m="prep"><b>📋 Подготовка к игре</b><span>чек-лист: что собрать к встрече</span></button>
      <button type="button" data-m="memo"><b>📖 Памятка Мастера</b><span>роль Мастера, описания, 13 принципов, бой, страх</span></button>
      <button type="button" data-m="gmon"><b>${GmAdvice.settingsLabel()}</b><span>короткий совет, когда случается подходящее событие</span></button>
      <button type="button" data-m="gmfreq"><b>${GmAdvice.freqLabel()}</b><span>редко — раз в 10 мин, обычно — 5, часто — 2</span></button>` : '');
    document.body.appendChild(menuEl);
    const w = menuEl.offsetWidth;
    Object.assign(menuEl.style, {left:Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px', top:Math.max(8, Math.min(r.bottom + 6, window.innerHeight - menuEl.offsetHeight - 8)) + 'px'});
    menuEl.addEventListener('click', (e)=>{ const b = e.target.closest('[data-m]'); if(!b) return;
      const m = b.dataset.m; closeMenu();
      if(m==='hints'){ st.hintsOff = !st.hintsOff; if(!st.hintsOff) st.hints = {}; save(); toastLine(st.hintsOff ? 'Подсказки выключены.' : 'Подсказки включены — появятся при открытии вкладок.'); }
      else if(m==='keys') showKeys();
      else if(m==='live'){ if(typeof TableLive!=='undefined') TableLive.openSettings(); }
      else if(m==='archive'){ if(typeof PlayerArchive!=='undefined') PlayerArchive.openList(); }
      else if(m==='lite'){ if(typeof LiteMode!=='undefined') LiteMode.openSettings(); }
      else if(m==='problem'){ if(typeof ProblemReport!=='undefined') ProblemReport.open(); }
      else if(m==='data'){ if(typeof DataBackup!=='undefined') DataBackup.openPanel(); }
      else if(m==='theme'){ Theme.cycle(); toastLine('Тема: ' + Theme.label() + '.'); }
      else if(m==='install') Pwa.install();
      else if(m==='prep' || m==='memo') GmAdvice.openPanel(m);
      else if(m==='gmon') toastLine(GmAdvice.toggleOn() ? 'Советы Мастеру включены.' : 'Советы Мастеру выключены.');
      else if(m==='gmfreq') toastLine('Частота советов: ' + GmAdvice.cycleFreq() + '.');
      else { st.seen = true; save(); const w0 = document.querySelector('.ob-welcome'); if(w0) w0.remove(); start(m); } });
    setTimeout(()=>document.addEventListener('click', function close(ev){ if(menuEl && !menuEl.contains(ev.target) && !ev.target.closest('.chzh-btn')){ closeMenu(); } if(!menuEl) document.removeEventListener('click', close); }), 0);
  }
  /* ---------- справка по горячим клавишам ---------- */
  const KEYS = [
    ['Везде', [['Ctrl+/', 'эта справка'], ['Esc', 'закрыть окно, меню, обучение, выбор броска'], ['Enter', 'подтвердить в окне (в многострочном поле — Ctrl+Enter)']]],
    ['Лист персонажа', [['Ctrl+Z', 'отменить последнее действие'], ['нажать и протянуть', 'бросок: от характеристики к гексу модификатора'], ['за левый / правый край окна броска', 'Помеха / Преимущество'], ['Enter в поле ОЗ / пси', 'принять значение («−3», «+2» или число)']]],
    ['Игровой стол', [['V', 'выбор'], ['H', 'рука (сдвиг поля)'], ['R', 'измерение'], ['G или Alt+клик', 'ping — показать точку всем'], ['D', 'рисование (Мастер)'], ['T', 'текст (Мастер)'], ['Пробел + перетаскивание', 'сдвиг поля'], ['колесо, + / −', 'масштаб'], ['Delete', 'удалить выбранные жетоны (Мастер)'], ['Ctrl+Z / Ctrl+Y', 'отменить / вернуть рисунки и ходы'], ['Enter', 'замкнуть полигон'], ['Esc', 'снять выбор, отменить цель атаки']]],
    ['Редактор карт', [['V H B G R W P O T', 'выбор, рука, кисть, заливка, комната, стена, путь, объект, надпись'], ['Q / E', 'повернуть на 90° (с Shift — на 15°)'], ['X', 'отразить'], [', / .', 'меньше / больше (с Shift — точнее)'], ['/', 'вернуть масштаб объекта'], ['[ / ]', 'размер кисти'], ['стрелки', 'сдвинуть выбранное (с Shift — точнее)'], ['Ctrl+C / Ctrl+V / Ctrl+D', 'копировать / вставить / дублировать'], ['Ctrl+A', 'выбрать всё'], ['Ctrl+S', 'сохранить'], ['Ctrl+Z / Ctrl+Y', 'отменить / вернуть'], ['+ / − / 0', 'масштаб, вся карта'], ['Delete', 'удалить выбранное'], ['Enter', 'закончить стену / путь']]],
    ['Касание и тачпад', [['тап по выделенному жетону', 'меню жетона'], ['два пальца', 'сдвиг поля и масштаб'], ['долгое нажатие на кнопку', 'подсказка']]]
  ];
  function showKeys(){
    const html = '<div class="ui-keys">' + KEYS.map(([sec, rows])=>`<div class="ui-keys-sec">${sec}</div>` + rows.map(([k, v])=>`<div class="ui-keys-row"><span class="ui-kbd">${k}</span><span>${v}</span></div>`).join('')).join('') + '</div>' +
      '<div class="ui-keys-note">Буквы работают и в русской раскладке.</div>';
    uiDialog({title:'Горячие клавиши', icon:'⌨', html, cancelValue:null, buttons:[{label:'Понятно', value:null, primary:true}]});
  }
  document.addEventListener('keydown', (e)=>{ if((e.ctrlKey || e.metaKey) && e.code==='Slash' && !document.querySelector('.ui-dlg-back')){ e.preventDefault(); showKeys(); } });
  function makeBtn(){ const b = document.createElement('button'); b.type = 'button'; b.className = 'chzh-btn'; b.title = 'Что здесь происходит? Обучение и подсказки'; b.textContent = 'ЧЗХ❓❓❓'; return b; }
  function ensureButtons(){
    // в строке вкладок — внутри группы .tab-tail (на телефоне она переезжает в шапку), иначе прямо в строку
    const tail = document.querySelector('.tab-tail'), bar = document.getElementById('mainTabBar');
    if(tail){ if(!tail.querySelector('.chzh-btn')) tail.appendChild(makeBtn()); }
    else if(bar && !bar.querySelector('.chzh-btn')) bar.appendChild(makeBtn());
    ['.gt-topline', '.me-topline'].forEach((sel)=>{
      const host = document.querySelector(sel); if(host && !host.querySelector('.chzh-btn')) host.appendChild(makeBtn()); });
  }
  document.addEventListener('click', (e)=>{ const b = e.target.closest && e.target.closest('.chzh-btn'); if(b){ e.preventDefault(); openMenu(b); } });

  function init(){
    ensureButtons();
    let left = null; try{ left = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); }catch(e){}
    if(left){ snap = left; setTimeout(settleSnapshot, 1200); return; } // страницу перезагрузили посреди обучения
    setTimeout(welcome, 1200);
  }
  return { init, start, stop, onTab:(t)=>{ ensureButtons(); onTab(t); }, ensureButtons, busy:()=>!!tour, chapters:()=>Object.keys(CH) };
})();
try{ Onboarding.init(); }catch(e){ console.error('[Обучение] не удалось запустить', e); }
