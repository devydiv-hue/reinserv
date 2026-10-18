/* ======================================================================
   РЕАКЦИИ — гифки на жетонах. Жетон ненадолго вырастает, оставаясь кругом, и показывает анимацию внутри: она
   обрезана по кругу (вокруг точки кадрирования), за его границей ничего нет. Видно всем за столом одновременно.
   Всё настраивает Мастер (экран Мастера → «Реакции»): включены ли реакции, могут ли игроки показывать их вручную на
   своём жетоне, размер круга и длительность, какие реакции на какие события, своя библиотека (GIF, WebP, PNG, MP4,
   WebM до 3 МБ — файл хранится на сервере игры). Встроенный набор нарисован кодом — файлов не нужно.
   События: нат. 12 («Крит!»), нат. 13 с провалом («Провал!»), попадание и промах атаки с карты, ранение, травма,
   «повержен» (ОЗ ≤ 0), трата удачи, провал инициативы, начало боя, ход стороны, новый уровень.
   Сеть: решает Мастер — игрок присылает ему просьбу (свой жетон: ручная реакция или нат. 12/13 своего броска),
   Мастер проверяет и рассылает показ ('gt-rx'); настройки для игроков — 'gt-rxcfg'. Без сессии и на учебном столе —
   всё локально.
   ====================================================================== */
