/* ======================================================================
   ВХОД ЗА СТОЛ, ПОРТРЕТ, КОПИИ ЛИСТОВ У МАСТЕРА, РЕЗЕРВНАЯ КОПИЯ.
   - Портрет персонажа: картинка из файла (обрезается в круг 160×160), хранится в самом персонаже, видна в листе и на
     жетоне игрока у всех (Мастер рассылает портреты отдельным сообщением, не в каждой рассылке ОЗ).
   - Экран входа: игрок открыл ссылку стола — сначала одно окно: имя → «Сесть за стол» → персонаж: продолжить,
     «Сгенерировать за меня» (уровень задаёт Мастер на экране Мастера), создать самому, загрузить, из файла,
     вернуть у Мастера. Показывается один раз на стол.
   - Копии листов у Мастера: каждый присланный игроком лист Мастер сохраняет у себя (IndexedDB, до 60 копий). Игрок,
     сменивший браузер или почистивший данные, просит свой лист — Мастер выбирает копию и отправляет.
   - Резервная копия всего (ЧЗХ → «Данные и резервная копия»): персонажи, карты, свои объекты, бестиарий, сцены,
     заметки, реакции, настройки — одним файлом; «Восстановить» — на любом устройстве. Плюс индикатор места в браузере
     и предупреждение, когда хранилище переполнено (раньше сохранение молча не происходило).
   ====================================================================== */
const SheetExtras = (function(){
  const RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
  const valid = (p)=>typeof p==='string' && p.length < 90000 && RE.test(p);
  let raf = 0;
  function render(){
    raf = 0; const b = document.getElementById('btnPortrait'), x = document.getElementById('btnPortraitClear'); if(!b) return;
    const p = typeof character!=='undefined' && character && valid(character.portrait) ? character.portrait : '';
    b.style.backgroundImage = p ? `url("${p}")` : ''; b.classList.toggle('has', !!p); b.textContent = p ? '' : '＋';
    b.disabled = !(typeof character!=='undefined' && character);
    if(x) x.style.display = p ? '' : 'none';
  }
  function schedule(){ if(!raf) raf = setTimeout(render, 30); } // таймер, не rAF: во фоновой вкладке кадры не идут
  function toPortrait(file){
    return new Promise((res, rej)=>{
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = ()=>{ const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
        const k = Math.max(S/img.width, S/img.height), w = img.width*k, h = img.height*k;
        c.imageSmoothingQuality = 'high'; c.drawImage(img, (S - w)/2, (S - h)/2, w, h); URL.revokeObjectURL(url);
        let d = cv.toDataURL('image/webp', 0.82); if(!/^data:image\/webp/.test(d)) d = cv.toDataURL('image/jpeg', 0.85); res(d); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error('не удалось открыть картинку')); };
      img.src = url;
    });
  }
  function pick(){
    if(typeof character==='undefined' || !character){ uiAlert('Сначала создайте персонажа.'); return; }
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = ()=>{ const f = inp.files && inp.files[0]; if(!f) return;
      toPortrait(f).then(d=>{ character.portrait = d; logEvent(character, 'Портрет персонажа обновлён.'); renderAll(); if(typeof sendSheetSnapshotToGM==='function') sendSheetSnapshotToGM();
        uiToast('Портрет — в листе и на вашем жетоне', {icon:'☺'}); }).catch(e=>uiAlert('Портрет: ' + e.message, {icon:'⚠'})); };
    inp.click();
  }
  function clear(){ if(!character || !character.portrait) return; const was = character.portrait; delete character.portrait; logEvent(character, 'Портрет убран.'); renderAll(); if(typeof sendSheetSnapshotToGM==='function') sendSheetSnapshotToGM();
    uiToast('Портрет убран', {icon:'✕', action:{label:'Отменить', run:()=>{ if(character){ character.portrait = was; renderAll(); if(typeof sendSheetSnapshotToGM==='function') sendSheetSnapshotToGM(); } }}}); }
  const b = document.getElementById('btnPortrait'); if(b) b.addEventListener('click', pick);
  const x = document.getElementById('btnPortraitClear'); if(x) x.addEventListener('click', clear);
  schedule();
  return { schedule, valid };
})();

