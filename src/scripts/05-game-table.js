/* ======================================================================
   ИГРОВОЙ СТОЛ — визуальный и интерактивный слой над существующей сессией, не отдельная игра.

   Состояние стола (gameTableState: карта, жетоны, рисунки, зоны) и действия над ним — разные вещи:
   действие — это команда, состояние меняет только авторитетная сторона.
     - Авторитет — Мастер (или сам человек, пока сессии нет вообще — локальный стол). Он принимает
       команды (свои и игроков), проверяет права, применяет их к authState, увеличивает version,
       сохраняет в localStorage (STATE_KEY) и рассылает игрокам gt-update с операциями.
     - Игрок ничего не меняет сам: шлёт gt-command Мастеру и показывает только подтверждённое
       состояние (viewState — снимок от Мастера, локальная копия в CACHE_KEY неавторитетна).
   Транспорт — существующие sendMsg/handleIncomingMessage (WebSocket-релей), новые только типы
   сообщений gt-*. RoomTransport (DataChannel) — лишь для временного: ping, указка Мастера, живое
   перетаскивание жетона; каждое такое событие дублируется через WS с меньшей частотой, так что
   без голосовой комнаты стол работает так же, просто чуть менее плавно.

   HP/Psi жетона игрока нигде в состоянии стола не хранятся: жетон ссылается на игрока (ownerId =
   тот же id, что ключ session.players), а цифры каждый раз берутся из его character через
   существующие hpMax/psiMax. Правка HP с жетона — выдача с подтверждением (sendGrant, как удача), он
   меняет свой character, и обратно оно приходит уже обычным sheet-snapshot.
   ====================================================================== */

