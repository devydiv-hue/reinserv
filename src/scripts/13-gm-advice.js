/* ======================================================================
   СОВЕТЫ МАСТЕРУ (по мотивам глав книги «Раздел мастера игры», «Описания в игре», 13 принципов, бой, «Страх в игре»):
   - «📋 Подготовка к игре» — чек-лист с отметками (хранится в браузере Мастера);
   - «📖 Памятка Мастера» — все советы по разделам;
   - «💡 Совет по ситуации» — маленькая карточка, когда случается подходящее событие (только Мастеру и на
     локальном столе; не чаще выбранной частоты; каждый совет — один раз, потом по кругу).
   Открывается из меню «ЧЗХ❓❓❓» и кнопкой «💡 Советы» на панели игрового стола.
   ====================================================================== */
const GmAdvice = (function(){
  const KEY = 'reincarnator_gm_advice_v1';
  const SECTIONS = {
    role:{title:'Роль Мастера', tips:[
      'Темп рождается из выбора: давайте варианты с понятными последствиями — «маршрут длинный, но спокойный, а короткий — опасный».',
      'Вы модератор заявок, а не противник игроков: играете за мир, а не против стола.',
      'Дайте свершиться потрясающей заявке: не режьте смелую идею — назначьте проверку и заранее назовите цену провала.',
      'Будьте последовательны: правило, применённое к врагу, работает и для игроков — иначе пропадёт доверие.',
      'Знать все правила не обязательно: решение принимаете вы, опираясь на дух правил.',
      'Отказывайте вежливо и предлагайте компромисс.',
      'Не давайте спору затянуться: решите в пользу игры, а к правилу вернитесь после встречи. Ошиблись — позже дайте пострадавшему поблажку.',
      'Если игрок спорит постоянно — поговорите с ним после игры.',
      'Объясняйте правила на примере и терпеливо.',
      'Абстрактные правила («если игрок может доказать мастеру…») решаете вы.']},
    desc:{title:'Описания', tips:[
      'Атмосфера — сердце игры: в проходных моментах отложите механику и описывайте.',
      'Показывайте, а не рассказывайте: вместо «аристократ — мерзавец» покажите его поступок.',
      'Живые детали подсказывают игрокам, что делать дальше.',
      'Берите образы из жизни: манеры знакомых, бытовые мелочи.',
      'Задействуйте все органы чувств — запахи, звуки, духоту, особенно под противогазом и бронёй.',
      'Мир не замирает, пока игроки думают: описывайте в движении.',
      'Не забирайте внимание: одно описание — не дольше минуты.',
      'Вкладывайте эмоции в голос, ускоряйте речь, когда торопите.',
      'Меняйте слова и слог, избегайте вычурных метафор.',
      'Рутина важна: бытовые сцены оттеняют действие.',
      'Чувства и намерения персонажа решает его игрок (кроме недостатков по правилам).',
      'Импровизируйте и не бойтесь клише.']},
    principles:{title:'13 принципов', tips:[
      'Персонажи игроков — главные: не давайте вашим персонажам решать за них.',
      'Это истории обычных людей со слабостями: используйте Трудности (стр. 313).',
      'До всего интересного нужно добраться: ценное — далеко и под охраной.',
      'Это странствия по Равнине: пустые просторы, руины и неожиданные встречи.',
      'Это выживание: снаряжение, вода и еда — граница между жизнью и смертью.',
      'Удивляйте игроков, а не персонажей: открывайте загадки прошлого.',
      'Описывайте впечатляющие сцены — крупно и ярко.',
      'Рвите душу персонажей: моральные выборы и последствия недостатков.',
      'Покажите тёмные закоулки человеческой натуры.',
      'Мир правдоподобен, но сдобрен постапокалиптическим преувеличением.',
      'Персонажи ведущего важны: у каждого свои цели.',
      'Игра непростая, но не удручающая: давайте передышки и маленькие победы.',
      'Незримое зло всегда рядом.']},
    combat:{title:'Бой', tips:[
      'Последствиям каждого действия — пара фраз: это минимум половина описания боя.',
      'У противника есть мотивация: жить, награбить, сбежать. Не все бьются до смерти.',
      'Деритесь коварно: ловушки, засады, приманки. Но противники не идеальны и тоже ошибаются.',
      'Используйте окружение: укрытия рушатся, балки падают, стёкла лопаются.',
      'Используйте манёвры: подавление, захват, оттеснение.',
      'Накаляйте драму и торопите игроков: круг длится секунды, долгие совещания разрушают темп.',
      'Провал с Невзгодами — повод для яркого последствия; провал атаки врага — шанс для ответного хода игрока.',
      'Специфика регионов: в Княжествах броня с высоким СК и сканеры движения, в Землях Страха — визоры и бои на 200–600 м.']},
    fear:{title:'Страх', tips:[
      'Помните о комфорте и табу каждого за столом.',
      'Ужас — малая часть истории: он держится на контрасте со спокойными сценами.',
      'Нагнетайте через ощущения персонажа — но осторожно со штампами.',
      'Шокируйте сменой мирного на ужасное.',
      'Обрушивайте угрозу внезапно, после затишья.',
      'Неведомое зло показывайте через следы и присутствие, без прямой встречи.',
      'Добавьте необъяснимое — то, что никто не может объяснить и изменить.',
      'Дайте почувствовать, что ситуация вне контроля.',
      'Отвратительное — приправа, а не основное блюдо.']},
    after:{title:'После игры', tips:[
      'Начислите опыт, пока встреча свежа в памяти.',
      'Проверьте спорные правила и, если ошиблись, придумайте поблажку на следующий раз.',
      'Спросите игроков, что понравилось и что нет; запишите зацепки к следующей встрече.']},
    prep:{title:'Подготовка', tips:[
      'Заготовьте около 9 коротких сцен атмосферы и вставляйте их, когда игра просит паузы.',
      'Перед игрой договоритесь о тоне и табу — это бережёт всех за столом.',
      'Сцене нужно немного: кто чего хочет и что случится, если игроки ничего не сделают.']}
  };
  const CHECK = [
    {h:'До встречи'},
    {id:'date', t:'Договорились о дате, тоне игры и табу'},
    {id:'chars', t:'Персонажи созданы — или на это выделена первая встреча'},
    {id:'goal', t:'Есть цель встречи и 2–3 сцены: кто чего хочет и что случится, если игроки ничего не сделают'},
    {id:'scenes', t:'Заготовлено около 9 коротких сцен атмосферы'},
    {id:'foes', t:'1–2 столкновения: противники подобраны', go:'bestiary', goT:'Бестиарий'},
    {id:'maps', t:'Карты 1–2 локаций', go:'maps', goT:'Редактор карт'},
    {id:'sounds', t:'3–4 звука под сцены', go:'sound', goT:'Саундпад'},
    {id:'loot', t:'2–3 находки и зацепка к следующей встрече'},
    {h:'После'},
    {id:'xp', t:'Опыт начислен', go:'xp', goT:'Начисление опыта'},
    {id:'review', t:'Спорные правила проверены, обратная связь собрана, зацепки записаны'}
  ];
  const FREQ = {rare:{label:'редко', gap:10*60e3}, normal:{label:'обычно', gap:5*60e3}, often:{label:'часто', gap:2*60e3}};
  let st = (function(){ try{ return Object.assign({on:true, freq:'normal', seen:{}, muted:{}, checks:{}, offerDay:''}, JSON.parse(localStorage.getItem(KEY) || '{}')); }catch(e){ return {on:true, freq:'normal', seen:{}, muted:{}, checks:{}, offerDay:''}; } })();
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(st)); }catch(e){} }
  const esc = (s)=>String(s).replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  function isGm(){ return typeof session==='undefined' || session.role!=='player'; }

  /* ---------- выбор совета: каждый по одному разу, потом по кругу ---------- */
  function nextTip(sec, idx){
    const tips = SECTIONS[sec].tips;
    if(idx!=null) return idx;
    const seen = st.seen[sec] = st.seen[sec] || [];
    let free = tips.map((_, i)=>i).filter(i=>seen.indexOf(i)<0);
    if(!free.length){ st.seen[sec] = []; free = tips.map((_, i)=>i); }
    return free[0];
  }

  /* ---------- карточка совета ---------- */
  let card = null, hideT = 0, lastShown = 0, sessionStart = Date.now();
  function busy(){
    const a = document.activeElement, tag = a && a.tagName;
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (a && a.isContentEditable)) return true;
    return typeof Onboarding!=='undefined' && Onboarding.busy && Onboarding.busy();
  }
  function show(sec, idx, opts){
    opts = opts || {};
    if(!isGm() || !SECTIONS[sec]) return false;
    if(!opts.force){
      if(!st.on || st.muted[sec] || busy()) return false;
      if(Date.now() - lastShown < FREQ[st.freq].gap) return false;
    }
    const i = nextTip(sec, idx);
    st.seen[sec] = st.seen[sec] || []; if(st.seen[sec].indexOf(i)<0) st.seen[sec].push(i);
    lastShown = Date.now(); save();
    if(!card){
      card = document.createElement('div'); card.className = 'gma-card';
      card.addEventListener('mouseenter', ()=>clearTimeout(hideT));
      card.addEventListener('mouseleave', ()=>{ hideT = setTimeout(close, 8000); });
      card.addEventListener('click', onCardClick);
      document.body.appendChild(card);
    }
    card.dataset.sec = sec;
    card.innerHTML = `<div class="gma-h">💡 Совет Мастеру · ${esc(SECTIONS[sec].title)}</div>`+
      (opts.lead ? `<div class="gma-lead">${opts.lead}</div>` : '') +
      `<div class="gma-t">${esc(SECTIONS[sec].tips[i])}</div>
      <div class="gma-btns">${opts.extraBtn || ''}<button type="button" class="small" data-g="more" title="Следующий совет этого раздела">Ещё совет</button><button type="button" class="small" data-g="memo" title="Открыть все советы раздела">В памятке</button><button type="button" class="small" data-g="mute" title="Больше не показывать советы этого раздела (вернуть — в меню «ЧЗХ»)">Не показывать такие</button><button type="button" class="small" data-g="close" title="Закрыть">✕</button></div>`;
    card.style.display = 'block'; placeCard();
    clearTimeout(hideT); hideT = setTimeout(close, 20000);
    return true;
  }
  function close(){ clearTimeout(hideT); if(card) card.style.display = 'none'; }
  function onCardClick(e){
    const b = e.target.closest('[data-g]'); if(!b) return;
    const sec = card.dataset.sec;
    if(b.dataset.g==='more') show(sec, null, {force:true});
    else if(b.dataset.g==='memo'){ close(); openPanel('memo', sec); }
    else if(b.dataset.g==='mute'){ st.muted[sec] = true; save(); close(); }
    else if(b.dataset.g==='check'){ close(); openPanel('prep'); }
    else close();
  }
  // Как у карточки обучения: из нескольких мест берём то, где карточка закрывает меньше всего кнопок и полей
  function placeCard(){
    const W = window.innerWidth, H = window.innerHeight, cw = Math.min(340, W - 24); card.style.width = cw + 'px';
    const ch = card.offsetHeight || 140;
    const cands = [[W - cw - 14, H - ch - 14], [14, H - ch - 14], [W - cw - 14, 70], [Math.round((W - cw)/2), H - ch - 14], [14, 70]];
    const busyR = [...document.querySelectorAll('button, input, select, textarea, a, .button-like, .tab-btn, .gt-combat, .bst-dock, .bst-float')]
      .filter(el=>!card.contains(el)).map(el=>el.getBoundingClientRect()).filter(b=>b.width && b.height && b.bottom>0 && b.top<H);
    let best = cands[0], bs = Infinity;
    cands.forEach(([x, y], k)=>{ let sc = k * 30;
      busyR.forEach(b=>{ sc += Math.max(0, Math.min(x + cw, b.right) - Math.max(x, b.left)) * Math.max(0, Math.min(y + ch, b.bottom) - Math.max(y, b.top)); });
      if(sc < bs){ bs = sc; best = [x, y]; } });
    card.style.left = best[0] + 'px'; card.style.top = best[1] + 'px';
  }

  /* ---------- события ---------- */
  const once = new Set(), counters = {};
  function every3(key){ counters[key] = (counters[key] || 0) + 1; return counters[key] % 3 === 1; } // 1-й, 4-й, 7-й…
  function event(name, data){
    try{
      if(typeof Onboarding!=='undefined' && Onboarding.busy()) return; // во время обучения — без советов
      switch(name){
        case 'session-gm': {
          const day = new Date().toISOString().slice(0, 10);
          if(st.offerDay===day || !st.on) return;
          st.offerDay = day; save();
          show('fear', 0, {force:true, lead:'Перед игрой — <b>📋 чек-лист подготовки</b>: что собрать к встрече.',
            extraBtn:'<button type="button" class="small primary" data-g="check" title="Открыть чек-лист подготовки">📋 Чек-лист</button>'});
          return;
        }
        case 'scene': show('desc'); return;
        case 'creature': {
          const t = data || {};
          const scary = t.group==='Пустоты' || (t.abil || []).some(a=>/пугающ|чудовищн|неописуем/i.test(a[1] || ''));
          if(scary && show('fear')) return;
          if(/Феодальных княжеств/.test(t.group || '') && !once.has('feudal')){ if(show('combat', 7)){ once.add('feudal'); return; } }
          if(!once.has('creature')){ if(show('combat', [1, 2][Math.floor(Math.random()*2)])) once.add('creature'); }
          return;
        }
        case 'combat-start': show('combat', 0); return;
        case 'combat-round': show('combat', [5, 3, 4][Math.floor(Math.random()*3)]); return;
        case 'combat-scene': show('combat', 3); return;
        case 'miss': if(every3('miss')) show('combat', 6); return;
        case 'enemy-low': if(every3('low')) show('combat', 1); return;
        case 'player-down': show('principles', [11, 0][Math.floor(Math.random()*2)]); return;
        case 'loot': show('principles', [2, 4][Math.floor(Math.random()*2)]); return;
        case 'sound': if(!once.has('sound')){ if(show('desc', 7)) once.add('sound'); } return;
        case 'mapgen': show('prep', 0); return;
        case 'xp': show('after'); return;
      }
    }catch(e){ console.warn('[Советы Мастеру]', e); }
  }
  // «Принцип встречи»: раз в 40 минут совместной игры, если других советов не было
  setInterval(()=>{
    if(typeof session==='undefined' || session.role!=='gm') return;
    if(Date.now() - sessionStart > 40*60e3 && Date.now() - lastShown > 40*60e3) show('principles');
  }, 60e3);
  // Следим за ОЗ существ и игроков на столе: «упали до трети» и «ушёл в 0 и ниже»
  const lastHp = {};
  function watchTable(){
    if(typeof GameTable==='undefined' || !isGm()) return;
    const toks = GameTable.state && GameTable.state.tokens; if(!toks) return;
    Object.values(toks).forEach(t=>{
      let hp = null, max = null;
      if(t.creature && t.creature.inst){ hp = t.hp; max = t.creature.inst.hpMax; }
      else if(t.kind==='player' && GameTable.vitalsOf){ const v = GameTable.vitalsOf(t); if(v){ hp = v.hp; max = v.hpMax; } }
      if(hp==null || !max) return;
      const prev = lastHp[t.id]; lastHp[t.id] = hp;
      if(prev==null) return;
      if(t.creature && prev > max/3 && hp <= max/3 && hp > 0) event('enemy-low');
      if(t.kind==='player' && prev > 0 && hp <= 0) event('player-down');
    });
  }
  setInterval(watchTable, 3000);

  /* ---------- панель: «📋 Подготовка» и «📖 Памятка» ---------- */
  let panel = null;
  function openPanel(tab, sec){
    if(!panel){
      panel = document.createElement('div'); panel.className = 'gma-panel';
      panel.addEventListener('click', onPanelClick);
      panel.addEventListener('change', (e)=>{ const c = e.target.closest('[data-chk]'); if(c){ st.checks[c.dataset.chk] = c.checked; save(); } });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && panel && panel.style.display==='flex') closePanel(); });
      document.body.appendChild(panel);
    }
    panel.dataset.tab = tab || 'prep';
    renderPanel(sec);
    panel.style.display = 'flex';
  }
  function closePanel(){ if(panel) panel.style.display = 'none'; }
  function renderPanel(openSec){
    const tab = panel.dataset.tab;
    const head = `<div class="gma-ph"><button type="button" class="small${tab==='prep' ? ' primary' : ''}" data-p="prep" title="Чек-лист подготовки к встрече">📋 Подготовка</button><button type="button" class="small${tab==='memo' ? ' primary' : ''}" data-p="memo" title="Все советы по разделам">📖 Памятка</button><button type="button" class="small gma-x" data-p="close" title="Закрыть (Esc)">✕</button></div>`;
    let body = '';
    if(tab==='prep'){
      body = CHECK.map(c=>c.h ? `<div class="gma-sub">${esc(c.h)}</div>`
        : `<label class="gma-check"><input type="checkbox" data-chk="${c.id}" ${st.checks[c.id] ? 'checked' : ''}><span>${esc(c.t)}${c.go ? ` <a href="#" data-go="${c.go}" title="Перейти на вкладку «${esc(c.goT)}»">→ ${esc(c.goT)}</a>` : ''}</span></label>`).join('') +
        `<div class="gma-row"><button type="button" class="small" data-p="reset" title="Снять все отметки — для подготовки к новой встрече">🔄 Новая встреча</button></div>`;
    } else {
      body = ['role', 'desc', 'principles', 'combat', 'fear', 'prep', 'after'].map(k=>`<details class="gma-sec" ${k===openSec ? 'open' : ''}><summary>${esc(SECTIONS[k].title)}${st.muted[k] ? ' <small>(советы скрыты)</small>' : ''}</summary><ol>${SECTIONS[k].tips.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>${st.muted[k] ? `<button type="button" class="small" data-unmute="${k}" title="Снова показывать советы этого раздела по ситуации">Снова показывать</button>` : ''}</details>`).join('') +
        `<div class="gma-note muted">По мотивам советов книги: «Раздел мастера игры», «Описания в игре», 13 принципов, бой и «Страх в игре».</div>`;
    }
    panel.innerHTML = head + `<div class="gma-body">${body}</div>`;
  }
  function onPanelClick(e){
    const go = e.target.closest('[data-go]');
    if(go){ e.preventDefault(); if(typeof toggleMainTab==='function') toggleMainTab(go.dataset.go); return; }
    const um = e.target.closest('[data-unmute]'); if(um){ delete st.muted[um.dataset.unmute]; save(); renderPanel(um.dataset.unmute); return; }
    const b = e.target.closest('[data-p]'); if(!b) return;
    const p = b.dataset.p;
    if(p==='close') closePanel();
    else if(p==='reset'){ uiConfirm('Снять все отметки чек-листа?', {title:'Подготовка', ok:'Снять'}).then(ok=>{ if(ok){ st.checks = {}; save(); renderPanel(); } }); }
    else { panel.dataset.tab = p; renderPanel(); }
  }

  /* ---------- настройки (для меню «ЧЗХ») ---------- */
  function toggleOn(){ st.on = !st.on; save(); return st.on; }
  function cycleFreq(){ const ks = Object.keys(FREQ); st.freq = ks[(ks.indexOf(st.freq) + 1) % ks.length]; save(); return FREQ[st.freq].label; }
  function settingsLabel(){ return `💡 Советы Мастеру: ${st.on ? 'вкл' : 'выкл'}`; }
  function freqLabel(){ return `⏱ Частота советов: ${FREQ[st.freq].label}`; }
  return { event, show, openPanel, closePanel, toggleOn, cycleFreq, settingsLabel, freqLabel, isGm };
})();
