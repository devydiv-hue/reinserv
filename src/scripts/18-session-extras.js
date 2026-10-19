/* ======================================================================
   ВСТРЕЧА ЦЕЛИКОМ: «Начать/Завершить встречу», раздатки, QR стола, сообщения и шёпот, тайные броски, «Стоп-кадр»,
   проверка версии сервера, качество связи игроков, «Сообщить о проблеме», облегчённый режим.
   - Встреча (Мастер, экран Мастера → «Игроки»): начало — новая сессия летописи, сброс отметок опыта (с вопросом),
     игрокам «Встреча началась»; конец — каждому игроку итог: главное из летописи, его выдачи (опыт, удача, находки).
   - Раздатки: «📜 Игрокам» в заметке Мастера — текст заметки (или выделенный кусок) и картинка всем или выбранным.
     У игрока — окно и архив («ЧЗХ❓❓❓» → «📜 Раздатки и итоги встреч», IndexedDB reincarnator_archive_v1).
   - QR-код ссылки стола — свой кодировщик (байтовый режим, уровень M, версии 1–10), без внешних библиотек.
   - Сообщения: строка под логом бросков — всем или лично (Мастеру / игроку; копия шёпота игроку игроку — Мастеру).
     Записи лога с priv видят только автор и адресат (см. rollVisibleTo в разделе сессии).
   - 🤫 Тайный бросок: переключатель рядом со строкой сообщений; бросок идёт только Мастеру, остальным — «бросил тайно».
   - «⏸ Стоп-кадр»: игроки не двигают жетоны (проверяет и Мастер — GameTable.setPaused), у всех плашка.
   - Связь: Мастер раз в 8 с меряет отклик каждого игрока (cping/cpong); точка в карточке игрока, «отключился N назад».
   ====================================================================== */
