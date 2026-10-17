/* ======================================================================
   ПОДСКАЗКИ К КНОПКАМ: задержались курсором на кнопке ~1.5 с — появляется пояснение «зачем она».
   Текст: собственный title элемента (переносится в data-tip, чтобы не всплывала ещё и системная
   подсказка) → правила ниже по id / data-атрибутам / onclick / тексту кнопки → aria-label.
   На сенсорных экранах не показываются (там нет «наведения»).
   ====================================================================== */
const Tips = (function(){
  const DELAY = 1500;
  const RULES = [
    // вкладки и шапка
    ['#tabBtnSheet', 'Лист персонажа: характеристики, способности, инвентарь, броски и сохранения'],
    ['#tabBtnXp', 'Начисление опыта после игровой встречи по пунктам книги'],
    ['#tabBtnTable', 'Общая карта сессии: жетоны, атаки с карты, трекер боя'],
    ['#tabBtnBestiary', 'Библиотека существ Мастера: карточки по книге, конструктор, жетоны на стол'],
    ['#tabBtnMaps', 'Редактор карт: генерация местности, рисование, отправка карты на стол'],
    ['#tabBtnSound', 'Музыка и звуки — их слышат все участники сессии'],
    ['.boosty-link', 'Поддержать автора книги на Boosty (откроется в новой вкладке)'],
    // сессия и связь
    ['#btnStartGM', 'Начать совместную сессию ведущим — игроки подключатся к вашему столу'],
    ['#btnStartPlayer', 'Подключиться к столу Мастера как игрок'],
    ['#btnLeaveSession', 'Отключиться от совместной сессии — лист персонажа останется у вас'],
    ['#btnRoomJoin', 'Голосовая и видеосвязь с участниками сессии прямо в браузере'],
    ['#btnRoomMic', 'Включить или выключить свой микрофон'],
    ['#btnRoomCam', 'Включить или выключить свою камеру'],
    ['#btnRoomLeave', 'Выйти из голосовой комнаты — сессия при этом продолжится'],
    ['[data-editplayer]', 'Открыть лист этого игрока для правки — изменения уйдут ему после «Отправить игроку»'],
    ['#btnSendEditedSheet', 'Отправить исправленный лист игроку'],
    ['#btnCancelEditedSheet', 'Выйти из правки чужого листа без изменений'],
    // действия с персонажем и сохранения
    ['#btnGenerate', 'Создать нового персонажа по правилам книги (прежнего можно вернуть кнопкой «Отменить»)'],
    ['#btnReset', 'Очистить лист и поля создания — начать с чистого листа'],
    ['#btnSaveAs', 'Сохранить персонажа в этом браузере под своим именем'],
    ['#btnExportFile', 'Скачать персонажа файлом .json — для другого устройства или резервной копии'],
    ['#btnImportFileLabel', 'Загрузить персонажа из файла .json'],
    ['#btnRefreshSaves', 'Перечитать список сохранений этого браузера'],
    ['[data-load]', 'Загрузить этого персонажа из сохранения (текущий лист заменится)'],
    ['[data-del]', 'Удалить это сохранение'],
    ['#btnClearHistory', 'Стереть журнал событий персонажа — на характеристики не влияет'],
    // способности, достоинства, недостатки
    ['[onclick^="resetAllAbilitySpent"]', 'Снять отметки «потрачено» со всех способностей — например, после отдыха или в новый день'],
    ['[onclick^="toggleAbilitySpent"]', 'Отметить, что способность уже использована (для «раз в день / раз во встречу»)'],
    ['[onclick^="editAbilityNote"]', 'Своя заметка к способности — для памяти'],
    ['[onclick^="editAdvantage"]', 'Изменить текст достоинства'],
    ['[onclick^="rerollAdvantage"]', 'Заменить достоинство случайным по таблице книги (к20)'],
    ['[onclick^="addAdvantageRandom"]', 'Добавить случайное достоинство по таблице книги (к20)'],
    ['[onclick^="addAdvantageCustom"]', 'Вписать своё достоинство'],
    ['[onclick^="editFlaw"]', 'Изменить текст недостатка'],
    ['[onclick^="rerollFlaw"]', 'Заменить недостаток случайным по таблице книги (к12)'],
    ['[onclick^="removeFlaw"]', 'Убрать этот недостаток'],
    ['[onclick^="addFlawRandom"]', 'Добавить случайный недостаток по таблице книги (к12)'],
    ['[onclick^="addFlawCustom"]', 'Вписать свой недостаток'],
    // инвентарь и оружие
    ['#btnAddFromCatalog', 'Положить выбранный предмет из каталога книги в инвентарь'],
    ['[data-inv]', 'Добавить в этот раздел инвентаря свой предмет'],
    ['[onclick^="equipWeapon"]', 'Взять оружие в свободный слот атаки — с ним появятся броски атаки'],
    ['[onclick^="unequipWeapon"]', 'Убрать оружие из слота атаки — в инвентаре оно останется'],
    ['[onpointerdown*="openWeaponSlotPicker"]', 'Заменить оружие в одном из слотов атаки: нажмите и потяните к нужному'],
    ['[onclick^="toggleWeaponLoaded"]', 'Отметить, заряжено ли оружие (для однозарядного и «пальбы»)'],
    ['[onclick^="rerollInventoryItem"]', 'Перебросить предмет по его таблице'],
    ['[onclick^="adjustItemUses"][onclick*=",-1)"]', 'Потратить одно использование (ПР)'],
    ['[onclick^="adjustItemUses"]', 'Добавить одно использование (ПР)'],
    ['[onclick^="toggleWearBoots"]', 'Надеть или снять обувь'],
    ['[onclick^="editInventoryItem"]', 'Изменить название и описание предмета'],
    ['[onclick^="removeInventoryItem"]', 'Выбросить предмет из инвентаря'],
    ['#zoneWearBtn', 'Надеть предмет на отмеченные зоны тела'],
    ['#zoneRemoveBtn', 'Снять предмет с тела'],
    // переброс
    ['#rerollLuckBtn', 'Потратить 1 удачу и перебросить'],
    ['#rerollBodrostBtn', 'Потратить бодрость и перебросить'],
    ['#rerollCareerBtn', 'Перебросить за счёт возможности карьеры'],
    ['.reroll-popup [data-ability]', 'Перебросить за счёт этой способности'],
    ['.reroll-popup [data-advantage]', 'Перебросить за счёт этого достоинства'],
    // выборы, ожидающие игрока
    ['#pendingBox .choice-btns button', (el)=>`Выбрать «${txt(el)}» — бонус сразу применится к персонажу`],
    ['#pendingItemRollsBox button', (el)=>`Взять «${txt(el).slice(0, 60)}» вместо случайного броска`],
    ['.gen-mode-menu [data-k]', 'Выбрать режим создания персонажа (запоминается)'],
    ['.ob-menu [data-m]', 'Запустить или настроить обучение'],
    // находки
    ['[data-loot-die]', 'Бросок находки этой костью'],
    ['[data-loot-cat]', 'Выбрать категорию находок'],
    ['[data-loot-book]', 'Бросить находку по таблицам книги'],
    ['[data-loot-give]', 'Выдать найденное выбранному персонажу'],
    ['[data-loot-restart]', 'Начать выбор находки заново'],
    // игровой стол
    ['[data-cbh="next"]', 'Сторона сходила — передать ход следующей (после последней начнётся новый круг)'],
    ['[data-cbh="end"]', 'Завершить бой — трекер закроется, итог запишется в журнал'],
    ['[data-cbh="fold"]', 'Свернуть или развернуть трекер боя'],
    ['[data-cbh="hints"]', 'Скрыть напоминания этого круга'],
    ['.gt-menu [data-mi]', (el)=>'Действие с жетоном: ' + el.textContent.trim().toLowerCase()],
    ['.gt-menu-sizes [data-size]', 'Размер жетона на поле'],
    ['#gtLogToggle', 'Показать общий лог бросков'],
    ['#gtBackToSheet, .me-topline [data-act="back"]', 'Вернуться к листу — шапка и вкладки снова появятся'],
    // бестиарий
    ['.bst-item', 'Открыть карточку этого существа'],
    ['[data-m="edit"]', 'Изменить существо в конструкторе (встроенное сохранится как ваша версия)'],
    ['[data-m="dup"]', 'Сделать копию существа, чтобы переделать под себя'],
    ['[data-m="del"]', 'Удалить своё существо из бестиария (жетоны на столе останутся)'],
    ['[data-m="new"]', 'Создать своё существо в конструкторе'],
    ['[data-m="quick"], [data-d="quick"]', 'Враг без характеристик: только ОЗ и помеха 3/6 на броски против него'],
    ['[data-m="import"]', 'Загрузить существ из файла .json'],
    ['[data-m="export"]', 'Скачать своих существ файлом .json'],
    ['[data-place], [data-d2="place"]', 'Поставить существо жетоном в центр игрового стола'],
    ['[data-act="cat-open"]', 'Добавить существу предмет из каталога книги'],
    ['[data-act="cat-add"]', 'Добавить выбранный предмет'],
    ['[data-act="extra-del"]', 'Убрать добавленный предмет'],
    ['.bst-card [data-act="hp"]', 'Применить: число — установить ОЗ, −N или +N — изменить'],
    ['.bst-card [data-act="tr"][data-d="1"]', 'Добавить травму'],
    ['.bst-card [data-act="tr"]', 'Убрать травму'],
    ['[data-act="move-roll"]', 'Бросить кость и подсветить выпавший ход'],
    // редактор карт
    ['.me-tab', 'Переключить боковую панель'],
    ['.me-cat', 'Категория объектов библиотеки'],
    ['[data-act="pngadd"]', 'Загрузить свою картинку как объект библиотеки'],
    ['[data-act="dup"]', 'Дублировать выделенное'],
    ['[data-act="rotr"]', 'Повернуть выделенное на 90° по часовой'],
    ['.me-props [data-act="del"], #mapEditorView [data-act="del"]', 'Удалить выделенное'],
    ['[data-act="resize"]', 'Изменить размер карты'],
    ['[data-act="fit"]', 'Показать карту целиком (клавиша 0)'],
    ['[data-act="clear"]', 'Стереть с карты всё нарисованное и расставленное'],
    ['[data-act="sdown"]', 'Уменьшить масштаб объекта'],
    ['[data-act="sup"]', 'Увеличить масштаб объекта'],
    ['[data-sset]', 'Задать масштаб объекта'],
    ['[data-c][data-r]', 'Готовый размер карты (клеток по ширине × высоте)'],
    ['[data-open]', 'Открыть эту карту'],
    ['[data-pfmanage]', 'Свои заготовки комнат и сцен для генератора'],
    ['[data-pfexp]', 'Скачать свои заготовки файлом'],
    ['[data-pfimp]', 'Загрузить заготовки из файла'],
    // саундпад
    ['.sb-cat', 'Категория звуков'],
    ['.sb-sec', 'Раздел саундпада'],
    ['#sbUnlock', 'Браузер не даёт играть звук без нажатия — разрешить звук'],
    // обучение
    ['.chzh-btn', 'Что здесь происходит? Экскурсия для игрока или Мастера, подсказки'],
    // общие кнопки окон и форм — по тексту
    [(el)=>/^(Отмена)$/i.test(txt(el)), 'Закрыть, ничего не меняя'],
    [(el)=>/^[✕×]$/.test(txt(el)), 'Закрыть'],
    [(el)=>/^(OK|ОК|Готово|Применить|Понятно)$/i.test(txt(el)), 'Подтвердить'],
    [(el)=>el.getAttribute('type')==='submit', (el)=>'Подтвердить: ' + txt(el).replace(/^[^\wА-Яа-яЁё]+/, '').toLowerCase()],
  ];
  function txt(el){ return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function textFor(el){
    if(el.dataset.tip) return el.dataset.tip;
    const ti = el.getAttribute('title');
    if(ti){ el.dataset.tip = ti; el.removeAttribute('title'); return ti; } // своё облачко вместо системного
    for(const [m, x] of RULES){
      let ok = false; try{ ok = typeof m==='function' ? m(el) : el.matches(m); }catch(e){}
      if(ok) return typeof x==='function' ? x(el) : x;
    }
    return el.getAttribute('aria-label') || '';
  }
  const SEL = 'button, .button-like, .tab-btn, [title], [data-tip], label.lock-toggle, .boosty-link';
  let timer = 0, cur = null, tipEl = null;
  function hide(){ clearTimeout(timer); timer = 0; if(tipEl){ tipEl.remove(); tipEl = null; } }
  function show(el){
    if(!el.isConnected) return;
    const text = textFor(el); if(!text) return;
    tipEl = document.createElement('div'); tipEl.className = 'ui-tip'; tipEl.textContent = text; document.body.appendChild(tipEl);
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let top = r.top - h - 8; if(top < 6) top = r.bottom + 8;
    const left = Math.max(6, Math.min(r.left + r.width/2 - w/2, window.innerWidth - w - 6));
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  document.addEventListener('pointerover', (e)=>{
    if(e.pointerType==='touch') return;
    const el = e.target.closest && e.target.closest(SEL);
    if(el===cur) return;
    hide(); cur = el;
    if(el){ if(el.hasAttribute('title')) textFor(el); timer = setTimeout(()=>show(el), DELAY); } // title снимаем сразу — без системной подсказки
  }, true);
  document.addEventListener('pointerout', (e)=>{ if(cur && !(e.relatedTarget && cur.contains(e.relatedTarget))){ cur = null; hide(); } }, true);
  ['pointerdown', 'keydown', 'wheel'].forEach(ev=>document.addEventListener(ev, ()=>{ hide(); }, true));
  // Касание: наведения нет — подсказку показывает долгое нажатие (0,6 с); после него кнопка не срабатывает.
  // Элементы, у которых нажатие само запускает жест (броски, «нажми и тяни»), не трогаем.
  let lpTimer = 0, lpStart = null, lpShownOn = null;
  document.addEventListener('pointerdown', (e)=>{
    if(e.pointerType!=='touch') return;
    const el = e.target.closest && e.target.closest(SEL);
    if(!el || el.matches('.bst-roll, .ability-roll-ref, [onpointerdown], .stat-row, [data-drag]') || el.closest('.roll-overlay')) return;
    lpStart = {x:e.clientX, y:e.clientY};
    lpTimer = setTimeout(()=>{ lpTimer = 0; show(el); if(tipEl){ lpShownOn = el; setTimeout(()=>{ if(lpShownOn===el){ hide(); } }, 3000); } }, 600);
  }, true);
  const lpCancel = ()=>{ clearTimeout(lpTimer); lpTimer = 0; };
  document.addEventListener('pointermove', (e)=>{ if(lpTimer && lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) lpCancel(); }, true);
  document.addEventListener('pointerup', lpCancel, true); document.addEventListener('pointercancel', lpCancel, true);
  document.addEventListener('click', (e)=>{ if(lpShownOn && lpShownOn.contains(e.target)){ e.preventDefault(); e.stopImmediatePropagation(); lpShownOn = null; } }, true);
  document.addEventListener('contextmenu', (e)=>{ if(lpShownOn || lpTimer){ const el = e.target.closest && e.target.closest(SEL); if(el) e.preventDefault(); } }, true);
  window.addEventListener('scroll', hide, true);
  return { textFor, hide };
})();
