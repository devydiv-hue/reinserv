/* ======================================================================
   RoomTransport: голос/видео/данные между участниками сессии — WebRTC P2P
   (mesh: каждый с каждым напрямую, без сервера на пути медиа). Сигналинг
   ПОЛНОСТЬЮ переиспользует существующий WebSocket-релей сессии (sendMsg /
   handleIncomingMessage выше) — offer/answer/ice-candidate это просто ещё
   несколько типов сообщений с полем "to", сервер их пересылает точно так
   же, как roll/sheet-snapshot, никакой новой серверной логики не нужно.

   Комната — по обоюдному согласию: PeerConnection к конкретному участнику
   создаётся только когда ОБА нажали «Войти в комнату» (room-join), а не
   всем подряд автоматически при входе в сессию (сессия и её общий лог
   бросков продолжают работать без этого, как и раньше).

   Игровой слой не должен знать про RTCPeerConnection/RTCDataChannel — он
   работает только через RoomTransport.sendGameEvent()/onGameEvent(). Это
   задел на будущие игровые события (не только dice_roll). dice_roll при
   этом НЕ становится вторым логом: recordAndShareRoll() по-прежнему пишет
   в существующий session.log и рассылает через WS как раньше (это остаётся
   источником истины и работает без WebRTC вообще) — DataChannel лишь
   дополнительно дублирует то же событие с тем же id, если канал открыт;
   существующий дедуп по id (_rollLogSeenIds) гасит повтор сам, без правок.

   Согласование (offer/answer коллизии) — стандартный паттерн Perfect
   Negotiation: у каждой пары ровно один "вежливый" участник (сравнение
   двух id, симметрично для обеих сторон), он уступает при одновременном
   обмене офферами вместо конфликта.
   ====================================================================== */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Свой TURN (self-hosted coturn, на случай сетей, где прямой P2P невозможен) добавляется одной
  // записью ниже, без изменений остального кода:
  // { urls: 'turn:ВАШ-СЕРВЕР:3478', username: '...', credential: '...' },
];

