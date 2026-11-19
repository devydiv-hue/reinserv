/* ======================================================================
   КАВАЛЕРИЯ — СТОЛ. Ссылка стола — /kava/КОД; сервер держит столы Кавалерии отдельно (sys=kava). Летописец создаёт
   стол (ключ Мастера — в этом браузере, reincarnator_kava_gm_keys_v1), игроки входят по ссылке. Сессия
   переживает перезагрузку (reincarnator_kava_session_v1). Сообщения (сервер ставит from):
     hello {name, tandem}        — игрок пришёл (всем); Летописец отвечает ему gm-hello
     gm-hello {name, telemost, lance} — Летописец (сервер пропускает только от подтверждённого Мастера)
     tandem {pilot}              — лист игрока Летописцу (при изменениях, не чаще раза в 1,5 с)
     roll {entry}                — бросок всем (тайные броски Летописца не рассылаются)
     request {rid, kind, stat, dc, mode, note} — Летописец просит бросок; mods {mode} — преимущество/препятствие
     hurt {side, amount, pierce} — Летописец наносит урон; telemost {url}; lance {state} — Копьё
   Команды Летописца принимаются только от того, кто прислал gm-hello. Связь проверяется сигналом hb раз в 20 с.
   ====================================================================== */
const Table = (function(){
  const SKEY = 'reincarnator_kava_session_v1', GKEY = 'reincarnator_kava_gm_keys_v1';
  const S = {code:'', role:null, ws:null, myId:'', gmId:'', gmName:'', peers:{}, telemost:'', lance:null, status:'off'};
  const listeners = [];
  let retry = 2000, retryTimer = 0, hbTimer = 0, pushTimer = 0, hbMiss = 0;
  const codeFromUrl = ()=>{ const m = location.pathname.match(/^\/kava\/([a-z0-9]{4,16})\/?$/); return m ? m[1] : ''; };
  S.code = codeFromUrl();
  function cid(role){
    let id = ''; try{ id = localStorage.getItem('reincarnator_client_id') || ''; }catch(e){}
    if(!/^[a-zA-Z0-9_-]{8,64}$/.test(id)){ id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); try{ localStorage.setItem('reincarnator_client_id', id); }catch(e){} }
    return role==='gm' ? id + '-gm' : id;
  }
  function gmKey(code){
    let keys = {}; try{ keys = JSON.parse(localStorage.getItem(GKEY) || '{}') || {}; }catch(e){}
    if(!/^[a-zA-Z0-9]{16,64}$/.test(keys[code] || '')){ keys[code] = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32).padEnd(16, '0'); try{ localStorage.setItem(GKEY, JSON.stringify(keys)); }catch(e){} }
    return keys[code];
  }
  const ownsTable = (code)=>{ try{ return !!(JSON.parse(localStorage.getItem(GKEY) || '{}') || {})[code]; }catch(e){ return false; } };
  function newCode(){ const abc = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(6)); return Array.from(r, x=>abc[x % abc.length]).join(''); }
  const link = ()=>location.origin + '/kava/' + S.code;
  const emit = ()=>listeners.forEach(f=>{ try{ f(S); }catch(e){ console.error(e); } });
  const onChange = (f)=>listeners.push(f);
  const me = ()=>Tandem.pilot;
  const myName = ()=>{ const p = me(); return S.role==='gm' ? (App.pref('gmName') || 'Летописец') : (p && p.name) || 'Спектр'; };
  function send(msg, to){ if(S.ws && S.ws.readyState===1){ if(to) msg.to = to; try{ S.ws.send(JSON.stringify(msg)); }catch(e){} } }

  function connect(role){
    if(!S.code) return;
    clearTimeout(retryTimer); stopHb();
    if(S.ws){ try{ S.ws.onclose = null; S.ws.close(); }catch(e){} }
    S.role = role; S.status = 'connecting'; emit();
    try{ localStorage.setItem(SKEY, JSON.stringify({code:S.code, role})); }catch(e){}
    const url = (location.protocol==='https:' ? 'wss://' : 'ws://') + location.host + '/?cid=' + encodeURIComponent(cid(role)) + '&sys=kava&room=' + S.code + (role==='gm' ? '&gmkey=' + gmKey(S.code) : '');
    let ws; try{ ws = new WebSocket(url); }catch(e){ S.status = 'off'; emit(); return; }
    S.ws = ws;
    ws.onmessage = (ev)=>{ let m; try{ m = JSON.parse(ev.data); }catch(e){ return; } if(m && typeof m==='object') onMsg(m); };
    ws.onclose = ()=>{
      stopHb();
      if(S.ws!==ws) return;
      if(ws._denied){ S.role = null; S.status = 'denied'; emit(); UI.toast('У этого стола уже есть Летописец в другом браузере', 'fail'); return; }
      if(!S.role){ S.status = 'off'; emit(); return; }
      S.status = 'reconnecting'; emit();
      retryTimer = setTimeout(()=>connect(S.role), retry); retry = Math.min(retry * 1.5, 10000);
    };
  }
  function leave(){
    S.role = null; clearTimeout(retryTimer); stopHb();
    if(S.ws){ try{ S.ws.close(); }catch(e){} } S.ws = null; S.status = 'off'; S.peers = {}; S.gmId = '';
    try{ localStorage.removeItem(SKEY); }catch(e){}
    emit();
  }
  function startHb(){ stopHb(); hbMiss = 0; hbTimer = setInterval(()=>{ if(++hbMiss > 2 && S.ws){ try{ S.ws.close(); }catch(e){} return; } send({type:'hb'}); }, 20000); }
  function stopHb(){ clearInterval(hbTimer); hbTimer = 0; }
  const fromGm = (m)=>S.gmId && m.from===S.gmId;

  function onMsg(m){
    if(m.type==='hb-ack'){ hbMiss = 0; return; }
    if(m.type==='gm-denied'){ if(S.ws) S.ws._denied = true; return; }
    if(m.type==='welcome'){
      S.myId = m.id; S.status = 'on'; retry = 2000; startHb();
      if(S.role==='gm'){ S.gmId = m.id; send({type:'gm-hello', name:myName(), telemost:S.telemost, lance:S.lance}); if(typeof Battle!=='undefined') setTimeout(()=>Battle.sync(), 0); }
      else send({type:'hello', name:myName(), tandem:me()});
      emit(); return;
    }
    if(m.type==='replaced'){ UI.toast('Стол открыт в другой вкладке этого браузера', 'fail'); S.role = null; return; }
    const from = m.from;
    switch(m.type){
      case 'gm-hello':
        S.gmId = from; S.gmName = m.name || 'Летописец'; S.telemost = m.telemost || ''; if(m.lance) S.lance = m.lance;
        S.peers[from] = Object.assign(S.peers[from] || {}, {name:S.gmName, role:'gm', seen:Date.now()});
        if(S.role==='player') send({type:'tandem', pilot:me()}, from);
        emit(); break;
      case 'hello':
        S.peers[from] = Object.assign(S.peers[from] || {}, {name:m.name, role:'player', pilot:m.tandem || null, seen:Date.now()});
        if(S.role==='gm'){ send({type:'gm-hello', name:myName(), telemost:S.telemost, lance:S.lance}, from); if(typeof Battle!=='undefined') Battle.sync(from); }
        if(S.role==='gm') UI.toast(`${m.name || 'Игрок'} за столом`, 'ok');
        emit(); break;
      case 'tandem':
        S.peers[from] = Object.assign(S.peers[from] || {role:'player'}, {pilot:m.pilot, name:(m.pilot && m.pilot.name) || (S.peers[from] || {}).name, seen:Date.now()});
        emit(); break;
      case 'roll': if(m.entry){ const e = Object.assign({}, m.entry, {remote:true}); Rolls.push(e); if(S.peers[from]){ S.peers[from].last = e; emit(); } if(!e.secret){ UI.toast(`${e.who || 'Игрок'}: ${e.title} — ${e.big!=null ? e.big + ' · ' : ''}${e.verdict || ''}`, e.tone); if(typeof Epic!=='undefined' && Epic.kindOf(e)) Epic.play(e); } } break;
      case 'request': if(fromGm(m) && S.role==='player') Prompts.request(m); break;
      case 'mods': if(fromGm(m) && S.role==='player'){ App.setMode(m.mode || 'norm'); UI.toast(m.mode==='adv' ? 'Летописец: следующий бросок к20 с преимуществом' : m.mode==='dis' ? 'Летописец: следующий бросок к20 с препятствием' : 'Летописец снял преимущество/препятствие', m.mode==='dis' ? 'fail' : 'ok'); } break;
      case 'hurt': if(fromGm(m) && S.role==='player') Prompts.hurt(m); break;
      case 'telemost': if(fromGm(m)){ S.telemost = m.url || ''; emit(); if(S.telemost) UI.toast('Летописец добавил ссылку на Телемост', 'ok'); } break;
      case 'lance': if(fromGm(m)){ S.lance = m.state || null; emit(); } break;
      case 'battle': if(fromGm(m)) Battle.receive(m.state); break;
      case 'battle-move': if(S.role==='gm') Battle.onMove(from, m); break;
      case 'battle-hit': if(S.role==='gm') Battle.onHit(from, m); break;
      case 'peer-left': delete S.peers[m.id]; if(m.id===S.gmId && S.role==='player'){ S.gmId = ''; UI.toast('Летописец отключился', 'fail'); } emit(); break;
    }
  }
  // ---- API для страницы ----
  function rolled(e){ if(!e || !S.role || e.secret) return; send({type:'roll', entry:Object.assign({}, e, {remote:undefined})}); }
  function pilotChanged(){
    if(S.role!=='player' || !S.gmId) return;
    clearTimeout(pushTimer); pushTimer = setTimeout(()=>send({type:'tandem', pilot:me()}, S.gmId), 1500);
  }
  function setTelemost(url){ S.telemost = url; if(S.role==='gm') send({type:'telemost', url}); emit(); }
  function setLance(state){ S.lance = state; if(S.role==='gm') send({type:'lance', state}); emit(); }
  function create(){ S.code = newCode(); try{ history.replaceState(null, '', '/kava/' + S.code); }catch(e){} connect('gm'); }
  function joinCode(t){
    const m = String(t || '').trim().toLowerCase().match(/(?:\/kava\/)?([a-z0-9]{4,16})\/?(?:[?#].*)?$/);
    if(!m){ UI.toast('Не похоже на ссылку стола Кавалерии', 'fail'); return; }
    if(/\/rein\//.test(t) || (/^https?:/.test(t) && !/\/kava\//.test(t))){ if(confirm('Это ссылка на стол другой системы. Перейти туда?')) location.href = String(t).trim(); return; }
    S.code = m[1]; try{ history.replaceState(null, '', '/kava/' + S.code); }catch(e){} connect('player');
  }
  function init(){
    let saved = null; try{ saved = JSON.parse(localStorage.getItem(SKEY) || 'null'); }catch(e){}
    if(saved && saved.role && (!S.code || saved.code===S.code)){ S.code = saved.code; try{ history.replaceState(null, '', '/kava/' + S.code); }catch(e){} connect(saved.role); }
    else if(S.code && ownsTable(S.code)) connect('gm');
    else if(S.code) setTimeout(()=>TableUI.joinPrompt(), 300);
    emit();
  }
  return {init, connect, leave, create, joinCode, rolled, pilotChanged, send, setTelemost, setLance, onChange, link, ownsTable, get S(){ return S; },
    get isGm(){ return S.role==='gm'; }, get on(){ return S.status==='on'; }};
})();

/* ---------- подсказки игроку: запрос броска и урон от Летописца ---------- */
const Prompts = (function(){
  const esc = kvEsc;
  const KINDS = {check:'Проверка', luck:'Испытание Удачи', sensors:'Проверка Сенсоров', alien:'Испытание Отчуждённости', connect:'Подключение (кС)', backlash:'Отдача', init:'Инициатива'};
  function request(m){
    const p = Tandem.pilot, s = KAVA.STATS.find(x=>x.key===m.stat);
    const what = m.kind==='check' && s ? `Проверка ${s.short}` : KINDS[m.kind] || 'Бросок';
    if(m.mode) App.setMode(m.mode);
    UI.sheet({title:'Летописец просит бросок', sub:what + (m.dc ? ` · сложность ${m.dc}` : '') + (m.mode==='adv' ? ' · с преимуществом' : m.mode==='dis' ? ' · с препятствием' : ''), cls:'kv-sheet-request',
      html:`${m.note ? `<p class="kv-p">${esc(m.note)}</p>` : ''}<div class="kv-sheet-btns"><button type="button" class="kv-btn" data-a="close">Позже</button><button type="button" class="kv-btn kv-primary kv-grow2" data-a="go" autofocus>Бросить: ${esc(what)}</button></div>`,
      onAction(a){
        const mode = App.useMode(), dc = Pilot.int(m.dc, App.dc());
        let e = null;
        if(m.kind==='check') e = Rolls.check(p, m.stat || 'som', dc, mode);
        else if(m.kind==='luck') e = Rolls.luck(p, mode);
        else if(m.kind==='sensors') e = Rolls.sensors(p, dc, mode);
        else if(m.kind==='alien') e = Rolls.alienation(p, 0, mode);
        else if(m.kind==='connect') e = Rolls.connect(p);
        else if(m.kind==='backlash') e = Rolls.backlash(p, Pilot.int(m.overtime));
        else if(m.kind==='init') e = Rolls.initiative(p.name);
        if(e){ e.request = m.rid; Actions.done(e); }
      }});
  }
  function hurt(m){
    const mech = m.side==='m';
    UI.toast(`Летописец: ${m.amount} урона по ${mech ? 'Катафракту' : 'Спектру'}`, 'fail');
    Actions.hurtSheet(Tandem.pilot, mech ? 'm' : 'p');
    setTimeout(()=>{ const i = document.querySelector('.kv-sheet [name="dmg"]'); if(i){ i.value = m.amount; } if(m.pierce){ const c = document.querySelector('.kv-sheet [data-chip="pierce"]'); if(c) c.classList.add('on'); } }, 30);
  }
  return {request, hurt};
})();
