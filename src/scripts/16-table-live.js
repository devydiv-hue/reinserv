/* ======================================================================
   ЖИВОЙ СТОЛ: БРОСКИ КРУПНО, «ВАШ ХОД», ЛЕТОПИСЬ СЕССИИ.
   - Броски «на столе»: каждый новый бросок (свой и чужой) — крупная плашка поверх игрового стола на несколько
     секунд: кто, что, число на кости, итог; натуральная 12 и провальная 13 — с акцентом. Только когда открыт
     игровой стол; при подтягивании старого лога (roll-sync) не показываются.
   - «Ваш ход»: в бою, когда ходит сторона вашего жетона — плашка на столе, вибрация телефона, мигающий заголовок
     вкладки и системное уведомление, если вкладка свёрнута (разрешение — в «ЧЗХ❓❓❓» → «Броски на столе и „Ваш ход“»).
   - Летопись (у Мастера и на столе без сессии): броски, атаки, бои и круги, «повержен», травмы, выдачи Мастера,
     подключения игроков и свои записи — по сессиям (новая — после 4 часов тишины), отдельно для каждого стола.
     Экран Мастера → «Летопись»: итоги сессии, главное или всё подряд, копировать и скачать текстом.
   Настройки зрителя — reincarnator_table_live_v1, летопись — reincarnator_chronicle_v1.
   ====================================================================== */