const RoomTransport = (function(){
  const peers = new Map(); // peerId -> {pc, dc, polite, makingOffer, ignoreOffer, name}
  let joined = false;
  let localStream = null;
  let micWanted = false, camWanted = false;
  const gameEventHandlers = [];

  function available(){ return typeof RTCPeerConnection !== 'undefined'; }
  function isJoined(){ return joined; }
  function onGameEvent(fn){ gameEventHandlers.push(fn); }
  function fireGameEvent(ev){ gameEventHandlers.forEach(fn=>{ try{ fn(ev); }catch(e){ console.error(e); } }); }
  function sendGameEvent(ev){
    peers.forEach(p=>{ if(p.dc && p.dc.readyState==='open'){ try{ p.dc.send(JSON.stringify(ev)); }catch(e){} } });
  }
  // Оба участника пары сравнивают одну и ту же пару id и получают взаимно-противоположный результат —
  // ровно один "вежливый" на пару, без отдельного согласования кто есть кто.
  function politeWith(peerId){ return session.myId < peerId; }

  function ensureTile(peerId, name){
    let tile = document.getElementById('roomTile_'+peerId);
    if(tile) return tile;
    tile = document.createElement('div');
    tile.className = 'room-tile no-video';
    tile.id = 'roomTile_'+peerId;
    tile.innerHTML = '<video autoplay playsinline' + (peerId===session.myId?' muted':'') + '></video>' +
      '<div class="tile-label"><span class="tname">'+escapeHtml(name||'…')+'</span><span class="tile-state"></span></div>';
    document.getElementById('roomTiles').appendChild(tile);
    return tile;
  }
  function removeTile(peerId){ const t = document.getElementById('roomTile_'+peerId); if(t) t.remove(); }
  function setTileState(peerId, text){
    const t = document.getElementById('roomTile_'+peerId);
    if(t) t.querySelector('.tile-state').textContent = text;
  }

  function wireDataChannel(p, dc){
    p.dc = dc;
    dc.onmessage = (ev)=>{
      let msg; try{ msg = JSON.parse(ev.data); }catch(e){ return; }
      if(!msg || typeof msg!=='object' || Array.isArray(msg)) return;
      if(msg.type==='dice_roll'){
        const entry = sanitizeRollEntry(msg.entry); // см. sanitizeRollEntry — чужие записи только через неё
        if(!entry) return;
        const isNew = addRollLogEntry(entry); // тот же общий лог, не второй
        console.log('[Бросок] получен по DataChannel', entry.id, 'от', p.name, isNew ? '— добавлен' : '— дубликат, уже был (это нормально: доставка через WS тоже могла дойти)');
        return;
      }
      msg.from = p.id; // отправитель — по самому каналу, не по тексту сообщения (как server.js ставит from для WS)
      fireGameEvent(msg);
    };
    dc.onerror = (e)=>console.error('[Комната] Ошибка DataChannel', e);
  }

  function ensurePeer(peerId, name){
    let p = peers.get(peerId);
    if(p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    p = { id: peerId, pc, dc:null, polite: politeWith(peerId), makingOffer:false, ignoreOffer:false, name: name||peerId };
    peers.set(peerId, p);
    ensureTile(peerId, p.name);
    setTileState(peerId, 'Подключение…');
    RoomFocusMode.refresh();

    if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));

    pc.onnegotiationneeded = async ()=>{
      try{
        p.makingOffer = true;
        await pc.setLocalDescription();
        sendMsg({type:'offer', payload: pc.localDescription}, peerId);
        console.log('[Комната] отправлен offer для '+(p.name||peerId)+' (треков в описании: '+pc.getSenders().length+')');
      }catch(e){ console.error('[Комната] Ошибка при согласовании (offer)', e); }
      finally{ p.makingOffer = false; }
    };
    pc.onicecandidate = (ev)=>{ if(ev.candidate) sendMsg({type:'ice-candidate', payload: ev.candidate}, peerId); };
    pc.ontrack = (ev)=>{
      const tile = ensureTile(peerId, p.name);
      const videoEl = tile.querySelector('video');
      // ev.streams[0] бывает пустым при повторном согласовании — например, когда камеру включили
      // уже ПОСЛЕ того, как звонок шёл только по звуку. В этом случае нельзя просто взять
      // ev.streams[0] (undefined затёр бы уже работающий srcObject и оборвал бы даже звук) — либо
      // берём готовый поток из события, либо докидываем трек в уже прикреплённый поток.
      let stream = ev.streams && ev.streams[0];
      if(!stream){
        stream = (videoEl.srcObject instanceof MediaStream) ? videoEl.srcObject : new MediaStream();
        if(!stream.getTracks().includes(ev.track)) stream.addTrack(ev.track);
      }
      if(videoEl.srcObject !== stream) videoEl.srcObject = stream;
      // autoplay для НЕ замьюченного (чужого) видео браузер иногда блокирует, пока нет истории
      // взаимодействия со страницей — в этом приложении она всегда есть (клик "Войти в комнату"),
      // но на случай, если политика браузера строже, явный play() + лог делают проблему видимой
      // вместо тихо замершего чёрного кадра, который выглядит как «видео не пришло».
      videoEl.play().catch(err=>console.warn('[Комната] автовоспроизведение видео заблокировано браузером ('+peerId+'):', err && err.name || err));
      // .enabled на ПРИЁМНОЙ стороне не отражает состояние камеры отправителя (это независимый,
      // локальный для получателя флаг) — правильный сигнал «отправитель выключил камеру» это
      // track.muted + события onmute/onunmute.
      ev.track.onmute = ()=>{ if(ev.track.kind==='video') tile.classList.add('no-video'); };
      ev.track.onunmute = ()=>{ if(ev.track.kind==='video') tile.classList.remove('no-video'); };
      const hasVideo = stream.getVideoTracks().some(t=>!t.muted);
      tile.classList.toggle('no-video', !hasVideo);
      console.log('[Комната] получен', ev.track.kind, 'от', p.name||peerId, '(muted='+ev.track.muted+')');
    };
    pc.onconnectionstatechange = ()=>{
      setTileState(peerId, ({connecting:'Подключение…', connected:'Подключено', disconnected:'Обрыв…',
        failed:'Не удалось', closed:'Закрыто'})[pc.connectionState] || '');
      if(pc.connectionState==='failed'){ try{ pc.restartIce(); }catch(e){} }
    };
    pc.ondatachannel = (ev)=>{ wireDataChannel(p, ev.channel); };
    if(session.myId > peerId){ wireDataChannel(p, pc.createDataChannel('game')); } // ровно одна сторона создаёт канал

    return p;
  }

  function teardownPeer(peerId){
    const p = peers.get(peerId);
    if(!p) return;
    // Закрываем сами и намеренно — onerror канала на это («User-Initiated Abort, Close called») не ошибка
    try{ if(p.dc){ p.dc.onerror = null; p.dc.close(); } }catch(e){}
    try{ p.pc.close(); }catch(e){}
    peers.delete(peerId);
    removeTile(peerId);
    RoomFocusMode.refresh();
  }

  // Вызывается после переподключения WebSocket сигналинга (см. connectSession/'welcome' обработчик) —
  // ТОЛЬКО досогласовывает уже существующие соединения, не трогает те, что и так 'connected' (нет
  // смысла дёргать рабочую связь). pc.restartIce() сам запустит onnegotiationneeded → новый offer —
  // раньше именно такой offer (или ICE-кандидат) мог потеряться, если родился ровно в момент, когда WS
  // уже упал (sendMsg молча ничего не делает без открытого сокета, см. её же комментарий) — без явного
  // толчка соединение так и осталось бы недосогласованным даже после того, как WS восстановился, потому
  // что новых событий negotiationneeded само по себе больше не будет.
  function resyncAfterReconnect(){
    peers.forEach(p=>{
      if(p.pc.connectionState!=='connected'){
        try{ p.pc.restartIce(); }catch(e){}
      }
    });
  }

  async function handleSignal(msg){
    const peerId = msg.from;
    if(!peerId || peerId===session.myId) return;
    if(msg.type==='room-join'){
      if(!joined) return; // мы сами ещё не в комнате — не откликаемся на чужое приглашение
      if(msg.reply){ ensurePeer(peerId, msg.name); return; } // ответ на НАШ вход — соединение с этой стороны просто создаём, без встречного ответа
      // Первичный вход (кнопка «Войти в комнату») всегда значит, что у того участника соединений ещё нет —
      // в том числе после перезагрузки страницы тем же постоянным id. Старое соединение с ним к этому
      // моменту мёртвое (другой DTLS-сертификат, его сторона ничего о нём не знает), и раньше оно здесь
      // переиспользовалось без ответа — голос между ними не восстанавливался, пока кто-то не перезайдёт.
      if(peers.has(peerId)) teardownPeer(peerId);
      ensurePeer(peerId, msg.name);
      sendMsg({type:'room-join', name: session.ownName, reply:true}, peerId); // симметричный ответ — см. комментарий у joinRoom()
      return;
    }
    if(msg.type==='room-leave'){ teardownPeer(peerId); return; }
    const p = peers.get(peerId);
    if(!p) return; // сигналинг от того, с кем мы (уже/ещё) не в комнате — не наш случай, игнорируем
    const pc = p.pc;
    try{
      if(msg.type==='offer' || msg.type==='answer'){
        const desc = msg.payload;
        if(!desc || (desc.type!=='offer' && desc.type!=='answer')) return;
        // isSettingRemoteAnswerPending — часть канонического Perfect Negotiation: пока применяется
        // пришедший answer, signalingState ещё не 'stable', и без этого флага встречный offer в это узкое
        // окно (например, двое одновременно включают камеру) ошибочно считался коллизией — невежливая
        // сторона его отбрасывала, и досогласование соединения застревало.
        const readyForOffer = !p.makingOffer && (pc.signalingState==='stable' || p.isSettingRemoteAnswerPending);
        const offerCollision = desc.type==='offer' && !readyForOffer;
        p.ignoreOffer = !p.polite && offerCollision;
        if(p.ignoreOffer) return;
        p.isSettingRemoteAnswerPending = desc.type==='answer';
        try{
          if(offerCollision) await Promise.all([pc.setLocalDescription({type:'rollback'}), pc.setRemoteDescription(desc)]);
          else await pc.setRemoteDescription(desc);
        } finally { p.isSettingRemoteAnswerPending = false; }
        if(desc.type==='offer'){ await pc.setLocalDescription(); sendMsg({type:'answer', payload: pc.localDescription}, peerId); }
      } else if(msg.type==='ice-candidate'){
        try{ await pc.addIceCandidate(msg.payload); }
        catch(e){ if(!p.ignoreOffer) console.error('[Комната] Ошибка ICE-кандидата', e); }
      }
    }catch(e){ console.error('[Комната] Ошибка согласования соединения', e); }
  }

  async function acquireLocalTrack(kind){
    try{
      const newStream = await navigator.mediaDevices.getUserMedia(kind==='audio' ? {audio:true} : {video:true});
      if(!localStream) localStream = new MediaStream();
      console.log('[Комната] локальный '+kind+' получен, рассылаем '+peers.size+' участникам');
      newStream.getTracks().forEach(t=>{
        localStream.addTrack(t);
        peers.forEach(p=>p.pc.addTrack(t, localStream)); // триггерит onnegotiationneeded на уже открытых соединениях
      });
      document.getElementById('roomHint').textContent = '';
      return true;
    }catch(e){
      console.error('[Комната] Не удалось получить доступ к устройству', e);
      document.getElementById('roomHint').textContent =
        (kind==='audio'?'Микрофон':'Камера') + ': доступ не получен (' + (e.message||e.name) + ').';
      return false;
    }
  }
  function updateLocalTile(){
    const tile = ensureTile(session.myId, (session.ownName||'Вы') + ' (вы)');
    tile.classList.add('local');
    const videoEl = tile.querySelector('video');
    if(localStream && videoEl.srcObject!==localStream) videoEl.srcObject = localStream;
    const camOn = !!(localStream && localStream.getVideoTracks().some(t=>t.enabled));
    tile.classList.toggle('no-video', !camOn);
    document.getElementById('btnRoomMic').classList.toggle('active', micWanted);
    document.getElementById('btnRoomCam').classList.toggle('active', camWanted);
  }
  // Флаг "включено" выставляется только при реальном успехе getUserMedia — иначе после отказа в
  // доступе кнопка осталась бы выглядеть нажатой, хотя ни трека, ни разрешения на самом деле нет.
  async function setMic(on){
    if(on && !(localStream && localStream.getAudioTracks().length)){
      if(!(await acquireLocalTrack('audio'))){ updateLocalTile(); return; }
    }
    micWanted = on;
    if(localStream) localStream.getAudioTracks().forEach(t=>t.enabled = on);
    updateLocalTile();
  }
  async function setCam(on){
    if(on && !(localStream && localStream.getVideoTracks().length)){
      if(!(await acquireLocalTrack('video'))){ updateLocalTile(); return; }
    }
    camWanted = on;
    if(localStream) localStream.getVideoTracks().forEach(t=>t.enabled = on);
    updateLocalTile();
  }

  async function joinRoom(){
    if(!available()){
      document.getElementById('roomHint').textContent = 'Этот браузер не поддерживает WebRTC — голос/видео недоступны, лог бросков и правки листа продолжают работать как обычно.';
      return;
    }
    joined = true;
    document.getElementById('btnRoomJoin').style.display = 'none';
    document.getElementById('btnRoomMic').style.display = '';
    document.getElementById('btnRoomCam').style.display = '';
    document.getElementById('btnRoomLeave').style.display = '';
    document.getElementById('btnRoomPin').style.display = '';
    document.getElementById('roomFocusHotkeyHint').style.display = '';
    document.getElementById('roomHint').textContent = '';
    updateLocalTile();
    sendMsg({type:'room-join', name: session.ownName}); // broadcast — все, кто уже в комнате, откликнутся сами (см. handleSignal)
    RoomFocusMode.refresh();
  }
  function leaveRoom(){
    if(!joined) return;
    sendMsg({type:'room-leave'});
    Array.from(peers.keys()).forEach(teardownPeer);
    if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream = null; }
    micWanted = false; camWanted = false;
    joined = false;
    removeTile(session.myId);
    document.getElementById('btnRoomJoin').style.display = '';
    document.getElementById('btnRoomMic').style.display = 'none';
    document.getElementById('btnRoomCam').style.display = 'none';
    document.getElementById('btnRoomLeave').style.display = 'none';
    document.getElementById('btnRoomPin').style.display = 'none';
    document.getElementById('roomFocusHotkeyHint').style.display = 'none';
    document.getElementById('roomHint').textContent = '';
    RoomFocusMode.refresh();
  }

  return { available, isJoined, joinRoom, leaveRoom, setMic, setCam, handleSignal, teardownPeer,
           resyncAfterReconnect, sendGameEvent, onGameEvent,
           get micWanted(){return micWanted;}, get camWanted(){return camWanted;} };
})();

