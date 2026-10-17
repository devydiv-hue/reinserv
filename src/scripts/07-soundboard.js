/* ======================================================================
   САУНДПАД — вкладка «Саундпад» (#soundTabView), отдельная подсистема той же игровой сессии.
   Использует общие session / sendMsg / RoomTransport / роли / реконнект, но своё состояние (не gameTableState):
   - Постоянное состояние (авторитет — Мастер, у него в localStorage; без сессии — свой локальный пульт):
     свои звуки (метаданные + ссылка на файл), библиотека музыки (файлы), плейлисты, текущая музыка (timeline),
     активная атмосфера. Игрок получает его снимком sb-snapshot и изменения музыки sb-music.
   - События: одноразовый звук sb-sound {eventId, soundId} — WS (надёжно) + DataChannel (быстро), дубль
     гасится по eventId. В состояние не попадает: три «Взрыва» подряд — три отдельных события.
   - Файлы по сети не ходят: встроенные звуки синтезируются в браузере, свои — по HTTP-ссылке с сервера
     проекта (/user-sounds/…, /assets/sounds/…) или по внешней ссылке.
   Музыка — аудиофайлы на сервере игры (загружает Мастер), один плеер на клиент. Синхронизация:
   Мастер держит timeline {position, at}; рассылает его при каждом изменении и раз в 5 с во время игры;
   у каждого клиента ожидаемая позиция = position + время с момента получения, расхождение > 2 с —
   подмотка. Локальные часы разных устройств не сравниваются. Обновил страницу — снимок вернёт ту же
   позицию. Атмосфера из своих файлов тоже продолжается с того же места (state.ambience — момент включения).
   Задел на будущее (не реализовано): сцены (state.scenes — музыка+атмосфера+громкости одним нажатием),
   «звук игрока» (ограниченный набор звуков, которые может запускать игрок), редактор горячих клавиш
   (prefs.hotkeys — клавиша → soundId; сейчас 1–9 = первые девять избранных).
   ====================================================================== */
