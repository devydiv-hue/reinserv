/* ======================================================================
   ДОПОЛНЕНИЕ К КАРТАМ: Равнина, пещеры, промзоны, трассы — фактуры новых грунтов и объекты.
   Новые типы ландшафта объявлены в MapFormat.TERRAIN (болото, кислотная и ржавая вода, медистый грунт, оплавленное
   стекло, кристаллическая корка, иней, россыпь лома, пол пещеры, толща породы); здесь — их фактуры
   (MapTex.addRecipe) и HD-объекты тем же набором помощников, что у встроенных (MapAssets.kit).
   Генераторы мест — 03c-map-wilds-gen.js.
   ====================================================================== */
(function(){
  const T = MapTex.kit, S = T.S;
  const tx = (id, fn)=>MapTex.addRecipe(id, fn);
  /* ---------- фактуры ---------- */
  tx('bog', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#4f573b', c1:'#3a412c', base:4, grain:12, contrast:1.7, ripple:{kx:2, ky:3, warp:8, a:0.05}, patches:[{c:'#2c3528', th:0.58, amt:0.65}, {c:'#6b6a40', th:0.68, amt:0.45, base:7}]});
    T.stains(c, rnd, 12, 12, 34, '#1c241e', 0.25, 0.4, 'multiply'); // чёрные окна топи
    T.specks(c, rnd, 1500, 1, 2.8, ['rgba(124,146,64,.55)', 'rgba(92,112,44,.5)', 'rgba(170,176,96,.4)']); // ряска
    T.strokes(c, rnd, 320, 5, 13, 1.1, ['#6a6a40', '#7e7c4e', '#4a4a2c', '#8a8458'], -Math.PI/2, 1.5); // осока
    T.stains(c, rnd, 10, 8, 24, '#d8e0d0', 0.05, 0.1); // мокрые блики
    for(let i=0;i<40;i++){ const x = rnd()*S, y = rnd()*S, r = 1.5 + rnd()*4; T.W(x, y, r + 1, (X, Y)=>{ c.strokeStyle = 'rgba(190,200,160,.35)'; c.lineWidth = 1; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.stroke(); }); } });
  tx('acid', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#a39f3e', c1:'#7e7a2a', base:3, grain:8, contrast:1.5, ripple:{kx:3, ky:5, warp:9, a:0.1}, patches:[{c:'#c8c058', th:0.62, amt:0.5}, {c:'#5e6a24', th:0.68, amt:0.45, base:6}]});
    T.strokes(c, rnd, 120, 10, 34, 1.2, ['rgba(250,250,200,.22)', 'rgba(220,230,140,.2)'], 0.3, 0.6);
    for(let i=0;i<90;i++){ const x = rnd()*S, y = rnd()*S, r = 1.2 + rnd()*4; T.W(x, y, r + 2, (X, Y)=>{ c.fillStyle = 'rgba(250,255,200,.5)'; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.fill(); c.strokeStyle = 'rgba(80,80,20,.4)'; c.lineWidth = 0.8; c.stroke(); }); } // пузыри
    T.stains(c, rnd, 5, 30, 60, '#e8f070', 0.08, 0.14); });
  tx('rustwater', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#74402e', c1:'#562a20', base:3, grain:8, contrast:1.5, ripple:{kx:3, ky:5, warp:9, a:0.09}, patches:[{c:'#8e5038', th:0.62, amt:0.5}, {c:'#3e2a26', th:0.68, amt:0.4, base:6}]});
    T.strokes(c, rnd, 120, 10, 34, 1.2, ['rgba(255,220,190,.18)', 'rgba(220,160,120,.16)'], 0.3, 0.6); T.stains(c, rnd, 6, 20, 50, '#c86a3a', 0.08, 0.14); T.specks(c, rnd, 60, 2, 4, ['rgba(200,120,70,.6)']); });
  tx('copper', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#806c52', c1:'#654f3d', base:4, grain:18, contrast:1.7, patches:[{c:'#4f8a76', th:0.62, amt:0.55}, {c:'#9a5a36', th:0.64, amt:0.5, base:7}, {c:'#6aa08a', th:0.72, amt:0.4, base:9}]});
    T.pebbles(c, rnd, 60, 1.5, 5, ['#8e5a3c', '#5f8a78', '#7a6a52', '#a8703e'], 0.4);
    T.crackLines(c, rnd, 8, 70, 1.2, 'rgba(40,30,22,.55)', true); T.specks(c, rnd, 700, 1, 2.4, ['rgba(130,200,170,.45)', 'rgba(60,40,28,.5)', 'rgba(200,140,90,.4)']); });
  tx('glass', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#36333b', c1:'#1d1c21', base:3, grain:6, contrast:2.2, bump:1.8, cells:{n:6, w:1.4, c:'#0b0a0c', a:0.85, lift:0.18, warp:22}, patches:[{c:'#4a3f52', th:0.64, amt:0.4}]});
    T.strokes(c, rnd, 90, 14, 46, 1.4, ['rgba(220,226,240,.28)', 'rgba(170,160,200,.22)'], -0.7, 0.5); // блики на гладком
    T.crackLines(c, rnd, 12, 120, 1, 'rgba(200,200,220,.35)', true); T.specks(c, rnd, 300, 1, 2, ['rgba(240,240,255,.5)']); });
  tx('crystal', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#8a8ea4', c1:'#686c84', base:4, grain:10, contrast:1.8, cells:{n:9, w:1.6, c:'#3a3c52', a:0.7, lift:0.2, warp:6}, patches:[{c:'#a8b4d8', th:0.62, amt:0.45}, {c:'#8a6ea8', th:0.7, amt:0.35, base:7}]});
    for(let i=0;i<160;i++){ const x = rnd()*S, y = rnd()*S, L = 4 + rnd()*12, a = rnd()*Math.PI*2; T.W(x, y, L + 2, (X, Y)=>{ c.save(); c.translate(X, Y); c.rotate(a); c.fillStyle = 'rgba(30,30,50,.35)'; c.fillRect(1, 1, L, L*0.25); c.fillStyle = rnd() < 0.5 ? 'rgba(200,220,255,.75)' : 'rgba(170,150,230,.7)'; c.beginPath(); c.moveTo(0, -L*0.12); c.lineTo(L, 0); c.lineTo(0, L*0.12); c.closePath(); c.fill(); c.restore(); }); }
    T.specks(c, rnd, 400, 1, 2, ['rgba(255,255,255,.65)']); });
  tx('frost', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#cbd3d6', c1:'#aab5ba', base:4, grain:10, contrast:1.4, cells:{n:8, w:1.2, c:'#7f8e96', a:0.45, lift:0.1, warp:14}, patches:[{c:'#e6eef0', th:0.6, amt:0.5}, {c:'#8a9aa2', th:0.7, amt:0.35, base:7}]});
    T.strokes(c, rnd, 500, 3, 9, 0.8, ['rgba(255,255,255,.55)', 'rgba(140,160,170,.4)']); T.specks(c, rnd, 900, 1, 2.2, ['rgba(255,255,255,.8)', 'rgba(120,140,150,.4)']); });
  tx('scrap', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#615a52', c1:'#4a443e', base:5, grain:16, contrast:1.7, patches:[{c:'#7a5034', th:0.6, amt:0.6}, {c:'#3a3936', th:0.68, amt:0.45, base:7}]});
    for(let i=0;i<220;i++){ const x = rnd()*S, y = rnd()*S, w = 3 + rnd()*14, h = 2 + rnd()*6, a = rnd()*Math.PI; const col = ['#7a7e80', '#8a5a3a', '#5a5e60', '#9a6a40', '#6a6e5a', '#a8a090'][Math.floor(rnd()*6)];
      T.W(x, y, w + 2, (X, Y)=>{ c.save(); c.translate(X, Y); c.rotate(a); c.fillStyle = 'rgba(15,12,10,.45)'; c.fillRect(-w/2 + 1.5, -h/2 + 2, w, h); c.fillStyle = col; c.fillRect(-w/2, -h/2, w, h); c.fillStyle = 'rgba(255,250,240,.2)'; c.fillRect(-w/2, -h/2, w, 1); c.restore(); }); }
    T.pebbles(c, rnd, 40, 2, 5, ['#4a4a48', '#6a6460'], 0.45); T.stains(c, rnd, 6, 14, 34, '#6f4a33', 0.2, 0.32, 'multiply'); });
  tx('cave', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#55504a', c1:'#3c3833', base:3, grain:14, contrast:2, cells:{n:6, w:1.8, c:'#1c1a17', a:0.6, lift:0.05, warp:30}, patches:[{c:'#4a5048', th:0.66, amt:0.4, base:8}, {c:'#6a6258', th:0.62, amt:0.3}]});
    T.pebbles(c, rnd, 90, 1.5, 6, ['#5e5852', '#4a4640', '#6e6860'], 0.5); T.stains(c, rnd, 8, 14, 40, '#20242a', 0.2, 0.32, 'multiply'); T.specks(c, rnd, 500, 1, 2.2, ['rgba(180,176,168,.3)', 'rgba(20,18,16,.45)']); });
  tx('bedrock', (c, rnd, s)=>{ T.basePixels(c, s, {c0:'#2c2926', c1:'#1a1816', base:3, grain:10, contrast:2.2, bump:1.6, cells:{n:5, w:2.2, c:'#0c0b0a', a:0.8, lift:0.06, warp:40}, patches:[{c:'#3a3530', th:0.62, amt:0.4}]});
    T.crackLines(c, rnd, 10, 100, 1.4, 'rgba(8,7,6,.7)', true); T.specks(c, rnd, 300, 1, 2.5, ['rgba(140,134,124,.25)']); });

  /* ---------- объекты ---------- */
  const K = MapAssets.kit, A = K.A, hk = K.hk, fx = K.fx, bits = K.bits, xb = K.xb, hdRock = K.hdRock, VN = K.VN, PV = K.PV, shade = K.shade;
  if(!MapAssets.CATS.some(c=>c[0]==='plains')) MapAssets.CATS.splice(MapAssets.CATS.findIndex(c=>c[0]==='anomaly') + 1, 0, ['plains', 'Равнина и наследие древних']);
  // Высокое тело — длинная тень вниз-вправо: многоугольник крыши, вытянутый на (dx, dy)
  function longShadow(k, pts, dx, dy, a){ const n = pts.length/2, sh = pts.map((v, i)=>v + (i%2 ? dy : dx));
    for(let i=0;i<n;i++){ const j = (i + 1)%n; k.fillP([pts[i*2], pts[i*2 + 1], pts[j*2], pts[j*2 + 1], sh[j*2], sh[j*2 + 1], sh[i*2], sh[i*2 + 1]], 'rgba(10,8,6,1)', a || 0.32); } k.fillP(sh, 'rgba(10,8,6,1)', a || 0.32); }
  const rot = (cx, cy, a, pts)=>pts.map((v, i)=>i%2 ? cy + (pts[i - 1] - cx)*Math.sin(a) + (v - cy)*Math.cos(a) : cx + (v - cx)*Math.cos(a) - (pts[i + 1] - cy)*Math.sin(a));
  const metalFill = (k, col, ta)=>k.texFill('metal', col || '#6d7376', col, ta==null ? 0.45 : ta);

  // Монолит: тёмная плита, длинная тень, руны / трещина / фон
  function monolithDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1, a = k.R(-0.5, 0.5);
    k.orgK(cx, cy, 0.95, 0.3); k.fill(d.rad ? 'rgba(130,160,40,.28)' : 'rgba(20,16,12,.2)');
    const L = d.fallen ? 0.92 : 0.78, Wd = d.fallen ? 0.36 : 0.34, top = rot(cx, cy, a, [cx - L, cy - Wd, cx + L, cy - Wd, cx + L, cy + Wd, cx - L, cy + Wd]);
    if(d.fallen){ k.fillP(top.map((v, i)=>v + (i%2 ? 0.1 : 0.08)), '#000', 0.4); } else longShadow(k, top, 0.32, 0.42, 0.34);
    k.fillP(top.map((v, i)=>v + (i%2 ? 0.07 : 0.05)), '#0e0d10'); k.poly(top); c.fillStyle = k.lin(cx - 0.6, cy - 0.6, cx + 0.6, cy + 0.6, [[0, '#3a3742'], [0.5, '#232128'], [1, '#141317']]); c.fill(); k.poly(top); k.stroke('#08070a', 0.02);
    c.save(); k.poly(top); c.clip(); k.line(rot(cx, cy, a, [cx - L*0.8, cy - Wd*0.5, cx + L*0.6, cy - Wd*0.7]), 'rgba(220,220,240,.25)', 0.025);
    if(d.runes){ for(let i=0;i<7;i++){ const t = -L*0.8 + i*L*0.26, p = rot(cx, cy, a, [cx + t, cy - Wd*0.4, cx + t + 0.06, cy, cx + t, cy + Wd*0.4]); k.line(p, d.runes, 0.022); } }
    if(d.cracked){ k.line(rot(cx, cy, a, [cx - 0.1, cy - Wd, cx + 0.05, cy - 0.05, cx - 0.08, cy + 0.08, cx + 0.06, cy + Wd]), 'rgba(0,0,0,.8)', 0.03); } c.restore();
    if(d.runes) k.radial(cx, cy, 0.8, d.runes, 0.3); if(d.rad){ k.radial(cx, cy, 1, '#c8f04a', 0.25); for(let i=0;i<10;i++){ const r = k.R(0.4, 0.95), t = k.R(0, 6.28); c.beginPath(); c.arc(cx + Math.cos(t)*r, cy + Math.sin(t)*r, 0.02, 0, 6.28); k.fill('#e0ff80'); } }
    if(d.cracked){ for(let i=0;i<5;i++) k.chunk(cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8), k.R(0.05, 0.11), '#2a2830', 0.03); } }
  const MONOLITH = [{n:'Чёрный монолит'}, {n:'Расколот', cracked:true}, {n:'Светятся знаки', runes:'#7ad8ff'}, {n:'Фонит, гудит', rad:true}, {n:'Повален', fallen:true, cracked:true}];
  A('monolith', 'Тёмный монолит', 'plains', 2, 2, {t:'монолит плита обелиск древние радиация', v:MONOLITH.length, vn:VN(MONOLITH), hd:true}, (g, v)=>monolithDraw(g, PV(MONOLITH, v)));

  // Лес металлических трубок: торцы труб с тенями, перекладины, упавшие трубы
  function pipeForestDraw(g, d){ const k = hk(g), c = k.c;
    k.orgK(1.5, 1.5, 1.4, 0.2); k.fill('rgba(20,16,12,.18)'); const tubes = [];
    for(let i=0;i<(d.dense ? 30 : 20);i++) tubes.push([k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.1, 0.24)]);
    tubes.forEach(([x, y, r])=>{ k.line([x, y, x + 0.28, y + 0.36], 'rgba(10,8,6,.32)', r*1.9); });
    for(let i=0;i<6;i++){ const p = k.pick(tubes), q = k.pick(tubes); if(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.1) k.line([p[0], p[1], q[0], q[1]], d.chrome ? '#9aa2a6' : '#6a4a34', 0.04); }
    for(let i=0;i<3;i++){ const x = k.R(0.3, 2.4), y = k.R(0.3, 2.6), a = k.R(0, 3.1), L = k.R(0.6, 1.2); k.line([x + 0.04, y + 0.05, x + Math.cos(a)*L + 0.04, y + Math.sin(a)*L + 0.05], 'rgba(0,0,0,.35)', 0.09); k.line([x, y, x + Math.cos(a)*L, y + Math.sin(a)*L], d.chrome ? '#8a9296' : '#7a4e30', 0.08); k.line([x, y - 0.02, x + Math.cos(a)*L, y + Math.sin(a)*L - 0.02], 'rgba(255,240,220,.25)', 0.02); }
    tubes.forEach(([x, y, r])=>{ c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, d.chrome ? [[0, '#e0e6e8'], [0.5, '#8a9296'], [1, '#3a4044']] : [[0, '#b8784a'], [0.5, '#7a4a2e'], [1, '#3a2418']]); c.fill(); k.stroke('rgba(10,8,6,.6)', 0.008); c.beginPath(); c.arc(x, y, r*0.55, 0, 6.28); k.fill('#0c0a08'); if(!d.chrome && k.rnd() < 0.4) k.rust(x, y, r*0.6, false); });
    if(d.totems){ for(let i=0;i<3;i++){ const [x, y] = k.pick(tubes); bits.skull(k, x + 0.12, y + 0.1, 0.06, k.R(-1, 1)); k.line([x, y, x + k.R(-0.2, 0.2), y + k.R(0.15, 0.3)], k.pick(['#a8352b', '#c8a040', '#d8d0c0']), 0.03); } }
    if(d.wind) for(let i=0;i<8;i++){ const y = k.R(0.2, 2.8); k.line([0.1, y, 0.8, y - 0.05, 1.5, y + 0.03], 'rgba(230,226,215,.18)', 0.015); } }
  const PIPEF = [{n:'Ржавые трубки'}, {n:'Хромированные', chrome:true}, {n:'Густые, гудят на ветру', dense:true, wind:true}, {n:'С тотемами дикарей', totems:true}];
  A('pipe_forest', 'Лес металлических трубок', 'plains', 3, 3, {t:'трубки лес гигантов металл заросли', v:PIPEF.length, vn:VN(PIPEF), hd:true}, (g, v)=>pipeForestDraw(g, PV(PIPEF, v)));

  // Секция корпуса звездолёта: обшивка, рёбра, пробоина с отсеками, песок
  function hullDraw(g, d){ const k = hk(g), c = k.c, W = 4, H = 6;
    const P = [0.3, 0.6, 2.0, 0.1, 3.7, 0.6, 3.9, 3.0, 3.6, 5.5, 2.0, 5.9, 0.4, 5.5, 0.1, 3.0];
    k.fillP(P.map((v, i)=>v + (i%2 ? 0.22 : 0.18)), '#000', 0.4); k.poly(P); metalFill(k, d.burnt ? '#3a3634' : '#8a9094', 0.3);
    c.save(); k.poly(P); c.clip(); c.fillStyle = k.lin(0, 0, W, 0, [[0, 'rgba(0,0,0,.4)'], [0.35, 'rgba(255,255,255,.12)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.45)']]); c.fillRect(0, 0, W, H);
    for(let y=0.6;y<H;y+=0.55) k.seam([0, y, W, y + 0.05], 0.014); for(let x=0.5;x<W;x+=0.9) k.seam([x, 0, x + 0.05, H], 0.01);
    for(let i=0;i<8;i++) k.rust(k.R(0.3, 3.7), k.R(0.4, 5.6), k.R(0.08, 0.2), false);
    if(d.burnt){ k.radial(2, 3, 2.4, '#000000', 0.45); for(let i=0;i<6;i++) k.blot(k.R(0.5, 3.5), k.R(0.6, 5.4), k.R(0.2, 0.5), '#141210', 0.5); }
    if(d.breach){ const hp = k.jag(2.1, 3.2, 1.0, 12, 0.35); k.fillP(hp, '#0a0908'); c.save(); k.poly(hp); c.clip(); for(let y=2.2;y<4.4;y+=0.45){ k.line([1, y, 3.2, y], '#3a3836', 0.06); k.line([1, y + 0.03, 3.2, y + 0.03], 'rgba(255,240,220,.15)', 0.015); } for(let x=1.4;x<3;x+=0.6) k.line([x, 2.2, x, 4.3], '#2a2826', 0.05); fx.paper(k, 1.8, 3.0, 0.15, 0.2); xb.cable(k, [1.4, 2.6, 2.0, 3.4, 2.6, 2.9], '#c83a2a', 0.02); c.restore(); k.poly(hp); k.stroke('#c8ccce', 0.03); for(let i=0;i<10;i++) k.chunk(2.1 + k.R(-1.4, 1.4), 3.2 + k.R(-1.4, 1.4), k.R(0.05, 0.14), '#8a9094', 0.03); }
    for(let i=0;i<4;i++){ const y = 1 + i*1.3; c.beginPath(); c.arc(0.9, y, 0.12, 0, 6.28); k.fill(d.lights ? '#ffb040' : '#1a1c1e'); k.stroke('#5a6064', 0.02); if(d.lights) k.radial(0.9, y, 0.35, '#ffb040', 0.4); }
    bits.stencil(k, 2.9, 1.3, d.label || 'КОВЧЕГ-7', 0.22, '#d8d0b0', 0.55);
    if(d.sand){ for(let i=0;i<5;i++){ k.organic(k.pick([0.4, 3.6]), k.R(0.6, 5.4), k.R(0.4, 0.8), 0.4, k.R(0.3, 0.5)); k.texFill('sand', '#c8b080'); } }
    c.restore(); k.poly(P); k.stroke('#141210', 0.03); }
  const HULL = [{n:'Обшивка с иллюминаторами'}, {n:'Пробоина, видны отсеки', breach:true}, {n:'Занесена песком', sand:true}, {n:'Обгоревшая', burnt:true, breach:true}, {n:'Огни ещё горят', lights:true, label:'СЕКТОР Г'}];
  A('ship_hull', 'Секция корпуса звездолёта', 'plains', 4, 6, {t:'звездолёт корабль ковчег обшивка корпус крушение', v:HULL.length, vn:VN(HULL), hd:true}, (g, v)=>hullDraw(g, PV(HULL, v)));

  // Дюза двигателя: кольца жаропрочного металла с цветами побежалости
  function nozzleDraw(g, d){ const k = hk(g), c = k.c, cx = 2, cy = 2;
    c.beginPath(); c.arc(cx + 0.18, cy + 0.24, 1.9, 0, 6.28); k.fill('rgba(0,0,0,.42)');
    [[1.9, '#6a6e72'], [1.6, '#8a6a9a'], [1.35, '#5a7aa8'], [1.12, '#a8884a'], [0.92, '#3a3634']].forEach(([r, col], i)=>{ c.beginPath(); c.arc(cx, cy, r, 0, 6.28); i===4 ? k.fill('#0c0a0a') : metalFill(k, col, 0.55); k.stroke('rgba(10,8,6,.55)', 0.02); });
    for(let i=0;i<24;i++){ const a = i/24*6.28; k.line([cx + Math.cos(a)*1.15, cy + Math.sin(a)*1.15, cx + Math.cos(a)*1.85, cy + Math.sin(a)*1.85], 'rgba(10,8,6,.3)', 0.02); }
    if(d.hot){ k.radial(cx, cy, 1.0, '#ff7a20', 0.75); k.radial(cx, cy, 0.5, '#ffe090', 0.8); } else { k.radial(cx, cy, 0.9, '#000000', 0.5); for(let i=0;i<8;i++) k.chunk(cx + k.R(-0.5, 0.5), cy + k.R(-0.5, 0.5), k.R(0.04, 0.1), '#3a3634', 0.02); }
    if(d.cracked){ const p = [cx + 0.3, cy - 1.9, cx + 0.1, cy - 1.2, cx + 0.35, cy - 0.95]; k.line(p, '#0a0808', 0.06); k.fillP([cx + 1.2, cy + 1.2, cx + 1.9, cy + 0.6, cx + 1.7, cy + 1.6], '#0a0808'); for(let i=0;i<6;i++) k.chunk(cx + k.R(1.5, 1.95), cy + k.R(1.2, 1.9), k.R(0.06, 0.14), '#6a6e72', 0.03); } }
  const NOZZLE = [{n:'Целая'}, {n:'Расколота', cracked:true}, {n:'Остаточный жар', hot:true}];
  A('ship_nozzle', 'Дюза двигателя', 'plains', 4, 4, {t:'дюза двигатель сопло корабль звездолёт', v:NOZZLE.length, vn:VN(NOZZLE), hd:true}, (g, v)=>nozzleDraw(g, PV(NOZZLE, v)));

  // Гибернационная капсула
  function cryoDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.14, 0.12, 0.8, 1.84, 0.36); k.fill('rgba(0,0,0,.42)'); k.rr(0.1, 0.06, 0.8, 1.84, 0.36); metalFill(k, '#b8bec2', 0.25); k.stroke(k.INK, 0.014);
    k.rr(0.22, 0.24, 0.56, 1.4, 0.26); if(d.open){ k.fill('#121414'); k.rr(0.22, 0.24, 0.56, 1.4, 0.26); k.stroke('#6a7074', 0.02); } else { c.fillStyle = k.lin(0.2, 0.2, 0.8, 1.6, d.frost ? [[0, '#e8f4f8'], [1, '#9ab8c8']] : [[0, '#4a9ab0'], [1, '#1a4a5a']]); c.fill(); }
    c.save(); k.rr(0.22, 0.24, 0.56, 1.4, 0.26); c.clip();
    if(d.sleeper || d.skel){ c.beginPath(); c.ellipse(0.5, 0.5, 0.12, 0.13, 0, 0, 6.28); k.fill(d.skel ? '#d8d0b8' : 'rgba(200,170,150,.75)'); k.rr(0.36, 0.64, 0.28, 0.6, 0.1); k.fill(d.skel ? 'rgba(216,208,184,.35)' : 'rgba(200,190,180,.55)'); if(d.skel){ for(let i=0;i<4;i++) k.line([0.4, 0.72 + i*0.08, 0.6, 0.72 + i*0.08], '#d8d0b8', 0.015); k.line([0.5, 0.64, 0.5, 1.2], '#d8d0b8', 0.02); } }
    if(d.frost) for(let i=0;i<20;i++){ c.beginPath(); c.arc(k.R(0.25, 0.75), k.R(0.3, 1.6), k.R(0.02, 0.06), 0, 6.28); k.fill('rgba(255,255,255,.55)'); }
    if(!d.open) k.line([0.3, 0.35, 0.45, 1.4], 'rgba(255,255,255,.35)', 0.04); c.restore();
    if(d.open){ c.save(); c.translate(0.95, 1.0); c.rotate(0.25); k.rr(-0.05, -0.7, 0.3, 1.4, 0.13); c.fillStyle = 'rgba(170,210,220,.4)'; c.fill(); k.stroke('#6a7074', 0.02); c.restore(); }
    [[0.25, 1.78, d.open ? '#3a2a22' : '#3ae050'], [0.5, 1.78, d.open ? '#3a2a22' : '#ffb040'], [0.75, 1.78, '#5a6064']].forEach(([x, y, col])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill(col); }); }
  const CRYO = [{n:'Закрыта, внутри спящий', sleeper:true}, {n:'Вскрыта, пуста', open:true}, {n:'Внутри скелет', skel:true}, {n:'Обледенела', frost:true, sleeper:true}];
  A('cryo_pod', 'Гибернационная капсула', 'plains', 1, 2, {t:'капсула крио гибернация анабиоз спящий ковчег', v:CRYO.length, vn:VN(CRYO), hd:true}, (g, v)=>cryoDraw(g, PV(CRYO, v)));

  // Радиотелескоп: чаша с рёбрами, облучатель на опорах, решётка там, где сорвана обшивка
  function dishDraw(g, d){ const k = hk(g), c = k.c, cx = 3, cy = 3, R = d.fallen ? 2.5 : 2.8;
    const ox = d.fallen ? 0.25 : 0, oy = d.fallen ? 0.3 : 0;
    c.beginPath(); c.ellipse(cx + 0.45 + ox, cy + 0.6 + oy, R, R*(d.fallen ? 0.8 : 1), 0, 0, 6.28); k.fill('rgba(0,0,0,.35)');
    c.save(); c.translate(cx + ox, cy + oy); if(d.fallen) c.scale(1, 0.8); c.beginPath(); c.arc(0, 0, R, 0, 6.28); c.fillStyle = (()=>{ const gr = c.createRadialGradient(-R*0.3, -R*0.3, R*0.1, 0, 0, R); gr.addColorStop(0, '#e4e2dc'); gr.addColorStop(0.7, '#b4b2aa'); gr.addColorStop(1, '#8a8880'); return gr; })(); c.fill(); k.stroke(k.INK, 0.03);
    c.save(); c.beginPath(); c.arc(0, 0, R, 0, 6.28); c.clip();
    for(let r=0.6;r<R;r+=0.55){ c.beginPath(); c.arc(0, 0, r, 0, 6.28); k.stroke('rgba(40,36,30,.35)', 0.015); } for(let i=0;i<24;i++){ const a = i/24*6.28; k.line([Math.cos(a)*0.3, Math.sin(a)*0.3, Math.cos(a)*R, Math.sin(a)*R], 'rgba(40,36,30,.35)', 0.012); }
    if(d.torn){ for(let i=0;i<5;i++){ const a0 = k.R(0, 6.28), a1 = a0 + k.R(0.25, 0.6), r0 = k.R(0.8, 1.6), r1 = r0 + k.R(0.6, 1.1); c.beginPath(); c.arc(0, 0, r1, a0, a1); c.arc(0, 0, r0, a1, a0, true); c.closePath(); k.fill('#2a2622'); for(let rr=r0;rr<r1;rr+=0.2){ c.beginPath(); c.arc(0, 0, rr, a0, a1); k.stroke('#7a7e80', 0.02); } } }
    for(let i=0;i<10;i++) k.blot(k.R(-R, R)*0.8, k.R(-R, R)*0.8, k.R(0.1, 0.3), d.overgrown ? '#5d6648' : '#6a5a40', d.overgrown ? 0.55 : 0.25); if(d.overgrown) k.tufts(-R, -R, R*2, R*2, 30);
    c.restore();
    if(d.fallen){ k.line([R*0.6, -R*0.7, R*0.95, -R*0.2], '#2a2622', 0.08); for(let i=0;i<8;i++) k.chunk(k.R(R*0.4, R*1.0), k.R(-R*0.8, -R*0.1), k.R(0.06, 0.16), '#b4b2aa', 0.03); }
    else { [0, 2.09, 4.19].forEach(a=>k.line([Math.cos(a)*R*0.75, Math.sin(a)*R*0.75, 0, 0], '#4a4844', 0.06)); c.beginPath(); c.arc(0, 0, 0.32, 0, 6.28); metalFill(k, '#6d7376'); k.stroke(k.INK, 0.015); c.beginPath(); c.arc(0, 0, 0.14, 0, 6.28); k.fill('#1a1816'); }
    c.restore(); }
  const DISH = [{n:'Целый'}, {n:'Обшивка сорвана', torn:true}, {n:'Рухнул, чаша набок', fallen:true, torn:true}, {n:'Зарос', overgrown:true}];
  A('radio_dish', 'Радиотелескоп', 'plains', 6, 6, {t:'радиотелескоп антенна тарелка обсерватория', v:DISH.length, vn:VN(DISH), hd:true}, (g, v)=>dishDraw(g, PV(DISH, v)));

  // Гидропонная теплица: арочная стеклянная крыша, ряды лотков сквозь стекло
  function greenhouseDraw(g, d){ const k = hk(g), c = k.c, W = 3, H = 8;
    k.rr(0.2, 0.22, 2.7, 7.7, 0.3); k.fill('rgba(0,0,0,.38)'); k.rr(0.1, 0.1, 2.7, 7.7, 0.3); k.fill(d.swamp ? '#3a4228' : '#4a4436');
    c.save(); k.rr(0.1, 0.1, 2.7, 7.7, 0.3); c.clip();
    for(let x=0.45;x<2.7;x+=0.7){ k.rr(x, 0.4, 0.4, 7.2, 0.05); k.fill('#5a4a36'); k.stroke('rgba(0,0,0,.4)', 0.01); for(let y=0.5;y<7.5;y+=0.22){ if(d.dead && k.rnd() < 0.6) continue; c.beginPath(); c.arc(x + 0.2 + k.R(-0.06, 0.06), y, k.R(0.06, 0.11), 0, 6.28); k.fill(d.dead ? '#6a6040' : k.pick(['#5a7a3a', '#6a8a40', '#4a6a2e', '#7a8a4a'])); } }
    if(d.swamp){ for(let i=0;i<8;i++) k.puddle(k.R(0.4, 2.5), k.R(0.6, 7.4), k.R(0.2, 0.45), k.R(0.12, 0.25)); }
    if(d.overgrown){ for(let i=0;i<10;i++) K.hdCanopy(k, k.R(0.3, 2.6), k.R(0.4, 7.6), k.R(0.25, 0.5), ['#3e5a2a', '#4e6a32', '#5e7a3a']); }
    c.fillStyle = d.broken ? 'rgba(200,220,220,.05)' : 'rgba(200,230,230,.22)'; c.fillRect(0, 0, W, H);
    for(let y=0.1;y<8;y+=0.6){ k.line([0.1, y, 2.8, y], '#3a3e40', 0.03); } k.line([1.45, 0.1, 1.45, 7.8], '#3a3e40', 0.05); [0.1, 2.8].forEach(x=>k.line([x, 0.1, x, 7.8], '#3a3e40', 0.04));
    if(!d.broken) for(let y=0.4;y<7.8;y+=1.2) k.line([0.3, y, 1.3, y + 0.5], 'rgba(255,255,255,.25)', 0.05);
    else { for(let i=0;i<14;i++){ const y = k.R(0.3, 7.6), x = k.R(0.2, 2.7); k.fillP([x, y, x + 0.12, y + 0.05, x + 0.05, y + 0.14], 'rgba(198,220,220,.55)'); } }
    c.restore(); k.rr(0.1, 0.1, 2.7, 7.7, 0.3); k.stroke('#2a2e30', 0.03); }
  const GREENH = [{n:'Целая, растёт урожай'}, {n:'Стёкла выбиты', broken:true, dead:true}, {n:'Заросла', overgrown:true, broken:true}, {n:'Заболочена', swamp:true, broken:true, dead:true}];
  A('greenhouse', 'Гидропонная теплица', 'plains', 3, 8, {t:'теплица гидропоника оранжерея урожай', v:GREENH.length, vn:VN(GREENH), hd:true}, (g, v)=>greenhouseDraw(g, PV(GREENH, v)));

  // Кристаллическое дерево: призмы-ветви от ствола, свечение
  function crystalTreeDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1, col = d.col;
    c.beginPath(); c.ellipse(cx + 0.35, cy + 0.45, 0.85, 0.7, 0.5, 0, 6.28); k.fill('rgba(0,0,0,.3)'); if(!d.dead) k.radial(cx, cy, 1, col[2], 0.3);
    for(let i=0;i<9;i++){ const a = i/9*6.28 + k.R(-0.25, 0.25), L = k.R(0.55, 0.9), w = L*0.22; c.save(); c.translate(cx, cy); c.rotate(a);
      k.fillP([0.05, 0.06, L + 0.05, 0.08, 0.05, w + 0.06], '#000', 0.3); k.fillP([0, -w, L*0.75, -w*0.55, L, 0, 0, 0], d.dead ? '#8a8a8a' : col[0]); k.fillP([0, w, L*0.75, w*0.55, L, 0, 0, 0], d.dead ? '#5a5a5a' : col[1]); k.line([0, 0, L, 0], d.dead ? '#b0b0b0' : col[2], 0.012);
      if(k.rnd() < 0.7){ const t = L*k.R(0.4, 0.7), b = k.R(0.4, 0.8)*(k.rnd() < 0.5 ? -1 : 1); c.translate(t, 0); c.rotate(b); k.fillP([0, -w*0.4, L*0.4, 0, 0, w*0.4], d.dead ? '#7a7a7a' : col[0]); } c.restore(); }
    if(d.dead) for(let i=0;i<6;i++) k.chunk(cx + k.R(-0.9, 0.9), cy + k.R(-0.9, 0.9), k.R(0.04, 0.1), '#8a8a8a', 0.02);
    c.beginPath(); c.arc(cx, cy, 0.16, 0, 6.28); k.fill(d.dead ? '#4a4a4a' : col[1]); k.stroke(k.INK, 0.01); if(!d.dead) for(let i=0;i<8;i++){ c.beginPath(); c.arc(cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8), 0.015, 0, 6.28); k.fill('#ffffff'); } }
  const CTREE = [{n:'Голубое', col:['#9ad8ff', '#3a7ab0', '#d8f4ff']}, {n:'Аметистовое', col:['#c8a0ff', '#6a3aa8', '#ecdcff']}, {n:'Дымчатое, фонит', col:['#c8d890', '#6a7a3a', '#f0ffb0']}, {n:'Мёртвое, расколотое', dead:true, col:['#999', '#666', '#bbb']}];
  A('crystal_tree', 'Кристаллическое дерево', 'plains', 2, 2, {t:'кристалл дерево лес аномалия', v:CTREE.length, vn:VN(CTREE), hd:true, lit:true}, (g, v)=>crystalTreeDraw(g, PV(CTREE, v)));

  // Минеральные «сосульки» из земли: острые конусы с длинными тенями
  function spikesDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    k.orgK(1, 1, 0.92, 0.3); k.fill('rgba(30,26,22,.18)'); const n = d.broken ? 9 : 13, sp = [];
    for(let i=0;i<n;i++) sp.push([k.R(0.3, 1.7), k.R(0.3, 1.7), k.R(0.12, 0.3)]); sp.sort((a, b)=>a[1] - b[1]);
    sp.forEach(([x, y, r])=>{ k.fillP([x - r*0.7, y, x + r*0.7, y, x + r*1.8, y + r*2.2], '#000', 0.25); });
    sp.forEach(([x, y, r])=>{ const gr = c.createRadialGradient(x - r*0.4, y - r*0.4, 0, x, y, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, col[0]); gr.addColorStop(1, col[1]); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = gr; c.fill(); k.stroke('rgba(10,8,6,.5)', 0.008);
      for(let j=0;j<5;j++){ const a = j/5*6.28; k.line([x, y, x + Math.cos(a)*r, y + Math.sin(a)*r], 'rgba(0,0,0,.18)', 0.006); }
      if(d.broken && k.rnd() < 0.5){ c.beginPath(); c.arc(x, y, r*0.5, 0, 6.28); k.fill(col[1]); k.chunk(x + r*1.6, y + r*1.2, r*0.5, col[0], 0.02); } else { c.beginPath(); c.arc(x - r*0.15, y - r*0.15, r*0.15, 0, 6.28); k.fill('#ffffff'); } }); }
  const SPIKES = [{n:'Белёсые', col:['#e8e2d4', '#8a8478']}, {n:'Ржавые', col:['#c88a5a', '#6a3a22']}, {n:'Сине-зелёные', col:['#8ad8c0', '#2a6a5a']}, {n:'Обломанные', col:['#d8d0c0', '#7a7468'], broken:true}];
  A('mineral_spikes', 'Минеральные «сосульки»', 'plains', 2, 2, {t:'сосульки шипы минерал кристаллы иглы острые', v:SPIKES.length, vn:VN(SPIKES), hd:true}, (g, v)=>spikesDraw(g, PV(SPIKES, v)));

  // Гейзер: жерло, минеральные террасы, пар
  function geyserDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1, col = d.col;
    [[0.95, col[0]], [0.75, col[1]], [0.55, col[0]]].forEach(([r, cc], i)=>{ k.orgK(cx, cy, r, 0.25); k.fill(cc, 0.75 - i*0.1); k.orgK(cx, cy, r, 0.25); k.stroke('rgba(255,250,235,.3)', 0.02); });
    k.orgK(cx, cy, 0.32, 0.3); c.fillStyle = d.mud ? '#4a3a2a' : d.acid ? '#c8c040' : d.dry ? '#2a2420' : '#3a6a7a'; c.fill(); k.orgK(cx, cy, 0.32, 0.3); k.stroke(k.INK, 0.015);
    if(d.mud) for(let i=0;i<6;i++){ c.beginPath(); c.arc(cx + k.R(-0.18, 0.18), cy + k.R(-0.18, 0.18), k.R(0.03, 0.06), 0, 6.28); k.stroke('rgba(200,180,150,.6)', 0.01); }
    if(!d.dry){ for(let i=0;i<5;i++) k.radial(cx + k.R(-0.2, 0.4), cy + k.R(-0.4, 0.2), k.R(0.3, 0.6), d.acid ? '#f0f0b0' : '#ffffff', 0.35); } else for(let i=0;i<6;i++) k.chunk(cx + k.R(-0.7, 0.7), cy + k.R(-0.7, 0.7), k.R(0.04, 0.09), '#8a7a60', 0.02); }
  const GEYSER = [{n:'Пар', col:['#c8b890', '#d8ccb0']}, {n:'Кипящая грязь', col:['#6a5a44', '#8a7458'], mud:true}, {n:'Кислотный', col:['#a8a840', '#d0d070'], acid:true}, {n:'Иссяк', col:['#9a8a6a', '#b0a080'], dry:true}];
  A('geyser', 'Гейзер', 'plains', 2, 2, {t:'гейзер пар источник жар грязь', g:true, v:GEYSER.length, vn:VN(GEYSER), hd:true}, (g, v)=>geyserDraw(g, PV(GEYSER, v)));

  // Громоотвод геотермального генератора: мачта с катушкой, молнии в землю
  function teslaDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.orgK(cx, cy, 0.95, 0.25); k.texFill('glass', '#2e2c31'); k.fill('rgba(0,0,0,.2)');
    if(d.broken){ k.line([cx, cy, cx + 0.8, cy + 0.6], 'rgba(0,0,0,.4)', 0.14); k.line([cx - 0.05, cy - 0.05, cx + 0.75, cy + 0.55], '#5a5e60', 0.1); for(let i=0;i<6;i++) k.chunk(cx + k.R(-0.6, 0.8), cy + k.R(-0.5, 0.8), k.R(0.05, 0.1), '#6a6e70', 0.02); }
    else { k.line([cx, cy, cx + 0.7, cy + 0.85], 'rgba(0,0,0,.35)', 0.12); }
    [0.42, 0.32, 0.22].forEach((r, i)=>{ c.beginPath(); c.arc(cx, cy, r, 0, 6.28); metalFill(k, i%2 ? '#b8784a' : '#6d7376', 0.5); k.stroke(k.INK, 0.012); });
    c.beginPath(); c.arc(cx, cy, 0.1, 0, 6.28); k.fill(d.active ? '#e8f4ff' : '#2a2c2e');
    if(d.active){ k.radial(cx, cy, 0.9, '#9ad0ff', 0.45); for(let i=0;i<5;i++){ const a = k.R(0, 6.28), L = k.R(0.6, 0.95); let x = cx, y = cy; const p = [x, y]; for(let j=1;j<=5;j++){ x = cx + Math.cos(a)*L*j/5 + k.R(-0.08, 0.08); y = cy + Math.sin(a)*L*j/5 + k.R(-0.08, 0.08); p.push(x, y); } k.line(p, '#9ad0ff', 0.04, 0.6); k.line(p, '#ffffff', 0.015); } } }
  const TESLA = [{n:'Бьёт молниями', active:true}, {n:'Затих'}, {n:'Мачта рухнула', broken:true}];
  A('tesla_mast', 'Громоотвод генератора', 'plains', 2, 2, {t:'молния генератор громоотвод геотермальный разряд', v:TESLA.length, vn:VN(TESLA), hd:true, lit:true}, (g, v)=>teslaDraw(g, PV(TESLA, v)));

  // Упавший спутник: корпус в золотой плёнке, солнечные крылья, тарелка
  function satDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5, a = 0.5;
    c.save(); c.translate(cx, cy); c.rotate(a);
    const wing = (sx)=>{ const x0 = sx > 0 ? 0.45 : -1.45; if(d.broken && sx > 0){ k.fillP([0.45, -0.3, 1.0, -0.25, 0.85, 0.32, 0.45, 0.3], '#1a2a4a'); return; } k.rr(x0 + 0.05, -0.28, 1.0, 0.6, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(x0, -0.32, 1.0, 0.6, 0.02); k.fill('#1a2a4a'); for(let i=1;i<5;i++) k.line([x0 + i*0.2, -0.32, x0 + i*0.2, 0.28], 'rgba(140,170,220,.4)', 0.01); k.line([x0, -0.02, x0 + 1, -0.02], 'rgba(140,170,220,.4)', 0.01); k.line([x0 + 0.1, -0.3, x0 + 0.5, 0.2], 'rgba(255,255,255,.2)', 0.03); };
    wing(-1); wing(1); k.rr(-0.42, -0.42, 0.9, 0.9, 0.04); k.fill('rgba(0,0,0,.4)'); k.rr(-0.45, -0.45, 0.9, 0.9, 0.04); c.fillStyle = k.lin(-0.45, -0.45, 0.45, 0.45, [[0, '#f0d070'], [0.5, '#b8902a'], [1, '#7a5a1a']]); c.fill(); k.stroke(k.INK, 0.012);
    for(let i=0;i<6;i++) k.line([k.R(-0.4, 0.4), k.R(-0.4, 0.4), k.R(-0.4, 0.4), k.R(-0.4, 0.4)], 'rgba(255,240,180,.35)', 0.01);
    c.beginPath(); c.arc(0.1, 0.1, 0.25, 0, 6.28); k.fill('#d8d6d0'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0.1, 0.1, 0.06, 0, 6.28); k.fill('#3a3836');
    if(d.live){ c.beginPath(); c.arc(-0.3, -0.3, 0.05, 0, 6.28); k.fill('#ff3a2a'); k.radial(-0.3, -0.3, 0.3, '#ff3a2a', 0.5); for(let r=0.4;r<1.2;r+=0.25){ c.beginPath(); c.arc(0.1, 0.1, r, -0.8, 0.2); k.stroke('rgba(120,220,255,.35)', 0.015); } }
    c.restore(); if(d.broken) for(let i=0;i<10;i++) k.chunk(k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.04, 0.1), k.pick(['#1a2a4a', '#b8902a', '#8a8e90']), 0.02);
    k.orgK(cx + 0.6, cy + 0.9, 0.7, 0.3, 0.35); k.fill('rgba(30,24,18,.3)'); }
  const SAT = [{n:'Целый'}, {n:'Крыло оторвано', broken:true}, {n:'Ещё вещает', live:true}];
  A('satellite', 'Упавший спутник', 'plains', 3, 3, {t:'спутник орбита антенна солнечные панели', v:SAT.length, vn:VN(SAT), hd:true}, (g, v)=>satDraw(g, PV(SAT, v)));

  // Кольцо ускорителя (тахионный циклотрон): бетонный тор, магниты, узлы
  function ringDraw(g, d){ const k = hk(g), c = k.c, cx = 4, cy = 4, R = 3.4, w = 0.75;
    c.beginPath(); c.arc(cx + 0.25, cy + 0.32, R + w/2, 0, 6.28); c.arc(cx + 0.25, cy + 0.32, R - w/2, 0, 6.28, true); k.fill('rgba(0,0,0,.4)');
    c.beginPath(); c.arc(cx, cy, R + w/2, 0, 6.28); c.arc(cx, cy, R - w/2, 0, 6.28, true); k.texFill('concrete', '#8a8780'); c.beginPath(); c.arc(cx, cy, R + w/2, 0, 6.28); k.stroke(k.INK, 0.025); c.beginPath(); c.arc(cx, cy, R - w/2, 0, 6.28); k.stroke(k.INK, 0.025);
    const gap = d.broken ? [0.6, 1.3] : null;
    for(let i=0;i<16;i++){ const a = i/16*6.28; if(gap && a > gap[0] && a < gap[1]) continue; c.save(); c.translate(cx + Math.cos(a)*R, cy + Math.sin(a)*R); c.rotate(a); k.rr(-0.22, -0.3, 0.44, 0.6, 0.04); metalFill(k, i%2 ? '#3a6a9a' : '#6d7376', 0.55); k.stroke(k.INK, 0.012); if(d.spark && i%3===0){ k.radial(0, 0, 0.5, '#9ad0ff', 0.55); } c.restore(); }
    if(gap){ c.beginPath(); c.arc(cx, cy, R + w/2 + 0.02, gap[0], gap[1]); c.arc(cx, cy, R - w/2 - 0.02, gap[1], gap[0], true); c.closePath(); k.fill('#141210'); for(let i=0;i<14;i++){ const a = k.R(gap[0], gap[1]), r = R + k.R(-1, 1.2); k.chunk(cx + Math.cos(a)*r, cy + Math.sin(a)*r, k.R(0.08, 0.2), '#8a8780', 0.04); } k.radial(cx + Math.cos(0.95)*R, cy + Math.sin(0.95)*R, 1.4, '#c89fff', 0.35); }
    if(d.spark) for(let i=0;i<6;i++){ const a = k.R(0, 6.28); k.line([cx + Math.cos(a)*R, cy + Math.sin(a)*R, cx + Math.cos(a + 0.1)*(R - 0.6), cy + Math.sin(a + 0.1)*(R - 0.6), cx + Math.cos(a - 0.05)*(R - 1.1), cy + Math.sin(a - 0.05)*(R - 1.1)], '#c8e8ff', 0.025); }
    // центр: пульт и кабели к кольцу
    k.rr(cx - 0.6, cy - 0.4, 1.2, 0.8, 0.05); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.012); for(let i=0;i<4;i++){ const a = i/4*6.28 + 0.4; xb.cable(k, [cx + Math.cos(a)*0.5, cy + Math.sin(a)*0.4, cx + Math.cos(a + 0.3)*1.8, cy + Math.sin(a + 0.3)*1.8, cx + Math.cos(a)*(R - 0.5), cy + Math.sin(a)*(R - 0.5)], '#1a1816', 0.04); }
    for(let i=0;i<3;i++){ c.beginPath(); c.arc(cx - 0.35 + i*0.35, cy, 0.06, 0, 6.28); k.fill(d.spark ? '#3ae0ff' : '#3a3e40'); } }
  const RING = [{n:'Кольцо цело'}, {n:'Искрит', spark:true}, {n:'Пробито, сияние', broken:true, spark:true}];
  A('accel_ring', 'Кольцо ускорителя', 'plains', 8, 8, {t:'циклотрон ускоритель кольцо тахионный', v:RING.length, vn:VN(RING), hd:true}, (g, v)=>ringDraw(g, PV(RING, v)));

  // Железобетонный саркофаг: уступы, потёки, знаки
  function sarcoDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.3, 0.3, 5.6, 5.6, 0.06, 0.18); [[0.2, 5.6], [0.8, 4.4], [1.5, 3.0]].forEach(([o, s], i)=>{ k.rr(o, o, s, s, 0.05); k.texFill('concrete', '#8e8a82', i===2 && d.open ? null : null); c.fillStyle = `rgba(0,0,0,${0.06*i})`; c.fill(); k.stroke(k.INK, 0.02); k.bevel(()=>k.rr(o, o, s, s, 0.05), 0.04); });
    for(let i=0;i<10;i++) k.streak(k.R(0.4, 5.4), k.R(0.3, 4.5), k.R(0.4, 1), 0.08, '#4a4030', 0.25);
    if(d.cracked){ for(let i=0;i<4;i++){ let x = k.R(0.5, 5.5), y = k.R(0.5, 5.5); const p = [x, y]; for(let j=0;j<5;j++){ x += k.R(-0.3, 0.3); y += k.R(-0.3, 0.3); p.push(x, y); } k.line(p, '#1a1816', 0.035); } k.radial(3, 3, 3, '#c8f04a', 0.18); }
    if(d.open){ k.fillP(k.jag(3, 3, 0.7, 10, 0.3), '#0a0908'); k.radial(3, 3, 1.2, '#c8f04a', 0.35); for(let i=0;i<10;i++) k.chunk(3 + k.R(-1.2, 1.2), 3 + k.R(-1.2, 1.2), k.R(0.06, 0.16), '#8e8a82', 0.03); for(let i=0;i<4;i++) k.rebar([3 + k.R(-0.8, 0.8), 3 + k.R(-0.8, 0.8), 3 + k.R(-0.8, 0.8), 3 + k.R(-0.8, 0.8)]); }
    [[0.5, 0.5], [5.1, 0.5], [0.5, 5.1], [5.1, 5.1]].forEach(([x, y])=>{ c.save(); c.translate(x + 0.2, y + 0.2); k.poly([0, -0.18, 0.18, 0.14, -0.18, 0.14]); k.fill('#e8c030'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0, 0.03, 0.04, 0, 6.28); k.fill('#1a1816'); c.restore(); }); }
  const SARCO = [{n:'Запечатан'}, {n:'Трещины, фонит', cracked:true}, {n:'Вскрыт сверху', open:true, cracked:true}];
  A('sarcophagus', 'Железобетонный саркофаг', 'plains', 6, 6, {t:'саркофаг бетон реактор радиация станция', v:SARCO.length, vn:VN(SARCO), hd:true}, (g, v)=>sarcoDraw(g, PV(SARCO, v)));

  // Вантовый мост: полотно, пилоны, ванты веером, провисание и обрушенный пролёт
  function cableBridgeDraw(g, d){ const k = hk(g), c = k.c, H = 12;
    k.rr(0.65, 0.1, 2.9, 11.8, 0.03); k.fill('rgba(0,0,0,.35)');
    const deck = (y0, y1, ang)=>{ c.save(); if(ang){ c.translate(2, y0); c.rotate(ang); c.translate(-2, -y0); } k.rr(0.5, y0, 3, y1 - y0, 0.02); k.texFill('asphalt', '#4b4a48'); k.stroke(k.INK, 0.02); k.line([2, y0, 2, y1], 'rgba(228,221,202,.45)', 0.05, null, [0.4, 0.4]); k.line([0.55, y0, 0.55, y1], '#6a6e70', 0.06); k.line([3.45, y0, 3.45, y1], '#6a6e70', 0.06); for(let i=0;i<4;i++) k.blot(k.R(0.8, 3.2), k.R(y0, y1), k.R(0.1, 0.25), '#2a2826', 0.4); c.restore(); };
    if(d.gap){ deck(0, 5.2, 0); deck(6.8, 12, 0); for(let i=0;i<12;i++) k.chunk(k.R(0.6, 3.4), k.R(4.8, 7.2), k.R(0.08, 0.22), '#6a6864', 0.04); for(let i=0;i<6;i++) k.rebar([k.R(0.6, 3.4), 5.2, k.R(0.6, 3.4), 5.2 + k.R(0.2, 0.6)]); }
    else deck(0, 12, 0);
    [3, 9].forEach(py=>{ [0.25, 3.75].forEach(px=>{ c.beginPath(); c.arc(px + 0.1, py + 0.14, 0.32, 0, 6.28); k.fill('rgba(0,0,0,.4)'); k.rr(px - 0.28, py - 0.28, 0.56, 0.56, 0.06); k.texFill('concrete', '#9a968e'); k.stroke(k.INK, 0.015); });
      for(let i=1;i<=5;i++){ const s = d.sag ? 0.15*i : 0; [0.25, 3.75].forEach(px=>{ [-1, 1].forEach(sd=>{ const ty = py + sd*i*0.5; if(d.gap && ty > 5.2 && ty < 6.8) return; k.line([px, py, (px + 2)/2 + (px < 2 ? -s : s), (py + ty)/2, px < 2 ? 0.55 : 3.45, ty], '#2a2826', 0.02); }); }); } });
    for(let i=0;i<6;i++) xb.box(k, k.R(0.8, 3.2), k.pick([k.R(0.5, 4.5), k.R(7.5, 11.5)]), 0.25, 0.4, k.R(0, 3), k.pick(['#5a4a3a', '#6a6e70'])); }
  const CBRIDGE = [{n:'Пролёты целы'}, {n:'Ванты провисли', sag:true}, {n:'Пролёт рухнул', gap:true}];
  A('cable_bridge', 'Вантовый мост', 'plains', 4, 12, {t:'мост вантовый пролёт переправа русло', v:CBRIDGE.length, vn:VN(CBRIDGE), hd:true}, (g, v)=>cableBridgeDraw(g, PV(CBRIDGE, v)));

  // Баржа на мели
  function bargeDraw(g, d){ const k = hk(g), c = k.c;
    const P = [2, 0.2, 3.7, 1.2, 3.8, 9.0, 3.5, 9.8, 0.5, 9.8, 0.2, 9.0, 0.3, 1.2];
    k.fillP(P.map((v, i)=>v + (i%2 ? 0.25 : 0.2)), '#000', 0.4); k.poly(P); k.texFill('rust', '#6b5546', '#5a3a26', 0.3); k.stroke(k.INK, 0.03);
    k.poly(P.map((v, i)=>i%2 ? v : 2 + (v - 2)*0.86)); k.stroke('rgba(255,240,220,.18)', 0.06);
    const holds = d.split ? [[1.6, 2.6], [5.8, 7.6]] : [[1.6, 3.4], [3.8, 5.6], [6.0, 7.8]];
    holds.forEach(([y0, y1])=>{ k.rr(0.8, y0, 2.4, y1 - y0, 0.03); k.fill(d.camp ? '#3a3026' : '#1c1916'); k.stroke('#4a3a2e', 0.04); if(!d.camp) for(let y=y0 + 0.3;y<y1;y+=0.4) k.line([0.85, y, 3.15, y], 'rgba(120,90,60,.25)', 0.02); });
    for(let i=0;i<14;i++) k.rust(k.R(0.5, 3.5), k.R(0.8, 9.4), k.R(0.08, 0.25), k.rnd() < 0.2);
    k.rr(1.0, 8.3, 2.0, 1.2, 0.05); k.texFill('metal', '#6d7376', '#7a5a46', 0.4); k.stroke(k.INK, 0.015); k.rr(1.2, 8.5, 1.6, 0.25, 0.02); k.fill('#1a2228');
    if(d.split){ k.fillP([0.2, 4.0, 3.8, 4.4, 3.8, 5.4, 0.2, 5.0], '#1a1714'); for(let i=0;i<10;i++) k.chunk(k.R(0.3, 3.7), k.R(3.8, 5.6), k.R(0.08, 0.2), '#6b5546', 0.04); }
    if(d.camp){ k.tarp(1.0, 2.0, 1.6, 1.2, '#7a6a4a', 0.1); k.tarp(1.2, 4.2, 1.4, 1.0, '#5a6a5a', -0.1); bits.fire(k, 2.4, 6.6, 0.15, 0.8); xb.laundry(k, 0.8, 6.2, 3.2, 7.2); }
    bits.stencil(k, 2, 0.95, 'Б-14', 0.24, '#d8d0b0', 0.5); }
  const BARGE = [{n:'На мели'}, {n:'Разломана', split:true}, {n:'Обжита', camp:true}];
  A('barge', 'Ржавая баржа', 'plains', 4, 10, {t:'баржа судно корабль ржавая мель солончак', v:BARGE.length, vn:VN(BARGE), hd:true}, (g, v)=>bargeDraw(g, PV(BARGE, v)));

  // Бетонный многогранник (сад многогранников): грани с освещением
  function polyDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1, a = k.R(0, 1.5), L = [0.92, -0.6];
    const face = (pts, nx, ny)=>{ const lit = Math.max(0, -(nx*L[0] + ny*L[1]))*0.5 + 0.35; k.fillP(pts, `rgb(${Math.round(150*lit + 60)},${Math.round(146*lit + 58)},${Math.round(138*lit + 54)})`); k.poly(pts); k.stroke('rgba(10,8,6,.6)', 0.015); };
    if(d.kind==='cube'){ const t = rot(cx, cy, a, [cx - 0.6, cy - 0.6, cx + 0.6, cy - 0.6, cx + 0.6, cy + 0.6, cx - 0.6, cy + 0.6]); longShadow(k, t, 0.45, 0.55, 0.3); face(t, 0, 0); k.poly(t); k.texFill('concrete', '#9a968e'); k.poly(t); k.stroke(k.INK, 0.02); }
    else { const n = d.kind==='pyr' ? 4 : 6, pts = []; for(let i=0;i<n;i++){ const t = a + i/n*6.28; pts.push(cx + Math.cos(t)*0.8, cy + Math.sin(t)*0.8); }
      longShadow(k, pts, 0.35, 0.45, 0.28); for(let i=0;i<n;i++){ const j = (i + 1)%n, mx = (pts[i*2] + pts[j*2])/2 - cx, my = (pts[i*2 + 1] + pts[j*2 + 1])/2 - cy, l = Math.hypot(mx, my) || 1; face([cx, cy, pts[i*2], pts[i*2 + 1], pts[j*2], pts[j*2 + 1]], mx/l, my/l); } }
    if(d.cracked){ k.line([cx - 0.5, cy - 0.3, cx - 0.1, cy, cx + 0.2, cy - 0.1, cx + 0.5, cy + 0.4], '#141210', 0.03); for(let i=0;i<6;i++) k.chunk(cx + k.R(-0.9, 0.9), cy + k.R(-0.9, 0.9), k.R(0.05, 0.12), '#8a8680', 0.03); }
    for(let i=0;i<4;i++) k.streak(cx + k.R(-0.5, 0.5), cy + k.R(-0.5, 0.2), k.R(0.2, 0.4), 0.05, '#4a4030', 0.18); }
  const POLY = [{n:'Куб', kind:'cube'}, {n:'Пирамида', kind:'pyr'}, {n:'Многогранник', kind:'hex'}, {n:'Расколот', kind:'hex', cracked:true}, {n:'Куб с трещиной', kind:'cube', cracked:true}];
  A('polyhedron', 'Бетонный многогранник', 'plains', 2, 2, {t:'многогранник куб пирамида бетон сад скульптура', v:POLY.length, vn:VN(POLY), hd:true}, (g, v)=>polyDraw(g, PV(POLY, v)));

  // Вагон антиграв-поезда
  function agTrainDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); if(d.side){ c.translate(1, 4); c.rotate(0.12); c.translate(-1, -4); }
    const body = (y0, y1)=>{ k.rr(0.25, y0 + 0.15, 1.6, y1 - y0, 0.7); k.fill('rgba(0,0,0,.38)'); k.rr(0.2, y0, 1.6, y1 - y0, 0.7); c.fillStyle = k.lin(0.2, 0, 1.8, 0, [[0, '#e8e8e4'], [0.45, '#c8ccd0'], [1, '#7a8288']]); c.fill(); k.stroke(k.INK, 0.02);
      k.rr(0.45, y0 + 0.4, 1.1, y1 - y0 - 0.8, 0.45); k.fill('#1e2a34'); k.line([0.6, y0 + 0.6, 0.6, y1 - 0.6], 'rgba(160,210,230,.35)', 0.05); k.line([1.0, y0 + 0.2, 1.0, y1 - 0.2], d.col || '#c83a2a', 0.06); };
    if(d.torn){ body(0, 3.4); body(4.6, 8); k.fillP([0.2, 3.3, 1.8, 3.5, 1.6, 3.9, 0.3, 3.7], '#1a1714'); for(let i=0;i<10;i++) k.chunk(k.R(0.2, 1.8), k.R(3.3, 4.7), k.R(0.06, 0.14), '#c8ccd0', 0.03); xb.cable(k, [0.8, 3.4, 1.1, 4.0, 0.9, 4.6], '#1a1816', 0.03); }
    else body(0, 8);
    if(d.side){ for(let i=0;i<5;i++) k.blot(k.R(0.3, 1.7), k.R(1, 7), k.R(0.15, 0.35), '#8a7a5a', 0.4); }
    c.restore(); }
  const AGT = [{n:'Вагон цел', col:'#c83a2a'}, {n:'Разорван пополам', torn:true, col:'#3a6ac8'}, {n:'Лежит на боку', side:true, col:'#c8a030'}];
  A('antigrav_car', 'Вагон антиграв-поезда', 'plains', 2, 8, {t:'поезд вагон антигравитационный монорельс', v:AGT.length, vn:VN(AGT), hd:true}, (g, v)=>agTrainDraw(g, PV(AGT, v)));

  // Опора ЛЭП: решётка с распорками, траверсы с изоляторами
  function pylonDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    if(d.fallen){ c.save(); c.translate(cx, cy); c.rotate(0.7); k.rr(-0.95, -0.22, 1.9, 0.44, 0.02); k.fill('rgba(0,0,0,.25)'); for(let x=-0.9;x<0.9;x+=0.3){ k.line([x, -0.2, x + 0.3, 0.2], '#3a3e40', 0.02); k.line([x, 0.2, x + 0.3, -0.2], '#3a3e40', 0.02); } k.line([-0.95, -0.2, 0.95, -0.2], '#4a4e50', 0.035); k.line([-0.95, 0.2, 0.95, 0.2], '#4a4e50', 0.035); c.restore(); return; }
    k.line([cx, cy, cx + 0.8, cy + 0.9], 'rgba(0,0,0,.3)', 0.25);
    k.rr(cx - 0.45, cy - 0.45, 0.9, 0.9, 0.01); k.stroke('#4a4e50', 0.04); k.line([cx - 0.45, cy - 0.45, cx + 0.45, cy + 0.45], '#4a4e50', 0.025); k.line([cx + 0.45, cy - 0.45, cx - 0.45, cy + 0.45], '#4a4e50', 0.025);
    k.rr(cx - 0.18, cy - 0.18, 0.36, 0.36, 0.01); k.stroke('#4a4e50', 0.03);
    k.line([cx - 0.95, cy, cx + 0.95, cy], '#3a3e40', 0.05); [-0.85, 0.85].forEach(x=>{ c.beginPath(); c.arc(cx + x, cy, 0.06, 0, 6.28); k.fill(d.rust ? '#8a5a3a' : '#b8c0c4'); k.stroke(k.INK, 0.008); });
    if(d.wires) [-0.85, 0.85].forEach(x=>{ k.line([cx + x, 0, cx + x, 2], '#1a1816', 0.012); }); }
  const PYLON = [{n:'С проводами', wires:true}, {n:'Ржавая, без проводов', rust:true}, {n:'Повалена', fallen:true}];
  A('power_pylon', 'Опора ЛЭП', 'industry', 2, 2, {t:'лэп опора провода столб электричество', v:PYLON.length, vn:VN(PYLON), hd:true}, (g, v)=>pylonDraw(g, PV(PYLON, v)));

  // Разбитый робот: корпус, голова-оптика, конечности, провода, масло
  function robotDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.orgK(cx + 0.2, cy + 0.3, 0.6, 0.4, 0.4); k.fill('#141210', 0.45); // масляное пятно
    const limb = (x0, y0, x1, y1, w)=>{ k.line([x0 + 0.04, y0 + 0.05, x1 + 0.04, y1 + 0.05], 'rgba(0,0,0,.4)', w); k.line([x0, y0, x1, y1], d.col || '#7a8288', w); k.line([x0, y0 - 0.01, x1, y1 - 0.01], 'rgba(255,255,255,.25)', w*0.25); c.beginPath(); c.arc(x1, y1, w*0.6, 0, 6.28); k.fill('#3a3e40'); };
    if(d.kind==='spider'){ for(let i=0;i<6;i++){ const a = i/6*6.28 + 0.3, m = [cx + Math.cos(a)*0.45, cy + Math.sin(a)*0.45]; limb(cx, cy, m[0], m[1], 0.07); limb(m[0], m[1], cx + Math.cos(a + 0.4)*0.9, cy + Math.sin(a + 0.4)*0.9, 0.05); } c.beginPath(); c.ellipse(cx, cy, 0.38, 0.3, 0.4, 0, 6.28); metalFill(k, '#4a5058'); k.stroke(k.INK, 0.012); for(let i=0;i<3;i++){ c.beginPath(); c.arc(cx - 0.12 + i*0.12, cy - 0.12, 0.04, 0, 6.28); k.fill(i===1 ? '#ff3a2a' : '#1a1c1e'); } }
    else if(d.kind==='pile'){ for(let i=0;i<5;i++){ const x = cx + k.R(-0.55, 0.55), y = cy + k.R(-0.55, 0.55); c.save(); c.translate(x, y); c.rotate(k.R(0, 6.28)); k.rr(-0.2, -0.13, 0.4, 0.26, 0.05); metalFill(k, k.pick(['#7a8288', '#5a6068', '#8a7a5a'])); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0.12, 0, 0.05, 0, 6.28); k.fill('#1a1c1e'); c.restore(); } for(let i=0;i<6;i++) limb(cx + k.R(-0.7, 0.7), cy + k.R(-0.7, 0.7), cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8), 0.05); }
    else { limb(cx - 0.1, cy - 0.15, cx - 0.65, cy - 0.45, 0.08); limb(cx + 0.1, cy - 0.1, cx + 0.55, cy + 0.15, 0.08); limb(cx - 0.05, cy + 0.25, cx - 0.35, cy + 0.85, 0.09); if(!d.legless) limb(cx + 0.1, cy + 0.25, cx + 0.3, cy + 0.85, 0.09);
      k.rr(cx - 0.25, cy - 0.3, 0.5, 0.6, 0.1); metalFill(k, d.col || '#7a8288'); k.stroke(k.INK, 0.012); k.rr(cx - 0.12, cy - 0.15, 0.24, 0.2, 0.03); k.fill('#2a3036'); c.beginPath(); c.arc(cx - 0.05, cy - 0.5, 0.15, 0, 6.28); metalFill(k, '#5a6068'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(cx - 0.05, cy - 0.5, 0.06, 0, 6.28); k.fill(d.live ? '#ff3a2a' : '#1a1c1e'); if(d.live) k.radial(cx - 0.05, cy - 0.5, 0.25, '#ff3a2a', 0.5); }
    for(let i=0;i<3;i++) xb.cable(k, [cx + k.R(-0.2, 0.2), cy + k.R(-0.2, 0.2), cx + k.R(-0.6, 0.6), cy + k.R(-0.6, 0.6), cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8)], k.pick(['#c83a2a', '#3a6ac8', '#c8a030']), 0.018);
    for(let i=0;i<3;i++) k.rust(cx + k.R(-0.3, 0.3), cy + k.R(-0.3, 0.3), k.R(0.05, 0.1), false); }
  const ROBOT = [{n:'Гуманоид'}, {n:'Гуманоид без ног, глаз светится', legless:true, live:true, col:'#8a7a5a'}, {n:'Паук-дрон', kind:'spider'}, {n:'Груда роботов', kind:'pile'}];
  A('robot_wreck', 'Разбитый робот', 'plains', 2, 2, {t:'робот андроид дрон остов металлолом свалка', v:ROBOT.length, vn:VN(ROBOT), hd:true}, (g, v)=>robotDraw(g, PV(ROBOT, v)));

  // Грузовой аэрокар: плоский корпус, турбины по углам, кабина, груз прутьев
  function aerocarDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.45, 0.4, 2.3, 4.4, 0.35); k.fill('rgba(0,0,0,.4)'); k.rr(0.35, 0.25, 2.3, 4.4, 0.35); metalFill(k, d.burnt ? '#3a3634' : '#c8a040', d.burnt ? 0.2 : 0.55); k.stroke(k.INK, 0.02);
    [[0.35, 0.6], [2.65, 0.6], [0.35, 4.3], [2.65, 4.3]].forEach(([x, y], i)=>{ c.beginPath(); c.arc(x, y, 0.42, 0, 6.28); metalFill(k, '#5a6068'); k.stroke(k.INK, 0.015); c.beginPath(); c.arc(x, y, 0.3, 0, 6.28); k.fill('#141618'); for(let j=0;j<8;j++){ const a = j/8*6.28 + i; k.line([x, y, x + Math.cos(a)*0.28, y + Math.sin(a)*0.28], '#4a5058', 0.03); } if(d.wreck && i===1){ c.beginPath(); c.arc(x, y, 0.42, 0, 6.28); k.fill('#0c0a08'); } });
    k.rr(0.9, 0.35, 1.2, 0.9, 0.3); k.fill('#1e2a34'); k.line([1.0, 0.5, 1.4, 0.45], 'rgba(160,210,230,.4)', 0.05);
    k.rr(0.7, 1.5, 1.6, 2.9, 0.05); k.fill('#2a2622'); const rods = d.spill ? 4 : 9; for(let i=0;i<rods;i++){ const x = 0.85 + i*0.16; k.line([x, 1.6, x, 4.3], '#b8783a', 0.08); k.line([x - 0.02, 1.6, x - 0.02, 4.3], 'rgba(255,220,160,.35)', 0.02); }
    if(d.spill) for(let i=0;i<9;i++){ const x = k.R(0.2, 2.8), y = k.R(4.6, 5.0), a = k.R(-0.8, 0.8); k.line([x, y - 1.2*Math.cos(a), x + Math.sin(a)*1.2, y], '#b8783a', 0.07); }
    if(d.wreck){ k.fillP([2.0, 2.0, 2.65, 1.6, 2.65, 3.0, 2.2, 2.8], '#0c0a08'); for(let i=0;i<8;i++) k.chunk(k.R(2.6, 2.95), k.R(1.2, 3.8), k.R(0.05, 0.12), '#c8a040', 0.03); }
    if(d.burnt) bits.fire(k, 2.2, 2.4, 0.25, 0.8);
    bits.stencil(k, 1.5, 4.55, 'ГРУЗ', 0.16, '#1a1816', 0.6); }
  const AEROCAR = [{n:'Разбит', wreck:true}, {n:'Груз рассыпан', spill:true, wreck:true}, {n:'Горит', burnt:true, wreck:true}, {n:'Почти цел'}];
  A('aerocar', 'Грузовой аэрокар', 'plains', 3, 5, {t:'аэрокар летающий грузовик крушение прутья бронза', v:AEROCAR.length, vn:VN(AEROCAR), hd:true}, (g, v)=>aerocarDraw(g, PV(AEROCAR, v)));

  // Остов шагохода: кабина, ноги, броня, орудие
  function mechDraw(g, d){ const k = hk(g), c = k.c, cx = 2, cy = 2;
    const legs = d.quad ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0.3], [1, 0.3]];
    legs.forEach(([sx, sy])=>{ const kx = cx + sx*1.0, ky = cy + sy*0.9, fx2 = cx + sx*1.7, fy = cy + sy*1.6; k.line([cx + 0.06, cy + 0.08, kx + 0.06, ky + 0.08, fx2 + 0.06, fy + 0.08], 'rgba(0,0,0,.4)', 0.24); k.line([cx, cy, kx, ky, fx2, fy], d.burnt ? '#2e2a27' : '#5a6050', 0.2); c.beginPath(); c.arc(kx, ky, 0.18, 0, 6.28); metalFill(k, '#4a4e50'); k.stroke(k.INK, 0.01); k.rr(fx2 - 0.25, fy - 0.2, 0.5, 0.4, 0.06); metalFill(k, '#4a4e50'); k.stroke(k.INK, 0.01); });
    k.rr(cx - 0.75, cy - 0.65, 1.5, 1.3, 0.2); k.fill('rgba(0,0,0,.4)'); k.rr(cx - 0.8, cy - 0.75, 1.5, 1.3, 0.2); metalFill(k, d.burnt ? '#2e2a27' : '#5e6650', 0.55); k.stroke(k.INK, 0.02); if(!d.burnt) bits.camo(k, cx - 0.75, cy - 0.7, 1.4, 1.2, ['#4a5040', '#6a6a50', '#3a3e30']);
    k.rr(cx - 0.35, cy - 0.65, 0.7, 0.35, 0.08); k.fill('#1a2228'); k.line([cx - 0.2, cy - 0.55, cx + 0.1, cy - 0.6], 'rgba(160,210,230,.35)', 0.04);
    k.line([cx + 0.3, cy + 0.1, cx + 1.5, cy - 0.7], '#2a2c2e', 0.12); k.line([cx + 0.3, cy + 0.1, cx + 1.5, cy - 0.7], 'rgba(255,255,255,.15)', 0.03);
    for(let i=0;i<6;i++) k.rust(cx + k.R(-0.7, 0.6), cy + k.R(-0.6, 0.5), k.R(0.05, 0.12), k.rnd() < 0.3);
    bits.stencil(k, cx - 0.2, cy + 0.25, d.burnt ? '' : '07', 0.22, '#d8d0b0', 0.5); if(d.burnt){ k.radial(cx, cy, 1.4, '#000', 0.35); } }
  const MECH = [{n:'Двуногий'}, {n:'Четырёхногий', quad:true}, {n:'Сгоревший', burnt:true, quad:true}];
  A('war_mech', 'Остов шагохода', 'military', 4, 4, {t:'шагоход мех робот война танк остов', v:MECH.length, vn:VN(MECH), hd:true}, (g, v)=>mechDraw(g, PV(MECH, v)));

  // Голова колосса: лоб, нос, глазницы — вид сверху на лежащую голову
  function headDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5, col = d.bronze ? '#5a8a7a' : '#9a948a';
    c.beginPath(); c.ellipse(cx + 0.18, cy + 0.24, 1.3, 1.1, 0.3, 0, 6.28); k.fill('rgba(0,0,0,.4)');
    c.beginPath(); c.ellipse(cx, cy, 1.3, 1.1, 0.3, 0, 6.28); k.texFill(d.bronze ? 'metal' : 'rock', col, col, 0.55); k.stroke(k.INK, 0.025);
    c.save(); c.beginPath(); c.ellipse(cx, cy, 1.3, 1.1, 0.3, 0, 6.28); c.clip(); c.fillStyle = k.lin(cx - 1.3, cy - 1.1, cx + 1.3, cy + 1.1, [[0, 'rgba(255,250,240,.25)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 3, 3);
    [[-0.45, -0.1], [0.35, 0.25]].forEach(([dx, dy])=>{ c.beginPath(); c.ellipse(cx + dx, cy + dy, 0.24, 0.14, 0.3, 0, 6.28); k.fill('rgba(10,8,6,.55)'); });
    k.line([cx - 0.1, cy - 0.05, cx + 0.15, cy + 0.6, cx - 0.05, cy + 0.7], 'rgba(10,8,6,.45)', 0.05); k.line([cx - 0.5, cy + 0.65, cx + 0.3, cy + 0.95], 'rgba(10,8,6,.5)', 0.04);
    for(let i=0;i<4;i++) k.line([cx + k.R(-1, 1), cy + k.R(-0.8, 0.8), cx + k.R(-1, 1), cy + k.R(-0.8, 0.8)], 'rgba(10,8,6,.5)', 0.025);
    if(d.bronze) for(let i=0;i<8;i++) k.blot(cx + k.R(-1, 1), cy + k.R(-0.8, 0.8), k.R(0.1, 0.25), '#7ab0a0', 0.35); else for(let i=0;i<3;i++) k.moss(cx + k.R(-0.9, 0.9), cy + k.R(-0.7, 0.7), k.R(0.15, 0.3));
    if(d.sand){ for(let i=0;i<4;i++){ k.organic(cx + k.R(-0.4, 1.2), cy + k.R(0.2, 1.2), k.R(0.4, 0.7), 0.35, k.R(0.25, 0.45)); k.texFill('sand', '#c8b080'); } } c.restore(); }
  const HEAD = [{n:'Каменная'}, {n:'Бронзовая, в патине', bronze:true}, {n:'По шею в песке', sand:true}];
  A('statue_head', 'Голова колосса', 'plains', 3, 3, {t:'статуя голова колосс древние руины скульптура', v:HEAD.length, vn:VN(HEAD), hd:true}, (g, v)=>headDraw(g, PV(HEAD, v)));

  // Биохранилище: шарообразный резервуар, лопнул — споры, грибы
  function bioTankDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5;
    if(d.burst){ k.radial(cx, cy, 1.5, '#a8c050', 0.35); for(let i=0;i<40;i++){ c.beginPath(); c.arc(cx + k.R(-1.4, 1.4), cy + k.R(-1.4, 1.4), k.R(0.015, 0.04), 0, 6.28); k.fill('rgba(220,240,150,.7)'); } }
    c.beginPath(); c.arc(cx + 0.18, cy + 0.24, 1.15, 0, 6.28); k.fill('rgba(0,0,0,.4)');
    c.beginPath(); c.arc(cx, cy, 1.15, 0, 6.28); c.fillStyle = (()=>{ const gr = c.createRadialGradient(cx - 0.4, cy - 0.4, 0.1, cx, cy, 1.15); gr.addColorStop(0, '#d8dcd4'); gr.addColorStop(1, '#6a7470'); return gr; })(); c.fill(); k.stroke(k.INK, 0.02);
    for(let i=0;i<8;i++){ const a = i/8*6.28; k.line([cx + Math.cos(a)*0.3, cy + Math.sin(a)*0.3, cx + Math.cos(a)*1.15, cy + Math.sin(a)*1.15], 'rgba(30,30,30,.25)', 0.02); }
    if(d.burst){ const hp = k.jag(cx + 0.2, cy + 0.1, 0.6, 11, 0.4); k.fillP(hp, '#1a2010'); k.poly(hp); k.stroke('#c8ccc4', 0.03); for(let i=0;i<10;i++){ const a = k.R(0, 6.28), r = k.R(0.3, 0.6); k.fillP([cx + 0.2 + Math.cos(a)*r, cy + 0.1 + Math.sin(a)*r, cx + 0.2 + Math.cos(a + 0.15)*(r + 0.25), cy + 0.1 + Math.sin(a + 0.15)*(r + 0.25), cx + 0.2 + Math.cos(a + 0.3)*r, cy + 0.1 + Math.sin(a + 0.3)*r], '#b8c0b8'); } }
    if(d.fungus){ for(let i=0;i<16;i++){ const a = k.R(0, 6.28), r = k.R(0.2, 1.3), x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r, rr = k.R(0.05, 0.12); c.beginPath(); c.arc(x, y, rr, 0, 6.28); k.fill(k.pick(['#c8b080', '#a8a060', '#e0d0a0'])); k.stroke('rgba(60,50,30,.5)', 0.008); c.beginPath(); c.arc(x - rr*0.3, y - rr*0.3, rr*0.3, 0, 6.28); k.fill('rgba(255,255,255,.4)'); } }
    k.line([cx - 0.6, cy - 0.7, cx - 0.2, cy - 0.95], 'rgba(255,255,255,.35)', 0.06); bits.stencil(k, cx, cy + 0.75, 'БИО-3', 0.18, '#2a3a2a', 0.55); }
  const BIOT = [{n:'Цело'}, {n:'Лопнуло, споры', burst:true}, {n:'Обросло грибами', fungus:true, burst:true}];
  A('bio_tank', 'Биохранилище', 'plains', 3, 3, {t:'биохранилище резервуар споры грибы заражение', v:BIOT.length, vn:VN(BIOT), hd:true}, (g, v)=>bioTankDraw(g, PV(BIOT, v)));

  // Паутина биома
  function webDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.orgK(cx, cy, 0.95, 0.3); k.fill(d.burnt ? 'rgba(20,16,12,.35)' : 'rgba(230,226,215,.12)');
    const col = d.burnt ? 'rgba(40,34,28,.6)' : 'rgba(240,236,226,.5)';
    for(let i=0;i<12;i++){ const a = i/12*6.28 + k.R(-0.1, 0.1); k.line([cx, cy, cx + Math.cos(a)*0.95, cy + Math.sin(a)*0.95], col, 0.01); }
    for(let r=0.15;r<0.95;r+=0.12){ c.beginPath(); for(let i=0;i<=12;i++){ const a = i/12*6.28, rr = r*k.R(0.9, 1.05); c.lineTo(cx + Math.cos(a)*rr, cy + Math.sin(a)*rr); } k.stroke(col, 0.008); }
    if(d.cocoons) for(let i=0;i<3;i++){ const x = cx + k.R(-0.6, 0.6), y = cy + k.R(-0.6, 0.6); c.beginPath(); c.ellipse(x, y, 0.08, 0.16, k.R(0, 3), 0, 6.28); k.fill('#e0dac8'); k.stroke('rgba(60,50,40,.5)', 0.008); }
    if(d.burnt) for(let i=0;i<8;i++) k.blot(cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8), k.R(0.05, 0.15), '#141210', 0.5); }
  const WEB = [{n:'Свежая'}, {n:'С коконами', cocoons:true}, {n:'Сожжённая', burnt:true}];
  A('web_mass', 'Липкая паутина', 'anomaly', 2, 2, {t:'паутина биом липкая сеть кокон', g:true, v:WEB.length, vn:VN(WEB), hd:true}, (g, v)=>webDraw(g, PV(WEB, v)));

  // Шлаковая лужа
  function slagDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.orgK(cx, cy, 0.9, 0.35, 0.75); k.fill('#1a1614'); k.orgK(cx, cy, 0.72, 0.35, 0.6); if(d.hot){ c.fillStyle = (()=>{ const gr = c.createRadialGradient(cx, cy, 0.05, cx, cy, 0.8); gr.addColorStop(0, '#ffe080'); gr.addColorStop(0.4, '#ff8a20'); gr.addColorStop(1, '#8a1a0a'); return gr; })(); c.fill(); k.radial(cx, cy, 1.0, '#ff6a10', 0.4); }
    else { k.texFill('glass', '#2e2c31'); }
    c.save(); k.orgK(cx, cy, 0.72, 0.35, 0.6); c.clip(); for(let i=0;i<8;i++){ const x = cx + k.R(-0.6, 0.6), y = cy + k.R(-0.5, 0.5); k.fillP(k.jag(x, y, k.R(0.06, 0.15), 6, 0.3), d.hot ? 'rgba(40,20,10,.7)' : 'rgba(80,76,84,.6)'); } c.restore();
    k.orgK(cx, cy, 0.9, 0.35, 0.75); k.stroke('rgba(10,8,6,.6)', 0.02); }
  const SLAG = [{n:'Раскалённый шлак', hot:true}, {n:'Остывший шлак'}];
  A('slag_pool', 'Шлаковая лужа', 'industry', 2, 2, {t:'шлак лава расплав печь металл', g:true, v:SLAG.length, vn:VN(SLAG), hd:true, lit:true}, (g, v)=>slagDraw(g, PV(SLAG, v)));

  /* ---- пещеры и шахты ---- */
  function oreDraw(g, d){ const k = hk(g), c = k.c; hdRock(k, 1, 1, 0.85, '#5a5650', {moss:false});
    c.save(); k.orgK(1, 1, 0.75, 0.3); c.clip(); for(let i=0;i<5;i++){ let x = k.R(0.3, 1.7), y = k.R(0.3, 1.7); const p = [x, y]; for(let j=0;j<4;j++){ x += k.R(-0.25, 0.25); y += k.R(-0.25, 0.25); p.push(x, y); } k.line(p, d.col[1], 0.09); k.line(p, d.col[0], 0.05); }
    for(let i=0;i<14;i++){ c.beginPath(); c.arc(k.R(0.3, 1.7), k.R(0.3, 1.7), k.R(0.02, 0.05), 0, 6.28); k.fill(d.col[0]); } c.restore(); if(d.glow) k.radial(1, 1, 0.9, d.col[0], 0.3);
    if(d.picks){ k.line([1.5, 1.5, 1.9, 1.9], '#6a5236', 0.04); k.line([1.42, 1.6, 1.62, 1.38], '#4a4e50', 0.05); } }
  const ORE = [{n:'Медь', col:['#5fb89a', '#2a5a48']}, {n:'Железо', col:['#b85a3a', '#5a2a1a']}, {n:'Бериллиевая бронза', col:['#e0b04a', '#7a5a1a'], picks:true}, {n:'Светящиеся кристаллы', col:['#7ae0ff', '#1a5a7a'], glow:true}];
  A('ore_vein', 'Рудная жила', 'under', 2, 2, {t:'руда жила медь железо порода шахта пещера', v:ORE.length, vn:VN(ORE), hd:true}, (g, v)=>oreDraw(g, PV(ORE, v)));
  function stalagDraw(g, d){ const k = hk(g), c = k.c; k.orgK(1, 1, 0.9, 0.3); k.fill('rgba(0,0,0,.18)');
    const n = 7 + Math.floor(k.rnd()*4); for(let i=0;i<n;i++){ const x = k.R(0.3, 1.7), y = k.R(0.3, 1.7), r = k.R(0.1, 0.26); k.fillP([x - r*0.6, y, x + r*0.6, y, x + r*2.2, y + r*2.6], '#000', 0.25);
      const gr = c.createRadialGradient(x - r*0.3, y - r*0.3, 0, x, y, r); gr.addColorStop(0, d.col[0]); gr.addColorStop(1, d.col[1]); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = gr; c.fill(); k.stroke('rgba(10,8,6,.45)', 0.008); for(let j=1;j<3;j++){ c.beginPath(); c.arc(x, y, r*j/3, 0, 6.28); k.stroke('rgba(255,255,255,.12)', 0.006); }
      if(d.wet){ c.beginPath(); c.arc(x - r*0.1, y - r*0.1, r*0.12, 0, 6.28); k.fill('rgba(220,240,255,.8)'); } }
    if(d.wet) k.puddle(1.2, 1.4, 0.35, 0.2); }
  const STALAG = [{n:'Известковые', col:['#d8d0bc', '#7a7262']}, {n:'Тёмные', col:['#7a746a', '#2e2a26']}, {n:'Мокрые, капает', col:['#c8ccc4', '#5a6058'], wet:true}];
  A('stalagmites', 'Сталагмиты', 'under', 2, 2, {t:'сталагмиты пещера натёки камень', v:STALAG.length, vn:VN(STALAG), hd:true}, (g, v)=>stalagDraw(g, PV(STALAG, v)));
  function cartDraw(g, d){ const k = hk(g), c = k.c; c.save(); if(d.tipped){ c.translate(0.5, 1); c.rotate(0.6); c.translate(-0.5, -1); }
    k.rr(0.12, 0.25, 0.8, 1.55, 0.05); k.fill('rgba(0,0,0,.4)'); [[0.15, 0.4], [0.85, 0.4], [0.15, 1.6], [0.85, 1.6]].forEach(([x, y])=>{ k.rr(x - 0.06, y - 0.12, 0.12, 0.24, 0.03); k.fill('#2a2826'); });
    k.rr(0.15, 0.2, 0.7, 1.6, 0.05); k.texFill('rust', '#6b5546', '#6a4a36', 0.4); k.stroke(k.INK, 0.015); k.rr(0.25, 0.3, 0.5, 1.4, 0.03); k.fill('#1c1916');
    if(d.ore){ for(let i=0;i<14;i++) k.chunk(k.R(0.3, 0.7), k.R(0.4, 1.6), k.R(0.05, 0.1), k.pick(['#6a6460', '#5fb89a', '#7a6a5a']), 0.02); }
    c.restore(); if(d.tipped) for(let i=0;i<8;i++) k.chunk(k.R(0.5, 0.95), k.R(1.3, 1.95), k.R(0.04, 0.09), k.pick(['#6a6460', '#5fb89a']), 0.02); }
  const CART = [{n:'Пустая'}, {n:'С рудой', ore:true}, {n:'Опрокинута', tipped:true, ore:true}];
  A('mine_cart', 'Вагонетка', 'under', 1, 2, {t:'вагонетка шахта рельсы руда', v:CART.length, vn:VN(CART), hd:true}, (g, v)=>cartDraw(g, PV(CART, v)));
  function headframeDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5;
    k.rr(0.7, 0.7, 1.6, 1.6, 0.03); k.fill('#0a0908'); k.rr(0.7, 0.7, 1.6, 1.6, 0.03); k.stroke('#4a4e50', 0.06);
    for(let i=0;i<4;i++) k.line([0.75, 0.9 + i*0.4, 2.25, 0.9 + i*0.4], 'rgba(120,100,70,.35)', 0.03);
    if(d.fallen){ k.line([0.3, 2.6, 2.9, 0.6], 'rgba(0,0,0,.4)', 0.22); k.line([0.2, 2.5, 2.8, 0.5], '#5a4a36', 0.16); for(let i=0;i<8;i++) k.chunk(k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.05, 0.14), '#6a5236', 0.03); return; }
    [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]].forEach(([x, y])=>{ k.line([x, y, cx, cy], '#5a4a36', 0.1); k.line([x + 0.05, y + 0.07, cx + 0.05, cy + 0.07], 'rgba(0,0,0,.3)', 0.1); });
    [[cx - 0.35, cy], [cx + 0.35, cy]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.32, 0, 6.28); metalFill(k, '#5a5e60'); k.stroke(k.INK, 0.015); for(let j=0;j<6;j++){ const a = j/6*6.28; k.line([x, y, x + Math.cos(a)*0.3, y + Math.sin(a)*0.3], '#3a3e40', 0.02); } });
    k.line([cx - 0.35, cy + 0.3, cx - 0.35, 2.3], '#1a1816', 0.015); k.line([cx + 0.35, cy + 0.3, cx + 0.35, 2.3], '#1a1816', 0.015); }
  const HEADF = [{n:'Копёр с колёсами'}, {n:'Рухнул', fallen:true}];
  A('mine_headframe', 'Шахтный копёр', 'under', 3, 3, {t:'шахта копёр подъёмник ствол клеть', v:HEADF.length, vn:VN(HEADF), hd:true}, (g, v)=>headframeDraw(g, PV(HEADF, v)));

  /* ---- карьер, промзона ---- */
  function drillDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5;
    k.rr(0.2, 0.2, 2.6, 2.6, 0.04); k.texFill('metal', '#6d7376', '#5a4a3a', 0.4); k.stroke(k.INK, 0.02);
    if(d.flood) { k.puddle(cx + 0.6, cy + 0.6, 0.9, 0.6); }
    [[0.35, 0.35], [2.65, 0.35], [0.35, 2.65], [2.65, 2.65]].forEach(([x, y])=>{ k.line([x + 0.08, y + 0.1, cx + 0.08, cy + 0.1], 'rgba(0,0,0,.35)', 0.1); k.line([x, y, cx, cy], '#8a5a3a', 0.08); });
    for(let r=0.3;r<1.2;r+=0.3){ k.rr(cx - r, cy - r, r*2, r*2, 0.01); k.stroke('#8a5a3a', 0.03); }
    c.beginPath(); c.arc(cx, cy, 0.14, 0, 6.28); k.fill('#2a2826'); k.stroke(k.INK, 0.01);
    k.rr(2.0, 0.3, 0.7, 0.5, 0.03); k.fill('#c8a030'); k.stroke(k.INK, 0.012); if(d.active){ k.radial(2.35, 0.55, 0.4, '#ffb040', 0.4); xb.cable(k, [2.0, 0.6, 1.6, 1.0, 1.5, 1.4], '#1a1816', 0.03); }
    if(!d.active) for(let i=0;i<5;i++) k.rust(k.R(0.4, 2.6), k.R(0.4, 2.6), k.R(0.06, 0.14), false); for(let i=0;i<3;i++) bits.barrel(k, 0.5 + i*0.3, 2.5, 0.12, '#3a5a8a'); }
  const DRILL = [{n:'Работает', active:true}, {n:'Брошена'}, {n:'Затоплена', flood:true}];
  A('drill_rig', 'Буровая вышка', 'industry', 3, 3, {t:'буровая вышка скважина нефть вода', v:DRILL.length, vn:VN(DRILL), hd:true}, (g, v)=>drillDraw(g, PV(DRILL, v)));
  function excavatorDraw(g, d){ const k = hk(g), c = k.c, col = d.rust ? '#8a5a3a' : '#d0a030';
    [[0.2, 1.3], [2.2, 1.3]].forEach(([x, y])=>{ k.rr(x + 0.05, y + 0.08, 0.6, 2.5, 0.08); k.fill('rgba(0,0,0,.4)'); k.rr(x, y, 0.6, 2.5, 0.08); k.fill('#2a2826'); for(let yy=y + 0.1;yy<y + 2.4;yy+=0.16) k.line([x + 0.02, yy, x + 0.58, yy], '#4a4846', 0.03); });
    k.rr(0.6, 1.6, 1.8, 1.7, 0.08); metalFill(k, col, 0.6); k.stroke(k.INK, 0.02); k.rr(0.75, 1.7, 0.7, 0.6, 0.06); k.fill('#1e2a34'); k.rr(1.6, 2.5, 0.7, 0.7, 0.04); k.fill(shade(col, -0.3));
    const bx = 1.8, by = d.nobucket ? 0.4 : 0.15; k.line([1.6, 1.7, 1.75, 0.9, bx, by + 0.3], 'rgba(0,0,0,.35)', 0.22); k.line([1.5, 1.6, 1.65, 0.8, bx, by + 0.25], col, 0.18); k.line([1.5, 1.6, 1.65, 0.8], 'rgba(255,255,255,.2)', 0.04);
    if(!d.nobucket){ k.rr(bx - 0.4, 0.05, 0.8, 0.45, 0.08); k.texFill('metal', '#5a5e60'); k.stroke(k.INK, 0.015); for(let i=0;i<5;i++) k.fillP([bx - 0.35 + i*0.17, 0.05, bx - 0.3 + i*0.17, -0.05, bx - 0.25 + i*0.17, 0.05], '#3a3e40'); } else { k.rr(0.2, 3.6, 0.8, 0.35, 0.08); k.texFill('metal', '#5a5e60'); }
    if(d.rust) for(let i=0;i<8;i++) k.rust(k.R(0.7, 2.3), k.R(1.7, 3.2), k.R(0.06, 0.15), k.rnd() < 0.3); }
  const EXCAV = [{n:'Цел'}, {n:'Ржавый', rust:true}, {n:'Ковш оторван', rust:true, nobucket:true}];
  A('excavator', 'Экскаватор', 'industry', 3, 4, {t:'экскаватор карьер техника ковш', v:EXCAV.length, vn:VN(EXCAV), hd:true}, (g, v)=>excavatorDraw(g, PV(EXCAV, v)));
  function dumpTruckDraw(g, d){ const k = hk(g), c = k.c, col = d.rust ? '#8a5a3a' : '#c8a030';
    [[0.2, 0.6], [2.4, 0.6], [0.2, 3.6], [2.4, 3.6]].forEach(([x, y])=>{ k.rr(x, y, 0.45, 0.9, 0.15); k.fill('#1c1b1a'); for(let i=0;i<5;i++) k.line([x, y + 0.15 + i*0.15, x + 0.45, y + 0.15 + i*0.15], '#3a3836', 0.025); });
    k.rr(0.55, 0.25, 1.95, 1.3, 0.06); k.fill('rgba(0,0,0,.35)'); k.rr(0.5, 0.15, 1.95, 1.3, 0.06); metalFill(k, col, 0.6); k.stroke(k.INK, 0.02); k.rr(0.65, 0.3, 0.8, 0.5, 0.05); k.fill('#1e2a34');
    k.rr(0.45, 1.6, 2.1, 3.25, 0.06); k.fill('rgba(0,0,0,.35)'); k.rr(0.4, 1.5, 2.1, 3.25, 0.06); metalFill(k, shade(col, -0.15), 0.6); k.stroke(k.INK, 0.02); k.rr(0.55, 1.65, 1.8, 2.95, 0.04); k.fill('#3a3026');
    if(d.load) for(let i=0;i<24;i++) k.chunk(k.R(0.7, 2.2), k.R(1.8, 4.5), k.R(0.06, 0.16), k.pick(['#7a7268', '#6a6460', '#5fb89a', '#8a6a4a']), 0.03);
    if(d.rust) for(let i=0;i<10;i++) k.rust(k.R(0.5, 2.4), k.R(0.3, 4.6), k.R(0.06, 0.18), k.rnd() < 0.25); }
  const DTRUCK = [{n:'Пустой'}, {n:'С породой', load:true}, {n:'Ржавый, с породой', load:true, rust:true}];
  A('dump_truck', 'Карьерный самосвал', 'industry', 3, 5, {t:'самосвал карьер грузовик техника', v:DTRUCK.length, vn:VN(DTRUCK), hd:true}, (g, v)=>dumpTruckDraw(g, PV(DTRUCK, v)));
  function pipeRackDraw(g, d){ const k = hk(g), c = k.c;
    for(let y=0.5;y<8;y+=1.5){ if(d.gap && y > 3 && y < 5) continue; k.rr(0.15, y - 0.08, 1.7, 0.16, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(0.1, y - 0.12, 1.7, 0.16, 0.02); k.fill('#5a5e60'); k.stroke(k.INK, 0.008); }
    const pipes = [[0.35, '#8a8e90', 0.12], [0.7, '#b8783a', 0.16], [1.1, '#3a6a8a', 0.14], [1.55, '#c8c8c0', 0.1]];
    pipes.forEach(([x, col, w])=>{ const seg = d.gap ? [[0.1, 3.2], [4.8, 7.9]] : [[0.1, 7.9]]; seg.forEach(([y0, y1])=>{ k.line([x + 0.05, y0 + 0.07, x + 0.05, y1 + 0.07], 'rgba(0,0,0,.35)', w); k.line([x, y0, x, y1], col, w); k.line([x - w*0.25, y0, x - w*0.25, y1], 'rgba(255,255,255,.3)', w*0.2); }); });
    if(d.gap){ k.line([0.7, 3.2, 1.2, 4.1], '#b8783a', 0.16); k.line([1.1, 3.2, 0.5, 3.9], '#3a6a8a', 0.14); for(let i=0;i<6;i++) k.chunk(k.R(0.2, 1.8), k.R(3.3, 4.7), k.R(0.05, 0.12), '#5a5e60', 0.02); }
    if(d.leak){ k.puddle(1.3, 5.3, 0.5, 0.3); k.organic(1.3, 5.3, 0.4, 0.4, 0.22); k.fill('#6ab030', 0.45); for(let i=0;i<4;i++) k.rust(k.pick([0.35, 0.7, 1.1]), k.R(0.5, 7.5), 0.07, false); } }
  const PRACK = [{n:'Целая'}, {n:'Течёт', leak:true}, {n:'Пролёт обрушен', gap:true}];
  A('pipe_rack', 'Эстакада трубопроводов', 'industry', 2, 8, {t:'трубопровод эстакада трубы завод', v:PRACK.length, vn:VN(PRACK), hd:true}, (g, v)=>pipeRackDraw(g, PV(PRACK, v)));
  function siloDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5, R = 1.3;
    c.beginPath(); c.arc(cx + 0.25, cy + 0.32, R, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, R, 0, 6.28); metalFill(k, d.rust ? '#8a6a50' : '#a8acae', 0.35);
    for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([cx + Math.cos(a)*0.2, cy + Math.sin(a)*0.2, cx + Math.cos(a)*R, cy + Math.sin(a)*R], 'rgba(20,20,20,.3)', 0.02); }
    c.beginPath(); c.arc(cx, cy, R, 0, 6.28); c.fillStyle = k.lin(cx - R, cy - R, cx + R, cy + R, [[0, 'rgba(255,255,255,.25)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fill(); k.stroke(k.INK, 0.02);
    c.beginPath(); c.arc(cx, cy, 0.22, 0, 6.28); k.fill('#5a5e60'); k.stroke(k.INK, 0.01); k.line([cx + R*0.7, cy - R*0.7, cx + R*0.95, cy - R*0.3], '#3a3e40', 0.04);
    if(d.rust) for(let i=0;i<8;i++) k.rust(cx + k.R(-1, 1), cy + k.R(-1, 1), k.R(0.08, 0.2), false);
    if(d.holed){ k.fillP(k.jag(cx + 0.4, cy + 0.3, 0.35, 9, 0.4), '#0a0908'); for(let i=0;i<14;i++) k.chunk(cx + k.R(0.5, 1.4), cy + k.R(0.5, 1.4), k.R(0.03, 0.07), '#c8b070', 0.01); } }
  const SILO = [{n:'Силос'}, {n:'Ржавый', rust:true}, {n:'Пробит, зерно высыпалось', holed:true, rust:true}];
  A('silo', 'Силос', 'industry', 3, 3, {t:'силос бункер элеватор хранилище', v:SILO.length, vn:VN(SILO), hd:true}, (g, v)=>siloDraw(g, PV(SILO, v)));
  function gantryDraw(g, d){ const k = hk(g), c = k.c;
    if(d.fallen){ c.save(); c.translate(2, 4); c.rotate(0.5); c.translate(-2, -4); }
    [[0.3, 0.2], [3.7, 0.2]].forEach(([x])=>{ k.rr(x - 0.25 + 0.06, 0.2 + 0.08, 0.5, 7.6, 0.04); k.fill('rgba(0,0,0,.35)'); k.rr(x - 0.25, 0.2, 0.5, 7.6, 0.04); metalFill(k, d.rust ? '#8a5a3a' : '#c8a030', 0.55); k.stroke(k.INK, 0.015); for(let y=0.4;y<7.6;y+=0.5){ k.line([x - 0.22, y, x + 0.22, y + 0.45], 'rgba(0,0,0,.4)', 0.02); } });
    const by = d.fallen ? 4 : 2.8; k.rr(0.05, by - 0.4, 3.9, 0.8, 0.04); k.fill('rgba(0,0,0,.35)'); k.rr(0, by - 0.45, 3.9, 0.8, 0.04); metalFill(k, d.rust ? '#8a5a3a' : '#c8a030', 0.55); k.stroke(k.INK, 0.02); for(let x=0.2;x<3.8;x+=0.4) k.line([x, by - 0.42, x + 0.35, by + 0.32], 'rgba(0,0,0,.35)', 0.02);
    k.rr(1.6, by - 0.35, 0.8, 0.6, 0.04); k.fill('#3a3e40'); k.stroke(k.INK, 0.012); k.line([2.0, by + 0.2, 2.0, by + 1.4], '#1a1816', 0.02); c.beginPath(); c.arc(2.0, by + 1.45, 0.08, 0, 6.28); k.stroke('#5a5e60', 0.03);
    if(d.rust) for(let i=0;i<6;i++) k.rust(k.R(0.2, 3.8), by + k.R(-0.4, 0.3), k.R(0.05, 0.12), false); if(d.fallen) c.restore(); }
  const GANTRY = [{n:'Стоит'}, {n:'Ржавый', rust:true}, {n:'Рухнул', rust:true, fallen:true}];
  A('gantry_crane', 'Портовый кран', 'industry', 4, 8, {t:'кран портовый козловой док погрузка', v:GANTRY.length, vn:VN(GANTRY), hd:true}, (g, v)=>gantryDraw(g, PV(GANTRY, v)));
  function stackDraw(g, d){ const k = hk(g), c = k.c; const cols = ['#8a3a2a', '#2a5a7a', '#3a6a3a', '#a8782a', '#5a5e60', '#7a2a5a'];
    const box = (x, y, w, h, col, lvl)=>{ k.rr(x + 0.06 + lvl*0.04, y + 0.08 + lvl*0.05, w, h, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(x, y, w, h, 0.02); k.texFill('corrugated', col, col, 0.55); k.stroke(k.INK, 0.012); k.rr(x, y, w, h, 0.02); c.fillStyle = `rgba(255,255,255,${0.05*lvl})`; c.fill(); for(let i=0;i<3;i++) k.rust(x + k.R(0.1, w - 0.1), y + k.R(0.1, h - 0.1), k.R(0.04, 0.1), false); };
    const slots = [[0.1, 0.1], [1.05, 0.1], [2.0, 0.1], [3.0, 0.1]];
    slots.forEach(([x, y], i)=>{ if(d.scatter && i===3) return; box(x, y, 0.9, 4.8, k.pick(cols), 0); });
    if(!d.scatter){ box(0.1, 0.3, 0.9, 4.4, k.pick(cols), 1); box(1.05, 0.2, 0.9, 4.5, k.pick(cols), 1); if(k.rnd() < 0.6) box(0.1, 0.5, 0.9, 4.0, k.pick(cols), 2); }
    else { c.save(); c.translate(3.4, 2.5); c.rotate(0.6); box(-0.45, -2.2, 0.9, 4.4, k.pick(cols), 0); c.restore(); }
    if(d.open){ k.rr(2.05, 4.3, 0.8, 0.5, 0.02); k.fill('#141210'); for(let i=0;i<4;i++) xb.box(k, 2.2 + k.R(0, 0.6), 4.9 + k.R(-0.1, 0.1), 0.25, 0.2, k.R(0, 3), '#7a6a4a'); } }
  const CSTACK = [{n:'Ровный штабель'}, {n:'Развален', scatter:true}, {n:'Вскрыт', open:true}];
  A('container_stack', 'Штабель контейнеров', 'industry', 4, 5, {t:'контейнеры штабель порт док склад', v:CSTACK.length, vn:VN(CSTACK), hd:true}, (g, v)=>stackDraw(g, PV(CSTACK, v)));

  /* ---- трасса ---- */
  function semiDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    c.save(); if(d.jack){ c.translate(1, 1.4); c.rotate(-0.5); c.translate(-1, -1.4); }
    k.rr(0.3, 0.25, 1.4, 1.3, 0.15); k.fill('rgba(0,0,0,.4)'); k.rr(0.25, 0.1, 1.4, 1.3, 0.15); metalFill(k, col, 0.6); k.stroke(k.INK, 0.02); k.rr(0.4, 0.2, 1.1, 0.45, 0.08); k.fill(d.burnt ? '#141210' : '#1e2a34'); c.restore();
    k.rr(0.25, 1.6, 1.5, 5.3, 0.04); k.fill('rgba(0,0,0,.4)'); k.rr(0.2, 1.5, 1.5, 5.3, 0.04);
    if(d.burnt){ k.fill('#1e1a18'); for(let y=1.7;y<6.7;y+=0.4) k.line([0.25, y, 1.65, y], '#3a3430', 0.04); bits.fire(k, 0.9, 3.5, 0.3, 0.6); }
    else if(d.reefer){ metalFill(k, '#d8d8d0', 0.3); k.stroke(k.INK, 0.02); for(let y=1.7;y<6.7;y+=0.5) k.line([0.25, y, 1.65, y], 'rgba(0,0,0,.18)', 0.02); k.rr(0.5, 1.6, 0.9, 0.35, 0.03); k.fill('#5a5e60'); }
    else { k.fill(d.tarp || '#5a6a4a'); k.stroke(k.INK, 0.02); for(let y=1.8;y<6.7;y+=0.55) k.line([0.2, y, 1.7, y], 'rgba(0,0,0,.25)', 0.04); k.line([0.95, 1.5, 0.95, 6.8], 'rgba(255,255,255,.12)', 0.06); }
    if(d.open){ k.rr(0.3, 6.0, 1.3, 0.8, 0.02); k.fill('#141210'); for(let i=0;i<6;i++) xb.box(k, k.R(0.3, 1.6), k.R(6.8, 6.98), 0.22, 0.18, k.R(0, 3), '#7a6a4a'); } }
  const SEMI = [{n:'Тентованная фура', col:'#7a3a2e', tarp:'#5a6a4a'}, {n:'Рефрижератор', col:'#3e5059', reefer:true}, {n:'Сгорела', burnt:true}, {n:'Сложилась, груз выпал', col:'#86703f', tarp:'#6a5a3a', jack:true, open:true}];
  A('semi_truck', 'Брошенная фура', 'waste', 2, 7, {t:'фура грузовик тягач прицеп трасса', v:SEMI.length, vn:VN(SEMI), hd:true}, (g, v)=>semiDraw(g, PV(SEMI, v)));
  function roadBillboardDraw(g, d){ const k = hk(g), c = k.c;
    [[0.6, 0.5], [2.4, 0.5]].forEach(([x, y])=>{ k.line([x + 0.05, y + 0.06, x + 0.4, y + 0.5], 'rgba(0,0,0,.35)', 0.08); c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#4a4e50'); });
    if(d.torn){ k.fillP([0.1, 0.2, 1.6, 0.18, 1.3, 0.62, 0.1, 0.65], '#c8b890'); k.stroke(k.INK, 0.012); k.line([1.7, 0.4, 2.9, 0.4], '#4a4e50', 0.04); return; }
    k.rr(0.12, 0.28, 2.9, 0.5, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(0.05, 0.18, 2.9, 0.5, 0.02); c.fillStyle = k.lin(0, 0, 3, 0, [[0, d.col[0]], [1, d.col[1]]]); c.fill(); k.stroke(k.INK, 0.015);
    bits.stencil(k, 1.5, 0.48, d.text, 0.2, '#f0e8d0', 0.85); c.save(); k.rr(0.05, 0.18, 2.9, 0.5, 0.02); c.clip(); c.fillStyle = 'rgba(240,230,210,.35)'; c.fillRect(0, 0, 3, 1); for(let i=0;i<6;i++) k.peel(k.R(0.2, 2.8), k.R(0.25, 0.6), k.R(0.05, 0.12), '#c8c0b0'); if(d.graffiti) k.graffiti(0.3, 0.25, 2.4, 0.35, '#c83a8a'); c.restore(); }
  const RBILL = [{n:'«Колонизируй будущее»', col:['#2a5a8a', '#8a3a2a'], text:'КОЛОНИЗИРУЙ БУДУЩЕЕ'}, {n:'«Мотель 50 км»', col:['#8a6a2a', '#5a2a1a'], text:'МОТЕЛЬ · 50 КМ'}, {n:'Исписан', col:['#3a6a4a', '#2a3a5a'], text:'ПЕЙ «ЗАРЮ»', graffiti:true}, {n:'Сорван', torn:true}];
  A('road_billboard', 'Придорожный щит', 'waste', 3, 1, {t:'реклама щит билборд трасса', v:RBILL.length, vn:VN(RBILL), hd:true}, (g, v)=>roadBillboardDraw(g, PV(RBILL, v)));
  function rackDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.15, 0.12, 0.8, 1.84, 0.03); k.fill('rgba(0,0,0,.4)'); k.rr(0.1, 0.06, 0.8, 1.84, 0.03); metalFill(k, '#2a2e32', 0.3); k.stroke(k.INK, 0.012);
    for(let y=0.15;y<1.85;y+=0.12){ k.rr(0.16, y, 0.68, 0.09, 0.01); k.fill(d.broken && k.rnd() < 0.3 ? '#0a0a0a' : '#1a1c1e'); if(!d.broken || k.rnd() < 0.5){ c.beginPath(); c.arc(0.25, y + 0.045, 0.015, 0, 6.28); k.fill(d.on ? k.pick(['#3ae050', '#3ae050', '#ffb040']) : '#2a2c2e'); } }
    if(d.frost){ c.fillStyle = 'rgba(230,240,245,.55)'; k.rr(0.1, 0.06, 0.8, 1.84, 0.03); c.fill(); for(let i=0;i<12;i++){ c.beginPath(); c.arc(k.R(0.15, 0.85), k.R(0.1, 1.85), k.R(0.02, 0.06), 0, 6.28); k.fill('rgba(255,255,255,.7)'); } }
    if(d.broken) xb.cable(k, [0.5, 1.0, 0.95, 1.4, 0.98, 1.9], '#c83a2a', 0.02); }
  const RACK = [{n:'Работает', on:true}, {n:'Обледенела', frost:true}, {n:'Разбита', broken:true}];
  A('server_rack', 'Серверная стойка', 'props', 1, 2, {t:'сервер стойка компьютер ферма данные', v:RACK.length, vn:VN(RACK), hd:true}, (g, v)=>rackDraw(g, PV(RACK, v)));
})();