/* ======================================================================
   RoomFocusMode: куда физически показывать видео-плитки (свою и чужие — как только в комнате есть
   хоть один собеседник, своя плитка переезжает вместе со всеми, а не остаётся мелкой в панели), в
   зависимости от того, занят ли человек листом персонажа прямо сейчас:
     - 8 секунд совсем без активности (мышь не двигалась, клавиши не нажимались, поле листа не в
       фокусе, бросок/выбор категории не открыт) — крупной плиткой во весь экран (#roomFocusOverlay);
     - как только человек снова начал что-то делать — плитки «уплывают» в пустое поле сбоку от
       листа (#roomSidebar, миниатюризируются/скроллится, если игроков много) — на узких экранах,
       где сбоку места нет, остаются прямо в панели сессии (#roomTiles), как было и до этой доработки.
     - либо в любой момент вручную, по клавише Q (физическое положение клавиши — сработает и как
       "Й" на русской раскладке, и как аналог Q на любой другой; сравнение идёт по event.code, а не
       по напечатанному символу) — включает/выключает полноэкранный режим сразу, не дожидаясь 8с
       простоя, и держится, пока не нажать Q ещё раз (не сбрасывается движением мыши — это осознанно,
       иначе смысла в ручном вызове почти не было бы).
   Тайлы физически ПЕРЕМЕЩАЮТСЯ между тремя контейнерами (не клонируются) — у <video> при этом не
   прерывается воспроизведение потока, это просто перестановка того же узла в DOM.
   ====================================================================== */
