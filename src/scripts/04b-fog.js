/* ======================================================================
   ТУМАН ВОЙНЫ — геометрия и растр (без состояния стола; настройки и жетоны — в GameTable).

   Видно игрокам = (освещённое ∩ линия взгляда любого жетона игрока) ∪ открыто кистью − закрыто кистью.
     - Свет — у любого жетона: круговой (диаметр) или конус (угол и длина); днём освещено всё.
     - Взгляд и свет останавливают стены карты (кроме видов с see: сетка-рабица, мешки с песком), закрытые двери и ворота,
       заколоченные окна и крупные объекты. Окна пропускают взгляд. Дверь или окно поверх стены прорезают её.
     - Крупный объект, на который упал взгляд и свет, виден целиком (крыша здания, а не только край у стены).
       Жетон, стоящий на самом объекте, смотрит наружу: своя фигура ему не мешает.
     - Кисть Мастера идёт поверх: мазки применяются по порядку, поздний перекрывает ранний.
   Всё в клетках стола. Многоугольник видимости — лучи к концам стен и по дуге; индекс стен — сетка ячеек G×G,
   луч идёт только по ячейкам на своём пути, поэтому большие карты с тысячами отрезков не тормозят движение жетона.
   ====================================================================== */
const FogKit = (function(){
  const G = 4;        // сторона ячейки индекса стен, клеток
  const FAR = 700;    // предел взгляда, клеток (больше самой большой карты)
  const EPS = 0.0004; // лучи чуть мимо конца стены — чтобы заглянуть за угол

  /* ---------- что на карте останавливает взгляд ---------- */
  // Двери: вариант-рисунок открытой створки и вариант, где двери нет вовсе (выбита, сорвана — всегда проём)
  const DOOR_ART = {door:{open:2, fixed:3}, double_door:{open:1}, gate_metal:{open:1, fixed:2}, vault_door:{open:1, fixed:2}, settlement_gate:{open:2, fixed:2}};
  const WINDOW_SHUT = {window:2, broken_window:1, display_window:-1}; // вариант «заколочено» взгляд не пропускает
  const SOLID_RECT = new Set(['house_small', 'house_mid', 'apartment_block', 'kiosk', 'overpass_pillar', 'bus_wreck', 'rubble_big', 'megatower', 'megablock', 'fortress_tower', 'monument',
    'mall', 'shop', 'warehouse', 'hangar', 'boiler', 'tank_horiz', 'transformer', 'container_stack', 'dump_truck', 'excavator', 'bunker', 'pillbox', 'barracks', 'tank_wreck', 'apc_wreck',
    'tent', 'big_tent', 'gas_station', 'scrap_shack', 'war_rig', 'junk_mound', 'caravan_cart', 'semi_truck', 'lab_ruin', 'metro_car', 'pump_station', 'shipping_container', 'barricade_car',
    'monolith', 'ship_hull', 'ship_nozzle', 'sarcophagus', 'barge', 'polyhedron', 'antigrav_car', 'aerocar']);
  const SOLID_ROUND = new Set(['tank_big', 'cooling_tower', 'chimney', 'silo', 'water_cistern', 'column', 'rock_big', 'statue_head', 'bio_tank']);
  const SOLID_LINE = new Set(['partition']);
  function solidKind(o){
    if(o.a in DOOR_ART || o.a in WINDOW_SHUT) return '';
    const a = MapAssets.BY_ID[o.a], round = SOLID_ROUND.has(o.a);
    if(o.sb===0 || !a) return '';
    if(o.sb===1) return round ? 'o' : 'r';
    return SOLID_RECT.has(o.a) ? 'r' : round ? 'o' : SOLID_LINE.has(o.a) ? 'l' : a.sight ? 'p' : '';
  }
  const isOpening = (id)=>id in DOOR_ART || id in WINDOW_SHUT;
  const blocksByDefault = (id)=>!!solidKind({a:id});
  // Точка объекта (от его центра, в клетках) → мир: те же поворот, масштаб и отражение, что у drawObject
  function frame(o, ox, oy){
    const s = o.s || 1, sx = o.f ? -s : s, rad = (o.r || 0)*Math.PI/180, c = Math.cos(rad), n = Math.sin(rad), X = o.x + ox, Y = o.y + oy;
    return (lx, ly)=>[X + c*sx*lx - n*s*ly, Y + n*sx*lx + c*s*ly];
  }
  // Отрезок стены минус проёмы дверей и окон, лежащие на нём
  function cutSeg(ax, ay, bx, by, gaps, emit){
    const len = Math.hypot(bx - ax, by - ay); if(len < 1e-6) return;
    const ux = (bx - ax)/len, uy = (by - ay)/len, cuts = [];
    gaps.forEach(q=>{
      if(Math.abs((q.ax - ax)*uy - (q.ay - ay)*ux) > 0.2 || Math.abs((q.bx - ax)*uy - (q.by - ay)*ux) > 0.2) return;
      const t1 = (q.ax - ax)*ux + (q.ay - ay)*uy, t2 = (q.bx - ax)*ux + (q.by - ay)*uy, lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if(hi > 0 && lo < len) cuts.push([Math.max(0, lo), Math.min(len, hi)]);
    });
    if(!cuts.length){ emit(ax, ay, bx, by); return; }
    cuts.sort((p, q)=>p[0] - q[0]);
    let t = 0;
    cuts.forEach(([lo, hi])=>{ if(lo > t + 1e-3) emit(ax + ux*t, ay + uy*t, ax + ux*lo, ay + uy*lo); t = Math.max(t, hi); });
    if(t < len - 1e-3) emit(ax + ux*t, ay + uy*t, bx, by);
  }
  // stateOf(id) — состояние двери на столе ('open' | 'closed' | 'locked') или пусто: тогда как нарисована на карте
  function mapSight(doc, ox, oy, stateOf){
    const s = [], own = [], ends = new Map(), groups = [], doors = [], gaps = [], shut = [];
    const add = (ax, ay, bx, by, g)=>{ s.push(ax, ay, bx, by); own.push(g); ends.set(ax + ',' + ay, [ax, ay]); ends.set(bx + ',' + by, [bx, by]); };
    const ring = (T, n, r)=>{ const out = []; for(let i=0;i<n;i++){ const a = i/n*Math.PI*2, p = T(Math.cos(a)*r, Math.sin(a)*r); out.push(p[0], p[1]); } return out; };
    const box = (T, hw, hh)=>[].concat(T(-hw, -hh), T(hw, -hh), T(hw, hh), T(-hw, hh));
    const addGroup = (poly, reveal)=>{
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for(let i=0;i<poly.length;i+=2){ x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); y0 = Math.min(y0, poly[i + 1]); y1 = Math.max(y1, poly[i + 1]); }
      const g = groups.length; groups.push({poly, reveal, x0, y0, x1, y1});
      for(let i=0;i<poly.length;i+=2){ const j = (i + 2)%poly.length; add(poly[i], poly[i + 1], poly[j], poly[j + 1], g); }
    };
    ((doc && doc.objects) || []).forEach(o=>{
      const a = MapAssets.BY_ID[o.a]; if(!a) return;
      const T = frame(o, ox, oy), art = DOOR_ART[o.a], win = WINDOW_SHUT[o.a], v = o.v || 0;
      if(art || win!==undefined){
        const p = T(-a.w/2, 0), q = T(a.w/2, 0), seg = {ax:p[0], ay:p[1], bx:q[0], by:q[1]};
        gaps.push(seg);
        if(win!==undefined){ if(v===win) shut.push(seg); return; }
        if(v===art.fixed) return;
        const def = v===art.open ? 'open' : 'closed', state = stateOf(o.id) || def;
        if(state!=='open') shut.push(seg);
        doors.push({id:o.id, name:a.name, x:(p[0] + q[0])/2, y:(p[1] + q[1])/2, def, v, openV:art.open, closedV:v===art.open ? 0 : v});
        return;
      }
      const kind = solidKind(o);
      if(kind==='r') addGroup(box(T, a.w/2*0.96, a.h/2*0.96), box(T, a.w/2, a.h/2)); // чуть меньше рисунка: жетон вплотную к объекту не прячется
      else if(kind==='o'){ const r = Math.min(a.w, a.h)/2; addGroup(ring(T, 12, r*0.85), ring(T, 20, r)); }
      else if(kind==='l'){ const p = T(-a.w/2, 0), q = T(a.w/2, 0); add(p[0], p[1], q[0], q[1], -1); }
      else if(kind==='p') a.sight(v).forEach(line=>{ for(let i=2;i<line.length;i+=2){ const p = T(line[i - 2] - a.w/2, line[i - 1] - a.h/2), q = T(line[i] - a.w/2, line[i + 1] - a.h/2); add(p[0], p[1], q[0], q[1], -1); } });
    });
    ((doc && doc.walls) || []).forEach(w=>{
      const kind = MapFormat.WALL_KINDS[w.kind];
      if(kind && kind.see) return;
      const pts = w.points || [];
      for(let i=1;i<pts.length;i++) cutSeg(pts[i - 1][0] + ox, pts[i - 1][1] + oy, pts[i][0] + ox, pts[i][1] + oy, gaps, (ax, ay, bx, by)=>add(ax, ay, bx, by, -1));
    });
    shut.forEach(q=>add(q.ax, q.ay, q.bx, q.by, -1));
    return {ix:makeIndex(s, [...ends.values()], own, groups), doors};
  }

  function emptyIndex(){ return {n:0, s:[], ends:[], groups:[], ver:0}; }
  function makeIndex(s, ends, own, groups){
    const n = s.length/4;
    if(!n) return emptyIndex();
    groups = groups || [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(let i=0;i<s.length;i+=2){ if(s[i] < x0) x0 = s[i]; if(s[i] > x1) x1 = s[i]; if(s[i + 1] < y0) y0 = s[i + 1]; if(s[i + 1] > y1) y1 = s[i + 1]; }
    const gx0 = Math.floor((x0 - 0.01)/G), gy0 = Math.floor((y0 - 0.01)/G), gx1 = Math.floor((x1 + 0.01)/G), gy1 = Math.floor((y1 + 0.01)/G);
    const gw = gx1 - gx0 + 1, cells = new Array(gw*(gy1 - gy0 + 1));
    for(let k=0;k<n;k++){
      const ax = s[k*4], ay = s[k*4 + 1], bx = s[k*4 + 2], by = s[k*4 + 3], ex = bx - ax, ey = by - ay;
      const cx0 = Math.floor((Math.min(ax, bx) - 0.01)/G), cx1 = Math.floor((Math.max(ax, bx) + 0.01)/G);
      const cy0 = Math.floor((Math.min(ay, by) - 0.01)/G), cy1 = Math.floor((Math.max(ay, by) + 0.01)/G);
      for(let cy=cy0;cy<=cy1;cy++) for(let cx=cx0;cx<=cx1;cx++){
        // отрезок лежит по одну сторону от всех углов ячейки — в ячейку не попадает
        const l = cx*G - 0.01, r = (cx + 1)*G + 0.01, t = cy*G - 0.01, b = (cy + 1)*G + 0.01;
        const side = (px, py)=>ex*(py - ay) - ey*(px - ax), c1 = side(l, t), c2 = side(r, t), c3 = side(l, b), c4 = side(r, b);
        if((c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0) || (c1 < 0 && c2 < 0 && c3 < 0 && c4 < 0)) continue;
        const i = (cy - gy0)*gw + cx - gx0;
        (cells[i] || (cells[i] = [])).push(k);
      }
    }
    return {n, s, ends, cells, gx0, gy0, gx1, gy1, gw, stamp:new Int32Array(n), tick:0, own:own ? Int32Array.from(own) : new Int32Array(n).fill(-1), groups, skip:new Int32Array(groups.length), ver:0, lastK:-1};
  }
  // Откуда смотрим: фигуры, внутри которых стоит наблюдатель, ему не мешают (жетон на крыше, у самого края объекта)
  function setOrigin(ix, x, y){
    if(!ix.n) return;
    ix.ver++;
    const gs = ix.groups;
    for(let i=0;i<gs.length;i++){ const g = gs[i]; if(x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1 && inPoly(g.poly, x, y)) ix.skip[i] = ix.ver; }
  }
  // Луч из (x, y) по единичному направлению (dx, dy): расстояние до первой стены, не больше R
  function cast(ix, x, y, dx, dy, R){
    if(!ix.n) return R;
    let best = R, cx = Math.floor(x/G), cy = Math.floor(y/G);
    const tick = ++ix.tick, s = ix.s, stamp = ix.stamp, cells = ix.cells, own = ix.own, skip = ix.skip, ver = ix.ver;
    ix.lastK = -1;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, tdx = dx ? G/Math.abs(dx) : Infinity, tdy = dy ? G/Math.abs(dy) : Infinity;
    let tx = dx ? ((cx + (dx > 0 ? 1 : 0))*G - x)/dx : Infinity, ty = dy ? ((cy + (dy > 0 ? 1 : 0))*G - y)/dy : Infinity;
    for(;;){
      const inX = cx >= ix.gx0 && cx <= ix.gx1, inY = cy >= ix.gy0 && cy <= ix.gy1;
      if(inX && inY){
        const list = cells[(cy - ix.gy0)*ix.gw + cx - ix.gx0];
        if(list) for(let i=0;i<list.length;i++){
          const k = list[i];
          if(stamp[k]===tick) continue;
          stamp[k] = tick;
          if(own[k] >= 0 && skip[own[k]]===ver) continue;
          const ax = s[k*4], ay = s[k*4 + 1], ex = s[k*4 + 2] - ax, ey = s[k*4 + 3] - ay, den = dx*ey - dy*ex;
          if(Math.abs(den) < 1e-9) continue;
          const t = ((ax - x)*ey - (ay - y)*ex)/den, u = ((ax - x)*dy - (ay - y)*dx)/den;
          if(t > 1e-6 && t < best && u >= -1e-9 && u <= 1 + 1e-9){ best = t; ix.lastK = k; }
        }
      } else if((!inX && (!dx || (cx < ix.gx0 ? sx < 0 : sx > 0))) || (!inY && (!dy || (cy < ix.gy0 ? sy < 0 : sy > 0)))) return best; // ушёл из области стен
      const exit = Math.min(tx, ty);
      if(exit >= best) return best;
      if(tx < ty){ cx += sx; tx += tdx; } else { cy += sy; ty += tdy; }
    }
  }
  function blocked(ix, ax, ay, bx, by){
    const d = Math.hypot(bx - ax, by - ay);
    if(d < 1e-6 || !ix.n) return false;
    setOrigin(ix, ax, ay);
    return cast(ix, ax, ay, (bx - ax)/d, (by - ay)/d, d) < d - 1e-4;
  }
  // Многоугольник видимости [x0, y0, x1, y1, …]. Без a0 — полный круг радиуса R; с a0, a1 (радианы, a1 > a0) — конус, первая вершина в центре.
  // В свойстве hits — номера крупных объектов, на которые упали лучи
  function fan(ix, x, y, R, a0, a1){
    setOrigin(ix, x, y);
    const cone = a0!==undefined, from = cone ? a0 : -Math.PI, to = cone ? a1 : Math.PI, angs = [];
    const step = R >= FAR ? Math.PI/12 : Math.max(Math.PI/120, Math.min(Math.PI/15, Math.sqrt(0.24/R))); // дуга гладкая и у маленького, и у большого радиуса
    for(let a=from;a<to;a+=step) angs.push(a);
    angs.push(to);
    const R2 = (R + 1)*(R + 1), turn = Math.PI*2;
    ix.ends.forEach(p=>{
      const ex = p[0] - x, ey = p[1] - y;
      if(ex*ex + ey*ey > R2) return;
      let a = Math.atan2(ey, ex);
      if(cone){ while(a < from) a += turn; while(a > from + turn) a -= turn; if(a > to) return; }
      angs.push(a - EPS, a, a + EPS);
    });
    angs.sort((p, q)=>p - q);
    const out = cone ? [x, y] : [], hits = new Set();
    let last = -Infinity;
    angs.forEach(a=>{
      if(a - last < 1e-7 || a < from || a > to) return;
      last = a;
      const c = Math.cos(a), sn = Math.sin(a), t = cast(ix, x, y, c, sn, R);
      out.push(x + c*t, y + sn*t);
      if(t < R && ix.lastK >= 0 && ix.own[ix.lastK] >= 0) hits.add(ix.own[ix.lastK]);
    });
    out.hits = [...hits];
    return out;
  }

  /* ---------- проверка точки: нужна, чтобы не показывать игрокам жетоны в темноте ---------- */
  function inPoly(p, x, y){
    let inside = false;
    for(let i=0, j=p.length - 2;i<p.length;j=i, i+=2){
      const yi = p[i + 1], yj = p[j + 1];
      if((yi > y)!==(yj > y) && x < (p[j] - p[i])*(y - yi)/(yj - yi) + p[i]) inside = !inside;
    }
    return inside;
  }
  function strokeHit(st, x, y){
    if(st.f) return inPoly(st.p, x, y);
    const p = st.p, r2 = st.r*st.r;
    if(p.length===2) return (x - p[0])*(x - p[0]) + (y - p[1])*(y - p[1]) <= r2;
    for(let i=2;i<p.length;i+=2){
      const ax = p[i - 2], ay = p[i - 1], ex = p[i] - ax, ey = p[i + 1] - ay, l2 = ex*ex + ey*ey;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax)*ex + (y - ay)*ey)/l2)) : 0, qx = ax + t*ex - x, qy = ay + t*ey - y;
      if(qx*qx + qy*qy <= r2) return true;
    }
    return false;
  }
  function lightHit(ix, L, x, y){
    const dx = x - L.x, dy = y - L.y;
    if(dx*dx + dy*dy > L.R*L.R) return false;
    if(L.a0!==undefined && (dx || dy)){
      let a = Math.atan2(dy, dx);
      while(a < L.a0) a += Math.PI*2;
      while(a > L.a0 + Math.PI*2) a -= Math.PI*2;
      if(a > L.a1) return false;
    }
    return !blocked(ix, L.x, L.y, x, y);
  }
  // M — модель кадра: {ix, day, pending, clip, reveal:[poly], eyes:[{x,y,poly}], lights:[{x,y,R,a0,a1,poly}], strokes}; reveal — объекты, видные целиком; clip — прямоугольник карты: за её краем не видно ничего
  function visibleAt(M, x, y){
    if(M.clip && (x < M.clip.x || y < M.clip.y || x > M.clip.x + M.clip.w || y > M.clip.y + M.clip.h)) return false;
    for(let i=M.strokes.length - 1;i>=0;i--) if(strokeHit(M.strokes[i], x, y)) return M.strokes[i].v===1;
    if(M.pending) return false;
    if(!M.eyes.some(e=>!blocked(M.ix, e.x, e.y, x, y))) return false;
    return M.day || M.lights.some(L=>lightHit(M.ix, L, x, y));
  }

  /* ---------- растр: S — набор вспомогательных холстов, T — {k, ox, oy}: экран = мир·k + o ---------- */
  function layer(S, name, W, H){
    let l = S[name];
    if(!l){ const cv = document.createElement('canvas'); l = S[name] = {cv, ctx:cv.getContext('2d')}; }
    if(l.cv.width!==W || l.cv.height!==H){ l.cv.width = W; l.cv.height = H; }
    l.ctx.setTransform(1, 0, 0, 1, 0, 0);
    l.ctx.globalCompositeOperation = 'source-over';
    l.ctx.clearRect(0, 0, W, H);
    return l;
  }
  function fillPoly(ctx, p){
    if(p.length < 6) return;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for(let i=2;i<p.length;i+=2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath(); ctx.fill();
  }
  function paintStroke(ctx, st){
    const p = st.p;
    if(st.f){ fillPoly(ctx, p); return; }
    if(p.length===2){ ctx.beginPath(); ctx.arc(p[0], p[1], st.r, 0, Math.PI*2); ctx.fill(); return; }
    ctx.lineWidth = st.r*2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for(let i=2;i<p.length;i+=2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
  // Результат — холст S.a: непрозрачно там, где видно сейчас; S.c — закрытое кистью (если мазки есть)
  function paintVisible(S, W, H, T, M){
    const a = layer(S, 'a', W, H);
    if(!M.pending){
      const b = layer(S, 'b', W, H);
      b.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy); b.ctx.fillStyle = '#fff';
      M.eyes.forEach(e=>fillPoly(b.ctx, e.poly));
      a.ctx.fillStyle = '#fff';
      if(M.day) a.ctx.fillRect(0, 0, W, H);
      else { a.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy); M.lights.forEach(L=>fillPoly(a.ctx, L.poly)); a.ctx.setTransform(1, 0, 0, 1, 0, 0); }
      a.ctx.globalCompositeOperation = 'destination-in'; a.ctx.drawImage(b.cv, 0, 0); a.ctx.globalCompositeOperation = 'source-over';
      if(M.reveal && M.reveal.length){ a.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy); M.reveal.forEach(p=>fillPoly(a.ctx, p)); a.ctx.setTransform(1, 0, 0, 1, 0, 0); }
    }
    if(M.strokes.length){
      const o = layer(S, 'o', W, H), c = layer(S, 'c', W, H);
      [o, c].forEach(l=>{ l.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy); l.ctx.fillStyle = l.ctx.strokeStyle = '#fff'; });
      M.strokes.forEach(st=>{
        const put = st.v ? o : c, cut = st.v ? c : o;
        paintStroke(put.ctx, st);
        cut.ctx.globalCompositeOperation = 'destination-out'; paintStroke(cut.ctx, st); cut.ctx.globalCompositeOperation = 'source-over';
      });
      a.ctx.drawImage(o.cv, 0, 0);
      a.ctx.globalCompositeOperation = 'destination-out'; a.ctx.drawImage(c.cv, 0, 0); a.ctx.globalCompositeOperation = 'source-over';
    }
    if(M.clip){
      a.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy);
      a.ctx.globalCompositeOperation = 'destination-in'; a.ctx.fillStyle = '#fff'; a.ctx.fillRect(M.clip.x, M.clip.y, M.clip.w, M.clip.h);
      a.ctx.setTransform(1, 0, 0, 1, 0, 0); a.ctx.globalCompositeOperation = 'source-over';
    }
    return a;
  }
  // Итоговая пелена на холсте out: o.veil — цвет, o.mem — {cv, x, y, w, h} (разведанное), o.memCut — насколько оно просвечивает, o.blur — мягкость края
  function compose(out, S, W, H, T, M, o){
    const a = paintVisible(S, W, H, T, M);
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.clearRect(0, 0, W, H);
    out.fillStyle = o.veil; out.fillRect(0, 0, W, H);
    out.globalCompositeOperation = 'destination-out';
    if(o.mem){
      const t = layer(S, 't', W, H);
      t.ctx.setTransform(T.k, 0, 0, T.k, T.ox, T.oy);
      t.ctx.drawImage(o.mem.cv, o.mem.x, o.mem.y, o.mem.w, o.mem.h);
      if(M.strokes.length){ t.ctx.setTransform(1, 0, 0, 1, 0, 0); t.ctx.globalCompositeOperation = 'destination-out'; t.ctx.drawImage(S.c.cv, 0, 0); }
      out.globalAlpha = o.memCut; out.drawImage(t.cv, 0, 0); out.globalAlpha = 1;
    }
    if(o.blur && 'filter' in out) out.filter = `blur(${o.blur}px)`; // в старом Safari фильтра нет — край мягкий и так: холст в половину разрешения
    out.drawImage(a.cv, 0, 0);
    if(o.blur && 'filter' in out) out.filter = 'none';
    out.globalCompositeOperation = 'source-over';
  }
  return { FAR, emptyIndex, mapSight, makeIndex, cast, blocked, fan, visibleAt, paintVisible, compose, isOpening, blocksByDefault };
})();