/* ---------- маленький помощник IndexedDB ---------- */
function rdbOpen(name, store, keyPath){
  return new Promise((res, rej)=>{ if(typeof indexedDB==='undefined') return rej(new Error('нет IndexedDB'));
    const r = indexedDB.open(name, 1); r.onupgradeneeded = ()=>{ if(!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, {keyPath}); };
    r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); });
}
function rdbAll(db, store){ return new Promise((res, rej)=>{ const t = db.transaction(store, 'readonly'), q = t.objectStore(store).getAll(); q.onsuccess = ()=>res(q.result || []); q.onerror = ()=>rej(q.error); }); }
function rdbPut(db, store, recs){ return new Promise((res, rej)=>{ const t = db.transaction(store, 'readwrite'), s = t.objectStore(store); recs.forEach(r=>s.put(r)); t.oncomplete = ()=>res(); t.onerror = ()=>rej(t.error); }); }
function rdbDel(db, store, keys){ return new Promise((res, rej)=>{ const t = db.transaction(store, 'readwrite'), s = t.objectStore(store); keys.forEach(k=>s.delete(k)); t.oncomplete = ()=>res(); t.onerror = ()=>rej(t.error); }); }

/* ---------- копии листов игроков у Мастера ---------- */
const GmCopies = (function(){
  const DB = 'reincarnator_gm_copies_v1', ST = 'copies', MAX = 60;
  let dbp = null; const db = ()=>dbp || (dbp = rdbOpen(DB, ST, 'key'));
  const pending = {}, timers = {};
  const norm = (s)=>String(s || '').trim().toLowerCase();
  // Мастер получил лист игрока — сохранить копию (не чаще раза в 4 с на игрока)
  function remember(playerId, playerName, payload){
    if(!payload || !payload.character) return;
    pending[playerId] = {playerName, payload};
    clearTimeout(timers[playerId]);
    timers[playerId] = setTimeout(()=>{ const p = pending[playerId]; delete pending[playerId]; if(!p) return;
      const c = p.payload.character, charName = (p.payload.extra && p.payload.extra.name) || '';
      const rec = {key:norm(p.playerName) + '|' + norm(charName || c.archetype || ''), player:String(p.playerName || 'Игрок').slice(0, 60), charName:String(charName).slice(0, 80),
        level:c.level, arch:(typeof ARCHETYPES!=='undefined' && ARCHETYPES[c.archetypeKey]) ? ARCHETYPES[c.archetypeKey].name : '', savedAt:Date.now(), payload:p.payload};
      db().then(d=>rdbPut(d, ST, [rec]).then(()=>rdbAll(d, ST)).then(all=>{ if(all.length > MAX){ all.sort((a, b)=>a.savedAt - b.savedAt); return rdbDel(d, ST, all.slice(0, all.length - MAX).map(r=>r.key)); } })).catch(()=>{});
    }, 4000);
  }
  function list(){ return db().then(d=>rdbAll(d, ST)).then(all=>all.sort((a, b)=>b.savedAt - a.savedAt)).catch(()=>[]); }
  const when = (t)=>new Date(t).toLocaleString('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
  // Игрок просит свой лист: Мастер выбирает копию и отправляет её игроку
  async function offer(playerId, playerName){
    const all = await list();
    const mine = all.filter(r=>norm(r.player)===norm(playerName)), rest = all.filter(r=>norm(r.player)!==norm(playerName));
    if(!all.length){ sendMsg({type:'sheet-restore-none'}, playerId); uiToast(`«${playerName}» просит свой лист, но копий у вас нет`, {icon:'↩'}); return; }
    const row = (r, i)=>`<button type="button" class="join-opt" data-i="${i}"><b>${escapeHtml(r.charName || 'Без имени')}${r.arch ? ' · ' + escapeHtml(r.arch) : ''} · ур. ${r.level}</b><span>игрок «${escapeHtml(r.player)}», сохранено ${when(r.savedAt)}</span></button>`;
    const ordered = mine.concat(rest);
    const p = uiDialog({title:'Игрок просит свой лист', icon:'↩', text:`«${playerName}» просит вернуть персонажа (новый браузер или очищенные данные). Выберите копию — она заменит его текущий лист.`,
      html:`<div class="join-opts">${mine.length ? '' : '<div class="gs-muted">Копий с этим именем игрока нет — показаны все.</div>'}${ordered.slice(0, 12).map(row).join('')}</div>`,
      cancelValue:null, buttons:[{label:'Не отправлять', value:null}]});
    const box = document.querySelector('.ui-dlg .join-opts');
    if(box) box.addEventListener('click', (e)=>{ const b = e.target.closest('[data-i]'); if(!b) return; const r = ordered[+b.dataset.i];
      sendMsg({type:'sheet-push', payload:r.payload, grantsIncluded:[]}, playerId); uiToast(`Лист «${r.charName || r.arch}» отправлен игроку «${playerName}»`, {icon:'↩'});
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); });
    await p;
  }
  return { remember, list, offer };
})();