const RoomFocusMode = (function(){
  const IDLE_MS = 8000;
  let idle = false;
  let forced = false; // ручной override по клавише Q — см. toggleForced()
  // Булавка: камеры закреплены сбоку (#roomSidebar) и не уходят на весь экран при простое — только по Q
  // вручную. Запоминается между перезагрузками.
  const PIN_KEY = 'reincarnator_room_pinned_v1';
  let pinned = (function(){ try{ return localStorage.getItem(PIN_KEY)==='1'; }catch(e){ return false; } })();
  let sidebarPinBtn = null;
  let lastActivityAt = Date.now();
  const wideQuery = window.matchMedia('(min-width: 1660px)'); // должно совпадать с медиа-запросом .room-sidebar в <style>

  function noteActivity(){ lastActivityAt = Date.now(); }
  ['mousemove','mousedown','keydown','wheel','touchstart','touchmove']
    .forEach(evt => window.addEventListener(evt, noteActivity, {passive:true}));

  function isEditableFocused(){
    const el = document.activeElement;
    // offsetParent — грубая, но дешёвая проверка «элемент реально виден на экране» (у display:none
    // и у отсоединённых от DOM узлов offsetParent === null) — иначе фокус, оставшийся на скрытом
    // после ре-рендера поле, мог бы бесконечно блокировать полноэкранный режим.
    return !!(el && el!==document.body && el.offsetParent!==null &&
      el.matches('input, textarea, select, [contenteditable="true"]'));
  }
  // «Залип над выбором из вариантов» — основной бросок (openRollPicker) и генератор категории
  // (openCatalogPicker) оба держат текущий оверлей в общей переменной _rollOverlayEl, пока он открыт.
  function idleBlockReason(){
    if(isEditableFocused()){
      const el = document.activeElement;
      return 'в фокусе поле листа (' + el.tagName.toLowerCase() + (el.id?'#'+el.id:'') + ')';
    }
    if(typeof _rollOverlayEl !== 'undefined' && _rollOverlayEl) return 'открыт бросок/выбор категории';
    const left = IDLE_MS - (Date.now() - lastActivityAt);
    if(left > 0) return 'была активность ' + Math.round((Date.now()-lastActivityAt)/1000) + 'с назад (ждём ещё ' + Math.ceil(left/1000) + 'с)';
    return null; // ничего не блокирует — пора переключаться в полноэкранный режим
  }
  function computeIdle(){ return idleBlockReason()===null; }

  function remoteTiles(){
    return Array.from(document.querySelectorAll('.room-tile:not(.local)'));
  }
  // В отличие от remoteTiles() — используется там, где решается, ЧТО показывать/куда переставлять
  // (полноэкранный режим/сайдбар должны включать и собственную плитку тоже, не только чужие:
  // пользователь явно попросил видеть и свой поток настолько крупно, насколько есть место, а не
  // только уменьшенную миниатюру в панели). remoteTiles() отдельно остаётся — им по-прежнему
  // решается, есть ли вообще смысл включать полноэкранный режим (в одиночестве в комнате — незачем).
  function allRoomTiles(){
    return Array.from(document.querySelectorAll('.room-tile'));
  }
  function targetContainer(){
    // Закреплено булавкой — всегда сбоку (и своя плитка, даже пока в комнате никого больше нет: закрепил —
    // значит хочет видеть камеры на любой вкладке, а панель сессии на вкладке стола не видна). Весь экран —
    // только по ручному Q (forced), не по простою.
    if(pinned && RoomTransport.isJoined()){
      return (forced && remoteTiles().length>0) ? document.getElementById('roomFocusOverlay') : document.getElementById('roomSidebar');
    }
    // Одни в комнате (ещё никто не подключился) — переставлять некого ради кого, своя плитка
    // остаётся на обычном месте в панели, как и до входа в комнату.
    if(remoteTiles().length===0) return document.getElementById('roomTiles');
    if(idle) return document.getElementById('roomFocusOverlay');
    if(wideQuery.matches) return document.getElementById('roomSidebar');
    return document.getElementById('roomTiles');
  }

  // Считает cols/rows и итоговый размер плитки, при котором N плиток фиксированной пропорции AR
  // занимают максимум площади прямоугольника WxH, не выходя за его пределы и не теряя ни одной —
  // классическая задача раскладки видео-сетки (тот же подход, что у Zoom/Meet): перебираем все
  // варианты числа колонок, для каждого считаем реальный размер плитки (упёршись либо в ширину
  // колонки, либо в высоту ряда — что раньше даёт превышение при данной AR) и берём вариант
  // с наибольшей площадью плитки.
  const FOCUS_TILE_AR = 16/9; // типичная пропорция веб-камеры; сама картинка обрезается по центру (object-fit:cover), не растягивается
  const FOCUS_MIN_TILE_W = 90; // ниже этого плитки нечитаемы — переключаемся на прокрутку вместо дальнейшего сжатия (см. layoutFocusGrid)
  function computeGrid(n, W, H, ar, gap){
    let best = null;
    for(let cols=1; cols<=n; cols++){
      const rows = Math.ceil(n/cols);
      const cellW = (W-(cols-1)*gap)/cols, cellH = (H-(rows-1)*gap)/rows;
      if(cellW<=0 || cellH<=0) continue;
      const tileW = (cellW/cellH>ar) ? cellH*ar : cellW;
      const tileH = tileW/ar;
      const area = tileW*tileH;
      if(!best || area>best.area) best = {cols, rows, tileW, tileH, area};
    }
    return best || {cols:1, rows:n, tileW:W, tileH:W/ar};
  }
  function layoutFocusGrid(tiles){
    const overlay = document.getElementById('roomFocusOverlay');
    const pad = 16, gap = 12;
    // SAFETY — расчёт ниже иначе может дать сетку, ровно впритык равную доступной высоте (например
    // 4 ряда × 143px + зазоры = ровно H, без единого пикселя запаса); любая суб-пиксельная разница
    // в реальном рендере тогда включает overflow-y:auto и обрезает последний ряд прокруткой — что
    // и увидели при живом тесте на 7 участниках. Запас с обеих сторон устраняет это структурно,
    // а не подгонкой под конкретный случай.
    const SAFETY = 10;
    const W = Math.max(1, window.innerWidth - pad*2 - SAFETY), H = Math.max(1, window.innerHeight - pad*2 - SAFETY);
    let g = computeGrid(tiles.length, W, H, FOCUS_TILE_AR, gap);
    // Плитки упёрлись в минимальный читаемый размер — дальше сжимать некуда, отдаём излишек
    // прокрутке контейнера (overflow-y:auto уже есть), а не рисуем нечитаемые миниатюры.
    if(g.tileW < FOCUS_MIN_TILE_W){
      g = computeGrid(tiles.length, W, Infinity, FOCUS_TILE_AR, gap);
      g.tileW = Math.max(g.tileW, FOCUS_MIN_TILE_W);
      g.tileH = g.tileW/FOCUS_TILE_AR;
    }
    const w = Math.floor(g.tileW)+'px', h = Math.floor(g.tileH)+'px';
    tiles.forEach(t=>{ t.style.width = w; t.style.height = h; });
  }
  // Сайдбар — одна колонка фиксированной ширины: если N плиток в полный рост (по ширине колонки,
  // с сохранением AR) не помещаются по высоте — миниатюризируем (уменьшаем и высоту, и ширину,
  // сохраняя пропорцию) так, чтобы все поместились без прокрутки; уже упёрлись в читаемый минимум —
  // отдаём остаток overflow-y:auto (он уже есть на .room-sidebar), а не сжимаем до нечитаемого.
  function layoutSidebar(tiles){
    const sidebar = document.getElementById('roomSidebar');
    const n = tiles.length;
    if(n===0) return;
    const gap = 10; // должно совпадать с gap в CSS .room-sidebar
    const pinH = sidebarPinBtn && sidebarPinBtn.offsetParent ? sidebarPinBtn.offsetHeight + gap : 0; // кнопка-булавка сверху колонки
    const availH = Math.max(1, sidebar.clientHeight-4-pinH), fullW = Math.max(1, sidebar.clientWidth-4);
    const naturalH = fullW/FOCUS_TILE_AR;
    let tileW = fullW, tileH = naturalH;
    if(n*naturalH + (n-1)*gap > availH){
      tileH = Math.max(1, (availH-(n-1)*gap)/n);
      tileW = tileH*FOCUS_TILE_AR;
      if(tileW < FOCUS_MIN_TILE_W){ tileW = FOCUS_MIN_TILE_W; tileH = tileW/FOCUS_TILE_AR; }
    }
    const w = Math.floor(tileW)+'px', h = Math.floor(tileH)+'px';
    tiles.forEach(t=>{ t.style.width = w; t.style.height = h; });
  }
  // Узкий экран без сайдбара и без простоя — плитки живут прямо в панели сессии: сбрасываем инлайн-
  // размер, оставшийся от сайдбара/полноэкранного режима, чтобы снова сработал обычный CSS-размер
  // из .room-tile (иначе плитка "застряла" бы в последнем посчитанном JS размере навсегда).
  function resetInlineSize(tiles){ tiles.forEach(t=>{ t.style.width=''; t.style.height=''; }); }
  // FLIP: запоминаем позицию плитки ДО переноса в новый контейнер (и ДО возможного изменения
  // размера сеткой), затем компенсируем скачок обратным transform и анимируем его в ноль — снаружи
  // это выглядит как плавный переезд, а не телепортация, хотя на самом деле узел просто переставлен
  // в другое место DOM и/или изменил размер.
  function apply(){
    const target = targetContainer();
    const tiles = allRoomTiles(); // своя плитка тоже участвует в раскладке — переезжает и меняет размер вместе с чужими
    // Сброс возможного «зависшего» transform от прерванной предыдущей FLIP-анимации — ДО любых
    // измерений getBoundingClientRect(). Если apply() вызывается повторно (новый участник, ресайз
    // окна, смена активности), пока предыдущая анимация ещё доигрывает, transform ещё не пуст — и
    // тогда следующее измерение "before"/"after" получает визуально искажённые transform'ом
    // координаты вместо истинного CSS-размера, а вычисленный на их основе новый transform содержит
    // эту ошибку и добавляет свою — при частых подряд изменениях так можно было залипнуть с диким
    // масштабом (например transform: scale(3.5)) навсегда, потому что сбрасывать его уже некому:
    // тайл, переставший "переезжать" между контейнерами, больше не попадает в код ниже вообще.
    tiles.forEach(t=>{ if(t.style.transform){ t.style.transition = 'none'; t.style.transform = ''; } });
    const moving = tiles.filter(t=>t.parentElement!==target);
    const firstRects = new Map(moving.map(t=>[t, t.getBoundingClientRect()]));
    moving.forEach(t=>target.appendChild(t));
    const showFocus = idle && remoteTiles().length>0; // полноэкранный режим по-прежнему имеет смысл только если в комнате есть кто-то ещё
    document.getElementById('roomFocusOverlay').classList.toggle('show', showFocus);
    if(showFocus) layoutFocusGrid(tiles);
    else if(target===document.getElementById('roomSidebar')) layoutSidebar(tiles);
    else resetInlineSize(tiles);
    moving.forEach(t=>{
      const first = firstRects.get(t);
      if(!first || !first.width) return; // тайл только что создан/раньше нигде не отображался — анимировать нечего
      const last = t.getBoundingClientRect(); // transform уже гарантированно пуст (сброшен выше) — это истинный размер после раскладки
      if(!last.width) return;
      const dx = first.left - last.left, dy = first.top - last.top;
      const sx = first.width/last.width, sy = first.height/last.height;
      t.style.transformOrigin = 'top left';
      t.style.transform = `translate(${dx}px,${dy}px) scale(${sx},${sy})`;
      requestAnimationFrame(()=>{
        t.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
        t.style.transform = '';
      });
      t.addEventListener('transitionend', ()=>{ t.style.transition=''; }, {once:true});
    });
  }
  function syncPinUi(){
    const joined = RoomTransport.isJoined();
    document.body.classList.toggle('room-pinned', pinned && joined);
    const title = pinned ? 'Открепить камеры (снова будут уходить на весь экран при простое)' : 'Закрепить камеры сбоку';
    [document.getElementById('btnRoomPin'), sidebarPinBtn].forEach(b=>{
      if(!b) return;
      b.classList.toggle('active', pinned);
      b.title = title;
    });
    if(sidebarPinBtn) sidebarPinBtn.style.display = joined ? '' : 'none';
  }
  function togglePinned(){
    pinned = !pinned;
    try{ localStorage.setItem(PIN_KEY, pinned ? '1' : '0'); }catch(e){}
    if(pinned){ idle = false; forced = false; } // закрепили — сразу сбоку, даже если сейчас был весь экран
    console.log('[Комната] камеры ' + (pinned ? 'закреплены сбоку' : 'откреплены'));
    refresh();
  }
  function tick(){
    syncPinUi();
    if(pinned && RoomTransport.isJoined()){
      // Закреплено: простой не разворачивает на весь экран; раскладку держим и в одиночестве (своя плитка сбоку)
      idle = forced && remoteTiles().length>0;
      apply();
      return;
    }
    if(!RoomTransport.isJoined() || remoteTiles().length===0){
      if(idle || forced){ idle = false; forced = false; apply(); } // некого показывать — сбрасываем и ручной override тоже
      else if(document.getElementById('roomSidebar').querySelector('.room-tile')) apply(); // только что открепили в одиночестве — вернуть плитку из колонки в панель
      return;
    }
    const next = forced || computeIdle();
    if(next !== idle){
      idle = next;
      console.log('[Комната] ' + (idle ? 'простой 8с — переключаемся на весь экран' : 'снова активны — плитки уходят с весь-экрана'));
    }
    apply();
  }
  function refresh(){ tick(); }
  // Ручной вызов полноэкранного режима по клавише Q — см. keydown-обработчик ниже. Не завязан на
  // computeIdle()/lastActivityAt вообще: пока forced=true, tick() всегда показывает полный экран,
  // независимо от активности мыши/клавиатуры, пока не нажать Q ещё раз.
  function toggleForced(){
    if(isEditableFocused()) return; // не мешаем печатать "q"/"й" в поле листа
    if(!RoomTransport.isJoined() || remoteTiles().length===0){
      console.log('[Комната] Q проигнорирован — не в комнате или собеседников ещё нет');
      return;
    }
    forced = !forced;
    console.log('[Комната] полноэкранный режим ' + (forced ? 'включён вручную (Q)' : 'выключен вручную (Q)'));
    if(forced) closeRerollPopup(); // Q → полноэкранные камеры — один из двух способов убрать всплывающую кнопку переброса (см. showRerollPopup)
    refresh();
  }
  window.addEventListener('keydown', (e)=>{
    if(e.code==='KeyQ' && !e.ctrlKey && !e.altKey && !e.metaKey) toggleForced();
  });
  // Диагностика на случай, если где-то в реальном браузере полноэкранный режим всё-таки не
  // включается — вызвать RoomFocusMode.debug() в консоли (F12) и посмотреть, что именно блокирует.
  function debug(){
    return {
      joined: RoomTransport.isJoined(),
      remoteTiles: remoteTiles().length,
      idle, forced,
      blockedBy: idleBlockReason(),
      wideLayout: wideQuery.matches,
      msSinceActivity: Date.now() - lastActivityAt
    };
  }

  if(wideQuery.addEventListener) wideQuery.addEventListener('change', refresh);
  else if(wideQuery.addListener) wideQuery.addListener(refresh); // старые браузеры без addEventListener на MediaQueryList
  window.addEventListener('resize', refresh); // пересчитать сетку полноэкранного режима сразу при смене размера окна, не ждать до 500мс
  // Булавка ещё и сверху самой колонки — чтобы открепить можно было с любой вкладки (на вкладке стола
  // панели сессии с основной кнопкой не видно). Не .room-tile — в раскладку плиток не попадает.
  (function initSidebarPin(){
    const sidebar = document.getElementById('roomSidebar');
    if(!sidebar) return;
    sidebarPinBtn = document.createElement('button');
    sidebarPinBtn.type = 'button';
    sidebarPinBtn.className = 'small room-pin-btn';
    sidebarPinBtn.textContent = '📌';
    sidebarPinBtn.style.display = 'none';
    sidebarPinBtn.addEventListener('click', togglePinned);
    sidebar.insertBefore(sidebarPinBtn, sidebar.firstChild);
  })();
  setInterval(tick, 500);

  return { refresh, debug, togglePinned, get pinned(){ return pinned; } };
})();

