/* ======================================================================
   РЕДАКТОР КАРТ — вкладка «Редактор карт» (#mapEditorView). Данные — MapFormat, рисование — MapRender
   (тот же, что на игровом столе), хранилище — MapStore. Камера и сетка — те же правила, что у стола:
   экран = cam + мир*TABLE_CELL_PX*zoom, линии сетки по целым координатам. Отключение сетки только
   прячет линии, координаты не меняются.
   ====================================================================== */
const MapEditor = (function(){
  const CELL = TABLE_CELL_PX;
  const PREFS_KEY = 'reincarnator_map_editor_v1';
  const ZOOM_MIN = 0.1, ZOOM_MAX = 4;
  const { r3, clamp, num } = MapFormat;
  const TOOLS = [
    ['select', 'Выбор', 'V', 'M5 3 L5 19 L9.5 14.5 L12.5 21 L15 20 L12 13.5 L18 13.5 Z'],
    ['hand', 'Рука — перемещать вид', 'H', 'M8 13 V5.5 a1.5 1.5 0 0 1 3 0 V12 M11 11.5 V4.5 a1.5 1.5 0 0 1 3 0 V12 M14 6.5 a1.5 1.5 0 0 1 3 0 V12 M17 9.5 a1.5 1.5 0 0 1 3 0 V15 c0 4-3 6.5-6.5 6.5 S8 19 6 16.5 L3.5 13 a1.4 1.4 0 0 1 2.2-1.8 L8 13.5'],
    ['brush', 'Ландшафт — кисть', 'B', 'M14.5 4.5 L19.5 9.5 L10 19 L5 19 L5 14 Z M12.5 6.5 L17.5 11.5'],
    ['fill', 'Ландшафт — заливка области', 'G', 'M4 12 L11 5 L18 12 L11 19 Z M18 14 c0 0 2 2.5 2 4 a2 2 0 0 1-4 0 c0-1.5 2-4 2-4'],
    ['room', 'Помещение (пол + стены)', 'R', 'M4 4 H20 V20 H4 Z M4 13 H10 M14 13 H20'],
    ['wall', 'Стена (по линиям сетки)', 'W', 'M3 18 L9 6 L15 18 L21 6'],
    ['path', 'Дорога / путь', 'P', 'M4 20 C8 14 6 9 12 8 S18 4 20 3 M4 20 L6 14 M20 3 L14 5'],
    ['object', 'Объект из библиотеки', 'O', 'M4 7 L12 3 L20 7 L20 17 L12 21 L4 17 Z M4 7 L12 11 L20 7 M12 11 V21'],
    ['label', 'Надпись', 'T', 'M5 5 H19 M12 5 V20 M9 20 H15'],
  ];
  const prefs = Object.assign({ mapId:null, grid:true, snap:true, hidden:{}, locked:{}, tool:'select', terrain:'concrete', brush:1,
    wallKind:'concrete', pathKind:'road', pathWidth:3, asset:'crate_wood', cat:'all', search:'', side:'lib', recent:[], wallsOnRoom:true, assetScale:{} }, (function(){ try{ return JSON.parse(localStorage.getItem(PREFS_KEY)||'null') || {}; }catch(e){ return {}; } })());
  function savePrefs(){ try{ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }catch(e){} }
  let doc = null, visible = false, inited = false;
  let canvas, ctx, stage, dpr = 1, vw = 0, vh = 0;
  let cam = {x:40, y:40, z:0.6};
  let undoStack = [], redoStack = [];
  let sel = new Set();   // 'o:id' | 'w:id' | 'p:id' | 'l:id'
  let action = null;     // текущее действие мышью
  let draft = null;      // стена/путь в процессе: {type, points}
  let ghost = {r:0, v:0, f:false, at:null};
  let hover = null;      // мир под курсором
  let spaceHeld = false, clipboard = null;
  let rq = 0, saveTimer = null, statusMsg = '';
  const $ = (id)=>document.getElementById(id);
  const esc = (s)=>escapeHtml(s==null ? '' : s);

  /* ---------- документ, отмена/повтор, сохранение ---------- */
  function snapshot(){ return JSON.stringify(MapFormat.toJSON(doc)); }
  const S_MIN = 0.1, S_MAX = 8; // масштаб объекта на карте (1 = размер из библиотеки)
  const defScale = (id)=>prefs.assetScale[id] || 1; // масштаб по умолчанию для типа объекта (помнится в браузере)
  const pct = (s)=>Math.round(s*100) + '%';
  function pushUndo(){ undoStack.push(snapshot()); if(undoStack.length > 80) undoStack.shift(); redoStack = []; }
  function changed(){ doc.updated = Date.now(); scheduleSave(); requestRender(); renderSide(); renderTop(); }
  function mutate(fn){ pushUndo(); fn(); changed(); }
  function restore(json){ const id = doc.id; doc = MapFormat.fromJSON(JSON.parse(json)); doc.id = id; sel.clear(); changed(); }
  function undo(){ if(!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo(){ if(!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
  function scheduleSave(){ clearTimeout(saveTimer); setStatus('Сохраняется…'); saveTimer = setTimeout(saveNow, 700); }
  function saveNow(){
    clearTimeout(saveTimer); saveTimer = null;
    if(!doc) return true;
    syncAssets();
    const ok = MapStore.save(doc);
    MapStore.invalidateLocal(doc.id);
    prefs.mapId = doc.id; savePrefs();
    setStatus(ok ? 'Сохранено ' + new Date().toLocaleTimeString().slice(0, 5) : '⚠ Хранилище браузера переполнено — экспортируйте карту в файл');
    return ok;
  }
  function setStatus(t){ statusMsg = t; const el = $('meStatus'); if(el) el.textContent = t; }
  // doc.assets = свои объекты, которые стоят на карте (размер/название/ссылка) — пересобираем при сохранении
  function syncAssets(){ if(!doc) return; const old = doc.assets || {}, out = {};
    doc.objects.forEach(o=>{ if(String(o.a).indexOf('u:')!==0 || out[o.a]) return; const m = CustomAssets.meta(o.a) || old[o.a]; if(m) out[o.a] = {name:m.name, w:m.w, h:m.h, g:!!m.g, url:m.url || (old[o.a] && old[o.a].url) || undefined}; });
    Object.keys(out).forEach(id=>{ if(!out[id].url) delete out[id].url; }); doc.assets = out; }
  function openDoc(d){ CustomAssets.registerDoc(d); doc = d; undoStack = []; redoStack = []; sel.clear(); draft = null; prefs.mapId = d.id; savePrefs(); fitView(); renderAll(); setStatus('Открыта «' + d.name + '»'); }

  /* ---------- камера ---------- */
  function toWorld(px, py){ return {x:(px - cam.x)/(CELL*cam.z), y:(py - cam.y)/(CELL*cam.z)}; }
  function toScreen(wx, wy){ return {x:cam.x + wx*CELL*cam.z, y:cam.y + wy*CELL*cam.z}; }
  function fitView(){
    if(!doc || !vw) return;
    const z = clamp(Math.min((vw - 60)/(doc.cols*CELL), (vh - 60)/(doc.rows*CELL)), ZOOM_MIN, ZOOM_MAX);
    cam.z = z; cam.x = (vw - doc.cols*CELL*z)/2; cam.y = (vh - doc.rows*CELL*z)/2; requestRender(); renderZoom();
  }
  function zoomAt(px, py, z){ z = clamp(z, ZOOM_MIN, ZOOM_MAX); const w = toWorld(px, py); cam.z = z; cam.x = px - w.x*CELL*z; cam.y = py - w.y*CELL*z; requestRender(); renderZoom(); }
  function renderZoom(){ const el = $('meZoom'); if(el) el.textContent = Math.round(cam.z*100) + '%'; }

  /* ---------- привязка к сетке ---------- */
  const snapOn = (e)=>prefs.snap && !(e && e.altKey); // Alt — временно без привязки
  function snapPt(w, step, e){ return snapOn(e) ? [Math.round(w.x/step)*step, Math.round(w.y/step)*step] : [r3(w.x), r3(w.y)]; }
  function effSize(o){ const a = MapAssets.BY_ID[o.a] || {w:1, h:1}; const s = o.s || 1; const q = Math.round(((o.r||0)%180 + 180)%180); return q===90 ? {w:a.h*s, h:a.w*s} : {w:a.w*s, h:a.h*s}; }
  // центр объекта так, чтобы его габарит лёг по клеткам (для поворотов, кратных 90°)
  function snapCenter(o, x, y, e){
    if(!snapOn(e)) return [r3(x), r3(y)];
    if((o.r||0) % 90){ return [Math.round(x*2)/2, Math.round(y*2)/2]; }
    const s = effSize(o), step = (Math.abs(s.w - Math.round(s.w)) < 0.01 && Math.abs(s.h - Math.round(s.h)) < 0.01) ? 1 : 0.5;
    return [r3(Math.round((x - s.w/2)/step)*step + s.w/2), r3(Math.round((y - s.h/2)/step)*step + s.h/2)];
  }

  /* ---------- поиск под курсором ---------- */
  const layerOf = (key)=>{ const t = key[0]; if(t==='o'){ const o = findItem(key); return o && MapRender.isGround(o) ? 'ground' : 'objects'; } return {w:'walls', p:'paths', l:'labels'}[t]; };
  const usable = (layer)=>!prefs.hidden[layer] && !prefs.locked[layer];
  function findItem(key){ const id = key.slice(2), t = key[0]; const arr = t==='o' ? doc.objects : t==='w' ? doc.walls : t==='p' ? doc.paths : doc.labels; return arr.find(x=>x.id===id); }
  function distSeg(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy; let t = L ? ((px - ax)*dx + (py - ay)*dy)/L : 0; t = clamp(t, 0, 1); return Math.hypot(px - (ax + dx*t), py - (ay + dy*t)); }
  function hitPolyline(pts, w, tol){ for(let i=0;i<pts.length - 1;i++) if(distSeg(w.x, w.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= tol) return true; return false; }
  function hitObject(o, w){ const a = MapAssets.BY_ID[o.a] || {w:1, h:1}; const s = o.s || 1, rad = -(o.r||0)*Math.PI/180; const dx = w.x - o.x, dy = w.y - o.y;
    const lx = dx*Math.cos(rad) - dy*Math.sin(rad), ly = dx*Math.sin(rad) + dy*Math.cos(rad); return Math.abs(lx) <= a.w*s/2 && Math.abs(ly) <= a.h*s/2; }
  function labelBox(l){ const w = Math.max(1, String(l.text).split('\n').reduce((m, s)=>Math.max(m, s.length), 0)*l.size*0.55), h = l.size*1.2*String(l.text).split('\n').length; return {x0:l.x - w/2, x1:l.x + w/2, y0:l.y - h/2, y1:l.y + h/2}; }
  function hitTest(w){
    const tol = Math.max(0.15, 6/(CELL*cam.z));
    if(usable('labels')) for(let i=doc.labels.length - 1;i>=0;i--){ const b = labelBox(doc.labels[i]); if(w.x>=b.x0 && w.x<=b.x1 && w.y>=b.y0 && w.y<=b.y1) return 'l:' + doc.labels[i].id; }
    if(usable('objects')) for(let i=doc.objects.length - 1;i>=0;i--){ const o = doc.objects[i]; if(!MapRender.isGround(o) && hitObject(o, w)) return 'o:' + o.id; }
    if(usable('walls')) for(let i=doc.walls.length - 1;i>=0;i--){ const wl = doc.walls[i]; if(hitPolyline(wl.points, w, tol + (MapFormat.WALL_KINDS[wl.kind] || {w:0.2}).w/2)) return 'w:' + wl.id; }
    if(usable('ground')) for(let i=doc.objects.length - 1;i>=0;i--){ const o = doc.objects[i]; if(MapRender.isGround(o) && hitObject(o, w)) return 'o:' + o.id; }
    if(usable('paths')) for(let i=doc.paths.length - 1;i>=0;i--){ const p = doc.paths[i]; if(hitPolyline(p.points, w, Math.max(tol, p.width/2))) return 'p:' + p.id; }
    return null;
  }
  function itemBox(key){
    const it = findItem(key); if(!it) return null; const t = key[0];
    if(t==='o') return MapAssets.objectBounds(it);
    if(t==='l') return labelBox(it);
    return MapRender.pathBox(it.points, t==='p' ? it.width/2 : 0.2);
  }
  // ручки выделенного объекта: поворот (над объектом) и масштаб (угол)
  function objectHandles(o){
    const a = MapAssets.BY_ID[o.a] || {w:1, h:1}, s = o.s || 1, rad = (o.r||0)*Math.PI/180, hw = a.w*s/2, hh = a.h*s/2;
    const rot = (lx, ly)=>({x:o.x + lx*Math.cos(rad) - ly*Math.sin(rad), y:o.y + lx*Math.sin(rad) + ly*Math.cos(rad)});
    const pad = 14/(CELL*cam.z);
    return { rotate:rot(0, -hh - pad*2.2), scale:rot(hw + pad*0.4, hh + pad*0.4), corners:[rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)] };
  }

  /* ---------- отрисовка поля ---------- */
  function requestRender(){ if(!rq) rq = requestAnimationFrame(render); }
  function render(){
    rq = 0;
    if(!visible || !doc || !ctx || !vw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2b2620'; ctx.fillRect(0, 0, vw, vh);
    const k = CELL*cam.z;
    ctx.fillStyle = '#efe6cc'; ctx.fillRect(cam.x, cam.y, doc.cols*k, doc.rows*k); // фон «пусто» — как поле стола
    ctx.setTransform(k*dpr, 0, 0, k*dpr, cam.x*dpr, cam.y*dpr);
    const v = {x0:-cam.x/k, y0:-cam.y/k, x1:(vw - cam.x)/k, y1:(vh - cam.y)/k};
    MapRender.drawMap(ctx, doc, {k, view:v, hidden:prefs.hidden});
    // призрак объекта, черновик стены/пути, прямоугольник помещения
    if(prefs.tool==='object' && ghost.at && MapAssets.BY_ID[prefs.asset]){
      ctx.globalAlpha = 0.6; MapAssets.drawObject(ctx, {a:prefs.asset, x:ghost.at[0], y:ghost.at[1], r:ghost.r, s:defScale(prefs.asset), v:ghost.v, f:ghost.f}, k); ctx.globalAlpha = 1;
    }
    if(draft){ const pts = draft.points.concat(hover ? [draft.next || [hover.x, hover.y]] : []);
      if(pts.length>1){ if(draft.type==='wall') MapRender.drawWall(ctx, {kind:prefs.wallKind, points:pts}, k); else MapRender.drawPath(ctx, {kind:prefs.pathKind, width:prefs.pathWidth, points:pts}); } }
    if(action && action.type==='room' && action.cur){ const [x0, y0, x1, y1] = roomRect(action); ctx.fillStyle = 'rgba(156,47,28,.12)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.lineWidth = 2/k; ctx.strokeStyle = '#9c2f1c'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); }
    // рамка карты
    ctx.lineWidth = 2/k; ctx.strokeStyle = '#1e1b18'; ctx.strokeRect(0, 0, doc.cols, doc.rows);
    drawGrid(k);
    drawOverlay(k);
  }
  // Сетка — те же правила, что у игрового стола: линии по целым клеткам, каждая 5-я жирнее
  function drawGrid(k){
    if(!prefs.grid) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x0 = Math.max(0, Math.floor(-cam.x/k)), x1 = Math.min(doc.cols, Math.ceil((vw - cam.x)/k));
    const y0 = Math.max(0, Math.floor(-cam.y/k)), y1 = Math.min(doc.rows, Math.ceil((vh - cam.y)/k));
    const top = Math.max(0, cam.y), bot = Math.min(vh, cam.y + doc.rows*k), left = Math.max(0, cam.x), right = Math.min(vw, cam.x + doc.cols*k);
    const minorA = cam.z < 0.5 ? 0.09 : 0.15;
    for(let pass=0; pass<2; pass++){
      ctx.beginPath();
      for(let i=x0;i<=x1;i++){ if((i%5===0)!==(pass===1)) continue; const x = Math.round(cam.x + i*k) + 0.5; ctx.moveTo(x, top); ctx.lineTo(x, bot); }
      for(let j=y0;j<=y1;j++){ if((j%5===0)!==(pass===1)) continue; const y = Math.round(cam.y + j*k) + 0.5; ctx.moveTo(left, y); ctx.lineTo(right, y); }
      ctx.strokeStyle = pass ? 'rgba(28,23,18,.28)' : `rgba(28,23,18,${minorA})`; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function drawOverlay(k){
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = (x, y)=>toScreen(x, y);
    sel.forEach(key=>{
      const it = findItem(key); if(!it) return;
      ctx.save(); ctx.strokeStyle = '#9c2f1c'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      if(key[0]==='o'){ const h = objectHandles(it); ctx.beginPath(); h.corners.forEach((c, i)=>{ const p = S(c.x, c.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke(); }
      else if(key[0]==='l'){ const b = labelBox(it), a = S(b.x0, b.y0), c = S(b.x1, b.y1); ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); }
      else { ctx.beginPath(); it.points.forEach((p, i)=>{ const s = S(p[0], p[1]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.setLineDash([]);
        if(sel.size===1) it.points.forEach(p=>{ const s = S(p[0], p[1]); ctx.fillStyle = '#efe6cc'; ctx.fillRect(s.x - 5, s.y - 5, 10, 10); ctx.strokeRect(s.x - 5, s.y - 5, 10, 10); }); }
      ctx.restore();
    });
    if(sel.size===1){ const key = [...sel][0]; if(key[0]==='o'){ const o = findItem(key); if(o){ const h = objectHandles(o), r = S(h.rotate.x, h.rotate.y), s = S(h.scale.x, h.scale.y), top = S((h.corners[0].x + h.corners[1].x)/2, (h.corners[0].y + h.corners[1].y)/2);
      ctx.strokeStyle = '#9c2f1c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.fillStyle = '#9c2f1c'; ctx.beginPath(); ctx.arc(r.x, r.y, 7, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#efe6cc'; ctx.beginPath(); ctx.arc(r.x, r.y, 3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#9c2f1c'; ctx.fillRect(s.x - 6, s.y - 6, 12, 12);
      if(action && action.type==='scale'){ const t = pct(o.s || 1); ctx.font = '600 12px "Roboto Condensed", Arial, sans-serif'; const tw = ctx.measureText(t).width; ctx.fillStyle = 'rgba(28,23,18,.88)'; ctx.fillRect(s.x + 10, s.y - 9, tw + 10, 18); ctx.fillStyle = '#efe6cc'; ctx.fillText(t, s.x + 15, s.y + 4); } } } }
    if(action && action.type==='box'){ const a = action.startScreen, b = action.curScreen; ctx.fillStyle = 'rgba(156,47,28,.08)'; ctx.strokeStyle = '#9c2f1c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.setLineDash([]); }
    if(hover && (prefs.tool==='brush' || prefs.tool==='fill')){ const n = prefs.tool==='brush' ? prefs.brush : 1, h = Math.floor(n/2); const a = S(Math.floor(hover.x) - h, Math.floor(hover.y) - h);
      ctx.strokeStyle = '#9c2f1c'; ctx.lineWidth = 2; ctx.strokeRect(a.x, a.y, n*k, n*k); }
    if(hover && (prefs.tool==='wall' || prefs.tool==='room' || prefs.tool==='path')){ const step = prefs.tool==='path' ? 0.5 : 1; const p = snapPt(hover, step), s = S(p[0], p[1]); ctx.fillStyle = '#9c2f1c'; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI*2); ctx.fill(); }
  }

  /* ---------- инструменты ---------- */
  function setTool(t){
    if(draft) finishDraft();
    prefs.tool = t; savePrefs(); action = null;
    if(t!=='select') { /* выделение не трогаем — его можно править после смены инструмента */ }
    canvas.style.cursor = t==='hand' ? 'grab' : t==='select' ? 'default' : 'crosshair';
    renderTools(); renderOptions(); requestRender();
  }
  function paintCells(w, e){
    const n = prefs.brush, h = Math.floor(n/2), ti = MapFormat.T_INDEX[prefs.terrain];
    const cx = Math.floor(w.x), cy = Math.floor(w.y); let any = false;
    for(let y=cy - h;y<cy - h + n;y++) for(let x=cx - h;x<cx - h + n;x++){ if(x<0 || y<0 || x>=doc.cols || y>=doc.rows) continue; const i = y*doc.cols + x; if(doc.terrain[i]!==ti){ doc.terrain[i] = ti; any = true; } }
    return any;
  }
  function floodFill(w){
    const x = Math.floor(w.x), y = Math.floor(w.y); if(x<0 || y<0 || x>=doc.cols || y>=doc.rows) return;
    const from = doc.terrain[y*doc.cols + x], to = MapFormat.T_INDEX[prefs.terrain]; if(from===to) return;
    mutate(()=>{ const stack = [[x, y]]; while(stack.length){ const [px, py] = stack.pop(); if(px<0 || py<0 || px>=doc.cols || py>=doc.rows) continue; const i = py*doc.cols + px; if(doc.terrain[i]!==from) continue; doc.terrain[i] = to; stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]); } });
  }
  function roomRect(a){ const x0 = Math.min(a.start[0], a.cur[0]), x1 = Math.max(a.start[0], a.cur[0]), y0 = Math.min(a.start[1], a.cur[1]), y1 = Math.max(a.start[1], a.cur[1]); return [x0, y0, x1, y1]; }
  function makeRoom(a){
    const [x0, y0, x1, y1] = roomRect(a); if(x1 - x0 < 1 || y1 - y0 < 1) return;
    mutate(()=>{
      const ti = MapFormat.T_INDEX[prefs.terrain];
      for(let y=Math.max(0, Math.floor(y0));y<Math.min(doc.rows, Math.ceil(y1));y++) for(let x=Math.max(0, Math.floor(x0));x<Math.min(doc.cols, Math.ceil(x1));x++) doc.terrain[y*doc.cols + x] = ti;
      if(prefs.wallsOnRoom) doc.walls.push({id:MapFormat.newId('w'), kind:prefs.wallKind, points:[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]});
    });
  }
  function finishDraft(){
    if(!draft) return;
    const d = draft; draft = null;
    if(d.points.length >= 2) mutate(()=>{ if(d.type==='wall') doc.walls.push({id:MapFormat.newId('w'), kind:prefs.wallKind, points:d.points}); else doc.paths.push({id:MapFormat.newId('p'), kind:prefs.pathKind, width:r3(prefs.pathWidth), points:d.points}); });
    requestRender();
  }
  function placeObject(){
    if(!ghost.at || !MapAssets.BY_ID[prefs.asset]) return;
    mutate(()=>{ const o = {id:MapFormat.newId('o'), a:prefs.asset, x:ghost.at[0], y:ghost.at[1], r:ghost.r, s:defScale(prefs.asset), v:ghost.v, f:ghost.f}; doc.objects.push(o); sel = new Set(['o:' + o.id]); });
    prefs.recent = [prefs.asset].concat(prefs.recent.filter(x=>x!==prefs.asset)).slice(0, 16); savePrefs();
  }
  function updateGhost(w, e){ if(!w || !MapAssets.BY_ID[prefs.asset]) { ghost.at = null; return; } ghost.at = snapCenter({a:prefs.asset, r:ghost.r, s:defScale(prefs.asset)}, w.x, w.y, e); }
  // Масштаб: у выбранных объектов (множитель или точное значение), без выбора в инструменте «Объект» —
  // масштаб по умолчанию для текущего объекта библиотеки (им будут ставиться новые копии)
  function setAssetScale(id, v){ v = r3(clamp(v, S_MIN, S_MAX)); if(Math.abs(v - 1) < 0.001) delete prefs.assetScale[id]; else prefs.assetScale[id] = v; savePrefs(); }
  function scaleSel(mul, abs){
    const objs = [...sel].filter(k=>k[0]==='o' && !prefs.locked[layerOf(k)]).map(findItem).filter(Boolean);
    if(!objs.length){ if(prefs.tool==='object' && MapAssets.BY_ID[prefs.asset]){ setAssetScale(prefs.asset, abs != null ? abs : defScale(prefs.asset)*mul); if(hover) updateGhost(hover); setStatus('Масштаб новых: ' + pct(defScale(prefs.asset))); renderOptions(); requestRender(); } return; }
    mutate(()=>objs.forEach(o=>{ o.s = r3(clamp(abs != null ? abs : (o.s || 1)*mul, S_MIN, S_MAX)); if(!(o.r%90)){ const c = snapCenter(o, o.x, o.y); o.x = c[0]; o.y = c[1]; } }));
    setStatus('Масштаб: ' + (objs.length===1 ? pct(objs[0].s) : objs.length + ' объект.'));
  }
  function deleteSelection(){ if(!sel.size) return; mutate(()=>{ sel.forEach(key=>{ const id = key.slice(2), t = key[0]; const k2 = t==='o' ? 'objects' : t==='w' ? 'walls' : t==='p' ? 'paths' : 'labels'; doc[k2] = doc[k2].filter(x=>x.id!==id); }); sel.clear(); }); }
  function cloneItems(keys, dx, dy){
    const out = [];
    keys.forEach(key=>{ const it = findItem(key); if(!it) return; const c = JSON.parse(JSON.stringify(it)); c.id = MapFormat.newId(key[0]);
      if(c.points) c.points = c.points.map(p=>[r3(p[0] + dx), r3(p[1] + dy)]); else { c.x = r3(c.x + dx); c.y = r3(c.y + dy); }
      const t = key[0]; (t==='o' ? doc.objects : t==='w' ? doc.walls : t==='p' ? doc.paths : doc.labels).push(c); out.push(t + ':' + c.id); });
    return out;
  }
  function duplicate(){ if(!sel.size) return; mutate(()=>{ sel = new Set(cloneItems([...sel], 1, 1)); }); }
  function copySel(){ if(!sel.size) return; clipboard = [...sel].map(key=>({t:key[0], it:JSON.parse(JSON.stringify(findItem(key)))})).filter(x=>x.it); setStatus('Скопировано: ' + clipboard.length); }
  function paste(){
    if(!clipboard || !clipboard.length) return;
    const boxes = clipboard.map(c=>c.it.points ? MapRender.pathBox(c.it.points, 0) : {x0:c.it.x, y0:c.it.y}); const bx = Math.min.apply(null, boxes.map(b=>b.x0)), by = Math.min.apply(null, boxes.map(b=>b.y0));
    const at = hover ? [Math.round(hover.x), Math.round(hover.y)] : [bx + 1, by + 1]; const dx = Math.round(at[0] - bx), dy = Math.round(at[1] - by);
    mutate(()=>{ const keys = []; clipboard.forEach(c=>{ const it = JSON.parse(JSON.stringify(c.it)); it.id = MapFormat.newId(c.t); if(it.points) it.points = it.points.map(p=>[r3(p[0] + dx), r3(p[1] + dy)]); else { it.x = r3(it.x + dx); it.y = r3(it.y + dy); }
      (c.t==='o' ? doc.objects : c.t==='w' ? doc.walls : c.t==='p' ? doc.paths : doc.labels).push(it); keys.push(c.t + ':' + it.id); }); sel = new Set(keys); });
  }
  function rotateSel(deg){
    if(prefs.tool==='object' && !sel.size){ ghost.r = ((ghost.r + deg)%360 + 360)%360; if(hover) updateGhost(hover); requestRender(); return; }
    const objs = [...sel].filter(k=>k[0]==='o').map(findItem).filter(Boolean); if(!objs.length) return;
    mutate(()=>objs.forEach(o=>{ o.r = r3(((o.r + deg)%360 + 360)%360); const c = snapCenter(o, o.x, o.y); o.x = c[0]; o.y = c[1]; }));
  }
  function flipSel(){ if(prefs.tool==='object' && !sel.size){ ghost.f = !ghost.f; requestRender(); return; } const objs = [...sel].filter(k=>k[0]==='o').map(findItem).filter(Boolean); if(objs.length) mutate(()=>objs.forEach(o=>{ o.f = !o.f; })); }
  function nudge(dx, dy){ if(!sel.size) return; mutate(()=>moveItems([...sel].map(k=>({key:k, orig:JSON.parse(JSON.stringify(findItem(k)))})), dx, dy)); }
  function moveItems(origs, dx, dy){ origs.forEach(({key, orig})=>{ const it = findItem(key); if(!it) return; if(orig.points) it.points = orig.points.map(p=>[r3(p[0] + dx), r3(p[1] + dy)]); else { it.x = r3(orig.x + dx); it.y = r3(orig.y + dy); } }); }
  function addLabelAt(w){
    const pos = snapPt(w, 0.5);
    dialog('Надпись на карте', `<label class="me-f">Текст<textarea name="text" maxlength="200" rows="2" required></textarea></label>
      <div class="me-f-row"><label class="me-f">Размер, клеток<input type="number" name="size" min="0.2" max="8" step="0.1" value="0.8"></label>
      <label class="me-f">Цвет<select name="color"><option value="#1e1b18">Тёмный</option><option value="#9c2f1c">Красный</option><option value="#e9e3d3">Светлый</option><option value="#2f4f7a">Синий</option></select></label></div>`, (f)=>{
      const text = f.text.value.trim(); if(!text) return false;
      mutate(()=>{ const l = {id:MapFormat.newId('l'), x:pos[0], y:pos[1], text, size:r3(clamp(num(f.size.value, 0.8), 0.2, 8)), color:f.color.value}; doc.labels.push(l); sel = new Set(['l:' + l.id]); });
    });
  }

  /* ---------- мышь / тач ---------- */
  function evPos(e){ const r = canvas.getBoundingClientRect(); return {x:e.clientX - r.left, y:e.clientY - r.top}; }
  // Два пальца на холсте: щипок — масштаб, перемещение — сдвиг карты (одним пальцем — обычный инструмент)
  const mTouches = new Map(); let mPinch = null;
  function pinchState(){ const [a, b] = [...mTouches.values()]; return {d:Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), c:{x:(a.x + b.x)/2, y:(a.y + b.y)/2}}; }
  function onDown(e){
    if(!doc) return;
    if(e.pointerType==='touch'){
      mTouches.set(e.pointerId, evPos(e));
      if(mTouches.size===2){ action = null; const ps = pinchState(); mPinch = {d:ps.d, z:cam.z, w:toWorld(ps.c.x, ps.c.y)}; requestRender(); return; }
      if(mTouches.size>2) return;
    }
    canvas.focus({preventScroll:true});
    const p = evPos(e), w = toWorld(p.x, p.y);
    if(e.button===1 || e.button===2 && prefs.tool!=='wall' && prefs.tool!=='path' || spaceHeld || prefs.tool==='hand'){
      if(e.button===2) return;
      action = {type:'pan', start:p, cam:{x:cam.x, y:cam.y}}; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
    }
    if(e.button===2){ // правая кнопка в стене/пути — убрать последнюю точку / отменить
      e.preventDefault(); if(draft){ draft.points.pop(); if(!draft.points.length) draft = null; requestRender(); } return;
    }
    canvas.setPointerCapture(e.pointerId);
    const tool = prefs.tool;
    if(tool==='select'){
      if(sel.size===1){
        const key = [...sel][0], it = findItem(key);
        if(key[0]==='o' && it && !prefs.locked[layerOf(key)]){ const h = objectHandles(it), ds = (q)=>Math.hypot(q.x - w.x, q.y - w.y)*CELL*cam.z;
          if(ds(h.rotate) < 10){ pushUndo(); action = {type:'rotate', key}; return; }
          if(ds(h.scale) < 10){ pushUndo(); action = {type:'scale', key, s0:it.s || 1, d0:Math.hypot(w.x - it.x, w.y - it.y) || 1}; return; } }
        if((key[0]==='w' || key[0]==='p') && it && !prefs.locked[layerOf(key)]){ const vi = it.points.findIndex(q=>Math.hypot(q[0] - w.x, q[1] - w.y)*CELL*cam.z < 9);
          if(vi>=0){ pushUndo(); action = {type:'vertex', key, vi}; return; } }
      }
      const hit = hitTest(w);
      if(hit){
        if(e.shiftKey){ sel.has(hit) ? sel.delete(hit) : sel.add(hit); renderSide(); requestRender(); return; }
        if(!sel.has(hit)) sel = new Set([hit]);
        pushUndo();
        action = {type:'move', start:w, moved:false, origs:[...sel].map(k=>({key:k, orig:JSON.parse(JSON.stringify(findItem(k)))}))};
        renderSide(); requestRender(); return;
      }
      if(!e.shiftKey) sel.clear();
      action = {type:'box', startScreen:p, curScreen:p, start:w, add:e.shiftKey}; renderSide(); requestRender(); return;
    }
    if(tool==='brush'){ if(prefs.locked.terrain) return toast('Слой «Ландшафт» закреплён'); pushUndo(); action = {type:'paint', any:paintCells(w)}; requestRender(); return; }
    if(tool==='fill'){ if(prefs.locked.terrain) return toast('Слой «Ландшафт» закреплён'); floodFill(w); return; }
    if(tool==='room'){ action = {type:'room', start:snapPt(w, 1), cur:snapPt(w, 1)}; return; }
    if(tool==='wall' || tool==='path'){
      const pt = snapPt(w, tool==='path' ? 0.5 : 1, e);
      if(e.detail >= 2 && draft){ finishDraft(); return; }
      if(!draft) draft = {type:tool, points:[pt]};
      else { const last = draft.points[draft.points.length - 1]; if(last[0]!==pt[0] || last[1]!==pt[1]) draft.points.push(pt); }
      requestRender(); return;
    }
    if(tool==='object'){ updateGhost(w, e); placeObject(); return; }
    if(tool==='label'){ addLabelAt(w); return; }
  }
  function onMove(e){
    if(e.pointerType==='touch' && mTouches.has(e.pointerId)){
      mTouches.set(e.pointerId, evPos(e));
      if(mPinch && mTouches.size>=2){ const ps = pinchState(), z = clamp(mPinch.z * ps.d / mPinch.d, ZOOM_MIN, ZOOM_MAX);
        cam.z = z; cam.x = ps.c.x - mPinch.w.x*CELL*z; cam.y = ps.c.y - mPinch.w.y*CELL*z; requestRender(); renderZoom(); return; }
    }
    if(!doc) return;
    const p = evPos(e), w = toWorld(p.x, p.y); hover = w;
    const st = $('meCursor'); if(st){ const cx = Math.floor(w.x), cy = Math.floor(w.y); st.textContent = (cx>=0 && cy>=0 && cx<doc.cols && cy<doc.rows) ? `клетка ${cx}, ${cy} · ${MapFormat.TERRAIN[doc.terrain[cy*doc.cols + cx]].name}` : ''; }
    if(prefs.tool==='object') updateGhost(w, e);
    if(draft) draft.next = snapPt(w, draft.type==='path' ? 0.5 : 1, e);
    if(!action){ requestRender(); return; }
    switch(action.type){
      case 'pan': cam.x = action.cam.x + p.x - action.start.x; cam.y = action.cam.y + p.y - action.start.y; break;
      case 'paint': if(paintCells(w)) action.any = true; break;
      case 'room': action.cur = snapPt(w, 1, e); break;
      case 'box': action.curScreen = p; break;
      case 'move': {
        let dx = w.x - action.start.x, dy = w.y - action.start.y;
        if(snapOn(e)){ dx = Math.round(dx); dy = Math.round(dy); } else { dx = r3(dx); dy = r3(dy); }
        if(dx || dy) action.moved = true; moveItems(action.origs, dx, dy); break; }
      case 'rotate': { const o = findItem(action.key); if(!o) break; let ang = Math.atan2(w.y - o.y, w.x - o.x)*180/Math.PI + 90; if(!e.altKey) ang = Math.round(ang/15)*15; o.r = r3(((ang%360) + 360)%360); break; }
      case 'scale': { const o = findItem(action.key); if(!o) break; let s = action.s0*Math.hypot(w.x - o.x, w.y - o.y)/action.d0; s = e.altKey ? r3(s) : Math.round(s*20)/20; o.s = clamp(s, S_MIN, S_MAX); break; }
      case 'vertex': { const it = findItem(action.key); if(!it) break; it.points[action.vi] = snapPt(w, action.key[0]==='p' ? 0.5 : 1, e); break; }
    }
    requestRender();
  }
  function onUp(e){
    if(e.pointerType==='touch'){ mTouches.delete(e.pointerId); if(mPinch){ if(mTouches.size<2) mPinch = null; return; } }
    if(!action) return;
    const a = action; action = null;
    if(a.type==='pan'){ canvas.style.cursor = prefs.tool==='hand' ? 'grab' : prefs.tool==='select' ? 'default' : 'crosshair'; return; }
    if(a.type==='paint'){ if(a.any) changed(); else undoStack.pop(); return; }
    if(a.type==='room'){ makeRoom(a); return; }
    if(a.type==='box'){
      const w0 = a.start, w1 = toWorld(a.curScreen.x, a.curScreen.y), x0 = Math.min(w0.x, w1.x), x1 = Math.max(w0.x, w1.x), y0 = Math.min(w0.y, w1.y), y1 = Math.max(w0.y, w1.y);
      if(Math.abs(a.curScreen.x - a.startScreen.x) + Math.abs(a.curScreen.y - a.startScreen.y) > 4){
        const add = (t, arr)=>arr.forEach(it=>{ const key = t + ':' + it.id; if(!usable(layerOf(key))) return; const b = itemBox(key); if(b && b.x0>=x0 && b.x1<=x1 && b.y0>=y0 && b.y1<=y1) sel.add(key); });
        add('o', doc.objects); add('w', doc.walls); add('p', doc.paths); add('l', doc.labels);
      }
      renderSide(); requestRender(); return;
    }
    if(a.type==='move'){ if(!a.moved){ undoStack.pop(); return; } a.origs.forEach(({key})=>{ if(key[0]!=='o') return; const o = findItem(key); if(o && snapOn(e)){ const c = snapCenter(o, o.x, o.y, e); o.x = c[0]; o.y = c[1]; } }); changed(); return; }
    if(a.type==='rotate' || a.type==='scale'){ const o = findItem(a.key); if(o && a.type==='scale' && !(o.r%90)){ const c = snapCenter(o, o.x, o.y, e); o.x = c[0]; o.y = c[1]; } changed(); return; }
    if(a.type==='vertex'){ changed(); return; }
  }
  function onWheel(e){ e.preventDefault(); if(e.altKey && (sel.size || prefs.tool==='object')){ scaleSel(e.deltaY < 0 ? 1.05 : 1/1.05); return; }
    if(wheelIntent(e)==='pan'){ cam.x -= e.deltaX; cam.y -= e.deltaY; requestRender(); return; } // два пальца тачпада — сдвиг карты
    const p = evPos(e); zoomAt(p.x, p.y, cam.z*Math.pow(e.ctrlKey ? 1.01 : 1.0015, -e.deltaY)); }
  function onKey(e){
    if(!visible) return;
    const tg = e.target; if(tg && (tg.tagName==='INPUT' || tg.tagName==='TEXTAREA' || tg.tagName==='SELECT' || tg.isContentEditable)) return;
    if(document.querySelector('.me-modal')) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if(k===' '){ spaceHeld = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    if(ctrl && (k==='z' || k==='я') && !e.shiftKey){ e.preventDefault(); undo(); return; }
    if(ctrl && ((k==='z' || k==='я') && e.shiftKey || k==='y' || k==='н')){ e.preventDefault(); redo(); return; }
    if(ctrl && (k==='s' || k==='ы')){ e.preventDefault(); saveNow(); return; }
    if(ctrl && (k==='d' || k==='в')){ e.preventDefault(); duplicate(); return; }
    if(ctrl && (k==='c' || k==='с')){ e.preventDefault(); copySel(); return; }
    if(ctrl && (k==='v' || k==='м')){ e.preventDefault(); paste(); return; }
    if(ctrl && (k==='a' || k==='ф')){ e.preventDefault(); sel = new Set(); ['o', 'w', 'p', 'l'].forEach(t=>(t==='o' ? doc.objects : t==='w' ? doc.walls : t==='p' ? doc.paths : doc.labels).forEach(it=>{ const key = t + ':' + it.id; if(usable(layerOf(key))) sel.add(key); })); renderSide(); requestRender(); return; }
    if(ctrl) return;
    if(k==='Escape'){ if(draft){ draft = null; } else if(prefs.tool!=='select'){ setTool('select'); } else sel.clear(); renderSide(); requestRender(); return; }
    if(k==='Enter'){ finishDraft(); return; }
    if(k==='Delete' || k==='Backspace'){ e.preventDefault(); if(draft){ draft.points.pop(); if(!draft.points.length) draft = null; requestRender(); } else deleteSelection(); return; }
    if(k==='q' || k==='й'){ rotateSel(e.shiftKey ? -15 : -90); return; }
    if(k==='e' || k==='у'){ rotateSel(e.shiftKey ? 15 : 90); return; }
    if(k==='x' || k==='ч'){ flipSel(); return; }
    if(k===',' || k==='<' || k==='б' || k==='Б'){ scaleSel(e.shiftKey ? 1/1.02 : 1/1.1); return; }
    if(k==='.' || k==='>' || k==='ю' || k==='Ю'){ scaleSel(e.shiftKey ? 1.02 : 1.1); return; }
    if(k==='/' || k==='?'){ scaleSel(1, 1); return; }
    if(k==='[' || k==='х'){ prefs.brush = Math.max(1, prefs.brush - 2); savePrefs(); renderOptions(); requestRender(); return; }
    if(k===']' || k==='ъ'){ prefs.brush = Math.min(15, prefs.brush + 2); savePrefs(); renderOptions(); requestRender(); return; }
    if(k==='+' || k==='='){ zoomAt(vw/2, vh/2, cam.z*1.25); return; }
    if(k==='-'){ zoomAt(vw/2, vh/2, cam.z/1.25); return; }
    if(k==='0'){ fitView(); return; }
    const arrows = {ArrowLeft:[-1, 0], ArrowRight:[1, 0], ArrowUp:[0, -1], ArrowDown:[0, 1]};
    if(arrows[k] && sel.size){ e.preventDefault(); const st = e.shiftKey ? 0.1 : 1; nudge(arrows[k][0]*st, arrows[k][1]*st); return; }
    const map = {v:'select', м:'select', h:'hand', р:'hand', b:'brush', и:'brush', g:'fill', п:'fill', r:'room', к:'room', w:'wall', ц:'wall', p:'path', з:'path', o:'object', щ:'object', t:'label', е:'label'};
    if(map[k.toLowerCase()]){ setTool(map[k.toLowerCase()]); }
  }
  function onKeyUp(e){ if(e.key===' '){ spaceHeld = false; if(canvas) canvas.style.cursor = prefs.tool==='hand' ? 'grab' : prefs.tool==='select' ? 'default' : 'crosshair'; } }

  function toast(t){ setStatus(t); }
  /* ---------- диалоги ---------- */
  function dialog(title, bodyHtml, onSubmit, opts){
    opts = opts || {};
    const wrap = document.createElement('div'); wrap.className = 'me-modal';
    wrap.innerHTML = `<form class="me-dialog"><div class="me-dialog-title">${esc(title)}</div>${bodyHtml}
      <div class="me-dialog-actions">${opts.noCancel ? '' : '<button type="button" class="small" data-close>Отмена</button>'}${onSubmit ? `<button type="submit" class="small primary">${esc(opts.ok || 'Готово')}</button>` : ''}</div></form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form');
    const close = ()=>{ if(!wrap.parentNode) return; wrap.remove(); if(canvas) canvas.focus({preventScroll:true}); if(opts.onClose) opts.onClose(); };
    wrap.addEventListener('pointerdown', (e)=>{ if(e.target===wrap) close(); });
    form.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ e.preventDefault(); close(); } });
    form.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', close));
    form.addEventListener('submit', (e)=>{ e.preventDefault(); if(onSubmit && onSubmit(form)===false) return; close(); });
    const first = form.querySelector('input,textarea,select'); if(first){ first.focus(); if(first.select) first.select(); }
    return {form, close};
  }
  const terrainOptions = (sel)=>MapFormat.TERRAIN.map(t=>`<option value="${t.id}" ${t.id===sel?'selected':''}>${esc(t.name)}</option>`).join('');
  function newMapDialog(){
    dialog('Новая карта', `<label class="me-f">Название<input type="text" name="name" maxlength="80" value="Новая локация" required></label>
      <div class="me-f-row"><label class="me-f">Ширина, клеток<input type="number" name="cols" min="4" max="${MapFormat.MAX_SIDE}" value="40" required></label>
      <label class="me-f">Высота, клеток<input type="number" name="rows" min="4" max="${MapFormat.MAX_SIDE}" value="30" required></label></div>
      <div class="me-f-row me-presets">${[[20, 15, 'Комната'], [40, 30, 'Здание'], [60, 45, 'Квартал'], [100, 75, 'Район']].map(([c, r, n])=>`<button type="button" class="small" data-c="${c}" data-r="${r}">${n} ${c}×${r}</button>`).join('')}</div>
      <label class="me-f">Основа ландшафта<select name="base">${terrainOptions('dust')}</select></label>
      <div class="muted me-note">1 клетка = ${TABLE_METERS_PER_CELL} м, как на игровом столе. Текущая карта сохранена в библиотеке.</div>`, (f)=>{
      saveNow(); const d = MapFormat.blank(f.cols.value, f.rows.value, f.base.value); d.name = f.name.value.trim().slice(0, 80) || 'Новая карта'; saveDocTo(d); openDoc(d);
    }, {ok:'Создать'}).form.querySelectorAll('[data-c]').forEach(b=>b.addEventListener('click', ()=>{ const f = b.closest('form'); f.cols.value = b.dataset.c; f.rows.value = b.dataset.r; }));
  }
  function saveDocTo(d){ if(!MapStore.save(d)) setStatus('⚠ Хранилище браузера переполнено'); }
  function openMapDialog(){
    const list = MapStore.list();
    const html = list.length ? `<div class="me-maplist">${list.map(m=>`<div class="me-maprow${doc && m.id===doc.id?' on':''}"><span class="me-mapname">${esc(m.name)}</span><span class="muted">${m.cols}×${m.rows} · ${new Date(m.updated).toLocaleString().slice(0, 17)}</span>
      <button type="button" class="small" data-open="${esc(m.id)}">Открыть</button><button type="button" class="small" data-copy="${esc(m.id)}" title="Создать копию">Копия</button><button type="button" class="small" data-del="${esc(m.id)}" title="Удалить из библиотеки">✕</button></div>`).join('')}</div>`
      : '<div class="muted">Библиотека пуста.</div>';
    const d = dialog('Карты в этом браузере', html, null);
    d.form.addEventListener('click', (e)=>{
      const b = e.target.closest('button'); if(!b) return;
      if(b.dataset.open){ saveNow(); const m = MapStore.get(b.dataset.open); if(m){ openDoc(m); d.close(); } }
      if(b.dataset.copy){ const m = MapStore.get(b.dataset.copy); if(m){ m.id = MapFormat.newId('map'); m.name = (m.name + ' (копия)').slice(0, 80); m.created = m.updated = Date.now(); saveDocTo(m); d.close(); openMapDialog(); } }
      if(b.dataset.del){ if(doc && b.dataset.del===doc.id) return uiAlert('Это открытая сейчас карта — сначала откройте или создайте другую.'); const del = b.dataset.del; uiConfirm('Удалить карту из библиотеки браузера? Отменить нельзя.', {title:'Удалить карту', ok:'Удалить', danger:true}).then(ok=>{ if(ok){ MapStore.remove(del); d.close(); openMapDialog(); } }); }
    });
  }
  function download(name, blob){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  const fileBase = ()=>(doc.name || 'map').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  function exportJSON(){ saveNow(); const j = MapFormat.toJSON(doc), ids = Object.keys(j.assets || {}); setStatus(ids.length ? 'Собираю картинки своих объектов…' : 'Экспорт…');
    Promise.all(ids.map(id=>CustomAssets.dataURL(id).then(du=>{ if(du) j.assets[id].data = du; }))).then(()=>{ download(fileBase() + '.rmap.json', new Blob([JSON.stringify(j, null, 1)], {type:'application/json'})); setStatus('Экспортировано в файл' + (ids.length ? ' (своих объектов внутри: ' + ids.length + ')' : '')); }); }
  function importJSON(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = ()=>{ const f = inp.files[0]; if(!f) return; if(f.size > 60*1024*1024) return uiAlert('Файл слишком большой (больше 60 МБ).');
      f.text().then(t=>{ const d = MapFormat.fromJSON(JSON.parse(t)); if(MapStore.get(d.id)){ d.id = MapFormat.newId('map'); d.name = (d.name + ' (импорт)').slice(0, 80); }
        const ids = Object.keys(d.assets || {}); return Promise.all(ids.map(id=>{ const m = d.assets[id]; return CustomAssets.importData(id, {name:m.name, w:m.w, h:m.h, g:m.g}, m.data); })).then(()=>{ ids.forEach(id=>{ delete d.assets[id].data; }); saveNow(); saveDocTo(d); openDoc(d); setStatus('Импортирована «' + d.name + '»' + (ids.length ? ', своих объектов: ' + ids.length : '')); }); })
        .catch(e=>uiAlert('Не удалось открыть файл карты: ' + e.message)); };
    inp.click();
  }
  function exportPNG(){
    const maxPx = 8192, maxPerCell = Math.max(4, Math.floor(maxPx/Math.max(doc.cols, doc.rows)));
    dialog('Экспорт картинки PNG', `<label class="me-f">Пикселей на клетку<input type="number" name="px" min="4" max="${Math.min(128, maxPerCell)}" value="${Math.min(64, maxPerCell)}"></label>
      <label class="me-check"><input type="checkbox" name="grid" checked> С сеткой</label>
      <div class="muted me-note">Картинка ${doc.cols}×${doc.rows} клеток. Для игрового стола она не нужна — стол рисует карту из её данных (кнопка «На игровой стол»). PNG — чтобы распечатать или поделиться; если загружать её как фон по ссылке, укажите ширину ${doc.cols} клеток.</div>`, (f)=>{
      const px = clamp(Math.round(num(f.px.value, 64)), 4, maxPerCell), cv = document.createElement('canvas'); cv.width = doc.cols*px; cv.height = doc.rows*px;
      const c = cv.getContext('2d'); c.fillStyle = '#efe6cc'; c.fillRect(0, 0, cv.width, cv.height); c.setTransform(px, 0, 0, px, 0, 0);
      MapRender.drawMap(c, doc, {k:px});
      if(f.grid.checked){ c.setTransform(1, 0, 0, 1, 0, 0); for(let pass=0;pass<2;pass++){ c.beginPath(); for(let i=0;i<=doc.cols;i++){ if((i%5===0)!==(pass===1)) continue; c.moveTo(i*px + 0.5, 0); c.lineTo(i*px + 0.5, cv.height); } for(let j=0;j<=doc.rows;j++){ if((j%5===0)!==(pass===1)) continue; c.moveTo(0, j*px + 0.5); c.lineTo(cv.width, j*px + 0.5); } c.strokeStyle = pass ? 'rgba(28,23,18,.28)' : 'rgba(28,23,18,.15)'; c.lineWidth = 1; c.stroke(); } }
      cv.toBlob(b=>{ if(b) download(fileBase() + '.png', b); else uiAlert('Браузер не смог собрать картинку такого размера — уменьшите пиксели на клетку.'); }, 'image/png');
    }, {ok:'Скачать PNG'});
  }
  // свои объекты: выбор файлов, окно параметров (по одному на файл), удаление
  function pickPng(at){ const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/png,image/webp,image/jpeg'; inp.onchange = ()=>queuePng([].slice.call(inp.files || []), at); inp.click(); }
  function queuePng(files, at){ files = files.filter(f=>/^image\//.test(f.type)); const next = ()=>{ const f = files.shift(); if(f) customDialog(f, null, at, next); }; next(); }
  function customDialog(file, editId, at, onDone){
    const a = editId ? MapAssets.BY_ID[editId] : null; if(editId && !a) return;
    const src = file ? URL.createObjectURL(file) : (a && a._src);
    const fail = (e)=>{ if(file) URL.revokeObjectURL(src); uiAlert('Не удалось открыть картинку: ' + e.message); if(onDone) onDone(); };
    if(!src) return fail(new Error('картинка ещё не загрузилась'));
    CustomAssets.loadImage(src).then(img=>{
      const iw = img.naturalWidth, ih = img.naturalHeight, ratio = a ? a.h/a.w : ih/iw, r2 = (v)=>Math.round(v*100)/100;
      const w0 = a ? a.w : r2(clamp(Math.round(iw/128*2)/2 || 1, 0.5, 12)), h0 = a ? a.h : r2(w0*ratio);
      const name0 = a ? a.name : (file.name || 'Свой объект').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60);
      const dd = dialog(a ? 'Свой объект: «' + a.name + '»' : 'Свой объект из картинки', `<div class="me-cprev"><canvas width="560" height="360"></canvas></div>
        <label class="me-f">Название<input type="text" name="nm" maxlength="60" value="${esc(name0)}"></label>
        <div class="me-f-row"><label class="me-f">Ширина, клеток<input type="number" name="w" min="0.25" max="60" step="any" value="${w0}"></label><label class="me-f">Высота, клеток<input type="number" name="h" min="0.25" max="60" step="any" value="${h0}"></label></div>
        <label class="me-check"><input type="checkbox" name="keep" checked> Сохранять пропорции картинки (${iw}×${ih} px)</label>
        <label class="me-check"><input type="radio" name="kind" value="obj" ${a && a.g ? '' : 'checked'}> Объект — с тенью (мебель, техника, постройки)</label>
        <label class="me-check"><input type="radio" name="kind" value="ground" ${a && a.g ? 'checked' : ''}> Наземный — без тени, под объектами (пятна, ковры, лужи, разметка)</label>
        <div class="muted me-note">1 клетка = ${TABLE_METERS_PER_CELL} м; сетка на превью — клетки карты. Размер можно поменять позже — у всех копий на картах сразу; у каждой копии есть ещё свой масштаб и поворот (вкладка «Свойства»).</div>`,
        (f)=>{ const meta = {name:f.nm.value.trim().slice(0, 60) || 'Свой объект', w:r2(clamp(num(f.w.value, 1), 0.25, 60)), h:r2(clamp(num(f.h.value, 1), 0.25, 60)), g:f.querySelector('[name=kind]:checked').value==='ground'};
          (a ? CustomAssets.update(a.id, meta) : CustomAssets.fromFile(file, meta)).then(x=>{ if(!x) return;
            if(doc.assets && doc.assets[x.id]) doc.assets[x.id] = Object.assign({}, doc.assets[x.id], CustomAssets.meta(x.id));
            if(!a){ prefs.cat = 'custom'; prefs.search = ''; prefs.asset = x.id; savePrefs(); ghost.v = 0; ghost.r = 0; ghost.f = false; setTool('object'); if(at){ updateGhost(at); placeObject(); } }
            scheduleSave(); renderSide(); requestRender(); setStatus((a ? 'Обновлён: ' : 'Добавлен: ') + x.name); }).catch(e=>uiAlert('Не удалось сохранить: ' + e.message)); },
        {ok:a ? 'Сохранить' : 'Добавить', onClose:()=>{ if(file) setTimeout(()=>URL.revokeObjectURL(src), 3000); if(onDone) onDone(); }});
      const f = dd.form, cv = f.querySelector('.me-cprev canvas'), c = cv.getContext('2d');
      const draw = ()=>{ const w = num(f.w.value, 1), h = num(f.h.value, 1), k = Math.min((cv.width - 40)/w, (cv.height - 40)/h), x0 = (cv.width - w*k)/2, y0 = (cv.height - h*k)/2;
        c.clearRect(0, 0, cv.width, cv.height); c.fillStyle = '#d9cdb0'; c.fillRect(0, 0, cv.width, cv.height); c.strokeStyle = 'rgba(28,23,18,.18)'; c.lineWidth = 1;
        for(let gx = x0 - Math.ceil(x0/k)*k; gx < cv.width; gx += k){ c.beginPath(); c.moveTo(Math.round(gx) + 0.5, 0); c.lineTo(Math.round(gx) + 0.5, cv.height); c.stroke(); }
        for(let gy = y0 - Math.ceil(y0/k)*k; gy < cv.height; gy += k){ c.beginPath(); c.moveTo(0, Math.round(gy) + 0.5); c.lineTo(cv.width, Math.round(gy) + 0.5); c.stroke(); }
        c.imageSmoothingQuality = 'high'; c.drawImage(img, x0, y0, w*k, h*k); c.strokeStyle = 'rgba(168,53,43,.8)'; c.setLineDash([6, 4]); c.strokeRect(x0 + 0.5, y0 + 0.5, w*k, h*k); c.setLineDash([]);
        c.fillStyle = 'rgba(28,23,18,.75)'; c.font = '700 13px Arial, sans-serif'; c.fillText(r2(w) + ' × ' + r2(h) + ' кл. · ' + r2(w*TABLE_METERS_PER_CELL) + ' × ' + r2(h*TABLE_METERS_PER_CELL) + ' м', 10, cv.height - 10); };
      f.w.addEventListener('input', ()=>{ if(f.keep.checked) f.h.value = r2(num(f.w.value, 1)*ratio); draw(); });
      f.h.addEventListener('input', ()=>{ if(f.keep.checked) f.w.value = r2(num(f.h.value, 1)/ratio); draw(); });
      draw();
    }, fail);
  }
  async function customDelete(id){ const a = MapAssets.BY_ID[id]; if(!a) return; const used = doc.objects.filter(o=>o.a===id).length;
    if(!(await uiConfirm('Удалить «' + a.name + '» из библиотеки этого браузера?' + (used ? '\n\nНа этой карте его копий: ' + used + '. Они останутся, но без картинки (пунктирная рамка) — пока карта не открыта с файла, где картинка встроена.' : '') + '\nОтменить нельзя.', {ok:'Да', danger:true}))) return;
    CustomAssets.remove(id).then(()=>{ if(prefs.asset===id){ prefs.asset = 'crate_wood'; savePrefs(); } renderSide(); renderOptions(); requestRender(); setStatus('Удалено: ' + a.name); }); }
  // нормализация после генерации — то же, что даст сохранение/загрузка
  function normalizeDoc(){ const n = MapFormat.fromJSON(MapFormat.toJSON(doc)); doc.objects = n.objects; doc.walls = n.walls; doc.paths = n.paths; doc.labels = n.labels; doc.gen = n.gen; }
  function seedOf(v){ v = String(v || '').trim(); if(!v) return 0; return /^\d+$/.test(v) ? (Number(v) >>> 0) || 1 : MapAssets.hashStr(v) || 1; }
  function runGen(id, opts){ const g = MapGen.LIST.find(x=>x.id===id); if(!g) return;
    mutate(()=>{ g.run(doc, opts); normalizeDoc(); sel.clear(); });
    setStatus('Сгенерировано: ' + g.name + (doc.gen ? ' · зерно ' + doc.gen.seed : '')); if(typeof GmAdvice!=='undefined') GmAdvice.event('mapgen'); }
  const GEN_LBL = [['none', 'без подписей'], ['buildings', 'здания и комнаты'], ['rooms', '+ помещения внутри зданий'], ['full', '+ мини-сцены и заголовок']], GEN_LSZ = [['small', 'мелкие'], ['normal', 'обычные'], ['large', 'крупные']];
  function generateDialog(pre){
    pre = pre || {}; const po = pre.opts || {}, cur = pre.id || (doc.gen && doc.gen.id) || MapGen.LIST[0].id;
    const sel2 = (name, v, list)=>`<select name="${name}">${list.map(([k, n])=>`<option value="${k}" ${(v || list[1 % list.length][0])===k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const SC = [['none', 'нет'], ['normal', 'обычно'], ['many', 'много']];
    const LBL = GEN_LBL, LSZ = GEN_LSZ;
    const dl = dialog('Сгенерировать планировку', `<div class="me-genform">
      <div class="me-genlist">${MapGen.LIST.map(g=>`<label class="me-check"><input type="radio" name="gen" value="${g.id}" ${g.id===cur?'checked':''}> ${esc(g.name)}</label>`).join('')}</div>
      <label class="me-f">Зерно генерации <div class="me-scale-row"><input type="text" name="seed" maxlength="16" placeholder="случайное" value="${pre.seed ? esc(String(pre.seed)) : ''}"><button type="button" class="small" onclick="this.form.seed.value=String(1 + Math.floor(Math.random()*999999999))" title="Случайное зерно">🎲</button></div></label>
      <div class="muted me-note">Одно и то же зерно с теми же параметрами и размером карты даёт ту же самую карту. Пусто — новое случайное. Можно ввести слово.</div>
      <fieldset class="me-gopt" data-for="city"><legend>Квартал</legend><div class="me-f-row">
        <label class="me-f">Застройка${sel2('density', po.density, [['sparse', 'редкая'], ['normal', 'обычная'], ['dense', 'плотная']])}</label>
        <label class="me-f">Разруха${sel2('ruin', po.ruin, [['low', 'меньше'], ['normal', 'обычно'], ['high', 'больше']])}</label></div><div class="me-f-row">
        <label class="me-f">Район${sel2('theme', po.theme || 'mixed', [['mixed', 'смешанный'], ['live', 'жилой'], ['trade', 'торговый'], ['industry', 'промышленный'], ['civic', 'служебный']])}</label>
        <label class="me-f">Мини-сцены${sel2('scenes_city', po.scenes, SC)}</label></div></fieldset>
      <fieldset class="me-gopt" data-for="bunker"><legend>Бункер</legend><div class="me-f-row">
        <label class="me-f">Комнаты${sel2('rooms', po.rooms, [['small', 'мелкие'], ['normal', 'обычные'], ['large', 'крупные']])}</label>
        <label class="me-f">Состояние${sel2('cond', po.cond || 'random', [['random', 'случайное'], ['abandoned', 'заброшен'], ['flooded', 'затоплен'], ['infested', 'заражён'], ['wrecked', 'разгромлен']])}</label></div>
        <label class="me-f">Мини-сцены${sel2('scenes_bunker', po.scenes, SC)}</label></fieldset>
      <fieldset class="me-gopt" data-for="camp"><legend>Лагерь</legend><div class="me-f-row">
        <label class="me-f">Тип${sel2('ctype', po.ctype || 'random', [['random', 'случайный'], ['settle', 'поселение'], ['raiders', 'банда рейдеров'], ['caravan', 'стоянка каравана'], ['military', 'военный']])}</label>
        <label class="me-f">Ограда${sel2('perim', po.perim || 'random', [['random', 'по типу'], ['scrap', 'стена из лома'], ['palisade', 'частокол'], ['wire', 'сетка и колючка'], ['vehicles', 'кольцо машин'], ['sandbag', 'мешки с песком'], ['none', 'без ограды']])}</label></div><div class="me-f-row">
        <label class="me-f">Местность${sel2('terr', po.terr || 'random', [['random', 'случайная'], ['waste', 'пустошь'], ['ruins', 'среди руин'], ['dryriver', 'у сухого русла'], ['rocks', 'в скалах']])}</label>
        <label class="me-f">Размер${sel2('csize', po.csize || 'medium', [['small', 'маленький'], ['medium', 'средний'], ['full', 'во всю карту']])}</label></div><div class="me-f-row">
        <label class="me-f">Состояние${sel2('cstate', po.cstate || 'random', [['random', 'случайное'], ['living', 'обжитой'], ['abandoned', 'брошенный'], ['ravaged', 'разорённый']])}</label>
        <label class="me-f">Мини-сцены${sel2('scenes_camp', po.scenes, SC)}</label></div></fieldset>
      <fieldset class="me-gopt"><legend>Подписи</legend><div class="me-f-row"><label class="me-f">Что подписать${sel2('labels', po.labels || 'buildings', LBL)}</label><label class="me-f">Размер${sel2('lsize', po.lsize, LSZ)}</label></div><div class="muted me-note">Подписи — обычные надписи карты: их видят и игроки на столе. Потом их можно поменять во вкладке «Карта», не перегенерируя карту.</div></fieldset>
      <fieldset class="me-gopt" data-for="rooms"><legend>Заготовки комнат и сцен</legend><div class="me-f-row"><label class="me-f">Как часто${sel2('prefabs', po.prefabs, [['none', 'не использовать'], ['some', 'иногда'], ['often', 'часто']])}</label>
        <div class="me-f"><span class="muted">${MapGen.prefabList().length} шт. (своих ${MapGen.userPrefabs().length})</span><button type="button" class="small" data-pfmanage>Заготовки…</button></div></div></fieldset>
      <div class="muted me-note">Заменит содержимое текущей карты (${doc.cols}×${doc.rows} клеток). Отменить можно кнопкой ↶ или Ctrl+Z. Отдельное здание или комнату потом можно перегенерировать во вкладке «Свойства».</div></div>`, (f)=>{
      const id = f.gen.value, opts = {seed:seedOf(f.seed.value), labels:f.labels.value, lsize:f.lsize.value};
      if(id==='city') Object.assign(opts, {density:f.density.value, ruin:f.ruin.value, theme:f.theme.value, scenes:f.scenes_city.value});
      if(id==='bunker') Object.assign(opts, {rooms:f.rooms.value, cond:f.cond.value, scenes:f.scenes_bunker.value});
      if(id==='camp') Object.assign(opts, {ctype:f.ctype.value, perim:f.perim.value, terr:f.terr.value, csize:f.csize.value, cstate:f.cstate.value, scenes:f.scenes_camp.value});
      opts.prefabs = f.prefabs.value;
      runGen(id, opts);
    }, {ok:'Сгенерировать'});
    const pb = dl.form.querySelector('[data-pfmanage]'); if(pb) pb.addEventListener('click', ()=>{ dl.close(); prefabDialog(); });
  }
  // Заготовки: выделенные предметы → своя заготовка (комната или сцена) для генератора; список, расстановка, обмен файлом
  function prefabSaveDialog(){
    const objs = [...sel].filter(k=>k[0]==='o').map(findItem).filter(Boolean); if(!objs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach(o=>{ const a = MapAssets.BY_ID[o.a] || {w:1, h:1}, s = o.s || 1, q = Math.round(((o.r||0)%180 + 180)%180)===90, w = (q ? a.h : a.w)*s, h = (q ? a.w : a.h)*s; x0 = Math.min(x0, o.x - w/2); y0 = Math.min(y0, o.y - h/2); x1 = Math.max(x1, o.x + w/2); y1 = Math.max(y1, o.y + h/2); });
    x0 = Math.floor(x0 + 0.001); y0 = Math.floor(y0 + 0.001); const W = Math.ceil(x1 - 0.001) - x0, H = Math.ceil(y1 - 0.001) - y0;
    if(W > 30 || H > 30) return uiAlert('Заготовка не больше 30×30 клеток — выделите меньше.');
    const G = MapGen.PF_GROUPS;
    dialog('Сохранить как заготовку', `<label class="me-f">Название<input type="text" name="nm" maxlength="40" required value="Моя заготовка"></label>
      <div class="me-f-row"><label class="me-check"><input type="radio" name="kind" value="room" checked> Комната (вместо обычной мебели)</label><label class="me-check"><input type="radio" name="kind" value="scene"> Сцена (поверх мебели)</label></div>
      <label class="me-f">Для каких комнат<select name="group">${Object.keys(G).map(k=>`<option value="${k}">${esc(G[k][0])}</option>`).join('')}</select></label>
      <label class="me-check"><input type="checkbox" name="swap" checked> Разрешить замены похожих предметов и других вариантов исполнения</label>
      <div class="muted me-note">Предметов: ${objs.length}, размер ${W}×${H} клеток. Генератор ставит заготовку целиком, поворачивая и отражая её, если комната подходит по типу и размеру и все предметы встают, не перекрывая проходов. Хранится в этом браузере; можно выгрузить в файл в списке заготовок.</div>`, (f)=>{
      const list = MapGen.userPrefabs(); const pf = {id:'u' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36), name:f.nm.value.trim().slice(0, 40) || 'Заготовка', kind:f.querySelector('[name=kind]:checked').value, group:f.group.value, w:W, h:H, swap:f.swap.checked,
        items:objs.map(o=>({a:o.a, x:r3(o.x - x0), y:r3(o.y - y0), r:o.r || 0, v:o.v || 0, f:!!o.f, s:o.s || 1}))};
      list.push(pf); if(!MapGen.saveUserPrefabs(list)){ uiAlert('Не удалось сохранить (хранилище браузера недоступно или переполнено).', {icon:'⚠'}); return false; }
      setStatus('Заготовка сохранена: ' + pf.name);
    }, {ok:'Сохранить'});
  }
  function prefabDialog(){
    const all = MapGen.prefabList(), G = MapGen.PF_GROUPS;
    const d = dialog('Заготовки комнат и сцен', `<div class="me-maplist">${all.map(p=>`<div class="me-maprow"><span class="me-mapname">${esc(p.name)}</span><span class="muted">${p.kind==='scene' ? 'сцена' : 'комната'} · ${esc((G[p.group] || ['?'])[0])} · ${p.w}×${p.h}${p.builtin ? ' · встроенная' : ''}</span>
        <button type="button" class="small" data-pfput="${esc(p.id)}" title="Поставить на карту в центр экрана">Поставить</button>${p.builtin ? '' : `<button type="button" class="small" data-pfdel="${esc(p.id)}" title="Удалить">✕</button>`}</div>`).join('')}</div>
      <div class="muted me-note">Своя заготовка: выделите предметы на карте (рамкой) → «Свойства» → «★ Сохранить как заготовку». Генератор берёт заготовки по параметру «Заготовки» в окне генерации.</div>
      <div class="me-btnrow"><button type="button" class="small" data-pfexp>Выгрузить свои в файл</button><button type="button" class="small" data-pfimp>Загрузить из файла</button></div>`, null);
    d.form.addEventListener('click', (e)=>{ const b = e.target.closest('button'); if(!b) return;
      if(b.dataset.pfdel){ const pid = b.dataset.pfdel; uiConfirm('Удалить заготовку?', {ok:'Удалить', danger:true}).then(ok=>{ if(!ok) return; MapGen.saveUserPrefabs(MapGen.userPrefabs().filter(p=>p.id!==pid)); d.close(); prefabDialog(); }); }
      else if(b.dataset.pfput){ const p = all.find(q=>q.id===b.dataset.pfput); if(!p) return; d.close(); const c = toWorld(vw/2, vh/2), ox = Math.round(c.x - p.w/2), oy = Math.round(c.y - p.h/2);
        mutate(()=>{ sel = new Set(); p.items.forEach(o=>{ const it = {id:MapFormat.newId('o'), a:o.a, x:r3(ox + o.x), y:r3(oy + o.y), r:o.r || 0, s:o.s || 1, v:o.v == null ? 0 : o.v, f:!!o.f}; doc.objects.push(it); sel.add('o:' + it.id); }); });
        setTool('select'); setStatus('Поставлена заготовка: ' + p.name); }
      else if(b.dataset.pfexp!==undefined){ const u = MapGen.userPrefabs(); if(!u.length) return uiAlert('Своих заготовок пока нет.'); download('zagotovki.rprefab.json', new Blob([JSON.stringify({format:'reincarnator-prefabs', prefabs:u}, null, 1)], {type:'application/json'})); }
      else if(b.dataset.pfimp!==undefined){ const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = ()=>{ const fl = inp.files[0]; if(!fl) return; fl.text().then(t=>{ const j = JSON.parse(t), add = (j && Array.isArray(j.prefabs) ? j.prefabs : []).filter(MapGen.validPrefab); const cur = MapGen.userPrefabs(), ids = new Set(cur.map(p=>p.id));
          add.forEach(p=>{ if(ids.has(p.id)) p.id = 'u' + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36); delete p.builtin; cur.push(p); }); MapGen.saveUserPrefabs(cur); d.close(); prefabDialog(); setStatus('Загружено заготовок: ' + add.length); }).catch(e=>uiAlert('Не удалось прочитать файл: ' + e.message)); };
        inp.click(); } });
  }
  function genPartOfSel(){ if(sel.size!==1 || !doc.gen) return null; const key = [...sel][0], it = findItem(key); if(!it) return null;
    const x = it.points ? it.points[0][0] : it.x, y = it.points ? it.points[0][1] : it.y; return MapGen.partAt(doc, x, y); }
  function rerollPart(mode){ const p = genPartOfSel(); if(!p) return; let ok = false; const was = p.arch || p.name;
    mutate(()=>{ ok = MapGen.reroll(doc, p, mode); normalizeDoc(); sel.clear(); });
    if(!ok){ restore(undoStack.pop()); return setStatus('Не удалось перегенерировать: не хватило места на участке — здание оставлено как было'); }
    setStatus((mode==='type' && (p.arch || p.name)===was ? 'Другой тип сюда не помещается — перестроено заново: ' : 'Перегенерировано: ') + MapGen.partTitle(p)); }
  // Передать карту на игровой стол: в сессии — JSON на сервер игры (игроки грузят его по ссылке), без сессии — из библиотеки
  function sendToTable(){
    if(typeof GameTable==='undefined') return;
    if(session.role==='player') return uiAlert('Отправить карту на стол может только Мастер. Вы можете экспортировать её в файл и передать Мастеру.');
    saveNow();
    const apply = (url)=>{ GameTable.setScene({mapId:doc.id, url, cols:doc.cols, rows:doc.rows, name:doc.name, rev:doc.updated}); toggleMainTab('table'); setTimeout(()=>GameTable.focusScene(), 60); };
    if(session.role==='gm'){
      const ids = Object.keys(doc.assets || {}); setStatus(ids.length ? 'Загрузка своих объектов (' + ids.length + ')…' : 'Загрузка карты на сервер…');
      Promise.all(ids.map(id=>CustomAssets.upload(id).then(url=>{ doc.assets[id].url = url; }))).then(()=>{ saveNow(); setStatus('Загрузка карты на сервер…'); return MapStore.upload(doc); })
        .then(url=>{ setStatus('Карта на игровом столе'); apply(url); }).catch(e=>{ setStatus('⚠ ' + e.message); uiAlert('Не удалось загрузить карту на сервер игры: ' + e.message); });
    } else { MapStore.invalidateLocal(doc.id); apply('local:' + doc.id); setStatus('Карта на игровом столе'); }
  }

  /* ---------- панели ---------- */
  const ICON = (d)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function renderTools(){
    const el = $('meTools'); if(!el) return;
    el.innerHTML = TOOLS.map(([id, name, key, d])=>`<button type="button" class="me-tool${prefs.tool===id?' on':''}" data-tool="${id}" title="${esc(name)} (${key})" aria-label="${esc(name)}">${ICON(d)}</button>`).join('') +
      `<div class="me-tool-sep"></div><button type="button" class="me-tool" data-act="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить" ${undoStack.length?'':'disabled'}>${ICON('M9 14 L4 9 L9 4 M4 9 H14 a6 6 0 0 1 0 12 H10')}</button>
      <button type="button" class="me-tool" data-act="redo" title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" ${redoStack.length?'':'disabled'}>${ICON('M15 14 L20 9 L15 4 M20 9 H10 a6 6 0 0 0 0 12 H14')}</button>`;
  }
  function renderOptions(){
    const el = $('meOptions'); if(!el) return;
    const t = prefs.tool; let h = '';
    if(t==='brush' || t==='fill' || t==='room'){
      h += `<span class="me-opt-label">${t==='room' ? 'Пол' : 'Ландшафт'}</span><div class="me-swatches">${MapFormat.TERRAIN.map(tt=>`<button type="button" class="me-sw${prefs.terrain===tt.id?' on':''}" data-terrain="${tt.id}" title="${esc(tt.name)}" style="--c:${tt.color || 'transparent'}${MapTex.enabled && MapTex.swatch(tt.id) ? `;background-image:url(${MapTex.swatch(tt.id)});background-size:cover` : ''}">${tt.color ? '' : '∅'}</button>`).join('')}</div>`;
      if(t==='brush') h += `<label class="me-opt">Кисть <input type="range" min="1" max="15" step="2" value="${prefs.brush}" data-brush> <b>${prefs.brush}×${prefs.brush}</b></label>`;
      if(t==='room') h += `<label class="me-opt"><input type="checkbox" data-roomwalls ${prefs.wallsOnRoom?'checked':''}> стены</label><label class="me-opt">Стена <select data-wallkind>${Object.keys(MapFormat.WALL_KINDS).map(k=>`<option value="${k}" ${prefs.wallKind===k?'selected':''}>${esc(MapFormat.WALL_KINDS[k].name)}</option>`).join('')}</select></label>`;
    } else if(t==='wall'){
      h += `<label class="me-opt">Стена <select data-wallkind>${Object.keys(MapFormat.WALL_KINDS).map(k=>`<option value="${k}" ${prefs.wallKind===k?'selected':''}>${esc(MapFormat.WALL_KINDS[k].name)}</option>`).join('')}</select></label><span class="me-hint">клик — точка на узле сетки · двойной клик / Enter — закончить · правый клик / Backspace — убрать точку · Esc — отмена</span>`;
    } else if(t==='path'){
      h += `<label class="me-opt">Путь <select data-pathkind>${Object.keys(MapFormat.PATH_KINDS).map(k=>`<option value="${k}" ${prefs.pathKind===k?'selected':''}>${esc(MapFormat.PATH_KINDS[k].name)}</option>`).join('')}</select></label>
        <label class="me-opt">Ширина <input type="number" min="0.1" max="20" step="0.5" value="${prefs.pathWidth}" data-pathwidth style="width:64px"> кл.</label><span class="me-hint">точки — по половинкам клеток · двойной клик / Enter — закончить</span>`;
    } else if(t==='object'){
      const a = MapAssets.BY_ID[prefs.asset];
      h += a ? `<span class="me-opt-label">${esc(a.name)} · ${a.w}×${a.h}</span>${a.v>1 ? `<label class="me-opt">Вариант <select data-ghostv>${Array.from({length:a.v}, (_, i)=>`<option value="${i}" ${ghost.v===i?'selected':''}>${a.vn ? (i + 1) + '. ' + esc(a.vn[i]) : i + 1}</option>`).join('')}</select></label>` : ''}
        <button type="button" class="small" data-act="rotl" title="Повернуть (Q)">⟲ 90°</button><button type="button" class="small" data-act="rotr" title="Повернуть (E)">⟳ 90°</button><button type="button" class="small" data-act="flip" title="Отразить (X)">⇋</button>
        <span class="me-opt" title="Масштаб, с которым ставятся новые копии этого объекта (запоминается). Клавиши &lt; и &gt;, Alt+колесо"><span class="me-opt-label">Масштаб</span><button type="button" class="small" data-act="sdown">−</button><input type="number" min="10" max="800" step="5" value="${Math.round(defScale(a.id)*100)}" data-ghosts style="width:58px">%<button type="button" class="small" data-act="sup">+</button>${defScale(a.id)!==1 ? '<button type="button" class="small" data-act="sreset" title="Вернуть 100%">↺</button>' : ''}<span class="me-hint">${r3(a.w*defScale(a.id))}×${r3(a.h*defScale(a.id))} кл.</span></span><span class="me-hint">клик — поставить · Esc — закончить</span>` : '<span class="me-hint">Выберите объект в библиотеке справа.</span>';
    } else if(t==='select'){
      if(IS_TOUCH_UI) h += `<span class="me-hint">тап — выбрать · перетащить — двигать · два пальца — масштаб и сдвиг карты · поворот, дубль и удаление — в «Свойствах»</span>`; else
      h += `<span class="me-hint">клик — выбрать · Shift — добавить · рамка — несколько · Ctrl+D — дубль · Del — удалить · Q/E — поворот · X — отразить · &lt; &gt; или Alt+колесо — масштаб, / — 100% · стрелки — сдвиг · Alt — без привязки</span>`;
    } else if(t==='hand'){ h += '<span class="me-hint">тяните поле · колесо — масштаб · пробел или средняя кнопка — перемещение из любого инструмента</span>'; }
    else if(t==='label'){ h += '<span class="me-hint">клик по карте — надпись</span>'; }
    h += `<span class="me-opt-spacer"></span><label class="me-opt" title="Показывать сетку (координаты карты от этого не меняются)"><input type="checkbox" data-grid ${prefs.grid?'checked':''}> Сетка</label>
      <label class="me-opt" title="Привязка к клеткам (Alt — временно выключить)"><input type="checkbox" data-snap ${prefs.snap?'checked':''}> Привязка</label>`;
    el.innerHTML = h;
  }
  function renderTop(){
    const n = $('meName'); if(n && doc && document.activeElement!==n) n.value = doc.name;
    const sz = $('meSize'); if(sz && doc) sz.textContent = `${doc.cols}×${doc.rows} кл. · ${doc.cols*doc.metersPerCell}×${doc.rows*doc.metersPerCell} м`;
    renderTools();
  }
  function renderSide(){
    const tabs = $('meSideTabs'), body = $('meSideBody'); if(!tabs || !body || !doc) return;
    const T = [['lib', 'Библиотека'], ['props', 'Свойства' + (sel.size ? ` (${sel.size})` : '')], ['layers', 'Слои'], ['map', 'Карта']];
    tabs.innerHTML = T.map(([k, n])=>`<button type="button" class="me-tab${prefs.side===k?' on':''}" data-side="${k}">${n}</button>`).join('');
    if(prefs.side==='lib') return renderLibrary(body);
    if(prefs.side==='props') return renderProps(body);
    if(prefs.side==='layers') return renderLayers(body);
    renderMapPanel(body);
  }
  function libraryItems(){
    const q = norm(prefs.search).trim();
    let list = MapAssets.LIST;
    if(q) list = list.concat(CustomAssets.list()).filter(a=>norm(a.name + ' ' + a.t + ' ' + catName(a.cat)).indexOf(q)>=0);
    else if(prefs.cat==='custom') list = CustomAssets.list();
    else if(prefs.cat==='recent') list = prefs.recent.map(id=>MapAssets.BY_ID[id]).filter(Boolean);
    else if(prefs.cat!=='all') list = list.filter(a=>a.cat===prefs.cat);
    return list;
  }
  const norm = (s)=>String(s||'').toLowerCase().replace(/ё/g, 'е');
  const catName = (c)=>c==='custom' ? 'Свои' : (MapAssets.CATS.find(x=>x[0]===c) || [0, ''])[1];
  function renderLibrary(body){
    const focus = document.activeElement && document.activeElement.id==='meSearch';
    const cats = [['all', 'Все'], ['recent', 'Недавние'], ['custom', 'Свои']].concat(MapAssets.CATS);
    const list = libraryItems();
    body.innerHTML = `<div class="me-lib-head"><input type="search" id="meSearch" class="me-search" placeholder="🔍 Найти объект…" value="${esc(prefs.search)}" aria-label="Найти объект">
      <div class="me-cats">${cats.map(([k, n])=>`<button type="button" class="me-cat${prefs.cat===k && !prefs.search?' on':''}" data-cat="${k}">${esc(n)}</button>`).join('')}</div>
      <div class="me-count muted">${list.length} ${list.length===1?'объект':'объектов'} · клик — выбрать, перетащить — сразу на карту</div>
      ${prefs.cat==='custom' && !prefs.search ? `<div class="me-btnrow"><button type="button" class="small primary" data-act="pngadd">＋ Загрузить PNG</button></div><div class="muted me-note">PNG, WebP или JPG (лучше с прозрачным фоном). Файлы можно перетащить прямо на карту. Хранятся в этом браузере; на игровой стол уходят вместе с картой.</div>` : ''}</div>
      <div class="me-assets" id="meAssets"></div>`;
    const grid = $('meAssets');
    list.forEach(a=>{ const b = document.createElement('button'); b.type = 'button'; b.className = 'me-asset' + (prefs.tool==='object' && prefs.asset===a.id ? ' on' : ''); b.dataset.asset = a.id; b.title = `${a.name} — ${a.w}×${a.h} кл.${a.v>1 ? ', вариантов: ' + a.v : ''}`;
      b.appendChild(cloneCanvas(MapAssets.thumbnail(a.id, 0, 56))); // миниатюра рисуется один раз, в сетку — копия
      const n = document.createElement('span'); n.className = 'me-asset-name'; n.textContent = a.name; b.appendChild(n);
      if(a.v>1){ const v = document.createElement('span'); v.className = 'me-asset-var'; v.textContent = '×' + a.v; b.appendChild(v); }
      if(a.custom){ const sz = document.createElement('span'); sz.className = 'me-asset-var'; sz.textContent = a.w + '×' + a.h; b.appendChild(sz);
        [['cedit', '✎', 'Название, размер, тип'], ['cdel', '✕', 'Удалить из библиотеки']].forEach(([k, t, ti], i)=>{ const x = document.createElement('span'); x.className = 'me-asset-tool' + (i ? ' del' : ''); x.dataset[k] = a.id; x.textContent = t; x.title = ti; b.appendChild(x); }); }
      grid.appendChild(b); });
    if(prefs.cat==='custom' && !prefs.search && !list.length) grid.insertAdjacentHTML('beforeend', '<div class="muted me-note" style="grid-column:1/-1">Своих объектов пока нет.</div>');
    if(focus){ const s = $('meSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  function cloneCanvas(c){ const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.style.width = c.style.width; n.style.height = c.style.height; n.getContext('2d').drawImage(c, 0, 0); return n; }
  function renderProps(body){
    if(!sel.size){ body.innerHTML = '<div class="muted me-note">Ничего не выбрано. Инструмент «Выбор» (V): клик по объекту, стене, пути или надписи.</div>' + (doc.gen && doc.gen.parts.length ? '<div class="muted me-note">Чтобы перегенерировать одно здание или комнату сгенерированной карты, выберите любой предмет или стену внутри него.</div>' : ''); return; }
    const gp = genPartOfSel(), gpHtml = gp ? `<div class="me-genpart"><div class="me-prop-title">${gp.k==='b' ? 'Здание' : gp.k==='z' ? 'Зона лагеря' : 'Комната'}: ${esc(MapGen.partTitle(gp))}</div>
      <div class="me-btnrow"><button type="button" class="small" data-act="reroll" title="Тот же тип, новая планировка, мебель и состояние">↻ Перегенерировать</button>${gp.k==='b' || !/^(gate|core)$/.test(gp.zone || '') ? `<button type="button" class="small" data-act="rerolltype" title="Другой тип — из тех, что ещё не встречались на карте">⇄ Другой тип</button>` : ''}</div>
      <div class="muted me-note">Меняется только ${gp.k==='b' ? 'это здание и его двор' : gp.k==='z' ? 'эта зона' : 'эта комната'}, остальная карта остаётся. Отменить — Ctrl+Z.</div></div>` : '';
    if(sel.size > 1){ const no = [...sel].filter(k=>k[0]==='o').length; body.innerHTML = `<div class="me-note">Выбрано: ${sel.size}</div>${no ? `<div class="me-f me-scale">Масштаб объектов (${no})<div class="me-btnrow"><button type="button" class="small" data-act="sdown" title="−10% (&lt;)">−10%</button><button type="button" class="small" data-act="sup" title="+10% (&gt;)">+10%</button>${[0.5, 0.75, 1, 1.5, 2].map(v=>`<button type="button" class="small" data-sset="${v}">${pct(v)}</button>`).join('')}</div></div>` : ''}<div class="me-btnrow"><button type="button" class="small" data-act="dup">Дублировать</button><button type="button" class="small" data-act="rotr">Повернуть 90°</button><button type="button" class="small" data-act="del">Удалить</button></div>${no ? '<div class="me-btnrow"><button type="button" class="small" data-act="pfsave" title="Сохранить выделенные предметы как заготовку комнаты или сцены для генератора">★ Сохранить как заготовку…</button></div>' : ''}`; return; }
    const key = [...sel][0], it = findItem(key); if(!it){ sel.clear(); body.innerHTML = ''; return; }
    const t = key[0]; let h = '';
    if(t==='o'){ const a = MapAssets.BY_ID[it.a] || {name:it.a, v:1, w:1, h:1};
      h = `<div class="me-prop-title">${esc(a.name)} <span class="muted">${a.w}×${a.h} кл.</span></div>
        <div class="me-f-row"><label class="me-f">X (центр)<input type="number" step="0.5" data-prop="x" value="${it.x}"></label><label class="me-f">Y (центр)<input type="number" step="0.5" data-prop="y" value="${it.y}"></label></div>
        <label class="me-f">Поворот, °<input type="number" step="15" data-prop="r" value="${it.r}"></label>
        ${scaleBlock(it.s || 1, a)}
        ${a.v>1 ? `<label class="me-f">Вариант<select data-prop="v">${Array.from({length:a.v}, (_, i)=>`<option value="${i}" ${it.v===i?'selected':''}>${a.vn ? (i + 1) + '. ' + esc(a.vn[i]) : i + 1}</option>`).join('')}</select></label>` : ''}
        <label class="me-check"><input type="checkbox" data-prop="f" ${it.f?'checked':''}> Отражён</label>`;
    } else if(t==='w'){ h = `<div class="me-prop-title">Стена · ${it.points.length} точ.</div><label class="me-f">Материал<select data-prop="kind">${Object.keys(MapFormat.WALL_KINDS).map(k=>`<option value="${k}" ${it.kind===k?'selected':''}>${esc(MapFormat.WALL_KINDS[k].name)}</option>`).join('')}</select></label><div class="muted me-note">Точки тянутся за квадратные ручки.</div>`; }
    else if(t==='p'){ h = `<div class="me-prop-title">Путь · ${it.points.length} точ.</div><label class="me-f">Вид<select data-prop="kind">${Object.keys(MapFormat.PATH_KINDS).map(k=>`<option value="${k}" ${it.kind===k?'selected':''}>${esc(MapFormat.PATH_KINDS[k].name)}</option>`).join('')}</select></label><label class="me-f">Ширина, клеток<input type="number" step="0.5" min="0.1" max="20" data-prop="width" value="${it.width}"></label>`; }
    else { h = `<div class="me-prop-title">Надпись</div><label class="me-f">Текст<textarea data-prop="text" maxlength="200" rows="2">${esc(it.text)}</textarea></label><div class="me-f-row"><label class="me-f">Размер<input type="number" step="0.1" min="0.2" max="8" data-prop="size" value="${it.size}"></label><label class="me-f">Цвет<input type="color" data-prop="color" value="${it.color}"></label></div>`; }
    body.innerHTML = gpHtml + h + `<div class="me-btnrow"><button type="button" class="small" data-act="dup" title="Ctrl+D">Дублировать</button><button type="button" class="small" data-act="del" title="Del">Удалить</button></div>`;
  }
  function scaleBlock(sv, a){
    const real = a.id ? `${r3(a.w*sv)}×${r3(a.h*sv)} кл.` : '';
    return `<div class="me-f me-scale">Масштаб <span class="muted">${real}</span>
      <div class="me-scale-row"><input type="range" min="${S_MIN}" max="4" step="0.05" value="${Math.min(4, sv)}" data-srange><input type="number" min="10" max="${S_MAX*100}" step="5" value="${Math.round(sv*100)}" data-prop="sp" style="width:62px">%</div>
      <div class="me-btnrow">${[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map(v=>`<button type="button" class="small${Math.abs(sv - v) < 0.001 ? ' on' : ''}" data-sset="${v}">${pct(v)}</button>`).join('')}</div>
      ${a.id ? `<div class="me-btnrow"><button type="button" class="small" data-sdef="${esc(a.id)}" title="Новые копии «${esc(a.name)}» будут ставиться с этим масштабом (сейчас ${pct(defScale(a.id))})">Сделать масштабом по умолчанию для этого объекта</button></div>` : ''}</div>`;
  }
  function applyProp(el){
    const key = [...sel][0], it = key && findItem(key); if(!it) return;
    const p = el.dataset.prop; let v = el.type==='checkbox' ? el.checked : el.value;
    pushUndo();
    if(p==='x' || p==='y'){ it[p] = r3(clamp(num(v, it[p]), -10, MapFormat.MAX_SIDE + 10)); }
    else if(p==='r'){ it.r = r3(((num(v, 0)%360) + 360)%360); }
    else if(p==='s'){ it.s = r3(clamp(num(v, 1), S_MIN, S_MAX)); }
    else if(p==='sp'){ it.s = r3(clamp(num(v, 100)/100, S_MIN, S_MAX)); }
    else if(p==='v'){ it.v = Math.round(num(v, 0)); }
    else if(p==='f'){ it.f = !!v; }
    else if(p==='width'){ it.width = r3(clamp(num(v, 1), 0.1, 20)); }
    else if(p==='size'){ it.size = r3(clamp(num(v, 0.8), 0.2, 8)); }
    else if(p==='text'){ const s = String(v).slice(0, 200); if(!s.trim()){ undoStack.pop(); return; } it.text = s; }
    else it[p] = v;
    doc.updated = Date.now(); scheduleSave(); requestRender(); renderTools();
  }
  function renderLayers(body){
    const count = {terrain:doc.cols*doc.rows, paths:doc.paths.length, ground:doc.objects.filter(MapRender.isGround).length, walls:doc.walls.length, objects:doc.objects.filter(o=>!MapRender.isGround(o)).length, labels:doc.labels.length};
    body.innerHTML = `<div class="muted me-note">Сверху вниз — как рисуется. Скрытие и закрепление — только в редакторе: на игровом столе видны все слои.</div>` +
      MapRender.LAYERS.slice().reverse().map(L=>`<div class="me-layer"><button type="button" class="me-eye${prefs.hidden[L.id]?' off':''}" data-hide="${L.id}" title="${prefs.hidden[L.id]?'Показать':'Скрыть'}">${prefs.hidden[L.id] ? '◌' : '👁'}</button>
        <button type="button" class="me-lock${prefs.locked[L.id]?' on':''}" data-lock="${L.id}" title="${prefs.locked[L.id]?'Открепить':'Закрепить (нельзя выбрать и изменить)'}">${prefs.locked[L.id] ? '🔒' : '🔓'}</button>
        <span class="me-layer-name">${esc(L.name)}</span><span class="muted">${L.id==='terrain' ? doc.cols + '×' + doc.rows : count[L.id]}</span></div>`).join('');
  }
  function renderMapPanel(body){
    body.innerHTML = `<label class="me-f">Название<input type="text" data-map="name" maxlength="80" value="${esc(doc.name)}"></label>
      <div class="me-f-row"><label class="me-f">Ширина, кл.<input type="number" min="4" max="${MapFormat.MAX_SIDE}" data-map="cols" value="${doc.cols}"></label><label class="me-f">Высота, кл.<input type="number" min="4" max="${MapFormat.MAX_SIDE}" data-map="rows" value="${doc.rows}"></label></div>
      <label class="me-f">Ландшафт новых клеток<select data-map="base">${terrainOptions('dust')}</select></label>
      <button type="button" class="small" data-act="resize">Изменить размер</button>
      <div class="muted me-note">Левый верхний угол остаётся на месте — координаты объектов не сдвигаются. 1 клетка = ${doc.metersPerCell} м (как на игровом столе).</div>
      <div class="me-btnrow"><button type="button" class="small" data-act="fit">Показать всю карту (0)</button><button type="button" class="small" data-act="clear">Очистить карту…</button></div>
      <label class="me-check"><input type="checkbox" data-hd ${MapTex.enabled ? 'checked' : ''}> HD-фактуры ландшафта, стен и объектов</label>
      <div class="muted me-note">Настройка этого браузера: действует и в редакторе, и на игровом столе. На слабом устройстве её можно выключить — останутся прежние плоские цвета.</div>
      ${doc.gen ? `<div class="me-genpart"><div class="me-prop-title">Генерация: ${esc((MapGen.LIST.find(x=>x.id===doc.gen.id) || {}).name || doc.gen.id)}</div><div class="muted me-note">Зерно <b>${doc.gen.seed}</b> · ${doc.gen.parts.length ? doc.gen.parts.length + (doc.gen.parts[0].k==='b' ? ' зданий' : doc.gen.parts[0].k==='z' ? ' зон' : ' комнат') : 'без частей'}</div>
        <div class="me-f-row"><label class="me-f">Подписи<select data-genlab>${GEN_LBL.map(([k, n])=>`<option value="${k}" ${(doc.gen.opts.labels || 'buildings')===k ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="me-f">Размер<select data-genlsize>${GEN_LSZ.map(([k, n])=>`<option value="${k}" ${(doc.gen.opts.lsize || 'normal')===k ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div class="me-btnrow"><button type="button" class="small" data-act="regen" title="Открыть генерацию с этим зерном и параметрами">Повторить / настроить…</button><button type="button" class="small" data-act="regennew" title="Те же параметры, новое зерно">🎲 Новый вариант</button></div></div>` : ''}
      <div class="me-btnrow"><button type="button" class="small" data-act="prefabs" title="Встроенные и свои заготовки комнат и сцен">Заготовки комнат и сцен…</button></div>
      <div class="muted me-note">ID карты: ${esc(doc.id)} · формат v${MapFormat.CURRENT_VERSION} · объектов ${doc.objects.length}, стен ${doc.walls.length}, путей ${doc.paths.length}, надписей ${doc.labels.length}</div>`;
  }

  function renderAll(){ renderTop(); renderOptions(); renderSide(); renderZoom(); requestRender(); }

  /* ---------- разметка и события ---------- */
  function build(){
    const root = $('mapEditorView');
    root.innerHTML = `
      <div class="me-topline">
        <button type="button" class="gt-back-btn" data-act="back" title="Вернуть шапку и вкладки">← К листу персонажа</button>
        <input type="text" id="meName" class="me-name" maxlength="80" aria-label="Название карты">
        <span id="meSize" class="me-size"></span>
        <span class="me-top-sep"></span>
        <button type="button" class="small" data-act="new" title="Новая карта">Новая</button>
        <button type="button" class="small" data-act="open" title="Библиотека карт этого браузера">Открыть…</button>
        <button type="button" class="small" data-act="save" title="Сохранить (Ctrl+S). Сохраняется и само">Сохранить</button>
        <button type="button" class="small" data-act="import" title="Открыть файл .rmap.json">Импорт</button>
        <button type="button" class="small" data-act="export" title="Скачать файл карты .rmap.json — данные карты целиком">Экспорт JSON</button>
        <button type="button" class="small" data-act="png" title="Скачать картинку карты">PNG</button>
        <button type="button" class="small" data-act="gen" title="Процедурная генерация планировки">Генерация…</button>
        <button type="button" class="small primary" data-act="table" title="Показать карту на игровом столе (у всех игроков)">На игровой стол</button>
        <span id="meStatus" class="me-status muted"></span>
      </div>
      <div class="me-body">
        <div class="me-tools" id="meTools"></div>
        <div class="me-stage-wrap">
          <div class="me-options" id="meOptions"></div>
          <div class="me-stage" id="meStage"><canvas id="meCanvas" tabindex="0" aria-label="Карта"></canvas>
            <div class="me-zoombar">${wheelModeButtonHtml('small me-wheelmode')}<button type="button" class="small" data-act="zoomout" title="Отдалить (−)">−</button><span id="meZoom">100%</span><button type="button" class="small" data-act="zoomin" title="Приблизить (+)">+</button><button type="button" class="small" data-act="fit" title="Вся карта (0)">⤢</button></div>
            <div class="me-cursor" id="meCursor"></div>
          </div>
        </div>
        <div class="me-side"><div class="me-side-tabs" id="meSideTabs"></div><div class="me-side-body" id="meSideBody"></div></div>
      </div>`;
    stage = $('meStage'); canvas = $('meCanvas'); ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', (e)=>{ mTouches.delete(e.pointerId); mPinch = null; action = null; requestRender(); });
    canvas.addEventListener('pointerleave', ()=>{ hover = null; ghost.at = null; requestRender(); });
    canvas.addEventListener('wheel', onWheel, {passive:false});
    canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
    canvas.addEventListener('dblclick', (e)=>{ if(draft){ e.preventDefault(); finishDraft(); } });
    canvas.addEventListener('dragover', (e)=>{ const t = e.dataTransfer && e.dataTransfer.types; if(t && [].indexOf.call(t, 'Files') >= 0){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    canvas.addEventListener('drop', (e)=>{ const fl = e.dataTransfer && [].slice.call(e.dataTransfer.files || []).filter(f=>/^image\//.test(f.type)); if(!fl || !fl.length) return; e.preventDefault(); const p = evPos(e); queuePng(fl, toWorld(p.x, p.y)); });
    window.addEventListener('reincarnator-assets', ()=>{ if(!visible || !doc) return; if(prefs.side==='lib' && !libDrag) renderSide(); renderOptions(); requestRender(); });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', ()=>{ spaceHeld = false; });
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onLibDown);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    if(typeof ResizeObserver!=='undefined') new ResizeObserver(()=>{ if(visible) resize(); }).observe(stage);
    else window.addEventListener('resize', ()=>{ if(visible) resize(); });
  }
  function resize(){
    const w = stage.clientWidth, h = stage.clientHeight; if(!w || !h) return;
    const first = !vw;
    dpr = window.devicePixelRatio || 1; vw = w; vh = h;
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    if(first) fitView();
    requestRender();
  }
  function onClick(e){
    const ct = e.target.closest && e.target.closest('[data-cedit],[data-cdel]'); if(ct){ e.preventDefault(); if(ct.dataset.cedit) customDialog(null, ct.dataset.cedit); else customDelete(ct.dataset.cdel); return; }
    const b = e.target.closest('button'); if(!b) return;
    const d = b.dataset;
    if(d.tool){ setTool(d.tool); return; }
    if(d.sset){ scaleSel(1, num(d.sset, 1)); return; }
    if(d.sdef){ const o = sel.size===1 && findItem([...sel][0]); if(o){ setAssetScale(d.sdef, o.s || 1); setStatus('Новые «' + ((MapAssets.BY_ID[d.sdef] || {}).name || '') + '» — ' + pct(defScale(d.sdef))); renderSide(); } return; }
    if(d.terrain){ prefs.terrain = d.terrain; savePrefs(); renderOptions(); return; }
    if(d.side){ prefs.side = d.side; savePrefs(); renderSide(); return; }
    if(d.cat){ prefs.cat = d.cat; prefs.search = ''; savePrefs(); renderSide(); return; }
    if(d.asset){ if(suppressAssetClick) return; prefs.asset = d.asset; ghost.v = 0; ghost.r = 0; ghost.f = false; savePrefs(); setTool('object'); renderSide(); return; }
    if(d.hide){ prefs.hidden[d.hide] = !prefs.hidden[d.hide]; if(prefs.hidden[d.hide]) sel.forEach(k=>{ if(layerOf(k)===d.hide) sel.delete(k); }); savePrefs(); renderSide(); requestRender(); return; }
    if(d.lock){ prefs.locked[d.lock] = !prefs.locked[d.lock]; if(prefs.locked[d.lock]) sel.forEach(k=>{ if(layerOf(k)===d.lock) sel.delete(k); }); savePrefs(); renderSide(); requestRender(); return; }
    switch(d.act){
      case 'back': toggleMainTab('sheet'); break;
      case 'new': newMapDialog(); break;
      case 'open': openMapDialog(); break;
      case 'save': saveNow(); break;
      case 'import': importJSON(); break;
      case 'export': exportJSON(); break;
      case 'png': exportPNG(); break;
      case 'gen': generateDialog(); break;
      case 'regen': generateDialog(doc.gen); break;
      case 'regennew': if(doc.gen) runGen(doc.gen.id, Object.assign({}, doc.gen.opts, {seed:0})); break;
      case 'reroll': rerollPart('same'); break;
      case 'pfsave': prefabSaveDialog(); break;
      case 'prefabs': prefabDialog(); break;
      case 'rerolltype': rerollPart('type'); break;
      case 'pngadd': pickPng(null); break;
      case 'table': sendToTable(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomin': zoomAt(vw/2, vh/2, cam.z*1.25); break;
      case 'zoomout': zoomAt(vw/2, vh/2, cam.z/1.25); break;
      case 'fit': fitView(); break;
      case 'rotl': rotateSel(-90); break;
      case 'rotr': rotateSel(90); break;
      case 'flip': flipSel(); break;
      case 'sup': scaleSel(1.1); break;
      case 'sdown': scaleSel(1/1.1); break;
      case 'sreset': scaleSel(1, 1); break;
      case 'dup': duplicate(); break;
      case 'del': deleteSelection(); break;
      case 'resize': { const f = b.closest('.me-side-body'); const c = num(f.querySelector('[data-map=cols]').value, doc.cols), r = num(f.querySelector('[data-map=rows]').value, doc.rows);
        const base = f.querySelector('[data-map=base]').value, go = ()=>{ mutate(()=>MapFormat.resize(doc, c, r, base)); fitView(); };
        if(c < doc.cols || r < doc.rows){ uiConfirm('Карта станет меньше — клетки за новой границей пропадут (объекты останутся, но окажутся за краем). Продолжить?', {title:'Размер карты', ok:'Уменьшить'}).then(ok=>{ if(ok) go(); }); break; }
        go(); break; }
      case 'clear': uiConfirm('Очистить карту: убрать все объекты, стены, пути и надписи и залить ландшафт сухой землёй? Можно отменить через ↶.', {title:'Очистить карту', ok:'Очистить', danger:true}).then(ok=>{ if(ok) mutate(()=>{ doc.terrain.fill(MapFormat.T_INDEX.dust); doc.objects = []; doc.walls = []; doc.paths = []; doc.labels = []; sel.clear(); }); }); break;
    }
  }
  // Перетаскивание объекта из библиотеки на карту. Мышь — сразу; палец — горизонтальным жестом
  // (вертикальный остаётся прокруткой списка). Над картой вместо иконки — «призрак» с привязкой к сетке.
  let libDrag = null, suppressAssetClick = false, rangeUndo = false;
  function onLibDown(e){
    const b = e.target.closest && e.target.closest('.me-asset'); if(!b || e.button!==0) return;
    libDrag = {id:b.dataset.asset, x:e.clientX, y:e.clientY, pid:e.pointerId, touch:e.pointerType!=='mouse', on:false, el:null};
    window.addEventListener('pointermove', onLibMove, {passive:false}); window.addEventListener('pointerup', onLibUp); window.addEventListener('pointercancel', endLibDrag);
  }
  function overCanvas(e){ const r = canvas.getBoundingClientRect(); return e.clientX>=r.left && e.clientX<r.right && e.clientY>=r.top && e.clientY<r.bottom ? {x:e.clientX - r.left, y:e.clientY - r.top} : null; }
  function onLibMove(e){
    const d = libDrag; if(!d || e.pointerId!==d.pid) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if(!d.on){
      if(Math.hypot(dx, dy) < 6) return;
      if(d.touch && Math.abs(dy) > Math.abs(dx)){ endLibDrag(); return; }
      d.on = true; prefs.asset = d.id; ghost.v = 0; ghost.r = 0; ghost.f = false; savePrefs(); setTool('object');
      d.el = document.createElement('div'); d.el.className = 'me-drag'; d.el.appendChild(cloneCanvas(MapAssets.thumbnail(d.id, 0, 56))); document.body.appendChild(d.el);
      document.body.classList.add('me-dragging');
    }
    e.preventDefault();
    const p = overCanvas(e);
    d.el.style.left = e.clientX + 'px'; d.el.style.top = e.clientY + 'px'; d.el.style.opacity = p ? '0' : '0.92';
    if(p){ hover = toWorld(p.x, p.y); updateGhost(hover, e); } else { hover = null; ghost.at = null; }
    requestRender();
  }
  function onLibUp(e){
    const d = libDrag; if(!d || e.pointerId!==d.pid) return;
    if(d.on){
      suppressAssetClick = true; setTimeout(()=>{ suppressAssetClick = false; }, 0);
      const p = overCanvas(e);
      if(p){ hover = toWorld(p.x, p.y); updateGhost(hover, e); placeObject(); setStatus('Поставлено: ' + (MapAssets.BY_ID[d.id] || {}).name); if(canvas) canvas.focus({preventScroll:true}); }
      renderSide(); requestRender();
    }
    endLibDrag();
  }
  function endLibDrag(){
    if(libDrag && libDrag.el) libDrag.el.remove();
    libDrag = null; document.body.classList.remove('me-dragging');
    window.removeEventListener('pointermove', onLibMove); window.removeEventListener('pointerup', onLibUp); window.removeEventListener('pointercancel', endLibDrag);
  }
  function onInput(e){
    const t = e.target;
    if(t.id==='meSearch'){ prefs.search = t.value; savePrefs(); renderSide(); return; }
    if(t.id==='meName'){ doc.name = t.value.slice(0, 80) || 'Карта'; doc.updated = Date.now(); scheduleSave(); return; }
    if(t.dataset.srange!==undefined){ const o = sel.size===1 && findItem([...sel][0]); if(!o) return; if(!rangeUndo){ pushUndo(); rangeUndo = true; } o.s = r3(clamp(num(t.value, 1), S_MIN, S_MAX)); const n = t.parentNode.querySelector('[data-prop=sp]'); if(n) n.value = Math.round(o.s*100); requestRender(); return; }
    if(t.dataset.brush!==undefined){ prefs.brush = parseInt(t.value, 10) || 1; savePrefs(); const b = t.parentNode.querySelector('b'); if(b) b.textContent = prefs.brush + '×' + prefs.brush; requestRender(); return; }
    if(t.dataset.map==='name'){ doc.name = t.value.slice(0, 80) || 'Карта'; doc.updated = Date.now(); scheduleSave(); renderTop(); return; }
  }
  function onChange(e){
    const t = e.target;
    if(t.dataset.grid!==undefined){ prefs.grid = t.checked; savePrefs(); requestRender(); return; }
    if(t.dataset.hd!==undefined){ MapTex.setEnabled(t.checked); renderOptions(); requestRender(); if(typeof GameTable!=='undefined' && GameTable.redraw) GameTable.redraw(); return; }
    if(t.dataset.snap!==undefined){ prefs.snap = t.checked; savePrefs(); return; }
    if(t.dataset.roomwalls!==undefined){ prefs.wallsOnRoom = t.checked; savePrefs(); return; }
    if(t.dataset.wallkind!==undefined){ prefs.wallKind = t.value; savePrefs(); requestRender(); return; }
    if(t.dataset.pathkind!==undefined){ prefs.pathKind = t.value; prefs.pathWidth = MapFormat.PATH_KINDS[t.value].width; savePrefs(); renderOptions(); requestRender(); return; }
    if(t.dataset.pathwidth!==undefined){ prefs.pathWidth = clamp(num(t.value, 1), 0.1, 20); savePrefs(); requestRender(); return; }
    if((t.dataset.genlab!==undefined || t.dataset.genlsize!==undefined) && doc.gen){ const key = t.dataset.genlab!==undefined ? 'labels' : 'lsize', v = t.value; mutate(()=>{ doc.gen.opts[key] = v; MapGen.applyLabels(doc); normalizeDoc(); }); setStatus('Подписи обновлены'); return; }
    if(t.dataset.ghostv!==undefined){ ghost.v = parseInt(t.value, 10) || 0; requestRender(); return; }
    if(t.dataset.ghosts!==undefined){ scaleSel(1, num(t.value, 100)/100); return; }
    if(t.dataset.srange!==undefined){ if(rangeUndo){ rangeUndo = false; changed(); } return; }
    if(t.dataset.prop){ applyProp(t); renderSide(); return; }
  }

  function ensureDoc(){
    if(doc) return;
    let d = prefs.mapId ? MapStore.get(prefs.mapId) : null;
    if(!d){ const l = MapStore.list(); if(l.length) d = MapStore.get(l[0].id); }
    if(!d){ d = MapFormat.blank(40, 30, 'dust'); d.name = 'Первая локация'; saveDocTo(d); }
    doc = d; prefs.mapId = d.id; savePrefs();
  }
  function setVisible(v){
    visible = !!v;
    if(!visible){ if(saveTimer) saveNow(); return; }
    if(!inited){ inited = true; build(); }
    ensureDoc(); CustomAssets.loadAll(); CustomAssets.registerDoc(doc);
    resize(); renderAll();
    if(MapTex.enabled) MapTex.warm(MapTex.TERRAIN_IDS, ()=>{ if(visible) renderOptions(); }); // фактуры кистей — фоном, по одной
    setTimeout(()=>{ resize(); if(canvas) canvas.focus({preventScroll:true}); }, 60); // после раскладки на весь экран
  }
  window.addEventListener('beforeunload', ()=>{ if(saveTimer) saveNow(); });
  return { setVisible,
    get doc(){ return doc; }, get camera(){ return cam; }, openDoc, saveNow, sendToTable,
    // для проверок/консоли: перевод координат и принудительная отрисовка
    toScreen, toWorld, render:()=>render() };
})();