const QrCode = (function(){
  // Таблицы уровня M для версий 1–10: байты коррекции на блок и число блоков (ISO/IEC 18004)
  const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const gfMul = (x, y)=>{ let z = 0; for(let i=7;i>=0;i--){ z = (z << 1) ^ ((z >>> 7)*0x11D); z ^= ((y >>> i) & 1)*x; } return z & 0xFF; };
  function rsDivisor(deg){ const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for(let i=0;i<deg;i++){ for(let j=0;j<r.length;j++){ r[j] = gfMul(r[j], root); if(j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 0x02); } return r; }
  function rsRemainder(data, div){ const r = div.map(()=>0); data.forEach(b=>{ const f = b ^ r.shift(); r.push(0); div.forEach((c, i)=>{ r[i] ^= gfMul(c, f); }); }); return r; }
  function rawModules(ver){ let r = (16*ver + 128)*ver + 64; if(ver >= 2){ const n = Math.floor(ver/7) + 2; r -= (25*n - 10)*n - 55; if(ver >= 7) r -= 36; } return r; }
  function alignPos(ver, size){ if(ver===1) return []; const n = Math.floor(ver/7) + 2, step = Math.ceil((ver*4 + 4)/(n*2 - 2))*2, out = [6];
    for(let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos); return out; }
  function encode(text){
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for(;ver<=10;ver++){ const cap = Math.floor(rawModules(ver)/8) - ECC_M[ver]*BLOCKS_M[ver]; if(4 + (ver<10 ? 8 : 16) + bytes.length*8 <= cap*8) break; }
    if(ver > 10) throw new Error('слишком длинная ссылка для QR');
    const size = ver*4 + 17, dataCw = Math.floor(rawModules(ver)/8) - ECC_M[ver]*BLOCKS_M[ver];
    // биты данных
    const bits = []; const put = (v, n)=>{ for(let i=n-1;i>=0;i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver<10 ? 8 : 16); bytes.forEach(b=>put(b, 8));
    put(0, Math.min(4, dataCw*8 - bits.length)); while(bits.length % 8) bits.push(0);
    const data = []; for(let i=0;i<bits.length;i+=8){ let b = 0; for(let j=0;j<8;j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for(let p = 0xEC; data.length < dataCw; p ^= 0xEC ^ 0x11) data.push(p);
    // блоки и коррекция, чередование
    const nb = BLOCKS_M[ver], eccLen = ECC_M[ver], raw = Math.floor(rawModules(ver)/8), nShort = nb - raw % nb, shortLen = Math.floor(raw/nb), div = rsDivisor(eccLen);
    const blocks = []; for(let i=0, k=0;i<nb;i++){ const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length; const ecc = rsRemainder(dat, div); if(i < nShort) dat.push(0); blocks.push(dat.concat(ecc)); }
    const cw = []; for(let i=0;i<blocks[0].length;i++) blocks.forEach((b, j)=>{ if(i!==shortLen - eccLen || j >= nShort) cw.push(b[i]); });
    // служебные узоры
    const m = Array.from({length:size}, ()=>new Array(size).fill(false)), fn = Array.from({length:size}, ()=>new Array(size).fill(false));
    const set = (x, y, v)=>{ m[y][x] = v; fn[y][x] = true; };
    for(let i=0;i<size;i++){ set(6, i, i % 2===0); set(i, 6, i % 2===0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy])=>{ for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){ const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if(x>=0 && x<size && y>=0 && y<size) set(x, y, d!==2 && d!==4); } });
    const ap = alignPos(ver, size), last = ap.length - 1;
    ap.forEach((ay, i)=>ap.forEach((ax, j)=>{ if((i===0 && j===0) || (i===0 && j===last) || (i===last && j===0)) return; for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy))!==1); }));
    const formatBits = (mask)=>{ const d = (0 << 3) | mask; let r = d; for(let i=0;i<10;i++) r = (r << 1) ^ ((r >>> 9)*0x537); return ((d << 10) | r) ^ 0x5412; }; // уровень M — 00
    const drawFormat = (mask)=>{ const b = formatBits(mask), g = (i)=>((b >>> i) & 1)===1;
      for(let i=0;i<=5;i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for(let i=9;i<15;i++) set(14 - i, 8, g(i));
      for(let i=0;i<8;i++) set(size - 1 - i, 8, g(i)); for(let i=8;i<15;i++) set(8, size - 15 + i, g(i)); set(8, size - 8, true); };
    drawFormat(0);
    if(ver >= 7){ let r = ver; for(let i=0;i<12;i++) r = (r << 1) ^ ((r >>> 11)*0x1F25); const b = (ver << 12) | r;
      for(let i=0;i<18;i++){ const v = ((b >>> i) & 1)===1, a = size - 11 + i % 3, c = Math.floor(i/3); set(a, c, v); set(c, a, v); } }
    // данные змейкой
    let k = 0;
    for(let right = size - 1; right >= 1; right -= 2){ if(right===6) right = 5;
      for(let v=0;v<size;v++) for(let j=0;j<2;j++){ const x = right - j, up = ((right + 1) & 2)===0, y = up ? size - 1 - v : v;
        if(!fn[y][x] && k < cw.length*8){ m[y][x] = ((cw[k >>> 3] >>> (7 - (k & 7))) & 1)===1; k++; } } }
    // маска: из восьми — с наименьшим штрафом (серии, квадраты 2×2, баланс)
    const MASKS = [(x, y)=>(x + y) % 2===0, (x, y)=>y % 2===0, (x)=>x % 3===0, (x, y)=>(x + y) % 3===0, (x, y)=>(Math.floor(x/3) + Math.floor(y/2)) % 2===0,
      (x, y)=>x*y % 2 + x*y % 3===0, (x, y)=>(x*y % 2 + x*y % 3) % 2===0, (x, y)=>((x + y) % 2 + x*y % 3) % 2===0];
    const applyMask = (i)=>{ for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!fn[y][x] && MASKS[i](x, y)) m[y][x] = !m[y][x]; };
    const penalty = ()=>{ let p = 0, dark = 0;
      for(let y=0;y<size;y++){ let run = 1; for(let x=1;x<size;x++){ if(m[y][x]===m[y][x - 1]){ run++; if(run===5) p += 3; else if(run > 5) p++; } else run = 1; } }
      for(let x=0;x<size;x++){ let run = 1; for(let y=1;y<size;y++){ if(m[y][x]===m[y - 1][x]){ run++; if(run===5) p += 3; else if(run > 5) p++; } else run = 1; } }
      for(let y=0;y<size - 1;y++) for(let x=0;x<size - 1;x++){ const c = m[y][x]; if(c===m[y][x + 1] && c===m[y + 1][x] && c===m[y + 1][x + 1]) p += 3; }
      m.forEach(r=>r.forEach(v=>{ if(v) dark++; })); p += Math.floor(Math.abs(dark*20 - size*size*10)/(size*size))*10; return p; };
    let best = 0, bestP = Infinity;
    for(let i=0;i<8;i++){ applyMask(i); drawFormat(i); const p = penalty(); if(p < bestP){ bestP = p; best = i; } applyMask(i); }
    applyMask(best); drawFormat(best);
    return m;
  }
  function svg(text, px){
    const m = encode(text), n = m.length, q = 4, S = n + q*2; let d = '';
    m.forEach((r, y)=>r.forEach((v, x)=>{ if(v) d += `M${x + q},${y + q}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${px || 240}" height="${px || 240}" shape-rendering="crispEdges"><rect width="${S}" height="${S}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { encode, svg };
})();

/* ---------- архив игрока: раздатки и итоги встреч (IndexedDB — картинки бывают большими) ---------- */
const PlayerArchive = (function(){
  const DB = 'reincarnator_archive_v1', ST = 'items';
  async function put(rec){ try{ const d = await rdbOpen(DB, ST, 'id'); await rdbPut(d, ST, [rec]); d.close(); }catch(e){ console.warn('[Архив]', e); } }
  async function all(){ try{ const d = await rdbOpen(DB, ST, 'id'); const r = await rdbAll(d, ST); d.close(); return r.sort((a, b)=>b.t - a.t); }catch(e){ return []; } }
  async function del(id){ try{ const d = await rdbOpen(DB, ST, 'id'); await rdbDel(d, ST, id); d.close(); }catch(e){} }
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  // Простая разметка заметок Мастера: **жирный**, «# заголовок», «- список» — без бросков
  function rich(text){
    let html = '', inList = false;
    String(text || '').split('\n').forEach(l=>{
      const li = l.match(/^\s*[-•*]\s+(.*)$/), b = (s)=>esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      if(li){ if(!inList){ html += '<ul>'; inList = true; } html += '<li>' + b(li[1]) + '</li>'; return; }
      if(inList){ html += '</ul>'; inList = false; }
      const h = l.match(/^\s*#{1,3}\s+(.*)$/);
      html += h ? '<h4>' + b(h[1]) + '</h4>' : l.trim() ? '<p>' + b(l) + '</p>' : '';
    });
    return html + (inList ? '</ul>' : '');
  }
  function show(rec){
    if(typeof NoteMedia!=='undefined') setTimeout(()=>NoteMedia.autoplay(document.querySelector('.ui-dlg:last-of-type') || document), 120); // ролики — сами
    const when = new Date(rec.t).toLocaleString('ru-RU', {day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'});
    return uiDialog({title:rec.title || (rec.kind==='meeting' ? 'Итог встречи' : 'Раздатка'), icon:rec.kind==='meeting' ? '⚑' : '📜',
      html:`<div class="ho-meta">${rec.kind==='meeting' ? 'Итог встречи' : 'От Мастера'} · ${esc(when)}</div>${rec.img ? `<a class="ho-img" href="${rec.img}" target="_blank" rel="noopener"><img src="${rec.img}" alt=""></a>` : ''}${rec.media && rec.media.length && typeof NoteMedia!=='undefined' ? NoteMedia.showHtml(rec.media) : ''}<div class="ho-text">${rich(rec.text)}</div>`,
      cancelValue:null, buttons:[{label:'Скачать текстом', value:'dl'}, {label:'Закрыть', value:null, primary:true}]}).then(r=>{
        document.querySelectorAll('.nm-show video').forEach(v=>{ try{ v.pause(); }catch(e){} });
        if(r==='dl'){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([(rec.title ? rec.title + '\n\n' : '') + rec.text], {type:'text/plain;charset=utf-8'}));
          a.download = (rec.kind==='meeting' ? 'itog-vstrechi-' : 'razdatka-') + new Date(rec.t).toISOString().slice(0, 10) + '.txt'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
      });
  }
  async function openList(){
    const list = await all();
    const r = await uiDialog({title:'Раздатки и итоги встреч', icon:'📜', text:list.length ? 'Всё, что присылал Мастер: раздатки и итоги встреч. Хранится в этом браузере.' : 'Пока пусто: здесь появятся раздатки Мастера и итоги встреч.',
      html:list.length ? `<div class="join-opts">${list.slice(0, 60).map(x=>`<button type="button" class="join-opt" data-ho="${esc(x.id)}"><b>${x.kind==='meeting' ? '⚑ ' : '📜 '}${esc(x.title || 'Без названия')}</b><span>${esc(new Date(x.t).toLocaleString('ru-RU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}))}${x.img || (x.media && x.media.length) ? ' · с медиа' : ''}</span></button>`).join('')}</div>` : '',
      cancelValue:null, buttons:[{label:'Закрыть', value:null, primary:true}]});
    return r;
  }
  document.addEventListener('click', (e)=>{ const b = e.target.closest && e.target.closest('[data-ho]'); if(!b) return;
    all().then(list=>{ const rec = list.find(x=>x.id===b.dataset.ho); if(rec){ document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); setTimeout(()=>show(rec), 250); } }); });
  return { put, all, del, show, openList, rich };
})();

const SessionExtras = (function(){
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  const isGm = ()=>typeof session!=='undefined' && session.role==='gm';
  const isPlayer = ()=>typeof session!=='undefined' && session.role==='player';
  const fromGmOk = (msg)=>isPlayer() && !!msg.from && msg.from===session.gmId;
  const playerName = (id)=>{ const p = session.players && session.players[id]; return (p && ((p.extra && p.extra.name) || p.name)) || (typeof xpRoster!=='undefined' && xpRoster[id]) || 'Игрок'; };

  /* ===== встреча ===== */
  const MEET_KEY = 'reincarnator_meeting_v1';
  let meet = {on:false, start:0}; try{ Object.assign(meet, JSON.parse(localStorage.getItem(MEET_KEY) || '{}')); }catch(e){}
  const saveMeet = ()=>{ try{ localStorage.setItem(MEET_KEY, JSON.stringify(meet)); }catch(e){} };
  async function startMeeting(){
    if(!isGm()){ uiAlert('Встречу начинает Мастер, когда стол открыт («Я — Мастер»).', {icon:'⚑'}); return; }
    const r = await uiDialog({title:'Начать встречу', icon:'⚑', text:'Летопись начнёт новую сессию, игроки увидят «Встреча началась». Снять отметки опыта прошлой встречи?',
      cancelValue:null, buttons:[{label:'Отмена', value:null}, {label:'Начать, отметки оставить', value:'keep'}, {label:'Начать и снять отметки', value:'reset', primary:true}]});
    if(!r) return;
    if(r==='reset' && typeof blankXpChecklist==='function'){ // как «сброс чек-листа», только без второго вопроса
      session.xpChecklist = blankXpChecklist(); xpRoster = {}; Object.keys(session.players).forEach(id=>{ xpRoster[id] = session.players[id].name || 'Игрок'; });
      saveXpRoster(); saveXpChecklist(); renderXpChecklist(); sendMsg({type:'xp-checklist-sync', checklist:session.xpChecklist});
    }
    meet = {on:true, start:Date.now()}; saveMeet();
    if(typeof Chronicle!=='undefined'){ Chronicle.startSession(); Chronicle.add('note', 'Встреча началась'); }
    sendMsg({type:'meet', phase:'start'});
    if(typeof TableLive!=='undefined') TableLive.banner({who:'Встреча началась', text:'Летопись пишет новую сессию', big:'⚑', cls:'success', turn:true}, 4000);
    uiToast('Встреча началась', {icon:'⚑'}); refreshGm();
  }
  function summaryFor(pid){
    const s = typeof Chronicle!=='undefined' && Chronicle.current(); if(!s) return '';
    const name = pid ? playerName(pid) : null, pname = pid && session.players[pid] ? session.players[pid].name : null;
    const main = s.ev.filter(e=>Chronicle.isMain(e) && e.k!=='grant');
    const mine = pid ? s.ev.filter(e=>e.k==='grant' && (e.x.indexOf(name + ':')===0 || (pname && e.x.indexOf(pname + ':')===0))) : s.ev.filter(e=>e.k==='grant');
    const mins = Math.max(1, Math.round((s.last - s.start)/60000));
    return [`# Встреча ${new Date(s.start).toLocaleDateString('ru-RU', {day:'numeric', month:'long'})}, ${Chronicle.hhmm(s.start)}–${Chronicle.hhmm(Date.now())} (${mins} мин)`,
      mine.length ? '# ' + (pid ? 'Вам выдано' : 'Выдано') : '', ...mine.map(e=>'- ' + (pid ? e.x.replace(/^[^:]+:\s*/, '') : e.x)),
      main.length ? '# Главное' : '', ...main.map(e=>`- ${Chronicle.hhmm(e.t)} ${e.n===12 ? '★ ' : e.n===13 ? '✗ ' : ''}${e.x}`)].filter(Boolean).join('\n');
  }
  async function endMeeting(){
    if(!isGm()) return;
    const ids = Object.keys(session.players || {});
    const r = await uiDialog({title:'Завершить встречу', icon:'⚑', text:`Каждому игроку за столом (${ids.length}) придёт итог: главное из летописи и его выдачи — опыт, удача, находки. Итог сохранится у игроков в «📜 Раздатки и итоги встреч».`,
      html:`<details class="ho-prev"><summary>Как выглядит итог</summary><div class="ho-text">${PlayerArchive.rich(summaryFor(ids[0] || null) || 'Летопись этой встречи пуста.')}</div></details>`,
      cancelValue:null, buttons:[{label:'Отмена', value:null}, {label:'Завершить и разослать', value:'go', primary:true}]});
    if(r!=='go') return;
    if(typeof Chronicle!=='undefined') Chronicle.add('note', 'Встреча завершена');
    ids.forEach(id=>sendMsg({type:'meet', phase:'end', summary:summaryFor(id).slice(0, 12000)}, id));
    meet = {on:false, start:0}; saveMeet();
    uiToast(`Встреча завершена — итог у ${ids.length} ${ids.length===1 ? 'игрока' : 'игроков'}`, {icon:'⚑'}); refreshGm();
  }
  function onMeet(msg){
    if(!fromGmOk(msg)) return;
    if(msg.phase==='start'){ if(typeof TableLive!=='undefined') TableLive.banner({who:'Встреча началась', text:'Удачной игры!', big:'⚑', cls:'success', turn:true}, 4500); uiToast('Мастер начал встречу', {icon:'⚑'}); }
    else if(msg.phase==='end'){
      const rec = {id:'m' + Date.now().toString(36), kind:'meeting', t:Date.now(), title:'Итог встречи', text:String(msg.summary || '').slice(0, 12000)};
      PlayerArchive.put(rec); PlayerArchive.show(rec);
    }
  }
  function meetingRowHtml(){
    if(!isGm()) return '';
    const dur = meet.on ? Math.max(1, Math.round((Date.now() - meet.start)/60000)) : 0;
    return `<div class="gs-row gs-meet">${meet.on ? `<span class="gs-chip on" title="Встреча идёт">⚑ ${dur} мин</span><button type="button" class="gs-btn" data-x="meet-end" title="Разослать игрокам итог встречи">■ Завершить встречу</button>`
        : `<button type="button" class="gs-btn primary" data-x="meet-start" title="Новая сессия летописи, сброс отметок опыта, игрокам — «Встреча началась»">▶ Начать встречу</button>`}
      <button type="button" class="gs-btn${paused ? ' primary' : ''}" data-x="pause" title="Стоп-кадр: игроки не двигают жетоны, у всех плашка «Пауза»">${paused ? '▶ Снять паузу' : '⏸ Стоп-кадр'}</button>
      <button type="button" class="gs-btn" data-x="qr" title="QR-код ссылки на стол — игроки за живым столом заходят с телефонов">▦ QR</button></div>`;
  }
  const refreshGm = ()=>{ if(typeof GmScreen!=='undefined') GmScreen.refresh(); };

  /* ===== раздатки ===== */
  function shrinkImage(file){
    return new Promise((res, rej)=>{ const url = URL.createObjectURL(file), img = new Image();
      img.onload = ()=>{ const k = Math.min(1, 1280/Math.max(img.width, img.height)), cv = document.createElement('canvas'); cv.width = Math.round(img.width*k); cv.height = Math.round(img.height*k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        let d = cv.toDataURL('image/webp', 0.8); if(!/^data:image\/webp/.test(d)) d = cv.toDataURL('image/jpeg', 0.82);
        if(d.length > 1500000) d = cv.toDataURL('image/jpeg', 0.6); res(d); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error('не удалось открыть картинку')); }; img.src = url; });
  }
  // mediaIds — медиа заметки (по умолчанию все из отправляемого текста); mediaOnly — только они, без текста («📜» у медиа)
  async function sendHandout(note, selection, mediaIds, mediaOnly){
    if(!isGm()){ uiAlert('Раздатки отправляются игрокам за столом — начните сессию «Я — Мастер».', {icon:'📜'}); return; }
    const ids = Object.keys(session.players || {});
    if(!ids.length){ uiAlert('За столом пока никого нет.', {icon:'📜'}); return; }
    const NM = typeof NoteMedia!=='undefined' ? NoteMedia : null;
    const media = (mediaIds || (NM && !selection ? NM.idsIn(note.text) : [])).slice(0, 12);
    const text = mediaOnly ? '' : NM ? NM.stripRefs(selection || note.text || '') : (selection || note.text || '').trim();
    let img = '';
    const html = `<div class="ho-send"><div class="gs-muted">${mediaOnly ? 'Будет отправлено только это медиа.' : selection ? 'Будет отправлен выделенный кусок заметки.' : 'Будет отправлена вся заметка. Чтобы отправить кусок — выделите его в заметке и нажмите «📜» снова.'}${media.length ? ` Медиа: ${media.length} — загрузятся на сервер игры при отправке; ролики у игроков запустятся сами.` : ''}</div>
      <div class="ho-text ho-prev-box">${PlayerArchive.rich(text) || '<span class="gs-muted">без текста</span>'}</div>
      <div class="gs-row"><button type="button" class="gs-btn" data-ho-img>🖼 Картинка…</button><span class="ho-img-name gs-muted"></span></div>
      <div class="ho-who"><label><input type="checkbox" data-all checked> <b>Всем за столом</b></label>${ids.map(id=>`<label><input type="checkbox" data-pid="${esc(id)}" checked> ${esc(playerName(id))}</label>`).join('')}</div></div>`;
    const title0 = mediaOnly && NM && media.length===1 ? (NM.captionOf(note.text, media[0]) || note.title || 'Раздатка') : (note.title || 'Раздатка');
    const pr = uiDialog({title:'Раздатка игрокам', icon:'📜', html, fields:[{name:'title', label:'Заголовок', value:title0.slice(0, 80)}], cancelValue:null,
      buttons:[{label:'Отмена', value:null}, {label:'Отправить', value:(v)=>v, primary:true}]});
    setTimeout(()=>{
      const box = document.querySelector('.ui-dlg .ho-send'); if(!box) return;
      box.querySelector('[data-ho-img]').onclick = ()=>{ const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = ()=>{ const f = inp.files && inp.files[0]; if(!f) return; shrinkImage(f).then(d=>{ img = d; box.querySelector('.ho-img-name').textContent = '✓ ' + f.name; }).catch(e=>uiAlert(e.message)); }; inp.click(); };
      const all = box.querySelector('[data-all]'), each = [...box.querySelectorAll('[data-pid]')];
      all.onchange = ()=>each.forEach(c=>{ c.checked = all.checked; }); each.forEach(c=>{ c.onchange = ()=>{ all.checked = each.every(x=>x.checked); }; });
      box._pick = ()=>each.filter(c=>c.checked).map(c=>c.dataset.pid);
    }, 0);
    let picked = ids; const watch = setInterval(()=>{ const b = document.querySelector('.ui-dlg .ho-send'); if(b && b._pick) picked = b._pick(); }, 150);
    const r = await pr; clearInterval(watch);
    if(!r) return;
    if(!text && !img && !media.length){ uiAlert('Пустая раздатка: нет ни текста, ни картинки.', {icon:'📜'}); return; }
    if(!picked.length){ uiAlert('Не выбран ни один игрок.', {icon:'📜'}); return; }
    const up = [];
    if(media.length){
      uiToast(`Загрузка медиа на сервер игры: ${media.length}…`, {icon:'⬆', ms:20000});
      try{ for(const id of media){ const u = await NM.upload(id); up.push({url:u.url, cap:NM.captionOf(note.text, id)}); } }
      catch(e){ uiAlert('Не удалось загрузить медиа: ' + e.message, {title:'Раздатка', icon:'⚠'}); return; }
    }
    const ho = {id:'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title:(r.title || 'Раздатка').trim().slice(0, 80), text:text.slice(0, 12000), img, media:up};
    picked.forEach(id=>sendMsg({type:'handout', ho}, id));
    if(typeof Chronicle!=='undefined') Chronicle.add('note', `Раздатка «${ho.title}» → ${picked.length===ids.length ? 'всем' : picked.map(playerName).join(', ')}`);
    uiToast(`Раздатка «${ho.title}» отправлена: ${picked.length}`, {icon:'📜'});
  }
  function onHandout(msg){
    if(!fromGmOk(msg) || !msg.ho) return;
    const h = msg.ho, img = typeof h.img==='string' && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(h.img) && h.img.length < 2500000 ? h.img : '';
    const rec = {id:String(h.id || Date.now()).slice(0, 40), kind:'handout', t:Date.now(), title:String(h.title || 'Раздатка').slice(0, 80), text:String(h.text || '').slice(0, 12000), img,
      media:typeof NoteMedia!=='undefined' ? NoteMedia.sanitize(h.media) : []};
    PlayerArchive.put(rec); PlayerArchive.show(rec);
  }

  /* ===== QR ===== */
  function showQr(){
    const link = typeof roomLink==='function' && currentRoomCode ? roomLink(currentRoomCode) : location.href;
    let svg = ''; try{ svg = QrCode.svg(link, 260); }catch(e){ uiAlert('QR: ' + e.message); return; }
    uiDialog({title:'Ссылка на стол', icon:'▦', html:`<div class="qr-box">${svg}</div><div class="qr-link">${esc(link)}</div><div class="gs-muted">Наведите камеру телефона на код — откроется стол. Ссылку можно и просто отправить игрокам.</div>`,
      cancelValue:null, buttons:[{label:'Копировать ссылку', value:'copy'}, {label:'Закрыть', value:null, primary:true}]})
      .then(r=>{ if(r==='copy') (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(()=>uiToast('Ссылка скопирована', {icon:'⧉'}), ()=>uiPrompt('Ссылка на стол:', link)); });
  }

  /* ===== сообщения и тайные броски: строка под логом ===== */
  let roster = []; // (игрок) кто за столом — от Мастера: [{id, name}]
  let tools = null;
  function buildTools(){
    tools = document.createElement('div'); tools.className = 'log-tools';
    tools.innerHTML = `<div class="lt-row"><select class="lt-to" title="Кому: всем или лично"></select><input class="lt-text" type="text" maxlength="500" placeholder="Сообщение…" autocomplete="off"><button type="button" class="small lt-send" title="Отправить (Enter)">➤</button>
      <button type="button" class="small lt-secret" aria-pressed="false" title="🤫 Тайные броски: следующие броски (лист, кость к20, кости) видит только Мастер; вы — нет. Остальные видят «бросил тайно»">🤫</button></div>`;
    tools.querySelector('.lt-send').onclick = sendChat;
    tools.querySelector('.lt-text').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });
    tools.querySelector('.lt-secret').onclick = ()=>setSecret(!secretRollOn);
  }
  function syncTools(){
    const list = document.getElementById('rollLogList'); if(!list || !list.parentNode) return;
    if(!tools) buildTools();
    if(tools.nextSibling!==list || tools.parentNode!==list.parentNode) list.parentNode.insertBefore(tools, list); // лог переезжает к столу — строка за ним
    const on = !!session.role; tools.style.display = on ? '' : 'none'; if(!on) return;
    const sel = tools.querySelector('.lt-to'), cur = sel.value;
    const opts = [['', 'Всем']];
    if(isPlayer() && session.gmId) opts.push(['gm', '🤫 Мастеру']);
    (isGm() ? Object.keys(session.players || {}).map(id=>({id, name:playerName(id)})) : roster.filter(x=>x.id!==session.myId)).forEach(x=>opts.push([x.id, '🤫 ' + x.name]));
    const sig = opts.map(o=>o.join(':')).join('|');
    if(sel._sig!==sig){ sel._sig = sig; sel.innerHTML = opts.map(([v, l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join(''); sel.value = opts.some(o=>o[0]===cur) ? cur : ''; }
    tools.querySelector('.lt-secret').classList.toggle('on', secretRollOn);
    tools.querySelector('.lt-secret').setAttribute('aria-pressed', String(secretRollOn));
  }
  function sendChat(){
    const inp = tools.querySelector('.lt-text'), text = inp.value.trim(); if(!text) return;
    if(!session.ws || session.ws.readyState!==WebSocket.OPEN){ uiToast('Нет связи со столом', {icon:'⚠'}); return; }
    const to = tools.querySelector('.lt-to').value;
    session.rollCounter++;
    const entry = {id:getDeviceId() + ':' + session.rollCounter, kind:'quick', chat:true, player:session.ownName || 'Аноним', text:text.slice(0, 500)};
    if(to){ entry.priv = true; entry.to = to; entry.fromId = session.myId || ''; entry.toName = to==='gm' ? 'Мастер' : (isGm() ? playerName(to) : ((roster.find(x=>x.id===to) || {}).name || 'игрок')); }
    addRollLogEntry(entry);
    if(!to) sendMsg({type:'roll', entry});
    else { const target = to==='gm' ? session.gmId : to; sendMsg({type:'roll', entry}, target); if(isPlayer() && to!=='gm' && session.gmId) sendMsg({type:'roll', entry}, session.gmId); } // шёпот игроку — копия Мастеру
    inp.value = '';
  }
  function setSecret(on){
    secretRollOn = !!on; document.body.classList.toggle('secret-rolls', secretRollOn); syncTools();
    let badge = document.getElementById('secretBadge');
    if(secretRollOn && !badge){ badge = document.createElement('button'); badge.type = 'button'; badge.id = 'secretBadge'; badge.className = 'secret-badge'; badge.title = 'Выключить тайные броски';
      badge.textContent = '🤫 Тайные броски — нажмите, чтобы выключить'; badge.onclick = ()=>setSecret(false); document.body.appendChild(badge); }
    if(!secretRollOn && badge) badge.remove();
    uiToast(secretRollOn ? (isGm() ? 'Тайные броски: игроки видят только «Мастер бросил тайно»' : 'Тайные броски: результат увидит только Мастер') : 'Тайные броски выключены', {icon:'🤫'});
  }
  // (Мастер) кто за столом — игрокам для списка «кому»
  let rosterSig = '';
  function broadcastRoster(force){
    if(!isGm()) return;
    const list = Object.keys(session.players || {}).map(id=>({id, name:playerName(id)}));
    const sig = JSON.stringify(list); if(!force && sig===rosterSig) return; rosterSig = sig;
    sendMsg({type:'roster', list});
  }

  /* ===== стоп-кадр ===== */
  let paused = false;
  function setPause(on, fromNet){
    paused = !!on; if(typeof GameTable!=='undefined' && GameTable.setPaused) GameTable.setPaused(paused);
    document.body.classList.toggle('table-paused', paused);
    let bar = document.getElementById('pauseBar');
    if(paused && !bar){ bar = document.createElement('div'); bar.id = 'pauseBar'; bar.className = 'pause-bar'; document.body.appendChild(bar); }
    if(bar) bar.innerHTML = paused ? (isGm() ? '⏸ Стоп-кадр: игроки не двигают жетоны <button type="button" class="small" data-x="pause">Снять</button>' : '⏸ Пауза — Мастер думает') : '';
    if(!paused && bar) bar.remove();
    if(isGm() && !fromNet) sendMsg({type:'pause', on:paused});
    refreshGm();
  }

  /* ===== связь игроков ===== */
  const conn = {}, gone = {}; let known = {};
  setInterval(()=>{
    if(!isGm()) return;
    const now = Date.now();
    Object.keys(session.players || {}).forEach(id=>{ sendMsg({type:'cping', t:now}, id); conn[id] = conn[id] || {rtt:null, last:now, sent:now}; conn[id].sent = now; });
    // кто пропал из списка — «отключился N назад»
    const cur = {}; Object.keys(session.players || {}).forEach(id=>{ cur[id] = playerName(id); delete gone[id]; });
    Object.keys(known).forEach(id=>{ if(!cur[id]) gone[id] = {name:known[id], at:now}; });
    known = cur;
    Object.keys(gone).forEach(id=>{ if(now - gone[id].at > 30*60000) delete gone[id]; });
    broadcastRoster(false);
  }, 8000);
  function connState(id){
    const c = conn[id]; if(!c || c.rtt==null) return {cls:'on', txt:'на связи'};
    const age = Date.now() - c.last;
    if(age > 25000) return {cls:'lost', txt:`не отвечает ${Math.round(age/1000)} с`};
    if(c.rtt > 700) return {cls:'slow', txt:`связь медленная: отклик ${c.rtt} мс`};
    return {cls:'on', txt:`отклик ${c.rtt} мс`};
  }
  function connDot(id){ const s = connState(id); return `<span class="gs-dot ${s.cls}" title="${esc(s.txt)}"></span>`; }
  function goneHtml(){
    const ids = Object.keys(gone); if(!ids.length) return '';
    const ago = (t)=>{ const s = Math.round((Date.now() - t)/1000); return s < 60 ? s + ' с' : Math.round(s/60) + ' мин'; };
    return `<div class="gs-gone">${ids.map(id=>`<span class="gs-chip red" title="Игрок пропал со связи — выдачи Мастера дойдут, когда он вернётся">⚠ ${esc(gone[id].name)} — отключился ${ago(gone[id].at)} назад</span>`).join('')}</div>`;
  }

  /* ===== сообщения сессии ===== */
  function handle(msg){
    switch(msg.type){
      case 'meet': onMeet(msg); return true;
      case 'handout': onHandout(msg); return true;
      case 'pause': if(fromGmOk(msg)) setPause(!!msg.on, true); return true;
      case 'roster': if(fromGmOk(msg) && Array.isArray(msg.list)) roster = msg.list.slice(0, 40).map(x=>({id:String(x && x.id || '').slice(0, 64), name:String(x && x.name || 'Игрок').slice(0, 60)})).filter(x=>x.id); return true;
      case 'cping': if(fromGmOk(msg)) sendMsg({type:'cpong', t:msg.t}, session.gmId); return true;
      case 'cpong': if(isGm() && msg.from && conn[msg.from]){ const t = +msg.t; if(t > 0){ conn[msg.from].rtt = Math.max(0, Date.now() - t); conn[msg.from].last = Date.now(); } } return true;
    }
    return false;
  }
  function onPlayerHello(id){ if(paused) sendMsg({type:'pause', on:true}, id); broadcastRoster(true); conn[id] = {rtt:null, last:Date.now(), sent:Date.now()}; }

  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-x]'); if(!b) return;
    const x = b.dataset.x;
    if(x==='meet-start') startMeeting(); else if(x==='meet-end') endMeeting();
    else if(x==='pause') setPause(!paused); else if(x==='qr') showQr();
  });
  setInterval(syncTools, 1000); setTimeout(syncTools, 300);

  return { startMeeting, endMeeting, sendHandout, showQr, handle, onPlayerHello, meetingRowHtml, connDot, goneHtml, setSecret, get paused(){ return paused; }, get meeting(){ return meet; } };
})();

/* ---------- проверка версии сервера ---------- */
const ServerCheck = (function(){
  const NEED = 2; // см. SERVER_PROTOCOL в server.js
  function onWelcome(msg){
    const old = !(Number(msg.ver) >= NEED) || (typeof currentRoomCode!=='undefined' && currentRoomCode && msg.room!==currentRoomCode);
    let bar = document.getElementById('serverOldBar');
    if(!old){ if(bar) bar.remove(); return; }
    if(!bar){ bar = document.createElement('div'); bar.id = 'serverOldBar'; bar.className = 'server-old-bar'; document.body.appendChild(bar); }
    bar.innerHTML = (session.role==='gm' || !session.role
      ? '⚠ Сервер игры старой версии: столы-комнаты, загрузка реакций и проверка Мастера могут не работать. Перезапустите server.js (или пересоберите приложение на хостинге).'
      : '⚠ Сервер игры старой версии — сообщите Мастеру: ему нужно перезапустить сервер.') + ' <button type="button" class="small" onclick="this.parentNode.remove()">✕</button>';
  }
  return { onWelcome };
})();

/* ---------- «Сообщить о проблеме» ---------- */
const ProblemReport = (function(){
  const errs = [];
  const push = (s)=>{ errs.push(new Date().toLocaleTimeString('ru-RU') + ' ' + String(s).slice(0, 500)); if(errs.length > 40) errs.shift(); };
  window.addEventListener('error', (e)=>push(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e)=>push('promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  const ce = console.error; console.error = function(){ try{ push([...arguments].map(a=>a && a.stack ? a.stack.split('\n').slice(0, 2).join(' ') : typeof a==='object' ? JSON.stringify(a) : String(a)).join(' ')); }catch(e){} return ce.apply(console, arguments); };
  function report(what){
    const ws = session.ws ? ['подключается', 'открыто', 'закрывается', 'закрыто'][session.ws.readyState] : 'нет';
    const banner = document.querySelector('.boot-error-banner, #bootErrorBanner');
    return ['РЕИНКАРНАТОР — отчёт о проблеме', new Date().toLocaleString('ru-RU'), '',
      'Что случилось: ' + (what || '(не описано)'), '',
      `Адрес: ${location.origin}${location.pathname}`, `Роль: ${session.role || 'без сессии'} · стол: ${typeof currentRoomCode!=='undefined' && currentRoomCode || 'общий'} · связь: ${ws}${session.role==='player' ? ' · Мастер: ' + (session.gmId ? 'на связи' : 'нет') : ''}${session.role==='gm' ? ' · игроков: ' + Object.keys(session.players || {}).length : ''}`,
      `Браузер: ${navigator.userAgent}`, `Экран: ${screen.width}×${screen.height}, окно ${innerWidth}×${innerHeight}, dpr ${devicePixelRatio} · тема: ${document.documentElement.dataset.theme || 'светлая'}${document.documentElement.classList.contains('lite') ? ' · облегчённый режим' : ''}`,
      `Установлено как приложение: ${matchMedia('(display-mode: standalone)').matches ? 'да' : 'нет'} · сервис-воркер: ${navigator.serviceWorker && navigator.serviceWorker.controller ? 'да' : 'нет'}`,
      banner ? 'Красная плашка: ' + banner.textContent.trim().slice(0, 400) : '',
      '', 'Последние ошибки:', ...(errs.length ? errs : ['— нет'])].join('\n');
  }
  async function open(){
    const r = await uiDialog({title:'Сообщить о проблеме', icon:'🐞', text:'Опишите, что произошло, — к описанию добавится техническая часть: роль, связь, браузер и последние ошибки страницы. Личных данных и листа персонажа там нет. Скопируйте и пришлите Мастеру или разработчику.',
      fields:[{name:'what', label:'Что случилось', multiline:true, rows:3, value:''}], cancelValue:null,
      buttons:[{label:'Отмена', value:null}, {label:'Скачать .txt', value:(v)=>Object.assign({how:'dl'}, v)}, {label:'Копировать отчёт', value:(v)=>Object.assign({how:'copy'}, v), primary:true}]});
    if(!r) return;
    const text = report((r.what || '').trim());
    if(r.how==='dl'){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'})); a.download = 'reinkarnator-problema.txt'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(()=>uiToast('Отчёт скопирован — вставьте его в сообщение', {icon:'🐞'}), ()=>uiPrompt('Скопируйте отчёт:', text));
  }
  return { open, report, get errors(){ return errs.slice(); } };
})();

/* ---------- облегчённый режим для слабых устройств ---------- */
const LiteMode = (function(){
  const KEY = 'reincarnator_lite_v1';
  let mode = 'auto'; try{ mode = localStorage.getItem(KEY) || 'auto'; }catch(e){}
  const apply = (on)=>document.documentElement.classList.toggle('lite', !!on);
  if(mode==='on') apply(true);
  // «Авто»: первые 6 с после загрузки меряем кадры; стабильно меньше ~30 кадров/с — включаем и говорим об этом
  if(mode==='auto') setTimeout(()=>{
    if(document.hidden) return;
    let n = 0; const t0 = performance.now();
    const tick = ()=>{ n++; if(performance.now() - t0 < 3000) requestAnimationFrame(tick); else if(n/3 < 28 && !document.hidden){ apply(true);
      uiToast('Устройство не успевает — включён облегчённый режим (без фактур и анимаций)', {icon:'🪶', action:{label:'Выключить', run:()=>set('off')}}); } };
    requestAnimationFrame(tick);
  }, 6000);
  function set(m){ mode = m; try{ localStorage.setItem(KEY, m); }catch(e){} apply(m==='on'); }
  async function openSettings(){
    const r = await uiDialog({title:'Облегчённый режим', icon:'🪶', text:'Без фактур бумаги, размытий, анимаций и ползания капель — для слабых телефонов и старых ноутбуков. Сейчас: ' + (document.documentElement.classList.contains('lite') ? 'включён' : 'выключен') + '.',
      cancelValue:null, buttons:[{label:'Авто', value:'auto'}, {label:'Выключен', value:'off'}, {label:'Включён', value:'on', primary:true}]});
    if(r){ set(r); uiToast(r==='auto' ? 'Облегчённый режим: включится сам, если устройство не успевает' : r==='on' ? 'Облегчённый режим включён' : 'Облегчённый режим выключен', {icon:'🪶'}); }
  }
  return { set, openSettings, get mode(){ return mode; } };
})();

/* ---------- «Предметы к встрече» (экран Мастера → «Заметки» → «Предметы»): список, который Мастер готовит заранее ----------
   Из каталога книги (поиск по названию), по таблицам Находок (к20/к12, «Вещи мертвецов» по книге, состояние к12) или
   своё. Во время игры — «Выдать →» игроку: та же выдача с подтверждением, что у «⛏ Находка», запись в логе. */
const PrepItems = (function(){
  const KEY = 'reincarnator_gm_items_v1';
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  let items = []; try{ const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if(Array.isArray(v)) items = v; }catch(e){}
  let root = null;
  const save = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(items)); }catch(e){} };
  const uid = ()=>'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const catOf = (w)=>/Крш/.test(String(w || '')) ? 'tiny' : 'backpack';
  function add(it){ items.unshift(Object.assign({id:uid(), weight:'—', category:'backpack', src:'own'}, it)); save(); if(root && root.isConnected) render(root); }
  // каталог книги одним списком
  let flat = null;
  function catalog(){ if(flat) return flat; flat = [];
    Object.values(ITEM_CATALOG).forEach(g=>Object.values(g.categories).forEach(c=>Object.values(c.items).forEach(it=>flat.push({it, where:g.label + ' / ' + c.label})))); return flat; }
  const norm = (s)=>String(s).toLowerCase().replace(/ё/g, 'е');
  async function pickFromCatalog(){
    const pr = uiDialog({title:'Из каталога книги', icon:'📖', html:`<input type="search" class="pi-search" placeholder="Название: «аптечка», «АК», «рацион»…" autocomplete="off"><div class="pi-found join-opts"></div>
      <div class="gs-muted">Нажмите на предмет — он добавится в список (можно несколько подряд).</div>`, cancelValue:null, buttons:[{label:'Готово', value:null, primary:true}]});
    setTimeout(()=>{
      const box = document.querySelector('.ui-dlg .pi-found'), inp = document.querySelector('.ui-dlg .pi-search'); if(!box) return;
      const draw = ()=>{ const q = norm(inp.value.trim()), all = catalog();
        const hit = (q ? all.filter(x=>norm(x.it.name).includes(q) || norm(x.where).includes(q)) : all).slice(0, 40);
        box.innerHTML = hit.map((x)=>`<button type="button" class="join-opt" data-pi="${all.indexOf(x)}"><b>${esc(x.it.name)}</b><span>${esc(x.where)} · ${esc(x.it.weight)}${x.it.price ? ' · ' + x.it.price + ' кр.' : ''}</span></button>`).join('') || '<div class="gs-muted">Ничего не нашлось.</div>'; };
      inp.addEventListener('input', draw); draw(); inp.focus();
      box.addEventListener('click', (e)=>{ const b = e.target.closest('[data-pi]'); if(!b) return; const x = catalog()[+b.dataset.pi];
        add({name:`${x.it.name} — ${x.it.desc}`, weight:x.it.weight, category:catOf(x.it.weight), src:'catalog'}); b.classList.add('primary'); uiToast('В список: ' + x.it.name, {icon:'+'}); });
    }, 0);
    await pr;
  }
  // Находка по таблицам книги — тот же разбор строк, что и в окне «⛏ Находка», без выдачи
  function rollLoot(die, cond){
    const steps = []; const r = randInt(die); let key = lootFind(LOOT_MAIN, r)[2];
    steps.push(`к${die}=${r}`);
    if(key==='dead'){ const a = randInt(12), b = randInt(12), v = Math.min(12, Math.min(a, b)); key = lootFind(LOOT_DEAD_CATEGORIES, v)[2]; steps.push(`2к12=[${a}, ${b}]→${v}`); }
    const t = LOOT_TABLES[key]; const r2 = randInt(t.die); steps.push(`«${t.title}» к${t.die}=${r2}`);
    let it = lootResolveRow(lootFind(t.rows, r2), steps), note = '';
    if(it.pick){ const rows = LOOT_TABLES.artifacts.rows, i = Math.floor(Math.random()*rows.length); it = lootResolveRow(rows[i], steps); note = ' (артефакт выбран случайно — можно заменить ✎)'; }
    let text = it.gmText ? 'Реликвия: опишите — ✎' : it.text, price = it.price;
    if(cond && !it.gmText){ const cr = randInt(12), row = lootFind(LOOT_CONDITION, cr), div = row[3];
      text += ` [состояние: ${row[2]}${div>1 ? `, цена продажи ÷${div}` : ''}]`; if(div>1 && typeof price==='number') price = Math.round(price/div); steps.push(`состояние к12=${cr}`); }
    if(price!=='' && price!=null) text += ` (цена ${price})`;
    add({name:(text + note).slice(0, 2000), weight:lootFormatWeight(it.weight), category:it.weight && it.weight.unit==='Крш' ? 'tiny' : 'backpack', src:'loot', how:steps.join(' → ').slice(0, 300)});
  }
  async function own(existing){
    const r = await uiForm(existing ? 'Предмет' : 'Свой предмет', [{name:'name', label:'Название и свойства', value:existing ? existing.name : '', multiline:true, rows:3},
      {name:'weight', label:'Вес (например «1 Вещь», «2 Крш», «—»)', value:existing ? existing.weight : '1 Вещь'}], {ok:'Сохранить'});
    if(!r || !(r.name || '').trim()) return;
    if(existing){ existing.name = r.name.trim().slice(0, 2000); existing.weight = (r.weight || '—').trim().slice(0, 30); existing.category = catOf(existing.weight); save(); render(root); }
    else add({name:r.name.trim().slice(0, 2000), weight:(r.weight || '—').trim().slice(0, 30), category:catOf(r.weight), src:'own'});
  }
  async function give(it){
    if(typeof session==='undefined' || session.role!=='gm'){ uiAlert('Выдать предмет можно, когда стол открыт («Я — Мастер») и игроки подключены.', {icon:'⛏'}); return; }
    const ids = Object.keys(session.players || {});
    if(!ids.length){ uiAlert('За столом пока никого нет.', {icon:'⛏'}); return; }
    const nm = (id)=>{ const p = session.players[id]; return (p.extra && p.extra.name) ? `${p.extra.name} (${p.name})` : p.name || 'Игрок'; };
    const pid = ids.length===1 ? ids[0] : await uiDialog({title:'Кому выдать', icon:'⛏', text:it.name.slice(0, 160) + (it.name.length > 160 ? '…' : ''), cancelValue:null,
      buttons:ids.map(id=>({label:nm(id), value:id})).concat([{label:'Отмена', value:null}])});
    if(!pid || !session.players[pid]) return;
    sendGrant(pid, {kind:'item', item:{name:it.name, weight:it.weight, category:it.category}});
    const short = it.name.length > 140 ? it.name.slice(0, 140) + '…' : it.name;
    recordAndShareQuickRoll({loot:true, target:session.players[pid].name || 'игрок', text:`из списка Мастера → «${short}» (${it.weight})`});
    if(typeof GmAdvice!=='undefined') GmAdvice.event('loot');
    it.given = {to:session.players[pid].name || 'игрок', at:Date.now()}; save(); render(root);
    uiToast('Выдано: ' + (session.players[pid].name || 'игрок'), {icon:'⛏'});
  }
  function render(el){
    root = el;
    const open = items.filter(x=>!x.given), done = items.filter(x=>x.given);
    const row = (it)=>`<div class="pi-item${it.given ? ' given' : ''}" data-id="${esc(it.id)}"><div class="pi-name" title="${esc(it.name)}${it.how ? '\n\nБроски: ' + esc(it.how) : ''}">${it.src==='loot' ? '🎲 ' : it.src==='catalog' ? '📖 ' : ''}${esc(it.name.length > 150 ? it.name.slice(0, 150) + '…' : it.name)}</div>
      <div class="pi-meta"><span class="gs-muted">${esc(it.weight)}${it.given ? ` · выдано: ${esc(it.given.to)}, ${new Date(it.given.at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}` : ''}</span>
      <span class="pi-btns">${it.given ? `<button type="button" class="gs-btn small" data-p="back" title="Вернуть в список (у игрока предмет останется)">↺</button>` : `<button type="button" class="gs-btn small primary" data-p="give" title="Выдать игроку: предмет придёт в его инвентарь">Выдать →</button>`}<button type="button" class="gs-btn small" data-p="edit" title="Править">✎</button><button type="button" class="gs-btn small" data-p="del" title="Убрать из списка">🗑</button></span></div></div>`;
    el.innerHTML = `<div class="gs-row"><button type="button" class="gs-btn" data-p="cat" title="Предмет из каталога книги — с описанием и свойствами">＋ Каталог</button>
        <button type="button" class="gs-btn" data-p="loot20" title="Находка по таблицам книги: к20 (как «⛏ Находка»), с состоянием">🎲 Находка к20</button>
        <button type="button" class="gs-btn" data-p="loot12" title="Находка по таблицам книги: к12">🎲 к12</button>
        <button type="button" class="gs-btn" data-p="own" title="Свой предмет">＋ Своё</button></div>
      ${open.length ? open.map(row).join('') : '<div class="gs-empty">Список пуст. Подготовьте к встрече: предметы из каталога книги, находки по таблицам (выпадут заранее — можно поправить) или свои. Во время игры — «Выдать →».</div>'}
      ${done.length ? `<div class="gs-sub" style="margin-top:10px">Выдано (${done.length})</div>${done.map(row).join('')}<div class="gs-row"><button type="button" class="gs-btn small" data-p="clear-given">Убрать выданные</button></div>` : ''}`;
  }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-p]'); if(!b || !root || !root.contains(b)) return;
    const host = b.closest('[data-id]'), it = host ? items.find(x=>x.id===host.dataset.id) : null;
    switch(b.dataset.p){
      case 'cat': pickFromCatalog(); break;
      case 'loot20': rollLoot(20, true); uiToast('В список: находка по таблицам (к20)', {icon:'🎲'}); break;
      case 'loot12': rollLoot(12, true); uiToast('В список: находка по таблицам (к12)', {icon:'🎲'}); break;
      case 'own': own(null); break;
      case 'edit': if(it) own(it); break;
      case 'give': if(it) give(it); break;
      case 'back': if(it){ delete it.given; save(); render(root); } break;
      case 'del': if(it){ const at = items.indexOf(it); items.splice(at, 1); save(); render(root);
        uiToast('Предмет убран из списка', {icon:'✕', action:{label:'Отменить', run:()=>{ items.splice(Math.min(at, items.length), 0, it); save(); if(root) render(root); }}}); } break;
      case 'clear-given': { const was = items.slice(); items = items.filter(x=>!x.given); save(); render(root);
        uiToast('Выданные убраны', {icon:'✕', action:{label:'Отменить', run:()=>{ items = was; save(); if(root) render(root); }}}); break; }
    }
  });
  return { render, get list(){ return items; }, importList(arr){ (Array.isArray(arr) ? arr : []).forEach(x=>{ if(x && typeof x.name==='string') items.push(Object.assign({}, x, {id:uid()})); }); save(); } };
})();