/* ---------- экран входа за стол ---------- */
const JoinScreen = (function(){
  const KEY = 'reincarnator_joined_tables_v1';
  let back = null, waitTimer = 0;
  const joined = ()=>{ try{ return JSON.parse(localStorage.getItem(KEY) || '[]'); }catch(e){ return []; } };
  function markJoined(){ if(!currentRoomCode) return; const j = joined().filter(x=>x!==currentRoomCode); j.push(currentRoomCode); try{ localStorage.setItem(KEY, JSON.stringify(j.slice(-60))); }catch(e){} }
  const isOpen = ()=>!!back;
  function open(html){
    close(true);
    back = document.createElement('div'); back.className = 'ui-dlg-back join-back';
    back.innerHTML = `<div class="ui-dlg join-dlg" role="dialog" aria-modal="true">${html}<div class="ui-dlg-sheen"></div></div>`;
    document.body.appendChild(back); requestAnimationFrame(()=>back && back.classList.add('show'));
    back.addEventListener('click', onClick);
    const i = back.querySelector('input'); if(i) setTimeout(()=>i.focus(), 60);
  }
  function close(now){ clearTimeout(waitTimer); if(!back) return; const b = back; back = null; if(now){ b.remove(); return; } b.classList.remove('show'); b.classList.add('hide'); setTimeout(()=>b.remove(), 260); }
  const head = (icon, title)=>`<div class="ui-dlg-head"><span class="ui-dlg-hex">${icon}</span><div class="ui-dlg-title">${escapeHtml(title)}</div></div>`;
  function step1(){
    const prev = (document.getElementById('sessionOwnName').value || '').trim();
    open(head('⚄', `Стол «${currentRoomCode}»`) + `<div class="ui-dlg-text">Вас пригласили за стол. Как вас называть за столом?</div>
      <label class="ui-dlg-field"><span>Ваше имя</span><input id="joinName" type="text" maxlength="40" value="${escapeHtml(prev)}" placeholder="например, Пелагея" autocomplete="off"></label>
      <div class="ui-dlg-btns"><button type="button" class="ui-dlg-btn" data-j="later">Позже</button><button type="button" class="ui-dlg-btn" data-j="gm" title="Это ваш стол — войти Мастером (только из браузера, где стол создан)">Я Мастер стола</button><button type="button" class="ui-dlg-btn primary" data-j="sit">Сесть за стол</button></div>`);
    back.querySelector('#joinName').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sit(); } });
  }
  function sit(){
    const n = back && back.querySelector('#joinName'), name = n ? n.value.trim() : '';
    if(!name){ n.focus(); n.placeholder = 'Введите имя — так вас увидят за столом'; return; }
    document.getElementById('sessionOwnName').value = name;
    open(head('⚄', `Стол «${currentRoomCode}»`) + '<div class="ui-dlg-text">Подключаемся к столу…</div>');
    connectSession('player');
    waitTimer = setTimeout(()=>{ if(back) step2(true); }, 6000); // Мастер не ответил — персонажа можно выбрать и так
  }
  function savesList(){ try{ const st = getSavesStore(); return Object.keys(st).sort((a, b)=>(st[b].savedAt || '').localeCompare(st[a].savedAt || '')).slice(0, 8).map(n=>({n, e:st[n]})); }catch(e){ return []; } }
  function step2(noGm){
    clearTimeout(waitTimer);
    const lvl = Math.min(20, Math.max(1, +session.gmNewLevel || 1)), saves = savesList();
    const opt = (j, t, sub, cls)=>`<button type="button" class="join-opt${cls ? ' ' + cls : ''}" data-j="${j}"><b>${t}</b><span>${sub}</span></button>`;
    const cur = typeof character!=='undefined' && character ? `${escapeHtml(document.getElementById('fName').value.trim() || 'Без имени')}, ур. ${character.level}` : '';
    open(head('☺', 'Ваш персонаж') + `<div class="ui-dlg-text">${session.gmName ? `Мастер стола — «${escapeHtml(session.gmName)}».` : noGm ? 'Мастер пока не в сети — персонажа можно выбрать уже сейчас.' : ''} Мастер просит персонажа <b>${lvl}</b> уровня.</div>
      <div class="join-opts">
        ${cur ? opt('play', '▶ Играть: ' + cur, 'персонаж, который уже открыт в этом браузере', 'primary') : ''}
        <label class="ui-dlg-field" style="margin:4px 0 2px"><span>Имя персонажа (можно позже)</span><input id="joinCharName" type="text" maxlength="60" autocomplete="off" placeholder="например, Вера Ржавая"></label>
        ${opt('quick', '🎲 Сгенерировать за меня', `готовый персонаж ${lvl} уровня за одно нажатие — все выборы сделают кости`, cur ? '' : 'primary')}
        ${opt('manual', '✋ Создать самому', 'лист откроется, выборы — ваши; обучение — в «ЧЗХ❓❓❓»')}
        ${saves.length ? opt('saves', '💾 Загрузить сохранённого', saves.map(s=>escapeHtml(s.n)).slice(0, 3).join(' · ') + (saves.length > 3 ? ' …' : '')) : ''}
        ${opt('file', '⬆ Из файла', 'файл персонажа, экспортированный раньше')}
        ${session.gmId ? opt('restore', '↩ Вернуть у Мастера', 'новый браузер или очищенные данные — Мастер хранит копии листов игроков') : ''}
      </div><div class="ui-dlg-btns"><button type="button" class="ui-dlg-btn" data-j="later">Позже</button></div>`);
  }
  function finish(msg){
    markJoined(); close();
    if(typeof toggleMainTab==='function') toggleMainTab('sheet');
    if(msg) uiToast(msg, {icon:'☺'});
    let seen = true; try{ seen = !!(JSON.parse(localStorage.getItem('reincarnator_onboarding_v1') || '{}').done || {})['p-full']; }catch(e){}
    if(!seen) setTimeout(()=>uiToast('Первый раз? «ЧЗХ❓❓❓» → полное обучение игрока', {icon:'?', ms:6000}), 3600);
  }
  function quick(){
    const lvl = Math.min(20, Math.max(1, +session.gmNewLevel || 1)), name = (back.querySelector('#joinCharName').value || '').trim();
    const prevMode = currentGenMode(); setGenMode('random2');
    document.getElementById('fLevelLock').checked = true; document.getElementById('fLevel').value = String(lvl);
    document.getElementById('btnGenerate').click();
    setGenMode(prevMode);
    if(name){ document.getElementById('fName').value = name; renderAll(); }
    if(typeof sendSheetSnapshotToGM==='function') setTimeout(sendSheetSnapshotToGM, 300);
    finish(`Готово: персонаж ${lvl} уровня${name ? ' «' + name + '»' : ''}. ⚔ Режим «Игра» — кнопка с d20.`);
  }
  function onClick(e){
    const b = e.target.closest('[data-j]'); if(!b) return;
    switch(b.dataset.j){
      case 'later': close(); break;
      case 'gm': close(); startAsGm(); break;
      case 'sit': sit(); break;
      case 'play': finish(''); break;
      case 'quick': quick(); break;
      case 'manual': { const lvl = Math.min(20, Math.max(1, +session.gmNewLevel || 1)); const name = (back.querySelector('#joinCharName').value || '').trim();
        document.getElementById('fLevelLock').checked = true; document.getElementById('fLevel').value = String(lvl); if(name) document.getElementById('fName').value = name;
        finish(`Нажмите «⚄ Сгенерировать персонажа» — ${lvl} уровень уже выставлен.`); setTimeout(()=>{ const g = document.getElementById('btnGenerate'); if(g) g.scrollIntoView({block:'center', behavior:'smooth'}); }, 300); break; }
      case 'saves': { const box = back.querySelector('.join-opts'); box.innerHTML = savesList().map(s=>`<button type="button" class="join-opt" data-j="load" data-n="${escapeHtml(s.n)}"><b>${escapeHtml(s.n)}</b><span>${escapeHtml(new Date(s.e.savedAt).toLocaleString('ru-RU'))}</span></button>`).join(''); break; }
      case 'load': loadSlot(b.dataset.n); if(typeof sendSheetSnapshotToGM==='function') setTimeout(sendSheetSnapshotToGM, 300); finish('Персонаж загружен.'); break;
      case 'file': { const f = document.getElementById('fileImportInput'); if(f) f.click(); finish(''); break; }
      case 'restore': sendMsg({type:'sheet-restore-request', name:session.ownName}, session.gmId); finish('Запрос отправлен Мастеру — лист придёт, когда он выберет копию.'); break;
    }
  }
  // После приветствия Мастера: впервые за этим столом — выбрать персонажа
  function onGmHello(){ if(session.role==='player' && currentRoomCode && joined().indexOf(currentRoomCode) < 0 && (!back || back.querySelector('#joinName')===null)) step2(); }
  // Открыли ссылку стола и не подключены — экран входа
  function autoOpen(){ if(currentRoomCode && !session.role && joined().indexOf(currentRoomCode) < 0 && !isOpen()) step1(); }
  setTimeout(autoOpen, 900);
  return { step1, step2, onGmHello, isOpen, autoOpen };
})();

