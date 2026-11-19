/* ======================================================================
   3D-КОСТИ — общий модуль (сейчас подключён в Кавалерии; геометрия и полёт — из Реинкарнатора,
   src/scripts/02-main/03-rendering-and-rolls.js и launchRollAnimation в 13-dice-panel.js).
   Кость — набор плоских div-граней, каждая поставлена в свою плоскость CSS matrix3d; выпавшая грань
   доворачивается к зрителю. к4 к6 к8 к10 к12 к20; к10 — пятиугольный трапецоэдр (грани-«воздушные змеи»,
   их контур считается из вершин). Dice3D.roll([{sides, value, label, tint, dim}], {from}) — кости летят
   через экран, отскакивают от краёв и оседают по центру; Promise — когда осели. Dice3D.clear() — убрать.
   prefers-reduced-motion — без полёта, сразу итог. Не больше 8 костей за раз.
   ====================================================================== */
const Dice3D = (function(){
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], scl=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
  const len=(a)=>Math.hypot(a[0],a[1],a[2]), nrm=(a)=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
  const crs=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], dist=(a,b)=>len(sub(a,b));
  const mat = (e1, e2, n, T, s)=>{ const c1=scl(e1,s), c2=scl(e2,s); return 'matrix3d('+[c1[0],c1[1],c1[2],0, c2[0],c2[1],c2[2],0, n[0],n[1],n[2],0, T[0],T[1],T[2],1].map(v=>v.toFixed(5)).join(',')+')'; };
  function rodrigues(axis, a){
    const [x,y,z]=axis, c=Math.cos(a), s=Math.sin(a), C=1-c;
    return [c+x*x*C, y*x*C+z*s, z*x*C-y*s, 0, x*y*C-z*s, c+y*y*C, z*y*C+x*s, 0, x*z*C+y*s, y*z*C-x*s, c+z*z*C, 0, 0,0,0,1];
  }
  // поворот, доворачивающий нормаль грани к зрителю (+Z)
  function settleMatrix(n){
    const d = n[2]; let axis = [n[1], -n[0], 0]; const al = Math.hypot(axis[0], axis[1]);
    if(al < 1e-9) return d > 0 ? [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] : [1,0,0,0, 0,-1,0,0, 0,0,-1,0, 0,0,0,1];
    axis = [axis[0]/al, axis[1]/al, 0];
    return rodrigues(axis, Math.acos(Math.max(-1, Math.min(1, d))));
  }
  const settleTransform = (n)=>'matrix3d(' + settleMatrix(n).map(v=>v.toFixed(5)).join(',') + ')';
  const dirMul = (M, v)=>[M[0]*v[0]+M[4]*v[1]+M[8]*v[2], M[1]*v[0]+M[5]*v[1]+M[9]*v[2], M[2]*v[0]+M[6]*v[1]+M[10]*v[2]];
  // угол, на который надо повернуть цифру, чтобы после доворота грани она читалась прямо
  function textRotations(faces){
    faces.forEach(f=>{ const m = settleMatrix(f.normal), vx = m[0]*f.e1[0]+m[4]*f.e1[1]+m[8]*f.e1[2], vy = m[1]*f.e1[0]+m[5]*f.e1[1]+m[9]*f.e1[2]; f.textRotation = -Math.atan2(vy, vx) * 180 / Math.PI; });
    return faces;
  }
  // грани-треугольники из настоящих вершин (к4, к8, к20): соседние грани сходятся рёбрами без зазоров
  function triFaces(verts, rPx, localR){
    let edge = Infinity;
    for(let i=0;i<verts.length;i++) for(let j=i+1;j<verts.length;j++) edge = Math.min(edge, dist(verts[i], verts[j]));
    const out = [];
    for(let i=0;i<verts.length;i++) for(let j=i+1;j<verts.length;j++) for(let k=j+1;k<verts.length;k++){
      const A=verts[i], B=verts[j], C=verts[k];
      if(Math.abs(dist(A,B)-edge)<1e-6 && Math.abs(dist(B,C)-edge)<1e-6 && Math.abs(dist(A,C)-edge)<1e-6){
        const G = scl(add(add(A,B),C), 1/3), n = nrm(G), e2 = nrm(scl(sub(A,G), -1)), e1 = crs(e2, n), s = len(sub(A,G)) * rPx / localR;
        out.push({normal:n, e1, verts:[A,B,C], centroid:G, matrix:mat(e1, e2, n, scl(G, rPx), s)});
      }
    }
    return textRotations(out);
  }
  function normalFaces(normals, rPx, localHalf){
    const s = rPx / localHalf;
    return textRotations(normals.map(raw=>{
      const n = nrm(raw), ref = Math.abs(n[2]) > 0.9 ? [1,0,0] : [0,0,1], e2 = nrm(sub(ref, scl(n, dot(ref, n)))), e1 = crs(e2, n);
      return {normal:n, e1, matrix:mat(e1, e2, n, scl(n, rPx), s)};
    }));
  }
  const T = (1 + Math.sqrt(5)) / 2;
  const ICO = [[0,1,T],[0,1,-T],[0,-1,T],[0,-1,-T],[1,T,0],[1,-T,0],[-1,T,0],[-1,-T,0],[T,0,1],[T,0,-1],[-T,0,1],[-T,0,-1]];
  const cache = {};
  function d20(){ return cache[20] || (cache[20] = triFaces(ICO, 50, 55)); }
  function d4(){ return cache[4] || (cache[4] = triFaces([[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]], 46, 55)); }
  function d8(){ return cache[8] || (cache[8] = triFaces([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], 78, 55)); }
  function d6(){ return cache[6] || (cache[6] = normalFaces([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], 50, 44)); }
  // к12 — двойственный икосаэдру: вершины грани — центроиды пяти граней икосаэдра вокруг его вершины
  function d12(){
    if(cache[12]) return cache[12];
    const ico = d20(), R = 40, LR = 55;
    cache[12] = textRotations(ICO.map(V=>{
      const pts = ico.filter(f=>f.verts.some(v=>dist(v, V) < 1e-6)).map(f=>f.centroid), nd = nrm(V);
      const u = nrm(sub(pts[0], scl(nd, dot(pts[0], nd)))), v2 = crs(nd, u);
      const sorted = pts.slice().sort((p, q)=>{ const pu = sub(p, scl(nd, dot(p, nd))), qu = sub(q, scl(nd, dot(q, nd))); return Math.atan2(dot(pu, v2), dot(pu, u)) - Math.atan2(dot(qu, v2), dot(qu, u)); });
      const G = scl(sorted.reduce((s, p)=>add(s, p), [0,0,0]), 1/5), n = nrm(G), A = sorted[0], e2 = nrm(scl(sub(A, G), -1)), e1 = crs(e2, n);
      return {normal:n, e1, matrix:mat(e1, e2, n, scl(G, R), len(sub(A, G)) * R / LR)};
    }));
    return cache[12];
  }
  // к10 — пятиугольный трапецоэдр: вершины-полюса (0,0,±h), два кольца по 5 точек на ±z0 со сдвигом 36°.
  // Плоскость грани: h = z0·(1 + cos36°)/(1 − cos36°). Контур грани («змей») считается из её вершин.
  let kiteClip = '', kiteEnamel = '';
  function d10(){
    if(cache[10]) return cache[10];
    const c36 = Math.cos(Math.PI / 5), z0 = 0.11, h = z0 * (1 + c36) / (1 - c36), R = 74, LR = 55;
    const up = [], lo = [];
    for(let k = 0; k < 5; k++){ const a = k * 2 * Math.PI / 5, b = a + Math.PI / 5; up.push([Math.cos(a), Math.sin(a), z0]); lo.push([Math.cos(b), Math.sin(b), -z0]); }
    const quads = [];
    for(let k = 0; k < 5; k++){ quads.push([[0,0,h], up[k], lo[k], up[(k + 1) % 5]]); quads.push([[0,0,-h], lo[k], up[(k + 1) % 5], lo[(k + 1) % 5]]); }
    const faces = quads.map(q=>{
      const A = q[0], G = scl(q.reduce((s, p)=>add(s, p), [0,0,0]), 1/4);
      let n = nrm(crs(sub(q[1], q[0]), sub(q[3], q[0]))); if(dot(n, G) < 0) n = scl(n, -1);
      const e2 = nrm(scl(sub(A, G), -1)), e1 = crs(e2, n), Rf = len(sub(A, G)), s = Rf * R / LR;
      const local = q.map(p=>{ const d = sub(p, G); return [55 + dot(d, e1) * LR / Rf, 55 + dot(d, e2) * LR / Rf]; });
      return {normal:n, e1, matrix:mat(e1, e2, n, scl(G, R), s), local};
    });
    // контур (одинаковый у всех граней): по кругу вокруг центра; эмаль — тот же контур, сжатый к центру
    const pts = faces[0].local.slice().sort((p, q)=>Math.atan2(p[1] - 55, p[0] - 55) - Math.atan2(q[1] - 55, q[0] - 55));
    const pct = (p, k)=>((55 + (p[0] - 55) * k) / 1.1).toFixed(2) + '% ' + ((55 + (p[1] - 55) * k) / 1.1).toFixed(2) + '%';
    kiteClip = 'polygon(' + pts.map(p=>pct(p, 1)).join(', ') + ')'; kiteEnamel = 'polygon(' + pts.map(p=>pct(p, .74)).join(', ') + ')';
    cache[10] = textRotations(faces);
    return cache[10];
  }
  const GEO = {4:[d4, 'tri'], 6:[d6, 'square'], 8:[d8, 'tri'], 10:[d10, 'kite'], 12:[d12, 'penta'], 20:[d20, 'tri']};
  const LIGHT = nrm([0.45, 0.6, 0.8]);
  const shapeOf = (sides)=>GEO[sides] ? sides : sides===3 ? 6 : sides===2 ? 6 : 20;

  // модель кости с выпавшей гранью value (1..sides)
  function model(sides, value, faceText){
    const g = GEO[shapeOf(sides)], faces = g[0](), shape = g[1];
    const idx = Math.max(0, Math.min(faces.length - 1, (value | 0) - 1));
    const scene = document.createElement('div'); scene.className = 'd3-icon';
    const spin = document.createElement('div'); spin.className = 'd3-spin';
    const body = document.createElement('div'); body.className = 'd3-body';
    const M = settleMatrix(faces[idx].normal);
    faces.forEach((f, i)=>{
      const face = document.createElement('div');
      face.className = 'd3-face shape-' + shape + (i===idx ? ' is-result' : '');
      face.style.transform = f.matrix + ' scale(1.06)';
      const light = Math.max(0, dot(dirMul(M, f.normal), LIGHT));
      face.style.filter = 'brightness(' + (0.55 + light * 0.8).toFixed(3) + ') drop-shadow(.8px .8px .5px rgba(0,0,0,.6)) drop-shadow(-.8px -.8px .5px rgba(255,255,255,.4))';
      if(shape==='kite') face.style.clipPath = kiteClip;
      const en = document.createElement('div'); en.className = 'd3-enamel shape-' + shape;
      if(shape==='kite') en.style.clipPath = kiteEnamel;
      const label = i===idx && faceText != null ? faceText : String(i + 1);
      en.innerHTML = '<span style="transform:rotate(' + f.textRotation.toFixed(2) + 'deg)' + (shape==='kite' ? ' translateY(8%)' : '') + '">' + label + '</span>';
      face.appendChild(en); body.appendChild(face);
    });
    body.style.transform = settleTransform(faces[idx].normal);
    spin.appendChild(body); scene.appendChild(spin);
    return {scene, spin};
  }
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let stage = null, gen = 0;
  function ensureStage(){ if(!stage){ stage = document.createElement('div'); stage.className = 'd3-stage'; document.body.appendChild(stage); } return stage; }
  function size(count){
    const base = Math.min(innerWidth, innerHeight) * 0.3;
    return count <= 1 ? Math.max(140, Math.min(base, 240)) : count===2 ? Math.max(120, Math.min(base * .75, 240)) : count <= 4 ? Math.max(96, Math.min(base * .55, 180)) : Math.max(72, Math.min(base * .42, 130));
  }
  const edge = (pad)=>{ const w = innerWidth, h = innerHeight, s = Math.floor(Math.random() * 4);
    return s===0 ? {x:pad, y:pad + Math.random() * (h - pad * 2)} : s===1 ? {x:w - pad, y:pad + Math.random() * (h - pad * 2)} : s===2 ? {x:pad + Math.random() * (w - pad * 2), y:pad} : {x:pad + Math.random() * (w - pad * 2), y:h - pad}; };
  // dice: [{sides, value, label, tint:'good'|'bad'|'', dim, face}] → Promise (кости осели)
  function roll(dice, opts){
    opts = opts || {};
    const st = ensureStage(), my = ++gen;
    st.innerHTML = ''; st.classList.add('show'); st.classList.toggle('dim', opts.dim!==false);
    const list = dice.slice(0, 8), sz = size(list.length), perRow = list.length > 4 ? Math.ceil(list.length / 2) : list.length;
    const cx = innerWidth / 2, cy = innerHeight / 2 - (opts.lift || 0);
    const from = opts.from || {left:innerWidth - 80, top:innerHeight - 80};
    const done = list.map((d, i)=>{
      const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, list.length - row * perRow), rows = Math.ceil(list.length / perRow);
      const ex = cx + (col - (inRow - 1) / 2) * sz * 1.02 - sz / 2, ey = cy + (row - (rows - 1) / 2) * sz * 1.1 - sz / 2;
      const wrap = document.createElement('div');
      wrap.className = 'd3-die' + (d.dim ? ' d3-dim' : '') + (d.tint ? ' d3-tint-' + d.tint : '');
      wrap.style.width = sz + 'px'; wrap.style.height = sz + 'px';
      const {scene, spin} = model(d.sides, d.value, d.face);
      wrap.appendChild(scene);
      if(d.label){ const l = document.createElement('div'); l.className = 'd3-label'; l.textContent = d.label; wrap.appendChild(l); }
      st.appendChild(wrap);
      const k = sz / 150, sc = `scale3d(${k.toFixed(4)},${k.toFixed(4)},${k.toFixed(4)})`;
      spin.style.transform = sc;
      if(reduce || opts.instant){ wrap.style.transform = `translate(${ex}px, ${ey}px)`; wrap.classList.add('d3-settled'); return Promise.resolve(); }
      const frames = [{transform:`translate(${from.left}px, ${from.top}px) rotate(0deg) scale(.45)`}];
      const hops = 2 + Math.floor(Math.random() * 2);
      for(let b = 0; b < hops; b++){ const p = edge(36); frames.push({transform:`translate(${p.x - sz / 2}px, ${p.y - sz / 2}px) rotate(${(Math.random() * 720 - 360).toFixed(0)}deg) scale(1)`}); }
      frames.push({transform:`translate(${ex}px, ${ey}px) rotate(0deg) scale(1)`});
      const dur = (opts.ms || 1500) + Math.random() * 400;
      const a = wrap.animate(frames, {duration:dur, easing:'cubic-bezier(.32,.08,.2,1)', fill:'forwards'});
      const tumble = [];
      for(let t = 0; t < 4; t++) tumble.push({transform:`rotate3d(${Math.random().toFixed(3)},${Math.random().toFixed(3)},${Math.random().toFixed(3)},${(260 + Math.random() * 400).toFixed(0)}deg) ${sc}`});
      tumble.push({transform:`rotate3d(1,0,0,0deg) ${sc}`});
      const sp = spin.animate(tumble, {duration:dur, easing:'linear', fill:'forwards'});
      // фоновая вкладка может заморозить анимацию — итог всё равно появится: досрочно завершаем полёт
      const late = new Promise(r=>setTimeout(r, dur + 600)).then(()=>{ try{ a.finish(); sp.finish(); }catch(e){} });
      return Promise.race([a.finished.catch(()=>{}), late]).then(()=>{ if(my===gen) wrap.classList.add('d3-settled'); });
    });
    return Promise.all(done).then(()=>my);
  }
  function clear(token){ if(token!=null && token!==gen) return; if(stage){ stage.classList.remove('show', 'dim'); stage.innerHTML = ''; } }
  return {roll, clear, model};
})();