const Reactions = (function(){
  const CFG_KEY = 'reincarnator_reactions_v1';
  const URL_RE = /^\/user-reactions\/[a-z0-9]{8,40}\.(gif|webp|png|mp4|webm)$/;
  const EVENTS = [
    ['crit', 'Крит! — натуральная 12', 'Выпало 12: автоматический успех с лучшей категорией. Над тем, кто бросал (лист, кости, существо, атака с карты).', true],
    ['fumble', 'Провал! — натуральная 13', 'Выпало 13, и проверка провалена.', true],
    ['hit', 'Попадание', 'Атака с карты попала — над атакующим.', false],
    ['miss', 'Промах', 'Атака с карты не попала — над атакующим.', false],
    ['hurt', 'Ранен', 'ОЗ жетона уменьшились.', false],
    ['trauma', 'Травма', 'Жетон получил травму.', true],
    ['down', 'Повержен', 'ОЗ упали до 0 или ниже.', true],
    ['luck', 'Удача', 'Игрок потратил удачу.', true],
    ['init_fail', 'Замешкался', 'Провал проверки инициативы — без действия в этом круге.', true],
    ['combat_start', 'В бой!', 'Начало боя — над всеми участниками сразу.', true],
    ['turn', 'Ход стороны', 'Начало хода стороны — над её участниками.', false],
    ['levelup', 'Новый уровень', 'Персонаж игрока получил уровень.', true]
  ];
  const DEFAULT_MAP = { crit:'b:crit', fumble:'b:fumble', hit:'b:hit', miss:'b:miss', hurt:'b:hurt', trauma:'b:trauma', down:'b:down', luck:'b:luck',
    init_fail:'b:init', combat_start:'b:fight', turn:'b:turn', levelup:'b:level' };
  const esc = (x)=>String(x==null ? '' : x).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;

  /* ---------- встроенный набор: анимации в круге, рисуются на холсте 200×200 ---------- */
  const FONT = (px)=>`700 ${px}px Cinzel, Georgia, serif`;
  function bg(c, a, b){ const g = c.createRadialGradient(100, 90, 10, 100, 100, 140); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, 200, 200); }
  function title(c, txt, y, px, col, dx){ c.save(); c.font = FONT(px); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = px/7; c.strokeStyle = 'rgba(0,0,0,.75)';
    c.strokeText(txt, 100 + (dx||0), y); c.fillStyle = col; c.fillText(txt, 100 + (dx||0), y); c.restore(); }
  const rnd = (i)=>{ const x = Math.sin(i*127.1 + 311.7)*43758.5453; return x - Math.floor(x); };
  const BUILTIN = {
    'b:crit':{name:'Крит!', draw(c, t){ bg(c, '#7a1a0a', '#120306');
      c.save(); c.translate(100, 100); c.rotate(t*0.7); c.fillStyle = 'rgba(255,200,90,.28)';
      for(let i=0;i<12;i++){ c.rotate(Math.PI/6); c.beginPath(); c.moveTo(0, 0); c.lineTo(-9, -120); c.lineTo(9, -120); c.fill(); } c.restore();
      for(let i=0;i<16;i++){ const a = i*0.4 + t*1.6, r = 30 + ((t*60 + i*23) % 70); c.fillStyle = `rgba(255,${180 + (i%3)*25},90,${1 - r/100})`; c.beginPath(); c.arc(100 + Math.cos(a)*r, 100 + Math.sin(a)*r, 2.5, 0, 7); c.fill(); }
      const k = 1 + Math.sin(t*8)*0.06; c.save(); c.translate(100, 104); c.scale(k, k); c.translate(-100, -104); title(c, 'КРИТ!', 104, 44, '#ffd27a'); c.restore();
      title(c, '12', 54, 20, '#fff1d0'); }},
    'b:fumble':{name:'Провал!', draw(c, t){ bg(c, '#2a1518', '#070405');
      c.strokeStyle = '#d8553a'; c.lineWidth = 3; c.lineCap = 'round';
      for(let i=0;i<7;i++){ const a0 = i/7*Math.PI*2 + rnd(i), len = Math.min(1, t*1.6)*(70 + rnd(i+9)*25); c.beginPath(); c.moveTo(100, 100);
        let x = 100, y = 100; for(let s=1;s<=4;s++){ const a = a0 + (rnd(i*7+s) - .5)*0.9; x += Math.cos(a)*len/4; y += Math.sin(a)*len/4; c.lineTo(x, y); } c.stroke(); }
      const sh = t < 1.2 ? Math.sin(t*60)*3*(1.2 - t) : 0;
      title(c, 'ПРОВАЛ', 104, 34, '#f1dcc4', sh); title(c, '13', 54, 20, '#ff9b7f'); }},
    'b:hit':{name:'Попадание', draw(c, t){ bg(c, '#3a1010', '#0d0405');
      for(let i=0;i<3;i++){ const p = Math.max(0, Math.min(1, (t - i*0.18)*3.5)); if(!p) continue; const x0 = 55 + i*30, y0 = 40;
        c.strokeStyle = '#ffd9c8'; c.lineWidth = 7 - i; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + (40 - i*4)*p - 20*p, y0 + 110*p); c.stroke();
        c.strokeStyle = '#c4482e'; c.lineWidth = 3; c.stroke(); }
      title(c, 'ПОПАЛ', 160, 30, '#ffe3d6'); }},
    'b:miss':{name:'Промах', draw(c, t){ bg(c, '#1c2730', '#06090c');
      c.strokeStyle = 'rgba(190,215,235,.55)'; c.lineCap = 'round';
      for(let i=0;i<5;i++){ const off = ((t*140 + i*45) % 260) - 30; c.lineWidth = 4 - i*0.5; c.beginPath(); c.arc(100, 230, 150 - i*14, Math.PI*1.15 + off/400, Math.PI*1.45 + off/400); c.stroke(); }
      title(c, 'МИМО', 104, 36, `rgba(214,232,245,${0.4 + 0.6*Math.min(1, t*2)})`); }},
    'b:hurt':{name:'Ранен', draw(c, t){ const p = 0.5 + 0.5*Math.sin(t*6); bg(c, `rgb(${110 + p*60},14,10)`, '#0d0203');
      for(let i=0;i<10;i++){ const x = 25 + rnd(i)*150, y = ((t*90*(0.7 + rnd(i+3)) + rnd(i+5)*200) % 230) - 20; c.fillStyle = '#e0412c';
        c.beginPath(); c.arc(x, y, 5, 0, Math.PI); c.lineTo(x, y - 12); c.closePath(); c.fill(); }
      title(c, 'РАНА', 104, 40, '#ffe3d6'); }},
    'b:trauma':{name:'Травма', draw(c, t){ bg(c, '#2c2016', '#0a0705');
      const sh = Math.sin(t*30)*(t < 1 ? 3 : 0.6); c.save(); c.translate(100 + sh, 80); c.rotate(-0.5);
      c.fillStyle = '#efe4cc'; c.fillRect(-48, -9, 96, 18); [[-48, -10], [-48, 10], [48, -10], [48, 10]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); });
      c.strokeStyle = '#7a1418'; c.lineWidth = 3; c.beginPath(); c.moveTo(-4, -9); c.lineTo(4, -2); c.lineTo(-3, 3); c.lineTo(5, 9); c.stroke(); c.restore();
      title(c, 'ТРАВМА', 150, 30, '#f4d9b8'); }},
    'b:down':{name:'Повержен', draw(c, t){ bg(c, '#1a1012', '#020102'); const a = Math.min(1, t*1.4);
      c.save(); c.globalAlpha = a; c.translate(100, 82 + Math.sin(t*2)*2); c.fillStyle = '#e9dfca';
      c.beginPath(); c.arc(0, 0, 38, Math.PI*0.9, Math.PI*2.1); c.lineTo(22, 34); c.lineTo(-22, 34); c.closePath(); c.fill();
      c.fillStyle = '#1a1012'; c.beginPath(); c.arc(-14, 2, 10, 0, 7); c.arc(14, 2, 10, 0, 7); c.fill(); c.beginPath(); c.moveTo(0, 14); c.lineTo(-5, 24); c.lineTo(5, 24); c.fill();
      for(let i=-1;i<=1;i++) c.fillRect(i*9 - 2, 30, 4, 7); c.restore();
      title(c, 'ПОВЕРЖЕН', 156, 24, `rgba(255,155,127,${a})`); }},
    'b:luck':{name:'Удача', draw(c, t){ bg(c, '#163a22', '#04100a');
      c.save(); c.translate(100, 86); c.rotate(t*1.2); c.fillStyle = '#5fbf72';
      for(let i=0;i<4;i++){ c.rotate(Math.PI/2); c.beginPath(); c.arc(-11, -20, 15, 0, 7); c.arc(11, -20, 15, 0, 7); c.fill(); }
      c.fillStyle = '#2c6a41'; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill(); c.restore();
      for(let i=0;i<9;i++){ const a = rnd(i)*7 + t, r = 55 + Math.sin(t*3 + i)*10; c.fillStyle = `rgba(230,255,200,${0.5 + 0.5*Math.sin(t*5 + i)})`; c.fillRect(100 + Math.cos(a)*r - 2, 86 + Math.sin(a)*r - 2, 4, 4); }
      title(c, 'УДАЧА', 158, 30, '#e6ffd8'); }},
    'b:init':{name:'Замешкался', draw(c, t){ bg(c, '#22213a', '#07070f');
      c.save(); c.translate(100, 80); c.rotate(Math.floor(t/1.6)*Math.PI + Math.min(1, (t % 1.6)*4)*0); c.strokeStyle = '#d9c9a6'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-26, -40); c.lineTo(26, -40); c.lineTo(-26, 40); c.lineTo(26, 40); c.closePath(); c.stroke();
      const f = (t % 1.6)/1.6; c.fillStyle = '#e8b04a'; c.beginPath(); c.moveTo(-22*(1 - f), -36 + 36*f); c.lineTo(22*(1 - f), -36 + 36*f); c.lineTo(0, -2); c.fill();
      c.beginPath(); c.moveTo(-22*f, 36); c.lineTo(22*f, 36); c.lineTo(0, 36 - 30*f); c.fill(); c.fillRect(-1, -2, 2, 38); c.restore();
      title(c, 'ЗАМЕШКАЛСЯ', 156, 19, '#e9e2ff'); }},
    'b:fight':{name:'В бой!', draw(c, t){ bg(c, '#3a240c', '#0c0703'); const p = Math.min(1, t*2.2), a = (1 - p)*1.1 + 0.62;
      [[-1, '#d8dde3'], [1, '#c9ced6']].forEach(([s, col])=>{ c.save(); c.translate(100, 88); c.rotate(s*a); c.fillStyle = col; c.fillRect(-4, -62, 8, 92); c.fillStyle = '#8a5a2a'; c.fillRect(-14, 28, 28, 7); c.fillRect(-4, 35, 8, 18); c.restore(); });
      if(p >= 1){ const k = Math.max(0, 1 - (t - 0.45)*2); c.fillStyle = `rgba(255,220,140,${k})`; for(let i=0;i<8;i++){ const an = i*Math.PI/4; c.beginPath(); c.moveTo(100, 60); c.lineTo(100 + Math.cos(an)*30, 60 + Math.sin(an)*30); c.lineTo(100 + Math.cos(an + .2)*8, 60 + Math.sin(an + .2)*8); c.fill(); } }
      title(c, 'В БОЙ!', 160, 30, '#ffe0a8'); }},
    'b:turn':{name:'Ход стороны', draw(c, t){ bg(c, '#12303a', '#03090c');
      c.save(); c.translate(100, 84); c.rotate(t*2.5); c.strokeStyle = '#8fd6e8'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.arc(0, 0, 34, 0.3, Math.PI*1.7); c.stroke();
      c.fillStyle = '#8fd6e8'; c.beginPath(); c.moveTo(34*Math.cos(0.3) + 10, 34*Math.sin(0.3) - 4); c.lineTo(34*Math.cos(0.3) - 10, 34*Math.sin(0.3) - 6); c.lineTo(34*Math.cos(0.3), 34*Math.sin(0.3) + 10); c.fill(); c.restore();
      title(c, 'ХОД', 158, 32, '#dff6ff'); }},
    'b:level':{name:'Новый уровень', draw(c, t){ bg(c, '#3a2e08', '#0d0a02');
      for(let i=0;i<4;i++){ const y = 150 - ((t*70 + i*40) % 160); c.strokeStyle = `rgba(255,214,120,${Math.min(1, y/60)})`; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(70, y + 18); c.lineTo(100, y - 6); c.lineTo(130, y + 18); c.stroke(); }
      title(c, 'УРОВЕНЬ', 160, 26, '#fff0c4'); }}
  };

  /* ---------- настройки Мастера ---------- */
  function defaultCfg(){
    const ev = {}; EVENTS.forEach(([k, , , on])=>{ ev[k] = {on, r:[DEFAULT_MAP[k]]}; });
    return {on:true, manual:true, size:3, dur:3.5, ev, custom:[]};
  }
  let cfg = (function(){
    try{ const v = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if(v && typeof v==='object') return normalize(v); }catch(e){}
    return defaultCfg();
  })();
  function normalize(v){
    const d = defaultCfg();
    const out = {on:v.on!==false, manual:v.manual!==false, size:[2, 3, 4, 5].indexOf(+v.size)>=0 ? +v.size : 3, dur:[2.5, 3.5, 5].indexOf(+v.dur)>=0 ? +v.dur : 3.5, ev:{}, custom:[]};
    (Array.isArray(v.custom) ? v.custom : []).forEach(x=>{ if(x && URL_RE.test(x.url || '') && /^c:[a-z0-9]{6,40}$/.test(x.id || ''))
      out.custom.push({id:x.id, name:String(x.name || 'Своя реакция').slice(0, 40), url:x.url, kind:/\.(mp4|webm)$/.test(x.url) ? 'video' : 'img', fx:clamp01(x.fx), fy:clamp01(x.fy)}); });
    EVENTS.forEach(([k])=>{ const e = v.ev && v.ev[k]; out.ev[k] = e ? {on:e.on!==false, r:(Array.isArray(e.r) ? e.r : []).filter(id=>BUILTIN[id] || out.custom.some(c=>c.id===id))} : d.ev[k]; });
    return out;
  }
  function clamp01(x){ x = Number(x); return isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5; }
  function saveCfg(){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} broadcastCfg(); }
  let pub = null; // (игрок) настройки, присланные Мастером
  function netRole(){ const gt = GT(); return gt && gt.netRole ? gt.netRole() : null; }
  function view(){ return netRole()==='player' ? (pub || {on:false, manual:false, size:3, dur:3.5, custom:[]}) : cfg; }
  function publicCfg(){ return {on:cfg.on, manual:cfg.manual, size:cfg.size, dur:cfg.dur, lib:cfg.custom.map(c=>({id:c.id, name:c.name, url:c.url, fx:c.fx, fy:c.fy}))}; }
  function broadcastCfg(to){ if(netRole()==='gm' && typeof sendMsg==='function') sendMsg({type:'gt-rxcfg', cfg:publicCfg()}, to); }
  function libraryAll(){ const v = view(); return Object.keys(BUILTIN).map(id=>({id, name:BUILTIN[id].name, kind:'b'})).concat((v.custom || v.lib || []).map(c=>Object.assign({kind:/\.(mp4|webm)$/.test(c.url) ? 'video' : 'img'}, c))); }
  function resolve(id){
    if(BUILTIN[id]) return {id, kind:'b'};
    const c = (view().custom || view().lib || []).find(x=>x.id===id);
    return c ? {id, kind:/\.(mp4|webm)$/.test(c.url) ? 'video' : 'img', url:c.url, fx:c.fx, fy:c.fy} : null;
  }

  /* ---------- показ ---------- */
  const shows = new Map(); // tokenId -> {el, raf, t0, timer}
  const lastAt = new Map();
  function stopShow(id, instant){
    const s = shows.get(id); if(!s) return;
    shows.delete(id); clearTimeout(s.timer);
    const tokEl = document.querySelector(`.gt-token[data-id="${CSS.escape(id)}"]`); if(tokEl) tokEl.classList.remove('rx-on');
    if(instant){ cancelAnimationFrame(s.raf); s.el.remove(); return; }
    s.el.style.width = s.el.style.height = s.d + 'px'; s.el.classList.add('rx-out');
    setTimeout(()=>{ cancelAnimationFrame(s.raf); s.el.remove(); }, 420);
  }
  function play(tokenId, r, size, dur){
    const gt = GT(); if(!gt || !gt.layerEl || !r) return;
    const pos = gt.tokenWorld(tokenId); if(!pos) return;
    stopShow(tokenId, true);
    const cell = gt.cellPx, D = Math.max(pos.d, (size || 3)*cell);
    const el = document.createElement('div'); el.className = 'rx-bubble';
    el.style.width = el.style.height = pos.d + 'px'; el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
    let cv = null;
    if(r.kind==='b'){ cv = document.createElement('canvas'); cv.width = cv.height = Math.round(D*Math.min(2, window.devicePixelRatio || 1)); el.appendChild(cv); }
    else if(r.kind==='video'){ const v = document.createElement('video'); v.src = r.url; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.style.objectPosition = `${(r.fx*100).toFixed(1)}% ${(r.fy*100).toFixed(1)}%`; el.appendChild(v); v.play().catch(()=>{}); }
    else { const im = document.createElement('img'); im.src = r.url; im.alt = ''; im.draggable = false; im.style.objectPosition = `${(r.fx*100).toFixed(1)}% ${(r.fy*100).toFixed(1)}%`; el.appendChild(im); }
    gt.layerEl.appendChild(el);
    const tokEl = document.querySelector(`.gt-token[data-id="${CSS.escape(tokenId)}"]`); if(tokEl) tokEl.classList.add('rx-on');
    const s = {el, d:pos.d, raf:0, t0:performance.now(), timer:0}; shows.set(tokenId, s);
    requestAnimationFrame(()=>{ el.style.width = el.style.height = D + 'px'; });
    const ctx = cv && cv.getContext('2d'), fx = BUILTIN[r.id];
    const loop = (now)=>{
      const p = gt.tokenWorld(tokenId); if(!p){ stopShow(tokenId, true); return; }
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; // жетон двигают — круг следует за ним
      if(ctx && fx){ ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.scale(cv.width/200, cv.height/200); fx.draw(ctx, (now - s.t0)/1000); }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    s.timer = setTimeout(()=>stopShow(tokenId), (dur || 3.5)*1000);
  }
  // Показать у всех: Мастер (или локальный стол) — сразу и рассылкой; скрытые жетоны — только у Мастера
  function showFor(tokenId, rid){
    const gt = GT(), t = gt && gt.getToken(tokenId), r = resolve(rid), v = view(); if(!t || !r) return false;
    const now = Date.now(); if(now - (lastAt.get(tokenId) || 0) < 1200) return false; lastAt.set(tokenId, now);
    play(tokenId, r, v.size, v.dur);
    if(netRole()==='gm' && !t.hidden && typeof sendMsg==='function') sendMsg({type:'gt-rx', tokenId, r, size:v.size, dur:v.dur});
    return true;
  }
  function fire(ev, tokenId){
    if(!cfg.on) return;
    const e = cfg.ev[ev]; if(!e || !e.on || !e.r.length) return;
    showFor(tokenId, e.r[Math.floor(Math.random()*e.r.length)]);
  }
  // Событие над одним жетоном или списком (с задержкой — например, «замешкался» после «В бой!»)
  function trigger(ev, ids, delay){
    ids = (Array.isArray(ids) ? ids : [ids]).filter(Boolean); if(!ids.length) return;
    const run = ()=>{
      const role = netRole();
      if(role==='player'){ if(ev==='crit' || ev==='fumble') ids.forEach(id=>{ if(typeof sendMsg==='function' && session.gmId) sendMsg({type:'gt-rxreq', ev, tokenId:id}, session.gmId); }); return; }
      ids.forEach((id, i)=>setTimeout(()=>fire(ev, id), i*90));
    };
    if(delay) setTimeout(run, delay); else run();
  }
  // Бросок к20 с нат. 12 / 13 (лист, кости, карточка существа): над жетоном существа или над своим жетоном
  function rollEvent(ev, tokId){ const gt = GT(); if(!gt) return; const id = tokId || (gt.ownTokenId && gt.ownTokenId()); if(id) trigger(ev, id); }
  function manualAllowed(t){ const v = view(); if(!v.on) return false; if(netRole()!=='player') return true; return !!v.manual && !!t && t.kind==='player' && t.ownerId===session.myId; }
  function requestManual(tokenId, rid){
    if(netRole()==='player'){ if(typeof sendMsg==='function' && session.gmId) sendMsg({type:'gt-rxreq', rid, tokenId}, session.gmId); return; }
    const t = GT() && GT().getToken(tokenId); if(t) { lastAt.delete(tokenId); showFor(tokenId, rid); }
  }

  /* ---------- сообщения стола ---------- */
  function sanitizeR(r){
    if(!r || typeof r!=='object') return null;
    if(r.kind==='b') return BUILTIN[r.id] ? {id:r.id, kind:'b'} : null;
    if((r.kind==='img' || r.kind==='video') && URL_RE.test(r.url || '')) return {id:String(r.id || '').slice(0, 50), kind:/\.(mp4|webm)$/.test(r.url) ? 'video' : 'img', url:r.url, fx:clamp01(r.fx), fy:clamp01(r.fy)};
    return null;
  }
  function handle(msg, fromGm){
    if(msg.type==='gt-rx'){ if(!fromGm) return; const r = sanitizeR(msg.r); if(r && typeof msg.tokenId==='string') play(msg.tokenId, r, Math.min(5, Math.max(2, +msg.size || 3)), Math.min(6, Math.max(1.5, +msg.dur || 3.5))); return; }
    if(msg.type==='gt-rxcfg'){ if(!fromGm || !msg.cfg) return; const c = msg.cfg;
      pub = {on:c.on!==false, manual:c.manual!==false, size:+c.size || 3, dur:+c.dur || 3.5, lib:(Array.isArray(c.lib) ? c.lib : []).filter(x=>x && URL_RE.test(x.url || '')).slice(0, 80)
        .map(x=>({id:String(x.id).slice(0, 50), name:String(x.name || '').slice(0, 40), url:x.url, fx:clamp01(x.fx), fy:clamp01(x.fy)}))};
      if(GT()) GT().refreshToolbar(); return; }
    if(msg.type==='gt-rxreq'){ // у Мастера: просьба игрока — только для своего жетона
      if(netRole()!=='gm' || !cfg.on) return;
      const t = GT().getToken(msg.tokenId); if(!t || t.kind!=='player' || t.ownerId!==msg.from) return;
      if(msg.rid){ if(cfg.manual && resolve(msg.rid)) showFor(t.id, msg.rid); }
      else if(msg.ev==='crit' || msg.ev==='fumble') fire(msg.ev, t.id);
    }
  }
  function onPlayerHello(id){ broadcastCfg(id); }

  /* ---------- наблюдатель (у Мастера и на локальном столе): ранение, травма, «повержен», удача, уровень ---------- */
  const seen = new Map(); // tokenId -> {hp, tr, luck, lvl}
  setInterval(()=>{
    const gt = GT(); if(!gt || !gt.state || netRole()==='player' || !cfg.on) { seen.clear(); return; }
    const toks = gt.state.tokens || {}, alive = new Set();
    Object.values(toks).forEach(t=>{
      alive.add(t.id);
      const v = gt.vitalsOf(t), hp = v && v.hp!=null ? Number(v.hp) : (t.hp!=null ? Number(t.hp) : null);
      const sh = t.kind==='player' && gt.sheetOf ? gt.sheetOf(t) : null;
      const cur = {hp:isFinite(hp) ? hp : null, tr:(t.trauma || 0) + (t.traumaRed || 0), luck:sh && sh.luck!=null ? Number(sh.luck) : null, lvl:sh ? Number(sh.level) : null};
      const was = seen.get(t.id); seen.set(t.id, cur);
      if(!was) return;
      if(cur.hp!=null && was.hp!=null && cur.hp <= 0 && was.hp > 0) fire('down', t.id);
      else if(cur.tr > was.tr) fire('trauma', t.id);
      else if(cur.hp!=null && was.hp!=null && cur.hp < was.hp) fire('hurt', t.id);
      else if(cur.lvl!=null && was.lvl!=null && cur.lvl > was.lvl) fire('levelup', t.id);
      else if(cur.luck!=null && was.luck!=null && cur.luck < was.luck) fire('luck', t.id);
    });
    [...seen.keys()].forEach(id=>{ if(!alive.has(id)) seen.delete(id); });
  }, 700);

  /* ---------- окно выбора реакции ---------- */
  let picker = null, pickRaf = 0;
  function closePicker(){ if(picker){ picker.remove(); picker = null; cancelAnimationFrame(pickRaf); } }
  function thumbHtml(it){
    if(it.kind==='b') return `<canvas width="120" height="120" data-b="${esc(it.id)}"></canvas>`;
    const pos = `${((it.fx==null ? .5 : it.fx)*100).toFixed(0)}% ${((it.fy==null ? .5 : it.fy)*100).toFixed(0)}%`;
    return it.kind==='video' ? `<video src="${esc(it.url)}" muted autoplay loop playsinline style="object-position:${pos}"></video>` : `<img src="${esc(it.url)}" alt="" style="object-position:${pos}">`;
  }
  function animateThumbs(root){
    const cvs = [...root.querySelectorAll('canvas[data-b]')], t0 = performance.now();
    const loop = (now)=>{ if(!root.isConnected) return; cvs.forEach(cv=>{ const c = cv.getContext('2d'), fx = BUILTIN[cv.dataset.b]; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 120, 120); c.scale(.6, .6); fx.draw(c, ((now - t0)/1000) % 3.2); }); pickRaf = requestAnimationFrame(loop); };
    pickRaf = requestAnimationFrame(loop);
  }
  // opts: {title, x, y, multi, selected:[ids], onPick(id) | onDone(ids)}
  function openPicker(opts){
    closePicker();
    const sel = new Set(opts.selected || []);
    picker = document.createElement('div'); picker.className = 'rx-picker';
    picker.innerHTML = `<div class="rx-picker-head"><b>${esc(opts.title || 'Реакция')}</b><button type="button" class="rx-x" title="Закрыть (Esc)">✕</button></div>
      <div class="rx-grid">${libraryAll().map(it=>`<button type="button" class="rx-tile${sel.has(it.id) ? ' on' : ''}" data-rid="${esc(it.id)}" title="${esc(it.name)}"><span class="rx-thumb">${thumbHtml(it)}</span><span class="rx-name">${esc(it.name)}</span></button>`).join('')}</div>
      ${opts.multi ? '<div class="rx-picker-foot"><span class="rx-hint">Несколько — выбирается случайная</span><button type="button" class="rx-done">Готово</button></div>' : ''}`;
    document.body.appendChild(picker);
    const w = picker.offsetWidth, h = picker.offsetHeight;
    const x = opts.x==null ? (innerWidth - w)/2 : Math.min(innerWidth - w - 8, Math.max(8, opts.x)), y = opts.y==null ? (innerHeight - h)/2 : Math.min(innerHeight - h - 8, Math.max(8, opts.y));
    picker.style.left = x + 'px'; picker.style.top = y + 'px';
    animateThumbs(picker);
    picker.addEventListener('click', (e)=>{
      if(e.target.closest('.rx-x')){ closePicker(); return; }
      if(e.target.closest('.rx-done')){ const ids = [...picker.querySelectorAll('.rx-tile.on')].map(b=>b.dataset.rid); closePicker(); if(opts.onDone) opts.onDone(ids); return; }
      const b = e.target.closest('[data-rid]'); if(!b) return;
      if(opts.multi){ b.classList.toggle('on'); return; }
      closePicker(); if(opts.onPick) opts.onPick(b.dataset.rid);
    });
    setTimeout(()=>{ const away = (ev)=>{ if(!picker){ document.removeEventListener('pointerdown', away, true); return; } if(!picker.contains(ev.target)){ closePicker(); document.removeEventListener('pointerdown', away, true); } }; document.addEventListener('pointerdown', away, true); }, 0);
  }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && picker){ e.stopPropagation(); closePicker(); } }, true);
  // Пункт меню жетона «🎞 Реакция…»
  function pickForToken(tokenId, clientX, clientY){
    openPicker({title:'Реакция на жетоне', x:clientX, y:clientY, onPick:(rid)=>requestManual(tokenId, rid)});
  }

  /* ---------- экран Мастера: вкладка «Реакции» ---------- */
  function renderConfig(root){
    const lib = libraryAll(), nameOf = (id)=>(lib.find(x=>x.id===id) || {}).name || '—';
    const seg = (key, vals, fmt)=>`<span class="rx-seg">${vals.map(v=>`<button type="button" data-set="${key}" data-v="${v}" class="${cfg[key]===v ? 'on' : ''}">${fmt(v)}</button>`).join('')}</span>`;
    root.innerHTML = `<label class="rx-sw"><input type="checkbox" data-opt="on" ${cfg.on ? 'checked' : ''}> <b>Реакции на столе</b></label>
      <label class="rx-sw"><input type="checkbox" data-opt="manual" ${cfg.manual ? 'checked' : ''}> Игроки могут показывать реакции вручную на своём жетоне</label>
      <div class="rx-line">Круг: ${seg('size', [2, 3, 4, 5], v=>v + ' кл.')}</div>
      <div class="rx-line">Длительность: ${seg('dur', [2.5, 3.5, 5], v=>String(v).replace('.', ',') + ' с')}</div>
      <div class="gs-sub" style="margin-top:12px">События</div>
      ${EVENTS.map(([k, label, desc])=>{ const e = cfg.ev[k];
        return `<div class="rx-ev${e.on ? '' : ' off'}"><label class="rx-sw"><input type="checkbox" data-ev="${k}" ${e.on ? 'checked' : ''}> <b>${esc(label)}</b></label>
          <div class="gs-muted">${esc(desc)}</div>
          <div class="rx-chips">${e.r.map(id=>`<span class="gs-chip">${esc(nameOf(id))}</span>`).join('') || '<span class="gs-muted">реакция не выбрана</span>'}<button type="button" class="gs-btn small" data-evpick="${k}" title="Выбрать реакции для этого события">✎</button></div></div>`; }).join('')}
      <div class="gs-sub" style="margin-top:12px">Библиотека</div>
      <div class="rx-lib">${lib.map(it=>`<div class="rx-libitem"><span class="rx-thumb">${thumbHtml(it)}</span><span class="rx-name">${esc(it.name)}</span>
        <span class="rx-libbtns"><button type="button" class="gs-btn small" data-test="${esc(it.id)}" title="Показать на выбранном жетоне (или на первом на столе)">▶</button>${it.kind==='b' ? '' : `<button type="button" class="gs-btn small" data-del="${esc(it.id)}" title="Убрать из библиотеки">✕</button>`}</span></div>`).join('')}</div>
      <div class="gs-row"><button type="button" class="gs-btn primary" data-act="upload" title="Своя анимация: GIF, WebP, PNG или ролик MP4/WebM до 3 МБ — файл хранится на сервере игры">＋ Загрузить свою</button>
        <button type="button" class="gs-btn" data-act="reset" title="Вернуть встроенный набор и события по умолчанию (свои файлы останутся в библиотеке)">Набор по умолчанию</button></div>
      <div class="gs-hint">Жетон вырастает до размера круга, анимация обрезается по кругу. Игроки видят реакции над своими и видимыми жетонами; над скрытыми жетонами — только вы.</div>`;
    animateThumbs(root);
    if(!root._rxWired){ root._rxWired = true;
      root.addEventListener('change', (e)=>{
        const o = e.target.dataset.opt, ev = e.target.dataset.ev;
        if(o){ cfg[o] = e.target.checked; saveCfg(); renderConfig(root); }
        else if(ev){ cfg.ev[ev].on = e.target.checked; saveCfg(); renderConfig(root); }
      });
      root.addEventListener('click', (e)=>{
        const s = e.target.closest('[data-set]'); if(s){ cfg[s.dataset.set] = Number(s.dataset.v); saveCfg(); renderConfig(root); return; }
        const p = e.target.closest('[data-evpick]'); if(p){ const k = p.dataset.evpick, r = p.getBoundingClientRect();
          openPicker({title:'Реакции: ' + EVENTS.find(x=>x[0]===k)[1], multi:true, selected:cfg.ev[k].r, x:r.left - 200, y:r.top, onDone:(ids)=>{ cfg.ev[k].r = ids; saveCfg(); renderConfig(root); }}); return; }
        const t = e.target.closest('[data-test]'); if(t){ const gt = GT(), ids = gt.selectedIds ? gt.selectedIds() : [], any = Object.keys(gt.state.tokens || {});
          const id = ids[0] || any[0]; if(!id){ uiToast('Поставьте на стол хотя бы один жетон', {icon:'🎞'}); return; }
          if(typeof toggleMainTab==='function') toggleMainTab('table'); setTimeout(()=>{ lastAt.delete(id); showFor(id, t.dataset.test); }, 120); return; }
        const d = e.target.closest('[data-del]'); if(d){ const id = d.dataset.del; cfg.custom = cfg.custom.filter(c=>c.id!==id); Object.values(cfg.ev).forEach(x=>{ x.r = x.r.filter(r=>r!==id); }); saveCfg(); renderConfig(root); return; }
        const a = e.target.closest('[data-act]'); if(!a) return;
        if(a.dataset.act==='reset'){ const keep = cfg.custom; cfg = defaultCfg(); cfg.custom = keep; saveCfg(); renderConfig(root); }
        else if(a.dataset.act==='upload') uploadCustom(()=>renderConfig(root));
      });
    }
  }
  function uploadCustom(done){
    if(typeof session==='undefined' || session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN){
      uiAlert('Свои реакции хранятся на сервере игры — загрузите их, когда стол открыт: «Я — Мастер» в «Совместной сессии».', {title:'Реакции', icon:'🎞'}); return; }
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/gif,image/webp,image/png,video/mp4,video/webm';
    inp.onchange = async ()=>{
      const f = inp.files && inp.files[0]; if(!f) return;
      if(!/^(image\/(gif|webp|png)|video\/(mp4|webm))$/.test(f.type)){ uiAlert('Подойдёт анимация GIF, WebP или PNG либо короткий ролик MP4/WebM.', {title:'Реакции', icon:'🎞'}); return; }
      if(f.size > 3*1024*1024){ uiAlert('Файл больше 3 МБ. Ролик MP4 того же вида обычно в 5–10 раз легче гифки.', {title:'Реакции', icon:'🎞'}); return; }
      const src = URL.createObjectURL(f), isVid = f.type.indexOf('video/')===0;
      let fx = 0.5, fy = 0.5;
      const pr = uiDialog({title:'Своя реакция', icon:'🎞', html:`<div class="rx-focus-wrap"><div class="rx-focus" title="Нажмите на главное место — круг будет вырезан вокруг него">${isVid ? `<video src="${src}" muted autoplay loop playsinline></video>` : `<img src="${src}" alt="">`}<i class="rx-dot"></i></div>
          <div class="rx-circle-prev">${isVid ? `<video src="${src}" muted autoplay loop playsinline></video>` : `<img src="${src}" alt="">`}</div></div>
          <div class="gs-muted" style="margin-top:6px">Слева нажмите на главное место кадра — справа видно, как это будет в круге жетона.</div>`,
        fields:[{name:'name', label:'Название', value:f.name.replace(/\.[^.]+$/, '').slice(0, 40)}], cancelValue:null,
        buttons:[{label:'Отмена', value:null}, {label:'Загрузить', value:(v)=>v, primary:true}]});
      const box = document.querySelector('.ui-dlg .rx-focus'), dot = box && box.querySelector('.rx-dot'), prev = document.querySelectorAll('.ui-dlg .rx-circle-prev img, .ui-dlg .rx-circle-prev video');
      const setFocus = ()=>{ if(dot){ dot.style.left = (fx*100) + '%'; dot.style.top = (fy*100) + '%'; } prev.forEach(m=>{ m.style.objectPosition = `${(fx*100).toFixed(1)}% ${(fy*100).toFixed(1)}%`; }); };
      if(box) box.addEventListener('click', (e)=>{ const r = box.getBoundingClientRect(); fx = clamp01((e.clientX - r.left)/r.width); fy = clamp01((e.clientY - r.top)/r.height); setFocus(); });
      setFocus();
      const res = await pr; URL.revokeObjectURL(src); if(!res) return;
      const rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try{
        const r = await fetch('/reaction-upload', {method:'POST', headers:{'Content-Type':f.type, 'X-Client-Id':session.myId, 'X-Reaction-Id':rid}, body:f});
        const j = await r.json(); if(!r.ok || !j.url) throw new Error(j.error || ('ошибка ' + r.status));
        cfg.custom.push({id:'c:' + rid, name:(res.name || '').trim().slice(0, 40) || 'Своя реакция', url:j.url, kind:isVid ? 'video' : 'img', fx, fy});
        saveCfg(); uiToast('Реакция загружена — назначьте её событию или покажите вручную', {icon:'🎞'}); if(done) done();
      }catch(err){ uiAlert('Не удалось загрузить: ' + err.message, {title:'Реакции', icon:'⚠'}); }
    };
    inp.click();
  }

  return { trigger, rollEvent, handle, onPlayerHello, manualAllowed, pickForToken, renderConfig, play, get config(){ return cfg; }, EVENTS };
})();
