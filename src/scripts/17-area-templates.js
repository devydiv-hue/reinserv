/* ======================================================================
   ШАБЛОНЫ ОБЛАСТЕЙ НА ИГРОВОМ СТОЛЕ.
   Круг (взрыв, визг), конус, линия (луч, полоса, поток, рывок) и квадрат поверх поля; шаблон показывает, кого
   задевает (жетон задет, если область накрывает хотя бы половину его радиуса). Шаблон локальный: у других не появляется.
   - Выбор целей для «Бросок цели» (AreaTemplates.pick): размеры — в метрах из текста способности («в радиусе 15 м от
     точки», «полоса шириной 3 м, до 24 м», «луч шириной 1 м и длиной до 30 м», «квадрат со стороной 3 м»), начало —
     от жетона существа или в точке. Круг вокруг существа ставится сразу; круг или квадрат в точке — следует за курсором,
     нажатие фиксирует; линия и конус от существа — направление за курсором, нажатие фиксирует. Без размеров — нажать
     и протянуть. Внизу поля — «Задето: N … Готово / Заново / Отмена». Сам источник в цели не попадает.
   - Свободные шаблоны (кнопка «◬ Область» на столе) — по-прежнему только при включённом флаге
     (localStorage reincarnator_area_templates_v1 = on или AreaTemplates.enable(true)).
   ====================================================================== */
