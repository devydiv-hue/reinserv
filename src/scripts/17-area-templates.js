/* ======================================================================
   ШАБЛОНЫ ОБЛАСТЕЙ НА ИГРОВОМ СТОЛЕ (ГОТОВО, НО ПОКА ВЫКЛЮЧЕНО).
   Круг (взрыв, граната), конус (огнемёт, дробовик, крик) и линия (луч, очередь) поверх поля: нажать в точке начала,
   протянуть — размер и направление по клеткам; шаблон показывает, кого задевает (жетон считается задетым, если
   область накрывает хотя бы половину его радиуса), и список имён. Шаблон локальный: у других не появляется.
   Включение — только вручную, пока функцию не решили выпустить:
     localStorage.setItem('reincarnator_area_templates_v1', 'on'); location.reload();
   или AreaTemplates.enable(true) в консоли. Тогда на столе появляется кнопка «◬ Область».
   ====================================================================== */
const AreaTemplates = (function(){
  const FLAG = 'reincarnator_area_templates_v1';
  const GT = ()=>typeof GameTable!=='undefined' ? GameTable : null;
  const esc = (s)=>escapeHtml(s==null ? '' : String(s));
  let enabled = false; try{ enabled = localStorage.getItem(FLAG)==='on'; }catch(e){}
  let shape = 'circle', coneDeg = 60, tpl = null, svg = null, tools = null, catcher = null, info = null, drag = null;

  const SHAPES = {circle:'Круг', cone:'Конус', line:'Линия'};
  const cell = ()=>GT().cellPx;
  function vp(){ const gt = GT(), l = gt && gt.layerEl; return l ? l.parentElement : null; }
  // экран → мир (в клетках): камера стола — translate(cam.x, cam.y) scale(cam.z) у слоя
  function toCells(ev){ const v = vp(), r = v.getBoundingClientRect(), cam = GT().camera; return {x:(ev.clientX - r.left - cam.x)/(cell()*cam.z), y:(ev.clientY - r.top - cam.y)/(cell()*cam.z)}; }
  const snapHalf = (v)=>Math.round(v*2)/2;

  /* ---------- геометрия: попадает ли круг жетона (центр c, радиус rt) в шаблон ---------- */
  function hits(t, cx, cy, rt){
    const k = rt*0.5; // половина радиуса жетона должна оказаться внутри
    if(t.shape==='circle') return Math.hypot(cx - t.x, cy - t.y) <= t.r + k;
    const dx = cx - t.x, dy = cy - t.y, len = t.len, a = t.ang, ux = Math.cos(a), uy = Math.sin(a);
    if(Math.hypot(dx, dy) < rt*0.9) return false; // жетон в начале конуса/линии — это сам стреляющий
    const along = dx*ux + dy*uy, across = -dx*uy + dy*ux;
    if(t.shape==='line') return along >= -k && along <= len + k && Math.abs(across) <= t.w/2 + k;
    // конус: расстояние от вершины и угол от оси
    const d = Math.hypot(dx, dy); if(d > len + k) return false;
    const half = t.deg/2*Math.PI/180, off = Math.abs(Math.atan2(across, along));
    return off <= half || d*Math.sin(Math.min(Math.PI/2, off - half)) <= k;
  }
  function affected(t){
    const gt = GT(), out = []; if(!gt || !t) return out;
    Object.values(gt.state.tokens || {}).forEach(tk=>{
      const p = gt.tokenWorld(tk.id); if(!p) return; // невидимые здесь жетоны не считаем
      const C = cell(), cx = p.x/C, cy = p.y/C, rt = p.d/C/2;
      if(hits(t, cx, cy, rt)){ const v = gt.vitalsOf(tk) || {}; out.push(v.name || tk.name || 'Жетон'); }
    });
    return out;
  }

  /* ---------- рисование ---------- */
  function draw(){
    const gt = GT(); if(!gt || !gt.layerEl) return;
    if(!tpl){ if(svg){ svg.remove(); svg = null; } if(info){ info.remove(); info = null; } return; }
    if(!svg){ svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'at-svg'); }
    if(svg.parentNode!==gt.layerEl) gt.layerEl.appendChild(svg);
    const C = cell(), X = (v)=>(v*C).toFixed(1);
    let path = '';
    if(tpl.shape==='circle') path = `<circle cx="${X(tpl.x)}" cy="${X(tpl.y)}" r="${X(tpl.r)}"/>`;
    else if(tpl.shape==='line'){ const ux = Math.cos(tpl.ang), uy = Math.sin(tpl.ang), nx = -uy*tpl.w/2, ny = ux*tpl.w/2, ex = tpl.x + ux*tpl.len, ey = tpl.y + uy*tpl.len;
      path = `<polygon points="${X(tpl.x + nx)},${X(tpl.y + ny)} ${X(ex + nx)},${X(ey + ny)} ${X(ex - nx)},${X(ey - ny)} ${X(tpl.x - nx)},${X(tpl.y - ny)}"/>`; }
    else { const h = tpl.deg/2*Math.PI/180, a1 = tpl.ang - h, a2 = tpl.ang + h, R = tpl.len;
      path = `<path d="M${X(tpl.x)},${X(tpl.y)} L${X(tpl.x + Math.cos(a1)*R)},${X(tpl.y + Math.sin(a1)*R)} A${X(R)},${X(R)} 0 0 1 ${X(tpl.x + Math.cos(a2)*R)},${X(tpl.y + Math.sin(a2)*R)} Z"/>`; }
    const size = tpl.shape==='circle' ? `радиус ${tpl.r} кл.` : `${tpl.len} кл.${tpl.shape==='cone' ? `, ${tpl.deg}°` : ''}`;
    const who = affected(tpl);
    svg.innerHTML = `<g class="at-shape">${path}</g><circle class="at-origin" cx="${X(tpl.x)}" cy="${X(tpl.y)}" r="${(C*0.12).toFixed(1)}"/>`;
    const v = vp(); if(!info){ info = document.createElement('div'); info.className = 'at-info'; }
    if(info.parentNode!==v) v.appendChild(info);
    info.innerHTML = `<b>${SHAPES[tpl.shape]}</b> · ${size} · задето: <b>${who.length}</b>${who.length ? `<div class="at-names">${who.map(esc).join(', ')}</div>` : ''}<button type="button" class="at-x" title="Убрать шаблон (Esc)">✕</button>`;
  }

  /* ---------- ввод ---------- */
  function startPlacing(s){
    shape = s || shape; clear(); const v = vp(); if(!v) return;
    catcher = document.createElement('div'); catcher.className = 'at-catch'; catcher.title = 'Нажмите в точке начала и протяните — размер и направление';
    v.appendChild(catcher);
    catcher.addEventListener('pointerdown', (e)=>{
      e.preventDefault(); catcher.setPointerCapture(e.pointerId);
      const p = toCells(e), o = shape==='circle' ? {x:Math.round(p.x), y:Math.round(p.y)} : {x:snapHalf(p.x), y:snapHalf(p.y)};
      drag = o; tpl = {shape, x:o.x, y:o.y, r:1, len:1, ang:0, w:1, deg:coneDeg}; draw();
    });
    catcher.addEventListener('pointermove', (e)=>{
      if(!drag) return; const p = toCells(e), dx = p.x - drag.x, dy = p.y - drag.y, d = Math.hypot(dx, dy);
      if(shape==='circle') tpl.r = Math.max(1, Math.round(d));
      else { tpl.len = Math.max(1, Math.round(d)); tpl.ang = Math.atan2(dy, dx); if(!e.shiftKey) tpl.ang = Math.round(tpl.ang/(Math.PI/8))*(Math.PI/8); } // Shift — свободный угол
      draw();
    });
    const end = ()=>{ if(!drag) return; drag = null; if(catcher){ catcher.remove(); catcher = null; } renderTools(); };
    catcher.addEventListener('pointerup', end); catcher.addEventListener('pointercancel', end);
    renderTools();
  }
  function clear(){ tpl = null; drag = null; if(catcher){ catcher.remove(); catcher = null; } draw(); renderTools(); }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && (tpl || catcher)){ clear(); } });
  document.addEventListener('click', (e)=>{ if(e.target.closest && e.target.closest('.at-x')) clear(); });
  // жетоны двигаются — пересчитать задетых
  setInterval(()=>{ if(tpl && !drag) draw(); }, 1000);

  function renderTools(){
    const v = vp(); if(!enabled || !v){ if(tools){ tools.remove(); tools = null; } return; }
    if(!tools){ tools = document.createElement('div'); tools.className = 'at-tools';
      tools.addEventListener('click', (e)=>{ const b = e.target.closest('[data-at]'); if(!b) return; const a = b.dataset.at;
        if(a==='open'){ tools.classList.toggle('open'); if(!tools.classList.contains('open')) clear(); else renderTools(); }
        else if(a==='deg'){ coneDeg = coneDeg===60 ? 90 : coneDeg===90 ? 45 : 60; if(tpl && tpl.shape==='cone'){ tpl.deg = coneDeg; draw(); } renderTools(); }
        else if(SHAPES[a]) startPlacing(a); }); }
    if(tools.parentNode!==v) v.appendChild(tools);
    const open = tools.classList.contains('open');
    tools.innerHTML = `<button type="button" data-at="open" class="gt-tool${open ? ' active' : ''}" title="Шаблоны областей: круг, конус, линия — кого задевает">◬ Область</button>` +
      (open ? Object.keys(SHAPES).map(k=>`<button type="button" class="gt-tool${catcher && shape===k ? ' active' : ''}" data-at="${k}">${SHAPES[k]}</button>`).join('') +
        `<button type="button" class="gt-tool" data-at="deg" title="Угол конуса">${coneDeg}°</button>` : '');
  }
  setInterval(renderTools, 2000); // стол перерисовывается и меняет вид — кнопка возвращается на место
  function enable(on){ enabled = !!on; try{ localStorage.setItem(FLAG, enabled ? 'on' : 'off'); }catch(e){} if(!enabled) clear(); renderTools(); return enabled; }

  return { get enabled(){ return enabled; }, enable, start:startPlacing, clear, affected, hits };
})();
