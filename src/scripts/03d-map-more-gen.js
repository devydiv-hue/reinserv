/* ======================================================================
   ДОПОЛНЕНИЕ К ГЕНЕРАТОРУ КАРТ: ещё 11 видов местности из уже нарисованных объектов — центр мегаполиса,
   аэродром, порт, нефтепромысел, метро и коллектор, место крушения корабля, линия фронта, свалка, рынок,
   ферма, аномальная зона. Помощники — MapWilds.kit (03c), здания — общим генератором (MapGen.kit.building).
   Расстановку после сборки утрясает MapGen.settle (не на стенах, не друг на друге, не в ямах).
   ====================================================================== */
const MapMore = (function(){
  const GK = MapGen.kit, K = MapWilds.kit, BY = MapAssets.BY_ID;
  const {ctx, mkPut, vIdx, each, blob, lineDist, r2, crossLine, pointAt, scatter, land, fenceRect, hazard, WILD, sel, SC} = K;
  GK.THEMES.airfield = ['warehouse', 'guardhouse', 'control', 'garage', 'boxgarage', 'substation'];
  GK.THEMES.farm = ['house', 'cottage', 'boxgarage', 'warehouse'];
  GK.THEMES.market = ['bar', 'cafe', 'diner', 'grocery', 'hardware', 'pharmacy', 'motel'];
  // общее начало: контекст, параметр (из списка или случайный), сведения о генерации
  function start(doc, opts, id, theme, keys){ opts = opts || {}; const g = ctx(doc, opts.seed), o = {};
    Object.keys(keys).forEach(k=>{ o[k] = keys[k].indexOf(opts[k]) >= 0 ? opts[k] : g.pick(keys[k]); });
    g.opts = Object.assign({}, opts, {theme, ruin:'high'});
    const gopts = {scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal', theme, ruin:'high'}; Object.keys(keys).forEach(k=>{ gopts[k] = opts[k] || 'random'; });
    return {g, o, init(){ doc.gen = {id, seed:g.seed, opts:gopts, parts:[]}; }}; }
  const done = (doc, title, note, x, y)=>{ doc.gen.title = {x:x==null ? doc.cols/2 : x, y:y==null ? 1.2 : y, text:title}; if(note) doc.gen.note = {title, text:note}; };
  // здание общим генератором в прямоугольнике участка (front — сторона входа 0..3), с учётом частей карты
  function house(g, x0, y0, x1, y1, front, arch){ const {cols, rows} = g.doc; x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(cols, Math.round(x1)); y1 = Math.min(rows, Math.round(y1));
    if(x1 - x0 < 5 || y1 - y0 < 5) return null; const b = GK.building(g, x0, y0, x1, y1, undefined, front, arch); if(b) g.doc.gen.parts.push(GK.partOf(b, [x0, y0, x1, y1])); return b; }
  // прямая дорога с полотном под ней (занятость клеток — чтобы на неё не ставилось)
  function road(g, kind, w, pts, ter, edge){ const {cols} = g.doc; g.path(kind, w, r2(pts));
    each(g, (x, y, px, py)=>{ const d = lineDist(pts, px, py); if(d < w/2 + 0.3){ if(ter) g.setT(x, y, ter); g.occ[y*cols + x] = 1; } else if(edge && d < w/2 + 1.6) g.setT(x, y, edge); }); }
  const inRect = (r, m)=>(x, y)=>x > r[0] + (m || 0) && y > r[1] + (m || 0) && x < r[2] - (m || 0) && y < r[3] - (m || 0);
  // самый крупный объект из списка, влезающий в прямоугольник (по центру, поворот 0/90)
  function biggest(g, put, list, r, v){ const w = r[2] - r[0], h = r[3] - r[1]; const fit = list.map(a=>BY[a]).filter(Boolean).map(a=>({a, rot:a.w <= w && a.h <= h ? 0 : a.h <= w && a.w <= h ? 90 : -1})).filter(e=>e.rot >= 0);
    if(!fit.length) return null; fit.sort((p, q)=>q.a.w*q.a.h - p.a.w*p.a.h); const top = fit.filter(e=>e.a.w*e.a.h >= fit[0].a.w*fit[0].a.h*0.6), e = g.pick(top);
    const as = e.a, sw = e.rot ? as.h : as.w, sh = e.rot ? as.w : as.h; return put(as.id, r[0] + sw/2 + (w - sw)*g.rnd(), r[1] + sh/2 + (h - sh)*g.rnd(), e.rot, false, v); }
  const NEAR = (pts, d)=>(x, y)=>lineDist(pts, x, y) > d;

  /* ---------- 1. Центр мегаполиса ---------- */
  function megacity(doc, opts){
    const {g, o, init} = start(doc, opts, 'megacity', 'civic', {mode:['towers', 'plaza', 'mall']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, 'cracked', [['concrete', 0, 0.35], ['dust', 0.82, 1, 1], ['gravel', 0.7, 0.82, 1]]); init();
    const W = 5, vx = Math.round(cols*g.R(0.4, 0.6)), hy = Math.round(rows*g.R(0.4, 0.6)), V = [[vx, -1], [vx, rows + 1]], H = [[-1, hy], [cols + 1, hy]];
    road(g, 'highway', W, V, 'asphalt', 'concrete'); road(g, 'highway', W, H, 'asphalt', 'concrete');
    put('crossroad', vx, hy, 0, true); [[vx, hy - W/2 - 1, 0], [vx, hy + W/2 + 1, 0], [vx - W/2 - 1.5, hy, 90], [vx + W/2 + 1.5, hy, 90]].forEach(([x, y, r])=>put('zebra', x, y, r, true));
    const m = W/2 + 2, Q = [[0, 0, vx - m, hy - m], [vx + m, 0, cols, hy - m], [0, hy + m, vx - m, rows], [vx + m, hy + m, cols, rows]].map(q=>q.map(Math.round)), area = (q)=>(q[2] - q[0])*(q[3] - q[1]);
    const order = [0, 1, 2, 3].sort((a, b)=>area(Q[b]) - area(Q[a])), tower = [];
    order.forEach((qi, n)=>{ const q = Q[qi], pad = [q[0] + 1, q[1] + 1, q[2] - 1, q[3] - 1];
      if(o.mode==='plaza' && n===0){ const cx = (pad[0] + pad[2])/2, cy = (pad[1] + pad[3])/2; g.rectT(q[0], q[1], q[2] - q[0], q[3] - q[1], 'concrete');
        put(g.pick(['statue_judge', 'monument']), cx, cy, 0, true); put('grand_arch', cx, qi < 2 ? pad[3] - 1.5 : pad[1] + 1.5, 0); [[pad[0] + 1, pad[1] + 1], [pad[2] - 1, pad[1] + 1], [pad[0] + 1, pad[3] - 1], [pad[2] - 1, pad[3] - 1]].forEach(([x, y])=>put('lamp_post', x, y, 0));
        for(let x=pad[0] + 2;x<pad[2] - 1;x+=4) for(const y of [pad[1] + 1, pad[3] - 1]) put(g.pick(['tree_sparse', 'dead_tree', 'lamp_post']), x, y, 0); // аллеи по краям площади
        scatter(g, put, [['rubble_pile', 2, 4], ['corpse', 0.5, 2], ['trash', 2, 4], ['car_burnt', 0.5, 1], ['barricade', 1, 2], ['sandbags_arc', 0.5, 2], ['crater', 0.5, 1]], 10, inRect(pad, 1)); return; }
      if(o.mode==='mall' && n===0){ const b = biggest(g, put, ['mall'], pad); if(b){ scatter(g, put, [['parking', 3, 3], ['carts', 2, 4], ['car_wreck', 2, 4]], 6, inRect(pad)); return; } }
      const b = biggest(g, put, n < 2 ? ['megatower', 'megablock', 'fortress_tower', 'apartment_block'] : ['megablock', 'apartment_block', 'warehouse', 'shop', 'house_mid'], pad);
      if(b && /mega|fortress/.test(b.a)) tower.push({qi, b});
      // остаток квартала — дома помельче, магазины, стоянки, дворы (по сетке, без наложений)
      const fill = n < 2 ? ['apartment_block', 'shop', 'house_mid', 'ruin_house', 'kiosk', 'parking', 'helipad'] : ['house_mid', 'house_small', 'shop', 'ruin_house', 'ruin_corner', 'kiosk', 'parking', 'yard', 'dumpster'];
      for(let t=0;t<Math.round(area(q)/18);t++) g.tryObj(g.pick(fill), pad[0], pad[1], pad[2], pad[3], 6, g.pick([0, 90])); });
    // переходы между башнями через проспект
    for(let i=0;i<tower.length;i++) for(let j=i + 1;j<tower.length;j++){ const A = tower[i].b, B = tower[j].b, sameRow = (tower[i].qi < 2)===(tower[j].qi < 2), sameCol = tower[i].qi%2===tower[j].qi%2;
      if(sameRow && !sameCol){ const y = (A.y + B.y)/2; put(g.rnd() < 0.5 ? 'skywalk' : 'sky_bridge', vx, y, 90, true); } else if(sameCol && !sameRow){ const x = (A.x + B.x)/2; put(g.rnd() < 0.5 ? 'skywalk' : 'sky_bridge', x, hy, 0, true); } }
    // проспекты: фонари, щиты, остановки, брошенные машины
    [[V, 0], [H, 90]].forEach(([pts, rot])=>{ for(let t=0.04;t<1;t+=g.R(0.08, 0.14)){ const q = pointAt(pts, t), s = g.rnd() < 0.5 ? 1 : -1, nx = -Math.sin(q.a)*s, ny = Math.cos(q.a)*s;
        if(Math.hypot(q.x - vx, q.y - hy) < W + 2) continue; put(g.pick(['lamp_post', 'lamp_post', 'billboard', 'bus_stop', 'hydrant', 'phone_booth', 'kiosk', 'trash']), q.x + nx*(W/2 + 1.1), q.y + ny*(W/2 + 1.1), q.a*180/Math.PI + 90);
        if(g.rnd() < 0.35) put(g.pick(['car_wreck', 'car_burnt', 'bus_wreck', 'jersey', 'rubble_pile']), q.x + nx*g.R(-1.2, 1.2), q.y + ny*g.R(-1.2, 1.2), q.a*180/Math.PI + 90 + g.R(-25, 25), true); } });
    scatter(g, put, [['rubble_pile', 3, 6], ['rubble_big', 1, 2], ['trash', 2, 5], ['statue_judge', 0.3, 1], ['billboard', 0.5, 2], ['crater', 0.4, 2], ['roof_vent', 0.4, 2], ['antenna', 0.3, 1]], Math.round(cols*rows/110));
    done(doc, o.mode==='plaza' ? 'Площадь мегаполиса' : o.mode==='mall' ? 'Торговый центр мегаполиса' : 'Башни мегаполиса', 'Широкие проспекты, высотки с переходами между ними. Крыши — отдельные зоны: подъём по лестницам, вертолётные площадки.');
  }

  /* ---------- 2. Аэродром / место крушения ---------- */
  function airfield(doc, opts){
    const {g, o, init} = start(doc, opts, 'airfield', 'airfield', {mode:['base', 'crash', 'abandoned']}); const {cols, rows} = doc, put = mkPut(g, {state:o.mode==='base' ? null : 'ruined'});
    land(g, 'dust', [['sand', 0.7, 1], ['grass', 0, 0.22], ['gravel', 0.86, 1, 1]]); init();
    const horiz = cols >= rows, L = horiz ? cols : rows, S = horiz ? rows : cols, RW = Math.max(6, Math.min(9, Math.round(S*0.2))), c = Math.round(Math.min(S - RW/2 - 9, Math.max(RW/2 + 13, S*0.58)));
    const run = horiz ? [[-1, c], [cols + 1, c]] : [[c, -1], [c, rows + 1]], P = (a, b)=>horiz ? [a, b] : [b, a];
    road(g, 'highway', RW, run, o.mode==='abandoned' ? 'cracked' : 'asphalt', 'gravel');
    // рулёжка к стоянке и ангарам по другую сторону
    const ax = Math.round(L*g.R(0.25, 0.4)), apron = c - RW/2 - 2, side = Math.max(3, apron - 9);
    road(g, 'road', 3, [P(ax, c - RW/2), P(ax, side + 3)], 'asphalt'); g.rectT(...(horiz ? [0, side, cols, Math.max(1, apron - side - 1)] : [side, 0, Math.max(1, apron - side - 1), rows]), 'concrete');
    for(let x=4;x<L - 6;x+=g.ri(9, 12)){ if(Math.abs(x - ax) < 6) continue; const [hx, hy] = P(x + 4, side - 2.5); put('hangar', hx, hy, horiz ? 0 : 90, false, o.mode==='base' ? vIdx('hangar', /^Ангар$/) : null); }
    if(o.mode==='crash'){ const t = g.R(0.45, 0.7), q = pointAt(run, t), off = g.R(RW/2 + 3, RW/2 + 6)*(g.rnd() < 0.5 ? 1 : -1), [px, py] = horiz ? [q.x + g.R(-4, 4), q.y + off] : [q.x + off, q.y + g.R(-4, 4)];
      put('plane_wreck', px, py, g.rnd()*360, true, vIdx('plane_wreck', /Сгоревший/)); const back = pointAt(run, t - 0.25);
      const gouge = [[back.x, back.y], [(back.x + px)/2 + g.R(-2, 2), (back.y + py)/2 + g.R(-2, 2)], [px, py]]; // борозда — взрытый грунт и гарь
      each(g, (x, y, X, Y)=>{ const d = lineDist(gouge, X, Y); if(d < 1.3) g.setT(x, y, 'dirt'); else if(d < 2.4 && g.nz(x, y) < 0.6) g.setT(x, y, 'gravel'); if(Math.hypot(X - px, Y - py) < 6 && g.nz(x, y) < 0.6) g.setT(x, y, 'ash'); });
      for(let i=0;i<g.ri(6, 10);i++){ const u = g.rnd(); put(g.pick(['scrap_pile', 'scrap_pile', 'crater', 'rubble_pile', 'corpse', 'crate_metal', 'oil_drum_fire', 'tire_stack']), back.x + (px - back.x)*u + g.R(-3, 3), back.y + (py - back.y)*u + g.R(-3, 3), g.rnd()*360); } }
    else { for(let t=0;t<12;t++){ const [px, py] = P(L*g.R(0.15, 0.85), (side + apron)/2 + 0.5); if(put('plane_wreck', px, py, horiz ? 90 : 0, false, vIdx('plane_wreck', o.mode==='base' ? /Военный/ : /Пассажир/))) break; } } // на стоянке между ангарами и полосой
    // вышка, радар, топливо, площадка — у стоянки
    const yard = horiz ? [0, 0, cols, side - 1] : [0, 0, side - 1, rows];
    scatter(g, put, [['watchtower', 1, 2], ['radar', 1, 1], ['helipad', 1, 1], ['fuel_pump', 2, 3], ['tank_horiz', 1, 2], ['semi_truck', 1, 2], ['searchlight', 1, 3], ['barrels_group', 1, 3], ['crate_metal', 1, 3], ['sandbags_arc', o.mode==='base' ? 2 : 0.3, 3]], 10, (x, y)=>!(horiz ? y > side - 7 && y < c + RW/2 + 2 : x > side - 7 && x < c + RW/2 + 2));
    if(o.mode!=='crash'){ const lot = horiz ? [Math.round(L*0.62), Math.round(c + RW/2 + 3), Math.min(cols, Math.round(L*0.62) + 12), rows] : [Math.round(c + RW/2 + 3), Math.round(L*0.62), cols, Math.min(rows, Math.round(L*0.62) + 12)];
      house(g, ...lot, horiz ? 0 : 3, g.pick(['control', 'guardhouse', 'boxgarage'])); }
    // огни полосы и разметка
    for(let x=2;x<L;x+=4){ [-1, 1].forEach(s=>{ const [lx, ly] = P(x, c + s*(RW/2 + 0.6)); if(g.rnd() < 0.7) put('lamp', lx, ly, 0); }); }
    if(o.mode==='base') fenceRect(g, 1, 1, cols - 1, rows - 1, 'fence', horiz ? 2 : 1, 4);
    scatter(g, put, o.mode==='abandoned' ? [['dry_bush', 3, 8], ['tree_sparse', 1, 3], ['rubble_pile', 1, 3], ['car_wreck', 1, 2]].concat(WILD) : WILD, Math.round(cols*rows/140), (x, y)=>lineDist(run, x, y) > RW/2 + 2);
    done(doc, {base:'Военный аэродром', crash:'Место крушения самолёта', abandoned:'Заброшенный аэродром'}[o.mode], {base:'Полоса, ангары, вышки и радар; охрана по периметру за сеткой.', crash:'Самолёт сошёл с полосы и пропахал борозду: обломки, пожар, выжившие или мародёры.', abandoned:'Пустая полоса в трещинах, ангары с провалами кровли — удобное укрытие.'}[o.mode]);
  }

  /* ---------- 3. Порт / речной берег ---------- */
  function port(doc, opts){
    const {g, o, init} = start(doc, opts, 'port', 'industry', {mode:['dock', 'wreck', 'river']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, o.mode==='dock' ? 'concrete' : 'dust', o.mode==='dock' ? [['cracked', 0, 0.35], ['gravel', 0.8, 1, 1]] : [['sand', 0, 0.4], ['grass', 0.75, 1], ['mud', 0.85, 1, 1]]); init();
    // вода вдоль одной стороны (горизонтально — снизу), берег неровный у реки и ровный причал у дока
    const horiz = cols >= rows, D = (horiz ? rows : cols)*g.R(0.3, 0.4), lim = (horiz ? rows : cols) - D, nw = g.noise(5, g.ri(1, 999));
    const depth = (x, y)=>(horiz ? y : x) - (lim + (o.mode==='dock' ? 0 : (nw(x, y) - 0.5)*5));
    each(g, (x, y, px, py)=>{ const d = depth(px, py); if(d > 0){ g.setT(x, y, d > 3 ? 'water' : g.nz(x, y) < 0.25 ? 'rustwater' : 'water'); } else if(d > -2.2) g.setT(x, y, o.mode==='dock' ? 'concrete' : g.nz(x, y) < 0.5 ? 'mud' : 'sand'); });
    const P = (a, b)=>horiz ? [a, b] : [b, a], L = horiz ? cols : rows;
    if(o.mode==='dock'){ // причал: краны над контейнерами, рельсы вдоль кромки, склады в глубине
      const edge = lim; g.path('rail', 1, r2([P(-1, edge - 2.5), P(L + 1, edge - 2.5)]));
      for(let x=g.ri(3, 6);x<L - 4;x+=g.ri(9, 13)){ put('gantry_crane', ...P(x, edge - 4), horiz ? 90 : 0, true); put('container_stack', ...P(x + g.R(-1, 1), edge - 7), horiz ? 90 : 0); }
      for(let x=2;x<L - 2;x+=g.ri(3, 5)) put(g.pick(['shipping_container', 'shipping_container', 'pallet', 'crate_wood', 'barrels_group']), ...P(x, edge - g.R(9, 12)), horiz ? 90 : 0);
      for(let i=0;i<g.ri(1, 2);i++) put('barge', ...P(L*g.R(0.15, 0.85), edge + 3 + i*D*0.4), horiz ? 90 : 0, true);
      for(let x=4;x<L;x+=g.ri(10, 14)){ const lot = horiz ? [x, 0, x + 11, Math.max(6, edge - 13)] : [0, x, Math.max(6, edge - 13), x + 11]; house(g, ...lot, horiz ? 2 : 1, 'warehouse'); }
      scatter(g, put, [['pipe_rack', 1, 2], ['crane_beam', 1, 2], ['forklift', 0, 0], ['semi_truck', 1, 2], ['lamp_post', 2, 4], ['tank_horiz', 1, 2], ['barrels_group', 1, 3]], 8, (x, y)=>depth(x, y) < -3);
    } else if(o.mode==='wreck'){ // корабль выброшен на берег, обломки по песку
      const x = L*g.R(0.3, 0.7); put('barge', ...P(x, lim - 1), (horiz ? 90 : 0) + g.R(-35, 35), true, vIdx('barge', /На мели/)); put('barge', ...P(x + g.R(9, 13)*(g.rnd() < 0.5 ? 1 : -1), lim + 3), g.rnd()*360, true, vIdx('barge', /Разломана/));
      for(let i=0;i<g.ri(8, 14);i++) put(g.pick(['shipping_container', 'scrap_pile', 'crate_wood', 'barrel', 'corpse', 'tire_stack', 'pipe_straight']), ...P(x + g.R(-12, 12), lim - g.R(0, 7)), g.rnd()*360);
      put('scrap_shack', ...P(x + g.R(-10, 10), lim - g.R(8, 12)), g.rnd()*360); put('campfire', ...P(x + g.R(-6, 6), lim - g.R(5, 9)), 0);
    } else { // река: мостки, лодка, рыбацкая стоянка, камыш
      const x = L*g.R(0.25, 0.75); put('barge', ...P(x, lim + 2.5), horiz ? 90 : 0, true, vIdx('barge', /Обжита/)); g.path('trail', 1, r2([P(x, lim - 1), P(x + g.R(-8, 8), 0)]));
      scatter(g, put, [['tent', 1, 2], ['campfire', 1, 1], ['drying_rack', 1, 2], ['crate_wood', 1, 3], ['moisture_trap', 1, 1]], 6, (X, Y)=>depth(X, Y) < -1 && depth(X, Y) > -9);
    }
    scatter(g, put, [['reeds', 6, 14]], Math.round(L/3), (x, y)=>{ const d = depth(x, y); return d > -1 && d < 1.5; });
    scatter(g, put, o.mode==='dock' ? [['trash', 2, 5], ['rubble_pile', 1, 3], ['dumpster', 1, 2], ['car_wreck', 1, 2]] : WILD, Math.round(cols*rows/150), (x, y)=>depth(x, y) < -2);
    done(doc, {dock:'Портовый причал', wreck:'Корабль на мели', river:'Речной берег'}[o.mode], 'Вода глубже трёх клеток от берега — вплавь (к Атлетике), тяжёлое снаряжение тянет на дно.');
  }

  /* ---------- 4. Нефтепромысел ---------- */
  function oilfield(doc, opts){
    const {g, o, init} = start(doc, opts, 'oilfield', 'factory', {state:['working', 'abandoned', 'burning']}); const {cols, rows} = doc, put = mkPut(g, {state:o.state==='working' ? 'intact' : 'ruined'});
    land(g, g.pick(['dust', 'sand']), [['dirt', 0, 0.25], ['gravel', 0.72, 1], ['saltflat', 0.9, 1, 1]]); init();
    // база: резервуары, трубы, пультовая за сеткой
    const bx = Math.round(cols*g.R(0.15, 0.3)), by = Math.round(rows*g.R(0.15, 0.3)), bw = Math.min(16, Math.round(cols*0.4)), bh = Math.min(13, Math.round(rows*0.45)), base = [bx, by, bx + bw, by + bh];
    g.rectT(bx, by, bw, bh, 'concrete'); const gate = fenceRect(g, bx - 0.5, by - 0.5, bx + bw + 0.5, by + bh + 0.5, 'fence', g.pick([1, 2]), 3);
    house(g, bx + 1, by + 1, bx + Math.min(10, bw - 1), by + Math.min(8, bh - 4), 2, g.pick(['control', 'guardhouse']));
    const tanks = []; for(let i=0;i<g.ri(2, 3);i++){ const t = put(g.pick(['tank_big', 'tank_big', 'tank_horiz']), bx + bw - 3 - i*3.5, by + bh - 3, g.pick([0, 90])); if(t) tanks.push(t); }
    scatter(g, put, [['valve', 2, 4], ['pipe_straight', 2, 3], ['pipe_corner', 1, 2], ['electric_panel', 1, 2], ['barrels_group', 1, 2], ['generator', 1, 1], ['pipe_rack', 1, 1]], 8, inRect(base, 1));
    // качалки по полю, к каждой — грунтовка и трубопровод к базе
    const hub = tanks[0] || {x:bx + bw/2, y:by + bh/2}, n = g.ri(4, 8), dx = gate[0] - (bx + bw/2), dy = gate[1] - (by + bh/2), dl = Math.hypot(dx, dy) || 1, ux = dx/dl, uy = dy/dl;
    const far = Math.max(cols, rows), main = [[gate[0] + ux, gate[1] + uy], [gate[0] + ux*far*0.35 + g.R(-3, 3), gate[1] + uy*far*0.35 + g.R(-3, 3)], [gate[0] + ux*far, gate[1] + uy*far]].map(p=>[Math.max(-1, Math.min(cols + 1, p[0])), Math.max(-1, Math.min(rows + 1, p[1]))]);
    g.path('track', 2.5, r2(main)); // дорога от ворот наружу, к ней — подъезды от качалок
    for(let i=0;i<n*4 && doc.objects.filter(q=>q.a==='pump_jack').length < n;i++){ const x = g.R(3, cols - 3), y = g.R(3, rows - 3); if(inRect(base, -4)(x, y)) continue;
      const pj = put('pump_jack', x, y, g.pick([0, 90, 180, 270]), false, o.state==='working' ? vIdx('pump_jack', /Качает/) : o.state==='burning' ? vIdx('pump_jack', /Разлив/) : vIdx('pump_jack', /Ржав/)); if(!pj) continue;
      g.path('pipe', 0.7, r2([[x, y], [x, hub.y], [hub.x, hub.y]])); { let bq = main[0], bd = Infinity; for(let t=0;t<=1;t+=0.05){ const q = pointAt(main, t), d = Math.hypot(q.x - x, q.y - y); if(d < bd){ bd = d; bq = [q.x, q.y]; } } if(bd > 3 && !inRect(base, -1)((x + bq[0])/2, (y + bq[1])/2)) g.path('track', 2, r2([[x, y], bq])); }
      each(g, (cx, cy, X, Y)=>{ if(Math.hypot(X - x, Y - y) < 2.4 && g.nz(cx, cy) < 0.55) g.setT(cx, cy, o.state==='burning' ? 'ash' : 'mud'); });
      if(o.state!=='working' && g.rnd() < 0.5) put(g.pick(['slag_pool', 'toxic_puddle']), x + g.R(-3, 3), y + g.R(-3, 3), 0); }
    put('drill_rig', ...[g.R(4, cols - 4), g.R(4, rows - 4)], 0);
    if(o.state==='burning'){ for(let i=0;i<g.ri(3, 6);i++) put(g.pick(['oil_drum_fire', 'anom_thermal', 'crater', 'car_burnt']), g.R(2, cols - 2), g.R(2, rows - 2), g.rnd()*360); hazard(g, put, 'chem'); }
    else put('oil_drum_fire', bx + bw + 2, by - 2, 0); // факел
    scatter(g, put, [['semi_truck', 1, 2], ['pickup_rust', 1, 2], ['scrap_pile', 1, 3], ['barrel', 2, 5], ['tire_stack', 1, 2], ['power_pylon', 1, 3]].concat(WILD), Math.round(cols*rows/120), (x, y)=>!inRect(base, -2)(x, y));
    done(doc, {working:'Нефтепромысел', abandoned:'Заброшенный нефтепромысел', burning:'Горящий нефтепромысел'}[o.state], {working:'Качалки по полю, трубы к резервуарам базы; охрана ценит топливо дороже людей.', abandoned:'Ржавые качалки, разливы нефти и шлака: топливо ещё можно нацедить.', burning:'Горящие разливы (вредная среда: жар и дым), выгоревшие машины.'}[o.state]);
  }

  /* ---------- 5. Метро и коллектор ---------- */
  function metro(doc, opts){
    const {g, o, init} = start(doc, opts, 'metro', 'civic', {mode:['station', 'sewer']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    GK.reset(doc, 'bedrock'); init(); const mask = new Uint8Array(cols*rows), open = (x, y, w, h, t)=>{ for(let j=Math.max(0, y);j<Math.min(rows, y + h);j++) for(let i=Math.max(0, x);i<Math.min(cols, x + w);i++){ mask[j*cols + i] = 1; g.setT(i, j, t); } };
    if(o.mode==='station'){ const cy = Math.round(rows/2), tw = 4, py0 = cy - tw - 5, py1 = cy + tw; // пути посередине, платформы по бокам
      open(0, cy - tw, cols, tw*2, 'gravel'); open(1, py0, cols - 2, 5, 'tiles'); open(1, py1, cols - 2, 5, 'tiles');
      [cy - tw/2, cy + tw/2].forEach(y=>g.path('rail', 1, r2([[-1, y], [cols + 1, y]])));
      for(let x=3;x<cols - 6;x+=6){ put('platform_edge', x + 3, cy - tw - 0.5, 90, true); put('platform_edge', x + 3, cy + tw + 0.5, 90, true); }
      for(let x=4;x<cols - 3;x+=5){ put('column', x, py0 + 2, 0, true); put('column', x, py1 + 2.5, 0, true); }
      const cars = g.ri(1, 3); for(let i=0;i<cars;i++) put('metro_car', g.R(5, cols - 5), g.rnd() < 0.5 ? cy - tw/2 : cy + tw/2, 90, true);
      // вестибюли с турникетами и лестницами наверх
      [[g.ri(3, Math.max(4, cols/2 - 8)), 0], [g.ri(Math.round(cols/2), cols - 9), 1]].forEach(([x, s])=>{ const y = s ? py1 + 5 : 0, h = s ? rows - y : py0; if(h < 4) return; open(x, y, 7, h, 'tiles'); put('turnstiles', x + 3.5, s ? y + 1.5 : y + h - 1.5, 0, true); put(g.pick(['escalator', 'stairs_down']), x + 3.5, s ? rows - 2.5 : 2.5, 0, true); put('electric_panel', x + 0.6, y + h/2, 90); });
      scatter(g, put, [['vending', 1, 3], ['kiosk', 0.5, 1], ['chair', 2, 5], ['trash', 3, 6], ['corpse', 0.5, 2], ['sleeping_bag', 1, 3], ['campfire', 0.5, 1], ['rubble_pile', 1, 3], ['blood', 0.5, 2]], Math.round(cols*rows/70), (x, y)=>mask[Math.floor(y)*cols + Math.floor(x)] && T(x, y)==='tiles');
    } else { // коллектор: сетка бетонных галерей со стоком посередине, узлы-колодцы
      const step = 9, xs = [], ys = []; for(let x=3;x<cols - 2;x+=step + g.ri(-1, 2)) xs.push(x); for(let y=3;y<rows - 2;y+=step + g.ri(-1, 2)) ys.push(y);
      ys.forEach(y=>{ if(g.rnd() < 0.85){ open(0, y - 2, cols, 4, 'concrete'); open(0, y - 1, cols, 1, 'sewer'); } }); xs.forEach(x=>{ if(g.rnd() < 0.85){ open(x - 2, 0, 4, rows, 'concrete'); open(x - 1, 0, 1, rows, 'sewer'); } });
      xs.forEach(x=>ys.forEach(y=>{ if(mask[y*cols + x]){ open(x - 3, y - 3, 6, 6, g.rnd() < 0.3 ? 'sewer' : 'concrete'); if(g.rnd() < 0.5) put('collector', x, y, 0, true, null); } }));
      if(xs.length && ys.length){ const x = g.pick(xs), y = g.pick(ys); open(x + 3, y + 3, 7, 6, 'concrete'); put('pump_station', x + 6.5, y + 5.5, 0); put('electric_panel', x + 4, y + 4, 0); }
      scatter(g, put, [['manhole', 2, 5], ['sewer_grate', 3, 6], ['pipe_straight', 2, 4], ['valve', 2, 4], ['ladder', 1, 3], ['catacomb_niche', 1, 3], ['bone_pile', 1, 3], ['rubble_pile', 2, 4], ['trash', 3, 6], ['cocoon', 0.4, 2], ['web_mass', 0.4, 2], ['corpse', 0.5, 2]], Math.round(cols*rows/60), (x, y)=>mask[Math.floor(y)*cols + Math.floor(x)] && T(x, y)==='concrete');
    }
    function T(x, y){ return MapFormat.TERRAIN[doc.terrain[Math.floor(y)*cols + Math.floor(x)]].id; }
    for(let i=0;i<cols*rows;i++) if(!mask[i]) g.occ[i] = 1;
    GK.wallsFromMask(g, mask, 'concrete');
    done(doc, o.mode==='station' ? 'Станция метро' : 'Городской коллектор', o.mode==='station' ? 'Платформы по обе стороны путей, вагоны в тоннеле; выходы наверх — лестницы и эскалаторы в вестибюлях.' : 'Галереи со стоком посередине (сточная вода — вредная среда), узлы-колодцы, насосная.', cols/2, 0.8);
  }

  /* ---------- 6. Место крушения корабля ---------- */
  function crashsite(doc, opts){
    const {g, o, init} = start(doc, opts, 'crashsite', 'industry', {state:['fresh', 'old', 'looted']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, g.pick(['saltflat', 'dust', 'sand']), [['gravel', 0.68, 1], ['dirt', 0, 0.2], ['rock', 0.9, 1, 1]]); init();
    // борозда от края к кораблю: оплавленный грунт, обломки вдоль
    const horiz = cols >= rows, full = crossLine(g, horiz, 1.5), line = full.slice(0, Math.ceil(full.length*0.7)), end = line[line.length - 1];
    each(g, (x, y, px, py)=>{ const d = lineDist(line, px, py); if(d < 1.5) g.setT(x, y, o.state==='fresh' ? 'glass' : 'ash'); else if(d < 3 && g.nz(x, y) < 0.6) g.setT(x, y, 'gravel'); });
    each(g, (x, y, px, py)=>{ const d = Math.hypot(px - end[0], py - end[1]); if(d < 7) g.setT(x, y, d < 4 ? (o.state==='fresh' ? 'glass' : 'ash') : 'gravel'); });
    const ang = Math.atan2(end[1] - line[line.length - 4][1], end[0] - line[line.length - 4][0])*180/Math.PI;
    put('ship_hull', end[0], end[1], ang + 90, true, vIdx('ship_hull', o.state==='fresh' ? /Огни|Обгор/ : o.state==='old' ? /Занесена/ : /Пробоина/));
    put('ship_nozzle', end[0] - Math.cos(ang*Math.PI/180)*8 + g.R(-3, 3), end[1] - Math.sin(ang*Math.PI/180)*8 + g.R(-3, 3), g.rnd()*360, true);
    for(let i=0;i<g.ri(8, 14);i++){ const q = pointAt(line, g.R(0.2, 1)); put(g.pick(['scrap_pile', 'scrap_pile', 'crater', 'cryo_pod', 'polyhedron', 'robot_wreck', 'bio_tank', 'sarcophagus', 'satellite']), q.x + g.R(-4, 4), q.y + g.R(-4, 4), g.rnd()*360); }
    for(let i=0;i<g.ri(2, 4);i++) put(g.pick(['cryo_pod', 'containment_pod', 'artifact']), end[0] + g.R(-7, 7), end[1] + g.R(-7, 7), g.rnd()*360);
    if(o.state==='fresh'){ for(let i=0;i<g.ri(3, 5);i++) put(g.pick(['anom_thermal', 'anom_electro', 'oil_drum_fire']), end[0] + g.R(-9, 9), end[1] + g.R(-9, 9), 0); hazard(g, put, 'rad', (x, y)=>Math.hypot(x - end[0], y - end[1]) < 10); }
    if(o.state==='old') scatter(g, put, [['crystal_tree', 2, 4], ['mineral_spikes', 2, 4], ['crystal_growth', 2, 3], ['glow_mushrooms', 1, 3], ['dune', 2, 4]], 10);
    if(o.state==='looted'){ put('scrap_shack', end[0] + g.R(-12, 12), end[1] + g.R(-12, 12), g.rnd()*360); scatter(g, put, [['tent', 1, 3], ['campfire', 1, 2], ['crate_metal', 2, 4], ['pickup_rust', 1, 2], ['buggy', 1, 2], ['corpse', 1, 2]], 9); }
    if(g.rnd() < 0.5) put(g.pick(['radio_dish', 'accel_ring', 'antigrav_car', 'aerocar']), g.R(6, cols - 6), g.R(6, rows - 6), g.rnd()*360);
    scatter(g, put, WILD, Math.round(cols*rows/150), NEAR(line, 3));
    done(doc, {fresh:'Свежее крушение корабля', old:'Древний корабль', looted:'Разграбленный корабль'}[o.state], {fresh:'Корпус ещё горит и фонит: радиация вокруг, термо- и электроаномалии; уцелевшие капсулы.', old:'Корабль занесло песком и проросло кристаллами; внутрь — через пробоины.', looted:'У корабля стоянка мародёров: шалаш, ящики с добычей, машины.'}[o.state], end[0], Math.max(1, end[1] - 6));
  }

  /* ---------- 7. Линия фронта ---------- */
  function front(doc, opts){
    const {g, o, init} = start(doc, opts, 'front', 'civic', {state:['active', 'old']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, o.state==='active' ? 'mud' : 'dirt', [['ash', 0, 0.25], ['dirt', 0.6, 1], ['grass', 0.86, 1, 1]]); init();
    const horiz = cols >= rows, S = horiz ? rows : cols, lines = [crossLine(g, horiz, 1.5, -S*0.3), crossLine(g, horiz, 1.5, S*0.3)];
    lines.forEach((ln, side)=>{ g.path('trench', 1.4, r2(ln)); const nrm = side ? -1 : 1; // бруствер и укрепления — со стороны противника
      for(let t=0.03;t<1;t+=g.R(0.06, 0.1)){ const q = pointAt(ln, t), nx = -Math.sin(q.a)*nrm, ny = Math.cos(q.a)*nrm; put(g.pick(['sandbags_line', 'sandbags_line', 'sandbags_arc']), q.x + nx*1.6, q.y + ny*1.6, q.a*180/Math.PI + (nrm < 0 ? 180 : 0)); }
      for(let i=0;i<g.ri(1, 3);i++){ const q = pointAt(ln, g.R(0.1, 0.9)), nx = -Math.sin(q.a)*nrm, ny = Math.cos(q.a)*nrm; put(g.pick(['pillbox', 'bunker', 'watchtower']), q.x - nx*3.5, q.y - ny*3.5, q.a*180/Math.PI); }
      for(let i=0;i<g.ri(2, 4);i++){ const q = pointAt(ln, g.rnd()), nx = -Math.sin(q.a)*nrm, ny = Math.cos(q.a)*nrm; put(g.pick(['ammo_crate', 'crate_metal', 'radio', 'medkit', 'searchlight', 'sleeping_bag']), q.x - nx*g.R(2, 3), q.y - ny*g.R(2, 3), g.rnd()*360); } });
    // ничейная земля: колючка, ежи, мины, воронки, подбитая техника
    const mid = crossLine(g, horiz, 2), NL = (x, y)=>lineDist(mid, x, y) < S*0.2;
    for(let t=0.05;t<1;t+=g.R(0.07, 0.12)){ const q = pointAt(mid, t); put(g.pick(['barbed_wire', 'barbed_wire', 'czech_hedgehog']), q.x + g.R(-2, 2), q.y + g.R(-2, 2), q.a*180/Math.PI + g.R(-15, 15)); }
    scatter(g, put, [['crater', 8, 18], ['mine_field', 2, 5], ['tank_wreck', 1, 2], ['apc_wreck', 1, 2], ['war_mech', o.state==='old' ? 0.4 : 0.2, 1], ['corpse', 2, 6], ['blood', 1, 3], ['rubble_pile', 1, 3], ['dead_tree', 1, 3]], Math.round(cols*rows/45), NL);
    scatter(g, put, [['crater', 2, 5], ['tent', 1, 2], ['field_kitchen', 0.6, 1], ['radio_mast', 0.5, 1], ['ammo_crate', 1, 3], ['stumps', 1, 2], ['dead_tree', 1, 3]], Math.round(cols*rows/160), (x, y)=>!NL(x, y));
    done(doc, o.state==='active' ? 'Линия фронта' : 'Старая линия фронта', o.state==='active' ? 'Две линии окопов, между ними ничейная земля: колючка, мины, воронки. Пересечь под огнём — укрытия только в воронках и за техникой.' : 'Окопы осыпались, мины ещё не сняты; в подбитой технике — трофеи и твари.');
  }

  /* ---------- 8. Свалка / автокладбище ---------- */
  function junkyard(doc, opts){
    const {g, o, init} = start(doc, opts, 'junkyard', 'industry', {mode:['cars', 'scrap', 'camp']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, 'dirt', [['gravel', 0, 0.3], ['mud', 0.72, 1], ['scrap', 0.6, 1, 1]]); init();
    const gate = g.pick([0, 1, 2, 3]); fenceRect(g, 1, 1, cols - 1, rows - 1, g.pick(['fence', 'scrap', 'scrap']), gate, 4);
    const lot = gate===2 ? [2, rows - 11, 13, rows - 2] : gate===0 ? [2, 2, 13, 11] : gate===1 ? [cols - 13, 2, cols - 2, 11] : [2, 2, 13, 11]; house(g, ...lot, gate, g.pick(['guardhouse', 'boxgarage', 'garage']));
    // ряды машин с проездами
    const horiz = cols >= rows, inLot = (x, y)=>x > lot[0] - 1.5 && y > lot[1] - 1.5 && x < lot[2] + 1.5 && y < lot[3] + 1.5;
    for(let a=5;a<(horiz ? rows : cols) - 3;a+=g.ri(5, 7)){ const B = horiz ? cols : rows, seg = []; let run = null; // проезд — по частям, в обход конторы
      for(let b=1.5;b<=B - 1.5;b+=0.5){ const [x, y] = horiz ? [b, a - 1.5] : [a - 1.5, b], ok = !inLot(x, y); if(ok){ if(!run) run = [b, b]; else run[1] = b; } else if(run){ seg.push(run); run = null; } } if(run) seg.push(run);
      seg.forEach(([b0, b1])=>{ if(b1 - b0 > 3) g.path('track', 2, r2(horiz ? [[b0, a - 1.5], [b1, a - 1.5]] : [[a - 1.5, b0], [a - 1.5, b1]])); });
      for(let b=3;b<(horiz ? cols : rows) - 3;b+=g.R(1.3, 2.2)){ if(g.rnd() < (o.mode==='cars' ? 0.08 : 0.3)) continue; const [x, y] = horiz ? [b, a + 0.6] : [a + 0.6, b]; if(inLot(x, y)) continue;
        put(o.mode==='cars' ? g.pick(['car_wreck', 'car_wreck', 'car_burnt', 'pickup_rust', 'bus_wreck', 'buggy']) : g.pick(['scrap_pile', 'junk_mound', 'tire_stack', 'car_wreck', 'crate_metal', 'barrels_group']), x, y, (horiz ? 0 : 90) + g.R(-12, 12)); } }
    scatter(g, put, [['junk_mound', 2, 4], ['scrap_tower', 1, 2], ['crane_beam', 1, 1], ['tire_stack', 2, 5], ['oil_drum_fire', 1, 3], ['dumpster', 1, 3], ['cage', 0.5, 1], ['semi_truck', 0.5, 1]], Math.round(cols*rows/90));
    if(o.mode==='camp') scatter(g, put, [['scrap_shack', 2, 4], ['tent', 1, 3], ['campfire', 1, 2], ['skull_totem', 1, 2], ['war_rig', 0.5, 1], ['trophy_pole', 1, 2]], 8);
    done(doc, {cars:'Автокладбище', scrap:'Свалка металлолома', camp:'Лагерь на свалке'}[o.mode], 'Проезды между рядами узкие, обзор — на пару клеток; на кучах хлама — высота и укрытие, но шумно.');
  }

  /* ---------- 9. Рынок / торговый пост ---------- */
  function market(doc, opts){
    const {g, o, init} = start(doc, opts, 'market', 'market', {mode:['bazaar', 'caravan']}); const {cols, rows} = doc, put = mkPut(g, {state:'intact'});
    land(g, 'dust', [['sand', 0, 0.3], ['gravel', 0.7, 1], ['dirt', 0.85, 1, 1]]); init();
    const m = 3, A = [m, m, cols - m, rows - m]; g.wall('scrap', [[A[0], A[1]], [A[2], A[1]]]); g.wall('scrap', [[A[0], A[3]], [A[2], A[3]]]); g.wall('scrap', [[A[0], A[1]], [A[0], rows/2 - 2]]); g.wall('scrap', [[A[0], rows/2 + 2], [A[0], A[3]]]); g.wall('scrap', [[A[2], A[1]], [A[2], A[3]]]);
    put('settlement_gate', A[0], rows/2, 90, true); [-1, 1].forEach(s=>put('watchtower', A[0] - 1.5, rows/2 + s*4, 0));
    // торговые ряды: прилавки лицом к проходу
    const aisles = []; for(let y=A[1] + 4;y<A[3] - 3;y+=g.ri(6, 7)) aisles.push(y);
    aisles.forEach(y=>{ g.path('trail', 2, r2([[A[0], y], [A[2] - 8, y]])); for(let x=A[0] + 3;x<A[2] - 9;x+=g.R(2.4, 3.4)){ if(g.rnd() < 0.15) continue; [-1, 1].forEach(s=>{ if(g.rnd() < 0.8) put(g.pick(['market_stall', 'market_stall', 'market_tent', 'canopy', 'kiosk']), x, y + s*2.2, s > 0 ? 0 : 180); }); } });
    // площадь у дальней стены: еда, вода, бар
    const px = A[2] - 6; put('water_cistern', px, rows/2, 0); put('food_court', px, rows/2 + 4, 0); put('field_kitchen', px, rows/2 - 4, 0); put('banner', px - 2, A[1] + 2, 0);
    house(g, A[2] - 13, A[1] + 1, A[2] - 1, A[1] + 10, 2); if(g.rnd() < 0.6) house(g, A[2] - 13, A[3] - 10, A[2] - 1, A[3] - 1, 0);
    if(o.mode==='caravan'){ for(let i=0;i<g.ri(2, 4);i++){ const y = rows/2 + g.R(-4, 4), x = g.R(1, A[0] - 1); put('caravan_cart', x, y, 90 + g.R(-20, 20)); put('pack_animal', x + g.R(-1, 1), y + 3, g.rnd()*360); } g.path('track', 2, r2([[-1, rows/2], [A[0], rows/2]])); }
    scatter(g, put, [['crate_wood', 3, 8], ['barrel', 2, 6], ['pallet', 1, 4], ['pack_animal', 1, 3], ['signpost', 1, 2], ['campfire', 1, 2], ['oil_drum_fire', 1, 3], ['trash', 2, 5], ['latrine', 1, 2], ['cage', 0.5, 1]], Math.round(cols*rows/70), inRect(A, 1));
    scatter(g, put, WILD, Math.round(cols*rows/250), (x, y)=>!inRect(A, -1)(x, y));
    done(doc, o.mode==='caravan' ? 'Караван-сарай' : 'Рынок', 'Ряды прилавков в ограде, ворота под охраной. Товары по таблице «торговец»; драка на рынке — вся охрана против нарушителя.');
  }

  /* ---------- 10. Ферма / оазис ---------- */
  function farm(doc, opts){
    const {g, o, init} = start(doc, opts, 'farm', 'farm', {mode:['farm', 'oasis']}); const {cols, rows} = doc, put = mkPut(g, {state:o.mode==='farm' ? 'intact' : null});
    land(g, o.mode==='oasis' ? 'sand' : 'dust', o.mode==='oasis' ? [['dust', 0.7, 1]] : [['grass', 0, 0.35], ['dirt', 0.75, 1]]); init();
    const cx = cols/2 + g.R(-3, 3), cy = rows/2 + g.R(-3, 3);
    if(o.mode==='oasis'){ const f = blob(g, cx, cy, Math.min(cols, rows)*0.14, Math.min(cols, rows)*0.11, 0.25); each(g, (x, y, px, py)=>{ const d = f(px, py); if(d < 1) g.setT(x, y, 'water'); else if(d < 1.4) g.setT(x, y, 'mud'); else if(d < 2.3) g.setT(x, y, g.nz(x, y) < 0.6 ? 'grass' : 'dirt'); });
      scatter(g, put, [['reeds', 6, 14]], 14, (x, y)=>f(x, y) > 0.95 && f(x, y) < 1.4); scatter(g, put, [['tree_sparse', 4, 8], ['dry_bush', 2, 5], ['mutant_plant', 1, 2]], 12, (x, y)=>f(x, y) > 1.4 && f(x, y) < 2.6); }
    // участок за изгородью: дом, грядки, теплица, загон
    const W2 = Math.min(cols - 4, 26), H2 = Math.min(rows - 4, 20), x0 = Math.round(o.mode==='oasis' ? (cx < cols/2 ? cols - W2 - 2 : 2) : (cols - W2)/2), y0 = Math.round((rows - H2)/2), A = [x0, y0, x0 + W2, y0 + H2];
    fenceRect(g, A[0], A[1], A[2], A[3], 'wood', g.pick([0, 2]), 3); house(g, A[0] + 1, A[1] + 1, A[0] + 11, A[1] + 10, 2, g.pick(['house', 'cottage']));
    for(let y=A[1] + 2;y<A[3] - 2;y+=2) for(let x=A[0] + 13;x<A[2] - 3;x+=4){ g.rectT(x - 2, y - 1, 4, 2, 'dirt'); put('garden_bed', x, y, 0); }
    put('greenhouse', A[0] + 4, A[3] - 4.5, 90); put('animal_pen', A[0] + 9, A[3] - 3, 0); put('pack_animal', A[0] + 9, A[3] - 3, g.rnd()*360, true);
    scatter(g, put, [['water_tower', 1, 1], ['windmill', 1, 1], ['moisture_trap', 1, 3], ['drying_rack', 1, 2], ['latrine', 1, 1], ['barrel', 1, 3], ['crate_wood', 1, 3], ['tire_stack', 0.5, 1], ['trophy_pole', 0.5, 1]], 8, inRect(A, 1));
    scatter(g, put, [['stumps', 2, 4], ['tree_sparse', 2, 4], ['dead_tree', 1, 3], ['pickup_rust', 0.5, 1], ['caravan_cart', 0.5, 1], ['dry_bush', 3, 8], ['rocks_scatter', 1, 3]], Math.round(cols*rows/120), (x, y)=>!inRect(A, -1)(x, y));
    g.path('track', 2, r2([[(A[0] + A[2])/2, A[1] < 3 ? A[3] : A[1]], [(A[0] + A[2])/2 + g.R(-6, 6), A[1] < 3 ? rows + 1 : -1]]));
    done(doc, o.mode==='oasis' ? 'Оазис' : 'Ферма', o.mode==='oasis' ? 'Чистая вода посреди пустыни — за неё дерутся. Камыш и деревья — укрытие.' : 'Хозяйство за изгородью: дом, грядки, теплица, загон со скотиной. Хозяева стреляют без предупреждения.');
  }

  /* ---------- 11. Аномальная зона ---------- */
  function anomaly(doc, opts){
    const {g, o, init} = start(doc, opts, 'anomaly', 'civic', {mode:['lab', 'field', 'nest']}); const {cols, rows} = doc, put = mkPut(g, {state:'ruined'});
    land(g, 'dust', [['mutant', 0, 0.3], ['rad', 0.78, 1], ['crystal', 0.9, 1, 1], ['glass', 0, 0.06, 1]]); init();
    const cx = cols/2 + g.R(-3, 3), cy = rows/2 + g.R(-3, 3), R = Math.min(cols, rows)*0.38, Z = (x, y)=>Math.hypot(x - cx, y - cy) < R;
    // знаки и колючка по кругу — граница зоны; у края — те, кто не дошёл
    for(let a=0;a<6.28;a+=g.R(0.35, 0.6)){ const x = cx + Math.cos(a)*R*1.12, y = cy + Math.sin(a)*R*1.12; put(g.rnd() < 0.5 ? 'rad_sign' : 'barbed_wire', x, y, a*180/Math.PI + 90); }
    if(o.mode==='lab'){ put('lab_ruin', cx, cy, 0, true, vIdx('lab_ruin', /Прорыв/)); for(let i=0;i<g.ri(2, 4);i++) put('containment_pod', cx + g.R(-6, 6), cy + g.R(-6, 6), 0); }
    if(o.mode==='field'){ put('rift', cx, cy, g.rnd()*180, true); put('crystal_growth', cx + g.R(-3, 3), cy + g.R(-3, 3), 0); }
    if(o.mode==='nest'){ each(g, (x, y, px, py)=>{ if(Math.hypot(px - cx, py - cy) < R*0.35 && g.nz(x, y) < 0.7) g.setT(x, y, 'mutant'); }); scatter(g, put, [['web_mass', 4, 8], ['cocoon', 4, 8], ['bone_pile', 2, 5], ['bone_field', 1, 2], ['corpse', 2, 4]], 18, (x, y)=>Math.hypot(x - cx, y - cy) < R*0.5); put('mutant_tree', cx, cy, 0, true); }
    // аномалии с промежутком, у каждой — шанс на артефакт
    const an = ['anom_gravity', 'anom_electro', 'anom_thermal', 'toxic_puddle', 'geyser'], pts = [];
    for(let i=0;i<120 && pts.length < Math.round(R*0.9);i++){ const x = cx + g.R(-R, R), y = cy + g.R(-R, R); if(!Z(x, y) || pts.some(p=>Math.hypot(p[0] - x, p[1] - y) < 4.5)) continue;
      if(put(g.pick(an), x, y, 0)){ pts.push([x, y]); if(g.rnd() < 0.3) put('artifact', x + g.R(-1.2, 1.2), y + g.R(-1.2, 1.2), 0); } }
    scatter(g, put, [['crystal_growth', 2, 5], ['glow_mushrooms', 3, 8], ['mutant_plant', 2, 5], ['mutant_tree', 1, 3], ['mineral_spikes', 1, 3], ['crystal_tree', 1, 2], ['rad_sign', 1, 2], ['monolith', 0.3, 1]], Math.round(R*1.5), Z);
    scatter(g, put, [['corpse', 2, 4], ['bus_wreck', 0.5, 1], ['car_wreck', 1, 2], ['tent', 0.6, 1], ['campfire', 0.5, 1], ['beast_bones', 0.5, 1], ['dead_tree', 2, 4], ['dry_bush', 2, 5]], Math.round(cols*rows/140), (x, y)=>!Z(x, y));
    hazard(g, put, g.pick(['rad', 'psi']), Z);
    done(doc, {lab:'Аномальная зона: лаборатория', field:'Аномальное поле', nest:'Гнездо в аномальной зоне'}[o.mode], 'Аномалии видны только вблизи (Внимательность); болт или камень — проверить путь. Рядом с ними — артефакты.');
  }

  /* ---------- регистрация ---------- */
  const reg = (id, name, fn, key, list)=>MapGen.register({id, name, run:(d, o)=>{ fn(d, o); MapGen.applyLabels(d); },
    form:(po)=>`<div class="me-f-row"><label class="me-f">Вид${sel(key + '_' + id, po[key] || 'random', [['random', 'случайный']].concat(list))}</label><label class="me-f">Мини-сцены${sel('scenes_' + id, po.scenes || 'normal', SC)}</label></div>`,
    read:(f)=>({[key]:f[key + '_' + id].value, scenes:f['scenes_' + id].value})});
  reg('megacity', 'Центр мегаполиса', megacity, 'mode', [['towers', 'башни с переходами'], ['plaza', 'площадь с монументом'], ['mall', 'торговый центр']]);
  reg('airfield', 'Аэродром / крушение самолёта', airfield, 'mode', [['base', 'военный аэродром'], ['crash', 'крушение'], ['abandoned', 'заброшенный']]);
  reg('port', 'Порт, берег реки', port, 'mode', [['dock', 'причал с кранами'], ['wreck', 'корабль на мели'], ['river', 'речной берег']]);
  reg('oilfield', 'Нефтепромысел', oilfield, 'state', [['working', 'работает'], ['abandoned', 'заброшен'], ['burning', 'горит']]);
  reg('metro', 'Метро / коллектор', metro, 'mode', [['station', 'станция метро'], ['sewer', 'коллектор']]);
  reg('crashsite', 'Крушение корабля', crashsite, 'state', [['fresh', 'свежее'], ['old', 'древнее'], ['looted', 'разграблено']]);
  reg('front', 'Линия фронта', front, 'state', [['active', 'идут бои'], ['old', 'старая']]);
  reg('junkyard', 'Свалка / автокладбище', junkyard, 'mode', [['cars', 'автокладбище'], ['scrap', 'металлолом'], ['camp', 'лагерь на свалке']]);
  reg('market', 'Рынок / торговый пост', market, 'mode', [['bazaar', 'рынок'], ['caravan', 'караван-сарай']]);
  reg('farm', 'Ферма / оазис', farm, 'mode', [['farm', 'ферма'], ['oasis', 'оазис']]);
  reg('anomaly', 'Аномальная зона', anomaly, 'mode', [['lab', 'лаборатория'], ['field', 'аномальное поле'], ['nest', 'гнездо']]);
  return {megacity, airfield, port, oilfield, metro, crashsite, front, junkyard, market, farm, anomaly};
})();