const GameTable = (function(){
  const CELL = TABLE_CELL_PX;           // пикселей на клетку при масштабе 100% — общий с редактором карт (MapKit)
  const METERS_PER_CELL = TABLE_METERS_PER_CELL; // главное правило: 1 клетка = 3 м
  const SIZE_CELLS = {small:0.6, normal:1, large:2, huge:3};
  const SIZE_LABELS = {small:'Маленький', normal:'Обычный', large:'Большой 2×2', huge:'Огромный 3×3'};
  const ZOOM_STEPS = [0.25,0.5,0.75,1,1.25,1.5,2,3];
  const ZOOM_MIN = 0.25, ZOOM_MAX = 3;
  const STATE_KEY = 'reincarnator_game_table_state_v1';   // авторитетный стол (Мастер / локальный)
  const CACHE_KEY = 'reincarnator_game_table_cache_v1';   // последний снимок от Мастера (игрок)
  const CAMERA_KEY = 'reincarnator_game_table_camera_v1';
  const STYLE_KEY = 'reincarnator_game_table_draw_style_v1';
  const LOCAL_OWNER = 'local';          // жетон «моего персонажа» на локальном столе без сессии
  const PALETTE = ['#9c2f1c','#1c1712','#3f6b4a','#2f4f7a','#6b3f7a','#b07a1f','#5c5240','#2f6f73'];
  const DRAW_COLORS = ['#9c2f1c','#1c1712','#2f4f7a','#3f6b4a','#b07a1f','#f6ecd4'];
  const DRAWING_TYPES = ['pen','line','arrow','rect','circle','polygon','text'];
  const PING_MS = 1700;
  const PENDING_MS = 4000;              // сколько ждём подтверждения своего хода от Мастера
  const PREVIEW_MS = 1500;              // сколько живёт чужое «живое» перетаскивание без новых событий

  /* ---------- состояние ---------- */
  function newId(p){ return (p||'')+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function blankState(tableId){
    return {schema:1, tableId: tableId===undefined ? newId('tbl') : tableId, version:0,
            map:{metersPerCell:METERS_PER_CELL, background:null, scene:null}, tokens:{}, drawings:[], zones:[], combat:null};
  }
  function num(v, d){ v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b){ return v<a ? a : v>b ? b : v; }
  function r3(v){ return Math.round(v*1000)/1000; }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function safeUrl(u){ u = String(u||'').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length<2048 ? u : ''; }
  function safeColor(c, d){ return /^#[0-9a-f]{6}$/i.test(c||'') ? c.toLowerCase() : d; }

  // Отметки состояний на жетоне (способности существ, «Бросок цели»): r — осталось кругов, 0 — пока не снимут
  const MARKS = {shock:'Шок', prone:'Сбит с ног', grabbed:'Схвачен', stunned:'Оглушён', blind:'Ослеплён', skipturn:'Пропускает ход', vanished:'Исчез', limit:'На пределе сил', fear:'Испуган', cover:'В укрытии', parry:'Парирует',
    exhausted:'Истощён', immobile:'Обездвижен', dead:'Погиб'}; // последние три — таблица травм и поломок (23-trauma-table.js), истощение существ
  function sanitizeToken(t){
    t = t || {};
    const kind = t.kind==='player' ? 'player' : 'gm';
    const out = {
      id: String(t.id||newId('t')).slice(0,64), kind,
      x: r3(clamp(num(t.x,0), -10000, 10000)), y: r3(clamp(num(t.y,0), -10000, 10000)),
      size: SIZE_CELLS[t.size] ? t.size : 'normal',
      color: safeColor(t.color, PALETTE[0]),
      rotation: num(t.rotation,0) % 360,          // задел: поворот есть в данных, UI для него пока нет
      name: String(t.name||'').slice(0,60),
      avatar: safeUrl(t.avatar),
      hidden: kind==='gm' && !!t.hidden
    };
    if(kind==='player') out.ownerId = String(t.ownerId||'').slice(0,64);
    else {
      out.hp = (t.hp===null || t.hp===undefined || t.hp==='') ? null : Math.round(clamp(num(t.hp,0), -9999, 9999));
      // Максимум ОЗ — для кольца по краю жетона. Не задан (старые жетоны) — берётся текущее значение; ОЗ выше максимума — максимум растёт
      const mx = (t.hpMax===null || t.hpMax===undefined || t.hpMax==='') ? null : Math.round(clamp(num(t.hpMax,0), 1, 9999));
      out.hpMax = out.hp===null ? mx : Math.max(mx || 0, out.hp, 1);
      out.hpShown = !!t.hpShown; // число ОЗ видно игрокам — по умолчанию нет, только кольцо
      if(out.hp===null && t.hpFrac!==null && t.hpFrac!==undefined && isFinite(Number(t.hpFrac))) out.hpFrac = clamp(Number(t.hpFrac), 0, 1); // (игрок) доля ОЗ без числа
    }
    // Боевые характеристики (атака с карты). Защита, модификаторы, порог травмы и оружие — секрет Мастера:
    // игрокам жетоны уходят без них (см. publicToken). Счётчики травм и флажок «можно по незащищённым» видны всем.
    out.trauma = Math.round(clamp(num(t.trauma,0), 0, 99));        // 🦴 — травмы
    out.traumaRed = Math.round(clamp(num(t.traumaRed,0), 0, 99));  // красная 🦴 — травмы от оружия с чертой «травма»
    out.attackModEnabled = kind==='gm' ? true : !!t.attackModEnabled; // у жетона игрока Мастер включает сам
    out.attackMod = Math.round(clamp(num(t.attackMod,0), -18, 18));   // прибавляется к броску того, кто атакует этот жетон
    out.traumaThreshold = kind==='player' ? 5 : Math.round(clamp(num(t.traumaThreshold,5), 1, 12)); // «Травма-к12»; у игроков всегда 5
    out.unprotectedEnabled = kind==='gm' && !!t.unprotectedEnabled;    // «атака по незащищённым частям» разрешена
    out.slowReaction = !!t.slowReaction; // ⚡ по жетону ударили медленным оружием — может отреагировать (снимает Мастер)
    out.burning = Math.round(clamp(num(t.burning,0), 0, 99)); // 🔥 горит N кругов (термическая граната; уменьшает/снимает Мастер)
    out.nature = CREATURE_NATURES[t.nature] ? t.nature : t.creature ? creatureNature(t.creature) : 'living';
    if(out.nature==='void'){ out.trauma = 0; out.traumaRed = 0; } // у пустот травм не бывает
    out.marks = (Array.isArray(t.marks) ? t.marks : []).slice(0, 12).filter(m=>m && MARKS[m.k]).map(m=>({k:m.k, r:Math.round(clamp(num(m.r,0), 0, 99))})); // отметки (Бросок цели)
    if(kind==='gm'){
      out.reflexes = Math.round(clamp(num(t.reflexes,3), 0, 20)); // рефлексы NPC — против них мечут гранаты
      out.grenade = GRENADE_SPECS[t.grenade] ? t.grenade : '';     // граната NPC (без учёта количества)
      out.defense = Math.round(clamp(num(t.defense,0), 0, 99));
      out.defenseSubs = {};
      Object.keys((t.defenseSubs && typeof t.defenseSubs==='object') ? t.defenseSubs : {}).slice(0,8).forEach(k=>{
        const v = Math.round(num(t.defenseSubs[k], NaN));
        if(/^[А-Яа-яЁё]{1,4}$/.test(k) && isFinite(v)) out.defenseSubs[k] = clamp(v, 0, 99);
      });
      out.armorName = String(t.armorName||'').slice(0,80);
      // защита по зонам, вписанная Мастером (жетон без карточки или поправка к карточке): {golova:5, ruki:0, …}
      out.zoneDef = {};
      Object.keys((t.zoneDef && typeof t.zoneDef==='object') ? t.zoneDef : {}).forEach(k=>{ const v = Math.round(num(t.zoneDef[k], NaN)); if(ARMOR_ZONES.indexOf(k)>=0 && isFinite(v)) out.zoneDef[k] = clamp(v, 0, 99); });
      out.weaponText = String(t.weaponText||'').slice(0,400);
      out.unprotectedMod = Math.round(clamp(num(t.unprotectedMod,-6), -30, 30));
      out.strength = Math.round(clamp(num(t.strength,3), 0, 20)); // сила NPC — для условных черт оружия («если сила 4+, то пул» и т.п.)
      // Навык атаки NPC: у существа из бестиария — из книги (Максимум «Ат +2 (12)» → 12 − 10 − 2), иначе 3
      out.atkSkill = (t.atkSkill===null || t.atkSkill===undefined || t.atkSkill==='') ? null : Math.round(clamp(num(t.atkSkill,3), -10, 30));
      // Существо из бестиария: копия шаблона + состояние экземпляра (см. модуль Bestiary). Только простой JSON, с ограничением размера
      if(t.creature && typeof t.creature==='object'){ try{ const j = JSON.stringify(t.creature); if(j.length <= 60000) out.creature = JSON.parse(j); }catch(e){} }
    }
    return out;
  }
  const SECRET_TOKEN_FIELDS = ['defense','defenseSubs','zoneDef','armorName','attackMod','attackModEnabled','unprotectedMod','traumaThreshold','weaponText','strength','reflexes','grenade','atkSkill','creature'];
  function publicToken(t){ const o = Object.assign({}, t); SECRET_TOKEN_FIELDS.forEach(k=>{ delete o[k]; });
    // ОЗ жетона Мастера скрыты (по умолчанию): игрокам — только доля для кольца, без числа и максимума
    if(t.kind==='gm' && !t.hpShown && t.hp!==null && t.hp!==undefined){ o.hpFrac = hpFraction(t.hp, t.hpMax); o.hp = null; o.hpMax = null; }
    return o; }
  function hpFraction(hp, max){ hp = Number(hp); max = Number(max); if(!isFinite(hp) || !(max > 0)) return null; return Math.round(clamp(hp/max, 0, 1)*100)/100; }
  // Доля ОЗ для кольца по краю: игрок — из листа, жетон Мастера — hp/hpMax или присланная доля
  function hpRingFrac(t, v){
    if(t.kind==='player') return v ? hpFraction(v.hp, v.hpMax) : null;
    if(t.hp!==null && t.hp!==undefined) return hpFraction(t.hp, t.hpMax);
    return t.hpFrac!==null && t.hpFrac!==undefined ? t.hpFrac : null;
  }
  function sanitizeDrawing(d){
    if(!d || DRAWING_TYPES.indexOf(d.type)<0) return null;
    const pts = (Array.isArray(d.points) ? d.points : []).slice(0,4000)
      .map(p=>[r3(clamp(num(p&&p[0],0),-10000,10000)), r3(clamp(num(p&&p[1],0),-10000,10000))]);
    if(!pts.length) return null;
    const out = {id:String(d.id||newId('d')).slice(0,64), type:d.type, points:pts,
      color:safeColor(d.color, DRAW_COLORS[0]), width:clamp(num(d.width,4),1,48), opacity:clamp(num(d.opacity,1),0.1,1)};
    if(d.type==='text'){ out.text = String(d.text||'').slice(0,400); out.fontSize = clamp(num(d.fontSize,22),8,160); if(!out.text.trim()) return null; }
    return out;
  }
  // Карта из редактора карт: ссылка на её JSON на сервере игры (или local:<id> — библиотека этого браузера,
  // без сессии) и целая клетка стола под её левым верхним углом. Рисуется тем же MapRender, что и в редакторе.
  function sanitizeScene(sc){
    if(!sc || typeof sc!=='object') return null;
    const url = String(sc.url||'');
    if(!/^\/user-maps\/[a-zA-Z0-9_-]{4,64}\.json$/.test(url) && !/^local:[a-zA-Z0-9_-]{4,64}$/.test(url)) return null;
    return { mapId:String(sc.mapId||'').slice(0,64), url, name:String(sc.name||'').slice(0,80),
      x:Math.round(clamp(num(sc.x,0),-2000,2000)), y:Math.round(clamp(num(sc.y,0),-2000,2000)),
      cols:Math.round(clamp(num(sc.cols,1),1,500)), rows:Math.round(clamp(num(sc.rows,1),1,500)), rev:Math.round(num(sc.rev,0)) };
  }
  function sanitizeMap(m){
    m = m || {};
    const b = m.background;
    const url = b && safeUrl(b.url);
    return {metersPerCell: clamp(num(m.metersPerCell, METERS_PER_CELL), 0.5, 100),
            background: url ? {url, x:r3(num(b.x,0)), y:r3(num(b.y,0)), w:clamp(num(b.w,20),1,1000)} : null,
            scene: sanitizeScene(m.scene)};
  }
  function normalizeState(raw, fallbackTableId){
    raw = raw || {};
    const s = blankState(typeof raw.tableId==='string' ? raw.tableId.slice(0,64) : fallbackTableId);
    s.version = Math.max(0, Math.floor(num(raw.version,0)));
    s.map = sanitizeMap(raw.map);
    Object.keys(raw.tokens||{}).forEach(k=>{ const t = sanitizeToken(raw.tokens[k]); s.tokens[t.id] = t; });
    (Array.isArray(raw.drawings) ? raw.drawings : []).forEach(d=>{ const c = sanitizeDrawing(d); if(c) s.drawings.push(c); });
    s.zones = Array.isArray(raw.zones) ? raw.zones : []; // задел под зоны/AoE — пока только хранятся
    s.combat = sanitizeCombat(raw.combat);
    return s;
  }
  /* Трекер боя (правила «Бой»): стороны ходят по очереди целиком — сначала начавшая конфликт, затем вторая (третья);
     круг закончен, когда сходили все стороны. Проверка инициативы — Бросок рефлексов (−6) в начале боя и при смене
     сцены: проваливший теряет действие в этом круге (реакция остаётся); при ходе сюрприза начавшая сторона
     преуспевает автоматически. У каждого участника — отметки «действие», «реакция», «действие обменяно на реакцию»
     и эффекты «на N кругов». */
  function sanitizeCombat(c){
    if(!c || typeof c!=='object' || !c.active) return null;
    const int = (v, d, a, b)=>Math.round(clamp(num(v, d), a, b));
    const sides = (Array.isArray(c.sides) ? c.sides : []).slice(0, 4).map(x=>({id:String(x && x.id || '').slice(0, 16), name:String(x && x.name || 'Сторона').slice(0, 40)})).filter(x=>x.id);
    if(!sides.length) return null;
    const ids = new Set(sides.map(x=>x.id));
    const order = (Array.isArray(c.order) ? c.order : []).map(String).filter((x, i, a)=>ids.has(x) && a.indexOf(x)===i);
    sides.forEach(x=>{ if(order.indexOf(x.id)<0) order.push(x.id); });
    const mode = (v)=>v==='advantage' || v==='disadvantage' ? v : 'plain';
    const parts = {};
    Object.keys(c.parts && typeof c.parts==='object' ? c.parts : {}).slice(0, 200).forEach(id=>{
      const q = c.parts[id] || {}; if(!ids.has(q.side)) return;
      const i0 = q.init && typeof q.init==='object' ? q.init : null;
      parts[String(id).slice(0, 64)] = { side:q.side,
        init: i0 ? {roll:int(i0.roll, 0, 0, 20), rolls:(Array.isArray(i0.rolls) ? i0.rolls : []).slice(0, 2).map(x=>int(x, 0, 0, 20)), max:int(i0.max, 0, -50, 99),
                    mode:mode(i0.mode), success:!!i0.success, auto:!!i0.auto} : null,
        noAct:!!q.noAct, act:!!q.act, react:!!q.react, swap:!!q.swap,
        effects:(Array.isArray(q.effects) ? q.effects : []).slice(0, 12).map(e=>({n:String(e && e.n || '').slice(0, 60), r:int(e && e.r, 1, 0, 99)})).filter(e=>e.n) };
    });
    return {active:true, round:int(c.round, 1, 1, 9999), turn:int(c.turn, 0, 0, order.length - 1), scene:int(c.scene, 1, 1, 999),
            surprise:ids.has(c.surprise) ? c.surprise : '', sides, order, parts};
  }
  // Игрокам — без скрытых жетонов (их для игроков не существует вовсе)
  function publicCombat(c){
    if(!c) return null;
    const o = clone(c);
    Object.keys(o.parts).forEach(id=>{ const t = authState.tokens[id]; if(!t || t.hidden) delete o.parts[id]; });
    return o;
  }
  function loadJson(key){ try{ return JSON.parse(localStorage.getItem(key)||'null'); }catch(e){ return null; } }
  function saveJson(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){ console.warn('[Игровой стол] не удалось сохранить', key, e); } }

  let authState = (function(){ const raw = loadJson(STATE_KEY); return raw ? normalizeState(raw) : blankState(); })();
  let viewState = (function(){ const raw = loadJson(CACHE_KEY); return raw ? normalizeState(raw, null) : blankState(null); })();

  // Учебный стол (обучение): настоящий стол со всем его состоянием откладывается, вместо него — пустой локальный.
  // Пока он открыт, стол ведёт себя как локальный без сессии: ничего не рассылается и не сохраняется, сообщения
  // сессии для стола не принимаются (после выхода Мастер заново рассылает снимок, игрок его запрашивает).
  let sandbox = null;
  function role(){ return sandbox ? null : (typeof session!=='undefined' && session.role) || null; }
  function isPlayer(){ return role()==='player'; }
  function isAuthority(){ return role()!=='player'; }
  function st(){ return isPlayer() ? viewState : authState; }
  function tok(id){ return st().tokens[id]; }
  function myOwnerId(){ const r = role(); return r==='player' ? session.myId : r ? null : LOCAL_OWNER; }
  function tokenVisibleHere(t){ return isAuthority() || !t.hidden; }
  function ownToken(){ const me = myOwnerId(); return me ? Object.values(st().tokens).find(t=>t.kind==='player' && t.ownerId===me) : null; }
  let paused = false; // «Стоп-кадр» Мастера: игроки не двигают жетоны
  function canControl(t){ return !!t && (isAuthority() || (!paused && t.kind==='player' && t.ownerId===myOwnerId())); }

  let saveTimer = null, cacheTimer = null;
  function scheduleSave(){ if(sandbox) return; clearTimeout(saveTimer); saveTimer = setTimeout(()=>{ saveTimer=null; saveJson(STATE_KEY, authState); }, 250); }
  function scheduleCacheSave(){ clearTimeout(cacheTimer); cacheTimer = setTimeout(()=>{ cacheTimer=null; saveJson(CACHE_KEY, viewState); }, 400); }
  window.addEventListener('beforeunload', ()=>{
    if(saveTimer){ clearTimeout(saveTimer); saveJson(STATE_KEY, authState); }
    if(cacheTimer){ clearTimeout(cacheTimer); saveJson(CACHE_KEY, viewState); }
    if(camTimer){ clearTimeout(camTimer); saveJson(CAMERA_KEY, cam); }
  });

  /* ---------- HP/Psi: только чтение из существующего character ---------- */
  let remoteVitals = {}; // (игрок) ownerId -> {name,hp,hpMax,psi,psiMax} — проекция, которую рассылает Мастер, не хранилище
  function vitalsOfCharacter(c, name){
    if(!c || !c.stats) return null;
    try{ return {name, hp:c.hpCurrent, hpMax:hpMax(c), psi:c.psiCurrent, psiMax:psiMax(c)}; }catch(e){ return null; }
  }
  function ownCharacterName(){
    const f = document.getElementById('fName');
    return (f && f.value.trim()) || (session.ownName) || 'Мой персонаж';
  }
  function playerDisplayName(p){ return (p && ((p.extra && p.extra.name) || p.name)) || ''; }
  // Портрет персонажа на жетоне игрока: свой — из своего листа, у Мастера — из присланных листов, у игрока — из рассылки Мастера
  const PORTRAIT_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
  const validPortrait = (p)=>typeof p==='string' && p.length < 90000 && PORTRAIT_RE.test(p);
  let remotePortraits = {}, portraitSig = '';
  function portraitFor(t){
    if(!t || t.kind!=='player') return '';
    let c = null;
    if(t.ownerId===myOwnerId()) c = (typeof character!=='undefined' && !session.editingPlayerId) ? character : null;
    else if(role()==='gm'){ const p = session.players[t.ownerId]; c = p && p.character; }
    else return remotePortraits[t.ownerId] || '';
    return c && validPortrait(c.portrait) ? c.portrait : '';
  }
  function broadcastPortraits(to){
    if(role()!=='gm') return;
    const out = {}; Object.keys(session.players || {}).forEach(id=>{ const p = session.players[id], pr = p && p.character && p.character.portrait; if(validPortrait(pr)) out[id] = pr; });
    const sig = Object.keys(out).sort().map(k=>k + ':' + out[k].length + out[k].slice(-12)).join('|');
    if(!to){ if(sig===portraitSig) return; portraitSig = sig; }
    sendMsg({type:'gt-portraits', portraits:out}, to);
  }
  function vitalsFor(t){
    if(t.kind!=='player') return null;
    const r = role();
    if(t.ownerId===myOwnerId()){
      // GM edit mode подменяет character чужим листом — свой жетон в это время не трогаем
      return (typeof character!=='undefined' && character && !session.editingPlayerId) ? vitalsOfCharacter(character, ownCharacterName()) : null;
    }
    if(r==='gm'){
      const p = session.players[t.ownerId];
      return p && p.character ? vitalsOfCharacter(p.character, playerDisplayName(p) || t.name) : null;
    }
    return remoteVitals[t.ownerId] || null;
  }
  function computeVitals(){
    const out = {};
    Object.keys(session.players||{}).forEach(id=>{
      const p = session.players[id];
      const v = p && p.character ? vitalsOfCharacter(p.character, playerDisplayName(p)) : null;
      if(v) out[id] = v;
    });
    return out;
  }
  let vitalsTimer = null;
  function broadcastVitals(){
    if(role()!=='gm') return;
    clearTimeout(vitalsTimer);
    vitalsTimer = setTimeout(()=>{ vitalsTimer=null; sendMsg({type:'gt-vitals', vitals:computeVitals()}); }, 150);
  }
  // "8" — установить, "-3"/"+2" — изменить на столько, "=-2" — установить отрицательное (HP в книге уходит ниже нуля)
  function parseVitalInput(raw){
    const s = String(raw||'').trim().replace(/[−–—]/g,'-').replace(/\s+/g,'');
    let m = s.match(/^=(-?\d+)$/);
    if(m) return {mode:'set', value:parseInt(m[1],10)};
    m = s.match(/^([+-])(\d+)$/);
    if(m) return {mode:'delta', value:(m[1]==='-'?-1:1)*parseInt(m[2],10)};
    m = s.match(/^(\d+)$/);
    if(m) return {mode:'set', value:parseInt(m[1],10)};
    return null;
  }
  // Одна и та же арифметика у Мастера (его копия листа игрока) и у самого игрока — через существующие hpMax/psiMax/clampLower
  function applyVitalsChange(c, which, mode, value){
    const key = which==='psi' ? 'psiCurrent' : 'hpCurrent';
    const max = which==='psi' ? psiMax(c) : hpMax(c);
    const before = c[key];
    const target = mode==='delta' ? (Number(before)||0) + value : value;
    const after = clampLower(Math.round(target), max);
    if(after===before) return null;
    c[key] = after;
    return {before, after};
  }
  function changePlayerVitals(t, which, raw){
    const parsed = parseVitalInput(raw);
    if(!parsed){ toast('Не понял число — например 8, −3 или +2'); return; }
    const label = which==='psi' ? 'Пси-запас' : 'Здоровье';
    if(t.ownerId===myOwnerId()){ // свой персонаж (локальный стол) — прямо в лист, тем же путём, что и поле HP листа
      if(!character){ toast('Сначала создайте персонажа'); return; }
      const ch = applyVitalsChange(character, which, parsed.mode, parsed.value);
      if(ch){ logEvent(character, `${label}: ${ch.before} → ${ch.after} (игровой стол).`); renderAll(); }
      return;
    }
    const p = role()==='gm' ? session.players[t.ownerId] : null;
    if(!p || !p.character){ toast('Игрок не в сети — его лист сейчас недоступен'); return; }
    // Выдача с подтверждением (sendGrant в основном скрипте) — та же, что у удачи и опыта: дойдёт и до
    // игрока, который прямо сейчас переподключается, и сразу обновляет копию листа у Мастера. Игрок
    // применяет её к своему character и шлёт обратно обычный sheet-snapshot.
    sendGrant(t.ownerId, {kind:'vitals', which, mode:parsed.mode, value:parsed.value});
    renderTokens(); broadcastVitals();
    if(typeof renderPlayersList==='function') renderPlayersList();
  }

  /* ---------- команды → операции (только авторитет) ---------- */
  function applyOp(s, op){
    switch(op.op){
      case 'token-upsert': s.tokens[op.token.id] = op.token; break;
      case 'token-remove': delete s.tokens[op.id]; break;
      case 'drawing-add':
        if(!s.drawings.some(d=>d.id===op.drawing.id)){
          if(Number.isInteger(op.index) && op.index>=0 && op.index<=s.drawings.length) s.drawings.splice(op.index,0,op.drawing);
          else s.drawings.push(op.drawing);
        }
        break;
      case 'drawing-remove': { const ids = new Set(op.ids||[]); s.drawings = s.drawings.filter(d=>!ids.has(d.id)); break; }
      case 'drawings-set': s.drawings = op.drawings; break;
      case 'map-set': s.map = op.map; break;
      case 'combat-set': s.combat = op.combat; break;
    }
  }
  function sanitizeOp(op){
    if(!op || typeof op!=='object') return null;
    switch(op.op){
      case 'token-upsert': return op.token ? {op:op.op, token:sanitizeToken(op.token)} : null;
      case 'token-remove': return {op:op.op, id:String(op.id)};
      case 'drawing-add': { const d = sanitizeDrawing(op.drawing); return d ? {op:op.op, drawing:d, index:op.index} : null; }
      case 'drawing-remove': return {op:op.op, ids:(op.ids||[]).map(String)};
      case 'drawings-set': return {op:op.op, drawings:(op.drawings||[]).map(sanitizeDrawing).filter(Boolean)};
      case 'map-set': return {op:op.op, map:sanitizeMap(op.map)};
      case 'combat-set': return {op:op.op, combat:sanitizeCombat(op.combat)};
    }
    return null;
  }
  // Скрытый жетон для игроков не существует вовсе: его upsert уходит им как remove, в снимок не попадает
  function playerOps(ops){
    return ops.map(op=>{
      if(op.op==='combat-set') return {op:'combat-set', combat:publicCombat(op.combat)};
      if(op.op!=='token-upsert') return op;
      return op.token.hidden ? {op:'token-remove', id:op.token.id} : {op:'token-upsert', token:publicToken(op.token)}; // без секретных боевых полей
    });
  }
  function playerSnapshot(){
    const s = authState, tokens = {};
    Object.values(s.tokens).forEach(t=>{ if(!t.hidden) tokens[t.id] = publicToken(t); });
    return {schema:1, tableId:s.tableId, version:s.version, map:s.map, tokens, drawings:s.drawings, zones:s.zones, combat:publicCombat(s.combat)};
  }
  function sendSnapshot(toId){ if(role()==='gm') sendMsg({type:'gt-snapshot', state:playerSnapshot()}, toId); }

  function execCommand(cmd, from){ // from — id игрока для чужой команды, пусто для своей
    if(!cmd || typeof cmd!=='object') return {ok:false, reason:'Пустая команда'};
    const s = authState, remote = !!from, ops = [];
    const deny = (reason)=>({ok:false, reason});
    switch(cmd.c){
      case 'player-token-create': {
        const ownerId = remote ? from : String(cmd.ownerId || myOwnerId() || '');
        if(!ownerId) return deny('Не удалось определить игрока');
        if(Object.values(s.tokens).some(t=>t.kind==='player' && t.ownerId===ownerId)) return deny('Жетон этого игрока уже на поле');
        const p = session.players && session.players[ownerId];
        const name = ownerId===myOwnerId() ? ownCharacterName() : (playerDisplayName(p) || 'Игрок');
        ops.push({op:'token-upsert', token:sanitizeToken({id:newId('t'), kind:'player', ownerId, x:cmd.x, y:cmd.y,
          size:'normal', color:colorForOwner(ownerId), name})});
        break;
      }
      case 'token-create': {
        if(remote) return deny('Создавать жетоны может только Мастер');
        ops.push({op:'token-upsert', token:sanitizeToken(Object.assign({}, cmd.token, {id:newId('t'), kind:'gm'}))});
        break;
      }
      case 'token-move': {
        if(remote && paused) return deny('Стоп-кадр: Мастер поставил игру на паузу');
        let denied = false;
        (Array.isArray(cmd.moves) ? cmd.moves : []).slice(0,100).forEach(m=>{
          const t = m && s.tokens[m.id];
          if(!t) return;
          if(remote && !(t.kind==='player' && t.ownerId===from)){ denied = true; return; }
          ops.push({op:'token-upsert', token:sanitizeToken(Object.assign({}, t, {x:m.x, y:m.y}))});
        });
        if(!ops.length) return deny(denied ? 'Можно двигать только свой жетон' : 'Жетон не найден');
        break;
      }
      case 'token-update': {
        if(remote) return deny('Менять жетоны может только Мастер');
        const t = s.tokens[cmd.id];
        if(!t) return deny('Жетон не найден');
        const patch = {};
        ['name','hp','hpMax','hpShown','size','color','hidden','avatar','rotation','marks','nature',
         'defense','defenseSubs','zoneDef','armorName','weaponText','attackMod','attackModEnabled','unprotectedEnabled','unprotectedMod','traumaThreshold','trauma','traumaRed','strength','slowReaction','burning','reflexes','grenade','atkSkill','creature']
          .forEach(k=>{ if(cmd.patch && k in cmd.patch) patch[k] = cmd.patch[k]; });
        ops.push({op:'token-upsert', token:sanitizeToken(Object.assign({}, t, patch))});
        break;
      }
      case 'token-delete': {
        if(remote) return deny('Удалять жетоны может только Мастер');
        (cmd.ids||[]).forEach(id=>{ if(s.tokens[id]) ops.push({op:'token-remove', id}); });
        break;
      }
      case 'combat-set': {
        if(remote) return deny('Вести бой может только Мастер');
        ops.push({op:'combat-set', combat:sanitizeCombat(cmd.combat)});
        break;
      }
      case 'combat-mark': { // игрок отмечает своё действие/реакцию
        const c0 = s.combat, t = s.tokens[cmd.id];
        if(!c0 || !t || !c0.parts[cmd.id]) return deny('Этот жетон не участвует в бою');
        if(remote && !(t.kind==='player' && t.ownerId===from)) return deny('Отмечать можно только себя');
        if(['act','react','swap'].indexOf(cmd.field)<0) return deny('Неизвестная отметка');
        const c1 = clone(c0); c1.parts[cmd.id][cmd.field] = !!cmd.value;
        ops.push({op:'combat-set', combat:sanitizeCombat(c1)});
        break;
      }
      case 'drawing-add': case 'drawing-remove': case 'drawings-set': case 'map-set': {
        if(remote) return deny('Рисовать может только Мастер');
        const op = sanitizeOp(Object.assign({}, cmd, {op:cmd.c}));
        if(op) ops.push(op);
        break;
      }
      default: return deny('Неизвестная команда');
    }
    if(!ops.length) return deny('Нечего менять');
    commit(ops);
    return {ok:true, ops};
  }
  function commit(ops){
    ops.forEach(op=>applyOp(authState, op));
    authState.version++;
    scheduleSave();
    afterOps(ops);
    if(role()==='gm') sendMsg({type:'gt-update', tableId:authState.tableId, version:authState.version, ops:playerOps(ops)});
  }
  function afterOps(ops){
    let draw = false, bg = false;
    ops.forEach(op=>{
      if(op.op==='token-upsert'){ delete pendingPos[op.token.id]; delete previewPos[op.token.id]; }
      if(op.op==='token-remove'){ selected.delete(op.id); }
      if(op.op.indexOf('drawing')===0) draw = true;
      if(op.op==='map-set') bg = true;
    });
    if(bg) checkSceneChange();
    renderTokens();
    requestRender({draw, bg, fx:true});
    if(ops.some(op=>op.op==='combat-set')) renderCombat();
    if(ops.some(op=>op.op==='combat-set' && !op.combat)) firstDmgSeen = {}; // бой закончен — «первый урон в бою» снова доступен
    if(typeof Bestiary!=='undefined') Bestiary.onTableChanged(); // открытая карточка существа — свежие ОЗ, травмы, оружие
  }
  // Своё действие: авторитет применяет сразу, игрок отправляет Мастеру
  function act(cmd){
    if(isAuthority()){
      const r = execCommand(cmd);
      if(!r.ok) toast(r.reason);
      return r.ok;
    }
    if(!session.gmId){ toast('Мастер не в сети — действие не отправлено'); return false; }
    sendMsg({type:'gt-command', cmd}, session.gmId);
    return true;
  }

  /* ---------- приём сообщений ---------- */
  let lastSnapshotRequest = 0;
  function requestSnapshot(){
    if(!isPlayer() || !session.gmId) return;
    const now = Date.now();
    if(now - lastSnapshotRequest < 1500) return;
    lastSnapshotRequest = now;
    sendMsg({type:'gt-request', name:session.ownName}, session.gmId);
  }
  function fromGm(msg){ return isPlayer() && !!msg.from && msg.from===session.gmId; }
  let awaitingOwnToken = false;
  function handleMessage(msg){
    const from = msg.from;
    if(sandbox){ // учебный стол: сообщения настоящего стола не применяем; ходы игроков Мастеру — отказ с объяснением
      if(msg.type==='gt-command' && session.role==='gm' && from) sendMsg({type:'gt-reject', reason:'Мастер сейчас в обучении — повторите через минуту'}, from);
      return;
    }
    switch(msg.type){
      case 'gt-snapshot': {
        if(!fromGm(msg) || !msg.state) return;
        const s = normalizeState(msg.state, null);
        if(s.tableId===viewState.tableId && s.version < viewState.version) return; // более старый снимок поверх нового не принимаем
        viewState = s;
        Object.keys(pendingPos).forEach(k=>delete pendingPos[k]);
        scheduleCacheSave();
        checkSceneChange();
        renderTokens(); requestRender({bg:true, draw:true, fx:true});
        break;
      }
      case 'gt-update': {
        if(!fromGm(msg)) return;
        const v = Math.floor(num(msg.version, -1));
        if(msg.tableId!==viewState.tableId){ requestSnapshot(); return; }
        if(v <= viewState.version) return;               // уже видели
        if(v !== viewState.version+1){ requestSnapshot(); return; } // пропустили обновление — целиком снимок
        const ops = (Array.isArray(msg.ops) ? msg.ops : []).map(sanitizeOp).filter(Boolean);
        ops.forEach(op=>applyOp(viewState, op));
        viewState.version = v;
        scheduleCacheSave();
        afterOps(ops);
        if(awaitingOwnToken){ const mine = ownToken(); if(mine){ awaitingOwnToken = false; selected.clear(); selected.add(mine.id); renderTokens(); } }
        break;
      }
      case 'gt-command': {
        if(role()!=='gm' || !from || !msg.cmd) return;
        const r = execCommand(msg.cmd, from);
        if(!r.ok) sendMsg({type:'gt-reject', reason:r.reason}, from);
        break;
      }
      case 'gt-reject': {
        if(!fromGm(msg)) return;
        Object.keys(pendingPos).forEach(k=>{ delete pendingPos[k]; refreshTokenPos(k); });
        awaitingOwnToken = false;
        toast(String(msg.reason||'Мастер отклонил действие').slice(0,120));
        break;
      }
      case 'gt-request': {
        if(role()!=='gm' || !from) return;
        // Игрок, подключённый ещё до перезагрузки Мастера, не присылает player-hello заново — без этого
        // его sheet-snapshot у Мастера отбрасывался бы (нет записи в session.players)
        if(!session.players[from]){
          session.players[from] = {name:String(msg.name||'Игрок').slice(0,60), character:null, extra:null};
          if(typeof addToXpRoster==='function') addToXpRoster(from, session.players[from].name);
          if(typeof renderPlayersList==='function') renderPlayersList();
        }
        sendSnapshot(from);
        sendMsg({type:'gt-vitals', vitals:computeVitals()}, from);
        break;
      }
      case 'gt-vitals': if(fromGm(msg)){ remoteVitals = msg.vitals && typeof msg.vitals==='object' ? msg.vitals : {}; renderTokens(); } break;
      case 'gt-portraits': if(fromGm(msg) && msg.portraits && typeof msg.portraits==='object'){ const o = {}; Object.keys(msg.portraits).slice(0, 40).forEach(k=>{ if(validPortrait(msg.portraits[k])) o[k] = msg.portraits[k]; }); remotePortraits = o; renderTokens(); } break;
      case 'gt-ping': case 'gt-pointer': case 'gt-drag': handleTransient(msg); break;
      case 'gt-rx': case 'gt-rxcfg': case 'gt-rxreq': if(typeof Reactions!=='undefined') Reactions.handle(msg, fromGm(msg)); break; // реакции на жетонах
      case 'gt-attack': { // игрок прислал бросок атаки — считает Мастер (см. resolveAttack)
        if(role()!=='gm' || !from || !msg.req || typeof msg.req!=='object') return;
        const res = resolveAttack(msg.req, from);
        if(!res.ok){ sendMsg({type:'gt-reject', reason:res.reason}, from); return; }
        sendMsg({type:'gt-attack-result', attackId:String(msg.req.attackId), success:res.success, jammed:res.jammed, speedUsed:res.speedUsed,
          extra:(res.extra || []).map(x=>({weaponIdx:x.weaponIdx, ok:!!x.ok, speedUsed:!!x.speedUsed, reason:String(x.reason || '').slice(0, 120)}))}, from);
        break;
      }
      case 'gt-attack-result': if(fromGm(msg)) afterAttackResult(String(msg.attackId), {success:!!msg.success, jammed:!!msg.jammed, speedUsed:!!msg.speedUsed,
        extra:(Array.isArray(msg.extra) ? msg.extra : []).slice(0, 4).map(x=>({weaponIdx:x && (x.weaponIdx===0 || x.weaponIdx===1) ? x.weaponIdx : null, ok:!!(x && x.ok), speedUsed:!!(x && x.speedUsed), reason:String(x && x.reason || '').slice(0, 120)}))}); break;
    }
  }

  /* ---------- временные события: DataChannel + WS как запасной путь ---------- */
  let tSeqCounter = 0;
  function nextSeq(){ tSeqCounter = (tSeqCounter+1) % 1000; return Date.now()*1000 + tSeqCounter; }
  const gates = {};
  function gated(key, ms, fn){ // не чаще раза в ms, с отложенным последним вызовом (финальная точка не теряется)
    const g = gates[key] || (gates[key] = {last:0, timer:null, fn:null});
    const now = performance.now();
    g.fn = fn;
    if(now - g.last >= ms){ g.last = now; clearTimeout(g.timer); g.timer = null; g.fn = null; fn(); return; }
    if(!g.timer) g.timer = setTimeout(()=>{ g.timer = null; g.last = performance.now(); const f = g.fn; g.fn = null; if(f) f(); }, ms - (now - g.last));
  }
  function sendTransient(ev, wsMs){
    ev.seq = nextSeq();
    const e2 = Object.assign({}, ev);
    gated('dc:'+ev.type, 30, ()=>{ try{ RoomTransport.sendGameEvent(e2); }catch(e){} });
    if(role()) gated('ws:'+ev.type, wsMs||0, ()=>sendMsg(e2));
  }
  const lastSeq = {}, seenPings = new Set();
  function handleTransient(msg){
    const from = msg.from;
    if(!from || from===session.myId) return;
    const key = from+'|'+msg.type;
    if(msg.type==='gt-ping'){
      if(!msg.eid || seenPings.has(msg.eid)) return;
      seenPings.add(msg.eid); if(seenPings.size>300) seenPings.clear();
      addPing(num(msg.x,0), num(msg.y,0), safeColor(msg.color, PALETTE[0]), String(msg.name||'').slice(0,40));
      return;
    }
    const seq = num(msg.seq, 0);
    if(lastSeq[key] && seq <= lastSeq[key]) return; // пришло позже более свежего (DC и WS обгоняют друг друга)
    lastSeq[key] = seq;
    if(msg.type==='gt-pointer'){
      if(!isPlayer() || from!==session.gmId) return; // указка — только от Мастера
      gmPointer = msg.off ? null : {x:num(msg.x,0), y:num(msg.y,0), t:performance.now()};
      requestRender({fx:true});
    } else if(msg.type==='gt-drag'){
      (Array.isArray(msg.moves) ? msg.moves : []).slice(0,100).forEach(m=>{
        const t = m && tok(m.id);
        if(!t || !tokenVisibleHere(t)) return;
        // Мастер может показывать движение любого (видимого) жетона, игрок — только своего
        const senderIsGm = isPlayer() && from===session.gmId;
        const senderOwns = t.kind==='player' && t.ownerId===from;
        if(!senderIsGm && !senderOwns) return;
        if(dragPos[t.id]) return; // сами сейчас держим этот жетон
        previewPos[t.id] = {x:num(m.x,t.x), y:num(m.y,t.y), t:performance.now()};
        refreshTokenPos(t.id);
      });
      requestRender({fx:true});
    }
  }

  /* ---------- камера ---------- */
  let camNeedsCenter = false;
  let cam = (function(){
    const c = loadJson(CAMERA_KEY);
    if(c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z)) return {x:c.x, y:c.y, z:clamp(c.z, ZOOM_MIN, ZOOM_MAX)};
    camNeedsCenter = true; // первый показ — начало координат в центр поля (размер поля ещё неизвестен)
    return {x:0, y:0, z:1};
  })();
  let camTimer = null;
  function toWorld(p){ return {x:(p.x-cam.x)/(CELL*cam.z), y:(p.y-cam.y)/(CELL*cam.z)}; }
  function toScreen(w){ return {x:cam.x + w.x*CELL*cam.z, y:cam.y + w.y*CELL*cam.z}; }
  function applyCamera(){
    layer.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;
    layer.style.setProperty('--gt-inv', (1/cam.z).toFixed(4));
    const zl = document.getElementById('gtZoomLabel');
    if(zl) zl.textContent = Math.round(cam.z*100)+'%';
    requestRender({bg:true, draw:true, fx:true});
    if(camNeedsCenter || sandbox) return; // ещё не центрировали по реальному размеру поля (или учебный стол) — такую камеру не запоминаем
    clearTimeout(camTimer);
    camTimer = setTimeout(()=>{ camTimer = null; saveJson(CAMERA_KEY, cam); }, 400);
  }
  function zoomAt(px, py, z){
    z = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const w = toWorld({x:px, y:py});
    cam.z = z; cam.x = px - w.x*CELL*z; cam.y = py - w.y*CELL*z;
    applyCamera();
  }
  function zoomStep(dir){
    const cur = cam.z;
    let z = dir>0 ? ZOOM_STEPS.find(s=>s>cur+0.001) : ZOOM_STEPS.slice().reverse().find(s=>s<cur-0.001);
    if(z===undefined) z = dir>0 ? ZOOM_MAX : ZOOM_MIN;
    zoomAt(vw/2, vh/2, z);
  }
  function centerOn(wx, wy){ cam.x = vw/2 - wx*CELL*cam.z; cam.y = vh/2 - wy*CELL*cam.z; applyCamera(); }
  function centerOnTokens(){
    const ts = Object.values(st().tokens).filter(tokenVisibleHere);
    if(!ts.length){ centerOn(0,0); return; }
    const xs = ts.map(t=>t.x), ys = ts.map(t=>t.y);
    centerOn((Math.min(...xs)+Math.max(...xs))/2, (Math.min(...ys)+Math.max(...ys))/2);
  }

  /* ---------- DOM / локальное состояние интерфейса ---------- */
  let viewport, layer, bgC, drC, fxC, bgX, drX, fxX, toolbar, subbar, zoombar, statusEl, infoCard, hintEl, toastEl, menuEl, popEl, emptyHint;
  let vw = 0, vh = 0, dpr = 1, visible = false;
  let tool = 'select', drawTool = 'pen';
  let drawStyle = Object.assign({color:DRAW_COLORS[0], width:4, opacity:1}, loadJson(STYLE_KEY)||{});
  const selected = new Set();
  const tokenEls = new Map();
  const dragPos = {};     // id -> {x,y}   своё текущее перетаскивание (ещё не отправлено)
  const pendingPos = {};  // id -> {x,y,t} (игрок) отправлено Мастеру, ждём подтверждения
  const previewPos = {};  // id -> {x,y,t} чужое «живое» перетаскивание
  let interaction = null, placing = null, ruler = null, polyDraft = null, eraseIds = null;
  let pings = [], gmPointer = null, pointerBroadcast = false;
  let undoStack = [], redoStack = [];
  let spaceHeld = false, lastRole = undefined, lastMouse = null;
  const touches = new Map();
  let pinch = null;

  function colorForOwner(id){ let h = 0; String(id).split('').forEach(ch=>{ h = (h*31 + ch.charCodeAt(0))>>>0; }); return PALETTE[h % PALETTE.length]; }
  function initials(name){
    const parts = String(name||'?').trim().split(/\s+/).filter(Boolean);
    const s = parts.length>1 ? parts[0][0]+parts[1][0] : (parts[0]||'?').slice(0,2);
    return s.toUpperCase();
  }
  function tokenName(t, v){ return (v && v.name) || t.name || (t.kind==='player' ? 'Игрок' : 'Жетон'); }
  function offlineText(t){
    if(t.ownerId===myOwnerId()) return 'нет персонажа';
    if(role()==='gm') return session.players[t.ownerId] ? 'ждём лист' : 'не в сети';
    return 'нет данных';
  }
  function displayPos(t){ return dragPos[t.id] || pendingPos[t.id] || previewPos[t.id] || t; }

  /* ---------- жетоны (HTML-слой) ---------- */
  function renderTokens(){
    if(!visible) return;
    const s = st(), seen = new Set();
    Object.values(s.tokens).forEach(t=>{
      if(!tokenVisibleHere(t)) return;
      seen.add(t.id);
      let el = tokenEls.get(t.id);
      if(!el){
        el = document.createElement('div');
        el.className = 'gt-token';
        el.dataset.id = t.id;
        tokenEls.set(t.id, el);
        layer.appendChild(el);
      }
      updateTokenEl(el, t);
    });
    tokenEls.forEach((el, id)=>{ if(!seen.has(id)){ el.remove(); tokenEls.delete(id); selected.delete(id); } });
    emptyHint.style.display = seen.size || st().drawings.length || (st().map && (st().map.scene || st().map.background)) ? 'none' : '';
    renderInfoCard();
    renderCombat();
  }
  function positionTokenEl(el, t){
    const pos = displayPos(t), sz = SIZE_CELLS[t.size]*CELL;
    el.style.width = el.style.height = sz+'px';
    el.style.transform = `translate(${pos.x*CELL - sz/2}px,${pos.y*CELL - sz/2}px)`;
  }
  function updateTokenEl(el, t){
    positionTokenEl(el, t);
    el.classList.toggle('selected', selected.has(t.id));
    el.classList.toggle('movable', canControl(t));
    el.classList.toggle('hidden-tok', !!t.hidden);
    el.classList.toggle('dragging', !!dragPos[t.id]);
    { const cbs = st().combat, cbp = cbs && cbs.parts[t.id];
      el.classList.toggle('cb-on', !!cbp && cbs.order[cbs.turn]===cbp.side);
      el.classList.toggle('cb-done', !!cbp && (cbp.act || cbp.swap || cbp.noAct));
      el.classList.toggle('cb-noact', !!cbp && cbp.noAct); }
    const v = vitalsFor(t);
    const pf = portraitFor(t);
    const key = JSON.stringify([t.name, t.color, t.avatar, pf ? pf.length + pf.slice(-16) : '', t.hp, t.hpMax, t.hpShown, t.hpFrac, isAuthority(), t.kind, t.hidden, t.size, t.rotation, t.trauma, t.traumaRed, t.nature, t.slowReaction, t.burning, JSON.stringify(t.marks || []), v && [v.name, v.hp, v.hpMax, v.psi, v.psiMax], tokenEncumbrance(t)]); // «Скован» зависит от листа / карточки
    if(el._gtKey===key) return;
    el._gtKey = key;
    const name = tokenName(t, v), sz = SIZE_CELLS[t.size]*CELL;
    const av = t.avatar || portraitFor(t);
    const face = av
      ? `<img src="${escapeHtml(av)}" alt="" draggable="false" referrerpolicy="no-referrer">`
      : `<span style="font-size:${Math.round(sz*0.36)}px">${escapeHtml(initials(name))}</span>`;
    let stats = '';
    const fmt = (a)=> (a===null || a===undefined || a==='') ? '—' : escapeHtml(String(a));
    if(t.kind==='player'){
      stats = v ? `<span class="gt-stats"><span class="gt-hp${Number(v.hp)<=0?' down':''}">♥ ${fmt(v.hp)} / ${fmt(v.hpMax)}</span><span class="gt-psi">✦ ${fmt(v.psi)} / ${fmt(v.psiMax)}</span></span>`
                : `<span class="gt-off">${offlineText(t)}</span>`;
    } else if(t.hp!==null && t.hp!==undefined){
      // у Мастера — число всегда (⊘ — игрокам не видно), у игроков — только если Мастер открыл
      stats = `<span class="gt-stats"><span class="gt-hp${t.hp<=0?' down':''}" title="${t.hpShown ? 'ОЗ видны игрокам' : 'ОЗ скрыты от игроков — им видно только кольцо'}">♥ ${fmt(t.hp)}${t.hpMax ? ' / ' + fmt(t.hpMax) : ''}${t.hpShown ? '' : ' <i class="gt-hp-secret">⊘</i>'}</span></span>`;
    }
    const hf = hpRingFrac(t, v);
    const ring = hf===null ? '' : `<i class="gt-hp-ring" style="--hpf:${hf}"></i>`;
    el.innerHTML = `<div class="gt-token-disc${hf===null ? '' : ' has-ring'}" style="--tok:${t.color};--rot:${t.rotation||0}deg">${face}${ring}</div>`+
      (t.hidden ? '<i class="gt-hidden-badge" title="Скрыт от игроков">⊘</i>' : '')+
      `<div class="gt-token-label"><b>${escapeHtml(name)}</b>${stats}${traumaBadgesHtml(t)}</div>`;
  }
  // «Скован»: броня сковывает — у игрока надетая броня из листа, у существа — броня из карточки, у жетона без карточки — броня из
  // каталога в поле «Броня»; считается при отрисовке там, где лист или карточка известны (у Мастера — всё, у игрока — свой жетон)
  function tokenEncumbrance(t){
    if(t.kind==='player') return typeof characterEncumbrance==='function' ? characterEncumbrance(attackerSheet(t)) : null;
    if(t.creature) return typeof Bestiary!=='undefined' && Bestiary.encumbrance ? Bestiary.encumbrance(t) : null;
    if(!t.armorName) return null;
    const nm = String(t.armorName).toLowerCase();
    for(const gen of Object.values(ITEM_CATALOG)) for(const it of ((gen.categories.armor || {}).items || [])){
      if(nm.indexOf(it.name.toLowerCase())===0) return armorEncumbers(it.desc, t.strength==null ? 3 : t.strength) ? it.name : null; }
    return null;
  }
  // Травмы под жетоном: 🦴N — обычные, красная 🦴M — от оружия с чертой «травма» (см. resolveAttack)
  function traumaBadgesHtml(t){
    const enc = tokenEncumbrance(t);
    if(!t.trauma && !t.traumaRed && !t.slowReaction && !t.burning && !(t.marks && t.marks.length) && !enc) return '';
    const rb = tokenNature(t)==='robot';
    const marks = (t.marks || []).map(m=>`<span class="gt-mark-badge" title="${MARKS[m.k]}${m.r ? ': ещё ' + m.r + ' кр.' : ' — пока не снимут'}">${MARKS[m.k]}${m.r ? ' ' + m.r : ''}</span>`).join('')
      + (enc ? `<span class="gt-mark-badge" title="Сковывает: ${escapeHtml(enc)} (сила ниже нужной)">Скован</span>` : '');
    return `<span class="gt-trauma-row">${marks}${t.burning?`<span class="gt-burn-badge" title="Горит (термическая граната): кругов">🔥${t.burning}</span>`:""}${t.slowReaction?'<span class="gt-slow-badge" title="Атакован медленным оружием — может отреагировать">⚡ реакция</span>':''}${t.trauma?`<span title="${rb ? 'Поломки' : 'Травмы'}">${rb ? '🔧' : '🦴'}${t.trauma}</span>`:''}${t.traumaRed?`<span class="bone-red" title="${rb ? 'Поломки' : 'Травмы'} от оружия с чертой «травма»">${rb ? '🔧' : '🦴'}</span><span class="gt-trauma-red-n">${t.traumaRed}</span>`:''}</span>`;
  }
  function refreshTokenPos(id){ const el = tokenEls.get(id), t = tok(id); if(el && t){ positionTokenEl(el, t); el.classList.toggle('dragging', !!dragPos[id]); } }
  function setSelection(ids){ selected.clear(); ids.forEach(id=>selected.add(id)); tokenEls.forEach((el,id)=>el.classList.toggle('selected', selected.has(id))); renderInfoCard(); }
  function renderInfoCard(){
    if(selected.size!==1){ infoCard.style.display = 'none'; return; }
    const t = tok([...selected][0]);
    if(!t){ infoCard.style.display = 'none'; return; }
    const v = vitalsFor(t);
    const kindTxt = t.kind==='player' ? 'Игрок' : 'Жетон Мастера';
    let stats = '';
    if(t.kind==='player') stats = v ? `<span class="hp">HP ${escapeHtml(String(v.hp))} / ${escapeHtml(String(v.hpMax))}</span><span class="psi">Psi ${escapeHtml(String(v.psi))} / ${escapeHtml(String(v.psiMax))}</span>` : '<span class="muted">лист недоступен</span>';
    else if(t.hp!==null && t.hp!==undefined) stats = `<span class="hp">HP ${escapeHtml(String(t.hp))}${t.hpMax ? ' / ' + escapeHtml(String(t.hpMax)) : ''}${t.hpShown ? '' : ' · скрыто от игроков'}</span>`;
    else if(t.hpFrac!==null && t.hpFrac!==undefined) stats = `<span class="hp">${t.hpFrac<=0 ? 'повержен' : t.hpFrac>=1 ? 'невредим' : t.hpFrac>0.5 ? 'ранен' : t.hpFrac>0.25 ? 'тяжело ранен' : 'при смерти'}</span>`;
    // Мастеру — ещё и боевые характеристики (игрокам они не приходят вовсе, см. publicToken)
    let combat = '';
    if(isAuthority() && t.kind==='gm'){
      const ws = t.weaponText ? parseWeaponStats(t.weaponText) : null;
      combat = `<div class="gt-ic-sub" style="margin-top:4px">Защита ${t.defense}${Object.keys(t.defenseSubs||{}).length?' ('+Object.keys(t.defenseSubs).map(k=>k+t.defenseSubs[k]).join(', ')+')':''}` +
        ` · ${ws ? escapeHtml(ws.cleanName)+` (Ат${ws.at>=0?'+':''}${ws.at}, МУ${ws.mu})` : 'без оружия'} · ${({void:'пустота — без травм', robot:'робот — поломка-к12 ' + t.traumaThreshold})[tokenNature(t)] || 'травма-к12 ' + t.traumaThreshold}</div>`;
    }
    const bones = (t.trauma||t.traumaRed||t.slowReaction||t.burning) ? `<div class="gt-ic-sub">${traumaBadgesHtml(t)}</div>` : '';
    infoCard.innerHTML = `<div class="gt-ic-sub">${kindTxt} · ${SIZE_LABELS[t.size]}${t.hidden?' · скрыт':''}</div><div class="gt-ic-name">${escapeHtml(tokenName(t, v))}</div>`+
      (stats ? `<div class="gt-ic-stats">${stats}</div>` : '') + bones + combat;
    infoCard.style.display = 'block';
  }

  /* ---------- canvas: фон/сетка, зоны+рисунки, временное ---------- */
  let rq = null;
  const dirty = {bg:false, draw:false, fx:false};
  function requestRender(f){
    if(f){ if(f.bg) dirty.bg = true; if(f.draw) dirty.draw = true; if(f.fx) dirty.fx = true; }
    if(!rq) rq = requestAnimationFrame(flush);
  }
  function flush(){
    rq = null;
    if(!visible || !vw) return;
    if(dirty.bg){ dirty.bg = false; drawBackground(); }
    if(dirty.draw){ dirty.draw = false; drawDrawings(); }
    if(dirty.fx){ dirty.fx = false; drawFx(); }
  }
  function resize(){
    if(!viewport) return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if(!w || !h) return;
    dpr = window.devicePixelRatio || 1; vw = w; vh = h;
    [bgC, drC, fxC].forEach(c=>{ c.width = Math.round(w*dpr); c.height = Math.round(h*dpr); c.style.width = w+'px'; c.style.height = h+'px'; });
    if(camNeedsCenter && visible){ camNeedsCenter = false; centerOn(0, 0); }
    if(visible && (focusPending || Date.now() < focusUntil)) applySceneFocus();
    requestRender({bg:true, draw:true, fx:true});
  }
  function setWorldTransform(ctx){ const k = CELL*cam.z*dpr; ctx.setTransform(k,0,0,k, cam.x*dpr, cam.y*dpr); }
  const bgImages = {};
  function drawBackground(){
    const ctx = bgX;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = '#efe6cc';
    ctx.fillRect(0,0,vw,vh);
    // Задел под карту-подложку: только ссылка на картинку (не base64 через WebSocket)
    const bg = st().map && st().map.background;
    if(bg){
      let img = bgImages[bg.url];
      if(!img){ img = bgImages[bg.url] = new Image(); img.referrerPolicy = 'no-referrer'; img.onload = ()=>requestRender({bg:true}); img.src = bg.url; }
      if(img.complete && img.naturalWidth){
        const p = toScreen({x:bg.x, y:bg.y}), w = bg.w*CELL*cam.z, h = w*img.naturalHeight/img.naturalWidth;
        ctx.drawImage(img, p.x, p.y, w, h);
      }
    }
    // Карта из редактора: тот же MapRender, мир = клетки, её (0,0) — в клетке (scene.x, scene.y) стола
    const sc = st().map && st().map.scene;
    if(sc && typeof MapStore!=='undefined'){
      const md = MapStore.sceneDoc(sc, ()=>requestRender({bg:true}));
      if(md){
        const k = CELL*cam.z;
        ctx.save();
        ctx.setTransform(k*dpr, 0, 0, k*dpr, (cam.x + sc.x*k)*dpr, (cam.y + sc.y*k)*dpr);
        MapRender.drawMap(ctx, md, {k, view:{x0:-cam.x/k - sc.x, y0:-cam.y/k - sc.y, x1:(vw - cam.x)/k - sc.x, y1:(vh - cam.y)/k - sc.y}});
        ctx.restore();
      }
    }
    const step = CELL*cam.z;
    const x0 = Math.floor(-cam.x/step), x1 = Math.ceil((vw-cam.x)/step);
    const y0 = Math.floor(-cam.y/step), y1 = Math.ceil((vh-cam.y)/step);
    const minorA = cam.z < 0.5 ? 0.09 : 0.15;
    for(let pass=0; pass<2; pass++){
      ctx.beginPath();
      for(let i=x0; i<=x1; i++){ if((i%5===0)!==(pass===1)) continue; const x = Math.round(cam.x+i*step)+0.5; ctx.moveTo(x,0); ctx.lineTo(x,vh); }
      for(let j=y0; j<=y1; j++){ if((j%5===0)!==(pass===1)) continue; const y = Math.round(cam.y+j*step)+0.5; ctx.moveTo(0,y); ctx.lineTo(vw,y); }
      ctx.strokeStyle = pass ? 'rgba(28,23,18,.28)' : `rgba(28,23,18,${minorA})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Мягкая виньетка по краям — поле читается как лист, а не как бесконечная таблица
    const g = ctx.createRadialGradient(vw/2, vh/2, Math.min(vw,vh)*0.35, vw/2, vh/2, Math.max(vw,vh)*0.75);
    g.addColorStop(0, 'rgba(92,82,64,0)'); g.addColorStop(1, 'rgba(92,82,64,.16)');
    ctx.fillStyle = g; ctx.fillRect(0,0,vw,vh);
  }
  function drawZones(/*ctx*/){ /* задел: зоны (опасность/эффект/запрет/шум/…) и AoE рисуются здесь, под рисунками */ }
  function drawDrawings(){
    const ctx = drX;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,drC.width,drC.height);
    drawZones(ctx);
    st().drawings.forEach(d=>{ if(eraseIds && eraseIds.has(d.id)) return; drawShape(ctx, d); });
  }
  function drawShape(ctx, d){
    const pts = d.points;
    if(!pts || !pts.length) return;
    ctx.save();
    const op = d.opacity==null ? 1 : d.opacity;
    ctx.globalAlpha = op;
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if(d.type==='text'){
      const p = toScreen({x:pts[0][0], y:pts[0][1]}), fs = d.fontSize*cam.z;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.font = `700 ${fs}px 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, fs*0.16);
      ctx.strokeStyle = d.color.toLowerCase()==='#f6ecd4' ? 'rgba(28,23,18,.85)' : 'rgba(239,230,204,.9)';
      String(d.text).split('\n').forEach((line, i)=>{ ctx.strokeText(line, p.x, p.y+i*fs*1.2); ctx.fillText(line, p.x, p.y+i*fs*1.2); });
      ctx.restore();
      return;
    }
    setWorldTransform(ctx);
    ctx.lineWidth = d.width/CELL;
    const a = pts[0], b = pts[pts.length-1];
    ctx.beginPath();
    switch(d.type){
      case 'pen':
        ctx.moveTo(a[0], a[1]);
        if(pts.length===1) ctx.lineTo(a[0]+0.0001, a[1]);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        break;
      case 'line': case 'arrow': {
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if(d.type==='arrow'){
          const ang = Math.atan2(b[1]-a[1], b[0]-a[0]), hl = Math.max(14, d.width*3.2)/CELL;
          ctx.beginPath();
          ctx.moveTo(b[0], b[1]);
          ctx.lineTo(b[0]-hl*Math.cos(ang-0.42), b[1]-hl*Math.sin(ang-0.42));
          ctx.lineTo(b[0]-hl*Math.cos(ang+0.42), b[1]-hl*Math.sin(ang+0.42));
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
      }
      case 'rect':
        ctx.rect(Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
        ctx.globalAlpha = op*0.14; ctx.fill(); ctx.globalAlpha = op; ctx.stroke();
        break;
      case 'circle':
        ctx.arc(a[0], a[1], Math.hypot(b[0]-a[0], b[1]-a[1]), 0, Math.PI*2);
        ctx.globalAlpha = op*0.14; ctx.fill(); ctx.globalAlpha = op; ctx.stroke();
        break;
      case 'polygon':
        ctx.moveTo(a[0], a[1]);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
        if(pts.length>2){ ctx.closePath(); ctx.globalAlpha = op*0.14; ctx.fill(); ctx.globalAlpha = op; }
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  /* ---------- измерение: клетки × 3 м ---------- */
  function fmtNum(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  function plCells(n){
    if(!Number.isInteger(n)) return 'клетки';
    const a = n%10, b = n%100;
    if(a===1 && b!==11) return 'клетка';
    if(a>=2 && a<=4 && (b<12 || b>14)) return 'клетки';
    return 'клеток';
  }
  // opts.limitMeters — задел под будущую дальность движения ("15 / 18 м"), сейчас не передаётся
  function measureLabel(cells, opts){
    const mpc = (st().map && st().map.metersPerCell) || METERS_PER_CELL;
    const c = Math.round(cells*10)/10, m = Math.round(cells*mpc*10)/10;
    const meters = opts && opts.limitMeters ? `${fmtNum(m)} / ${fmtNum(opts.limitMeters)} м` : `${fmtNum(m)} м`;
    return `${fmtNum(c)} ${plCells(c)} · ${meters}`;
  }
  function pathLength(pts){ let s = 0; for(let i=1;i<pts.length;i++) s += Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); return s; }
  function pill(ctx, x, y, text, bg){
    ctx.font = "700 12px 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif";
    const w = ctx.measureText(text).width + 16, h = 22;
    let bx = x + 12, by = y - h - 8;
    if(bx + w > vw - 4) bx = x - w - 12;
    if(by < 4) by = y + 12;
    ctx.fillStyle = bg || 'rgba(28,23,18,.92)';
    ctx.beginPath();
    const r = h/2;
    ctx.moveTo(bx+r, by); ctx.lineTo(bx+w-r, by); ctx.arc(bx+w-r, by+r, r, -Math.PI/2, Math.PI/2); ctx.lineTo(bx+r, by+h); ctx.arc(bx+r, by+r, r, Math.PI/2, Math.PI*1.5);
    ctx.fill();
    ctx.fillStyle = '#f6ecd4'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx+8, by+h/2+0.5);
  }
  function strokePath(ctx, pts, color, dash){
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(239,230,204,.9)'; ctx.lineWidth = 6;
    ctx.beginPath(); pts.forEach((p,i)=> i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    if(dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }
  function dot(ctx, p, r, color){ ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#efe6cc'; ctx.stroke(); }

  function drawFx(){
    const ctx = fxX, now = performance.now();
    let animate = false;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,fxC.width,fxC.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // линейка (с промежуточными точками)
    if(ruler){
      const wp = ruler.points.concat(ruler.cur ? [ruler.cur] : []);
      const sp = wp.map(toScreen);
      strokePath(ctx, sp, '#9c2f1c', [8,6]);
      sp.forEach((p,i)=>dot(ctx, p, i===sp.length-1 ? 5 : 4, '#9c2f1c'));
      const last = sp[sp.length-1];
      pill(ctx, last.x, last.y, measureLabel(pathLength(wp)) + (ruler.points.length>1 ? ` · ${ruler.points.length} точ.` : ''));
    }
    // перетаскивание жетона: откуда → куда и сколько это метров
    if(interaction && interaction.type==='drag' && interaction.moved){
      const t = tok(interaction.primary), start = interaction.starts[interaction.primary], cur = dragPos[interaction.primary];
      if(t && start && cur){
        const a = toScreen(start), b = toScreen(cur);
        strokePath(ctx, [a,b], '#1c1712', [6,6]);
        dot(ctx, a, 4, '#1c1712');
        pill(ctx, b.x, b.y - SIZE_CELLS[t.size]*CELL*cam.z/2, measureLabel(Math.hypot(cur.x-start.x, cur.y-start.y)));
      }
    }
    if(targeting && targeting.cur){
      const att = tok(targeting.attackerId);
      if(att){
        const hov = targetUnder(att, targeting.cur);
        const end = hov ? {x:hov.x, y:hov.y} : targeting.cur;
        const ri = rangeInfo(att, hov || {x:end.x, y:end.y, size:'normal'}, targeting.w);
        const a = toScreen(att), b = toScreen(end);
        strokePath(ctx, [a,b], ri.ok ? '#9c2f1c' : '#5c5240', [8,5]);
        if(hov){ ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, SIZE_CELLS[hov.size]*CELL*cam.z/2 + 5, 0, Math.PI*2); ctx.strokeStyle = ri.ok ? '#9c2f1c' : '#5c5240'; ctx.lineWidth = 3; ctx.setLineDash([4,4]); ctx.stroke(); ctx.restore(); }
        if(hov && targeting.w.grenade){ // радиус взрыва/осколков вокруг цели
          const sp = targeting.w.spec, R = sp.thermal ? sp.thermal.radius : sp.frag.radius;
          ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, R/METERS_PER_CELL*CELL*cam.z, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(156,47,28,.10)'; ctx.fill(); ctx.strokeStyle = 'rgba(156,47,28,.75)'; ctx.lineWidth = 1.5; ctx.setLineDash([6,4]); ctx.stroke(); ctx.restore();
        }
        pill(ctx, b.x, b.y, `${fmtNum(ri.meters)} м · ${ri.label}`, ri.ok ? 'rgba(156,47,28,.92)' : 'rgba(92,82,64,.92)');
      }
    }
    if(abilityPick){
      const P = abilityPick, src = P.srcId ? tok(P.srcId) : null;
      const ring = (t, color, dash)=>{ const b = toScreen(t); ctx.save(); ctx.beginPath(); ctx.arc(b.x, b.y, SIZE_CELLS[t.size]*CELL*cam.z/2 + 5, 0, Math.PI*2); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash(dash); ctx.stroke(); ctx.restore(); };
      P.ids.forEach(id=>{ const t = tok(id); if(t) ring(t, '#9c2f1c', []); });
      if(P.cur){
        const hov = pickUnder(P.cur), end = hov ? {x:hov.x, y:hov.y} : P.cur;
        if(hov) ring(hov, '#9c2f1c', [4,4]);
        if(src){ const a = toScreen(src), b = toScreen(end), m = Math.round(Math.hypot(end.x - src.x, end.y - src.y)*METERS_PER_CELL*10)/10, far = P.rangeM && m > P.rangeM;
          strokePath(ctx, [a, b], far ? '#5c5240' : '#9c2f1c', [8,5]);
          pill(ctx, b.x, b.y, `${fmtNum(m)} м${P.rangeM ? ` · дальность ${P.rangeM} м${far ? ' — дальше' : ''}` : ''}`, far ? 'rgba(92,82,64,.92)' : 'rgba(156,47,28,.92)'); }
      }
    }
    if(placing && placing.cur){
      const t = tok(placing.ids[0]);
      if(t){ const a = toScreen(t), b = toScreen(placing.cur); strokePath(ctx, [a,b], '#1c1712', [6,6]); pill(ctx, b.x, b.y, measureLabel(Math.hypot(placing.cur.x-t.x, placing.cur.y-t.y))); }
    }
    // рамка выделения
    if(interaction && interaction.type==='box'){
      const a = interaction.start, b = interaction.cur;
      ctx.save();
      ctx.fillStyle = 'rgba(156,47,28,.08)'; ctx.strokeStyle = '#9c2f1c'; ctx.lineWidth = 1.5; ctx.setLineDash([5,4]);
      ctx.fillRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y));
      ctx.strokeRect(Math.min(a.x,b.x)+0.5, Math.min(a.y,b.y)+0.5, Math.abs(b.x-a.x), Math.abs(b.y-a.y));
      ctx.restore();
    }
    // черновик фигуры + размер в метрах (круг — радиус, удобно для будущих AoE)
    if(interaction && interaction.type==='shape'){
      const d = interaction.draft;
      drawShape(ctx, d);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if(d.type!=='pen' && d.points.length>1){
        const a = d.points[0], b = d.points[d.points.length-1], sb = toScreen({x:b[0], y:b[1]});
        let label;
        if(d.type==='rect') label = `${fmtNum(Math.abs(b[0]-a[0])*METERS_PER_CELL)} × ${fmtNum(Math.abs(b[1]-a[1])*METERS_PER_CELL)} м`;
        else if(d.type==='circle') label = 'радиус ' + measureLabel(Math.hypot(b[0]-a[0], b[1]-a[1]));
        else label = measureLabel(Math.hypot(b[0]-a[0], b[1]-a[1]));
        pill(ctx, sb.x, sb.y, label);
      }
    }
    if(polyDraft){
      const pts = polyDraft.points.concat(lastMouse ? [[lastMouse.x, lastMouse.y]] : []);
      drawShape(ctx, Object.assign({}, polyDraft.style, {type:'polygon', points:pts}));
      ctx.setTransform(dpr,0,0,dpr,0,0);
      polyDraft.points.forEach((p,i)=>dot(ctx, toScreen({x:p[0], y:p[1]}), i===0 ? 6 : 3.5, polyDraft.style.color));
    }
    // ping — расходящиеся кольца, живут ~1,7 с, в состояние стола не попадают
    pings = pings.filter(p=>now - p.t0 < PING_MS);
    pings.forEach(p=>{
      const s = toScreen(p), k = (now - p.t0)/PING_MS;
      for(let i=0;i<3;i++){
        const q = (k*1.6 - i*0.28);
        if(q<=0 || q>=1) continue;
        ctx.beginPath(); ctx.arc(s.x, s.y, 8 + q*46, 0, Math.PI*2);
        ctx.strokeStyle = p.color; ctx.globalAlpha = 1-q; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.globalAlpha = Math.max(0, 1 - k*k);
      dot(ctx, s, 6, p.color);
      if(p.name){ ctx.font = "700 11px 'Roboto Condensed', Arial, sans-serif"; ctx.fillStyle = '#1c1712'; ctx.textBaseline = 'top'; ctx.fillText(p.name, s.x + 10, s.y + 8); }
      ctx.globalAlpha = 1;
    });
    if(pings.length) animate = true;
    // указка Мастера (у игроков) — гаснет через ~2,5 с без движения
    if(gmPointer){
      const age = now - gmPointer.t;
      if(age > 2600) gmPointer = null;
      else {
        const s = toScreen(gmPointer);
        ctx.globalAlpha = age > 1600 ? 1 - (age-1600)/1000 : 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI*2); ctx.fillStyle = 'rgba(156,47,28,.22)'; ctx.fill();
        dot(ctx, s, 5, '#9c2f1c');
        ctx.font = "700 10px 'Roboto Condensed', Arial, sans-serif"; ctx.fillStyle = '#9c2f1c'; ctx.textBaseline = 'top';
        ctx.fillText(session.gmName || 'Мастер', s.x + 12, s.y + 6);
        ctx.globalAlpha = 1;
        animate = true;
      }
    }
    // сроки жизни чужих превью и своих неподтверждённых ходов
    Object.keys(previewPos).forEach(id=>{ if(now - previewPos[id].t > PREVIEW_MS){ delete previewPos[id]; refreshTokenPos(id); } else animate = true; });
    let expired = false;
    Object.keys(pendingPos).forEach(id=>{ if(now - pendingPos[id].t > PENDING_MS){ delete pendingPos[id]; refreshTokenPos(id); expired = true; } else animate = true; });
    if(expired) toast('Мастер не подтвердил перемещение');
    if(animate) requestRender({fx:true});
  }
  function addPing(x, y, color, name){ pings.push({x, y, color, name, t0:performance.now()}); requestRender({fx:true}); }
  function doPing(w){
    const mine = ownToken();
    const color = role()==='gm' || !role() ? '#9c2f1c' : (mine ? mine.color : colorForOwner(session.myId||'me'));
    const name = session.ownName || (role()==='gm' ? 'Мастер' : '');
    addPing(w.x, w.y, color, '');
    sendTransient({type:'gt-ping', eid:newId('p'), x:r3(w.x), y:r3(w.y), color, name});
  }

  /* ---------- попадание по рисункам (ластик) ---------- */
  function distToSeg(p, a, b){
    const dx = b[0]-a[0], dy = b[1]-a[1], l2 = dx*dx + dy*dy;
    let t = l2 ? ((p.x-a[0])*dx + (p.y-a[1])*dy)/l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x-(a[0]+t*dx), p.y-(a[1]+t*dy));
  }
  function hitDrawing(d, w){
    const tol = 8/(CELL*cam.z) + d.width/CELL/2, pts = d.points, a = pts[0], b = pts[pts.length-1];
    switch(d.type){
      case 'pen': if(pts.length===1) return Math.hypot(w.x-a[0], w.y-a[1]) <= tol;
                  for(let i=1;i<pts.length;i++) if(distToSeg(w, pts[i-1], pts[i])<=tol) return true; return false;
      case 'line': case 'arrow': return distToSeg(w, a, b) <= tol;
      case 'rect': return w.x>=Math.min(a[0],b[0])-tol && w.x<=Math.max(a[0],b[0])+tol && w.y>=Math.min(a[1],b[1])-tol && w.y<=Math.max(a[1],b[1])+tol;
      case 'circle': return Math.hypot(w.x-a[0], w.y-a[1]) <= Math.hypot(b[0]-a[0], b[1]-a[1]) + tol;
      case 'polygon': {
        let inside = false;
        for(let i=0, j=pts.length-1; i<pts.length; j=i++){
          const xi=pts[i][0], yi=pts[i][1], xj=pts[j][0], yj=pts[j][1];
          if(((yi>w.y)!==(yj>w.y)) && (w.x < (xj-xi)*(w.y-yi)/(yj-yi)+xi)) inside = !inside;
        }
        if(inside) return true;
        for(let i=0;i<pts.length;i++) if(distToSeg(w, pts[i], pts[(i+1)%pts.length])<=tol) return true;
        return false;
      }
      case 'text': {
        const lines = String(d.text).split('\n'), fsC = d.fontSize/CELL;
        const wC = Math.max(...lines.map(l=>l.length))*fsC*0.52, hC = lines.length*fsC*1.2;
        return w.x>=a[0]-tol && w.x<=a[0]+wC+tol && w.y>=a[1]-tol && w.y<=a[1]+hC+tol;
      }
    }
    return false;
  }

  /* ---------- рисунки: команды + отмена/повтор (только Мастер/локально) ---------- */
  function drawingAction(cmd, inverse){
    if(!isAuthority()) return;
    const r = execCommand(cmd);
    if(!r.ok){ toast(r.reason); return; }
    undoStack.push({cmd, inverse});
    if(undoStack.length>100) undoStack.shift();
    redoStack = [];
    renderSubbar();
  }
  function undo(){ const e = undoStack.pop(); if(!e) return; execCommand(e.inverse); redoStack.push(e); renderSubbar(); }
  function redo(){ const e = redoStack.pop(); if(!e) return; execCommand(e.cmd); undoStack.push(e); renderSubbar(); }
  function addDrawing(d){
    const clean = sanitizeDrawing(Object.assign({}, d, {id:newId('d')}));
    if(!clean) return;
    drawingAction({c:'drawing-add', drawing:clean}, {c:'drawing-remove', ids:[clean.id]});
  }
  function removeDrawings(ids){
    if(!ids.length) return;
    const prev = clone(authState.drawings);
    drawingAction({c:'drawing-remove', ids}, {c:'drawings-set', drawings:prev});
  }
  async function clearDrawings(){
    if(!authState.drawings.length) return;
    if(!(await uiConfirm('Стереть все рисунки на столе? (можно отменить — Ctrl+Z)', {ok:'Да', danger:true}))) return;
    drawingAction({c:'drawings-set', drawings:[]}, {c:'drawings-set', drawings:clone(authState.drawings)});
  }

  /* ---------- жетоны: действия ---------- */
  function moveTokens(moves){
    moves = moves.map(m=>({id:m.id, x:r3(m.x), y:r3(m.y)}));
    if(isAuthority()){ act({c:'token-move', moves}); return; }
    if(!session.gmId){ toast('Мастер не в сети — ход не отправлен'); moves.forEach(m=>refreshTokenPos(m.id)); return; }
    const now = performance.now();
    moves.forEach(m=>{ pendingPos[m.id] = {x:m.x, y:m.y, t:now}; refreshTokenPos(m.id); });
    act({c:'token-move', moves});
    requestRender({fx:true});
  }
  function snapPos(x, y, size){
    const c = SIZE_CELLS[size] || 1;
    const even = Number.isInteger(c) && c%2===0; // 2×2 — центр на пересечении линий, остальные — в центре клетки
    const f = v => even ? Math.round(v) : Math.floor(v) + 0.5;
    return {x:f(x), y:f(y)};
  }
  function myTokenAction(){
    const mine = ownToken();
    if(mine){ setSelection([mine.id]); centerOn(mine.x, mine.y); return; }
    if(role()==='gm'){ toast('У Мастера нет своего жетона игрока'); return; }
    const c = toWorld({x:vw/2, y:vh/2}), sn = snapPos(c.x, c.y, 'normal');
    if(isAuthority()){ act({c:'player-token-create', x:sn.x, y:sn.y}); const t = ownToken(); if(t) setSelection([t.id]); return; }
    awaitingOwnToken = true;
    if(!act({c:'player-token-create', x:sn.x, y:sn.y})) awaitingOwnToken = false;
  }
  function deleteTokens(ids){
    ids = ids.filter(id=>tok(id));
    if(!ids.length || !isAuthority()) return;
    const names = ids.map(id=>tokenName(tok(id), vitalsFor(tok(id))));
    const saved = ids.map(id=>clone(tok(id)));
    act({c:'token-delete', ids});
    // Удаление сразу, без вопроса — с «Отменить» в уведомлении (жетоны возвращаются со всем: ОЗ, карточка существа, владелец)
    uiToast(`Удалено с поля: ${names.join(', ')}`.slice(0, 120), {icon:'✕', action:{label:'Отменить', run:()=>{
      if(!isAuthority()) return; commit(saved.filter(t=>!tok(t.id)).map(t=>({op:'token-upsert', token:sanitizeToken(t)}))); }}});
  }

  /* ---------- ввод: мышь / перо / касание ---------- */
  function localPt(e){ const r = viewport.getBoundingClientRect(); return {x:e.clientX - r.left - viewport.clientLeft, y:e.clientY - r.top - viewport.clientTop}; }
  function tokenFromEvent(e){ const el = e.target.closest && e.target.closest('.gt-token'); return el ? tok(el.dataset.id) : null; }
  function onPointerDown(e){
    if(e.target.closest('.gt-ui')) return;
    closeMenu(); closePopover();
    viewport.focus({preventScroll:true});
    if(e.pointerType==='touch'){
      touches.set(e.pointerId, localPt(e));
      if(touches.size===2){ cancelInteraction(); startPinch(); return; }
      if(touches.size>2) return;
    }
    const p = localPt(e), w = toWorld(p);
    lastMouse = w;
    // «Рука» (как Move/Pan в других VTT): левой кнопкой тянется поле в любом месте, даже поверх жетонов —
    // быстрая навигация без средней кнопки и пробела (на ноутбуке с тачпадом их может просто не быть).
    if(e.button===1 || (e.button===0 && (spaceHeld || tool==='pan'))){ startPan(e, p); e.preventDefault(); return; }
    if(e.button!==0) return;
    if(e.altKey){ doPing(w); return; }
    if(abilityPick){ handlePickClick(e); return; } // цели способности существа — см. pickTargets
    if(targeting){ handleTargetClick(e, p); return; } // выбор цели атаки — см. startTargeting
    if(placing){ finishPlacing(w, e.shiftKey); return; }
    const t = tokenFromEvent(e);
    try{ viewport.setPointerCapture(e.pointerId); }catch(err){}
    switch(tool){
      case 'select': {
        if(t && canControl(t)){
          if(e.ctrlKey || e.metaKey){ const ids = new Set(selected); ids.has(t.id) ? ids.delete(t.id) : ids.add(t.id); setSelection([...ids]); return; }
          const wasSel = selected.has(t.id);
          if(!wasSel) setSelection([t.id]);
          const ids = [...selected].filter(id=>canControl(tok(id)));
          const starts = {};
          ids.forEach(id=>{ const tt = tok(id); const pp = displayPos(tt); starts[id] = {x:pp.x, y:pp.y}; });
          interaction = {type:'drag', primary:t.id, ids, starts, startW:w, startP:p, moved:false, clicked:t.id, wasSel};
          return;
        }
        if(e.pointerType==='touch'){ startPan(e, p); return; }
        interaction = {type:'box', start:p, cur:p, additive:e.ctrlKey||e.metaKey};
        if(!interaction.additive) setSelection([]);
        return;
      }
      case 'ruler': {
        if(ruler && ruler.mode==='waypoints'){ ruler.points.push(w); ruler.cur = w; }
        else ruler = {points:[w], cur:w, mode:'drag'};
        interaction = {type:'ruler', startP:p, moved:false};
        showHint();
        requestRender({fx:true});
        return;
      }
      case 'ping': doPing(w); return;
      case 'token': if(isAuthority()) openTokenForm(null, w, p); return;
      case 'text': if(isAuthority()) openTextForm(w, p); return;
      case 'draw': {
        if(!isAuthority()) return;
        if(drawTool==='eraser'){ eraseIds = new Set(); interaction = {type:'erase'}; eraseAt(w); return; }
        if(drawTool==='polygon'){
          if(!polyDraft) polyDraft = {points:[], style:Object.assign({}, drawStyle)};
          const first = polyDraft.points[0];
          if(first && polyDraft.points.length>2 && Math.hypot(w.x-first[0], w.y-first[1])*CELL*cam.z < 10){ finishPolygon(); return; }
          polyDraft.points.push([r3(w.x), r3(w.y)]);
          showHint(); requestRender({fx:true});
          return;
        }
        interaction = {type:'shape', draft:Object.assign({}, drawStyle, {type:drawTool, points:[[r3(w.x), r3(w.y)]]}), startP:p};
        requestRender({fx:true});
        return;
      }
    }
  }
  function onPointerMove(e){
    if(e.pointerType==='touch' && touches.has(e.pointerId)){
      touches.set(e.pointerId, localPt(e));
      if(pinch){ updatePinch(); return; }
    }
    const p = localPt(e), w = toWorld(p);
    lastMouse = w;
    if(pointerBroadcast && role()==='gm' && !interaction) sendTransient({type:'gt-pointer', x:r3(w.x), y:r3(w.y)}, 90);
    if(!interaction){
      if(abilityPick){ abilityPick.cur = w; requestRender({fx:true}); return; }
      if(targeting){ targeting.cur = w; requestRender({fx:true}); return; }
      if(placing){ movePlacing(w, e.shiftKey); return; }
      if(ruler && ruler.mode==='waypoints'){ ruler.cur = w; requestRender({fx:true}); }
      if(polyDraft) requestRender({fx:true});
      return;
    }
    const it = interaction;
    switch(it.type){
      case 'pan':
        cam.x = it.cam.x + (p.x - it.startP.x); cam.y = it.cam.y + (p.y - it.startP.y);
        applyCamera();
        break;
      case 'drag': {
        if(!it.moved && Math.hypot(p.x-it.startP.x, p.y-it.startP.y) < 4) return;
        it.moved = true;
        const s0 = it.starts[it.primary];
        let nx = s0.x + (w.x - it.startW.x), ny = s0.y + (w.y - it.startW.y);
        if(e.shiftKey){ const sn = snapPos(nx, ny, tok(it.primary).size); nx = sn.x; ny = sn.y; }
        const dx = nx - s0.x, dy = ny - s0.y;
        const moves = [];
        it.ids.forEach(id=>{ dragPos[id] = {x:it.starts[id].x+dx, y:it.starts[id].y+dy}; refreshTokenPos(id); if(!tok(id).hidden) moves.push({id, x:r3(dragPos[id].x), y:r3(dragPos[id].y)}); });
        if(moves.length) sendTransient({type:'gt-drag', moves}, 120);
        requestRender({fx:true});
        break;
      }
      case 'box': it.cur = p; requestRender({fx:true}); break;
      case 'ruler':
        if(Math.hypot(p.x-it.startP.x, p.y-it.startP.y) >= 4) it.moved = true;
        ruler.cur = w; requestRender({fx:true});
        break;
      case 'shape': {
        const d = it.draft, pt = [r3(w.x), r3(w.y)];
        if(d.type==='pen'){
          const last = d.points[d.points.length-1];
          if(Math.hypot(pt[0]-last[0], pt[1]-last[1])*CELL*cam.z >= 2 && d.points.length < 4000) d.points.push(pt);
        } else d.points = [d.points[0], pt];
        requestRender({fx:true});
        break;
      }
      case 'erase': eraseAt(w); break;
    }
  }
  function onPointerUp(e){
    if(e.pointerType==='touch'){
      touches.delete(e.pointerId);
      if(pinch){ if(touches.size<2) pinch = null; return; }
    }
    const it = interaction;
    if(!it) return;
    interaction = null;
    viewport.classList.remove('panning');
    switch(it.type){
      case 'drag': {
        if(!it.moved){
          // Касание: на телефоне нет правого клика (а на iPhone и долгое нажатие его не вызывает) — второй тап по
          // уже выделенному жетону открывает его меню: атака, карточка существа, изменить и т.д.
          if(e.pointerType==='touch' && it.wasSel && tok(it.clicked)){ openTokenMenu(tok(it.clicked), localPt(e)); break; }
          if(!(e.ctrlKey||e.metaKey)) setSelection([it.clicked]); break; }
        const moves = it.ids.map(id=>({id, x:dragPos[id].x, y:dragPos[id].y}));
        it.ids.forEach(id=>{ delete dragPos[id]; });
        moveTokens(moves);
        it.ids.forEach(refreshTokenPos);
        break;
      }
      case 'box': {
        const a = toWorld(it.start), b = toWorld(it.cur);
        const x0 = Math.min(a.x,b.x), x1 = Math.max(a.x,b.x), y0 = Math.min(a.y,b.y), y1 = Math.max(a.y,b.y);
        const ids = new Set(it.additive ? selected : []);
        if(Math.abs(it.cur.x-it.start.x) > 3 || Math.abs(it.cur.y-it.start.y) > 3){
          Object.values(st().tokens).forEach(t=>{ if(tokenVisibleHere(t) && canControl(t)){ const pp = displayPos(t); if(pp.x>=x0 && pp.x<=x1 && pp.y>=y0 && pp.y<=y1) ids.add(t.id); } });
        }
        setSelection([...ids]);
        break;
      }
      case 'ruler':
        if(ruler.mode==='drag'){
          if(it.moved) ruler = null;            // обычное измерение — исчезает при отпускании
          else ruler.mode = 'waypoints';        // клик без протягивания — режим промежуточных точек
        }
        showHint();
        break;
      case 'shape': {
        const d = it.draft;
        const a = d.points[0], b = d.points[d.points.length-1];
        const tiny = Math.hypot(b[0]-a[0], b[1]-a[1])*CELL*cam.z < 3;
        if(d.type==='pen' || !tiny) addDrawing(d);
        break;
      }
      case 'erase': {
        const ids = [...eraseIds];
        eraseIds = null;
        if(ids.length) removeDrawings(ids); else requestRender({draw:true});
        break;
      }
    }
    requestRender({fx:true});
  }
  function eraseAt(w){
    let hit = false;
    st().drawings.forEach(d=>{ if(!eraseIds.has(d.id) && hitDrawing(d, w)){ eraseIds.add(d.id); hit = true; } });
    if(hit) requestRender({draw:true});
  }
  function startPan(e, p){
    interaction = {type:'pan', startP:p, cam:{x:cam.x, y:cam.y}};
    viewport.classList.add('panning');
    try{ viewport.setPointerCapture(e.pointerId); }catch(err){}
  }
  function startPinch(){
    const [a, b] = [...touches.values()];
    const mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
    pinch = {dist:Math.max(10, Math.hypot(b.x-a.x, b.y-a.y)), z:cam.z, anchor:toWorld(mid)};
  }
  function updatePinch(){
    const [a, b] = [...touches.values()];
    if(!a || !b) return;
    const mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
    const z = clamp(pinch.z * Math.hypot(b.x-a.x, b.y-a.y)/pinch.dist, ZOOM_MIN, ZOOM_MAX);
    cam.z = z; cam.x = mid.x - pinch.anchor.x*CELL*z; cam.y = mid.y - pinch.anchor.y*CELL*z;
    applyCamera();
  }
  function cancelInteraction(){
    if(interaction && interaction.type==='drag') interaction.ids.forEach(id=>{ delete dragPos[id]; refreshTokenPos(id); });
    if(interaction && interaction.type==='erase'){ eraseIds = null; requestRender({draw:true}); }
    interaction = null;
    viewport && viewport.classList.remove('panning');
    requestRender({fx:true});
  }
  function cancelAll(){
    cancelInteraction();
    targeting = null;
    if(abilityPick) finishPick(null);
    if(placing){ placing.ids.forEach(id=>{ delete dragPos[id]; refreshTokenPos(id); }); placing = null; }
    ruler = null; polyDraft = null;
    closeMenu(); closePopover(); showHint();
    requestRender({fx:true});
  }
  function onWheel(e){
    e.preventDefault();
    if(wheelIntent(e)==='pan'){ cam.x -= e.deltaX; cam.y -= e.deltaY; applyCamera(); return; } // два пальца тачпада — сдвиг поля
    const p = localPt(e);
    const k = e.deltaMode===1 ? 0.05 : e.deltaMode===2 ? 0.5 : (e.ctrlKey ? 0.01 : 0.0015); // щипок — крупнее шаг
    zoomAt(p.x, p.y, cam.z * Math.exp(-e.deltaY * k));
  }
  function onDblClick(e){
    if(e.target.closest('.gt-ui')) return;
    if(tool==='ruler' && ruler){ ruler = null; showHint(); requestRender({fx:true}); return; }
    if(polyDraft){ finishPolygon(); return; }
    const t = tokenFromEvent(e);
    if(t && tool==='select' && isAuthority()){ if(t.creature && typeof Bestiary!=='undefined') Bestiary.openFloat(t.id); else openTokenForm(t, null, localPt(e)); }
  }
  function finishPolygon(){
    if(!polyDraft) return;
    const pts = [];
    polyDraft.points.forEach(p=>{ const l = pts[pts.length-1]; if(!l || Math.hypot(p[0]-l[0], p[1]-l[1])*CELL*cam.z > 2) pts.push(p); });
    const style = polyDraft.style;
    polyDraft = null;
    if(pts.length>=2) addDrawing(Object.assign({}, style, {type:'polygon', points:pts}));
    showHint(); requestRender({fx:true});
  }
  function startPlacing(ids){
    ids = ids.filter(id=>canControl(tok(id)));
    if(!ids.length) return;
    const t0 = tok(ids[0]);
    placing = {ids, offsets:{}, cur:null};
    ids.forEach(id=>{ const t = tok(id); placing.offsets[id] = {x:t.x - t0.x, y:t.y - t0.y}; });
    setSelection(ids);
    showHint();
  }
  function movePlacing(w, snap){
    let c = {x:w.x, y:w.y};
    if(snap) c = snapPos(c.x, c.y, tok(placing.ids[0]).size);
    placing.cur = c;
    placing.ids.forEach(id=>{ dragPos[id] = {x:c.x + placing.offsets[id].x, y:c.y + placing.offsets[id].y}; refreshTokenPos(id); });
    requestRender({fx:true});
  }
  function finishPlacing(w, snap){
    movePlacing(w, snap);
    const moves = placing.ids.map(id=>({id, x:dragPos[id].x, y:dragPos[id].y}));
    placing.ids.forEach(id=>{ delete dragPos[id]; });
    placing = null;
    moveTokens(moves);
    moves.forEach(m=>refreshTokenPos(m.id));
    showHint(); requestRender({fx:true});
  }
  function onContextMenu(e){
    if(e.target.closest('.gt-ui')) return;
    e.preventDefault();
    if(polyDraft){ finishPolygon(); return; }
    if(ruler){ ruler = null; showHint(); requestRender({fx:true}); return; }
    if(placing || targeting || abilityPick){ cancelAll(); return; }
    const p = localPt(e), w = toWorld(p), t = tokenFromEvent(e);
    if(t) openTokenMenu(t, p); else openFieldMenu(w, p);
  }
  function onKeyDown(e){
    if(!visible) return;
    const ae = document.activeElement, tag = ae && ae.tagName;
    const typing = tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || (ae && ae.isContentEditable);
    if(e.key==='Escape' && (popEl.style.display==='block' || menuEl.style.display==='block')){ closePopover(); closeMenu(); e.stopPropagation(); return; }
    if(typing) return;
    const isZ = e.code==='KeyZ', isY = e.code==='KeyY';
    if((e.ctrlKey || e.metaKey) && (isZ || isY)){
      // Ctrl+Z листа персонажа (performUndo) на вкладке стола не срабатывает — там отмена рисунков
      e.preventDefault(); e.stopPropagation();
      if(!isAuthority()) return;
      if(isY || e.shiftKey) redo(); else undo();
      return;
    }
    if(e.code==='Space'){ if(!spaceHeld){ spaceHeld = true; viewport.classList.add('space-pan'); } e.preventDefault(); return; }
    if(e.key==='Escape'){ cancelAll(); if(!placing) setSelection([]); return; }
    if((e.key==='Delete' || e.key==='Backspace') && isAuthority() && selected.size){ e.preventDefault(); deleteTokens([...selected]); return; }
    if(e.key==='Enter' && polyDraft){ finishPolygon(); return; }
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(e.key==='+' || e.key==='='){ zoomStep(1); return; }
    if(e.key==='-' || e.key==='_'){ zoomStep(-1); return; }
    const hot = {KeyV:'select', KeyH:'pan', KeyR:'ruler', KeyG:'ping', KeyD:'draw', KeyT:'text'}[e.code];
    if(hot && (isAuthority() || ['select','pan','ruler','ping'].indexOf(hot)>=0)){ setTool(hot); }
  }
  function onKeyUp(e){ if(e.code==='Space'){ spaceHeld = false; viewport && viewport.classList.remove('space-pan'); } }

  /* ---------- панели ---------- */
  const ICONS = {
    select:'<path d="M5 3l13 7.5-5.8 1.6L9.6 18z"/>',
    pan:'<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    token:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="2.8"/><path d="M7.3 17.4c1.2-2.3 2.8-3.4 4.7-3.4s3.5 1.1 4.7 3.4"/>',
    ruler:'<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l2 2M13 6.5l2 2"/>',
    draw:'<path d="M4 20l1.2-4.8L16 4.4l3.6 3.6L8.8 18.8z"/><path d="M13.8 6.6l3.6 3.6"/>',
    text:'<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    ping:'<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="9.8" opacity=".45"/>',
    pointer:'<path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="3.6"/>',
    me:'<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8"/>',
    more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    pen:'<path d="M3 17c3-7 6 3 9-4s5-3 9-7"/>',
    line:'<path d="M5 19L19 5"/>',
    arrow:'<path d="M5 19L19 5M11 5h8v8"/>',
    rect:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
    circle:'<circle cx="12" cy="12" r="8"/>',
    polygon:'<path d="M12 3.5l8 5.8-3 10.2H7L4 9.3z"/>',
    eraser:'<path d="M8 20h11M4.5 15.5l9-9 6 6-7.5 7.5H8.5z"/>',
    undo:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    redo:'<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
    center:'<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>'
  };
  function icon(n){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]||''}</svg>`; }
  function toolBtn(id, label, hotkey){
    return `<button type="button" class="gt-tool${tool===id?' active':''}" data-tool="${id}" title="${label}${hotkey?' ('+hotkey+')':''}">${icon(id)}<span class="gt-lbl">${label}</span></button>`;
  }
  function actBtn(ic, label, act, extra){ return `<button type="button" class="gt-tool${extra||''}" data-act="${act}" title="${label}">${icon(ic)}${label ? `<span class="gt-lbl">${label}</span>` : ''}</button>`; }
  function renderToolbar(){
    const auth = isAuthority(), r = role();
    const h = [toolBtn('select','Выбор','V'), toolBtn('pan','Рука','H')];
    if(auth) h.push(toolBtn('token','Жетон'));
    h.push(toolBtn('ruler','Измерение','R'));
    if(auth){ h.push(toolBtn('draw','Рисование','D')); h.push(toolBtn('text','Текст','T')); }
    h.push(toolBtn('ping','Ping','G / Alt+клик'));
    h.push('<span class="gt-sep"></span>');
    if(r==='gm') h.push(actBtn('pointer','Указка','pointer', pointerBroadcast ? ' active' : ''));
    if(r!=='gm') h.push(actBtn('me','Мой жетон','my-token'));
    if(auth) h.push(`<button type="button" class="gt-tool${st().combat ? ' active' : ''}" data-act="combat" title="${st().combat ? 'Бой идёт — свернуть/развернуть трекер' : 'Начать бой: стороны, инициатива, круги'}"><span style="font-size:14px;line-height:1">⚔</span><span class="gt-lbl">Бой</span></button>`);
    if(auth && typeof Bestiary!=='undefined') h.push(`<button type="button" class="gt-tool${Bestiary.dockOpen ? ' active' : ''}" data-act="bestiary" title="Бестиарий — перетащите существо на поле"><span style="font-size:14px;line-height:1">📖</span><span class="gt-lbl">Бестиарий</span></button>`);
    if(auth && typeof GmAdvice!=='undefined') h.push(`<button type="button" class="gt-tool" data-act="gm-advice" title="Советы Мастеру: чек-лист подготовки и памятка"><span style="font-size:14px;line-height:1">💡</span><span class="gt-lbl">Советы</span></button>`);
    if(auth) h.push(`<button type="button" class="gt-tool" data-act="more" title="Ещё">${icon('more')}</button>`);
    toolbar.innerHTML = h.join('');
    viewport.className = 'gt-viewport tool-' + tool + (spaceHeld ? ' space-pan' : '');
  }
  function renderSubbar(){
    if(!subbar) return;
    if(!(isAuthority() && (tool==='draw' || tool==='text'))){ subbar.style.display = 'none'; return; }
    const h = [];
    if(tool==='draw'){
      [['pen','Карандаш'],['line','Линия'],['arrow','Стрелка'],['rect','Прямоугольник'],['circle','Круг'],['polygon','Полигон'],['eraser','Ластик']]
        .forEach(([id,label])=>h.push(`<button type="button" class="gt-tool${drawTool===id?' active':''}" data-draw="${id}" title="${label}">${icon(id)}</button>`));
      h.push('<span class="gt-sep"></span>');
    }
    DRAW_COLORS.forEach(c=>h.push(`<button type="button" class="gt-swatch${drawStyle.color===c?' active':''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`));
    h.push(`<label class="gt-range" title="Толщина">толщ.<input type="range" min="1" max="24" step="1" value="${drawStyle.width}" data-style="width"></label>`);
    h.push(`<label class="gt-range" title="Прозрачность">прозр.<input type="range" min="0.2" max="1" step="0.05" value="${drawStyle.opacity}" data-style="opacity"></label>`);
    h.push('<span class="gt-sep"></span>');
    h.push(`<button type="button" class="gt-tool" data-act="undo" title="Отменить (Ctrl+Z)" ${undoStack.length?'':'disabled'}>${icon('undo')}</button>`);
    h.push(`<button type="button" class="gt-tool" data-act="redo" title="Повторить (Ctrl+Shift+Z)" ${redoStack.length?'':'disabled'}>${icon('redo')}</button>`);
    h.push(`<button type="button" class="gt-tool" data-act="clear-drawings" title="Стереть все рисунки">${icon('trash')}</button>`);
    subbar.innerHTML = h.join('');
    subbar.style.display = 'flex';
  }
  function renderZoombar(){
    zoombar.innerHTML = `<button type="button" class="gt-tool" data-act="zoom-out" title="Отдалить (−)">${icon('minus')}</button>`+
      `<span class="gt-zoom-label" id="gtZoomLabel" data-act="zoom-reset" title="Масштаб 100%">${Math.round(cam.z*100)}%</span>`+
      `<button type="button" class="gt-tool" data-act="zoom-in" title="Приблизить (+)">${icon('plus')}</button>`+
      `<button type="button" class="gt-tool" data-act="center" title="Показать все жетоны">${icon('center')}</button>` + wheelModeButtonHtml('gt-tool gt-wheelmode');
  }
  function renderStatus(){
    const r = role(), connected = !!(session.ws && session.ws.readyState===WebSocket.OPEN);
    let txt;
    if(!r) txt = 'Локальный стол · без сессии';
    else if(r==='gm') txt = connected ? `<b>Мастер</b> · игроков: ${Object.keys(session.players).length}` : '<b>Мастер</b> · переподключение…';
    else txt = session.gmId && session.gmName ? `<b>Игрок</b> · стол Мастера «${escapeHtml(session.gmName)}»` : '<b>Игрок</b> · ждём Мастера…';
    statusEl.innerHTML = txt;
    if(IS_TOUCH_UI){ emptyHint.innerHTML = isAuthority()
      ? '<b>Пустое поле</b>Жетон — поставить NPC' + (role()==='gm' ? ' или жетон игрока' : ', «Мой жетон» — своего персонажа') + '. Два пальца — масштаб и сдвиг, тап по выделенному жетону — его меню.'
      : '<b>Стол Мастера</b>«Мой жетон» — поставить своего персонажа. Два пальца — масштаб и сдвиг, тап по выделенному жетону — его меню.'; return; }
    emptyHint.innerHTML = isAuthority()
      ? '<b>Пустое поле</b>' + (role()==='gm' ? 'Жетон — поставить NPC или жетон игрока.' : 'Жетон — поставить NPC, «Мой жетон» — своего персонажа.') + ' Колесо — масштаб, «Рука» (H), средняя кнопка или пробел+перетаскивание — сдвиг поля.'
      : '<b>Стол Мастера</b>«Мой жетон» — поставить своего персонажа. Колесо — масштаб, «Рука» (H), средняя кнопка или пробел+перетаскивание — сдвиг поля.';
  }
  function setTool(t){
    if(tool===t) return;
    if(polyDraft) finishPolygon();
    ruler = null; placing && cancelAll();
    tool = t;
    renderToolbar(); renderSubbar(); showHint();
    requestRender({fx:true});
  }
  function showHint(){
    let h = '';
    if(abilityPick) h = IS_TOUCH_UI ? 'Тап по цели способности · тап по пустому месту — отмена' : 'Выберите цель способности · Esc или правый клик — отмена';
    else if(targeting) h = IS_TOUCH_UI ? 'Тап по цели атаки · тап по пустому месту — отмена' : 'Выберите цель атаки · Esc или правый клик — отмена';
    else if(placing) h = IS_TOUCH_UI ? 'Тап — поставить жетон' : 'Клик — поставить · Shift — по сетке · Esc — отмена';
    else if(polyDraft) h = 'Клик — вершина · двойной клик, Enter или клик по первой точке — замкнуть · Esc — отмена';
    else if(ruler && ruler.mode==='waypoints') h = 'Клик — ещё точка · двойной клик, правый клик или Esc — убрать';
    else if(tool==='ruler') h = 'Протяните — измерить · клик — измерение по точкам';
    else if(tool==='pan') h = 'Тяните поле мышью · колесо — масштаб · V — вернуться к выбору';
    hintEl.textContent = h;
    hintEl.style.display = h ? 'block' : 'none';
  }
  let toastTimer = null;
  function toast(text){
    if(!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 2600);
  }
  function onToolbarClick(e){
    const b = e.target.closest('[data-tool],[data-act],[data-draw],[data-color]');
    if(!b) return;
    if(b.dataset.tool){ setTool(b.dataset.tool); return; }
    if(b.dataset.draw){ if(polyDraft) finishPolygon(); drawTool = b.dataset.draw; renderSubbar(); showHint(); return; }
    if(b.dataset.color){ drawStyle.color = b.dataset.color; saveJson(STYLE_KEY, drawStyle); renderSubbar(); return; }
    switch(b.dataset.act){
      case 'pointer':
        pointerBroadcast = !pointerBroadcast;
        if(!pointerBroadcast) sendTransient({type:'gt-pointer', off:true}, 0);
        toast(pointerBroadcast ? 'Указка включена — игроки видят, куда вы наводите' : 'Указка выключена');
        renderToolbar();
        break;
      case 'my-token': myTokenAction(); break;
      case 'more': openMoreMenu(b); break;
      case 'bestiary': if(typeof Bestiary!=='undefined') Bestiary.toggleDock(); break;
      case 'gm-advice': if(typeof GmAdvice!=='undefined') GmAdvice.openPanel('memo'); break;
      case 'combat': if(st().combat){ combatCollapsed = !combatCollapsed; renderCombat(); } else openCombatSetup(b); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'clear-drawings': clearDrawings(); break;
      case 'zoom-in': zoomStep(1); break;
      case 'zoom-out': zoomStep(-1); break;
      case 'zoom-reset': zoomAt(vw/2, vh/2, 1); break;
      case 'center': centerOnTokens(); break;
    }
  }
  function onStyleInput(e){
    const k = e.target.dataset && e.target.dataset.style;
    if(!k) return;
    drawStyle[k] = parseFloat(e.target.value);
    saveJson(STYLE_KEY, drawStyle);
  }

  /* ---------- меню и формы ---------- */
  function placeFloating(el, x, y){
    el.style.display = 'block';
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = clamp(x, 8, Math.max(8, vw - w - 8)) + 'px';
    el.style.top = clamp(y, 8, Math.max(8, vh - h - 8)) + 'px';
  }
  function closeMenu(){ if(menuEl){ menuEl.style.display = 'none'; menuEl.innerHTML = ''; } }
  function openMenu(p, title, items){
    closePopover();
    menuEl.innerHTML = (title ? `<div class="gt-menu-title">${escapeHtml(title)}</div>` : '') + items.map(it=>{
      if(it==='-') return '<hr>';
      if(it.html) return it.html;
      return `<button type="button" class="${it.danger?'danger':''}" data-mi="${it.id}">${escapeHtml(it.label)}</button>`;
    }).join('');
    const handlers = {};
    items.forEach(it=>{ if(it.id) handlers[it.id] = it.run; });
    menuEl.onclick = (e)=>{
      const b = e.target.closest('[data-mi],[data-size]');
      if(!b) return;
      if(b.dataset.size){ const fn = handlers['size']; closeMenu(); fn && fn(b.dataset.size); return; }
      const fn = handlers[b.dataset.mi];
      closeMenu();
      if(fn) fn();
    };
    placeFloating(menuEl, p.x + 4, p.y + 4);
  }
  function openTokenMenu(t, p){
    const v = vitalsFor(t), name = tokenName(t, v);
    if(!selected.has(t.id) && canControl(t)) setSelection([t.id]);
    if(isAuthority()){
      const ids = selected.has(t.id) ? [...selected] : [t.id];
      const items = attackMenuItems(t, p).concat(abilityMenuItems(t, p), [
        {id:'move', label:'Переместить', run:()=>startPlacing(ids)},
        {id:'edit', label:'Изменить…', run:()=>openTokenForm(t, null, p)},
        {id:'hp', label:'Изменить HP…', run:()=>openVitalForm(t, 'hp', p)}
      ]);
      if(t.creature && typeof Bestiary!=='undefined') items.unshift({id:'card', label:'📖 Карточка существа', run:()=>Bestiary.openFloat(t.id)});
      items.push(...combatMenuItems(t, p));
      if(t.kind==='player') items.push({id:'psi', label:'Изменить Psi…', run:()=>openVitalForm(t, 'psi', p)});
      if(t.kind==='player' && typeof Bestiary!=='undefined' && attackerSheet(t)) items.push({id:'tobst', label:'📖 В бестиарий…', run:()=>Bestiary.fromSheet(attackerSheet(t), {name:tokenName(t, vitalsFor(t)), player:(session.players[t.ownerId] && session.players[t.ownerId].name) || ''})});
      items.push({id:'size', run:(size)=>act({c:'token-update', id:t.id, patch:{size}}),
        html:`<div class="gt-menu-sizes">${Object.keys(SIZE_CELLS).map(s=>`<button type="button" data-size="${s}" class="${t.size===s?'active':''}">${SIZE_LABELS[s].split(' ')[0]}</button>`).join('')}</div>`});
      if(t.kind==='gm') items.push({id:'hide', label:t.hidden ? 'Показать игрокам' : 'Скрыть от игроков', run:()=>act({c:'token-update', id:t.id, patch:{hidden:!t.hidden}})});
      if(typeof Reactions!=='undefined' && Reactions.manualAllowed(t)) items.push({id:'rx', label:'🎞 Реакция…', run:()=>{ const r = viewport.getBoundingClientRect(); Reactions.pickForToken(t.id, r.left + p.x, r.top + p.y); }});
      if(typeof TargetRolls!=='undefined') items.push({id:'tr', label:t.kind==='gm' ? '🎯 Бросок цели…' : '🎯 Потребовать бросок…', run:()=>TargetRolls.open(t.kind==='gm' ? {src:t.id, targets:ids.filter(x=>x!==t.id)} : {targets:ids})});
      { const cov = (t.marks || []).some(m=>m.k==='cover'); // укрытие: броня «если персонаж в укрытии, то +1 к защите» (characterGearEffects)
        items.push({id:'cover', label:cov ? '🧱 Вышел из укрытия' : '🧱 В укрытии', run:()=>act({c:'token-update', id:t.id, patch:{marks:cov ? (t.marks || []).filter(m=>m.k!=='cover') : (t.marks || []).concat([{k:'cover', r:0}])}})}); }
      if((t.marks || []).length) items.push({id:'unmark', label:'✕ Снять отметки: ' + t.marks.map(m=>MARKS[m.k].toLowerCase()).join(', '), run:()=>act({c:'token-update', id:t.id, patch:{marks:[]}})});
      items.push('-', {id:'del', label: ids.length>1 ? `Удалить (${ids.length})` : 'Удалить', danger:true, run:()=>deleteTokens(ids)});
      openMenu(p, name, items);
      return;
    }
    if(canControl(t)){
      openMenu(p, name, attackMenuItems(t, p).concat(abilityMenuItems(t, p), [
        {id:'sel', label:'Выбрать', run:()=>setSelection([t.id])},
        {id:'move', label:'Переместить', run:()=>startPlacing([t.id])},
        {id:'sheet', label:'Открыть персонажа', run:()=>{ toggleMainTab('sheet'); const el = document.getElementById('hpValue'); if(el) el.scrollIntoView({block:'center', behavior:'smooth'}); }}
      ].concat(typeof Reactions!=='undefined' && Reactions.manualAllowed(t) ? [{id:'rx', label:'🎞 Реакция…', run:()=>{ const r = viewport.getBoundingClientRect(); Reactions.pickForToken(t.id, r.left + p.x, r.top + p.y); }}] : [])));
    }
  }
  // Способности персонажа (PcAbilities): у игрока — своего, у Мастера — любого по копии листа
  function abilityMenuItems(t, p){
    if(t.kind!=='player' || typeof PcAbilities==='undefined' || !attackerSheet(t)) return [];
    return [{id:'pcab', label:'✦ Способности…', run:()=>{ const r = viewport.getBoundingClientRect(); PcAbilities.openList(t.id, r.left + p.x, r.top + p.y); }}];
  }
  function openFieldMenu(w, p){
    const items = [{id:'ping', label:'Ping сюда', run:()=>doPing(w)}];
    if(isAuthority()) items.unshift({id:'new', label:'Новый жетон здесь…', run:()=>openTokenForm(null, w, p)});
    if(selected.size && [...selected].every(id=>canControl(tok(id)))){
      items.push({id:'here', label: selected.size>1 ? 'Переместить выбранные сюда' : 'Переместить выбранный сюда', run:()=>{ startPlacing([...selected]); finishPlacing(w, false); }});
    }
    openMenu(p, '', items);
  }
  function openMoreMenu(btn){
    const r = btn.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    const p = {x:r.left - vr.left, y:r.bottom - vr.top + 2};
    const bg = authState.map.background;
    const items = [
      {id:'bg', label: bg ? 'Сменить фон карты…' : 'Фон карты по ссылке…', run:()=>openBackgroundForm(p)}
    ];
    if(bg) items.push({id:'bgoff', label:'Убрать фон карты', run:()=>act({c:'map-set', map:Object.assign({}, authState.map, {background:null})})});
    const sc = authState.map.scene;
    if(sc) items.push({id:'scenefocus', label:'К карте из редактора', run:()=>focusScene()}, {id:'scenepos', label:`Карта «${sc.name}»: положение…`, run:()=>openSceneForm(p)}, {id:'sceneoff', label:'Убрать карту из редактора', run:()=>act({c:'map-set', map:Object.assign({}, authState.map, {scene:null})})});
    items.push({id:'clear', label:'Стереть все рисунки', run:clearDrawings});
    items.push('-', {id:'reset', label:'Очистить стол целиком…', danger:true, run:resetTable});
    openMenu(p, '', items);
  }
  async function resetTable(){
    const prev = clone(authState); // очистка — сразу; «Отменить» в уведомлении возвращает стол целиком
    authState = blankState();
    undoStack = []; redoStack = [];
    saveJson(STATE_KEY, authState);
    setSelection([]);
    renderTokens(); renderSubbar(); requestRender({bg:true, draw:true, fx:true});
    if(role()==='gm') sendMsg({type:'gt-snapshot', state:playerSnapshot()});
    uiToast('Стол очищен', {icon:'✕', action:{label:'Отменить', run:()=>{
      if(!isAuthority()) return;
      authState = normalizeState(Object.assign(prev, {tableId:authState.tableId, version:authState.version + 1}));
      scheduleSave(); tokenEls.forEach(el=>el.remove()); tokenEls.clear();
      renderTokens(); renderCombat(); renderToolbar(); requestRender({bg:true, draw:true, fx:true});
      if(role()==='gm') sendMsg({type:'gt-snapshot', state:playerSnapshot()}); }}});
  }
  function closePopover(){ if(popEl){ popEl.style.display = 'none'; popEl.innerHTML = ''; } }
  function openPopover(p, html, onSubmit){
    closeMenu();
    popEl.innerHTML = `<form class="gt-pop-form" autocomplete="off">${html}</form>`;
    const form = popEl.querySelector('form');
    form.onsubmit = (e)=>{ e.preventDefault(); if(onSubmit(form)!==false) closePopover(); };
    form.querySelectorAll('[data-cancel]').forEach(b=>b.onclick = closePopover);
    form.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ e.preventDefault(); closePopover(); viewport.focus({preventScroll:true}); } });
    placeFloating(popEl, p.x + 8, p.y + 8);
    const first = form.querySelector('input[type=text],input[type=number],textarea') || form.querySelector('input:not([type=radio]):not([type=checkbox]),select');
    if(first){ first.focus(); if(first.select) first.select(); }
    return form;
  }
  function swatchesHtml(cur){
    return `<div class="gt-swatches">${PALETTE.map(c=>`<label class="gt-sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c===cur?'checked':''}><span></span></label>`).join('')}</div>`;
  }
  function sizeOptions(cur){ return Object.keys(SIZE_CELLS).map(s=>`<option value="${s}" ${s===cur?'selected':''}>${SIZE_LABELS[s]}</option>`).join(''); }
  // Каталог книги для боевых полей жетонов Мастера: оружие (есть Ат и МУ — атаковать им можно) и броня
  // (есть «Защита N»). Строится один раз, группами по поколениям, как и в инвентаре листа.
  const GEN_LABELS = { hlam:'Хлам', svalka:'Свалка', knyazhestva:'Феодальные княжества', zemli_straha:'Земли страха' };
  let combatCatalogCache = null;
  function combatCatalog(){
    if(combatCatalogCache) return combatCatalogCache;
    const weapons = [], armor = [];
    Object.keys(ITEM_CATALOG).forEach(g=>{
      const cats = ITEM_CATALOG[g].categories || {};
      ((cats.weapons && cats.weapons.items) || []).forEach(it=>{
        const text = it.name + ' — ' + (it.desc||'');
        if(parseWeaponStats(text)) weapons.push({gen:g, label:it.name, text});
      });
      ((cats.armor && cats.armor.items) || []).forEach(it=>{
        const st = parseArmorStats(it.name + ' — ' + (it.desc||''));
        if(st) armor.push({gen:g, label:it.name, base:st.base, subs:armorSubsObject(st.subs)});
      });
    });
    return combatCatalogCache = {weapons, armor};
  }
  function catalogOptions(list, selectedFn){
    const byGen = {};
    list.forEach((x,i)=>{ (byGen[x.gen] = byGen[x.gen] || []).push(`<option value="${i}" ${selectedFn(x)?'selected':''}>${escapeHtml(x.label)}</option>`); });
    return Object.keys(byGen).map(g=>`<optgroup label="${escapeHtml(GEN_LABELS[g]||g)}">${byGen[g].join('')}</optgroup>`).join('');
  }
  function combatFieldsHtml(cur, isPlayerTok){
    const nat = tokenNature(cur);
    const n = (name, val, min, max)=>`<input type="number" name="${name}" step="1" min="${min}" max="${max}" value="${val}">`;
    const ic = nat==='robot' ? '🔧' : '🦴';
    const natSel = `<label class="gt-f">Природа<select name="nature" title="Травмы — у гуманоидов и животных; у пустот травм нет; у роботов — поломки">${Object.keys(CREATURE_NATURES).map(k=>`<option value="${k}" ${nat===k?'selected':''}>${CREATURE_NATURES[k]}${k==='void' ? ' — без травм' : k==='robot' ? ' — поломки 🔧' : ' — травмы 🦴'}</option>`).join('')}</select></label>`;
    const bones = natSel + (nat==='void' ? `<div class="gt-pop-note">У пустот травм не бывает.</div>` :
                  `<div class="gt-f-row"><label class="gt-f">${nat==='robot' ? 'Поломки' : 'Травмы'} ${ic}${n('trauma', cur.trauma||0, 0, 99)}</label>`+
                  `<label class="gt-f">Красные <span class="bone-red">${ic}</span>${n('traumaRed', cur.traumaRed||0, 0, 99)}</label></div>`)+
                  `<label class="gt-check"><input type="checkbox" name="slowReaction" ${cur.slowReaction?'checked':''}> ⚡ Может отреагировать (атакован медленным оружием)</label>`+
                  `<label class="gt-f">🔥 Горит, кругов (термическая граната)${n('burning', cur.burning||0, 0, 99)}</label>`;
    if(isPlayerTok){
      return `<details class="gt-combat" open><summary>Бой</summary>`+
        `<label class="gt-check"><input type="checkbox" name="attackModEnabled" ${cur.attackModEnabled?'checked':''}> Модификатор атаки по этому игроку</label>`+
        `<label class="gt-f">Модификатор (−18…+18)${n('attackMod', cur.attackMod||0, -18, 18)}</label>`+
        bones + `<div class="gt-pop-note">Травма-к12 у игроков — 5, защита — торс из его листа.</div></details>`;
    }
    const cat = combatCatalog();
    const wOpts = catalogOptions(cat.weapons, x=>x.text===cur.weaponText);
    const aOpts = catalogOptions(cat.armor, x=>x.label===cur.armorName);
    return `<details class="gt-combat" open><summary>Бой</summary>`+
      `<label class="gt-f">Оружие (каталог)<select name="weapon"><option value="">— без оружия —</option>${wOpts}</select></label>`+
      `<label class="gt-f">Броня (каталог — заполнит защиту)<select name="armor"><option value="">— вручную —</option>${aOpts}</select></label>`+
      `<div class="gt-f-row"><label class="gt-f">Защита${n('defense', cur.defense||0, 0, 99)}</label>`+
      `<label class="gt-f">Сила${n('strength', cur.strength==null?3:cur.strength, 0, 20)}</label>`+
      (nat==='void' ? '</div>' : `<label class="gt-f">${nat==='robot' ? 'Поломка' : 'Травма'}-к12${n('traumaThreshold', cur.traumaThreshold||5, 1, 12)}</label></div>`)+
      `<div class="gt-f-row"><label class="gt-f">Рефлексы${n('reflexes', cur.reflexes==null?3:cur.reflexes, 0, 20)}</label>`+
      `<label class="gt-f">Граната<select name="grenade"><option value="">— нет —</option>${Object.keys(GRENADE_SPECS).map(k=>`<option value="${k}" ${cur.grenade===k?'selected':''}>${escapeHtml(GRENADE_SPECS[k].name)}</option>`).join('')}</select></label></div>`+
      `<div class="gt-pop-note" data-subs-note>${Object.keys(cur.defenseSubs||{}).length ? 'По типам урона: '+escapeHtml(Object.keys(cur.defenseSubs).map(k=>k+cur.defenseSubs[k]).join(', ')) : ''}</div>`+
      // защита по зонам для прицельной атаки: пусто — как у карточки существа или как «Защита» (тело)
      `<div class="gt-pop-note">Защита по зонам (прицельная атака): пусто — ${cur.creature ? 'по броне из карточки' : 'как «Защита»'}.</div><div class="gt-f-row gt-zone-row">${AIM_ZONES.map(z=>
        `<label class="gt-f">${ARMOR_ZONE_LABELS[z]}<input type="number" name="zone_${z}" min="0" max="99" step="1" placeholder="—" value="${cur.zoneDef && cur.zoneDef[z]!=null ? cur.zoneDef[z] : ''}"></label>`).join('')}</div>`+
      `<label class="gt-f">Модификатор атаки по нему (−18…+18)${n('attackMod', cur.attackMod||0, -18, 18)}</label>`+
      `<div class="gt-f-row" style="align-items:flex-end"><label class="gt-check" style="flex:1"><input type="checkbox" name="unprotectedEnabled" ${cur.unprotectedEnabled?'checked':''}> По незащищённым частям</label>`+
      `<label class="gt-f" style="flex:0 0 70px">мод.${n('unprotectedMod', cur.unprotectedMod==null?-6:cur.unprotectedMod, -30, 30)}</label></div>`+
      bones + `<div class="gt-pop-note">Навык NPC для атаки и лёгкая атлетика — 3; сила влияет на условные черты оружия («если сила 4+, то пул» и т.п.) и дальность броска гранаты; против рефлексов мечут гранаты.</div></details>`;
  }
  function readCombatFields(fd, cur, isPlayerTok, subsState){
    const int = (k, d)=>{ const v = parseInt(String(fd.get(k)), 10); return isFinite(v) ? v : d; };
    const out = { nature:CREATURE_NATURES[fd.get('nature')] ? fd.get('nature') : tokenNature(cur), trauma:int('trauma', cur.trauma||0), traumaRed:int('traumaRed', cur.traumaRed||0), attackMod:int('attackMod', cur.attackMod||0), slowReaction: fd.get('slowReaction')==='on', burning:int('burning', cur.burning||0) };
    if(isPlayerTok){ out.attackModEnabled = fd.get('attackModEnabled')==='on'; return out; }
    const cat = combatCatalog();
    const wi = fd.get('weapon'), ai = fd.get('armor');
    out.weaponText = (wi==='' || wi===null) ? '' : (cat.weapons[+wi] ? cat.weapons[+wi].text : (cur.weaponText||''));
    out.armorName = (ai==='' || ai===null) ? '' : (cat.armor[+ai] ? cat.armor[+ai].label : (cur.armorName||''));
    out.defense = int('defense', cur.defense||0);
    out.strength = int('strength', cur.strength==null?3:cur.strength);
    out.reflexes = int('reflexes', cur.reflexes==null?3:cur.reflexes);
    out.grenade = GRENADE_SPECS[fd.get('grenade')] ? fd.get('grenade') : '';
    out.defenseSubs = subsState.subs;
    out.zoneDef = {}; AIM_ZONES.forEach(z=>{ const raw = String(fd.get('zone_' + z) || '').trim(), v = parseInt(raw, 10); if(raw!=='' && isFinite(v)) out.zoneDef[z] = v; });
    out.traumaThreshold = int('traumaThreshold', cur.traumaThreshold||5);
    out.unprotectedEnabled = fd.get('unprotectedEnabled')==='on';
    out.unprotectedMod = int('unprotectedMod', -6);
    return out;
  }
  function openTokenForm(t, w, p){
    const editing = !!t, isPlayerTok = editing && t.kind==='player';
    let whoHtml = '';
    if(!editing && role()==='gm'){
      const free = Object.keys(session.players).filter(id=>!Object.values(authState.tokens).some(x=>x.kind==='player' && x.ownerId===id));
      if(free.length) whoHtml = `<label class="gt-f">Кто<select name="who"><option value="">NPC / объект</option>${free.map(id=>`<option value="${escapeHtml(id)}">Игрок: ${escapeHtml(playerDisplayName(session.players[id])||id)}</option>`).join('')}</select></label>`;
    }
    const cur = t || {name:'', hp:null, size:'normal', color:PALETTE[1], avatar:'', hidden:false, defense:0, defenseSubs:{}, traumaThreshold:5, unprotectedMod:-6};
    const subsState = { subs: Object.assign({}, cur.defenseSubs||{}) }; // защита по типам урона — меняется выбором брони из каталога
    const html = `<div class="gt-pop-title">${editing ? 'Жетон «'+escapeHtml(tokenName(t, vitalsFor(t)))+'»' : 'Новый жетон'}</div>`+
      (isPlayerTok ? '<div class="gt-pop-note">Имя, HP и Psi берутся из листа игрока.</div>' : '')+
      whoHtml+
      (isPlayerTok ? '' : `<label class="gt-f">Имя<input type="text" name="name" maxlength="60" value="${escapeHtml(cur.name||'')}" placeholder="Например, Болотный упырь"></label>`)+
      `<div class="gt-f-row">`+
      (isPlayerTok ? '' : `<label class="gt-f">HP<input type="number" name="hp" step="1" value="${cur.hp===null||cur.hp===undefined?'':cur.hp}" placeholder="—"></label>`+
        `<label class="gt-f" title="Полное кольцо по краю жетона; пусто — равно текущим HP">Макс. HP<input type="number" name="hpMax" step="1" min="1" value="${cur.hpMax||''}" placeholder="="></label>`)+
      `<label class="gt-f">Размер<select name="size">${sizeOptions(cur.size)}</select></label></div>`+
      `<label class="gt-f" style="margin-bottom:2px">Цвет</label>${swatchesHtml(cur.color)}`+
      `<label class="gt-f">Картинка (ссылка, необязательно)<input type="url" name="avatar" maxlength="2000" value="${escapeHtml(cur.avatar||'')}" placeholder="https://…"></label>`+
      (isPlayerTok ? '' : `<label class="gt-check"><input type="checkbox" name="hidden" ${cur.hidden?'checked':''}> Скрыт от игроков</label>`+
        `<label class="gt-check" title="По умолчанию игроки видят только кольцо по краю жетона, без числа"><input type="checkbox" name="hpShown" ${cur.hpShown?'checked':''}> Показывать игрокам число HP</label>`)+
      combatFieldsHtml(cur, isPlayerTok)+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">${editing?'Сохранить':'Создать'}</button></div>`;
    const form = openPopover(p, html, (f)=>{
      const fd = new FormData(f);
      const who = fd.get('who');
      const avatar = String(fd.get('avatar')||'').trim();
      if(avatar && !safeUrl(avatar)){ toast('Ссылка на картинку должна начинаться с http:// или https://'); return false; }
      const base = {size:fd.get('size'), color:fd.get('color')||cur.color, avatar};
      if(who){ // жетон конкретного игрока, поставленный Мастером
        const at = w || {x:0, y:0}, sn = snapPos(at.x, at.y, base.size);
        const r = execCommand({c:'player-token-create', ownerId:who, x:sn.x, y:sn.y});
        if(!r.ok){ toast(r.reason); return false; }
        const nt = Object.values(authState.tokens).find(x=>x.kind==='player' && x.ownerId===who);
        if(nt && (base.size!=='normal' || base.avatar || fd.get('color'))) act({c:'token-update', id:nt.id, patch:base});
        return;
      }
      if(!isPlayerTok){
        base.name = String(fd.get('name')||'').trim() || 'Жетон';
        const hpRaw = String(fd.get('hp')||'').trim();
        base.hp = hpRaw==='' ? null : parseInt(hpRaw, 10);
        const mxRaw = String(fd.get('hpMax')||'').trim();
        base.hpMax = mxRaw==='' ? (base.hp!==null && base.hp!==cur.hp ? Math.max(1, base.hp) : (cur.hpMax || null)) : parseInt(mxRaw, 10);
        base.hpShown = fd.get('hpShown')==='on';
        base.hidden = fd.get('hidden')==='on';
      }
      Object.assign(base, readCombatFields(fd, cur, isPlayerTok, subsState));
      if(editing){ act({c:'token-update', id:t.id, patch:base}); return; }
      const sn = snapPos(w.x, w.y, base.size);
      act({c:'token-create', token:Object.assign(base, {x:sn.x, y:sn.y})});
    });
    const whoSel = form.querySelector('select[name=who]');
    if(whoSel) whoSel.onchange = ()=>{
      const npc = !whoSel.value;
      ['name','hp','hpMax','hidden','hpShown'].forEach(n=>{ const el = form.querySelector(`[name=${n}]`); if(el){ el.disabled = !npc; const lab = el.closest('label'); if(lab) lab.style.opacity = npc ? '' : '.4'; } });
      const combat = form.querySelector('.gt-combat'); if(combat) combat.style.display = npc ? '' : 'none';
    };
    // Броня из каталога — сразу проставляет защиту и защиту по типам урона (поле «Защита» потом можно поправить)
    const armorSel = form.querySelector('select[name=armor]');
    if(armorSel) armorSel.onchange = ()=>{
      const a = combatCatalog().armor[+armorSel.value];
      const note = form.querySelector('[data-subs-note]');
      if(!a){ subsState.subs = {}; if(note) note.textContent = ''; return; }
      form.querySelector('[name=defense]').value = a.base;
      subsState.subs = Object.assign({}, a.subs);
      if(note) note.textContent = Object.keys(a.subs).length ? 'По типам урона: ' + Object.keys(a.subs).map(k=>k+a.subs[k]).join(', ') : '';
    };
  }
  function openVitalForm(t, which, p){
    const v = vitalsFor(t), label = which==='psi' ? 'Psi' : 'HP';
    let now = '—';
    if(t.kind==='player'){ if(!v){ toast('Лист игрока сейчас недоступен'); return; } now = which==='psi' ? `${v.psi} / ${v.psiMax}` : `${v.hp} / ${v.hpMax}`; }
    else now = t.hp===null || t.hp===undefined ? '—' : String(t.hp);
    const html = `<div class="gt-pop-title">${label} · ${escapeHtml(tokenName(t, v))}</div>`+
      `<div class="gt-pop-note">Сейчас: <b>${escapeHtml(now)}</b>. Число — установить, −3 / +2 — изменить${t.kind==='player'?', изменение уйдёт в лист игрока':''}.</div>`+
      `<label class="gt-f">Новое значение<input type="text" name="v" inputmode="numeric" placeholder="например −3"></label>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">Применить</button></div>`;
    openPopover(p, html, (f)=>{
      const raw = f.querySelector('[name=v]').value;
      if(t.kind==='player'){ changePlayerVitals(t, which, raw); return; }
      const parsed = parseVitalInput(raw);
      if(!parsed){ toast('Не понял число — например 17, −3 или +2'); return false; }
      const hp = parsed.mode==='delta' ? (Number(t.hp)||0) + parsed.value : parsed.value;
      act({c:'token-update', id:t.id, patch:{hp}});
    });
  }
  function openTextForm(w, p){
    const html = `<div class="gt-pop-title">Надпись на карте</div>`+
      `<label class="gt-f">Текст<textarea name="text" maxlength="400"></textarea></label>`+
      `<label class="gt-f">Размер<select name="fs"><option value="16">Мелкий</option><option value="22" selected>Обычный</option><option value="34">Крупный</option><option value="56">Заголовок</option></select></label>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">Добавить</button></div>`;
    const form = openPopover(p, html, (f)=>{
      const text = f.querySelector('[name=text]').value;
      if(!text.trim()) return false;
      addDrawing(Object.assign({}, drawStyle, {type:'text', text, fontSize:parseInt(f.querySelector('[name=fs]').value,10), points:[[r3(w.x), r3(w.y)]]}));
    });
    const ta = form.querySelector('textarea');
    ta.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); if(form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', {cancelable:true})); } }); // requestSubmit — только Safari 16+
  }
  // Положение карты из редактора на столе — только целыми клетками, чтобы её сетка совпадала с сеткой стола
  function openSceneForm(p){
    const sc = authState.map.scene; if(!sc) return;
    const html = `<div class="gt-pop-title">Карта «${escapeHtml(sc.name)}»</div>`+
      `<div class="gt-pop-note">${sc.cols}×${sc.rows} клеток. Левый верхний угол карты — в клетке стола (только целые клетки: сетка карты совпадает с сеткой стола).</div>`+
      `<div class="gt-f-row"><label class="gt-f">X<input type="number" name="x" step="1" value="${sc.x}"></label><label class="gt-f">Y<input type="number" name="y" step="1" value="${sc.y}"></label></div>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">Применить</button></div>`;
    openPopover(p, html, (f)=>{ act({c:'map-set', map:Object.assign({}, authState.map, {scene:Object.assign({}, sc, {x:Math.round(num(f.querySelector('[name=x]').value, sc.x)), y:Math.round(num(f.querySelector('[name=y]').value, sc.y))})})}); });
  }
  // Из редактора карт: поставить карту на стол. Та же карта (mapId) остаётся на прежнем месте, новая — в (0,0).
  function setScene(scene){
    if(!isAuthority()){ toast('Карту на стол ставит Мастер'); return false; }
    const cur = authState.map.scene, keep = cur && cur.mapId===scene.mapId;
    const ok = act({c:'map-set', map:Object.assign({}, authState.map, {scene:Object.assign({}, scene, {x: keep ? cur.x : 0, y: keep ? cur.y : 0})})});
    if(ok && !keep) if(typeof GmAdvice!=='undefined') GmAdvice.event('scene');
    return ok;
  }
  // Перейти к карте из редактора. Стол может быть ещё не разложен (первый показ, анимация на весь экран) —
  // тогда переход откладывается до resize(), и ещё секунду повторяется при каждом изменении размера поля.
  let focusPending = false, focusUntil = 0;
  function focusScene(){ focusPending = true; focusUntil = Date.now() + 1500; applySceneFocus(); }
  // Новая карта на столе (другой mapId) — перейти к ней у всех; правки той же карты камеру не трогают.
  let lastSceneId;
  function checkSceneChange(){
    const sc = st().map && st().map.scene, id = sc ? sc.mapId : null;
    if(lastSceneId!==undefined && id && id!==lastSceneId) focusScene();
    lastSceneId = id;
  }
  function applySceneFocus(){
    const sc = st().map && st().map.scene; if(!sc){ focusPending = false; return; }
    if(!vw || !visible || camNeedsCenter) return;
    focusPending = false;
    cam.z = clamp(Math.min((vw - 80)/(sc.cols*CELL), (vh - 80)/(sc.rows*CELL), cam.z > 0 ? 1.5 : 1), ZOOM_MIN, ZOOM_MAX);
    centerOn(sc.x + sc.cols/2, sc.y + sc.rows/2);
    requestRender({bg:true, draw:true, fx:true});
  }
  function openBackgroundForm(p){
    const bg = authState.map.background || {url:'', x:0, y:0, w:20};
    const html = `<div class="gt-pop-title">Фон карты</div>`+
      `<div class="gt-pop-note">Только ссылка на картинку — сам файл через сессию не пересылается. Левый верхний угол ставится в центр поля.</div>`+
      `<label class="gt-f">Ссылка<input type="url" name="url" value="${escapeHtml(bg.url)}" placeholder="https://…"></label>`+
      `<label class="gt-f">Ширина карты в клетках<input type="number" name="w" min="1" max="1000" step="1" value="${bg.w}"></label>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">Применить</button></div>`;
    openPopover(p, html, (f)=>{
      const url = safeUrl(f.querySelector('[name=url]').value);
      if(!url){ toast('Нужна ссылка, начинающаяся с http:// или https://'); return false; }
      const c = authState.map.background ? {x:bg.x, y:bg.y} : toWorld({x:vw/2, y:vh/2});
      act({c:'map-set', map:Object.assign({}, authState.map, {background:{url, x:Math.round(c.x), y:Math.round(c.y), w:num(f.querySelector('[name=w]').value, 20)}})}); // карту из редактора не трогаем
    });
  }

  /* ---------- крючки из существующего кода (все вызываются через gtHook) ---------- */
  // Лог бросков слева от стола: тот же #rollLogList (данные и отрисовка — renderRollLog листа), просто физически
  // переносится в панель, пока открыт стол, и возвращается на своё место в панели сессии при уходе с вкладки.
  const LOGDOCK_KEY = 'reincarnator_table_logdock_open_v1';
  let logHome = null;
  function dockRollLog(toTable){
    const list = document.getElementById('rollLogList');
    const body = document.getElementById('gtLogDockBody');
    if(!list || !body) return;
    if(!logHome) logHome = {parent:list.parentNode, next:list.nextSibling};
    if(toTable){ if(list.parentNode!==body) body.appendChild(list); }
    else if(list.parentNode!==logHome.parent) logHome.parent.insertBefore(list, logHome.next);
  }
  // Кнопка «📜 Лог» в строке над столом (рядом с «← К листу персонажа») — только пока открыт стол И развёрнут лог (боковая вкладка тогда скрыта CSS)
  function syncLogDockUi(){
    const dock = document.getElementById('gtLogDock'), tabBtn = document.getElementById('gtLogTabBtn');
    if(!dock || !tabBtn) return;
    tabBtn.style.display = (visible && dock.classList.contains('open')) ? '' : 'none';
  }
  function setLogDockOpen(open){
    const dock = document.getElementById('gtLogDock');
    if(!dock) return;
    dock.classList.toggle('open', !!open);
    try{ localStorage.setItem(LOGDOCK_KEY, open ? '1' : '0'); }catch(e){}
    syncLogDockUi();
    if(visible) resize(); // поле стало уже/шире
  }
  function setVisible(v){
    visible = !!v;
    dockRollLog(visible);
    syncLogDockUi();
    if(!visible){ cancelAll(); return; }
    resize();
    applyCamera();
    renderToolbar(); renderSubbar(); renderZoombar(); renderStatus(); showHint();
    renderTokens();
    requestRender({bg:true, draw:true, fx:true});
    if(typeof Bestiary!=='undefined') Bestiary.onTableShown();
  }
  function refreshRole(){
    const r = role();
    if(r!==lastRole){
      lastRole = r;
      cancelAll();
      setSelection([]);
      undoStack = []; redoStack = [];
      remoteVitals = {};
      tokenEls.forEach(el=>el.remove()); tokenEls.clear();
      if(!isAuthority() && ['token','draw','text'].indexOf(tool)>=0) tool = 'select';
      if(r!=='gm') pointerBroadcast = false;
      if(viewport){ renderToolbar(); renderSubbar(); renderTokens(); requestRender({bg:true, draw:true, fx:true}); }
    }
    if(viewport) renderStatus();
  }
  function onPlayerHello(id){ sendSnapshot(id); sendMsg({type:'gt-vitals', vitals:computeVitals()}, id); broadcastPortraits(id); renderStatus(); if(typeof Reactions!=='undefined') Reactions.onPlayerHello(id); }
  function onGmHello(){ lastSnapshotRequest = 0; requestSnapshot(); }
  function onPlayerSheet(){ renderTokens(); broadcastVitals(); broadcastPortraits(); }
  function onPeerLeft(id){
    if(role()==='gm'){ renderTokens(); broadcastVitals(); renderStatus(); }
    if(isPlayer() && id===session.gmId){ gmPointer = null; requestRender({fx:true}); }
  }
  function onLocalCharacterChanged(){ if(visible) renderTokens(); }

  function init(){
    viewport = document.getElementById('gtViewport');
    if(!viewport) return;
    layer = document.getElementById('gtTokenLayer');
    bgC = document.getElementById('gtCanvasBg'); drC = document.getElementById('gtCanvasDraw'); fxC = document.getElementById('gtCanvasFx');
    bgX = bgC.getContext('2d'); drX = drC.getContext('2d'); fxX = fxC.getContext('2d');
    toolbar = document.getElementById('gtToolbar'); subbar = document.getElementById('gtSubbar'); zoombar = document.getElementById('gtZoombar');
    statusEl = document.getElementById('gtStatus'); infoCard = document.getElementById('gtInfoCard'); hintEl = document.getElementById('gtHint');
    toastEl = document.getElementById('gtToast'); menuEl = document.getElementById('gtMenu'); popEl = document.getElementById('gtPopover');
    emptyHint = document.getElementById('gtEmptyHint');
    combatEl = document.createElement('div'); combatEl.className = 'gt-ui gt-combat'; combatEl.id = 'gtCombat'; viewport.appendChild(combatEl);
    combatEl.addEventListener('click', onCombatClick);
    combatEl.addEventListener('wheel', (e)=>e.stopPropagation(), {passive:true});
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', (e)=>{ touches.delete(e.pointerId); pinch = null; cancelInteraction(); });
    viewport.addEventListener('pointerleave', ()=>{ if(pointerBroadcast && role()==='gm') sendTransient({type:'gt-pointer', off:true}, 0); });
    viewport.addEventListener('wheel', onWheel, {passive:false});
    viewport.addEventListener('dblclick', onDblClick);
    viewport.addEventListener('contextmenu', onContextMenu);
    viewport.addEventListener('dragstart', (e)=>e.preventDefault());
    [toolbar, subbar, zoombar].forEach(el=>el.addEventListener('click', onToolbarClick));
    const logToggle = document.getElementById('gtLogToggle');
    if(logToggle){
      let open = false; try{ open = localStorage.getItem(LOGDOCK_KEY)==='1'; }catch(e){}
      document.getElementById('gtLogDock').classList.toggle('open', open);
      logToggle.addEventListener('click', ()=>setLogDockOpen(true));
      const logTabBtn = document.getElementById('gtLogTabBtn');
      if(logTabBtn) logTabBtn.addEventListener('click', ()=>setLogDockOpen(false));
    }
    subbar.addEventListener('input', onStyleInput);
    window.addEventListener('keydown', onKeyDown, true); // capture: раньше Ctrl+Z листа персонажа
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', ()=>{ spaceHeld = false; viewport.classList.remove('space-pan'); });
    if(typeof ResizeObserver!=='undefined') new ResizeObserver(()=>{ if(visible) resize(); }).observe(viewport);
    else window.addEventListener('resize', ()=>{ if(visible) resize(); });
    { const sc0 = st().map && st().map.scene; lastSceneId = sc0 ? sc0.mapId : null; } // карта, что уже была на столе при загрузке, камеру не двигает
    RoomTransport.onGameEvent((ev)=>{ if(ev && typeof ev.type==='string' && ev.type.indexOf('gt-')===0) handleTransient(ev); });
    window.addEventListener('reincarnator-assets', ()=>{ if(visible) requestRender({bg:true}); }); // догрузились картинки своих объектов
    // Стол Мастера сохранён в общем для вкладок localStorage. Вкладка, которая сейчас не Мастер (например,
    // вытесненная второй вкладкой — см. handleReplacedByOtherTab), подхватывает чужие сохранения, а не
    // держит устаревшую копию, которой потом перезаписала бы актуальный стол при первом же действии.
    window.addEventListener('storage', (e)=>{
      if(e.key!==STATE_KEY || !e.newValue || role()==='gm') return;
      let fresh; try{ fresh = normalizeState(JSON.parse(e.newValue)); }catch(err){ return; }
      authState = fresh;
      undoStack = []; redoStack = [];
      if(isAuthority()){ setSelection([]); renderTokens(); renderSubbar(); requestRender({bg:true, draw:true, fx:true}); }
    });
    refreshRole();
    renderToolbar(); renderZoombar(); renderStatus();
  }

  /* ---------- трекер боя ---------- */
  let combatEl = null, combatCollapsed = false, combatHints = null, lastTurnKey = '';
  const SIDE_NAMES = {s1:'Игроки и союзники', s2:'Противники', s3:'Третья сторона'};
  function combatSides(){ return Object.keys(SIDE_NAMES).map(id=>({id, name:SIDE_NAMES[id]})); }
  function setCombat(c){ act({c:'combat-set', combat:c}); }
  function abilityTextsOf(t){
    if(t.kind==='player'){ const c = attackerSheet(t); return c && Array.isArray(c.abilities) ? c.abilities.map(a=>({n:a.name || '', x:a.text || ''})) : []; }
    if(t.creature) return (t.creature.abil || []).map(a=>({n:a[0] || '', x:a[1] || ''}));
    return [];
  }
  // Максимум проверки инициативы: рефлексы + 10 − 6; «проверка инициативы +3 / Упрощена / Осложнена» из способностей —
  // сразу; условные («может…», «если…», «союзников…») — только подсказкой Мастеру
  function initiativeSetup(t){
    let refl = 3;
    if(t.kind==='player'){ const c = attackerSheet(t); if(c && c.stats && isFinite(Number(c.stats.refleksy))) refl = Number(c.stats.refleksy); }
    else if(t.reflexes!=null) refl = t.reflexes;
    let mod = 0, adv = 0, dis = 0; const notes = [], hints = [];
    abilityTextsOf(t).forEach(a=>{
      const sent = String(a.x).split(/(?<=[.!?])\s+/).filter(x=>/инициатив/i.test(x)).join(' ');
      if(!sent) return;
      // существо из листа персонажа: «может … совершить её Упрощённо» (за пси — решает Мастер), «смекалку вместо рефлексов»
      if(t.creature && t.creature.pc && /смекалк\S*\s+вместо\s+рефлекс/i.test(sent)){ const sm = typeof TargetRolls!=='undefined' ? TargetRolls.npcStat(t, 'smekalka') : refl;
        if(sm > refl){ refl = sm; notes.push(`${a.n}: смекалка ${sm} вместо рефлексов`); } return; }
      if(t.creature && t.creature.pc && /может[^.]*Упрощ/i.test(sent) && !/союзник|если\s+(?!боец|персонаж)/i.test(sent)){ const ps = /(\d+)\s+пси/i.exec(sent);
        adv++; notes.push(`${a.n}: Упрощена${ps ? ` (за ${ps[1]} пси)` : ''}`); return; }
      if(/союзник|может|если|когда|вместо/i.test(sent)){ hints.push(a.n || sent.slice(0, 40)); return; }
      const m = sent.match(/инициатив[^.]*?\+\s*(\d+)/i); if(m){ mod += +m[1]; notes.push(`${a.n} +${m[1]}`); }
      if(/Упрощ/i.test(sent)){ adv++; notes.push(`${a.n}: Упрощена`); }
      if(/Осложн/i.test(sent)){ dis++; notes.push(`${a.n}: Осложнена`); }
    });
    if(typeof AbilityKit!=='undefined'){ try{ const au = AbilityKit.initAura(t); mod += au.mod; notes.push(...au.notes); }catch(e){} }
    return {max:refl + 10 - 6 + mod, mode:adv>dis ? 'advantage' : dis>adv ? 'disadvantage' : 'plain', notes, hints};
  }
  function rollInitiative(c, ids, title, rxDelay){
    const list = []; let hiddenN = 0;
    ids.forEach(id=>{
      const t = authState.tokens[id], q = c.parts[id]; if(!t || !q) return;
      const name = tokenName(t, vitalsFor(t));
      let e;
      if(c.surprise && q.side===c.surprise){ q.init = {roll:0, rolls:[], max:0, mode:'plain', success:true, auto:true}; q.noAct = false; e = {name, auto:true, success:true}; }
      else {
        const su = initiativeSetup(t), rolls = su.mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)];
        const roll = pickD20ForMode(rolls[0], rolls[1], su.max, su.mode), ev = evaluateD20Check(roll, su.max);
        q.init = {roll, rolls, max:su.max, mode:su.mode, success:ev.success, auto:false}; q.noAct = !ev.success;
        e = {name, roll, rolls, max:su.max, mode:su.mode, success:ev.success, notes:su.notes.join('; ')};
      }
      if(t.hidden) hiddenN++; else list.push(e);
    });
    if(list.length || hiddenN) recordAndShareQuickRoll({initiative:true, title:title + (hiddenN ? ` (+ скрытых участников: ${hiddenN})` : ''), list});
    if(typeof Reactions!=='undefined') Reactions.trigger('init_fail', ids.filter(id=>c.parts[id] && c.parts[id].noAct), rxDelay || 0);
  }
  function openCombatSetup(btn){
    const r = btn.getBoundingClientRect(), vr = viewport.getBoundingClientRect(), p = {x:r.left - vr.left, y:r.bottom - vr.top + 2};
    const all = Object.values(authState.tokens), pick = selected.size>1 ? all.filter(t=>selected.has(t.id)) : all;
    if(!pick.length){ toast('На поле нет жетонов'); return; }
    const rows = pick.map(t=>{ const def = t.kind==='player' ? 's1' : 's2';
      return `<div class="gt-cb-setrow"><span>${escapeHtml(tokenName(t, vitalsFor(t)))}${t.hidden ? ' <i class="muted">(скрыт)</i>' : ''}</span><select name="side_${escapeHtml(t.id)}">${combatSides().map(x=>`<option value="${x.id}" ${x.id===def ? 'selected' : ''}>${x.name}</option>`).join('')}<option value="">— не участвует</option></select></div>`; }).join('');
    const html = `<div class="gt-pop-title">⚔ Начать бой</div>
      <div class="gt-pop-note">${selected.size>1 ? 'Участники — выбранные жетоны.' : 'Участники — все жетоны на поле (выделите несколько, чтобы взять только их).'} Сторона каждого:</div>
      <div class="gt-cb-setup">${rows}</div>
      <label class="gt-f">Конфликт начала сторона<select name="first">${combatSides().map(x=>`<option value="${x.id}" ${x.id==='s2' ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
      <label class="gt-check"><input type="checkbox" name="surprise"> Ход сюрприза — начавшая сторона застала другую врасплох (её участники автоматически преуспевают в проверке инициативы)</label>
      <div class="gt-pop-note">Проверка инициативы — Бросок рефлексов (−6) за всех: провал — без действия в этом круге, реакция остаётся.</div>
      <div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">🎲 Инициатива и в бой</button></div>`;
    openPopover(p, html, (f)=>{
      const fd = new FormData(f), parts = {};
      pick.forEach(t=>{ const sd = fd.get('side_' + t.id); if(sd) parts[t.id] = {side:sd, init:null, noAct:false, act:false, react:false, swap:false, effects:[]}; });
      const used = [...new Set(Object.values(parts).map(x=>x.side))];
      if(!used.length){ toast('Никто не участвует'); return false; }
      let first = String(fd.get('first')); if(used.indexOf(first)<0) first = used[0];
      const order = [first].concat(combatSides().map(x=>x.id).filter(id=>id!==first && used.indexOf(id)>=0));
      const c = {active:true, round:1, turn:0, scene:1, surprise:fd.get('surprise')==='on' ? first : '', sides:combatSides().filter(x=>used.indexOf(x.id)>=0), order, parts};
      if(typeof Reactions!=='undefined') Reactions.trigger('combat_start', Object.keys(parts));
      rollInitiative(c, Object.keys(parts), 'Инициатива — начало боя', typeof Reactions!=='undefined' ? (Reactions.config.dur*1000 + 300) : 0);
      combatCollapsed = false; combatHints = roundHints(c, 'start');
      setCombat(c); renderToolbar();
      if(typeof GmAdvice!=='undefined') GmAdvice.event('combat-start');
    });
  }
  // Подсказки Мастеру: способности участников, которые срабатывают «в начале/в конце круга»
  function roundHints(c, when){
    const re = when==='start' ? (c.round===1 ? /в начал\S* (?:каждого |нового |своего )?(?:круга|хода)|в начале боя|перед (?:сценой )?боя|до начала боя|\d+ реакци\S* в круг/i : /в начал\S* (?:каждого |нового |своего )?(?:круга|хода)/i) : /в конц\S* (?:каждого |своего )?(?:круга|хода)/i, items = [];
    Object.keys(c.parts).forEach(id=>{ const t = authState.tokens[id]; if(!t) return;
      abilityTextsOf(t).forEach(a=>{ if(re.test(a.x)) items.push(`${tokenName(t, vitalsFor(t))} — ${a.n || 'способность'}`); }); });
    return items.length ? {title:when==='start' ? `Начало круга ${c.round}` : `Конец круга ${c.round}`, items} : null;
  }
  function combatNext(){
    const c = clone(st().combat); if(!c) return;
    const rxTurn = (cc)=>{ if(typeof Reactions!=='undefined') Reactions.trigger('turn', Object.keys(cc.parts).filter(id=>cc.parts[id].side===cc.order[cc.turn])); };
    if(c.turn + 1 < c.order.length){ c.turn++; setCombat(c); rxTurn(c); return; }
    const endHints = roundHints(c, 'end'), ended = [], burns = [];
    c.round++; c.turn = 0;
    Object.keys(c.parts).forEach(id=>{
      const q = c.parts[id], t = authState.tokens[id];
      if(!t){ delete c.parts[id]; return; }
      q.act = q.react = q.swap = false; q.noAct = false;
      q.effects = q.effects.map(e=>({n:e.n, r:e.r - 1})).filter(e=>{ if(e.r<=0){ ended.push(`${tokenName(t, vitalsFor(t))}: «${e.n}»`); return false; } return true; });
      if(t.burning) burns.push(t);
    });
    burns.forEach(t=>act({c:'token-update', id:t.id, patch:{burning:t.burning - 1}}));
    Object.values(authState.tokens).forEach(t=>{ if(!(t.marks || []).some(m=>m.r)) return; // отметки на N кругов — новый круг, на 1 меньше
      act({c:'token-update', id:t.id, patch:{marks:t.marks.filter(m=>m.r!==1).map(m=>m.r ? {k:m.k, r:m.r - 1} : m)}}); }); // r=1 — истекает
    const startHints = roundHints(c, 'start'), items = [];
    if(endHints) items.push(...endHints.items.map(x=>'конец круга: ' + x));
    if(burns.length) items.push(...burns.map(t=>`🔥 ${tokenName(t, vitalsFor(t))} горит — осталось ${t.burning - 1}`));
    if(ended.length) items.push(...ended.map(x=>'⏳ закончился эффект ' + x));
    if(startHints) items.push(...startHints.items);
    combatHints = items.length ? {title:`Круг ${c.round}`, items} : null;
    setCombat(c);
    rxTurn(c);
    if((c.round - 1) % 3 === 0) if(typeof GmAdvice!=='undefined') GmAdvice.event('combat-round'); // каждый третий круг: 4-й, 7-й…
    if(ended.length) toast('Закончились эффекты: ' + ended.join(', '));
  }
  async function combatScene(){
    const c = clone(st().combat); if(!c) return;
    if(!(await uiConfirm('Сменилась сцена боя? Все участники заново пройдут проверку инициативы (провал — без действия в этом круге).', {ok:'Да', danger:true}))) return;
    c.scene++; c.surprise = '';
    Object.values(c.parts).forEach(q=>{ q.act = q.swap = false; });
    rollInitiative(c, Object.keys(c.parts), `Инициатива — смена сцены (круг ${c.round})`);
    setCombat(c);
    if(typeof GmAdvice!=='undefined') GmAdvice.event('combat-scene');
  }
  async function combatEnd(){
    const c = st().combat; if(!c) return;
    if(!(await uiConfirm(`Завершить бой (круг ${c.round})?`, {ok:'Да', danger:true}))) return;
    recordAndShareQuickRoll({initiative:true, title:`Бой завершён на круге ${c.round}`, list:[]});
    combatHints = null; setCombat(null); renderToolbar();
  }
  function combatMenuItems(t, p){
    const c = st().combat; if(!c) return [];
    const q = c.parts[t.id];
    if(!q) return combatSides().map(x=>({id:'cb_join_' + x.id, label:`⚔ Вступить в бой: ${x.name}`, run:()=>{
      const c1 = clone(st().combat); c1.parts[t.id] = {side:x.id, init:null, noAct:false, act:false, react:false, swap:false, effects:[]};
      if(!c1.sides.some(s0=>s0.id===x.id)){ c1.sides.push({id:x.id, name:x.name}); c1.order.push(x.id); }
      rollInitiative(c1, [t.id], `Инициатива — вступает в бой (круг ${c1.round})`); setCombat(c1); }}));
    return [{id:'cb_eff', label:'⏳ Эффект на N кругов…', run:()=>openEffectForm(t, p)},
            {id:'cb_out', label:'⚔ Выйти из боя', run:()=>{ const c1 = clone(st().combat); delete c1.parts[t.id]; setCombat(c1); }}];
  }
  function openEffectForm(t, p){
    const html = `<div class="gt-pop-title">⏳ Эффект: ${escapeHtml(tokenName(t, vitalsFor(t)))}</div>
      <label class="gt-f">Что за эффект<input type="text" name="n" maxlength="60" placeholder="Например, испуг, неистовство, щит"></label>
      <label class="gt-f">Кругов<input type="number" name="r" min="1" max="99" value="3"></label>
      <div class="gt-pop-note">В начале каждого нового круга счётчик уменьшается; когда дойдёт до нуля — эффект снимется с уведомлением.</div>
      <div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button><button type="submit" class="small primary">Добавить</button></div>`;
    openPopover(p, html, (f)=>{
      const fd = new FormData(f), n = String(fd.get('n') || '').trim(), r = parseInt(fd.get('r'), 10);
      if(!n || !(r>0)){ toast('Нужно название и число кругов'); return false; }
      const c1 = clone(st().combat); if(!c1 || !c1.parts[t.id]) return;
      c1.parts[t.id].effects.push({n, r}); setCombat(c1);
    });
  }
  function beep(){
    try{ const A = window.AudioContext || window.webkitAudioContext; if(!A) return; const ac = beep.ac || (beep.ac = new A());
      [0, 0.18].forEach(dt=>{ const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, ac.currentTime + dt); g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dt + 0.15);
        o.start(ac.currentTime + dt); o.stop(ac.currentTime + dt + 0.16); }); }catch(e){}
  }
  function renderCombat(){
    if(!combatEl) return;
    const c = st().combat, auth = isAuthority();
    if(!c){ combatEl.style.display = 'none'; if(infoCard) infoCard.style.bottom = ''; lastTurnKey = ''; return; }
    const activeSide = c.order[c.turn], sideName = (id)=>(c.sides.find(x=>x.id===id) || {}).name || id;
    // «Ваш ход» — игроку, когда наступает ход его стороны
    const key = c.round + ':' + c.turn, mine = ownToken();
    if(key!==lastTurnKey){ const was = lastTurnKey; lastTurnKey = key;
      if(was && role()==='player' && mine && c.parts[mine.id] && c.parts[mine.id].side===activeSide){ toast(`⚔ Ваш ход — круг ${c.round}`); beep(); } }
    const chips = (sid)=>Object.keys(c.parts).filter(id=>c.parts[id].side===sid && st().tokens[id]).map(id=>{
      const q = c.parts[id], t = st().tokens[id], name = tokenName(t, vitalsFor(t)), mineTok = t.kind==='player' && mine && mine.id===id;
      const can = auth || mineTok, dis = can ? '' : ' disabled';
      const ini = q.init ? (q.init.auto ? `<span class="ini ok" title="Ход сюрприза — автоматический успех">⚡</span>`
        : `<span class="ini ${q.init.success ? 'ok' : 'bad'}" ${auth ? 'data-cb="ini"' : ''} title="Инициатива: к20=${q.init.roll}${q.init.rolls.length>1 ? ' [' + q.init.rolls.join(', ') + ']' : ''} / Макс. ${q.init.max}${q.init.mode==='advantage' ? ', Упрощена' : q.init.mode==='disadvantage' ? ', Осложнена' : ''}${auth ? ' · клик — переключить успех/провал' : ''}">${q.init.roll}/${q.init.max}</span>`) : '';
      const eff = q.effects.map((e, i)=>`<span class="eff" ${auth ? `data-cb="eff" data-i="${i}"` : ''} title="${escapeHtml(e.n)}: осталось кругов ${e.r}${auth ? ' · клик — убрать' : ''}">⏳${escapeHtml(e.n)} ${e.r}</span>`).join('');
      return `<div class="gt-cb-chip${q.act || q.swap || q.noAct ? ' done' : ''}${q.noAct ? ' noact' : ''}" data-id="${escapeHtml(id)}">
        <span class="dot" style="background:${t.color}"></span><span class="nm" data-cb="focus" title="Показать на поле">${escapeHtml(name)}</span>${ini}
        ${q.noAct ? '<span class="lost" title="Провалил проверку инициативы — без действия в этом круге (реакция есть)">без действия</span>'
          : `<button type="button" data-cb="act" class="${q.act ? 'on' : ''}"${dis} title="Действие потрачено">Д</button>`}
        <button type="button" data-cb="react" class="${q.react ? 'on' : ''}"${dis} title="Реакция потрачена (1 за круг)">Р</button>
        ${q.noAct ? '' : `<button type="button" data-cb="swap" class="${q.swap ? 'on' : ''}"${dis} title="Действие обменяно на дополнительную реакцию">⇄</button>`}${eff}</div>`; }).join('');
    const head = `<div class="gt-cb-head"><span><b>⚔ Круг ${c.round}</b>${c.scene>1 ? ` · сцена ${c.scene}` : ''} · ходит: <b>${escapeHtml(sideName(activeSide))}</b></span>`+
      (auth ? `<span class="gt-cb-btns"><button type="button" class="small primary" data-cbh="next" title="Сторона сходила — передать ход следующей (после последней — новый круг)">▶ ${c.turn + 1 < c.order.length ? 'Ход: ' + escapeHtml(sideName(c.order[c.turn + 1])) : 'Новый круг'}</button><button type="button" class="small" data-cbh="scene" title="Смена сцены — заново проверка инициативы">🔄 Сцена</button><button type="button" class="small" data-cbh="end">⏹ Завершить</button></span>` : '') +
      `<button type="button" class="small gt-cb-fold" data-cbh="fold" title="${combatCollapsed ? 'Развернуть' : 'Свернуть'}">${combatCollapsed ? '▴' : '▾'}</button></div>`;
    const body = combatCollapsed ? '' : c.order.map((sid, i)=>`<div class="gt-cb-side${sid===activeSide ? ' on' : ''}"><div class="gt-cb-sname">${i + 1}. ${escapeHtml(sideName(sid))}${sid===c.surprise ? ' · ⚡ сюрприз' : ''}</div><div class="gt-cb-chips">${chips(sid) || '<span class="muted">—</span>'}</div></div>`).join('') +
      (auth && combatHints ? `<div class="gt-cb-hints"><b>📌 ${escapeHtml(combatHints.title)}</b> <button type="button" class="small" data-cbh="hints" title="Скрыть">✕</button><ul>${combatHints.items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '');
    combatEl.innerHTML = head + body;
    combatEl.style.display = 'block';
    if(infoCard) infoCard.style.bottom = (combatEl.offsetHeight + 18) + 'px';
  }
  function onCombatClick(e){
    const c = st().combat; if(!c) return;
    const h = e.target.closest('[data-cbh]');
    if(h){ const k = h.dataset.cbh;
      if(k==='fold'){ combatCollapsed = !combatCollapsed; renderCombat(); return; }
      if(k==='hints'){ combatHints = null; renderCombat(); return; }
      if(!isAuthority()) return;
      if(k==='next') combatNext(); else if(k==='scene') combatScene(); else if(k==='end') combatEnd();
      return; }
    const b = e.target.closest('[data-cb]'), chip = e.target.closest('[data-id]'); if(!b || !chip) return;
    const id = chip.dataset.id, q = c.parts[id], k = b.dataset.cb; if(!q) return;
    if(k==='focus'){ setSelection([id]); const t = tok(id); if(t) centerOnToken(t); return; }
    if(k==='act' || k==='react' || k==='swap'){
      if(isAuthority()){ const c1 = clone(c); c1.parts[id][k] = !q[k]; setCombat(c1); }
      else act({c:'combat-mark', id, field:k, value:!q[k]});
      return; }
    if(!isAuthority()) return;
    if(k==='ini'){ const c1 = clone(c); const q1 = c1.parts[id]; q1.init.success = !q1.init.success; q1.noAct = !q1.init.success; setCombat(c1); return; }
    if(k==='eff'){ const c1 = clone(c); c1.parts[id].effects.splice(+b.dataset.i, 1); setCombat(c1); }
  }
  function centerOnToken(t){ if(!viewport) return; cam.x = viewport.clientWidth/2 - t.x*CELL*cam.z; cam.y = viewport.clientHeight/2 - t.y*CELL*cam.z; applyCamera(); requestRender({bg:true, draw:true, fx:true}); }

  /* ---------- атака с карты ----------
     Атакующий (свой жетон игрока или жетон Мастера) → «Атаковать» в меню → клик по цели → окно атаки → жест
     броска (тот же, что в листе). Считает Мастер: у игрока нет модификаторов и защиты цели (они секретны).
     Максимум = навык боя (у NPC — 3) + Ат + черты + дистанция + выбранный гекс + мод. цели (+ по незащищённым).
     Каждое попадание — к12 ≤ (МУ − защита цели) — пробило (защита по типу урона МУ, если у брони указана;
     «по незащищённым» — защита 0); раны — как в листе (weaponHitPlan); к12 > «Травма-к12» у пробившего —
     травма 🦴 (красная — если у оружия черта «травма»). Раны сразу вычитаются из HP (у игрока — выдачей с
     подтверждением), Мастер может отменить атаку кнопкой ↶ в логе. */
  const ATTACK_RECORDS_KEY = 'reincarnator_attack_records_v1';
  let attackRecords = (function(){ const v = loadJson(ATTACK_RECORDS_KEY); return Array.isArray(v) ? v : []; })();
  function saveAttackRecords(){ attackRecords = attackRecords.slice(-100); saveJson(ATTACK_RECORDS_KEY, attackRecords); }
  let targeting = null;        // {attackerId, weaponIdx, fireMode, w, cur} — выбор цели на карте
  const lastAttackReqs = {};   // attackId -> {req, from} — для переброса способностями существ (Малая цель, Уход техника СДК…)
  const pendingAttacks = {};   // attackId -> контекст своей атаки (для «Скорости» и переброса после ответа Мастера)
  let firstDmgSeen = {};       // «первый урон в бою наносит раны N»: атакующий|оружие → уже был (сброс — когда бой трекера закончен)

  function npcWeapon(t){ // оружие жетона Мастера выдано Мастером — доступно всегда; условные черты — по силе NPC
    const p = t && t.weaponText ? parseWeaponStats(t.weaponText) : null;
    if(!p) return null;
    const w = applyWielder(Object.assign({}, p, {name:p.cleanName, muType:p.hitType, travma:hasWeaponTag(p.statText, 'травма'), speedBonusAvailable:false}), npcWielderStats(t.strength), true);
    if(w) w.npcSkill = (t.atkSkill===null || t.atkSkill===undefined) ? null : t.atkSkill;
    return w;
  }
  function sheetWeapon(c, idx){ return sheetWeaponEffective(c, idx); }
  function weaponModes(w){
    const m = [['attack','атака']];
    if(w && w.avtomat) m.push(['burst','длинная очередь'], ['suppress','подавляющий огонь']);
    return m;
  }
  function attackerSheet(att){ // лист атакующего/атакуемого жетона игрока: свой или (у Мастера) копия
    if(!att || att.kind!=='player') return null;
    if(att.ownerId===myOwnerId()) return (typeof character!=='undefined') ? character : null;
    const p = session.players[att.ownerId];
    return p && p.character;
  }
  // Дальность: ближний бой (у оружия нет Дл) — только соседняя клетка; иначе Дл в метрах от центра до центра:
  // дальше Дл −3, дальше 2×Дл −9, дальше 3×Дл — атака невозможна.
  function rangeInfo(att, tgt, w){
    const cells = Math.hypot(tgt.x-att.x, tgt.y-att.y);
    const meters = Math.round(cells*METERS_PER_CELL*10)/10;
    if(w.grenade){ // метание: до предела броска (вес + сила), дальше 12 м — Помеха −6
      if(meters>w.maxRange) return {ok:false, pen:0, meters, label:`дальше ${w.maxRange} м — не добросить`};
      return meters>12 ? {ok:true, pen:-6, meters, label:`метание дальше 12 м: −6 (предел ${w.maxRange} м)`} : {ok:true, pen:0, meters, label:`метание (предел ${w.maxRange} м)`};
    }
    if(w.dl==null){
      const reach = (SIZE_CELLS[att.size] + SIZE_CELLS[tgt.size||'normal'])/2 + 0.75;
      return cells<=reach ? {ok:true, pen:0, meters, label:'ближний бой'} : {ok:false, pen:0, meters, label:'вне досягаемости (ближний бой — только соседняя клетка)'};
    }
    const dl = w.dl;
    if(meters<=dl) return {ok:true, pen:0, meters, label:`в пределах Дл${dl}`};
    if(meters<=2*dl) return {ok:true, pen:-3, meters, label:`дальше Дл${dl}: −3`};
    if(meters<=3*dl) return {ok:true, pen:-9, meters, label:`дальше 2×Дл${dl}: −9`};
    return {ok:false, pen:0, meters, label:`дальше 3×Дл${dl} — атака невозможна`};
  }
  function canTarget(att, tgt){
    if(!att || !tgt || att.id===tgt.id) return false;
    return isPlayer() ? tgt.kind==='gm' : true;
  }
  // Прицельная атака (стр. 39): по части тела −6; урон одного попадания — против защиты этой зоны (у NPC зон нет — защита тела)
  const AIM_ZONES = ['golova', 'plechi', 'ruki', 'bedra', 'nogi'];
  // Атака с двумя оружиями (стр. 39): одно действие, каждое оружие проверяется отдельно с −3; «Амбидекстр» 2-го уровня снимает штраф
  function dualPenalty(c, isNpc){ return !isNpc && c && specTier(c, 'ambidekstr') >= 2 ? 0 : 3; }
  // Известная атакующему часть Максимума (без модификаторов цели). opts: aim — зона прицельной атаки, dual — атака двумя оружиями
  function attackKnownPart(c, w, fireMode, range, optikaOn, isNpc, opts){
    opts = opts || {};
    const tags = [];
    let base;
    if(fireMode==='suppress'){ base = 12; tags.push('Подавляющий огонь: Максимум 12'); }
    else {
      const sk = weaponCombatSkill(w);
      const skillVal = isNpc ? (w.npcSkill!=null ? w.npcSkill : 3) : (sk && c ? (c.stats[sk]||0) : 0);
      base = 10 + skillVal + (w.at||0);
      tags.push(isNpc ? `Навык NPC: ${10+skillVal}` : `${STAT_LABELS[sk]||'Навык'}: ${10+skillVal}`, `Ат оружия: ${w.at>=0?'+':''}${w.at}`);
      (w.techNotes||[]).concat((w.condNotes||[]).filter(n=>/Ат/.test(n))).forEach(n=>tags.push(n)); // Ат уже с ними (applyWielder)
      const fav = !isNpc && c ? favoriteWeaponBonus(c, w) : 0;
      if(fav){ base += fav; tags.push(`Любимое оружие: +${fav}`); }
      if(fireMode==='burst' && range.meters>12){ base -= 6; tags.push('Очередь дальше 12 м: −6'); }
      if(fireMode==='attack' && w.optika && optikaOn && range.meters>=30){ base += 6; tags.push('Оптика (30 м+): +6'); }
      if(opts.aim){ base -= 6; tags.push(`Прицельно — ${String(ARMOR_ZONE_LABELS[opts.aim] || opts.aim).toLowerCase()}: −6`); }
      if(opts.dual){ const p = dualPenalty(c, isNpc); base -= p; tags.push(p ? `Двумя оружиями: −${p}` : 'Двумя оружиями: без штрафа («Амбидекстр»)'); }
    }
    if(range.pen){ base += range.pen; tags.push(`Дистанция ${fmtNum(range.meters)} м: ${range.pen}`); }
    else tags.push(`Дистанция ${fmtNum(range.meters)} м`);
    return {base, tags};
  }
  // Постоянные способности существ (AbilityKit): Ирреальный, Инфлятор, Владение, Муштра, Мука, Сыпучая кора, Инерционный щит…
  function passiveAtk(att, tgt, w, commit){ try{ return typeof AbilityKit!=='undefined' ? AbilityKit.attackPassives(att, tgt, w, {commit:!!commit}) : null; }catch(e){ console.warn('[Способности]', e); return null; } }
  function secretPart(tgt, unprotected){
    let v = 0; const tags = [];
    if(tgt.attackModEnabled && tgt.attackMod){ v += tgt.attackMod; tags.push(`Мод. цели: ${tgt.attackMod>0?'+':''}${tgt.attackMod}`); }
    if(unprotected && tgt.unprotectedEnabled){ v += tgt.unprotectedMod; tags.push(`По незащищённым: ${tgt.unprotectedMod}`); }
    return {v, tags};
  }
  function targetDefense(tgt, muType){
    if(tgt.kind==='gm') return defenseAgainst(tgt.defense, tgt.defenseSubs, muType);
    return characterTorsoDefense(attackerSheet(tgt), muType);
  }

  /* Цели способности прямо на карте (кнопка ⚔ у способности существа — AbilityKit, у персонажа — PcAbilities): клик по
     жетону — цель; набралось n целей — готово (при n > 1 — «Готово» раньше, повторный клик снимает цель). Esc / правый
     клик — отмена. Игрок выбирает цели только для своего жетона. */
  let abilityPick = null, pickInfo = null; // {srcId, n, title, rangeM, ids, cur, done}
  function pickUnder(cur){ return Object.values(st().tokens).find(t=>tokenVisibleHere(t) && t.id!==(abilityPick && abilityPick.srcId) && Math.hypot(t.x-cur.x, t.y-cur.y) <= SIZE_CELLS[t.size]/2) || null; }
  function pickTargets(o){
    if(!viewport || !(isAuthority() || (o && o.srcId && canControl(tok(o.srcId))))){ if(o && o.done) o.done(null); return; }
    cancelAll();
    abilityPick = {srcId:o.srcId || null, n:Math.max(1, o.n || 1), title:o.title || 'Способность', rangeM:o.rangeM || 0, ids:[], cur:null, done:o.done};
    renderPickInfo(); showHint(); requestRender({fx:true});
  }
  function finishPick(ids){ const P = abilityPick; abilityPick = null; renderPickInfo(); showHint(); requestRender({fx:true}); if(P && P.done) P.done(ids); }
  function handlePickClick(e){
    const P = abilityPick, t = tokenFromEvent(e);
    if(!t){ if(e.pointerType==='touch') finishPick(null); else toast('Выберите жетон-цель · Esc — отмена'); return; }
    if(t.id===P.srcId){ toast('Это само существо — выберите цель'); return; }
    const i = P.ids.indexOf(t.id); if(i >= 0) P.ids.splice(i, 1); else P.ids.push(t.id);
    if(P.ids.length >= P.n) finishPick(P.ids.slice()); else { renderPickInfo(); requestRender({fx:true}); }
  }
  function renderPickInfo(){
    const P = abilityPick;
    if(!P){ if(pickInfo){ pickInfo.remove(); pickInfo = null; } return; }
    if(!pickInfo){ pickInfo = document.createElement('div'); pickInfo.className = 'at-info at-pick gt-ui';
      pickInfo.addEventListener('click', (e)=>{ const b = e.target.closest('[data-pk]'); if(!b || !abilityPick) return; e.stopPropagation(); finishPick(b.dataset.pk==='done' ? abilityPick.ids.slice() : null); }); }
    if(pickInfo.parentNode!==viewport) viewport.appendChild(pickInfo);
    const names = P.ids.map(id=>{ const t = tok(id); return t ? tokenName(t, vitalsFor(t)) : '?'; });
    pickInfo.innerHTML = `<b>⚔ ${escapeHtml(P.title)}</b> · ${P.n > 1 ? `цели: <b>${P.ids.length}/${P.n}</b>` : 'выберите цель'}${P.rangeM ? ` · дальность ${P.rangeM} м` : ''}`+
      (names.length ? `<div class="at-names">${names.map(escapeHtml).join(', ')}</div>` : '')+
      `<div class="at-hint">${IS_TOUCH_UI ? 'Тап' : 'Клик'} по жетону — цель${P.n > 1 ? ', ещё раз — снять' : ''}. Параметры — как в карточке.</div>`+
      `<div class="at-btns"><button type="button" class="small" data-pk="cancel">Отмена</button>${P.n > 1 ? `<button type="button" class="small primary" data-pk="done" ${P.ids.length ? '' : 'disabled'}>Готово — ${P.ids.length}</button>` : ''}</div>`;
  }
  // Атака оружием существа: оружие становится «в руке» жетона (Максимум из книги — через atkSkill), затем выбор цели
  function creatureAttack(id, text, skill, mode){
    const t = tok(id); if(!t || !isAuthority()) return;
    if(t.weaponText!==text || t.atkSkill!==skill) act({c:'token-update', id, patch:{weaponText:text, atkSkill:skill}});
    const nt = tok(id); if(!nt || !npcWeapon(nt)){ toast('Не удалось разобрать оружие'); return; }
    startTargeting(nt, null, mode || 'attack');
  }
  // Жетон из бестиария: поставить в точку экрана (или в центр поля)
  function placeToken(fields, cx, cy){
    if(!isAuthority() || !viewport){ toast('Ставить жетоны может только Мастер'); return false; }
    const r = viewport.getBoundingClientRect();
    const p = cx==null ? {x:viewport.clientWidth/2, y:viewport.clientHeight/2} : {x:cx - r.left - viewport.clientLeft, y:cy - r.top - viewport.clientTop};
    const w = toWorld(p); let sn = snapPos(w.x, w.y, fields.size);
    if(cx==null){ // в центр — на ближайшую свободную клетку по спирали, чтобы жетоны не ложились стопкой
      const busy = (x, y)=>Object.values(authState.tokens).some(t=>Math.hypot(t.x - x, t.y - y) < (SIZE_CELLS[t.size] + SIZE_CELLS[fields.size]) / 2 - 0.05);
      const step = Math.max(1, SIZE_CELLS[fields.size]);
      outer: for(let r=0; r<=12; r++) for(let dx=-r; dx<=r; dx++) for(let dy=-r; dy<=r; dy++){
        if(Math.max(Math.abs(dx), Math.abs(dy))!==r) continue;
        const c = {x:sn.x + dx*step, y:sn.y + dy*step}; if(!busy(c.x, c.y)){ sn = c; break outer; } }
    }
    return act({c:'token-create', token:Object.assign({}, fields, {x:sn.x, y:sn.y})});
  }
  function startTargeting(att, weaponIdx, fireMode){
    const w = fireMode==='grenade' ? grenadeWeapon(att, weaponIdx) : MANEUVERS[fireMode] ? maneuverWeapon(fireMode) : att.kind==='player' ? sheetWeapon(attackerSheet(att), weaponIdx) : npcWeapon(att);
    if(!w){ toast('Нет оружия для атаки'); return; }
    cancelAll();
    targeting = {attackerId:att.id, weaponIdx, fireMode, w, cur:null};
    setSelection([att.id]); showHint(); requestRender({fx:true});
  }
  function targetUnder(att, cur){
    if(!cur) return null;
    return Object.values(st().tokens).find(t=>tokenVisibleHere(t) && canTarget(att, t) && Math.hypot(t.x-cur.x, t.y-cur.y) <= SIZE_CELLS[t.size]/2) || null;
  }
  function handleTargetClick(e, p){
    const att = tok(targeting.attackerId);
    if(!att){ targeting = null; showHint(); return; }
    const tgt = tokenFromEvent(e);
    if(!tgt && e.pointerType==='touch'){ targeting = null; showHint(); requestRender({fx:true}); toast('Атака отменена'); return; } // на телефоне нет Esc и правого клика
    if(!tgt || !canTarget(att, tgt)){ toast(tgt ? 'Эту цель атаковать нельзя' : 'Выберите жетон-цель · Esc — отмена'); return; }
    const range = rangeInfo(att, tgt, targeting.w);
    if(!range.ok){ toast('Цель ' + range.label); return; }
    const t = targeting;
    targeting = null; showHint(); requestRender({fx:true});
    if(t.w.grenade) openGrenadePopover(att, tgt, t, range, p);
    else if(t.w.maneuver) openManeuverPopover(att, tgt, t, range, p);
    else openAttackPopover(att, tgt, t, range, p);
  }
  function openAttackPopover(att, tgt, t, range, p){
    const c = att.kind==='player' ? attackerSheet(att) : null;
    const modeName = (weaponModes(t.w).find(m=>m[0]===t.fireMode) || [])[1] || 'атака';
    const auth = isAuthority();
    const unprotHtml = tgt.unprotectedEnabled
      ? `<label class="gt-check"><input type="checkbox" name="unprot"> По незащищённым частям${auth ? ` (${tgt.unprotectedMod})` : ''} — защита цели не учитывается</label>` : '';
    const optikaNote = (t.fireMode==='attack' && t.w.optika && att.kind==='player' && range.meters>=30)
      ? '<div class="gt-pop-note">Оптика учтётся, если отмечена на карточке оружия (реакция).</div>' : '';
    // прицельная атака — по зоне тела (−6); второе оружие — тем же действием (каждому −3); «до N атак одним действием» — серия
    const aimHtml = t.fireMode==='suppress' ? '' : `<label class="gt-check">🎯 Прицельно: <select name="aim"><option value="">нет — по телу</option>${AIM_ZONES.map(z=>`<option value="${z}">${ARMOR_ZONE_LABELS[z]}</option>`).join('')}</select> −6</label>`;
    const otherIdx = att.kind==='player' && c && (t.weaponIdx===0 || t.weaponIdx===1) && t.fireMode!=='suppress' ? 1 - t.weaponIdx : null;
    const other = otherIdx!=null ? sheetWeapon(c, otherIdx) : null, otherOk = !!(other && !weaponBlockedReason(c, otherIdx));
    const dualWhy = otherOk ? dualWieldBlock(c) : null; // двуручное парой — «Две пушки», размер, сила
    const dualHtml = !otherOk ? '' : dualWhy ? `<div class="gt-pop-note">⚔⚔ Двумя оружиями нельзя: ${escapeHtml(dualWhy)}.</div>`
      : `<label class="gt-check"><input type="checkbox" name="dual"> ⚔⚔ Двумя оружиями: ещё «${escapeHtml(other.name)}» — одно действие, каждому ${dualPenalty(c, false) ? '−3' : 'без штрафа («Амбидекстр»)'}</label>`;
    const apa = t.fireMode==='attack' && t.w.attacksPerAction > 1 ? t.w.attacksPerAction : 0;
    const multiHtml = !apa ? '' : `<label class="gt-check">Атак этим действием: <select name="multi">${Array.from({length:apa}, (_, i)=>`<option value="${i+1}"${i+1===apa ? ' selected' : ''}>${i+1}</option>`).join('')}</select></label>`;
    const lineNote = t.w.lineWidth && t.fireMode!=='suppress' ? `<div class="gt-pop-note">Линия шириной ${t.w.lineWidth} м через цель до ${fmtNum(3*(t.w.dl || 0))} м: по каждому жетону на ней (и своим) — отдельная проверка, к20 бросает стол.</div>` : '';
    const seriesNote = lineNote + (dualHtml || multiHtml ? '<div class="gt-pop-note">Следующие атаки действия бросаются сами (тот же жест — Преимущество/Помеха); переброс — только у первой. Двуручное оружие парой — с «Двумя пушками».</div>' : '');
    const html = `<div class="gt-pop-title">⚔ ${escapeHtml(t.w.name)} → ${escapeHtml(tokenName(tgt, vitalsFor(tgt)))}</div>`+
      `<div class="gt-pop-note">${escapeHtml(modeName)} · ${fmtNum(range.meters)} м · ${escapeHtml(range.label)}</div>` + optikaNote + unprotHtml + aimHtml + dualHtml + multiHtml + seriesNote +
      `<div class="gt-pop-note">${auth ? 'Модификаторы цели уже в Максимуме.' : 'Модификаторы цели учтёт Мастер — итог появится в общем логе.'}</div>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button>`+
      `<button type="button" class="small primary" data-roll title="Нажмите и протяните — как бросок в листе">🎯 Бросок — нажмите и тяните</button></div>`;
    const form = openPopover(p, html, ()=>false);
    form.querySelector('[data-roll]').addEventListener('pointerdown', (ev)=>{
      ev.preventDefault();
      const unEl = form.querySelector('[name=unprot]');
      const unprot = !!(unEl && unEl.checked);
      const optikaOn = att.kind==='player' && !!t.w.optika && checkboxOn('weaponOptika' + t.weaponIdx);
      const aimEl = form.querySelector('[name=aim]'), aim = aimEl && AIM_ZONES.indexOf(aimEl.value) >= 0 ? aimEl.value : null;
      const dualEl = form.querySelector('[name=dual]'), dual = !!(dualEl && dualEl.checked);
      const multiEl = form.querySelector('[name=multi]'), multi = multiEl ? Math.max(1, Math.min(apa, +multiEl.value || 1)) : 1;
      const known = attackKnownPart(c, t.w, t.fireMode, range, optikaOn, att.kind==='gm', {aim, dual});
      let knownBase = known.base, tags = known.tags;
      if(auth){ const sec = secretPart(tgt, unprot); knownBase += sec.v; tags = tags.concat(sec.tags);
        const pa = passiveAtk(att, tgt, t.w); if(pa && (pa.mod || pa.tags.length)){ knownBase += pa.mod; tags = tags.concat(pa.tags); } } // Мастер видит полный Максимум
      const plan = []; // остальные атаки того же действия: ещё раз тем же оружием («атаковать дважды»), второе оружие
      for(let i=1;i<multi;i++) plan.push({weaponIdx:t.weaponIdx, fireMode:t.fireMode});
      if(dual) plan.push({weaponIdx:otherIdx, fireMode:weaponModes(other).some(m=>m[0]===t.fireMode) ? t.fireMode : 'attack'});
      if(plan.length) tags = tags.concat([`Ещё ${plan.length} ${plan.length===1 ? 'атака' : 'атаки'} этим действием — бросятся сами`]);
      _mapAttackCtx = { attackerId:att.id, targetId:tgt.id, weaponIdx:t.weaponIdx, fireMode:t.fireMode, unprotected:unprot, optikaOn, aim, dual, plan,
                        knownBase, tags, rerollOf:null };
      closePopover();
      openRollPicker('map_attack', ev.clientX, ev.clientY, 0);
    });
  }
  // После броска (executeMapAttackRoll): Мастер/локальный стол считает сам, игрок отправляет Мастеру
  function submitMapAttack(ctx, r){
    if(!ctx) return;
    const req = { attackId:newId('atk'), attackerId:ctx.attackerId, targetId:ctx.targetId, weaponIdx:ctx.weaponIdx, fireMode:ctx.fireMode,
                  unprotected:!!ctx.unprotected, optikaOn:!!ctx.optikaOn, aim:ctx.aim||null, dual:!!ctx.dual, parryItem:ctx.parryItem||null,
                  rolls:r.rolls, mode:r.mode, chosenMod:r.chosenMod, rerollOf:ctx.rerollOf||null };
    const att = tok(ctx.attackerId);
    const speedOf = (idx)=>{ const c = att && att.kind==='player' ? attackerSheet(att) : null, slot = c && c.weapons && c.weapons[idx]; return !!(slot && slot.skorost && slot.speedBonusAvailable); };
    if(att && att.kind==='player') req.speedAvailable = speedOf(ctx.weaponIdx);
    // остальные атаки того же действия: к20 бросаются здесь же, тем же режимом жеста (переброс — только первой атаки)
    if(ctx.plan && ctx.plan.length && !ctx.rerollOf) req.series = ctx.plan.slice(0, 3).map(s=>({ weaponIdx:s.weaponIdx, fireMode:s.fireMode,
      rolls: r.mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)], speedAvailable:speedOf(s.weaponIdx) }));
    pendingAttacks[req.attackId] = Object.assign({}, ctx, {chosenMod:r.chosenMod, mode:r.mode});
    if(isAuthority()){
      const res = resolveAttack(req, null);
      if(!res.ok){ delete pendingAttacks[req.attackId]; toast(res.reason); return; }
      afterAttackResult(req.attackId, res);
      return;
    }
    if(!session.gmId){ delete pendingAttacks[req.attackId]; toast('Мастер не в сети — атака не отправлена'); return; }
    sendMsg({type:'gt-attack', req}, session.gmId);
  }
  // Своя атака персонажем листа: снять «Скорость», если сработала, и предложить переброс (он заменит эту атаку)
  function afterAttackResult(attackId, res){
    const ctx = pendingAttacks[attackId];
    if(!ctx) return;
    delete pendingAttacks[attackId];
    const att = tok(ctx.attackerId);
    if(!att || att.kind!=='player' || att.ownerId!==myOwnerId() || typeof character==='undefined' || !character) return; // NPC — без переброса
    if(ctx.fireMode==='grenade'){
      if(!ctx.rerollOf && consumeGrenade(character, ctx.weaponIdx)) renderAll(); // переброс той же гранаты не списывает вторую
      _mapAttackCtx = Object.assign({}, ctx, {rerollOf:attackId});
      showRerollPopup('map_attack', ctx.chosenMod||0, ctx.mode);
      return;
    }
    const slot = character.weapons && character.weapons[ctx.weaponIdx];
    let changed = false;
    if(res.speedUsed && slot && slot.speedBonusAvailable){ slot.speedBonusAvailable = false; changed = true; }
    if(slot && slot.odnozaryadnoe && slot.loaded!==false){ slot.loaded = false; changed = true; } // выстрел разрядил однозарядное
    (res.extra || []).forEach(x=>{ // остальные атаки того же действия (второе оружие, «атаковать дважды»)
      const s2 = character.weapons && character.weapons[x.weaponIdx];
      if(!x.ok){ if(x.reason) toast(`${s2 && s2.name ? '«' + s2.name + '»: ' : ''}${x.reason}`); return; }
      if(x.speedUsed && s2 && s2.speedBonusAvailable){ s2.speedBonusAvailable = false; changed = true; }
      if(s2 && s2.odnozaryadnoe && s2.loaded!==false){ s2.loaded = false; changed = true; } });
    if(changed) renderAll();
    if(!res.jammed){
      _mapAttackCtx = Object.assign({}, ctx, {rerollOf:attackId, plan:null}); // переброс — только этой атаки, без остальных атак серии
      showRerollPopup('map_attack', ctx.chosenMod||0, ctx.mode);
    }
  }
  // Попадания по профилю способности существа («2 попадания с МУ 12 удар, раны 3, травма»): как у атаки с карты —
  // к12 на попадание против (МУ − защита цели), пробившие наносят раны; к12 выше порога травмы — травма
  function rollWoundsExpr(v){ const s = String(v==null ? '' : v).trim().replace(/[−–]/g, '-'), m = /^(\d*)[кkdд](\d+)\s*([+-]\s*\d+)?$/i.exec(s);
    if(m){ let t = 0; for(let i=0;i<(+m[1] || 1);i++) t += 1 + Math.floor(Math.random()*(+m[2])); return t + (m[3] ? +m[3].replace(/\s/g, '') : 0); }
    const n = parseInt(s, 10); return isFinite(n) ? n : 0; }
  // Черты — как у оружия (weaponHitPlan): «мощь» — раны = выпавший к12 (если раны не указаны); «пул» — [КУ существа] к12
  // на попадание, берётся наибольший пробивший; «разрыв» — +4 раны, если на к20 существа выпало 11+. h.cat, h.roll — бросок существа.
  // Способности цели: меньше/больше ран (в т. ч. по типу МУ), усиления защиты.
  // Травмы — в таблицу травм (23-trauma-table.js): попадание в голову — пробившее с к12=12 (у «Бей в голову» при стрельбе —
  // 11 и 12), черта оружия «травма» — бросок по таблице Осложнённо
  function headFrom(att, w){ const re = /значени\S*\s+11\s+и\s+12\s+на\s+к12/i, c = att && att.kind==='player' ? attackerSheet(att) : null;
    const has = (c && (c.abilities || []).some(a=>re.test(a.text || ''))) || (att && att.creature && (att.creature.abil || []).some(a=>re.test(a[1] || '')));
    return has && w && w.dl!=null ? 11 : 12; }
  function noteTraumas(tgt, hits, head, redAll){ if(typeof TraumaTable==='undefined' || !tgt || tgt.kind!=='gm') return;
    TraumaTable.noteHits(tgt.id, hits.filter(x=>x.trauma).map(x=>({head:x.k12 >= head || !!x.headAim, red:!!(redAll || x.red)}))); } // headAim — прицельное в голову
  function applyHitsTo(id, h){
    const tgt = tok(id); if(!tgt || !isAuthority() || !(h && h.n > 0)) return null;
    let pa = null; try{ pa = typeof AbilityKit!=='undefined' ? AbilityKit.hitPassives(tgt) : null; }catch(e){ console.warn('[Способности]', e); }
    pa = pa || {adj:{}, adjAll:0, defMod:0, tags:[]};
    const max12 = (h.mu || 0) - targetDefense(tgt, h.muType) - (pa.defMod || 0), thr = tgt.kind==='player' ? 5 : (tgt.traumaThreshold || 5), hits = [];
    const nat = tokenNature(tgt), per = h.pul ? Math.max(1, h.cat || 1) : 1, rz = h.razryv && (h.roll || 0) >= 11 ? 4 : 0, adj = (pa.adjAll || 0) + (pa.adj[String(h.muType || '').toLowerCase()] || 0);
    for(let i=0;i<Math.min(30, h.n);i++){
      const rolls12 = Array.from({length:per}, ()=>randInt(12)), fits = rolls12.filter(k=>k<=max12), pen = max12 >= 1 && fits.length > 0;
      const k12 = pen ? Math.max(...fits) : Math.max(...rolls12);
      const wounds = pen ? Math.max(0, Math.max(1, (h.moshh ? k12 : rollWoundsExpr(h.wounds || 1)) + rz) + adj) : 0;
      hits.push({k12, rolls12:per > 1 ? rolls12 : null, pen, wounds, trauma:pen && k12 > thr && nat!=='void'}); }
    const total = hits.reduce((a, x)=>a + x.wounds, 0), trN = hits.filter(x=>x.trauma).length, patch = {};
    noteTraumas(tgt, hits, 12, h.travma);
    if(trN){ if(h.travma) patch.traumaRed = (tgt.traumaRed || 0) + trN; else patch.trauma = (tgt.trauma || 0) + trN; }
    if(total){ if(tgt.kind==='gm'){ if(tgt.hp!==null && tgt.hp!==undefined) patch.hp = tgt.hp - total; } else changeCharacterHp(tgt.ownerId, -total); }
    if(Object.keys(patch).length) execCommand({c:'token-update', id, patch});
    const each = hits.length > 1 && hits.some(x=>x.pen && x.wounds!==hits.find(y=>y.pen).wounds);
    const txt = `к12≤${max12} → ${hits.map(x=>`${x.rolls12 ? `[${x.rolls12.join(', ')}]→` : ''}${x.k12} ${x.pen ? 'пробило' : 'не пробило'}${x.pen && each ? ` (${x.wounds})` : ''}${x.trauma ? (nat==='robot' ? ' 🔧' : ' 🦴') : ''}`).join('; ')} · ${total} ${woundsWord(total)}`
      + (rz && total ? ' (разрыв +4)' : '') + (pa.tags.length && hits.some(x=>x.pen) ? ` (${pa.tags.join('; ')})` : '');
    return {hits, total, max12, text:txt};
  }
  function addMarkTo(id, k, r){ const t = tok(id); if(!t || !isAuthority() || !MARKS[k]) return;
    const n = /[кkdд]/i.test(String(r)) ? rollWoundsExpr(r) : Math.round(+r || 0); // «на к6 кругов» — бросок при наложении
    const marks = (t.marks || []).filter(m=>m.k!==k).concat([{k, r:Math.max(0, n)}]); execCommand({c:'token-update', id, patch:{marks}}); return n; }
  function changeCharacterHp(ownerId, delta){
    if(ownerId===myOwnerId()){
      if(typeof character!=='undefined' && character){
        const txt = applyGrant(character, {kind:'vitals', which:'hp', mode:'delta', value:delta});
        if(txt) logEvent(character, txt.replace('Мастер изменил здоровье на игровом столе', 'Атака с игрового стола — здоровье'));
        renderAll();
      }
      return;
    }
    sendGrant(ownerId, {kind:'vitals', which:'hp', mode:'delta', value:delta}); // с подтверждением — дойдёт и после обрыва
  }
  // Эпичный бросок (EpicRolls): к20 атаки / манёвра / гранаты жетоном игрока — сцену запускает тот, кто считает итог
  function epicMapRoll(att, info){
    if(!att || att.kind!=='player' || typeof EpicRolls==='undefined') return;
    try{ EpicRolls.forMapRoll(att.ownerId || null, info); }catch(e){ console.warn('[Эпичный бросок]', e); }
  }
  // (Мастер/локальный стол) Итог атаки. from — id игрока для его атаки, пусто — своя.
  function resolveAttack(req, from){
    if(req && req.fireMode==='grenade') return resolveGrenade(req, from);
    if(req && MANEUVERS[req.fireMode]) return resolveManeuver(req, from);
    const res = resolveOne(req, from, 0);
    if(!res.ok) return res;
    // остальные атаки того же действия — отдельными записями в логе (своя отмена у каждой): ещё раз тем же оружием, пока
    // позволяет «за одно действие может атаковать дважды / до трёх атак», и второе оружие при атаке двумя оружиями
    const att = authState.tokens[req.attackerId];
    let same = 0, others = 0, speedSpent = !!res.speedUsed;
    res.extra = [];
    (Array.isArray(req.series) ? req.series : []).slice(0, 3).forEach((x, i)=>{
      if(!x || typeof x!=='object') return;
      const idx = att && att.kind==='player' ? (x.weaponIdx===0 || x.weaponIdx===1 ? x.weaponIdx : -1) : null;
      if(idx===-1) return;
      const isSame = idx===(att && att.kind==='player' ? req.weaponIdx : null);
      if(isSame ? ++same > Math.max(0, (res.w.attacksPerAction || 1) - 1) : (!req.dual || ++others > 1)) return;
      if(!isSame){ // второе оружие: двуручное парой — «Две пушки», размер 1+, сила (dualWieldBlock)
        const cAtt = from ? (session.players[from] && session.players[from].character) : attackerSheet(att), why = cAtt ? dualWieldBlock(cAtt) : null;
        if(why){ res.extra.push({weaponIdx:idx, ok:false, success:false, jammed:false, speedUsed:false, reason:why}); return; } }
      const sub = Object.assign({}, req, {attackId:String(req.attackId || '').slice(0, 60) + '~' + (i + 2), weaponIdx:idx, fireMode:x.fireMode, rolls:x.rolls,
        rerollOf:null, series:null, speedAvailable:!!x.speedAvailable && !(isSame && speedSpent)});
      const r = resolveOne(sub, from, i + 2);
      if(r.speedUsed && isSame) speedSpent = true;
      res.extra.push({weaponIdx:idx, ok:!!r.ok, success:!!r.success, jammed:!!r.jammed, speedUsed:!!r.speedUsed, reason:r.ok ? '' : r.reason});
    });
    // «Шрапнельная пушка»: «проверьте атаку по каждой цели на линии шириной 3 м» — линия от атакующего через цель до предела
    // дальности (3×Дл); каждый жетон на ней (и свои тоже) — отдельная проверка: к20 бросает стол тем же режимом жеста, дистанция
    // и защита у каждого свои. Переброс первой атаки линию заново не бросает.
    if(res.w.lineWidth && att && !req.rerollOf && req.fireMode!=='suppress'){
      const t0 = authState.tokens[req.targetId], dx = t0.x - att.x, dy = t0.y - att.y, len = Math.hypot(dx, dy) || 1, ux = dx/len, uy = dy/len;
      const maxCells = 3*(res.w.dl || 0)/METERS_PER_CELL, half = res.w.lineWidth/2/METERS_PER_CELL;
      const mode = req.mode==='advantage' || req.mode==='disadvantage' ? req.mode : 'plain';
      Object.values(authState.tokens).filter(t=>t.id!==att.id && t.id!==t0.id).map(t=>{ const px = t.x - att.x, py = t.y - att.y;
        return {t, along:px*ux + py*uy, across:Math.abs(px*uy - py*ux)}; })
        .filter(x=>x.along > 0 && x.along <= maxCells && x.across < half + (SIZE_CELLS[x.t.size||'normal'] || 1)/2 - 1e-6) // только касается края — не задет
        .sort((a, b)=>a.along - b.along).slice(0, 12).forEach((x, i)=>{
          const sub = Object.assign({}, req, {attackId:String(req.attackId || '').slice(0, 60) + '~L' + (i + 1), targetId:x.t.id, aim:null, series:null, rerollOf:null,
            rolls: mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)], speedAvailable:false});
          resolveOne(sub, from, 0, {anyTarget:true, line:true}); });
    }
    return res;
  }
  // Одна атака оружием с карты. seriesNo — номер атаки в серии одного действия (0 — первая, 2, 3… — остальные);
  // opts.anyTarget — цель выбрал стол (линия шрапнели): можно и свой жетон, и скрытый (имя в логе — «???»)
  function resolveOne(req, from, seriesNo, opts){
    opts = opts || {};
    const s = authState;
    const att = s.tokens[req.attackerId], tgt = s.tokens[req.targetId];
    if(!att || !tgt || att.id===tgt.id) return {ok:false, reason:'Атакующий или цель не найдены'};
    const attackId = String(req.attackId||'').slice(0,64);
    if(!attackId || attackRecords.some(r=>r.attackId===attackId)) return {ok:false, reason:'Повтор атаки'};
    let c = null, w = null, attackerName;
    if(from){
      if(!(att.kind==='player' && att.ownerId===from)) return {ok:false, reason:'Атаковать можно только своим жетоном'};
      if(!opts.anyTarget && (tgt.kind!=='gm' || tgt.hidden)) return {ok:false, reason:'Эту цель атаковать нельзя'};
      const p = session.players[from]; c = p && p.character;
      if(!c) return {ok:false, reason:'Мастеру ещё не пришёл ваш лист'};
      w = sheetWeapon(c, req.weaponIdx);
      attackerName = playerDisplayName(p) || att.name || 'Игрок';
    } else if(att.kind==='gm'){
      w = npcWeapon(att);
      attackerName = att.hidden ? '???' : (att.name || 'NPC'); // скрытый NPC в логе не раскрывается
    } else {
      if(att.ownerId!==myOwnerId()) return {ok:false, reason:'Жетоном игрока атакует сам игрок'};
      c = attackerSheet(att);
      if(!c) return {ok:false, reason:'Нет листа персонажа'};
      w = sheetWeapon(c, req.weaponIdx);
      attackerName = tokenName(att, vitalsFor(att));
    }
    if(!w) return {ok:false, reason:'Нет оружия для атаки'};
    if(att.kind==='player'){ const why = weaponBlockedReason(c, req.weaponIdx); if(why) return {ok:false, reason:why}; }
    const fireMode = ['attack','burst','suppress'].indexOf(req.fireMode)>=0 ? req.fireMode : 'attack';
    if(fireMode!=='attack' && !w.avtomat) return {ok:false, reason:'У оружия нет автоматического огня'};
    const range = rangeInfo(att, tgt, w);
    if(!range.ok) return {ok:false, reason:'Цель ' + range.label};
    let mode = (req.mode==='advantage' || req.mode==='disadvantage') ? req.mode : 'plain';
    let rolls = (Array.isArray(req.rolls) ? req.rolls : []).slice(0, mode==='plain' ? 1 : 2).map(v=>Math.round(num(v,0)));
    if(!rolls.length || rolls.some(v=>v<1 || v>20) || (mode!=='plain' && rolls.length<2)) return {ok:false, reason:'Некорректный бросок'};
    const chosenMod = Math.round(clamp(num(req.chosenMod,0), -30, 30));
    // цель парировала этого противника: его рукопашные атаки по ней в этом ходу Осложнены (нет второго к20 — бросает стол)
    const parried = w.dl==null && parryActive(tgt.id, att.id);
    if(parried){ mode = mode==='advantage' ? 'plain' : 'disadvantage'; rolls = mode==='plain' ? rolls.slice(0, 1) : rolls.length < 2 ? [rolls[0], randInt(20)] : rolls; }
    if(req.rerollOf){ // переброс: прежняя атака этого же атакующего отменяется целиком
      const prev = attackRecords.find(r=>r.attackId===req.rerollOf);
      if(prev && prev.attackerOwner===(from||null)) undoAttack(prev.attackId, true);
    }
    const pa = passiveAtk(att, tgt, w, true) || {mod:0, tags:[], adj:{}, adjAll:0, shield:false, defMod:0, muMod:0, firstDmg:0, catPlus:0};
    const aim = fireMode!=='suppress' && AIM_ZONES.indexOf(req.aim) >= 0 ? req.aim : null;
    const fullMax = attackKnownPart(c, w, fireMode, range, !!req.optikaOn, att.kind==='gm', {aim, dual:!!req.dual}).base + chosenMod + secretPart(tgt, !!req.unprotected).v + pa.mod;
    let max12Shown = null, aim12Shown = null; // для подробного вида лога (пороги видят только допущенные Мастером)
    const roll = pickD20ForMode(rolls[0], rolls[1], fullMax, mode);
    const ev = evaluateD20Check(roll, fullMax);
    if(ev.success && pa.catPlus) ev.category += pa.catPlus; // «Мастер»: успешная атака из ружья — категория выше
    const jammed = !!(w.klinit && roll===13);
    const unprotected = !!(req.unprotected && tgt.unprotectedEnabled);
    const hits = [];
    let speedUsed = false;
    if(ev.success && !jammed){
      const tSheet = tgt.kind==='player' ? attackerSheet(tgt) : null;
      const targetHp = tgt.kind==='gm' ? tgt.hp : (tSheet ? tSheet.hpCurrent : null); // для «раны 6, если у цели 10+ ОЗ»
      const plan = weaponHitPlan(Object.assign({}, w, {speedBonusAvailable:!!req.speedAvailable}), fireMode, roll, ev.category, {targetHp});
      speedUsed = plan.speedUsed;
      // защитные вещи листов: у цели — входящие, у атакующего — свои исходящие (characterGearEffects): «Кинетический щит» — МУ
      // −[попадания атаки], «Генератор щита» — МУ −4 при стрельбе энергией/температурой/взрывом; у цели ещё «Гаситель кинетики»
      // (раны −1 с попадания) и броня «в укрытии +1 к защите» (отметка «В укрытии» на жетоне)
      const ranged = w.dl!=null, gearT = tgt.kind==='player' ? characterGearEffects(tSheet) : null, gearA = att.kind==='player' ? characterGearEffects(c) : null;
      const gearMu = (type)=>{ let v = 0; [gearA, gearT].forEach(g=>{ if(!g) return; if(g.kinetic) v += plan.hits; if(g.shieldGen && ranged && type && g.shieldGen.types.indexOf(String(type).toLowerCase()) >= 0) v += g.shieldGen.v; }); return v; };
      [[gearA, 'свой'], [gearT, 'у цели']].forEach(([g, who])=>{ if(!g) return;
        if(g.kinetic) pa.tags.push(`${g.kinetic} (${who}): МУ −${plan.hits}`);
        if(g.shieldGen && ranged && w.muType && g.shieldGen.types.indexOf(String(w.muType).toLowerCase()) >= 0) pa.tags.push(`${g.shieldGen.name} (${who}): МУ −${g.shieldGen.v}`); });
      const inCover = (tgt.marks || []).some(m=>m.k==='cover');
      const coverDef = !inCover ? 0 : gearT ? gearT.coverDef : (tgt.creature && typeof Bestiary!=='undefined' ? Bestiary.coverBonus(tgt) : 0);
      if(coverDef) pa.tags.push(`броня цели в укрытии: защита +${coverDef}`);
      if(gearT && gearT.woundsMinus) pa.tags.push(`${gearT.woundsMinusName}: раны −${gearT.woundsMinus} с попадания`);
      // защита зоны: у персонажа — надетая на зону броня, у существа — броня из карточки (Bestiary.zoneDefense), у жетона без
      // карточки — его защита
      const zoneDef = (type, zone)=>{ if(tgt.kind==='player') return characterZoneDefense(tSheet, zone, type);
        if(tgt.zoneDef && tgt.zoneDef[zone]!=null) return tgt.zoneDef[zone]; // вписано Мастером в форме жетона
        const z = typeof Bestiary!=='undefined' ? Bestiary.zoneDefense(tgt, zone, type) : null; return z==null ? targetDefense(tgt, type) : z; };
      const defOf = (type, zone)=>unprotected ? 0 : (zone ? zoneDef(type, zone) : targetDefense(tgt, type) + coverDef) + (pa.defMod||0);
      const muBase = (w.mu||0) + (w.muPlusCat ? ev.category : 0) + (pa.muMod||0) - gearMu(w.muType); // «МУ[15+категория успеха]»; усиления атакующего
      const max12 = muBase - defOf(w.muType); max12Shown = max12;
      const aim12 = aim ? muBase - defOf(w.muType, aim) : null; aim12Shown = aim12; // прицельное — одно попадание, по защите зоны
      const thr = tgt.kind==='player' ? 5 : (tgt.traumaThreshold || 5), nature = tokenNature(tgt);
      // «Первый урон (в бою) наносит раны N»: в бою — один раз на атакующего и оружие, пока идёт бой трекера
      const fwKey = att.id + '|' + w.name, fwOk = !!(w.firstWounds && (!w.firstWounds.perFight || !firstDmgSeen[fwKey]));
      const adjFor = (type)=>pa.adjAll + (pa.adj[String(type || '').toLowerCase()] || 0) - (gearT ? gearT.woundsMinus : 0);
      for(let i=0;i<plan.hits;i++){
        const m12 = aim && i===0 ? aim12 : max12;
        const rolls12 = Array.from({length:plan.rollsPerHit}, ()=>randInt(12));
        const fits = rolls12.filter(k=>k<=m12);
        const pen = m12>=1 && fits.length>0;
        const k12 = pen ? Math.max(...fits) : Math.max(...rolls12); // «Пул»: лучший — наибольший, что ещё пробивает
        const h = {k12, pen, wounds: pen ? plan.woundsFor(k12) : 0, trauma: pen && k12>thr && nature!=='void', red:false};
        h.red = h.trauma && !!w.travma;
        if(plan.pulShot) h.rolls12 = rolls12;
        if(aim && i===0){ h.aim = true; if(aim==='golova') h.headAim = true; }
        const firstPen = h.pen && !hits.some(x=>x.pen && !x.zap);
        if(firstPen && fwOk){ h.wounds = Math.max(h.wounds, w.firstWounds.wounds); if(w.firstWounds.perFight) firstDmgSeen[fwKey] = true; }
        if(h.pen){ const d = adjFor(w.muType) + (pa.firstDmg && firstPen ? pa.firstDmg : 0); if(d) h.wounds = Math.max(0, h.wounds + d); } // раны: способности цели и атакующего, «Гаситель»
        hits.push(h);
        if(w.zap){ // «каждое попадание даёт разряд с МУ14 энергия, раны 2» — отдельный к12 против защиты от его типа
          const z12 = w.zap.mu - gearMu(w.zap.muType) - defOf(w.zap.muType, aim && i===0 ? aim : null), k = randInt(12), zp = z12>=1 && k<=z12;
          const zh = {k12:k, pen:zp, wounds:zp ? Math.max(0, Math.max(1, w.zap.wounds) + adjFor(w.zap.muType)) : 0, trauma:zp && k>thr && nature!=='void', red:false, zap:true};
          hits.push(zh);
        }
      }
      if(pa.shield && hits.length > 1){ const k = randInt(12), drop = Math.min(k, hits.length - 1); hits.splice(hits.length - drop, drop); pa.tags.push(`щит: к12=${k}, отменено ${drop}`); }
      if(pa.ignore && hits.length){ hits.length = 0; pa.tags.push('атака проигнорирована (сценарная броня)'); }
      if(pa.cancelHits > 0 && hits.some(h=>h.pen)){ const off = hits.filter(h=>h.pen).sort((x, y)=>y.wounds - x.wounds).slice(0, pa.cancelHits); // отклоняются самые тяжёлые
        off.forEach(h=>{ h.pen = false; h.wounds = 0; h.trauma = false; h.red = false; }); pa.tags.push(`отклонено попаданий: ${off.length}`); }
    }
    const total = hits.reduce((a,h)=>a+h.wounds, 0);
    const traumaN = hits.filter(h=>h.trauma && !h.red).length, traumaRedN = hits.filter(h=>h.red).length;
    noteTraumas(tgt, hits, headFrom(att, w), false);
    const hiddenLine = !!(opts.anyTarget && tgt.hidden), targetName = hiddenLine ? '???' : tokenName(tgt, vitalsFor(tgt));
    if(hiddenLine){ const real = tokenName(tgt, vitalsFor(tgt)); pa.tags.push(`скрытая цель: ${real}`); if(role()==='gm' || !session.gmId) toast(`Шрапнель задела скрытого: ${real} — ${total} ${woundsWord(total)}`); }
    const rec = { attackId, attackerOwner: from||null, targetId:tgt.id, targetKind:tgt.kind, ownerId:tgt.ownerId||null,
                  total, traumaN, traumaRedN, hpApplied:false, label:`${attackerName} → ${targetName}, «${w.name}»: ${total} ${woundsWord(total)}`, undone:false };
    const patch = {};
    if(w.slow && !tgt.slowReaction) patch.slowReaction = true; // медленное оружие — цель может отреагировать
    if(traumaN) patch.trauma = (tgt.trauma||0) + traumaN;
    if(traumaRedN) patch.traumaRed = (tgt.traumaRed||0) + traumaRedN;
    if(total){
      if(tgt.kind==='gm'){ if(tgt.hp!==null && tgt.hp!==undefined){ patch.hp = tgt.hp - total; rec.hpApplied = true; rec.hpDelta = -total; } }
      else {
        // Лист не опускает HP ниже −Максимума — запоминаем фактическое изменение, чтобы отмена вернула ровно его
        const tc = attackerSheet(tgt);
        let applied = -total;
        if(tc && tc.hpCurrent!==null && tc.hpCurrent!==undefined){ const before = Number(tc.hpCurrent)||0; applied = clampLower(before - total, hpMax(tc)) - before; }
        if(applied) changeCharacterHp(tgt.ownerId, applied);
        rec.hpApplied = applied!==0; rec.hpDelta = applied;
      }
    }
    if(Object.keys(patch).length) execCommand({c:'token-update', id:tgt.id, patch});
    attackRecords.push(rec); saveAttackRecords();
    recordAndShareQuickRoll({ mapAttack:true, attackId, attacker:attackerName, target:targetName, weaponName:w.name, fireMode, rolls, roll, mode,
                              success:ev.success, category:ev.category, jammed, unprotected, slow:!!w.slow, hits, total, robot:tokenNature(tgt)==='robot',
                              aim, dual:!!req.dual, series:seriesNo || 0, line:!!opts.line, parried, sec:{max:fullMax, max12:max12Shown, aim12:aim12Shown}, pnote:pa.tags.join('; ') });
    if(att.kind==='player' && !ev.success) if(typeof GmAdvice!=='undefined') GmAdvice.event('miss'); // промах атаки игрока
    if(!seriesNo && !opts.line) epicMapRoll(att, {value:roll, success:ev.success && !jammed, category:ev.category, who:attackerName, label:`«${w.name}» → ${targetName}`,
      main: jammed ? 'Оружие заклинило' : ev.success ? (roll===12 ? 'Критическое попадание' : 'Попадание') : roll===13 ? 'Провал' : 'Промах'});
    if(typeof Reactions!=='undefined') Reactions.trigger(roll===12 ? 'crit' : (roll===13 && !ev.success) ? 'fumble' : ev.success ? 'hit' : 'miss', att.id);
    lastAttackReqs[attackId] = {req, from:from || null};
    if(typeof AbilityKit!=='undefined') setTimeout(()=>{ try{ AbilityKit.onAttack({attackId, attackerId:att.id, targetId:tgt.id, roll, success:ev.success, jammed, total, fromPlayer:!!from || att.kind==='player'}); }catch(e){ console.warn('[Способности]', e); } }, 0);
    return {ok:true, success:ev.success, jammed, speedUsed, w};
  }
  function undoAttack(attackId, asReroll){
    if(!isAuthority()) return;
    const rec = attackRecords.find(r=>r.attackId===attackId);
    if(!rec || rec.undone) return;
    if(rec.maneuver){ // манёвр: вернуть отметку «Схвачен» как было
      const tg = rec.markOn && authState.tokens[rec.markOn];
      if(tg) execCommand({c:'token-update', id:tg.id, patch:{marks:(tg.marks || []).filter(m=>m.k!=='grabbed')}});
      const at = rec.markOff && authState.tokens[rec.markOff];
      if(at && !(at.marks || []).some(m=>m.k==='grabbed')) execCommand({c:'token-update', id:at.id, patch:{marks:(at.marks || []).concat([{k:'grabbed', r:0}])}});
      if(rec.moved && authState.tokens[rec.moved.id]) execCommand({c:'token-move', moves:[{id:rec.moved.id, x:rec.moved.x, y:rec.moved.y}]}); // толчок — жетон обратно
      if(rec.parryOn){ delete parryVs[rec.parryOn]; const pt = authState.tokens[rec.parryOn]; if(pt) execCommand({c:'token-update', id:pt.id, patch:{marks:(pt.marks || []).filter(m=>m.k!=='parry')}}); } // парирование
      rec.undone = true; saveAttackRecords();
      recordAndShareQuickRoll({mapAttackUndo:true, attackId, text: rec.label + (asReroll ? ' (переброс)' : '')});
      return;
    }
    if(rec.victims){ // граната: откатываем каждого задетого
      rec.victims.forEach(v=>{
        const t = authState.tokens[v.targetId];
        if(t){
          const patch = {};
          if(v.traumaN) patch.trauma = Math.max(0, (t.trauma||0) - v.traumaN);
          if(v.burn) patch.burning = Math.max(0, (t.burning||0) - v.burn);
          if(v.slowSet) patch.slowReaction = false;
          if(v.hpApplied && v.targetKind==='gm' && t.hp!==null && t.hp!==undefined) patch.hp = t.hp - v.hpDelta;
          if(Object.keys(patch).length) execCommand({c:'token-update', id:t.id, patch});
        }
        if(v.hpApplied && v.targetKind==='player' && v.ownerId) changeCharacterHp(v.ownerId, -v.hpDelta);
      });
      rec.undone = true; saveAttackRecords();
      recordAndShareQuickRoll({mapAttackUndo:true, attackId, text: rec.label + (asReroll ? ' (переброс)' : '')});
      return;
    }
    const tgt = authState.tokens[rec.targetId];
    if(tgt){
      const patch = {};
      if(rec.traumaN) patch.trauma = Math.max(0, (tgt.trauma||0) - rec.traumaN);
      if(rec.traumaRedN) patch.traumaRed = Math.max(0, (tgt.traumaRed||0) - rec.traumaRedN);
      if(rec.hpApplied && rec.targetKind==='gm' && tgt.hp!==null && tgt.hp!==undefined) patch.hp = tgt.hp - (rec.hpDelta!=null ? rec.hpDelta : -rec.total);
      if(Object.keys(patch).length) execCommand({c:'token-update', id:tgt.id, patch});
    }
    if(rec.hpApplied && rec.targetKind==='player' && rec.ownerId) changeCharacterHp(rec.ownerId, rec.hpDelta!=null ? -rec.hpDelta : rec.total);
    rec.undone = true; saveAttackRecords();
    recordAndShareQuickRoll({mapAttackUndo:true, attackId, text: rec.label + (asReroll ? ' (переброс)' : '')});
  }
  function canUndoAttack(id){ return isAuthority() && attackRecords.some(r=>r.attackId===id && !r.undone); }

  /* ---------- манёвры: схватить, толкнуть, освободиться (стр. 39) ----------
     Действием — Бросок силы против силы или рефлексов цели (на её выбор — берётся большее). Крупнее цели — Упрощённо, мельче —
     Осложнённо (складывается с Преимуществом/Помехой жеста). Успех: «схватить» — отметка «Схвачен» (обездвижена, может говорить,
     освобождаться и Осложнённо делать простые действия одной рукой), «освободиться» — отметка снимается, «толкнуть» — жетон
     цели отлетает на 3 м от толкающего (отмена ↶ возвращает). Цель «освободиться» — тот, кто держит.
     Парирование (стр. 39) — реакция: Бросок архаичного оружия (10 + навык + Пр оружия или щита; −3 непредназначенным предметом,
     −6 крошечным) против рукопашной атаки противника. Успех — его рукопашные атаки по персонажу в этом ходу Осложнены (до конца
     круга трекера, без боя — 2 минуты): parryVs, отметка «Парирует». Цель манёвра — противник, чью атаку парируют. */
  const MANEUVERS = {grab:'Схватить', push:'Толкнуть', escape:'Освободиться из захвата', parry:'Парировать'};
  const parryVs = {}; // жетон, который парировал → {by: id противника, round, at}
  function parryActive(defId, attId){ const p = parryVs[defId]; if(!p || p.by!==attId) return false;
    const cb = authState.combat; return cb ? p.round===cb.round : Date.now() - p.at < 120000; }
  // Чем парировать: оружие ближнего боя с Пр (слоты листа / оружие NPC), щиты из инвентаря («Пр +3»), непредназначенный или крошечный предмет
  function parryOptions(c, t){
    const out = [], sg = (n)=>(n >= 0 ? '+' : '−') + Math.abs(n);
    if(t.kind==='player' && c){
      [0, 1].forEach(i=>{ const w = sheetWeapon(c, i); if(w && w.dl==null && w.pr!=null) out.push({key:'w' + i, label:`«${w.name}» (Пр ${sg(w.pr)})`, mod:w.pr}); });
      ['on_body','pockets','backpack','tiny'].forEach(cat=>((c.inventory && c.inventory[cat]) || []).forEach(it=>{
        const m = /щит/i.test(String(it.name).split(' — ')[0]) && /(?:^|[\s,.;—])Пр\s*([+−-])\s*(\d+)/.exec(it.name);
        if(m) out.push({key:'sh:' + it.id, label:`«${String(it.name).split(' — ')[0]}» (Пр ${m[1]==='+' ? '+' : '−'}${m[2]})`, mod:(m[1]==='+' ? 1 : -1)*(+m[2])}); }));
    } else if(t.kind==='gm'){ const w = npcWeapon(t); if(w && w.dl==null && w.pr!=null) out.push({key:'w', label:`«${w.name}» (Пр ${sg(w.pr)})`, mod:w.pr}); }
    out.push({key:'improper', label:'Непредназначенный предмет (−3)', mod:-3}, {key:'tiny', label:'Крошечный предмет (−6)', mod:-6});
    return out;
  }
  function parryKnownPart(c, att, key){
    const all = parryOptions(c, att), opt = all.find(o=>o.key===key) || all[0];
    const w = att.kind==='gm' ? npcWeapon(att) : null;
    const sk = att.kind==='player' ? ((c && c.stats && +c.stats.arhaichnoe_oruzhie) || 0) : (w && w.npcSkill!=null ? w.npcSkill : 3);
    return {base:10 + sk + opt.mod, tags:[`Архаичное оружие: ${10 + sk}`, `${opt.label.replace(/\s*\([^)]*\)$/, '')}: ${opt.mod >= 0 ? '+' : '−'}${Math.abs(opt.mod)}`], key:opt.key};
  }
  function maneuverWeapon(kind){ return {name:MANEUVERS[kind], maneuver:kind, dl:null}; }
  function tokenStat(t, key){
    if(t.kind==='player'){ const c = attackerSheet(t); return c && c.stats ? (+c.stats[key] || 0) : 0; }
    if(t.creature && typeof TargetRolls!=='undefined') return TargetRolls.npcStat(t, key);
    return key==='sila' ? (t.strength==null ? 3 : +t.strength) : key==='refleksy' ? (t.reflexes==null ? 3 : +t.reflexes) : 3;
  }
  // размер для сравнения: у игрока — из листа, у существа — «Размер» карточки, иначе по клеткам жетона
  function tokenBulk(t){
    if(t.kind==='player'){ const c = attackerSheet(t); if(c && isFinite(+c.size)) return +c.size; }
    if(t.creature && t.creature.rz!=null && isFinite(+t.creature.rz)) return +t.creature.rz;
    return {small:-2, normal:0, large:2, huge:4}[t.size || 'normal'] || 0;
  }
  function maneuverSizeCmp(att, tgt){ const a = tokenBulk(att), b = tokenBulk(tgt); return a > b ? 1 : a < b ? -1 : 0; }
  function maneuverKnownPart(c, att){ const s = att.kind==='player' ? (c && c.stats ? +c.stats.sila || 0 : 0) : tokenStat(att, 'sila'); return {base:10 + s, tags:[`Сила: ${10 + s}`]}; }
  function maneuverSecretPart(tgt){ const ts = tokenStat(tgt, 'sila'), tr = tokenStat(tgt, 'refleksy'), v = Math.max(ts, tr);
    return {v:-v, tags:[`${ts >= tr ? 'Сила' : 'Рефлексы'} цели: −${v}`]}; }
  function openManeuverPopover(att, tgt, t, range, p){
    const c = att.kind==='player' ? attackerSheet(att) : null, kind = t.w.maneuver, auth = isAuthority(), cmp = maneuverSizeCmp(att, tgt);
    if(kind==='parry'){
      const opts = parryOptions(c, att);
      const html = `<div class="gt-pop-title">🛡 Парировать атаку: ${escapeHtml(tokenName(tgt, vitalsFor(tgt)))}</div>`+
        `<div class="gt-pop-note">Реакция. Бросок архаичного оружия против рукопашной атаки этого противника. Успех — все его рукопашные атаки по вам в этом ходу Осложнены.</div>`+
        `<label class="gt-f">Чем парировать<select name="parryItem">${opts.map(o=>`<option value="${escapeHtml(o.key)}">${escapeHtml(o.label)}</option>`).join('')}</select></label>`+
        `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button>`+
        `<button type="button" class="small primary" data-roll title="Нажмите и протяните — как бросок в листе">🛡 Бросок — нажмите и тяните</button></div>`;
      const form = openPopover(p, html, ()=>false);
      form.querySelector('[data-roll]').addEventListener('pointerdown', (ev)=>{
        ev.preventDefault();
        const known = parryKnownPart(c, att, form.querySelector('[name=parryItem]').value);
        _mapAttackCtx = { attackerId:att.id, targetId:tgt.id, weaponIdx:null, fireMode:'parry', parryItem:known.key, label:'Парирование', formula:'10 + архаичное оружие + Пр (непредназначенный предмет −3, крошечный −6)',
                          knownBase:known.base, tags:known.tags, rerollOf:null };
        closePopover();
        openRollPicker('map_attack', ev.clientX, ev.clientY, 0);
      });
      return;
    }
    const what = kind==='grab' ? 'Успех — цель схвачена: обездвижена, простые действия одной рукой Осложнены, пока не освободится.'
      : kind==='push' ? 'Успех — цель отлетает на 3 м от вас (жетон сдвинется сам).' : 'Успех — отметка «Схвачен» снимается. Цель — тот, кто держит.';
    const html = `<div class="gt-pop-title">🤼 ${escapeHtml(MANEUVERS[kind])} → ${escapeHtml(tokenName(tgt, vitalsFor(tgt)))}</div>`+
      `<div class="gt-pop-note">Действие. Бросок силы против силы или рефлексов цели (что у неё выше). ${escapeHtml(what)}</div>`+
      `<div class="gt-pop-note">${cmp > 0 ? 'Вы крупнее цели — Упрощённо' : cmp < 0 ? 'Вы мельче цели — Осложнённо' : 'Размеры равны'} — ${auth ? 'стол учтёт сам' : 'учтёт Мастер'}.${auth ? ' Сила или рефлексы цели уже в Максимуме.' : ' Характеристику цели учтёт Мастер — итог появится в общем логе.'}</div>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button>`+
      `<button type="button" class="small primary" data-roll title="Нажмите и протяните — как бросок в листе">🤼 Бросок — нажмите и тяните</button></div>`;
    const form = openPopover(p, html, ()=>false);
    form.querySelector('[data-roll]').addEventListener('pointerdown', (ev)=>{
      ev.preventDefault();
      const known = maneuverKnownPart(c, att);
      let knownBase = known.base, tags = known.tags;
      if(auth){ const sec = maneuverSecretPart(tgt); knownBase += sec.v; tags = tags.concat(sec.tags); }
      else tags = tags.concat(['− сила или рефлексы цели (учтёт Мастер)']);
      if(cmp) tags = tags.concat([cmp > 0 ? 'Крупнее цели: Упрощённо (добавит стол)' : 'Мельче цели: Осложнённо (добавит стол)']);
      _mapAttackCtx = { attackerId:att.id, targetId:tgt.id, weaponIdx:null, fireMode:kind, label:`Манёвр: ${MANEUVERS[kind]}`, formula:'10 + сила − (сила или рефлексы цели, что выше); крупнее — Упрощённо, мельче — Осложнённо',
                        knownBase, tags, rerollOf:null };
      closePopover();
      openRollPicker('map_attack', ev.clientX, ev.clientY, 0);
    });
  }
  // (Мастер/локальный стол) Итог манёвра: отметка «Схвачен» ставится или снимается сразу, отмена ↶ в логе возвращает как было
  function resolveManeuver(req, from){
    const s = authState, kind = req.fireMode;
    const att = s.tokens[req.attackerId], tgt = s.tokens[req.targetId];
    if(!att || !tgt || att.id===tgt.id) return {ok:false, reason:'Участники манёвра не найдены'};
    const attackId = String(req.attackId||'').slice(0,64);
    if(!attackId || attackRecords.some(r=>r.attackId===attackId)) return {ok:false, reason:'Повтор манёвра'};
    let c = null, attackerName;
    if(from){
      if(!(att.kind==='player' && att.ownerId===from)) return {ok:false, reason:'Действовать можно только своим жетоном'};
      if(tgt.kind!=='gm' || tgt.hidden) return {ok:false, reason:'Эту цель выбрать нельзя'};
      const p = session.players[from]; c = p && p.character;
      if(!c) return {ok:false, reason:'Мастеру ещё не пришёл ваш лист'};
      attackerName = playerDisplayName(p) || att.name || 'Игрок';
    } else if(att.kind==='gm'){
      attackerName = att.hidden ? '???' : (att.name || 'NPC');
    } else {
      if(att.ownerId!==myOwnerId()) return {ok:false, reason:'Жетоном игрока действует сам игрок'};
      c = attackerSheet(att);
      if(!c) return {ok:false, reason:'Нет листа персонажа'};
      attackerName = tokenName(att, vitalsFor(att));
    }
    if(kind==='escape' && !(att.marks || []).some(m=>m.k==='grabbed')) return {ok:false, reason:'Жетон не схвачен — освобождаться не от чего'};
    const range = rangeInfo(att, tgt, maneuverWeapon(kind));
    if(!range.ok) return {ok:false, reason:'Цель ' + range.label};
    const pmode = (req.mode==='advantage' || req.mode==='disadvantage') ? req.mode : 'plain';
    let rolls = (Array.isArray(req.rolls) ? req.rolls : []).slice(0, pmode==='plain' ? 1 : 2).map(v=>Math.round(num(v,0)));
    if(!rolls.length || rolls.some(v=>v<1 || v>20) || (pmode!=='plain' && rolls.length<2)) return {ok:false, reason:'Некорректный бросок'};
    const chosenMod = Math.round(clamp(num(req.chosenMod,0), -30, 30));
    if(req.rerollOf){ const prev = attackRecords.find(r=>r.attackId===req.rerollOf); if(prev && prev.attackerOwner===(from||null)) undoAttack(prev.attackId, true); }
    const fullMax = kind==='parry' ? parryKnownPart(c, att, String(req.parryItem || '')).base + chosenMod : maneuverKnownPart(c, att).base + chosenMod + maneuverSecretPart(tgt).v;
    // Упрощение/Осложнение: жест игрока и разница в размере складываются и гасят друг друга; не хватает второго к20 — бросает стол
    const sizeCmp = kind==='parry' ? 0 : maneuverSizeCmp(att, tgt), score = (pmode==='advantage' ? 1 : pmode==='disadvantage' ? -1 : 0) + sizeCmp;
    const mode = score > 0 ? 'advantage' : score < 0 ? 'disadvantage' : 'plain';
    if(mode==='plain') rolls = rolls.slice(0, 1); else if(rolls.length < 2) rolls = [rolls[0], randInt(20)];
    const roll = pickD20ForMode(rolls[0], rolls[1], fullMax, mode);
    const ev = evaluateD20Check(roll, fullMax);
    const targetName = tokenName(tgt, vitalsFor(tgt));
    const rec = { attackId, attackerOwner: from||null, targetId:tgt.id, targetKind:tgt.kind, ownerId:tgt.ownerId||null, total:0, traumaN:0, traumaRedN:0, hpApplied:false,
                  label:`${attackerName} → ${targetName}: ${MANEUVERS[kind].toLowerCase()}`, undone:false, maneuver:kind, markOn:null, markOff:null };
    if(ev.success && kind==='grab' && !(tgt.marks || []).some(m=>m.k==='grabbed')){
      execCommand({c:'token-update', id:tgt.id, patch:{marks:(tgt.marks || []).concat([{k:'grabbed', r:0}])}}); rec.markOn = tgt.id; }
    if(ev.success && kind==='escape'){ execCommand({c:'token-update', id:att.id, patch:{marks:(att.marks || []).filter(m=>m.k!=='grabbed')}}); rec.markOff = att.id; }
    if(ev.success && kind==='push'){ // «толкнуть»: цель отлетает на 3 м (клетку) от толкающего — по ближайшему из 8 направлений сетки
      const dx = tgt.x - att.x, dy = tgt.y - att.y, len = Math.hypot(dx, dy) || 1, step = Math.max(1, Math.round(3/METERS_PER_CELL));
      const sx = Math.round(dx/len), sy = Math.round(dy/len), to = snapPos(tgt.x + (sx || (sy ? 0 : 1))*step, tgt.y + sy*step, tgt.size || 'normal');
      rec.moved = {id:tgt.id, x:tgt.x, y:tgt.y};
      execCommand({c:'token-move', moves:[{id:tgt.id, x:to.x, y:to.y}]});
    }
    if(ev.success && kind==='parry'){ // парировал: рукопашные атаки этого противника по нему Осложнены до конца хода (круга)
      parryVs[att.id] = {by:tgt.id, round:authState.combat ? authState.combat.round : null, at:Date.now()}; rec.parryOn = att.id;
      execCommand({c:'token-update', id:att.id, patch:{marks:(att.marks || []).filter(m=>m.k!=='parry').concat([{k:'parry', r:1}])}});
      const cb = authState.combat; if(cb && cb.parts && cb.parts[att.id] && !cb.parts[att.id].react){ const c1 = clone(cb); c1.parts[att.id].react = true; setCombat(c1); } // реакция потрачена
    }
    attackRecords.push(rec); saveAttackRecords();
    recordAndShareQuickRoll({ mapManeuver:true, attackId, attacker:attackerName, target:targetName, mv:kind, rolls, roll, mode, sizeCmp,
                              success:ev.success, category:ev.category, sec:{max:fullMax} });
    epicMapRoll(att, {value:roll, success:ev.success, category:ev.category, who:attackerName, label:`${MANEUVERS[kind]} → ${targetName}`});
    lastAttackReqs[attackId] = {req, from:from || null};
    return {ok:true, success:ev.success, jammed:false, speedUsed:false};
  }

  /* ---------- гранаты (см. GRENADE_SPECS) ---------- */
  function grenadeWeaponByKey(key, sila){
    const spec = GRENADE_SPECS[key];
    if(!spec) return null;
    return {name:spec.name, grenade:key, spec, maxRange: spec.range + 3*Math.max(0, (sila||0) - 3), slow:!!spec.slow, dl:null};
  }
  // Граната метателя: у жетона Мастера — из поля «Граната», у игрока — предмет инвентаря по id
  function grenadeWeapon(att, itemId){
    if(!att) return null;
    if(att.kind==='gm') return att.grenade ? grenadeWeaponByKey(att.grenade, att.strength==null ? 3 : att.strength) : null;
    const c = attackerSheet(att);
    const it = grenadeItemsOf(c).find(x=>x.itemId===itemId);
    return it ? grenadeWeaponByKey(it.key, c.stats && c.stats.sila) : null;
  }
  function tokenReflexes(t){
    if(t.kind==='gm') return t.reflexes==null ? 3 : t.reflexes;
    const c = attackerSheet(t);
    return c && c.stats ? (c.stats.refleksy||0) : 0;
  }
  function tokenSizeNum(t){ // «размер цели» для горения: у игрока — из листа, у NPC — по размеру жетона
    if(t.kind==='player'){ const c = attackerSheet(t); if(c && isFinite(c.size)) return Number(c.size); }
    return {small:0, normal:1, large:2, huge:3}[t.size||'normal'];
  }
  function grenadeKnownPart(c, w, range, isNpc){
    const ath = isNpc ? 3 : (c && c.stats ? (c.stats.legkaya_atletika||0) : 0);
    let base = 10 + ath;
    const tags = [`Лёгкая атлетика: ${10+ath}`];
    if(range.pen){ base += range.pen; tags.push(`Дальше 12 м (${fmtNum(range.meters)} м): ${range.pen}`); }
    else tags.push(`Дистанция ${fmtNum(range.meters)} м`);
    return {base, tags};
  }
  function grenadeSecretPart(tgt){
    const r = tokenReflexes(tgt);
    let v = -r; const tags = [`Рефлексы цели: −${r}`];
    if(tgt.attackModEnabled && tgt.attackMod){ v += tgt.attackMod; tags.push(`Мод. цели: ${tgt.attackMod>0?'+':''}${tgt.attackMod}`); }
    return {v, tags};
  }
  function openGrenadePopover(att, tgt, t, range, p){
    const c = att.kind==='player' ? attackerSheet(att) : null;
    const auth = isAuthority(), spec = t.w.spec;
    const area = spec.thermal ? `по 4 раны всем в радиусе ${spec.thermal.radius} м с защитой от температуры ${spec.thermal.maxDefense}−, поджигает`
      : `${spec.blast.targetOnly ? 'цели '+spec.blast.hits+' попадания' : 'цели и всем в 1 м — [КУ] попаданий'} МУ${spec.blast.mu} взрыв, раны ${spec.blast.wounds}; всем в радиусе ${spec.frag.radius} м — по ${spec.frag.hits} попаданий МУ${spec.frag.mu} патрон`;
    const html = `<div class="gt-pop-title">💣 ${escapeHtml(t.w.name)} → ${escapeHtml(tokenName(tgt, vitalsFor(tgt)))}</div>`+
      `<div class="gt-pop-note">${fmtNum(range.meters)} м · ${escapeHtml(range.label)}</div>`+
      `<div class="gt-pop-note">${escapeHtml(area)}. ${spec.thermal ? 'Провал — эффекта нет.' : 'Провал с итогом 16+ — осколки всё равно задевают всех в радиусе.'}</div>`+
      `<div class="gt-pop-note">${auth ? 'Рефлексы и модификатор цели уже в Максимуме.' : 'Рефлексы цели учтёт Мастер — итог появится в общем логе.'}${att.kind==='player' ? ' После броска граната спишется из инвентаря.' : ''}</div>`+
      `<div class="gt-pop-actions"><button type="button" class="small" data-cancel>Отмена</button>`+
      `<button type="button" class="small primary" data-roll title="Нажмите и протяните — как бросок в листе">💣 Бросок — нажмите и тяните</button></div>`;
    const form = openPopover(p, html, ()=>false);
    form.querySelector('[data-roll]').addEventListener('pointerdown', (ev)=>{
      ev.preventDefault();
      const known = grenadeKnownPart(c, t.w, range, att.kind==='gm');
      let knownBase = known.base, tags = known.tags;
      if(auth){ const sec = grenadeSecretPart(tgt); knownBase += sec.v; tags = tags.concat(sec.tags); }
      else tags = tags.concat(['− рефлексы цели (учтёт Мастер)']);
      _mapAttackCtx = { attackerId:att.id, targetId:tgt.id, weaponIdx:t.weaponIdx, fireMode:'grenade', grenadeKey:t.w.grenade, unprotected:false, optikaOn:false,
                        knownBase, tags, rerollOf:null };
      closePopover();
      openRollPicker('map_attack', ev.clientX, ev.clientY, 0);
    });
  }
  // (Мастер/локальный стол) Итог броска гранаты: взрыв и осколки по всем жетонам в радиусе, раны сразу в HP
  function resolveGrenade(req, from){
    const s = authState;
    const att = s.tokens[req.attackerId], tgt = s.tokens[req.targetId];
    if(!att || !tgt || att.id===tgt.id) return {ok:false, reason:'Метатель или цель не найдены'};
    const attackId = String(req.attackId||'').slice(0,64);
    if(!attackId || attackRecords.some(r=>r.attackId===attackId)) return {ok:false, reason:'Повтор броска'};
    let c = null, attackerName, sila = 3;
    if(from){
      if(!(att.kind==='player' && att.ownerId===from)) return {ok:false, reason:'Метать можно только своим жетоном'};
      if(tgt.kind!=='gm' || tgt.hidden) return {ok:false, reason:'Эту цель атаковать нельзя'};
      const p = session.players[from]; c = p && p.character;
      if(!c) return {ok:false, reason:'Мастеру ещё не пришёл ваш лист'};
      attackerName = playerDisplayName(p) || att.name || 'Игрок';
    } else if(att.kind==='gm'){
      attackerName = att.hidden ? '???' : (att.name || 'NPC');
      sila = att.strength==null ? 3 : att.strength;
    } else {
      if(att.ownerId!==myOwnerId()) return {ok:false, reason:'Жетоном игрока бросает сам игрок'};
      c = attackerSheet(att);
      if(!c) return {ok:false, reason:'Нет листа персонажа'};
      attackerName = tokenName(att, vitalsFor(att));
    }
    if(c && c.stats) sila = c.stats.sila||0;
    let w = grenadeWeapon(att, String(req.weaponIdx||''));
    let prev = null;
    if(req.rerollOf){
      prev = attackRecords.find(r=>r.attackId===req.rerollOf && r.attackerOwner===(from||null) && r.grenadeKey);
      if(!w && prev) w = grenadeWeaponByKey(prev.grenadeKey, sila); // последняя граната уже списана — переброс того же броска
    }
    if(!w) return {ok:false, reason:'Нет гранаты'};
    const range = rangeInfo(att, tgt, w);
    if(!range.ok) return {ok:false, reason:'Цель ' + range.label};
    const mode = (req.mode==='advantage' || req.mode==='disadvantage') ? req.mode : 'plain';
    const rolls = (Array.isArray(req.rolls) ? req.rolls : []).slice(0, mode==='plain' ? 1 : 2).map(v=>Math.round(num(v,0)));
    if(!rolls.length || rolls.some(v=>v<1 || v>20) || (mode!=='plain' && rolls.length<2)) return {ok:false, reason:'Некорректный бросок'};
    const chosenMod = Math.round(clamp(num(req.chosenMod,0), -30, 30));
    if(prev) undoAttack(prev.attackId, true);
    const fullMax = grenadeKnownPart(c, w, range, att.kind==='gm').base + chosenMod + grenadeSecretPart(tgt).v;
    const roll = pickD20ForMode(rolls[0], rolls[1], fullMax, mode);
    const ev = evaluateD20Check(roll, fullMax);
    const outcome = ev.success ? 'hit' : roll>=16 ? 'frag' : 'none';
    const spec = w.spec;
    const all = Object.values(s.tokens);
    const radiusM = (t)=>SIZE_CELLS[t.size||'normal']*METERS_PER_CELL/2;
    const centerDist = (t)=>Math.hypot(t.x-tgt.x, t.y-tgt.y)*METERS_PER_CELL;
    const inSphere = (t, R)=>t.id===tgt.id || centerDist(t) - radiusM(t) <= R + 1e-6;       // сфера с центром в точке взрыва
    const withinEdge = (t, m)=>t.id===tgt.id || centerDist(t) - radiusM(t) - radiusM(tgt) <= m + 1e-6; // «в метре от цели»
    const victims = {};
    const victim = (t)=>victims[t.id] || (victims[t.id] = {t, blast:[], frag:[], thermal:0, burn:0, immune:false});
    const rollHits = (t, n, part)=>{
      const max12 = part.mu - targetDefense(t, part.muType);
      const thr = t.kind==='player' ? 5 : (t.traumaThreshold || 5);
      return Array.from({length:Math.max(0, n)}, ()=>{
        const k12 = randInt(12), pen = max12>=1 && k12<=max12;
        return {k12, pen, wounds: pen ? Math.max(1, part.wounds) : 0, trauma: pen && k12>thr && tokenNature(t)!=='void'};
      });
    };
    if(spec.thermal){
      if(outcome==='hit') all.filter(t=>inSphere(t, spec.thermal.radius)).forEach(t=>{
        const v = victim(t);
        if(targetDefense(t, 'температура') > spec.thermal.maxDefense){ v.immune = true; return; }
        v.thermal = spec.thermal.wounds; v.burn = Math.max(1, tokenSizeNum(t));
      });
    } else {
      if(outcome==='hit'){
        const n = spec.blast.hitsFromCategory ? (ev.category||1) : spec.blast.hits;
        all.filter(t=>spec.blast.targetOnly ? t.id===tgt.id : withinEdge(t, spec.blast.edge)).forEach(t=>{ victim(t).blast = rollHits(t, n, spec.blast); });
      }
      if(outcome!=='none') all.filter(t=>inSphere(t, spec.frag.radius)).forEach(t=>{ victim(t).frag = rollHits(t, spec.frag.hits, spec.frag); });
    }
    const targetName = tgt.hidden ? '???' : tokenName(tgt, vitalsFor(tgt));
    const recVictims = [], logVictims = [], hiddenNotes = [];
    let grand = 0;
    Object.values(victims).forEach(v=>{
      const t = v.t, hits = v.blast.concat(v.frag);
      const total = hits.reduce((a,h)=>a+h.wounds, 0) + v.thermal;
      const traumaN = hits.filter(h=>h.trauma).length;
      noteTraumas(t, hits, 12, false);
      const rv = {targetId:t.id, targetKind:t.kind, ownerId:t.ownerId||null, hpApplied:false, hpDelta:0, traumaN, burn:v.burn, slowSet:false};
      const patch = {};
      if(traumaN) patch.trauma = (t.trauma||0) + traumaN;
      if(v.burn) patch.burning = (t.burning||0) + v.burn;
      if(w.slow && t.id===tgt.id && !t.slowReaction){ patch.slowReaction = true; rv.slowSet = true; } // медленное — цель может отреагировать
      if(total){
        if(t.kind==='gm'){ if(t.hp!==null && t.hp!==undefined){ patch.hp = t.hp - total; rv.hpApplied = true; rv.hpDelta = -total; } }
        else {
          const tc = attackerSheet(t);
          let applied = -total;
          if(tc && tc.hpCurrent!==null && tc.hpCurrent!==undefined){ const before = Number(tc.hpCurrent)||0; applied = clampLower(before - total, hpMax(tc)) - before; }
          if(applied) changeCharacterHp(t.ownerId, applied);
          rv.hpApplied = applied!==0; rv.hpDelta = applied;
        }
      }
      if(Object.keys(patch).length) execCommand({c:'token-update', id:t.id, patch});
      recVictims.push(rv);
      grand += total;
      const lv = {name: tokenName(t, vitalsFor(t)), bN:v.blast.length, bP:v.blast.filter(h=>h.pen).length, fN:v.frag.length, fP:v.frag.filter(h=>h.pen).length,
                  total, trauma:traumaN, robot:tokenNature(t)==='robot', burn:v.burn, immune:v.immune};
      if(t.kind==='gm' && t.hidden){ grand -= total; hiddenNotes.push(`${lv.name}: ${total} ${woundsWord(total)}`); return; } // скрытых в общем логе нет
      logVictims.push(lv);
    });
    if(w.slow && !victims[tgt.id] && !tgt.slowReaction){ // промах без осколков: метка «может отреагировать» у цели всё равно ставится
      execCommand({c:'token-update', id:tgt.id, patch:{slowReaction:true}});
      recVictims.push({targetId:tgt.id, targetKind:tgt.kind, ownerId:tgt.ownerId||null, hpApplied:false, hpDelta:0, traumaN:0, burn:0, slowSet:true});
    }
    if(hiddenNotes.length && role()==='gm') toast('Задеты скрытые: ' + hiddenNotes.join('; '));
    const rec = { attackId, attackerOwner: from||null, grenadeKey:w.grenade, targetId:tgt.id, victims:recVictims,
                  label:`${attackerName} → ${targetName}, «${w.name}»: ${grand} ${woundsWord(grand)}`, undone:false };
    attackRecords.push(rec); saveAttackRecords();
    recordAndShareQuickRoll({ mapGrenade:true, attackId, attacker:attackerName, target:targetName, weaponName:w.name, rolls, roll, mode,
                              success:ev.success, category:ev.category, outcome, slow:!!w.slow, victims:logVictims, sec:{max:fullMax, max12:null} });
    epicMapRoll(att, {value:roll, success:ev.success, category:ev.category, who:attackerName, label:`«${w.name}» → ${targetName}`,
      main: ev.success ? (roll===12 ? 'Критическое попадание' : 'Попадание') : outcome==='frag' ? 'Недолёт — осколки' : roll===13 ? 'Провал' : 'Промах'});
    return {ok:true, success:ev.success, jammed:false, speedUsed:false};
  }
  // Пункты «Атаковать» для меню жетона
  function attackMenuItems(t, p){
    const items = [];
    if(t.kind==='gm'){
      const cw = (t.creature && typeof Bestiary!=='undefined') ? Bestiary.tokenWeapons(t) : [];
      if(cw.length) cw.forEach((x, wi)=>{ const pw = parseWeaponStats(x.text); if(!pw) return;
        weaponModes({avtomat:hasWeaponTag(pw.statText, 'автомат')}).forEach(([m, label])=>items.push({id:`atk_c${wi}_${m}`, label:`⚔ ${x.name}: ${label}`, run:()=>creatureAttack(t.id, x.text, x.skill, m)})); });
      const w = cw.length ? null : npcWeapon(t);
      if(cw.length){}
      else if(!w) items.push({id:'atk_none', label:'⚔ Атаковать… (задайте оружие в «Изменить»)', run:()=>openTokenForm(t, null, p)});
      else weaponModes(w).forEach(([m, label])=>items.push({id:'atk_'+m, label:`⚔ ${w.name}: ${label}`, run:()=>startTargeting(t, null, m)}));
      if(t.grenade && GRENADE_SPECS[t.grenade]) items.push({id:'atk_grenade', label:`💣 Метнуть: ${GRENADE_SPECS[t.grenade].name}`, run:()=>startTargeting(t, null, 'grenade')});
      return items.concat(maneuverItems(t));
    }
    if(t.ownerId!==myOwnerId()) return items;
    const c = attackerSheet(t);
    [0,1].forEach(idx=>{
      const w = sheetWeapon(c, idx);
      if(!w) return;
      const why = weaponBlockedReason(c, idx);
      if(why){ items.push({id:`atk${idx}_blocked`, label:`⚔ ${w.name} — недоступно`, run:()=>toast(why)}); return; }
      weaponModes(w).forEach(([m, label])=>items.push({id:`atk${idx}_${m}`, label:`⚔ ${w.name}: ${label}`, run:()=>startTargeting(t, idx, m)}));
    });
    // Гранаты из инвентаря — по пункту на вид, бросается первая найденная такого вида
    const seen = {};
    grenadeItemsOf(c).forEach(g=>{ (seen[g.key] = seen[g.key] || {first:g, n:0}).n += g.count; });
    Object.keys(seen).forEach(k=>{ const g = seen[k];
      items.push({id:'atk_gr_'+k, label:`💣 Метнуть: ${g.first.name} (×${g.n})`, run:()=>startTargeting(t, g.first.itemId, 'grenade')}); });
    if(!items.length) items.push({id:'atk_none', label:'⚔ Атаковать… (экипируйте оружие в листе)', run:()=>{}});
    return items.concat(maneuverItems(t));
  }
  // «Схватить», «Толкнуть», а схваченному — «Освободиться» (см. манёвры выше)
  function maneuverItems(t){
    const out = [{id:'mv_grab', label:'🤼 Схватить…', run:()=>startTargeting(t, null, 'grab')}, {id:'mv_push', label:'🤼 Толкнуть…', run:()=>startTargeting(t, null, 'push')},
      {id:'mv_parry', label:'🛡 Парировать… (реакция)', run:()=>startTargeting(t, null, 'parry')}];
    if((t.marks || []).some(m=>m.k==='grabbed')) out.unshift({id:'mv_escape', label:'🤼 Освободиться из захвата…', run:()=>startTargeting(t, null, 'escape')});
    return out;
  }

  /* ---------- сцены (экран Мастера): снимок стола без жетонов игроков и включение снимка одной командой ---------- */
  function captureScene(){
    const s = authState;
    return {map:clone(s.map), tokens:Object.values(s.tokens).filter(t=>t.kind!=='player').map(clone), drawings:clone(s.drawings || []), zones:clone(s.zones || [])};
  }
  function applyScene(sc){
    if(!isAuthority() || !sc) return false;
    cancelAll();
    const tokens = {};
    Object.values(authState.tokens).forEach(t=>{ if(t.kind==='player') tokens[t.id] = t; }); // жетоны игроков остаются на местах
    (sc.tokens || []).forEach(t=>{ if(t && t.kind!=='player'){ const c = clone(t); c.id = newId('t'); tokens[c.id] = c; } });
    authState = normalizeState({tableId:authState.tableId, version:authState.version + 1, map:clone(sc.map), tokens, drawings:clone(sc.drawings || []), zones:clone(sc.zones || []), combat:null});
    undoStack = []; redoStack = []; setSelection([]);
    scheduleSave();
    if(role()==='gm') sendMsg({type:'gt-snapshot', state:playerSnapshot()});
    tokenEls.forEach(el=>el.remove()); tokenEls.clear();
    if(viewport){ renderTokens(); renderCombat(); renderToolbar(); requestRender({bg:true, draw:true, fx:true}); }
    if(typeof Bestiary!=='undefined') Bestiary.onTableChanged();
    if(authState.map && authState.map.scene){ lastSceneId = undefined; checkSceneChange(); focusScene(); }
    else if(viewport && vw) centerOnTokens();
    return true;
  }
  function focusOwner(ownerId){
    const t = Object.values(st().tokens).find(x=>x.kind==='player' && x.ownerId===ownerId); if(!t) return false;
    if(typeof toggleMainTab==='function') toggleMainTab('table');
    setTimeout(()=>{ setSelection([t.id]); centerOnToken(t); }, 80);
    return true;
  }

  /* ---------- учебный стол ---------- */
  let sandboxBadge = null;
  function enterSandbox(kind, label){
    if(sandbox) return;
    if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; saveJson(STATE_KEY, authState); } // настоящий стол — сохранён как есть
    cancelAll();
    const dock = document.getElementById('gtLogDock'), logOpen = !!(dock && dock.classList.contains('open'));
    sandbox = {auth:authState, cam:{x:cam.x, y:cam.y, z:cam.z}, undo:undoStack, redo:redoStack, combatCollapsed, combatHints, logOpen, kind:kind || 'tutorial'};
    if(logOpen && window.innerWidth <= 820) setLogDockOpen(false); // на узком экране лог закрывал бы учебный стол
    authState = blankState('sandbox'); undoStack = []; redoStack = []; combatHints = null; combatCollapsed = false;
    lastRole = undefined; refreshRole();
    if(viewport && vw){ cam.z = 1; centerOn(0, 0); } // учебный стол — в натуральную величину
    if(viewport){
      if(!sandboxBadge){ sandboxBadge = document.createElement('div'); sandboxBadge.className = 'gt-sandbox-badge'; viewport.appendChild(sandboxBadge); }
      sandboxBadge.textContent = label || '🎓 Учебный стол — настоящий вернётся после обучения'; sandboxBadge.style.display = '';
      renderCombat(); renderZoombar(); renderStatus(); requestRender({bg:true, draw:true, fx:true});
    }
  }
  function exitSandbox(){
    if(!sandbox) return;
    const sb = sandbox; sandbox = null;
    cancelAll();
    authState = sb.auth; undoStack = sb.undo; redoStack = sb.redo; combatCollapsed = sb.combatCollapsed; combatHints = sb.combatHints;
    cam.x = sb.cam.x; cam.y = sb.cam.y; cam.z = sb.cam.z;
    lastRole = undefined; refreshRole();
    if(sandboxBadge) sandboxBadge.style.display = 'none';
    if(sb.logOpen) setLogDockOpen(true);
    if(viewport){ applyCamera(); renderCombat(); renderZoombar(); renderStatus(); }
    if(role()==='gm'){ sendMsg({type:'gt-snapshot', state:playerSnapshot()}); broadcastVitals(); } // кто подключился или ходил, пока шло обучение
    if(isPlayer()){ lastSnapshotRequest = 0; requestSnapshot(); }
  }
  // Учебная сцена: свой жетон и типичный мародёр из бестиария рядом
  function sandboxDemo(){
    if(!sandbox) enterSandbox();
    if(!viewport || !vw) return;
    const c = toWorld({x:vw/2, y:vh/2});
    if(!ownToken()){ const sn = snapPos(c.x - 1, c.y, 'normal'); act({c:'player-token-create', x:sn.x, y:sn.y}); }
    if(!Object.values(authState.tokens).some(t=>t.creature) && typeof Bestiary!=='undefined'){
      const tpl = Bestiary.byId('sv_maroder');
      if(tpl){ const f = Bestiary.makeTokenFields(tpl, authState.tokens), sn = snapPos(c.x + 1.2, c.y, f.size); f.hidden = false;
        act({c:'token-create', token:Object.assign({}, f, {x:sn.x, y:sn.y})}); }
    }
    renderTokens(); centerOnTokens();
  }
  // Учебный бой: свой жетон против мародёра, инициатива брошена
  function sandboxCombat(){
    sandboxDemo();
    if(authState.combat) return;
    const parts = {};
    Object.values(authState.tokens).forEach(t=>{ parts[t.id] = {side:t.kind==='player' ? 's1' : 's2', init:null, noAct:false, act:false, react:false, swap:false, effects:[]}; });
    const used = [...new Set(Object.values(parts).map(x=>x.side))]; if(!used.length) return;
    const order = combatSides().map(x=>x.id).filter(id=>used.indexOf(id)>=0);
    const cb = {active:true, round:1, turn:0, scene:1, surprise:'', sides:combatSides().filter(x=>used.indexOf(x.id)>=0), order, parts};
    rollInitiative(cb, Object.keys(parts), 'Инициатива — учебный бой');
    combatCollapsed = false; combatHints = null;
    setCombat(cb); renderToolbar();
  }

  return { init, setVisible, refreshRole, handleMessage, onPlayerHello, onGmHello, onPlayerSheet, onPeerLeft, onLocalCharacterChanged,
           get layerEl(){ return layer || null; }, tokenWorld(id){ const t = tok(id); if(!t || !tokenVisibleHere(t) || !layer) return null; const p = displayPos(t); return {x:p.x*CELL, y:p.y*CELL, d:SIZE_CELLS[t.size]*CELL}; },
           cellPx:CELL, netRole:()=>role(), sheetOf:(t)=>t && t.kind==='player' ? attackerSheet(t) : null, selectedIds:()=>[...selected], ownTokenId:()=>{ const t = ownToken(); return t ? t.id : null; },
           enterSandbox, exitSandbox, inSandbox:()=>sandbox ? sandbox.kind : null, sandboxDemo, sandboxCombat, captureScene, applyScene, focusOwner,
           submitMapAttack, undoAttack, canUndoAttack, setScene, focusScene, redraw:()=>requestRender({bg:true, draw:true, fx:true}),
           placeToken, creatureAttack, getToken:(id)=>tok(id), vitalsOf:(t)=>vitalsFor(t), updateToken:(id, patch)=>act({c:'token-update', id, patch}),
           pickTargets, editToken:(id)=>{ const t = tok(id); if(t) openTokenForm(t, null, {x:40, y:60}); }, refreshToolbar:()=>{ if(viewport) renderToolbar(); },
           get state(){ return st(); }, get camera(){ return cam; },
           setPaused(on){ paused = !!on; if(viewport) renderTokens(); }, get paused(){ return paused; },
           // переброс атаки с карты (способность существа): прежняя отменяется целиком (rerollOf), новый к20 — здесь
           rerollAttack(attackId){ const r = lastAttackReqs[attackId]; if(!r || !isAuthority()) return {ok:false, reason:'Атака не найдена'};
             const n = r.req.mode==='plain' || !r.req.mode ? 1 : 2, req = Object.assign({}, r.req, {attackId:newId('atk'), rolls:Array.from({length:n}, ()=>randInt(20)), rerollOf:attackId});
             return resolveAttack(req, r.from); },
           // оружие атаки («Охрана»: попадание приходится в защитника тем же оружием)
           attackWeapon(attackId){ const r = lastAttackReqs[attackId], att = r && tok(r.req.attackerId); if(!att) return null;
             const w = att.kind==='player' ? sheetWeapon(attackerSheet(att), r.req.weaponIdx) : npcWeapon(att);
             return w ? {name:w.name, mu:w.mu || 0, muType:w.muType || 'удар', wounds:String(w.wounds || 1), travma:!!w.travma, moshh:!!w.moshh} : null; },
           // та же атака с другим к20 («Родство с оружием»: +к6 к выпавшему), прежняя отменяется
           redoAttackRoll(attackId, roll){ const r = lastAttackReqs[attackId]; if(!r || !isAuthority()) return {ok:false, reason:'Атака не найдена'};
             const v = Math.max(1, Math.min(20, Math.round(+roll || 1))), req = Object.assign({}, r.req, {attackId:newId('atk'), rolls:[v], mode:'plain', rerollOf:attackId});
             return resolveAttack(req, r.from); },
           // та же атака с теми же к20, но с поправкой к Максимуму («Нечеловеческая изворотливость»: −3 к этой атаке)
           redoAttack(attackId, modDelta){ const r = lastAttackReqs[attackId]; if(!r || !isAuthority()) return {ok:false, reason:'Атака не найдена'};
             const req = Object.assign({}, r.req, {attackId:newId('atk'), chosenMod:Math.round(num(r.req.chosenMod, 0)) + Math.round(+modDelta || 0), rerollOf:attackId});
             return resolveAttack(req, r.from); },
           applyHitsTo, addMarkTo, rollWoundsExpr, MARKS, ownerIdHere:()=>myOwnerId(), sheetOfToken:(t)=>attackerSheet(t), defenseOf:(t, muType)=>targetDefense(t, muType) };
})();
try{ GameTable.init(); }catch(e){ console.error('[Игровой стол] не удалось запустить', e); }