const TableLive = (function(){
  const PREF_KEY = 'reincarnator_table_live_v1';
  let prefs = {banner:true, turn:true, asked:false};
  try{ Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); }catch(e){}
  const savePrefs = ()=>{ try{ localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); }catch(e){} };
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const txt = (h)=>{ const d = document.createElement('div'); d.innerHTML = h; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

  /* ---------- бросок → плашка ---------- */
  function model(e){
    if(!e || e.mapAttackUndo || e.weaponHits) return null;
    if(e.kind==='quick'){
      const f = formatQuickRollEntry(e), d = document.createElement('div'); d.innerHTML = f.html;
      const who = (d.querySelector('.who') || {}).textContent || e.player || '?', rest = txt((d.querySelector('.rest') || {}).innerHTML || '');
      const d20 = e.mapAttack || e.mapGrenade || e.diceType==='d20';
      const big = e.loot ? '⛏' : e.initiative ? '⚔' : e.itemCheck ? '' : (d20 || e.mode==='max') ? e.roll : (e.sum!=null ? e.sum : '');
      const n13 = d20 && e.roll===13 && (e.jammed || e.success===false || e.outcome==='none');
      return {who, text:rest, big, cls:f.cls, nat:d20 && e.roll===12 ? 12 : n13 ? 13 : 0};
    }
    const outcome = e.success===true ? `успех, КУ${e.category}` : e.success===false ? 'провал' : '';
    return {who:e.player || '?', text:`${e.statLabel} (${e.mod>=0 ? '+' : ''}${e.mod}) · Макс.${e.max}${outcome ? ' — ' + outcome : ''}`, big:e.roll,
      cls:e.success===true ? 'success' : e.success===false ? 'failure' : '', nat:e.roll===12 ? 12 : (e.roll===13 && e.success===false) ? 13 : 0};
  }
  function viewport(){ const gt = GT(), l = gt && gt.layerEl; return l && l.parentElement && l.offsetParent!==null ? l.parentElement : null; }
  function stack(){
    const vp = viewport(); if(!vp) return null;
    let s = vp.querySelector(':scope > .tl-stack'); if(!s){ s = document.createElement('div'); s.className = 'tl-stack'; vp.appendChild(s); }
    return s;
  }
  function banner(m, ms){
    const s = stack(); if(!s) return;
    const el = document.createElement('div');
    el.className = `tl-banner ${m.cls || ''}${m.nat===12 ? ' nat12' : m.nat===13 ? ' nat13' : ''}${m.turn ? ' turn' : ''}`;
    el.innerHTML = `${m.big!=='' && m.big!=null ? `<span class="tl-big">${esc(String(m.big))}</span>` : ''}<span class="tl-body"><b>${esc(m.who)}</b><span>${esc(String(m.text).slice(0, 170))}</span>${m.nat===12 ? '<i>натуральная 12</i>' : m.nat===13 ? '<i>натуральная 13</i>' : ''}</span>`;
    s.appendChild(el);
    while(s.children.length > 3) s.firstChild.remove();
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(), 400); }, ms || (m.nat ? 5200 : 4000));
  }
  function onEntry(e){
    if(prefs.banner && !document.hidden){ const m = model(e); if(m) banner(m); }
    Chronicle.fromRoll(e);
  }
  // Все новые записи лога (свои, по сети, с карты) проходят через addRollLogEntry — оборачиваем её
  if(typeof addRollLogEntry==='function'){
    const orig = addRollLogEntry;
    window.addRollLogEntry = function(entry, silent){
      const isNew = orig.apply(this, arguments);
      if(isNew && !silent){ try{ onEntry(entry); }catch(err){ console.warn('[Живой стол]', err); } }
      return isNew;
    };
  }

  /* ---------- «Ваш ход» ---------- */
  let lastMine = '', primed = false, titleTimer = 0, baseTitle = document.title;
  function flashTitle(){
    clearInterval(titleTimer); let on = false;
    titleTimer = setInterval(()=>{ if(!document.hidden){ clearInterval(titleTimer); document.title = baseTitle; return; } on = !on; document.title = on ? '⚔ Ваш ход!' : baseTitle; }, 900);
  }
  function notify(body){
    try{
      if(!('Notification' in window) || Notification.permission!=='granted') return;
      const n = new Notification('⚔ Ваш ход', {body, tag:'reinc-turn', renotify:true, icon:'/icons/icon-192.png'});
      n.onclick = ()=>{ try{ window.focus(); }catch(e){} n.close(); };
    }catch(e){}
  }
  function yourTurn(c){
    const side = (c.sides || []).find(x=>x.id===c.order[c.turn]), sideName = side ? side.name : 'ваша сторона';
    const body = `Круг ${c.round} — ходит «${sideName}».`;
    if(!prefs.turn) return;
    banner({who:'Ваш ход!', text:body, big:'⚔', cls:'success', turn:true}, 6000);
    try{ if(navigator.vibrate) navigator.vibrate([140, 70, 140]); }catch(e){}
    if(document.hidden){ flashTitle(); notify(body); }
    else if(!prefs.asked && 'Notification' in window && Notification.permission==='default'){
      prefs.asked = true; savePrefs();
      setTimeout(()=>uiToast('Сообщать «Ваш ход», даже если вкладка свёрнута?', {icon:'⚔', action:{label:'Включить', run:askPermission}}), 1500);
    }
  }
  function askPermission(){
    if(!('Notification' in window)){ uiAlert('Этот браузер не умеет показывать уведомления. «Ваш ход» будет на столе и в заголовке вкладки.', {icon:'🔔'}); return Promise.resolve('unsupported'); }
    return Notification.requestPermission().then(p=>{ uiToast(p==='granted' ? 'Уведомления включены' : 'Уведомления запрещены в браузере — «Ваш ход» останется на столе и в заголовке', {icon:'🔔'}); return p; });
  }
  setInterval(()=>{
    const gt = GT(); if(!gt || typeof session==='undefined' || session.role!=='player'){ lastMine = ''; return; }
    const c = gt.state && gt.state.combat, own = gt.ownTokenId && gt.ownTokenId();
    const q = c && own && c.parts && c.parts[own];
    const key = q && c.order[c.turn]===q.side ? `${c.round}:${c.turn}:${c.scene || 0}` : '';
    if(key && key!==lastMine && primed) yourTurn(c);
    lastMine = key; primed = true;
  }, 1000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ clearInterval(titleTimer); document.title = baseTitle; } });

  /* ---------- настройки (ЧЗХ) ---------- */
  function openSettings(){
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const permTxt = perm==='granted' ? 'разрешены' : perm==='denied' ? 'запрещены в настройках браузера' : perm==='unsupported' ? 'браузер не поддерживает' : 'ещё не разрешены';
    uiDialog({title:'Броски на столе и «Ваш ход»', icon:'🔔', html:`<div class="tl-set">
        <label class="rx-sw"><input type="checkbox" data-p="banner" ${prefs.banner ? 'checked' : ''}> <b>Броски крупно на столе</b> — кто, что и сколько выпало, у всех за столом</label>
        <label class="rx-sw"><input type="checkbox" data-p="turn" ${prefs.turn ? 'checked' : ''}> <b>«Ваш ход»</b> — в бою, когда ходит сторона вашего жетона: плашка, вибрация, заголовок вкладки</label>
        <div class="gs-muted" style="margin-top:8px">Системные уведомления, когда вкладка свёрнута: <b>${permTxt}</b>.</div>
        ${perm==='default' ? '<button type="button" class="gs-btn" data-p="ask" style="margin-top:6px">Разрешить уведомления</button>' : ''}</div>`,
      cancelValue:null, buttons:[{label:'Готово', value:null, primary:true}]});
    setTimeout(()=>{ const box = document.querySelector('.ui-dlg .tl-set'); if(!box) return;
      box.addEventListener('change', (e)=>{ const k = e.target.dataset.p; if(k){ prefs[k] = e.target.checked; savePrefs(); } });
      const a = box.querySelector('[data-p="ask"]'); if(a) a.addEventListener('click', ()=>askPermission().then(()=>a.remove()));
    }, 0);
  }

  return { banner, openSettings, askPermission, get prefs(){ return prefs; } };
})();