const AreaTemplates = (function(){
  const FLAG = 'reincarnator_area_templates_v1';
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  let enabled = false; try{ enabled = localStorage.getItem(FLAG)==='on'; }catch(e){}
  let shape = 'circle', coneDeg = 60, tpl = null, svg = null, tools = null, catcher = null, info = null, drag = null, pickCtx = null;

  const SHAPES = {circle:'Круг', cone:'Конус', line:'Линия', rect:'Квадрат'};
  const cell = ()=>GT().cellPx;
  const mpc = ()=>{ const gt = GT(), m = gt && gt.state && gt.state.map && +gt.state.map.metersPerCell; return m > 0 ? m : 3; };
  const toCellsM = (m)=>Math.max(0.2, (+m || 0)/mpc());
  const fmtM = (cells)=>{ const m = Math.round(cells*mpc()*10)/10; return String(m).replace('.', ',') + ' м'; };
  function vp(){ const gt = GT(), l = gt && gt.layerEl; return l ? l.parentElement : null; }
  // экран → мир (в клетках): камера стола — translate(cam.x, cam.y) scale(cam.z) у слоя
  function toCells(ev){ const v = vp(), r = v.getBoundingClientRect(), cam = GT().camera; return {x:(ev.clientX - r.left - cam.x)/(cell()*cam.z), y:(ev.clientY - r.top - cam.y)/(cell()*cam.z)}; }
  const snapHalf = (v)=>Math.round(v*2)/2;
  function tokCenter(id){ const gt = GT(), p = gt && gt.tokenWorld(id); return p ? {x:p.x/cell(), y:p.y/cell()} : null; }

  /* ---------- геометрия: попадает ли круг жетона (центр c, радиус rt) в шаблон ---------- */
  function hits(t, cx, cy, rt){
    const k = rt*0.5; // половина радиуса жетона должна оказаться внутри
    if(t.shape==='circle') return Math.hypot(cx - t.x, cy - t.y) <= t.r + k;
    if(t.shape==='rect') return Math.abs(cx - t.x) <= t.side/2 + k && Math.abs(cy - t.y) <= t.side/2 + k;
    const dx = cx - t.x, dy = cy - t.y, len = t.len, a = t.ang, ux = Math.cos(a), uy = Math.sin(a);
    if(Math.hypot(dx, dy) < rt*0.9) return false; // жетон в начале конуса/линии — это сам стреляющий
    const along = dx*ux + dy*uy, across = -dx*uy + dy*ux;
    if(t.shape==='line') return along >= -k && along <= len + k && Math.abs(across) <= t.w/2 + k;
    // конус: расстояние от вершины и угол от оси
    const d = Math.hypot(dx, dy); if(d > len + k) return false;
    const half = t.deg/2*Math.PI/180, off = Math.abs(Math.atan2(across, along));
    return off <= half || d*Math.sin(Math.min(Math.PI/2, off - half)) <= k;
  }
  function affectedTokens(t){
    const gt = GT(), out = []; if(!gt || !t) return out;
    Object.values(gt.state.tokens || {}).forEach(tk=>{
      if(t.exclude && t.exclude.indexOf(tk.id) >= 0) return;
      const p = gt.tokenWorld(tk.id); if(!p) return; // невидимые здесь жетоны не считаем
      const C = cell(), cx = p.x/C, cy = p.y/C, rt = p.d/C/2;
      if(hits(t, cx, cy, rt)){ const v = gt.vitalsOf(tk) || {}; out.push({id:tk.id, name:v.name || tk.name || 'Жетон'}); }
    });
    return out;
  }
  const affected = (t)=>affectedTokens(t).map(x=>x.name);

  /* ---------- рисование ---------- */
  function sizeText(t){ return t.shape==='circle' ? `радиус ${fmtM(t.r)}` : t.shape==='rect' ? `сторона ${fmtM(t.side)}` : t.shape==='line' ? `${fmtM(t.len)} × ${fmtM(t.w)}` : `${fmtM(t.len)}, ${t.deg}°`; }
  function draw(){
    const gt = GT(); if(!gt || !gt.layerEl) return;
    if(!tpl){ if(svg){ svg.remove(); svg = null; } if(info){ info.remove(); info = null; } return; }
    if(!svg){ svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'at-svg'); }
    if(svg.parentNode!==gt.layerEl) gt.layerEl.appendChild(svg);
    const C = cell(), X = (v)=>(v*C).toFixed(1);
    let path = '';
    if(tpl.shape==='circle') path = `<circle cx="${X(tpl.x)}" cy="${X(tpl.y)}" r="${X(tpl.r)}"/>`;
    else if(tpl.shape==='rect') path = `<rect x="${X(tpl.x - tpl.side/2)}" y="${X(tpl.y - tpl.side/2)}" width="${X(tpl.side)}" height="${X(tpl.side)}"/>`;
    else if(tpl.shape==='line'){ const ux = Math.cos(tpl.ang), uy = Math.sin(tpl.ang), nx = -uy*tpl.w/2, ny = ux*tpl.w/2, ex = tpl.x + ux*tpl.len, ey = tpl.y + uy*tpl.len;
      path = `<polygon points="${X(tpl.x + nx)},${X(tpl.y + ny)} ${X(ex + nx)},${X(ey + ny)} ${X(ex - nx)},${X(ey - ny)} ${X(tpl.x - nx)},${X(tpl.y - ny)}"/>`; }
    else { const h = tpl.deg/2*Math.PI/180, a1 = tpl.ang - h, a2 = tpl.ang + h, R = tpl.len;
      path = `<path d="M${X(tpl.x)},${X(tpl.y)} L${X(tpl.x + Math.cos(a1)*R)},${X(tpl.y + Math.sin(a1)*R)} A${X(R)},${X(R)} 0 0 1 ${X(tpl.x + Math.cos(a2)*R)},${X(tpl.y + Math.sin(a2)*R)} Z"/>`; }
    const who = affectedTokens(tpl);
    svg.innerHTML = `<g class="at-shape">${path}</g><circle class="at-origin" cx="${X(tpl.x)}" cy="${X(tpl.y)}" r="${(C*0.12).toFixed(1)}"/>`;
    const v = vp(); if(!info){ info = document.createElement('div'); info.className = 'at-info gt-ui'; }
    if(info.parentNode!==v) v.appendChild(info);
    info.classList.toggle('at-pick', !!pickCtx);
    info.innerHTML = pickCtx
      ? `<b>📐 ${esc(pickCtx.title || 'Область')}</b> · ${SHAPES[tpl.shape].toLowerCase()}, ${sizeText(tpl)} · задето: <b>${who.length}</b>${who.length ? `<div class="at-names">${who.map(x=>esc(x.name)).join(', ')}</div>` : ''}
         <div class="at-hint">${esc(pickCtx.hint || '')}</div>
         <div class="at-btns"><button type="button" class="small" data-atp="cancel">Отмена</button><button type="button" class="small" data-atp="again">Заново</button><button type="button" class="small primary" data-atp="done">Готово — ${who.length}</button></div>`
      : `<b>${SHAPES[tpl.shape]}</b> · ${sizeText(tpl)} · задето: <b>${who.length}</b>${who.length ? `<div class="at-names">${who.map(x=>esc(x.name)).join(', ')}</div>` : ''}<button type="button" class="at-x" title="Убрать шаблон (Esc)">✕</button>`;
  }

  /* ---------- свободный ввод: нажать и протянуть ---------- */
  function newCatcher(title){ const v = vp(); if(!v) return null; if(catcher) catcher.remove(); catcher = document.createElement('div'); catcher.className = 'at-catch'; catcher.title = title || ''; v.appendChild(catcher); return catcher; }
  function startPlacing(s, opts){
    opts = opts || {};
    shape = s || shape; tpl = null; drag = null; draw();
    const c = newCatcher('Нажмите в точке начала и протяните — размер и направление'); if(!c) return;
    c.addEventListener('pointerdown', (e)=>{
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      const p = toCells(e), o = shape==='circle' || shape==='rect' ? {x:Math.round(p.x*2)/2, y:Math.round(p.y*2)/2} : {x:snapHalf(p.x), y:snapHalf(p.y)};
      drag = o; tpl = {shape, x:o.x, y:o.y, r:1, side:1, len:1, ang:0, w:opts.w || 1, deg:opts.deg || coneDeg, exclude:opts.exclude || []}; draw();
    });
    c.addEventListener('pointermove', (e)=>{
      if(!drag) return; const p = toCells(e), dx = p.x - drag.x, dy = p.y - drag.y, d = Math.hypot(dx, dy);
      if(shape==='circle') tpl.r = Math.max(0.5, Math.round(d*2)/2);
      else if(shape==='rect') tpl.side = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))*2));
      else { tpl.len = Math.max(1, Math.round(d)); tpl.ang = Math.atan2(dy, dx); if(!e.shiftKey) tpl.ang = Math.round(tpl.ang/(Math.PI/8))*(Math.PI/8); } // Shift — свободный угол
      draw();
    });
    const end = ()=>{ if(!drag) return; drag = null; if(catcher && !pickCtx){ catcher.remove(); catcher = null; } renderTools(); };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    renderTools();
  }
  function clear(){ tpl = null; drag = null; if(catcher){ catcher.remove(); catcher = null; } draw(); renderTools(); }

  /* ---------- выбор целей для способности ---------- */
  // spec: {shape:'circle'|'line'|'cone'|'rect', r, len, w, side, deg — в метрах; at:'self'|'point'}; src — жетон существа
  function pick(spec, src, title, done){
    const gt = GT(); if(!gt || !vp()){ done(null); return; }
    spec = Object.assign({shape:'circle'}, spec || {});
    const origin = src ? tokCenter(src) : null, at = spec.at==='self' && origin ? 'self' : 'point';
    const sized = spec.shape==='circle' ? spec.r > 0 : spec.shape==='rect' ? spec.side > 0 : spec.len > 0;
    pickCtx = {title, done, spec, src};
    const exclude = src ? [src] : [];
    const finish = (ids)=>{ const cb = pickCtx && pickCtx.done; pickCtx = null; clear(); if(cb) cb(ids); };
    pickCtx.finish = finish;
    if(!sized){ pickCtx.hint = 'Нажмите в точке начала и протяните — размер и направление.'; startPlacing(spec.shape, {w:spec.w ? toCellsM(spec.w) : 1, deg:spec.deg || coneDeg, exclude}); draw(); return; }
    const base = {shape:spec.shape, r:toCellsM(spec.r), side:toCellsM(spec.side), len:toCellsM(spec.len), w:toCellsM(spec.w || 1), deg:spec.deg || coneDeg, ang:0, exclude};
    if(spec.shape==='circle' && at==='self'){ tpl = Object.assign(base, origin); pickCtx.hint = 'Круг вокруг существа. «Заново» — поставить в другую точку.'; draw(); return; }
    const c = newCatcher(''); let fixed = false;
    if(spec.shape==='line' || spec.shape==='cone'){
      const o = at==='self' ? origin : null;
      pickCtx.hint = o ? 'Наведите направление и нажмите. Shift — свободный угол.' : 'Нажмите в точке начала, затем — в направлении.';
      let start = o;
      const aim = (e)=>{ if(!start) return; const p = toCells(e); let a = Math.atan2(p.y - start.y, p.x - start.x); if(!e.shiftKey) a = Math.round(a/(Math.PI/16))*(Math.PI/16); tpl = Object.assign({}, base, start, {ang:a}); draw(); };
      c.addEventListener('pointermove', (e)=>{ if(!fixed) aim(e); });
      c.addEventListener('pointerdown', (e)=>{ e.preventDefault(); if(!start){ const p = toCells(e); start = {x:snapHalf(p.x), y:snapHalf(p.y)}; tpl = Object.assign({}, base, start); draw(); return; } fixed = !fixed; if(fixed) aim(e); });
      if(o){ tpl = Object.assign({}, base, o); }
    } else {
      pickCtx.hint = 'Ведите курсор — область следует за ним; нажатие фиксирует (ещё нажатие — двигать снова).';
      const follow = (e)=>{ const p = toCells(e); tpl = Object.assign({}, base, {x:snapHalf(p.x), y:snapHalf(p.y)}); draw(); };
      c.addEventListener('pointermove', (e)=>{ if(!fixed) follow(e); });
      c.addEventListener('pointerdown', (e)=>{ e.preventDefault(); follow(e); fixed = !fixed; });
      if(origin) tpl = Object.assign({}, base, origin);
    }
    draw();
  }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-atp]'); if(!b || !pickCtx) return;
    e.stopPropagation();
    if(b.dataset.atp==='cancel') pickCtx.finish(null);
    else if(b.dataset.atp==='done') pickCtx.finish(tpl ? affectedTokens(tpl).map(x=>x.id) : []);
    else if(b.dataset.atp==='again'){ const p = pickCtx, sp = Object.assign({}, p.spec, {at:'point'}); pickCtx = null; tpl = null; if(catcher){ catcher.remove(); catcher = null; } pick(sp, p.src, p.title, p.done); }
  });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && (tpl || catcher)){ if(pickCtx) pickCtx.finish(null); else clear(); } });
  document.addEventListener('click', (e)=>{ if(e.target.closest && e.target.closest('.at-x')) clear(); });
  // жетоны двигаются — пересчитать задетых
  setInterval(()=>{ if(tpl && !drag) draw(); }, 1000);

  function renderTools(){
    const v = vp(); if(!enabled || !v){ if(tools){ tools.remove(); tools = null; } return; }
    if(!tools){ tools = document.createElement('div'); tools.className = 'at-tools gt-ui';
      tools.addEventListener('click', (e)=>{ const b = e.target.closest('[data-at]'); if(!b) return; const a = b.dataset.at;
        if(a==='open'){ tools.classList.toggle('open'); if(!tools.classList.contains('open')) clear(); else renderTools(); }
        else if(a==='deg'){ coneDeg = coneDeg===60 ? 90 : coneDeg===90 ? 45 : 60; if(tpl && tpl.shape==='cone'){ tpl.deg = coneDeg; draw(); } renderTools(); }
        else if(SHAPES[a]) startPlacing(a); }); }
    if(tools.parentNode!==v) v.appendChild(tools);
    const open = tools.classList.contains('open');
    tools.innerHTML = `<button type="button" data-at="open" class="gt-tool${open ? ' active' : ''}" title="Шаблоны областей: круг, конус, линия, квадрат — кого задевает">◬ Область</button>` +
      (open ? Object.keys(SHAPES).map(k=>`<button type="button" class="gt-tool${catcher && shape===k ? ' active' : ''}" data-at="${k}">${SHAPES[k]}</button>`).join('') +
        `<button type="button" class="gt-tool" data-at="deg" title="Угол конуса">${coneDeg}°</button>` : '');
  }
  setInterval(renderTools, 2000); // стол перерисовывается и меняет вид — кнопка возвращается на место
  function enable(on){ enabled = !!on; try{ localStorage.setItem(FLAG, enabled ? 'on' : 'off'); }catch(e){} if(!enabled) clear(); renderTools(); return enabled; }

  return { get enabled(){ return enabled; }, enable, start:startPlacing, clear, affected, affectedTokens, hits, pick, metersPerCell:mpc };
})();
