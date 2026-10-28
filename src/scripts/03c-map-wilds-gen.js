/* ======================================================================
   ДОПОЛНЕНИЕ К ГЕНЕРАТОРУ КАРТ: Препятствие Равнины, промзона, пещеры/шахта/карьер, трасса.
   Препятствие Равнины — по таблицам книги (к6 — таблица, к12 — строка; в шестой — к6): у каждой строки свой
   сборщик местности (разлом, озеро, поле монолитов, крушение, комплекс…) с параметрами, Мастеру — заметка с
   броском и кратким правилом (doc.gen.note: на сервер и игрокам не уходит). Здания — общим генератором
   (MapGen.kit.building) с новыми типами: цех, пультовая, мотель, закусочная. Объекты — 03b-map-wilds-assets.js.
   ====================================================================== */
const MapWilds = (function(){
  const GK = MapGen.kit, BY = MapAssets.BY_ID, newId = MapFormat.newId;
  /* ---------- новые типы зданий и комнат ---------- */
  Object.assign(GK.ROLES, {
    factory_floor:{sz:2, fl:['concrete', 'metal'], it:[{a:['lathe', 'press', 'workbench'], m:'rows'}, {a:['conveyor'], m:'wall', p:0.6}, {a:['barrels_group', 'crate_metal', 'pallet'], m:'corner', n:[1, 3]}, {a:['electric_panel'], m:'wall', n:[1, 2]}, {a:['generator'], m:'corner', p:0.4}, {a:['slag_pool'], m:'floor', p:0.3}]},
    control_room:{sz:1, fl:['tiles', 'metal'], it:[{a:['terminal', 'server_rack'], m:'rows'}, {a:['office_desk'], m:'wall', n:[1, 2]}, {a:['electric_panel'], m:'wall', n:[1, 2]}, {a:['radio'], m:'wall', p:0.5}, {a:['chair'], m:'center', n:[1, 2]}]},
    motel_room:{sz:0, fl:['carpet', 'wood'], it:[{a:['bed'], m:'wall'}, {a:['tv'], m:'wall', p:0.7}, {a:['table_small'], m:'wall', p:0.6}, {a:['wardrobe'], m:'wall', p:0.4}, {a:['toilet'], m:'corner', p:0.5}]},
  });
  Object.assign(GK.ROLE_NAME, {factory_floor:'Цех', control_room:'Пультовая', motel_room:'Номер'});
  GK.addArch({id:'factory_hall', name:'Цех', w:[10, 14], h:[8, 12], shapes:['rect', 'L', 'rect'], ext:['metal', 'concrete', 'brick'], prog:['factory_floor', 'workshop', 'office', 'storage', 'lockerroom'], room:[10, 22], main:0.68, door:'gate_metal', yard:['pallet', 'barrels_group', 'scrap_pile', 'crate_metal', 'conveyor']});
  GK.addArch({id:'control', name:'Пультовая', w:[6, 9], h:[6, 8], shapes:['rect', 'L'], ext:['concrete', 'brick'], prog:['control_room', 'server', 'office', 'bath'], room:[8, 16], main:0.6, yard:['transformer', 'electric_panel', 'power_pylon']});
  GK.addArch({id:'motel', name:'Мотель', w:[10, 14], h:[5, 7], shapes:['rect', 'L'], ext:['brick', 'wood'], prog:['reception', 'motel_room', 'motel_room', 'motel_room', 'motel_room', 'bath', 'motel_room', 'storage'], room:[6, 10], entry:['reception'], door:'double_door', yard:['car_wreck', 'road_sign', 'vending', 'dumpster', 'pickup_rust']});
  GK.addArch({id:'diner', name:'Закусочная', w:[6, 9], h:[5, 7], shapes:['rect', 'L'], ext:['brick', 'metal'], prog:['dining', 'kitchen', 'bath', 'storage'], room:[8, 18], main:0.62, shop:true, door:'double_door', yard:['restaurant_table', 'dumpster', 'trash', 'car_wreck', 'road_sign']});
  GK.THEMES.factory = ['factory_hall', 'control', 'warehouse', 'boiler', 'substation', 'garage', 'boxgarage', 'guardhouse', 'lab'];
  GK.THEMES.road = ['motel', 'diner', 'garage', 'boxgarage', 'guardhouse', 'bar', 'cafe'];

  /* ---------- общие помощники ---------- */
  function ctx(doc, seed){ const g = GK.ctxFor(doc, seed); g.R = (a, b)=>a + g.rnd()*(b - a); g.nz = g.noise(1.7, g.ri(1, 99999)); return g; } // nz — мелкие пятна грунта без «шахматки» по клеткам
  // объект в произвольной точке с поворотом; занятость — по описанному прямоугольнику
  function mkPut(g, st){ const doc = g.doc, cols = doc.cols, rows = doc.rows;
    return function put(a, cx, cy, rdeg, force, v){ const as = BY[a]; if(!as) return null; rdeg = rdeg || 0; const t = rdeg*Math.PI/180, bw = Math.abs(Math.cos(t))*as.w + Math.abs(Math.sin(t))*as.h, bh = Math.abs(Math.sin(t))*as.w + Math.abs(Math.cos(t))*as.h;
      const x0 = Math.floor(cx - bw/2), y0 = Math.floor(cy - bh/2), cw = Math.ceil(cx + bw/2) - x0, ch = Math.ceil(cy + bh/2) - y0;
      if(x0 < 0 || y0 < 0 || x0 + cw > cols || y0 + ch > rows) return null; if(!force && !as.g && !g.free(x0, y0, cw, ch)) return null; if(!as.g) g.mark(x0, y0, cw, ch);
      const o = {id:newId('o'), a, x:Math.round(cx*100)/100, y:Math.round(cy*100)/100, r:Math.round(((rdeg%360) + 360)%360), s:1, v:v==null ? g.variant(a, st.state, st.prefer) : v, f:g.rnd() < 0.3}; doc.objects.push(o); return o; }; }
  // номер варианта объекта по названию (или null)
  const vIdx = (a, re)=>{ const as = BY[a]; if(!as || !as.vn) return null; const i = as.vn.findIndex(n=>re.test(n)); return i < 0 ? null : i; };
  const each = (g, fn)=>{ const {cols, rows} = g.doc; for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) fn(x, y, x + 0.5, y + 0.5); };
  // неровное пятно: значение < 1 — внутри
  function blob(g, cx, cy, rx, ry, irr){ const ph = [g.rnd()*6.3, g.rnd()*6.3, g.rnd()*6.3], f = (a)=>1 + irr*(0.5*Math.sin(3*a + ph[0]) + 0.3*Math.sin(5*a + ph[1]) + 0.2*Math.sin(8*a + ph[2]));
    return (x, y)=>{ const dx = (x - cx)/rx, dy = (y - cy)/ry; return Math.hypot(dx, dy)/f(Math.atan2(dy, dx)); }; }
  const chaikin = (p, it)=>{ for(let k=0;k<it;k++){ const q = [p[0]]; for(let i=0;i<p.length - 1;i++){ const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax*0.75 + bx*0.25, ay*0.75 + by*0.25], [ax*0.25 + bx*0.75, ay*0.25 + by*0.75]); } q.push(p[p.length - 1]); p = q; } return p; };
  const segDist = (px, py, ax, ay, bx, by)=>{ const dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy || 1; let t = ((px - ax)*dx + (py - ay)*dy)/L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - dx*t, py - ay - dy*t); };
  const lineDist = (pts, x, y)=>{ let m = Infinity; for(let i=0;i<pts.length - 1;i++){ const d = segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); if(d < m) m = d; } return m; };
  const r2 = (pts)=>pts.map(p=>[Math.round(p[0]*100)/100, Math.round(p[1]*100)/100]);
  // плавная линия от края до края (через середину карты)
  function crossLine(g, horiz, wob, off){ const {cols, rows} = g.doc, a = horiz ? [-2, rows*(0.3 + g.rnd()*0.4)] : [cols*(0.3 + g.rnd()*0.4), -2], b = horiz ? [cols + 2, rows*(0.3 + g.rnd()*0.4)] : [cols*(0.3 + g.rnd()*0.4), rows + 2];
    if(off){ a[horiz ? 1 : 0] += off; b[horiz ? 1 : 0] += off; }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(3, Math.round(L/8)), nx = -(b[1] - a[1])/L, ny = (b[0] - a[0])/L, pts = [a]; let o = 0;
    for(let i=1;i<n;i++){ const t = i/n; o = o*0.5 + (g.rnd() - 0.5)*2*(wob || 3); pts.push([a[0] + (b[0] - a[0])*t + nx*o, a[1] + (b[1] - a[1])*t + ny*o]); } pts.push(b); return chaikin(pts, 3); }
  function pointAt(pts, t){ let tot = 0; const ls = []; for(let i=0;i<pts.length - 1;i++){ const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); tot += l; }
    let s = t*tot; for(let i=0;i<ls.length;i++){ if(s <= ls[i] || i===ls.length - 1){ const [ax, ay] = pts[i], [bx, by] = pts[i + 1], u = ls[i] ? Math.min(1, s/ls[i]) : 0; return {x:ax + (bx - ax)*u, y:ay + (by - ay)*u, a:Math.atan2(by - ay, bx - ax), len:tot}; } s -= ls[i]; } return {x:pts[0][0], y:pts[0][1], a:0, len:0}; }
  // разброс по взвешенному списку [[объект, вес, не больше]]; ok(x, y) — где можно
  function scatter(g, put, list, n, ok, rotAny){ const used = {}; let placed = 0; const {cols, rows} = g.doc;
    for(let i=0;i<n*10 && placed<n;i++){ const pool = list.filter(e=>BY[e[0]] && (used[e[0]] || 0) < (e[2] || 99)); if(!pool.length) break; let tot = 0; pool.forEach(e=>{ tot += e[1]; }); let q = g.rnd()*tot, e = pool[0]; for(const c of pool){ q -= c[1]; if(q <= 0){ e = c; break; } }
      const x = 1 + g.rnd()*(cols - 2), y = 1 + g.rnd()*(rows - 2); if(ok && !ok(x, y)) continue;
      if(put(e[0], x, y, rotAny || g.rnd() < 0.4 ? g.rnd()*360 : g.pick([0, 90, 180, 270]))){ used[e[0]] = (used[e[0]] || 0) + 1; placed++; } } return placed; }
  // земля: основа + пятна по шуму. mix: [[тип, от, до, шум 0/1]]
  function land(g, base, mix){ GK.reset(g.doc, base); const n1 = g.noise(7, g.ri(1, 9999)), n2 = g.noise(2.6, g.ri(1, 9999));
    each(g, (x, y)=>{ const v = n1(x, y), w = n2(x, y); for(const [id, lo, hi, which] of (mix || [])){ const q = which ? w : v; if(q >= lo && q < hi){ g.setT(x, y, id); break; } } }); }
  // забор-прямоугольник с воротами (gate: сторона 0..3), возвращает центр ворот
  function fenceRect(g, x0, y0, x1, y1, kind, gate, gw){ gw = gw || 3; const gx = Math.round((x0 + x1)/2), gy = Math.round((y0 + y1)/2);
    const sides = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
    sides.forEach((s, i)=>{ if(i!==gate){ g.wall(kind, s); return; } const h = i%2===0, c = h ? gx : gy;
      if(h){ g.wall(kind, [[s[0][0], s[0][1]], [c - gw/2*(i===0 ? 1 : -1), s[0][1]]]); g.wall(kind, [[c + gw/2*(i===0 ? 1 : -1), s[1][1]], [s[1][0], s[1][1]]]); }
      else { g.wall(kind, [[s[0][0], s[0][1]], [s[0][0], c - gw/2*(i===1 ? 1 : -1)]]); g.wall(kind, [[s[1][0], c + gw/2*(i===1 ? 1 : -1)], [s[1][0], s[1][1]]]); } });
    return gate===0 ? [gx, y0] : gate===1 ? [x1, gy] : gate===2 ? [gx, y1] : [x0, gy]; }
  // вредность среды: пятна грунта и знаки/следы в области test
  function hazard(g, put, kind, test){ if(!kind) return; const n = g.noise(3.2, g.ri(1, 9999)), {cols, rows} = g.doc;
    const tid = {rad:'rad', chem:'toxic', psi:'mutant', acid:'acid', disease:'mud'}[kind]; if(!tid) return;
    each(g, (x, y, px, py)=>{ if(test && !test(px, py)) return; if(g.occ[y*cols + x]) return; if(n(x, y) > (kind==='psi' ? 0.72 : 0.68)) g.setT(x, y, tid); });
    const props = {rad:[['rad_sign', 3, 4], ['barrel_toxic', 1, 2], ['bone_field', 0.4, 1]], chem:[['barrel_toxic', 2, 4], ['toxic_puddle', 2, 3], ['rad_sign', 1, 2]], psi:[['crystal_growth', 1, 2], ['glow_mushrooms', 1, 3], ['anom_electro', 0.6, 1], ['artifact', 0.3, 1]],
      acid:[['toxic_puddle', 2, 3], ['barrel_toxic', 1, 2]], disease:[['bone_pile', 1, 2], ['toxic_puddle', 1, 2], ['corpse', 1, 2], ['blood', 1, 2]]}[kind];
    scatter(g, put, props, Math.max(2, Math.round(cols*rows/320)), test); }
  // природная мелочь пустоши
  const WILD = [['boulder', 3, 6], ['rocks_scatter', 3, 5], ['dry_bush', 4, 8], ['dead_tree', 1.5, 3], ['rock_big', 1.5, 3], ['cactus', 1, 3], ['beast_bones', 0.4, 1], ['tire_stack', 0.5, 2], ['trash', 1, 3], ['crater', 0.5, 2], ['scrap_pile', 0.6, 2]];
  const SALT = [['rocks_scatter', 2, 4], ['boulder', 1, 3], ['beast_bones', 0.6, 1], ['dry_bush', 1, 3], ['crater', 1, 3], ['trash', 0.8, 2]];

  /* ---------- сборщики местности (препятствия) ----------
     Каждый: (g, put, p) — p из строки таблицы; рисует землю, главный объект, россыпь; возвращает точку заголовка. */
  const B = {};
  // разлом / каньон / провал: тёмная толща, скальный край стенами, переправа
  B.chasm = function(g, put, p){ const {cols, rows} = g.doc, M = Math.min(cols, rows), horiz = cols >= rows ? g.rnd() < 0.8 : g.rnd() < 0.2;
    land(g, p.canyon ? 'rock' : 'dust', [['gravel', 0.62, 1], ['dirt', 0, 0.22], ['sand', 0.85, 1, 1]]);
    const w0 = Math.max(2.5, Math.min(9, M*(p.wide || p.canyon ? 0.22 : 0.13))), pts = crossLine(g, horiz, p.canyon ? 2 : 3.5), nw = g.noise(4, g.ri(1, 999)), half = (x, y)=>w0*(0.7 + nw(x, y)*0.6)/2;
    const mid = pointAt(pts, 0.35 + g.rnd()*0.3), bridgeA = mid.a + Math.PI/2, inBridge = (x, y)=>!p.nobridge && Math.abs((x - mid.x)*Math.cos(mid.a) + (y - mid.y)*Math.sin(mid.a)) < (p.plank ? 1.4 : 1.1);
    const mask = new Uint8Array(cols*rows);
    each(g, (x, y, px, py)=>{ const d = lineDist(pts, px, py), w = half(px, py); if(d < w){ if(inBridge(px, py) && !p.plank){ g.setT(x, y, 'rock'); return; } g.setT(x, y, 'bedrock'); mask[y*cols + x] = 1; g.occ[y*cols + x] = 1; } else if(d < w + 1.4) g.setT(x, y, g.nz(x, y) < 0.55 ? 'rock' : 'gravel'); });
    if(p.plank) for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(mask[y*cols + x] && inBridge(x + 0.5, y + 0.5)) mask[y*cols + x] = 0;
    GK.wallsFromMask(g, mask, 'rock');
    for(let i=0;i<Math.round(pointAt(pts, 0).len/6);i++){ const q = pointAt(pts, g.rnd()); if(Math.hypot(q.x - mid.x, q.y - mid.y) < 3) continue; put('rift', q.x, q.y, q.a*180/Math.PI + 90, true, vIdx('rift', p.glow ? /сияние|Светится/ : p.water ? /водой/ : /^Тре|Широк/)); }
    if(p.plank && !p.nobridge){ const br = put('bridge', mid.x, mid.y, mid.a*180/Math.PI, true, vIdx('bridge', p.broken ? /Разбит|обруш/ : /Целый/)); if(br) br.s = Math.round(Math.max(1, (half(mid.x, mid.y)*2 + 3)/8)*100)/100; }
    const rimPt = (side, t)=>{ const q = pointAt(pts, t), w = half(q.x, q.y) + 2.2; return [q.x + Math.cos(q.a + Math.PI/2)*w*side, q.y + Math.sin(q.a + Math.PI/2)*w*side, q.a]; };
    if(p.rings){ for(let i=0;i<g.ri(4, 7);i++){ const [x, y, a] = rimPt(g.rnd() < 0.5 ? 1 : -1, g.rnd()); put(g.pick(['shipping_container', 'tank_horiz', 'scrap_pile', 'pipe_straight', 'crane_beam']), x + g.R(-1, 1), y + g.R(-1, 1), a*180/Math.PI + g.R(-40, 40)); put('crater', x + g.R(-3, 3), y + g.R(-3, 3), 0); } }
    if(p.cables){ for(let i=0;i<g.ri(2, 3);i++){ const q = pointAt(pts, 0.15 + i*0.35 + g.rnd()*0.1), w = half(q.x, q.y) + 4; const a = q.a + Math.PI/2 + g.R(-0.4, 0.4); g.path('cable', 0.6, r2([[q.x - Math.cos(a)*w, q.y - Math.sin(a)*w], [q.x + Math.cos(a)*w, q.y + Math.sin(a)*w]])); put('scrap_pile', q.x - Math.cos(a)*w, q.y - Math.sin(a)*w, 0); } }
    if(p.ruin){ const [x, y, a] = rimPt(1, 0.5 + g.R(-0.2, 0.2)); put('apartment_block', x, y, a*180/Math.PI, true, vIdx('apartment_block', /обруш|руин|развал|Разруш/)); put('rubble_big', x + g.R(-3, 3), y + g.R(-3, 3), g.rnd()*360, true); put('rubble_pile', mid.x + g.R(-2, 2), mid.y + g.R(-2, 2), 0, true); }
    scatter(g, put, p.canyon ? [['rock_big', 3, 8], ['boulder', 3, 8], ['rocks_scatter', 2, 5], ['dry_bush', 1, 3]] : WILD, Math.round(cols*rows/120));
    return {x:mid.x, y:Math.max(1, Math.min(rows - 1, mid.y - half(mid.x, mid.y) - 2))}; };
  // кратер: дно, склон, вал, выброс; в центре — по строке
  B.crater = function(g, put, p){ const {cols, rows} = g.doc, M = Math.min(cols, rows), cx = cols/2 + g.R(-2, 2), cy = rows/2 + g.R(-2, 2), R = M*(p.big ? 0.42 : 0.34);
    land(g, p.salt ? 'saltflat' : 'dust', [['gravel', 0.64, 1], ['dirt', 0, 0.2]]); const f = blob(g, cx, cy, R, R*g.R(0.8, 1), 0.12);
    each(g, (x, y, px, py)=>{ const d = f(px, py); if(d < 0.55) g.setT(x, y, p.glass ? 'glass' : p.floor || 'ash'); else if(d < 0.92) g.setT(x, y, p.glass ? (d < 0.75 ? 'glass' : 'rock') : 'gravel'); else if(d < 1.08) g.setT(x, y, 'rock'); else if(d < 1.4 && g.nz(x, y) < 0.35) g.setT(x, y, 'gravel'); });
    // вал — стена по контуру с проходами
    const rim = [], n = 36, gaps = [g.ri(0, n - 1), g.ri(0, n - 1)]; for(let i=0;i<=n;i++){ const a = i/n*6.283; let r = R; for(let k=0;k<20;k++){ if(f(cx + Math.cos(a)*r, cy + Math.sin(a)*r) >= 1) break; r += 0.15; } rim.push([cx + Math.cos(a)*r, cy + Math.sin(a)*r, i]); }
    let run = []; rim.forEach(q=>{ if(gaps.some(gp=>Math.abs(gp - q[2]) <= 1)){ if(run.length > 1) g.wall('rock', r2(run)); run = []; } else run.push([q[0], q[1]]); }); if(run.length > 1) g.wall('rock', r2(run));
    for(let i=0;i<Math.round(R*2);i++){ const a = g.rnd()*6.28, r = R*g.R(1.0, 1.35); put(g.pick(['boulder', 'rock_big', 'rocks_scatter']), cx + Math.cos(a)*r, cy + Math.sin(a)*r, g.rnd()*360); }
    if(p.center==='psi'){ put('crystal_growth', cx, cy, 0, true); put('artifact', cx + 1.5, cy + 0.5, 0); put('anom_electro', cx - 2, cy + 1.5, 0); for(let i=0;i<3;i++) put('glow_mushrooms', cx + g.R(-3, 3), cy + g.R(-3, 3), 0); hazard(g, put, 'psi', (x, y)=>f(x, y) < 0.5); }
    else if(p.center==='wreck') put(g.pick(['plane_wreck', 'apc_wreck', 'tank_wreck']), cx, cy, g.rnd()*360, true);
    else if(p.center==='beast') put('beast_bones', cx, cy, g.rnd()*360, true);
    else if(p.center==='water'){ each(g, (x, y, px, py)=>{ if(f(px, py) < 0.3) g.setT(x, y, p.liq || 'water'); }); }
    if(p.glass) for(let i=0;i<6;i++) put(g.pick(['rocks_scatter', 'boulder']), cx + g.R(-R*0.7, R*0.7), cy + g.R(-R*0.7, R*0.7), g.rnd()*360);
    if(p.finds) for(let i=0;i<g.ri(2, 4);i++) put(g.pick(['crate_metal', 'safe', 'corpse', 'medkit', 'ammo_crate']), cx + g.R(-R*0.4, R*0.4), cy + g.R(-R*0.4, R*0.4), g.rnd()*360);
    g.path('trail', 1, r2([[cx + Math.cos(gaps[0]/n*6.283)*R*1.6, cy + Math.sin(gaps[0]/n*6.283)*R*1.6], [cx + Math.cos(gaps[0]/n*6.283)*R*0.6, cy + Math.sin(gaps[0]/n*6.283)*R*0.6], [cx + g.R(-1, 1), cy + g.R(-1, 1)]]));
    scatter(g, put, p.salt ? SALT : WILD, Math.round(cols*rows/160), (x, y)=>f(x, y) > 1.15);
    return {x:cx, y:Math.max(1, cy - R*1.15)}; };
  // много воронок (солончак, свалка у кратера)
  B.craters = function(g, put, p){ const {cols, rows} = g.doc; land(g, p.salt ? 'saltflat' : 'dust', p.salt ? [['sand', 0.7, 1], ['gravel', 0, 0.15]] : [['gravel', 0.62, 1], ['dirt', 0, 0.2]]);
    const n = Math.round(cols*rows/(p.cars ? 260 : 140)); for(let i=0;i<n;i++){ const x = g.R(2, cols - 2), y = g.R(2, rows - 2), r = g.R(1.2, 2.6); each(g, (cx2, cy2, px, py)=>{ const d = Math.hypot(px - x, py - y); if(d < r*0.6) g.setT(cx2, cy2, 'ash'); else if(d < r) g.setT(cx2, cy2, 'gravel'); }); put('crater', x, y, g.rnd()*360, true); }
    if(p.cars){ const cx = cols*g.R(0.3, 0.7), cy = rows*g.R(0.3, 0.7), R = Math.min(cols, rows)*0.22; each(g, (x, y, px, py)=>{ const d = Math.hypot(px - cx, py - cy); if(d < R*0.6) g.setT(x, y, 'ash'); else if(d < R) g.setT(x, y, 'gravel'); }); put('crater', cx, cy, 0, true);
      for(let i=0;i<Math.round(cols*rows/40);i++){ const a = g.rnd()*6.28, r = R*g.R(1.1, 2.2); put(g.pick(['car_wreck', 'car_wreck', 'car_burnt', 'pickup_rust', 'bus_wreck', 'semi_truck', 'buggy']), cx + Math.cos(a)*r, cy + Math.sin(a)*r, g.rnd()*360); } scatter(g, put, [['scrap_pile', 2, 6], ['tire_stack', 2, 6], ['junk_mound', 1, 2]], 8); }
    scatter(g, put, p.salt ? SALT : WILD, Math.round(cols*rows/150));
    return {x:cols/2, y:1.5}; };
  // озеро: кислотное, ржавое, болотное; островки-блоки, затонувшее
  B.lake = function(g, put, p){ const {cols, rows} = g.doc, M = Math.min(cols, rows), cx = cols/2 + g.R(-3, 3), cy = rows/2 + g.R(-2, 2), f = blob(g, cx, cy, Math.min(cols*0.36, M*0.5), M*0.34, 0.28);
    land(g, p.shore || 'dust', [['gravel', 0.65, 1], ['dirt', 0, 0.2]]); const liq = p.liq || 'acid';
    each(g, (x, y, px, py)=>{ const d = f(px, py); if(d < 1){ g.setT(x, y, liq); g.occ[y*cols + x] = 1; } else if(d < 1.18 + g.nz(x, y)*0.25) g.setT(x, y, p.copper ? 'copper' : g.nz(x, y) < 0.55 ? 'mud' : 'dirt'); else if(d < 1.6 && p.copper && g.nz(x, y) < 0.5) g.setT(x, y, 'copper'); });
    if(p.blocks){ const a = g.rnd()*6.28, L = M*0.5; let px = cx - Math.cos(a)*L, py = cy - Math.sin(a)*L; for(let i=0;i<=Math.round(L*2/1.8);i++){ const x = px + Math.cos(a)*i*1.8 + g.R(-0.6, 0.6), y = py + Math.sin(a)*i*1.8 + g.R(-0.6, 0.6); if(f(x, y) < 1) put(g.pick(['jersey', 'cover_concrete', 'polyhedron', 'rubble_pile']), x, y, g.rnd()*360, true); } }
    for(let i=0;i<g.ri(4, 8);i++){ let x, y, t = 0; do { x = g.R(1, cols - 1); y = g.R(1, rows - 1); } while(f(x, y) > 0.95 && ++t < 30); put(g.pick(['barrel_toxic', 'car_wreck', 'pipe_straight', 'tank_horiz', 'bus_wreck', 'rubble_pile', 'crane_beam']), x, y, g.rnd()*360, true); }
    for(let i=0;i<Math.round(M*0.8);i++){ const a = g.rnd()*6.28; let r = 0.5; for(let k=0;k<60 && f(cx + Math.cos(a)*r, cy + Math.sin(a)*r) < 1;k++) r += 0.5; r += g.R(0.5, 2.5); put(g.pick(['reeds', 'dead_tree', 'dry_bush', 'barrel_toxic', 'toxic_puddle', 'rad_sign', 'boulder']), cx + Math.cos(a)*r, cy + Math.sin(a)*r, g.rnd()*360); }
    scatter(g, put, WILD, Math.round(cols*rows/170), (x, y)=>f(x, y) > 1.3); return {x:cx, y:Math.max(1, cy - M*0.4)}; };
  // болото: топь, окна воды, камыш, мостки, утопленная техника
  B.swamp = function(g, put, p){ const {cols, rows} = g.doc, n1 = g.noise(5, g.ri(1, 999)), n2 = g.noise(2, g.ri(1, 999)); GK.reset(g.doc, p.clay ? 'mud' : 'bog');
    each(g, (x, y)=>{ const v = n1(x, y), w = n2(x, y); if(v < 0.28){ g.setT(x, y, p.liq==='acid' ? 'acid' : 'water'); g.occ[y*cols + x] = 1; } else if(v < 0.36) g.setT(x, y, 'mud'); else if(v > 0.74) g.setT(x, y, p.clay ? 'dirt' : 'grass'); if(p.clay && w > 0.7 && v >= 0.36) g.setT(x, y, 'bog'); });
    const pts = crossLine(g, cols >= rows, 3); g.path('trail', 1.2, r2(pts)); pts.forEach(([x, y])=>{ const cx2 = Math.floor(x), cy2 = Math.floor(y); if(cx2 >= 0 && cy2 >= 0 && cx2 < cols && cy2 < rows){ g.occ[cy2*cols + cx2] = 0; if(n1(cx2, cy2) < 0.36) g.setT(cx2, cy2, 'mud'); } });
    scatter(g, put, [['reeds', 6, 30], ['dead_tree', 3, 8], ['mutant_plant', 1, 3], ['stumps', 2, 5], ['tree_sparse', 1, 3], ['glow_mushrooms', 1, 3], ['puddle', 1, 3]], Math.round(cols*rows/45));
    for(let i=0;i<g.ri(2, 4);i++) put(g.pick(['car_wreck', 'pickup_rust', 'barrel_toxic', 'barrels_group', 'tank_horiz', 'apc_wreck']), g.R(2, cols - 2), g.R(2, rows - 2), g.rnd()*360, true, null);
    if(p.clay) scatter(g, put, [['barrel', 3, 6], ['barrel_toxic', 2, 4]], 6); return {x:cols/2, y:1.5}; };
  // жара: пепел, оплавленное, трещины с огнём, гейзеры; варианты: сухой зной, снопы искр, молнии генератора
  B.hot = function(g, put, p){ const {cols, rows} = g.doc; land(g, p.dry ? 'saltflat' : 'ash', p.dry ? [['dust', 0.6, 1], ['cracked', 0, 0.12]] : [['glass', 0.72, 1], ['gravel', 0.55, 0.72], ['dirt', 0, 0.18]]);
    const nh = g.noise(4, g.ri(1, 999)); each(g, (x, y)=>{ if(nh(x, y) > 0.78) g.setT(x, y, p.lightning ? 'glass' : 'ash'); });
    const n = Math.round(cols*rows/(p.lightning ? 260 : 160));
    if(p.lightning){ const cx = cols/2, cy = rows/2; put('tesla_mast', cx, cy, 0, true, vIdx('tesla_mast', /молни/)); for(let i=0;i<g.ri(2, 4);i++){ const a = g.rnd()*6.28, r = Math.min(cols, rows)*g.R(0.2, 0.38); put('tesla_mast', cx + Math.cos(a)*r, cy + Math.sin(a)*r, 0, false, vIdx('tesla_mast', g.rnd() < 0.7 ? /молни/ : /Затих|рухнула/)); }
      scatter(g, put, [['anom_electro', 3, 6], ['crater', 1, 4], ['rocks_scatter', 1, 3], ['corpse', 0.5, 2]], n); for(let i=0;i<4;i++){ const a = g.rnd()*6.28; g.path('cable', 0.25, r2([[cx, cy], [cx + Math.cos(a)*cols, cy + Math.sin(a)*rows]])); } return {x:cx, y:Math.max(1, cy - 4)}; }
    scatter(g, put, [['geyser', 3, 6], ['anom_thermal', p.sparks ? 4 : 2, p.sparks ? 7 : 4], ['slag_pool', p.sparks ? 2 : 0.6, 3], ['beast_bones', 0.5, 1], ['dry_bush', 1, 4], ['boulder', 1, 3], ['corpse', 0.4, 1], ['rift', 1, 3]], n);
    for(let i=0;i<g.ri(1, 3);i++){ const a = g.R(0, 6.28), x = g.R(4, cols - 4), y = g.R(4, rows - 4); put('rift', x, y, a*180/Math.PI, false, vIdx('rift', /Светится/)); }
    scatter(g, put, WILD.filter(w=>/rock|bould|bones|crater/.test(w[0])), Math.round(cols*rows/200)); return {x:cols/2, y:1.5}; };
  // развалины: древние / промзона / вход в подземный город / фабрика (здания с комнатами)
  B.ruins = function(g, put, p, parts){ const {cols, rows} = g.doc; land(g, 'dust', [['gravel', 0.6, 1], ['grass', 0, 0.22], ['cracked', 0.85, 1, 1]]);
    if(p.factory || p.industrial){ g.opts.theme = p.factory ? 'factory' : 'industry'; g.opts.ruin = 'high'; const n = Math.round(cols*rows/450) + 1; let fails = 0;
      for(let t=0;t<40 && parts.length < n && fails < 20;t++){ const bx = g.ri(1, Math.max(1, cols - 14)), by = g.ri(1, Math.max(1, rows - 12)), lot = [bx, by, Math.min(cols, bx + 14), Math.min(rows, by + 12)]; const b = GK.building(g, lot[0], lot[1], lot[2], lot[3]); if(b) parts.push(GK.partOf(b, lot)); else fails++; } }
    const n = Math.round(cols*rows/(p.factory || p.industrial ? 160 : 70));
    for(let i=0;i<n;i++){ const x = g.ri(2, cols - 6), y = g.ri(2, rows - 6), L1 = g.ri(2, 6), L2 = g.ri(2, 5), kind = p.industrial ? g.pick(['concrete', 'brick', 'metal']) : g.pick(['concrete', 'brick', 'brick', 'rock']); if(!g.free(x - 1, y - 1, 3, 3)) continue;
      const sh = g.ri(0, 3), pts = sh===0 ? [[x + L1, y], [x, y], [x, y + L2]] : sh===1 ? [[x, y], [x + L1, y]] : sh===2 ? [[x, y], [x, y + L2]] : [[x, y + L2], [x, y], [x + L1, y], [x + L1, y + Math.max(1, L2 - 2)]]; g.wall(kind, pts); g.mark(x, y, 1, 1); }
    const list = p.industrial ? [['rubble_pile', 4, 8], ['rubble_big', 2, 4], ['pipe_straight', 2, 4], ['tank_big', 1, 2], ['chimney', 1, 2], ['scrap_pile', 2, 5], ['ruin_corner', 2, 3], ['barrels_group', 1, 3], ['conveyor', 1, 2], ['crane_beam', 0.5, 1]]
      : p.under ? [['stairs_down', 2, 3], ['maintenance_hatch', 2, 3], ['manhole', 2, 4], ['rubble_pile', 3, 6], ['ruin_corner', 2, 3], ['rift', 1, 2], ['column', 3, 6], ['collector', 1, 2], ['sewer_grate', 1, 3]]
      : [['column', 4, 10], ['nature_ruins', 2, 4], ['statue_head', 1, 1], ['polyhedron', 1, 3], ['rubble_pile', 3, 6], ['rubble_big', 1, 3], ['ruin_corner', 2, 3], ['ruin_house', 1, 2], ['dead_tree', 2, 4], ['tree_sparse', 1, 3], ['monument', 0.5, 1]];
    scatter(g, put, list, Math.round(cols*rows/(p.factory ? 110 : 60))); scatter(g, put, WILD, Math.round(cols*rows/220)); return {x:cols/2, y:1.5}; };
  // поле объектов с проходами: монолиты, кристаллы, трубки, сосульки, роботы, многогранники
  B.field = function(g, put, p){ const {cols, rows} = g.doc; const T = {monolith:['dust', [['glass', 0.72, 1], ['gravel', 0.6, 0.72]]], crystal_tree:['crystal', [['rock', 0.7, 1], ['gravel', 0, 0.2]]], pipe_forest:['dirt', [['dust', 0.6, 1], ['gravel', 0, 0.2]]],
      mineral_spikes:['rock', [['gravel', 0.6, 1], ['saltflat', 0, 0.2]]], robot_wreck:['scrap', [['dust', 0.62, 1], ['gravel', 0, 0.25]]], polyhedron:[p.frozen ? 'glass' : 'grass', p.frozen ? [['crystal', 0.6, 1], ['rock', 0, 0.25]] : [['dust', 0.62, 1], ['gravel', 0, 0.2]]]}[p.obj] || ['dust', []];
    land(g, T[0], T[1]);
    // тропы сквозь поле — свободны
    const paths = []; for(let i=0;i<g.ri(1, 2);i++){ const pts = crossLine(g, i ? cols < rows : cols >= rows, 4, g.R(-4, 4)); paths.push(pts); g.path('trail', 1.1, r2(pts)); }
    each(g, (x, y, px, py)=>{ if(paths.some(pt=>lineDist(pt, px, py) < 1.2)) g.occ[y*cols + x] = 1; });
    const as = BY[p.obj], step = Math.max(as.w, as.h) + (p.dense ? 0.3 : 0.9); let n = 0;
    const scl = {monolith:[1, 1.7], crystal_tree:[0.9, 1.6], polyhedron:[0.9, 1.5], mineral_spikes:[0.9, 1.4]}[p.obj]; // разный рост — поле не под копирку
    for(let y=1 + g.rnd()*step;y<rows - 1;y+=step*g.R(0.8, 1.2)) for(let x=1 + g.rnd()*step;x<cols - 1;x+=step*g.R(0.8, 1.2)){ if(g.rnd() < 0.18) continue; const o = put(p.obj, x + g.R(-0.5, 0.5), y + g.R(-0.5, 0.5), g.rnd() < 0.5 ? g.rnd()*360 : 0); if(o){ n++; if(scl) o.s = Math.round(g.R(scl[0], scl[1])*100)/100; } }
    each(g, (x, y, px, py)=>{ if(paths.some(pt=>lineDist(pt, px, py) < 1.2)) g.occ[y*cols + x] = 0; });
    const extra = {monolith:[['bone_field', 0.5, 1], ['crater', 1, 2], ['rad_sign', 1, 2]], crystal_tree:[['crystal_growth', 3, 6], ['glow_mushrooms', 1, 3], ['artifact', 0.4, 1]], pipe_forest:p.camp ? [['skull_totem', 2, 4], ['tent', 1, 2], ['campfire', 1, 2], ['trophy_pole', 1, 2]] : [['scrap_pile', 1, 3]],
      mineral_spikes:[['beast_bones', 0.5, 1], ['corpse', 0.5, 1], ['boulder', 2, 4]], robot_wreck:[['scrap_pile', 3, 6], ['tire_stack', 1, 3], ['junk_mound', 1, 2], ['electric_panel', 1, 2]].concat(p.bones ? [['bone_field', 1, 2], ['bone_pile', 2, 4]] : []), polyhedron:p.guards ? [['statue_judge', 1, 2], ['monument', 0.5, 1]] : [['crystal_growth', 1, 2]]}[p.obj] || [];
    scatter(g, put, extra, 6); if(p.anom) scatter(g, put, [['anom_electro', 1, 2], ['anom_gravity', 0.5, 1]], 2); return {x:cols/2, y:1.5}; };
  // крушение: борозда от края, главный остов, обломки, пожары
  B.wreck = function(g, put, p){ const {cols, rows} = g.doc, M = Math.min(cols, rows); land(g, p.salt ? 'saltflat' : 'dust', p.salt ? [['sand', 0.72, 1], ['gravel', 0, 0.15]] : [['gravel', 0.62, 1], ['dirt', 0, 0.22], ['grass', 0.85, 1, 1]]);
    const cx = cols/2 + g.R(-2, 2), cy = rows/2 + g.R(-2, 2), a = g.rnd()*6.28, L = M*0.55;
    if(!p.noTrench){ const sx = cx - Math.cos(a)*L*1.4, sy = cy - Math.sin(a)*L*1.4; each(g, (x, y, px, py)=>{ const d = segDist(px, py, sx, sy, cx, cy); if(d < 1.4) g.setT(x, y, p.salt ? 'gravel' : 'dirt'); else if(d < 2.4 && g.nz(x, y) < 0.5) g.setT(x, y, 'ash'); });
      for(let i=0;i<g.ri(3, 6);i++){ const t = g.rnd(); put(g.pick(['rubble_pile', 'scrap_pile', 'crate_metal', 'pipe_straight', 'trash']), sx + (cx - sx)*t + g.R(-2, 2), sy + (cy - sy)*t + g.R(-2, 2), g.rnd()*360); } }
    const ang = a*180/Math.PI + 90;
    if(p.obj==='ship_hull'){ put('ship_hull', cx, cy, ang, true, vIdx('ship_hull', /Пробоина/)); put('ship_hull', cx + Math.cos(a)*5, cy + Math.sin(a)*5, ang + g.R(-25, 25), true); put('ship_nozzle', cx - Math.cos(a)*6 + g.R(-1, 1), cy - Math.sin(a)*6, 0, false);
      for(let i=0;i<g.ri(3, 6);i++) put('cryo_pod', cx + g.R(-6, 6), cy + g.R(-6, 6), g.rnd()*360); for(let i=0;i<g.ri(2, 3);i++) put('robot_wreck', cx + g.R(-7, 7), cy + g.R(-7, 7), g.rnd()*360, false, vIdx('robot_wreck', /Паук/)); }
    else if(p.obj==='antigrav_car'){ for(let i=0;i<g.ri(3, 4);i++){ const t = i*8.5, d = (g.rnd() - 0.5)*3; put('antigrav_car', cx + Math.cos(a)*(t - 12) + Math.cos(a + 1.57)*d, cy + Math.sin(a)*(t - 12) + Math.sin(a + 1.57)*d, ang + g.R(-30, 30), true); } }
    else if(p.obj==='barge') put('barge', cx, cy, ang, true);
    else if(p.obj==='satellite'){ put('satellite', cx, cy, g.rnd()*360, true, vIdx('satellite', /вещает/)); put('crater', cx + 1, cy + 1.5, 0, true); for(let i=0;i<g.ri(2, 3);i++) put(g.pick(['billboard', 'road_billboard']), cx + g.R(-8, 8), cy + g.R(-8, 8), g.pick([0, 90])); }
    else put(p.obj, cx, cy, ang, true, p.obj==='aerocar' ? vIdx('aerocar', /рассыпан/) : null);
    if(p.obj==='aerocar'){ for(let i=0;i<g.ri(4, 7);i++) put(g.pick(['pipe_straight', 'crate_metal', 'scrap_pile']), cx + g.R(-5, 5), cy + g.R(-5, 5), g.rnd()*360); }
    scatter(g, put, [['crater', 1, 3], ['rubble_pile', 2, 4], ['scrap_pile', 2, 4], ['car_burnt', 0.4, 1], ['oil_drum_fire', 0.6, 2], ['corpse', 0.6, 2]], Math.round(M/3), (x, y)=>Math.hypot(x - cx, y - cy) < M*0.5);
    if(p.anom) scatter(g, put, [['anom_gravity', 1, 2], ['anom_electro', 1, 2], ['rift', 0.6, 1]], 4);
    if(p.ads) scatter(g, put, [['billboard', 1, 3], ['radio_mast', 0.6, 1], ['tv', 1, 3]], 4);
    scatter(g, put, p.salt ? SALT : WILD, Math.round(cols*rows/170)); return {x:cx, y:Math.max(1, cy - M*0.35)}; };
  // карьер / рудник: уступы кольцами, серпантин, техника, жилы
  B.pit = function(g, put, p, parts){ const {cols, rows} = g.doc, M = Math.min(cols, rows), cx = cols/2, cy = rows/2, R = M*0.44;
    land(g, p.ore==='copper' ? 'copper' : 'dust', [['gravel', 0.6, 1], ['dirt', 0, 0.25]]); const f = blob(g, cx, cy, Math.min(cols*0.46, R*1.2), R, 0.1), lv = p.rings ? 5 : 4;
    const tiers = ['gravel', 'rock', p.ore==='copper' ? 'copper' : 'dirt', 'rock', 'gravel'];
    each(g, (x, y, px, py)=>{ const d = f(px, py); if(d < 1){ const k = Math.floor((1 - d)*lv); g.setT(x, y, k >= lv - 1 && p.liq ? p.liq : tiers[k%tiers.length]); if(k >= lv - 1 && p.liq) g.occ[y*cols + x] = 1; } });
    // уступы — скальные стенки по уровням, с проходом серпантина
    for(let k=1;k<lv;k++){ const lvl = 1 - k/lv, gap = (k*1.7)%6.28, pts = []; for(let i=0;i<=48;i++){ const a = i/48*6.283; let r = 0.3; for(let s=0;s<120 && f(cx + Math.cos(a)*r, cy + Math.sin(a)*r) < lvl;s++) r += 0.25;
        const dd = Math.abs(((a - gap + 9.42)%6.283) - 3.14); if(dd < 0.35){ if(pts.length > 1) g.wall('rock', r2(pts)); pts.length = 0; continue; } pts.push([cx + Math.cos(a)*r, cy + Math.sin(a)*r]); } if(pts.length > 1) g.wall('rock', r2(pts)); }
    const sp = []; for(let i=0;i<=lv*10;i++){ const t = i/(lv*10), a = t*lv*1.7, lvl = 1 - t*0.95; let r = 0.3; for(let s=0;s<160 && f(cx + Math.cos(a)*r, cy + Math.sin(a)*r) < lvl;s++) r += 0.25; sp.push([cx + Math.cos(a)*(r - 0.8), cy + Math.sin(a)*(r - 0.8)]); }
    g.path(p.mine ? 'rail' : 'track', p.mine ? 1 : 2, r2(sp.reverse()));
    if(p.mine){ put('mine_headframe', cx + R*0.95, cy - R*0.5, 0, true); for(let i=0;i<g.ri(3, 5);i++){ const q = sp[g.ri(0, sp.length - 1)]; put('mine_cart', q[0] + g.R(-1, 1), q[1] + g.R(-1, 1), g.rnd()*360); } scatter(g, put, [['ore_vein', 3, 6], ['mine_props', 2, 4], ['crate_wood', 1, 3]], 8, (x, y)=>f(x, y) < 0.95);
      g.opts.theme = 'industry'; g.opts.ruin = 'high'; for(let t=0;t<10 && parts.length < 2;t++){ const bx = g.ri(1, Math.max(1, cols - 9)), by = g.pick([1, Math.max(1, rows - 8)]), lot = [bx, by, Math.min(cols, bx + 9), Math.min(rows, by + 7)]; const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, g.pick(['boxgarage', 'guardhouse', 'warehouse'])); if(b) parts.push(GK.partOf(b, lot)); } }
    else { scatter(g, put, [['excavator', 1, 2], ['dump_truck', 1, 2], ['drill_rig', 0.6, 1], ['conveyor', 1, 2], ['rubble_pile', 2, 5], ['barrels_group', 1, 2]], 7, (x, y)=>f(x, y) < 1); }
    scatter(g, put, WILD, Math.round(cols*rows/220), (x, y)=>f(x, y) > 1.1); return {x:cx, y:Math.max(1, cy - R*1.1)}; };
  // огороженный комплекс с ядром: радиотелескопы, печи, циклотрон, саркофаг, пси-установка, ускоритель, АЭС, завод
  B.complex = function(g, put, p, parts){ const {cols, rows} = g.doc, M = Math.min(cols, rows); land(g, 'dust', [['gravel', 0.6, 1], ['grass', 0, 0.2], ['concrete', 0.88, 1, 1]]);
    const x0 = 2, y0 = 2, x1 = cols - 2, y1 = rows - 2, gate = g.ri(0, 3), gp = fenceRect(g, x0, y0, x1, y1, p.mines ? 'fence' : g.pick(['fence', 'concrete', 'fence']), gate, 3);
    put(p.guard ? 'checkpoint' : 'gate_metal', gp[0], gp[1], gate%2 ? 90 : 0, true); const cx = cols/2, cy = rows/2;
    g.path('road', 3, r2([[gp[0], gp[1]], [cx + (gp[0] - cx)*0.3, cy + (gp[1] - cy)*0.3], [cx, cy]])); each(g, (x, y, px, py)=>{ if(segDist(px, py, gp[0], gp[1], cx, cy) < 1.6) g.occ[y*cols + x] = 1; });
    const core = p.core;
    if(core==='dishes'){ const n = M >= 36 ? 4 : 2, sp = Math.min(cols, rows)*0.26; [[-1, -1], [1, -1], [-1, 1], [1, 1]].slice(0, n).forEach(([sx, sy], i)=>put('radio_dish', cx + sx*sp*(n===2 ? 1.2 : 1), cy + sy*sp*(n===2 ? 0 : 0.8), 0, true, vIdx('radio_dish', i===n - 1 ? /Рухнул/ : g.rnd() < 0.5 ? /сорвана/ : /Целый|Зарос/))); }
    else if(core==='furnaces'){ for(let i=0;i<g.ri(3, 5);i++) put('slag_pool', cx + g.R(-6, 6), cy + g.R(-5, 5), 0, false, vIdx('slag_pool', /Раскал/)); put('chimney', cx + 4, cy - 3, 0); put('boiler', cx - 4, cy - 3, 0); put('conveyor', cx, cy + 3, 90); }
    else if(core==='cyclotron' || core==='accel') put('accel_ring', cx, cy, 0, true, vIdx('accel_ring', core==='accel' ? /Пробито/ : /Искрит/));
    else if(core==='sarcophagus') put('sarcophagus', cx, cy, 0, true, vIdx('sarcophagus', /Трещин/));
    else if(core==='nuclear'){ put('sarcophagus', cx - 3, cy, 0, true, vIdx('sarcophagus', /Вскрыт/)); put('cooling_tower', cx + 5, cy - 3, 0, true); if(M > 30) put('cooling_tower', cx + 5, cy + 5, 0, true); }
    else if(core==='psi'){ put('radar', cx, cy, 0, true); put('radio_mast', cx + 3, cy - 2, 0); put('antenna', cx - 3, cy + 2, 0); put('transformer', cx + 3, cy + 3, 0); }
    else if(core==='factory'){ }
    g.opts.theme = 'factory'; g.opts.ruin = p.guard ? 'low' : 'high';
    const want = core==='factory' ? 3 : 2; let fails = 0;
    for(let t=0;t<40 && parts.length < want && fails < 20;t++){ const bx = g.ri(x0 + 2, Math.max(x0 + 2, x1 - 12)), by = g.ri(y0 + 2, Math.max(y0 + 2, y1 - 10)), lot = [bx, by, Math.min(x1 - 1, bx + 12), Math.min(y1 - 1, by + 10)];
      const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, parts.length===0 ? (core==='factory' || core==='furnaces' ? 'factory_hall' : 'control') : null); if(b) parts.push(GK.partOf(b, lot)); else fails++; }
    scatter(g, put, [['transformer', 2, 3], ['power_pylon', 1, 3], ['electric_panel', 1, 3], ['generator', 1, 2], ['barrels_group', 1, 2], ['crate_metal', 1, 3], ['pipe_rack', 0.6, 1], ['lamp_post', 1, 4]], Math.round(cols*rows/160), (x, y)=>x > x0 + 1 && y > y0 + 1 && x < x1 - 1 && y < y1 - 1);
    if(p.guard) scatter(g, put, [['turret', 3, 6], ['searchlight', 2, 4], ['watchtower', 1, 2]], 8, (x, y)=>x > x0 + 1 && y > y0 + 1 && x < x1 - 1 && y < y1 - 1);
    if(p.mines){ for(let i=0;i<Math.round(cols*rows/80);i++) put('landmine', g.R(x0 + 1, x1 - 1), g.R(y0 + 1, y1 - 1), 0); scatter(g, put, [['mine_field', 3, 6]], 6); }
    if(p.anom || core==='cyclotron' || core==='accel') scatter(g, put, [['anom_gravity', 1, 2], ['anom_electro', 2, 3], ['rift', 1, 2], ['crystal_growth', 1, 2]], 5);
    hazard(g, put, p.haz, null); scatter(g, put, WILD, Math.round(cols*rows/260)); return {x:cx, y:1.2}; };
  // зона радиации
  B.radzone = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'dust', [['gravel', 0.6, 1], ['grass', 0, 0.2]]); const f = blob(g, cols/2, rows/2, cols*0.4, rows*0.38, 0.3);
    each(g, (x, y, px, py)=>{ const d = f(px, py); if(d < 0.6 || (d < 1 && g.nz(x, y) < (1 - d)*1.2)) g.setT(x, y, 'rad'); });
    for(let i=0;i<14;i++){ const a = i/14*6.28; let r = 1; for(let k=0;k<80 && f(cols/2 + Math.cos(a)*r, rows/2 + Math.sin(a)*r) < 1;k++) r += 0.5; put('rad_sign', cols/2 + Math.cos(a)*(r + 1), rows/2 + Math.sin(a)*(r + 1), 0); }
    scatter(g, put, [['tank_wreck', 1, 1], ['apc_wreck', 1, 2], ['barrel_toxic', 3, 6], ['crater', 2, 4], ['bone_field', 1, 2], ['dead_tree', 2, 5], ['mutant_plant', 1, 2], ['car_burnt', 1, 3], ['corpse', 1, 2]], Math.round(cols*rows/90));
    scatter(g, put, WILD, Math.round(cols*rows/220)); return {x:cols/2, y:1.5}; };
  // поле боя: окопы, проволока, воронки, остовы, кости
  B.battle = function(g, put, p){ const {cols, rows} = g.doc, horiz = cols >= rows; land(g, 'dirt', [['mud', 0.68, 1], ['ash', 0, 0.18], ['grass', 0.8, 1, 1]]);
    [-1, 1].forEach(sd=>{ const off = sd*(horiz ? rows : cols)*0.28, base = crossLine(g, horiz, 1, off), zz = []; base.forEach(([x, y], i)=>{ if(i%4===0) zz.push([x + (horiz ? 0 : (i%8 ? 1 : -1)), y + (horiz ? (i%8 ? 1 : -1) : 0)]); }); g.path('trench', 1.2, r2(zz));
      for(let t=0.1;t<1;t+=0.18){ const q = pointAt(zz, t); put(g.pick(['sandbags_line', 'sandbags_arc', 'pillbox', 'sandbags_line']), q.x - Math.sin(q.a)*sd*1.6, q.y + Math.cos(q.a)*sd*1.6*(horiz ? -1 : 1), q.a*180/Math.PI); } });
    const mid = crossLine(g, horiz, 1); for(let t=0.05;t<1;t+=0.12){ const q = pointAt(mid, t); put('barbed_wire', q.x, q.y, q.a*180/Math.PI, true); if(g.rnd() < 0.5) put('czech_hedgehog', q.x + g.R(-2, 2), q.y + g.R(-2, 2), g.rnd()*360); }
    for(let i=0;i<Math.round(cols*rows/90);i++){ const x = g.R(1, cols - 1), y = g.R(1, rows - 1); put('crater', x, y, g.rnd()*360); }
    scatter(g, put, [['tank_wreck', 1, 2], ['apc_wreck', 1, 2], ['war_mech', 1, 1], ['bone_field', 2, 4], ['corpse', 2, 4], ['landmine', 2, 6], ['mine_field', 1, 3], ['ammo_crate', 1, 3], ['dead_tree', 2, 4], ['stumps', 1, 3]], Math.round(cols*rows/80));
    return {x:cols/2, y:1.2}; };
  // открытая Равнина с сюжетной мелочью: засада, дюны, брошенная стоянка, крысы, брошенное снаряжение
  B.plain = function(g, put, p){ const {cols, rows} = g.doc; land(g, p.dunes ? 'sand' : 'dust', p.dunes ? [['dust', 0.7, 1], ['gravel', 0, 0.12]] : [['gravel', 0.62, 1], ['grass', 0, 0.2], ['sand', 0.85, 1, 1]]);
    const road = crossLine(g, cols >= rows, 3); g.path('track', 2, r2(road)); each(g, (x, y, px, py)=>{ if(lineDist(road, px, py) < 1.3) g.occ[y*cols + x] = 1; });
    if(p.dunes) scatter(g, put, [['dune', 6, 14], ['rocks_scatter', 1, 3]], Math.round(cols*rows/80));
    const c = pointAt(road, 0.4 + g.rnd()*0.2), side = g.rnd() < 0.5 ? 1 : -1, sx = c.x - Math.sin(c.a)*side*4, sy = c.y + Math.cos(c.a)*side*4;
    if(p.event==='ambush'){ put('barricade_car', c.x, c.y, c.a*180/Math.PI + 90, true); [-1, 1].forEach(s=>{ for(let i=0;i<2;i++) put(g.pick(['rock_big', 'cover_concrete', 'rubble_pile', 'car_wreck']), c.x - Math.sin(c.a)*s*g.R(4, 6) + g.R(-3, 3), c.y + Math.cos(c.a)*s*g.R(4, 6) + g.R(-3, 3), g.rnd()*360); }); put('corpse', c.x + g.R(-3, 3), c.y + g.R(-2, 2), g.rnd()*360); put('tripwire', c.x + Math.cos(c.a)*4, c.y + Math.sin(c.a)*4, c.a*180/Math.PI + 90, true); }
    if(p.camp || p.gear){ put('campfire', sx, sy, 0, false, vIdx('campfire', /потух|Остыв|Зол/)); put('sleeping_bag', sx + 1.5, sy, 90); put('sleeping_bag', sx - 1.5, sy + 0.5, 90); put('trash', sx, sy + 1.5, 0); if(p.gear){ for(let i=0;i<3;i++) put(g.pick(['crate_metal', 'ammo_crate', 'barrel']), sx + g.R(-2.5, 2.5), sy + g.R(-2.5, 2.5), g.rnd()*360); } }
    if(p.rats){ for(let i=0;i<g.ri(3, 5);i++) put(g.pick(['bone_pile', 'trash', 'trash', 'beast_bones']), sx + g.R(-4, 4), sy + g.R(-4, 4), g.rnd()*360); put('campfire', sx, sy, 0); }
    scatter(g, put, p.dunes ? [['cactus', 1, 3], ['beast_bones', 0.5, 1], ['dry_bush', 1, 4]] : WILD, Math.round(cols*rows/110)); return {x:cols/2, y:1.5}; };
  // зона искажения / аномальный биом
  B.anomaly = function(g, put, p, parts){ const {cols, rows} = g.doc; land(g, 'dust', [['mutant', 0.66, 1], ['crystal', 0, 0.14], ['gravel', 0.85, 1, 1]]);
    if(p.sanatorium){ g.opts.theme = 'civic'; g.opts.ruin = 'high'; for(let t=0;t<12 && parts.length < 2;t++){ const bx = g.ri(1, Math.max(1, cols - 13)), by = g.ri(1, Math.max(1, rows - 12)), lot = [bx, by, Math.min(cols, bx + 13), Math.min(rows, by + 12)]; const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, g.pick(['clinic', 'lab', 'office'])); if(b) parts.push(GK.partOf(b, lot)); } }
    scatter(g, put, [['anom_gravity', 2, 3], ['anom_electro', 2, 4], ['anom_thermal', 1, 3], ['crystal_growth', 2, 5], ['rift', 1, 2], ['artifact', 1, 2], ['mutant_tree', 1, 3], ['glow_mushrooms', 1, 4], ['monolith', 0.6, 2], ['rubble_pile', 1, 3]], Math.round(cols*rows/70));
    scatter(g, put, WILD, Math.round(cols*rows/250)); return {x:cols/2, y:1.5}; };
  // склон: уступы-скалы с серпантином; бетонный, скальный, сыпучий
  B.slope = function(g, put, p){ const {cols, rows} = g.doc, horiz = cols >= rows, mat = p.mat || 'rock'; const n = 4;
    land(g, mat==='sand' ? 'sand' : mat==='concrete' ? 'cracked' : 'rock', mat==='concrete' ? [['concrete', 0.6, 1], ['gravel', 0, 0.25]] : mat==='sand' ? [['dust', 0.65, 1], ['gravel', 0, 0.15]] : [['gravel', 0.6, 1], ['dirt', 0, 0.2]]);
    const lines = []; for(let k=1;k<n;k++){ const off = ((k/n) - 0.5)*(horiz ? rows : cols), pts = crossLine(g, horiz, 1.5, off); lines.push(pts); const gap = 0.15 + ((k*0.37)%0.7); const L = pts.length, gi = Math.floor(gap*L); const a = pts.slice(0, Math.max(2, gi - 2)), b = pts.slice(Math.min(L - 2, gi + 2));
      const kind = mat==='concrete' ? 'concrete' : 'rock'; if(a.length > 1) g.wall(kind, r2(a)); if(b.length > 1) g.wall(kind, r2(b));
      const q = pointAt(pts, gap); if(p.up) put('ladder', q.x, q.y, q.a*180/Math.PI + 90, true); }
    // серпантин через проёмы
    const sp = []; for(let k=0;k<=n;k++){ const t = k===0 ? 0.5 : k===n ? 0.5 : 0.15 + ((k*0.37)%0.7); const o = ((k/n) - 0.5)*(horiz ? rows : cols); sp.push(horiz ? [cols*t, rows/2 + o] : [cols/2 + o, rows*t]); } g.path('trail', 1, r2(chaikin(sp, 2)));
    const list = mat==='concrete' ? [['rubble_pile', 4, 8], ['rubble_big', 2, 4], ['jersey', 1, 3], ['cover_concrete', 1, 3]] : mat==='sand' ? [['dune', 3, 6], ['rocks_scatter', 2, 4], ['boulder', 2, 4]] : [['rock_big', 4, 8], ['boulder', 4, 8], ['rocks_scatter', 3, 6], ['dry_bush', 2, 4], ['dead_tree', 1, 2]];
    scatter(g, put, list, Math.round(cols*rows/70)); return {x:cols/2, y:1.2}; };
  // биохранилища, споры, паутина
  B.bio = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'dirt', [['mutant', 0.6, 1], ['grass', 0, 0.22], ['mud', 0.85, 1, 1]]);
    if(p.web){ const road = crossLine(g, cols >= rows, 2); g.path('road', 3, r2(road)); for(let t=0.25;t<0.8;t+=0.18){ const q = pointAt(road, t); put('semi_truck', q.x, q.y, q.a*180/Math.PI + 90, true, vIdx('semi_truck', /Сложилась|Тентован/)); } scatter(g, put, [['web_mass', 6, 12], ['cocoon', 3, 6], ['mutant_plant', 1, 3]], Math.round(cols*rows/70)); }
    else { const n = Math.max(2, Math.round(cols*rows/450)); for(let i=0;i<n;i++) put('bio_tank', g.R(4, cols - 4), g.R(4, rows - 4), 0, false, vIdx('bio_tank', g.rnd() < 0.6 ? /споры/ : /грибами/)); scatter(g, put, [['glow_mushrooms', 4, 8], ['cocoon', 1, 3], ['toxic_puddle', 2, 4], ['pipe_straight', 1, 3], ['mutant_tree', 1, 2], ['web_mass', 1, 2]], Math.round(cols*rows/70)); }
    scatter(g, put, WILD, Math.round(cols*rows/250)); return {x:cols/2, y:1.5}; };
  // многоэтажки / корпуса над завалами
  B.towers = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'cracked', [['concrete', 0.62, 1], ['gravel', 0, 0.22], ['dust', 0.85, 1, 1]]);
    const step = 11; for(let y=2;y<rows - 8;y+=step) for(let x=2;x<cols - 6;x+=step){ if(g.rnd() < 0.2) continue; put(g.pick(['apartment_block', 'apartment_block', 'megablock', 'ruin_house']), x + 4 + g.R(-1, 1), y + 4 + g.R(-1, 1), g.pick([0, 90]), false, null); }
    scatter(g, put, [['rubble_big', 4, 8], ['rubble_pile', 6, 12], ['ruin_corner', 2, 4], ['car_burnt', 1, 3], ['bus_wreck', 0.5, 1]].concat(p.climb ? [['ladder', 3, 6], ['sky_bridge', 1, 2]] : []), Math.round(cols*rows/50));
    hazard(g, put, p.haz, null); return {x:cols/2, y:1.2}; };
  // утилизатор / ржавые трубы
  B.utilizer = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'scrap', [['dust', 0.62, 1], ['toxic', 0, 0.12], ['gravel', 0.85, 1, 1]]);
    if(p.pipes){ for(let i=0;i<Math.round(cols*rows/60);i++) put(g.pick(['pipe_straight', 'pipe_straight', 'pipe_corner', 'pipe_rack']), g.R(1, cols - 1), g.R(1, rows - 1), g.rnd()*360, false, null); scatter(g, put, [['toxic_puddle', 3, 6], ['valve', 1, 3]], 8); }
    else scatter(g, put, [['junk_mound', 2, 4], ['scrap_pile', 4, 8], ['press', 1, 2], ['conveyor', 1, 3], ['barrel_toxic', 3, 6], ['chimney', 1, 1], ['crane_beam', 0.5, 1], ['robot_wreck', 1, 2], ['tire_stack', 1, 3]], Math.round(cols*rows/50));
    hazard(g, put, p.haz || 'chem', null); return {x:cols/2, y:1.2}; };
  // залитые скважины
  B.wells = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'mud', [['dirt', 0.6, 1], ['bog', 0, 0.2]]); const n = Math.max(3, Math.round(cols*rows/220));
    for(let i=0;i<n;i++){ const x = g.R(3, cols - 3), y = g.R(3, rows - 3), r = g.R(1.5, 3); each(g, (cx2, cy2, px, py)=>{ if(Math.hypot(px - x, py - y) < r){ g.setT(cx2, cy2, 'acid'); g.occ[cy2*cols + cx2] = 1; } }); put(g.pick(['drill_rig', 'pump_jack', 'drill_rig']), x + g.R(-1, 1), y + g.R(-1, 1), g.rnd()*360, true, vIdx('drill_rig', /Затоплена|Брошена/)); }
    scatter(g, put, [['pipe_straight', 2, 5], ['tank_horiz', 1, 2], ['barrels_group', 1, 2], ['reeds', 3, 8], ['dead_tree', 1, 3]], Math.round(cols*rows/70)); return {x:cols/2, y:1.2}; };
  // русло с мостом: вантовым или деревянным с заставой
  B.bridge = function(g, put, p){ const {cols, rows} = g.doc, horiz = cols < rows ? true : g.rnd() < 0.3; land(g, 'dust', [['gravel', 0.62, 1], ['grass', 0, 0.2]]);
    const pts = crossLine(g, horiz, 1.2), w = Math.min(10, Math.max(5, Math.min(cols, rows)*0.28)); each(g, (x, y, px, py)=>{ const d = lineDist(pts, px, py); if(d < w/2) g.setT(x, y, d < w/4 ? 'mud' : 'gravel'); else if(d < w/2 + 1) g.setT(x, y, 'rock'); });
    g.path('dryriver', w*0.5, r2(pts)); const q = pointAt(pts, 0.5); const bridgeAng = q.a*180/Math.PI;
    const br = put(p.outpost ? 'bridge' : 'cable_bridge', q.x, q.y, bridgeAng, true, p.outpost ? null : vIdx('cable_bridge', /провисли|Пролёты/)); if(br) br.s = Math.round(Math.max(1, (w + 3)/(p.outpost ? 8 : 12))*100)/100; // пролёт — во всю ширину русла
    [-1, 1].forEach(s=>{ const ex = q.x + Math.cos(q.a + Math.PI/2)*s*(w/2 + 1), ey = q.y + Math.sin(q.a + Math.PI/2)*s*(w/2 + 1), L = Math.max(cols, rows); g.path('track', 2, r2([[ex, ey], [ex + Math.cos(q.a + Math.PI/2)*s*L, ey + Math.sin(q.a + Math.PI/2)*s*L]])); }); // подъезды к мосту
    for(let i=0;i<g.ri(4, 8);i++){ const r = pointAt(pts, g.rnd()); if(Math.hypot(r.x - q.x, r.y - q.y) < 5) continue; put(g.pick(['car_wreck', 'scrap_pile', 'pipe_straight', 'crane_beam', 'buggy', 'rubble_pile', 'bus_wreck']), r.x + g.R(-1.5, 1.5), r.y + g.R(-1.5, 1.5), g.rnd()*360); }
    if(p.outpost){ const ends = [-1, 1].map(s=>[q.x + Math.cos(q.a + Math.PI/2)*s*(w/2 + 4.5), q.y + Math.sin(q.a + Math.PI/2)*s*(w/2 + 4.5)]); const [ex, ey] = ends[0]; put('settlement_gate', ex, ey, bridgeAng, true); put('scrap_tower', ex + Math.cos(q.a)*3, ey + Math.sin(q.a)*3, 0); put('banner', ex - Math.cos(q.a)*3, ey - Math.sin(q.a)*3, 0); put('skull_totem', ends[1][0], ends[1][1], 0);
      const ox = (ex - q.x)/(Math.hypot(ex - q.x, ey - q.y) || 1), oy = (ey - q.y)/(Math.hypot(ex - q.x, ey - q.y) || 1); // от моста наружу
      for(let i=0, k=0, want=g.ri(6, 9);i<40 && k<want;i++){ const t = g.R(1, 9), sd = g.R(-6, 6); if(put(g.pick(['tent', 'tent', 'scrap_shack', 'campfire', 'trophy_pole', 'oil_drum_fire', 'sleeping_bag', 'skull_totem', 'pack_animal']), ex + ox*t - oy*sd, ey + oy*t + ox*sd, g.rnd()*360)) k++; } }
    hazard(g, put, p.haz, (x, y)=>lineDist(pts, x, y) < w/2); scatter(g, put, WILD, Math.round(cols*rows/180), (x, y)=>lineDist(pts, x, y) > w/2 + 1); return {x:cols/2, y:1.2}; };
  // заброшенный док: канал, причал, краны, штабели, баржа
  B.docks = function(g, put, p, parts){ const {cols, rows} = g.doc, wd = Math.max(5, Math.round(Math.min(cols, rows)*0.25)); land(g, 'concrete', [['cracked', 0.6, 1], ['gravel', 0, 0.15], ['rust', 0.88, 1, 1]].filter(m=>MapFormat.T_INDEX[m[0]] != null));
    for(let y=rows - wd;y<rows;y++) for(let x=0;x<cols;x++){ g.setT(x, y, 'sewer'); g.occ[y*cols + x] = 1; } g.wall('concrete', [[0, rows - wd], [cols, rows - wd]]);
    put('barge', cols*g.R(0.3, 0.7), rows - wd/2, 90, true, vIdx('barge', /Разлом|мели/));
    const ny = rows - wd - 4.5; for(let x=4;x<cols - 4;x+=g.ri(9, 12)) put('gantry_crane', x, ny, 90, false, vIdx('gantry_crane', g.rnd() < 0.3 ? /Рухнул/ : /Ржав/));
    for(let i=0;i<Math.round(cols*rows/220);i++) put('container_stack', g.R(3, cols - 3), g.R(3, rows - wd - 9), g.pick([0, 90]));
    g.opts.theme = 'industry'; g.opts.ruin = 'high'; for(let t=0;t<10 && parts.length < 1;t++){ const bx = g.ri(1, Math.max(1, cols - 13)), lot = [bx, 1, Math.min(cols, bx + 13), Math.min(rows - wd - 6, 12)]; if(lot[3] - lot[1] < 7) break; const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, 2, 'warehouse'); if(b) parts.push(GK.partOf(b, lot)); }
    scatter(g, put, [['crate_wood', 2, 5], ['crate_metal', 2, 5], ['pallet', 2, 4], ['barrels_group', 1, 3], ['rubble_pile', 2, 4], ['lamp_post', 1, 4], ['toxic_puddle', 1, 3]], Math.round(cols*rows/80));
    hazard(g, put, 'disease', (x, y)=>y < rows - wd); return {x:cols/2, y:1.2}; };
  // теплицы (заболоченные), община культистов
  B.greenhouse = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'bog', [['mud', 0.6, 1], ['grass', 0, 0.25], ['acid', 0, 0.08, 1]]);
    for(let x=2;x<cols - 3;x+=4.5) for(let y=1.5;y<rows - 8;y+=10){ if(g.rnd() < 0.15) continue; put('greenhouse', x + 1.5, y + 4, 0, false, vIdx('greenhouse', g.rnd() < 0.6 ? /Заболочена|выбиты/ : /Заросла/)); }
    scatter(g, put, [['pump_station', 1, 1], ['water_cistern', 1, 2], ['reeds', 4, 10], ['dead_tree', 1, 3], ['pipe_straight', 1, 3]], Math.round(cols*rows/90));
    if(p.cult){ const cx = g.R(cols*0.3, cols*0.7), cy = g.R(rows*0.3, rows*0.7); put('big_tent', cx, cy, 0, true); put('skull_totem', cx + 3, cy, 0); put('campfire', cx, cy + 3, 0); put('banner', cx - 3, cy - 2, 0); for(let i=0;i<g.ri(2, 4);i++) put(g.pick(['tent', 'scrap_shack', 'garden_bed']), cx + g.R(-6, 6), cy + g.R(-5, 5), g.rnd()*360); }
    return {x:cols/2, y:1.2}; };
  // крио-низина: иней, обледенелые стойки и капсулы
  B.cryo = function(g, put, p){ const {cols, rows} = g.doc; land(g, 'frost', [['gravel', 0.62, 1], ['rock', 0, 0.15]]); const cx = cols/2, cy = rows/2, w = Math.min(cols - 6, 18), h = Math.min(rows - 6, 12);
    const x0 = Math.round(cx - w/2), y0 = Math.round(cy - h/2); for(let y=y0;y<y0 + h;y++) for(let x=x0;x<x0 + w;x++) g.setT(x, y, g.nz(x, y) < 0.7 ? 'metal' : 'frost');
    g.wall('concrete', [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h - 4]]); g.wall('concrete', [[x0 + w, y0 + h], [x0, y0 + h], [x0, y0 + 3]]); g.mark(x0, y0, w, 1);
    for(let x=x0 + 1.5;x<x0 + w - 1;x+=2.5) for(let y=y0 + 2;y<y0 + h - 2;y+=3.5) put('server_rack', x, y, 0, false, vIdx('server_rack', g.rnd() < 0.7 ? /Обледен/ : /Разбит/));
    scatter(g, put, [['cryo_pod', 4, 8], ['terminal', 1, 3], ['electric_panel', 1, 2], ['generator', 1, 1], ['corpse', 0.5, 1], ['crystal_growth', 1, 2]], Math.round(cols*rows/90));
    scatter(g, put, [['boulder', 2, 5], ['rocks_scatter', 2, 4]], Math.round(cols*rows/200)); return {x:cx, y:Math.max(1, y0 - 1.5)}; };

  /* ---------- таблицы препятствий Равнины ----------
     [название, сборщик, параметры, заметка Мастеру]. Номер строки — индекс + 1. */
  const PT = [
    [ // №1
      ['Разлом, впадина или древний кратер', 'chasm', {alt:'crater'}, 'Путь преграждает разлом, впадина, возвышение или древний кратер шириной 2×20 м — обойти или найти переправу.'],
      ['Озеро технических отходов', 'lake', {liq:'acid'}, 'Кислотность −15.'],
      ['Место подземного жара', 'hot', {}, 'Духота и жар: кто не преуспеет в Броске выносливости (−3) или не выпьет воды на дневную норму (проверка питания), получает истощение.'],
      ['Развалины древних построек', 'ruins', {}, 'Столкнуться с к6 Препятствиями руин (с. 307).'],
      ['Грузовой аэрокар', 'wreck', {obj:'aerocar', haz:'psi'}, 'Груз — стержни бериллиевой бронзы. Местность — Вредность (пси-поле) −3.'],
      ['Поле минеральных «сосулек»', 'field', {obj:'mineral_spikes'}, 'Острые минеральные наросты растут прямо из земли.'],
      ['Медный рудник', 'pit', {mine:true, ore:'copper', haz:'chem'}, 'Окружающая Вредность (химия) −9.'],
      ['Комплекс радиотелескопов', 'complex', {core:'dishes'}, 'Опасное аварийное состояние конструкций.'],
      ['Зона повышенной радиации', 'radzone', {}, 'Вредность (радиация) −9.'],
      ['Поле сражения Великой войны', 'battle', {haz:'psi'}, 'Вредность (пси) −6.'],
      ['Неосторожный проводник', 'plain', {event:'ambush'}, 'Группа проходит дополнительную случайную встречу (с. 317). Разумный противник может устроить засаду.'],
      ['Зона со случайным искажением', 'anomaly', {}, 'Случайное искажение (с. 240).'],
    ],
    [ // №2
      ['Крутой спуск по битому бетону', 'slope', {mat:'concrete'}, 'Каждый провалившийся при спуске получает 1 рану, первый провалившийся с Невзгодами на к6 дней — травму голеностопа.'],
      ['Водоём, ставший болотом', 'swamp', {liq:'acid'}, 'Кислотность −9.'],
      ['Лопнувшие биохранилища', 'bio', {}, 'Споры: провал Броска путника на Равнине — споры в пище, понос на 2 суток (двойной расход воды или истощение).'],
      ['Промзона', 'ruins', {industrial:true}, 'Промзона с к6 Препятствиями руин (с. 307).'],
      ['Комплекс многоэтажек', 'towers', {haz:'rad'}, 'Вихревые потоки радиоактивной пыли — Вредность (радиация) −9.'],
      ['Руины утилизатора', 'utilizer', {haz:'chem'}, 'Вредность (химия) −6.'],
      ['Сложный подъём', 'slope', {mat:'rock', up:true}, 'Истощение каждому, кто провалит связанную с восхождением проверку.'],
      ['Корпуса над завалами', 'towers', {climb:true}, 'Альпинизм и продвижение сквозь окна.'],
      ['Залитые грунтовыми водами скважины', 'wells', {}, 'Кислотность −9.'],
      ['Кристаллический древний лес', 'field', {obj:'crystal_tree', haz:'rad'}, 'Вредность (радиация) −12.'],
      ['Плавильные печи под охраной', 'complex', {core:'furnaces', guard:true}, 'Действующие печи с автоматизированной охраной.'],
      ['Комплекс тахионного циклотрона', 'complex', {core:'cyclotron', anom:true}, 'Зона искривления времени.'],
    ],
    [ // №3
      ['Изрытый кратерами солончак', 'craters', {salt:true}, 'Персонаж с наименьшим значением путника — Бросок рефлексов (−6); провал — вывих голеностопа на к6 дней.'],
      ['Глинистое зловонное болото', 'swamp', {clay:true}, 'Групповая проверка восприятия — безопасный маршрут; иначе почва с кислотностью −9.'],
      ['Обломки ржавых труб', 'utilizer', {pipes:true, haz:'acid'}, 'Капающая жидкость — кислотность −6; если рюкзак не выдержит, портится рацион воды или еда.'],
      ['Баржа посреди солончака', 'wreck', {obj:'barge', salt:true, haz:'chem'}, 'Вредность (химия) −6.'],
      ['Сыпучий склон', 'slope', {mat:'sand'}, 'Бросок выносливости (−3); провал — истощение.'],
      ['Жар из-под земли', 'hot', {dry:true}, 'Бросок выносливости (−3); провал — истощение или проверка питания (её провал расходует 1 рацион воды).'],
      ['Раскалённая почва, снопы искр', 'hot', {sparks:true}, 'Бросок внимательности или смекалки; провал — пороховые патроны в рюкзаке начинают взрываться.'],
      ['Ветер с песком', 'plain', {dunes:true}, 'Перед боем — Бросок путника или навыка боя; провал — пороховое оружие засорилось, пока его не прочистят.'],
      ['Утомительный переход', 'plain', {camp:true}, 'Бросок путника (−3); провал — кровавые мозоли на к6 дней и спасбросок от болезни.'],
      ['Ночь на крысином мясе', 'plain', {rats:true}, 'Отдохнув, все проходят спасбросок от болезни.'],
      ['Испорченные заряды', 'plain', {gear:true}, 'Персонаж с наибольшим запасом зарядов — Бросок путника или лёгкого оружия; провал — к6 зарядов испорчено.'],
      ['Мост с заставой дикарей', 'bridge', {outpost:true}, 'Застава берёт плату (200 кредитов с человека); племя контролирует 20 км вокруг.'],
    ],
    [ // №4
      ['Поле тёмных монолитов', 'field', {obj:'monolith', haz:'rad'}, 'Вредность (радиация) −12.'],
      ['Гравитационный разлом с кольцами', 'chasm', {rings:true, wide:true, glow:true, nobridge:true}, 'С висящих колец раз в пару часов рушится деталь.'],
      ['Лес Гигантов', 'field', {obj:'pipe_forest', camp:true}, 'Групповая проверка смекалки или лёгкой атлетики.'],
      ['Туша корабля-ковчега', 'wreck', {obj:'ship_hull', haz:'rad'}, 'Вредность (радиация) −6 раз в минуту; дроны атакуют всех без древних ДНК-маркеров.'],
      ['Кратер из вулканического стекла', 'crater', {glass:true, center:'psi', big:true, finds:true}, 'Подъём по краю: Бросок атлетики, провал — 1 рана (на 15− — кровотечение). В центре — Вредность (пси-поле) −3, к6 ценных Находок.'],
      ['Колоссальный карьер', 'pit', {liq:'acid', rings:true, haz:'chem'}, 'Щелочные смеси: кислотность −9, Вредность (химия) −6 раз в 15 минут.'],
      ['Заброшенный док', 'docks', {}, 'Шатающиеся конструкции (попадания с МУ 12 удар); Вредность (болезнь) −6.'],
      ['Застывшая жидкость', 'field', {obj:'polyhedron', frozen:true}, 'Перелезть — Бросок атлетики, провал — к6 ран; первый сорвавшийся с Невзгодами — травма ноги.'],
      ['Свалка доведённых роботов', 'field', {obj:'robot_wreck'}, 'Бросок рефлексов; провал — к6 попаданий с МУ 8 удар, первый провалившийся — растяжение связок.'],
      ['Вантовый мост над руслом', 'bridge', {haz:'rad'}, 'Ржавые балки и мусор; русло — Вредность (радиация) −12.'],
      ['Красное медное озеро', 'lake', {liq:'rustwater', copper:true, blocks:true}, 'Островки — Бросок смекалки или восприятия, затем атлетика; провал — кислотность −9.'],
      ['Саркофаг исследовательской станции', 'complex', {core:'sarcophagus', mines:true}, 'Минные поля; внутри — техно-демон-страж (с. 291).'],
    ],
    [ // №5
      ['Гидропонные теплицы', 'greenhouse', {cult:true}, 'Кислотность −6; в теплицах — община культистов-гумоидов.'],
      ['Разрушенный подземный город', 'ruins', {under:true}, 'Пересечь — к6+1 Препятствий руин (с. 307).'],
      ['Груз биоматериалов', 'bio', {web:true}, 'Биом с паутиной: на 1 из к6 съедобен, иначе ядовит — Вредность (болезнь) −15.'],
      ['Крио-низина', 'cryo', {}, 'Низкие температуры (с. 223).'],
      ['Зона пси-оборудования', 'complex', {core:'psi', haz:'psi'}, 'Каждую минуту — спасбросок; провал — смекалка временно −1.'],
      ['Фабрика синтетиков', 'ruins', {factory:true}, 'Пересечь — к6+1 Препятствий руин; в цехах прячется синтетик-убийца.'],
      ['Ускоритель частиц', 'complex', {core:'accel', anom:true}, 'Хаотичный лабиринт межпространственных переходов.'],
      ['Дом, рухнувший в ущелье', 'chasm', {ruin:true, plank:true, broken:true}, 'Сорвавшийся с Невзгодами получает травму (к6: 1–2 кисть, 3–4 ведущая рука, 5–6 нога).'],
      ['Разрушенная АЭС', 'complex', {core:'nuclear', haz:'rad'}, 'Вредность (радиация) −9 раз в сцену.'],
      ['Антигравитационный поезд', 'wreck', {obj:'antigrav_car', anom:true}, 'Групповая проверка смекалки или восприятия, затем Бросок силы; провал — попадание с МУ 13 удар, раны 2.'],
      ['Сад многогранников', 'field', {obj:'polyhedron', guards:true}, 'Гумоиды-колоссы (с. 291) охраняют сад.'],
      ['Кладбище синтетических животных', 'field', {obj:'robot_wreck', bones:true, anom:true}, 'Шум будит электрическую жизнь; можно сделать Преградой.'],
    ],
    [ // №6 (к6)
      ['Мыслеспам со спутника', 'wreck', {obj:'satellite', ads:true}, 'Каждую минуту — Бросок воли или смекалки, иначе ошеломлён на час; спасает защита головы от энергии 9+.'],
      ['Свалка автокаров у кратера', 'craters', {cars:true, haz:'rad'}, 'Вредность (радиация) −12.'],
      ['Аномальный биом санатория', 'anomaly', {sanatorium:true}, 'Реплики личностей пациентов и биосинтетический материал.'],
      ['Геотермальный генератор', 'hot', {lightning:true}, 'Бросок лёгкой атлетики или смекалки; провал — попадание с МУ 17 энергия, раны 2к6, травма.'],
      ['Военный завод', 'complex', {core:'factory', guard:true}, 'Стражи атакуют всех без ДНК-маркера сотрудников; внутри — многомерные инструменты.'],
      ['Каньон с тросами орбитального лифта', 'chasm', {canyon:true, cables:true, plank:true, haz:'psi'}, 'Вредность (пси) −3.'],
    ],
  ];
  const siteOf = (id)=>{ const m = /^t([1-6])_(\d{1,2})$/.exec(id || ''); if(!m) return null; const t = +m[1], r = +m[2], row = PT[t - 1] && PT[t - 1][r - 1]; return row ? {t, r, row} : null; };
  function plains(doc, opts){
    opts = opts || {}; const g = ctx(doc, opts.seed); g.opts = Object.assign({}, opts); const put = mkPut(g, {state:'ruined'});
    let site = siteOf(opts.site), rolled = null; if(!site){ const t = g.ri(1, 6), r = g.ri(1, t===6 ? 6 : 12); site = siteOf('t' + t + '_' + r); rolled = {t, r}; }
    const [name, bid, P0, note] = site.row, P = Object.assign({}, P0); let builder = bid;
    if(P.alt && g.rnd() < 0.5) builder = P.alt; // разлом или кратер — по зерну
    doc.gen = {id:'plains', seed:g.seed, opts:{site:opts.site || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal'}, parts:[]};
    const parts = doc.gen.parts, tp = B[builder](g, put, P, parts) || {x:doc.cols/2, y:1.2};
    if(builder!=='complex' && builder!=='utilizer' && builder!=='towers' && builder!=='bridge') hazard(g, put, P.haz, null);
    if(g.opts.theme){ doc.gen.opts.theme = g.opts.theme; doc.gen.opts.ruin = g.opts.ruin || 'normal'; } // перегенерация здания — из той же темы
    const roll = `Таблица №${site.t}, ${site.t===6 ? 'к6' : 'к12'} = ${site.r}`;
    doc.gen.title = {x:tp.x, y:tp.y, text:name};
    doc.gen.note = {title:'Препятствие Равнины: ' + name, text:(rolled ? 'Бросок: к6 = ' + site.t + ' (таблица), ' + (site.t===6 ? 'к6' : 'к12') + ' = ' + site.r + '. ' : roll + '. ') + note};
    return {site, rolled};
  }

  /* ---------- промзона / завод ---------- */
  const PROFILES = {metal:{name:'металлургический', yard:[['slag_pool', 3, 5], ['chimney', 2, 3], ['conveyor', 2, 4], ['crane_beam', 1, 2], ['scrap_pile', 2, 4]], terr:'ash'},
    chem:{name:'химический', yard:[['tank_big', 3, 6], ['tank_horiz', 2, 4], ['pipe_rack', 2, 4], ['barrel_toxic', 3, 6], ['toxic_puddle', 2, 4], ['valve', 2, 4]], terr:'toxic', pond:'toxic'},
    energy:{name:'энергетический', yard:[['transformer', 3, 6], ['power_pylon', 3, 6], ['cooling_tower', 1, 1], ['generator', 2, 4], ['solar_panels', 1, 3], ['electric_panel', 2, 4]], terr:'gravel'},
    depot:{name:'складской', yard:[['container_stack', 3, 6], ['shipping_container', 2, 5], ['pallet', 3, 6], ['crate_wood', 2, 5], ['silo', 1, 3], ['gantry_crane', 0.6, 1]], terr:'concrete'}};
  function industry(doc, opts){
    opts = opts || {}; const g = ctx(doc, opts.seed); const {cols, rows} = doc;
    const prof = PROFILES[opts.profile] ? opts.profile : g.pick(Object.keys(PROFILES)), PR = PROFILES[prof];
    const state = ['abandoned', 'captured', 'working'].indexOf(opts.state) >= 0 ? opts.state : g.pick(['abandoned', 'abandoned', 'captured', 'working']);
    const fence = ['fence', 'wall', 'none'].indexOf(opts.fence) >= 0 ? opts.fence : g.pick(['fence', 'wall', 'fence', 'none']);
    g.opts = Object.assign({}, opts, {theme:'factory', ruin:state==='abandoned' ? 'high' : 'low'});
    const put = mkPut(g, state==='working' ? {state:'intact'} : {state:'ruined', prefer:state==='abandoned' ? /ржав|брош|пуст|выключ|Ржав/i : null});
    land(g, 'concrete', [['cracked', 0.62, 1], [PR.terr, 0, 0.12], ['gravel', 0.86, 1, 1]].filter(m=>MapFormat.T_INDEX[m[0]] != null));
    doc.gen = {id:'industry', seed:g.seed, opts:{profile:opts.profile || 'random', state:opts.state || 'random', fence:opts.fence || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal', theme:'factory', ruin:g.opts.ruin}, parts:[]};
    const parts = doc.gen.parts, gate = g.ri(0, 3), x0 = 1, y0 = 1, x1 = cols - 1, y1 = rows - 1;
    const gp = fence==='none' ? [gate===1 ? x1 : gate===3 ? x0 : cols/2, gate===0 ? y0 : gate===2 ? y1 : rows/2] : fenceRect(g, x0, y0, x1, y1, fence==='wall' ? 'concrete' : 'fence', gate, 4);
    if(fence!=='none') put(state==='working' ? 'checkpoint' : 'gate_metal', gp[0], gp[1], gate%2 ? 90 : 0, true);
    // дороги: от ворот насквозь и одна-две поперечные
    const horiz = gate%2===1, main = horiz ? [[x0, gp[1]], [x1, gp[1] + g.R(-3, 3)]] : [[gp[0], y0], [gp[0] + g.R(-3, 3), y1]];
    const roads = [main]; for(let i=0;i<g.ri(1, 2);i++){ const t = 0.3 + i*0.4 + g.R(-0.08, 0.08); roads.push(horiz ? [[x0 + (x1 - x0)*t, y0], [x0 + (x1 - x0)*t + g.R(-2, 2), y1]] : [[x0, y0 + (y1 - y0)*t], [x1, y0 + (y1 - y0)*t + g.R(-2, 2)]]); }
    roads.forEach(r=>{ g.path('road', 3, r2(r)); each(g, (x, y, px, py)=>{ if(segDist(px, py, r[0][0], r[0][1], r[1][0], r[1][1]) < 2.3){ g.occ[y*cols + x] = 1; if(segDist(px, py, r[0][0], r[0][1], r[1][0], r[1][1]) < 1.6) g.setT(x, y, 'asphalt'); } }); });
    // ж/д ветка вдоль одной стороны
    if(rows > 24 && cols > 24 && g.rnd() < 0.7){ const ry = horiz ? y1 - 3 : null, rx = horiz ? null : x1 - 3; const rp = horiz ? [[x0, ry], [x1, ry]] : [[rx, y0], [rx, y1]]; g.path('rail', 1.4, r2(rp)); each(g, (x, y, px, py)=>{ if(segDist(px, py, rp[0][0], rp[0][1], rp[1][0], rp[1][1]) < 1.2) g.occ[y*cols + x] = 1; });
      for(let i=0;i<g.ri(1, 3);i++){ const t = g.R(0.15, 0.8); put('metro_car', horiz ? x0 + (x1 - x0)*t : rx, horiz ? ry : y0 + (y1 - y0)*t, horiz ? 90 : 0, true, null); } }
    // цеха и службы
    const want = Math.max(2, Math.round(cols*rows/380)); let fails = 0;
    for(let t=0;t<80 && parts.length < want && fails < 30;t++){ const bx = g.ri(x0 + 1, Math.max(x0 + 1, x1 - 13)), by = g.ri(y0 + 1, Math.max(y0 + 1, y1 - 11)), lot = [bx, by, Math.min(x1 - 1, bx + 14), Math.min(y1 - 1, by + 12)];
      const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, parts.length===0 ? 'factory_hall' : null); if(b){ const pt = GK.partOf(b, lot); if(state==='working') delete pt.st; parts.push(pt); } else fails++; }
    // двор по профилю
    scatter(g, put, PR.yard, Math.round(cols*rows/110)); scatter(g, put, [['pipe_rack', 1, 3], ['pipe_straight', 2, 4], ['barrels_group', 2, 4], ['lamp_post', 2, 6], ['crate_metal', 1, 4], ['power_pylon', 1, 2]], Math.round(cols*rows/160));
    if(PR.pond){ const px = g.R(cols*0.2, cols*0.8), py = g.R(rows*0.2, rows*0.8), f = blob(g, px, py, 4, 3, 0.3); each(g, (x, y, qx, qy)=>{ if(f(qx, qy) < 1 && !g.occ[y*cols + x]){ g.setT(x, y, PR.pond); g.occ[y*cols + x] = 1; } }); }
    if(state==='abandoned'){ const nz = g.noise(3, g.ri(1, 999)); each(g, (x, y)=>{ if(!g.occ[y*cols + x] && nz(x, y) > 0.72) g.setT(x, y, 'grass'); }); scatter(g, put, [['dry_bush', 3, 8], ['dead_tree', 1, 3], ['rubble_pile', 2, 5], ['car_wreck', 1, 3]], Math.round(cols*rows/150)); }
    if(state==='captured'){ put('barricade_car', gp[0] + (gate===1 ? -4 : gate===3 ? 4 : 0), gp[1] + (gate===0 ? 4 : gate===2 ? -4 : 0), gate%2 ? 90 : 0, true); scatter(g, put, [['oil_drum_fire', 3, 5], ['skull_totem', 1, 3], ['banner', 1, 2], ['scrap_tower', 1, 2], ['sleeping_bag', 2, 4], ['buggy', 1, 2], ['tire_stack', 2, 4]], Math.round(cols*rows/120)); }
    if(state==='working') scatter(g, put, [['turret', 2, 4], ['searchlight', 2, 4], ['watchtower', 1, 2]], 6, (x, y)=>x < 6 || y < 6 || x > cols - 6 || y > rows - 6);
    const nm = g.pick(['«Красный молот»', '«Прогресс-7»', '«Заря»', '«Сталь Равнины»', '«Химпром-3»', '«Северный»', '«Гиперион»']);
    doc.gen.title = {x:cols/2, y:1.6, text:'Завод ' + nm + (state==='abandoned' ? ' (заброшен)' : state==='captured' ? ' (захвачен)' : '')};
    doc.gen.note = {title:'Промзона: ' + PR.name + ' завод', text:'Состояние: ' + (state==='abandoned' ? 'заброшен' : state==='captured' ? 'захвачен бандой' : 'работает, охраняется') + '. Ограда: ' + (fence==='wall' ? 'бетонная стена' : fence==='fence' ? 'сетка' : 'нет') + '.'};
  }

  /* ---------- пещеры / шахта / карьер ---------- */
  function caves(doc, opts){
    opts = opts || {}; const g = ctx(doc, opts.seed); g.opts = Object.assign({}, opts); const {cols, rows} = doc;
    const mode = ['cave', 'mine', 'quarry'].indexOf(opts.mode) >= 0 ? opts.mode : g.pick(['cave', 'cave', 'mine', 'quarry']);
    const state = ['wild', 'infested', 'worked'].indexOf(opts.state) >= 0 ? opts.state : g.pick(['wild', 'infested', 'worked']);
    const ore = ['none', 'copper', 'iron', 'crystal'].indexOf(opts.ore) >= 0 ? opts.ore : g.pick(['none', 'copper', 'crystal', 'iron']);
    doc.gen = {id:'caves', seed:g.seed, opts:{mode:opts.mode || 'random', state:opts.state || 'random', ore:opts.ore || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal'}, parts:[]};
    const put = mkPut(g, {state:state==='worked' ? 'intact' : 'ruined'}), oreV = ore==='copper' ? /Медь/ : ore==='iron' ? /Железо/ : ore==='crystal' ? /кристаллы/ : null;
    if(mode==='quarry'){ B.pit(g, put, {liq:g.rnd() < 0.5 ? 'water' : 'acid', rings:true, ore:ore==='copper' ? 'copper' : null}, doc.gen.parts); Object.assign(doc.gen.opts, {theme:'industry', ruin:'high'});
      if(state==='worked') scatter(g, put, [['excavator', 1, 2], ['dump_truck', 1, 2], ['lamp_post', 2, 4], ['generator', 1, 2]], 6); if(state==='infested') scatter(g, put, [['web_mass', 2, 4], ['bone_pile', 2, 4], ['cocoon', 1, 3]], 6);
      doc.gen.title = {x:cols/2, y:1.2, text:'Карьер'}; doc.gen.note = {title:'Карьер', text:'Уступы — скальные стенки, спуск по серпантину; на дне — вода.'}; return; }
    GK.reset(doc, 'bedrock'); const floor = new Uint8Array(cols*rows), F = (x, y)=>x >= 0 && y >= 0 && x < cols && y < rows && floor[y*cols + x];
    const chambers = [];
    if(mode==='cave'){ // клеточный автомат + связность
      for(let y=1;y<rows - 1;y++) for(let x=1;x<cols - 1;x++) floor[y*cols + x] = g.rnd() < 0.53 ? 1 : 0;
      for(let it=0;it<5;it++){ const nx = floor.slice(); for(let y=1;y<rows - 1;y++) for(let x=1;x<cols - 1;x++){ let n = 0; for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if(dx || dy) n += floor[(y + dy)*cols + x + dx] ? 1 : 0; nx[y*cols + x] = n >= 5 ? 1 : n <= 3 ? 0 : floor[y*cols + x]; } floor.set(nx); }
      // области: оставить крупные, соединить ходами с главной
      const lab = new Int32Array(cols*rows).fill(-1), regs = []; for(let i=0;i<cols*rows;i++){ if(!floor[i] || lab[i] >= 0) continue; const st = [i], cells = []; lab[i] = regs.length; while(st.length){ const c = st.pop(); cells.push(c); const x = c%cols, y = (c - x)/cols; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy])=>{ const q = (y + dy)*cols + x + dx; if(F(x + dx, y + dy) && lab[q] < 0){ lab[q] = regs.length; st.push(q); } }); } regs.push(cells); }
      regs.sort((a, b)=>b.length - a.length); regs.forEach((r, i)=>{ if(r.length < 12){ r.forEach(c=>{ floor[c] = 0; }); return; } if(i===0) return; const a = r[Math.floor(g.rnd()*r.length)], b = regs[0][Math.floor(g.rnd()*regs[0].length)]; let x = a%cols, y = (a - x)/cols; const tx = b%cols, ty = (b - tx)/cols; let k = 0;
        while((x!==tx || y!==ty) && k++ < 400){ if(g.rnd() < 0.5) x += Math.sign(tx - x); else y += Math.sign(ty - y); for(let dy=0;dy<=1;dy++) for(let dx=0;dx<=1;dx++) if(x + dx < cols - 1 && y + dy < rows - 1) floor[(y + dy)*cols + x + dx] = 1; } });
      // крупные полости — «залы»
      for(let t=0;t<40 && chambers.length < Math.max(2, Math.round(cols*rows/350));t++){ const x = g.ri(2, cols - 8), y = g.ri(2, rows - 7), w = g.ri(4, 7), h = g.ri(4, 6); let ok = 0; for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) ok += F(i, j) ? 1 : 0; if(ok >= w*h*0.85 && !chambers.some(c=>Math.abs(c.x - x) < 8 && Math.abs(c.y - y) < 7)) chambers.push({x, y, w, h}); } }
    else { // шахта: штреки под прямым углом, камеры
      const carve = (x0, y0, x1, y1, w)=>{ for(let y=Math.min(y0, y1);y<=Math.max(y0, y1) + w - 1;y++) for(let x=Math.min(x0, x1);x<=Math.max(x0, x1) + w - 1;x++) if(x > 0 && y > 0 && x < cols - 1 && y < rows - 1) floor[y*cols + x] = 1; };
      const horiz = cols >= rows, my = Math.round(rows/2), mx = Math.round(cols/2); if(horiz) carve(1, my, cols - 3, my, 2); else carve(mx, 1, mx, rows - 3, 2);
      const drifts = []; for(let t=6;t<(horiz ? cols : rows) - 6;t+=g.ri(7, 10)){ const len = g.ri(4, Math.max(5, Math.round((horiz ? rows : cols)/2 - 4))), sd = g.rnd() < 0.5 ? -1 : 1;
        if(horiz){ const y1 = my + sd*len; carve(t, my, t, y1, 2); drifts.push([t, y1]); } else { const x1 = mx + sd*len; carve(mx, t, x1, t, 2); drifts.push([x1, t]); } }
      drifts.forEach(([x, y])=>{ if(g.rnd() < 0.75){ const w = g.ri(4, 6), h = g.ri(4, 5), cx = Math.max(1, Math.min(cols - w - 1, x - Math.floor(w/2))), cy = Math.max(1, Math.min(rows - h - 1, y - Math.floor(h/2))); carve(cx, cy, cx + w - 2, cy + h - 2, 2); chambers.push({x:cx, y:cy, w, h}); } });
      g.path('rail', 1, r2(horiz ? [[1, my + 1], [cols - 2, my + 1]] : [[mx + 1, 1], [mx + 1, rows - 2]])); }
    // вход — от края карты
    const ent = (()=>{ for(let t=0;t<200;t++){ const side = g.ri(0, 3), x = side===1 ? cols - 2 : side===3 ? 1 : g.ri(2, cols - 3), y = side===0 ? 1 : side===2 ? rows - 2 : g.ri(2, rows - 3); for(let d=0;d<Math.max(cols, rows);d++){ const px = side===1 ? x - d : side===3 ? x + d : x, py = side===0 ? y + d : side===2 ? y - d : y; if(F(px, py)) return {side, x, y, px, py}; } } return null; })();
    if(ent){ for(let d=0;;d++){ const px = ent.side===1 ? ent.x + 1 - d : ent.side===3 ? ent.x - 1 + d : ent.x, py = ent.side===0 ? ent.y - 1 + d : ent.side===2 ? ent.y + 1 - d : ent.y; if(px < 0 || py < 0 || px >= cols || py >= rows) break; if(F(px, py) && d > 1) break; floor[py*cols + px] = 1; if(ent.side%2===0 && px + 1 < cols) floor[py*cols + px + 1] = 1; else if(py + 1 < rows) floor[(py + 1)*cols + px] = 1; } }
    for(let i=0;i<cols*rows;i++){ if(floor[i]){ doc.terrain[i] = MapFormat.T_INDEX[mode==='mine' && g.nz(i%cols, Math.floor(i/cols)) > 0.68 ? 'gravel' : 'cave']; } else g.occ[i] = 1; }
    GK.wallsFromMask(g, floor, 'rock');
    // вода: подземное озеро в одном зале / затопленная камера
    if(chambers.length && g.rnd() < 0.7){ const c = g.pick(chambers); for(let y=c.y + 1;y<c.y + c.h - 1;y++) for(let x=c.x + 1;x<c.x + c.w - 1;x++) if(F(x, y) && g.rnd() < 0.85){ g.setT(x, y, 'water'); g.occ[y*cols + x] = 1; } c.water = true; }
    const inF = (x, y)=>F(Math.floor(x), Math.floor(y));
    const nearWall = (x, y)=>{ const cx2 = Math.floor(x), cy2 = Math.floor(y); return F(cx2, cy2) && (!F(cx2 + 1, cy2) || !F(cx2 - 1, cy2) || !F(cx2, cy2 + 1) || !F(cx2, cy2 - 1)); };
    if(oreV) for(let i=0;i<Math.round(cols*rows/160);i++){ const x = g.R(1, cols - 1), y = g.R(1, rows - 1); if(nearWall(x, y)) put('ore_vein', x, y, g.rnd()*360, true, vIdx('ore_vein', oreV)); }
    const list = mode==='mine' ? [['mine_props', 6, 16], ['mine_cart', 2, 5], ['crate_wood', 2, 5], ['lamp', 2, 6], ['barrel', 1, 3], ['rubble_pile', 2, 5], ['electric_panel', 1, 2], ['workbench', 1, 2], ['generator', 0.6, 1]]
      : [['stalagmites', 5, 12], ['rocks_scatter', 3, 6], ['boulder', 2, 6], ['glow_mushrooms', 3, 8], ['crystal_growth', ore==='crystal' ? 3 : 1, 4], ['bone_pile', 1, 3], ['puddle', 1, 3]];
    scatter(g, put, list, Math.round(cols*rows/45), inF);
    if(mode==='mine'){ put('stairs_down', ent ? ent.px + 0.5 : cols/2, ent ? ent.py + 0.5 : rows/2, 0, true); }
    if(state==='infested') scatter(g, put, [['web_mass', 3, 8], ['cocoon', 2, 5], ['bone_pile', 2, 5], ['blood', 2, 4], ['corpse', 1, 3]], Math.round(cols*rows/90), inF);
    if(state==='worked') scatter(g, put, [['lamp', 3, 8], ['sleeping_bag', 1, 3], ['campfire', 1, 2], ['crate_metal', 1, 3], ['radio', 0.6, 1]], Math.round(cols*rows/140), inF);
    chambers.forEach(c=>{ if(c.water) return; const rm = {x:c.x, y:c.y, w:c.w, h:c.h, role:'storage', entries:[]}; if(g.rnd() < (opts.scenes==='none' ? 0 : opts.scenes==='many' ? 0.8 : 0.45)) GK.placeScene(g, rm); }); // мини-сцены в залах
    doc.gen.title = {x:cols/2, y:1.2, text:mode==='mine' ? 'Заброшенная шахта' : 'Пещеры'};
    doc.gen.note = {title:mode==='mine' ? 'Шахта' : 'Пещеры', text:(state==='infested' ? 'Логово: паутина, коконы, кости. ' : state==='worked' ? 'Обжито: лампы, ночлег. ' : '') + (ore!=='none' ? 'Жилы: ' + {copper:'медь', iron:'железо', crystal:'кристаллы'}[ore] + '.' : '')};
  }

  /* ---------- трасса через пустошь ---------- */
  function highway(doc, opts){
    opts = opts || {}; const g = ctx(doc, opts.seed); const {cols, rows} = doc;
    const ev = ['pileup', 'ambush', 'checkpoint', 'quiet'].indexOf(opts.events) >= 0 ? opts.events : g.pick(['pileup', 'ambush', 'checkpoint', 'quiet', 'pileup']);
    const rs = ['gas', 'motel', 'diner', 'none'].indexOf(opts.roadside) >= 0 ? opts.roadside : g.pick(['gas', 'motel', 'diner', 'gas', 'none']);
    const ld = ['desert', 'plains', 'ruins'].indexOf(opts.land) >= 0 ? opts.land : g.pick(['desert', 'plains', 'plains', 'ruins']);
    g.opts = Object.assign({}, opts, {theme:'road', ruin:'high'}); const put = mkPut(g, {state:'ruined'});
    land(g, ld==='desert' ? 'sand' : 'dust', ld==='desert' ? [['dust', 0.68, 1], ['saltflat', 0, 0.12]] : ld==='ruins' ? [['cracked', 0.62, 1], ['gravel', 0, 0.2], ['grass', 0.85, 1, 1]] : [['grass', 0, 0.28], ['gravel', 0.66, 1], ['dirt', 0.85, 1, 1]]);
    doc.gen = {id:'highway', seed:g.seed, opts:{events:opts.events || 'random', roadside:opts.roadside || 'random', land:opts.land || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal', theme:'road', ruin:'high'}, parts:[]};
    const horiz = cols >= rows, road = crossLine(g, horiz, 2), W = 5; g.path('highway', W, r2(road));
    each(g, (x, y, px, py)=>{ const d = lineDist(road, px, py); if(d < W/2 + 0.6){ g.occ[y*cols + x] = 1; g.setT(x, y, 'asphalt'); } else if(d < W/2 + 1.6 && g.nz(x, y) < 0.6) g.setT(x, y, 'gravel'); });
    // обочина: столбы, знаки, щиты
    const L = pointAt(road, 0).len; for(let s=g.ri(3, 6);s<L;s+=g.ri(8, 13)){ const q = pointAt(road, s/L), sd = g.rnd() < 0.5 ? 1 : -1, d = W/2 + 1.6; put(g.pick(['lamp_post', 'road_sign', 'lamp_post', 'power_pylon']), q.x - Math.sin(q.a)*d*sd, q.y + Math.cos(q.a)*d*sd, q.a*180/Math.PI); }
    for(let i=0;i<g.ri(1, 2);i++){ const q = pointAt(road, g.R(0.1, 0.9)), sd = g.rnd() < 0.5 ? 1 : -1, d = W/2 + 4; put('road_billboard', q.x - Math.sin(q.a)*d*sd, q.y + Math.cos(q.a)*d*sd, q.a*180/Math.PI); }
    // съезд к придорожному месту
    const q0 = pointAt(road, g.R(0.25, 0.4)), side = g.rnd() < 0.5 ? 1 : -1, nx = -Math.sin(q0.a)*side, ny = Math.cos(q0.a)*side, sx = q0.x + nx*(W/2 + 8), sy = q0.y + ny*(W/2 + 8);
    if(rs!=='none'){ g.path('road', 3, r2([[q0.x + nx*W/2, q0.y + ny*W/2], [sx, sy]]));
      if(rs==='gas'){ put('gas_station', sx, sy, q0.a*180/Math.PI, true); for(let i=0;i<2;i++) put('fuel_pump', sx + Math.cos(q0.a)*(i*2 - 1)*1.6 - nx*3.2, sy + Math.sin(q0.a)*(i*2 - 1)*1.6 - ny*3.2, q0.a*180/Math.PI); }
      const lot = [Math.max(0, Math.round(sx - 8)), Math.max(0, Math.round(sy - 7)), Math.min(cols, Math.round(sx + 8)), Math.min(rows, Math.round(sy + 7))];
      if(rs!=='gas' || g.rnd() < 0.6){ const front = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 3 : 1) : (ny > 0 ? 0 : 2); const b = GK.building(g, lot[0], lot[1], lot[2], lot[3], undefined, front, rs==='gas' ? 'diner' : rs); if(b) doc.gen.parts.push(GK.partOf(b, lot)); }
      put('parking', sx - nx*2 + Math.cos(q0.a)*5, sy - ny*2 + Math.sin(q0.a)*5, q0.a*180/Math.PI, false); }
    // событие
    const qe = pointAt(road, g.R(0.55, 0.75));
    if(ev==='pileup'){ for(let i=0;i<g.ri(7, 12);i++){ const t = qe.len ? g.R(-9, 9)/qe.len : 0, q = pointAt(road, Math.max(0.02, Math.min(0.98, (qe.len*g.R(0.5, 0.82))/qe.len + t))), lat = g.R(-W/2 + 0.6, W/2 - 0.6); put(g.pick(['car_wreck', 'car_wreck', 'car_burnt', 'semi_truck', 'bus_wreck', 'pickup_rust']), q.x - Math.sin(q.a)*lat, q.y + Math.cos(q.a)*lat, q.a*180/Math.PI + 90 + g.R(-50, 50), true); } scatter(g, put, [['corpse', 1, 3], ['trash', 2, 5], ['oil_drum_fire', 0.5, 1]], 5, (x, y)=>lineDist(road, x, y) < W); }
    if(ev==='ambush'){ put('barricade_car', qe.x, qe.y, qe.a*180/Math.PI + 90, true); [-1, 1].forEach(s=>{ for(let i=0;i<2;i++) put(g.pick(['rock_big', 'cover_concrete', 'rubble_pile', 'car_wreck', 'sandbags_line']), qe.x - Math.sin(qe.a)*s*g.R(5, 8) + g.R(-4, 4), qe.y + Math.cos(qe.a)*s*g.R(5, 8) + g.R(-4, 4), g.rnd()*360); }); put('tripwire', qe.x - Math.cos(qe.a)*5, qe.y - Math.sin(qe.a)*5, qe.a*180/Math.PI + 90, true); put('car_burnt', qe.x - Math.cos(qe.a)*3, qe.y - Math.sin(qe.a)*3, qe.a*180/Math.PI + 70, true); put('corpse', qe.x + g.R(-3, 3), qe.y + g.R(-3, 3), g.rnd()*360, true); }
    if(ev==='checkpoint'){ put('checkpoint', qe.x, qe.y, qe.a*180/Math.PI + 90, true); [-3, 3].forEach(o=>put('jersey', qe.x + Math.cos(qe.a)*o - Math.sin(qe.a)*(o > 0 ? 1.2 : -1.2), qe.y + Math.sin(qe.a)*o + Math.cos(qe.a)*(o > 0 ? 1.2 : -1.2), qe.a*180/Math.PI + 90, true)); [-1, 1].forEach(s=>{ put('watchtower', qe.x - Math.sin(qe.a)*s*(W/2 + 3), qe.y + Math.cos(qe.a)*s*(W/2 + 3), 0); put('sandbags_arc', qe.x - Math.sin(qe.a)*s*(W/2 + 2) + Math.cos(qe.a)*3, qe.y + Math.cos(qe.a)*s*(W/2 + 2) + Math.sin(qe.a)*3, qe.a*180/Math.PI); }); put('banner', qe.x + Math.cos(qe.a)*5, qe.y + Math.sin(qe.a)*5 + 3, 0); }
    if(ev==='quiet'){ for(let i=0;i<g.ri(1, 3);i++){ const q = pointAt(road, g.rnd()); put(g.pick(['car_wreck', 'pickup_rust', 'semi_truck']), q.x - Math.sin(q.a)*g.R(-1.5, 1.5), q.y + Math.cos(q.a)*g.R(-1.5, 1.5), q.a*180/Math.PI + 90 + g.R(-20, 20), true); } }
    // эстакада над трассой на больших картах
    if(Math.max(cols, rows) >= 40 && g.rnd() < 0.5){ const q = pointAt(road, g.R(0.08, 0.2)); put('bridge', q.x, q.y, q.a*180/Math.PI, true, null); [-1, 1].forEach(s=>put('overpass_pillar', q.x - Math.sin(q.a)*s*(W/2 + 1.5), q.y + Math.cos(q.a)*s*(W/2 + 1.5), 0, true)); }
    scatter(g, put, ld==='ruins' ? [['ruin_house', 1, 3], ['ruin_corner', 2, 4], ['rubble_pile', 3, 6], ['tree_sparse', 1, 3], ['bus_stop', 1, 2]].concat(WILD) : ld==='desert' ? [['dune', 4, 10], ['cactus', 2, 6], ['beast_bones', 0.5, 1], ['rocks_scatter', 1, 3]] : WILD, Math.round(cols*rows/110));
    const title = {pileup:'Затор на трассе', ambush:'Засада на трассе', checkpoint:'Блокпост на трассе', quiet:'Трасса'}[ev];
    doc.gen.title = {x:cols/2, y:1.2, text:title}; doc.gen.note = {title, text:{pileup:'Затор из брошенных машин: проезд — медленно, в обход или растаскивая.', ambush:'Баррикада из машин поперёк дороги, укрытия по обочинам, растяжка на подъезде.', checkpoint:'Блокпост: КПП, бетонные блоки змейкой, вышки по обе стороны.', quiet:'Пустая трасса: редкие брошенные машины.'}[ev]};
  }

  /* ---------- регистрация в списке генераторов ---------- */
  const sel = (name, v, list)=>`<select name="${name}">${list.map(([k, n])=>`<option value="${k}" ${v===k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const esc = (s)=>String(s).replace(/[&<>"]/g, m=>({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[m]));
  const SC = [['none', 'нет'], ['normal', 'обычно'], ['many', 'много']];
  function siteOptions(v){ return `<option value="random" ${!v || v==='random' ? 'selected' : ''}>🎲 Бросить: к6 — таблица, к12 — строка</option>` + PT.map((tb, ti)=>`<optgroup label="Таблица препятствий Равнины №${ti + 1}">${tb.map((row, ri)=>{ const id = 't' + (ti + 1) + '_' + (ri + 1); return `<option value="${id}" ${v===id ? 'selected' : ''}>${ri + 1}. ${esc(row[0])}</option>`; }).join('')}</optgroup>`).join(''); }
  MapGen.register({id:'plains', name:'Препятствие Равнины (по таблицам)', run:(d, o)=>{ const r = plains(d, o); MapGen.applyLabels(d); return r; },
    form:(po)=>`<label class="me-f">Препятствие<select name="site">${siteOptions(po.site)}</select></label><div class="muted me-note">Карта строится под выбранную строку таблицы; бросок и правило — в заметке Мастеру («Свойства» → «Генерация»; игрокам не видна).</div><label class="me-f">Мини-сцены${sel('scenes_plains', po.scenes || 'normal', SC)}</label>`,
    read:(f)=>({site:f.site.value, scenes:f.scenes_plains.value}),
    done:(d, r)=>r && r.rolled ? `Бросок: к6 = ${r.site.t}, ${r.site.t===6 ? 'к6' : 'к12'} = ${r.site.r} — ${r.site.row[0]}` : ''});
  MapGen.register({id:'industry', name:'Промзона / завод', run:(d, o)=>{ industry(d, o); MapGen.applyLabels(d); },
    form:(po)=>`<div class="me-f-row"><label class="me-f">Профиль${sel('profile', po.profile || 'random', [['random', 'случайный'], ['metal', 'металлургия'], ['chem', 'химия'], ['energy', 'энергетика'], ['depot', 'склады']])}</label>
      <label class="me-f">Состояние${sel('istate', po.state || 'random', [['random', 'случайное'], ['abandoned', 'заброшен'], ['captured', 'захвачен бандой'], ['working', 'работает']])}</label></div><div class="me-f-row">
      <label class="me-f">Ограда${sel('fence', po.fence || 'random', [['random', 'случайная'], ['fence', 'сетка'], ['wall', 'бетонная стена'], ['none', 'без ограды']])}</label><label class="me-f">Мини-сцены${sel('scenes_ind', po.scenes || 'normal', SC)}</label></div>`,
    read:(f)=>({profile:f.profile.value, state:f.istate.value, fence:f.fence.value, scenes:f.scenes_ind.value})});
  MapGen.register({id:'caves', name:'Пещеры, шахта, карьер', run:(d, o)=>{ caves(d, o); MapGen.applyLabels(d); },
    form:(po)=>`<div class="me-f-row"><label class="me-f">Что${sel('cmode', po.mode || 'random', [['random', 'случайное'], ['cave', 'пещеры'], ['mine', 'шахта'], ['quarry', 'карьер']])}</label>
      <label class="me-f">Обитатели${sel('cvstate', po.state || 'random', [['random', 'случайно'], ['wild', 'дикие места'], ['infested', 'логово тварей'], ['worked', 'обжито']])}</label></div><div class="me-f-row">
      <label class="me-f">Жилы${sel('ore', po.ore || 'random', [['random', 'случайные'], ['none', 'нет'], ['copper', 'медь'], ['iron', 'железо'], ['crystal', 'кристаллы']])}</label><label class="me-f">Мини-сцены${sel('scenes_cave', po.scenes || 'normal', SC)}</label></div>`,
    read:(f)=>({mode:f.cmode.value, state:f.cvstate.value, ore:f.ore.value, scenes:f.scenes_cave.value})});
  MapGen.register({id:'highway', name:'Трасса через пустошь', run:(d, o)=>{ highway(d, o); MapGen.applyLabels(d); },
    form:(po)=>`<div class="me-f-row"><label class="me-f">Событие${sel('events', po.events || 'random', [['random', 'случайное'], ['pileup', 'затор'], ['ambush', 'засада'], ['checkpoint', 'блокпост'], ['quiet', 'пусто']])}</label>
      <label class="me-f">У дороги${sel('roadside', po.roadside || 'random', [['random', 'случайно'], ['gas', 'заправка'], ['motel', 'мотель'], ['diner', 'закусочная'], ['none', 'ничего']])}</label></div><div class="me-f-row">
      <label class="me-f">Местность${sel('hland', po.land || 'random', [['random', 'случайная'], ['desert', 'пустыня'], ['plains', 'Равнина'], ['ruins', 'пригород в руинах']])}</label><label class="me-f">Мини-сцены${sel('scenes_hw', po.scenes || 'normal', SC)}</label></div>`,
    read:(f)=>({events:f.events.value, roadside:f.roadside.value, land:f.hland.value, scenes:f.scenes_hw.value})});
  return {PT, plains, industry, caves, highway};
})();