/* ---------- данные браузера: место, резервная копия, восстановление ---------- */
const DataBackup = (function(){
  const IDBS = [['reincarnator_assets_v1', 'assets', 'id'], ['reincarnator_gm_copies_v1', 'copies', 'key'], ['reincarnator_archive_v1', 'items', 'id'], ['reincarnator_note_media_v1', 'media', 'id']];
  const SKIP = ['reincarnator_onboarding_snapshot_v1', 'reincarnator_session_state_v1'];
  const keys = ()=>{ const out = []; try{ for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); if(k && k.indexOf('reincarnator_')===0 && SKIP.indexOf(k) < 0) out.push(k); } }catch(e){} return out; };
  function localBytes(){ let n = 0; try{ for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length)*2; } }catch(e){} return n; }
  const mb = (b)=>(b/1024/1024).toFixed(b < 1024*1024 ? 2 : 1).replace('.', ',');
  const blobToB64 = (b)=>new Promise((res, rej)=>{ const r = new FileReader(); r.onload = ()=>res(String(r.result).split(',')[1] || ''); r.onerror = ()=>rej(r.error); r.readAsDataURL(b); });
  async function pack(rec){ const o = {}; for(const k of Object.keys(rec)){ const v = rec[k]; o[k] = (typeof Blob!=='undefined' && v instanceof Blob) ? {__blob:v.type || 'application/octet-stream', b64:await blobToB64(v)} : v; } return o; }
  function unpack(rec){ const o = {}; Object.keys(rec).forEach(k=>{ const v = rec[k]; if(v && typeof v==='object' && v.__blob){ const bin = atob(v.b64), arr = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i); o[k] = new Blob([arr], {type:v.__blob}); } else o[k] = v; }); return o; }
  async function download(){
    const local = {}; keys().forEach(k=>{ local[k] = localStorage.getItem(k); });
    const idb = {};
    for(const [name, store, kp] of IDBS){ try{ const d = await rdbOpen(name, store, kp); const all = await rdbAll(d, store); idb[name] = {store, keyPath:kp, records:await Promise.all(all.map(pack))}; d.close(); }catch(e){} }
    const data = JSON.stringify({format:'reincarnator-backup', version:1, created:new Date().toISOString(), local, idb});
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], {type:'application/json'}));
    a.download = 'reinkarnator-rezervnaya-kopiya-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    uiToast(`Резервная копия скачана (${mb(data.length)} МБ)`, {icon:'⬇'});
  }
  function restore(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async ()=>{
      const f = inp.files && inp.files[0]; if(!f) return;
      let j; try{ j = JSON.parse(await f.text()); }catch(e){ uiAlert('Файл не читается как резервная копия.', {icon:'⚠'}); return; }
      if(!j || j.format!=='reincarnator-backup' || !j.local){ uiAlert('Это не резервная копия «Реинкарнатора».', {icon:'⚠'}); return; }
      const ok = await uiConfirm(`Копия от ${new Date(j.created).toLocaleString('ru-RU')}. Данные этого браузера (персонажи, карты, бестиарий, сцены, заметки, настройки) будут заменены данными из копии. Страница перезагрузится.`,
        {title:'Восстановить из копии', ok:'Восстановить', danger:true});
      if(!ok) return;
      try{
        keys().forEach(k=>localStorage.removeItem(k));
        Object.keys(j.local).forEach(k=>{ if(k.indexOf('reincarnator_')===0) localStorage.setItem(k, String(j.local[k])); });
        for(const name of Object.keys(j.idb || {})){ const x = j.idb[name], def = IDBS.find(d=>d[0]===name); if(!def || !Array.isArray(x.records)) continue;
          const d = await rdbOpen(name, def[1], def[2]); await rdbPut(d, def[1], x.records.map(unpack)); d.close(); }
      }catch(e){ uiAlert('Не удалось восстановить: ' + e.message, {icon:'⚠'}); return; }
      uiToast('Восстановлено — перезагрузка…', {icon:'⬆'}); setTimeout(()=>location.reload(), 900);
    };
    inp.click();
  }
  async function openPanel(){
    const lb = localBytes(); let est = null; try{ est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; }catch(e){}
    const LIM = 5*1024*1024, pct = Math.min(100, Math.round(lb/LIM*100));
    const r = await uiDialog({title:'Данные и резервная копия', icon:'💾',
      html:`<div class="ui-dlg-text">Всё хранится в этом браузере: персонажи, карты, бестиарий, сцены, заметки, реакции. Очистка данных браузера удалит их — держите резервную копию.</div>
        <div class="bk-bar"><i style="width:${pct}%" class="${pct > 85 ? 'warn' : ''}"></i></div>
        <div class="gs-muted">Основное хранилище: ${mb(lb)} из ~5 МБ (${pct}%)${est && est.usage ? ` · всего у сайта: ${mb(est.usage)} МБ (картинки своих объектов, копии листов)` : ''}</div>`,
      cancelValue:null, buttons:[{label:'Закрыть', value:null}, {label:'⬆ Восстановить…', value:'restore'}, {label:'⬇ Скачать копию', value:'download', primary:true}]});
    if(r==='download') download(); else if(r==='restore') restore();
  }
  // Переполнение: раньше запись молча не происходила — теперь предупреждение (не чаще раза в минуту)
  let warned = 0;
  try{
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v){
      try{ return orig.call(this, k, v); }
      catch(e){
        if(this===window.localStorage && (e && (e.name==='QuotaExceededError' || e.code===22)) && Date.now() - warned > 60000){
          warned = Date.now();
          setTimeout(()=>uiToast('Хранилище браузера переполнено — последние изменения не сохранились. Скачайте резервную копию и удалите лишнее.', {icon:'⚠', red:true, ms:9000,
            action:{label:'Данные…', run:openPanel}}), 0);
        }
        throw e;
      }
    };
  }catch(e){}
  return { openPanel, download, restore, localBytes };
})();