const Soundboard = (function(){
  const STATE_KEY = 'reincarnator_soundboard_state_v1'; // авторитетное состояние Мастера / локального пульта
  const PREFS_KEY = 'reincarnator_soundboard_prefs_v1'; // локальное: громкость, mute, избранное, недавние, UI
  const CATEGORIES = ['Атмосфера','Бой','Оружие','Монстры','Люди','Природа','Техника','Окружение','Хоррор','События','Интерфейс'];
  const PLAYLIST_SUGGESTIONS = ['Погони','Сталкер','Подземелье','Бой','Хоррор','Пустошь','Город','Спокойная атмосфера'];
  const SYNC_MS = 5000, TICK_MS = 1000, DRIFT_S = 2, MAX_UPLOAD = 25*1024*1024;

  const clamp = (v, a, b)=>Math.max(a, Math.min(b, v));
  const num = (v, d)=>{ const x = Number(v); return isFinite(x) ? x : d; };
  const str = (v, n)=>v==null ? '' : String(v).slice(0, n);
  const newId = (p)=>p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = (s)=>String(s||'').toLowerCase().replace(/ё/g, 'е');
  function loadJson(k){ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } }
  function saveJson(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function isAuthority(){ return !session.role || session.role==='gm'; }
  function fromGm(msg){ return session.role==='player' && !!msg.from && msg.from===session.gmId; }
  function fmtTime(s){ s = Math.max(0, Math.floor(num(s, 0))); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }

  /* ---------- встроенный каталог (синтез, без файлов) ---------- */
  // [id, название, эмодзи, категория, теги, синтез, loop]
  const BUILTIN = [
    ['b_shot','Выстрел','🔫','Оружие','выстрел пистолет ружьё огнестрел','shot'],
    ['b_burst','Очередь','🔫','Оружие','очередь автомат стрельба','burst'],
    ['b_laser','Энерговыстрел','✴️','Оружие','лазер энергия плазма выстрел','laser'],
    ['b_reload','Перезарядка','🔩','Оружие','перезарядка затвор магазин','reload'],
    ['b_explosion','Взрыв','💥','Бой','взрыв граната бомба','explosion'],
    ['b_hit','Удар','🩸','Бой','удар кулак драка','hit'],
    ['b_whoosh','Огонь','🔥','Бой','огонь пламя вспышка огнемёт','whoosh'],
    ['b_door','Дверь','🚪','Окружение','дверь скрип металл','door'],
    ['b_knock','Стук в дверь','✊','Окружение','стук дверь','knock'],
    ['b_glass','Разбитое стекло','🪟','Окружение','стекло разбить окно','glass'],
    ['b_metal','Удар по металлу','🛠','Окружение','металл звон удар','metal'],
    ['b_steps','Шаги','👣','Люди','шаги ходьба','steps'],
    ['b_scream','Крик','😱','Люди','крик вопль страх','scream'],
    ['b_whisper','Шёпот','🤫','Хоррор','шёпот голос','whisper'],
    ['b_roar','Рёв монстра','👹','Монстры','рёв монстр мутант','roar'],
    ['b_growl','Рычание','🐺','Монстры','рычание зверь собака','growl'],
    ['b_thunder','Гром','🌩','Природа','гром гроза буря','thunder'],
    ['b_gust','Порыв ветра','💨','Природа','ветер порыв','gust'],
    ['b_splash','Вода','💧','Природа','вода всплеск капли','splash'],
    ['b_electric','Электричество','⚡','Техника','электричество ток искры','electric'],
    ['b_radio','Радиопомехи','📻','Техника','радио помехи рация','radio'],
    ['b_siren','Сирена','🚨','Техника','сирена тревога','siren'],
    ['b_bell','Звонок','🔔','События','звонок колокол','bell'],
    ['b_alarm','Тревога','⏰','События','тревога сигнал писк','alarm'],
    ['b_tension','Напряжение','🎻','Хоррор','напряжение нарастание акцент','tension'],
    ['b_heartbeat','Сердцебиение','💓','Хоррор','сердце сердцебиение','heartbeat'],
    ['b_death','Смерть','💀','События','смерть гибель','death'],
    ['b_click','Клик','🖱','Интерфейс','клик кнопка','click'],
    ['b_notify','Уведомление','📩','Интерфейс','уведомление сообщение','notify'],
    ['b_success','Успех','✅','Интерфейс','успех удача','success'],
    ['b_fail','Провал','❌','Интерфейс','провал неудача ошибка','fail'],
    ['b_rain','Дождь','🌧','Атмосфера','дождь ливень вода','rain', true],
    ['b_wind','Ветер','🌬','Атмосфера','ветер буря','wind', true],
    ['b_campfire','Костёр','🔥','Атмосфера','костёр огонь треск','campfire', true],
    ['b_static','Радиошум','📻','Атмосфера','радио помехи шум','static', true],
    ['b_city','Шум города','🏙','Атмосфера','город улица шум','city', true],
    ['b_cave','Пещера','🕳','Атмосфера','пещера капли подземелье','cave', true],
    ['b_drone','Тревожный гул','🌑','Атмосфера','гул напряжение хоррор','drone', true],
    ['b_night','Ночной лес','🌲','Атмосфера','лес ночь сверчки природа','crickets', true],
    ['b_sea','Прибой','🌊','Атмосфера','море прибой волны вода берег','sea', true],
    ['b_storm','Гроза','⛈','Атмосфера','гроза ливень гром дождь буря','storm', true],
    ['b_blizzard','Метель','❄️','Атмосфера','метель буран снег ветер холод','blizzard', true],
    ['b_sewer','Канализация','🚰','Атмосфера','канализация вода трубы подземелье','sewer', true],
    ['b_factory','Завод','🏭','Атмосфера','завод цех станки машины','factory', true],
    ['b_generator','Генератор','⚙️','Атмосфера','генератор мотор двигатель техника','generator', true],
    ['b_swamp','Болото','🐸','Атмосфера','болото лягушки жабы топь','swamp', true],
    ['b_wasteland','Пустошь','🏜','Атмосфера','пустошь равнина ветер руины','wasteland', true],
    ['b_pulse','Пульс','🫀','Атмосфера','сердце пульс напряжение хоррор','pulse', true],
    ['b_geiger','Счётчик Гейгера','☢️','Атмосфера','радиация дозиметр гейгер','geiger', true],
    ['b_tavern','Таверна','🍺','Атмосфера','таверна бар толпа голоса город','tavern', true],
    ['b_vent','Вентиляция','🌀','Атмосфера','вентиляция шахта бункер воздух','vent', true],
    ['b_train','Поезд','🚂','Атмосфера','поезд вагон рельсы дорога','train', true],
    ['b_choir','Призрачный хор','👻','Атмосфера','хор призраки мистика хоррор','choir', true],
  ].map(([id, title, emoji, cat, tags, synth, loop])=>({id, title, emoji, cat, tags:tags.split(' '), synth, loop:!!loop, builtin:true}));
  const BUILTIN_BY_ID = {}; BUILTIN.forEach(s=>{ BUILTIN_BY_ID[s.id] = s; });

  /* ---------- состояние ---------- */
  function blankState(){
    return { schema:1, version:0, sounds:{}, library:{}, playlists:{}, playlistOrder:[], ambience:{},
             music:{ itemId:null, playlistId:null, playing:false, position:0, at:0 },
             scenes:{} }; // scenes — задел на будущее, сейчас не используется
  }
  function safeUrl(u){
    u = str(u, 500).trim();
    if(/^\/(user-sounds|assets\/sounds)\/[a-zA-Z0-9_.-]+$/.test(u)) return u;
    if(/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i.test(u)) return ''; // YouTube — не аудиофайл (поддержка YouTube убрана)
    if(/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
    return '';
  }
  const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  function sanitizeSound(s){
    if(!s || typeof s!=='object' || !ID_RE.test(s.id)) return null;
    const url = safeUrl(s.url); if(!url) return null;
    return { id:s.id, title:str(s.title, 60) || 'Звук', emoji:str(s.emoji, 8) || '🔊', cat: CATEGORIES.indexOf(s.cat)>=0 ? s.cat : 'События',
             tags:(Array.isArray(s.tags) ? s.tags : []).slice(0, 12).map(t=>str(t, 30)).filter(Boolean), url, loop:!!s.loop, custom:true };
  }
  function sanitizeItem(it){
    if(!it || typeof it!=='object' || !ID_RE.test(it.id) || it.youtubeId || it.listId) return null; // записи прежней YouTube-библиотеки отбрасываются
    const url = safeUrl(it.url); if(!url) return null;
    return { id:it.id, title:str(it.title, 120) || 'Трек', url, duration: clamp(num(it.duration, 0), 0, 86400) };
  }
  function sanitizeMusic(m){
    m = m && typeof m==='object' ? m : {};
    return { itemId: ID_RE.test(m.itemId||'') ? m.itemId : null, playlistId: ID_RE.test(m.playlistId||'') ? m.playlistId : null,
             playing:!!m.playing, position: clamp(num(m.position, 0), 0, 86400), at: num(m.at, 0) };
  }
  function sanitizeState(raw){
    const s = blankState();
    if(!raw || typeof raw!=='object') return s;
    s.version = Math.max(0, Math.round(num(raw.version, 0)));
    Object.values(raw.sounds && typeof raw.sounds==='object' ? raw.sounds : {}).slice(0, 300).forEach(x=>{ const v = sanitizeSound(x); if(v) s.sounds[v.id] = v; });
    Object.values(raw.library && typeof raw.library==='object' ? raw.library : {}).slice(0, 500).forEach(x=>{ const v = sanitizeItem(x); if(v) s.library[v.id] = v; });
    Object.values(raw.playlists && typeof raw.playlists==='object' ? raw.playlists : {}).slice(0, 100).forEach(p=>{
      if(!p || !ID_RE.test(p.id)) return;
      s.playlists[p.id] = { id:p.id, title:str(p.title, 60) || 'Плейлист', items:(Array.isArray(p.items) ? p.items : []).filter(id=>s.library[id]).slice(0, 300) };
    });
    s.playlistOrder = (Array.isArray(raw.playlistOrder) ? raw.playlistOrder : []).filter(id=>s.playlists[id]);
    Object.keys(s.playlists).forEach(id=>{ if(s.playlistOrder.indexOf(id)<0) s.playlistOrder.push(id); });
    Object.keys(raw.ambience && typeof raw.ambience==='object' ? raw.ambience : {}).forEach(id=>{
      const v = raw.ambience[id];
      if(v!==false && v!=null && (BUILTIN_BY_ID[id] || s.sounds[id])) s.ambience[id] = v===true ? Date.now() : Math.max(0, num(v, 0));
    });
    s.music = sanitizeMusic(raw.music);
    if(s.music.itemId && !s.library[s.music.itemId]) s.music = sanitizeMusic(null);
    return s;
  }
  let state = sanitizeState(loadJson(STATE_KEY)); // Мастер / локальный пульт
  let remote = blankState();                     // игрок: последний снимок от Мастера
  let remoteAnchor = 0;                          // performance.now() получения remote.music
  let remoteAmbAnchor = 0;                       // performance.now() получения remote.ambience (секунды звучания)
  const has = (o, k)=>Object.prototype.hasOwnProperty.call(o || {}, k);
  function ambElapsed(id){ // сколько секунд атмосфера уже звучит — чтобы своя петля-файл продолжилась с того же места
    if(isAuthority()) return Math.max(0, (Date.now() - num(state.ambience[id], Date.now()))/1000);
    return Math.max(0, num(remote.ambience[id], 0) + (performance.now() - remoteAmbAnchor)/1000);
  }
  function cur(){ return isAuthority() ? state : remote; }
  function soundById(id){ return BUILTIN_BY_ID[id] || cur().sounds[id] || null; }
  function allSounds(){ return BUILTIN.concat(Object.values(cur().sounds)); }

  const prefs = Object.assign({ vol:{music:80, amb:60, sfx:100}, mute:{all:false, music:false, amb:false, sfx:false},
    favorites:{}, recent:[], cat:'all', section:'pad', hotkeys:{} }, loadJson(PREFS_KEY) || {});
  delete prefs.showVideo; delete prefs.dock; // остатки YouTube-версии
  ['music','amb','sfx'].forEach(k=>{ prefs.vol[k] = clamp(num(prefs.vol && prefs.vol[k], 80), 0, 100); });
  function savePrefs(){ saveJson(PREFS_KEY, prefs); }

  /* ---------- timeline музыки ---------- */
  function timelinePos(m){ // авторитет: позиция «сейчас» по сохранённой точке отсчёта
    return m.playing ? m.position + Math.max(0, Date.now() - m.at)/1000 : m.position;
  }
  function expectedPos(){
    if(isAuthority()) return timelinePos(state.music);
    const m = remote.music;
    return m.playing ? m.position + Math.max(0, performance.now() - remoteAnchor)/1000 : m.position;
  }
  function musicWire(){ const m = state.music; return Object.assign({}, m, {position: timelinePos(m), at:0}); }

  /* ---------- сеть ---------- */
  function snapshot(){
    return { version:state.version, sounds:state.sounds, library:state.library, playlists:state.playlists, playlistOrder:state.playlistOrder,
             ambience:Object.keys(state.ambience).reduce((o, id)=>{ o[id] = ambElapsed(id); return o; }, {}), music:musicWire() };
  }
  let snapTimer = null;
  function commit(opts){ // изменение постоянного состояния Мастером: сохранить, разослать, применить у себя
    state.version++;
    saveJson(STATE_KEY, state);
    if(session.role==='gm'){
      if(opts && opts.musicOnly) sendMsg({type:'sb-music', version:state.version, music:musicWire()});
      else { clearTimeout(snapTimer); snapTimer = setTimeout(()=>sendMsg({type:'sb-snapshot', state:snapshot()}), 60); }
    }
    syncAmbience(); followMusic(); render();
  }
  function applyRemoteSnapshot(raw){
    const s = sanitizeState(raw);
    remote = s; remoteAnchor = remoteAmbAnchor = performance.now();
    syncAmbience(); followMusic(); render();
  }
  function handleMessage(msg){
    if(msg.type==='sb-request'){ if(session.role==='gm' && msg.from) sendMsg({type:'sb-snapshot', state:snapshot()}, msg.from); return; }
    if(!fromGm(msg)) return; // остальное принимаем только от Мастера
    if(msg.type==='sb-snapshot') applyRemoteSnapshot(msg.state);
    else if(msg.type==='sb-music'){
      if(num(msg.version, 0) < remote.version) return; // устаревшее (переупорядочивание после реконнекта)
      remote.version = Math.round(num(msg.version, remote.version));
      remote.music = sanitizeMusic(msg.music); remoteAnchor = performance.now();
      if(remote.music.itemId && !remote.library[remote.music.itemId]){ sendMsg({type:'sb-request'}, session.gmId); return; }
      followMusic(); renderNow();
    }
    else if(msg.type==='sb-sound') receiveSound(msg);
  }
  function onPlayerHello(id){ sendMsg({type:'sb-snapshot', state:snapshot()}, id); }
  function onGmHello(){ if(session.gmId) sendMsg({type:'sb-request'}, session.gmId); }
  let lastRole = undefined;
  function refreshRole(){
    const r = session.role || null;
    if(r===lastRole){ renderNow(); return; }
    lastRole = r;
    stopAllLoops();
    if(musicSrc){ musicEl.pause(); musicEl.removeAttribute('src'); musicSrc = null; musicReady = false; }
    if(r==='player') remote = blankState();
    syncAmbience(); followMusic(); render();
  }

  /* ---------- одноразовые звуки ---------- */
  const seen = new Set(); const seenOrder = [];
  function markSeen(id){ if(seen.has(id)) return false; seen.add(id); seenOrder.push(id); if(seenOrder.length>300) seen.delete(seenOrder.shift()); return true; }
  function playSound(id, srcEl){
    const s = soundById(id);
    if(!s || !isAuthority()) return;
    if(typeof GmAdvice!=='undefined') GmAdvice.event('sound');
    if(s.loop){ toggleAmbience(id); return; }
    const eventId = 'sfx:' + id + ':' + newId('');
    markSeen(eventId);
    playLocal(s);
    if(session.role==='gm'){
      const ev = {type:'sb-sound', eventId, soundId:id, ts:Date.now()};
      sendMsg(ev);                                                 // надёжно, всем
      try{ RoomTransport.sendGameEvent(ev); }catch(e){}            // быстрее, если открыт DataChannel; дубль гасится по eventId
    }
    prefs.recent = [id].concat(prefs.recent.filter(x=>x!==id)).slice(0, 12); savePrefs();
    flashButton(id);
    if(!visible) toast(`${s.emoji} ${s.title}`);
    renderRecentOnly();
  }
  function receiveSound(msg){
    if(typeof msg.eventId!=='string' || msg.eventId.length>120 || !markSeen(msg.eventId)) return;
    const s = soundById(msg.soundId);
    if(!s || s.loop) return;
    stats.received++;
    playLocal(s);
    toast(`🔊 ${s.title}`);
    flashButton(s.id);
  }
  const stats = { played:0, received:0, lastSound:null }; // диагностика: сколько эффектов проиграно / получено от Мастера
  function playLocal(s){
    stats.played++; stats.lastSound = s.id;
    if(s.builtin){
      const ac = audio(); if(!ac) return;
      if(ac.state!=='running'){ ac.resume().catch(()=>{}); renderUnlock(); if(ac.state!=='running') return; }
      const out = actx.createGain(); out.connect(chanSfx);
      try{ SFX[s.synth](out, actx.currentTime + 0.02); }catch(e){ console.warn('[Саундпад]', e); }
      setTimeout(()=>{ try{ out.disconnect(); }catch(e){} }, 9000);
      return;
    }
    const el = new Audio(s.url); // новый экземпляр на каждое воспроизведение — повторы не обрывают друг друга
    el.volume = effVol('sfx');
    el.play().then(()=>{ audioUnlockedEl = true; renderUnlock(); }).catch((e)=>{ if(e && e.name==='NotAllowedError'){ audioUnlockedEl = false; renderUnlock(); } });
  }

  /* ---------- атмосфера (лупы) ---------- */
  const activeLoops = {}; // soundId -> {stop}
  function toggleAmbience(id){
    if(!isAuthority()) return;
    if(has(state.ambience, id)) delete state.ambience[id]; else state.ambience[id] = Date.now();
    commit();
  }
  function syncAmbience(){
    const want = cur().ambience || {};
    Object.keys(activeLoops).forEach(id=>{ if(!has(want, id)) stopLoop(id); });
    Object.keys(want).forEach(id=>{ if(!activeLoops[id]) startLoop(id); });
  }
  function startLoop(id){
    const s = soundById(id);
    if(!s || !s.loop || activeLoops[id]) return;
    if(s.builtin){
      const ac = audio(); if(!ac) return;
      if(ac.state!=='running') ac.resume().catch(()=>{});
      const out = actx.createGain(); out.gain.value = 0.0001; out.connect(chanAmb);
      out.gain.setTargetAtTime(1, actx.currentTime, 0.4);
      let stops = [];
      try{ stops = LOOPS[s.synth](out) || []; }catch(e){ console.warn('[Саундпад]', e); }
      activeLoops[id] = { stop(){ try{ out.gain.setTargetAtTime(0.0001, actx.currentTime, 0.15); }catch(e){}
        setTimeout(()=>{ stops.forEach(f=>{ try{ f(); }catch(e){} }); try{ out.disconnect(); }catch(e){} }, 600); } };
      return;
    }
    const el = new Audio(s.url); el.loop = true; el.volume = effVol('amb');
    el.addEventListener('loadedmetadata', ()=>{ const d = el.duration; if(isFinite(d) && d>0){ try{ el.currentTime = ambElapsed(id) % d; }catch(e){} } }, {once:true});
    el.play().catch((e)=>{ if(e && e.name==='NotAllowedError'){ audioUnlockedEl = false; renderUnlock(); } });
    activeLoops[id] = { el, stop(){ try{ el.pause(); el.removeAttribute('src'); el.load(); }catch(e){} } };
  }
  function stopLoop(id){ const l = activeLoops[id]; if(l){ l.stop(); delete activeLoops[id]; } }
  function stopAllLoops(){ Object.keys(activeLoops).forEach(stopLoop); }

  /* ---------- громкость (локально) ---------- */
  function effVol(ch){ const m = prefs.mute; return (m.all || m[ch]) ? 0 : prefs.vol[ch]/100; }
  function applyVolumes(){
    if(actx){
      master.gain.value = prefs.mute.all ? 0 : 1;
      chanSfx.gain.value = prefs.mute.sfx ? 0 : prefs.vol.sfx/100;
      chanAmb.gain.value = prefs.mute.amb ? 0 : prefs.vol.amb/100;
    }
    Object.values(activeLoops).forEach(l=>{ if(l.el) l.el.volume = effVol('amb'); });
    musicEl.volume = effVol('music');
  }

  /* ---------- разрешение звука (autoplay) ----------
     Не обходим политику браузера: звук считается разрешённым, только если AudioContext реально 'running'
     и play() музыки не отклонён. Любое нажатие на странице — пользовательский жест: пробуем resume()/play() ещё раз. */
  let audioUnlockedEl = true; // последний play() своего аудиофайла не был отклонён политикой
  function needsUnlock(){
    const sessionAudio = !!session.role; // без сессии — свой пульт, подсказка не нужна до первого звука
    const ctxBlocked = !!actx && actx.state!=='running';
    return musicNeedsGesture || !audioUnlockedEl || (sessionAudio && session.role==='player' && (!actx || ctxBlocked)) || (ctxBlocked && Object.keys(activeLoops).length>0);
  }
  function unlock(){
    const ac = audio();
    const p = ac ? ac.resume() : Promise.resolve();
    if(musicSrc && cur().music.playing){ seekToExpected(); tryPlay(); }
    Object.values(activeLoops).forEach(l=>{ if(l.el) l.el.play().catch(()=>{}); });
    audioUnlockedEl = true;
    Promise.resolve(p).catch(()=>{}).then(()=>{ renderUnlock(); setTimeout(renderUnlock, 1500); });
  }
  document.addEventListener('pointerdown', ()=>{ if(needsUnlock() && (actx || session.role)) unlock(); }, true);

  /* ---------- звук: Web Audio, каналы громкости ----------
     Встроенные звуки не файлы, а синтез в самом браузере (Web Audio) — ни скачивания чужих записей, ни прав на
     них не нужно. Каждый эффект — новый экземпляр узлов (выстрел поверх выстрела звучит дважды), атмосфера-луп —
     ровно один экземпляр на звук. Каналы: Эффекты и Атмосфера — узлы усиления Web Audio, Музыка — громкость
     аудиоплеера музыки. Громкость и mute — только локальные (prefs), на других участников не влияют. */
  let actx = null, master = null, chanSfx = null, chanAmb = null, noiseBuf = null;
  function audio(){
    if(actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{ actx = new AC(); }catch(e){ return null; }
    master = actx.createGain(); master.connect(actx.destination);
    chanSfx = actx.createGain(); chanSfx.connect(master);
    chanAmb = actx.createGain(); chanAmb.connect(master);
    actx.onstatechange = ()=>{ renderUnlock(); };
    applyVolumes();
    return actx;
  }
  function audioRunning(){ return !!actx && actx.state==='running'; }
  function noise(){
    if(!noiseBuf){
      const len = actx.sampleRate*2; noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      const d = noiseBuf.getChannelData(0); for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
    }
    return noiseBuf;
  }
  const G = (v)=>{ const g = actx.createGain(); g.gain.value = v; return g; };
  const F = (type, f, q)=>{ const x = actx.createBiquadFilter(); x.type = type; x.frequency.value = f; if(q!=null) x.Q.value = q; return x; };
  const O = (type, f)=>{ const o = actx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const N = ()=>{ const s = actx.createBufferSource(); s.buffer = noise(); s.loop = true; return s; };
  const chain = (...n)=>{ for(let i=0;i<n.length-1;i++) n[i].connect(n[i+1]); return n[n.length-1]; };
  const R = (a, b)=>a + Math.random()*(b-a);
  function envelope(g, t, a, peak, dur){
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  }
  function noiseHit(out, t, o){
    const n = N(), fl = F(o.type||'lowpass', o.f||1000, o.q==null?1:o.q), g = G(0);
    chain(n, fl, g, out);
    if(o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + (o.a||0.003) + (o.dur||0.3));
    envelope(g, t, o.a||0.003, o.peak==null?1:o.peak, o.dur||0.3);
    n.start(t, Math.random()*1.5); n.stop(t + (o.a||0.003) + (o.dur||0.3) + 0.05);
  }
  function tone(out, t, o){
    const osc = O(o.type||'sine', o.f||440), g = G(0);
    chain(osc, g, out);
    if(o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || ((o.a||0.005) + (o.dur||0.5))));
    envelope(g, t, o.a||0.005, o.peak==null?0.5:o.peak, o.dur||0.5);
    osc.start(t); osc.stop(t + (o.a||0.005) + (o.dur||0.5) + 0.05);
    return osc;
  }
  function partials(out, t, base, ratios, peak, dur){
    ratios.forEach((r, i)=>tone(out, t, {f:base*r, peak:peak/(i+1), dur:dur/(1+i*0.4), a:0.002}));
  }
  // Одноразовые эффекты: (out, t) — out уже подключён к каналу «Эффекты»
  const SFX = {
    shot(out, t){ noiseHit(out, t, {f:4200, f2:300, dur:0.35}); tone(out, t, {f:140, f2:40, dur:0.18, peak:0.9}); },
    burst(out, t){ for(let i=0;i<7;i++){ noiseHit(out, t+i*0.095, {f:3800, f2:400, dur:0.12, peak:0.8}); tone(out, t+i*0.095, {f:120, f2:45, dur:0.08, peak:0.6}); } },
    laser(out, t){ tone(out, t, {type:'sawtooth', f:1900, f2:140, dur:0.32, peak:0.18}); tone(out, t, {f:2600, f2:320, dur:0.26, peak:0.2}); },
    reload(out, t){ noiseHit(out, t, {type:'highpass', f:2500, dur:0.04, peak:0.6}); tone(out, t, {type:'square', f:900, dur:0.03, peak:0.12});
      noiseHit(out, t+0.28, {type:'bandpass', f:1800, q:2, dur:0.07, peak:0.8}); tone(out, t+0.28, {type:'square', f:620, dur:0.04, peak:0.12}); },
    explosion(out, t){ noiseHit(out, t, {f:2200, f2:80, a:0.01, dur:2.6}); tone(out, t, {f:75, f2:24, dur:1.9, peak:1}); noiseHit(out, t+0.05, {f:420, f2:55, dur:3.4, peak:0.7}); },
    door(out, t){
      const saw = O('sawtooth', 150), bp = F('bandpass', 900, 8), g = G(0);
      chain(saw, bp, g, out);
      for(let i=0;i<20;i++) saw.frequency.setValueAtTime(R(105, 210), t + i*0.05);
      envelope(g, t, 0.06, 0.45, 1.0); saw.start(t); saw.stop(t + 1.1);
      noiseHit(out, t+1.05, {f:240, dur:0.25, peak:1}); tone(out, t+1.05, {f:95, f2:48, dur:0.2, peak:0.8});
    },
    knock(out, t){ for(let i=0;i<3;i++){ noiseHit(out, t+i*0.22, {f:900, f2:200, dur:0.09, peak:0.9}); tone(out, t+i*0.22, {f:190, f2:90, dur:0.08, peak:0.6}); } },
    steps(out, t){ for(let i=0;i<4;i++){ const k = i%2 ? 0.75 : 1; noiseHit(out, t+i*0.48, {f:500, dur:0.09, peak:0.7*k}); noiseHit(out, t+i*0.48+0.01, {type:'highpass', f:3200, dur:0.03, peak:0.12*k}); } },
    electric(out, t){
      const a = O('sawtooth', 55), b = O('square', 110), lp = F('lowpass', 1400), g = G(0);
      a.connect(lp); b.connect(lp); chain(lp, g, out);
      for(let i=0;i<32;i++) g.gain.setValueAtTime(Math.random()<0.6 ? R(0.05, 0.35) : 0.0001, t + i*0.04);
      g.gain.setValueAtTime(0.0001, t + 1.3); a.start(t); b.start(t); a.stop(t + 1.35); b.stop(t + 1.35);
      for(let i=0;i<10;i++) noiseHit(out, t + R(0, 1.2), {type:'bandpass', f:4000, q:3, dur:0.025, peak:R(0.2, 0.6)});
    },
    thunder(out, t){
      noiseHit(out, t, {type:'highpass', f:1500, dur:0.25, peak:0.8});
      const n = N(), lp = F('lowpass', 260), g = G(0.0001); chain(n, lp, g, out);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
      for(let i=1;i<14;i++) g.gain.exponentialRampToValueAtTime(R(0.25, 0.9) * (1 - i/16), t + 0.25 + i*0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2); n.start(t); n.stop(t + 4.3);
    },
    scream(out, t){
      const o = O('sawtooth', 650), lfo = O('sine', 6.5), lg = G(30), b1 = F('bandpass', 1300, 3), b2 = F('bandpass', 2600, 4), g = G(0);
      lfo.connect(lg); lg.connect(o.frequency); o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(out);
      o.frequency.setValueAtTime(650, t); o.frequency.linearRampToValueAtTime(1150, t + 0.25); o.frequency.linearRampToValueAtTime(900, t + 1.1); o.frequency.linearRampToValueAtTime(520, t + 1.45);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.setValueAtTime(0.5, t + 1.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.start(t); lfo.start(t); o.stop(t + 1.55); lfo.stop(t + 1.55);
      noiseHit(out, t, {type:'bandpass', f:2500, q:1, a:0.05, dur:1.3, peak:0.08});
    },
    roar(out, t){
      const a = O('sawtooth', 68), b = O('sawtooth', 101), lp = F('lowpass', 520), trem = G(0.6), lfo = O('sine', 7), ld = G(0.35), g = G(0);
      a.connect(lp); b.connect(lp); chain(lp, trem, g, out); lfo.connect(ld); ld.connect(trem.gain);
      a.frequency.exponentialRampToValueAtTime(50, t + 2); b.frequency.exponentialRampToValueAtTime(72, t + 2);
      envelope(g, t, 0.25, 0.9, 1.8); [a, b, lfo].forEach(x=>{ x.start(t); x.stop(t + 2.2); });
      noiseHit(out, t, {f:700, a:0.25, dur:1.7, peak:0.3});
    },
    growl(out, t){
      const a = O('sawtooth', 48), am = G(0.5), lfo = O('square', 28), ld = G(0.5), lp = F('lowpass', 380), g = G(0);
      chain(a, am, lp, g, out); lfo.connect(ld); ld.connect(am.gain);
      envelope(g, t, 0.2, 0.8, 1.4); [a, lfo].forEach(x=>{ x.start(t); x.stop(t + 1.7); });
    },
    bell(out, t){ partials(out, t, 660, [1, 2.01, 2.76, 4.07, 5.43], 0.5, 2.6); },
    metal(out, t){ partials(out, t, 420, [1, 2.57, 4.18, 6.3], 0.45, 1.3); noiseHit(out, t, {type:'highpass', f:3000, dur:0.03, peak:0.5}); },
    glass(out, t){ noiseHit(out, t, {type:'highpass', f:3000, dur:0.5, peak:0.5}); for(let i=0;i<14;i++) tone(out, t + R(0, 0.4), {f:R(2500, 7000), dur:R(0.12, 0.4), peak:0.08, a:0.001}); },
    radio(out, t){
      const n = N(), bp = F('bandpass', 1800, 1), g = G(0); chain(n, bp, g, out);
      for(let i=0;i<40;i++) g.gain.setValueAtTime(Math.random()<0.7 ? R(0.05, 0.5) : 0.0001, t + i*0.03);
      g.gain.setValueAtTime(0.0001, t + 1.2); n.start(t); n.stop(t + 1.25);
    },
    gust(out, t){
      const n = N(), bp = F('bandpass', 400, 1.5), g = G(0); chain(n, bp, g, out);
      bp.frequency.exponentialRampToValueAtTime(1200, t + 1.2); bp.frequency.exponentialRampToValueAtTime(350, t + 2.6);
      envelope(g, t, 0.6, 0.7, 2.0); n.start(t); n.stop(t + 2.7);
    },
    whoosh(out, t){
      const n = N(), lp = F('lowpass', 200), g = G(0); chain(n, lp, g, out);
      lp.frequency.exponentialRampToValueAtTime(3500, t + 0.45); lp.frequency.exponentialRampToValueAtTime(300, t + 1.1);
      envelope(g, t, 0.15, 0.8, 1.0); n.start(t); n.stop(t + 1.2);
      for(let i=0;i<8;i++) noiseHit(out, t + R(0.3, 1.1), {type:'highpass', f:2200, dur:0.02, peak:R(0.1, 0.4)});
    },
    splash(out, t){ noiseHit(out, t, {type:'bandpass', f:1200, f2:400, q:0.8, dur:0.5, peak:0.8}); [0.3, 0.55, 0.72].forEach(d=>tone(out, t+d, {f:1400, f2:700, dur:0.08, peak:0.2})); },
    hit(out, t){ tone(out, t, {f:160, f2:45, dur:0.15, peak:1}); noiseHit(out, t, {f:1500, dur:0.06, peak:0.6}); },
    death(out, t){ tone(out, t, {f:220, f2:55, dur:2.2, peak:0.35, a:0.05}); tone(out, t, {f:233, f2:58, dur:2.2, peak:0.25, a:0.05}); tone(out, t, {type:'triangle', f:110, f2:40, dur:2.5, peak:0.3, a:0.05}); },
    heartbeat(out, t){ for(let i=0;i<3;i++){ tone(out, t+i*0.9, {f:62, f2:40, dur:0.12, peak:1}); tone(out, t+i*0.9+0.25, {f:55, f2:38, dur:0.1, peak:0.7}); } },
    siren(out, t){
      const o = O('square', 650), lp = F('lowpass', 2000), g = G(0); chain(o, lp, g, out);
      for(let i=0;i<8;i++) o.frequency.setValueAtTime(i%2 ? 950 : 650, t + i*0.35);
      envelope(g, t, 0.05, 0.18, 2.8); o.start(t); o.stop(t + 2.9);
    },
    alarm(out, t){ for(let i=0;i<6;i++) tone(out, t+i*0.2, {type:'square', f:880, dur:0.12, peak:0.15, a:0.002}); },
    whisper(out, t){
      const n = N(), bp = F('bandpass', 3500, 2), g = G(0.0001); chain(n, bp, g, out);
      for(let i=0;i<9;i++){ const s = t + i*0.18 + R(0, 0.05); g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(R(0.15, 0.4), s + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, s + R(0.1, 0.16)); }
      n.start(t); n.stop(t + 1.8);
    },
    tension(out, t){
      const lp = F('lowpass', 200), g = G(0.0001); chain(lp, g, out);
      [110, 116.5, 164.8].forEach(f=>{ const o = O('sawtooth', f); o.connect(lp); o.start(t); o.stop(t + 2.4); });
      lp.frequency.exponentialRampToValueAtTime(2200, t + 2.1);
      g.gain.exponentialRampToValueAtTime(0.25, t + 2.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.35);
    },
    click(out, t){ tone(out, t, {f:1500, dur:0.04, peak:0.3, a:0.001}); },
    notify(out, t){ tone(out, t, {f:880, dur:0.12, peak:0.3}); tone(out, t+0.12, {f:1320, dur:0.25, peak:0.3}); },
    success(out, t){ [523, 659, 784].forEach((f, i)=>tone(out, t+i*0.1, {type:'triangle', f, dur:0.3, peak:0.25})); },
    fail(out, t){ tone(out, t, {type:'square', f:300, dur:0.25, peak:0.12}); tone(out, t+0.18, {type:'square', f:220, dur:0.35, peak:0.12}); },
  };
  // Атмосфера: (out) → функция остановки. Один экземпляр на звук.
  function every(min, max, fn){
    let timer = null, stopped = false;
    const loop = ()=>{ if(stopped) return; try{ fn(actx.currentTime + 0.02); }catch(e){} timer = setTimeout(loop, R(min, max)); };
    timer = setTimeout(loop, R(min, max));
    return ()=>{ stopped = true; clearTimeout(timer); };
  }
  function lfoOn(param, rate, depth){ const l = O('sine', rate), d = G(depth); l.connect(d); d.connect(param); l.start(); return l; }
  const LOOPS = {
    rain(out){ const n = N(); chain(n, F('highpass', 900), F('lowpass', 7000), G(0.35), out); n.start();
      const s = every(60, 180, t=>tone(out, t, {f:R(2000, 4200), dur:0.03, peak:R(0.01, 0.05), a:0.001})); return [()=>n.stop(), s]; },
    wind(out){ const n = N(), bp = F('bandpass', 500, 0.8), g = G(0.5); chain(n, bp, g, out); n.start();
      const l1 = lfoOn(bp.frequency, 0.08, 280), l2 = lfoOn(g.gain, 0.13, 0.25); return [()=>n.stop(), ()=>l1.stop(), ()=>l2.stop()]; },
    campfire(out){ const n = N(); chain(n, F('lowpass', 450), G(0.28), out); n.start();
      const s = every(40, 140, t=>{ if(Math.random()<0.45) noiseHit(out, t, {type:'highpass', f:2000, dur:0.02, peak:R(0.08, 0.5)}); }); return [()=>n.stop(), s]; },
    static(out){ const n = N(), g = G(0.16); chain(n, F('bandpass', 2200, 0.7), g, out); n.start(); const h = O('sine', 50); chain(h, G(0.04), out); h.start();
      const s = every(120, 260, t=>g.gain.setValueAtTime(R(0.06, 0.22), t)); return [()=>n.stop(), ()=>h.stop(), s]; },
    city(out){ const a = N(), b = N(); chain(a, F('lowpass', 350), G(0.4), out); chain(b, F('bandpass', 1000, 0.5), G(0.05), out); a.start(); b.start();
      const s = every(6000, 13000, t=>{ const lp = F('lowpass', 1200); lp.connect(out); tone(lp, t, {type:'square', f:330, dur:0.4, peak:0.03}); tone(lp, t, {type:'square', f:440, dur:0.4, peak:0.02}); });
      return [()=>a.stop(), ()=>b.stop(), s]; },
    cave(out){ const a = O('sine', 55), b = O('sine', 82.4); chain(a, G(0.08), out); chain(b, G(0.04), out); a.start(); b.start();
      const dl = actx.createDelay(1), fb = G(0.4); dl.delayTime.value = 0.35; dl.connect(fb); fb.connect(dl); dl.connect(out);
      const s = every(600, 2200, t=>tone(dl, t, {f:R(1500, 2100), f2:900, dur:0.06, peak:0.15})); return [()=>a.stop(), ()=>b.stop(), s]; },
    crickets(out){ // ночной лес: сверчки поверх тихого ветра
      const n = N(); chain(n, F('bandpass', 400, 0.7), G(0.08), out); n.start();
      const s = every(120, 420, t=>{ const f = R(3800, 5200), k = Math.floor(R(2, 5)); for(let i=0;i<k;i++) tone(out, t + i*0.07, {f, dur:0.035, peak:R(0.03, 0.08), a:0.004}); });
      return [()=>n.stop(), s]; },
    sea(out){ const n = N(), lp = F('lowpass', 600), g = G(0.35); chain(n, lp, g, out); n.start();
      const l1 = lfoOn(lp.frequency, 0.09, 450), l2 = lfoOn(g.gain, 0.09, 0.25); return [()=>n.stop(), ()=>l1.stop(), ()=>l2.stop()]; },
    storm(out){ const n = N(); chain(n, F('highpass', 700), F('lowpass', 6000), G(0.4), out); n.start();
      const s = every(7000, 16000, t=>{ const r = N(), lp = F('lowpass', 220), g = G(0.0001); chain(r, lp, g, out);
        g.gain.exponentialRampToValueAtTime(R(0.4, 0.8), t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5); r.start(t, R(0, 1.5)); r.stop(t + 3.6); });
      return [()=>n.stop(), s]; },
    blizzard(out){ const n = N(), bp = F('bandpass', 1400, 2), g = G(0.35); chain(n, bp, g, out); n.start();
      const l1 = lfoOn(bp.frequency, 0.21, 700), l2 = lfoOn(g.gain, 0.17, 0.2);
      const n2 = N(); chain(n2, F('lowpass', 300), G(0.3), out); n2.start();
      return [()=>n.stop(), ()=>n2.stop(), ()=>l1.stop(), ()=>l2.stop()]; },
    sewer(out){ const n = N(); chain(n, F('lowpass', 700), G(0.25), out); n.start();
      const s = every(80, 300, t=>{ if(Math.random()<0.6) tone(out, t, {f:R(300, 900), f2:R(900, 1600), dur:0.05, peak:R(0.02, 0.07)}); });
      return [()=>n.stop(), s]; },
    factory(out){ const h = O('square', 60); chain(h, F('lowpass', 300), G(0.05), out); h.start();
      const n = N(); chain(n, F('bandpass', 900, 1), G(0.05), out); n.start();
      let k = 0; const s = every(480, 520, t=>{ k++; if(k%2) partials(out, t, 300, [1, 2.4, 3.9], 0.12, 0.4); else noiseHit(out, t, {f:500, dur:0.12, peak:0.25}); });
      return [()=>h.stop(), ()=>n.stop(), s]; },
    generator(out){ const a = O('sawtooth', 46), g = G(0.18); chain(a, F('lowpass', 260), g, out); a.start(); const l = lfoOn(g.gain, 11, 0.06);
      const n = N(); chain(n, F('bandpass', 1800, 2), G(0.03), out); n.start();
      return [()=>a.stop(), ()=>l.stop(), ()=>n.stop()]; },
    swamp(out){ const n = N(); chain(n, F('lowpass', 500), G(0.08), out); n.start();
      const s = every(500, 1800, t=>{
        if(Math.random()<0.55){ const f = R(140, 260); for(let i=0;i<3;i++) tone(out, t + i*0.11, {type:'sawtooth', f, f2:f*0.8, dur:0.08, peak:0.05}); } // кваканье
        else tone(out, t, {f:R(200, 400), f2:R(600, 900), dur:0.06, peak:0.06}); }); // пузырь
      return [()=>n.stop(), s]; },
    wasteland(out){ const n = N(), bp = F('bandpass', 300, 0.8); chain(n, bp, G(0.3), out); n.start(); const l = lfoOn(bp.frequency, 0.05, 150);
      const s = every(9000, 20000, t=>{ const o = O('sawtooth', 110), b = F('bandpass', 700, 6), g = G(0); chain(o, b, g, out); // далёкий скрип металла
        for(let i=0;i<14;i++) o.frequency.setValueAtTime(R(80, 160), t + i*0.08); envelope(g, t, 0.2, 0.08, 1.0); o.start(t); o.stop(t + 1.3); });
      return [()=>n.stop(), ()=>l.stop(), s]; },
    pulse(out){ const s = every(1150, 1250, t=>{ tone(out, t, {f:58, f2:38, dur:0.14, peak:0.7}); tone(out, t + 0.28, {f:52, f2:36, dur:0.12, peak:0.45}); }); return [s]; },
    geiger(out){ const s = every(30, 260, t=>{ if(Math.random()<0.5) noiseHit(out, t, {type:'highpass', f:3000, dur:0.008, peak:R(0.2, 0.5)}); }); return [s]; },
    tavern(out){ const parts = [300, 700, 1200].map(f=>{ const n = N(), g = G(0.06); chain(n, F('bandpass', f, 1.2), g, out); n.start(); return {n, g}; });
      const s = every(150, 400, t=>parts.forEach(p=>p.g.gain.setTargetAtTime(R(0.02, 0.1), t, 0.08))); // гул голосов
      const s2 = every(4000, 9000, t=>partials(out, t, R(800, 1100), [1, 2.7], 0.05, 0.3));      // звон кружек
      return parts.map(p=>()=>p.n.stop()).concat([s, s2]); },
    vent(out){ const n = N(); chain(n, F('lowpass', 900), F('highpass', 120), G(0.25), out); n.start();
      const h = O('sine', 120); chain(h, G(0.025), out); h.start(); return [()=>n.stop(), ()=>h.stop()]; },
    train(out){ const n = N(); chain(n, F('lowpass', 300), G(0.3), out); n.start();
      let k = 0; const s = every(290, 310, t=>{ k++; const acc = k%4===0 || k%4===1; noiseHit(out, t, {f:900, dur:0.05, peak:acc ? 0.35 : 0.15}); });
      return [()=>n.stop(), s]; },
    choir(out){ const lp = F('lowpass', 1200), g = G(0.08); chain(lp, g, out);
      const vs = [220, 261.6, 329.6, 392].map(f=>{ const o = O('sine', f); o.connect(lp); o.start(); return [o, lfoOn(o.frequency, R(0.1, 0.3), f*0.006)]; });
      const fl = lfoOn(lp.frequency, 0.04, 600), gl = lfoOn(g.gain, 0.07, 0.04);
      return vs.map(([o, l])=>()=>{ o.stop(); l.stop(); }).concat([()=>fl.stop(), ()=>gl.stop()]); },
    drone(out){ const lp = F('lowpass', 380), g = G(0.12); chain(lp, g, out); const os = [55, 55.7, 82.5].map(f=>{ const o = O('sawtooth', f); o.connect(lp); o.start(); return o; });
      const l = lfoOn(lp.frequency, 0.05, 120); return os.map(o=>()=>o.stop()).concat([()=>l.stop()]); },
  };

  /* ---------- музыка: один аудиоплеер на клиент ----------
     Треки — аудиофайлы, которые Мастер загрузил на сервер игры (/user-sounds/…), или ссылки на аудиофайлы.
     Плеер один (HTMLAudioElement): берёт нужный трек и встаёт на позицию timeline Мастера; при расхождении
     больше DRIFT_S подматывается. После обновления страницы позиция приходит в снимке — трек продолжается
     с того же места у всех, а не с начала. */
  const musicEl = new Audio(); musicEl.preload = 'auto';
  let musicSrc = null, musicReady = false, musicError = '', musicErrorStreak = 0, musicNeedsGesture = false, playPending = false;
  function musicDuration(){ const d = musicEl.duration; return musicReady && isFinite(d) && d>0 ? d : 0; }
  function seekToExpected(){
    const d = musicDuration(); let t = expectedPos();
    if(d) t = Math.min(t, Math.max(0, d - 0.25));
    try{ musicEl.currentTime = t; }catch(e){}
  }
  function tryPlay(){
    if(!musicSrc || playPending || !musicEl.paused) return;
    playPending = true;
    musicEl.play().then(()=>{ playPending = false; }).catch((e)=>{
      playPending = false;
      if(e && e.name==='NotAllowedError' && !musicNeedsGesture){ musicNeedsGesture = true; renderUnlock(); } // браузер ждёт жеста
    });
  }
  musicEl.addEventListener('loadedmetadata', ()=>{
    musicReady = true;
    seekToExpected();
    if(isAuthority()){ const it = state.library[state.music.itemId], d = musicDuration();
      if(it && d && Math.abs((it.duration||0) - d) > 0.5){ it.duration = Math.round(d*10)/10; saveJson(STATE_KEY, state); } }
    followMusic(); renderProgress();
  });
  musicEl.addEventListener('playing', ()=>{ musicErrorStreak = 0; if(musicError){ musicError = ''; renderNow(); } if(musicNeedsGesture){ musicNeedsGesture = false; renderUnlock(); } });
  musicEl.addEventListener('ended', ()=>{ if(isAuthority() && state.music.playing) nextTrack(true); });
  musicEl.addEventListener('error', ()=>{ if(musicSrc) onMusicError(); });
  // Недоступный файл — следующий трек; если подряд не запустился ни один трек плейлиста — музыка останавливается
  function onMusicError(){
    musicError = 'Не удалось воспроизвести трек — файл недоступен или формат не поддерживается браузером';
    musicErrorStreak++;
    if(isAuthority() && state.music.playing){
      if(musicErrorStreak >= Math.max(1, itemsInOrder().length)){ musicError += ' — музыка остановлена: ни один трек не запустился'; setMusic({playing:false}); }
      else setTimeout(()=>{ if(state.music.playing) nextTrack(true); }, 1200);
    }
    renderNow();
  }
  // Привести свой плеер к состоянию музыки: нужный файл, play/pause, позиция
  function followMusic(){
    const c = cur(), m = c.music, it = m.itemId ? c.library[m.itemId] : null;
    if(!it){
      if(musicSrc){ musicEl.pause(); musicEl.removeAttribute('src'); try{ musicEl.load(); }catch(e){} musicSrc = null; musicReady = false; }
      musicNeedsGesture = false; return;
    }
    if(musicSrc!==it.url){
      musicSrc = it.url; musicReady = false;
      musicEl.src = it.url; // позицию выставит loadedmetadata
      if(m.playing) tryPlay(); // в том же жесте Мастера, если это его нажатие — браузер разрешает звук
      return;
    }
    if(!musicReady) return;
    const exp = expectedPos(), d = musicDuration();
    if(m.playing){
      if(isAuthority() && d && exp > d + 1){ nextTrack(true); return; } // timeline ушёл за конец трека (Мастер обновлял страницу или звук был заблокирован)
      if(musicEl.paused){ if(!(d && exp >= d - 0.3)) { seekToExpected(); tryPlay(); } return; }
      const t = musicEl.currentTime;
      if(Math.abs(t - exp) > DRIFT_S && !(d && exp >= d - 0.3)) seekToExpected();
      else if(isAuthority() && !musicEl.seeking){ state.music.position = t; state.music.at = Date.now(); } // timeline идёт за реальным воспроизведением Мастера
    } else {
      if(!musicEl.paused) musicEl.pause();
      if(Math.abs(musicEl.currentTime - exp) > 0.5) seekToExpected();
    }
  }
  let lastBroadcast = 0;
  setInterval(()=>{
    followMusic();
    if(session.role==='gm' && state.music.playing && state.music.itemId && Date.now() - lastBroadcast > SYNC_MS){
      lastBroadcast = Date.now();
      sendMsg({type:'sb-music', version:state.version, music:musicWire()}); // периодическая коррекция позиции у игроков
      saveJson(STATE_KEY, state);
    }
    renderProgress();
  }, TICK_MS);
  // Мастер закрывает/обновляет страницу — сохранить точную позицию, чтобы после перезагрузки продолжить с неё
  window.addEventListener('pagehide', ()=>{ if(isAuthority()) saveJson(STATE_KEY, state); });

  /* ---------- команды музыки (только Мастер / локальный пульт) ---------- */
  function setMusic(patch){ if(!isAuthority()) return; Object.assign(state.music, patch, {at:Date.now()}); lastBroadcast = Date.now(); commit({musicOnly:true}); }
  function playItem(itemId, playlistId){
    const it = state.library[itemId]; if(!it) return;
    musicErrorStreak = 0; musicError = '';
    setMusic({itemId, playlistId:playlistId||null, playing:true, position:0});
    if(musicSrc===it.url){ seekToExpected(); tryPlay(); }
  }
  function playPlaylist(pid, idx){ const p = state.playlists[pid]; if(!p || !p.items.length) return; playItem(p.items[clamp(idx||0, 0, p.items.length-1)], pid); }
  function togglePlay(){
    const m = state.music;
    if(!m.itemId){ const first = state.playlistOrder.map(id=>state.playlists[id]).find(p=>p && p.items.length); if(first) playPlaylist(first.id, 0); return; }
    if(m.playing){ setMusic({playing:false, position:timelinePos(m)}); musicEl.pause(); }
    else { musicErrorStreak = 0; musicError = ''; setMusic({playing:true}); tryPlay(); } // тот же жест — разрешение браузера на звук
  }
  function seekTo(sec){ setMusic({position:clamp(sec, 0, 86400)}); if(musicReady) seekToExpected(); }
  function itemsInOrder(){ const m = state.music; const p = m.playlistId && state.playlists[m.playlistId]; return p && p.items.length ? p.items : (m.itemId ? [m.itemId] : []); }
  function nextTrack(){
    const m = state.music; if(!state.library[m.itemId]) return;
    const items = itemsInOrder(), i = items.indexOf(m.itemId);
    const nextId = items[(i+1) % items.length]; // по кругу — фоновая музыка не обрывается
    setMusic({itemId:nextId, position:0, playing:true});
    if(state.library[nextId] && musicSrc===state.library[nextId].url){ seekToExpected(); tryPlay(); } // тот же трек — с начала
  }
  function prevTrack(){
    const m = state.music; if(!state.library[m.itemId]) return;
    if(timelinePos(m) > 5){ seekTo(0); return; }
    const items = itemsInOrder(), i = items.indexOf(m.itemId);
    setMusic({itemId:items[(i-1+items.length) % items.length], position:0, playing:true});
    if(musicReady && musicSrc===state.library[state.music.itemId].url){ seekToExpected(); tryPlay(); }
  }
  function stopAll(){ // музыка и атмосфера; уже прозвучавшие эффекты не трогаем
    if(!isAuthority()) return;
    state.music = Object.assign(sanitizeMusic(null), {at:Date.now()});
    state.ambience = {};
    commit();
  }

  /* ---------- библиотека музыки (файлы) ---------- */
  function fileTitle(name){
    let s = String(name||'').split('/').pop(); try{ s = decodeURIComponent(s); }catch(e){}
    return s.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 120) || 'Трек';
  }
  function addLibraryItem(url, title, playlistId){
    const item = { id:newId('m'), title:str(title, 120).trim() || fileTitle(url), url };
    state.library[item.id] = item;
    if(playlistId && state.playlists[playlistId]) state.playlists[playlistId].items.push(item.id);
    return item;
  }
  function addMusicUrl(url, title, playlistId){
    const u = safeUrl(url);
    if(!u) return 'Нужна ссылка на аудиофайл: https://… или /assets/sounds/…';
    addLibraryItem(u, title, playlistId); commit();
    return '';
  }
  function addMusicFiles(files, playlistId, statusEl){
    const list = Array.prototype.slice.call(files || []);
    if(!list.length){ statusEl.textContent = 'Выберите один или несколько файлов'; return; }
    let i = 0, ok = 0;
    const step = ()=>{
      if(i>=list.length){ statusEl.textContent = `Добавлено треков: ${ok} из ${list.length}`; return; }
      const f = list[i++];
      statusEl.textContent = `Загрузка ${i} из ${list.length}: ${f.name}…`;
      if(f.size > MAX_UPLOAD){ statusEl.textContent = `«${f.name}» больше 25 МБ — пропущен`; setTimeout(step, 600); return; }
      uploadFile(f).then(url=>{ addLibraryItem(url, fileTitle(f.name), playlistId); ok++; commit(); step(); })
        .catch(e=>{ statusEl.textContent = `«${f.name}»: ${e.message}`; setTimeout(step, 1200); });
    };
    step();
  }
  // Файл с сервера игры удаляется, когда на него больше ничто не ссылается (ни звук, ни трек)
  function releaseFile(url){
    if(!/^\/user-sounds\//.test(url || '') || session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN) return;
    const used = Object.values(state.sounds).some(s=>s.url===url) || Object.values(state.library).some(it=>it.url===url);
    if(used) return;
    fetch('/sound-delete', {method:'POST', headers:{'X-Client-Id':session.myId, 'X-File-Name':url.slice('/user-sounds/'.length)}}).catch(()=>{});
  }

  /* ---------- свои звуки ---------- */
  function uploadFile(file){
    return new Promise((resolve, reject)=>{
      if(file.size > MAX_UPLOAD) return reject(new Error('Файл больше 25 МБ'));
      if(session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN) return reject(new Error('Загружать файлы может Мастер в активной сессии. Без сессии укажите ссылку на файл.'));
      const ext = (file.name.match(/\.([a-z0-9]{2,5})$/i) || [,''])[1].toLowerCase();
      fetch('/sound-upload', {method:'POST', headers:{'X-Client-Id':session.myId, 'X-File-Ext':ext, 'Content-Type':'application/octet-stream'}, body:file})
        .then(r=>r.json().then(j=>{ if(!r.ok || !j.url) throw new Error(j.error || ('Ошибка ' + r.status)); resolve(j.url); }))
        .catch(reject);
    });
  }
  function saveCustomSound(form){
    const fd = new FormData(form);
    const title = str(fd.get('title'), 60).trim(), file = form.querySelector('[name=file]').files[0];
    const base = { id: form.dataset.edit || newId('s'), title: title || 'Мой звук', emoji: str(fd.get('emoji'), 8).trim() || '🔊',
      cat: CATEGORIES.indexOf(fd.get('cat'))>=0 ? fd.get('cat') : 'События', tags: str(fd.get('tags'), 200).split(/[,\s]+/).filter(Boolean).slice(0, 12),
      loop: fd.get('loop')==='on', custom:true };
    const status = form.querySelector('.sb-form-status');
    const finish = (url)=>{ const s = sanitizeSound(Object.assign(base, {url})); if(!s){ status.textContent = 'Нужна ссылка на файл или сам файл'; return; }
      const old = state.sounds[s.id]; state.sounds[s.id] = s; commit(); if(old && old.url!==s.url) releaseFile(old.url); editingSound = null; render(); };
    if(file){
      if(file.size > MAX_UPLOAD){ status.textContent = 'Файл больше 25 МБ'; return; }
      status.textContent = 'Загрузка…';
      uploadFile(file).then(finish).catch(e=>{ status.textContent = e.message; });
    } else finish(str(fd.get('url'), 500).trim() || (state.sounds[base.id] && state.sounds[base.id].url) || '');
  }
  async function deleteCustomSound(id){
    const s = state.sounds[id]; if(!s || !(await uiConfirm(`Удалить звук «${s.title}» из саундпада?`, {title:'Саундпад', ok:'Удалить', danger:true}))) return;
    delete state.sounds[id]; delete state.ambience[id]; delete prefs.favorites[id]; prefs.recent = prefs.recent.filter(x=>x!==id); savePrefs(); commit(); releaseFile(s.url);
  }

  /* ---------- плейлисты ---------- */
  function createPlaylist(title){ title = str(title, 60).trim(); if(!title) return; const id = newId('p'); state.playlists[id] = {id, title, items:[]}; state.playlistOrder.push(id); commit(); }
  async function deletePlaylist(id){ const p = state.playlists[id]; if(!p || !(await uiConfirm(`Удалить плейлист «${p.title}»? Треки останутся в библиотеке.`, {title:'Саундпад', ok:'Удалить', danger:true}))) return;
    delete state.playlists[id]; state.playlistOrder = state.playlistOrder.filter(x=>x!==id); if(state.music.playlistId===id) state.music.playlistId = null; commit(); }
  function moveInPlaylist(pid, i, d){ const p = state.playlists[pid]; if(!p) return; const j = i + d; if(j<0 || j>=p.items.length) return; const t = p.items[i]; p.items[i] = p.items[j]; p.items[j] = t; commit(); }
  function removeFromPlaylist(pid, i){ const p = state.playlists[pid]; if(!p) return; p.items.splice(i, 1); commit(); }
  async function deleteItem(id){ const it = state.library[id]; if(!it || !(await uiConfirm(`Убрать «${it.title}» из библиотеки?`, {title:'Саундпад', ok:'Убрать', danger:true}))) return;
    delete state.library[id]; Object.values(state.playlists).forEach(p=>{ p.items = p.items.filter(x=>x!==id); });
    if(state.music.itemId===id) state.music = Object.assign(sanitizeMusic(null), {at:Date.now()}); commit(); releaseFile(it.url); }

  /* ---------- интерфейс ---------- */
  let visible = false, editingSound = null, search = '';
  const $ = (id)=>document.getElementById(id);
  const esc = (s)=>escapeHtml(s==null ? '' : s);
  function nowTitle(){
    const c = cur(), m = c.music, it = m.itemId && c.library[m.itemId];
    if(!it) return '';
    const pl = m.playlistId && c.playlists[m.playlistId];
    return (pl ? pl.title + ' — ' : '') + it.title;
  }
  function visibleSounds(){
    const q = norm(search).trim();
    let list = allSounds();
    if(q) return list.filter(s=>norm(s.title + ' ' + s.cat + ' ' + s.tags.join(' ')).indexOf(q)>=0);
    if(prefs.cat==='fav') return list.filter(s=>prefs.favorites[s.id]);
    if(prefs.cat==='recent') return prefs.recent.map(soundById).filter(Boolean);
    if(prefs.cat!=='all') return list.filter(s=>s.cat===prefs.cat);
    const fav = list.filter(s=>prefs.favorites[s.id]); // «Все»: сначала избранные
    return fav.concat(list.filter(s=>!prefs.favorites[s.id]));
  }
  function hotkeyFor(id){
    const custom = Object.keys(prefs.hotkeys||{}).find(k=>prefs.hotkeys[k]===id); if(custom) return custom;
    const fav = allSounds().filter(s=>prefs.favorites[s.id]).slice(0, 9); const i = fav.findIndex(s=>s.id===id);
    return i>=0 ? String(i+1) : '';
  }
  function padButton(s){
    const amb = has(cur().ambience, s.id), hk = isAuthority() ? hotkeyFor(s.id) : '';
    const label = `${s.title}${s.loop ? ' — атмосфера (вкл/выкл)' : ''}${hk ? ' · клавиша ' + hk : ''}`;
    return `<div class="sb-pad-cell"><button type="button" class="sb-pad${s.loop?' loop':''}${amb?' on':''}" data-play="${esc(s.id)}" title="${esc(label)}" aria-label="${esc(label)}" ${isAuthority()?'':'disabled'}>
      <span class="sb-emoji" aria-hidden="true">${esc(s.emoji)}</span><span class="sb-name">${esc(s.title)}</span>${s.loop?'<span class="sb-loop" aria-hidden="true">∞</span>':''}${hk?`<span class="sb-hk">${esc(hk)}</span>`:''}</button>
      ${isAuthority() ? `<button type="button" class="sb-star${prefs.favorites[s.id]?' on':''}" data-fav="${esc(s.id)}" title="${prefs.favorites[s.id]?'Убрать из избранного':'В избранное'}" aria-label="Избранное">${prefs.favorites[s.id]?'★':'☆'}</button>` : ''}</div>`;
  }
  function volRow(ch, label){
    const muted = prefs.mute[ch];
    return `<div class="sb-vol"><button type="button" class="sb-mute${muted?' on':''}" data-mute="${ch}" title="${muted?'Включить':'Заглушить'}: ${label}" aria-label="Заглушить: ${label}">${muted?'🔇':'🔊'}</button>
      <span class="sb-vol-label">${label}</span><input type="range" min="0" max="100" step="1" value="${prefs.vol[ch]}" data-vol="${ch}" aria-label="Громкость: ${label}"><span class="sb-vol-val">${prefs.vol[ch]}%</span></div>`;
  }
  function nowHtml(){
    const auth = isAuthority(), c = cur(), m = c.music, title = nowTitle();
    const ambNames = Object.keys(c.ambience||{}).map(soundById).filter(Boolean).map(s=>s.emoji + ' ' + s.title);
    return `<div class="sb-now">
      <div class="sb-now-main">
        <div class="sb-now-label">${m.itemId ? (m.playing ? '🎵 Сейчас играет' : '⏸ На паузе') : '🎵 Музыка не играет'}</div>
        <div class="sb-now-title" id="sbNowTitle">${esc(title || (auth ? 'Выберите трек в «Музыка» или плейлист' : 'Мастер ещё ничего не включил'))}</div>
        <div class="sb-progress"><span id="sbTimeCur">0:00</span><input type="range" id="sbSeek" min="0" max="100" step="1" value="0" ${auth && m.itemId ? '' : 'disabled'} aria-label="Позиция трека"><span id="sbTimeDur">0:00</span></div>
        ${auth ? `<div class="sb-transport">
          <button type="button" data-cmd="prev" title="Предыдущий трек" aria-label="Предыдущий трек">⏮</button>
          <button type="button" class="primary" data-cmd="toggle" title="Играть / пауза" aria-label="Играть или пауза">${m.playing ? '⏸' : '▶'}</button>
          <button type="button" data-cmd="next" title="Следующий трек" aria-label="Следующий трек">⏭</button>
          <button type="button" class="sb-stopall" data-cmd="stopall" title="Остановить музыку и атмосферу у всех">⏹ Остановить всё</button>
        </div>` : ''}
        ${ambNames.length ? `<div class="sb-amb-now">Атмосфера: ${esc(ambNames.join(', '))}</div>` : ''}
        ${musicError ? `<div class="sb-warn">${esc(musicError)}</div>` : ''}
      </div>
      <div class="sb-mixer">
        ${volRow('music', 'Музыка')}${volRow('amb', 'Атмосфера')}${volRow('sfx', 'Эффекты')}
        <div class="sb-mixer-row">
          <button type="button" class="sb-mute-all${prefs.mute.all?' on':''}" data-mute="all" title="Заглушить всё у себя (на других не влияет)">${prefs.mute.all ? '🔇 Звук выключен' : '🔇 Заглушить всё'}</button>
        </div>
        <div class="muted sb-note">Громкость и заглушение — только у вас.</div>
      </div>
    </div>`;
  }
  const SECTIONS = [['pad','Саундпад'],['music','Музыка'],['playlists','Плейлисты'],['mine','Мои звуки']];
  function padHtml(){
    const cats = [['all','Все'],['fav','⭐ Избранное'],['recent','🕘 Недавние']].concat(CATEGORIES.map(c=>[c, c]));
    const list = visibleSounds();
    const recent = (!search && prefs.cat==='all' && prefs.recent.length) ? `<div class="sb-subhead">🕘 Недавние</div><div class="sb-grid sb-grid-small" id="sbRecentGrid">${prefs.recent.slice(0, 8).map(soundById).filter(Boolean).map(padButton).join('')}</div><div class="sb-subhead">Все звуки</div>` : '';
    return `<div class="sb-tools"><input type="search" id="sbSearch" placeholder="🔍 Найти звук…" value="${esc(search)}" aria-label="Найти звук"></div>
      <div class="sb-cats" role="tablist">${cats.map(([k, l])=>`<button type="button" class="sb-cat${prefs.cat===k && !search?' on':''}" data-cat="${esc(k)}">${esc(l)}</button>`).join('')}</div>
      ${recent}<div class="sb-grid" id="sbGrid">${list.length ? list.map(padButton).join('') : '<div class="muted">Ничего не найдено.</div>'}</div>
      <div class="muted sb-note">Клик — звук у всех. ∞ — атмосфера: включается и выключается повторным нажатием. Клавиши 1–9 — первые девять избранных (на этой вкладке).</div>`;
  }
  function libRow(it, extra){
    const playing = state.music.itemId===it.id;
    return `<div class="sb-row${playing?' on':''}"><button type="button" class="sb-rowplay" data-playitem="${esc(it.id)}" title="Играть у всех" aria-label="Играть: ${esc(it.title)}">${playing && state.music.playing ? '🔊' : '▶'}</button>
      <span class="sb-row-title">🎵 ${esc(it.title)}${it.duration ? ` <span class="muted">· ${fmtTime(it.duration)}</span>` : ''}</span>${extra||''}</div>`;
  }
  function musicHtml(){
    const pls = state.playlistOrder.map(id=>state.playlists[id]).filter(Boolean);
    const items = Object.values(state.library);
    return `<form class="sb-addyt" id="sbAddMusic">
        <label class="sb-filepick">🎵 Файлы <input type="file" name="files" multiple accept="audio/*,.mp3,.ogg,.wav,.m4a,.aac,.webm,.flac" aria-label="Аудиофайлы для музыки"></label>
        <select name="pl" aria-label="Добавить в плейлист"><option value="">— без плейлиста —</option>${pls.map(p=>`<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>
        <button type="submit" class="primary">＋ Загрузить</button><span class="sb-form-status muted"></span></form>
      <form class="sb-addyt" id="sbAddMusicUrl">
        <input type="text" name="url" placeholder="или ссылка на аудиофайл: https://… или /assets/sounds/…" required aria-label="Ссылка на аудиофайл">
        <input type="text" name="title" placeholder="Название (необязательно)" maxlength="120" aria-label="Название">
        <button type="submit">＋ По ссылке</button><span class="sb-form-status muted"></span></form>
      <div class="muted sb-note">Файлы до 25 МБ (mp3, ogg, wav, m4a, aac, webm, flac) загружаются на сервер игры — игроки получают только ссылку. Можно выбрать несколько сразу. Трек играет у всех с одного места.</div>
      <div class="sb-list">${items.length ? items.map(it=>libRow(it,
        `<select class="sb-mini" data-addto="${esc(it.id)}" aria-label="В плейлист"><option value="">＋ в плейлист</option>${pls.map(p=>`<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select>
         <button type="button" class="sb-mini" data-rename="${esc(it.id)}" title="Переименовать">✎</button><button type="button" class="sb-mini" data-delitem="${esc(it.id)}" title="Убрать из библиотеки">✕</button>`)).join('')
        : '<div class="muted">Музыки пока нет — загрузите файлы.</div>'}</div>`;
  }
  function playlistsHtml(){
    const pls = state.playlistOrder.map(id=>state.playlists[id]).filter(Boolean);
    const sugg = PLAYLIST_SUGGESTIONS.filter(t=>!pls.some(p=>p.title===t));
    return `<form class="sb-addyt" id="sbAddPl"><input type="text" name="title" placeholder="Новый плейлист" maxlength="60" list="sbPlSugg" required aria-label="Название плейлиста">
        <datalist id="sbPlSugg">${sugg.map(t=>`<option value="${esc(t)}">`).join('')}</datalist><button type="submit" class="primary">＋ Создать</button></form>
      ${pls.length ? pls.map(p=>`<div class="sb-pl${state.music.playlistId===p.id?' on':''}">
        <div class="sb-pl-head"><button type="button" class="sb-rowplay" data-playpl="${esc(p.id)}" title="Играть плейлист у всех" ${p.items.length?'':'disabled'}>▶</button>
          <b>${esc(p.title)}</b><span class="muted">${p.items.length} ${p.items.length===1?'трек':'треков'}</span><button type="button" class="sb-mini" data-delpl="${esc(p.id)}" title="Удалить плейлист">✕</button></div>
        <ol class="sb-pl-items">${p.items.map((id, i)=>{ const it = state.library[id]; if(!it) return '';
          const on = state.music.playlistId===p.id && state.music.itemId===id;
          return `<li class="${on?'on':''}"><button type="button" class="sb-mini" data-playat="${esc(p.id)}|${i}" title="Играть с этого трека">${on && state.music.playing ? '🔊' : '▶'}</button>
            <span class="sb-row-title">${esc(it.title)}</span>
            <button type="button" class="sb-mini" data-move="${esc(p.id)}|${i}|-1" title="Выше">↑</button><button type="button" class="sb-mini" data-move="${esc(p.id)}|${i}|1" title="Ниже">↓</button>
            <button type="button" class="sb-mini" data-rmpl="${esc(p.id)}|${i}" title="Убрать из плейлиста">✕</button></li>`; }).join('')}</ol>
        ${p.items.length ? '' : '<div class="muted">Пусто — добавьте треки в «Музыка».</div>'}</div>`).join('') : '<div class="muted">Плейлистов пока нет. Например: ' + esc(PLAYLIST_SUGGESTIONS.join(', ')) + '.</div>'}`;
  }
  function mineHtml(){
    const e = editingSound ? state.sounds[editingSound] : null;
    const mine = Object.values(state.sounds);
    return `<form class="sb-soundform" id="sbSoundForm" ${e ? `data-edit="${esc(e.id)}"` : ''}>
        <div class="sb-subhead">${e ? 'Изменить звук' : '＋ Добавить звук'}</div>
        <label>Файл <input type="file" name="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.aac,.webm,.flac"></label>
        <label>или ссылка <input type="text" name="url" placeholder="https://… или /assets/sounds/…" value="${esc(e ? e.url : '')}"></label>
        <label>Название <input type="text" name="title" maxlength="60" required placeholder="Рёв мутанта" value="${esc(e ? e.title : '')}"></label>
        <label>Категория <select name="cat">${CATEGORIES.map(c=>`<option ${(e ? e.cat : 'Монстры')===c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Значок <input type="text" name="emoji" maxlength="8" value="${esc(e ? e.emoji : '🔊')}" style="max-width:70px"></label>
        <label>Теги <input type="text" name="tags" placeholder="мутант, рёв, монстр" value="${esc(e ? e.tags.join(', ') : '')}"></label>
        <label class="sb-check"><input type="checkbox" name="loop" ${e && e.loop ? 'checked' : ''}> ∞ Атмосфера (зацикленный фон)</label>
        <div class="sb-form-actions"><button type="submit" class="primary">Сохранить</button>${e ? '<button type="button" data-cmd="canceledit">Отмена</button>' : ''}<span class="sb-form-status muted"></span></div>
      </form>
      <div class="muted sb-note">Файл загружается на сервер игры (до 25 МБ), игрокам уходит только ссылка. Без сессии — только ссылка на файл.</div>
      <div class="sb-list">${mine.length ? mine.map(s=>`<div class="sb-row"><span class="sb-row-title">${esc(s.emoji)} ${esc(s.title)} <span class="muted">· ${esc(s.cat)}${s.loop?' · ∞':''}${s.tags.length?' · '+esc(s.tags.join(', ')):''}</span></span>
        <button type="button" class="sb-mini" data-editsound="${esc(s.id)}" title="Изменить">✎</button><button type="button" class="sb-mini" data-delsound="${esc(s.id)}" title="Удалить">✕</button></div>`).join('') : '<div class="muted">Своих звуков пока нет.</div>'}</div>`;
  }
  function render(){
    renderMini(); renderUnlock();
    const root = $('soundTabView'); if(!root || !visible) return;
    const auth = isAuthority();
    if(!auth && prefs.section!=='pad') prefs.section = 'pad';
    const body = !auth ? `<div class="muted sb-note">Звуки и музыку запускает Мастер — у вас они играют сами. Здесь — ваша громкость и заглушение.</div>`
      : prefs.section==='music' ? musicHtml() : prefs.section==='playlists' ? playlistsHtml() : prefs.section==='mine' ? mineHtml() : padHtml();
    const focusSearch = document.activeElement && document.activeElement.id==='sbSearch';
    root.innerHTML = `<div class="panel sb-panel">
      <div class="sb-head"><b class="sb-title">🎚 Саундпад</b>${auth ? `<div class="sb-sections">${SECTIONS.map(([k, l])=>`<button type="button" class="sb-sec${prefs.section===k?' on':''}" data-sec="${k}">${l}</button>`).join('')}</div>` : ''}</div>
      ${nowHtml()}${body}</div>`;
    if(focusSearch){ const s = $('sbSearch'); if(s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    renderProgress();
  }
  function renderNow(){ if(visible) render(); else { renderMini(); renderUnlock(); } }
  function renderRecentOnly(){ if(visible && prefs.section==='pad' && !search && prefs.cat==='all'){ const g = $('sbRecentGrid'); if(!g){ render(); return; } g.innerHTML = prefs.recent.slice(0, 8).map(soundById).filter(Boolean).map(padButton).join(''); } }
  let seeking = false;
  function renderProgress(){
    const it = cur().library[cur().music.itemId];
    const pos = musicReady ? musicEl.currentTime : expectedPos(), dur = musicDuration() || (it && it.duration) || 0;
    const a = $('sbTimeCur'), b = $('sbTimeDur'), r = $('sbSeek');
    if(a) a.textContent = fmtTime(pos);
    if(b) b.textContent = dur ? fmtTime(dur) : '—:—';
    if(r && !seeking){ r.max = String(Math.max(1, Math.round(dur))); r.value = String(Math.round(pos)); }
    const t = $('sbNowTitle'); if(t && cur().music.itemId){ const nt = nowTitle(); if(nt && t.textContent!==nt) t.textContent = nt; }
    renderMini();
  }
  function flashButton(id){
    document.querySelectorAll(`#soundTabView [data-play="${CSS.escape(id)}"]`).forEach(b=>{ b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); setTimeout(()=>b.classList.remove('hit'), 700); });
  }
  let toastTimer = null;
  function toast(text){ const el = $('sbToast'); if(!el) return; el.textContent = text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove('show'), 1600); }
  function renderMini(){
    const el = $('sbMini'); if(!el) return;
    const c = cur(), m = c.music, t = m.itemId ? nowTitle() : '';
    const show = !!t && !visible;
    el.style.display = show ? '' : 'none';
    if(show){ const txt = (m.playing ? '🎵 ' : '⏸ ') + t; if(el.textContent!==txt) el.textContent = txt; el.title = 'Открыть саундпад'; }
  }
  function renderUnlock(){
    const el = $('sbUnlock'); if(!el) return;
    const need = needsUnlock();
    el.style.display = need ? '' : 'none';
    el.textContent = musicNeedsGesture ? (isAuthority() ? '▶ Нажмите, чтобы продолжить музыку' : '🔊 Нажмите, чтобы включить звук') : '🔊 Включить звук';
  }
  /* ---------- события интерфейса (делегирование) ---------- */
  function onClick(e){
    const b = e.target.closest('button,[data-cat]'); if(!b || !b.closest('#soundTabView')) return;
    const d = b.dataset;
    if(d.play){ playSound(d.play); return; }
    if(d.fav){ if(prefs.favorites[d.fav]) delete prefs.favorites[d.fav]; else prefs.favorites[d.fav] = true; savePrefs(); render(); return; }
    if(d.cat){ prefs.cat = d.cat; search = ''; savePrefs(); render(); return; }
    if(d.sec){ prefs.section = d.sec; savePrefs(); render(); return; }
    if(d.mute){ prefs.mute[d.mute] = !prefs.mute[d.mute]; savePrefs(); applyVolumes(); render(); return; }
    if(d.cmd==='toggle') togglePlay(); else if(d.cmd==='next') nextTrack(); else if(d.cmd==='prev') prevTrack();
    else if(d.cmd==='stopall') stopAll();
    else if(d.cmd==='canceledit'){ editingSound = null; render(); }
    else if(d.playitem) playItem(d.playitem, null);
    else if(d.playpl) playPlaylist(d.playpl, 0);
    else if(d.playat){ const [p, i] = d.playat.split('|'); playPlaylist(p, +i); }
    else if(d.move){ const [p, i, dd] = d.move.split('|'); moveInPlaylist(p, +i, +dd); }
    else if(d.rmpl){ const [p, i] = d.rmpl.split('|'); removeFromPlaylist(p, +i); }
    else if(d.delpl) deletePlaylist(d.delpl);
    else if(d.delitem) deleteItem(d.delitem);
    else if(d.rename){ const it = state.library[d.rename]; if(it) uiPrompt('Название', it.title, {title:'Переименовать', ok:'Сохранить'}).then(t=>{ if(t && t.trim()){ it.title = str(t.trim(), 120); it.autoTitle = false; commit(); } }); }
    else if(d.editsound){ editingSound = d.editsound; render(); }
    else if(d.delsound) deleteCustomSound(d.delsound);
  }
  function onInput(e){
    const t = e.target; if(!t.closest('#soundTabView')) return;
    if(t.id==='sbSearch'){ search = t.value; const g = $('sbGrid'); if(g){ const list = visibleSounds(); g.innerHTML = list.length ? list.map(padButton).join('') : '<div class="muted">Ничего не найдено.</div>'; }
      document.querySelectorAll('#soundTabView .sb-cat').forEach(c=>c.classList.toggle('on', !search && c.dataset.cat===prefs.cat)); return; }
    if(t.dataset.vol){ prefs.vol[t.dataset.vol] = clamp(+t.value, 0, 100); const v = t.parentNode.querySelector('.sb-vol-val'); if(v) v.textContent = t.value + '%'; applyVolumes(); savePrefs(); return; }
    if(t.id==='sbSeek'){ seeking = true; const a = $('sbTimeCur'); if(a) a.textContent = fmtTime(+t.value); }
  }
  function onChange(e){
    const t = e.target; if(!t.closest('#soundTabView')) return;
    if(t.id==='sbSeek'){ seeking = false; seekTo(+t.value); return; }
    if(t.dataset.addto && t.value){ const p = state.playlists[t.value]; if(p && p.items.indexOf(t.dataset.addto)<0){ p.items.push(t.dataset.addto); commit(); } else t.value = ''; }
  }
  function onSubmit(e){
    const f = e.target; if(!f.closest('#soundTabView')) return;
    e.preventDefault();
    if(f.id==='sbAddMusic'){ addMusicFiles(f.querySelector('[name=files]').files, new FormData(f).get('pl'), f.querySelector('.sb-form-status')); }
    else if(f.id==='sbAddMusicUrl'){ const fd = new FormData(f); const err = addMusicUrl(fd.get('url'), fd.get('title'), ''); f.querySelector('.sb-form-status').textContent = err; if(!err) f.reset(); }
    else if(f.id==='sbAddPl'){ createPlaylist(new FormData(f).get('title')); }
    else if(f.id==='sbSoundForm') saveCustomSound(f);
  }
  function onKey(e){ // горячие клавиши: 1–9 — первые девять избранных; prefs.hotkeys — задел под назначаемые
    if(!visible || !isAuthority() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target; if(tg && (tg.tagName==='INPUT' || tg.tagName==='TEXTAREA' || tg.tagName==='SELECT' || tg.isContentEditable)) return;
    const mapped = prefs.hotkeys && prefs.hotkeys[e.key];
    const fav = allSounds().filter(s=>prefs.favorites[s.id]).slice(0, 9);
    const s = mapped ? soundById(mapped) : (/^[1-9]$/.test(e.key) ? fav[+e.key-1] : null);
    if(s){ e.preventDefault(); playSound(s.id); }
  }
  function setVisible(v){ visible = !!v; render(); }
  function init(){
    const root = $('soundTabView'); if(!root) return;
    root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('submit', onSubmit);
    window.addEventListener('keydown', onKey);
    const mini = $('sbMini'); if(mini) mini.addEventListener('click', ()=>toggleMainTab('sound'));
    const un = $('sbUnlock'); if(un) un.addEventListener('click', unlock);
    RoomTransport.onGameEvent((ev)=>{ if(ev && ev.type==='sb-sound' && session.role==='player' && ev.from===session.gmId) receiveSound(ev); });
    lastRole = session.role || null;
    syncAmbience(); followMusic(); render();
  }
  // Звук сцены (экран Мастера): что играет сейчас — и включить это одной командой
  function sceneSound(){
    const m = state.music;
    return {ambience:Object.keys(state.ambience || {}).filter(id=>state.sounds[id]), music:m && m.itemId && m.playing && state.library[m.itemId] ? {itemId:m.itemId, playlistId:m.playlistId || null} : null};
  }
  function applySceneSound(sc){
    if(!isAuthority() || !sc) return;
    state.ambience = {}; (sc.ambience || []).forEach(id=>{ if(state.sounds[id]) state.ambience[id] = Date.now(); });
    if(sc.music && state.library[sc.music.itemId]){ commit(); playItem(sc.music.itemId, sc.music.playlistId); }
    else { state.music = Object.assign(sanitizeMusic(null), {at:Date.now()}); commit(); }
  }
  return { init, setVisible, refreshRole, handleMessage, onPlayerHello, onGmHello, playSound, stopAll, sceneSound, applySceneSound,
           get state(){ return cur(); }, get stats(){ return Object.assign({audio: actx ? actx.state : 'none', music: musicSrc, musicTime: musicEl.currentTime, musicPaused: musicEl.paused, loops:Object.keys(activeLoops),
             loopTimes:Object.keys(activeLoops).reduce((o, id)=>{ if(activeLoops[id].el) o[id] = activeLoops[id].el.currentTime; return o; }, {})}, stats); } };
})();
try{ Soundboard.init(); }catch(e){ console.error('[Саундпад] не удалось запустить', e); }