/* ---------- летопись сессии ---------- */
const Chronicle = (function(){
  const KEY = 'reincarnator_chronicle_v1', GAP = 4*3600e3, MAX_CHARS = 700000;
  let db = {}; try{ db = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){ db = {}; }
  let saveTimer = 0, liveRoot = null, view = {sel:'', all:false};
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const room = ()=>(typeof currentRoomCode!=='undefined' && currentRoomCode) || 'local';
  function recording(){
    if(typeof session!=='undefined' && session.role==='player') return false;
    if(typeof Onboarding!=='undefined' && Onboarding.busy && Onboarding.busy()) return false;
    const gt = GT(); if(gt && gt.inSandbox && gt.inSandbox()) return false;
    return true;
  }
  function save(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      let s = JSON.stringify(db);
      while(s.length > MAX_CHARS){ // место в браузере не бесконечно — старейшие сессии уходят первыми
        let oldest = null; Object.keys(db).forEach(r=>{ const x = db[r][0]; if(x && (!oldest || x.start < oldest.s.start)) oldest = {r, s:x}; });
        if(!oldest) break; db[oldest.r].shift(); if(!db[oldest.r].length) delete db[oldest.r]; s = JSON.stringify(db);
      }
      try{ localStorage.setItem(KEY, s); }catch(e){}
    }, 1500);
  }
  function list(){ return db[room()] || []; }
  function current(make){
    const l = db[room()] || (db[room()] = []), now = Date.now();
    let s = l[l.length - 1];
    if(!s || (make && now - s.last > GAP)){ if(!make) return s || null; s = {id:now.toString(36), start:now, last:now, ev:[]}; l.push(s); if(l.length > 30) l.shift(); }
    return s;
  }
  function add(k, x, n){
    if(!recording()) return;
    const s = current(true), now = Date.now();
    s.ev.push(n ? {t:now, k, x:String(x).slice(0, 320), n} : {t:now, k, x:String(x).slice(0, 320)}); s.last = now;
    if(s.ev.length > 4000) s.ev.splice(0, s.ev.length - 4000);
    save(); if(liveRoot && liveRoot.isConnected) render(liveRoot);
  }
  const strip = (h)=>{ const d = document.createElement('div'); d.innerHTML = h; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
  function fromRoll(e){
    if(!e || e.mapAttackUndo || e.weaponHits || e.chat || e.secretStub) return;
    let line = ''; try{ const d = document.createElement('div'); d.innerHTML = renderRollLogEntry(e, null);
      const w = d.querySelector('.who'), r = d.querySelector('.rest'); line = w && r ? `${strip(w.innerHTML)}: ${strip(r.innerHTML)}` : strip(d.innerHTML); }catch(err){ return; }
    const k = e.mapAttack || e.mapGrenade ? 'atk' : e.loot ? 'loot' : e.initiative ? 'init' : 'roll';
    const d20 = e.kind!=='quick' || e.mapAttack || e.mapGrenade || e.diceType==='d20';
    const n = d20 && e.roll===12 ? 12 : d20 && e.roll===13 && (e.success===false || e.jammed || e.outcome==='none') ? 13 : 0;
    add(k, line, n);
  }

  /* наблюдатель: бои, круги, «повержен», травмы, игроки за столом */
  let wasCombat = null, seen = new Map(), players = null, chronPrimed = false; // первый взгляд после загрузки — только запомнить, не писать
  setInterval(()=>{
    const gt = GT(); if(!gt || !recording()){ wasCombat = null; seen.clear(); players = null; return; }
    const st = gt.state || {}, c = st.combat;
    if(!chronPrimed){ chronPrimed = true; wasCombat = c ? {round:c.round} : null; return; }
    if(c && !wasCombat) add('combat', `Бой начался: участников ${Object.keys(c.parts || {}).length}`);
    else if(!c && wasCombat) add('combat', `Бой окончен (кругов: ${wasCombat.round})`);
    else if(c && wasCombat && c.round > wasCombat.round) add('round', `Круг ${c.round}`);
    wasCombat = c ? {round:c.round} : null;
    const alive = new Set();
    Object.values(st.tokens || {}).forEach(t=>{
      alive.add(t.id);
      const v = gt.vitalsOf(t) || {}, hp = v.hp!=null ? Number(v.hp) : (t.hp!=null ? Number(t.hp) : null), tr = (t.trauma || 0) + (t.traumaRed || 0);
      const name = v.name || t.name || 'Жетон', was = seen.get(t.id); seen.set(t.id, {hp, tr});
      if(!was) return;
      if(hp!=null && was.hp!=null && hp <= 0 && was.hp > 0) add('down', `${name} повержен`);
      else if(hp!=null && was.hp!=null && hp > 0 && was.hp <= 0) add('up', `${name} снова на ногах`);
      if(tr > was.tr){ const rb = typeof tokenNature==='function' && tokenNature(t)==='robot'; add(rb ? 'breakage' : 'trauma', `${name}: ${rb ? 'поломка' : 'травма'} (${tr})`); }
    });
    [...seen.keys()].forEach(id=>{ if(!alive.has(id)) seen.delete(id); });
    if(typeof session!=='undefined' && session.role==='gm'){
      const now = {}; Object.keys(session.players || {}).forEach(id=>{ now[id] = (session.players[id] && session.players[id].name) || 'Игрок'; });
      if(players){ Object.keys(now).forEach(id=>{ if(!players[id]) add('join', `→ ${now[id]} за столом`); }); Object.keys(players).forEach(id=>{ if(!now[id]) add('join', `← ${players[id]} вышел`); }); }
      players = now;
    } else players = null;
  }, 1500);
  // Выдачи Мастера (опыт, деньги, находки, ОЗ): текст — тот же, что увидит игрок в своём журнале
  if(typeof sendGrant==='function'){
    const orig = sendGrant;
    window.sendGrant = function(playerId, fields){
      try{ const p = session.players[playerId], who = (p && p.name) || 'Игрок';
        const t = p && p.character ? applyGrant(JSON.parse(JSON.stringify(p.character)), Object.assign({gid:'chron'}, fields)) : '';
        add('grant', `${who}: ${t || 'выдача Мастера'}`.replace('Мастер ', '')); }catch(e){}
      return orig.apply(this, arguments);
    };
  }

  /* ---------- вкладка «Летопись» на экране Мастера ---------- */
  const ICON = {roll:'⚄', atk:'🗡', loot:'⛏', init:'⚔', combat:'⚔', round:'↻', down:'☠', up:'✚', trauma:'🦴', breakage:'🔧', grant:'🎁', join:'☺', note:'✎'};
  const MAIN = new Set(['combat', 'down', 'up', 'trauma', 'breakage', 'grant', 'note', 'loot']);
  const hhmm = (t)=>new Date(t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
  const dayTxt = (t)=>new Date(t).toLocaleDateString('ru-RU', {day:'numeric', month:'long'});
  function pickSession(){ const l = list(); return l.find(s=>s.id===view.sel) || l[l.length - 1] || null; }
  function stats(s){
    const ev = s.ev, cnt = (k)=>ev.filter(e=>e.k===k).length;
    const names = new Set(ev.filter(e=>e.k==='join' && e.x.indexOf('→')===0).map(e=>e.x.slice(2).replace(/ за столом$/, '')));
    return {rolls:cnt('roll') + cnt('atk'), n12:ev.filter(e=>e.n===12).length, n13:ev.filter(e=>e.n===13).length, atk:cnt('atk'),
      fights:ev.filter(e=>e.k==='combat' && e.x.indexOf('начался') >= 0).length, rounds:cnt('round'), downs:ev.filter(e=>e.k==='down' && e.x.indexOf('повержен') >= 0).length,
      grants:cnt('grant'), mins:Math.max(1, Math.round((s.last - s.start)/60000)), players:[...names]};
  }
  function asText(s){
    const st = stats(s), main = s.ev.filter(e=>MAIN.has(e.k) || e.n);
    return [`ЛЕТОПИСЬ — стол «${room()}», ${dayTxt(s.start)}, ${hhmm(s.start)}–${hhmm(s.last)}`,
      `Бросков: ${st.rolls} (нат. 12: ${st.n12}, нат. 13: ${st.n13}) · атак: ${st.atk} · боёв: ${st.fights}, кругов: ${st.rounds} · повержено: ${st.downs} · выдач: ${st.grants}`,
      st.players.length ? `За столом: ${st.players.join(', ')}` : '', '', 'ГЛАВНОЕ', ...main.map(e=>`${hhmm(e.t)}  ${e.n ? (e.n===12 ? '★' : '✗') : (ICON[e.k] || '·')} ${e.x}`),
      '', 'ВСЁ ПО ПОРЯДКУ', ...s.ev.map(e=>`${hhmm(e.t)}  ${e.x}`)].filter((x, i, a)=>x!=='' || a[i - 1]!=='').join('\n');
  }
  function render(root){
    liveRoot = root;
    const l = list(), s = pickSession();
    if(!s){ root.innerHTML = `<div class="gs-empty">Летопись пуста. Она пишется сама, пока идёт игра: броски, атаки, бои, «повержен», травмы, выдачи и ваши записи.
      Новая сессия начинается после 4 часов тишины или по кнопке.</div>${noteRow()}`; return; }
    const st = stats(s), evs = view.all ? s.ev : s.ev.filter(e=>MAIN.has(e.k) || e.n);
    root.innerHTML = `<div class="gs-row">${l.length > 1 ? `<select class="ch-sel" title="Сессии этого стола">${l.slice().reverse().map(x=>`<option value="${x.id}" ${x===s ? 'selected' : ''}>${dayTxt(x.start)}, ${hhmm(x.start)} · ${x.ev.length} зап.</option>`).join('')}</select>` : `<b>${dayTxt(s.start)}, ${hhmm(s.start)}–${hhmm(s.last)}</b>`}</div>
      <div class="ch-stats"><span><b>${st.mins}</b> мин</span><span><b>${st.rolls}</b> бросков</span><span class="n12"><b>${st.n12}</b> нат. 12</span><span class="n13"><b>${st.n13}</b> нат. 13</span>
        <span><b>${st.fights}</b> боёв · ${st.rounds} кр.</span><span><b>${st.downs}</b> повержено</span><span><b>${st.grants}</b> выдач</span></div>
      ${st.players.length ? `<div class="gs-muted">За столом: ${esc(st.players.join(', '))}</div>` : ''}
      ${noteRow()}
      <div class="rx-seg ch-mode"><button type="button" data-c="main" class="${view.all ? '' : 'on'}">Главное</button><button type="button" data-c="all" class="${view.all ? 'on' : ''}">Всё</button></div>
      <div class="ch-list">${evs.slice().reverse().slice(0, 400).map(e=>`<div class="ch-ev k-${e.k}${e.n ? ' n' + e.n : ''}"><time>${hhmm(e.t)}</time><span class="ch-i">${ICON[e.k] || '·'}</span><span>${esc(e.x)}</span></div>`).join('') || '<div class="gs-muted">Пока ничего главного — переключите на «Всё».</div>'}</div>
      <div class="gs-row"><button type="button" class="gs-btn" data-c="copy" title="Скопировать летопись этой сессии текстом — для чата или заметок">Копировать</button>
        <button type="button" class="gs-btn" data-c="dl" title="Скачать текстовым файлом">Скачать .txt</button>
        <button type="button" class="gs-btn" data-c="new" title="Начать новую сессию в летописи">Новая сессия</button>
        <button type="button" class="gs-btn" data-c="del" title="Удалить эту сессию из летописи">Удалить</button></div>`;
  }
  const noteRow = ()=>`<div class="gs-row ch-note"><input type="text" maxlength="300" placeholder="Своя запись: «Отряд нашёл бункер»…"><button type="button" class="gs-btn small" data-c="note">＋</button></div>`;
  function addNote(root){ const i = root.querySelector('.ch-note input'), v = i && i.value.trim(); if(!v) return; add('note', v); if(!recording()) uiToast('Летопись ведёт Мастер', {icon:'✎'}); }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-c]'); if(!b || !liveRoot || !liveRoot.contains(b)) return;
    const s = pickSession();
    switch(b.dataset.c){
      case 'main': view.all = false; render(liveRoot); break;
      case 'all': view.all = true; render(liveRoot); break;
      case 'note': addNote(liveRoot); break;
      case 'copy': if(s){ const t = asText(s); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(()=>uiToast('Летопись скопирована', {icon:'✎'}), ()=>uiPrompt('Скопируйте летопись:', t)); } break;
      case 'dl': if(s){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([asText(s)], {type:'text/plain;charset=utf-8'}));
        a.download = `letopis-${room()}-${new Date(s.start).toISOString().slice(0, 10)}.txt`; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500); } break;
      case 'new': { const l = db[room()] || (db[room()] = []), now = Date.now(); l.push({id:now.toString(36), start:now, last:now, ev:[]}); view.sel = ''; save(); render(liveRoot); uiToast('Новая сессия в летописи', {icon:'✎'}); break; }
      case 'del': if(s){ const l = db[room()] || [], at = l.indexOf(s); l.splice(at, 1); view.sel = ''; save(); render(liveRoot);
        uiToast('Сессия удалена из летописи', {icon:'✕', action:{label:'Отменить', run:()=>{ const ll = db[room()] || (db[room()] = []); ll.splice(Math.min(at, ll.length), 0, s); save(); if(liveRoot) render(liveRoot); }}}); } break;
    }
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && e.target.matches && e.target.matches('.ch-note input') && liveRoot && liveRoot.contains(e.target)){ e.preventDefault(); addNote(liveRoot); } });
  document.addEventListener('change', (e)=>{ if(e.target.matches && e.target.matches('.ch-sel') && liveRoot){ view.sel = e.target.value; render(liveRoot); } });

  function startSession(){ const l = db[room()] || (db[room()] = []), now = Date.now(); l.push({id:now.toString(36), start:now, last:now, ev:[]}); if(l.length > 30) l.shift(); view.sel = ''; save(); if(liveRoot && liveRoot.isConnected) render(liveRoot); }
  const MAIN_KINDS = MAIN;
  return { fromRoll, add, render, asText, list, startSession, current:()=>current(false), isMain:(e)=>MAIN_KINDS.has(e.k) || !!e.n, hhmm };
})();
