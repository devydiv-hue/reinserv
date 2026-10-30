/* ======================================================================
   РЕДАКТОР КАРТ — общее ядро (MapKit): формат карты, хранилище, отрисовка.
   Этим же кодом карта рисуется и в редакторе (вкладка «Редактор карт»), и на игровом столе, поэтому
   клетки и объекты совпадают по построению: единица координат карты = одна клетка стола (TABLE_CELL_PX
   пикселей при масштабе 100%), начало координат карты — её левый верхний угол, на столе он ставится в
   целую клетку (scene.x, scene.y). Ничего не растягивается из картинки и не пересчитывается — нечему
   накапливать погрешность.
   Формат (версионируемый, см. MapFormat.CURRENT_VERSION):
     { format:'reincarnator-map', version, id, name, cols, rows, metersPerCell, created, updated,
       terrain:'RLE' (тип ландшафта каждой клетки построчно), paths:[{id,kind,width,points}],
       walls:[{id,kind,points}], objects:[{id,a,x,y,r,s,v,f}], labels:[{id,x,y,text,size,color}] }
   Координаты объектов, путей и стен — в клетках (дробные допустимы); x,y объекта — его центр.
   ====================================================================== */
const TABLE_CELL_PX = 64;          // пикселей на клетку при масштабе 100% — общий для стола и редактора
const TABLE_METERS_PER_CELL = 3;   // главное правило: 1 клетка = 3 м

const MapFormat = (function(){
  const CURRENT_VERSION = 1;
  const MAX_SIDE = 200;
  const ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
  const TERRAIN = [
    {id:'void',     ch:'.', name:'Пусто (фон стола)', color:null},
    {id:'sand',     ch:'s', name:'Песок', color:'#d6be8a', sp:['#c7ab73','#e3cf9f']},
    {id:'dust',     ch:'d', name:'Сухая земля', color:'#b7a079', sp:['#a48b63','#c7b28b']},
    {id:'dirt',     ch:'e', name:'Грунт', color:'#8d7352', sp:['#786043','#9f855e']},
    {id:'mud',      ch:'m', name:'Грязь', color:'#5e4f3f', sp:['#4b3f32','#6d5c4a']},
    {id:'grass',    ch:'g', name:'Сухая трава', color:'#8a8854', sp:['#747245','#9f9c62']},
    {id:'mutant',   ch:'u', name:'Мутировавшая поросль', color:'#6b5970', sp:['#56465e','#88708e']},
    {id:'rock',     ch:'r', name:'Скальный грунт', color:'#878078', sp:['#726c65','#9c958b']},
    {id:'gravel',   ch:'v', name:'Щебень', color:'#9b958a', sp:['#7d776d','#b3ada1']},
    {id:'ash',      ch:'h', name:'Пепел', color:'#6b6763', sp:['#585450','#7e7974']},
    {id:'saltflat', ch:'l', name:'Солончак', color:'#d7d2c2', sp:['#c2bca7','#e6e2d6']},
    {id:'asphalt',  ch:'a', name:'Асфальт', color:'#53504b', sp:['#484541','#5f5c56']},
    {id:'cracked',  ch:'k', name:'Битый асфальт', color:'#5c5852', sp:['#3e3b37','#74706a'], cracks:true},
    {id:'concrete', ch:'c', name:'Бетон', color:'#9f9b91', sp:['#8f8b82','#aeaaa0']},
    {id:'tiles',    ch:'t', name:'Кафель', color:'#c8c1ad', tile:'#aea78f'},
    {id:'metal',    ch:'x', name:'Металлический пол', color:'#7a8388', plate:'#687176'},
    {id:'wood',     ch:'w', name:'Дощатый пол', color:'#896743', plank:'#745639'},
    {id:'carpet',   ch:'p', name:'Ковролин', color:'#6c4945', sp:['#60403d','#78534f']},
    {id:'water',    ch:'q', name:'Вода', color:'#3d5c67', sp:['#4b6c77','#35525f']},
    {id:'sewer',    ch:'y', name:'Сточная вода', color:'#4b503f', sp:['#5a6048','#404535']},
    {id:'toxic',    ch:'z', name:'Токсичная жижа', color:'#6e8e29', sp:['#8eb239','#5c791f']},
    {id:'rad',      ch:'n', name:'Радиоактивный грунт', color:'#7d883c', sp:['#a5b748','#687231'], glow:true},
    // Равнина, пещеры, промзоны (03b-map-wilds.js): фактуры — там же
    {id:'bog',      ch:'b', name:'Болото', color:'#4b5238', sp:['#5d6644','#3a412b']},
    {id:'acid',     ch:'i', name:'Кислотная вода', color:'#9a9638', sp:['#b8b448','#7a7628']},
    {id:'copper',   ch:'o', name:'Медистый грунт', color:'#7c6a52', sp:['#5f8a78','#8e5a3c']},
    {id:'glass',    ch:'j', name:'Оплавленное стекло', color:'#2e2c31', sp:['#46434a','#1e1d21']},
    {id:'crystal',  ch:'f', name:'Кристаллическая корка', color:'#8c90a6', sp:['#b4bcd8','#6a6e86']},
    {id:'frost',    ch:'F', name:'Иней', color:'#c3ccd0', sp:['#e4ecee','#a4b0b6']},
    {id:'scrap',    ch:'S', name:'Россыпь металлолома', color:'#5f564c', sp:['#7a5a40','#4a4640']},
    {id:'cave',     ch:'C', name:'Пол пещеры', color:'#4c4741', sp:['#5c5750','#3a3631']},
    {id:'bedrock',  ch:'B', name:'Толща породы', color:'#24221f', sp:['#2e2b28','#1a1816']},
    {id:'rustwater',ch:'W', name:'Ржавая вода', color:'#6e3a2c', sp:['#8a4a36','#562a20']},
  ];
  const T_BY_CH = {}, T_INDEX = {};
  TERRAIN.forEach((t, i)=>{ T_BY_CH[t.ch] = i; T_INDEX[t.id] = i; });
  const WALL_KINDS = {
    concrete:{name:'Бетон', fill:'#8e8a80', w:0.26}, brick:{name:'Кирпич', fill:'#8f5240', w:0.24, hatch:true},
    metal:{name:'Металл', fill:'#66737a', w:0.18}, wood:{name:'Доски', fill:'#7a5a39', w:0.16, hatch:true},
    scrap:{name:'Металлолом', fill:'#8a5333', w:0.22, rough:true}, sandbag:{name:'Мешки с песком', fill:'#b39b6a', w:0.34, bags:true},
    fence:{name:'Сетка-рабица', fill:'#6e7880', w:0.06, fence:true}, rock:{name:'Скала', fill:'#706a62', w:0.42, rough:true},
    plaster:{name:'Перегородка', fill:'#b9b1a2', w:0.12},
  };
  const PATH_KINDS = {
    road:{name:'Дорога', width:3}, sidewalk:{name:'Тротуар', width:5}, highway:{name:'Шоссе', width:5}, track:{name:'Грунтовка', width:2}, trail:{name:'Тропа', width:1},
    rail:{name:'Рельсы', width:1}, pipe:{name:'Трубопровод', width:0.7}, river:{name:'Река', width:2},
    dryriver:{name:'Сухое русло', width:2}, trench:{name:'Окоп', width:1}, cable:{name:'Кабель', width:0.2},
  };
  const num = (v, d)=>{ const x = Number(v); return isFinite(x) ? x : d; };
  const clamp = (v, a, b)=>Math.max(a, Math.min(b, v));
  const r3 = (v)=>Math.round(v*1000)/1000; // координаты храним с точностью до 0.001 клетки — без накопления хвостов
  const str = (v, n)=>v==null ? '' : String(v).slice(0, n);
  function newId(p){ return (p||'m') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function blank(cols, rows, base){
    cols = clamp(Math.round(num(cols, 40)), 4, MAX_SIDE); rows = clamp(Math.round(num(rows, 30)), 4, MAX_SIDE);
    const t = new Uint8Array(cols*rows); t.fill(T_INDEX[base] != null ? T_INDEX[base] : T_INDEX.dust);
    const now = Date.now();
    return { format:'reincarnator-map', version:CURRENT_VERSION, id:newId('map'), name:'Новая карта', cols, rows,
             metersPerCell:TABLE_METERS_PER_CELL, created:now, updated:now, terrain:t, paths:[], walls:[], objects:[], labels:[], assets:{} };
  }
  function encodeTerrain(arr){
    let out = '', prev = -1, run = 0;
    for(let i=0;i<arr.length;i++){
      if(arr[i]===prev){ run++; continue; }
      if(run) out += run + TERRAIN[prev].ch;
      prev = arr[i]; run = 1;
    }
    if(run) out += run + TERRAIN[prev].ch;
    return out;
  }
  function decodeTerrain(s, n){
    const t = new Uint8Array(n); t.fill(T_INDEX.dust);
    let i = 0; const re = /(\d+)([^\d])/g; let m;
    while((m = re.exec(String(s||''))) && i<n){ const idx = T_BY_CH[m[2]]; const cnt = Math.min(n - i, parseInt(m[1], 10)); t.fill(idx==null ? T_INDEX.dust : idx, i, i + cnt); i += cnt; }
    return t;
  }
  const pt = (p)=>[r3(clamp(num(p && p[0], 0), -10, MAX_SIDE + 10)), r3(clamp(num(p && p[1], 0), -10, MAX_SIDE + 10))];
  // Из JSON (файл, хранилище, сервер, игроку) — всё по белому списку; старые версии мигрируются здесь
  function fromJSON(raw){
    if(!raw || typeof raw!=='object' || raw.format!=='reincarnator-map') throw new Error('Это не файл карты «Реинкарнатора»');
    const ver = Math.round(num(raw.version, 1));
    if(ver > CURRENT_VERSION) throw new Error('Карта сохранена более новой версией редактора (v' + ver + ')');
    const cols = clamp(Math.round(num(raw.cols, 40)), 4, MAX_SIDE), rows = clamp(Math.round(num(raw.rows, 30)), 4, MAX_SIDE);
    const doc = { format:'reincarnator-map', version:CURRENT_VERSION, id: ID_RE.test(raw.id||'') ? raw.id : newId('map'),
      name: str(raw.name, 80) || 'Карта', cols, rows, metersPerCell: clamp(num(raw.metersPerCell, TABLE_METERS_PER_CELL), 0.5, 100),
      created: num(raw.created, Date.now()), updated: num(raw.updated, Date.now()),
      terrain: raw.terrain instanceof Uint8Array && raw.terrain.length===cols*rows ? raw.terrain.slice() : decodeTerrain(raw.terrain, cols*rows),
      paths:[], walls:[], objects:[], labels:[] };
    (Array.isArray(raw.paths) ? raw.paths : []).slice(0, 2000).forEach(p=>{
      if(!p || !PATH_KINDS[p.kind] || !Array.isArray(p.points) || p.points.length<2) return;
      doc.paths.push({ id: str(p.id, 64) || newId('p'), kind:p.kind, width: r3(clamp(num(p.width, PATH_KINDS[p.kind].width), 0.1, 20)), points: p.points.slice(0, 500).map(pt) });
    });
    (Array.isArray(raw.walls) ? raw.walls : []).slice(0, 5000).forEach(w=>{
      if(!w || !WALL_KINDS[w.kind] || !Array.isArray(w.points) || w.points.length<2) return;
      doc.walls.push({ id: str(w.id, 64) || newId('w'), kind:w.kind, points: w.points.slice(0, 500).map(pt) });
    });
    (Array.isArray(raw.objects) ? raw.objects : []).slice(0, 8000).forEach(o=>{
      if(!o || typeof o.a!=='string') return;
      doc.objects.push({ id: str(o.id, 64) || newId('o'), a: str(o.a, 64), x: pt([o.x, o.y])[0], y: pt([o.x, o.y])[1],
        r: r3(((num(o.r, 0) % 360) + 360) % 360), s: r3(clamp(num(o.s, 1), 0.1, 8)), v: Math.round(clamp(num(o.v, 0), 0, 99)), f: !!o.f });
    });
    (Array.isArray(raw.labels) ? raw.labels : []).slice(0, 1000).forEach(l=>{
      const text = str(l && l.text, 200).trim(); if(!text) return;
      doc.labels.push({ id: str(l.id, 64) || newId('l'), x: pt([l.x, l.y])[0], y: pt([l.x, l.y])[1], text, size: r3(clamp(num(l.size, 0.8), 0.2, 8)),
        color: /^#[0-9a-f]{6}$/i.test(l.color||'') ? l.color : '#1e1b18' });
    });
    doc.assets = {}; const ra = raw.assets && typeof raw.assets==='object' ? raw.assets : {};
    Object.keys(ra).slice(0, 300).forEach(id=>{ if(!/^u:[a-z0-9]{6,40}$/.test(id)) return; const m = ra[id] || {};
      const e = {name:str(m.name, 80) || 'Свой объект', w:r3(clamp(num(m.w, 1), 0.25, 60)), h:r3(clamp(num(m.h, 1), 0.25, 60)), g:!!m.g};
      if(typeof m.url==='string' && /^\/user-assets\/[a-z0-9]{6,40}\.(png|webp|jpg)$/.test(m.url)) e.url = m.url;
      if(typeof m.data==='string' && m.data.length < 12e6 && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(m.data)) e.data = m.data;
      doc.assets[id] = e; });
    const gn = sanitizeGen(raw.gen); if(gn) doc.gen = gn;
    return doc;
  }
  // Сведения о генерации: генератор, зерно, параметры и части (здания/комнаты) — для перегенерации по одной
  function sanitizeGen(gn){
    if(!gn || typeof gn!=='object' || !/^[a-z]{2,12}$/.test(gn.id || '')) return null;
    const I = (v)=>Math.round(clamp(num(v, 0), 0, MAX_SIDE)), out = {id:gn.id, seed:Math.round(clamp(num(gn.seed, 1), 1, 4294967295)), opts:{}, parts:[]};
    if(/^[a-z]{1,16}$/.test(gn.cond || '')) out.cond = gn.cond;
    if(gn.title && typeof gn.title.text==='string') out.title = {x:r3(clamp(num(gn.title.x, 0), 0, MAX_SIDE)), y:r3(clamp(num(gn.title.y, 0), 0, MAX_SIDE)), text:str(gn.title.text, 60)};
    // заметка Мастеру (препятствие Равнины: бросок, правило) — игрокам не уходит, см. MapStore.upload
    if(gn.note && typeof gn.note.text==='string') out.note = {title:str(gn.note.title, 80), text:str(gn.note.text, 1200)};
    const o = gn.opts && typeof gn.opts==='object' ? gn.opts : {}; ['density', 'ruin', 'theme', 'scenes', 'rooms', 'cond', 'prefabs', 'labels', 'lsize', 'ctype', 'perim', 'terr', 'csize', 'cstate',
      'site', 'size', 'state', 'profile', 'fence', 'mode', 'events', 'roadside', 'land', 'ore', 'hazard'].forEach(k=>{ if(typeof o[k]==='string' && /^[a-z0-9_]{1,16}$/.test(o[k])) out.opts[k] = o[k]; });
    (Array.isArray(gn.parts) ? gn.parts : []).slice(0, 400).forEach(p=>{ if(!p || (p.k!=='b' && p.k!=='r' && p.k!=='z')) return; const q = {k:p.k, x:I(p.x), y:I(p.y), w:I(p.w), h:I(p.h)}; if(!q.w || !q.h) return;
      if(Array.isArray(p.lot) && p.lot.length===4) q.lot = p.lot.map(I);
      ['arch', 'st', 'shape', 'zone', 'role', 'scene'].forEach(k=>{ if(typeof p[k]==='string' && /^[a-z0-9_]{1,40}$/.test(p[k])) q[k] = p[k]; });
      if(typeof p.name==='string') q.name = str(p.name, 60); if(typeof p.label==='string') q.label = str(p.label, 64); q.rooms = Math.round(clamp(num(p.rooms, 0), 0, 99));
      if(Array.isArray(p.rm)) q.rm = p.rm.slice(0, 40).filter(e=>Array.isArray(e) && e.length===5 && /^[a-z_]{1,24}$/.test(e[4] || '')).map(e=>[I(e[0]), I(e[1]), I(e[2]), I(e[3]), e[4]]);
      if(Array.isArray(p.ent)) q.ent = p.ent.slice(0, 80).filter(e=>Array.isArray(e) && e.length===3 && (e[2]==='h' || e[2]==='v')).map(e=>[I(e[0]), I(e[1]), e[2]]);
      out.parts.push(q); });
    return out;
  }
  function toJSON(doc){
    return { format:'reincarnator-map', version:CURRENT_VERSION, id:doc.id, name:doc.name, cols:doc.cols, rows:doc.rows, gen:doc.gen ? sanitizeGen(doc.gen) : undefined,
      metersPerCell:doc.metersPerCell, created:doc.created, updated:doc.updated, terrain:encodeTerrain(doc.terrain),
      paths:doc.paths, walls:doc.walls, objects:doc.objects, labels:doc.labels, assets:(function(){ const o = {}; Object.keys(doc.assets || {}).forEach(id=>{ const m = doc.assets[id]; o[id] = {name:m.name, w:m.w, h:m.h, g:!!m.g}; if(m.url) o[id].url = m.url; }); return o; })() }; // картинки (data) — только в экспорте
  }
  // Сменить размер: левый верхний угол на месте, новые клетки — базовым ландшафтом
  function resize(doc, cols, rows, base){
    cols = clamp(Math.round(cols), 4, MAX_SIDE); rows = clamp(Math.round(rows), 4, MAX_SIDE);
    const t = new Uint8Array(cols*rows); t.fill(T_INDEX[base] != null ? T_INDEX[base] : T_INDEX.dust);
    for(let y=0;y<Math.min(rows, doc.rows);y++) for(let x=0;x<Math.min(cols, doc.cols);x++) t[y*cols + x] = doc.terrain[y*doc.cols + x];
    doc.cols = cols; doc.rows = rows; doc.terrain = t;
  }
  return { CURRENT_VERSION, MAX_SIDE, ID_RE, TERRAIN, T_INDEX, WALL_KINDS, PATH_KINDS, blank, fromJSON, toJSON, encodeTerrain, decodeTerrain, resize, newId, r3, clamp, num };
})();

/* ---------- библиотека объектов: процедурные векторные ассеты ----------
   Каждый объект — функция рисования в собственных координатах (клетки, 0..w × 0..h, вид сверху) через
   маленький API g: прямоугольники, круги, многоугольники, линии, сетки окон, обломки, полосы опасности.
   Единая палитра P и общая обводка «тушью» — одна визуальная система. Варианты (v) меняют посев
   случайности (обломки, повреждения) и детали. ground:true — наземные объекты (разметка, лужи, тени),
   рисуются под стенами и предметами и без тени. */
const MapAssets = (function(){
  const P = {
    ink:'#1e1b18', con:'#a7a297', conD:'#86827a', conL:'#c3beb2', conDD:'#66625b',
    rust:'#8e4b2c', rustD:'#6b3820', rustL:'#b8693f', met:'#76828a', metD:'#525b61', metL:'#a3aeb4',
    sand:'#d8c08c', sandD:'#b99d66', wood:'#7d5b3a', woodD:'#5e4229', woodL:'#a17a52',
    pl:'#66733e', plD:'#48522a', plL:'#86945a', mut:'#7b4a78', mutL:'#a66aa2', mutD:'#57325a',
    tox:'#94c13a', toxD:'#5e8420', wat:'#3f6170', watL:'#5d8594', gl:'#86aab4', glD:'#5f8691',
    red:'#a8352b', redD:'#782620', yel:'#d0a72c', yelD:'#a07f1c', cl:'#857659', clL:'#ab9b79', clD:'#63573f',
    brk:'#94533f', brkD:'#6e3c2d', asp:'#46433f', aspL:'#5c5954', wh:'#e9e3d3', bk:'#151311', bone:'#dcd2b6',
    blood:'#5f1d18', glow:'#dcf56b', cyan:'#5fd1d6', vio:'#9d6cd6', fire:'#e3792b', fireL:'#f4c04e', tile:'#d2cbb7', gr:'#3f3a35',
  };
  const CATS = [
    ['city','Город'], ['mega','Мегаполис'], ['trade','Торговля'], ['life','Быт и общественные места'], ['industry','Промышленность'],
    ['military','Военные объекты'], ['waste','Пустоши'], ['camp','Лагерь'], ['anomaly','Зоны аномалий'], ['under','Подземелья'], ['nature','Природа'],
    ['props','Интерьер и предметы'],
  ];
  const LIST = [], BY_ID = {}, CUSTOM = []; // CUSTOM — свои объекты из PNG (CustomAssets)
  // A(id, название, категория, ширина, высота в клетках, {t:теги, v:вариантов, g:наземный}, рисование)
  function A(id, name, cat, w, h, o, draw){ const a = Object.assign({id, name, cat, w, h, v:1, g:false, t:''}, o || {}, {draw}); LIST.push(a); BY_ID[id] = a; }

  // ---- общие заготовки ----
  // Плоская крыша здания: парапет, плитка кровли, вентиляция/кондиционеры, повреждения по варианту
  function roof(g, x, y, w, h, base, opt){
    opt = opt || {};
    g.r(x, y, w, h, base);
    g.r(x + 0.18, y + 0.18, w - 0.36, h - 0.36, opt.inner || g.shade(base, -0.08), {lw:0.6});
    if(opt.tiles !== false){ g.grid(x + 0.18, y + 0.18, w - 0.36, h - 0.36, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), 'rgba(30,27,24,.12)', 0.02); }
    const n = opt.vents == null ? Math.max(1, Math.round(w*h/9)) : opt.vents;
    for(let i=0;i<n;i++){
      const vx = x + 0.6 + g.rnd()*(w - 1.6), vy = y + 0.6 + g.rnd()*(h - 1.6);
      if(g.rnd() < 0.5) g.r(vx, vy, 0.6, 0.45, P.metL, {rad:0.05}), g.c(vx + 0.3, vy + 0.22, 0.14, P.metD);
      else g.c(vx + 0.3, vy + 0.3, 0.28, P.conL), g.c(vx + 0.3, vy + 0.3, 0.12, P.conDD, {s:false});
    }
    if(opt.damage){ for(let i=0;i<opt.damage;i++){ const dx = x + 0.4 + g.rnd()*(w - 1.4), dy = y + 0.4 + g.rnd()*(h - 1.4), r = 0.35 + g.rnd()*0.6;
      g.blob(dx + r, dy + r, r, P.gr); g.rub(dx, dy, r*2.2, r*2.2, 5, [P.conD, P.con, P.rustD]); } }
  }
  function windowsRow(g, x, y, len, horiz, n){ for(let i=0;i<n;i++){ const t = (i + 0.5)/n*len; horiz ? g.r(x + t - 0.18, y - 0.05, 0.36, 0.1, P.gl, {s:false}) : g.r(x - 0.05, y + t - 0.18, 0.1, 0.36, P.gl, {s:false}); } }
  function car(g, x, y, w, h, body, wreck){
    g.r(x, y, w, h, body, {rad:0.22});
    g.r(x + 0.1, y + h*0.22, w - 0.2, h*0.18, wreck ? P.gr : P.glD, {rad:0.06});
    g.r(x + 0.12, y + h*0.42, w - 0.24, h*0.3, g.shade(body, 0.12), {rad:0.08});
    g.r(x + 0.1, y + h*0.74, w - 0.2, h*0.1, wreck ? P.gr : P.glD, {rad:0.05});
    if(wreck){ g.rub(x, y, w, h, 4, [P.rustD, P.rust]); g.blob(x + w*0.6, y + h*0.55, 0.18, P.rustD); }
  }
  /* ---- Брошенные машины (HD): генератор по описанию ----
     Вид сверху, капот вверх, 1×2 клетки. Описание машины: кузов, краска, чужие детали, повреждения.
     Кузова: sedan, hatch, wagon, pickup, suv, van. Поля повреждений (все необязательны):
       glass:{ws:'ok'|'crack'|'web'|'gone', rw:'ok'|'gone', l:'ok'|'gone', r:'ok'|'gone'}, wheels:[ПЛ,ПП,ЗЛ,ЗП] 'ok'|'flat'|'gone'|'rim',
       hood:'ok'|'open'|'gone', trunk:'ok'|'open'|'gone', bumperF/bumperR:'ok'|'hang'|'gone', mirrors:[л,п], lamps:[ПЛ,ПП,ЗЛ,ЗП] разбита,
       doors:[л,п] сняты, rust:0..3, roofHole, shots:{n, side:'l'|'r', glass}, dents, parts:{hood,trunk,doorL,doorR,fenderL,fenderR: цвет},
       roofRack, luggage, cargo, fuelOpen, plateBent, burnt, dust */
  const CAR_BODY = {
    sedan: {yT:0.05, yB:1.95, hood:0.565, ws:[0.6, 0.84], roof:[0.86, 1.38], rw:[1.41, 1.6], tr:1.635, ax:[0.42, 1.53], rf:0.12, rb:0.12},
    hatch: {yT:0.13, yB:1.87, hood:0.555, ws:[0.59, 0.82], roof:[0.84, 1.53], rw:[1.555, 1.71], tr:1.73, ax:[0.47, 1.5], rf:0.14, rb:0.09},
    wagon: {yT:0.05, yB:1.95, hood:0.55, ws:[0.585, 0.82], roof:[0.84, 1.73], rw:[1.755, 1.86], tr:1.875, ax:[0.42, 1.55], rf:0.12, rb:0.07},
    pickup:{yT:0.05, yB:1.95, hood:0.52, ws:[0.555, 0.74], roof:[0.76, 1.05], rw:[1.065, 1.12], bed:[1.16, 1.9], ax:[0.4, 1.56], rf:0.1, rb:0.04},
    suv:   {yT:0.06, yB:1.9, hood:0.5, ws:[0.535, 0.72], roof:[0.74, 1.72], rw:[1.745, 1.83], tr:1.845, ax:[0.42, 1.52], rf:0.07, rb:0.06, boxy:true},
    van:   {yT:0.05, yB:1.95, hood:0.17, ws:[0.2, 0.38], roof:[0.4, 1.9], rw:null, tr:null, ax:[0.36, 1.58], rf:0.12, rb:0.06, boxy:true},
  };
  const CAR_PAINT = {bordo:'#74372f', blue:'#3e5059', mustard:'#86703f', silver:'#8d9295', green:'#4d5a45', white:'#b7b4aa', brown:'#5e4636', grey:'#686a69', red:'#8a3a2e', navy:'#2f3a4a', khaki:'#6b6448', black:'#2c2b29', olive:'#5c6040', cream:'#a69a7a', primer:'#76726b', bare:'#8a8782'};
  function carDraw(g, d){
    const c = g.ctx, rnd = g.rnd, B = CAR_BODY[d.body] || CAR_BODY.sedan, burnt = !!d.burnt;
    const paint = burnt ? '#2e2a27' : (CAR_PAINT[d.paint] || d.paint || '#74372f');
    const pD = shade(paint, -0.45), pM = shade(paint, -0.2), pL = shade(paint, 0.2), pLL = shade(paint, 0.4);
    const INK = 'rgba(18,14,10,.55)', X0 = d.body==='van' || d.body==='suv' ? 0.09 : 0.1, X1 = 1 - X0, yT = B.yT, yB = B.yB;
    const gl = d.glass || {}, wh = d.wheels || ['ok', 'ok', 'ok', 'ok'], lamps = d.lamps || [], mir = d.mirrors || [true, true], doors = d.doors || [false, false], parts = d.parts || {};
    const rustL = d.rust==null ? 1 : d.rust, dustK = d.dust==null ? 1 : d.dust;
    const rr = (x, y, w, h, r)=>{ c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    const poly = (p)=>{ c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.closePath(); };
    const line = (p, col, w, a)=>{ c.save(); if(a!=null) c.globalAlpha = a; c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.restore(); };
    const fillP = (p, col, a)=>{ c.save(); if(a!=null) c.globalAlpha = a; poly(p); c.fillStyle = col; c.fill(); c.restore(); };
    const jag = (cx, cy, r, n, irr)=>{ c.beginPath(); for(let i=0;i<n;i++){ const an = i/n*Math.PI*2, dd = r*(1 - irr + rnd()*irr*2); const x = cx + Math.cos(an)*dd, y = cy + Math.sin(an)*dd; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
    const organic = (cx, cy, r, irr)=>{ const p1 = rnd()*6.3, p2 = rnd()*6.3, p3 = rnd()*6.3, n = 30; c.beginPath();
      for(let i=0;i<=n;i++){ const an = i/n*Math.PI*2, dd = r*(1 + irr*(0.5*Math.sin(3*an + p1) + 0.3*Math.sin(5*an + p2) + 0.2*Math.sin(9*an + p3))); const x = cx + Math.cos(an)*dd, y = cy + Math.sin(an)*dd; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
    const blot = (cx, cy, r, col, a)=>{ c.save(); c.globalAlpha = a; organic(cx, cy, r, 0.45); c.fillStyle = col; c.fill(); c.restore(); };
    const radial = (cx, cy, r, col, a)=>{ const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0)); c.fillStyle = gr; c.fillRect(cx - r, cy - r, r*2, r*2); };
    const seam = (p, w)=>{ line(p.map((q)=>q + 0.005), 'rgba(255,248,236,.26)', (w || 0.011)*0.8); line(p, 'rgba(10,8,6,.85)', w || 0.011); };
    const dent = (cx, cy, r)=>{ radial(cx + r*0.25, cy + r*0.3, r, '#000000', 0.32); radial(cx - r*0.3, cy - r*0.3, r*0.8, '#fffaf0', 0.22); };
    const rust = (cx, cy, r, hole)=>{
      if(!burnt){ c.save(); organic(cx, cy, r*1.25, 0.5); c.strokeStyle = hexA(pLL, 0.45); c.lineWidth = 0.006; c.stroke(); c.restore(); }
      organic(cx, cy, r, 0.22); const rg0 = c.createRadialGradient(cx, cy, 0, cx, cy, r*1.3); rg0.addColorStop(0, '#4a2616'); rg0.addColorStop(0.45, '#7a4126'); rg0.addColorStop(0.8, '#9a5a30'); rg0.addColorStop(1, 'rgba(154,90,48,.35)'); c.fillStyle = rg0; c.fill();
      blot(cx + r*0.15, cy - r*0.1, r*0.45, '#b0703c', 0.35);
      for(let i=0;i<Math.round(6 + r*60);i++){ const an = rnd()*Math.PI*2, dd = rnd()*r*0.9; c.fillStyle = rnd() < 0.7 ? 'rgba(36,20,12,.8)' : 'rgba(200,140,80,.6)'; c.beginPath(); c.arc(cx + Math.cos(an)*dd, cy + Math.sin(an)*dd, 0.004 + rnd()*0.008, 0, Math.PI*2); c.fill(); }
      if(hole){ jag(cx, cy, r*0.38, 10, 0.45); c.fillStyle = '#0c0a08'; c.fill(); c.strokeStyle = '#a2602f'; c.lineWidth = 0.008; c.stroke(); }
    };
    const peel = (cx, cy, r)=>{ organic(cx, cy, r, 0.6); c.fillStyle = hexA(pLL, 0.3); c.fill(); organic(cx + r*0.1, cy + r*0.1, r*0.55, 0.6); c.fillStyle = hexA(shade(paint, 0.55), 0.22); c.fill(); };
    const glassFill = (p, y0, y1, flip)=>{ poly(p); const gg = c.createLinearGradient(0, y0, 0, y1); gg.addColorStop(0, flip ? '#3d4c50' : '#26302f'); gg.addColorStop(1, flip ? '#26302f' : '#3d4c50'); c.fillStyle = gg; c.fill(); };
    // контур кузова: скругления спереди/сзади, борта чуть выпуклые посередине
    const body = ()=>{ const a = B.rf, b = B.rb, mid0 = yT + 0.55, mid1 = yB - 0.45; c.beginPath();
      c.moveTo(X0 + a*1.3, yT); c.lineTo(X1 - a*1.3, yT); c.bezierCurveTo(X1 - a*0.3, yT, X1, yT + a*0.3, X1, yT + a*1.3);
      c.lineTo(X1 + 0.012, mid0); c.lineTo(X1 + 0.012, mid1); c.lineTo(X1, yB - b*1.3); c.bezierCurveTo(X1, yB - b*0.3, X1 - b*0.3, yB, X1 - b*1.3, yB);
      c.lineTo(X0 + b*1.3, yB); c.bezierCurveTo(X0 + b*0.3, yB, X0, yB - b*0.3, X0, yB - b*1.3); c.lineTo(X0 - 0.012, mid1); c.lineTo(X0 - 0.012, mid0);
      c.lineTo(X0, yT + a*1.3); c.bezierCurveTo(X0, yT + a*0.3, X0 + a*0.3, yT, X0 + a*1.3, yT); c.closePath(); };
    const hoodY0 = yT + 0.07, hood1 = B.hood, W0 = B.ws[0], W1 = B.ws[1], R0 = B.roof[0], R1 = B.roof[1];
    const cabL = 0.205, cabR = 0.795, midRoof = (R0 + Math.min(R1, R0 + 0.55))/2;
    const shardsAt = (x0, x1, y0, y1, n)=>{ for(let i=0;i<n;i++){ const x = x0 + rnd()*(x1 - x0), y = y0 + rnd()*(y1 - y0); fillP([x, y, x + 0.02 + rnd()*0.015, y + (rnd() - 0.5)*0.02, x + 0.008, y + 0.016], 'rgba(198,212,212,.72)'); } };

    // --- 0. под машиной: лужа, осколки вокруг ---
    if(!burnt){ c.save(); c.globalAlpha = 0.4; c.beginPath(); c.ellipse(0.5 + (rnd() - 0.3)*0.25, (yT + yB)/2 + (rnd() - 0.5)*0.4, 0.4, 0.6, 0.15, 0, Math.PI*2); c.fillStyle = '#16130f'; c.fill(); c.restore(); }
    else { c.save(); c.globalAlpha = 0.5; c.beginPath(); c.ellipse(0.5, (yT + yB)/2, 0.6, 0.95, 0, 0, Math.PI*2); const sg = c.createRadialGradient(0.5, 1, 0.2, 0.5, 1, 0.95); sg.addColorStop(0, '#0e0c0a'); sg.addColorStop(1, 'rgba(14,12,10,0)'); c.fillStyle = sg; c.fill(); c.restore(); }
    if(gl.l==='gone' || gl.ws==='gone' || burnt) shardsAt(0.01, 0.09, W0, R1, burnt ? 6 : 10);
    if(gl.r==='gone' || gl.rw==='gone') shardsAt(0.91, 0.99, W0, R1, 10);

    // --- 1. колёса ---
    const wheel = (x, y, st)=>{
      if(st==='gone'){ c.fillStyle = 'rgba(10,9,8,.75)'; rr(x - 0.055, y - 0.16, 0.11, 0.32, 0.03); c.fill();
        c.beginPath(); c.arc(x, y, 0.065, 0, Math.PI*2); c.fillStyle = '#5e4232'; c.fill(); c.strokeStyle = '#2a1d15'; c.lineWidth = 0.008; c.stroke();
        c.beginPath(); c.arc(x, y, 0.028, 0, Math.PI*2); c.fillStyle = '#3d3632'; c.fill(); for(let i=0;i<5;i++){ const an = i/5*Math.PI*2; c.beginPath(); c.arc(x + Math.cos(an)*0.042, y + Math.sin(an)*0.042, 0.007, 0, Math.PI*2); c.fillStyle = '#8e8a84'; c.fill(); }
        const bx = x + (x < 0.5 ? -0.02 : 0.02); c.strokeStyle = INK; c.lineWidth = 0.006; rr(bx - 0.04, y + 0.075, 0.08, 0.05, 0.005); c.fillStyle = '#7a4434'; c.fill(); c.stroke(); rr(bx - 0.04, y - 0.125, 0.08, 0.05, 0.005); c.fillStyle = '#6b3b2e'; c.fill(); c.stroke(); return; }
      if(st==='rim'){ c.fillStyle = '#2a2624'; rr(x - 0.05, y - 0.15, 0.1, 0.3, 0.03); c.fill(); for(let i=0;i<5;i++) line([x - 0.04, y - 0.12 + i*0.06, x + 0.04, y - 0.12 + i*0.06], '#5a4a3e', 0.01); return; }
      const flat = st==='flat', w = flat ? 0.12 : 0.1, h = flat ? 0.34 : 0.32;
      c.fillStyle = flat ? '#161514' : '#1c1b1a'; rr(x - w/2, y - h/2, w, h, 0.04); c.fill();
      for(let i=0;i<9;i++){ const yy = y - h/2 + 0.025 + i*(h - 0.05)/8; c.fillStyle = 'rgba(70,67,63,.9)'; c.fillRect(x - w*0.32 + (i%2)*0.012, yy - 0.006, w*0.5, 0.012); }
    };
    const wx = d.body==='suv' || d.body==='van' ? 0.006 : 0.008;
    wheel(X0 + wx, B.ax[0], wh[0]); wheel(X1 - wx, B.ax[0], wh[1]); wheel(X0 + wx, B.ax[1], wh[2]); wheel(X1 - wx, B.ax[1], wh[3]);

    // --- 2. зеркала ---
    const my = W0 + 0.06, mirror = (x, s)=>{ c.save(); c.translate(x, my); c.rotate(s*0.25); rr(-0.045, -0.024, 0.09, 0.048, 0.018); c.fillStyle = pM; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); rr(s > 0 ? -0.005 : -0.035, -0.016, 0.04, 0.032, 0.01); c.fillStyle = burnt ? '#141210' : '#3e4b4f'; c.fill(); c.restore(); };
    if(mir[0]) mirror(X0 - 0.035, -1); else { c.fillStyle = '#2a2622'; c.fillRect(X0 - 0.024, my - 0.012, 0.02, 0.025); }
    if(mir[1]) mirror(X1 + 0.035, 1); else { c.fillStyle = '#2a2622'; c.fillRect(X1 + 0.004, my - 0.012, 0.02, 0.025); }

    // --- 3. кузов: краска, чужие детали, объём, износ ---
    body(); const gr = c.createLinearGradient(X0 - 0.012, 0, X1 + 0.012, 0);
    gr.addColorStop(0, pD); gr.addColorStop(0.12, pM); gr.addColorStop(0.3, paint); gr.addColorStop(0.45, pL); gr.addColorStop(0.62, paint); gr.addColorStop(0.88, pM); gr.addColorStop(1, pD);
    c.fillStyle = gr; c.fill();
    c.save(); body(); c.clip();
      // чужие детали: тот же объём, другой цвет
      const recolor = (p, col)=>{ const pc = CAR_PAINT[col] || col; poly(p); const hg = c.createLinearGradient(X0, 0, X1, 0); hg.addColorStop(0, shade(pc, -0.45)); hg.addColorStop(0.2, shade(pc, -0.15)); hg.addColorStop(0.45, shade(pc, 0.18)); hg.addColorStop(0.8, shade(pc, -0.15)); hg.addColorStop(1, shade(pc, -0.45)); c.fillStyle = hg; c.fill(); };
      if(parts.hood) recolor([0.13, hoodY0, 0.87, hoodY0, 0.875, hood1, 0.125, hood1], parts.hood);
      if(parts.trunk && B.tr) recolor([0.13, B.tr, 0.87, B.tr, 0.87, yB - 0.01, 0.13, yB - 0.01], parts.trunk);
      if(parts.fenderL) recolor([0, yT, 0.165, yT, 0.165, W0, 0, W0], parts.fenderL);
      if(parts.fenderR) recolor([0.835, yT, 1, yT, 1, W0, 0.835, W0], parts.fenderR);
      const dEnd = d.body==='pickup' ? R1 : Math.min(R1, W0 + 0.95);
      if(parts.doorL) recolor([0, W0 + 0.02, 0.21, W0 + 0.02, 0.21, dEnd, 0, dEnd], parts.doorL);
      if(parts.doorR) recolor([0.79, W0 + 0.02, 1, W0 + 0.02, 1, dEnd, 0.79, dEnd], parts.doorR);
      // скаты к носу и корме, блик по гребню
      let s1 = c.createLinearGradient(0, yT, 0, yT + 0.25); s1.addColorStop(0, 'rgba(0,0,0,.34)'); s1.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = s1; c.fillRect(0, yT, 1, 0.25);
      s1 = c.createLinearGradient(0, yB - 0.22, 0, yB); s1.addColorStop(0, 'rgba(0,0,0,0)'); s1.addColorStop(1, 'rgba(0,0,0,.34)'); c.fillStyle = s1; c.fillRect(0, yB - 0.22, 1, 0.22);
      const sp = c.createLinearGradient(0.3, 0, 0.5, 0); sp.addColorStop(0, 'rgba(255,250,240,0)'); sp.addColorStop(0.5, burnt ? 'rgba(255,250,240,.06)' : 'rgba(255,250,240,.2)'); sp.addColorStop(1, 'rgba(255,250,240,0)'); c.fillStyle = sp; c.fillRect(0, 0, 1, 2);
      if(burnt){ // гарь: окалина, ржавые проплешины, белёсый пепел
        for(let i=0;i<10;i++) blot(0.15 + rnd()*0.7, yT + 0.1 + rnd()*(yB - yT - 0.2), 0.06 + rnd()*0.12, rnd() < 0.5 ? '#6a3a22' : '#8a4a28', 0.55 + rnd()*0.3);
        for(let i=0;i<7;i++) blot(0.15 + rnd()*0.7, yT + 0.1 + rnd()*(yB - yT - 0.2), 0.04 + rnd()*0.08, '#b8b2a6', 0.25 + rnd()*0.25);
        for(let i=0;i<5;i++) blot(0.15 + rnd()*0.7, yT + 0.1 + rnd()*(yB - yT - 0.2), 0.05 + rnd()*0.08, '#0c0b0a', 0.6);
      } else {
        for(let i=0;i<4;i++) blot(0.25 + rnd()*0.5, yT + 0.1 + rnd()*(yB - yT - 0.2), 0.06 + rnd()*0.08, pLL, 0.13);
        for(let i=0;i<3 + rustL*2;i++) peel(0.22 + rnd()*0.56, rnd() < 0.5 ? hoodY0 + 0.05 + rnd()*(hood1 - hoodY0 - 0.08) : yB - 0.1 - rnd()*0.22, 0.02 + rnd()*0.035);
      }
      // ржавчина: арки, пороги, кромки — по уровню
      if(rustL > 0){
        const ar = 0.05 + rustL*0.025;
        [[X0 - 0.005, B.ax[0]], [X1 + 0.005, B.ax[0]], [X0 - 0.005, B.ax[1]], [X1 + 0.005, B.ax[1]]].forEach(([x, y])=>rust(x, y, ar + rnd()*0.03, rustL >= 3 && rnd() < 0.5));
        for(let i=0;i<rustL*2;i++) rust(rnd() < 0.5 ? X0 + 0.012 : X1 - 0.012, W0 + rnd()*(R1 - W0), 0.02 + rnd()*0.02*rustL, rustL >= 3 && rnd() < 0.3);
        rust(0.2 + rnd()*0.6, yT + 0.03, 0.02 + rustL*0.01, false); rust(0.2 + rnd()*0.6, yB - 0.03, 0.02 + rustL*0.012, false);
        if(rustL >= 2) rust(0.3 + rnd()*0.4, hoodY0 + 0.1 + rnd()*(hood1 - hoodY0 - 0.2), 0.03 + rnd()*0.03, rustL >= 3);
      }
      for(let i=0;i<(d.dents==null ? 2 : d.dents);i++) dent(0.25 + rnd()*0.5, rnd() < 0.5 ? hoodY0 + 0.1 + rnd()*0.3 : yB - 0.1 - rnd()*0.2, 0.06 + rnd()*0.05);
      let dg = c.createLinearGradient(X0 - 0.012, 0, X0 + 0.07, 0); dg.addColorStop(0, 'rgba(70,58,44,.55)'); dg.addColorStop(1, 'rgba(70,58,44,0)'); c.fillStyle = dg; c.fillRect(0, 0, 0.2, 2);
      dg = c.createLinearGradient(X1 + 0.012, 0, X1 - 0.07, 0); dg.addColorStop(0, 'rgba(70,58,44,.55)'); dg.addColorStop(1, 'rgba(70,58,44,0)'); c.fillStyle = dg; c.fillRect(0.8, 0, 0.2, 2);
      radial(0.5, (hoodY0 + hood1)/2, 0.36, '#bfb5a0', 0.13*dustK); radial(0.5, yB - 0.17, 0.3, '#bfb5a0', 0.12*dustK);
    c.restore();
    body(); c.lineWidth = 0.014; c.strokeStyle = INK; c.stroke();

    // --- 4. снятые двери: проём, видно сиденье ---
    [[0, X0 - 0.012, 0.165], [1, 0.835, X1 + 0.012]].forEach(([i, xa, xb])=>{ if(!doors[i]) return; const y0 = W0 + 0.03, y1 = Math.min(R1, W0 + 0.6);
      c.fillStyle = '#12100e'; c.fillRect(xa, y0, xb - xa, y1 - y0); rr(i ? xa + 0.005 : xb - 0.06, y0 + 0.12, 0.055, 0.2, 0.02); c.fillStyle = burnt ? '#2a2420' : '#4a3c32'; c.fill(); line([i ? xa + 0.02 : xb - 0.04, y0 + 0.14, i ? xa + 0.02 : xb - 0.04, y0 + 0.3], 'rgba(20,16,12,.6)', 0.006); });

    // --- 5. швы, молдинги, ручки, лючок ---
    if(d.hood!=='gone'){ seam([0.165, hoodY0, 0.17, hood1]); seam([0.835, hoodY0, 0.83, hood1]); }
    if(B.tr && d.trunk!=='open'){ seam([0.165, B.tr, 0.175, yB - 0.05]); seam([0.835, B.tr, 0.825, yB - 0.05]); c.beginPath(); c.moveTo(0.175, B.tr); c.quadraticCurveTo(0.5, B.tr + 0.02, 0.825, B.tr); c.strokeStyle = 'rgba(10,8,6,.85)'; c.lineWidth = 0.011; c.stroke(); }
    const dEnd2 = d.body==='pickup' ? R1 : Math.min(R1 + 0.1, W0 + 0.92);
    [[X0 + 0.004, 1, 0], [X1 - 0.004, -1, 1]].forEach(([x, s, i])=>{
      if(!doors[i]){ seam([x, W0 + 0.02, x + s*0.06, W0 + 0.02]); seam([x, (W0 + dEnd2)/2, x + s*0.06, (W0 + dEnd2)/2]); }
      if(d.body!=='pickup') seam([x, dEnd2, x + s*0.06, dEnd2]);
      line([x + s*0.012, W0 + 0.06, x + s*0.012, dEnd2 - 0.04], '#24211e', 0.014); line([x + s*0.02, W0 + 0.06, x + s*0.02, dEnd2 - 0.04], 'rgba(200,196,188,.22)', 0.004);
      if(!doors[i]){ rr(x + s*0.025 - 0.012, W0 + 0.38, 0.024, 0.055, 0.008); c.fillStyle = '#4c4945'; c.fill(); if(d.body!=='pickup' && d.body!=='van'){ rr(x + s*0.025 - 0.012, dEnd2 - 0.14, 0.024, 0.055, 0.008); c.fill(); } } });
    if(d.body!=='van'){ const fy = B.ax[1] + 0.02; rr(X1 - 0.07, fy, 0.05, 0.05, 0.01); c.strokeStyle = 'rgba(10,8,6,.8)'; c.lineWidth = 0.008; c.stroke(); if(d.fuelOpen){ c.fillStyle = '#1a1714'; c.beginPath(); c.arc(X1 - 0.045, fy + 0.025, 0.012, 0, Math.PI*2); c.fill(); } }

    // --- 6. перед: решётка, фары, номер, бампер; без капота — моторный отсек ---
    const gy = yT + 0.012, boxy = !!B.boxy;
    rr(0.33, gy, 0.34, 0.06, boxy ? 0.006 : 0.018); c.fillStyle = '#1d1b19'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke();
    for(let i=0;i<4;i++) line([0.345, gy + 0.013 + i*0.012, 0.655, gy + 0.013 + i*0.012], burnt ? '#3a3633' : '#6a6660', 0.005);
    if(!burnt){ c.beginPath(); c.arc(0.5, gy + 0.03, 0.014, 0, Math.PI*2); c.fillStyle = '#9c9890'; c.fill(); }
    const lamp = (x, broken)=>{ const ly = yT + 0.025; if(boxy){ rr(x - 0.06, ly, 0.12, 0.07, 0.01); } else rr(x - 0.075, ly, 0.15, 0.06, 0.02); c.fillStyle = '#1a1917'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke();
      const pts = boxy ? [x] : [x - 0.035, x + 0.03];
      pts.forEach((lx, i)=>{ const rad = boxy ? 0.028 : 0.022, cy = ly + (boxy ? 0.035 : 0.03); const rg = c.createRadialGradient(lx - 0.006, cy - 0.005, 0, lx, cy, rad); const dead = broken || burnt; rg.addColorStop(0, dead && (i || boxy) ? '#2a2826' : '#e2ded2'); rg.addColorStop(1, dead && (i || boxy) ? '#141312' : '#7d7a72'); c.fillStyle = rg; c.beginPath(); c.arc(lx, cy, rad, 0, Math.PI*2); c.fill(); });
      if(broken && !burnt) for(let i=0;i<6;i++) line([x, ly + 0.03, x + (rnd() - 0.5)*0.14, ly + 0.03 + (rnd() - 0.5)*0.05], 'rgba(220,228,228,.6)', 0.004);
      else if(!burnt) line([x - 0.05, ly + 0.012, x + 0.02, ly + 0.008], 'rgba(255,255,255,.5)', 0.007);
      if(!burnt){ rr(x < 0.5 ? x - (boxy ? 0.085 : 0.1) : x + (boxy ? 0.06 : 0.075), ly + 0.005, 0.025, 0.045, 0.008); c.fillStyle = '#8f6a2c'; c.fill(); } };
    lamp(boxy ? 0.24 : 0.25, lamps[0]); lamp(boxy ? 0.76 : 0.75, lamps[1]);
    const plate = (y, bent)=>{ if(burnt) return; c.save(); c.translate(0.5, y); if(bent) c.rotate(0.2); rr(-0.1, -0.017, 0.2, 0.034, 0.005); c.fillStyle = '#bdb8a8'; c.fill(); c.strokeStyle = '#3a3733'; c.lineWidth = 0.005; c.stroke();
      for(let i=0;i<6;i++){ c.fillStyle = '#2c2a27'; c.fillRect(-0.085 + i*0.03, -0.009, 0.016, 0.018); } c.restore(); };
    const bF = d.bumperF || 'ok';
    if(bF==='hang'){ c.save(); c.translate(0.14, yT - 0.015); c.rotate(-0.42); rr(0, -0.028, 0.66, 0.056, 0.022); c.fillStyle = '#34322f'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); for(let i=0;i<4;i++) line([0.1 + i*0.13, -0.01, 0.16 + i*0.13, 0.008], 'rgba(170,166,158,.45)', 0.005); c.restore(); plate(yT - 0.01, true); }
    else if(bF==='ok'){ c.beginPath(); c.moveTo(0.15, yT - 0.01); c.quadraticCurveTo(0.5, yT - (boxy ? 0.015 : 0.05), 0.85, yT - 0.01); c.strokeStyle = boxy ? '#2a2826' : '#34322f'; c.lineWidth = boxy ? 0.05 : 0.045; c.lineCap = boxy ? 'butt' : 'round'; c.stroke(); for(let i=0;i<5;i++){ const x = 0.2 + rnd()*0.6; line([x, yT - 0.024, x + 0.04, yT - 0.02], 'rgba(170,166,158,.5)', 0.004); } plate(yT - 0.02, d.plateBent); }
    if(d.hood==='gone' || d.hood==='open'){ // моторный отсек
      const ex0 = 0.15, ex1 = 0.85, ey0 = hoodY0 + (d.hood==='open' ? 0.08 : 0), ey1 = hood1 - 0.005;
      poly([ex0, ey0, ex1, ey0, ex1 + 0.005, ey1, ex0 - 0.005, ey1]); c.fillStyle = '#16130f'; c.fill();
      c.save(); poly([ex0, ey0, ex1, ey0, ex1 + 0.005, ey1, ex0 - 0.005, ey1]); c.clip();
        rr(ex0 + 0.02, ey0 + 0.01, ex1 - ex0 - 0.04, 0.05, 0.01); c.fillStyle = '#2a2826'; c.fill(); for(let i=0;i<12;i++) line([ex0 + 0.04 + i*0.05, ey0 + 0.015, ex0 + 0.04 + i*0.05, ey0 + 0.055], '#3e3a36', 0.008); // радиатор
        rr(0.33, ey0 + 0.09, 0.3, (ey1 - ey0) - 0.13, 0.03); c.fillStyle = burnt ? '#2e2a26' : '#4a4642'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); // блок
        rr(0.36, ey0 + 0.11, 0.24, (ey1 - ey0) - 0.17, 0.02); c.fillStyle = burnt ? '#3a2a20' : '#6b4a36'; c.fill(); for(let i=0;i<4;i++){ c.beginPath(); c.arc(0.42 + i*0.04, ey0 + 0.11 + ((ey1 - ey0) - 0.17)/2, 0.01, 0, Math.PI*2); c.fillStyle = '#2a2420'; c.fill(); } // клапанная крышка, свечи
        c.beginPath(); c.arc(0.73, ey0 + 0.15, 0.06, 0, Math.PI*2); c.fillStyle = burnt ? '#1e1b18' : '#3a3836'; c.fill(); c.stroke(); // воздушный фильтр
        if(rnd() < 0.5){ rr(0.19, ey0 + 0.12, 0.1, 0.13, 0.01); c.fillStyle = '#1e1d1c'; c.fill(); c.stroke(); } else { rr(0.19, ey0 + 0.12, 0.1, 0.13, 0.01); c.strokeStyle = '#4a4642'; c.lineWidth = 0.006; c.stroke(); } // аккумулятор или пустая полка
        c.beginPath(); c.moveTo(0.33, ey0 + 0.2); c.bezierCurveTo(0.25, ey0 + 0.2, 0.28, ey0 + 0.06, 0.4, ey0 + 0.06); c.strokeStyle = '#1b1a19'; c.lineWidth = 0.02; c.stroke(); // патрубок
        for(let i=0;i<6;i++) blot(ex0 + rnd()*(ex1 - ex0), ey0 + rnd()*(ey1 - ey0), 0.015 + rnd()*0.02, rnd() < 0.5 ? '#6b3820' : '#6f5a36', 0.8);
      c.restore();
      if(d.hood==='open'){ c.save(); c.translate(0.5, hoodY0 + 0.02); c.rotate(-0.04); rr(-0.37, -0.03, 0.74, 0.09, 0.02); c.fillStyle = shade(CAR_PAINT[parts.hood] || parts.hood || paint, -0.1); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.01; c.stroke(); c.restore(); }
    }

    // --- 7. воздухозаборник, лобовое стекло ---
    if(d.body!=='van'){ rr(0.17, hood1, 0.66, 0.035, 0.008); c.fillStyle = '#1f1d1a'; c.fill(); for(let i=0;i<14;i++) line([0.2 + i*0.045, hood1 + 0.008, 0.2 + i*0.045, hood1 + 0.027], '#4a4641', 0.006); }
    const wsP = [0.17, W0, 0.83, W0, cabR - 0.01, W1, cabL + 0.01, W1], wsSt = burnt ? 'gone' : (gl.ws || 'ok');
    if(wsSt==='gone'){ poly(wsP); c.fillStyle = '#16130f'; c.fill(); c.save(); poly(wsP); c.clip(); rr(0.18, W0, 0.64, 0.06, 0.01); c.fillStyle = burnt ? '#26221e' : '#2a2520'; c.fill(); c.beginPath(); c.ellipse(0.35, W0 + 0.085, 0.075, 0.045, 0, 0, Math.PI*2); c.strokeStyle = burnt ? '#3a3430' : '#0e0d0c'; c.lineWidth = 0.016; c.stroke(); c.restore(); shardsAt(0.18, 0.82, W0 + 0.005, W0 + 0.02, 6); }
    else {
      glassFill(wsP, W0, W1, false);
      c.save(); poly(wsP); c.clip();
        rr(0.18, W0, 0.64, 0.06, 0.01); c.fillStyle = 'rgba(16,14,12,.75)'; c.fill();
        c.beginPath(); c.ellipse(0.35, W0 + 0.085, 0.075, 0.045, 0, 0, Math.PI*2); c.strokeStyle = 'rgba(12,11,10,.85)'; c.lineWidth = 0.016; c.stroke(); line([0.35, W0 + 0.085, 0.35, W0 + 0.04], 'rgba(12,11,10,.8)', 0.012);
        radial(0.5, W0 + 0.03, 0.4, '#bdb29a', 0.38*dustK);
        [0.33, 0.6].forEach((px)=>{ c.save(); c.globalAlpha = 0.6*dustK; c.beginPath(); c.moveTo(px, W0); c.arc(px, W0, Math.min(0.2, W1 - W0), 0.05, Math.PI - 0.05); c.closePath(); c.fillStyle = '#2a3433'; c.fill(); c.restore(); });
        c.globalAlpha = 0.28; fillP([0.28, W0, 0.38, W0, 0.27, W1, 0.2, W1], '#dfe6e6'); c.globalAlpha = 0.14; fillP([0.44, W0, 0.48, W0, 0.38, W1, 0.35, W1], '#dfe6e6'); c.globalAlpha = 1;
        if(wsSt!=='ok'){ const web = wsSt==='web', ix = web ? 0.44 : 0.64, iy = W0 + (W1 - W0)*0.45, n = web ? 16 : 7;
          for(let i=0;i<n;i++){ const an = i/n*Math.PI*2 + rnd()*0.3, L = 0.08 + rnd()*0.24; line([ix, iy, ix + Math.cos(an)*L*0.45 + (rnd() - 0.5)*0.03, iy + Math.sin(an)*L*0.45 + (rnd() - 0.5)*0.02, ix + Math.cos(an)*L, iy + Math.sin(an)*L], 'rgba(228,234,234,.62)', 0.005); }
          for(let k=1;k<=(web ? 3 : 1);k++){ c.beginPath(); c.arc(ix, iy, 0.025*k + rnd()*0.008, 0, Math.PI*2); c.strokeStyle = 'rgba(228,234,234,.45)'; c.lineWidth = 0.004; c.stroke(); }
          c.beginPath(); c.arc(ix, iy, 0.008, 0, Math.PI*2); c.fillStyle = 'rgba(240,244,244,.8)'; c.fill(); }
      c.restore();
      line([0.33, W0 + 0.008, 0.52, W0 + 0.016], '#141210', 0.011); line([0.6, W0 + 0.008, 0.79, W0 + 0.018], '#141210', 0.011);
    }
    poly(wsP); c.lineWidth = 0.011; c.strokeStyle = '#151311'; c.stroke();
    if(d.body!=='van') for(let i=0;i<9;i++) blot(0.2 + rnd()*0.6, hood1 + 0.015 + rnd()*0.02, 0.012 + rnd()*0.012, rnd() < 0.5 ? '#6b5a3a' : '#857048', 0.9);

    // --- 8. боковые стёкла и крыша ---
    const sideSegs = d.body==='van' ? [[R0 + 0.02, R0 + 0.3], [R0 + 0.36, R0 + 0.66], [R0 + 0.72, R0 + 1.02]] : d.body==='pickup' ? [[R0 + 0.01, R1 - 0.01]] : [[R0 + 0.01, midRoof - 0.015], [midRoof + 0.015, R1 - 0.01]];
    [[0.155, cabL, 1, 'l'], [0.845, cabR, -1, 'r']].forEach(([xo, xi, s, k])=>{ const gone = burnt || gl[k]==='gone';
      sideSegs.forEach(([a, b], j)=>{ poly([xo, a, xi, a + 0.02, xi, b, xo, b]); c.fillStyle = gone && (j===0 || burnt) ? '#171411' : '#2f3a3c'; c.fill();
        if(!(gone && (j===0 || burnt))) line([xo + s*0.01, a + 0.03, xi - s*0.006, b - 0.04], 'rgba(220,228,228,.22)', 0.006); }); });
    const roofH = R1 - R0;
    rr(cabL, R0, cabR - cabL, roofH, 0.05);
    const rg = c.createLinearGradient(cabL, 0, cabR, 0); rg.addColorStop(0, pD); rg.addColorStop(0.15, pM); rg.addColorStop(0.42, pL); rg.addColorStop(0.7, paint); rg.addColorStop(1, pD); c.fillStyle = rg; c.fill();
    c.save(); rr(cabL, R0, cabR - cabL, roofH, 0.05); c.clip();
      radial(0.42, R0 + roofH*0.3, 0.25, '#fffaf0', burnt ? 0.04 : 0.14); radial(0.55, R0 + roofH*0.55, 0.3 + roofH*0.1, '#cfc4ae', 0.28*dustK);
      if(burnt){ for(let i=0;i<5;i++) blot(cabL + rnd()*0.55, R0 + rnd()*roofH, 0.05 + rnd()*0.07, rnd() < 0.5 ? '#7a4126' : '#b8b2a6', 0.5); }
      else for(let i=0;i<3;i++) peel(0.3 + rnd()*0.4, R0 + 0.06 + rnd()*(roofH - 0.12), 0.025 + rnd()*0.03);
      if(d.roofHole) rust(0.42 + rnd()*0.16, R0 + roofH*(0.3 + rnd()*0.4), 0.055, true);
      if(d.body==='van'){ for(let i=1;i<8;i++) line([cabL + 0.02, R0 + i*roofH/8, cabR - 0.02, R0 + i*roofH/8], 'rgba(10,8,6,.28)', 0.008); rr(0.42, R0 + 0.35, 0.16, 0.12, 0.01); c.fillStyle = shade(paint, -0.25); c.fill(); } // рёбра крыши, люк
      if(!burnt) for(let i=0;i<5;i++){ c.fillStyle = 'rgba(232,228,216,.75)'; c.beginPath(); c.arc(0.3 + rnd()*0.4, R0 + 0.05 + rnd()*(roofH - 0.1), 0.006 + rnd()*0.006, 0, Math.PI*2); c.fill(); }
      for(let i=0;i<4;i++) blot(0.25 + rnd()*0.5, R0 + 0.05 + rnd()*(roofH - 0.1), 0.012, '#6f5a36', 0.85);
    c.restore();
    rr(cabL, R0, cabR - cabL, roofH, 0.05); c.lineWidth = 0.007; c.strokeStyle = 'rgba(10,8,6,.45)'; c.stroke();
    line([0.25, R0 + 0.05, 0.25, R1 - 0.05], 'rgba(10,8,6,.4)', 0.007); line([0.75, R0 + 0.05, 0.75, R1 - 0.05], 'rgba(10,8,6,.4)', 0.007);
    if(d.roofRack){ const ra = R0 + 0.06, rb = Math.min(R1 - 0.06, R0 + 0.7);
      [0.3, 0.7].forEach(x=>{ line([x, ra, x, rb], '#2a2826', 0.02); line([x - 0.005, ra, x - 0.005, rb], 'rgba(200,196,188,.35)', 0.005); }); for(let i=0;i<4;i++) line([0.3, ra + 0.04 + i*(rb - ra - 0.08)/3, 0.7, ra + 0.04 + i*(rb - ra - 0.08)/3], '#2a2826', 0.014);
      if(d.luggage){ rr(0.34, ra + 0.06, 0.18, 0.24, 0.03); c.fillStyle = '#4e5040'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); line([0.34, ra + 0.15, 0.52, ra + 0.15], '#2a2a20', 0.012);
        rr(0.55, ra + 0.08, 0.12, 0.18, 0.012); c.fillStyle = '#5a5e3e'; c.fill(); c.stroke(); line([0.57, ra + 0.1, 0.65, ra + 0.1], '#30321f', 0.012); line([0.61, ra + 0.12, 0.61, ra + 0.24], 'rgba(255,255,255,.15)', 0.006); } } // сумка и канистра
    if(!burnt && d.body!=='van'){ c.beginPath(); c.arc(0.72, R1 - 0.06, 0.012, 0, Math.PI*2); c.fillStyle = '#1e1c1a'; c.fill(); line([0.72, R1 - 0.06, 0.78, R1 + 0.05], '#1e1c1a', 0.005); }

    // --- 9. заднее стекло ---
    if(B.rw){ const a = B.rw[0], b = B.rw[1], rwP = [0.215, a, 0.785, a, 0.815, b, 0.185, b];
      if(burnt || gl.rw==='gone'){ poly(rwP); c.fillStyle = '#1c1916'; c.fill(); c.save(); poly(rwP); c.clip(); rr(0.24, a + 0.015, 0.52, Math.max(0.03, b - a - 0.04), 0.03); c.fillStyle = burnt ? '#2a2420' : '#4a3c32'; c.fill(); if(burnt) for(let i=0;i<6;i++) line([0.26 + i*0.09, a + 0.02, 0.26 + i*0.09, b - 0.02], '#5a4a3e', 0.006); else [0.33, 0.67].forEach(x=>{ rr(x - 0.05, a - 0.005, 0.1, 0.035, 0.015); c.fillStyle = '#56463a'; c.fill(); }); c.restore();
        if(!burnt){ shardsAt(0.2, 0.8, a + 0.003, a + 0.012, 7); shardsAt(0.2, 0.8, b - 0.015, b - 0.005, 7); } }
      else { glassFill(rwP, a, b, true); c.save(); poly(rwP); c.clip(); for(let i=1;i<6;i++) line([0.2, a + i*(b - a)/6, 0.8, a + i*(b - a)/6], 'rgba(120,64,48,.45)', 0.003); c.globalAlpha = 0.25; fillP([0.56, a, 0.64, a, 0.6, b, 0.52, b], '#dfe6e6'); c.globalAlpha = 1; radial(0.5, b, 0.3, '#bdb29a', 0.3*dustK); c.restore(); if(d.body!=='pickup'){ rr(0.44, a + 0.006, 0.12, 0.014, 0.005); c.fillStyle = '#6a2520'; c.fill(); } }
      poly(rwP); c.lineWidth = 0.01; c.strokeStyle = '#151311'; c.stroke(); }

    // --- 10. багажник / кузов пикапа / задние двери фургона ---
    if(B.bed){ const b0 = B.bed[0], b1 = B.bed[1];
      rr(0.14, b0, 0.72, b1 - b0, 0.02); c.fillStyle = burnt ? '#1c1916' : '#2b2825'; c.fill();
      c.save(); rr(0.14, b0, 0.72, b1 - b0, 0.02); c.clip(); for(let i=1;i<9;i++) line([0.14 + i*0.08, b0, 0.14 + i*0.08, b1], 'rgba(120,114,106,.35)', 0.012); // рёбра пола
        [[0.14, B.ax[1]], [0.86, B.ax[1]]].forEach(([x, y])=>{ rr(x - 0.06, y - 0.16, 0.12, 0.32, 0.05); c.fillStyle = shade(paint, -0.3); c.fill(); });   // колёсные арки
        for(let i=0;i<(rustL + 1)*2;i++) blot(0.2 + rnd()*0.6, b0 + 0.05 + rnd()*(b1 - b0 - 0.1), 0.03 + rnd()*0.05, '#6a3a22', 0.7);
        if(rustL >= 3) for(let i=0;i<3;i++){ jag(0.25 + rnd()*0.5, b0 + 0.1 + rnd()*(b1 - b0 - 0.2), 0.04, 9, 0.4); c.fillStyle = '#0c0a08'; c.fill(); }
        if(d.cargo){ // бочка, покрышка, ящик
          c.beginPath(); c.arc(0.32, b0 + 0.18, 0.11, 0, Math.PI*2); c.fillStyle = '#5a4030'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); c.beginPath(); c.arc(0.32, b0 + 0.18, 0.08, 0, Math.PI*2); c.strokeStyle = 'rgba(20,16,12,.6)'; c.stroke(); c.beginPath(); c.arc(0.35, b0 + 0.15, 0.015, 0, Math.PI*2); c.fillStyle = '#1a1714'; c.fill();
          c.beginPath(); c.arc(0.62, b0 + 0.45, 0.13, 0, Math.PI*2); c.fillStyle = '#1c1b1a'; c.fill(); c.beginPath(); c.arc(0.62, b0 + 0.45, 0.065, 0, Math.PI*2); c.fillStyle = '#2b2825'; c.fill();
          rr(0.22, b1 - 0.24, 0.22, 0.18, 0.01); c.fillStyle = '#6b5236'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); line([0.22, b1 - 0.24, 0.44, b1 - 0.06], '#4a3622', 0.01); line([0.44, b1 - 0.24, 0.22, b1 - 0.06], '#4a3622', 0.01); }
      c.restore();
      rr(0.14, b0, 0.72, b1 - b0, 0.02); c.lineWidth = 0.03; c.strokeStyle = pM; c.stroke(); c.lineWidth = 0.008; c.strokeStyle = INK; c.stroke();
      line([0.15, b0 - 0.005, 0.85, b0 - 0.005], shade(paint, -0.2), 0.03); }
    else if(B.tr){ if(d.trunk==='open'){ fillP([0.19, B.tr + 0.01, 0.81, B.tr + 0.01, 0.8, B.tr + 0.07, 0.2, B.tr + 0.07], '#100e0c'); line([0.2, B.tr + 0.075, 0.8, B.tr + 0.075], 'rgba(255,250,240,.3)', 0.006); }
      if(!burnt){ c.beginPath(); c.arc(0.5, Math.min(yB - 0.15, B.tr + 0.17), 0.014, 0, Math.PI*2); c.fillStyle = '#8e8a84'; c.fill(); } }
    if(d.body==='van'){ seam([0.5, yB - 0.2, 0.5, yB - 0.02]); line([0.2, yB - 0.2, 0.8, yB - 0.2], 'rgba(10,8,6,.5)', 0.008); }

    // --- 11. корма: фонари, номер, бампер, запаска ---
    const tail = (x, broken)=>{ const ty = yB - 0.09, h = boxy ? 0.075 : 0.06; rr(x - (boxy ? 0.05 : 0.075), ty, boxy ? 0.1 : 0.15, h, 0.012); const dead = broken || burnt; const tg = c.createLinearGradient(0, ty, 0, ty + h); tg.addColorStop(0, dead ? '#1d1b19' : '#7c2a22'); tg.addColorStop(1, dead ? '#121110' : '#4a1814'); c.fillStyle = tg; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke();
      if(!dead){ line([x - 0.02, ty + 0.005, x - 0.02, ty + h - 0.005], 'rgba(20,8,6,.6)', 0.005); line([x - 0.04, ty + 0.012, x + 0.01, ty + 0.01], 'rgba(255,220,210,.45)', 0.006); }
      else if(!burnt) for(let i=0;i<5;i++) line([x, ty + h/2, x + (rnd() - 0.5)*0.13, ty + h/2 + (rnd() - 0.5)*0.05], 'rgba(170,70,60,.7)', 0.004); };
    tail(boxy ? 0.18 : 0.21, lamps[2]); tail(boxy ? 0.82 : 0.79, lamps[3]);
    const bR = d.bumperR || 'ok';
    if(bR==='ok'){ c.beginPath(); c.moveTo(0.15, yB + 0.005); c.quadraticCurveTo(0.5, yB + (boxy ? 0.015 : 0.045), 0.85, yB + 0.005); c.strokeStyle = '#34322f'; c.lineWidth = 0.035; c.lineCap = boxy ? 'butt' : 'round'; c.stroke(); plate(yB - 0.005, d.plateBent && bF!=='ok'); }
    else if(bR==='hang'){ c.save(); c.translate(0.85, yB + 0.01); c.rotate(Math.PI + 0.35); rr(0, -0.022, 0.64, 0.045, 0.02); c.fillStyle = '#34322f'; c.fill(); c.strokeStyle = INK; c.lineWidth = 0.008; c.stroke(); c.restore(); }
    if(d.spare){ c.beginPath(); c.arc(0.5, yB - 0.02, 0.1, Math.PI, 0); c.closePath(); c.fillStyle = '#1c1b1a'; c.fill(); c.beginPath(); c.arc(0.5, yB - 0.02, 0.05, Math.PI, 0); c.fillStyle = '#4a4642'; c.fill(); }

    // --- 12. пробоины, царапины, сколы ---
    const sh = d.shots;
    if(sh && sh.n){ const sx = sh.side==='l' ? X0 + 0.03 : X1 - 0.03; for(let i=0;i<sh.n;i++){ const x = sx + (sh.side==='l' ? 1 : -1)*rnd()*0.07, y = W0 + 0.12 + i*(Math.min(0.7, R1 - W0 - 0.15)/sh.n) + rnd()*0.02; radial(x + 0.006, y + 0.008, 0.028, '#000000', 0.35); c.beginPath(); c.arc(x, y, 0.011, 0, Math.PI*2); c.fillStyle = '#0c0a08'; c.fill(); c.strokeStyle = 'rgba(214,208,196,.7)'; c.lineWidth = 0.005; c.stroke(); }
      if(sh.glass && B.rw && gl.rw!=='gone' && !burnt) [[0.3, B.rw[0] + 0.08], [0.36, B.rw[0] + 0.05]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.01, 0, Math.PI*2); c.fillStyle = '#0d0c0b'; c.fill(); for(let i=0;i<6;i++){ const an = i/6*Math.PI*2 + rnd(); line([x, y, x + Math.cos(an)*0.05, y + Math.sin(an)*0.03], 'rgba(228,234,234,.55)', 0.004); } }); }
    if(!burnt){ line([0.12, W0 + 0.15, 0.13, W0 + 0.45, 0.125, W0 + 0.7], 'rgba(226,220,208,.5)', 0.004); line([0.3, hoodY0 + 0.12, 0.62, hoodY0 + 0.2], 'rgba(226,220,208,.38)', 0.003);
      for(let i=0;i<26;i++){ const x = 0.13 + rnd()*0.74, y = yT + 0.03 + rnd()*(yB - yT - 0.06); if(y > W0 && y < (B.rw ? B.rw[1] : R1) && x > 0.2 && x < 0.8) continue; c.fillStyle = rnd() < 0.6 ? 'rgba(168,164,156,.75)' : 'rgba(40,30,24,.65)'; c.fillRect(x, y, 0.008 + rnd()*0.016, 0.005 + rnd()*0.009); } }
  }
  // Варианты брошенных машин. Первые четыре — как были (уже расставленные на картах машины не меняются).
  const CAR_VARIANTS = [
    {n:'Седан, разграблен (выбито заднее стекло)', body:'sedan', paint:'bordo', parts:{doorL:'primer'}, glass:{ws:'crack', rw:'gone', r:'gone'}, lamps:[false, false, true, false], rust:2, roofHole:true, dents:2},
    {n:'Седан, оторван бампер, нет колеса', body:'sedan', paint:'blue', glass:{ws:'crack'}, wheels:['ok', 'ok', 'gone', 'ok'], bumperF:'hang', roofRack:true, rust:2, dents:2},
    {n:'Седан, расстрелян', body:'sedan', paint:'mustard', glass:{ws:'web', l:'ok', r:'gone'}, wheels:['ok', 'flat', 'ok', 'ok'], mirrors:[true, false], lamps:[false, true, false, false], shots:{n:9, side:'r', glass:true}, fuelOpen:true, plateBent:true, rust:2, dents:4},
    {n:'Седан, чужой капот, открыт багажник', body:'sedan', paint:'silver', parts:{hood:'#7a5a4a'}, glass:{ws:'crack'}, wheels:['ok', 'ok', 'ok', 'gone'], trunk:'open', lamps:[true, false, false, false], rust:2, roofHole:true, dents:2},
    {n:'Хэтчбек, просто брошен', body:'hatch', paint:'green', glass:{ws:'crack'}, wheels:['ok', 'ok', 'flat', 'ok'], rust:1, dents:1, dust:1.4},
    {n:'Хэтчбек, без капота, чужая дверь', body:'hatch', paint:'white', parts:{doorR:'red'}, hood:'gone', glass:{ws:'gone', l:'gone'}, wheels:['gone', 'gone', 'gone', 'gone'], bumperF:'gone', lamps:[true, true, true, false], rust:3, dents:3},
    {n:'Универсал, чужая дверь багажника', body:'wagon', paint:'brown', parts:{trunk:'blue', fenderL:'primer'}, glass:{ws:'crack', rw:'gone', l:'gone'}, wheels:['ok', 'ok', 'ok', 'flat'], roofRack:true, luggage:true, rust:2, dents:2},
    {n:'Универсал, остов на кирпичах', body:'wagon', paint:'grey', glass:{ws:'gone', rw:'gone', l:'gone', r:'gone'}, wheels:['gone', 'gone', 'gone', 'gone'], doors:[false, true], mirrors:[false, false], bumperF:'gone', bumperR:'hang', lamps:[true, true, true, true], rust:3, roofHole:true, dents:3},
    {n:'Пикап, с грузом в кузове', body:'pickup', paint:'red', glass:{ws:'crack'}, rust:2, cargo:true, dents:2},
    {n:'Пикап, остов, чужой капот', body:'pickup', paint:'navy', parts:{hood:'primer', doorL:'cream'}, hood:'open', glass:{ws:'web', l:'gone'}, wheels:['ok', 'rim', 'gone', 'flat'], shots:{n:6, side:'l'}, bumperF:'hang', lamps:[true, false, false, true], rust:3, dents:3},
    {n:'Внедорожник, багажник на крыше', body:'suv', paint:'khaki', parts:{fenderR:'navy', doorL:'primer'}, glass:{ws:'crack'}, roofRack:true, luggage:true, spare:true, rust:1, dents:2},
    {n:'Внедорожник, расстрелян', body:'suv', paint:'black', glass:{ws:'web', rw:'gone', r:'gone'}, wheels:['flat', 'ok', 'flat', 'ok'], shots:{n:11, side:'l', glass:false}, spare:true, mirrors:[false, true], lamps:[true, true, false, true], rust:2, dents:4},
    {n:'Фургон, просто брошен', body:'van', paint:'olive', glass:{ws:'crack'}, rust:2, dents:1, dust:1.3},
    {n:'Фургон, остов, без колёс', body:'van', paint:'cream', parts:{doorL:'grey'}, glass:{ws:'gone', l:'gone', r:'gone'}, wheels:['gone', 'gone', 'gone', 'gone'], doors:[true, false], bumperF:'gone', lamps:[true, true, true, true], rust:3, roofHole:true, dents:3},
  ];
  const CAR_BURNT = [
    {n:'Седан', body:'sedan', burnt:true, wheels:['rim', 'rim', 'rim', 'rim'], hood:'gone', rust:3, dents:2},
    {n:'Хэтчбек', body:'hatch', burnt:true, wheels:['rim', 'rim', 'gone', 'rim'], rust:3, dents:2},
    {n:'Пикап', body:'pickup', burnt:true, wheels:['rim', 'rim', 'rim', 'rim'], hood:'open', rust:3, dents:2},
    {n:'Фургон', body:'van', burnt:true, wheels:['rim', 'gone', 'rim', 'rim'], doors:[true, false], rust:3, dents:2},
  ];
  function crate(g, x, y, s, c){ g.r(x, y, s, s, c || P.woodL); g.l([x, y, x + s, y + s], P.woodD, 0.04); g.l([x + s, y, x, y + s], P.woodD, 0.04); g.r(x + 0.06, y + 0.06, s - 0.12, s - 0.12, false, {lw:0.6}); }
  function barrel(g, cx, cy, r, c, mark){ g.c(cx, cy, r, c); g.c(cx, cy, r*0.72, false, {lw:0.6}); g.c(cx, cy, r*0.18, g.shade(c, -0.25), {s:false}); if(mark) g.c(cx, cy, r*0.45, mark, {s:false, alpha:0.85}); }
  function chair(g, x, y, c){ g.r(x, y, 0.42, 0.42, c || P.woodL, {rad:0.06}); g.r(x, y, 0.42, 0.1, g.shade(c || P.woodL, -0.2), {rad:0.04}); }
  function tree(g, cx, cy, r, c, dead){
    if(dead){ for(let i=0;i<7;i++){ const a = i/7*Math.PI*2 + g.rnd()*0.4, l = r*(0.6 + g.rnd()*0.4); g.l([cx, cy, cx + Math.cos(a)*l, cy + Math.sin(a)*l], P.woodD, 0.09); } g.c(cx, cy, r*0.22, P.wood); return; }
    for(let i=0;i<6;i++){ const a = i/6*Math.PI*2, d = r*0.45; g.c(cx + Math.cos(a)*d, cy + Math.sin(a)*d, r*0.55, c, {s:i===0}); }
    g.c(cx, cy, r*0.75, c); g.c(cx - r*0.2, cy - r*0.2, r*0.35, g.shade(c, 0.15), {s:false});
  }
  function rocks(g, x, y, w, h, n, c){ for(let i=0;i<n;i++){ const rx = x + g.rnd()*w, ry = y + g.rnd()*h, r = 0.15 + g.rnd()*0.35; g.blob(rx, ry, r, c || P.conD); } }

  /* ===================== ГОРОД ===================== */
  /* ---- Набор для детальных (HD) рисунков объектов ----
     hk(g) — помощники поверх контекста ассета (1 единица = 1 клетка): органичные пятна, ржавчина, швы, вмятины,
     обломки с гранями, кирпичи, доски, арматура, мусор, листва, мох, лужи, граффити, брезент, фактуры MapTex.
     Всё детерминировано: случайность — только из g.rnd (одна и та же модель всегда рисуется одинаково). */
  function hk(g){
    const c = g.ctx, rnd = g.rnd, R = (a, b)=>a + rnd()*(b - a), pick = (arr)=>arr[Math.floor(rnd()*arr.length)];
    const k = {c, rnd, R, pick, INK:'rgba(18,14,10,.55)'};
    k.rr = (x, y, w, h, r)=>{ if(w < 0){ x += w; w = -w; } if(h < 0){ y += h; h = -h; } r = Math.max(0, Math.min(r, w/2, h/2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    k.poly = (p)=>{ c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.closePath(); };
    k.line = (p, col, w, a, dash)=>{ c.save(); if(a!=null) c.globalAlpha = a; if(dash) c.setLineDash(dash); c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.restore(); };
    k.fill = (col, a)=>{ c.save(); if(a!=null) c.globalAlpha = a; c.fillStyle = col; c.fill(); c.restore(); };
    k.stroke = (col, w, a)=>{ c.save(); if(a!=null) c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.stroke(); c.restore(); };
    k.fillP = (p, col, a)=>{ k.poly(p); k.fill(col, a); };
    // orgK: тот же контур при повторном вызове с теми же аргументами (заливка, клип и обводка совпадают)
    k.orgK = (cx, cy, r, irr, ry)=>{ const key = [cx, cy, r, irr, ry].join(','); k._oc = k._oc || {}; const p = k._oc[key] || (k._oc[key] = [rnd()*6.3, rnd()*6.3, rnd()*6.3]); k.organic(cx, cy, r, irr, ry, p); };
    k.organic = (cx, cy, r, irr, ry, ph)=>{ const p1 = ph ? ph[0] : rnd()*6.3, p2 = ph ? ph[1] : rnd()*6.3, p3 = ph ? ph[2] : rnd()*6.3, n = 30, sy = ry ? ry/r : 1; c.beginPath();
      for(let i=0;i<=n;i++){ const an = i/n*Math.PI*2, d = r*(1 + irr*(0.5*Math.sin(3*an + p1) + 0.3*Math.sin(5*an + p2) + 0.2*Math.sin(9*an + p3))); const x = cx + Math.cos(an)*d, y = cy + Math.sin(an)*d*sy; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
    // рваный контур: плавная основа + мелкая зазубренность (ржавчина, сколы) — без лепестков
    k.ragged = (cx, cy, r, ry)=>{ const n = 40, p1 = rnd()*6.3, p2 = rnd()*6.3, sy = ry ? ry/r : 1; c.beginPath(); for(let i=0;i<=n;i++){ const an = i/n*Math.PI*2, d = r*(0.82 + 0.16*Math.sin(2*an + p1) + 0.1*Math.sin(3*an + p2) + (rnd() - 0.5)*0.22); const x = cx + Math.cos(an)*d, y = cy + Math.sin(an)*d*sy; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
    k.jag = (cx, cy, r, n, irr, rot)=>{ const pts = []; for(let i=0;i<n;i++){ const an = (rot || 0) + i/n*Math.PI*2 + (rnd() - 0.5)*0.5, d = r*(1 - irr + rnd()*irr*2); pts.push(cx + Math.cos(an)*d, cy + Math.sin(an)*d); } return pts; };
    k.blot = (cx, cy, r, col, a, irr)=>{ k.organic(cx, cy, r, irr==null ? 0.45 : irr); k.fill(col, a); };
    k.radial = (cx, cy, r, col, a)=>{ const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0)); c.fillStyle = gr; c.fillRect(cx - r, cy - r, r*2, r*2); };
    k.lin = (x0, y0, x1, y1, stops)=>{ const gr = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(s=>gr.addColorStop(s[0], s[1])); return gr; };
    k.seam = (p, w, a)=>{ k.line(p.map(q=>q + 0.006), 'rgba(255,248,236,.25)', (w || 0.012)*0.8, a); k.line(p, 'rgba(10,8,6,.8)', w || 0.012, a); };
    k.dent = (cx, cy, r)=>{ k.radial(cx + r*0.25, cy + r*0.3, r, '#000000', 0.3); k.radial(cx - r*0.3, cy - r*0.3, r*0.8, '#fffaf0', 0.2); };
    k.rust = (cx, cy, r, hole, lift)=>{
      if(lift){ c.save(); k.organic(cx, cy, r*1.25, 0.5); c.strokeStyle = hexA(lift, 0.45); c.lineWidth = Math.max(0.004, r*0.08); c.stroke(); c.restore(); }
      k.ragged(cx, cy, r); const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r*1.3); gr.addColorStop(0, '#4a2616'); gr.addColorStop(0.45, '#7a4126'); gr.addColorStop(0.8, '#9a5a30'); gr.addColorStop(1, 'rgba(154,90,48,.3)'); c.fillStyle = gr; c.fill();
      k.blot(cx + r*0.15, cy - r*0.1, r*0.45, '#b0703c', 0.3);
      for(let i=0;i<Math.min(40, Math.round(5 + r*50));i++){ const an = rnd()*6.28, d = rnd()*r*0.9; c.fillStyle = rnd() < 0.7 ? 'rgba(36,20,12,.8)' : 'rgba(200,140,80,.55)'; c.beginPath(); c.arc(cx + Math.cos(an)*d, cy + Math.sin(an)*d, r*0.04 + rnd()*r*0.06, 0, 6.28); c.fill(); }
      if(hole){ k.poly(k.jag(cx, cy, r*0.38, 10, 0.45)); c.fillStyle = '#0c0a08'; c.fill(); c.strokeStyle = '#a2602f'; c.lineWidth = Math.max(0.004, r*0.06); c.stroke(); }
    };
    k.peel = (cx, cy, r, col)=>{ k.organic(cx, cy, r, 0.6); k.fill(hexA(col || '#c8c0b0', 0.3)); k.organic(cx + r*0.1, cy + r*0.1, r*0.55, 0.6); k.fill(hexA(shade(col || '#c8c0b0', 0.2), 0.22)); };
    k.streak = (x, y, len, w, col, a)=>{ const gr = c.createLinearGradient(x, y, x, y + len); gr.addColorStop(0, hexA(col, a)); gr.addColorStop(1, hexA(col, 0)); c.fillStyle = gr; c.fillRect(x - w/2, y, w, len); };
    k.tex = (id)=>typeof MapTex!=='undefined' ? MapTex.pattern(id) : null;
    // залить текущий контур фактурой (с оттенком: тон берётся от цвета, яркость — от фактуры)
    k.texFill = (id, fallback, tint, ta)=>{ c.save(); c.fillStyle = k.tex(id) || fallback; c.fill(); if(tint){ c.globalCompositeOperation = 'color'; c.globalAlpha = ta==null ? 0.6 : ta; c.fillStyle = tint; c.fill(); } c.restore(); };
    // обломок с гранями: тень, боковая грань, верх со светлой кромкой
    k.chunk = (cx, cy, r, col, h)=>{ const pts = k.jag(cx, cy, r, 5 + Math.floor(rnd()*3), 0.35, rnd()*6.28), hh = h==null ? r*0.35 : h;
      k.fillP(pts.map((v, i)=>v + (i%2 ? hh*1.1 : hh*0.9)), 'rgba(12,10,8,.38)');
      k.fillP(pts.map((v, i)=>v + (i%2 ? hh*0.5 : hh*0.35)), shade(col, -0.38)); k.poly(pts.map((v, i)=>v + (i%2 ? hh*0.5 : hh*0.35))); k.stroke('rgba(10,8,6,.5)', Math.max(0.005, r*0.05));
      k.fillP(pts, col); k.poly(pts); k.stroke('rgba(10,8,6,.55)', Math.max(0.005, r*0.05));
      k.line([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]], 'rgba(255,250,240,.35)', Math.max(0.004, r*0.04));
      for(let i=0;i<4;i++){ c.fillStyle = rnd() < 0.5 ? 'rgba(30,26,22,.45)' : 'rgba(230,226,216,.35)'; c.beginPath(); c.arc(cx + (rnd() - 0.5)*r, cy + (rnd() - 0.5)*r, r*0.06, 0, 6.28); c.fill(); }
      return pts; };
    k.brick = (x, y, ang, col, s)=>{ s = s || 1; c.save(); c.translate(x, y); c.rotate(ang); const w = 0.25*s, h = 0.12*s;
      c.fillStyle = 'rgba(12,10,8,.35)'; c.fillRect(-w/2 + 0.015, -h/2 + 0.02, w, h); k.rr(-w/2, -h/2, w, h, 0.012*s); k.fill(col); k.stroke('rgba(20,12,10,.6)', 0.006*s);
      c.fillStyle = 'rgba(255,240,220,.18)'; c.fillRect(-w/2 + 0.01*s, -h/2 + 0.008*s, w - 0.02*s, 0.02*s); c.fillStyle = 'rgba(190,180,160,.45)'; c.fillRect(w*0.1, -h*0.3, w*0.2, h*0.25); c.restore(); };
    k.plank = (x, y, len, w, ang, col, broken)=>{ c.save(); c.translate(x, y); c.rotate(ang);
      c.fillStyle = 'rgba(12,10,8,.3)'; c.fillRect(-len/2 + 0.02, -w/2 + 0.025, len, w);
      if(broken){ c.beginPath(); c.moveTo(-len/2, -w/2); c.lineTo(len/2 - 0.04, -w/2); c.lineTo(len/2, -w/6); c.lineTo(len/2 - 0.05, w/8); c.lineTo(len/2 - 0.02, w/2); c.lineTo(-len/2, w/2); c.closePath(); } else { c.beginPath(); c.rect(-len/2, -w/2, len, w); }
      k.fill(col); k.stroke('rgba(20,14,10,.6)', 0.008);
      for(let i=0;i<3;i++){ const yy = -w/2 + w*(0.25 + i*0.25) + (rnd() - 0.5)*w*0.1; k.line([-len/2 + 0.02, yy, len/2 - 0.03, yy + (rnd() - 0.5)*w*0.2], 'rgba(40,28,18,.35)', 0.005); }
      c.fillStyle = '#2a2420'; c.fillRect(-len/2 + 0.04, -0.008, 0.016, 0.016); if(!broken) c.fillRect(len/2 - 0.06, -0.008, 0.016, 0.016); c.restore(); };
    k.rebar = (p, a)=>{ k.line(p, '#3e2a1e', 0.026, a); k.line(p, '#7a4a30', 0.016, a); k.line(p.map((q, i)=>q - 0.004), 'rgba(220,160,110,.35)', 0.005, a); };
    k.trash = (x, y, w, h, n)=>{ for(let i=0;i<n;i++){ const px = x + rnd()*w, py = y + rnd()*h, t = rnd();
      if(t < 0.35){ c.save(); c.translate(px, py); c.rotate(rnd()*6.28); c.fillStyle = pick(['#d8d2c2', '#c9c1a8', '#b9b2a0', '#a9b4b8']); c.fillRect(-0.04, -0.03, 0.08, 0.06); c.strokeStyle = 'rgba(40,36,30,.35)'; c.lineWidth = 0.004; c.strokeRect(-0.04, -0.03, 0.08, 0.06); c.restore(); }
      else if(t < 0.55){ c.save(); c.translate(px, py); c.rotate(rnd()*6.28); k.rr(-0.035, -0.018, 0.07, 0.036, 0.016); k.fill(pick(['#8a8f92', '#9a3a2e', '#3e5a6a', '#b8a24a'])); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(-0.03, -0.012, 0.06, 0.006); c.restore(); }
      else if(t < 0.72){ c.save(); c.translate(px, py); c.rotate(rnd()*6.28); c.beginPath(); c.ellipse(0, 0, 0.05, 0.018, 0, 0, 6.28); c.fillStyle = pick(['rgba(60,90,50,.8)', 'rgba(110,70,30,.8)', 'rgba(170,190,180,.6)']); c.fill(); c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(-0.03, -0.01, 0.04, 0.005); c.restore(); }
      else if(t < 0.86){ k.blot(px, py, 0.04 + rnd()*0.04, pick(['#d9d6cc', '#3a3a38', '#5a6a5a']), 0.75, 0.5); }
      else { k.blot(px, py, 0.015 + rnd()*0.02, '#2a2622', 0.6); } } };
    k.leaves = (x, y, w, h, n)=>{ for(let i=0;i<n;i++){ const px = x + rnd()*w, py = y + rnd()*h; c.save(); c.translate(px, py); c.rotate(rnd()*6.28); c.beginPath(); c.ellipse(0, 0, 0.022, 0.011, 0, 0, 6.28); c.fillStyle = pick(['#6f5a36', '#857048', '#5a4a2c', '#7a6040', '#5e5a3a']); c.fill(); c.restore(); } };
    k.tufts = (x, y, w, h, n, cols)=>{ cols = cols || ['#7c785a', '#8f8a64', '#6a664c', '#5f6a48']; c.lineCap = 'round'; for(let i=0;i<n;i++){ const px = x + rnd()*w, py = y + rnd()*h, m = 4 + Math.floor(rnd()*5); for(let j=0;j<m;j++){ const an = -Math.PI/2 + (rnd() - 0.5)*2.2, L = 0.04 + rnd()*0.07; c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + Math.cos(an)*L*0.5 + (rnd() - 0.5)*0.02, py + Math.sin(an)*L*0.5, px + Math.cos(an)*L, py + Math.sin(an)*L); c.strokeStyle = pick(cols); c.lineWidth = 0.008; c.stroke(); } } };
    k.moss = (cx, cy, r)=>{ k.blot(cx, cy, r, '#5d6648', 0.55, 0.6); k.blot(cx + r*0.2, cy - r*0.1, r*0.6, '#737d55', 0.5, 0.6); for(let i=0;i<8;i++){ c.fillStyle = 'rgba(140,150,100,.55)'; c.beginPath(); c.arc(cx + (rnd() - 0.5)*r*1.4, cy + (rnd() - 0.5)*r*1.4, r*0.06, 0, 6.28); c.fill(); } };
    k.puddle = (cx, cy, r, ry)=>{ k.organic(cx, cy, r, 0.4, ry); k.fill('#2f3a3c', 0.6); k.organic(cx - r*0.1, cy - r*0.1, r*0.8, 0.4, ry ? ry*0.8 : null); k.fill('#4a5a5e', 0.35); k.organic(cx, cy, r, 0.4, ry); k.stroke('rgba(200,210,210,.25)', Math.max(0.004, r*0.04)); };
    k.graffiti = (x, y, w, h, col)=>{ c.save(); c.globalAlpha = 0.75; c.lineCap = 'round'; c.strokeStyle = col; c.lineWidth = Math.min(w, h)*0.08; c.beginPath(); let px = x, py = y + h*(0.3 + rnd()*0.4); c.moveTo(px, py);
      for(let i=0;i<6;i++){ const nx = x + w*(i + 1)/6, ny = y + h*(0.2 + rnd()*0.6); c.bezierCurveTo(px + w*0.08, y + rnd()*h, nx - w*0.08, y + rnd()*h, nx, ny); px = nx; py = ny; } c.stroke();
      c.lineWidth = Math.min(w, h)*0.03; c.strokeStyle = 'rgba(20,18,16,.6)'; c.stroke(); c.restore(); };
    k.tarp = (x, y, w, h, col, ang)=>{ c.save(); c.translate(x + w/2, y + h/2); if(ang) c.rotate(ang);
      k.organic(0, 0, w/2, 0.08, h/2); k.fill(col); c.save(); k.organic(0, 0, w/2, 0.08, h/2); c.clip();
        for(let i=0;i<5;i++){ const fx = (rnd() - 0.5)*w, fy = (rnd() - 0.5)*h; k.line([fx - w*0.3, fy - h*0.2, fx + w*0.3, fy + h*0.25], 'rgba(0,0,0,.22)', Math.min(w, h)*0.05); k.line([fx - w*0.3, fy - h*0.2 - 0.02, fx + w*0.3, fy + h*0.25 - 0.02], 'rgba(255,255,255,.15)', Math.min(w, h)*0.03); }
        k.radial(0, 0, Math.max(w, h)*0.6, '#cfc4ae', 0.18); c.restore();
      k.organic(0, 0, w/2, 0.08, h/2); k.stroke('rgba(10,8,6,.55)', 0.01);
      [[-w/2 + 0.04, -h/2 + 0.04], [w/2 - 0.04, -h/2 + 0.04], [-w/2 + 0.04, h/2 - 0.04], [w/2 - 0.04, h/2 - 0.04]].forEach(([px, py])=>{ c.beginPath(); c.arc(px, py, 0.012, 0, 6.28); c.fillStyle = '#9a968c'; c.fill(); });
      c.restore(); };
    k.tire = (cx, cy, r)=>{ c.beginPath(); c.arc(cx + r*0.15, cy + r*0.2, r, 0, 6.28); k.fill('rgba(10,8,6,.4)'); c.beginPath(); c.arc(cx, cy, r, 0, 6.28); c.arc(cx, cy, r*0.5, 0, 6.28, true); k.fill('#1c1b1a');
      for(let i=0;i<14;i++){ const an = i/14*6.28; k.line([cx + Math.cos(an)*r*0.62, cy + Math.sin(an)*r*0.62, cx + Math.cos(an)*r*0.95, cy + Math.sin(an)*r*0.95], '#3a3836', r*0.08); }
      c.beginPath(); c.arc(cx, cy, r*0.5, 0, 6.28); k.stroke('rgba(120,116,110,.4)', r*0.05); };
    // стекло: тёмное с отражением; разбитое — проём с осколками по раме
    k.glass = (pathFn, x0, y0, x1, y1, broken)=>{ pathFn(); if(broken){ k.fill('#16130f'); c.save(); pathFn(); c.clip(); for(let i=0;i<6;i++){ const px = x0 + rnd()*(x1 - x0), py = rnd() < 0.5 ? y0 : y1; k.fillP([px, py, px + 0.03, py + (rnd() - 0.5)*0.05, px + 0.01, py + (py===y0 ? 0.04 : -0.04)], 'rgba(198,212,212,.7)'); } c.restore(); }
      else { c.fillStyle = k.lin(x0, y0, x1, y1, [[0, '#2a3536'], [1, '#46575b']]); c.fill(); c.save(); pathFn(); c.clip(); c.globalAlpha = 0.25; k.fillP([x0 + (x1 - x0)*0.2, y0, x0 + (x1 - x0)*0.35, y0, x0 + (x1 - x0)*0.15, y1, x0, y1], '#dfe6e6'); c.restore(); }
      pathFn(); k.stroke('#151311', 0.012); };
    // кромка поверхности сверху-слева светлее, снизу-справа темнее (объём плоской детали)
    k.bevel = (pathFn, w)=>{ c.save(); pathFn(); c.clip(); c.translate(w, w); pathFn(); k.stroke('rgba(255,250,240,.28)', w*2); c.restore(); c.save(); pathFn(); c.clip(); c.translate(-w, -w); pathFn(); k.stroke('rgba(0,0,0,.3)', w*2); c.restore(); };
    k.concreteDetail = (x0, y0, w, h, step)=>{ step = step || 0.5;
      for(let y=y0;y<y0 + h;y+=step) for(let x=x0;x<x0 + w;x+=step){ c.fillStyle = k.rnd() < 0.5 ? `rgba(255,250,240,${k.R(0.03, 0.09)})` : `rgba(20,16,12,${k.R(0.03, 0.1)})`; c.fillRect(x, y, step, step); }
      for(let x=x0 + step;x<x0 + w;x+=step){ k.line([x + 0.006, y0, x + 0.006, y0 + h], 'rgba(255,250,240,.16)', 0.006); k.line([x, y0, x, y0 + h], 'rgba(15,12,10,.38)', 0.008); }
      for(let y=y0 + step;y<y0 + h;y+=step){ k.line([x0, y + 0.006, x0 + w, y + 0.006], 'rgba(255,250,240,.16)', 0.006); k.line([x0, y, x0 + w, y], 'rgba(15,12,10,.38)', 0.008); }
      for(let y=y0 + step/2;y<y0 + h;y+=step) for(let x=x0 + step/2;x<x0 + w;x+=step){ [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(([dx, dy])=>{ const px = x + dx*step, py = y + dy*step; c.beginPath(); c.arc(px, py, step*0.028, 0, 6.28); k.fill('#1e1a16', 0.7); c.beginPath(); c.arc(px - 0.004, py - 0.004, step*0.028, 3.4, 5.6); k.stroke('rgba(235,230,220,.4)', 0.004); }); }
      for(let i=0;i<Math.round(w*h*2);i++){ const x = x0 + k.rnd()*w, y = y0 + Math.floor(k.rnd()*h/step)*step + 0.01; k.streak(x, y, k.R(0.15, 0.4), k.R(0.03, 0.07), '#e8e4d8', 0.2); }
      for(let i=0;i<Math.round(w*h*1.2);i++){ const x = x0 + k.rnd()*w, y = y0 + k.rnd()*h, r = k.R(0.04, 0.1); k.organic(x, y, r, 0.6); k.fill('#6a665e'); k.organic(x, y, r, 0.6); k.stroke('rgba(240,236,226,.35)', 0.006); for(let j=0;j<5;j++){ c.beginPath(); c.arc(x + k.R(-r, r)*0.7, y + k.R(-r, r)*0.7, r*0.15, 0, 6.28); k.fill(k.pick(['#8a857c', '#4a4640', '#9a948a'])); } if(k.rnd() < 0.4) k.rebar([x - r*0.7, y, x + r*0.7, y + k.R(-0.02, 0.02)]); }
      for(let i=0;i<Math.round(w*h*3);i++){ const vert = k.rnd() < 0.5, along = k.rnd(); const x = vert ? x0 + Math.max(1, Math.round(k.rnd()*w/step))*step : x0 + along*w, y = vert ? y0 + along*h : y0 + Math.max(1, Math.round(k.rnd()*h/step))*step; k.blot(x, y, k.R(0.02, 0.05), k.pick(['#5d6648', '#6e7a50']), 0.6, 0.6); } };
    return k;
  }
  /* ---- Город (HD): дома, многоэтажка, руины ---- */
  const LIGHT = [-0.6, -0.8]; // свет сверху-слева (в координатах карты)
  // скат крыши: заливка фактурой (ряды параллельны свесу), свет по нормали ската, темнее к свесу
  function roofFace(k, pts, mat, tint, ang, nrm, ridgeEave){
    const c = k.c; c.save(); k.poly(pts); c.clip();
    let cx = 0, cy = 0; for(let i=0;i<pts.length;i+=2){ cx += pts[i]; cy += pts[i + 1]; } cx /= pts.length/2; cy /= pts.length/2;
    c.save(); c.translate(cx, cy); c.rotate(ang); c.beginPath(); c.rect(-8, -8, 16, 16); k.texFill(mat, '#7a746c', tint, 0.62); c.restore();
    const b = nrm[0]*LIGHT[0] + nrm[1]*LIGHT[1]; c.fillStyle = b > 0 ? `rgba(255,250,240,${b*0.16})` : `rgba(0,0,0,${-b*0.34})`; c.fillRect(-1, -1, 20, 20);
    if(ridgeEave){ const [rx, ry, ex, ey] = ridgeEave; c.fillStyle = k.lin(rx, ry, ex, ey, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.22)']]); c.fillRect(-1, -1, 20, 20); }
    c.restore();
  }
  function chimney(k, x, y, s){ const c = k.c; s = s || 1; k.rr(x + 0.05*s, y + 0.07*s, 0.3*s, 0.3*s, 0.02); k.fill('rgba(10,8,6,.4)'); k.rr(x, y, 0.3*s, 0.3*s, 0.02); c.save(); k.rr(x, y, 0.3*s, 0.3*s, 0.02); k.texFill('brickwall', '#7a4c3e'); c.restore(); k.rr(x, y, 0.3*s, 0.3*s, 0.02); k.stroke(k.INK, 0.012);
    k.rr(x + 0.06*s, y + 0.06*s, 0.18*s, 0.18*s, 0.01); k.fill('#141210'); k.radial(x + 0.15*s, y + 0.15*s, 0.45*s, '#1a1714', 0.35); k.line([x, y + 0.02, x + 0.3*s, y + 0.02], 'rgba(255,250,240,.25)', 0.01); }
  function ventPipe(k, x, y, r){ const c = k.c; c.beginPath(); c.arc(x + r*0.3, y + r*0.4, r, 0, 6.28); k.fill('rgba(10,8,6,.35)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); k.fill('#6e7174'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x, y, r*0.6, 0, 6.28); k.fill('#2a2826'); k.line([x - r*0.6, y - r*0.5, x + r*0.2, y - r*0.8], 'rgba(255,255,255,.3)', r*0.15); }
  function dish(k, x, y, r){ const c = k.c; c.beginPath(); c.ellipse(x + r*0.2, y + r*0.3, r, r*0.8, 0.4, 0, 6.28); k.fill('rgba(10,8,6,.35)'); c.beginPath(); c.ellipse(x, y, r, r*0.8, 0.4, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#c9c6bd'], [1, '#7e7b74']]); c.fill(); k.stroke(k.INK, 0.01); k.line([x, y, x + r*0.9, y + r*0.6], '#3a3836', 0.015); c.beginPath(); c.arc(x + r*0.9, y + r*0.6, r*0.12, 0, 6.28); k.fill('#2a2826'); k.rust(x - r*0.3, y + r*0.2, r*0.25, false); }
  function solar(k, x, y, w, h, broken){ const c = k.c; k.rr(x + 0.04, y + 0.05, w, h, 0.01); k.fill('rgba(10,8,6,.4)'); k.rr(x, y, w, h, 0.01); c.fillStyle = k.lin(x, y, x + w, y + h, [[0, '#2d3b4e'], [1, '#1b2431']]); c.fill(); k.stroke('#8a8d90', 0.014);
    for(let i=1;i<4;i++) k.line([x + w*i/4, y, x + w*i/4, y + h], 'rgba(160,170,180,.45)', 0.006); for(let j=1;j<3;j++) k.line([x, y + h*j/3, x + w, y + h*j/3], 'rgba(160,170,180,.45)', 0.006);
    k.line([x + w*0.1, y + h*0.1, x + w*0.4, y + h*0.6], 'rgba(255,255,255,.18)', 0.02); if(broken){ const ix = x + w*0.6, iy = y + h*0.4; for(let i=0;i<8;i++){ const a = i/8*6.28; k.line([ix, iy, ix + Math.cos(a)*w*0.3, iy + Math.sin(a)*h*0.4], 'rgba(220,228,230,.6)', 0.005); } } }
  function antenna(k, x, y, L, ang){ const c = k.c, dx = Math.cos(ang), dy = Math.sin(ang); k.line([x, y, x + dx*L, y + dy*L], '#2a2826', 0.016); for(let i=1;i<6;i++){ const px = x + dx*L*i/6, py = y + dy*L*i/6, w = L*0.22*(1 - i/8); k.line([px - dy*w, py + dx*w, px + dy*w, py - dx*w], '#3a3836', 0.01); } c.beginPath(); c.arc(x, y, 0.03, 0, 6.28); k.fill('#1e1c1a'); }
  function hole(k, cx, cy, r, raft){ const c = k.c; // провал кровли: тьма, стропила, обломки внутри, рваный край
    k.organic(cx, cy, r, 0.4, r*0.75); c.fillStyle = k.lin(cx - r, cy - r, cx + r, cy + r, [[0, '#0e0c0a'], [1, '#2a241e']]); c.fill();
    c.save(); k.organic(cx, cy, r, 0.4, r*0.75); c.clip(); for(let i=0;i<5;i++) k.chunk(cx + k.R(-0.6, 0.6)*r, cy + k.R(-0.4, 0.5)*r, r*k.R(0.08, 0.16), k.pick(['#8a8580', '#6b5a48', '#7a4c3e']), r*0.04);
      for(let i=-3;i<=3;i++){ const x = cx + i*r*0.3; if(raft==='h') k.line([cx - r*1.2, cy + i*r*0.25, cx + r*1.2, cy + i*r*0.25 + k.R(-0.04, 0.04)], '#5c4632', 0.05); else k.line([x, cy - r, x + k.R(-0.05, 0.05), cy + r], '#5c4632', 0.05); }
      if(raft==='h') for(let i=-3;i<=3;i++) k.line([cx - r*1.2, cy + i*r*0.25 - 0.015, cx + r*1.2, cy + i*r*0.25 - 0.015], 'rgba(255,240,220,.15)', 0.012); else for(let i=-3;i<=3;i++) k.line([cx + i*r*0.3 - 0.015, cy - r, cx + i*r*0.3 - 0.015, cy + r], 'rgba(255,240,220,.15)', 0.012);
    c.restore(); k.organic(cx, cy, r, 0.4, r*0.75); k.stroke('#2a2420', 0.03); for(let i=0;i<10;i++){ const a = k.rnd()*6.28; k.chunk(cx + Math.cos(a)*r*1.05, cy + Math.sin(a)*r*0.8, 0.035, '#8a7a6a', 0.012); } }
  function burntInside(k, x0, y0, x1, y1, raftH){ const c = k.c; // выгоревший дом сверху: стены по периметру, обгорелые стропила, пепел
    c.fillStyle = k.lin(x0, y0, x1, y1, [[0, '#1a1714'], [1, '#262019']]); c.fillRect(x0, y0, x1 - x0, y1 - y0);
    for(let i=0;i<10;i++) k.blot(k.R(x0, x1), k.R(y0, y1), k.R(0.12, 0.35), k.pick(['#5a524a', '#8a847a', '#3a2a20']), k.R(0.3, 0.6));
    for(let i=0;i<14;i++) k.chunk(k.R(x0 + 0.2, x1 - 0.2), k.R(y0 + 0.2, y1 - 0.2), k.R(0.05, 0.12), k.pick(['#4a4440', '#5e3a2a', '#2a2624']), 0.02);
    const n = Math.round(((raftH ? y1 - y0 : x1 - x0))/0.45); for(let i=1;i<n;i++){ if(k.rnd() < 0.35) continue; const t = i/n; const a = raftH ? [x0, y0 + (y1 - y0)*t, x1, y0 + (y1 - y0)*t] : [x0 + (x1 - x0)*t, y0, x0 + (x1 - x0)*t, y1];
      const cut = k.R(0.25, 0.75); const p = raftH ? [a[0], a[1], a[0] + (a[2] - a[0])*cut, a[1] + k.R(-0.05, 0.05)] : [a[0], a[1], a[0] + k.R(-0.05, 0.05), a[1] + (a[3] - a[1])*cut]; k.line(p.map(v=>v + 0.04), 'rgba(0,0,0,.5)', 0.1); k.line(p, '#0c0a08', 0.09); k.line(p, '#4e3a2a', 0.05); k.line(p.map(v=>v - 0.012), 'rgba(255,190,140,.18)', 0.014); for(let j=0;j<4;j++){ const t = k.rnd(); k.line([p[0] + (p[2] - p[0])*t - 0.03, p[1] + (p[3] - p[1])*t, p[0] + (p[2] - p[0])*t + 0.03, p[1] + (p[3] - p[1])*t + 0.02], '#141110', 0.012); } }
    const mx = (x0 + x1)/2, my = (y0 + y1)/2; [[mx, y0, mx, my + (y1 - y0)*0.15], [x0, my, mx - 0.3, my]].forEach(p=>{ c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[2], p[3]); c.lineWidth = 0.12; c.strokeStyle = k.tex('brickwall') || '#6b4a3e'; c.stroke(); k.line(p, 'rgba(10,8,6,.45)', 0.12); });
    for(let i=0;i<6;i++){ const ax = k.R(x0 + 0.3, x1 - 0.3), ay = k.R(y0 + 0.3, y1 - 0.3); k.organic(ax, ay, k.R(0.15, 0.3), 0.5, k.R(0.1, 0.2)); k.fill('#9a948a', 0.45); }
    c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.lineWidth = 0.18; c.strokeStyle = k.tex('brickwall') || '#6b4a3e'; c.stroke(); c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.lineWidth = 0.18; c.strokeStyle = 'rgba(10,8,6,.3)'; c.stroke(); c.restore();
    for(let i=0;i<8;i++){ const t = k.rnd(), side = Math.floor(k.rnd()*4); const px = side < 2 ? x0 + (x1 - x0)*t : (side===2 ? x0 : x1), py = side < 2 ? (side ? y1 : y0) : y0 + (y1 - y0)*t; k.radial(px, py, 0.3, '#0c0a08', 0.5); } c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); k.stroke('rgba(30,26,22,.8)', 0.012);
    for(let i=0;i<4;i++) k.radial(k.R(x0, x1), k.R(y0, y1), k.R(0.5, 1), '#0c0a08', 0.35); }
  // Дом: рамка крыши в клетках, кровля, повреждения, «жизнь» на крыше
  function houseDraw(g, W, H, d){
    const k = hk(g), c = k.c, e = 0.1, x0 = e, y0 = e, x1 = (d.main ? d.main[2] : W) - e, y1 = (d.main ? d.main[3] : H) - e;
    const vertical = (y1 - y0) > (x1 - x0), tint = d.tint, mat = d.mat || 'rooftile';
    if(d.dmg===3){ burntInside(k, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, !vertical); k.radial((x0 + x1)/2, (y0 + y1)/2, Math.max(W, H)*0.7, '#0c0a08', 0.25); for(let i=0;i<3;i++) k.chunk(k.R(0.2, W - 0.2), y1 + 0.02, 0.06, '#3a3430', 0.02); return; }
    const mx = (x0 + x1)/2, my = (y0 + y1)/2;
    if(d.roof==='flat'){
      k.rr(x0, y0, x1 - x0, y1 - y0, 0.04); k.texFill('concrete', '#8a8780');
      k.rr(x0 + 0.14, y0 + 0.14, x1 - x0 - 0.28, y1 - y0 - 0.28, 0.02); k.texFill('roofing', '#46433f');
      c.save(); k.rr(x0 + 0.14, y0 + 0.14, x1 - x0 - 0.28, y1 - y0 - 0.28, 0.02); c.clip(); c.fillStyle = k.lin(0, y0 + 0.14, 0, y0 + 0.4, [[0, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(x0, y0, x1 - x0, 0.4); c.fillStyle = k.lin(x0 + 0.14, 0, x0 + 0.4, 0, [[0, 'rgba(0,0,0,.28)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(x0, y0, 0.4, y1 - y0);
        for(let i=0;i<3;i++) k.puddle(k.R(x0 + 0.5, x1 - 0.5), k.R(y0 + 0.5, y1 - 0.5), k.R(0.15, 0.35), k.R(0.1, 0.25)); k.leaves(x0, y0, x1 - x0, y1 - y0, 30); c.restore();
      k.rr(x0, y0, x1 - x0, y1 - y0, 0.04); k.stroke(k.INK, 0.014); k.line([x0 + 0.02, y0 + 0.02, x1 - 0.02, y0 + 0.02], 'rgba(255,250,240,.3)', 0.014);
      ventPipe(k, x1 - 0.5, y0 + 0.5, 0.07); ventPipe(k, x0 + 0.6, y1 - 0.6, 0.06);
      k.rr(mx - 0.25, my - 0.25, 0.5, 0.5, 0.02); k.texFill('metal', '#6d7376'); k.rr(mx - 0.25, my - 0.25, 0.5, 0.5, 0.02); k.stroke(k.INK, 0.012); k.line([mx - 0.25, my - 0.2, mx + 0.25, my - 0.2], '#2a2826', 0.02); // люк
    } else {
      const ridgeLen = vertical ? (y1 - y0) : (x1 - x0), span = vertical ? (x1 - x0) : (y1 - y0), hw = d.roof==='hip' ? span/2 : 0;
      // строим в «горизонтальной» системе: конёк по оси X; для вертикальных — поворачиваем точки
      const T = (x, y)=>vertical ? [mx - (y - my)*1, my + (x - mx)] : [x, y];
      const N = (nx, ny)=>vertical ? [-ny, nx] : [nx, ny];
      const lx0 = mx - ridgeLen/2, lx1 = mx + ridgeLen/2, ly0 = my - span/2, ly1 = my + span/2;
      const P = (arr)=>{ const o = []; for(let i=0;i<arr.length;i+=2){ const p = T(arr[i], arr[i + 1]); o.push(p[0], p[1]); } return o; };
      const angOff = vertical ? Math.PI/2 : 0;
      const faces = [
        {p:P([lx0, ly0, lx1, ly0, lx1 - hw, my, lx0 + hw, my]), a:Math.PI + angOff, n:N(0, -1), re:P([mx, my, mx, ly0])},
        {p:P([lx0 + hw, my, lx1 - hw, my, lx1, ly1, lx0, ly1]), a:angOff, n:N(0, 1), re:P([mx, my, mx, ly1])},
      ];
      if(hw) faces.push({p:P([lx0, ly0, lx0 + hw, my, lx0, ly1]), a:Math.PI/2 + angOff, n:N(-1, 0), re:P([lx0 + hw, my, lx0, my])}, {p:P([lx1, ly0, lx1, ly1, lx1 - hw, my]), a:-Math.PI/2 + angOff, n:N(1, 0), re:P([lx1 - hw, my, lx1, my])});
      faces.forEach(f=>roofFace(k, f.p, mat, tint, f.a, f.n, f.re));
      // кромки граней, конёк, рёбра вальм
      faces.forEach(f=>{ k.poly(f.p); k.stroke('rgba(10,8,6,.55)', 0.012); });
      const r0 = T(lx0 + hw, my), r1 = T(lx1 - hw, my);
      k.line([r0[0] + 0.012, r0[1] + 0.012, r1[0] + 0.012, r1[1] + 0.012], 'rgba(0,0,0,.4)', 0.07); k.line([r0[0], r0[1], r1[0], r1[1]], tint ? shade(tint, -0.25) : '#5a5650', 0.06); k.line([r0[0] - 0.01, r0[1] - 0.01, r1[0] - 0.01, r1[1] - 0.01], 'rgba(255,250,240,.28)', 0.015);
      for(let i=0;i<=Math.round(ridgeLen/0.3);i++){ const t = i/Math.round(ridgeLen/0.3), p = T(lx0 + hw + (ridgeLen - 2*hw)*t, my); k.line([p[0] - (vertical ? 0.03 : 0), p[1] - (vertical ? 0 : 0.03), p[0] + (vertical ? 0.03 : 0), p[1] + (vertical ? 0 : 0.03)], 'rgba(10,8,6,.35)', 0.008); }
      // водостоки по свесам
      [[lx0, ly0 - 0.035, lx1, ly0 - 0.035], [lx0, ly1 + 0.035, lx1, ly1 + 0.035]].forEach(q=>{ const a = T(q[0], q[1]), b = T(q[2], q[3]); k.line([a[0], a[1], b[0], b[1]], '#5f6466', 0.045); k.line([a[0], a[1] - 0.01, b[0], b[1] - 0.01], 'rgba(255,255,255,.2)', 0.01); for(let i=0;i<3;i++){ const t = k.rnd(); k.rust(a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t, 0.03, false); } });
      [[lx0 + 0.05, ly0 - 0.035], [lx1 - 0.05, ly1 + 0.035]].forEach(q=>{ const p = T(q[0], q[1]); k.rr(p[0] - 0.04, p[1] - 0.04, 0.08, 0.08, 0.01); k.fill('#555a5c'); k.stroke(k.INK, 0.008); });
      // поверхность: мох, листва, недостающая черепица
      c.save(); k.poly(P([lx0, ly0, lx1, ly0, lx1, ly1, lx0, ly1])); c.clip();
        if(d.moss) for(let i=0;i<d.moss;i++){ const p = T(k.R(lx0 + 0.3, lx1 - 0.3), k.R(ly0 + 0.1, my - 0.1)); k.moss(p[0], p[1], k.R(0.12, 0.28)); }
        if(d.missing) for(let i=0;i<d.missing;i++){ const p = T(k.R(lx0 + 0.3, lx1 - 0.3), k.R(ly0 + 0.2, ly1 - 0.2)); k.rr(p[0] - 0.12, p[1] - 0.08, k.R(0.15, 0.3), k.R(0.1, 0.2), 0.01); k.fill('#1e1a16'); for(let j=0;j<3;j++) k.line(vertical ? [p[0] - 0.12 + j*0.08, p[1] - 0.1, p[0] - 0.12 + j*0.08, p[1] + 0.12] : [p[0] - 0.14, p[1] - 0.06 + j*0.06, p[0] + 0.18, p[1] - 0.06 + j*0.06], '#6b5238', 0.02); }
        k.leaves(x0, y0, x1 - x0, y1 - y0, 25);
        for(let i=0;i<4;i++){ const p = T(k.R(lx0, lx1), ly1 - 0.05); k.streak(p[0], p[1] - 0.4, 0.4, 0.04, '#3a3026', 0.3); }
      c.restore();
      if(d.dmg===2){ const p = T(lx0 + ridgeLen*k.R(0.3, 0.65), ly0 + span*k.R(0.25, 0.4)); hole(k, p[0], p[1], Math.min(span, ridgeLen)*0.28, vertical ? 'v' : 'h'); }
    }
    if(d.chimney){ const p = d.chimney; chimney(k, p[0], p[1]); }
    (d.vents || []).forEach(p=>ventPipe(k, p[0], p[1], 0.06));
    if(d.dish) dish(k, d.dish[0], d.dish[1], 0.18);
    if(d.solar) solar(k, d.solar[0], d.solar[1], d.solar[2], d.solar[3], d.solarBroken);
    if(d.antenna) antenna(k, d.antenna[0], d.antenna[1], 0.7, d.antenna[2]);
    if(d.tarp){ const t = d.tarp; k.tarp(t[0], t[1], t[2], t[3], t[4], t[5] || 0); k.tire(t[0] + 0.12, t[1] + 0.12, 0.1); k.tire(t[0] + t[2] - 0.15, t[1] + t[3] - 0.15, 0.1); k.brick(t[0] + t[2]*0.5, t[1] + 0.08, 0.3, '#7a4c3e'); }
    if(d.annex){ const a = d.annex; c.save(); k.rr(a[0], a[1], a[2], a[3], 0.02); k.texFill('corrugated', '#7f8588', '#7a6a5a', 0.35); c.fillStyle = k.lin(a[0], a[1], a[0], a[1] + a[3], [[0, 'rgba(255,250,240,.1)'], [1, 'rgba(0,0,0,.3)']]); c.fill(); c.restore(); k.rr(a[0], a[1], a[2], a[3], 0.02); k.stroke(k.INK, 0.012); for(let i=0;i<3;i++) k.rust(k.R(a[0], a[0] + a[2]), k.R(a[1], a[1] + a[3]), 0.06, i===0); }
    if(d.garden) d.garden.forEach(b=>{ k.rr(b[0] + 0.03, b[1] + 0.04, b[2], b[3], 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(b[0], b[1], b[2], b[3], 0.02); k.texFill('wood', '#6b5236'); k.rr(b[0] + 0.06, b[1] + 0.06, b[2] - 0.12, b[3] - 0.12, 0.01); k.texFill('dirt', '#5e5143');
      const rows = Math.max(1, Math.round((b[3] - 0.12)/0.18)); for(let r=0;r<rows;r++) for(let x=b[0] + 0.12;x<b[0] + b[2] - 0.1;x+=0.13){ const y = b[1] + 0.1 + r*0.18 + 0.05; k.blot(x, y, 0.05, k.pick(['#5f7a3e', '#6e8a46', '#4e6a34']), 0.95, 0.6); k.line([x - 0.02, y - 0.02, x + 0.015, y + 0.01], 'rgba(200,220,150,.4)', 0.006); } });
    if(d.barrels) d.barrels.forEach(p=>{ c.beginPath(); c.arc(p[0] + 0.04, p[1] + 0.05, 0.16, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(p[0], p[1], 0.16, 0, 6.28); c.fillStyle = k.lin(p[0] - 0.16, p[1] - 0.16, p[0] + 0.16, p[1] + 0.16, [[0, '#4a6a8a'], [1, '#2a3e52']]); c.fill(); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(p[0], p[1], 0.11, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.01); c.beginPath(); c.arc(p[0] + 0.05, p[1] - 0.04, 0.025, 0, 6.28); k.fill('#1e2a36'); });
    if(d.porch){ const p = d.porch; k.rr(p[0] + 0.04, p[1] + 0.05, p[2], p[3], 0.01); k.fill('rgba(0,0,0,.35)'); k.rr(p[0], p[1], p[2], p[3], 0.01); k.texFill('corrugated', '#7f8588', '#6a6a6a', 0.3); k.rr(p[0], p[1], p[2], p[3], 0.01); k.stroke(k.INK, 0.012); }
    for(let i=0;i<6;i++){ c.fillStyle = 'rgba(232,228,216,.65)'; c.beginPath(); c.arc(k.R(x0, x1), k.R(y0, y1), 0.012, 0, 6.28); c.fill(); }
  }
  const HOUSE_SMALL = [
    {n:'Черепица, жилой вид', roof:'gable', mat:'rooftile', tint:'#8a4632', chimney:[1.9, 0.55], dish:[0.6, 2.2], vents:[[2.4, 2.3]], moss:2},
    {n:'Черепица, провал крыши', roof:'gable', mat:'rooftile', tint:'#7a4a38', dmg:2, chimney:[0.5, 0.5], missing:4, moss:3},
    {n:'Ржавый профнастил, латаный брезентом', roof:'gable', mat:'corrugated', tarp:[1.4, 1.6, 1.0, 0.8, '#3e5a72', 0.1], vents:[[0.6, 0.6]], antenna:[2.4, 0.5, 2.3]},
    {n:'Шифер, мох, солнечная панель', roof:'gable', mat:'rooftile', tint:'#6a6e70', moss:5, solar:[0.5, 1.75, 0.9, 0.6], solarBroken:true, chimney:[2.2, 0.6]},
    {n:'Плоская крыша, рубероид', roof:'flat', dish:[2.3, 2.3]},
    {n:'Выгоревший', dmg:3},
  ];
  const HOUSE_MID = [
    {n:'Вальмовая черепица', roof:'hip', mat:'rooftile', tint:'#8a4632', chimney:[2.3, 1.4], dish:[0.7, 3.8], vents:[[1.5, 3.2]], moss:2},
    {n:'Вальмовая, обрушена часть', roof:'hip', mat:'rooftile', tint:'#7e5040', dmg:2, missing:5, moss:3, chimney:[1.3, 1.2]},
    {n:'Профнастил, с пристройкой', roof:'gable', mat:'corrugated', main:[0, 0, 4, 3.6], annex:[0.3, 3.65, 3.4, 1.25], vents:[[1, 1]], antenna:[3, 0.6, 2.2]},
    {n:'Плоская крыша, огород', roof:'flat', garden:[[0.5, 0.5, 1.3, 1.6], [2.2, 0.5, 1.3, 1.6], [0.5, 2.5, 1.3, 1.1]], barrels:[[2.6, 2.9], [3.1, 3.4]], tarp:[2.1, 3.7, 1.5, 0.9, '#5a6a3a', 0.05]},
    {n:'Черепица, латаная', roof:'gable', mat:'rooftile', tint:'#7a5240', missing:6, moss:3, tarp:[0.7, 1.3, 1.3, 1.1, '#2e5a7a', -0.15], chimney:[2.6, 2.2], porch:[1.3, 4.55, 1.4, 0.4]},
    {n:'Выгоревший', dmg:3},
  ];
  // Многоэтажка: плоская кровля с парапетом и надстройками; варианты — как используют крышу
  function blockDraw(g, W, H, d){
    const k = hk(g), c = k.c, pw = 0.22;
    k.rr(0, 0, W, H, 0.03); k.texFill('concrete', '#8a8780'); k.rr(0, 0, W, H, 0.03); k.stroke(k.INK, 0.016); k.line([0.03, 0.03, W - 0.03, 0.03], 'rgba(255,250,240,.3)', 0.02); k.line([0.03, 0.03, 0.03, H - 0.03], 'rgba(255,250,240,.2)', 0.02);
    const ix0 = pw, iy0 = pw, ix1 = W - pw, iy1 = H - pw;
    k.rr(ix0, iy0, ix1 - ix0, iy1 - iy0, 0.02); k.texFill('roofing', '#46433f');
    c.save(); k.rr(ix0, iy0, ix1 - ix0, iy1 - iy0, 0.02); c.clip();
      c.fillStyle = k.lin(0, iy0, 0, iy0 + 0.45, [[0, 'rgba(0,0,0,.38)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(0, iy0, W, 0.45); c.fillStyle = k.lin(ix0, 0, ix0 + 0.45, 0, [[0, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(ix0, 0, 0.45, H);
      for(let i=0;i<(d.overgrown ? 9 : 4);i++) k.puddle(k.R(1, W - 1), k.R(1, H - 1), k.R(0.2, d.overgrown ? 0.7 : 0.4), k.R(0.15, 0.4));
      k.leaves(ix0, iy0, ix1 - ix0, iy1 - iy0, d.overgrown ? 120 : 40); k.trash(ix0, iy0, ix1 - ix0, iy1 - iy0, d.overgrown ? 30 : 12);
      if(d.overgrown){ for(let i=0;i<10;i++) k.moss(k.R(0.6, W - 0.6), k.R(0.6, H - 0.6), k.R(0.2, 0.5)); k.tufts(ix0, iy0, ix1 - ix0, iy1 - iy0, 70); }
      for(let i=0;i<5;i++){ const y = k.R(1, H - 1); k.line([ix0, y, ix0 + k.R(1, 3), y + k.R(-0.3, 0.3), ix0 + k.R(2, 4), y + k.R(-0.2, 0.5)], '#151311', 0.02, 0.8); } // кабели
    c.restore();
    // водостоки-воронки
    [[ix0 + 0.35, iy1 - 0.35], [ix1 - 0.35, iy0 + 0.35]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.1, 0, 6.28); k.fill('#2a2826'); for(let i=0;i<6;i++){ const a = i/6*6.28; k.line([x, y, x + Math.cos(a)*0.1, y + Math.sin(a)*0.1], '#55524e', 0.012); } });
    // машинные отделения лифтов и выходы на крышу
    const box = (x, y, w, h, door)=>{ k.rr(x + 0.1, y + 0.14, w, h, 0.02); k.fill('rgba(0,0,0,.42)'); k.rr(x, y, w, h, 0.02); k.texFill('concrete', '#8a8780'); k.rr(x + 0.08, y + 0.08, w - 0.16, h - 0.16, 0.01); k.texFill('roofing', '#3e3c39'); k.rr(x, y, w, h, 0.02); k.stroke(k.INK, 0.014); k.line([x + 0.02, y + 0.02, x + w - 0.02, y + 0.02], 'rgba(255,250,240,.3)', 0.016);
      ventPipe(k, x + w*0.7, y + h*0.4, 0.07); if(door){ k.rr(x + w*0.3, y + h - 0.02, 0.35, 0.08, 0.01); k.fill('#4a4e50'); k.stroke(k.INK, 0.008); } for(let i=0;i<3;i++) k.streak(x + k.R(0.1, w - 0.1), y + h, 0.3, 0.03, '#2a2622', 0.3); };
    box(W*0.33, H*0.12, W*0.34, H*0.17, true); box(W*0.33, H*0.68, W*0.34, H*0.15, true);
    // вентшахты рядами
    for(let i=0;i<4;i++){ const x = 0.8 + i*(W - 1.6)/3, y = H*0.45; k.rr(x - 0.18 + 0.05, y - 0.18 + 0.07, 0.36, 0.36, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(x - 0.18, y - 0.18, 0.36, 0.36, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.012); k.rr(x - 0.1, y - 0.1, 0.2, 0.2, 0.01); k.fill('#141210'); k.line([x - 0.1, y - 0.03, x + 0.1, y - 0.03], '#5a5650', 0.012); k.line([x - 0.1, y + 0.04, x + 0.1, y + 0.04], '#5a5650', 0.012); }
    if(!d.collapse) [[0.8, 1.2, -2.2], [W - 0.9, H - 1.4, 2.4], [W - 1.2, 1.0, -1.9], [1.0, H - 2.4, -2.6]].forEach(a=>{ k.line([a[0] + 0.04, a[1] + 0.05, a[0] + 0.04 + Math.cos(a[2])*1.1, a[1] + 0.05 + Math.sin(a[2])*1.1], 'rgba(0,0,0,.3)', 0.03); antenna(k, a[0], a[1], 1.1, a[2]); });
    [[0.55, 0.55], [W - 0.85, 0.6], [W - 0.9, H - 0.95], [0.6, H*0.5 + 1.4]].forEach((p, i)=>{ if(d.collapse && i===2) return; k.rr(p[0] + 0.05, p[1] + 0.07, 0.34, 0.26, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(p[0], p[1], 0.34, 0.26, 0.02); c.fillStyle = k.lin(p[0], p[1], p[0], p[1] + 0.26, [[0, '#b9b6ac'], [1, '#7e7b74']]); c.fill(); k.stroke(k.INK, 0.01);
      c.beginPath(); c.arc(p[0] + 0.13, p[1] + 0.13, 0.09, 0, 6.28); k.fill('#2a2826'); for(let j=0;j<4;j++){ const a = j/4*6.28 + i; k.line([p[0] + 0.13, p[1] + 0.13, p[0] + 0.13 + Math.cos(a)*0.08, p[1] + 0.13 + Math.sin(a)*0.08], '#6a6e70', 0.018); }
      for(let j=0;j<4;j++) k.line([p[0] + 0.25, p[1] + 0.05 + j*0.05, p[0] + 0.31, p[1] + 0.05 + j*0.05], '#4a4844', 0.01); k.rust(p[0] + 0.28, p[1] + 0.2, 0.04, false); k.streak(p[0] + 0.17, p[1] + 0.26, 0.25, 0.04, '#3a3026', 0.3); }); // кондиционеры
    if(!d.collapse && !d.nest){ dish(k, W - 1.6, H*0.6, 0.22); dish(k, 1.5, H*0.32, 0.2); }
    if(!d.garden && !d.nest && !d.collapse){ const ly = H*0.6 + 0.35; [[1.0, ly], [W - 1.0, ly + 0.08]].forEach(p=>{ k.c.beginPath(); k.c.arc(p[0], p[1], 0.04, 0, 6.28); k.fill('#3a3836'); }); k.line([1.0, ly, W - 1.0, ly + 0.08], '#d8d0bc', 0.008);
      for(let i=0;i<9;i++){ const x = 1.3 + i*(W - 2.6)/8, y = ly + 0.08*(x - 1)/(W - 2); c.save(); c.translate(x, y + 0.01); c.rotate(k.R(-0.1, 0.1)); k.rr(-0.08, 0, 0.16, k.R(0.14, 0.24), 0.01); k.fill(k.pick(['#8a7a6a', '#5a6a7a', '#9a8a5a', '#7a4a3a', '#c9c1a8', '#4a5a4a']), 0.9); k.stroke('rgba(0,0,0,.35)', 0.006); c.restore(); } } // бельё
    if(d.garden){ [[0.7, 2.2, 1.8, 1.0], [0.7, 3.5, 1.8, 1.0], [W - 2.5, 2.2, 1.8, 1.0], [W - 2.5, 3.5, 1.8, 1.0]].forEach(b=>houseBits.bed(k, b));
      [[W*0.5 - 0.6, H - 1.4], [W*0.5 + 0.6, H - 1.4]].forEach(p=>houseBits.tank(k, p[0], p[1], 0.38)); solar(k, 0.6, H - 1.6, 1.4, 0.8, false); k.tarp(W - 2.4, H - 1.8, 1.6, 1.1, '#4a5a34', 0.08); k.trash(0.5, 5, W - 1, 1, 8); }
    if(d.nest){ const cx = W*0.5, cy = H*0.52; for(let i=0;i<22;i++){ const a = i/22*6.28, x = cx + Math.cos(a)*1.25, y = cy + Math.sin(a)*0.95; if(a > 1.2 && a < 1.9) continue; houseBits.sandbag(k, x, y, a + Math.PI/2); }
      k.tarp(cx - 0.9, cy - 0.7, 1.0, 0.8, '#5a5a3e', 0.2); houseBits.crate(k, cx + 0.3, cy - 0.2, 0.4, 0.3, 0.2); houseBits.crate(k, cx + 0.45, cy + 0.25, 0.35, 0.25, -0.4);
      for(let i=0;i<30;i++){ c.save(); c.translate(cx + k.R(-0.8, 0.8), cy + k.R(-0.6, 0.6)); c.rotate(k.rnd()*6.28); c.fillStyle = k.pick(['#b8953a', '#a8853a', '#c9a24a']); c.fillRect(-0.02, -0.006, 0.04, 0.012); c.restore(); } // гильзы
      k.line([cx - 1.3, cy - 1.2, cx - 1.3, cy - 1.9], '#3a3836', 0.025); k.organic(cx - 1.15, cy - 1.8, 0.15, 0.4, 0.08); k.fill('#7a2a22'); }
    if(d.collapse){ const cx = W - 1.4, cy = H - 1.6, pts = [W - 2.9, H, W - 2.4, H - 1.6, W - 1.5, H - 2.9, W, H - 3.4, W, H];
      for(let f=0;f<4;f++){ const off = f*0.22; k.poly(pts.map((v, i)=>v + (i%2 ? off*0.6 : off*0.5))); k.fill(f%2 ? '#3a3632' : '#4a4540'); }
      k.poly(pts); c.fillStyle = k.lin(W - 2.5, H - 2.5, W, H, [[0, 'rgba(10,8,6,.2)'], [1, 'rgba(10,8,6,.85)']]); c.fill();
      for(let i=0;i<12;i++){ const t = k.rnd(), x = W - 2.9 + t*2.9, y = H - t*3.4; k.rebar([x, y, x + k.R(0.1, 0.35), y + k.R(0.05, 0.3)]); }
      for(let i=0;i<28;i++){ const t = k.rnd(); k.chunk(W - 3.2 + t*3.0 + k.R(-0.5, 0.2), H - t*3.6 + k.R(-0.6, 0.1), k.R(0.06, 0.2), k.pick(['#9a968e', '#86827a', '#7a766e']), 0.04); }
      for(let i=0;i<6;i++) k.line([W - 2.4 - k.R(0, 2), H - 1.6 - k.R(0, 2), W - 2.4, H - 1.6], 'rgba(15,12,10,.5)', 0.012); }
  }
  // мелочи, которые повторяются в разных объектах
  const houseBits = {
    bed(k, b){ k.rr(b[0] + 0.04, b[1] + 0.05, b[2], b[3], 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(b[0], b[1], b[2], b[3], 0.02); k.texFill('wood', '#6b5236'); k.rr(b[0], b[1], b[2], b[3], 0.02); k.stroke(k.INK, 0.012); k.rr(b[0] + 0.07, b[1] + 0.07, b[2] - 0.14, b[3] - 0.14, 0.01); k.texFill('dirt', '#5e5143');
      for(let y=b[1] + 0.16;y<b[1] + b[3] - 0.1;y+=0.2) for(let x=b[0] + 0.15;x<b[0] + b[2] - 0.1;x+=0.14){ k.blot(x, y, 0.055, k.pick(['#5f7a3e', '#6e8a46', '#4e6a34', '#7a7a3e']), 0.95, 0.6); k.line([x - 0.02, y - 0.02, x + 0.02, y + 0.01], 'rgba(200,220,150,.4)', 0.006); } },
    tank(k, x, y, r){ const c = k.c; c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.38)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#8a9294'], [1, '#4e5658']]); c.fill(); k.stroke(k.INK, 0.014);
      for(let i=1;i<4;i++){ c.beginPath(); c.arc(x, y, r*i/4, 0, 6.28); k.stroke('rgba(0,0,0,.25)', 0.008); } c.beginPath(); c.arc(x, y, r*0.18, 0, 6.28); k.fill('#2a2e30'); k.rust(x + r*0.4, y + r*0.3, r*0.3, false); k.line([x - r*0.7, y - r*0.5, x - r*0.2, y - r*0.85], 'rgba(255,255,255,.3)', r*0.08); },
    sandbag(k, x, y, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.ellipse(0.02, 0.03, 0.17, 0.09, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(0, 0, 0.17, 0.09, 0, 0, 6.28); c.fillStyle = k.lin(-0.17, -0.09, 0.17, 0.09, [[0, '#c2ac7a'], [1, '#8c7850']]); c.fill(); k.stroke('rgba(30,24,16,.7)', 0.01); k.line([-0.12, 0, 0.12, 0], 'rgba(60,48,30,.4)', 0.006); k.line([-0.15, -0.03, -0.15, 0.03], 'rgba(60,48,30,.6)', 0.01); c.restore(); },
    crate(k, x, y, w, h, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-w/2 + 0.03, -h/2 + 0.04, w, h, 0.01); k.fill('rgba(0,0,0,.38)'); k.rr(-w/2, -h/2, w, h, 0.01); k.texFill('wood', '#6b5236'); k.rr(-w/2, -h/2, w, h, 0.01); k.stroke(k.INK, 0.012); k.line([-w/2, -h/2, w/2, h/2], 'rgba(40,28,18,.6)', 0.02); k.line([w/2, -h/2, -w/2, h/2], 'rgba(40,28,18,.6)', 0.02); k.rr(-w/2 + 0.03, -h/2 + 0.03, w - 0.06, h - 0.06, 0.005); k.stroke('rgba(40,28,18,.45)', 0.012); c.restore(); },
  };
  const APT_BLOCK = [
    {n:'Жилой вид'},
    {n:'Огород на крыше', garden:true},
    {n:'Огневая точка', nest:true},
    {n:'Частичное обрушение', collapse:true},
    {n:'Заброшена, заросла', overgrown:true},
  ];
  // Руины: пол, остатки стен с рваными краями, завалы, балки, остатки мебели
  function wallRun(k, p, th, mat, shadow){ const c = k.c; // стена-полилиния: тень, кладка сверху, кромки
    if(shadow){ k.line(p.map((v, i)=>v + (i%2 ? 0.12 : 0.09)), 'rgba(0,0,0,.4)', th*1.05); }
    c.save(); c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.lineWidth = th; c.lineCap = 'butt'; c.lineJoin = 'miter'; c.strokeStyle = k.tex(mat) || '#8a8780'; c.stroke(); c.restore();
    c.save(); c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.lineWidth = th; c.lineCap = 'butt'; c.lineJoin = 'miter'; c.strokeStyle = 'rgba(10,8,6,.6)'; c.globalCompositeOperation = 'source-over'; c.setLineDash([]); c.lineWidth = th + 0.02; c.globalAlpha = 0.5; c.stroke(); c.restore();
    c.save(); c.beginPath(); c.moveTo(p[0], p[1]); for(let i=2;i<p.length;i+=2) c.lineTo(p[i], p[i + 1]); c.lineWidth = th - 0.02; c.lineCap = 'butt'; c.lineJoin = 'miter'; c.strokeStyle = k.tex(mat) || '#8a8780'; c.stroke(); c.restore();
    [[p[0], p[1], p[2], p[3]], [p[p.length - 2], p[p.length - 1], p[p.length - 4], p[p.length - 3]]].forEach(([x, y, x2, y2])=>{ const a = Math.atan2(y2 - y, x2 - x); for(let i=0;i<3;i++) k.chunk(x + Math.cos(a)*0.08 + k.R(-0.1, 0.1), y + Math.sin(a)*0.08 + k.R(-0.1, 0.1), k.R(0.05, 0.1), mat==='brickwall' ? '#7a4c3e' : '#8a8680', 0.03); }); }
  function ruinDraw(g, W, H, d){
    const k = hk(g), c = k.c, m = 0.15;
    k.rr(m, m, W - 2*m, H - 2*m, 0.02); k.texFill(d.floor || 'wood', '#6b5236', d.burnt ? '#2a2420' : null, 0.5);
    c.save(); k.rr(m, m, W - 2*m, H - 2*m, 0.02); c.clip();
      if(d.burnt){ c.fillStyle = 'rgba(16,13,11,.55)'; c.fillRect(0, 0, W, H); for(let i=0;i<10;i++) k.blot(k.R(0.4, W - 0.4), k.R(0.4, H - 0.4), k.R(0.15, 0.4), k.pick(['#5a524a', '#8a847a']), 0.35); }
      for(let i=0;i<6;i++) k.blot(k.R(0.4, W - 0.4), k.R(0.4, H - 0.4), k.R(0.2, 0.5), '#8a7e6a', 0.25);
      k.leaves(m, m, W - 2*m, H - 2*m, d.overgrown ? 90 : 30); k.trash(m, m, W - 2*m, H - 2*m, 14);
      if(d.overgrown){ k.tufts(m, m, W - 2*m, H - 2*m, 60); for(let i=0;i<6;i++) k.moss(k.R(0.5, W - 0.5), k.R(0.5, H - 0.5), k.R(0.2, 0.4)); }
    c.restore();
    d.walls.forEach(w=>wallRun(k, w, w.th || 0.24, d.mat, true));
    (d.inner || []).forEach(w=>wallRun(k, w, 0.13, d.mat==='brickwall' ? 'concrete' : d.mat, true));
    // мебель
    if(d.furniture){ const f = d.furniture;
      if(f.bed){ const [x, y, a] = f.bed; c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.45 + 0.03, -0.3 + 0.04, 0.9, 0.6, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(-0.45, -0.3, 0.9, 0.6, 0.02); k.fill(d.burnt ? '#2a2420' : '#3e3a36'); k.stroke(k.INK, 0.012); for(let i=-3;i<=3;i++) k.line([-0.4, i*0.07, 0.4, i*0.07], d.burnt ? '#5a4a3e' : '#6e6a64', 0.008); for(let i=-4;i<=4;i++) k.line([i*0.09, -0.26, i*0.09, 0.26], d.burnt ? '#5a4a3e' : '#6e6a64', 0.008); if(!d.burnt){ k.rr(-0.4, -0.25, 0.55, 0.5, 0.05); k.fill('#6a5a50', 0.85); k.blot(-0.1, 0.05, 0.12, '#4a3a30', 0.6); } c.restore(); }
      if(f.table){ const [x, y, a] = f.table; c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.3 + 0.03, -0.2 + 0.04, 0.6, 0.4, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(-0.3, -0.2, 0.6, 0.4, 0.02); k.texFill('wood', '#6b5236'); k.rr(-0.3, -0.2, 0.6, 0.4, 0.02); k.stroke(k.INK, 0.012); [[-0.25, -0.15], [0.25, -0.15], [-0.25, 0.15]].forEach(([lx, ly])=>{ c.fillStyle = '#3a2a1e'; c.fillRect(lx - 0.025, ly - 0.025, 0.05, 0.05); }); c.restore(); }
      if(f.stove){ const [x, y] = f.stove; k.rr(x + 0.03, y + 0.04, 0.4, 0.4, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(x, y, 0.4, 0.4, 0.02); k.fill('#bdb8ac'); k.stroke(k.INK, 0.012); [[0.11, 0.11], [0.29, 0.11], [0.11, 0.29], [0.29, 0.29]].forEach(([a, b])=>{ k.c.beginPath(); k.c.arc(x + a, y + b, 0.06, 0, 6.28); k.fill('#2a2826'); }); k.rust(x + 0.3, y + 0.32, 0.06, false); }
      if(f.tub){ const [x, y, a] = f.tub; c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.4 + 0.03, -0.2 + 0.04, 0.8, 0.4, 0.12); k.fill('rgba(0,0,0,.35)'); k.rr(-0.4, -0.2, 0.8, 0.4, 0.12); k.fill('#d6d2c6'); k.stroke(k.INK, 0.012); k.rr(-0.33, -0.13, 0.66, 0.26, 0.09); c.fillStyle = k.lin(0, -0.13, 0, 0.13, [[0, '#a8a498'], [1, '#e2ded2']]); c.fill(); k.blot(0.1, 0.02, 0.08, '#7a5a3a', 0.5); c.restore(); } }
    // балки и завалы
    (d.beams || []).forEach(b=>k.plank(b[0], b[1], b[2], 0.13, b[3], d.burnt ? '#2a2018' : '#6b5236', true));
    (d.piles || []).forEach(p=>{ k.blot(p[0], p[1], p[2]*1.1, '#7a7468', 0.5); for(let i=0;i<Math.round(p[2]*40);i++){ const a = k.rnd()*6.28, r = k.rnd()*p[2]; const x = p[0] + Math.cos(a)*r, y = p[1] + Math.sin(a)*r*0.8; if(d.mat==='brickwall' && k.rnd() < 0.55) k.brick(x, y, k.rnd()*6.28, k.pick(['#7a4c3e', '#8a5a48', '#6b4034'])); else k.chunk(x, y, k.R(0.04, 0.13), k.pick(['#9a968e', '#86827a', '#7a766e', '#a8a29a']), 0.03); }
      for(let i=0;i<2;i++) k.rebar([p[0] + k.R(-0.3, 0.3), p[1] + k.R(-0.3, 0.3), p[0] + k.R(-0.5, 0.5), p[1] + k.R(-0.5, 0.5)]); });
    for(let i=0;i<14;i++) k.chunk(k.R(0.2, W - 0.2), k.R(0.2, H - 0.2), k.R(0.03, 0.07), k.pick(['#9a968e', '#7a4c3e', '#86827a']), 0.02);
    if(d.overgrown){ for(let i=0;i<2;i++){ const x = k.R(1, W - 1), y = k.R(1, H - 1); houseBits.bush(k, x, y, k.R(0.35, 0.55)); } }
  }
  houseBits.bush = (k, x, y, r)=>{ const c = k.c; c.beginPath(); c.arc(x + r*0.25, y + r*0.3, r, 0, 6.28); k.fill('rgba(0,0,0,.35)'); for(let i=0;i<9;i++){ const a = i/9*6.28, d = r*0.5; k.blot(x + Math.cos(a)*d, y + Math.sin(a)*d, r*0.55, k.pick(['#4e5a3a', '#5a6640', '#46523a']), 1, 0.4); } k.blot(x, y, r*0.6, '#5f6e44', 1, 0.4); for(let i=0;i<14;i++){ const a = k.rnd()*6.28, d = k.rnd()*r; c.fillStyle = k.rnd() < 0.5 ? 'rgba(150,170,110,.5)' : 'rgba(20,26,14,.45)'; c.beginPath(); c.arc(x + Math.cos(a)*d - r*0.15, y + Math.sin(a)*d - r*0.15, r*0.08, 0, 6.28); c.fill(); } };
  const RUIN_HOUSE = [
    {n:'Кирпичный, без крыши', mat:'brickwall', floor:'wood', walls:[[0.15, 2.4, 0.15, 0.15, 3.85, 0.15, 3.85, 1.6], [2.9, 3.85, 3.85, 3.85, 3.85, 3.1], [0.15, 3.3, 0.15, 3.85, 1.2, 3.85]], inner:[[2.0, 0.15, 2.0, 1.4]], piles:[[3.0, 2.4, 0.6], [1.0, 2.8, 0.5]], beams:[[1.9, 2.0, 1.6, 0.5]], furniture:{bed:[0.8, 0.9, 0.1], table:[2.9, 0.9, 0.6]}},
    {n:'Бетонный, обрушен наполовину', mat:'concrete', floor:'tiles', walls:[[0.15, 3.85, 0.15, 0.15, 2.3, 0.15], [0.15, 3.85, 1.4, 3.85]], inner:[[0.15, 1.8, 1.4, 1.8]], piles:[[2.8, 2.6, 1.0], [3.2, 1.0, 0.6], [1.9, 3.3, 0.5]], beams:[[2.4, 1.8, 1.8, 2.2]], furniture:{tub:[0.7, 1.2, 0], stove:[0.4, 2.2]}},
    {n:'Выгоревший', mat:'brickwall', floor:'wood', burnt:true, walls:[[0.15, 3.85, 0.15, 0.15, 3.85, 0.15, 3.85, 2.8], [1.6, 3.85, 3.0, 3.85]], inner:[[2.0, 0.15, 2.0, 2.2]], piles:[[3.0, 3.2, 0.55]], beams:[[1.0, 1.5, 1.8, 0.8], [2.8, 2.0, 1.5, -0.4], [1.2, 2.9, 1.3, 0.2]], furniture:{bed:[0.9, 0.8, 0], stove:[2.5, 0.5]}},
    {n:'Заросший', mat:'brickwall', floor:'tiles', overgrown:true, walls:[[0.15, 2.0, 0.15, 0.15, 2.6, 0.15], [3.85, 1.0, 3.85, 3.85, 2.2, 3.85]], piles:[[2.0, 2.0, 0.6], [0.9, 3.2, 0.5]], beams:[[3.0, 1.0, 1.4, 1.2]], furniture:{table:[1.2, 1.0, -0.4]}},
  ];
  const RUIN_CORNER = [
    {n:'Кирпичный угол', mat:'brickwall', walls:[[0.15, 2.6, 0.15, 0.15, 2.5, 0.15]], piles:[[0.9, 0.9, 0.6], [1.9, 0.6, 0.35]], beams:[[1.2, 1.6, 1.2, 0.7]]},
    {n:'Бетонная панель', mat:'concrete', walls:[[0.18, 2.85, 0.18, 0.18, 2.85, 0.18]], piles:[[1.0, 1.1, 0.75]], beams:[]},
    {n:'Угол с упавшей плитой', mat:'concrete', walls:[[0.15, 1.9, 0.15, 0.15, 2.0, 0.15]], piles:[[0.8, 0.7, 0.45]], slab:[1.7, 1.7, 0.6], beams:[]},
  ];
  function cornerDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(1.1, 1.1, 1.3, 0.35); k.fill('#8a7e6a', 0.3);
    if(d.slab){ const [x, y, a] = d.slab; c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.8 + 0.08, -0.5 + 0.1, 1.6, 1.0, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(-0.8, -0.5, 1.6, 1.0, 0.02); k.texFill('concrete', '#8a8780'); k.rr(-0.8, -0.5, 1.6, 1.0, 0.02); k.stroke(k.INK, 0.014); k.line([-0.78, -0.48, 0.78, -0.48], 'rgba(255,250,240,.3)', 0.016); for(let i=0;i<6;i++) k.rebar([0.8, -0.4 + i*0.16, 0.8 + k.R(0.1, 0.3), -0.4 + i*0.16 + k.R(-0.08, 0.08)]); k.line([-0.3, -0.5, 0.1, 0.1, -0.1, 0.5], 'rgba(15,12,10,.6)', 0.012); c.restore(); }
    d.walls.forEach(w=>wallRun(k, w, d.mat==='concrete' ? 0.3 : 0.24, d.mat, true));
    if(d.mat==='concrete') d.walls.forEach(w=>{ [[w[0], w[1]], [w[w.length - 2], w[w.length - 1]]].forEach(([x, y])=>{ for(let i=0;i<4;i++) k.rebar([x + k.R(-0.1, 0.1), y + k.R(-0.1, 0.1), x + k.R(-0.3, 0.3), y + k.R(-0.3, 0.3)]); }); });
    d.piles.forEach(p=>{ k.blot(p[0], p[1], p[2]*1.1, '#7a7468', 0.5); for(let i=0;i<Math.round(p[2]*45);i++){ const a = k.rnd()*6.28, r = k.rnd()*p[2]; const x = p[0] + Math.cos(a)*r, y = p[1] + Math.sin(a)*r*0.8; if(d.mat==='brickwall' && k.rnd() < 0.6) k.brick(x, y, k.rnd()*6.28, k.pick(['#7a4c3e', '#8a5a48', '#6b4034'])); else k.chunk(x, y, k.R(0.04, 0.14), k.pick(['#9a968e', '#86827a', '#7a766e']), 0.03); } });
    (d.beams || []).forEach(b=>k.plank(b[0], b[1], b[2], 0.13, b[3], '#6b5236', true));
    k.leaves(0, 0, 3, 3, 25); k.trash(0.3, 0.3, 2.4, 2.4, 6); }
  /* ---- Город (HD): двор, разметка, транспорт, завалы, уличные мелочи ---- */
  // стереть краску пятнами (для разметки): выедает уже нарисованное на спрайте
  function erode(k, x, y, w, h, amt){ const c = k.c; if(!(c.canvas && c.canvas.__sprite)) return; /* только в спрайте: иначе стёрло бы карту под объектом */ c.save(); c.globalCompositeOperation = 'destination-out'; for(let i=0;i<Math.round(w*h*120*amt);i++){ const r = k.R(0.01, 0.06)*(0.5 + amt); k.organic(x + k.rnd()*w, y + k.rnd()*h, r, 0.6); c.fillStyle = `rgba(0,0,0,${k.R(0.4, 1)})`; c.fill(); } c.restore(); }
  function paintBar(k, x, y, w, h, col, a){ const c = k.c; c.save(); c.globalAlpha = a; c.fillStyle = col; c.fillRect(x, y, w, h); c.restore(); }
  function yardDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(2, 2, 1.9, 0.12); k.texFill(d.burnt ? 'ash' : 'dust', '#a09380'); k.organic(2, 2, 1.9, 0.12); k.stroke('rgba(60,50,40,.35)', 0.02);
    c.save(); k.organic(2, 2, 1.9, 0.12); c.clip(); for(let i=0;i<5;i++) k.blot(k.R(0.5, 3.5), k.R(0.5, 3.5), k.R(0.2, 0.5), '#6a5e4c', 0.25); if(d.overgrown){ k.tufts(0.1, 0.1, 3.8, 3.8, 110); for(let i=0;i<6;i++) k.moss(k.R(0.4, 3.6), k.R(0.4, 3.6), k.R(0.15, 0.35)); } else k.tufts(0.1, 0.1, 3.8, 3.8, 25); k.leaves(0, 0, 4, 4, 50); k.trash(0.2, 0.2, 3.6, 3.6, d.burnt ? 20 : 10); c.restore();
    // песочница
    k.rr(0.42, 0.42, 1.3, 1.3, 0.02); k.fill('rgba(0,0,0,.3)'); k.rr(0.4, 0.4, 1.3, 1.3, 0.02); k.texFill('sand', '#b8a989'); c.save(); k.rr(0.4, 0.4, 1.3, 1.3, 0.02); c.lineWidth = 0.2; c.strokeStyle = k.tex('wood') || '#6b5236'; c.stroke(); c.restore(); k.rr(0.3, 0.3, 1.5, 1.5, 0.03); k.stroke(k.INK, 0.012); k.rr(0.5, 0.5, 1.1, 1.1, 0.01); k.stroke('rgba(0,0,0,.4)', 0.01);
    c.save(); k.rr(0.5, 0.5, 1.1, 1.1, 0.01); c.clip(); for(let i=0;i<8;i++) k.blot(k.R(0.6, 1.5), k.R(0.6, 1.5), 0.04, '#8a7a5e', 0.5); if(!d.burnt){ c.beginPath(); c.arc(1.2, 0.9, 0.07, 0, 6.28); k.fill('#8a3a2e'); k.stroke(k.INK, 0.008); } k.leaves(0.5, 0.5, 1.1, 1.1, 12); c.restore();
    // качели: стойки А-образные, перекладина, сиденья на цепях
    const sx0 = 2.3, sx1 = 3.7, sy = 0.75;
    if(d.wrecked){ k.line([2.2, 0.5, 3.6, 1.3], '#3a3836', 0.07); k.line([2.2, 0.5, 3.6, 1.3], k.tex('rust') || '#6b4a3a', 0.05); k.rust(2.9, 0.9, 0.08, false); }
    else { [sx0, sx1].forEach(x=>{ k.line([x - 0.02, sy - 0.32 + 0.03, x + 0.03, sy + 0.32 + 0.04], 'rgba(0,0,0,.35)', 0.05); k.line([x, sy - 0.35, x, sy + 0.35], '#4a4e50', 0.045); [[x, sy - 0.35], [x, sy + 0.35]].forEach(([px, py])=>{ c.beginPath(); c.arc(px, py, 0.035, 0, 6.28); k.fill('#2a2826'); }); });
      k.line([sx0 + 0.03, sy + 0.05, sx1 + 0.03, sy + 0.05], 'rgba(0,0,0,.4)', 0.07); k.line([sx0, sy, sx1, sy], '#5a6064', 0.06); k.line([sx0, sy - 0.015, sx1, sy - 0.015], 'rgba(255,255,255,.25)', 0.012); for(let i=0;i<4;i++) k.rust(k.R(sx0, sx1), sy, 0.035, false);
      [[2.75, 0], [3.3, d.overgrown ? 0.6 : 0.25]].forEach(([x, a])=>{ c.save(); c.translate(x, sy + 0.25); c.rotate(a); k.line([-0.12, -0.25, -0.12, 0], '#6a6e70', 0.008, 0.8, [0.02, 0.012]); k.line([0.12, -0.25, 0.12, 0], '#6a6e70', 0.008, 0.8, [0.02, 0.012]); k.rr(-0.15 + 0.02, -0.04 + 0.03, 0.3, 0.09, 0.01); k.fill('rgba(0,0,0,.3)'); k.rr(-0.15, -0.04, 0.3, 0.09, 0.01); k.texFill('wood', '#6b5236'); k.rr(-0.15, -0.04, 0.3, 0.09, 0.01); k.stroke(k.INK, 0.008); c.restore(); }); }
    // горка: лестница и скат
    if(!d.wrecked){ c.save(); c.translate(2.9, 2.5); c.rotate(-0.5); k.line([-0.4, -0.1, -0.05, -0.1], '#4a4e50', 0.025); k.line([-0.4, 0.1, -0.05, 0.1], '#4a4e50', 0.025); for(let i=0;i<5;i++) k.line([-0.38 + i*0.08, -0.1, -0.38 + i*0.08, 0.1], '#5a5e60', 0.015);
      k.rr(-0.05, -0.17, 0.3, 0.34, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); k.rr(0.25 + 0.03, -0.11 + 0.05, 0.8, 0.22, 0.05); k.fill('rgba(0,0,0,.35)'); k.rr(0.25, -0.11, 0.8, 0.22, 0.05); c.fillStyle = k.lin(0.25, -0.11, 0.25, 0.11, [[0, '#a8aeb2'], [0.5, '#d6dade'], [1, '#7e8488']]); c.fill(); k.stroke(k.INK, 0.01); k.rust(0.7, 0.03, 0.06, false); k.rust(0.95, -0.04, 0.04, false); c.restore(); }
    else for(let i=0;i<3;i++) k.tire(k.R(2.4, 3.6), k.R(2.2, 3.2), 0.14);
    // карусель
    const cx = 1.1, cy = 3.0; c.beginPath(); c.arc(cx + 0.05, cy + 0.06, 0.48, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(cx, cy, 0.48, 0, 6.28); k.texFill('metal', '#6d7376', d.burnt ? '#2a2826' : '#8a5a3a', 0.35); k.stroke(k.INK, 0.012);
    for(let i=0;i<6;i++){ const a = i/6*6.28 + 0.3; k.line([cx, cy, cx + Math.cos(a)*0.48, cy + Math.sin(a)*0.48], 'rgba(20,18,16,.6)', 0.012); k.line([cx + Math.cos(a)*0.2, cy + Math.sin(a)*0.2, cx + Math.cos(a + 0.4)*0.38, cy + Math.sin(a + 0.4)*0.38], '#4a4e50', 0.02); }
    c.beginPath(); c.arc(cx, cy, 0.08, 0, 6.28); k.fill('#3a3836'); for(let i=0;i<3;i++) k.rust(cx + k.R(-0.3, 0.3), cy + k.R(-0.3, 0.3), 0.06, false);
    // скамья
    c.save(); c.translate(2.2, 3.55); k.rr(-0.55 + 0.03, -0.12 + 0.04, 1.1, 0.24, 0.02); k.fill('rgba(0,0,0,.3)'); for(let i=0;i<3;i++){ if(d.wrecked && i===1) continue; k.rr(-0.55, -0.12 + i*0.08, 1.1, 0.07, 0.01); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.008); } k.line([-0.45, -0.13, -0.45, 0.13], '#3a3836', 0.03); k.line([0.45, -0.13, 0.45, 0.13], '#3a3836', 0.03); c.restore();
    if(d.overgrown) [[3.5, 2.0, 0.4], [0.5, 2.2, 0.3]].forEach(b=>houseBits.bush(k, b[0], b[1], b[2]));
    if(d.burnt){ for(let i=0;i<4;i++) k.radial(k.R(1, 3), k.R(1, 3), k.R(0.4, 0.8), '#0c0a08', 0.4); k.blot(2.6, 2.6, 0.35, '#2a2622', 0.7); for(let i=0;i<6;i++) k.chunk(2.6 + k.R(-0.3, 0.3), 2.6 + k.R(-0.3, 0.3), 0.05, '#1e1a16', 0.02); } }
  const YARD = [{n:'Заброшенная площадка'}, {n:'Заросшая', overgrown:true}, {n:'Разорённая, следы костра', wrecked:true, burnt:true}];
  // Разметка (наземные): краска + выщербины, трещины, пятна масла, выбоины
  function crossDraw(g, d){ const k = hk(g), c = k.c, a = d.paint;
    const side = (fn)=>{ for(let r=0;r<4;r++){ c.save(); c.translate(2, 2); c.rotate(r*Math.PI/2); c.translate(-2, -2); fn(r); c.restore(); } };
    side(()=>{ for(let i=0;i<6;i++) paintBar(k, 0.6 + i*0.48, 0.05, 0.3, 0.55, '#e4ddca', a); paintBar(k, 0.6, 0.72, 2.8, 0.08, '#e4ddca', a); });
    c.save(); c.globalAlpha = a*0.8; k.poly([1.3, 1.25, 1.45, 1.25, 1.45, 1.6, 1.6, 1.6, 1.37, 1.85, 1.14, 1.6, 1.3, 1.6]); k.fill('#e4ddca'); c.restore();
    erode(k, 0, 0, 4, 4, d.wear);
    for(let i=0;i<d.cracks;i++) k.line([k.R(0, 4), k.R(0, 4), k.R(0, 4), k.R(0, 4), k.R(0, 4), k.R(0, 4)], 'rgba(15,13,11,.6)', 0.018);
    for(let i=0;i<3;i++) k.blot(k.R(0.8, 3.2), k.R(0.8, 3.2), k.R(0.15, 0.35), '#141210', 0.35);
    // люк
    const mx = 2.3, my = 2.3; c.beginPath(); c.arc(mx, my, 0.3, 0, 6.28); k.fill('#3a3836'); k.stroke(k.INK, 0.014); c.beginPath(); c.arc(mx, my, 0.27, 0, 6.28); k.texFill('metal', '#5c6265', '#4a4644', 0.4); c.save(); c.beginPath(); c.arc(mx, my, 0.26, 0, 6.28); c.clip(); for(let i=-6;i<=6;i++){ k.line([mx - 0.3, my + i*0.05, mx + 0.3, my + i*0.05 + 0.1], 'rgba(20,18,16,.5)', 0.012); } c.restore(); k.rust(mx + 0.1, my + 0.08, 0.08, false); c.beginPath(); c.arc(mx, my, 0.3, 0, 6.28); k.stroke('rgba(255,255,255,.18)', 0.01);
    for(let i=0;i<d.holes;i++){ const x = k.R(0.7, 3.3), y = k.R(0.7, 3.3), r = k.R(0.18, 0.35); k.organic(x, y, r, 0.4, r*0.8); k.texFill('gravel', '#77736c'); k.organic(x, y, r, 0.4, r*0.8); k.stroke('rgba(10,8,6,.7)', 0.02); k.puddle(x + 0.03, y + 0.03, r*0.55, r*0.4); for(let j=0;j<5;j++) k.chunk(x + k.R(-r, r), y + k.R(-r, r), 0.04, '#4a4844', 0.015); } }
  const CROSS = [{n:'Стёртая разметка', paint:0.75, wear:0.8, cracks:5, holes:0}, {n:'Заметная разметка', paint:0.85, wear:0.35, cracks:3, holes:0}, {n:'С выбоинами', paint:0.6, wear:1.0, cracks:8, holes:4}];
  function zebraDraw(g, d){ const k = hk(g); for(let i=0;i<5;i++) paintBar(k, 0.12 + i*0.6, 0.08, 0.36, 0.84, '#e4ddca', d.paint); erode(k, 0, 0, 3, 1, d.wear); for(let i=0;i<d.cracks;i++) k.line([k.R(0, 3), 0, k.R(0, 3), 0.5, k.R(0, 3), 1], 'rgba(15,13,11,.55)', 0.015); if(d.grass) k.tufts(0, 0, 3, 1, 14); k.blot(k.R(0.5, 2.5), 0.5, 0.2, '#141210', 0.25); }
  const ZEBRA = [{n:'Чёткая', paint:0.85, wear:0.3, cracks:1}, {n:'Стёртая', paint:0.75, wear:0.8, cracks:3}, {n:'Почти исчезла', paint:0.55, wear:1.3, cracks:5, grass:true}];
  function parkingDraw(g, d){ const k = hk(g), c = k.c;
    for(let i=0;i<=4;i++) paintBar(k, i - 0.04, 0, 0.08, 2.1, '#e4ddca', d.paint); paintBar(k, 0, 2.06, 4, 0.08, '#e4ddca', d.paint);
    c.save(); c.globalAlpha = d.paint*0.6; c.fillStyle = '#e4ddca'; c.font = '700 0.42px Arial, sans-serif'; c.textAlign = 'center'; for(let i=0;i<4;i++) c.fillText(String(i + 1 + d.n0), i + 0.5, 1.7); c.restore();
    erode(k, 0, 0, 4, 2.2, d.wear);
    for(let i=0;i<4;i++){ if(k.rnd() < 0.8){ k.blot(i + 0.5 + k.R(-0.15, 0.15), k.R(0.8, 1.3), k.R(0.15, 0.3), '#141210', 0.4); k.blot(i + 0.5, k.R(0.9, 1.2), 0.08, '#4a3e5e', 0.12); }
      const sx = i + 0.18, sy = 0.12; k.rr(sx + 0.03, sy + 0.05, 0.64, 0.16, 0.03); k.fill('rgba(0,0,0,.35)'); k.rr(sx, sy, 0.64, 0.16, 0.03); k.texFill('concrete', '#8a8780'); k.rr(sx, sy, 0.64, 0.16, 0.03); k.stroke(k.INK, 0.01); k.line([sx + 0.03, sy + 0.03, sx + 0.6, sy + 0.03], 'rgba(255,250,240,.35)', 0.012); if(k.rnd() < 0.4) k.chunk(sx + 0.55, sy + 0.1, 0.06, '#8a8780', 0.02); }
    if(d.trash) k.trash(0.1, 0.4, 3.8, 2.5, 26); if(d.grass){ for(let i=0;i<=4;i++) k.tufts(i - 0.1, 0, 0.2, 2.2, 6); k.tufts(0, 2.1, 4, 0.2, 12); } k.leaves(0, 0, 4, 3, 30);
    for(let i=0;i<3;i++) k.line([k.R(0, 4), k.R(0, 3), k.R(0, 4), k.R(0, 3)], 'rgba(15,13,11,.5)', 0.014); }
  const PARKING = [{n:'Пустая', paint:0.8, wear:0.5, n0:0}, {n:'Пятна масла и мусор', paint:0.7, wear:0.8, n0:4, trash:true}, {n:'Стёртая, проросла трава', paint:0.55, wear:1.2, n0:8, grass:true}];
  // Автобус / троллейбус
  function busDraw(g, d){ const k = hk(g), c = k.c, paint = d.burnt ? '#2e2a27' : d.paint, pD = shade(paint, -0.42), pL = shade(paint, 0.18);
    const X0 = 0.06, X1 = 0.94, Y0 = 0.06, Y1 = 3.94;
    if(!d.burnt){ c.save(); c.globalAlpha = 0.35; c.beginPath(); c.ellipse(0.55, 2.2, 0.5, 1.6, 0.05, 0, 6.28); k.fill('#16130f'); c.restore(); }
    [[0.7, 0], [0.7, 1], [3.2, 0], [3.2, 1]].forEach(([y, s], i)=>{ const x = s ? X1 - 0.02 : X0 + 0.02, gone = d.wheelsGone && d.wheelsGone.indexOf(i)>=0; if(gone){ k.rr(x - 0.05, y - 0.16, 0.1, 0.32, 0.03); k.fill('rgba(10,8,6,.7)'); return; } k.rr(x - 0.06, y - 0.18, 0.12, 0.36, 0.04); k.fill(d.burnt ? '#2a2624' : '#1c1b1a'); for(let j=0;j<7;j++) k.line([x - 0.04, y - 0.14 + j*0.047, x + 0.04, y - 0.14 + j*0.047], d.burnt ? '#5a4a3e' : '#46433f', 0.012); });
    const body = ()=>k.rr(X0, Y0, X1 - X0, Y1 - Y0, 0.12);
    body(); c.fillStyle = k.lin(X0, 0, X1, 0, [[0, pD], [0.15, shade(paint, -0.15)], [0.45, pL], [0.85, shade(paint, -0.15)], [1, pD]]); c.fill();
    c.save(); body(); c.clip();
      if(d.stripe && !d.burnt){ c.fillStyle = d.stripe; c.fillRect(X0, Y0, 0.08, Y1 - Y0); c.fillRect(X1 - 0.08, Y0, 0.08, Y1 - Y0); }
      for(let i=1;i<7;i++) k.seam([X0 + 0.04, Y0 + i*0.55, X1 - 0.04, Y0 + i*0.55], 0.01, 0.7);
      if(d.burnt){ for(let i=0;i<14;i++) k.blot(k.R(0.15, 0.85), k.R(0.3, 3.7), k.R(0.06, 0.18), k.pick(['#7a4126', '#9a5a30', '#b8b2a6', '#0c0b0a']), k.R(0.4, 0.75)); for(let i=0;i<2;i++){ const y = k.R(1.2, 2.8); k.organic(0.5, y, 0.28, 0.4, 0.22); k.fill('#0e0c0a'); c.save(); k.organic(0.5, y, 0.28, 0.4, 0.22); c.clip(); for(let j=0;j<6;j++) k.line([0.2, y - 0.25 + j*0.1, 0.8, y - 0.25 + j*0.1], '#3a2a20', 0.03); c.restore(); } }
      else { for(let i=0;i<6;i++) k.peel(k.R(0.2, 0.8), k.R(0.3, 3.7), k.R(0.03, 0.06), pL); k.radial(0.5, 1.5, 0.8, '#bfb5a0', 0.12); }
      for(let i=0;i<8;i++) k.rust(k.rnd() < 0.5 ? X0 + 0.02 : X1 - 0.02, k.R(0.3, 3.7), k.R(0.03, 0.08), d.burnt && k.rnd() < 0.3);
      k.rust(k.R(0.3, 0.7), Y0 + 0.05, 0.05, false); k.rust(k.R(0.3, 0.7), Y1 - 0.05, 0.06, false);
      for(let i=0;i<3;i++) k.dent(k.R(0.25, 0.75), k.R(0.4, 3.6), k.R(0.06, 0.12));
      let dg = k.lin(X0, 0, X0 + 0.1, 0, [[0, 'rgba(70,58,44,.55)'], [1, 'rgba(70,58,44,0)']]); c.fillStyle = dg; c.fillRect(0, 0, 0.2, 4); dg = k.lin(X1, 0, X1 - 0.1, 0, [[0, 'rgba(70,58,44,.55)'], [1, 'rgba(70,58,44,0)']]); c.fillStyle = dg; c.fillRect(0.8, 0, 0.2, 4);
    c.restore(); body(); k.stroke(k.INK, 0.016);
    // окна по бортам (видны полосками), лобовое и заднее стекло
    for(let i=0;i<7;i++){ const y = 0.42 + i*0.48; [[X0 + 0.005, X0 + 0.07], [X1 - 0.07, X1 - 0.005]].forEach(([a, b], s)=>{ const broken = d.burnt || k.rnd() < d.broken; k.fillP([a, y, b, y + 0.02, b, y + 0.4, a, y + 0.42], broken ? '#171411' : '#2f3a3c'); if(!broken) k.line([a + 0.01, y + 0.05, b - 0.01, y + 0.3], 'rgba(220,228,228,.22)', 0.008); }); }
    const ws = [0.1, Y0 + 0.04, 0.9, Y0 + 0.04, 0.88, Y0 + 0.26, 0.12, Y0 + 0.26]; k.glass(()=>k.poly(ws), 0.1, Y0, 0.9, Y0 + 0.26, d.burnt || d.wsBroken);
    if(!d.burnt && !d.wsBroken){ const ix = 0.6, iy = Y0 + 0.14; for(let i=0;i<8;i++){ const a = i/8*6.28; k.line([ix, iy, ix + Math.cos(a)*0.15, iy + Math.sin(a)*0.08], 'rgba(228,234,234,.55)', 0.005); } }
    k.rr(0.3, Y0 + 0.28, 0.4, 0.07, 0.01); k.fill(d.burnt ? '#1e1b18' : '#1a1a18'); if(!d.burnt){ c.save(); c.fillStyle = 'rgba(200,170,80,.6)'; for(let i=0;i<5;i++) c.fillRect(0.33 + i*0.07, Y0 + 0.295, 0.04, 0.04); c.restore(); } // табло маршрута
    k.glass(()=>k.rr(0.18, Y1 - 0.2, 0.64, 0.12, 0.02), 0.18, Y1 - 0.2, 0.82, Y1 - 0.08, d.burnt);
    // крыша: люки, кондиционер, решётка двигателя
    [[0.3, 1.0], [0.3, 2.6]].forEach(([x, y], i)=>{ k.rr(x + 0.03, y + 0.04, 0.4, 0.34, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(x, y, 0.4, 0.34, 0.02); if(d.burnt && i){ k.fill('#0e0c0a'); } else { k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); k.line([x, y + 0.05, x + 0.4, y + 0.05], '#2a2826', 0.02); } });
    if(!d.trolley){ k.rr(0.2 + 0.05, 1.6 + 0.06, 0.6, 0.75, 0.04); k.fill('rgba(0,0,0,.4)'); k.rr(0.2, 1.6, 0.6, 0.75, 0.04); k.texFill('metal', '#8a9094', d.burnt ? '#2a2624' : null); k.stroke(k.INK, 0.012); [[0.5, 1.8], [0.5, 2.15]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.13, 0, 6.28); k.fill('#2a2826'); for(let i=0;i<5;i++){ const a = i/5*6.28; k.line([x, y, x + Math.cos(a)*0.12, y + Math.sin(a)*0.12], '#5a5e60', 0.02); } c.beginPath(); c.arc(x, y, 0.03, 0, 6.28); k.fill('#6a6e70'); }); }
    else { k.rr(0.3, 2.9, 0.4, 0.3, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); [[0.38, 3.0], [0.62, 3.0]].forEach(([x, y], i)=>{ const ex = x + (i ? 0.08 : -0.08), ey = 0.3; k.line([x + 0.03, y + 0.04, ex + 0.03, ey + 0.05], 'rgba(0,0,0,.35)', 0.03); k.line([x, y, ex, ey], '#2a2826', 0.026); k.line([x - 0.006, y, ex - 0.006, ey], 'rgba(255,255,255,.2)', 0.006); c.beginPath(); c.arc(ex, ey, 0.03, 0, 6.28); k.fill('#3a3836'); }); }
    for(let i=0;i<8;i++) k.line([0.25, Y1 - 0.42 + i*0.03, 0.75, Y1 - 0.42 + i*0.03], d.burnt ? '#3a2a20' : '#2a2826', 0.012);
    k.leaves(0.1, 0.4, 0.8, 3.4, 20); if(!d.burnt) for(let i=0;i<6;i++){ c.fillStyle = 'rgba(232,228,216,.7)'; c.beginPath(); c.arc(k.R(0.2, 0.8), k.R(0.5, 3.5), 0.012, 0, 6.28); c.fill(); } }
  const BUS = [{n:'Городской автобус', paint:'#8f9a9c', stripe:'#2f4a6a', broken:0.3}, {n:'Школьный автобус', paint:'#a88a32', stripe:'#1e1c1a', broken:0.45, wheelsGone:[2]}, {n:'Троллейбус', paint:'#8e3e32', stripe:'#c9bfa4', broken:0.5, trolley:true, wsBroken:true}, {n:'Сгоревший', burnt:true, wheelsGone:[1, 3], broken:1}];
  // Завалы: пыль, крупные обломки снизу, мелкие сверху, кирпич, доски, арматура, трубы
  function rubbleDraw(g, W, H, d){ const k = hk(g), c = k.c, cx = W/2, cy = H/2, rx = W*0.47, ry = H*0.45;
    k.organic(cx, cy, rx, 0.25, ry); k.fill('#8a8070', 0.45); k.organic(cx, cy, rx*0.8, 0.3, ry*0.8); k.fill('#6a6258', 0.4);
    const cols = d.mat==='brick' ? ['#7a4c3e', '#8a5a48', '#6b4034', '#9a968e'] : d.mat==='wood' ? ['#6b5236', '#5a4430', '#7a6040', '#8a8578'] : ['#9a968e', '#86827a', '#7a766e', '#a8a29a', '#7a4c3e'];
    if(d.slab){ const [x, y, a, w, h] = d.slab; c.save(); c.translate(x, y); c.rotate(a); k.rr(-w/2 + 0.1, -h/2 + 0.12, w, h, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(-w/2, -h/2, w, h, 0.02); k.texFill('concrete', '#8a8780'); k.rr(-w/2, -h/2, w, h, 0.02); k.stroke(k.INK, 0.016); k.line([-w/2 + 0.02, -h/2 + 0.02, w/2 - 0.02, -h/2 + 0.02], 'rgba(255,250,240,.3)', 0.016); k.line([-w*0.2, -h/2, w*0.05, 0, -w*0.1, h/2], 'rgba(15,12,10,.6)', 0.014); for(let i=0;i<7;i++) k.rebar([w/2, -h/2 + (i + 0.5)*h/7, w/2 + k.R(0.1, 0.35), -h/2 + (i + 0.5)*h/7 + k.R(-0.1, 0.1)]); c.restore(); }
    const layers = [[0.16, 0.26, 0.35], [0.09, 0.17, 0.6], [0.04, 0.09, 1]];
    layers.forEach(([r0, r1, spread], li)=>{ const n = Math.round(W*H*(li===0 ? 4 : li===1 ? 8 : 14)); for(let i=0;i<n;i++){ const a = k.rnd()*6.28, rr0 = Math.sqrt(k.rnd())*spread; const x = cx + Math.cos(a)*rx*rr0, y = cy + Math.sin(a)*ry*rr0;
      if(d.mat==='brick' && k.rnd() < 0.55) k.brick(x, y, k.rnd()*6.28, k.pick(cols)); else if(d.mat==='wood' && k.rnd() < 0.5) k.plank(x, y, k.R(0.3, 0.7), k.R(0.08, 0.13), k.rnd()*6.28, k.pick(cols), k.rnd() < 0.6); else k.chunk(x, y, k.R(r0, r1), k.pick(cols), 0.03 + (2 - li)*0.02); } });
    if(d.mat==='mixed' || d.mat==='wood') for(let i=0;i<Math.round(W*H*0.8);i++) k.plank(cx + k.R(-rx, rx)*0.7, cy + k.R(-ry, ry)*0.7, k.R(0.35, 0.8), 0.1, k.rnd()*6.28, k.pick(['#6b5236', '#5a4430']), true);
    for(let i=0;i<Math.round(W*H*1.2);i++) k.rebar([cx + k.R(-rx, rx)*0.7, cy + k.R(-ry, ry)*0.7, cx + k.R(-rx, rx)*0.8, cy + k.R(-ry, ry)*0.8]);
    if(d.pipe){ const [x, y, a, L] = d.pipe; c.save(); c.translate(x, y); c.rotate(a); k.rr(-L/2 + 0.05, -0.12 + 0.07, L, 0.24, 0.1); k.fill('rgba(0,0,0,.4)'); k.rr(-L/2, -0.12, L, 0.24, 0.1); c.fillStyle = k.lin(0, -0.12, 0, 0.12, [[0, '#9aa0a2'], [0.4, '#c6cbcc'], [1, '#5a6062']]); c.fill(); k.stroke(k.INK, 0.012); c.beginPath(); c.ellipse(L/2, 0, 0.05, 0.12, 0, 0, 6.28); k.fill('#1e1c1a'); k.rust(0, 0.05, 0.1, false); c.restore(); }
    if(d.door){ const [x, y, a] = d.door; c.save(); c.translate(x, y); c.rotate(a); carDraw({ctx:c, rnd:k.rnd}, Object.assign({}, CAR_VARIANTS[7], {body:'sedan'})); c.restore(); }
    if(d.sandbags) for(let i=0;i<9;i++) houseBits.sandbag(k, 0.5 + i*0.36, H - 0.35, k.R(-0.2, 0.2));
    if(d.tires) for(let i=0;i<3;i++) k.tire(k.R(0.5, W - 0.5), k.R(0.4, H*0.5), 0.17);
    k.radial(cx - rx*0.2, cy - ry*0.2, Math.max(rx, ry)*0.8, '#d8d2c4', 0.16); k.leaves(0, 0, W, H, Math.round(W*H*4)); k.trash(cx - rx*0.8, cy - ry*0.8, rx*1.6, ry*1.6, Math.round(W*H*1.5)); }
  const RUBBLE = [{n:'Бетонный', mat:'concrete'}, {n:'Кирпичный', mat:'brick'}, {n:'Смешанный', mat:'mixed'}, {n:'Деревянный', mat:'wood'}];
  const RUBBLE_BIG = [{n:'Обрушенная плита', mat:'concrete', slab:[1.6, 1.4, 0.25, 2.2, 1.2]}, {n:'Смешанный, с трубой', mat:'mixed', pipe:[2.4, 1.0, -0.4, 1.8]}, {n:'Баррикада', mat:'brick', sandbags:true, tires:true, pipe:[1.4, 0.8, 0.15, 1.5]}];
  // Ограждения: бетонные «джерси», крашеные, пластиковые водоналивные
  function jerseyDraw(g, d){ const k = hk(g), c = k.c;
    [0.05, 1.05].forEach((x0, i)=>{ const w = 0.9, y0 = 0.18, h = 0.64;
      if(d.plastic){ const col = i ? '#c9c2b4' : '#b8622e'; k.rr(x0 + 0.05, y0 + 0.07, w, h, 0.1); k.fill('rgba(0,0,0,.35)'); k.rr(x0, y0, w, h, 0.1); c.fillStyle = k.lin(0, y0, 0, y0 + h, [[0, shade(col, 0.2)], [0.45, col], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.012);
        k.rr(x0 + 0.08, y0 + 0.22, w - 0.16, 0.2, 0.06); k.fill(shade(col, 0.12)); k.stroke('rgba(0,0,0,.3)', 0.008); c.beginPath(); c.arc(x0 + w/2, y0 + 0.32, 0.06, 0, 6.28); k.fill('#2a2826'); for(let j=0;j<4;j++) k.blot(x0 + k.R(0.1, w - 0.1), y0 + k.R(0.1, h - 0.1), 0.04, '#5a5048', 0.4); if(i===0){ k.line([x0 + 0.2, y0 + 0.1, x0 + 0.5, y0 + 0.5], 'rgba(20,16,14,.7)', 0.01); } return; }
      k.rr(x0 + 0.06, y0 + 0.08, w, h, 0.05); k.fill('rgba(0,0,0,.38)'); k.rr(x0, y0, w, h, 0.05); k.texFill('concrete', '#8a8780');
      c.save(); k.rr(x0, y0, w, h, 0.05); c.clip(); if(!d.striped) k.concreteDetail(x0, y0, w, h, 0.32); c.fillStyle = k.lin(0, y0, 0, y0 + h, [[0, 'rgba(255,250,240,.12)'], [0.4, 'rgba(0,0,0,0)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(x0, y0, w, h);
        if(d.striped) for(let j=0;j<4;j++){ c.save(); c.globalAlpha = 0.75; c.fillStyle = j%2 ? '#d8d0bc' : '#8e3a2e'; c.fillRect(x0 + j*w/4, y0, w/4, h); c.restore(); }
        if(d.graffiti && i===0) k.graffiti(x0 + 0.08, y0 + 0.05, 0.75, 0.2, '#3a6a8a'); erode(k, x0, y0, w, h, 0.15);
      c.restore();
      k.rr(x0 + 0.06, y0 + h*0.42, w - 0.12, h*0.16, 0.02); k.texFill('concrete', '#9a968e'); k.line([x0 + 0.06, y0 + h*0.42, x0 + w - 0.06, y0 + h*0.42], 'rgba(255,250,240,.35)', 0.012); k.line([x0 + 0.06, y0 + h*0.58, x0 + w - 0.06, y0 + h*0.58], 'rgba(0,0,0,.3)', 0.012);
      k.rr(x0, y0, w, h, 0.05); k.stroke(k.INK, 0.012);
      [[x0 + 0.2, y0 + h/2], [x0 + w - 0.2, y0 + h/2]].forEach(([x, y])=>{ k.line([x - 0.05, y, x + 0.05, y], '#4a3424', 0.025); k.line([x - 0.05, y - 0.006, x + 0.05, y - 0.006], 'rgba(220,160,110,.35)', 0.006); });
      for(let j=0;j<3;j++){ const ex = x0 + k.R(0.05, w - 0.05), ey = k.rnd() < 0.5 ? y0 + 0.02 : y0 + h - 0.02; k.organic(ex, ey, k.R(0.04, 0.08), 0.5); k.fill('#5a5650'); }
      if(i===1 && d.broken){ k.organic(x0 + w - 0.05, y0 + h*0.5, 0.18, 0.5, 0.3); k.fill('#4a4640'); for(let j=0;j<4;j++) k.rebar([x0 + w - 0.1, y0 + 0.2 + j*0.08, x0 + w + 0.06, y0 + 0.2 + j*0.08 + k.R(-0.04, 0.04)]); for(let j=0;j<4;j++) k.chunk(x0 + w + 0.02 + k.R(-0.05, 0.05), y0 + k.R(0.1, h - 0.1), 0.05, '#8a8780', 0.02); } }); }
  const JERSEY = [{n:'Бетонные', graffiti:true, broken:true}, {n:'Красно-белые', striped:true}, {n:'Пластиковые водоналивные', plastic:true}];
  // Мост: настил, отбойники, перила, фонари, деформационные швы; варианты разрушения
  function bridgeDraw(g, d){ const k = hk(g), c = k.c, W = 3, H = 8;
    const deck = (y0, y1)=>{ k.rr(0, y0, W, y1 - y0, 0.01); k.texFill('concrete', '#8a8780'); c.beginPath(); c.rect(0.28, y0, W - 0.56, y1 - y0); k.texFill(d.potholes ? 'cracked' : 'asphalt', '#46433f');
      c.save(); c.beginPath(); c.rect(0.28, y0, W - 0.56, y1 - y0); c.clip(); for(let y=y0 + 0.2;y<y1;y+=0.9) paintBar(k, 1.47, y, 0.06, 0.45, '#e4ddca', 0.55); erode(k, 1.4, y0, 0.2, y1 - y0, 0.8); for(let i=0;i<4;i++) k.blot(k.R(0.5, 2.5), k.R(y0 + 0.3, y1 - 0.3), k.R(0.15, 0.3), '#141210', 0.3); k.leaves(0.3, y0, W - 0.6, y1 - y0, 30); k.trash(0.3, y0, W - 0.6, y1 - y0, 10);
        if(d.potholes) for(let i=0;i<5;i++){ const x = k.R(0.6, 2.4), y = k.R(y0 + 0.4, y1 - 0.4), r = k.R(0.15, 0.3); k.organic(x, y, r, 0.4, r*0.8); k.texFill('gravel', '#77736c'); k.organic(x, y, r, 0.4, r*0.8); k.stroke('rgba(10,8,6,.7)', 0.02); k.puddle(x, y, r*0.5, r*0.35); } c.restore();
      [0.28, W - 0.28].forEach(x=>{ k.line([x, y0, x, y1], 'rgba(0,0,0,.35)', 0.03); });
      [0.08, W - 0.08].forEach((x, s)=>{ k.line([x + 0.02, y0, x + 0.02, y1], 'rgba(0,0,0,.35)', 0.05); k.line([x, y0, x, y1], '#5a5e60', 0.04); k.line([x - 0.008, y0, x - 0.008, y1], 'rgba(255,255,255,.25)', 0.01); for(let y=y0 + 0.1;y<y1;y+=0.5){ if(k.rnd() < d.railLoss) continue; k.rr(x - 0.04, y - 0.04, 0.08, 0.08, 0.01); k.fill('#3e4244'); } for(let i=0;i<3;i++) k.rust(x, k.R(y0, y1), 0.05, false); }); };
    if(d.gap){ const [g0, g1] = d.gap; c.fillStyle = k.lin(0, g0, 0, g1, [[0, '#14110f'], [0.5, '#0a0908'], [1, '#14110f']]); c.fillRect(0, g0 - 0.1, W, g1 - g0 + 0.2);
      c.save(); c.beginPath(); c.rect(0, g0, W, g1 - g0); c.clip(); k.texFill('water', '#2e3c40'); c.fillStyle = 'rgba(8,7,6,.6)'; c.fillRect(0, g0, W, g1 - g0); for(let i=0;i<8;i++) k.chunk(k.R(0.3, 2.7), k.R(g0 + 0.3, g1 - 0.3), k.R(0.1, 0.25), '#5a5650', 0.05); c.restore();
      deck(0, g0); deck(g1, H);
      [[g0, -1], [g1, 1]].forEach(([y, s])=>{ c.save(); c.beginPath(); let px = 0; c.moveTo(0, y - s*0.3); c.lineTo(0, y); for(let x=0.15;x<=W;x+=0.15) c.lineTo(x, y + s*k.R(-0.12, 0.12)); c.lineTo(W, y - s*0.3); c.closePath(); c.fillStyle = s < 0 ? '#3a3632' : '#3a3632'; c.globalCompositeOperation = 'source-over'; c.fill(); c.restore();
        for(let i=0;i<14;i++) k.rebar([k.R(0.1, 2.9), y - s*0.05, k.R(0.1, 2.9), y + s*k.R(0.15, 0.45)]); for(let i=0;i<6;i++) k.chunk(k.R(0.2, 2.8), y - s*k.R(0.1, 0.35), k.R(0.06, 0.14), '#8a8680', 0.03); });
      c.save(); c.translate(1.2, (g0 + g1)/2 + 0.1); c.rotate(0.35); k.rr(-0.6 + 0.1, -0.4 + 0.12, 1.2, 0.8, 0.02); k.fill('rgba(0,0,0,.45)'); k.rr(-0.6, -0.4, 1.2, 0.8, 0.02); k.texFill('asphalt', '#46433f'); k.stroke(k.INK, 0.014); c.restore(); }
    else deck(0, H);
    [[1.0, 0], [3.6, 1], [6.2, 0]].forEach(([y, s])=>{ if(d.gap && y > d.gap[0] - 0.3 && y < d.gap[1] + 0.3) return; const x = s ? W - 0.08 : 0.08, ax = s ? W - 0.6 : 0.6; k.line([x + 0.04, y + 0.05, ax + 0.04, y + 0.05], 'rgba(0,0,0,.35)', 0.04); k.line([x, y, ax, y], '#4a4e50', 0.035); c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#3a3e40'); k.rr(ax - 0.1, y - 0.05, 0.2, 0.1, 0.03); k.fill('#5a5e60'); k.stroke(k.INK, 0.008); k.rr(ax - 0.08, y - 0.03, 0.16, 0.06, 0.02); k.fill(d.potholes && s ? '#1a1816' : '#b9b6a8'); });
    [2.7, 5.3].forEach(y=>{ if(d.gap && y > d.gap[0] - 0.2 && y < d.gap[1] + 0.2) return; c.fillStyle = '#3a3836'; c.fillRect(0.28, y - 0.04, W - 0.56, 0.08); for(let x=0.3;x<W - 0.3;x+=0.08) k.line([x, y - 0.04, x + 0.04, y + 0.04], '#6a6e70', 0.012); });
    if(d.car){ c.save(); c.translate(1.9, 1.9); c.rotate(0.25); carDraw({ctx:c, rnd:k.rnd}, CAR_VARIANTS[4]); c.restore(); } }
  const BRIDGE = [{n:'Целый пролёт', railLoss:0.1}, {n:'Разбитый, с брошенной машиной', potholes:true, railLoss:0.35, car:true}, {n:'Обрушенный пролёт', gap:[3.4, 5.1], railLoss:0.3}];
  function pillarDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(1, 1, 0.95, 0.25); k.fill('#7a7468', 0.35);
    const top = ()=>k.rr(0.35, 0.35, 1.3, 1.3, 0.06);
    if(d.broken){ const p = [0.35, 0.6, 0.9, 0.35, 1.65, 0.35, 1.65, 1.2, 1.1, 1.65, 0.35, 1.65]; k.fillP(p.map((v, i)=>v + (i%2 ? 0.16 : 0.12)), 'rgba(0,0,0,.42)'); k.poly(p); k.texFill('concrete', '#8a8780'); k.poly(p); k.stroke(k.INK, 0.016);
      k.fillP([0.9, 0.35, 1.65, 0.35, 1.65, 1.2], '#5a5650', 0.8); for(let i=0;i<16;i++) k.rebar([k.R(0.9, 1.6), k.R(0.4, 1.1), k.R(0.9, 1.9), k.R(0.1, 1.2)]); for(let i=0;i<20;i++) k.chunk(k.R(0.1, 1.9), k.R(0.1, 1.9), k.R(0.05, 0.14), k.pick(['#9a968e', '#86827a']), 0.03); }
    else { k.rr(0.35 + 0.14, 0.35 + 0.18, 1.3, 1.3, 0.06); k.fill('rgba(0,0,0,.45)'); top(); k.texFill('concrete', '#8a8780'); c.save(); top(); c.clip(); k.concreteDetail(0.35, 0.35, 1.3, 1.3, 0.43); c.fillStyle = k.lin(0.35, 0.35, 1.65, 1.65, [[0, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(0, 0, 2, 2); for(let i=0;i<3;i++) k.line([k.R(0.4, 1.6), 0.35, k.R(0.6, 1.4), k.R(0.8, 1.2), k.R(0.4, 1.6), 1.65], 'rgba(15,12,10,.55)', 0.012); k.graffiti(0.5, 1.2, 0.9, 0.3, '#8a3a5a'); c.restore(); top(); k.stroke(k.INK, 0.016); k.bevel(top, 0.03);
      [[0.6, 0.85], [1.15, 0.85]].forEach(([x, y])=>{ k.rr(x, y, 0.25, 0.3, 0.02); k.fill('#232120'); k.stroke('rgba(255,255,255,.12)', 0.008); }); for(let i=0;i<10;i++){ const x = k.R(0.45, 1.55), y = k.rnd() < 0.5 ? 0.45 : 1.55; k.rebar([x, y, x + k.R(-0.08, 0.08), y + k.R(-0.08, 0.08)]); } for(let i=0;i<4;i++) k.streak(k.R(0.4, 1.6), 1.0, 0.6, 0.05, '#6a4028', 0.35); } }
  const PILLAR = [{n:'Опора'}, {n:'Разрушенная опора', broken:true}];
  // Фонарный столб (вид сверху): основание, ствол, консоль, светильник
  function lampDraw(g, d){ const k = hk(g), c = k.c, bx = 0.5, by = 0.5;
    const head = (x, y, a, broken)=>{ c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.13 + 0.03, -0.06 + 0.04, 0.26, 0.12, 0.05); k.fill('rgba(0,0,0,.35)'); k.rr(-0.13, -0.06, 0.26, 0.12, 0.05); c.fillStyle = k.lin(0, -0.06, 0, 0.06, [[0, '#7a7e80'], [1, '#3e4244']]); c.fill(); k.stroke(k.INK, 0.008); k.rr(-0.08, -0.035, 0.16, 0.07, 0.03); k.fill(broken ? '#1a1816' : '#c8c2a8'); if(broken) for(let i=0;i<4;i++) k.line([0, 0, k.R(-0.08, 0.08), k.R(-0.04, 0.04)], 'rgba(220,228,228,.6)', 0.004); c.restore(); };
    if(d.fallen){ k.rr(bx - 0.13, by - 0.13 + 0.25, 0.26, 0.26, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(bx, by + 0.38, 0.06, 0, 6.28); k.fill('#2a2826'); for(let i=0;i<4;i++) k.line([bx, by + 0.38, bx + k.R(-0.08, 0.08), by + 0.38 + k.R(-0.08, 0.08)], '#6a6e70', 0.01);
      k.line([bx + 0.05, by + 0.38 + 0.05, 0.98, -0.02 + 0.05], 'rgba(0,0,0,.35)', 0.07); k.line([bx, by + 0.38, 0.95, -0.02], '#4a4e50', 0.06); k.line([bx - 0.01, by + 0.37, 0.94, -0.03], 'rgba(255,255,255,.22)', 0.012); for(let i=0;i<3;i++) k.rust(bx + (0.45)*(i + 1)/4, by + 0.38 - 0.4*(i + 1)/4, 0.035, false);
      head(0.2, 0.15, -0.6, true); for(let i=0;i<8;i++) k.fillP((()=>{ const x = k.R(0.05, 0.4), y = k.R(0.05, 0.35); return [x, y, x + 0.03, y + 0.01, x + 0.01, y + 0.025]; })(), 'rgba(198,212,212,.7)'); return; }
    k.rr(bx - 0.13 + 0.03, by - 0.13 + 0.04, 0.26, 0.26, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(bx - 0.13, by - 0.13, 0.26, 0.26, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]].forEach(([a, b])=>{ c.beginPath(); c.arc(bx + a, by + b, 0.015, 0, 6.28); k.fill('#5a5e60'); });
    const arms = d.double ? [[-1, 0], [1, 0]] : [[0, -1]];
    arms.forEach(([ax, ay], i)=>{ let ex = bx + ax*0.4, ey = by + ay*0.42; if(d.bent){ ex = bx + 0.32; ey = by - 0.18; } c.beginPath(); c.moveTo(bx + 0.04, by + 0.05); c.quadraticCurveTo(bx + ax*0.15 + 0.04, by + ay*0.25 + 0.05, ex + 0.04, ey + 0.05); k.stroke('rgba(0,0,0,.35)', 0.04); c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(bx + ax*0.15, by + ay*0.25, ex, ey); k.stroke('#4a4e50', 0.034); k.rust(bx + (ex - bx)*0.5, by + (ey - by)*0.5, 0.025, false); head(ex, ey, d.bent ? 0.9 : Math.atan2(ay, ax || 0.0001), d.bent); });
    c.beginPath(); c.arc(bx + 0.02, by + 0.03, 0.07, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(bx, by, 0.065, 0, 6.28); c.fillStyle = k.lin(bx - 0.06, by - 0.06, bx + 0.06, by + 0.06, [[0, '#8a8e90'], [1, '#3a3e40']]); c.fill(); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(bx, by, 0.03, 0, 6.28); k.fill('#5a5e60');
    if(d.poster) k.rr(bx - 0.08, by + 0.07, 0.16, 0.1, 0.005), k.fill('#c9c1a8', 0.85); }
  const LAMP = [{n:'Одинарный'}, {n:'Двойной', double:true}, {n:'Погнутый', bent:true, poster:true}, {n:'Упавший', fallen:true}];
  // Дорожные знаки: лицом к зрителю (так читаются на карте), с износом
  function signDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.42;
    c.beginPath(); c.arc(0.5 + 0.03, 0.82 + 0.03, 0.05, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(0.5, 0.82, 0.045, 0, 6.28); k.fill('#5a5e60'); k.stroke(k.INK, 0.008); k.line([0.5, 0.82, 0.5, cy + 0.2], '#6a6e70', 0.03);
    c.save(); c.translate(cx, cy); if(d.bent) c.rotate(0.35), c.transform(1, 0.15, 0, 0.9, 0, 0);
      const shape = ()=>{ if(d.kind==='stop'){ c.beginPath(); for(let i=0;i<8;i++){ const a = Math.PI/8 + i*Math.PI/4; c.lineTo(Math.cos(a)*0.3, Math.sin(a)*0.3); } c.closePath(); } else if(d.kind==='yield'){ k.poly([0, 0.27, -0.31, -0.25, 0.31, -0.25]); } else if(d.kind==='warn'){ k.poly([0, -0.3, 0.32, 0.25, -0.32, 0.25]); } else if(d.kind==='dir'){ k.rr(-0.38, -0.2, 0.76, 0.4, 0.03); } else { c.beginPath(); c.arc(0, 0, 0.29, 0, 6.28); } };
      c.save(); c.translate(0.03, 0.04); shape(); k.fill('rgba(0,0,0,.35)'); c.restore();
      shape(); k.fill(d.kind==='dir' ? '#3a5a7a' : '#d9d2c0'); shape(); k.stroke('#1e1c1a', 0.012);
      if(d.kind==='stop'){ c.save(); c.scale(0.86, 0.86); shape(); k.fill('#8e2e26'); c.restore(); c.fillStyle = '#e4ddca'; c.font = '700 0.13px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('STOP', 0, 0.01); }
      if(d.kind==='yield'){ c.save(); c.scale(0.8, 0.8); c.translate(0, -0.02); k.poly([0, 0.27, -0.31, -0.25, 0.31, -0.25]); c.restore(); k.c.lineWidth = 0.06; k.c.strokeStyle = '#8e2e26'; k.poly([0, 0.22, -0.25, -0.2, 0.25, -0.2]); k.c.stroke(); }
      if(d.kind==='warn'){ k.poly([0, -0.2, 0.22, 0.18, -0.22, 0.18]); c.lineWidth = 0.05; c.strokeStyle = '#8e2e26'; c.stroke(); c.fillStyle = '#1e1c1a'; c.fillRect(-0.02, -0.08, 0.04, 0.14); c.fillRect(-0.02, 0.09, 0.04, 0.04); }
      if(d.kind==='speed'){ c.beginPath(); c.arc(0, 0, 0.25, 0, 6.28); c.lineWidth = 0.06; c.strokeStyle = '#8e2e26'; c.stroke(); c.fillStyle = '#1e1c1a'; c.font = '700 0.2px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('40', 0, 0.01); }
      if(d.kind==='dir'){ c.fillStyle = '#d9d2c0'; k.poly([-0.3, -0.03, 0.15, -0.03, 0.15, -0.1, 0.3, 0, 0.15, 0.1, 0.15, 0.03, -0.3, 0.03]); c.fill(); c.font = '700 0.07px Arial, sans-serif'; c.textAlign = 'left'; c.fillText('ЦЕНТР 12', -0.32, -0.12); }
      c.save(); shape(); c.clip(); for(let i=0;i<3;i++) k.rust(k.R(-0.25, 0.25), k.R(-0.25, 0.25), k.R(0.015, 0.035), false); k.radial(0.1, 0.1, 0.3, '#5a5040', 0.3); erode(k, -0.35, -0.35, 0.7, 0.7, 0.12);
        for(let i=0;i<(d.shots || 0);i++){ const x = k.R(-0.22, 0.22), y = k.R(-0.2, 0.2); c.beginPath(); c.arc(x, y, 0.016, 0, 6.28); k.fill('#0c0a08'); c.beginPath(); c.arc(x, y, 0.025, 0, 6.28); k.stroke('rgba(200,196,188,.7)', 0.006); } c.restore();
    c.restore(); }
  const SIGN = [{n:'Стоп', kind:'stop', shots:2}, {n:'Уступи дорогу', kind:'yield'}, {n:'Ограничение 40', kind:'speed', shots:4}, {n:'Указатель, простреленный', kind:'dir', shots:7}, {n:'Осторожно, погнутый', kind:'warn', bent:true}];
  // Остановка: навес из поликарбоната на раме, скамья, рекламный щит
  function stopDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); c.translate(0.5, 1.5); k.rr(-0.06, -1.0, 0.36, 2.0, 0.02); k.fill('rgba(0,0,0,.3)'); for(let i=0;i<3;i++){ k.rr(-0.05 + i*0.1, -0.95, 0.08, 1.9, 0.01); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.008); } c.restore();
    k.rr(0.62, 2.55, 0.26, 0.26, 0.03); k.fill('#3e4244'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0.75, 2.68, 0.08, 0, 6.28); k.fill('#1a1816'); k.trash(0.4, 2.3, 0.6, 0.6, 6);
    if(d.collapsed){ c.save(); c.translate(0.55, 1.6); c.rotate(0.22); c.transform(1, 0, 0.12, 1, 0, 0); k.rr(-0.48 + 0.1, -1.35 + 0.12, 0.96, 2.7, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(-0.48, -1.35, 0.96, 2.7, 0.02); k.fill('rgba(120,140,130,.35)'); k.stroke('#4a4e50', 0.05); for(let i=1;i<4;i++) k.line([-0.48, -1.35 + i*0.675, 0.48, -1.35 + i*0.675], '#4a4e50', 0.035); k.line([-0.4, -1.2, 0.3, 0.3], 'rgba(220,228,228,.5)', 0.006); c.restore(); for(let i=0;i<20;i++){ const x = k.R(0.1, 0.9), y = k.R(0.2, 2.8); k.fillP([x, y, x + 0.04, y + 0.01, x + 0.015, y + 0.035], 'rgba(190,206,200,.65)'); } return; }
    k.line([0.06, 0.15, 0.06, 2.85], '#2f3a3c', 0.06); k.line([0.06, 0.15, 0.06, 2.85], 'rgba(220,228,228,.25)', 0.015);
    c.save(); k.rr(0.08 + 0.08, 0.1 + 0.1, 0.84, 2.8, 0.02); k.fill('rgba(0,0,0,.28)'); c.restore();
    for(let i=0;i<4;i++){ const y = 0.1 + i*0.7, gone = d.broken && (i===1 || i===3); if(gone){ k.line([0.1, y + 0.05, 0.9, y + 0.05], 'rgba(198,212,212,.6)', 0.008, null, [0.03, 0.05]); continue; } k.rr(0.08, y, 0.84, 0.7, 0.01); c.fillStyle = 'rgba(140,160,150,.42)'; c.fill(); c.save(); k.rr(0.08, y, 0.84, 0.7, 0.01); c.clip(); k.radial(0.5, y + 0.35, 0.5, '#8a8270', 0.3); k.leaves(0.08, y, 0.84, 0.7, 8); c.globalAlpha = 0.3; k.fillP([0.2, y, 0.32, y, 0.15, y + 0.7, 0.08, y + 0.7], '#e0e8e6'); c.restore(); if(d.broken && i===2){ for(let j=0;j<8;j++){ const a = j/8*6.28; k.line([0.5, y + 0.35, 0.5 + Math.cos(a)*0.3, y + 0.35 + Math.sin(a)*0.3], 'rgba(230,236,234,.6)', 0.005); } } }
    c.beginPath(); c.rect(0.08, 0.1, 0.84, 2.8); k.stroke('#4a4e50', 0.045); for(let i=1;i<4;i++) k.line([0.08, 0.1 + i*0.7, 0.92, 0.1 + i*0.7], '#4a4e50', 0.035); k.line([0.08, 0.09, 0.92, 0.09], 'rgba(255,255,255,.25)', 0.01); for(let i=0;i<4;i++) k.rust(k.R(0.1, 0.9), k.rnd() < 0.5 ? 0.1 : 2.9, 0.03, false);
    k.rr(0.84, 0.25, 0.12, 0.6, 0.01); k.fill('#2a2826'); k.rr(0.86, 0.28, 0.08, 0.54, 0.005); k.fill(d.broken ? '#4a4038' : '#a89a7a'); k.graffiti(0.86, 0.35, 0.08, 0.4, '#3a6a8a'); }
  const BUS_STOP = [{n:'Грязная, целая'}, {n:'Разбитая', broken:true}, {n:'Обрушенная', collapsed:true}];
  // Киоск: кровля, вывеска, маркиза, ставни
  function kioskDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    k.rr(0.15 + 0.1, 0.15 + 0.12, 1.7, 1.55, 0.03); k.fill('rgba(0,0,0,.4)'); k.rr(0.15, 0.15, 1.7, 1.55, 0.03); k.texFill(d.burnt ? 'ash' : 'corrugated', '#7f8588', d.burnt ? null : col, 0.45);
    c.save(); k.rr(0.15, 0.15, 1.7, 1.55, 0.03); c.clip(); c.fillStyle = k.lin(0.15, 0, 1.85, 0, [[0, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(0, 0, 2, 2); for(let i=0;i<d.rust;i++) k.rust(k.R(0.3, 1.7), k.R(0.3, 1.5), k.R(0.06, 0.16), i < d.rust/3); k.leaves(0.15, 0.15, 1.7, 1.55, 15); if(d.burnt){ for(let i=0;i<6;i++) k.blot(k.R(0.3, 1.7), k.R(0.3, 1.5), k.R(0.1, 0.25), k.pick(['#7a4126', '#b8b2a6', '#0c0b0a']), 0.6); k.organic(1.1, 0.8, 0.35, 0.4, 0.28); k.fill('#0e0c0a'); } c.restore();
    k.rr(0.15, 0.15, 1.7, 1.55, 0.03); k.stroke(k.INK, 0.014); ventPipe(k, 1.55, 0.45, 0.06);
    // вывеска и маркиза вдоль фасада (низ)
    k.rr(0.15, 1.6, 1.7, 0.16, 0.01); k.fill(d.burnt ? '#1e1b18' : shade(col, -0.25)); k.stroke(k.INK, 0.01); if(!d.burnt){ c.save(); c.globalAlpha = 0.75; c.fillStyle = '#d8d0bc'; c.font = '700 0.11px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(d.sign, 1.0, 1.685); c.restore(); erode(k, 0.15, 1.6, 1.7, 0.16, 0.5); }
    if(d.awning){ for(let i=0;i<8;i++){ k.poly([0.15 + i*0.2125, 1.76, 0.15 + (i + 1)*0.2125, 1.76, 0.15 + (i + 1)*0.2125 - 0.01, 1.95, 0.15 + i*0.2125 + 0.01, 1.95]); k.fill(i%2 ? '#d0c6ae' : (d.torn && i===5 ? 'rgba(0,0,0,0)' : '#7a3a2e')); } k.line([0.15, 1.95, 1.85, 1.95], 'rgba(10,8,6,.6)', 0.012); if(d.torn) k.line([1.2, 1.8, 1.25, 1.95, 1.21, 1.99], '#7a3a2e', 0.02); }
    else { k.rr(0.2, 1.77, 1.6, 0.18, 0.01); k.texFill('corrugated', '#6c7275', '#4a4e50', 0.3); k.stroke(k.INK, 0.01); for(let i=0;i<10;i++) k.line([0.22, 1.79 + i*0.017, 1.78, 1.79 + i*0.017], 'rgba(0,0,0,.25)', 0.004); }
    if(d.loot){ k.trash(0.0, 1.75, 2, 0.25, 14); houseBits.crate(k, 1.75, 1.85, 0.22, 0.18, 0.4); } if(d.papers) for(let i=0;i<3;i++){ c.save(); c.translate(0.4 + i*0.5, 1.88); c.rotate(k.R(-0.3, 0.3)); k.rr(-0.1, -0.06, 0.2, 0.12, 0.01); k.fill('#c9c1a8'); k.line([-0.1, 0, 0.1, 0], '#8a7a5a', 0.01); c.restore(); } }
  const KIOSK = [{n:'Газетный, закрыт', col:'#3e5a6a', sign:'ПЕЧАТЬ', papers:true, rust:4}, {n:'Продуктовый, разграблен', col:'#7a3a2e', sign:'ПРОДУКТЫ', awning:true, torn:true, loot:true, rust:5}, {n:'Ржавый ларёк', col:'#6a6a50', sign:'ЛАРЁК 24', rust:12}, {n:'Сгоревший', burnt:true, sign:'', rust:6}];
  // Мусорный контейнер: корпус, две крышки; открытый — мешки внутри; переполненный — мешки вокруг
  function dumpsterDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    const bag = (x, y, r, a)=>{ c.save(); c.translate(x, y); c.rotate(a); k.organic(0.02, 0.03, r, 0.25, r*0.8); k.fill('rgba(0,0,0,.35)'); k.organic(0, 0, r, 0.25, r*0.8); c.fillStyle = k.lin(-r, -r, r, r, [[0, '#3a3e36'], [1, '#141512']]); c.fill(); k.line([-r*0.4, -r*0.5, r*0.2, -r*0.2], 'rgba(255,255,255,.18)', r*0.08); c.beginPath(); c.arc(r*0.6, -r*0.5, r*0.15, 0, 6.28); k.fill('#20221e'); c.restore(); };
    if(d.over) for(let i=0;i<7;i++) bag(k.R(0.1, 1.9), k.rnd() < 0.5 ? k.R(0.0, 0.15) : k.R(0.85, 1.0), k.R(0.1, 0.16), k.rnd()*6.28);
    if(d.over) k.trash(0, 0, 2, 1, 20);
    k.rr(0.06 + 0.06, 0.12 + 0.08, 1.88, 0.76, 0.05); k.fill('rgba(0,0,0,.4)'); k.rr(0.06, 0.12, 1.88, 0.76, 0.05); k.texFill('metal', '#6d7376', col, 0.6); k.rr(0.06, 0.12, 1.88, 0.76, 0.05); k.stroke(k.INK, 0.014);
    c.save(); k.rr(0.06, 0.12, 1.88, 0.76, 0.05); c.clip(); for(let i=0;i<d.rust;i++) k.rust(k.R(0.1, 1.9), k.rnd() < 0.5 ? 0.15 : 0.85, k.R(0.04, 0.1), false); c.restore();
    [0.1, 1.02].forEach((x, i)=>{ const open = d.open && i===1;
      if(open){ k.rr(x, 0.18, 0.86, 0.64, 0.03); k.fill('#141210'); c.save(); k.rr(x, 0.18, 0.86, 0.64, 0.03); c.clip(); for(let j=0;j<5;j++) bag(x + k.R(0.15, 0.7), k.R(0.3, 0.7), k.R(0.12, 0.18), k.rnd()*6.28); k.trash(x, 0.18, 0.86, 0.64, 8); c.restore(); k.rr(x - 0.02, 0.02, 0.9, 0.14, 0.02); k.fill(d.burnt ? '#1a1816' : '#2a2c2a'); k.stroke(k.INK, 0.01); return; }
      k.rr(x, 0.16, 0.86, 0.68, 0.03); c.fillStyle = d.burnt ? '#141210' : k.lin(x, 0.16, x, 0.84, [[0, '#3e423e'], [1, '#22251f']]); c.fill(); k.stroke(k.INK, 0.01); for(let j=1;j<5;j++) k.line([x + j*0.17, 0.2, x + j*0.17, 0.8], 'rgba(255,255,255,.08)', 0.02); k.rr(x + 0.3, 0.75, 0.26, 0.05, 0.02); k.fill('#141210'); if(d.burnt){ k.organic(x + 0.4, 0.5, 0.25, 0.5, 0.2); k.fill('#0a0908'); } });
    k.line([0.06, 0.12, 1.94, 0.12], '#2a2826', 0.02); [[0.04, 0.3], [0.04, 0.7], [1.96, 0.3], [1.96, 0.7]].forEach(([x, y])=>{ k.rr(x - 0.03, y - 0.05, 0.06, 0.1, 0.01); k.fill('#3a3836'); });
    if(d.burnt){ k.radial(1, 0.5, 1.1, '#0c0a08', 0.35); for(let i=0;i<5;i++) k.blot(k.R(0.2, 1.8), k.R(0.2, 0.8), 0.1, '#b8b2a6', 0.3); } }
  const DUMPSTER = [{n:'Зелёный, закрыт', col:'#3e5a3a', rust:4}, {n:'Синий, открыт, полон', col:'#2f4a6a', open:true, rust:5}, {n:'Переполнен, мусор вокруг', col:'#5a5a48', open:true, over:true, rust:8}, {n:'Сгоревший', burnt:true, rust:6}];
  function hydrantDraw(g, d){ const k = hk(g), c = k.c, col = d.col, x = 0.5, y = 0.5;
    if(d.leak){ k.puddle(0.55, 0.6, 0.42, 0.34); for(let i=0;i<8;i++) k.line([x, y, x + Math.cos(-0.6 + i*0.12)*0.45, y + Math.sin(-0.6 + i*0.12)*0.3], 'rgba(200,215,220,.35)', 0.012, null, [0.03, 0.03]); }
    [[0, 1], [Math.PI, 1], [Math.PI/2, 0.8]].forEach(([a, s])=>{ const ex = x + Math.cos(a)*0.2*s, ey = y + Math.sin(a)*0.2*s; k.line([x + 0.02, y + 0.03, ex + 0.02, ey + 0.03], 'rgba(0,0,0,.35)', 0.09); k.line([x, y, ex, ey], shade(col, -0.15), 0.08); c.beginPath(); c.arc(ex, ey, 0.05, 0, 6.28); k.fill(shade(col, -0.3)); k.stroke(k.INK, 0.008); });
    c.beginPath(); c.arc(x + 0.03, y + 0.04, 0.16, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.16, 0, 6.28); c.fillStyle = k.lin(x - 0.16, y - 0.16, x + 0.16, y + 0.16, [[0, shade(col, 0.25)], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.01);
    for(let i=0;i<8;i++){ const a = i/8*6.28; c.beginPath(); c.arc(x + Math.cos(a)*0.13, y + Math.sin(a)*0.13, 0.012, 0, 6.28); k.fill('#5a5650'); }
    if(d.leak){ c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#141210'); k.radial(x, y, 0.1, '#c8d6da', 0.4); } else { c.beginPath(); for(let i=0;i<5;i++){ const a = i/5*6.28 - Math.PI/2; c.lineTo(x + Math.cos(a)*0.06, y + Math.sin(a)*0.06); } c.closePath(); k.fill(shade(col, -0.2)); k.stroke(k.INK, 0.008); }
    for(let i=0;i<4;i++) k.rust(x + k.R(-0.12, 0.12), y + k.R(-0.12, 0.12), k.R(0.02, 0.05), false); k.line([x + 0.2, y, x + 0.25, y + 0.15, x + 0.12, y + 0.18], '#5a5e60', 0.008, 0.8, [0.012, 0.008]); }
  const HYDRANT = [{n:'Красный', col:'#8e3a2e'}, {n:'Жёлтый, ржавый', col:'#9a8030'}, {n:'Сломан, течёт', col:'#8e3a2e', leak:true}];
  function boothDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    if(d.open){ k.rr(0.25, 0.2, 0.5, 0.15, 0.02); k.fill('#3e4244'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0.5 + 0.03, 0.35 + 0.04, 0.3, 0, Math.PI); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(0.5, 0.35, 0.3, 0, Math.PI); c.closePath(); k.texFill('metal', '#6d7376', col, 0.5); k.stroke(k.INK, 0.012); k.rr(0.42, 0.28, 0.16, 0.12, 0.01); k.fill('#1e1c1a'); k.line([0.45, 0.4, 0.5, 0.6, 0.62, 0.7], '#1e1c1a', 0.012); k.rr(0.58, 0.66, 0.1, 0.05, 0.02); k.fill('#2a2826'); for(let i=0;i<3;i++) k.rust(k.R(0.3, 0.7), k.R(0.4, 0.6), 0.03, false); return; }
    if(d.smashed) for(let i=0;i<20;i++){ const x = k.R(0.02, 0.98), y = k.R(0.02, 0.98); if(x > 0.15 && x < 0.85 && y > 0.15 && y < 0.85) continue; k.fillP([x, y, x + 0.03, y + 0.008, x + 0.012, y + 0.028], 'rgba(198,212,212,.7)'); }
    k.rr(0.15 + 0.06, 0.15 + 0.08, 0.7, 0.7, 0.03); k.fill('rgba(0,0,0,.4)'); k.rr(0.15, 0.15, 0.7, 0.7, 0.03); c.fillStyle = k.lin(0.15, 0.15, 0.85, 0.85, [[0, shade(col, 0.15)], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.012);
    k.rr(0.22, 0.22, 0.56, 0.56, 0.02); k.fill(shade(col, -0.1)); k.stroke('rgba(0,0,0,.4)', 0.008); c.beginPath(); c.arc(0.5, 0.5, 0.06, 0, 6.28); k.fill('#d8d0bc', 0.75);
    c.save(); c.globalAlpha = 0.8; c.fillStyle = '#e4ddca'; c.font = '700 0.06px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ТЕЛЕФОН', 0.5, 0.185); c.restore();
    for(let i=0;i<3;i++) k.rust(k.R(0.2, 0.8), k.R(0.2, 0.8), k.R(0.015, 0.03), false); if(d.smashed){ k.dent(0.45, 0.55, 0.15); k.line([0.15, 0.85, 0.05, 0.95], '#1e1c1a', 0.012); } k.leaves(0.2, 0.2, 0.6, 0.6, 5); }
  const BOOTH = [{n:'Красная будка', col:'#8e2e26'}, {n:'Уличный таксофон', col:'#5a6a6e', open:true}, {n:'Разбитая будка', col:'#7a3a30', smashed:true}];
  const VN = (arr)=>arr.map(x=>x.n), PV = (arr, v)=>arr[v] || arr[0];
  A('house_small', 'Жилой дом, малый', 'city', 3, 3, {t:'дом здание жилой коттедж крыша черепица', v:HOUSE_SMALL.length, vn:VN(HOUSE_SMALL), hd:true}, (g, v)=>houseDraw(g, 3, 3, PV(HOUSE_SMALL, v)));
  A('house_mid', 'Жилой дом, средний', 'city', 4, 5, {t:'дом здание жилой крыша огород', v:HOUSE_MID.length, vn:VN(HOUSE_MID), hd:true}, (g, v)=>houseDraw(g, 4, 5, PV(HOUSE_MID, v)));
  A('apartment_block', 'Многоквартирный дом', 'city', 6, 8, {t:'дом многоэтажка панелька жилой крыша', v:APT_BLOCK.length, vn:VN(APT_BLOCK), hd:true}, (g, v)=>blockDraw(g, 6, 8, PV(APT_BLOCK, v)));
  A('ruin_house', 'Руины дома', 'city', 4, 4, {t:'руины разрушенный дом развалины', v:RUIN_HOUSE.length, vn:VN(RUIN_HOUSE), hd:true}, (g, v)=>ruinDraw(g, 4, 4, PV(RUIN_HOUSE, v)));
  A('ruin_corner', 'Обрушенный угол здания', 'city', 3, 3, {t:'руины стена угол', v:RUIN_CORNER.length, vn:VN(RUIN_CORNER), hd:true}, (g, v)=>cornerDraw(g, PV(RUIN_CORNER, v)));
  A('yard', 'Двор с детской площадкой', 'city', 4, 4, {t:'двор площадка качели песочница горка', g:true, v:YARD.length, vn:VN(YARD), hd:true}, (g, v)=>yardDraw(g, PV(YARD, v)));
  A('crossroad', 'Разметка перекрёстка', 'city', 4, 4, {t:'перекрёсток разметка зебра дорога люк', g:true, v:CROSS.length, vn:VN(CROSS), hd:true}, (g, v)=>crossDraw(g, PV(CROSS, v)));
  A('zebra', 'Пешеходный переход', 'city', 3, 1, {t:'зебра переход разметка', g:true, v:ZEBRA.length, vn:VN(ZEBRA), hd:true}, (g, v)=>zebraDraw(g, PV(ZEBRA, v)));
  A('parking', 'Парковка', 'city', 4, 3, {t:'парковка стоянка разметка', g:true, v:PARKING.length, vn:VN(PARKING), hd:true}, (g, v)=>parkingDraw(g, PV(PARKING, v)));
  A('car_wreck', 'Брошенный автомобиль', 'city', 1, 2, {t:'машина авто автомобиль остов легковушка седан хэтчбек универсал пикап внедорожник джип фургон', v:CAR_VARIANTS.length, vn:CAR_VARIANTS.map(x=>x.n), hd:true}, (g, v)=>carDraw(g, CAR_VARIANTS[v] || CAR_VARIANTS[0]));
  A('car_burnt', 'Сгоревший автомобиль', 'city', 1, 2, {t:'машина сгоревшая остов гарь пикап фургон', v:CAR_BURNT.length, vn:CAR_BURNT.map(x=>x.n), hd:true}, (g, v)=>carDraw(g, CAR_BURNT[v] || CAR_BURNT[0]));
  A('bus_wreck', 'Остов автобуса', 'city', 1, 4, {t:'автобус транспорт остов троллейбус школьный', v:BUS.length, vn:VN(BUS), hd:true}, (g, v)=>busDraw(g, PV(BUS, v)));
  A('rubble_pile', 'Завал', 'city', 2, 2, {t:'завал обломки мусор бетон кирпич', v:RUBBLE.length, vn:VN(RUBBLE), hd:true}, (g, v)=>rubbleDraw(g, 2, 2, PV(RUBBLE, v)));
  A('rubble_big', 'Большой завал', 'city', 4, 3, {t:'завал обломки баррикада плита', v:RUBBLE_BIG.length, vn:VN(RUBBLE_BIG), hd:true}, (g, v)=>rubbleDraw(g, 4, 3, PV(RUBBLE_BIG, v)));
  A('jersey', 'Бетонные блоки', 'city', 2, 1, {t:'блок бетон ограждение укрытие джерси', v:JERSEY.length, vn:VN(JERSEY), hd:true}, (g, v)=>jerseyDraw(g, PV(JERSEY, v)));
  A('bridge', 'Пролёт моста', 'city', 3, 8, {t:'мост пролёт переправа', v:BRIDGE.length, vn:VN(BRIDGE), hd:true}, (g, v)=>bridgeDraw(g, PV(BRIDGE, v)));
  A('overpass_pillar', 'Опора эстакады', 'city', 2, 2, {t:'эстакада опора колонна мост', v:PILLAR.length, vn:VN(PILLAR), hd:true}, (g, v)=>pillarDraw(g, PV(PILLAR, v)));
  A('lamp_post', 'Фонарный столб', 'city', 1, 1, {t:'фонарь столб освещение', v:LAMP.length, vn:VN(LAMP), hd:true}, (g, v)=>lampDraw(g, PV(LAMP, v)));
  A('road_sign', 'Дорожный знак', 'city', 1, 1, {t:'знак дорога указатель стоп', v:SIGN.length, vn:VN(SIGN), hd:true}, (g, v)=>signDraw(g, PV(SIGN, v)));
  A('bus_stop', 'Остановка', 'city', 1, 3, {t:'остановка навес скамья', v:BUS_STOP.length, vn:VN(BUS_STOP), hd:true}, (g, v)=>stopDraw(g, PV(BUS_STOP, v)));
  A('kiosk', 'Киоск', 'city', 2, 2, {t:'киоск ларёк будка', v:KIOSK.length, vn:VN(KIOSK), hd:true}, (g, v)=>kioskDraw(g, PV(KIOSK, v)));
  A('dumpster', 'Мусорный контейнер', 'city', 2, 1, {t:'мусор бак контейнер', v:DUMPSTER.length, vn:VN(DUMPSTER), hd:true}, (g, v)=>dumpsterDraw(g, PV(DUMPSTER, v)));
  A('hydrant', 'Пожарный гидрант', 'city', 1, 1, {t:'гидрант вода', v:HYDRANT.length, vn:VN(HYDRANT), hd:true}, (g, v)=>hydrantDraw(g, PV(HYDRANT, v)));
  A('phone_booth', 'Телефонная будка', 'city', 1, 1, {t:'телефон будка таксофон', v:BOOTH.length, vn:VN(BOOTH), hd:true}, (g, v)=>boothDraw(g, PV(BOOTH, v)));

  /* ===================== МЕГАПОЛИС ===================== */
  /* ---- Мегаполис (HD) ---- */
  function tier(k, x, y, w, h, opt){ opt = opt || {}; const c = k.c; fx.sh(k, x, y, w, h, 0.04, opt.sh || 0.18); k.rr(x, y, w, h, 0.04); k.texFill(opt.mat || 'concrete', '#8a8780', opt.tint, 0.3); c.save(); k.rr(x, y, w, h, 0.04); c.clip(); c.fillStyle = k.lin(x, y, x + w, y + h, [[0, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(x, y, w, h); if(opt.windows){ for(let i=0;i<Math.round(w/0.35);i++){ k.rr(x + 0.1 + i*0.35, y + 0.05, 0.22, 0.08, 0.01); k.fill('rgba(40,60,70,.85)'); k.rr(x + 0.1 + i*0.35, y + h - 0.13, 0.22, 0.08, 0.01); k.fill('rgba(40,60,70,.85)'); } } c.restore(); k.rr(x, y, w, h, 0.04); k.stroke(k.INK, 0.016); k.line([x + 0.03, y + 0.03, x + w - 0.03, y + 0.03], 'rgba(255,250,240,.35)', 0.02); }
  function beacon(k, x, y, on){ const c = k.c; c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#2a2826'); c.beginPath(); c.arc(x, y, 0.045, 0, 6.28); k.fill(on ? '#e8402a' : '#5a2a22'); if(on) k.radial(x, y, 0.3, '#ff5030', 0.35); }
  function helipadMark(k, cx, cy, r, worn){ const c = k.c; c.beginPath(); c.arc(cx, cy, r, 0, 6.28); k.stroke(`rgba(228,221,202,${worn ? 0.5 : 0.85})`, r*0.08); c.save(); c.globalAlpha = worn ? 0.5 : 0.85; c.fillStyle = '#e4ddca'; const s = r*0.55; c.fillRect(cx - s*0.6, cy - s, s*0.25, s*2); c.fillRect(cx + s*0.35, cy - s, s*0.25, s*2); c.fillRect(cx - s*0.6, cy - s*0.12, s*1.2, s*0.24); c.restore(); for(let i=0;i<8;i++){ const a = i/8*6.28; beacon(k, cx + Math.cos(a)*r*1.12, cy + Math.sin(a)*r*1.12, !worn && i%2===0); } }
  function megatowerDraw(g, d){ const k = hk(g), c = k.c;
    tier(k, 0.1, 0.1, 9.8, 9.8, {windows:true}); tier(k, 1.3, 1.3, 7.4, 7.4, {mat:'roofing', sh:0.25}); tier(k, 2.6, 2.6, 4.8, 4.8, {sh:0.3});
    [[0.5, 0.5], [9.5, 0.5], [0.5, 9.5], [9.5, 9.5]].forEach(([x, y])=>beacon(k, x, y, true)); [[1.8, 1.8, 1.4, 0.8], [6.8, 1.8, 1.4, 0.8], [1.8, 7.4, 1.4, 0.8], [6.8, 7.4, 1.4, 0.8]].forEach(b=>hvac(k, b[0], b[1], b[2], b[3]));
    if(d.dmg){ k.orgK(6.0, 4.4, 1.6, 0.35, 1.3); k.fill('#0a0908'); c.save(); k.orgK(6.0, 4.4, 1.6, 0.35, 1.3); c.clip(); for(let f=1;f<4;f++){ k.orgK(6.0 + f*0.15, 4.4 + f*0.2, 1.6 - f*0.3, 0.35, 1.3 - f*0.25); k.fill(f%2 ? '#2a2622' : '#3a3632'); } c.restore(); for(let i=0;i<30;i++) k.rebar([6 + k.R(-1.6, 1.6), 4.4 + k.R(-1.3, 1.3), 6 + k.R(-1.9, 1.9), 4.4 + k.R(-1.6, 1.6)]); for(let i=0;i<40;i++) k.chunk(k.R(3, 9.5), k.R(2, 7.5), k.R(0.06, 0.22), '#8a8780', 0.05); helipadMark(k, 3.8, 5.0, 0.9, true); }
    else helipadMark(k, 5, 5, 1.5, false);
    if(d.garden){ for(let i=0;i<4;i++) houseBits.bed(k, [1.6 + (i%2)*5.6, 3.2 + Math.floor(i/2)*2.4, 1.2, 1.6]); [[2.2, 2.2], [7.8, 2.4], [2.0, 7.9], [8.0, 7.8], [5.0, 2.0]].forEach(([x, y])=>houseBits.bush(k, x, y, 0.45)); k.leaves(1.4, 1.4, 7.2, 7.2, 60); }
    antenna(k, 8.6, 8.6, 1.2, -2.4); antenna(k, 1.4, 8.6, 1.0, -0.8); }
  const MEGATOWER = [{n:'Вертолётная площадка'}, {n:'Верх обрушен', dmg:true}, {n:'Сады на крыше', garden:true}];
  function megablockDraw(g, d){ const k = hk(g), c = k.c, W = 8;
    tier(k, 0.1, 0.1, 7.8, 7.8, {mat:'roofing', windows:true});
    if(d.court){ k.rr(2.4, 2.4, 3.2, 3.2, 0.04); c.fillStyle = k.lin(2.4, 2.4, 5.6, 5.6, [[0, '#060504'], [1, '#2a2620']]); c.fill(); k.stroke('rgba(255,250,240,.25)', 0.04); c.save(); k.rr(2.4, 2.4, 3.2, 3.2, 0.04); c.clip(); for(let i=0;i<6;i++) k.line([2.4, 2.6 + i*0.5, 5.6, 2.6 + i*0.5], 'rgba(255,255,255,.04)', 0.08); houseBits.bush(k, 4.2, 4.6, 0.4); c.restore(); xb.laundry(k, 2.5, 3.0, 5.5, 3.3); xb.laundry(k, 2.5, 4.6, 5.5, 4.4); }
    for(let i=0;i<5;i++) for(let j=0;j<5;j++){ if(d.court && i > 0 && i < 4 && j > 0 && j < 4) continue; const x = 0.8 + i*1.5, y = 0.8 + j*1.5; if(d.ruined && x > 4.6 && y > 4.6) continue; if((i + j)%3===0) ventPipe(k, x, y, 0.1); else if((i + j)%3===1){ k.rr(x - 0.2, y - 0.2, 0.4, 0.4, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.008); k.rr(x - 0.1, y - 0.1, 0.2, 0.2, 0.01); k.fill('#141210'); } else dish(k, x, y, 0.18); }
    if(d.ruined){ const P = [4.2, 7.9, 4.6, 5.4, 6.2, 4.3, 7.9, 4.0, 7.9, 7.9]; for(let f=0;f<5;f++){ k.poly(P.map((v, i)=>v + f*0.18*(i%2 ? 0.6 : 0.5))); k.fill(f%2 ? '#3a3632' : '#4a4540'); } k.poly(P); c.fillStyle = k.lin(5, 5, 7.9, 7.9, [[0, 'rgba(10,8,6,.2)'], [1, 'rgba(10,8,6,.85)']]); c.fill(); for(let i=0;i<40;i++){ const t = k.rnd(); k.chunk(4.0 + t*3.6 + k.R(-0.5, 0.3), 7.9 - t*3.9 + k.R(-0.6, 0.2), k.R(0.08, 0.25), '#8a8780', 0.05); } for(let i=0;i<14;i++){ const t = k.rnd(); k.rebar([4.2 + t*3.7, 7.9 - t*3.9, 4.2 + t*3.7 + k.R(0.1, 0.4), 7.9 - t*3.9 + k.R(0.05, 0.3)]); } }
    [[0.4, 0.4], [7.6, 0.4], [0.4, 7.6], [7.6, 7.6]].forEach(([x, y])=>beacon(k, x, y, !d.ruined)); solar(k, 0.6, 3.4, 1.3, 0.8, d.ruined); [[1.2, 6.2], [5.6, 1.0]].forEach(([x, y], i)=>{ if(d.ruined && i===0 && 0) return; tier(k, x, y, 1.2, 0.9, {sh:0.2}); k.rr(x + 0.35, y + 0.65, 0.5, 0.25, 0.01); k.texFill('metal', '#55585a', '#5a4a3a', 0.5); k.stroke(k.INK, 0.008); }); houseBits.tank(k, 6.6, 6.6 - (d.ruined ? 4.6 : 0), 0.45); houseBits.tank(k, 1.5, 1.6, 0.35); k.line([0.2, 0.2, 7.8, 0.2], 'rgba(255,250,240,.2)', 0.06); for(let i=0;i<6;i++) k.streak(k.R(0.5, 7.5), k.R(0.5, 7), 0.6, 0.08, '#2a2418', 0.25); }
  const MEGABLOCK = [{n:'Жилой блок'}, {n:'С внутренним двором', court:true}, {n:'Обрушен угол', ruined:true}];
  function fortressDraw(g, d){ const k = hk(g), c = k.c, cx = 3.5, cy = 3.5;
    const oct = (r)=>{ c.beginPath(); for(let i=0;i<8;i++){ const a = i/8*6.28 + 0.39; c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } c.closePath(); };
    c.save(); c.translate(0.2, 0.25); oct(3.3); k.fill('rgba(0,0,0,.4)'); c.restore(); oct(3.3); k.texFill('concrete', '#7a7670', '#5a5a50', 0.3); oct(3.3); k.stroke(k.INK, 0.02);
    for(let i=0;i<32;i++){ if(d.broken && i > 3 && i < 9) continue; const a = i/32*6.28; k.c.save(); k.c.translate(cx + Math.cos(a)*3.15, cy + Math.sin(a)*3.15); k.c.rotate(a); k.rr(-0.12, -0.18, 0.24, 0.36, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.006); k.c.restore(); }
    oct(2.3); k.texFill('roofing', '#46433f'); oct(2.3); k.stroke(k.INK, 0.014); c.save(); oct(2.3); c.clip(); k.concreteDetail(1.2, 1.2, 4.6, 4.6, 0.8); c.restore();
    [[cx - 2.6, cy - 2.6], [cx + 2.6, cy - 2.6], [cx - 2.6, cy + 2.6], [cx + 2.6, cy + 2.6]].forEach(([x, y], i)=>{ if(d.broken && i===1) return; c.beginPath(); c.arc(x + 0.08, y + 0.1, 0.55, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(x, y, 0.55, 0, 6.28); k.texFill('metal', '#6d7376', '#4a5040', 0.4); k.stroke(k.INK, 0.012); c.save(); c.translate(x, y); c.rotate(Math.atan2(y - cy, x - cx)); k.rr(0.1, -0.05, 0.7, 0.1, 0.02); k.fill('#1e1c1a'); k.rr(0.1, 0.08, 0.6, 0.06, 0.02); k.fill('#1e1c1a'); c.restore(); c.beginPath(); c.arc(x, y, 0.2, 0, 6.28); k.fill('#3a3e40'); });
    for(let i=0;i<12;i++){ const a = i/12*6.28; houseBits.sandbag(k, cx + Math.cos(a)*1.0, cy + Math.sin(a)*1.0, a + Math.PI/2); } k.tarp(cx - 0.6, cy - 0.5, 1.2, 1.0, '#4a5236', 0.2); antenna(k, cx + 1.5, cy - 1.4, 0.9, -2.3); bits.stencil(k, cx, cy + 1.6, 'ЗАСТАВА 9', 0.3, '#e4ddca', 0.4);
    if(d.broken){ k.organic(cx + 1.4, cy - 2.2, 1.2, 0.4, 0.8); k.fill('#0e0c0a'); for(let i=0;i<30;i++) k.chunk(cx + k.R(0.2, 3.3), cy + k.R(-3.4, -0.8), k.R(0.08, 0.22), '#8a8780', 0.05); for(let i=0;i<12;i++) k.rebar([cx + k.R(0.5, 2.5), cy + k.R(-3, -1.2), cx + k.R(0.3, 2.8), cy + k.R(-3.3, -1)]); k.radial(cx + 1.4, cy - 2.2, 2, '#0c0a08', 0.35); } }
  const FORTRESS = [{n:'Укреплённая'}, {n:'Пробита', broken:true}];
  function skywalkDraw(g, d){ const k = hk(g), c = k.c, H = 10;
    const deck = (y0, y1)=>{ fx.sh(k, 0.15, y0, 2.7, y1 - y0, 0.02, 0.2); k.rr(0.15, y0, 2.7, y1 - y0, 0.02); k.texFill('tiles', '#bab4a5', '#9a9690', 0.3); c.save(); k.rr(0.15, y0, 2.7, y1 - y0, 0.02); c.clip(); for(let i=0;i<Math.round((y1 - y0)*1.5);i++) k.blot(k.R(0.4, 2.6), k.R(y0 + 0.2, y1 - 0.2), k.R(0.1, 0.25), '#5a5040', 0.25); k.leaves(0.2, y0, 2.6, y1 - y0, 20); k.trash(0.3, y0, 2.4, y1 - y0, 8); c.restore();
      [0.18, 2.82].forEach(x=>{ k.line([x + 0.03, y0, x + 0.03, y1], 'rgba(0,0,0,.35)', 0.07); k.line([x, y0, x, y1], '#5a5e60', 0.06); k.line([x - 0.01, y0, x - 0.01, y1], 'rgba(160,190,195,.6)', 0.012); for(let y=y0 + 0.4;y<y1;y+=0.8){ c.beginPath(); c.arc(x, y, 0.05, 0, 6.28); k.fill('#3a3e40'); } }); };
    if(d.broken){ deck(0, 4.0); deck(6.2, H); c.fillStyle = k.lin(0, 4, 0, 6.2, [[0, '#0a0908'], [0.5, '#1a1612'], [1, '#0a0908']]); c.fillRect(0.15, 4.0, 2.7, 2.2); [[4.0, -1], [6.2, 1]].forEach(([y, s])=>{ for(let i=0;i<10;i++) k.rebar([k.R(0.2, 2.8), y, k.R(0.2, 2.8), y + s*k.R(0.15, 0.5)]); for(let i=0;i<8;i++) k.chunk(k.R(0.3, 2.7), y - s*k.R(0.05, 0.3), k.R(0.06, 0.14), '#8a8780', 0.03); }); }
    else deck(0, H);
    [[1.5, 1.2], [1.5, 8.3]].forEach(([x, y])=>{ if(d.broken && y > 4 && y < 6.2) return; k.rr(x - 0.45, y - 0.35, 0.9, 0.7, 0.03); k.texFill('metal', '#6d7376', '#3e5a6a', 0.4); k.stroke(k.INK, 0.01); k.rr(x - 0.4, y + 0.3, 0.8, 0.12, 0.01); k.fill('#5ad1d6', 0.6); k.radial(x, y + 0.36, 0.5, '#5ad1d6', 0.2); });
    [2.8, 5.0, 7.2].forEach((y, i)=>{ if(d.broken && y > 3.8 && y < 6.4) return; c.beginPath(); c.arc(i%2 ? 2.6 : 0.4, y, 0.08, 0, 6.28); k.fill('#3a3e40'); k.radial(i%2 ? 2.6 : 0.4, y, 0.45, '#5ad1d6', 0.15); }); }
  const SKYWALK = [{n:'Многоуровневая улица'}, {n:'Пролёт обрушен', broken:true}];
  function monumentDraw(g, d){ const k = hk(g), c = k.c;
    for(let s=0;s<3;s++){ const o = 0.1 + s*0.25; k.rr(o, o, 3 - 2*o, 3 - 2*o, 0.02); k.texFill('concrete', '#9a968e', s===2 ? '#8a7a6a' : null, 0.2); k.fill(`rgba(0,0,0,${0.08*s})`); k.rr(o, o, 3 - 2*o, 3 - 2*o, 0.02); k.stroke(k.INK, 0.01); k.line([o + 0.02, o + 0.02, 3 - o - 0.02, o + 0.02], 'rgba(255,250,240,.35)', 0.015); }
    c.save(); k.rr(0.6, 0.6, 1.8, 1.8, 0.02); c.clip(); k.concreteDetail(0.6, 0.6, 1.8, 1.8, 0.6); c.restore();
    if(d.obelisk){ c.beginPath(); c.moveTo(1.5 + 0.12, 0.7 + 0.15); c.lineTo(2.2 + 0.12, 1.5 + 0.15); c.lineTo(1.5 + 0.12, 2.3 + 0.15); c.lineTo(0.8 + 0.12, 1.5 + 0.15); c.closePath(); k.fill('rgba(0,0,0,.45)'); [[1.5, 1.5, 1.5, 0.7, 2.2, 1.5, '#a8a49c'], [1.5, 1.5, 2.2, 1.5, 1.5, 2.3, '#6a6660'], [1.5, 1.5, 1.5, 2.3, 0.8, 1.5, '#5a5650'], [1.5, 1.5, 0.8, 1.5, 1.5, 0.7, '#c8c4bc']].forEach(p=>{ k.fillP(p.slice(0, 6), p[6]); }); k.poly([1.5, 0.7, 2.2, 1.5, 1.5, 2.3, 0.8, 1.5]); k.stroke(k.INK, 0.01); xb.star(k, 1.5, 1.5, 0.12, '#8e2e26'); return; }
    if(d.toppled){ c.save(); c.translate(2.0, 2.2); c.rotate(0.7); k.rr(-0.25, -0.9, 0.5, 1.6, 0.2); k.texFill('metal', '#6d7376', '#5a7a6a', 0.6); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0, -1.05, 0.22, 0, 6.28); k.texFill('metal', '#6d7376', '#5a7a6a', 0.6); k.stroke(k.INK, 0.01); k.line([-0.25, -0.5, -0.6, -1.2], '#4a6a5a', 0.14); c.restore(); c.save(); k.rr(1.2, 1.2, 0.6, 0.6, 0.02); k.fill('#4a6a5a'); c.restore(); for(let i=0;i<14;i++) k.chunk(k.R(0.4, 2.6), k.R(1.8, 2.9), k.R(0.05, 0.14), '#9a968e', 0.03); k.graffiti(0.5, 0.4, 1.6, 0.3, '#8e2e26'); return; }
    // фигура сверху: плечи, голова, вытянутая рука
    c.save(); c.translate(1.55, 1.6); c.beginPath(); c.ellipse(0.08, 0.1, 0.55, 0.35, 0, 0, 6.28); k.fill('rgba(0,0,0,.45)'); c.beginPath(); c.ellipse(0, 0, 0.55, 0.32, 0, 0, 6.28); k.texFill('metal', '#6d7376', '#5a7a6a', 0.6); k.stroke(k.INK, 0.01); k.line([0.35, -0.1, 0.9, -0.55], '#4a6a5a', 0.16); k.line([0.35, -0.1, 0.9, -0.55], 'rgba(255,255,255,.2)', 0.04); c.beginPath(); c.arc(0.92, -0.58, 0.08, 0, 6.28); k.fill('#4a6a5a'); c.beginPath(); c.arc(-0.05, -0.05, 0.2, 0, 6.28); k.texFill('metal', '#6d7376', '#5a7a6a', 0.6); k.stroke(k.INK, 0.01); k.radial(-0.1, -0.1, 0.4, '#e8f0e0', 0.2); for(let i=0;i<5;i++) k.streak(k.R(-0.4, 0.4), 0.1, 0.4, 0.04, '#3a6a5a', 0.4); c.restore(); }
  const MONUMENT = [{n:'Памятник вождю'}, {n:'Обелиск', obelisk:true}, {n:'Свергнут', toppled:true}];
  function archDraw(g, d){ const k = hk(g), c = k.c;
    [[0.1, 0.1], [4.6, 0.1]].forEach(([x, y])=>{ fx.sh(k, x, y, 1.3, 1.8, 0.04, 0.18); k.rr(x, y, 1.3, 1.8, 0.04); k.texFill('concrete', '#9a968e', '#a89a80', 0.25); k.stroke(k.INK, 0.014); c.save(); k.rr(x, y, 1.3, 1.8, 0.04); c.clip(); k.concreteDetail(x, y, 1.3, 1.8, 0.45); c.restore(); k.rr(x + 0.15, y + 0.15, 1.0, 1.5, 0.02); k.stroke('rgba(0,0,0,.3)', 0.02); });
    const span = (x0, x1)=>{ fx.sh(k, x0, 0.5, x1 - x0, 1.0, 0.02, 0.15); k.rr(x0, 0.5, x1 - x0, 1.0, 0.02); k.texFill('concrete', '#9a968e', '#a89a80', 0.25); k.stroke(k.INK, 0.012); k.line([x0, 0.55, x1, 0.55], 'rgba(255,250,240,.3)', 0.02); for(let x=x0 + 0.2;x<x1;x+=0.4) k.rr(x, 0.6, 0.2, 0.15, 0.01), k.fill('rgba(0,0,0,.2)'); };
    if(d.cracked){ span(1.4, 2.7); span(3.4, 4.6); for(let i=0;i<20;i++) k.chunk(k.R(2.6, 3.5), k.R(0.3, 1.8), k.R(0.08, 0.22), '#9a968e', 0.05); for(let i=0;i<8;i++) k.rebar([k.R(2.6, 2.8), k.R(0.6, 1.4), k.R(2.8, 3.1), k.R(0.6, 1.4)]); }
    else { span(1.4, 4.6); bits.stencil(k, 3.0, 1.05, 'СЛАВА ТРУДУ', 0.22, '#c8a040', 0.7); xb.star(k, 3.0, 0.65, 0.1, '#8e2e26'); } }
  const ARCH = [{n:'Арка'}, {n:'Расколота', cracked:true}];
  function rampDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.15, 0.05, 1.7, 3.9, 0.02, 0.1); k.rr(0.15, 0.05, 1.7, 3.9, 0.02); k.texFill('concrete', '#8a8780'); c.save(); k.rr(0.15, 0.05, 1.7, 3.9, 0.02); c.clip(); c.fillStyle = k.lin(0, 0.05, 0, 3.95, [[0, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.4)']]); c.fillRect(0, 0, 2, 4); for(let y=0.2;y<3.9;y+=0.12) k.line([0.25, y, 1.75, y], 'rgba(0,0,0,.25)', 0.015); if(d.cracked){ for(let i=0;i<4;i++) k.line([k.R(0.3, 1.7), k.R(0.2, 3.8), k.R(0.3, 1.7), k.R(0.2, 3.8), k.R(0.3, 1.7), k.R(0.2, 3.8)], 'rgba(15,12,10,.6)', 0.015); for(let i=0;i<14;i++) k.chunk(k.R(0.3, 1.7), k.R(0.3, 3.7), k.R(0.04, 0.12), '#9a968e', 0.03); } c.restore(); k.rr(0.15, 0.05, 1.7, 3.9, 0.02); k.stroke(k.INK, 0.012);
    [0.15, 1.85].forEach(x=>{ k.line([x + 0.03, 0.05, x + 0.03, 3.95], 'rgba(0,0,0,.35)', 0.06); k.line([x, 0.05, x, 3.95], '#c8a030', 0.05); for(let y=0.3;y<3.9;y+=0.4) k.line([x, y, x, y + 0.2], '#1e1c1a', 0.05); }); }
  const RAMP = [{n:'Пандус'}, {n:'Растрескан, обломки', cracked:true}];
  function roofVentDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.15, 0.15, 1.7, 1.7, 0.04, 0.14); k.rr(0.15, 0.15, 1.7, 1.7, 0.04); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.014); k.bevel(()=>k.rr(0.15, 0.15, 1.7, 1.7, 0.04), 0.04);
    c.beginPath(); c.arc(1, 1, 0.65, 0, 6.28); k.fill('#0e0c0a'); k.stroke('#3a3e40', 0.04);
    if(d.fan || d.broken){ c.save(); c.translate(1, 1); c.rotate(0.3); for(let i=0;i<(d.broken ? 3 : 5);i++){ c.rotate(6.28/5); k.poly([0, 0, 0.6, -0.12, 0.62, 0.1]); k.fill('#6a6e70'); k.stroke(k.INK, 0.006); } c.restore(); c.beginPath(); c.arc(1, 1, 0.12, 0, 6.28); k.fill('#3a3e40'); }
    if(!d.fan){ c.save(); c.beginPath(); c.arc(1, 1, 0.64, 0, 6.28); c.clip(); for(let x=0.35;x<1.7;x+=0.1) k.line([x, 0.3, x, 1.7], d.broken ? 'rgba(0,0,0,0)' : '#5a5e60', 0.025); if(d.broken){ for(let i=0;i<6;i++) k.line([k.R(0.4, 1.6), 0.4, k.R(0.4, 1.6), 1.6], '#4a4e50', 0.025); } c.restore(); }
    for(let i=0;i<5;i++) k.rust(k.R(0.3, 1.7), k.R(0.3, 1.7), 0.05, false); k.radial(1, 1, 0.9, '#1a1612', 0.2); }
  const ROOFVENT = [{n:'С решёткой'}, {n:'С вентилятором', fan:true}, {n:'Разбита', broken:true}];
  function antennaMastDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.rr(0.45, 0.45, 1.1, 1.1, 0.04); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.45, 0.45, 1.1, 1.1, 0.04), 0.03); c.save(); k.rr(0.45, 0.45, 1.1, 1.1, 0.04); c.clip(); k.concreteDetail(0.45, 0.45, 1.1, 1.1, 0.35); c.restore(); [[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#3a3e40'); });
    for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; k.line([cx + 0.02, cy + 0.03, cx + Math.cos(a)*0.95 + 0.02, cy + Math.sin(a)*0.95 + 0.03], 'rgba(0,0,0,.35)', 0.014); k.line([cx, cy, cx + Math.cos(a)*0.95, cy + Math.sin(a)*0.95], 'rgba(210,206,198,.85)', 0.012); c.beginPath(); c.arc(cx + Math.cos(a)*0.95, cy + Math.sin(a)*0.95, 0.06, 0, 6.28); k.fill('#5a5e60'); k.stroke(k.INK, 0.006); }
    if(d.fallen){ c.save(); c.translate(cx, cy); c.rotate(0.6); for(let i=0;i<10;i++){ k.line([i*0.12, -0.1, i*0.12, 0.1], '#c8302a', 0.02); } k.line([0, -0.1, 1.2, -0.1], '#8a8e90', 0.025); k.line([0, 0.1, 1.2, 0.1], '#8a8e90', 0.025); for(let i=0;i<10;i++) k.line([i*0.12, -0.1, (i + 1)*0.12, 0.1], '#8a8e90', 0.012); c.restore(); k.c.beginPath(); k.c.arc(cx, cy, 0.18, 0, 6.28); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); return; }
    c.beginPath(); for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; c.lineTo(cx + Math.cos(a)*0.42, cy + Math.sin(a)*0.42); } c.closePath(); k.fill('rgba(0,0,0,.3)'); k.stroke('#c8302a', 0.05); for(let r=0.08;r<0.42;r+=0.08){ c.beginPath(); for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } c.closePath(); k.stroke(Math.round(r/0.08)%2 ? '#e4ddca' : '#c8302a', 0.025); } for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; k.line([cx, cy, cx + Math.cos(a)*0.42, cy + Math.sin(a)*0.42], '#8a8e90', 0.015); }
    beacon(k, cx, cy, true); if(d.dishes){ dish(k, cx - 0.55, cy + 0.2, 0.22); dish(k, cx + 0.5, cy - 0.35, 0.18); k.rr(cx + 0.2, cy + 0.25, 0.35, 0.25, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.008); } xb.cable(k, [cx, cy, cx + 0.4, cy + 0.6, cx + 0.95, cy + 0.95], '#1a1816', 0.014); }
  const ANTENNA_M = [{n:'Решётчатая мачта'}, {n:'С тарелками', dishes:true}, {n:'Рухнула', fallen:true}];
  function helipadDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05, 0.05, 3.9, 3.9, 0.02); k.texFill('asphalt', '#46433f', '#3a4a40', 0.2); k.rr(0.05, 0.05, 3.9, 3.9, 0.02); k.stroke('#c8a030', 0.05);
    c.save(); k.rr(0.05, 0.05, 3.9, 3.9, 0.02); c.clip(); helipadMark(k, 2, 2, 1.4, d.worn); for(let i=0;i<(d.worn ? 40 : 8);i++) k.blot(k.R(0.4, 3.6), k.R(0.4, 3.6), k.R(0.08, 0.3), '#3e3b37', d.worn ? 0.55 : 0.3); for(let i=0;i<(d.worn ? 8 : 2);i++) k.line([k.R(0.2, 3.8), k.R(0.2, 3.8), k.R(0.2, 3.8), k.R(0.2, 3.8), k.R(0.2, 3.8), k.R(0.2, 3.8)], 'rgba(15,12,10,.55)', 0.015); if(d.worn) k.tufts(0.1, 0.1, 3.8, 3.8, 14); for(let i=0;i<4;i++) k.blot(k.R(0.5, 3.5), k.R(0.5, 3.5), k.R(0.15, 0.35), '#141210', 0.3); k.leaves(0, 0, 4, 4, 20); c.restore();
    if(d.heli){ c.save(); c.translate(2.1, 2.0); c.rotate(-0.4); k.organic(0.1, 0.12, 0.55, 0.12, 0.95); k.fill('rgba(0,0,0,.4)'); k.rr(-0.45, -0.9, 0.9, 1.6, 0.4); k.texFill('metal', '#6d7376', '#4a5a3a', 0.6); k.stroke(k.INK, 0.012); k.rr(-0.32, -0.85, 0.64, 0.4, 0.2); k.fill('rgba(40,55,60,.8)'); k.rr(-0.08, 0.6, 0.16, 1.2, 0.04); k.texFill('metal', '#6d7376', '#4a5a3a', 0.6); k.stroke(k.INK, 0.008); for(let i=0;i<4;i++){ const a = i/4*6.28 + 0.3, L = i===2 ? 0.7 : 1.7; k.line([0, -0.1, Math.cos(a)*L, -0.1 + Math.sin(a)*L], '#2a2826', 0.06); } c.beginPath(); c.arc(0, -0.1, 0.1, 0, 6.28); k.fill('#3a3836'); for(let i=0;i<8;i++) k.rust(k.R(-0.35, 0.35), k.R(-0.7, 0.5), 0.05, false); c.restore(); } }
  const HELIPAD = [{n:'Площадка'}, {n:'Стёртая', worn:true}, {n:'С брошенным вертолётом', worn:true, heli:true}];
  function skyBridgeDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.1, 0, 1.8, 8, 0.02, 0.25); k.rr(0.1, 0, 1.8, 8, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.014);
    for(let i=0;i<16;i++){ const y = 0.05 + i*0.495, gone = d.broken && k.rnd() < 0.5; k.rr(0.2, y, 1.6, 0.45, 0.01); if(gone){ k.fill('#141210'); c.save(); k.rr(0.2, y, 1.6, 0.45, 0.01); c.clip(); k.texFill('tiles', '#bab4a5'); k.fill('rgba(0,0,0,.35)'); k.trash(0.2, y, 1.6, 0.45, 3); c.restore(); } else { c.fillStyle = k.lin(0.2, y, 1.8, y + 0.45, [[0, 'rgba(140,175,185,.75)'], [1, 'rgba(60,85,95,.85)']]); c.fill(); k.line([0.3, y + 0.05, 0.9, y + 0.4], 'rgba(255,255,255,.25)', 0.02); k.radial(1.2, y + 0.25, 0.5, '#7a6a4a', 0.15); } }
    k.line([1, 0, 1, 8], '#3e4244', 0.05); for(let i=0;i<=16;i++) k.line([0.1, 0.025 + i*0.495, 1.9, 0.025 + i*0.495], '#3e4244', 0.035); if(d.broken) for(let i=0;i<30;i++){ const x = k.R(0.15, 1.85), y = k.R(0.1, 7.9); k.fillP([x, y, x + 0.06, y + 0.02, x + 0.02, y + 0.06], 'rgba(198,212,212,.7)'); } }
  const SKYBRIDGE = [{n:'Застеклённый мост'}, {n:'Стёкла выбиты', broken:true}];
  function billboardDraw(g, d){ const k = hk(g), c = k.c;
    [[0.3, 0.75], [2.7, 0.75]].forEach(([x, y])=>{ c.beginPath(); c.arc(x + 0.03, y + 0.04, 0.08, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#3a3e40'); });
    fx.sh(k, 0.05, 0.2, 2.9, 0.5, 0.02, 0.08); k.rr(0.05, 0.2, 2.9, 0.5, 0.02); k.texFill('metal', '#6d7376', '#2a2c2e', 0.5); k.stroke(k.INK, 0.012);
    k.rr(0.12, 0.26, 2.76, 0.38, 0.01); k.fill(d.broken ? '#0e0c0a' : '#0a1418');
    if(!d.broken){ c.save(); k.rr(0.12, 0.26, 2.76, 0.38, 0.01); c.clip(); k.radial(1.5, 0.45, 1.6, d.col, 0.55); for(let y=0.28;y<0.64;y+=0.03) k.line([0.12, y, 2.88, y], 'rgba(0,0,0,.25)', 0.008); bits.stencil(k, 1.5, 0.45, d.text, 0.2, '#f0f8f8', 0.95); c.restore(); k.radial(1.5, 0.45, 1.7, d.col, 0.18); }
    else { for(let i=0;i<10;i++) k.line([1.4, 0.45, 1.4 + k.R(-1.2, 1.2), 0.45 + k.R(-0.18, 0.18)], 'rgba(200,220,220,.4)', 0.006); k.rr(1.8, 0.3, 0.6, 0.25, 0.01); k.fill('#1a3a3e'); xb.cable(k, [0.5, 0.65, 0.4, 0.85, 0.7, 0.95], '#c8302a', 0.01); } }
  const BILLBOARD = [{n:'Голограмма', col:'#5ad1d6', text:'НЕОКОРП'}, {n:'Красная реклама', col:'#e8402a', text:'ПЕЙ КОЛУ'}, {n:'Разбит', broken:true}];
  function judgeDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.1, 0.1, 1.8, 1.8, 0.03); k.texFill('concrete', '#9a968e'); k.stroke(k.INK, 0.012); c.save(); k.rr(0.1, 0.1, 1.8, 1.8, 0.03); c.clip(); k.concreteDetail(0.1, 0.1, 1.8, 1.8, 0.6); c.restore();
    c.save(); c.translate(1.0, 1.05); const col = '#4a4e50';
    c.beginPath(); c.ellipse(0.1, 0.12, 0.55, 0.32, 0, 0, 6.28); k.fill('rgba(0,0,0,.45)'); c.beginPath(); c.ellipse(0, 0, 0.55, 0.3, 0, 0, 6.28); k.texFill('metal', '#6d7376', col, 0.6); k.stroke(k.INK, 0.01); [[-0.42, -0.02], [0.42, -0.02]].forEach(([x, y])=>{ c.beginPath(); c.ellipse(x, y, 0.16, 0.13, 0, 0, 6.28); k.texFill('metal', '#6d7376', '#8a7a3a', 0.6); k.stroke(k.INK, 0.008); });
    k.rr(0.25, -0.65, 0.12, 0.6, 0.03); k.fill('#2a2826'); k.rr(0.2, -0.25, 0.22, 0.2, 0.03); k.fill('#3a3836');
    if(!d.headless){ c.beginPath(); c.arc(0, -0.04, 0.2, 0, 6.28); k.texFill('metal', '#6d7376', '#3a3e40', 0.6); k.stroke(k.INK, 0.008); k.rr(-0.16, -0.12, 0.32, 0.08, 0.02); k.fill('#1e2428'); k.line([0, -0.24, 0, -0.32], '#8a7a3a', 0.04); k.radial(-0.08, -0.12, 0.3, '#ffffff', 0.15); } else { c.beginPath(); c.arc(0, -0.04, 0.14, 0, 6.28); k.fill('#2a2826'); for(let i=0;i<6;i++) k.rebar([0, -0.04, k.R(-0.15, 0.15), -0.04 + k.R(-0.15, 0.15)]); }
    c.restore(); bits.stencil(k, 1.0, 1.7, 'ЗАКОН', 0.16, '#c8a040', 0.6); if(d.graffiti){ k.graffiti(0.3, 0.3, 1.4, 0.4, '#e83a8a'); k.graffiti(0.2, 1.3, 1.0, 0.3, '#3ae88a'); } if(d.headless){ c.beginPath(); c.arc(1.6, 1.55, 0.16, 0, 6.28); k.texFill('metal', '#6d7376', '#3a3e40', 0.6); k.stroke(k.INK, 0.008); } }
  const JUDGE = [{n:'Страж закона'}, {n:'Обезглавлен', headless:true}, {n:'Исписан граффити', graffiti:true}];

  A('megatower', 'Супернебоскрёб', 'mega', 10, 10, {t:'небоскрёб башня мегаблок дредд', v:MEGATOWER.length, vn:VN(MEGATOWER), hd:true}, (g, v)=>megatowerDraw(g, PV(MEGATOWER, v)));
  A('megablock', 'Вертикальный жилой блок', 'mega', 8, 8, {t:'мегаблок жилой блок дредд', v:MEGABLOCK.length, vn:VN(MEGABLOCK), hd:true}, (g, v)=>megablockDraw(g, PV(MEGABLOCK, v)));
  A('fortress_tower', 'Башня-крепость', 'mega', 7, 7, {t:'крепость башня бастион турель', v:FORTRESS.length, vn:VN(FORTRESS), hd:true}, (g, v)=>fortressDraw(g, PV(FORTRESS, v)));
  A('skywalk', 'Многоуровневая улица', 'mega', 3, 10, {t:'эстакада улица уровень мост', v:SKYWALK.length, vn:VN(SKYWALK), hd:true}, (g, v)=>skywalkDraw(g, PV(SKYWALK, v)));
  A('monument', 'Монумент', 'mega', 3, 3, {t:'памятник монумент статуя площадь', v:MONUMENT.length, vn:VN(MONUMENT), hd:true}, (g, v)=>monumentDraw(g, PV(MONUMENT, v)));
  A('grand_arch', 'Арка-ворота', 'mega', 6, 2, {t:'арка ворота въезд', v:ARCH.length, vn:VN(ARCH), hd:true}, (g, v)=>archDraw(g, PV(ARCH, v)));
  A('ramp', 'Пандус', 'mega', 2, 4, {t:'пандус рампа съезд', v:RAMP.length, vn:VN(RAMP), hd:true}, (g, v)=>rampDraw(g, PV(RAMP, v)));
  A('roof_vent', 'Вентиляционная шахта', 'mega', 2, 2, {t:'вентиляция шахта крыша', v:ROOFVENT.length, vn:VN(ROOFVENT), hd:true}, (g, v)=>roofVentDraw(g, PV(ROOFVENT, v)));
  A('antenna', 'Антенная мачта', 'mega', 2, 2, {t:'антенна мачта связь радио', v:ANTENNA_M.length, vn:VN(ANTENNA_M), hd:true}, (g, v)=>antennaMastDraw(g, PV(ANTENNA_M, v)));
  A('helipad', 'Посадочная площадка', 'mega', 4, 4, {t:'вертолётная площадка посадка', g:true, v:HELIPAD.length, vn:VN(HELIPAD), hd:true}, (g, v)=>helipadDraw(g, PV(HELIPAD, v)));
  A('sky_bridge', 'Мост между башнями', 'mega', 2, 8, {t:'мост переход башни', v:SKYBRIDGE.length, vn:VN(SKYBRIDGE), hd:true}, (g, v)=>skyBridgeDraw(g, PV(SKYBRIDGE, v)));
  A('billboard', 'Голо-билборд', 'mega', 3, 1, {t:'реклама билборд экран', v:BILLBOARD.length, vn:VN(BILLBOARD), hd:true}, (g, v)=>billboardDraw(g, PV(BILLBOARD, v)));
  A('statue_judge', 'Статуя стража закона', 'mega', 2, 2, {t:'статуя страж закон судья дредд', v:JUDGE.length, vn:VN(JUDGE), hd:true}, (g, v)=>judgeDraw(g, PV(JUDGE, v)));

  /* ===================== ТОРГОВЛЯ ===================== */
  /* ---- Торговля (HD) ---- */
  // плоская кровля с парапетом: общая основа для ТЦ и магазинов
  function flatRoof(k, W, H, pw){ const c = k.c; k.rr(0, 0, W, H, 0.03); k.texFill('concrete', '#8a8780'); k.rr(0, 0, W, H, 0.03); k.stroke(k.INK, 0.016); k.line([0.03, 0.03, W - 0.03, 0.03], 'rgba(255,250,240,.3)', 0.02);
    k.rr(pw, pw, W - 2*pw, H - 2*pw, 0.02); k.texFill('roofing', '#46433f'); c.save(); k.rr(pw, pw, W - 2*pw, H - 2*pw, 0.02); c.clip(); c.fillStyle = k.lin(0, pw, 0, pw + 0.4, [[0, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(0, 0, W, pw + 0.4); c.fillStyle = k.lin(pw, 0, pw + 0.4, 0, [[0, 'rgba(0,0,0,.28)'], [1, 'rgba(0,0,0,0)']]); c.fillRect(0, 0, pw + 0.4, H); for(let i=0;i<Math.round(W*H/8);i++) k.puddle(k.R(pw + 0.4, W - pw - 0.4), k.R(pw + 0.4, H - pw - 0.4), k.R(0.15, 0.4), k.R(0.1, 0.3)); k.leaves(pw, pw, W - 2*pw, H - 2*pw, Math.round(W*H*1.5)); k.trash(pw, pw, W - 2*pw, H - 2*pw, Math.round(W*H/3)); c.restore(); }
  function hvac(k, x, y, w, h){ const c = k.c; fx.sh(k, x, y, w, h, 0.02, 0.07); k.rr(x, y, w, h, 0.02); c.fillStyle = k.lin(x, y, x, y + h, [[0, '#b9b6ac'], [1, '#7e7b74']]); c.fill(); k.stroke(k.INK, 0.01); const n = Math.max(1, Math.round(w/0.5)); for(let i=0;i<n;i++){ const fx0 = x + (i + 0.5)*w/n, fy = y + h*0.45, r = Math.min(w/n, h)*0.35; c.beginPath(); c.arc(fx0, fy, r, 0, 6.28); k.fill('#2a2826'); for(let j=0;j<5;j++){ const a = j/5*6.28 + i; k.line([fx0, fy, fx0 + Math.cos(a)*r*0.9, fy + Math.sin(a)*r*0.9], '#6a6e70', r*0.25); } c.beginPath(); c.arc(fx0, fy, r*0.2, 0, 6.28); k.fill('#5a5e60'); } for(let i=0;i<3;i++) k.rust(k.R(x, x + w), k.R(y, y + h), 0.04, false); k.streak(x + w*0.5, y + h, 0.4, 0.05, '#3a3026', 0.3); }
  function skylight(k, x, y, w, h, broken){ const c = k.c; k.rr(x - 0.08, y - 0.08, w + 0.16, h + 0.16, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.012); const nx = Math.round(w/0.6), ny = Math.round(h/0.6);
    for(let i=0;i<nx;i++) for(let j=0;j<ny;j++){ const px = x + i*w/nx, py = y + j*h/ny, pw = w/nx - 0.04, ph = h/ny - 0.04, gone = broken && k.rnd() < 0.55; k.rr(px + 0.02, py + 0.02, pw, ph, 0.005); if(gone){ k.fill('#0e0c0a'); k.radial(px + pw/2, py + ph/2, Math.max(pw, ph), '#3a3026', 0.2); } else { c.fillStyle = k.lin(px, py, px + pw, py + ph, [[0, 'rgba(150,180,185,.75)'], [1, 'rgba(60,80,85,.85)']]); c.fill(); k.line([px + 0.05, py + 0.05, px + pw*0.4, py + ph*0.6], 'rgba(255,255,255,.25)', 0.015); k.radial(px + pw*0.6, py + ph*0.6, pw*0.6, '#8a7a5a', 0.2); } }
    for(let i=1;i<nx;i++) k.line([x + i*w/nx, y, x + i*w/nx, y + h], '#3e4244', 0.03); for(let j=1;j<ny;j++) k.line([x, y + j*h/ny, x + w, y + j*h/ny], '#3e4244', 0.03); if(broken) for(let i=0;i<20;i++){ const px = k.R(x, x + w), py = k.R(y, y + h); k.fillP([px, py, px + 0.05, py + 0.015, px + 0.02, py + 0.05], 'rgba(198,212,212,.7)'); } }
  function mallDraw(g, d){ const k = hk(g), c = k.c, W = 10, H = 8;
    flatRoof(k, W, H, 0.25); skylight(k, 3.2, 2.4, 3.6, 3.2, d.broken);
    [[0.7, 0.7, 1.4, 0.7], [7.9, 0.7, 1.4, 0.7], [0.7, 6.4, 1.4, 0.7], [7.9, 6.4, 1.4, 0.7], [0.7, 3.6, 0.9, 0.6], [8.4, 3.6, 0.9, 0.6]].forEach(b=>hvac(k, b[0], b[1], b[2], b[3]));
    [[2.4, 1.0], [7.6, 2.0], [2.4, 6.6], [7.2, 6.8]].forEach(([x, y])=>ventPipe(k, x, y, 0.1)); antenna(k, 9.2, 1.6, 1.0, 2.3); dish(k, 1.6, 2.2, 0.28);
    k.rr(3.5, H - 0.1, 3.0, 0.1, 0.01); k.fill('#5a5e60'); for(let i=0;i<8;i++){ k.rr(3.55 + i*0.36, H - 0.32, 0.26, 0.22, 0.02); k.fill(d.sign || '#8e2e26', 0.85); k.stroke(k.INK, 0.006); } bits.stencil(k, 5.0, H - 0.21, 'ГИПЕРМАРКЕТ', 0.15, '#e4ddca', 0.85); erode(k, 3.5, H - 0.35, 3, 0.3, 0.4);
    if(d.camp){ for(let i=0;i<3;i++) k.tarp(1.6 + i*2.4, 4.6 + (i%2)*0.6, 1.2, 0.9, k.pick(['#5a5a3e', '#3e5a6a', '#7a4a36']), k.R(-0.2, 0.2)); houseBits.bed(k, [8.0, 4.6, 1.3, 1.0]); houseBits.bed(k, [8.0, 5.7, 1.3, 0.5]); [[2.4, 3.4], [7.6, 4.2]].forEach(([x, y])=>houseBits.tank(k, x, y, 0.3)); solar(k, 1.2, 1.6, 1.2, 0.6, false); bits.stones(k, 6.4, 6.3, 0.16, 7); bits.fire(k, 6.4, 6.3, 0.12, 0.8); xb.laundry(k, 1.0, 5.8, 3.0, 6.0); } }
  const MALL = [{n:'Крыша с атриумом'}, {n:'Атриум провален', broken:true}, {n:'Лагерь на крыше', camp:true, sign:'#3e5a6a'}];
  function shopDraw(g, d){ const k = hk(g), c = k.c, W = 4, H = 4;
    flatRoof(k, W, H - 0.4, 0.18); hvac(k, 2.4, 0.5, 1.0, 0.55); ventPipe(k, 0.7, 0.8, 0.07); if(d.looted){ k.organic(1.4, 1.8, 0.55, 0.4, 0.45); k.fill('#0e0c0a'); for(let i=0;i<8;i++) k.rebar([1.4 + k.R(-0.5, 0.5), 1.8 + k.R(-0.4, 0.4), 1.4 + k.R(-0.7, 0.7), 1.8 + k.R(-0.6, 0.6)]); }
    // вывеска и козырёк по фасаду (низ)
    k.rr(0.15, H - 0.55, 3.7, 0.2, 0.01); k.fill(d.looted ? '#2a2826' : shade(d.col, -0.2)); k.stroke(k.INK, 0.01); if(!d.looted || d.sign2) bits.stencil(k, 2.0, H - 0.45, d.sign, 0.14, '#e4ddca', 0.85); erode(k, 0.15, H - 0.55, 3.7, 0.2, 0.4);
    if(d.cross){ k.rr(3.35, H - 0.6, 0.3, 0.3, 0.02); k.fill('#2a2826'); k.rr(3.45, H - 0.57, 0.1, 0.24, 0.01); k.fill('#5ad18a'); k.rr(3.38, H - 0.5, 0.24, 0.1, 0.01); k.fill('#5ad18a'); k.radial(3.5, H - 0.45, 0.4, '#5ad18a', 0.15); }
    for(let i=0;i<8;i++){ k.poly([0.2 + i*0.45, H - 0.35, 0.2 + (i + 1)*0.45, H - 0.35, 0.2 + (i + 1)*0.45 - 0.02, H - 0.08, 0.2 + i*0.45 + 0.02, H - 0.08]); k.fill(d.looted && i===5 ? 'rgba(0,0,0,0)' : (i%2 ? '#d0c6ae' : d.col)); } k.line([0.2, H - 0.08, 3.8, H - 0.08], 'rgba(10,8,6,.5)', 0.012);
    if(d.looted){ k.trash(0, H - 0.4, W, 0.4, 14); for(let i=0;i<6;i++){ const x = k.R(0.2, 3.8), y = k.R(H - 0.3, H - 0.05); k.fillP([x, y, x + 0.06, y + 0.02, x + 0.02, y + 0.06], 'rgba(198,212,212,.7)'); } } }
  const SHOP = [{n:'Продуктовый', col:'#7a3a2e', sign:'ПРОДУКТЫ'}, {n:'Аптека', col:'#3e6a5a', sign:'АПТЕКА', cross:true}, {n:'Разграблен, провал', col:'#5a5a48', sign:'ХОЗТОВАРЫ', looted:true}];
  function goods(k, x, y, w, h, kind){ const c = k.c; for(let i=0;i<Math.round(w*h*40);i++){ const px = x + k.rnd()*w, py = y + k.rnd()*h;
    if(kind==='veg'){ c.beginPath(); c.arc(px, py, k.R(0.025, 0.045), 0, 6.28); k.fill(k.pick(['#8a3a24', '#c8902a', '#6a8a2a', '#a8a43a', '#7a2a4a'])); k.c.beginPath(); k.c.arc(px - 0.01, py - 0.01, 0.01, 0, 6.28); k.fill('rgba(255,255,255,.4)'); }
    else if(kind==='scrap'){ c.save(); c.translate(px, py); c.rotate(k.rnd()*6.28); k.rr(-0.04, -0.012, 0.08, 0.024, 0.005); k.fill(k.pick(['#6a6e70', '#8a5a3a', '#4a4e50', '#a89a6a'])); c.restore(); }
    else if(kind==='guns'){ if(i%3===0) rifle(k, px, py, k.R(-0.3, 0.3), 0.5, k.rnd() < 0.5); else bits.casings(k, px - 0.05, py - 0.05, 0.1, 0.1, 2); } } }
  function stallDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.08, 0.3, 1.84, 0.62, '#6a5236', 0.02); c.save(); k.rr(0.08, 0.3, 1.84, 0.62, 0.02); c.clip(); goods(k, 0.12, 0.34, 1.76, 0.54, d.kind); c.restore();
    if(d.kind==='guns'){ houseBits.crate(k, 1.6, 0.6, 0.35, 0.3, 0.1); xb.box(k, 0.35, 0.6, 0.35, 0.2, -0.1, '#4e5a34'); }
    for(let i=0;i<6;i++){ k.poly([0.05 + i*0.317, 0.04, 0.05 + (i + 1)*0.317, 0.04, 0.05 + (i + 1)*0.317 - 0.01, 0.32, 0.05 + i*0.317 + 0.01, 0.32]); k.fill(i%2 ? '#d0c6ae' : d.col); } k.line([0.05, 0.32, 1.95, 0.32], 'rgba(10,8,6,.5)', 0.012); c.save(); k.poly([0.05, 0.04, 1.95, 0.04, 1.95, 0.32, 0.05, 0.32]); c.clip(); k.radial(1, 0.15, 1, '#3a3026', 0.2); c.restore();
    [0.06, 1.94].forEach(x=>{ c.beginPath(); c.arc(x, 0.9, 0.035, 0, 6.28); k.fill('#5e4630'); }); fx.chair(k, 1.0, 0.98, Math.PI, 'wood', '#5e4630'); }
  const STALL = [{n:'Фрукты и овощи', kind:'veg', col:'#7a3a2e'}, {n:'Барахло и запчасти', kind:'scrap', col:'#3e5a6a'}, {n:'Оружие и патроны', kind:'guns', col:'#4a5236'}];
  function mtentDraw(g, d){ const k = hk(g), c = k.c;
    [[0.1, 0.1], [1.9, 0.1], [0.1, 1.9], [1.9, 1.9]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#3a3e40'); });
    c.save(); c.globalAlpha = 0.92; const P = [0.05, 0.05, 1.95, 0.05, 1.95, 1.95, 0.05, 1.95]; [[0.05, 0.05, 1.95, 0.05, 1, 1], [1.95, 0.05, 1.95, 1.95, 1, 1], [1.95, 1.95, 0.05, 1.95, 1, 1], [0.05, 1.95, 0.05, 0.05, 1, 1]].forEach((p, i)=>{ k.poly(p); k.fill(i%2 ? d.col : '#d0c6ae'); k.poly(p); k.fill(['rgba(255,250,240,.12)', 'rgba(0,0,0,.12)', 'rgba(0,0,0,.28)', 'rgba(255,250,240,.04)'][i]); k.poly(p); k.stroke('rgba(10,8,6,.45)', 0.01); }); c.restore();
    c.save(); k.poly(P); c.clip(); for(let i=0;i<5;i++) k.blot(k.R(0.3, 1.7), k.R(0.3, 1.7), k.R(0.1, 0.2), '#3a3026', 0.2); if(d.torn){ k.organic(1.4, 0.6, 0.3, 0.5, 0.25); k.fill('#141210'); c.save(); k.organic(1.4, 0.6, 0.3, 0.5, 0.25); c.clip(); goods(k, 1.1, 0.35, 0.6, 0.5, 'veg'); c.restore(); } c.restore();
    c.beginPath(); c.arc(1, 1, 0.06, 0, 6.28); k.fill('#5e4630'); for(let i=0;i<8;i++) k.line([0.05 + i*0.27, 1.95, 0.05 + i*0.27 + 0.13, 2.0], 'rgba(200,190,170,.6)', 0.006); }
  const MTENT = [{n:'Красно-белый', col:'#7a3a2e'}, {n:'Сине-белый', col:'#3e5a7a'}, {n:'Рваный', col:'#5a5a3e', torn:true}];
  const WAREHOUSE = [{n:'Склад', roof:'gable', mat:'corrugated', tint:'#6a6e70', vents:[[1.2, 1.0], [4.8, 1.0]], antenna:[5.4, 0.5, 2.4]}, {n:'Провал крыши', roof:'gable', mat:'corrugated', tint:'#6a5a4a', dmg:2, missing:4}, {n:'Сгоревший', dmg:3}];
  function storeShelfDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); if(d.fallen){ c.translate(0.6, 1.5); c.rotate(0.35); c.translate(-0.5, -1.5); }
    fx.sh(k, 0.1, 0.05, 0.8, 2.9, 0.02, 0.06); k.rr(0.1, 0.05, 0.8, 2.9, 0.02); k.texFill('metal', '#8a9094', '#c8c2b0', 0.4); k.stroke(k.INK, 0.012); k.line([0.5, 0.05, 0.5, 2.95], 'rgba(0,0,0,.4)', 0.02);
    for(let s=0;s<2;s++){ const x0 = 0.14 + s*0.38; for(let y=0.1;y<2.9;y+=0.18){ if(d.looted && k.rnd() < 0.75) continue; let px = x0; while(px < x0 + 0.32){ const w = k.R(0.05, 0.1); k.rr(px, y, w, 0.14, 0.01); k.fill(k.pick(['#8a3a2e', '#3e5a6a', '#c8a040', '#5a7a3a', '#d8d0bc', '#6a3a5a'])); k.stroke('rgba(0,0,0,.35)', 0.004); k.line([px + 0.01, y + 0.02, px + 0.01, y + 0.12], 'rgba(255,255,255,.3)', 0.006); px += w + 0.01; } } }
    for(let y=0.28;y<2.9;y+=0.54) k.line([0.12, y, 0.88, y], '#6a6e70', 0.012); c.restore();
    if(d.looted || d.fallen) k.trash(0, 0, 1, 3, 14); }
  const SSHELF = [{n:'Полный'}, {n:'Разграблен', looted:true}, {n:'Повален', fallen:true}];
  function displayDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.02, 0.15, 2.96, 0.7, 0.01); k.texFill('tiles', '#bab4a5'); k.stroke(k.INK, 0.01);
    if(d.mannequins) [[0.6, 0.45], [1.5, 0.5], [2.4, 0.45]].forEach(([x, y], i)=>{ c.beginPath(); c.ellipse(x + 0.03, y + 0.04, 0.18, 0.1, 0, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.ellipse(x, y, 0.18, 0.1, 0, 0, 6.28); k.fill(i===1 ? '#7a3a2e' : '#d8d0c0'); k.stroke(k.INK, 0.006); c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#e8e0d0'); k.stroke(k.INK, 0.005); });
    else for(let i=0;i<7;i++){ const x = 0.25 + i*0.38; k.rr(x - 0.12, 0.3, 0.24, 0.3, 0.02); k.fill(k.pick(['#8a6a4a', '#4a5a6a', '#7a3a2e', '#c8b890'])); k.stroke(k.INK, 0.006); }
    k.rr(0.02, 0.78, 2.96, 0.08, 0.005); c.fillStyle = 'rgba(160,190,195,.7)'; c.fill(); k.line([0.02, 0.78, 2.98, 0.78], '#3e4244', 0.02); for(let i=1;i<4;i++) k.line([0.75*i, 0.76, 0.75*i, 0.88], '#3e4244', 0.03); k.line([0.2, 0.8, 0.8, 0.84], 'rgba(255,255,255,.45)', 0.012); }
  const DISPLAY = [{n:'С товаром'}, {n:'С манекенами', mannequins:true}];
  function brokenWinDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.02, 0.15, 2.96, 0.7, 0.01); k.texFill('tiles', '#bab4a5'); k.stroke(k.INK, 0.01); c.save(); k.rr(0.02, 0.15, 2.96, 0.7, 0.01); c.clip(); k.trash(0, 0.15, 3, 0.7, 14); c.restore();
    k.line([0.02, 0.78, 2.98, 0.78], '#3e4244', 0.02); for(let i=1;i<4;i++) k.line([0.75*i, 0.76, 0.75*i, 0.88], '#3e4244', 0.03);
    for(let i=0;i<40;i++){ const x = k.R(0.05, 2.95), y = k.rnd() < 0.6 ? k.R(0.82, 0.98) : k.R(0.2, 0.75), s = k.R(0.03, 0.09); k.fillP([x, y, x + s, y + s*0.3, x + s*0.3, y + s], 'rgba(190,210,212,.75)'); k.line([x, y, x + s, y + s*0.3], 'rgba(255,255,255,.5)', 0.004); }
    [[0.3, 0.8], [2.1, 0.8]].forEach(([x, y])=>{ k.fillP([x, y - 0.03, x + 0.2, y - 0.02, x + 0.08, y + 0.05], 'rgba(170,200,205,.8)'); });
    if(d.boards) for(let i=0;i<3;i++) k.plank(1.5, 0.75 + i*0.08, 2.8, 0.08, k.R(-0.05, 0.05), '#5e4630', false); }
  const BROKEN_WIN = [{n:'Осколки'}, {n:'Заколочена', boards:true}];
  function checkoutDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); if(d.fallen){ c.translate(0.5, 1); c.rotate(0.4); c.translate(-0.5, -1); }
    fx.sh(k, 0.15, 0.1, 0.7, 1.8, 0.03, 0.06); k.rr(0.15, 0.1, 0.7, 1.8, 0.03); k.texFill('metal', '#8a9094', '#b8b2a2', 0.4); k.stroke(k.INK, 0.012);
    k.rr(0.25, 0.2, 0.5, 1.0, 0.02); k.fill('#1e1c1a'); for(let i=0;i<14;i++) k.line([0.27, 0.25 + i*0.07, 0.73, 0.25 + i*0.07], '#3a3836', 0.012); if(!d.fallen){ goods(k, 0.3, 0.3, 0.4, 0.4, 'veg'); }
    k.rr(0.25, 1.35, 0.45, 0.35, 0.03); k.fill('#3a3c3e'); k.stroke(k.INK, 0.008); k.rr(0.3, 1.38, 0.3, 0.1, 0.01); k.fill('#1a2a1e');
    if(d.looted){ k.rr(0.27, 1.52, 0.4, 0.15, 0.01); k.fill('#0e0c0a'); for(let i=0;i<5;i++){ k.rr(k.R(0.0, 0.9), k.R(1.5, 1.95), 0.14, 0.07, 0.005); k.fill('#7a8a5a'); } } c.restore(); }
  const CHECKOUT = [{n:'Касса'}, {n:'Вскрыта', looted:true}, {n:'Опрокинута', fallen:true, looted:true}];
  function cartsDraw(g, d){ const k = hk(g), c = k.c;
    const cart = (x, y, a)=>{ c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.18 + 0.02, -0.25 + 0.03, 0.36, 0.5, 0.02); k.fill('rgba(0,0,0,.25)'); k.rr(-0.18, -0.25, 0.36, 0.5, 0.02); k.stroke('#9aa0a2', 0.02); c.save(); k.rr(-0.18, -0.25, 0.36, 0.5, 0.02); c.clip(); for(let i=-4;i<=4;i++){ k.line([i*0.045, -0.25, i*0.045, 0.25], '#8a9094', 0.006); } for(let j=-5;j<=5;j++) k.line([-0.18, j*0.05, 0.18, j*0.05], '#8a9094', 0.006); if(d.junk){ k.trash(-0.15, -0.2, 0.3, 0.4, 6); houseBits.crate(k, 0, 0.05, 0.18, 0.14, 0.3); } c.restore(); k.line([-0.18, -0.3, 0.18, -0.3], '#c8302a', 0.03); for(const [wx, wy] of [[-0.15, -0.22], [0.15, -0.22], [-0.15, 0.22], [0.15, 0.22]]){ c.beginPath(); c.arc(wx, wy, 0.03, 0, 6.28); k.fill('#1a1a1a'); } c.restore(); };
    if(d.fallen){ cart(0.5, 0.5, 1.4); return; } cart(0.5, 0.55, 0.05); if(!d.junk){ cart(0.5, 0.45, 0.05); cart(0.5, 0.35, 0.05); } }
  const CARTS = [{n:'Сцеплены'}, {n:'С хламом', junk:true}, {n:'Опрокинута', fallen:true}];
  function foodCourtDraw(g, d){ const k = hk(g), c = k.c;
    [[0.25, 1], [1.75, 1]].forEach(([x, y])=>{ fx.sh(k, x - 0.15, y - 0.65, 0.3, 1.3, 0.05); k.rr(x - 0.15, y - 0.65, 0.3, 1.3, 0.05); k.fill(d.col); k.stroke(k.INK, 0.008); k.radial(x - 0.05, y - 0.3, 0.4, '#ffffff', 0.15); });
    fx.sh(k, 0.5, 0.45, 1.0, 1.1, 0.03); k.rr(0.5, 0.45, 1.0, 1.1, 0.03); c.fillStyle = k.lin(0.5, 0.45, 1.5, 1.55, [[0, '#d8d2c4'], [1, '#a8a294']]); c.fill(); k.stroke(k.INK, 0.01);
    if(!d.empty){ [[0.75, 0.75], [1.25, 1.25]].forEach(([x, y])=>{ k.rr(x - 0.2, y - 0.14, 0.4, 0.28, 0.02); k.fill('#8a3a2e'); k.stroke(k.INK, 0.006); k.rr(x - 0.15, y - 0.08, 0.14, 0.12, 0.02); k.fill('#c8a050'); fx.cup(k, x + 0.1, y, 0.04); }); k.rr(1.15, 0.6, 0.12, 0.14, 0.02); k.fill('#d8c890'); }
    if(d.trash){ k.trash(0.5, 0.45, 1.0, 1.1, 10); k.blot(1.1, 1.0, 0.15, '#5a3a1e', 0.4); } }
  const FOOD = [{n:'С подносами', col:'#c8302a'}, {n:'Пустой', col:'#3e6a8a', empty:true}, {n:'Замусорен', col:'#c8a030', trash:true}];
  function escalatorDraw(g, d){ const k = hk(g), c = k.c;
    [[0.05, 0.35], [1.6, 0.35]].forEach(([x])=>{ fx.sh(k, x, 0.05, 0.35, 3.9, 0.03); k.rr(x, 0.05, 0.35, 3.9, 0.03); k.texFill('metal', '#8a9094'); k.stroke(k.INK, 0.01); k.line([x + 0.17, 0.1, x + 0.17, 3.9], '#1a1a18', 0.07); });
    k.rr(0.4, 0.05, 1.2, 3.9, 0.01); k.fill('#2a2826'); for(let i=0;i<26;i++){ const y = 0.1 + i*0.15, dk = i/26; k.rr(0.42, y, 1.16, 0.13, 0.005); k.texFill('metal', '#6d7376'); k.fill(`rgba(0,0,0,${dk*0.6})`); for(let j=0;j<14;j++) k.line([0.45 + j*0.08, y + 0.02, 0.45 + j*0.08, y + 0.11], 'rgba(0,0,0,.35)', 0.008); }
    if(d.collapsed){ k.organic(1.0, 2.4, 0.6, 0.4, 0.8); k.fill('#0a0908'); for(let i=0;i<10;i++) k.chunk(k.R(0.5, 1.5), k.R(1.8, 3.2), k.R(0.05, 0.12), '#5a5e60', 0.03); }
    if(d.rubble){ for(let i=0;i<30;i++) k.chunk(k.R(0.4, 1.6), k.R(2.0, 3.9), k.R(0.04, 0.12), k.pick(['#9a968e', '#86827a']), 0.03); k.trash(0.4, 0.5, 1.2, 3, 10); } }
  const ESC = [{n:'Стоит'}, {n:'Обрушен пролёт', collapsed:true}, {n:'Засыпан обломками', rubble:true}];
  function palletDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.08, 0.08, 0.84, 0.84, '#8a7050', 0.01); for(let i=0;i<5;i++) k.line([0.08, 0.15 + i*0.17, 0.92, 0.15 + i*0.17], 'rgba(0,0,0,.4)', 0.03);
    if(d.kind==='crates'){ houseBits.crate(k, 0.32, 0.32, 0.38, 0.38, 0.03); houseBits.crate(k, 0.68, 0.32, 0.36, 0.38, -0.05); houseBits.crate(k, 0.5, 0.7, 0.4, 0.34, 0.04); }
    else if(d.kind==='sacks') for(let i=0;i<5;i++){ c.save(); c.translate(0.3 + (i%2)*0.4, 0.25 + Math.floor(i/2)*0.27); c.rotate(k.R(-0.2, 0.2)); k.organic(0, 0, 0.2, 0.15, 0.13); c.fillStyle = k.lin(-0.2, -0.13, 0.2, 0.13, [[0, '#d8c8a0'], [1, '#a08a60']]); c.fill(); k.stroke('rgba(40,30,20,.6)', 0.008); bits.stencil(k, 0, 0, 'МУКА', 0.05, '#5a4630', 0.6); c.restore(); }
    else if(d.kind==='barrels') [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([x, y], i)=>bits.barrel(k, x, y, 0.19, ['#3e5a6a', '#6a4a36', '#4a5a3a', '#8a3a2e'][i]));
    else { k.rr(0.12, 0.12, 0.76, 0.76, 0.04); c.fillStyle = 'rgba(210,220,225,.45)'; c.fill(); for(let i=0;i<4;i++) k.line([0.12, 0.2 + i*0.18, 0.88, 0.25 + i*0.18], 'rgba(255,255,255,.35)', 0.01); houseBits.crate(k, 0.5, 0.5, 0.6, 0.6, 0); c.save(); k.rr(0.12, 0.12, 0.76, 0.76, 0.04); c.clip(); c.fillStyle = 'rgba(210,220,225,.35)'; c.fillRect(0, 0, 1, 1); c.restore(); } }
  const PALLET = [{n:'С ящиками', kind:'crates'}, {n:'С мешками', kind:'sacks'}, {n:'С бочками', kind:'barrels'}, {n:'В плёнке', kind:'wrap'}];
  function fdispDraw(g, d){ const k = hk(g), c = k.c;
    fx.enamel(k, 0.08, 0.06, 0.84, 1.88, '#d8d2c4', 0.04); k.rr(0.15, 0.13, 0.7, 1.74, 0.03); k.fill('#1e2a2e');
    if(!d.empty && !d.broken) for(let i=0;i<24;i++){ const x = k.R(0.2, 0.8), y = k.R(0.2, 1.8); k.rr(x - 0.06, y - 0.04, 0.12, 0.08, 0.01); k.fill(k.pick(['#c8b890', '#8a3a2e', '#3e5a6a', '#d8d0c0'])); }
    if(d.empty) k.radial(0.5, 1, 0.6, '#5a7a8a', 0.15);
    if(d.broken){ for(let i=0;i<30;i++){ const x = k.R(0.15, 0.85), y = k.R(0.15, 1.85); k.fillP([x, y, x + 0.05, y + 0.015, x + 0.02, y + 0.05], 'rgba(198,212,212,.7)'); } k.blot(0.5, 1.2, 0.3, '#3a3a2a', 0.5); }
    else { c.fillStyle = 'rgba(170,200,210,.35)'; k.rr(0.15, 0.13, 0.7, 1.74, 0.03); c.fill(); k.line([0.2, 0.2, 0.5, 1.2], 'rgba(255,255,255,.3)', 0.015); k.line([0.5, 0.13, 0.5, 1.87], '#8a9094', 0.02); } }
  const FDISP = [{n:'Полная'}, {n:'Пустая', empty:true}, {n:'Разбита', broken:true}];
  function vendingDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); if(d.fallen){ c.translate(0.5, 0.5); c.rotate(0.6); c.translate(-0.5, -0.5); }
    fx.sh(k, 0.12, 0.2, 0.76, 0.6, 0.03, 0.06); k.rr(0.12, 0.2, 0.76, 0.6, 0.03); c.fillStyle = k.lin(0.12, 0.2, 0.88, 0.8, [[0, shade(d.col, 0.2)], [1, shade(d.col, -0.3)]]); c.fill(); k.stroke(k.INK, 0.01);
    k.rr(0.16, 0.24, 0.45, 0.5, 0.02); k.fill('rgba(30,40,45,.85)'); if(!d.fallen) for(let j=0;j<4;j++) for(let i=0;i<4;i++){ k.rr(0.18 + i*0.105, 0.27 + j*0.115, 0.08, 0.09, 0.01); k.fill(k.pick(['#c8302a', '#3e6a9a', '#c8a030', '#5a9a5a'])); }
    k.rr(0.66, 0.26, 0.17, 0.25, 0.01); k.fill('#2a2c2e'); for(let i=0;i<9;i++){ c.beginPath(); c.arc(0.7 + (i%3)*0.045, 0.3 + Math.floor(i/3)*0.05, 0.012, 0, 6.28); k.fill('#8a9094'); } k.rr(0.68, 0.6, 0.12, 0.08, 0.01); k.fill('#141210');
    if(d.fallen){ for(let i=0;i<8;i++) k.line([0.4, 0.5, 0.4 + k.R(-0.2, 0.2), 0.5 + k.R(-0.2, 0.2)], 'rgba(220,228,228,.55)', 0.004); } c.restore();
    if(d.fallen) for(let i=0;i<6;i++) fx.can(k, k.R(0.1, 0.9), k.R(0.7, 0.95), 0.04, k.pick(['#c8302a', '#3e6a9a'])); }
  const VENDING = [{n:'Газировка', col:'#a8302a'}, {n:'Снеки', col:'#2e4a7a'}, {n:'Повален, разбит', col:'#a8302a', fallen:true}];

  A('mall', 'Торговый центр', 'trade', 10, 8, {t:'торговый центр тц молл', v:MALL.length, vn:VN(MALL), hd:true}, (g, v)=>mallDraw(g, PV(MALL, v)));
  A('shop', 'Магазин', 'trade', 4, 4, {t:'магазин лавка', v:SHOP.length, vn:VN(SHOP), hd:true}, (g, v)=>shopDraw(g, PV(SHOP, v)));
  A('market_stall', 'Прилавок рынка', 'trade', 2, 1, {t:'прилавок рынок торговля', v:STALL.length, vn:VN(STALL), hd:true}, (g, v)=>stallDraw(g, PV(STALL, v)));
  A('market_tent', 'Торговый шатёр', 'trade', 2, 2, {t:'шатёр рынок навес', v:MTENT.length, vn:VN(MTENT), hd:true}, (g, v)=>mtentDraw(g, PV(MTENT, v)));
  A('warehouse', 'Склад', 'trade', 6, 4, {t:'склад ангар хранилище', v:WAREHOUSE.length, vn:VN(WAREHOUSE), hd:true}, (g, v)=>houseDraw(g, 6, 4, PV(WAREHOUSE, v)));
  A('shelf', 'Стеллаж', 'trade', 1, 3, {t:'стеллаж полка склад', v:SSHELF.length, vn:VN(SSHELF), hd:true}, (g, v)=>storeShelfDraw(g, PV(SSHELF, v)));
  A('display_window', 'Витрина', 'trade', 3, 1, {t:'витрина стекло окно', v:DISPLAY.length, vn:VN(DISPLAY), hd:true}, (g, v)=>displayDraw(g, PV(DISPLAY, v)));
  A('broken_window', 'Разбитая витрина', 'trade', 3, 1, {t:'витрина разбитая стекло', v:BROKEN_WIN.length, vn:VN(BROKEN_WIN), hd:true}, (g, v)=>brokenWinDraw(g, PV(BROKEN_WIN, v)));
  A('checkout', 'Касса', 'trade', 1, 2, {t:'касса прилавок', v:CHECKOUT.length, vn:VN(CHECKOUT), hd:true}, (g, v)=>checkoutDraw(g, PV(CHECKOUT, v)));
  A('carts', 'Тележки', 'trade', 1, 1, {t:'тележка магазин', v:CARTS.length, vn:VN(CARTS), hd:true}, (g, v)=>cartsDraw(g, PV(CARTS, v)));
  A('food_court', 'Стол фуд-корта', 'trade', 2, 2, {t:'стол фудкорт кафе еда', v:FOOD.length, vn:VN(FOOD), hd:true}, (g, v)=>foodCourtDraw(g, PV(FOOD, v)));
  A('escalator', 'Эскалатор', 'trade', 2, 4, {t:'эскалатор лестница', v:ESC.length, vn:VN(ESC), hd:true}, (g, v)=>escalatorDraw(g, PV(ESC, v)));
  A('pallet', 'Паллета с ящиками', 'trade', 1, 1, {t:'паллета ящики груз', v:PALLET.length, vn:VN(PALLET), hd:true}, (g, v)=>palletDraw(g, PV(PALLET, v)));
  A('fridge_display', 'Холодильная витрина', 'trade', 1, 2, {t:'холодильник витрина', v:FDISP.length, vn:VN(FDISP), hd:true}, (g, v)=>fdispDraw(g, PV(FDISP, v)));
  A('vending', 'Торговый автомат', 'trade', 1, 1, {t:'автомат торговый газировка', v:VENDING.length, vn:VN(VENDING), hd:true}, (g, v)=>vendingDraw(g, PV(VENDING, v)));

  /* ===================== БЫТ И ОБЩЕСТВЕННЫЕ МЕСТА ===================== */
  /* ---- Быт и предметы интерьера (HD): общие заготовки мебели и мелочей ---- */
  const fx = {
    sh(k, x, y, w, h, r, d){ d = d || 0.05; k.rr(x + d*0.8, y + d, w, h, r); k.fill('rgba(0,0,0,.35)'); },
    wood(k, x, y, w, h, col, r, ang){ fx.sh(k, x, y, w, h, r || 0.02); const c = k.c; c.save(); k.rr(x, y, w, h, r || 0.02); c.clip(); if(ang){ c.translate(x + w/2, y + h/2); c.rotate(ang); c.beginPath(); c.rect(-w - h, -w - h, (w + h)*2, (w + h)*2); k.texFill('wood', '#6b5236', col, 0.45); } else { c.beginPath(); c.rect(x, y, w, h); k.texFill('wood', '#6b5236', col, 0.45); } c.restore(); k.rr(x, y, w, h, r || 0.02); k.stroke(k.INK, 0.01); k.bevel(()=>k.rr(x, y, w, h, r || 0.02), 0.015); },
    cushion(k, x, y, w, h, col, opt){ opt = opt || {}; const c = k.c, r = Math.min(w, h)*0.22; k.rr(x, y, w, h, r); c.fillStyle = k.lin(x, y, x + w, y + h, [[0, shade(col, 0.18)], [0.5, col], [1, shade(col, -0.32)]]); c.fill(); c.save(); k.rr(x, y, w, h, r); c.clip(); k.radial(x + w*0.38, y + h*0.35, Math.max(w, h)*0.6, '#fff8ea', 0.16);
      if(opt.tuft) for(let i=1;i<=opt.tuft;i++) for(let j=1;j<=Math.max(1, Math.round(opt.tuft*h/w));j++){ const px = x + w*i/(opt.tuft + 1), py = y + h*j/(Math.max(1, Math.round(opt.tuft*h/w)) + 1); k.radial(px, py, Math.min(w, h)*0.18, '#000000', 0.22); c.beginPath(); c.arc(px, py, 0.012, 0, 6.28); k.fill(shade(col, -0.4)); }
      for(let i=0;i<(opt.wear || 2);i++) k.radial(x + k.R(0.2, 0.8)*w, y + k.R(0.2, 0.8)*h, Math.min(w, h)*k.R(0.15, 0.3), shade(col, 0.35), 0.28);
      for(let i=0;i<(opt.stains || 1);i++){ const sx = x + k.R(0.2, 0.8)*w, sy = y + k.R(0.2, 0.8)*h, sr = Math.min(w, h)*k.R(0.08, 0.16); k.organic(sx, sy, sr, 0.22); k.fill('#5a4630', 0.16); k.organic(sx, sy, sr, 0.22); k.stroke('rgba(70,50,30,.28)', sr*0.08); }
      if(opt.torn){ const tx = x + w*k.R(0.3, 0.7), ty = y + h*k.R(0.3, 0.7); k.organic(tx, ty, Math.min(w, h)*0.22, 0.6); k.fill('#d8c890'); k.organic(tx, ty, Math.min(w, h)*0.22, 0.6); k.stroke(shade(col, -0.4), 0.01); for(let i=0;i<4;i++){ c.beginPath(); c.arc(tx + k.R(-0.05, 0.05), ty + k.R(-0.05, 0.05), 0.012, 0, 6.28); k.fill('#c8b878'); } }
      c.restore(); k.rr(x, y, w, h, r); k.stroke('rgba(10,8,6,.5)', 0.01); k.rr(x + 0.025, y + 0.025, w - 0.05, h - 0.05, r*0.8); k.stroke('rgba(0,0,0,.18)', 0.005, null); },
    enamel(k, x, y, w, h, col, r){ fx.sh(k, x, y, w, h, r || 0.04); const c = k.c; k.rr(x, y, w, h, r || 0.04); c.fillStyle = k.lin(x, y, x + w, y + h, [[0, shade(col, 0.15)], [1, shade(col, -0.25)]]); c.fill(); k.stroke(k.INK, 0.01); c.save(); k.rr(x, y, w, h, r || 0.04); c.clip(); for(let i=0;i<7;i++){ const cx = x + k.R(0.06, 0.94)*w, cy = y + (k.rnd() < 0.5 ? k.R(0.02, 0.1) : k.R(0.9, 0.98))*h, cr = k.R(0.006, 0.016); k.organic(cx, cy, cr, 0.3); k.fill('#3a3430', 0.85); k.organic(cx - cr*0.2, cy - cr*0.2, cr*1.3, 0.3); k.stroke('rgba(255,255,255,.4)', cr*0.25); } k.radial(x + w*0.3, y + h*0.25, Math.max(w, h)*0.5, '#ffffff', 0.18); for(let i=0;i<2;i++) k.rust(x + k.R(0.1, 0.9)*w, y + k.R(0.6, 0.95)*h, 0.03, false); c.restore(); },
    book(k, x, y, w, h, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-w/2 + 0.01, -h/2 + 0.015, w, h, 0.006); k.fill('rgba(0,0,0,.3)'); k.rr(-w/2, -h/2, w, h, 0.006); k.fill(k.pick(['#6a2a24', '#2a4a5a', '#4a5a2a', '#7a6a3a', '#3a3030', '#8a7a5a'])); k.stroke('rgba(0,0,0,.4)', 0.004); k.line([-w/2 + 0.008, -h/2 + 0.01, -w/2 + 0.008, h/2 - 0.01], 'rgba(255,240,200,.25)', 0.005); c.fillStyle = '#e4dcc4'; c.fillRect(w/2 - 0.012, -h/2 + 0.008, 0.008, h - 0.016); c.restore(); },
    spines(k, x, y, w, h, n, lean){ let px = x; for(let i=0;i<n && px < x + w - 0.02;i++){ const bw = k.R(0.025, 0.05); if(lean && i===n - 1){ fx.book(k, px + h/2, y + h/2, bw, h*0.9, 0.5); break; } k.rr(px, y + k.R(0, 0.03), bw, h - k.R(0, 0.04), 0.004); k.fill(k.pick(['#6a2a24', '#2a4a5a', '#4a5a2a', '#7a6a3a', '#3a3030', '#8a7a5a', '#5a3a5a'])); k.stroke('rgba(0,0,0,.45)', 0.003); k.line([px + bw*0.3, y + 0.03, px + bw*0.3, y + h - 0.03], 'rgba(255,240,200,.25)', 0.004); px += bw + 0.004; } },
    plate(k, x, y, r, food){ const c = k.c; c.beginPath(); c.arc(x + r*0.15, y + r*0.2, r, 0, 6.28); k.fill('rgba(0,0,0,.25)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#f0ece2'], [1, '#bab4a6']]); c.fill(); k.stroke('rgba(0,0,0,.35)', r*0.06); c.beginPath(); c.arc(x, y, r*0.65, 0, 6.28); k.stroke('rgba(0,0,0,.12)', r*0.05); if(food) k.blot(x, y, r*0.45, k.pick(['#6a4a2a', '#8a6a3a', '#5a6a3a']), 0.85, 0.5); },
    cup(k, x, y, r){ const c = k.c; c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); k.fill('#d8d2c4'); k.stroke('rgba(0,0,0,.4)', r*0.1); c.beginPath(); c.arc(x, y, r*0.75, 0, 6.28); k.fill('#3a2416'); c.beginPath(); c.arc(x + r*1.1, y, r*0.35, -1.2, 1.2); k.stroke('#d8d2c4', r*0.18); },
    bottle(k, x, y, a, col){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-0.05 + 0.01, -0.022 + 0.015, 0.1, 0.044, 0.02); k.fill('rgba(0,0,0,.3)'); k.rr(-0.05, -0.022, 0.08, 0.044, 0.02); k.fill(col || 'rgba(60,90,50,.85)'); k.rr(0.028, -0.01, 0.03, 0.02, 0.006); k.fill(col || 'rgba(60,90,50,.85)'); k.line([-0.04, -0.012, 0.02, -0.012], 'rgba(255,255,255,.45)', 0.006); c.restore(); },
    can(k, x, y, r, col){ const c = k.c; c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#d8dcde'], [1, '#6a6e70']]); c.fill(); k.stroke('rgba(0,0,0,.4)', r*0.1); c.beginPath(); c.arc(x, y, r*0.8, 0, 6.28); k.stroke(col || '#8a3a2e', r*0.25); c.beginPath(); c.arc(x + r*0.3, y - r*0.2, r*0.15, 0, 6.28); k.fill('#3a3836'); },
    candle(k, x, y, r, lit){ const c = k.c; if(lit) k.radial(x, y, r*7, '#f0b050', 0.3); c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); k.fill('#e8dcb8'); k.stroke('rgba(0,0,0,.3)', r*0.1); k.blot(x + r*0.6, y + r*0.3, r*0.5, '#d8c8a0', 0.9); if(lit){ c.beginPath(); c.arc(x, y, r*0.35, 0, 6.28); k.fill('#fff0b0'); k.radial(x, y, r*1.6, '#ffd070', 0.7); } else { c.beginPath(); c.arc(x, y, r*0.15, 0, 6.28); k.fill('#1a1612'); } },
    paper(k, x, y, w, h, a, lines){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-w/2 + 0.01, -h/2 + 0.015, w, h, 0.004); k.fill('rgba(0,0,0,.25)'); k.rr(-w/2, -h/2, w, h, 0.004); k.fill(k.pick(['#e4dcc8', '#d8d0bc', '#ece6d6'])); k.stroke('rgba(0,0,0,.2)', 0.003); for(let i=0;i<(lines || 5);i++) k.line([-w/2 + 0.015, -h/2 + 0.02 + i*(h - 0.04)/(lines || 5), w/2 - 0.015 - k.R(0, w*0.3), -h/2 + 0.02 + i*(h - 0.04)/(lines || 5)], 'rgba(40,36,30,.4)', 0.004); c.restore(); },
    chair(k, x, y, a, kind, col){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); col = col || '#6b5236';
      if(kind==='office'){ for(let i=0;i<5;i++){ const an = i/5*6.28; k.line([0, 0, Math.cos(an)*0.24, Math.sin(an)*0.24], '#2a2826', 0.03); c.beginPath(); c.arc(Math.cos(an)*0.24, Math.sin(an)*0.24, 0.03, 0, 6.28); k.fill('#1a1816'); } fx.cushion(k, -0.17, -0.15, 0.34, 0.32, '#2e3236', {wear:2}); fx.cushion(k, -0.17, -0.24, 0.34, 0.1, '#26292c', {wear:1}); }
      else if(kind==='plastic'){ k.rr(-0.16 + 0.02, -0.16 + 0.03, 0.32, 0.32, 0.06); k.fill('rgba(0,0,0,.3)'); k.rr(-0.16, -0.16, 0.32, 0.32, 0.06); c.fillStyle = k.lin(-0.16, -0.16, 0.16, 0.16, [[0, shade(col, 0.2)], [1, shade(col, -0.3)]]); c.fill(); k.stroke(k.INK, 0.008); for(let i=0;i<4;i++) k.line([-0.1 + i*0.065, -0.12, -0.1 + i*0.065, 0.12], 'rgba(0,0,0,.2)', 0.012); k.rr(-0.16, -0.2, 0.32, 0.07, 0.03); k.fill(shade(col, -0.15)); k.stroke(k.INK, 0.008); }
      else { [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]].forEach(([lx, ly])=>{ c.fillStyle = '#2a1e14'; c.fillRect(lx - 0.025, ly - 0.025, 0.05, 0.05); }); fx.wood(k, -0.17, -0.15, 0.34, 0.32, col, 0.02); fx.wood(k, -0.17, -0.22, 0.34, 0.07, shade(col, -0.15), 0.01); }
      c.restore(); },
    blanket(k, pts, col){ bits.fabric(k, pts, col, 5, 'h'); },
    springs(k, x, y, w, h){ const c = k.c; for(let i=0;i<Math.round(w/0.12);i++) for(let j=0;j<Math.round(h/0.12);j++){ const px = x + 0.06 + i*0.12, py = y + 0.06 + j*0.12; c.beginPath(); c.arc(px, py, 0.04, 0, 6.28); k.stroke('#6a6e70', 0.008); c.beginPath(); c.arc(px, py, 0.025, 0, 6.28); k.stroke('#4a4e50', 0.006); } },
  };
  /* ---- Быт ---- */
  function bedDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.08, 0.06, 0.84, 1.88, d.frame || '#5a4030', 0.03);
    if(d.rotten){ k.rr(0.14, 0.14, 0.72, 1.72, 0.03); k.fill('#2a2420'); fx.springs(k, 0.15, 0.2, 0.7, 1.6); fx.cushion(k, 0.2, 0.7, 0.55, 0.9, '#8a7a5a', {torn:true, stains:4, wear:1}); k.plank(0.5, 1.92, 0.7, 0.08, 0.15, '#4a3624', true); for(let i=0;i<4;i++) k.moss(k.R(0.2, 0.8), k.R(0.3, 1.7), 0.08); return; }
    fx.cushion(k, 0.14, 0.12, 0.72, 1.76, d.sheet || '#c9c1a8', {wear:2, stains:d.stains || 1});
    fx.cushion(k, 0.2, 0.18, 0.6, 0.3, '#ddd6c4', {tuft:0, wear:1, stains:d.stains ? 2 : 0});
    if(d.blanket){ const P = d.messy ? [0.12, 0.62, 0.88, 0.75, 0.9, 1.88, 0.3, 1.9, 0.08, 1.4] : [0.12, 0.85, 0.88, 0.85, 0.88, 1.86, 0.12, 1.86]; bits.fabric(k, P, d.blanket, d.messy ? 7 : 4, d.messy ? 'v' : 'h'); if(!d.messy){ k.rr(0.12, 0.82, 0.76, 0.1, 0.02); k.fill(shade(d.blanket, 0.25)); k.stroke('rgba(0,0,0,.3)', 0.006); } }
    if(d.items){ fx.book(k, 0.75, 0.5, 0.1, 0.14, 0.4); xb.bedroll(k, 0.3, 1.95, 0, '#4a5a3a'); }
    k.rr(0.08, 0.04, 0.84, 0.08, 0.02); k.texFill('wood', '#5a4030', d.frame, 0.4); k.stroke(k.INK, 0.008); }
  const BED = [{n:'Застелена', blanket:'#5a6a7a'}, {n:'Разворошена', blanket:'#7a4a3a', messy:true, items:true}, {n:'Голый матрас в пятнах', stains:5}, {n:'Сгнила, пружины наружу', rotten:true, frame:'#4a3a2c'}];
  function bunkDraw(g, d){ const k = hk(g), c = k.c;
    [[0.1, 0.05], [0.9, 0.05], [0.1, 1.95], [0.9, 1.95]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#3a3e40'); });
    k.rr(0.08, 0.04, 0.84, 1.92, 0.03); k.stroke('#4a4e50', 0.04); k.rr(0.08, 0.04, 0.84, 1.92, 0.03); k.stroke('rgba(255,255,255,.2)', 0.01);
    if(d.broken){ k.rr(0.13, 0.1, 0.74, 1.8, 0.02); k.fill('#1e1c1a'); fx.springs(k, 0.14, 0.12, 0.72, 1.76); fx.cushion(k, 0.2, 0.5, 0.6, 0.8, '#5a5a48', {torn:true, stains:3}); k.line([0.13, 1.2, 0.87, 1.5], '#4a4e50', 0.03); }
    else { fx.cushion(k, 0.13, 0.09, 0.74, 1.82, '#6a6a54', {wear:2, stains:2}); fx.cushion(k, 0.18, 0.14, 0.64, 0.26, '#c9c1a8', {wear:1}); bits.fabric(k, [0.13, 0.8, 0.87, 0.8, 0.87, 1.88, 0.13, 1.88], '#4a5236', 4, 'h'); k.rr(0.13, 0.78, 0.74, 0.08, 0.01); k.fill('#d8d0b8'); }
    if(d.stuff){ xb.jerry(k, 0.75, 1.6, 0.4, '#4a5a34'); for(let i=0;i<2;i++){ k.rr(0.25 + i*0.12, 1.92, 0.09, 0.08, 0.02); k.fill('#2a2018'); } k.rr(0.5, 0.45, 0.3, 0.2, 0.03); k.fill('#5a5a3e'); k.stroke(k.INK, 0.006); }
    for(let i=0;i<4;i++) k.line([0.88, 0.5 + i*0.12, 0.98, 0.5 + i*0.12], '#5a5e60', 0.016); k.line([0.98, 0.42, 0.98, 0.9], '#4a4e50', 0.02); }
  const BUNK = [{n:'Армейская'}, {n:'С вещами', stuff:true}, {n:'Сломанная', broken:true}];
  function sofaDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    fx.sh(k, 0.06, 0.1, 1.88, 0.82, 0.12, 0.07);
    fx.cushion(k, 0.06, 0.1, 1.88, 0.3, shade(col, -0.12), {wear:2, stains:1, tuft:d.leather ? 6 : 0});
    fx.cushion(k, 0.06, 0.1, 0.22, 0.82, shade(col, -0.05), {wear:1}); fx.cushion(k, 1.72, 0.1, 0.22, 0.82, shade(col, -0.05), {wear:1});
    [[0.28, 0.72], [1.0, 0.72]].forEach(([x], i)=>fx.cushion(k, x, 0.38, 0.72, 0.52, col, {wear:3, stains:2, torn:d.torn && i===1}));
    if(d.leather){ c.save(); k.rr(0.06, 0.1, 1.88, 0.82, 0.12); c.clip(); for(let i=0;i<14;i++) k.line([k.R(0.1, 1.9), k.R(0.1, 0.9), k.R(0.1, 1.9), k.R(0.1, 0.9)], 'rgba(230,210,180,.25)', 0.004); c.restore(); }
    if(d.torn){ for(let i=0;i<4;i++){ c.beginPath(); c.arc(k.R(1.1, 1.6), k.R(0.45, 0.85), 0.04, 0, 6.28); k.stroke('#6a6e70', 0.008); } }
    if(d.plaid){ bits.fabric(k, [0.35, 0.3, 1.0, 0.35, 0.95, 0.92, 0.3, 0.9], '#7a3a2e', 3, 'v'); c.save(); k.poly([0.35, 0.3, 1.0, 0.35, 0.95, 0.92, 0.3, 0.9]); c.clip(); for(let i=0;i<8;i++){ k.line([0.3 + i*0.09, 0.3, 0.3 + i*0.09, 0.95], 'rgba(220,200,150,.35)', 0.012); k.line([0.3, 0.33 + i*0.08, 1.0, 0.33 + i*0.08], 'rgba(220,200,150,.3)', 0.012); } c.restore(); } }
  const SOFA = [{n:'Тканевый', col:'#5a6a4a'}, {n:'Кожаный, потёртый', col:'#6a4030', leather:true}, {n:'Рваный, пружины', col:'#7a6a5a', torn:true}, {n:'С пледом', col:'#4a5a6a', plaid:true}];
  function diningDraw(g, d){ const k = hk(g), c = k.c;
    if(d.flipped){ c.save(); c.translate(1, 1); c.rotate(0.3); fx.wood(k, -0.75, -0.5, 1.5, 1.0, '#5a4030', 0.03); [[-0.65, -0.4], [0.65, -0.4], [-0.65, 0.4], [0.65, 0.4]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#3a2a1c'); k.stroke(k.INK, 0.006); k.line([x, y, x + 0.05, y + 0.06], '#2a1e14', 0.05); }); c.restore(); fx.chair(k, 0.3, 1.75, 2.0, 'wood'); fx.chair(k, 1.75, 0.4, -0.6, 'wood'); for(let i=0;i<3;i++){ fx.plate(k, k.R(0.2, 1.8), k.R(1.5, 1.9), 0.08, false); } k.trash(0, 0, 2, 2, 8); return; }
    [[1, 0.2, 0], [1, 1.8, Math.PI], [0.2, 1, -Math.PI/2], [1.8, 1, Math.PI/2]].forEach(([x, y, a], i)=>{ if(d.empty && i===3) return; fx.chair(k, x, y, a, 'wood', '#6b5236'); });
    fx.wood(k, 0.35, 0.4, 1.3, 1.2, '#5e4630', 0.03);
    if(d.set){ [[0.7, 0.7], [1.3, 0.7], [0.7, 1.3], [1.3, 1.3]].forEach(([x, y])=>fx.plate(k, x, y, 0.13, true)); fx.cup(k, 0.9, 0.95, 0.05); fx.bottle(k, 1.05, 1.05, 0.7); fx.candle(k, 1.0, 1.0, 0.03, true); }
    if(d.map){ fx.paper(k, 1.0, 1.0, 0.7, 0.5, 0.1, 0); c.save(); c.translate(1.0, 1.0); c.rotate(0.1); for(let i=0;i<6;i++) k.line([k.R(-0.3, 0.3), k.R(-0.2, 0.2), k.R(-0.3, 0.3), k.R(-0.2, 0.2)], 'rgba(120,60,40,.6)', 0.006); c.beginPath(); c.arc(0.1, -0.05, 0.06, 0, 6.28); k.stroke('#8e2e26', 0.008); c.restore(); fx.candle(k, 0.55, 0.6, 0.035, true); fx.cup(k, 1.45, 1.35, 0.05); }
    if(!d.set && !d.map){ k.blot(1.0, 1.0, 0.2, '#3a2a1c', 0.25); k.leaves(0.4, 0.45, 1.2, 1.1, 6); } }
  const DINING = [{n:'Накрыт', set:true}, {n:'Пустой', empty:true}, {n:'Перевёрнут', flipped:true}, {n:'С картой и свечой', map:true}];
  function chairDraw(g, d){ const k = hk(g), c = k.c; if(d.fallen){ c.save(); c.translate(0.5, 0.5); c.rotate(1.2); fx.wood(k, -0.18, -0.08, 0.36, 0.3, '#6b5236', 0.02); [[-0.14, -0.12], [0.14, -0.12]].forEach(([x, y])=>k.line([x, y, x, y - 0.18], '#3a2a1c', 0.045)); fx.wood(k, -0.18, 0.18, 0.36, 0.08, '#5a4430', 0.01); c.restore(); return; } fx.chair(k, 0.5, 0.52, d.a || 0.15, d.kind, d.col); }
  const CHAIR = [{n:'Деревянный', kind:'wood', col:'#6b5236'}, {n:'Офисный', kind:'office', a:0.6}, {n:'Пластиковый', kind:'plastic', col:'#c9c1a8'}, {n:'Опрокинут', fallen:true}];
  function wardrobeDraw(g, d){ const k = hk(g), c = k.c;
    if(d.fallen){ c.save(); c.translate(1, 0.5); c.rotate(0.12); fx.wood(k, -0.95, -0.42, 1.9, 0.84, '#5a4030', 0.02); k.line([0, -0.42, 0, 0.42], 'rgba(0,0,0,.5)', 0.012); [[-0.1, 0], [0.1, 0]].forEach(([x])=>{ k.rr(x - 0.02, -0.08, 0.04, 0.16, 0.01); k.fill('#8a7a5a'); }); for(let i=0;i<3;i++) k.dent(k.R(-0.7, 0.7), k.R(-0.3, 0.3), 0.1); c.restore(); k.trash(0, 0.8, 2, 0.2, 5); return; }
    fx.wood(k, 0.06, 0.15, 1.88, 0.7, '#5a4030', 0.02); k.rr(0.1, 0.19, 1.8, 0.62, 0.015); k.stroke('rgba(0,0,0,.25)', 0.008);
    if(d.open){ k.rr(0.12, 0.2, 1.76, 0.6, 0.01); k.fill('#1e1a16'); k.line([0.15, 0.4, 1.85, 0.4], '#6a6e70', 0.014); for(let i=0;i<9;i++){ const x = 0.25 + i*0.18; k.line([x, 0.4, x, 0.42], '#8a8e90', 0.006); c.save(); c.translate(x, 0.55); k.rr(-0.07, -0.13, 0.14, 0.32, 0.03); k.fill(k.pick(['#4a5a6a', '#6a3a2e', '#5a5a48', '#7a6a5a', '#2a2a2a'])); k.stroke('rgba(0,0,0,.4)', 0.005); c.restore(); }
      [[0.06, -1], [1.94, 1]].forEach(([x, s])=>{ c.save(); c.translate(x, 0.85); c.rotate(s*0.9); fx.wood(k, s > 0 ? 0 : -0.94, -0.03, 0.94, 0.05, '#5e4430', 0.01); c.restore(); }); }
    else { k.line([1, 0.2, 1, 0.8], 'rgba(0,0,0,.45)', 0.012); [[0.94, 0.5], [1.06, 0.5]].forEach(([x, y])=>{ k.rr(x - 0.015, y - 0.07, 0.03, 0.14, 0.01); k.fill('#8a7a5a'); }); k.rr(0.25, 0.3, 0.5, 0.4, 0.01); k.stroke('rgba(0,0,0,.18)', 0.008); k.rr(1.25, 0.3, 0.5, 0.4, 0.01); k.stroke('rgba(0,0,0,.18)', 0.008); if(d.box){ houseBits.crate(k, 1.5, 0.45, 0.4, 0.3, 0.1); fx.paper(k, 0.5, 0.45, 0.3, 0.2, -0.2); } } }
  const WARDROBE = [{n:'Закрыт', box:true}, {n:'Открыт, одежда', open:true}, {n:'Упал', fallen:true}];
  function stoveDraw(g, d){ const k = hk(g), c = k.c;
    if(d.burzhuika){ c.beginPath(); c.arc(0.5 + 0.05, 0.55 + 0.06, 0.32, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(0.5, 0.55, 0.32, 0, 6.28); k.texFill('rust', '#4a3a30', '#2a2624', 0.5); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(0.5, 0.55, 0.18, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.012); c.beginPath(); c.arc(0.5, 0.55, 0.08, 0, 6.28); k.fill('#141210'); k.radial(0.5, 0.55, 0.25, '#e07a2a', 0.35); k.line([0.62, 0.38, 0.78, 0.12, 0.78, 0.02], '#2a2826', 0.08); k.line([0.62, 0.38, 0.78, 0.12, 0.78, 0.02], 'rgba(255,255,255,.12)', 0.015); fx.pot(k, 0.42, 0.5, 0.1); for(let i=0;i<3;i++) k.plank(0.15 + i*0.06, 0.88, 0.25, 0.06, 0.1, '#5e4630', false); return; }
    fx.enamel(k, 0.1, 0.1, 0.8, 0.8, d.col, 0.04); [[0.32, 0.32], [0.68, 0.32], [0.32, 0.66], [0.68, 0.66]].forEach(([x, y], i)=>{ c.beginPath(); c.arc(x, y, 0.13, 0, 6.28); k.fill('#1e1c1a'); for(let j=0;j<6;j++){ const a = j/6*6.28; k.line([x, y, x + Math.cos(a)*0.12, y + Math.sin(a)*0.12], '#4a4844', 0.012); } c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#3a3836'); });
    k.rr(0.1, 0.84, 0.8, 0.06, 0.01); k.fill('#2a2826'); for(let i=0;i<4;i++){ c.beginPath(); c.arc(0.22 + i*0.18, 0.87, 0.022, 0, 6.28); k.fill('#c8c4b8'); }
    if(d.dirty){ fx.pot(k, 0.32, 0.32, 0.12); k.blot(0.66, 0.66, 0.12, '#3a2a14', 0.5); k.radial(0.5, 0.5, 0.4, '#2a2014', 0.3); } }
  fx.pot = (k, x, y, r)=>xb.pot(k, x, y, r);
  const STOVE = [{n:'Эмалированная', col:'#d8d2c4'}, {n:'Грязная, с кастрюлей', col:'#b8a888', dirty:true}, {n:'Буржуйка', burzhuika:true}];
  function fridgeDraw(g, d){ const k = hk(g), c = k.c;
    if(d.fallen){ c.save(); c.translate(0.5, 0.5); c.rotate(0.5); fx.enamel(k, -0.3, -0.42, 0.6, 0.84, '#c8c2b0', 0.06); k.line([-0.3, 0.05, 0.3, 0.05], 'rgba(0,0,0,.4)', 0.01); for(let i=0;i<5;i++) k.rust(k.R(-0.25, 0.25), k.R(-0.35, 0.35), k.R(0.03, 0.07), false); c.restore(); return; }
    fx.enamel(k, 0.12, 0.12, 0.76, 0.76, '#d0cabc', 0.05); for(let i=0;i<6;i++) k.line([0.25, 0.22 + i*0.03, 0.75, 0.22 + i*0.03], 'rgba(0,0,0,.3)', 0.008); k.rr(0.2, 0.7, 0.6, 0.1, 0.01); k.stroke('rgba(0,0,0,.25)', 0.006);
    if(d.open){ c.save(); c.translate(0.88, 0.88); c.rotate(0.9); fx.enamel(k, -0.76, -0.04, 0.76, 0.07, '#c8c2b0', 0.01); c.restore(); k.rr(0.12, 0.84, 0.76, 0.06, 0.01); k.fill('#1a1814'); fx.bottle(k, 0.45, 0.94, 0, 'rgba(160,140,60,.8)'); }
    fx.paper(k, 0.35, 0.45, 0.15, 0.12, 0.2, 3); c.beginPath(); c.arc(0.65, 0.45, 0.03, 0, 6.28); k.fill('#8e2e26'); }
  const FRIDGE = [{n:'Старый белый'}, {n:'Дверь распахнута', open:true}, {n:'Лежит, ржавый', fallen:true}];
  function sinkDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.05, 0.12, 0.9, 0.76, '#7a7268', 0.02); k.rr(0.05, 0.12, 0.9, 0.76, 0.02); k.texFill('tiles', '#bab4a5'); k.stroke(k.INK, 0.01);
    if(d.broken){ k.organic(0.5, 0.5, 0.25, 0.4, 0.18); k.fill('#1a1612'); for(let i=0;i<6;i++){ const x = k.R(0.25, 0.75), y = k.R(0.3, 0.7); k.fillP([x, y, x + 0.06, y + 0.02, x + 0.02, y + 0.06], '#d8d2c6'); } k.puddle(0.7, 0.85, 0.14, 0.08); return; }
    k.rr(0.25, 0.28, 0.5, 0.42, 0.12); c.fillStyle = k.lin(0, 0.28, 0, 0.7, [[0, '#9a968c'], [0.5, '#e4e0d4'], [1, '#c8c2b4']]); c.fill(); k.stroke('rgba(0,0,0,.4)', 0.01); c.beginPath(); c.arc(0.5, 0.55, 0.03, 0, 6.28); k.fill('#3a3836');
    k.line([0.5, 0.16, 0.5, 0.36], '#8a9094', 0.035); k.line([0.49, 0.16, 0.49, 0.35], 'rgba(255,255,255,.4)', 0.008); [[0.38, 0.18], [0.62, 0.18]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#9aa0a2'); k.stroke(k.INK, 0.005); }); k.rust(0.5, 0.62, 0.04, false);
    if(d.dishes){ fx.plate(k, 0.42, 0.48, 0.1, true); fx.plate(k, 0.55, 0.52, 0.09, false); fx.cup(k, 0.82, 0.3, 0.05); fx.cup(k, 0.15, 0.8, 0.05); } }
  const SINK = [{n:'Чистая'}, {n:'С грязной посудой', dishes:true}, {n:'Разбита', broken:true}];
  function toiletDraw(g, d){ const k = hk(g), c = k.c;
    fx.enamel(k, 0.28, 0.1, 0.44, 0.22, '#d8d2c4', 0.04); c.beginPath(); c.ellipse(0.5 + 0.03, 0.56 + 0.04, 0.2, 0.28, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)');
    if(d.broken){ k.organic(0.5, 0.58, 0.2, 0.5, 0.25); k.fill('#d0c8b8'); k.organic(0.5, 0.58, 0.12, 0.5, 0.16); k.fill('#2a2420'); for(let i=0;i<5;i++) k.chunk(k.R(0.2, 0.8), k.R(0.55, 0.95), 0.05, '#d8d2c6', 0.01); k.puddle(0.6, 0.85, 0.15, 0.08); return; }
    c.beginPath(); c.ellipse(0.5, 0.56, 0.2, 0.28, 0, 0, 6.28); c.fillStyle = k.lin(0.3, 0.3, 0.7, 0.85, [[0, '#ece6da'], [1, '#b4ae9e']]); c.fill(); k.stroke('rgba(0,0,0,.4)', 0.01); c.beginPath(); c.ellipse(0.5, 0.6, 0.12, 0.17, 0, 0, 6.28); k.fill(d.dirty ? '#5a4a2a' : '#7a9aa0'); c.beginPath(); c.ellipse(0.5, 0.56, 0.2, 0.28, 0, 0, 6.28); k.stroke(d.dirty ? '#5a4a3a' : '#c8c2b4', 0.04);
    if(d.dirty){ k.blot(0.4, 0.4, 0.06, '#6a5a3a', 0.6); k.trash(0.1, 0.7, 0.8, 0.25, 4); } k.rr(0.42, 0.12, 0.16, 0.04, 0.01); k.fill('#9aa0a2'); }
  const TOILET = [{n:'Чистый'}, {n:'Грязный', dirty:true}, {n:'Разбит', broken:true}];
  function showerDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.06, 0.06, 0.88, 0.88, 0.03); k.texFill('tiles', '#bab4a5', d.dirty ? '#7a7a5a' : null, 0.3); k.stroke(k.INK, 0.012); k.rr(0.12, 0.12, 0.76, 0.76, 0.06); c.fillStyle = k.lin(0, 0.12, 0, 0.88, [[0, '#9a968c'], [0.5, '#e0dcd0'], [1, '#c4beb0']]); c.fill(); k.stroke('rgba(0,0,0,.35)', 0.01);
    c.beginPath(); c.arc(0.5, 0.5, 0.05, 0, 6.28); k.fill('#5a5e60'); for(let i=0;i<6;i++){ const a = i/6*6.28; c.beginPath(); c.arc(0.5 + Math.cos(a)*0.025, 0.5 + Math.sin(a)*0.025, 0.006, 0, 6.28); k.fill('#1a1816'); }
    c.beginPath(); c.arc(0.85, 0.15, 0.06, 0, 6.28); k.fill('#9aa0a2'); k.stroke(k.INK, 0.006);
    if(d.dirty){ for(let i=0;i<4;i++) k.blot(k.R(0.2, 0.8), k.R(0.2, 0.8), k.R(0.05, 0.12), '#5a5a3a', 0.4); k.moss(0.2, 0.8, 0.08); }
    if(d.curtain){ c.beginPath(); c.moveTo(0.08, 0.92); for(let i=0;i<=8;i++) c.lineTo(0.08 + i*0.1, 0.92 + (i%2 ? 0.04 : -0.02)); c.lineTo(0.88, 0.97); c.lineTo(0.08, 0.97); c.closePath(); k.fill(d.dirty ? '#7a7a5a' : '#6a8a9a', 0.85); k.line([0.06, 0.93, 0.94, 0.93], '#9aa0a2', 0.012); } }
  const SHOWER = [{n:'Со шторкой', curtain:true}, {n:'Без шторки'}, {n:'Грязная, плесень', dirty:true, curtain:true}];
  function tubDraw(g, d){ const k = hk(g), c = k.c;
    fx.enamel(k, 0.08, 0.08, 0.84, 1.84, d.rusty ? '#b8ae9a' : '#d8d2c4', 0.2); k.rr(0.17, 0.18, 0.66, 1.64, 0.16); c.fillStyle = k.lin(0.17, 0, 0.83, 0, [[0, '#a8a296'], [0.5, '#e4e0d4'], [1, '#b4ae9e']]); c.fill(); k.stroke('rgba(0,0,0,.35)', 0.01);
    if(d.water){ k.rr(0.2, 0.4, 0.6, 1.38, 0.14); c.fillStyle = k.lin(0, 0.4, 0, 1.8, [[0, 'rgba(90,100,70,.85)'], [1, 'rgba(60,70,50,.9)']]); c.fill(); for(let i=0;i<5;i++) k.line([0.25, 0.6 + i*0.25, 0.75, 0.62 + i*0.25], 'rgba(220,230,210,.18)', 0.006); k.blot(0.5, 1.2, 0.15, '#8a8a5a', 0.4); }
    if(d.rusty){ for(let i=0;i<8;i++) k.rust(k.R(0.2, 0.8), k.R(0.25, 1.75), k.R(0.03, 0.09), false); k.streak(0.5, 1.6, 0.25, 0.08, '#6a3a1e', 0.4); }
    c.beginPath(); c.arc(0.5, 1.72, 0.03, 0, 6.28); k.fill('#3a3836'); k.line([0.5, 0.1, 0.5, 0.26], '#8a9094', 0.035); [[0.38, 0.14], [0.62, 0.14]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#9aa0a2'); }); }
  const TUB = [{n:'Пустая'}, {n:'Мутная вода', water:true}, {n:'Ржавая', rusty:true}];

  function monitor(k, x, y, crt, broken){ const c = k.c; if(crt){ fx.enamel(k, x - 0.2, y - 0.17, 0.4, 0.34, '#b8b2a2', 0.04); k.rr(x - 0.14, y - 0.15, 0.28, 0.08, 0.01); k.fill('#1e2224'); for(let i=0;i<4;i++) k.line([x - 0.12 + i*0.08, y + 0.05, x - 0.1 + i*0.08, y + 0.14], 'rgba(0,0,0,.3)', 0.008); }
    else { k.rr(x - 0.25 + 0.02, y - 0.04 + 0.03, 0.5, 0.06, 0.01); k.fill('rgba(0,0,0,.3)'); k.rr(x - 0.25, y - 0.04, 0.5, 0.06, 0.01); k.fill('#1e2022'); k.stroke(k.INK, 0.006); k.rr(x - 0.06, y + 0.02, 0.12, 0.1, 0.02); k.fill('#2a2c2e'); }
    if(broken) for(let i=0;i<5;i++) k.line([x, y - 0.1, x + k.R(-0.15, 0.15), y - 0.1 + k.R(-0.06, 0.06)], 'rgba(220,228,228,.5)', 0.004); }
  function keyboard(k, x, y, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-0.2 + 0.01, -0.06 + 0.015, 0.4, 0.12, 0.015); k.fill('rgba(0,0,0,.3)'); k.rr(-0.2, -0.06, 0.4, 0.12, 0.015); k.fill('#c8c2b4'); k.stroke(k.INK, 0.005); for(let j=0;j<3;j++) for(let i=0;i<12;i++){ c.fillStyle = 'rgba(40,36,30,.35)'; c.fillRect(-0.18 + i*0.03, -0.045 + j*0.03, 0.022, 0.022); } c.restore(); }
  function officeDraw(g, d){ const k = hk(g), c = k.c;
    fx.chair(k, 1.0, 0.92, Math.PI + (d.wrecked ? 0.9 : 0.1), 'office');
    fx.wood(k, 0.05, 0.08, 1.9, 0.62, d.wrecked ? '#6a6458' : '#8a8478', 0.02);
    monitor(k, 0.95, 0.27, d.crt, d.wrecked); keyboard(k, 0.95, 0.55, 0.05); c.beginPath(); c.ellipse(1.3, 0.55, 0.035, 0.05, 0, 0, 6.28); k.fill('#2a2826');
    fx.cup(k, 1.6, 0.25, 0.05); if(d.papers || d.wrecked){ for(let i=0;i<(d.wrecked ? 8 : 5);i++) fx.paper(k, k.R(0.15, 0.6), k.R(0.2, 0.6), 0.2, 0.26, k.R(-0.6, 0.6)); } else { k.rr(0.15, 0.18, 0.4, 0.3, 0.01); k.fill('#3a3634'); k.stroke(k.INK, 0.006); }
    k.c.beginPath(); k.c.moveTo(1.15, 0.3); k.c.bezierCurveTo(1.4, 0.1, 1.6, 0.6, 1.9, 0.75); k.stroke('#1a1816', 0.012);
    if(d.wrecked){ k.trash(0, 0.6, 2, 0.4, 10); k.dent(0.5, 0.4, 0.12); fx.paper(k, 1.7, 0.85, 0.22, 0.28, 0.8); } else { k.rr(1.62, 0.42, 0.25, 0.22, 0.02); k.fill('#3a3e40'); k.stroke(k.INK, 0.006); } }
  const OFFICE = [{n:'Старый ЭЛТ-монитор', crt:true}, {n:'С бумагами', papers:true}, {n:'Разгромлен', wrecked:true, crt:true}];
  function hospDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.1, 0.06, 0.8, 1.88, 0.04); k.fill('rgba(0,0,0,.3)'); k.rr(0.08, 0.04, 0.84, 1.9, 0.04); k.stroke('#8a9094', 0.04); [[0.08, 0.04], [0.92, 0.04], [0.08, 1.94], [0.92, 1.94]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#5a5e60'); });
    fx.cushion(k, 0.14, 0.12, 0.72, 1.74, '#d8d4c8', {wear:1, stains:d.blood ? 0 : 1}); fx.cushion(k, 0.2, 0.16, 0.6, 0.26, '#ece6da', {wear:1});
    bits.fabric(k, [0.13, 0.9, 0.87, 0.9, 0.87, 1.86, 0.13, 1.86], '#a8b8b8', 4, 'h');
    if(d.blood){ k.blot(0.5, 1.0, 0.22, '#5a1a14', 0.75); k.blot(0.42, 1.25, 0.12, '#6a1e18', 0.6); k.blot(0.7, 1.95, 0.1, '#4a1410', 0.7); }
    if(d.straps) [0.75, 1.3, 1.7].forEach(y=>{ k.rr(0.08, y - 0.04, 0.84, 0.08, 0.01); k.fill('#5a4030'); k.stroke(k.INK, 0.005); k.rr(0.45, y - 0.05, 0.1, 0.1, 0.01); k.stroke('#9aa0a2', 0.012); });
    [0.09, 0.91].forEach(x=>k.line([x, 0.5, x, 1.5], '#9aa0a2', 0.03));
    c.beginPath(); c.arc(0.95, 0.15, 0.05, 0, 6.28); k.fill('#5a5e60'); k.line([0.95, 0.15, 0.95, 0.15], '#5a5e60', 0.02); k.rr(0.88, 0.02, 0.14, 0.09, 0.03); k.fill('rgba(190,210,210,.75)'); k.stroke(k.INK, 0.005); c.beginPath(); c.moveTo(0.95, 0.11); c.bezierCurveTo(0.85, 0.3, 0.7, 0.3, 0.6, 0.5); k.stroke('rgba(200,210,210,.7)', 0.006); }
  const HOSP = [{n:'Чистая'}, {n:'В крови', blood:true}, {n:'С ремнями', straps:true}];
  function stretcherDraw(g, d){ const k = hk(g), c = k.c;
    if(d.tipped){ c.save(); c.translate(0.5, 1); c.rotate(0.7); k.rr(-0.32, -0.85, 0.64, 1.7, 0.04); k.stroke('#8a9094', 0.035); [[-0.32, -0.85], [0.32, -0.85], [-0.32, 0.85], [0.32, 0.85]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#1e1c1a'); }); bits.fabric(k, [-0.28, -0.8, 0.28, -0.8, 0.28, 0.8, -0.28, 0.8], '#5a6a5a', 3, 'h'); c.restore(); bits.fabric(k, [0.05, 1.5, 0.6, 1.4, 0.75, 1.95, 0.1, 1.95], '#d8d4c8', 3, 'v'); return; }
    [[0.18, 0.15], [0.82, 0.15], [0.18, 1.85], [0.82, 1.85]].forEach(([x, y])=>{ c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.06, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#1e1c1a'); });
    k.rr(0.18, 0.08, 0.64, 1.84, 0.04); k.stroke('#8a9094', 0.035); bits.fabric(k, [0.22, 0.12, 0.78, 0.12, 0.78, 1.88, 0.22, 1.88], '#5a6a5a', 4, 'h');
    if(d.body){ c.save(); k.organic(0.5, 1.0, 0.24, 0.12, 0.75); k.fill('#d8d4c8'); c.restore(); k.organic(0.5, 0.35, 0.15, 0.1, 0.13); k.fill('#d0ccc0'); bits.fabric(k, [0.27, 0.25, 0.73, 0.25, 0.75, 1.75, 0.25, 1.75], '#d8d4c8', 5, 'h'); k.blot(0.55, 0.9, 0.08, '#6a1e18', 0.5); k.line([0.5, 1.85, 0.42, 1.95], '#d8d0bc', 0.01); fx.paper(k, 0.45, 1.97, 0.1, 0.06, 0.4, 1); } }
  const STRETCHER = [{n:'Пустая'}, {n:'Тело под простынёй', body:true}, {n:'Опрокинута', tipped:true}];
  function schoolDraw(g, d){ const k = hk(g), c = k.c;
    fx.chair(k, 0.5, 0.85, Math.PI, 'wood', '#5a6a5a'); fx.wood(k, 0.12, 0.12, 0.76, 0.5, d.col || '#8a7a5a', 0.02); k.rr(0.12, 0.12, 0.76, 0.06, 0.01); k.fill('#5a5e60');
    c.save(); k.rr(0.12, 0.12, 0.76, 0.5, 0.02); c.clip(); for(let i=0;i<4;i++) k.line([k.R(0.2, 0.8), k.R(0.2, 0.55), k.R(0.2, 0.8), k.R(0.2, 0.55)], 'rgba(40,30,20,.45)', 0.005); bits.stencil(k, 0.6, 0.45, 'ВАСЯ', 0.06, '#2a2018', 0.35); c.restore();
    if(d.books){ fx.book(k, 0.35, 0.38, 0.22, 0.16, 0.2); fx.paper(k, 0.62, 0.36, 0.16, 0.2, -0.3, 6); c.beginPath(); c.moveTo(0.7, 0.5); c.lineTo(0.82, 0.55); k.stroke('#c8a030', 0.012); }
    if(d.fallen) k.trash(0, 0.6, 1, 0.4, 4); }
  const SCHOOL = [{n:'С учебниками', books:true}, {n:'Пустая'}, {n:'Исцарапанная, мусор', col:'#6a5a46', fallen:true}];
  function boardDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.05, 0.25, 2.9, 0.5, '#5a4030', 0.02); k.rr(0.12, 0.3, 2.76, 0.36, 0.01); k.fill(d.broken ? '#1e2a24' : '#2e4a3c'); c.save(); k.rr(0.12, 0.3, 2.76, 0.36, 0.01); c.clip(); k.radial(1.5, 0.45, 1.2, '#8aa898', 0.15);
      c.strokeStyle = 'rgba(230,230,220,.75)'; c.lineWidth = 0.008; c.lineCap = 'round';
      if(d.math){ c.font = '600 0.07px Arial, sans-serif'; c.fillStyle = 'rgba(230,230,220,.75)'; ['E = mc²', 'R = 6 км', '∫ f(x) dx', '3 + 2 = 5'].forEach((t, i)=>c.fillText(t, 0.25 + i*0.65, 0.42 + (i%2)*0.12)); }
      else if(d.draw){ c.beginPath(); c.arc(0.8, 0.48, 0.1, 0, 6.28); c.stroke(); c.beginPath(); c.moveTo(0.7, 0.62); c.lineTo(0.8, 0.58); c.lineTo(0.9, 0.62); c.stroke(); for(let i=0;i<4;i++){ c.beginPath(); c.moveTo(1.4 + i*0.25, 0.6); c.lineTo(1.5 + i*0.25, 0.38); c.lineTo(1.6 + i*0.25, 0.6); c.stroke(); } bits.stencil(k, 2.4, 0.45, 'НЕ ВХОДИТЬ', 0.06, 'rgba(230,200,190,.8)', 1); }
      if(d.broken){ for(let i=0;i<10;i++) k.line([1.5, 0.48, 1.5 + k.R(-0.8, 0.8), 0.48 + k.R(-0.2, 0.2)], 'rgba(0,0,0,.5)', 0.008); k.organic(1.5, 0.48, 0.12, 0.5, 0.1); k.fill('#141210'); }
    c.restore(); k.rr(0.12, 0.66, 2.76, 0.05, 0.01); k.fill('#6a5236'); for(let i=0;i<3;i++){ k.rr(0.4 + i*0.2, 0.67, 0.07, 0.025, 0.01); k.fill('#e8e4d8'); } k.rr(1.3, 0.665, 0.18, 0.04, 0.01); k.fill('#5a4a3a'); }
  const BOARD = [{n:'С формулами', math:true}, {n:'С рисунками', draw:true}, {n:'Разбитая', broken:true}];
  function receptionDraw(g, d){ const k = hk(g), c = k.c;
    if(d.barricade){ for(let i=0;i<6;i++) houseBits.sandbag(k, 0.3 + i*0.45, 0.1, 0); }
    const P = [0.05, 0.25, 2.95, 0.25, 2.95, 0.85, 2.5, 0.85, 2.5, 0.55, 0.05, 0.55]; k.fillP(P.map((v, i)=>v + (i%2 ? 0.06 : 0.05)), 'rgba(0,0,0,.35)'); k.poly(P); k.texFill('wood', '#6b5236', '#7a6a5a', 0.4); k.poly(P); k.stroke(k.INK, 0.012); k.line([0.07, 0.3, 2.9, 0.3], 'rgba(255,250,240,.3)', 0.01);
    monitor(k, 2.2, 0.68, false, d.looted); keyboard(k, 1.8, 0.7, 0.1); c.beginPath(); c.arc(0.4, 0.4, 0.05, 0, 6.28); k.fill('#c8a040'); k.stroke(k.INK, 0.005); c.beginPath(); c.arc(0.4, 0.4, 0.015, 0, 6.28); k.fill('#5a4a2a');
    if(d.looted){ for(let i=0;i<8;i++) fx.paper(k, k.R(0.2, 2.8), k.R(0.6, 0.95), 0.2, 0.26, k.R(-0.8, 0.8)); k.trash(0, 0.55, 3, 0.45, 10); } else { fx.paper(k, 1.0, 0.4, 0.3, 0.2, 0.05, 4); houseBits.bush(k, 2.75, 0.4, 0.13); c.beginPath(); c.arc(2.75, 0.4, 0.1, 0, 6.28); k.stroke('#6a4a36', 0.02); } fx.chair(k, 2.0, 0.92, Math.PI, 'office'); }
  const RECEPTION = [{n:'Стойка'}, {n:'Разграблена', looted:true}, {n:'Баррикада из стойки', barricade:true, looted:true}];
  function restTableDraw(g, d){ const k = hk(g), c = k.c;
    if(d.flipped){ c.save(); c.translate(1.05, 0.95); c.rotate(0.6); c.beginPath(); c.ellipse(0.06, 0.08, 0.6, 0.18, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(0, 0, 0.6, 0.18, 0, 0, 6.28); k.texFill('wood', '#5a4030'); k.stroke(k.INK, 0.01); k.line([0, 0, 0, 0.35], '#2a2826', 0.06); c.restore(); fx.chair(k, 0.35, 1.6, 2.4, 'wood', '#3a2a1e'); fx.chair(k, 1.7, 0.4, -0.9, 'wood', '#3a2a1e'); for(let i=0;i<5;i++){ const x = k.R(0.2, 1.8), y = k.R(1.3, 1.9); k.fillP([x, y, x + 0.06, y + 0.03, x + 0.02, y + 0.06], '#e4ded2'); } bits.fabric(k, [1.2, 1.5, 1.8, 1.35, 1.9, 1.8, 1.3, 1.95], '#d8d0c0', 3, 'v'); return; }
    [[1, 0.22, 0], [1, 1.78, Math.PI], [0.22, 1, -Math.PI/2], [1.78, 1, Math.PI/2]].forEach(([x, y, a])=>fx.chair(k, x, y, a, 'wood', '#3a2a1e'));
    c.beginPath(); c.arc(1 + 0.06, 1 + 0.08, 0.58, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(1, 1, 0.58, 0, 6.28); if(d.cloth){ c.fillStyle = k.lin(0.4, 0.4, 1.6, 1.6, [[0, '#ece6d8'], [1, '#bab2a0']]); c.fill(); k.stroke('rgba(0,0,0,.35)', 0.01); for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([1 + Math.cos(a)*0.4, 1 + Math.sin(a)*0.4, 1 + Math.cos(a)*0.58, 1 + Math.sin(a)*0.58], 'rgba(0,0,0,.1)', 0.02); } k.blot(1.2, 0.8, 0.08, '#7a3a2e', 0.4); } else { k.texFill('wood', '#5a4030'); k.stroke(k.INK, 0.01); }
    if(d.set){ [[1, 0.6], [1, 1.4], [0.6, 1], [1.4, 1]].forEach(([x, y])=>fx.plate(k, x, y, 0.12, false)); fx.candle(k, 1, 1, 0.035, true); fx.bottle(k, 1.15, 1.15, 0.8, 'rgba(90,30,30,.85)'); [[0.8, 0.75], [1.25, 1.25]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('rgba(200,210,210,.55)'); k.stroke('rgba(0,0,0,.3)', 0.004); }); } }
  const REST_TABLE = [{n:'Сервирован', cloth:true, set:true}, {n:'Пустой', cloth:true}, {n:'Опрокинут', flipped:true}];
  function lockerDraw(g, d){ const k = hk(g), c = k.c, n = 6, w = 2.9/n;
    for(let i=0;i<n;i++){ const x = 0.05 + i*w, open = d.open && (i%2===0 || i===3); fx.sh(k, x, 0.2, w - 0.02, 0.6, 0.01, 0.04); k.rr(x, 0.2, w - 0.02, 0.6, 0.01); k.texFill('metal', '#6d7376', d.col, 0.5); k.stroke(k.INK, 0.008);
      c.save(); k.rr(x, 0.2, w - 0.02, 0.6, 0.01); c.clip(); for(let j=0;j<(d.rusty ? 4 : 1);j++) k.rust(x + k.R(0.05, w - 0.05), k.R(0.25, 0.75), k.R(0.02, 0.06), false); c.restore();
      for(let j=0;j<4;j++) k.line([x + 0.06, 0.28 + j*0.035, x + w - 0.08, 0.28 + j*0.035], 'rgba(0,0,0,.4)', 0.008); c.beginPath(); c.arc(x + w - 0.08, 0.55, 0.018, 0, 6.28); k.fill('#2a2826');
      if(open){ k.rr(x + 0.02, 0.78, w - 0.06, 0.04, 0.005); k.fill('#141210'); c.save(); c.translate(x + w - 0.02, 0.8); c.rotate(0.9); k.rr(-0.02, 0, w - 0.03, 0.03, 0.005); k.texFill('metal', '#6d7376', d.col, 0.5); k.stroke(k.INK, 0.005); c.restore(); } }
    if(d.open){ k.trash(0, 0.8, 3, 0.2, 8); fx.paper(k, 1.2, 0.92, 0.18, 0.1, 0.3); } }
  const LOCKER = [{n:'Закрыты', col:'#4a5a6a'}, {n:'Вскрыты', col:'#5a6a5a', open:true}, {n:'Ржавые', col:'#6a5a4a', rusty:true}];
  function washDraw(g, d){ const k = hk(g), c = k.c;
    if(d.fallen){ c.save(); c.translate(0.5, 0.5); c.rotate(0.6); fx.enamel(k, -0.35, -0.38, 0.7, 0.76, '#c8c2b0', 0.05); c.beginPath(); c.arc(0, 0.05, 0.2, 0, 6.28); k.fill('#1e2224'); c.restore(); k.puddle(0.75, 0.85, 0.15, 0.08); return; }
    fx.enamel(k, 0.12, 0.12, 0.76, 0.76, '#dad4c6', 0.04); k.rr(0.12, 0.12, 0.76, 0.16, 0.02); k.fill('#b8b2a4'); [[0.25, 0.2], [0.45, 0.2]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#5a5e60'); k.stroke(k.INK, 0.005); }); k.rr(0.6, 0.17, 0.2, 0.06, 0.01); k.fill('#1e2420');
    c.beginPath(); c.arc(0.5, 0.58, 0.24, 0, 6.28); k.fill('#9aa0a2'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(0.5, 0.58, 0.18, 0, 6.28); c.fillStyle = k.lin(0.32, 0.4, 0.68, 0.76, [[0, '#4a5a62'], [1, '#1e2428']]); c.fill(); if(d.clothes) for(let i=0;i<4;i++) k.blot(0.5 + k.R(-0.1, 0.1), 0.58 + k.R(-0.1, 0.1), 0.06, k.pick(['#7a4a3a', '#4a5a6a', '#c9c1a8']), 0.7); c.beginPath(); c.arc(0.44, 0.52, 0.05, 0, 6.28); k.fill('rgba(255,255,255,.25)'); }
  const WASH = [{n:'Стиральная машина'}, {n:'С бельём', clothes:true}, {n:'Опрокинута', fallen:true}];
  function pantryDraw(g, d){ const k = hk(g), c = k.c;
    fx.wood(k, 0.04, 0.12, 1.92, 0.76, '#6a5a46', 0.01); for(let i=1;i<4;i++) k.line([0.04 + i*0.48, 0.12, 0.04 + i*0.48, 0.88], 'rgba(0,0,0,.4)', 0.02);
    const n = d.empty ? 6 : 26; for(let i=0;i<n;i++){ const x = k.R(0.12, 1.88), y = k.R(0.22, 0.8), t = k.rnd();
      if(d.looted && t < 0.4){ for(let j=0;j<3;j++){ const px = x + k.R(-0.05, 0.05), py = y + k.R(-0.05, 0.05); k.fillP([px, py, px + 0.04, py + 0.01, px + 0.01, py + 0.04], 'rgba(190,210,200,.6)'); } k.blot(x, y, 0.05, '#7a3a1e', 0.5); continue; }
      if(t < 0.4) fx.can(k, x, y, 0.045, k.pick(['#8a3a2e', '#3e5a6a', '#8a7a3a'])); else if(t < 0.65){ c.beginPath(); c.arc(x, y, 0.05, 0, 6.28); k.fill('rgba(190,170,110,.7)'); k.stroke('rgba(0,0,0,.4)', 0.006); c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill(k.pick(['#8a2a1e', '#6a7a2a', '#9a6a2a'])); } else if(t < 0.85) fx.bottle(k, x, y, k.R(-0.3, 0.3), k.pick(['rgba(60,90,50,.85)', 'rgba(110,70,30,.85)'])); else { k.rr(x - 0.07, y - 0.05, 0.14, 0.1, 0.01); k.fill('#a08a5a'); k.stroke(k.INK, 0.005); } }
    if(d.looted) k.trash(0, 0.85, 2, 0.15, 6); }
  const PANTRY = [{n:'Полные'}, {n:'Почти пустые', empty:true}, {n:'Разграблены, банки разбиты', looted:true}];

  A('bed', 'Кровать', 'life', 1, 2, {t:'кровать спальня', v:BED.length, vn:VN(BED), hd:true}, (g, v)=>bedDraw(g, PV(BED, v)));
  A('bunk', 'Двухъярусная койка', 'life', 1, 2, {t:'койка нары казарма', v:BUNK.length, vn:VN(BUNK), hd:true}, (g, v)=>bunkDraw(g, PV(BUNK, v)));
  A('sofa', 'Диван', 'life', 2, 1, {t:'диван гостиная', v:SOFA.length, vn:VN(SOFA), hd:true}, (g, v)=>sofaDraw(g, PV(SOFA, v)));
  A('table_dining', 'Обеденный стол', 'life', 2, 2, {t:'стол обеденный кухня', v:DINING.length, vn:VN(DINING), hd:true}, (g, v)=>diningDraw(g, PV(DINING, v)));
  A('chair', 'Стул', 'life', 1, 1, {t:'стул', v:CHAIR.length, vn:VN(CHAIR), hd:true}, (g, v)=>chairDraw(g, PV(CHAIR, v)));
  A('wardrobe', 'Шкаф', 'life', 2, 1, {t:'шкаф гардероб', v:WARDROBE.length, vn:VN(WARDROBE), hd:true}, (g, v)=>wardrobeDraw(g, PV(WARDROBE, v)));
  A('stove', 'Кухонная плита', 'life', 1, 1, {t:'плита кухня готовка', v:STOVE.length, vn:VN(STOVE), hd:true}, (g, v)=>stoveDraw(g, PV(STOVE, v)));
  A('fridge', 'Холодильник', 'life', 1, 1, {t:'холодильник кухня', v:FRIDGE.length, vn:VN(FRIDGE), hd:true}, (g, v)=>fridgeDraw(g, PV(FRIDGE, v)));
  A('sink', 'Раковина', 'life', 1, 1, {t:'раковина мойка кухня ванная', v:SINK.length, vn:VN(SINK), hd:true}, (g, v)=>sinkDraw(g, PV(SINK, v)));
  A('toilet', 'Унитаз', 'life', 1, 1, {t:'унитаз туалет санузел', v:TOILET.length, vn:VN(TOILET), hd:true}, (g, v)=>toiletDraw(g, PV(TOILET, v)));
  A('shower', 'Душевая кабина', 'life', 1, 1, {t:'душ душевая санузел', v:SHOWER.length, vn:VN(SHOWER), hd:true}, (g, v)=>showerDraw(g, PV(SHOWER, v)));
  A('bathtub', 'Ванна', 'life', 1, 2, {t:'ванна ванная', v:TUB.length, vn:VN(TUB), hd:true}, (g, v)=>tubDraw(g, PV(TUB, v)));
  A('office_desk', 'Офисный стол с терминалом', 'life', 2, 1, {t:'офис стол компьютер терминал', v:OFFICE.length, vn:VN(OFFICE), hd:true}, (g, v)=>officeDraw(g, PV(OFFICE, v)));
  A('hospital_bed', 'Больничная койка', 'life', 1, 2, {t:'больница койка медицина', v:HOSP.length, vn:VN(HOSP), hd:true}, (g, v)=>hospDraw(g, PV(HOSP, v)));
  A('stretcher', 'Каталка', 'life', 1, 2, {t:'каталка носилки больница', v:STRETCHER.length, vn:VN(STRETCHER), hd:true}, (g, v)=>stretcherDraw(g, PV(STRETCHER, v)));
  A('school_desk', 'Школьная парта', 'life', 1, 1, {t:'школа парта класс', v:SCHOOL.length, vn:VN(SCHOOL), hd:true}, (g, v)=>schoolDraw(g, PV(SCHOOL, v)));
  A('chalkboard', 'Классная доска', 'life', 3, 1, {t:'доска школа класс', v:BOARD.length, vn:VN(BOARD), hd:true}, (g, v)=>boardDraw(g, PV(BOARD, v)));
  A('reception', 'Стойка ресепшена', 'life', 3, 1, {t:'ресепшен стойка гостиница', v:RECEPTION.length, vn:VN(RECEPTION), hd:true}, (g, v)=>receptionDraw(g, PV(RECEPTION, v)));
  A('restaurant_table', 'Ресторанный столик', 'life', 2, 2, {t:'ресторан стол кафе', v:REST_TABLE.length, vn:VN(REST_TABLE), hd:true}, (g, v)=>restTableDraw(g, PV(REST_TABLE, v)));
  A('locker', 'Шкафчики', 'life', 3, 1, {t:'шкафчик раздевалка', v:LOCKER.length, vn:VN(LOCKER), hd:true}, (g, v)=>lockerDraw(g, PV(LOCKER, v)));
  A('washing', 'Стиральная машина', 'life', 1, 1, {t:'стиральная машина прачечная', v:WASH.length, vn:VN(WASH), hd:true}, (g, v)=>washDraw(g, PV(WASH, v)));
  A('pantry_shelves', 'Полки подсобки', 'life', 2, 1, {t:'подсобка кладовая полка', v:PANTRY.length, vn:VN(PANTRY), hd:true}, (g, v)=>pantryDraw(g, PV(PANTRY, v)));

  /* ===================== ПРОМЫШЛЕННОСТЬ ===================== */
  /* ---- Промышленность (HD) ---- */
  function cyl(k, x, y, w, h, col, vertical){ const c = k.c; k.rr(x, y, w, h, Math.min(w, h)*0.5); c.fillStyle = vertical ? k.lin(x, 0, x + w, 0, [[0, shade(col, -0.45)], [0.35, shade(col, 0.2)], [0.55, col], [1, shade(col, -0.5)]]) : k.lin(0, y, 0, y + h, [[0, shade(col, -0.45)], [0.35, shade(col, 0.2)], [0.55, col], [1, shade(col, -0.5)]]); c.fill(); k.stroke(k.INK, 0.012); }
  function tankBigDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5, R = 1.38;
    c.beginPath(); c.arc(cx + 0.12, cy + 0.16, R, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, R, 0, 6.28); k.texFill('metal', '#8a9094', d.col, 0.45);
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 6.28); c.clip(); const rg = c.createRadialGradient(cx - 0.4, cy - 0.45, 0.1, cx, cy, R); rg.addColorStop(0, 'rgba(255,250,240,.28)'); rg.addColorStop(0.6, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = rg; c.fillRect(0, 0, 3, 3);
      for(let i=0;i<16;i++){ const a = i/16*6.28; k.seam([cx + Math.cos(a)*0.25, cy + Math.sin(a)*0.25, cx + Math.cos(a)*R, cy + Math.sin(a)*R], 0.01, 0.6); } [0.25, 0.7, 1.05].forEach(r=>{ c.beginPath(); c.arc(cx, cy, r, 0, 6.28); k.stroke('rgba(0,0,0,.25)', 0.012); });
      for(let i=0;i<(d.rusty ? 16 : 6);i++) k.rust(cx + k.R(-1.1, 1.1), cy + k.R(-1.1, 1.1), k.R(0.05, 0.16), d.rusty && i < 3); for(let i=0;i<6;i++){ const a = k.rnd()*6.28; k.streak(cx + Math.cos(a)*R*0.8, cy + Math.sin(a)*R*0.8, 0.4, 0.05, '#6a3a1e', 0.3); }
      if(d.caved){ k.organic(cx + 0.2, cy + 0.1, 0.7, 0.35, 0.6); k.fill('#0e0c0a'); c.save(); k.organic(cx + 0.2, cy + 0.1, 0.7, 0.35, 0.6); c.clip(); k.radial(cx + 0.2, cy + 0.3, 0.6, '#3a4a2a', 0.5); c.restore(); for(let i=0;i<10;i++) k.rebar([cx + 0.2 + k.R(-0.7, 0.7), cy + 0.1 + k.R(-0.6, 0.6), cx + 0.2 + k.R(-0.9, 0.9), cy + 0.1 + k.R(-0.8, 0.8)]); } c.restore();
    c.beginPath(); c.arc(cx, cy, R, 0, 6.28); k.stroke(k.INK, 0.016); c.beginPath(); c.arc(cx, cy, R - 0.06, 0, 6.28); k.stroke('#4a4e50', 0.03);
    c.beginPath(); c.arc(cx, cy, 0.2, 0, 6.28); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); for(let i=0;i<8;i++){ const a = i/8*6.28; c.beginPath(); c.arc(cx + Math.cos(a)*0.16, cy + Math.sin(a)*0.16, 0.015, 0, 6.28); k.fill('#3a3e40'); }
    ventPipe(k, cx + 0.7, cy - 0.5, 0.07); c.beginPath(); c.arc(cx, cy, R + 0.04, 3.4, 4.6); k.stroke('#3a3e40', 0.05); for(let i=0;i<8;i++){ const a = 3.4 + i*0.15; k.line([cx + Math.cos(a)*R, cy + Math.sin(a)*R, cx + Math.cos(a)*(R + 0.08), cy + Math.sin(a)*(R + 0.08)], '#5a5e60', 0.015); }
    if(d.leak){ k.organic(2.5, 2.6, 0.45, 0.4, 0.3); k.fill(d.leak, 0.75); k.radial(2.5, 2.6, 0.5, d.leak, 0.3); } if(d.label) bits.stencil(k, cx, cy + 0.65, d.label, 0.2, '#e4ddca', 0.5); }
  const TANK_BIG = [{n:'Резервуар', col:'#9aa0a2', label:'ВОДА'}, {n:'Ржавый, протекает', col:'#8a6a50', rusty:true, leak:'#2a2418'}, {n:'Крыша провалена', col:'#7a8084', caved:true}];
  function tankHorizDraw(g, d){ const k = hk(g), c = k.c;
    [0.7, 3.3].forEach(y=>{ k.rr(0.05, y - 0.15, 1.9, 0.3, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); });
    fx.sh(k, 0.15, 0.1, 1.7, 3.8, 0.85, 0.1); cyl(k, 0.15, 0.1, 1.7, 3.8, d.col, true);
    c.save(); k.rr(0.15, 0.1, 1.7, 3.8, 0.85); c.clip(); for(let i=1;i<6;i++) k.seam([0.15, 0.1 + i*0.63, 1.85, 0.1 + i*0.63], 0.01, 0.7); for(let i=0;i<(d.rusty ? 14 : 5);i++) k.rust(k.R(0.3, 1.7), k.R(0.4, 3.6), k.R(0.05, 0.14), d.holed && i < 2); if(d.label) bits.stencil(k, 1.0, 2.0, d.label, 0.22, '#e4ddca', 0.5); c.restore();
    c.beginPath(); c.arc(1.0, 1.1, 0.18, 0, 6.28); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); for(let i=0;i<8;i++){ const a = i/8*6.28; c.beginPath(); c.arc(1.0 + Math.cos(a)*0.14, 1.1 + Math.sin(a)*0.14, 0.013, 0, 6.28); k.fill('#3a3e40'); }
    k.line([1.0, 0.1, 1.0, 0.0], '#3a3e40', 0.06); for(let i=0;i<4;i++) k.line([1.65, 1.6 + i*0.2, 1.85, 1.6 + i*0.2], '#4a4e50', 0.02);
    if(d.holed){ k.organic(1.4, 3.9, 0.5, 0.4, 0.2); k.fill('#1a1610', 0.75); } }
  const TANK_HORIZ = [{n:'Топливная цистерна', col:'#c8c2b0', label:'ОГНЕОПАСНО'}, {n:'Ржавая, пробита', col:'#8a6a50', rusty:true, holed:true}];
  function genDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.1, 0.25, 1.8, 1.5, 0.04, 0.08); k.rr(0.1, 0.25, 1.8, 1.5, 0.04); k.texFill('metal', '#6d7376', d.col, 0.55); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.1, 0.25, 1.8, 1.5, 0.04), 0.03);
    if(d.open){ k.rr(0.3, 0.4, 1.1, 1.2, 0.02); k.fill('#1a1814'); c.save(); k.rr(0.3, 0.4, 1.1, 1.2, 0.02); c.clip(); k.rr(0.45, 0.55, 0.6, 0.9, 0.03); k.fill('#4a4642'); k.stroke(k.INK, 0.008); for(let i=0;i<4;i++){ c.beginPath(); c.arc(0.75, 0.7 + i*0.2, 0.05, 0, 6.28); k.fill('#2a2622'); } k.rr(1.1, 0.6, 0.2, 0.3, 0.02); k.fill('#3a3836'); xb.cable(k, [0.5, 1.5, 0.8, 1.3, 1.2, 1.5], '#8a3a2e', 0.015); c.restore(); for(let i=0;i<5;i++) k.plank(k.R(0.2, 1.8), k.R(1.75, 1.95), 0.2, 0.04, k.rnd()*6.28, '#6a6e70', false); }
    else { for(let j=0;j<2;j++) for(let i=0;i<10;i++) k.line([0.35 + i*0.1, 0.45 + j*0.5, 0.35 + i*0.1, 0.8 + j*0.5], 'rgba(0,0,0,.45)', 0.018); }
    k.rr(1.45, 0.4, 0.35, 0.4, 0.02); k.fill('#2a2c2e'); k.stroke(k.INK, 0.008); [[1.55, 0.5], [1.7, 0.5]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#c8c2b0'); k.line([x, y, x + 0.02, y - 0.03], '#8e2e26', 0.006); }); c.beginPath(); c.arc(1.62, 0.7, 0.025, 0, 6.28); k.fill(d.on ? '#7ad28a' : '#3a2a2a'); if(d.on) k.radial(1.62, 0.7, 0.1, '#7ad28a', 0.5);
    c.beginPath(); c.arc(1.6, 1.4, 0.12, 0, 6.28); k.fill('#2a2826'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(1.6, 1.4, 0.07, 0, 6.28); k.fill('#0c0a08'); if(d.on) k.radial(1.75, 1.3, 0.5, '#2a2622', 0.4);
    xb.cable(k, [0.1, 1.2, -0.0, 1.5, 0.2, 1.9], '#1a1816', 0.03); xb.jerry(k, 0.3, 1.88, 1.2, '#8e3a2e'); for(let i=0;i<(d.rusty ? 10 : 3);i++) k.rust(k.R(0.2, 1.8), k.R(0.3, 1.7), k.R(0.04, 0.1), false); bits.stencil(k, 0.9, 1.6, d.label || 'ДГ-30', 0.11, '#e4ddca', 0.6); }
  const GEN = [{n:'Работает', col:'#5a6040', on:true}, {n:'Ржавый', col:'#6a5a46', rusty:true, label:'АД-60'}, {n:'Разобран', col:'#4a5a6a', open:true}];
  function transDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05, 0.05, 1.9, 1.9, 0.01); k.texFill('gravel', '#77736c'); k.rr(0.05, 0.05, 1.9, 1.9, 0.01); c.setLineDash([0.04, 0.03]); k.stroke('#6a6e70', 0.012); c.setLineDash([]); [[0.05, 0.05], [1.95, 0.05], [0.05, 1.95], [1.95, 1.95]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#4a4e50'); });
    fx.sh(k, 0.45, 0.5, 1.1, 1.0, 0.03, 0.08); k.rr(0.45, 0.5, 1.1, 1.0, 0.03); k.texFill('metal', '#6d7376', '#6a7a6a', 0.4); k.stroke(k.INK, 0.012); for(let i=0;i<10;i++){ k.line([0.38, 0.58 + i*0.09, 0.45, 0.58 + i*0.09], '#5a6a5a', 0.03); k.line([1.55, 0.58 + i*0.09, 1.62, 0.58 + i*0.09], '#5a6a5a', 0.03); }
    [[0.7, 0.75], [1.0, 0.75], [1.3, 0.75]].forEach(([x, y])=>{ for(let j=0;j<4;j++){ c.beginPath(); c.arc(x, y - j*0.04, 0.07 - j*0.01, 0, 6.28); k.fill(j%2 ? '#8a6a3a' : '#a07a40'); k.stroke('rgba(0,0,0,.4)', 0.005); } }); xb.cable(k, [0.7, 0.6, 0.7, 0.2, 0.5, 0.05], '#1a1816', 0.02); xb.cable(k, [1.3, 0.6, 1.3, 0.2, 1.5, 0.05], '#1a1816', 0.02);
    if(d.blown){ k.radial(1.0, 1.0, 1.0, '#0c0a08', 0.55); k.organic(1.05, 1.05, 0.3, 0.5, 0.25); k.fill('#0e0c0a'); for(let i=0;i<10;i++) k.chunk(k.R(0.3, 1.7), k.R(0.3, 1.7), 0.05, '#3a3836', 0.02); k.blot(1.3, 1.6, 0.2, '#1a1612', 0.7); }
    else k.puddle(1.3, 1.65, 0.12, 0.06);
    if(d.sign) xb.plate(k, 1.0, 1.82, 0.5, 0.2, 'ВЫСОКОЕ', '#c8a030', 0); }
  const TRANS = [{n:'Трансформатор'}, {n:'Взорвался', blown:true}, {n:'С табличкой', sign:true}];
  function pipeStraightDraw(g, d){ const k = hk(g), c = k.c;
    [0.6, 2.0, 3.4].forEach(y=>{ k.rr(0.12, y - 0.08, 0.76, 0.16, 0.01); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.008); });
    fx.sh(k, 0.25, 0, 0.5, 4, 0.25, 0.08); cyl(k, 0.25, 0, 0.5, 4, d.insul ? '#c8c2b0' : d.col, true);
    c.save(); k.rr(0.25, 0, 0.5, 4, 0.25); c.clip(); if(d.insul) for(let i=0;i<20;i++) k.line([0.25, i*0.2, 0.75, i*0.2 + 0.05], 'rgba(0,0,0,.25)', 0.012); for(let i=0;i<(d.rusty ? 12 : 4);i++) k.rust(k.R(0.3, 0.7), k.R(0.2, 3.8), k.R(0.03, 0.08), false); c.restore();
    [1.3, 2.7].forEach(y=>{ k.rr(0.2, y - 0.05, 0.6, 0.1, 0.02); k.texFill('metal', '#6d7376', d.col, 0.4); k.stroke(k.INK, 0.008); for(let i=0;i<5;i++){ c.beginPath(); c.arc(0.25 + i*0.125, y, 0.015, 0, 6.28); k.fill('#3a3e40'); } });
    if(d.leak){ k.puddle(0.75, 2.85, 0.25, 0.15); for(let i=0;i<4;i++) k.line([0.62, 2.72, 0.62 + i*0.06, 2.9], 'rgba(200,215,220,.4)', 0.008, null, [0.02, 0.02]); } }
  const PIPE = [{n:'Стальная', col:'#8a9094'}, {n:'Ржавая, течёт', col:'#7a5a40', rusty:true, leak:true}, {n:'В изоляции', col:'#c8c2b0', insul:true}];
  function pipeCornerDraw(g, d){ const k = hk(g), c = k.c;
    const path = ()=>{ c.beginPath(); c.moveTo(0.75, 0); c.lineTo(0.75, 0.75); c.quadraticCurveTo(0.75, 1.25, 1.25, 1.25); c.lineTo(2, 1.25); };
    path(); c.lineWidth = 0.56; c.strokeStyle = 'rgba(0,0,0,.35)'; c.save(); c.translate(0.07, 0.09); path(); c.stroke(); c.restore();
    [[0.5, 0.22], [0.4, -0.1], [0.3, 0.05], [0.12, 0.35]].forEach(([w, sh], i)=>{ path(); c.lineWidth = w; c.lineCap = 'butt'; c.strokeStyle = shade(d.col, i===0 ? -0.45 : i===1 ? -0.1 : i===2 ? 0.15 : 0.3); c.stroke(); });
    for(let i=0;i<(d.rusty ? 10 : 4);i++) k.rust(k.R(0.55, 0.95), k.R(0.1, 1.0), 0.05, false); [[0.55, 0.3, 0.95, 0.3], [1.6, 1.05, 1.6, 1.45]].forEach(p=>{ k.line(p, shade(d.col, -0.3), 0.08); for(let i=0;i<4;i++){ const t = (i + 0.5)/4; c.beginPath(); c.arc(p[0] + (p[2] - p[0])*t, p[1] + (p[3] - p[1])*t, 0.014, 0, 6.28); k.fill('#2a2826'); } }); }
  const PIPE_C = [{n:'Стальной', col:'#8a9094'}, {n:'Ржавый', col:'#7a5a40', rusty:true}];
  function valveDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.3, 0, 0.4, 1, 0.2, 0.06); cyl(k, 0.3, 0, 0.4, 1, d.rusty ? '#7a5a40' : '#8a9094', true);
    k.rr(0.2, 0.35, 0.6, 0.3, 0.04); k.texFill('metal', '#6d7376', '#5a6268', 0.4); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0.5, 0.5, 0.3, 0, 6.28); k.stroke('rgba(0,0,0,.35)', 0.05); c.beginPath(); c.arc(0.5 - 0.01, 0.5 - 0.01, 0.3, 0, 6.28); k.stroke(d.red ? '#a8302a' : '#4a4e50', 0.04); for(let i=0;i<5;i++){ const a = i/5*6.28; k.line([0.5, 0.5, 0.5 + Math.cos(a)*0.3, 0.5 + Math.sin(a)*0.3], d.red ? '#a8302a' : '#4a4e50', 0.03); } c.beginPath(); c.arc(0.5, 0.5, 0.06, 0, 6.28); k.fill('#2a2826');
    if(d.rusty){ for(let i=0;i<5;i++) k.rust(k.R(0.25, 0.75), k.R(0.2, 0.8), 0.04, false); k.puddle(0.75, 0.82, 0.18, 0.1); } }
  const VALVE = [{n:'Стальная', red:false}, {n:'Красный штурвал', red:true}, {n:'Ржавая, подтекает', rusty:true}];
  function coolingDraw(g, d){ const k = hk(g), c = k.c, cx = 3, cy = 3;
    c.beginPath(); c.arc(cx + 0.25, cy + 0.3, 2.85, 0, 6.28); k.fill('rgba(0,0,0,.4)');
    c.beginPath(); c.arc(cx, cy, 2.85, 0, 6.28); k.texFill('concrete', '#8a8780'); c.save(); c.beginPath(); c.arc(cx, cy, 2.85, 0, 6.28); c.clip(); const rg = c.createRadialGradient(cx - 0.8, cy - 0.9, 0.5, cx, cy, 2.85); rg.addColorStop(0, 'rgba(255,250,240,.2)'); rg.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = rg; c.fillRect(0, 0, 6, 6); for(let i=0;i<8;i++){ const a = k.rnd()*6.28; k.streak(cx + Math.cos(a)*2.3, cy + Math.sin(a)*2.3, 0.6, 0.12, '#3a3630', 0.3); } c.restore();
    c.beginPath(); c.arc(cx, cy, 2.85, 0, 6.28); k.stroke(k.INK, 0.02);
    const inner = ()=>{ c.beginPath(); if(d.broken){ for(let i=0;i<=40;i++){ const a = i/40*6.28, r = 2.35 - (a > 0.4 && a < 1.6 ? k.R(0.2, 0.9) : k.R(0, 0.06)); c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } c.closePath(); } else c.arc(cx, cy, 2.35, 0, 6.28); };
    inner(); c.fillStyle = k.lin(cx - 2.3, cy - 2.3, cx + 2.3, cy + 2.3, [[0, '#0e0c0a'], [0.6, '#1e1a16'], [1, '#2a2620']]); c.fill(); inner(); k.stroke('rgba(255,250,240,.25)', 0.03);
    c.save(); inner(); c.clip(); c.beginPath(); c.arc(cx, cy, 1.4, 0, 6.28); k.stroke('rgba(255,255,255,.06)', 0.05); for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([cx + Math.cos(a)*0.3, cy + Math.sin(a)*0.3, cx + Math.cos(a)*1.4, cy + Math.sin(a)*1.4], 'rgba(255,255,255,.05)', 0.04); } k.radial(cx + 0.5, cy + 0.6, 1.5, '#4a5a3a', 0.25); if(d.broken) for(let i=0;i<20;i++) k.chunk(cx + k.R(0.3, 1.8), cy + k.R(-1.6, 0.2), k.R(0.08, 0.22), '#6a6660', 0.04); c.restore();
    if(d.broken){ for(let i=0;i<30;i++){ const a = k.R(0.4, 1.6), r = k.R(2.4, 3.0); k.chunk(cx + Math.cos(a)*r, cy + Math.sin(a)*r, k.R(0.06, 0.18), '#8a8780', 0.04); } for(let i=0;i<10;i++){ const a = k.R(0.4, 1.6); k.rebar([cx + Math.cos(a)*2.35, cy + Math.sin(a)*2.35, cx + Math.cos(a)*2.6, cy + Math.sin(a)*2.65]); } } }
  const COOLING = [{n:'Градирня'}, {n:'Разрушенный край', broken:true}];
  function chimneyDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    c.beginPath(); c.arc(cx + 0.12, cy + 0.15, 0.92, 0, 6.28); k.fill('rgba(0,0,0,.4)');
    const ring = ()=>{ c.beginPath(); c.arc(cx, cy, 0.92, 0, 6.28); c.arc(cx, cy, 0.62, 0, 6.28, true); };
    if(d.broken){ c.beginPath(); for(let i=0;i<=30;i++){ const a = i/30*6.28, r = 0.92 - (a > 3.5 && a < 5.2 ? k.R(0.1, 0.25) : 0); c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } c.closePath(); c.arc(cx, cy, 0.62, 0, 6.28, true); k.texFill(d.brick ? 'brickwall' : 'concrete', '#8a8780'); }
    else { ring(); k.texFill(d.brick ? 'brickwall' : 'concrete', '#8a8780'); if(d.stripes){ c.save(); ring(); c.clip(); for(let i=0;i<8;i++){ c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 1, i/8*6.28, (i + 0.5)/8*6.28); c.closePath(); k.fill(i%2 ? '#e4ddca' : '#a8302a', 0.75); } c.restore(); } }
    c.save(); ring(); c.clip(); const rg = c.createRadialGradient(cx - 0.3, cy - 0.3, 0.2, cx, cy, 0.95); rg.addColorStop(0, 'rgba(255,250,240,.18)'); rg.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = rg; c.fillRect(0, 0, 2, 2); k.radial(cx, cy, 0.95, '#141210', 0.45); c.restore();
    c.beginPath(); c.arc(cx, cy, 0.62, 0, 6.28); c.fillStyle = k.lin(cx - 0.6, cy - 0.6, cx + 0.6, cy + 0.6, [[0, '#050404'], [1, '#2a2420']]); c.fill(); k.stroke('rgba(255,250,240,.2)', 0.02);
    c.beginPath(); c.arc(cx, cy, 0.92, 0, 6.28); k.stroke(k.INK, 0.014); for(let i=0;i<6;i++) k.line([cx + 0.88, cy - 0.3 + i*0.12, cx + 1.0, cy - 0.3 + i*0.12], '#4a4e50', 0.02); if(!d.broken){ c.beginPath(); c.arc(cx, cy, 0.95, 0, 6.28); k.stroke('#3a3e40', 0.025); } }
  const CHIMNEY = [{n:'Кирпичная', brick:true}, {n:'Бетонная, полосатая', stripes:true}, {n:'Обломанная', brick:true, broken:true}];
  function hangarDraw(g, d){ const k = hk(g), c = k.c, W = 8, H = 6;
    fx.sh(k, 0.1, 0.1, W - 0.2, H - 0.2, 0.02, 0.15); k.rr(0.1, 0.1, W - 0.2, H - 0.2, 0.02); k.texFill('corrugated', '#7f8588', d.col, 0.45);
    c.save(); k.rr(0.1, 0.1, W - 0.2, H - 0.2, 0.02); c.clip(); c.fillStyle = k.lin(0.1, 0, W - 0.1, 0, [[0, 'rgba(0,0,0,.45)'], [0.3, 'rgba(255,250,240,.18)'], [0.5, 'rgba(255,250,240,.06)'], [0.8, 'rgba(0,0,0,.2)'], [1, 'rgba(0,0,0,.55)']]); c.fillRect(0, 0, W, H);
      for(let i=1;i<6;i++) k.seam([0.1, i*1.0, W - 0.1, i*1.0], 0.016, 0.8); for(let i=0;i<(d.rusty ? 30 : 10);i++) k.rust(k.R(0.3, W - 0.3), k.R(0.3, H - 0.3), k.R(0.06, 0.2), d.rusty && i < 6); for(let i=0;i<6;i++) k.streak(k.R(0.5, W - 0.5), k.R(0.2, 3), 1.5, 0.08, '#5a3a20', 0.3);
      for(let i=0;i<4;i++){ k.rr(2.0 + i*1.2, 1.6, 0.5, 0.25, 0.02); c.fillStyle = 'rgba(160,190,195,.55)'; c.fill(); k.stroke('rgba(0,0,0,.4)', 0.008); }
      if(d.hole){ k.organic(5.3, 3.4, 1.1, 0.35, 0.85); k.fill('#0e0c0a'); c.save(); k.organic(5.3, 3.4, 1.1, 0.35, 0.85); c.clip(); for(let i=0;i<6;i++) k.line([4.0 + i*0.45, 2.4, 4.0 + i*0.45, 4.6], '#4a4e50', 0.08); for(let i=0;i<4;i++) k.line([4.0, 2.7 + i*0.5, 6.6, 2.7 + i*0.5], '#3a3e40', 0.04); bits.barrel(k, 5.0, 3.8, 0.2, '#3e5a6a'); c.restore(); for(let i=0;i<14;i++){ const a = k.rnd()*6.28; bits.sheet(k, (()=>{ const x = 5.3 + Math.cos(a)*1.3, y = 3.4 + Math.sin(a)*1.0; return [x, y, x + 0.3, y + 0.05, x + 0.25, y + 0.25, x - 0.02, y + 0.2]; })(), k.pick([null, d.col]), true); } } c.restore();
    k.rr(0.1, 0.1, W - 0.2, H - 0.2, 0.02); k.stroke(k.INK, 0.018);
    // торцевые ворота
    k.rr(2.5, H - 0.25, 3.0, 0.2, 0.01); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); if(d.open){ k.rr(2.6, H - 0.25, 2.8, 0.2, 0.01); k.fill('#141210'); [[2.5, -1], [5.5, 1]].forEach(([x, s])=>{ c.save(); c.translate(x, H - 0.1); c.rotate(s*0.5); k.rr(s > 0 ? 0 : -1.4, -0.05, 1.4, 0.08, 0.01); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.008); c.restore(); }); }
    bits.stencil(k, 4, 1.0, d.label || 'АНГАР 3', 0.4, '#e4ddca', 0.4); }
  const HANGAR = [{n:'Ангар', col:'#7a8084'}, {n:'Провал в кровле', col:'#6a7a6a', hole:true, label:'ЦЕХ 2'}, {n:'Ржавый, ворота открыты', col:'#7a5a44', rusty:true, open:true}];
  function conveyorDraw(g, d){ const k = hk(g), c = k.c;
    [0.15, 0.85].forEach(x=>{ k.line([x + 0.03, 0, x + 0.03, 5].map((v, i)=>v + (i%2 ? 0.04 : 0)), 'rgba(0,0,0,.35)', 0.08); k.line([x, 0, x, 5], '#4a4e50', 0.07); k.line([x - 0.015, 0, x - 0.015, 5], 'rgba(255,255,255,.2)', 0.015); });
    k.rr(0.2, 0.05, 0.6, 4.9, 0.02); k.fill('#232220'); for(let y=0.1;y<5;y+=0.12) k.line([0.21, y, 0.79, y], d.broken && y > 2.2 && y < 3 ? 'rgba(0,0,0,0)' : '#3a3836', 0.025);
    for(let y=0.25;y<5;y+=0.5){ c.beginPath(); c.arc(0.15, y, 0.035, 0, 6.28); k.fill('#5a5e60'); c.beginPath(); c.arc(0.85, y, 0.035, 0, 6.28); k.fill('#5a5e60'); }
    if(d.broken){ k.rr(0.2, 2.2, 0.6, 0.8, 0.01); k.fill('#0e0c0a'); for(let i=0;i<5;i++){ c.beginPath(); c.arc(0.5, 2.3 + i*0.16, 0.05, 0, 6.28); k.fill('#5a5e60'); } c.save(); c.translate(0.5, 3.2); c.rotate(0.3); k.rr(-0.3, -0.03, 0.6, 0.06, 0.01); k.fill('#232220'); c.restore(); }
    if(d.boxes) [0.6, 1.5, 3.4, 4.3].forEach((y, i)=>houseBits.crate(k, 0.5, y, 0.45, 0.42, k.R(-0.1, 0.1)));
    c.beginPath(); c.arc(0.5, 4.85, 0.18, 0, 6.28); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.008); }
  const CONVEYOR = [{n:'С ящиками', boxes:true}, {n:'Пустой'}, {n:'Лента порвана', broken:true}];
  function latheDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.05, 0.2, 1.9, 0.6, 0.03, 0.06); k.rr(0.05, 0.2, 1.9, 0.6, 0.03); k.texFill('metal', '#6d7376', '#4a6a5a', 0.5); k.stroke(k.INK, 0.012);
    k.rr(0.1, 0.25, 0.45, 0.5, 0.03); k.texFill('metal', '#6d7376', '#3e5a4a', 0.5); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(0.65, 0.5, 0.17, 0, 6.28); k.texFill('metal', '#8a9094'); k.stroke(k.INK, 0.008); for(let i=0;i<3;i++){ const a = i*2.09; k.line([0.65, 0.5, 0.65 + Math.cos(a)*0.16, 0.5 + Math.sin(a)*0.16], '#3a3e40', 0.03); }
    if(!d.parts){ k.line([0.65, 0.5, 1.5, 0.5], '#a8aeb2', 0.06); } k.rr(1.0, 0.3, 0.3, 0.4, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.008); k.rr(1.55, 0.35, 0.3, 0.3, 0.02); k.texFill('metal', '#6d7376', '#3e5a4a', 0.5); k.stroke(k.INK, 0.008); k.line([1.85, 0.5, 1.98, 0.5], '#3a3e40', 0.03);
    [[0.25, 0.32], [0.35, 0.32]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.03, 0, 6.28); k.fill('#c8302a'); });
    for(let i=0;i<14;i++){ const x = k.R(0.6, 1.6), y = k.R(0.75, 0.98); c.beginPath(); c.arc(x, y, 0.025, k.rnd()*6, k.rnd()*6 + 3); k.stroke('#b8bcbe', 0.006); }
    if(d.rusty) for(let i=0;i<10;i++) k.rust(k.R(0.1, 1.9), k.R(0.25, 0.75), k.R(0.03, 0.08), false); if(d.parts) for(let i=0;i<6;i++) k.plank(k.R(0.3, 1.8), k.R(0.0, 0.2), 0.15, 0.04, k.rnd()*6.28, '#8a9094', false); }
  const LATHE = [{n:'Токарный станок'}, {n:'Ржавый', rusty:true}, {n:'Разобран', parts:true}];
  function benchDraw(g, d){ const k = hk(g), c = k.c;
    if(d.metal){ fx.sh(k, 0.05, 0.15, 1.9, 0.7, 0.02, 0.06); k.rr(0.05, 0.15, 1.9, 0.7, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.012); for(let i=0;i<8;i++) k.rust(k.R(0.1, 1.9), k.R(0.2, 0.8), 0.04, false); } else fx.wood(k, 0.05, 0.15, 1.9, 0.7, '#6a5236', 0.02);
    c.save(); c.translate(0.25, 0.5); k.rr(-0.14, -0.12, 0.28, 0.24, 0.02); k.fill('#3a5a7a'); k.stroke(k.INK, 0.008); k.line([0, -0.12, 0, -0.28], '#8a9094', 0.02); k.line([-0.08, -0.28, 0.08, -0.28], '#8a9094', 0.02); c.restore();
    const tool = (x, y, a, kind)=>{ c.save(); c.translate(x, y); c.rotate(a); if(kind==='hammer'){ k.rr(-0.12, -0.012, 0.22, 0.024, 0.01); k.fill('#6a5236'); k.rr(0.08, -0.04, 0.05, 0.08, 0.01); k.fill('#4a4e50'); } else if(kind==='wrench'){ k.rr(-0.12, -0.012, 0.2, 0.024, 0.01); k.fill('#9aa0a2'); c.beginPath(); c.arc(0.1, 0, 0.03, 0.6, 5.7); k.stroke('#9aa0a2', 0.02); } else { k.rr(-0.1, -0.01, 0.12, 0.02, 0.005); k.fill('#8a9094'); k.rr(0.02, -0.018, 0.08, 0.036, 0.01); k.fill('#c8302a'); } c.restore(); };
    tool(0.7, 0.35, 0.3, 'hammer'); tool(0.9, 0.6, -0.4, 'wrench'); tool(1.2, 0.3, 1.2, 'screw'); tool(1.5, 0.7, 0.2, 'wrench'); for(let i=0;i<10;i++){ c.beginPath(); c.arc(k.R(0.6, 1.8), k.R(0.25, 0.75), 0.012, 0, 6.28); k.fill('#8a9094'); }
    if(d.parts){ xb.box(k, 1.6, 0.4, 0.3, 0.2, 0.2, '#8a3a2e'); xb.cable(k, [1.1, 0.5, 1.3, 0.75, 1.6, 0.6], '#c8302a', 0.008); k.rr(1.2, 0.45, 0.18, 0.12, 0.01); k.fill('#2a4a2a'); for(let i=0;i<4;i++){ c.beginPath(); c.arc(1.23 + i*0.04, 0.5, 0.01, 0, 6.28); k.fill('#c8a040'); } }
    if(d.oily) k.blot(1.2, 0.55, 0.2, '#141210', 0.5); }
  const BENCH = [{n:'Деревянный'}, {n:'Металлический, в масле', metal:true, oily:true}, {n:'С электроникой', parts:true}];
  function pressDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.2, 0.2, 1.6, 1.6, 0.03); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01);
    [[0.25, 0.25], [1.5, 0.25], [0.25, 1.5], [1.5, 1.5]].forEach(([x, y])=>{ fx.sh(k, x, y, 0.25, 0.25, 0.02, 0.06); k.rr(x, y, 0.25, 0.25, 0.02); k.texFill('metal', '#6d7376', '#c8a030', 0.5); k.stroke(k.INK, 0.008); });
    fx.sh(k, 0.35, 0.35, 1.3, 1.3, 0.04, 0.12); k.rr(0.35, 0.35, 1.3, 1.3, 0.04); k.texFill('metal', '#6d7376', d.col, 0.5); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.35, 0.35, 1.3, 1.3, 0.04), 0.04);
    c.beginPath(); c.arc(1, 1, 0.38, 0, 6.28); c.fillStyle = k.lin(0.62, 0.62, 1.38, 1.38, [[0, '#c8ccce'], [1, '#5a5e60']]); c.fill(); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(1, 1, 0.2, 0, 6.28); k.stroke('rgba(0,0,0,.3)', 0.012);
    xb.cable(k, [1.65, 0.8, 1.9, 0.6, 1.95, 0.3], '#1a1816', 0.035); xb.cable(k, [1.65, 1.2, 1.9, 1.4, 1.95, 1.8], '#1a1816', 0.035); for(let i=0;i<(d.rusty ? 10 : 3);i++) k.rust(k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.04, 0.1), false);
    if(d.crushed){ c.save(); c.translate(1, 1.85); c.scale(1.4, 0.4); carDraw && k.organic(0, 0, 0.3, 0.3, 0.3); k.fill('#7a3a2e'); c.restore(); } k.c.save(); for(let i=0;i<6;i++){ k.poly([0.35 + i*0.217, 0.35, 0.35 + (i + 0.5)*0.217, 0.35, 0.35 + i*0.217 + 0.1, 0.42, 0.35 + i*0.217 - 0.01, 0.42]); k.fill(i%2 ? '#1e1c1a' : '#c8a030', 0.7); } k.c.restore(); }
  const PRESS = [{n:'Пресс', col:'#4a6a7a'}, {n:'Ржавый', col:'#6a5a46', rusty:true}, {n:'С расплющенным ломом', col:'#5a6a5a', crushed:true}];
  function barrelsGroupDraw(g, d){ const k = hk(g), c = k.c;
    if(d.pallet){ fx.wood(k, 0.1, 0.1, 1.8, 1.8, '#8a7050', 0.01); for(let i=0;i<7;i++) k.line([0.1, 0.2 + i*0.27, 1.9, 0.2 + i*0.27], 'rgba(0,0,0,.4)', 0.03); }
    const pos = d.fallen ? [[0.5, 0.5], [1.4, 0.55], [0.55, 1.45]] : [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]];
    pos.forEach(([x, y], i)=>bits.barrel(k, x, y, 0.42, d.cols[i%d.cols.length], d.open && i===1));
    if(d.fallen){ c.save(); c.translate(1.4, 1.45); c.rotate(0.7); k.rr(-0.45, -0.3, 0.9, 0.6, 0.06); c.fillStyle = k.lin(0, -0.3, 0, 0.3, [[0, '#4a5a3a'], [0.4, '#6a7a4a'], [1, '#2a3a1e']]); c.fill(); k.stroke(k.INK, 0.01); [-0.2, 0.2].forEach(x=>k.line([x, -0.3, x, 0.3], 'rgba(0,0,0,.4)', 0.02)); c.restore(); k.organic(1.75, 1.75, 0.3, 0.4, 0.2); k.fill('#141210', 0.7); }
    if(d.stencil) pos.forEach(([x, y])=>bits.stencil(k, x, y, d.stencil, 0.12, '#e4ddca', 0.5)); }
  const BARRELS = [{n:'Масло', cols:['#4a5a3a', '#3e5a6a', '#4a5a3a', '#6a4a36'], stencil:'ГСМ'}, {n:'На паллете', cols:['#3e5a6a'], pallet:true}, {n:'Ржавые, одна открыта', cols:['#6a4a36', '#5a3a2a'], open:true}, {n:'Рассыпаны, разлив', cols:['#4a5a3a', '#6a4a36'], fallen:true}];
  function craneDraw(g, d){ const k = hk(g), c = k.c;
    [0.15, 1.85].forEach(y=>{ k.line([0, y + 0.04, 8, y + 0.04], 'rgba(0,0,0,.35)', 0.12); k.line([0, y, 8, y], '#4a4e50', 0.1); k.line([0, y - 0.02, 8, y - 0.02], 'rgba(255,255,255,.2)', 0.02); });
    c.save(); if(d.fallen){ c.translate(4, 1); c.rotate(0.12); c.translate(-4, -1); }
    fx.sh(k, 0.3, 0.75, 7.4, 0.5, 0.02, 0.14); k.rr(0.3, 0.75, 7.4, 0.5, 0.02); k.texFill('metal', '#6d7376', '#c8a030', 0.55); k.stroke(k.INK, 0.012);
    c.save(); k.rr(0.3, 0.75, 7.4, 0.5, 0.02); c.clip(); for(let i=0;i<30;i++){ k.poly([0.3 + i*0.25, 0.75, 0.3 + i*0.25 + 0.12, 0.75, 0.3 + i*0.25 + 0.37, 1.25, 0.3 + i*0.25 + 0.25, 1.25]); k.fill('#1e1c1a', 0.6); } for(let i=0;i<10;i++) k.rust(k.R(0.4, 7.6), k.R(0.8, 1.2), 0.06, false); c.restore();
    [[0.3, 0.1, 0.5, 1.8], [7.2, 0.1, 0.5, 1.8]].forEach(([x, y, w, h])=>{ k.rr(x, y, w, h, 0.02); k.texFill('metal', '#6d7376', '#c8a030', 0.55); k.stroke(k.INK, 0.01); [[x + 0.1, y + 0.05], [x + 0.1, y + h - 0.05]].forEach(([wx, wy])=>{ c.beginPath(); c.arc(wx + 0.15, wy, 0.06, 0, 6.28); k.fill('#2a2826'); }); });
    const tx = d.fallen ? 5.2 : 3.4; k.rr(tx, 0.65, 0.7, 0.7, 0.03); k.texFill('metal', '#6d7376', '#3e5a6a', 0.5); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(tx + 0.35, 1.0, 0.18, 0, 6.28); k.fill('#2a2826'); k.stroke('#8a9094', 0.02); c.restore();
    if(!d.fallen){ k.line([3.75, 1.0, 3.75, 1.6], '#3a3836', 0.02); k.c.beginPath(); k.c.arc(3.75, 1.65, 0.07, 0, 3.6); k.stroke('#c8a030', 0.03); } else { for(let i=0;i<14;i++) k.chunk(k.R(2, 6), k.R(1.3, 1.95), k.R(0.05, 0.14), '#8a8780', 0.03); bits.barrel(k, 6.4, 1.6, 0.2, '#3e5a6a'); } }
  const CRANE = [{n:'Кран-балка'}, {n:'Рухнула', fallen:true}];
  function boilerDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.1, 0.2, 2.4, 1.6, 0.8, 0.1); cyl(k, 0.1, 0.2, 2.4, 1.6, d.rusty ? '#7a5a40' : '#5a5e60', false);
    c.save(); k.rr(0.1, 0.2, 2.4, 1.6, 0.8); c.clip(); for(let i=1;i<6;i++) k.seam([0.1 + i*0.4, 0.2, 0.1 + i*0.4, 1.8], 0.012, 0.7); for(let i=0;i<(d.rusty ? 16 : 5);i++) k.rust(k.R(0.3, 2.3), k.R(0.3, 1.7), k.R(0.04, 0.12), d.blown && i < 3); for(let i=0;i<3;i++) k.radial(k.R(0.4, 2.2), 0.4, 0.3, '#1a1612', 0.3); if(d.blown){ k.organic(1.5, 0.9, 0.5, 0.45, 0.4); k.fill('#0e0c0a'); for(let i=0;i<10;i++) k.rebar([1.5 + k.R(-0.5, 0.5), 0.9 + k.R(-0.4, 0.4), 1.5 + k.R(-0.7, 0.7), 0.9 + k.R(-0.6, 0.6)]); } c.restore();
    k.rr(2.4, 0.4, 0.55, 1.2, 0.04); k.texFill('brickwall', '#7a4c3e'); k.stroke(k.INK, 0.01); k.rr(2.55, 0.85, 0.3, 0.3, 0.02); k.fill('#1a1410'); if(!d.blown && !d.rusty){ k.radial(2.7, 1.0, 0.25, '#e07a2a', 0.45); }
    [[0.6, 0.3], [0.95, 0.3]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.08, 0, 6.28); k.fill('#c8c2b0'); k.stroke(k.INK, 0.006); k.line([x, y, x + 0.04, y - 0.05], '#8e2e26', 0.008); });
    k.line([1.3, 0.2, 1.3, 0.0], '#4a4e50', 0.08); xb.cable(k, [0.2, 1.0, 0.0, 1.2, 0.05, 1.95], '#4a4e50', 0.06); if(d.blown) for(let i=0;i<14;i++) bits.sheet(k, (()=>{ const x = k.R(0.0, 2.9), y = k.R(1.75, 1.95); return [x, y, x + 0.15, y, x + 0.12, y + 0.05, x, y + 0.05]; })(), '#5a5e60', false); }
  const BOILER = [{n:'Котёл, топится'}, {n:'Ржавый, холодный', rusty:true}, {n:'Взорван', rusty:true, blown:true}];
  function solarDraw(g, d){ const k = hk(g), c = k.c;
    [[0.08, 0.12], [1.04, 0.12], [0.08, 1.06], [1.04, 1.06]].forEach(([x, y], i)=>{ c.save(); if(d.wind && i===3){ c.translate(x + 0.44, y + 0.41); c.rotate(0.5); c.translate(-x - 0.44, -y - 0.41); } solar(k, x, y, 0.88, 0.82, d.broken && (i===1 || i===2)); if(d.dirty){ c.save(); k.rr(x, y, 0.88, 0.82, 0.01); c.clip(); k.radial(x + 0.4, y + 0.5, 0.6, '#b8a888', 0.45); k.leaves(x, y, 0.88, 0.82, 8); c.restore(); } c.restore(); });
    xb.cable(k, [0.5, 0.95, 1.0, 1.0, 1.5, 0.95, 1.95, 1.0], '#1a1816', 0.016); }
  const SOLAR = [{n:'Целые'}, {n:'Разбиты', broken:true}, {n:'Пыльные, одна сорвана', dirty:true, wind:true}];
  function pumpJackDraw(g, d){ const k = hk(g), c = k.c;
    if(d.spill){ k.organic(1.2, 1.4, 0.9, 0.35, 0.55); k.fill('#0e0c0a', 0.85); k.organic(1.0, 1.3, 0.5, 0.3, 0.3); k.fill('rgba(110,90,140,.15)'); }
    k.rr(0.15, 0.6, 2.7, 0.8, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.012);
    const col = d.rusty ? '#7a5a40' : '#c8a030';
    [[0.5, 0.7], [0.5, 1.3]].forEach(([x, y])=>k.line([x, y, 1.5, 1.0], '#4a4e50', 0.06)); c.beginPath(); c.arc(1.5, 1.0, 0.08, 0, 6.28); k.fill('#2a2826');
    fx.sh(k, 0.1, 0.9, 2.6, 0.2, 0.02, 0.1); k.rr(0.1, 0.9, 2.6, 0.2, 0.02); k.texFill('metal', '#6d7376', col, 0.6); k.stroke(k.INK, 0.01);
    k.poly([2.6, 0.75, 2.95, 0.85, 2.95, 1.15, 2.6, 1.25]); k.texFill('metal', '#6d7376', col, 0.6); k.stroke(k.INK, 0.01); k.line([2.92, 1.0, 2.92, 1.5], '#2a2826', 0.02);
    [[0.3, 0.6], [0.3, 1.4]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.22, 0, 6.28); k.texFill('metal', '#6d7376', '#3a3e40', 0.5); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x, y, 0.05, 0, 6.28); k.fill('#1e1c1a'); });
    k.rr(0.05, 0.85, 0.3, 0.3, 0.02); k.texFill('metal', '#6d7376', '#3e5a6a', 0.5); k.stroke(k.INK, 0.008);
    c.beginPath(); c.arc(2.92, 1.55, 0.08, 0, 6.28); k.fill('#3a3836'); k.stroke(k.INK, 0.008); for(let i=0;i<(d.rusty ? 12 : 4);i++) k.rust(k.R(0.2, 2.8), k.R(0.6, 1.4), k.R(0.03, 0.08), false); }
  const PUMPJACK = [{n:'Качает'}, {n:'Ржавая', rusty:true}, {n:'Разлив нефти', rusty:true, spill:true}];

  A('tank_big', 'Резервуар', 'industry', 3, 3, {t:'резервуар бак цистерна нефть', v:TANK_BIG.length, vn:VN(TANK_BIG), hd:true}, (g, v)=>tankBigDraw(g, PV(TANK_BIG, v)));
  A('tank_horiz', 'Горизонтальная цистерна', 'industry', 2, 4, {t:'цистерна бак топливо', v:TANK_HORIZ.length, vn:VN(TANK_HORIZ), hd:true}, (g, v)=>tankHorizDraw(g, PV(TANK_HORIZ, v)));
  A('generator', 'Генератор', 'industry', 2, 2, {t:'генератор энергия дизель', v:GEN.length, vn:VN(GEN), hd:true}, (g, v)=>genDraw(g, PV(GEN, v)));
  A('transformer', 'Трансформатор', 'industry', 2, 2, {t:'трансформатор подстанция энергия', v:TRANS.length, vn:VN(TRANS), hd:true}, (g, v)=>transDraw(g, PV(TRANS, v)));
  A('pipe_straight', 'Труба (прямая)', 'industry', 1, 4, {t:'труба трубопровод', v:PIPE.length, vn:VN(PIPE), hd:true}, (g, v)=>pipeStraightDraw(g, PV(PIPE, v)));
  A('pipe_corner', 'Труба (угол)', 'industry', 2, 2, {t:'труба угол колено', v:PIPE_C.length, vn:VN(PIPE_C), hd:true}, (g, v)=>pipeCornerDraw(g, PV(PIPE_C, v)));
  A('valve', 'Задвижка', 'industry', 1, 1, {t:'вентиль задвижка труба', v:VALVE.length, vn:VN(VALVE), hd:true}, (g, v)=>valveDraw(g, PV(VALVE, v)));
  A('cooling_tower', 'Градирня', 'industry', 6, 6, {t:'градирня аэс электростанция', v:COOLING.length, vn:VN(COOLING), hd:true}, (g, v)=>coolingDraw(g, PV(COOLING, v)));
  A('chimney', 'Дымовая труба', 'industry', 2, 2, {t:'труба дым котельная', v:CHIMNEY.length, vn:VN(CHIMNEY), hd:true}, (g, v)=>chimneyDraw(g, PV(CHIMNEY, v)));
  A('hangar', 'Ангар', 'industry', 8, 6, {t:'ангар склад цех', v:HANGAR.length, vn:VN(HANGAR), hd:true}, (g, v)=>hangarDraw(g, PV(HANGAR, v)));
  A('conveyor', 'Конвейер', 'industry', 1, 5, {t:'конвейер лента завод', v:CONVEYOR.length, vn:VN(CONVEYOR), hd:true}, (g, v)=>conveyorDraw(g, PV(CONVEYOR, v)));
  A('lathe', 'Станок', 'industry', 2, 1, {t:'станок мастерская завод', v:LATHE.length, vn:VN(LATHE), hd:true}, (g, v)=>latheDraw(g, PV(LATHE, v)));
  A('workbench', 'Верстак', 'industry', 2, 1, {t:'верстак мастерская инструменты', v:BENCH.length, vn:VN(BENCH), hd:true}, (g, v)=>benchDraw(g, PV(BENCH, v)));
  A('press', 'Гидравлический пресс', 'industry', 2, 2, {t:'пресс завод', v:PRESS.length, vn:VN(PRESS), hd:true}, (g, v)=>pressDraw(g, PV(PRESS, v)));
  A('barrels_group', 'Бочки', 'industry', 2, 2, {t:'бочки топливо склад', v:BARRELS.length, vn:VN(BARRELS), hd:true}, (g, v)=>barrelsGroupDraw(g, PV(BARRELS, v)));
  A('crane_beam', 'Кран-балка', 'industry', 8, 2, {t:'кран балка цех', v:CRANE.length, vn:VN(CRANE), hd:true}, (g, v)=>craneDraw(g, PV(CRANE, v)));
  A('boiler', 'Котёл', 'industry', 3, 2, {t:'котёл котельная', v:BOILER.length, vn:VN(BOILER), hd:true}, (g, v)=>boilerDraw(g, PV(BOILER, v)));
  A('solar_panels', 'Солнечные панели', 'industry', 2, 2, {t:'солнечные панели энергия', v:SOLAR.length, vn:VN(SOLAR), hd:true}, (g, v)=>solarDraw(g, PV(SOLAR, v)));
  A('pump_jack', 'Нефтекачалка', 'industry', 3, 2, {t:'нефть качалка вышка', v:PUMPJACK.length, vn:VN(PUMPJACK), hd:true}, (g, v)=>pumpJackDraw(g, PV(PUMPJACK, v)));

  /* ===================== ВОЕННЫЕ ОБЪЕКТЫ И ПУСТОШИ (HD) ===================== */
  /* ---- Общие детали для военных объектов и пустошей ---- */
  const bits = {
    barrel(k, x, y, r, col, open){ const c = k.c; c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.38)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, shade(col, 0.2)], [1, shade(col, -0.4)]]); c.fill(); k.stroke(k.INK, r*0.06);
      c.beginPath(); c.arc(x, y, r*0.84, 0, 6.28); k.stroke('rgba(0,0,0,.35)', r*0.05); if(open){ c.beginPath(); c.arc(x, y, r*0.78, 0, 6.28); k.fill('#141210'); } else { c.beginPath(); c.arc(x + r*0.45, y - r*0.3, r*0.12, 0, 6.28); k.fill(shade(col, -0.3)); c.beginPath(); c.arc(x - r*0.4, y + r*0.35, r*0.08, 0, 6.28); k.fill(shade(col, -0.3)); }
      for(let i=0;i<3;i++) k.rust(x + k.R(-r, r)*0.6, y + k.R(-r, r)*0.6, r*k.R(0.07, 0.15), false); k.line([x - r*0.7, y - r*0.4, x - r*0.3, y - r*0.8], 'rgba(255,255,255,.25)', r*0.1); },
    fire(k, x, y, r, level){ const c = k.c; level = level==null ? 1 : level; k.radial(x, y, r*2.6, '#e07a2a', 0.3*level); k.radial(x, y, r*1.5, '#f0a040', 0.35*level);
      // пламя сверху: слои языков от тёмно-красного к жёлтому, искры
      [[1.05, '#a8341a', 0.85], [0.82, '#e0621e', 0.9], [0.58, '#f29a34', 0.92], [0.34, '#ffd66e', 0.95]].forEach(([s0, col, al])=>{ for(let i=0;i<3;i++){ k.organic(x + k.R(-0.12, 0.12)*r, y + k.R(-0.12, 0.12)*r, r*s0*level*k.R(0.85, 1.05), 0.55); k.fill(col, al*0.55); } });
      k.radial(x, y, r*0.45, '#fff4c8', 0.9*level); for(let i=0;i<10;i++){ const an = k.rnd()*6.28, d = r*k.R(0.9, 1.8); c.beginPath(); c.arc(x + Math.cos(an)*d, y + Math.sin(an)*d, r*0.04, 0, 6.28); k.fill(k.pick(['#ffb04a', '#ff7a2a', '#ffe08a']), 0.85); } },
    embers(k, x, y, r){ for(let i=0;i<14;i++){ const a = k.rnd()*6.28, d = k.rnd()*r; k.c.beginPath(); k.c.arc(x + Math.cos(a)*d, y + Math.sin(a)*d, r*k.R(0.04, 0.09), 0, 6.28); k.fill(k.pick(['#e8682a', '#b8401a', '#f0a040']), 0.85); } k.radial(x, y, r*1.6, '#c85a20', 0.25); },
    logs(k, x, y, r, n, burnt){ for(let i=0;i<n;i++){ const a = i/n*6.28 + 0.3; k.plank(x + Math.cos(a)*r*0.55, y + Math.sin(a)*r*0.55, r*1.1, r*0.28, a, burnt ? '#2a2018' : '#5e4630', false); } },
    stones(k, x, y, r, n){ for(let i=0;i<n;i++){ const a = i/n*6.28; k.chunk(x + Math.cos(a)*r, y + Math.sin(a)*r, r*0.22, k.pick(['#7a766e', '#8a857c', '#6a665f']), r*0.06); } },
    skull(k, x, y, r, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); c.beginPath(); c.ellipse(r*0.15, r*0.2, r, r*0.85, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(0, 0, r, r*0.85, 0, 0, 6.28); c.fillStyle = k.lin(-r, -r, r, r, [[0, '#ece4cc'], [1, '#a89e84']]); c.fill(); k.stroke('#4a4234', r*0.08);
      c.beginPath(); c.ellipse(-r*0.35, r*0.05, r*0.24, r*0.28, 0, 0, 6.28); k.fill('#1e1a14'); c.beginPath(); c.ellipse(r*0.35, r*0.05, r*0.24, r*0.28, 0, 0, 6.28); k.fill('#1e1a14'); k.poly([0, r*0.35, -r*0.1, r*0.55, r*0.1, r*0.55]); k.fill('#2a241a'); for(let i=-2;i<=2;i++) k.line([i*r*0.14, r*0.68, i*r*0.14, r*0.82], '#4a4234', r*0.06); c.restore(); },
    // лист металлолома: ржавый/крашеный, с гофрой или без, заклёпки по краю
    sheet(k, pts, col, corr){ const c = k.c; k.fillP(pts.map((v, i)=>v + (i%2 ? 0.05 : 0.04)), 'rgba(0,0,0,.35)'); k.poly(pts); k.texFill(corr ? 'corrugated' : 'rust', '#7a5a46', col, col ? 0.5 : 0); k.poly(pts); k.stroke(k.INK, 0.012);
      for(let i=0;i<pts.length;i+=2){ const nx = pts[(i + 2)%pts.length], ny = pts[(i + 3)%pts.length]; for(let t=0.15;t<1;t+=0.25){ c.beginPath(); c.arc(pts[i] + (nx - pts[i])*t, pts[i + 1] + (ny - pts[i + 1])*t, 0.012, 0, 6.28); k.fill('#3a3430'); } } },
    // ткань: заливка, складки, светлые гребни, тёмные впадины
    fabric(k, pts, col, folds, dir){ const c = k.c; k.poly(pts); k.fill(col); c.save(); k.poly(pts); c.clip(); const xs = pts.filter((_, i)=>i%2===0), ys = pts.filter((_, i)=>i%2===1), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      for(let i=0;i<folds;i++){ const t = (i + 0.5)/folds, j = k.R(-0.03, 0.03); if(dir==='v'){ const x = x0 + (x1 - x0)*t + j; k.line([x, y0, x + k.R(-0.05, 0.05), y1], 'rgba(0,0,0,.2)', 0.04); k.line([x - 0.03, y0, x - 0.03 + k.R(-0.05, 0.05), y1], 'rgba(255,250,240,.12)', 0.02); } else { const y = y0 + (y1 - y0)*t + j; k.line([x0, y, x1, y + k.R(-0.05, 0.05)], 'rgba(0,0,0,.2)', 0.04); k.line([x0, y - 0.03, x1, y - 0.03 + k.R(-0.05, 0.05)], 'rgba(255,250,240,.12)', 0.02); } }
      for(let i=0;i<4;i++) k.blot(k.R(x0, x1), k.R(y0, y1), k.R(0.08, 0.2), '#3a3026', 0.18);
      c.fillStyle = k.lin(0, y0, 0, y1, [[0, 'rgba(255,248,230,.12)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(60,46,30,.25)']]); c.fillRect(x0, y0, x1 - x0, y1 - y0);
      for(let i=1;i<3;i++){ const t = i/3; if(dir==='v') k.line([x0 + (x1 - x0)*t, y0, x0 + (x1 - x0)*t, y1], 'rgba(40,30,20,.45)', 0.005, null, [0.018, 0.012]); else k.line([x0, y0 + (y1 - y0)*t, x1, y0 + (y1 - y0)*t], 'rgba(40,30,20,.45)', 0.005, null, [0.018, 0.012]); }
      for(let i=0;i<3;i++){ const px = k.R(x0, x1), py = k.R(y0, y1); k.c.save(); k.c.translate(px, py); k.c.rotate(k.R(-0.4, 0.4)); k.rr(-0.06, -0.045, 0.12, 0.09, 0.01); k.fill(shade(col, k.R(-0.25, 0.2))); k.c.strokeStyle = 'rgba(40,30,20,.55)'; k.c.lineWidth = 0.004; k.c.setLineDash([0.012, 0.008]); k.rr(-0.055, -0.04, 0.11, 0.08, 0.01); k.c.stroke(); k.c.setLineDash([]); k.c.restore(); }
      c.restore(); k.poly(pts); k.stroke('rgba(10,8,6,.6)', 0.012);
      for(let i=0;i<pts.length;i+=2){ const nx = pts[(i + 2)%pts.length], ny = pts[(i + 3)%pts.length], L = Math.hypot(nx - pts[i], ny - pts[i + 1]), n = Math.max(1, Math.round(L/0.3)); for(let j=1;j<n;j++){ const px = pts[i] + (nx - pts[i])*j/n, py = pts[i + 1] + (ny - pts[i + 1])*j/n; k.c.beginPath(); k.c.arc(px, py, 0.014, 0, 6.28); k.fill('#8a8478'); k.c.beginPath(); k.c.arc(px, py, 0.006, 0, 6.28); k.fill('#1a1612'); } } },
    wheel(k, x, y, w, h, gone){ if(gone){ k.rr(x - w*0.4, y - h*0.4, w*0.8, h*0.8, 0.02); k.fill('rgba(10,8,6,.6)'); return; } k.rr(x - w/2, y - h/2, w, h, Math.min(w, h)*0.3); k.fill('#1c1b1a'); for(let i=0;i<7;i++) k.line([x - w*0.38, y - h/2 + h*(i + 0.5)/7, x + w*0.38, y - h/2 + h*(i + 0.5)/7], '#46433f', h*0.05); },
    casings(k, x, y, w, h, n){ const c = k.c; for(let i=0;i<n;i++){ c.save(); c.translate(x + k.rnd()*w, y + k.rnd()*h); c.rotate(k.rnd()*6.28); c.fillStyle = k.pick(['#b8953a', '#a8853a', '#c9a24a']); c.fillRect(-0.018, -0.005, 0.036, 0.01); c.restore(); } },
    stencil(k, x, y, txt, size, col, a){ const c = k.c; c.save(); c.globalAlpha = a==null ? 0.7 : a; c.fillStyle = col || '#d8d0b0'; c.font = `700 ${size}px Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, x, y); c.restore(); },
    camo(k, x0, y0, w, h, cols){ for(let i=0;i<Math.round(w*h*6);i++) k.blot(x0 + k.rnd()*w, y0 + k.rnd()*h, k.R(0.08, 0.22), k.pick(cols), 0.55, 0.6); },
    net(k, pts, col){ const c = k.c; k.poly(pts); k.fill(col, 0.55); c.save(); k.poly(pts); c.clip(); const xs = pts.filter((_, i)=>i%2===0), ys = pts.filter((_, i)=>i%2===1), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      for(let x=x0;x<x1 + (y1 - y0);x+=0.12) k.line([x, y0, x - (y1 - y0), y1], 'rgba(20,24,14,.5)', 0.008); for(let x=x0 - (y1 - y0);x<x1;x+=0.12) k.line([x, y0, x + (y1 - y0), y1], 'rgba(20,24,14,.5)', 0.008); for(let i=0;i<Math.round((x1 - x0)*(y1 - y0)*25);i++) k.blot(k.R(x0, x1), k.R(y0, y1), k.R(0.04, 0.1), k.pick(['#4e5a34', '#5e6a3e', '#6a5e40', '#3e4a2a']), 0.85, 0.7); c.restore(); },
  };
  /* ---- Военные объекты (HD) ---- */
  function bunkerDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(2, 2, 1.95, 0.12); k.texFill(d.sod ? 'grass' : 'dirt', '#6f6a50'); // насыпь
    c.save(); k.organic(2, 2, 1.95, 0.12); c.clip(); c.fillStyle = k.lin(0, 0, 4, 4, [[0, 'rgba(255,250,240,.08)'], [1, 'rgba(0,0,0,.3)']]); c.fillRect(0, 0, 4, 4); if(d.sod) k.tufts(0, 0, 4, 4, 90); k.leaves(0, 0, 4, 4, 30); c.restore();
    const slab = ()=>k.rr(0.55, 0.55, 2.9, 2.6, 0.12);
    k.rr(0.65, 0.68, 2.9, 2.6, 0.12); k.fill('rgba(0,0,0,.4)'); slab(); k.texFill('concrete', '#8a8780'); slab(); k.stroke(k.INK, 0.016); k.bevel(slab, 0.04);
    c.save(); slab(); c.clip(); k.concreteDetail(0.55, 0.55, 2.9, 2.6, 0.5); for(let i=0;i<5;i++) k.line([k.R(0.6, 3.4), 0.55, k.R(0.6, 3.4), k.R(1.5, 3)], 'rgba(15,12,10,.5)', 0.012); for(let i=0;i<6;i++) k.streak(k.R(0.7, 3.3), k.R(0.6, 2.4), 0.6, 0.05, '#5a4a38', 0.25); if(d.sod) for(let i=0;i<5;i++) k.moss(k.R(0.8, 3.2), k.R(0.8, 3), k.R(0.15, 0.35)); c.restore();
    [[0.85, 0.62, 2.3, 0.08], [0.62, 1.2, 0.08, 1.3], [3.3, 1.2, 0.08, 1.3]].forEach(([x, y, w, h])=>{ k.rr(x, y, w, h, 0.02); k.fill('#0e0c0a'); }); // амбразуры
    ventPipe(k, 1.2, 1.3, 0.1); ventPipe(k, 2.9, 2.6, 0.08); c.beginPath(); c.arc(2.7, 1.2, 0.08, 0, 6.28); k.fill('#3a3e40'); k.stroke(k.INK, 0.01); k.rr(2.66, 1.1, 0.08, 0.05, 0.01); k.fill('#1a1d1e'); // перископ
    // вход: пандус, гермодверь
    k.poly([1.5, 3.15, 2.5, 3.15, 2.7, 4, 1.3, 4]); k.texFill('concrete', '#7a7670'); k.poly([1.5, 3.15, 2.5, 3.15, 2.7, 4, 1.3, 4]); k.stroke(k.INK, 0.012); for(let i=0;i<5;i++) k.line([1.45 - i*0.03, 3.3 + i*0.15, 2.55 + i*0.03, 3.3 + i*0.15], 'rgba(0,0,0,.3)', 0.012);
    k.rr(1.6, 3.12, 0.8, 0.12, 0.01); k.texFill('metal', '#6d7376', d.open ? null : '#4a5040', 0.3); k.stroke(k.INK, 0.01); if(d.open){ k.rr(1.6, 3.12, 0.8, 0.1, 0.01); k.fill('#0e0c0a'); }
    if(d.net) bits.net(k, [0.3, 0.4, 3.7, 0.3, 3.8, 3.4, 0.2, 3.5], '#4a5434');
    if(d.blast){ const x = 2.3, y = 1.9; k.organic(x, y, 0.75, 0.4, 0.6); k.fill('#0e0c0a'); c.save(); k.organic(x, y, 0.75, 0.4, 0.6); c.clip(); for(let i=0;i<6;i++) k.chunk(x + k.R(-0.5, 0.5), y + k.R(-0.4, 0.4), k.R(0.08, 0.16), '#6a6660', 0.03); c.restore(); for(let i=0;i<16;i++) k.rebar([x + k.R(-0.7, 0.7), y + k.R(-0.55, 0.55), x + k.R(-0.9, 0.9), y + k.R(-0.7, 0.7)]); for(let i=0;i<24;i++){ const a = k.rnd()*6.28, r = k.R(0.75, 1.6); k.chunk(x + Math.cos(a)*r, y + Math.sin(a)*r*0.8, k.R(0.05, 0.14), '#8a8780', 0.03); } k.radial(x, y, 1.4, '#0c0a08', 0.35); }
    if(d.camp){ k.tarp(0.1, 3.3, 0.9, 0.6, '#5a5a3e', 0.1); bits.barrel(k, 3.4, 3.5, 0.2, '#4a5a3a'); } }
  const BUNKER = [{n:'Бетонный, под дёрном', sod:true}, {n:'Под маскировочной сетью', net:true}, {n:'Вскрыт взрывом', blast:true, open:true}, {n:'Обжитой, дверь открыта', open:true, camp:true, sod:true}];
  function pillboxDraw(g, d){ const k = hk(g), c = k.c, x = 1, y = 1;
    k.organic(1, 1, 0.98, 0.15); k.texFill('dirt', '#776753'); c.save(); k.organic(1, 1, 0.98, 0.15); c.clip(); k.tufts(0, 0, 2, 2, 25); c.restore();
    const shape = ()=>{ if(d.hex){ c.beginPath(); for(let i=0;i<6;i++){ const a = i/6*6.28 + 0.52; c.lineTo(x + Math.cos(a)*0.78, y + Math.sin(a)*0.78); } c.closePath(); } else { c.beginPath(); c.arc(x, y, 0.78, 0, 6.28); } };
    c.save(); c.translate(0.1, 0.12); shape(); k.fill('rgba(0,0,0,.45)'); c.restore(); shape(); k.texFill('concrete', '#8a8780'); c.save(); shape(); c.clip(); k.concreteDetail(0.2, 0.2, 1.6, 1.6, 0.4); c.fillStyle = k.lin(0.2, 0.2, 1.8, 1.8, [[0, 'rgba(255,250,240,.18)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 2); for(let i=0;i<3;i++) k.line([k.R(0.4, 1.6), 0.25, k.R(0.6, 1.4), 1, k.R(0.4, 1.6), 1.75], 'rgba(15,12,10,.5)', 0.012); for(let i=0;i<4;i++) k.dent(k.R(0.5, 1.5), k.R(0.5, 1.5), 0.08); c.restore(); shape(); k.stroke(k.INK, 0.016);
    c.save(); c.scale(1, 1); c.beginPath(); c.arc(x, y, 0.42, 0, 6.28); k.texFill('concrete', '#7a7670'); k.stroke('rgba(0,0,0,.4)', 0.012); c.restore(); c.beginPath(); c.arc(x - 0.08, y - 0.08, 0.3, 0, 6.28); k.fill('rgba(255,250,240,.08)');
    [-Math.PI/2, -Math.PI/2 - 1.1, -Math.PI/2 + 1.1].forEach(a=>{ c.save(); c.translate(x + Math.cos(a)*0.7, y + Math.sin(a)*0.7); c.rotate(a + Math.PI/2); k.rr(-0.2, -0.05, 0.4, 0.1, 0.02); k.fill('#0c0a08'); k.line([-0.2, -0.06, 0.2, -0.06], 'rgba(255,250,240,.25)', 0.01); c.restore(); });
    k.poly([0.8, 1.7, 1.2, 1.7, 1.25, 2, 0.75, 2]); k.fill('#2a2420'); // ход сообщения
    if(d.bags) for(let i=0;i<14;i++){ const a = i/14*6.28; houseBits.sandbag(k, x + Math.cos(a)*0.86, y + Math.sin(a)*0.86, a + Math.PI/2); }
    if(d.ruined){ k.organic(1.4, 0.7, 0.45, 0.4, 0.35); k.fill('#0e0c0a'); for(let i=0;i<10;i++) k.rebar([1.4 + k.R(-0.4, 0.4), 0.7 + k.R(-0.35, 0.35), 1.4 + k.R(-0.5, 0.5), 0.7 + k.R(-0.45, 0.45)]); for(let i=0;i<16;i++) k.chunk(k.R(1.0, 1.95), k.R(0.1, 1.2), k.R(0.05, 0.13), '#8a8780', 0.03); } bits.casings(k, 0.3, 0.2, 1.4, 0.4, d.ruined ? 4 : 12); }
  const PILLBOX = [{n:'Круглый'}, {n:'Шестигранный', hex:true}, {n:'Обложен мешками', bags:true}, {n:'Разрушенный', ruined:true}];
  function checkpointDraw(g, d){ const k = hk(g), c = k.c;
    // будка
    k.rr(0.15 + 0.08, 0.25 + 0.1, 0.95, 1.5, 0.03); k.fill('rgba(0,0,0,.4)'); k.rr(0.15, 0.25, 0.95, 1.5, 0.03); if(d.scrap) bits.sheet(k, [0.15, 0.25, 1.1, 0.25, 1.1, 1.75, 0.15, 1.75], '#6a4a3a', true); else { k.texFill(d.burnt ? 'ash' : 'corrugated', '#7f8588', d.burnt ? null : d.col, 0.5); k.rr(0.15, 0.25, 0.95, 1.5, 0.03); k.stroke(k.INK, 0.014); }
    c.save(); k.rr(0.15, 0.25, 0.95, 1.5, 0.03); c.clip(); for(let i=0;i<4;i++) k.rust(k.R(0.2, 1.05), k.R(0.3, 1.7), k.R(0.04, 0.09), false); if(d.burnt){ k.organic(0.6, 1.0, 0.35, 0.4, 0.4); k.fill('#0c0a08'); k.radial(0.6, 1.0, 0.8, '#0c0a08', 0.4); } c.restore();
    ventPipe(k, 0.4, 0.5, 0.05); if(!d.burnt){ k.rr(1.05, 0.4, 0.07, 0.6, 0.01); k.fill('#2f3a3c'); k.line([1.07, 0.45, 1.1, 0.9], 'rgba(220,228,228,.3)', 0.008); }
    if(d.sign) bits.stencil(k, 0.62, 1.55, d.sign, 0.13, '#e4ddca', 0.8);
    // шлагбаум
    const px = 1.35, py = 1.25; k.rr(px - 0.12, py - 0.12, 0.24, 0.24, 0.02); k.fill('#3e4244'); k.stroke(k.INK, 0.01);
    const arm = d.arm==='up' ? [px, py, px + 0.55, py - 1.05] : d.arm==='broken' ? [px, py, px + 0.85, py + 0.05] : [px, py, 2.95, py];
    k.line(arm.map((v, i)=>v + (i%2 ? 0.05 : 0.04)), 'rgba(0,0,0,.35)', 0.1); c.save(); k.line(arm, '#d8d0bc', 0.09); const L = Math.hypot(arm[2] - arm[0], arm[3] - arm[1]); for(let t=0.08;t<1;t+=0.22) k.line([arm[0] + (arm[2] - arm[0])*t, arm[1] + (arm[3] - arm[1])*t, arm[0] + (arm[2] - arm[0])*Math.min(1, t + 0.11), arm[1] + (arm[3] - arm[1])*Math.min(1, t + 0.11)], '#8e2e26', 0.09); c.restore();
    if(d.arm==='broken'){ c.save(); c.translate(2.5, 1.6); c.rotate(0.5); k.line([-0.5, 0, 0.5, 0], '#d8d0bc', 0.09); k.line([-0.25, 0, 0, 0], '#8e2e26', 0.09); k.line([0.2, 0, 0.45, 0], '#8e2e26', 0.09); c.restore(); }
    k.rr(2.75, py - 0.08, 0.16, 0.16, 0.02); k.fill('#4a4e50');
    // блоки и мешки
    if(d.blocks) [[1.8, 0.35], [2.5, 0.35]].forEach(([x, y])=>{ k.rr(x + 0.04, y + 0.06, 0.55, 0.3, 0.03); k.fill('rgba(0,0,0,.35)'); k.rr(x, y, 0.55, 0.3, 0.03); k.texFill('concrete', '#8a8780', d.striped ? '#8e2e26' : null, 0.25); k.stroke(k.INK, 0.01); k.line([x + 0.03, y + 0.15, x + 0.52, y + 0.15], 'rgba(255,250,240,.3)', 0.03); });
    if(d.tires) for(let i=0;i<4;i++) k.tire(1.9 + i*0.3, 0.45 + (i%2)*0.15, 0.15); if(d.skulls){ bits.skull(k, 2.2, 1.8, 0.07, 0.2); bits.skull(k, 2.6, 1.85, 0.06, -0.3); k.line([2.9, 0.1, 2.9, 0.7], '#5e4630', 0.04); bits.skull(k, 2.9, 0.15, 0.08, 0); }
    if(d.bags) for(let i=0;i<5;i++) houseBits.sandbag(k, 1.9 + i*0.22, 1.85, 0); k.trash(0.1, 0.1, 2.8, 1.8, 8); }
  const CHECKPOINT = [{n:'Армейский', col:'#5a6040', sign:'СТОП', arm:'down', blocks:true, bags:true}, {n:'Полицейский', col:'#3e5a6a', sign:'ПОСТ', arm:'up', blocks:true, striped:true}, {n:'Брошенный, сгоревший', burnt:true, arm:'broken', blocks:true}, {n:'Рейдерский', scrap:true, arm:'down', tires:true, skulls:true}];
  function bagsArcDraw(g, d){ const k = hk(g), c = k.c, rows = d.rows || 2;
    if(d.spill) for(let i=0;i<3;i++) k.blot(k.R(0.5, 2.5), k.R(1.0, 1.7), k.R(0.12, 0.25), '#b8a888', 0.85);
    for(let r=0;r<rows;r++){ const R = 1.25 - r*0.24, n = 9 - r; for(let i=0;i<n;i++){ const a = Math.PI + (i + 0.5 + (r%2)*0.5)/n*Math.PI; if(d.gap && i===Math.floor(n/2) && r===0) continue; houseBits.sandbag(k, 1.5 + Math.cos(a)*R, 1.75 + Math.sin(a)*R*1.05, a + Math.PI/2); } }
    if(d.spill) for(let i=0;i<4;i++){ const a = Math.PI + k.R(0.3, 2.8), x = 1.5 + Math.cos(a)*1.25, y = 1.75 + Math.sin(a)*1.3; k.blot(x, y + 0.1, 0.18, '#c2ac7a', 0.9); c.save(); c.translate(x, y); c.rotate(a + Math.PI/2); c.beginPath(); c.ellipse(0, 0, 0.17, 0.06, 0, 0, 6.28); k.fill('#8c7850'); k.stroke('rgba(30,24,16,.6)', 0.008); c.restore(); }
    if(d.mg){ const x = 1.5, y = 1.2; [[0, 0.25], [-0.2, -0.12], [0.2, -0.12]].forEach(([dx, dy])=>k.line([x, y, x + dx, y + dy + 0.15], '#2a2826', 0.02)); k.rr(x - 0.05, y - 0.55, 0.1, 0.6, 0.02); k.fill('#1e1c1a'); k.rr(x - 0.12, y - 0.05, 0.24, 0.16, 0.02); k.fill('#2a2826'); k.stroke(k.INK, 0.008); k.line([x, y - 0.55, x, y - 0.9], '#141210', 0.03); k.rr(x + 0.12, y, 0.18, 0.12, 0.01); k.fill('#4a5a3a'); bits.casings(k, 1.0, 1.3, 1.0, 0.4, 26); k.line([x + 0.2, y + 0.06, x + 0.45, y + 0.2, x + 0.6, y + 0.15], '#a8853a', 0.02, 0.9, [0.02, 0.01]); }
    k.leaves(0, 0, 3, 2, 12); }
  const BAGS_ARC = [{n:'Двойной ряд', rows:2}, {n:'Осыпался', rows:2, spill:true, gap:true}, {n:'Пулемётное гнездо', rows:2, mg:true}];
  function bagsLineDraw(g, d){ const k = hk(g); for(let r=0;r<(d.rows || 2);r++) for(let i=0;i<(r ? 7 : 8);i++){ if(d.slits && r===0 && (i===2 || i===5)) continue; const x = 0.2 + i*0.37 + (r ? 0.18 : 0), y = 0.32 + r*0.36 + (d.sag ? Math.sin(i*0.8)*0.05 : 0); houseBits.sandbag(k, x, y, (d.sag ? k.R(-0.25, 0.25) : k.R(-0.06, 0.06))); }
    if(d.sag) for(let i=0;i<3;i++) k.blot(k.R(0.3, 2.7), k.R(0.6, 0.9), 0.12, '#b8a888', 0.8); if(d.slits) bits.casings(k, 0.3, 0.75, 2.4, 0.2, 10); k.tufts(0, 0.8, 3, 0.2, 6); }
  const BAGS_LINE = [{n:'Ровный ряд', rows:2}, {n:'Осевший, рваный', rows:2, sag:true}, {n:'С бойницами', rows:2, slits:true}];
  function hedgehogDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    const beam = (a, L, col)=>{ c.save(); c.translate(x, y); c.rotate(a); k.rr(-L/2 + 0.04, -0.055 + 0.06, L, 0.11, 0.01); k.fill('rgba(0,0,0,.35)'); k.rr(-L/2, -0.055, L, 0.11, 0.01); if(d.rail){ c.fillStyle = k.lin(0, -0.055, 0, 0.055, [[0, '#8a8e90'], [0.5, '#5a5e60'], [1, '#3a3e40']]); c.fill(); k.line([-L/2, 0, L/2, 0], 'rgba(255,255,255,.3)', 0.02); } else { c.fillStyle = k.lin(0, -0.055, 0, 0.055, [[0, shade(col, 0.2)], [1, shade(col, -0.35)]]); c.fill(); k.line([-L/2, -0.03, L/2, -0.03], 'rgba(0,0,0,.3)', 0.008); k.line([-L/2, 0.03, L/2, 0.03], 'rgba(0,0,0,.3)', 0.008); } k.stroke(k.INK, 0.008);
      for(let i=0;i<4;i++) k.rust(k.R(-L/2, L/2), 0, k.R(0.02, 0.04)*(d.rusty ? 1.8 : 1), false); c.restore(); };
    const col = d.rusty ? '#6a4a36' : '#4e5440'; beam(0.785, 1.1, col); beam(-0.785, 1.1, col); beam(0, 0.7, col); c.beginPath(); c.arc(x, y, 0.08, 0, 6.28); k.fill(shade(col, -0.2)); k.stroke(k.INK, 0.008);
    [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88], [0.15, 0.5], [0.85, 0.5]].forEach(([px, py])=>{ c.beginPath(); c.arc(px, py, 0.02, 0, 6.28); k.fill('#2a2826'); });
    if(d.wire){ for(let i=0;i<5;i++) k.line([0.1 + i*0.2, 0.15, 0.2 + i*0.2, 0.9], '#6a6e70', 0.008); for(let i=0;i<20;i++){ const px = k.R(0.1, 0.9), py = k.R(0.15, 0.9); k.line([px - 0.02, py - 0.02, px + 0.02, py + 0.02], '#6a6e70', 0.006); } } }
  const HEDGEHOG = [{n:'Крашеный'}, {n:'Ржавый', rusty:true}, {n:'Сварен из рельсов', rail:true}, {n:'Обмотан колючкой', rusty:true, wire:true}];
  function wireDraw(g, d){ const k = hk(g), c = k.c;
    if(d.posts){ for(let i=0;i<5;i++){ const x = 0.1 + i*0.7; c.beginPath(); c.arc(x + 0.02, 0.52, 0.05, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, 0.5, 0.045, 0, 6.28); k.fill('#5e4630'); k.stroke(k.INK, 0.008); } for(let j=0;j<3;j++){ const y = 0.42 + j*0.08; for(let i=0;i<4;i++) k.line([0.1 + i*0.7, y, 0.8 + i*0.7, y + (d.broken && i===2 ? 0.25 : 0)], '#3e4244', 0.016); for(let i=0;i<24;i++){ const px = k.R(0.1, 2.9), py = y; k.line([px - 0.015, py - 0.015, px + 0.015, py + 0.015], '#3e4244', 0.012); } } }
    else { const n = d.broken ? 7 : 10; for(let i=0;i<n;i++){ const cx = 0.18 + i*(d.broken && i > 4 ? 0.36 : 0.29) + (d.broken && i > 4 ? 0.4 : 0), sag = d.broken && i > 3 && i < 6 ? 0.15 : 0; c.beginPath(); c.ellipse(cx + 0.04, 0.55 + sag, 0.2, 0.34, 0, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.024); c.beginPath(); c.ellipse(cx, 0.5 + sag, 0.2, 0.34, 0.15, 0, 6.28); k.stroke('#3e4244', 0.02); c.beginPath(); c.ellipse(cx, 0.5 + sag, 0.2, 0.34, 0.15, 0, 6.28); k.stroke('#7a8084', 0.008); c.beginPath(); c.ellipse(cx, 0.5 + sag, 0.2, 0.34, 0.15, -0.5, 0.8); k.stroke('rgba(255,255,255,.3)', 0.006);
      for(let j=0;j<8;j++){ const a = j/8*6.28, px = cx + Math.cos(a)*0.2, py = 0.5 + sag + Math.sin(a)*0.34; k.line([px - 0.018, py, px + 0.018, py], '#3e4244', 0.012); k.line([px, py - 0.018, px, py + 0.018], '#3e4244', 0.012); } k.rust(cx, 0.5 + sag + 0.3, 0.02, false); } k.line([0, 0.53, 3, 0.53], 'rgba(0,0,0,.35)', 0.016); k.line([0, 0.5, 3, 0.5], '#3e4244', 0.014); }
    if(d.cans) for(let i=0;i<6;i++){ const x = 0.3 + i*0.45; k.line([x, 0.5, x, 0.62], '#5a5e60', 0.006); c.beginPath(); c.arc(x, 0.66, 0.035, 0, 6.28); c.fillStyle = k.lin(x - 0.035, 0.63, x + 0.035, 0.69, [[0, '#c8ccce'], [1, '#6a6e70']]); c.fill(); k.stroke(k.INK, 0.005); }
    k.tufts(0, 0, 3, 1, 10); }
  const WIRE = [{n:'Спираль (егоза)'}, {n:'На кольях', posts:true}, {n:'Порванная', broken:true}, {n:'С жестянками-сигнализацией', posts:true, cans:true}];
  function watchtowerDraw(g, d){ const k = hk(g), c = k.c;
    // опоры видны по углам из-под площадки, тень вытянута
    k.poly([0.25, 0.25, 1.75, 0.25, 2, 2, 0.5, 2]); k.fill('rgba(0,0,0,.28)');
    [[0.2, 0.2], [1.8, 0.2], [0.2, 1.8], [1.8, 1.8]].forEach(([x, y])=>{ k.line([x, y, x + 0.18, y + 0.22], 'rgba(0,0,0,.35)', 0.08); k.line([x, y, x + (x < 1 ? -0.08 : 0.08), y + (y < 1 ? -0.08 : 0.08)], d.metal ? '#4a4e50' : '#5e4630', 0.08); });
    if(d.ruined){ k.rr(0.3, 0.3, 1.4, 1.4, 0.02); k.texFill('wood', '#6b5236'); k.rr(0.3, 0.3, 1.4, 1.4, 0.02); k.stroke(k.INK, 0.014); for(let i=0;i<9;i++){ const a = i/9*6.28; houseBits.sandbag(k, 1 + Math.cos(a)*0.55, 1 + Math.sin(a)*0.55, a + Math.PI/2); } for(let i=0;i<4;i++) k.plank(k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.4, 0.8), 0.1, k.rnd()*6.28, '#4a3a28', true); k.c.beginPath(); k.c.arc(1.2, 0.8, 0.12, 0, 6.28); k.fill('#141210'); bits.casings(k, 0.6, 0.6, 0.8, 0.8, 14); return; }
    // крыша
    const roofP = [0.05, 0.05, 1.95, 0.05, 1.95, 1.95, 0.05, 1.95];
    if(d.metal){ k.fillP(roofP.map((v, i)=>v + (i%2 ? 0.08 : 0.06)), 'rgba(0,0,0,.35)'); k.poly(roofP); k.texFill('corrugated', '#7f8588', '#5a6040', 0.35); }
    else { k.fillP(roofP.map((v, i)=>v + (i%2 ? 0.08 : 0.06)), 'rgba(0,0,0,.35)'); [[0.05, 0.05, 1.95, 0.05, 1, 1], [1.95, 0.05, 1.95, 1.95, 1, 1], [1.95, 1.95, 0.05, 1.95, 1, 1], [0.05, 1.95, 0.05, 0.05, 1, 1]].forEach((p, i)=>{ k.poly(p); k.texFill('wood', '#6b5236'); k.poly(p); k.fill(['rgba(255,250,240,.12)', 'rgba(0,0,0,.15)', 'rgba(0,0,0,.32)', 'rgba(255,250,240,.04)'][i]); k.poly(p); k.stroke('rgba(10,8,6,.5)', 0.01); }); }
    k.poly(roofP); k.stroke(k.INK, 0.016); for(let i=0;i<5;i++) k.rust(k.R(0.2, 1.8), k.R(0.2, 1.8), k.R(0.04, 0.08), false); k.leaves(0.1, 0.1, 1.8, 1.8, 14);
    if(d.light){ c.save(); c.translate(1.65, 0.35); c.rotate(-0.6); k.rr(-0.14, -0.1, 0.28, 0.2, 0.04); k.fill('#3a3e40'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0, -0.1, 0.1, Math.PI, 0); k.fill('#d8d2bc'); c.restore(); }
    k.line([0.9, 1.95, 0.9, 2.0], '#5e4630', 0.02); k.line([1.1, 1.95, 1.1, 2.0], '#5e4630', 0.02); }
  const WATCHTOWER = [{n:'Деревянная'}, {n:'Металлическая', metal:true}, {n:'С прожектором', metal:true, light:true}, {n:'Без крыши, гнездо', ruined:true}];
  const BARRACKS = [
    {n:'Казарма', roof:'gable', mat:'corrugated', tint:'#5a6040', vents:[[1.5, 1.4], [4.5, 1.4]], antenna:[5.4, 0.5, 2.4], porch:[2.5, 2.55, 1.0, 0.4]},
    {n:'Казарма, провал крыши', roof:'gable', mat:'corrugated', tint:'#5a6040', dmg:2, vents:[[1.5, 1.4]], missing:3},
    {n:'Казарма, обжитая', roof:'gable', mat:'corrugated', tint:'#6a6a50', tarp:[3.6, 0.6, 1.4, 0.9, '#4a5a34', 0.05], solar:[0.6, 1.7, 1.2, 0.6], vents:[[2.4, 0.8]]},
    {n:'Казарма, сгоревшая', dmg:3},
  ];
  function ammoDraw(g, d){ const k = hk(g), c = k.c;
    const box = (x, y, w, h, a, open, empty)=>{ c.save(); c.translate(x, y); c.rotate(a); k.rr(-w/2 + 0.04, -h/2 + 0.05, w, h, 0.02); k.fill('rgba(0,0,0,.38)'); k.rr(-w/2, -h/2, w, h, 0.02); k.texFill('wood', '#6b5236', '#4e5a34', 0.6); k.rr(-w/2, -h/2, w, h, 0.02); k.stroke(k.INK, 0.012);
      if(open){ k.rr(-w/2 + 0.04, -h/2 + 0.04, w - 0.08, h - 0.08, 0.01); k.fill('#1a1814'); if(!empty) for(let i=0;i<5;i++) for(let j=0;j<2;j++){ c.save(); c.translate(-w/2 + 0.1 + i*(w - 0.2)/4, -h/4 + j*h/2.2); k.rr(-0.025, -h*0.18, 0.05, h*0.36, 0.02); c.fillStyle = k.lin(-0.025, 0, 0.025, 0, [[0, '#d0aa50'], [1, '#8a6a2a']]); c.fill(); c.restore(); } else for(let i=0;i<3;i++) k.plank(k.R(-w/3, w/3), k.R(-h/4, h/4), 0.25, 0.06, k.rnd()*6.28, '#4a5a34', true); }
      else { k.line([-w/2 + 0.04, -h/2 + 0.08, w/2 - 0.04, -h/2 + 0.08], 'rgba(0,0,0,.3)', 0.012); bits.stencil(k, 0, 0.02, '7.62', h*0.24, '#d8d0b0', 0.7); [[-w/2 + 0.08, 0], [w/2 - 0.08, 0]].forEach(([lx, ly])=>{ k.rr(lx - 0.025, ly - 0.05, 0.05, 0.1, 0.01); k.fill('#2a2826'); }); k.line([-w*0.2, h/2 + 0.02, w*0.2, h/2 + 0.02], '#8a7a5a', 0.02); }
      c.restore(); };
    if(d.stack){ box(0.48, 0.58, 0.8, 0.45, 0.05, false); box(0.52, 0.42, 0.75, 0.42, -0.08, false); return; }
    if(d.zinc){ k.rr(0.2 + 0.03, 0.25 + 0.04, 0.6, 0.5, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(0.2, 0.25, 0.6, 0.5, 0.02); c.fillStyle = k.lin(0.2, 0.25, 0.8, 0.75, [[0, '#b8bcbe'], [1, '#6a6e70']]); c.fill(); k.stroke(k.INK, 0.01); k.rr(0.25, 0.3, 0.5, 0.4, 0.01); k.stroke('rgba(0,0,0,.4)', 0.008); k.line([0.25, 0.3, 0.75, 0.3, 0.7, 0.25], '#5a5e60', 0.012); bits.stencil(k, 0.5, 0.52, '5.45', 0.09, '#2a2826', 0.7); bits.casings(k, 0.1, 0.75, 0.8, 0.2, 6); return; }
    box(0.5, 0.5, 0.8, 0.48, 0, d.open, d.empty); if(d.open) bits.casings(k, 0.1, 0.78, 0.8, 0.18, d.empty ? 3 : 8); if(d.empty){ k.plank(0.25, 0.15, 0.5, 0.08, 0.3, '#4a5a34', true); } }
  const AMMO = [{n:'Закрытый'}, {n:'Открытый, с патронами', open:true}, {n:'Пустой, разбитый', open:true, empty:true}, {n:'Два ящика', stack:true}, {n:'Цинк', zinc:true}];
  function rifle(k, x, y, a, len, wood){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a); k.rr(-len/2 + 0.02, -0.035 + 0.03, len, 0.07, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(-len/2, -0.03, len*0.35, 0.06, 0.02); k.fill(wood ? '#5e4630' : '#2a2826'); k.rr(-len*0.15, -0.025, len*0.45, 0.05, 0.01); k.fill('#2a2a28'); k.rr(len*0.3, -0.012, len*0.2, 0.024, 0.005); k.fill('#1a1a18'); k.rr(-len*0.05, 0.02, 0.05, 0.07, 0.01); k.fill('#232321'); k.line([-len*0.1, -0.026, len*0.25, -0.026], 'rgba(255,255,255,.18)', 0.008); c.restore(); }
  function rackDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05 + 0.05, 0.25 + 0.06, 1.9, 0.5, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(0.05, 0.25, 1.9, 0.5, 0.02); k.texFill('wood', '#6b5236', d.mil ? '#4e5a34' : null, 0.4); k.rr(0.05, 0.25, 1.9, 0.5, 0.02); k.stroke(k.INK, 0.012);
    for(let i=0;i<6;i++){ const x = 0.25 + i*0.3; k.rr(x - 0.03, 0.28, 0.06, 0.44, 0.01); k.fill('rgba(0,0,0,.35)'); }
    const n = d.full ? 6 : d.few || 0; for(let i=0;i<n;i++){ const x = 0.25 + i*0.3 + (d.full ? 0 : 0.3); rifle(k, x, 0.5, Math.PI/2 + k.R(-0.05, 0.05), 0.85, i%2===0); }
    if(d.broken){ k.plank(1.4, 0.55, 0.8, 0.12, 0.4, '#5e4630', true); k.trash(0.1, 0.1, 1.8, 0.9, 6); bits.casings(k, 0.1, 0.8, 1.8, 0.2, 5); } }
  const RACK = [{n:'Полная', full:true, mil:true}, {n:'Почти пустая', few:2, mil:true}, {n:'Пустая, сломанная', broken:true}];
  function labDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05 + 0.05, 0.1 + 0.06, 1.9, 0.8, 0.02); k.fill('rgba(0,0,0,.35)'); k.rr(0.05, 0.1, 1.9, 0.8, 0.02); c.fillStyle = k.lin(0, 0.1, 0, 0.9, [[0, '#d6d6ce'], [1, '#a8a8a0']]); c.fill(); k.stroke(k.INK, 0.012); k.line([0.07, 0.13, 1.93, 0.13], 'rgba(255,255,255,.5)', 0.01);
    c.save(); k.rr(0.05, 0.1, 1.9, 0.8, 0.02); c.clip(); for(let i=0;i<5;i++) k.blot(k.R(0.2, 1.8), k.R(0.2, 0.8), k.R(0.04, 0.1), k.pick(['#7a8a3a', '#5a4a6a', '#8a5a3a']), 0.35); if(d.spill){ k.blot(1.0, 0.55, 0.35, '#8ab83a', 0.55); k.radial(1.0, 0.55, 0.5, '#c8f060', 0.3); for(let i=0;i<10;i++){ c.beginPath(); c.arc(1.0 + k.R(-0.3, 0.3), 0.55 + k.R(-0.25, 0.25), 0.015, 0, 6.28); k.stroke('rgba(230,250,190,.6)', 0.005); } } c.restore();
    const flask = (x, y, r, col, broken)=>{ c.beginPath(); c.arc(x + 0.02, y + 0.025, r, 0, 6.28); k.fill('rgba(0,0,0,.3)'); if(broken){ for(let i=0;i<5;i++) k.fillP([x + k.R(-r, r), y + k.R(-r, r), x + k.R(-r, r), y + k.R(-r, r), x + k.R(-r, r), y + k.R(-r, r)], 'rgba(200,220,220,.6)'); k.blot(x, y, r*1.4, col, 0.45); return; } c.beginPath(); c.arc(x, y, r, 0, 6.28); k.fill('rgba(210,225,225,.45)'); k.stroke('rgba(60,70,70,.7)', 0.006); c.beginPath(); c.arc(x, y, r*0.7, 0, 6.28); k.fill(col, 0.8); c.beginPath(); c.arc(x - r*0.3, y - r*0.3, r*0.25, 0, 6.28); k.fill('rgba(255,255,255,.6)'); c.beginPath(); c.arc(x, y, r*0.25, 0, 6.28); k.fill('rgba(240,245,245,.7)'); };
    flask(0.3, 0.35, 0.09, '#8ab83a', d.wrecked); flask(0.5, 0.3, 0.07, '#5ad1d6', false); flask(0.42, 0.6, 0.1, '#9d6cd6', d.wrecked); flask(0.7, 0.5, 0.06, '#e07a2a', d.spill);
    for(let i=0;i<6;i++){ c.beginPath(); c.arc(0.9 + i*0.06, 0.25, 0.022, 0, 6.28); k.fill('rgba(210,225,225,.6)'); k.stroke('rgba(60,70,70,.6)', 0.004); } k.rr(0.86, 0.2, 0.4, 0.1, 0.01); k.stroke('#4a4e50', 0.01);
    c.save(); c.translate(1.62, 0.48); c.rotate(d.wrecked ? 1.3 : 0); k.rr(-0.13, -0.1, 0.26, 0.2, 0.03); k.fill('#2a2e30'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(0.05, 0, 0.05, 0, 6.28); k.fill('#5a5e60'); k.line([0.05, 0, 0.18, -0.14], '#3a3e40', 0.03); c.restore();
    [[1.2, 0.7, 0.3], [1.3, 0.62, -0.2]].forEach(([x, y, a])=>{ c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.12, -0.08, 0.24, 0.16, 0.005); k.fill('#d8d2c0'); for(let i=0;i<4;i++) k.line([-0.1, -0.05 + i*0.035, 0.08, -0.05 + i*0.035], 'rgba(40,36,30,.4)', 0.006); c.restore(); });
    if(d.wrecked){ k.trash(0, 0, 2, 1, 10); k.dent(0.9, 0.6, 0.15); } }
  const LAB = [{n:'Рабочий'}, {n:'Разгромленный', wrecked:true}, {n:'С токсичным разливом', spill:true}];
  function vaultDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0, 0.2, 3, 0.6, 0.02); k.texFill('concrete', '#7a7670'); k.rr(0, 0.2, 3, 0.6, 0.02); k.stroke(k.INK, 0.014); for(let i=0;i<4;i++) k.streak(k.R(0.2, 2.8), 0.25, 0.5, 0.05, '#4a3a2a', 0.3);
    const cx = d.open ? 1.5 : 1.5, cy = 0.5; c.beginPath(); c.arc(cx, cy, 0.5, 0, 6.28); k.fill('#141210'); k.stroke(k.INK, 0.014);
    const door = (x, y)=>{ c.beginPath(); c.arc(x + 0.05, y + 0.06, 0.47, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); for(let i=0;i<24;i++){ const a = i/24*6.28, r = i%2 ? 0.47 : 0.43; c.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r); } c.closePath(); k.texFill('metal', '#8a9094', d.rust ? '#6a4a36' : '#9a8a40', d.rust ? 0.5 : 0.3); k.stroke(k.INK, 0.012);
      c.beginPath(); c.arc(x, y, 0.32, 0, 6.28); k.stroke('rgba(0,0,0,.45)', 0.02); c.beginPath(); c.arc(x - 0.01, y - 0.01, 0.32, 0, 6.28); k.stroke('rgba(255,255,255,.2)', 0.008); for(let i=0;i<12;i++){ const a = i/12*6.28; c.beginPath(); c.arc(x + Math.cos(a)*0.38, y + Math.sin(a)*0.38, 0.018, 0, 6.28); k.fill('#4a4e50'); }
      bits.stencil(k, x, y, d.num || '101', 0.16, '#2a2826', 0.6); if(d.rust) for(let i=0;i<6;i++) k.rust(x + k.R(-0.35, 0.35), y + k.R(-0.35, 0.35), k.R(0.03, 0.07), false); };
    if(d.open){ door(2.35, 0.5); k.rr(1.9, 0.42, 0.25, 0.16, 0.02); k.fill('#4a4e50'); k.stroke(k.INK, 0.01); k.radial(1.5, 0.5, 0.45, '#2a2420', 0.6); bits.stencil(k, 1.5, 0.5, '', 0.1); }
    else { door(cx, cy); k.rr(1.95, 0.42, 0.18, 0.16, 0.02); k.fill('#4a4e50'); k.stroke(k.INK, 0.01); }
    if(d.blown){ for(let i=0;i<14;i++) k.chunk(k.R(0.9, 2.1), k.R(0.0, 1.0), k.R(0.04, 0.1), '#8a8780', 0.02); k.radial(1.5, 0.5, 0.8, '#0c0a08', 0.4); }
    [[0.25, 0.5], [2.75, 0.5]].forEach(([x, y])=>{ k.rr(x - 0.12, y - 0.18, 0.24, 0.36, 0.02); k.fill('#c8a030', 0.85); for(let i=0;i<4;i++) k.line([x - 0.12, y - 0.18 + i*0.12, x + 0.12, y - 0.06 + i*0.12], '#1e1c1a', 0.04); }); }
  const VAULT = [{n:'Закрыта', num:'101'}, {n:'Открыта', open:true, num:'34'}, {n:'Ржавая, вскрытая', rust:true, blown:true, num:'7'}];
  function radarDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.55 + 0.06, 0.55 + 0.08, 0.9, 0.9, 0.04); k.fill('rgba(0,0,0,.35)'); k.rr(0.55, 0.55, 0.9, 0.9, 0.04); k.texFill('metal', '#6d7376', '#4e5440', 0.3); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(1, 1, 0.22, 0, 6.28); k.fill('#3e4244'); k.stroke(k.INK, 0.01);
    if(d.lattice){ c.save(); c.translate(1, 0.85); c.rotate(-0.2); k.rr(-0.9 + 0.06, -0.16 + 0.08, 1.8, 0.32, 0.02); k.fill('rgba(0,0,0,.35)'); for(let i=0;i<=12;i++) k.line([-0.9 + i*0.15, -0.16, -0.9 + i*0.15, 0.16], '#6a6e70', 0.012); k.line([-0.9, -0.16, 0.9, -0.16], '#6a6e70', 0.02); k.line([-0.9, 0.16, 0.9, 0.16], '#6a6e70', 0.02); for(let i=0;i<12;i++) k.line([-0.9 + i*0.15, -0.16, -0.75 + i*0.15, 0.16], '#5a5e60', 0.008); c.restore(); return; }
    c.save(); c.translate(1, 0.95); c.rotate(d.broken ? 0.7 : -0.15); c.beginPath(); c.ellipse(0.06, 0.08, 0.85, 0.5, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(0, 0, 0.85, 0.5, 0, 0, 6.28); c.fillStyle = k.lin(-0.85, -0.5, 0.85, 0.5, [[0, '#d6d6ce'], [0.6, '#9a9a92'], [1, '#6a6a64']]); c.fill(); k.stroke(k.INK, 0.012);
      for(let i=0;i<8;i++){ const a = i/8*6.28; k.line([0, 0, Math.cos(a)*0.85, Math.sin(a)*0.5], 'rgba(0,0,0,.2)', 0.01); } c.beginPath(); c.ellipse(0, 0, 0.5, 0.3, 0, 0, 6.28); k.stroke('rgba(0,0,0,.2)', 0.01); [[0.4, 0.3], [-0.4, 0.3], [0, -0.45]].forEach(([x, y])=>k.line([x*0.9, y*0.9, 0, -0.05], '#4a4e50', 0.015)); c.beginPath(); c.arc(0, -0.05, 0.05, 0, 6.28); k.fill('#3a3e40');
      for(let i=0;i<5;i++) k.rust(k.R(-0.6, 0.6), k.R(-0.35, 0.35), k.R(0.03, 0.08), false); if(d.broken){ k.organic(0.3, 0.1, 0.25, 0.5, 0.18); k.fill('#141210'); k.dent(-0.3, -0.1, 0.2); } c.restore(); }
  const RADAR = [{n:'Тарелка'}, {n:'Решётчатая антенна', lattice:true}, {n:'Разбитая', broken:true}];
  // Танк: корпус, гусеницы с траками, башня с люками и стволом, решётки МТО, ящики, бочки
  function tankDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    if(!d.burnt){ c.save(); c.globalAlpha = 0.35; c.beginPath(); c.ellipse(1.05, 1.6, 0.9, 1.3, 0, 0, 6.28); k.fill('#16130f'); c.restore(); }
    [[0.05, 0.42], [1.53, 0.42]].forEach(([x, w])=>{ k.rr(x + 0.05, 0.25 + 0.06, w, 2.55, 0.12); k.fill('rgba(0,0,0,.38)'); k.rr(x, 0.25, w, 2.55, 0.12); k.fill('#232220'); for(let y=0.3;y<2.75;y+=0.11){ k.line([x + 0.03, y, x + w - 0.03, y], d.burnt ? '#5a4a3e' : '#4a4844', 0.04); k.line([x + 0.03, y - 0.02, x + w - 0.03, y - 0.02], 'rgba(255,255,255,.08)', 0.01); } for(let i=0;i<4;i++) k.rust(x + w/2, k.R(0.4, 2.6), 0.05, false); });
    if(d.trackOff){ k.rr(1.53, 0.25, 0.42, 2.55, 0.12); k.fill('#141210'); for(let i=0;i<6;i++){ k.c.beginPath(); k.c.arc(1.74, 0.5 + i*0.38, 0.14, 0, 6.28); k.fill('#3a3836'); k.stroke(k.INK, 0.01); } k.c.save(); k.c.translate(1.8, 2.95); k.c.rotate(0.15); for(let i=0;i<10;i++){ k.rr(-0.6 + i*0.12, -0.05, 0.1, 0.12, 0.01); k.fill('#2a2826'); } k.c.restore(); }
    const hull = [0.42, 0.2, 1.58, 0.2, 1.62, 0.45, 1.62, 2.75, 1.55, 2.85, 0.45, 2.85, 0.38, 2.75, 0.38, 0.45];
    k.fillP(hull.map((v, i)=>v + (i%2 ? 0.08 : 0.06)), 'rgba(0,0,0,.4)'); k.poly(hull); k.texFill('metal', '#6d7376', col, 0.62); c.save(); k.poly(hull); c.clip(); c.fillStyle = k.lin(0.38, 0, 1.62, 0, [[0, 'rgba(0,0,0,.3)'], [0.4, 'rgba(255,250,240,.1)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 3);
      if(d.camo && !d.burnt) bits.camo(k, 0.4, 0.2, 1.2, 2.6, ['#3e4a2a', '#5a4a34', '#6a6a48']); if(d.burnt) for(let i=0;i<12;i++) k.blot(k.R(0.5, 1.5), k.R(0.3, 2.7), k.R(0.08, 0.2), k.pick(['#7a4126', '#9a5a30', '#b8b2a6', '#0c0b0a']), 0.6); else for(let i=0;i<8;i++) k.rust(k.R(0.45, 1.55), k.R(0.3, 2.7), k.R(0.04, 0.1), false);
      if(d.overgrown){ for(let i=0;i<6;i++) k.moss(k.R(0.5, 1.5), k.R(0.4, 2.6), k.R(0.12, 0.25)); k.tufts(0.4, 0.3, 1.2, 2.5, 20); } c.restore(); k.poly(hull); k.stroke(k.INK, 0.016);
    k.seam([0.42, 0.55, 1.58, 0.55]); for(let i=0;i<7;i++) k.line([0.55 + i*0.13, 2.3, 0.55 + i*0.13, 2.75], '#1e1c1a', 0.04); k.rr(0.5, 2.25, 1.0, 0.55, 0.02); k.stroke('rgba(0,0,0,.4)', 0.012);
    if(!d.burnt){ bits.barrel(k, 0.62, 2.9, 0.13, '#4a4e3a'); bits.barrel(k, 1.38, 2.9, 0.13, '#4a4e3a'); } [[0.5, 0.75, 0.25, 0.3], [1.25, 0.75, 0.25, 0.3]].forEach(([x, y, w, h])=>{ k.rr(x, y, w, h, 0.01); k.texFill('metal', '#6d7376', col, 0.5); k.stroke(k.INK, 0.01); });
    const turret = (tx, ty, a)=>{ c.save(); c.translate(tx, ty); c.rotate(a); k.rr(-0.04, -1.35 + 0.05, 0.12, 1.0, 0.03); k.fill('rgba(0,0,0,.35)'); k.rr(-0.055, -1.35, 0.11, 1.0, 0.03); c.fillStyle = k.lin(-0.055, 0, 0.055, 0, [[0, shade(col, -0.3)], [0.5, shade(col, 0.15)], [1, shade(col, -0.4)]]); c.fill(); k.stroke(k.INK, 0.01); k.rr(-0.08, -1.38, 0.16, 0.12, 0.02); k.fill(shade(col, -0.35)); k.stroke(k.INK, 0.008); k.c.beginPath(); k.c.arc(0, -1.38, 0.035, 0, 6.28); k.fill('#0c0a08');
      k.organic(0.06, 0.08, 0.5, 0.12, 0.42); k.fill('rgba(0,0,0,.4)'); k.organic(0, 0, 0.5, 0.12, 0.42); k.texFill('metal', '#6d7376', col, 0.62); c.fillStyle = k.lin(-0.5, -0.4, 0.5, 0.4, [[0, 'rgba(255,250,240,.15)'], [1, 'rgba(0,0,0,.35)']]); k.organic(0, 0, 0.5, 0.12, 0.42); c.fill(); k.stroke(k.INK, 0.014);
      [[-0.18, 0.08], [0.18, 0.12]].forEach(([hx, hy], i)=>{ k.c.beginPath(); k.c.arc(hx, hy, 0.12, 0, 6.28); if(d.burnt || (d.hatchOpen && i===0)) k.fill('#0e0c0a'); else { k.texFill('metal', '#6d7376', col, 0.5); k.stroke(k.INK, 0.01); k.line([hx - 0.08, hy, hx + 0.08, hy], 'rgba(0,0,0,.4)', 0.012); } });
      k.line([0.25, -0.2, 0.42, -0.42], '#1e1c1a', 0.02); if(!d.burnt) k.rr(-0.4, 0.22, 0.25, 0.14, 0.01), k.fill('#4a4e3a'); c.restore(); };
    if(d.turretOff){ k.c.beginPath(); k.c.arc(1, 1.35, 0.42, 0, 6.28); k.fill('#0e0c0a'); k.stroke(k.INK, 0.012); for(let i=0;i<12;i++){ const a = i/12*6.28; k.c.beginPath(); k.c.arc(1 + Math.cos(a)*0.38, 1.35 + Math.sin(a)*0.38, 0.02, 0, 6.28); k.fill('#5a5e60'); } turret(0.35, 2.4, 2.4); }
    else turret(1, 1.35, d.turretRot || 0);
    if(d.burnt) k.radial(1, 1.5, 1.5, '#0c0a08', 0.3); }
  const TANK = [{n:'Остов танка, камуфляж', col:'#5a6040', camo:true, hatchOpen:true}, {n:'Сорвана башня', col:'#5a5e48', turretOff:true}, {n:'Сгоревший, сбита гусеница', burnt:true, trackOff:true, turretRot:0.5}, {n:'Ржавый, заросший', col:'#6a5a46', overgrown:true, turretRot:-0.3}];
  function apcDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    [0.75, 1.5, 2.35, 3.1].forEach((y, i)=>{ [[0.1, 0], [1.9, 1]].forEach(([x, s])=>{ bits.wheel(k, x, y, 0.22, 0.48, d.noWheels && (i + s)%2===0 || d.burnt && i===2); }); });
    const hull = [1, 0.05, 1.7, 0.45, 1.82, 0.7, 1.82, 3.75, 1.7, 3.92, 0.3, 3.92, 0.18, 3.75, 0.18, 0.7, 0.3, 0.45];
    k.fillP(hull.map((v, i)=>v + (i%2 ? 0.09 : 0.07)), 'rgba(0,0,0,.4)'); k.poly(hull); k.texFill('metal', '#6d7376', col, 0.62); c.save(); k.poly(hull); c.clip(); c.fillStyle = k.lin(0.18, 0, 1.82, 0, [[0, 'rgba(0,0,0,.35)'], [0.45, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.38)']]); c.fillRect(0, 0, 2, 4);
      k.fillP([1, 0.05, 1.7, 0.45, 0.3, 0.45], 'rgba(255,250,240,.1)'); if(d.burnt) for(let i=0;i<14;i++) k.blot(k.R(0.3, 1.7), k.R(0.5, 3.8), k.R(0.08, 0.2), k.pick(['#7a4126', '#9a5a30', '#b8b2a6', '#0c0b0a']), 0.6); else { bits.camo(k, 0.2, 0.4, 1.6, 3.5, ['#3e4a2a', '#5a4a34', '#6a6a48']); for(let i=0;i<10;i++) k.rust(k.R(0.25, 1.75), k.R(0.5, 3.8), k.R(0.04, 0.1), false); } c.restore(); k.poly(hull); k.stroke(k.INK, 0.016);
    k.seam([0.3, 0.45, 1.7, 0.45]); [[0.55, 0.65], [1.3, 0.65]].forEach(([x, y])=>{ k.rr(x - 0.15, y, 0.3, 0.25, 0.02); k.fill('#2a3436'); k.stroke(k.INK, 0.008); });
    [[0.6, 2.0], [1.4, 2.0], [0.6, 2.7], [1.4, 2.7]].forEach(([x, y], i)=>{ k.rr(x - 0.18, y - 0.15, 0.36, 0.3, 0.03); if(d.burnt || (d.open && i < 2)) k.fill('#0e0c0a'); else { k.texFill('metal', '#6d7376', col, 0.5); k.stroke(k.INK, 0.01); } });
    for(let i=0;i<8;i++) k.line([0.5 + i*0.13, 3.3, 0.5 + i*0.13, 3.75], '#1e1c1a', 0.035);
    c.save(); c.translate(1, 1.35); k.c.beginPath(); k.c.arc(0.05, 0.06, 0.3, 0, 6.28); k.fill('rgba(0,0,0,.4)'); k.c.beginPath(); k.c.arc(0, 0, 0.3, 0, 6.28); k.texFill('metal', '#6d7376', col, 0.6); k.stroke(k.INK, 0.012); k.rr(-0.03, -0.85, 0.06, 0.6, 0.02); k.fill('#232321'); k.rr(0.08, -0.5, 0.04, 0.3, 0.01); k.fill('#232321'); k.c.beginPath(); k.c.arc(0, 0.08, 0.1, 0, 6.28); k.fill(d.burnt ? '#0e0c0a' : '#3a3e40'); c.restore();
    if(!d.burnt){ k.rr(0.25, 3.0, 0.3, 0.2, 0.01); k.fill('#4a4e3a'); k.stroke(k.INK, 0.008); k.line([1.5, 0.9, 1.7, 1.5], '#1e1c1a', 0.015); } k.leaves(0.2, 0.2, 1.6, 3.6, 12); }
  const APC = [{n:'Остов БТР', col:'#5a6040', open:true}, {n:'Сгоревший', burnt:true}, {n:'Без колёс', col:'#5e5a46', noWheels:true}];
  function mineDraw(g, d){ const k = hk(g), c = k.c;
    if(d.exposed){ k.organic(0.5, 0.55, 0.3, 0.3, 0.26); k.texFill('dirt', '#6a5a46'); const x = 0.5, y = 0.52; c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.22, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.22, 0, 6.28); c.fillStyle = k.lin(x - 0.2, y - 0.2, x + 0.2, y + 0.2, [[0, '#7a8064'], [1, '#3a3e2e']]); c.fill(); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x, y, 0.14, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.008); c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#2a2e22'); k.stroke('#8a8e70', 0.006); k.rust(x + 0.1, y + 0.08, 0.04, false); k.c.save(); k.c.beginPath(); k.c.arc(x, y + 0.12, 0.2, 0, Math.PI); k.c.restore(); k.organic(x, y + 0.14, 0.24, 0.3, 0.08); k.texFill('dirt', '#6a5a46'); return; }
    if(d.trip){ k.line([0.05, 0.3, 0.95, 0.75], '#b8b0a0', 0.006); [[0.05, 0.3], [0.95, 0.75]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#5e4630'); }); c.beginPath(); c.arc(0.12, 0.42, 0.06, 0, 6.28); k.fill('#4a5236'); k.stroke(k.INK, 0.006); for(let i=0;i<4;i++) k.line([0.07, 0.38 + i*0.03, 0.17, 0.38 + i*0.03], 'rgba(0,0,0,.4)', 0.004); k.rr(0.1, 0.33, 0.04, 0.04, 0.005); k.fill('#8a8e70'); k.tufts(0, 0, 1, 1, 6); return; }
    c.beginPath(); c.arc(0.52, 0.88, 0.04, 0, 6.28); k.fill('rgba(0,0,0,.35)'); k.line([0.5, 0.86, 0.5, 0.6], '#5e4630', 0.035);
    const tri = [0.5, 0.08, 0.9, 0.72, 0.1, 0.72]; k.fillP(tri.map((v, i)=>v + (i%2 ? 0.04 : 0.03)), 'rgba(0,0,0,.35)'); k.poly(tri); k.fill('#8e2e26'); k.poly(tri); k.stroke(k.INK, 0.012); k.poly([0.5, 0.2, 0.8, 0.66, 0.2, 0.66]); k.fill('#d8d0bc');
    if(d.skull) bits.skull(k, 0.5, 0.48, 0.1, 0); else bits.stencil(k, 0.5, 0.5, 'МИНЫ', 0.11, '#1e1c1a', 0.9);
    c.save(); k.poly(tri); c.clip(); for(let i=0;i<3;i++) k.rust(k.R(0.3, 0.7), k.R(0.3, 0.65), 0.03, false); erode(k, 0.1, 0.08, 0.8, 0.64, 0.1); c.restore(); k.tufts(0, 0.7, 1, 0.3, 5); }
  const MINE = [{n:'Знак «Мины»'}, {n:'Знак с черепом', skull:true}, {n:'Обнаруженная мина', exposed:true}, {n:'Растяжка', trip:true}];
  function turretDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.55;
    k.rr(0.1 + 0.04, 0.15 + 0.05, 0.8, 0.8, 0.05); k.fill('rgba(0,0,0,.38)'); k.rr(0.1, 0.15, 0.8, 0.8, 0.05); if(d.scrap) bits.sheet(k, [0.1, 0.15, 0.9, 0.15, 0.9, 0.95, 0.1, 0.95], '#6a4a3a', false); else { k.texFill('metal', '#6d7376', '#4a5040', 0.4); k.rr(0.1, 0.15, 0.8, 0.8, 0.05); k.stroke(k.INK, 0.01); } [[0.17, 0.22], [0.83, 0.22], [0.17, 0.88], [0.83, 0.88]].forEach(([px, py])=>{ k.c.beginPath(); k.c.arc(px, py, 0.02, 0, 6.28); k.fill('#2a2826'); });
    c.save(); c.translate(x, y); c.rotate(d.broken ? 1.0 : -0.2); [[-0.07], [0.07]].forEach(([dx])=>{ k.rr(dx - 0.025, -0.52, 0.05, 0.4, 0.01); k.fill('#1e1e1c'); k.stroke(k.INK, 0.006); });
      k.c.beginPath(); k.c.arc(0.03, 0.04, 0.24, 0, 6.28); k.fill('rgba(0,0,0,.35)'); k.c.beginPath(); k.c.arc(0, 0, 0.24, 0, 6.28); k.c.fillStyle = k.lin(-0.24, -0.24, 0.24, 0.24, [[0, '#8a9094'], [1, '#3e4244']]); k.c.fill(); k.stroke(k.INK, 0.01); k.rr(-0.12, -0.2, 0.24, 0.1, 0.02); k.fill('#2a2e30'); k.c.beginPath(); k.c.arc(0, -0.15, 0.035, 0, 6.28); k.fill(d.broken ? '#2a1010' : '#d84a2e'); if(!d.broken) k.radial(0, -0.15, 0.12, '#ff5a3a', 0.35);
      k.rr(0.12, -0.05, 0.12, 0.16, 0.01); k.fill('#4a4e3a'); if(d.broken){ k.dent(0.05, 0.05, 0.12); k.line([-0.1, 0.05, 0.1, 0.12], 'rgba(220,220,220,.5)', 0.006); } c.restore();
    if(!d.broken) bits.casings(k, 0.1, 0.1, 0.8, 0.8, 10); else { k.trash(0, 0, 1, 1, 4); k.radial(0.5, 0.55, 0.5, '#0c0a08', 0.3); } }
  const TURRET = [{n:'Рабочая'}, {n:'Разбитая', broken:true}, {n:'Самодельная', scrap:true}];
  /* ---- Пустоши (HD) ---- */
  function tentDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    [[0.08, 0.15], [1.92, 0.15], [0.08, 1.85], [1.92, 1.85], [1, 0.02], [1, 1.98]].forEach(([x, y])=>{ k.line([x, y, x < 1 ? 0.35 : x > 1 ? 1.65 : 1, y < 1 ? 0.35 : 1.65], 'rgba(200,190,170,.55)', 0.006); k.c.beginPath(); k.c.arc(x, y, 0.02, 0, 6.28); k.fill('#5e4630'); });
    const L = [0.3, 0.3, 1, 0.3, 1, 1.7, 0.3, 1.7], R = [1, 0.3, 1.7, 0.3, 1.7, 1.7, 1, 1.7];
    k.fillP([0.3, 0.3, 1.7, 0.3, 1.85, 1.75, 0.45, 1.8].map((v, i)=>v + (i%2 ? 0.06 : 0.04)), 'rgba(0,0,0,.35)');
    bits.fabric(k, L, shade(col, 0.08), 5, 'h'); bits.fabric(k, R, shade(col, -0.22), 5, 'h');
    c.save(); k.poly([0.3, 0.3, 1.7, 0.3, 1.7, 1.7, 0.3, 1.7]); c.clip(); for(let i=0;i<4;i++) k.blot(k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.08, 0.18), '#4a3e30', 0.25); if(d.torn){ k.organic(1.35, 1.0, 0.18, 0.5, 0.25); k.fill('#141210'); k.organic(0.6, 0.6, 0.1, 0.5, 0.15); k.fill('#141210'); } if(d.patch){ k.rr(0.5, 1.0, 0.3, 0.25, 0.01); k.fill('#6a6a4a'); k.stroke('rgba(0,0,0,.4)', 0.006, null); for(let i=0;i<10;i++) k.line([0.5 + i*0.03, 1.0, 0.5 + i*0.03, 0.99], '#2a2420', 0.006); } c.restore();
    k.line([1, 0.25, 1, 1.75], shade(col, -0.4), 0.03); k.line([0.99, 0.25, 0.99, 1.75], 'rgba(255,250,240,.2)', 0.01); [[1, 0.25], [1, 1.75]].forEach(([x, y])=>{ k.c.beginPath(); k.c.arc(x, y, 0.035, 0, 6.28); k.fill('#5e4630'); });
    k.poly([0.85, 1.7, 1.15, 1.7, 1.0, 1.9]); k.fill('#141210');
    if(d.camp){ bits.stones(k, 0.4, 0.15, 0.12, 6); bits.embers(k, 0.4, 0.15, 0.08); houseBits.crate(k, 1.75, 1.9, 0.25, 0.18, 0.2); bits.barrel(k, 1.85, 0.25, 0.12, '#4a5a6a'); k.trash(0, 1.7, 2, 0.3, 6); } }
  const TENT = [{n:'Брезентовая', col:'#857659'}, {n:'Армейская', col:'#5a6040'}, {n:'Рваная, латаная', col:'#7a5e48', torn:true, patch:true}, {n:'Обжитая, с костром', col:'#6a6450', camp:true}];
  function bigTentDraw(g, d){ const k = hk(g), c = k.c, col = d.col, cx = 1.5, cy = 1.5;
    if(d.market){ const P = [0.2, 0.3, 2.8, 0.3, 2.8, 2.7, 0.2, 2.7]; k.fillP(P.map((v, i)=>v + 0.08), 'rgba(0,0,0,.35)'); for(let i=0;i<8;i++){ k.poly([0.2 + i*0.325, 0.3, 0.2 + (i + 1)*0.325, 0.3, 0.2 + (i + 1)*0.325, 2.7, 0.2 + i*0.325, 2.7]); k.fill(i%2 ? '#c9bfa4' : shade(col, -0.05)); }
      c.save(); k.poly(P); c.clip(); c.fillStyle = k.lin(0, 0.3, 0, 2.7, [[0, 'rgba(255,250,240,.12)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(0, 0, 3, 3); for(let i=0;i<5;i++) k.blot(k.R(0.4, 2.6), k.R(0.4, 2.6), k.R(0.1, 0.25), '#4a3e30', 0.25); k.line([0.2, 1.5, 2.8, 1.5], 'rgba(0,0,0,.3)', 0.03); c.restore(); k.poly(P); k.stroke(k.INK, 0.014); for(let i=0;i<9;i++){ const x = 0.2 + i*0.325; k.c.beginPath(); k.c.arc(x, 2.72, 0.03, 0, 6.28); k.fill('#5e4630'); } houseBits.crate(k, 0.6, 2.85, 0.3, 0.2, 0.1); houseBits.crate(k, 2.4, 2.85, 0.3, 0.2, -0.1); bits.barrel(k, 1.5, 2.85, 0.13, '#6a4a36'); return; }
    c.beginPath(); c.arc(cx + 0.1, cy + 0.12, 1.42, 0, 6.28); k.fill('rgba(0,0,0,.35)');
    const n = 10; for(let i=0;i<n;i++){ const a0 = i/n*6.28, a1 = (i + 1)/n*6.28; if(d.torn && i===3) continue; const p = [cx, cy, cx + Math.cos(a0)*1.42, cy + Math.sin(a0)*1.42, cx + Math.cos(a1)*1.42, cy + Math.sin(a1)*1.42]; const mid = (a0 + a1)/2, b = Math.cos(mid)*LIGHT[0] + Math.sin(mid)*LIGHT[1]; k.poly(p); k.fill(shade(col, b*0.22)); k.poly(p); k.stroke('rgba(10,8,6,.35)', 0.01); k.line([cx + Math.cos(mid)*0.3, cy + Math.sin(mid)*0.3, cx + Math.cos(mid)*1.35, cy + Math.sin(mid)*1.35], 'rgba(0,0,0,.15)', 0.04); }
    if(d.torn){ const a0 = 3/n*6.28, a1 = 4/n*6.28; k.poly([cx, cy, cx + Math.cos(a0)*1.42, cy + Math.sin(a0)*1.42, cx + Math.cos(a1)*1.42, cy + Math.sin(a1)*1.42]); k.fill('#141210'); c.save(); k.poly([cx, cy, cx + Math.cos(a0)*1.42, cy + Math.sin(a0)*1.42, cx + Math.cos(a1)*1.42, cy + Math.sin(a1)*1.42]); c.clip(); houseBits.crate(k, cx + 0.2, cy + 0.9, 0.3, 0.25, 0.3); k.trash(cx - 0.6, cy + 0.3, 1.2, 1.1, 6); c.restore(); k.line([cx + Math.cos(a0)*0.4, cy + Math.sin(a0)*0.4, cx + Math.cos(a0 + 0.2)*1.2, cy + Math.sin(a0 + 0.2)*1.2], shade(col, -0.2), 0.05); }
    c.save(); c.beginPath(); c.arc(cx, cy, 1.42, 0, 6.28); c.clip(); for(let i=0;i<6;i++) k.blot(k.R(0.4, 2.6), k.R(0.4, 2.6), k.R(0.1, 0.25), '#3a3026', 0.2); k.radial(cx, cy, 1.4, '#0c0a08', 0.15); c.restore();
    c.beginPath(); c.arc(cx, cy, 1.42, 0, 6.28); k.stroke(k.INK, 0.014); c.beginPath(); c.arc(cx, cy, 0.18, 0, 6.28); k.fill('#2a2420'); k.stroke(k.INK, 0.01); k.radial(cx, cy, 0.4, '#1a1612', 0.4);
    for(let i=0;i<n;i++){ const a = i/n*6.28; k.line([cx + Math.cos(a)*1.42, cy + Math.sin(a)*1.42, cx + Math.cos(a)*1.5, cy + Math.sin(a)*1.5], 'rgba(200,190,170,.55)', 0.006); } }
  const BIG_TENT = [{n:'Шатёр', col:'#857659'}, {n:'Рыночный навес', col:'#7a3a2e', market:true}, {n:'Рваный шатёр', col:'#6a6050', torn:true}];
  function campfireDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    k.radial(x, y, 0.5, '#1a1612', 0.5); bits.stones(k, x, y, 0.34, 9);
    if(d.state==='out'){ k.blot(x, y, 0.22, '#5a5550', 0.9); k.blot(x + 0.03, y - 0.02, 0.14, '#8a847a', 0.6); bits.logs(k, x, y, 0.2, 3, true); return; }
    bits.logs(k, x, y, 0.2, 5, true); if(d.state==='smoulder'){ bits.embers(k, x, y, 0.17); k.radial(x, y, 0.3, '#c85a20', 0.3); } else bits.fire(k, x, y, 0.16, 1);
    if(d.pot){ [[0, -0.32], [-0.28, 0.2], [0.28, 0.2]].forEach(([dx, dy])=>k.line([x, y, x + dx, y + dy], '#2a2826', 0.02)); c.beginPath(); c.arc(x + 0.01, y + 0.02, 0.11, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(x, y, 0.11, 0, 6.28); c.fillStyle = k.lin(x - 0.1, y - 0.1, x + 0.1, y + 0.1, [[0, '#5a5e60'], [1, '#1e2022']]); c.fill(); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x, y, 0.08, 0, 6.28); k.fill('#5a4a2a'); } }
  const CAMPFIRE = [{n:'Горит', state:'fire'}, {n:'Потух (зола)', state:'out'}, {n:'Тлеет', state:'smoulder'}, {n:'С котелком', state:'fire', pot:true}];
  // Заправка: навес над колонками (вид сверху — кровля навеса), магазин, площадка
  function gasDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0, 0, 5, 4, 0.02); k.texFill('cracked', '#46433f'); c.save(); k.rr(0, 0, 5, 4, 0.02); c.clip(); for(let i=0;i<8;i++) k.blot(k.R(0.3, 4.7), k.R(0.3, 3.7), k.R(0.15, 0.4), '#141210', 0.35); k.leaves(0, 0, 5, 4, 40); k.trash(0, 0, 5, 4, 18); c.restore();
    // магазин справа
    const sx = 3.6, sy = 0.25, sw = 1.25, sh = 3.5; k.rr(sx + 0.1, sy + 0.12, sw, sh, 0.02); k.fill('rgba(0,0,0,.4)'); k.rr(sx, sy, sw, sh, 0.02); k.texFill('concrete', '#8a8780'); k.rr(sx + 0.1, sy + 0.1, sw - 0.2, sh - 0.2, 0.01); k.texFill(d.burnt ? 'ash' : 'roofing', '#46433f'); k.rr(sx, sy, sw, sh, 0.02); k.stroke(k.INK, 0.014); ventPipe(k, sx + 0.4, sy + 0.5, 0.07); ventPipe(k, sx + 0.8, sy + 2.8, 0.06); if(d.burnt){ k.organic(sx + 0.6, sy + 1.6, 0.4, 0.4, 0.5); k.fill('#0e0c0a'); }
    // островки с колонками (видны из-под навеса только если навес разрушен)
    const pumps = [[1.0, 1.2], [2.2, 1.2], [1.0, 2.8], [2.2, 2.8]];
    const canopyP = [0.25, 0.55, 3.3, 0.55, 3.3, 3.45, 0.25, 3.45];
    pumps.forEach(([x, y])=>{ k.rr(x - 0.35, y - 0.12, 0.7, 0.24, 0.04); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); fuelPump(k, x - 0.12, y, d.burnt); fuelPump(k, x + 0.16, y, d.burnt); });
    if(d.collapsed){ c.save(); c.translate(1.8, 2.2); c.rotate(0.12); const P = [-1.5, -1.6, 1.4, -1.6, 1.0, 0.2, -1.2, 0.4]; k.fillP(P.map((v, i)=>v + 0.12), 'rgba(0,0,0,.4)'); k.poly(P); k.texFill('corrugated', '#7f8588', '#8e2e26', 0.5); k.poly(P); k.stroke(k.INK, 0.014); for(let i=0;i<8;i++) k.rust(k.R(-1.3, 1.2), k.R(-1.5, 0.1), k.R(0.05, 0.12), i < 2); c.restore(); [[0.3, 0.6], [3.25, 0.6]].forEach(([x, y])=>{ k.rr(x - 0.1, y - 0.1, 0.2, 0.2, 0.02); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); }); }
    else { k.fillP(canopyP.map((v, i)=>v + (i%2 ? 0.16 : 0.12)), 'rgba(0,0,0,.4)'); k.poly(canopyP); k.texFill(d.burnt ? 'ash' : 'corrugated', '#7f8588', d.burnt ? null : '#b9b6aa', 0.35); c.save(); k.poly(canopyP); c.clip(); c.fillStyle = d.burnt ? '#2a2420' : '#8e2e26'; c.fillRect(0.25, 0.55, 3.05, 0.18); c.fillRect(0.25, 3.27, 3.05, 0.18); for(let i=0;i<10;i++) k.rust(k.R(0.4, 3.1), k.R(0.7, 3.3), k.R(0.05, 0.12), d.burnt && i < 3); for(let i=0;i<4;i++) k.puddle(k.R(0.8, 2.8), k.R(1, 3), k.R(0.12, 0.25), k.R(0.1, 0.2)); if(d.burnt){ for(let i=0;i<4;i++){ k.organic(k.R(0.8, 2.8), k.R(1, 3), k.R(0.2, 0.4), 0.5, 0.3); k.fill('#0e0c0a'); } } c.restore(); k.poly(canopyP); k.stroke(k.INK, 0.016);
      for(let i=0;i<6;i++){ const x = 0.6 + i*0.5; k.rr(x - 0.12, 1.95, 0.24, 0.1, 0.02); k.fill(d.burnt ? '#1a1816' : '#d6d0bc'); } if(!d.burnt){ k.rr(0.9, 0.6, 1.8, 0.08, 0.01); k.fill('#e4ddca'); bits.stencil(k, 1.8, 0.64, 'А З С', 0.07, '#8e2e26', 0.9); } }
    if(d.fort){ for(let i=0;i<12;i++) houseBits.sandbag(k, 0.35 + i*0.27, 3.8, k.R(-0.1, 0.1)); [[0.15, 0.2], [0.15, 0.9]].forEach(([x, y])=>k.tire(x + 0.1, y + 0.1, 0.15)); for(let i=0;i<5;i++) bits.sheet(k, [0.05, 0.4 + i*0.6, 0.18, 0.4 + i*0.6, 0.18, 0.95 + i*0.6, 0.05, 0.95 + i*0.6], i%2 ? '#6a4a3a' : null, true); k.line([4.9, 3.9, 4.9, 3.3], '#3a3836', 0.04); bits.skull(k, 4.9, 3.3, 0.08, 0); }
    // стела с ценами
    k.rr(4.55, 3.85 - 0.6, 0.3, 0.6, 0.02); k.fill(d.burnt ? '#1e1b18' : '#3e4244'); k.stroke(k.INK, 0.01); if(!d.burnt) for(let i=0;i<3;i++){ k.rr(4.58, 3.3 + i*0.17, 0.24, 0.12, 0.01); k.fill('#1a1a18'); bits.stencil(k, 4.7, 3.36 + i*0.17, ['92', '95', 'ДТ'][i], 0.07, '#d84a2e', 0.8); } }
  function fuelPump(k, x, y, burnt){ const c = k.c; k.rr(x - 0.07 + 0.02, y - 0.08 + 0.03, 0.14, 0.16, 0.01); k.fill('rgba(0,0,0,.35)'); k.rr(x - 0.07, y - 0.08, 0.14, 0.16, 0.01); k.fill(burnt ? '#2a2624' : '#9a3a2e'); k.stroke(k.INK, 0.006); k.rr(x - 0.05, y - 0.06, 0.1, 0.05, 0.005); k.fill('#1a1a18'); }
  function pumpDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : d.col;
    if(d.fallen){ c.save(); c.translate(0.5, 0.55); c.rotate(1.2); }
    else c.save();
    const x = d.fallen ? -0.3 : 0.2, y = d.fallen ? -0.25 : 0.22; k.rr(x + 0.05, y + 0.06, 0.6, 0.55, 0.04); k.fill('rgba(0,0,0,.38)'); k.rr(x, y, 0.6, 0.55, 0.04); c.fillStyle = k.lin(x, y, x + 0.6, y + 0.55, [[0, shade(col, 0.2)], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.012);
    k.rr(x + 0.08, y + 0.06, 0.44, 0.16, 0.01); k.fill('#141412'); if(!d.burnt && !d.broken){ bits.stencil(k, x + 0.3, y + 0.14, '00.00', 0.07, '#c8a040', 0.7); } if(d.broken){ for(let i=0;i<6;i++) k.line([x + 0.3, y + 0.14, x + 0.3 + k.R(-0.2, 0.2), y + 0.14 + k.R(-0.07, 0.07)], 'rgba(220,228,228,.6)', 0.004); }
    k.rr(x + 0.42, y + 0.28, 0.12, 0.18, 0.02); k.fill('#2a2826'); for(let i=0;i<3;i++) k.rust(x + k.R(0.05, 0.55), y + k.R(0.05, 0.5), k.R(0.02, 0.05), false); if(!d.burnt) bits.stencil(k, x + 0.2, y + 0.38, 'АИ-92', 0.05, '#e4ddca', 0.75);
    c.restore();
    if(!d.fallen){ c.beginPath(); c.moveTo(0.8, 0.55); c.bezierCurveTo(1.0, 0.6, 0.95, 0.95, 0.7, 0.92); k.stroke('#1a1a18', 0.035); k.rr(0.6, 0.88, 0.14, 0.07, 0.02); k.fill('#3a3e40'); }
    if(d.burnt) k.radial(0.5, 0.5, 0.6, '#0c0a08', 0.4); }
  const PUMP = [{n:'Красная', col:'#9a3a2e'}, {n:'Белая', col:'#b9b6aa'}, {n:'Разбитая', col:'#8a5a2e', broken:true}, {n:'Опрокинута', col:'#9a3a2e', fallen:true}];
  // Лачуга из металлолома: кровля из разномастных листов, придавленных покрышками и камнями
  function shackDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(1.5, 1.5, 1.45, 0.1); k.fill('#5a5045', 0.35);
    const cols = ['#7a4a36', null, '#5a6a6e', '#8a7a4a', '#6a4a3a', '#4e5a44', null, '#8e3a2e'];
    let n = 0; for(let j=0;j<3;j++) for(let i=0;i<3;i++){ const x = 0.15 + i*0.92 + k.R(-0.06, 0.06), y = 0.15 + j*0.9 + k.R(-0.06, 0.06), w = 0.95 + k.R(-0.05, 0.1), h = 0.95 + k.R(-0.05, 0.1), a = k.R(-0.06, 0.06); c.save(); c.translate(x + w/2, y + h/2); c.rotate(a); bits.sheet(k, [-w/2, -h/2, w/2, -h/2, w/2, h/2, -w/2, h/2], cols[(n + d.seed)%cols.length], (n + d.seed)%3!==1); c.restore(); n++; }
    c.save(); k.poly([0.1, 0.1, 2.9, 0.1, 2.9, 2.9, 0.1, 2.9]); c.clip(); for(let i=0;i<6;i++) k.rust(k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.08, 0.2), i < 2); k.leaves(0, 0, 3, 3, 30); c.restore();
    [[0.6, 0.6], [2.3, 1.2], [1.2, 2.4]].forEach(([x, y])=>k.tire(x, y, 0.17)); for(let i=0;i<5;i++) k.chunk(k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.06, 0.11), '#7a766e', 0.03);
    c.beginPath(); c.arc(2.2, 0.55, 0.09, 0, 6.28); k.fill('#2a2826'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(2.2, 0.55, 0.05, 0, 6.28); k.fill('#0c0a08'); k.radial(2.3, 0.45, 0.4, '#3a3634', 0.25); // печная труба
    if(d.awning){ c.save(); c.translate(1.5, 2.95); bits.fabric(k, [-1.2, -0.1, 1.2, -0.1, 1.3, 0.05, -1.3, 0.05], '#6a6450', 6, 'v'); c.restore(); }
    if(d.garden){ houseBits.bed(k, [0.2, 3.0 - 0.02, 1.0, 0.0]); }
    if(d.fort){ for(let i=0;i<9;i++) houseBits.sandbag(k, 0.25 + i*0.32, 0.08, 0); bits.skull(k, 2.85, 2.85, 0.07, 0); k.line([0.05, 1.5, 0.05, 2.8], '#5a5e60', 0.04); }
    if(d.door){ k.rr(1.25, 2.85, 0.5, 0.12, 0.01); k.fill('#2a2420'); } }
  const SHACK = [{n:'Лачуга', seed:0, door:true}, {n:'С навесом', seed:2, awning:true}, {n:'Синяя кровля', seed:1, door:true}, {n:'Укреплённая', seed:4, fort:true}];
  function scrapTowerDraw(g, d){ const k = hk(g), c = k.c;
    k.poly([0.3, 0.3, 1.7, 0.3, 2, 2, 0.6, 2]); k.fill('rgba(0,0,0,.28)'); [[0.15, 0.15], [1.85, 0.15], [0.15, 1.85], [1.85, 1.85]].forEach(([x, y])=>{ k.line([x, y, x + 0.18, y + 0.22], 'rgba(0,0,0,.35)', 0.08); k.c.beginPath(); k.c.arc(x, y, 0.07, 0, 6.28); k.fill('#5a3a2a'); k.stroke(k.INK, 0.008); });
    const plat = [0.2, 0.2, 1.8, 0.2, 1.8, 1.8, 0.2, 1.8]; bits.sheet(k, plat, '#6a4a36', false);
    for(let i=0;i<4;i++){ const s = i*0.4; bits.sheet(k, [0.2 + s, 0.12, 0.6 + s, 0.12, 0.6 + s, 0.3, 0.2 + s, 0.3], i%2 ? '#5a6a6e' : null, true); } for(let i=0;i<3;i++) bits.sheet(k, [0.12, 0.4 + i*0.45, 0.3, 0.4 + i*0.45, 0.3, 0.82 + i*0.45, 0.12, 0.82 + i*0.45], i%2 ? '#8a7a4a' : null, true);
    if(d.roof){ c.save(); c.translate(1, 1); c.rotate(0.05); bits.sheet(k, [-0.75, -0.75, 0.75, -0.75, 0.75, 0.75, -0.75, 0.75], '#7a4a36', true); c.restore(); }
    else { for(let i=0;i<6;i++){ const a = i/6*3.14 + 3.3; houseBits.sandbag(k, 1 + Math.cos(a)*0.55, 1.1 + Math.sin(a)*0.55, a + Math.PI/2); } bits.casings(k, 0.6, 0.8, 0.8, 0.6, 10); }
    if(d.light){ c.save(); c.translate(1.65, 0.35); c.rotate(-0.6); k.rr(-0.13, -0.09, 0.26, 0.18, 0.04); k.fill('#3a3e40'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(0, -0.09, 0.09, Math.PI, 0); k.fill('#d8d2bc'); c.restore(); }
    if(d.skull) bits.skull(k, 1.0, 1.85, 0.09, 0); for(let i=0;i<5;i++) k.line([0.85, 1.8 + i*0.04, 1.15, 1.8 + i*0.04], '#4a3a2a', 0.015); }
  const SCRAP_TOWER = [{n:'Открытая площадка', light:true}, {n:'С крышей', roof:true}, {n:'Рейдерская, с черепом', skull:true}];
  // Багги: рама из труб, сиденья, двигатель сзади, большие колёса
  function buggyDraw(g, d){ const k = hk(g), c = k.c;
    [[0.12, 0.42], [0.88, 0.42], [0.1, 1.55], [0.9, 1.55]].forEach(([x, y], i)=>bits.wheel(k, x, y, i > 1 ? 0.24 : 0.2, i > 1 ? 0.42 : 0.36, d.wreck && i===1));
    const frame = [0.3, 0.12, 0.7, 0.12, 0.78, 0.6, 0.8, 1.75, 0.2, 1.75, 0.22, 0.6];
    k.fillP(frame.map((v, i)=>v + (i%2 ? 0.07 : 0.05)), 'rgba(0,0,0,.35)'); k.poly(frame); k.texFill('metal', '#6d7376', d.col, 0.5); k.poly(frame); k.stroke(k.INK, 0.012);
    c.save(); k.poly(frame); c.clip(); for(let i=0;i<6;i++) k.rust(k.R(0.25, 0.75), k.R(0.2, 1.7), k.R(0.03, 0.07), false); c.restore();
    k.rr(0.32, 0.15, 0.36, 0.35, 0.03); k.texFill('rust', '#6b5546'); k.stroke(k.INK, 0.01); for(let i=0;i<5;i++) k.line([0.35, 0.2 + i*0.06, 0.65, 0.2 + i*0.06], 'rgba(0,0,0,.35)', 0.01);
    [[0.33, 0.85], [0.6, 0.85]].forEach(([x, y])=>{ k.rr(x, y, 0.2, 0.26, 0.04); k.fill('#3a2e26'); k.stroke(k.INK, 0.008); k.line([x + 0.03, y + 0.05, x + 0.17, y + 0.05], 'rgba(255,255,255,.15)', 0.01); });
    k.c.beginPath(); k.c.arc(0.43, 0.72, 0.07, 0, 6.28); k.stroke('#1a1a18', 0.02); // руль
    k.rr(0.3, 1.25, 0.4, 0.42, 0.03); k.fill('#2a2826'); k.stroke(k.INK, 0.01); for(let i=0;i<4;i++){ k.c.beginPath(); k.c.arc(0.38 + i*0.08, 1.35, 0.025, 0, 6.28); k.fill('#5a5e60'); } k.rr(0.36, 1.48, 0.28, 0.14, 0.02); k.fill('#4a4e50'); k.line([0.7, 1.55, 0.84, 1.8], '#3a3836', 0.03); // двигатель, выхлоп
    // каркас безопасности
    [[0.25, 0.75, 0.75, 0.75], [0.25, 1.15, 0.75, 1.15], [0.25, 0.75, 0.25, 1.15], [0.75, 0.75, 0.75, 1.15], [0.25, 0.75, 0.75, 1.15]].forEach(p=>{ k.line(p.map((v, i)=>v + 0.03), 'rgba(0,0,0,.35)', 0.04); k.line(p, '#5a5e60', 0.035); k.line(p.map(v=>v - 0.006), 'rgba(255,255,255,.25)', 0.008); });
    if(d.spikes) for(let i=0;i<7;i++){ const x = 0.25 + i*0.08; k.fillP([x - 0.025, 0.12, x + 0.025, 0.12, x, 0.0], '#8a8e90'); }
    if(d.gun){ k.rr(0.45, 1.0, 0.1, 0.1, 0.02); k.fill('#2a2826'); k.line([0.5, 1.05, 0.5, 0.4], '#1a1a18', 0.035); bits.casings(k, 0.3, 1.0, 0.4, 0.3, 6); }
    if(d.wreck){ k.radial(0.5, 0.9, 0.6, '#0c0a08', 0.4); for(let i=0;i<5;i++) k.blot(k.R(0.3, 0.7), k.R(0.3, 1.6), 0.06, '#7a4126', 0.6); } }
  const BUGGY = [{n:'Рейдерский, с шипами', col:'#a07a2a', spikes:true}, {n:'С пулемётом', col:'#5a6040', gun:true}, {n:'Разбитый', col:'#6a4a36', wreck:true}];
  // Грузовик-крепость: кабина, бронированная цистерна/кузов, шипы, листы брони
  function rigDraw(g, d){ const k = hk(g), c = k.c, col = d.burnt ? '#2e2a27' : '#6a4a36';
    [0.6, 2.2, 2.9, 3.9, 4.5].forEach((y, i)=>{ bits.wheel(k, 0.1, y, 0.22, 0.42, d.burnt && i===2); bits.wheel(k, 1.9, y, 0.22, 0.42, d.burnt && i===3); });
    const cab = [0.2, 0.05, 1.8, 0.05, 1.85, 1.35, 0.15, 1.35]; k.fillP(cab.map((v, i)=>v + (i%2 ? 0.09 : 0.07)), 'rgba(0,0,0,.4)'); k.poly(cab); k.texFill('rust', '#6b5546', d.burnt ? '#2e2a27' : null, 0.6); k.poly(cab); k.stroke(k.INK, 0.014);
    k.rr(0.3, 0.12, 1.4, 0.22, 0.02); k.fill('#1e1c1a'); for(let i=0;i<9;i++) k.line([0.32 + i*0.16, 0.14, 0.32 + i*0.16, 0.32], '#5a5e60', 0.015); // решётка
    k.glass(()=>k.poly([0.3, 0.42, 1.7, 0.42, 1.62, 0.65, 0.38, 0.65]), 0.3, 0.42, 1.7, 0.65, d.burnt); if(!d.burnt) for(let i=0;i<5;i++) k.line([0.4 + i*0.3, 0.42, 0.4 + i*0.3, 0.65], '#2a2826', 0.03); // решётка на стекле
    k.rr(0.35, 0.7, 1.3, 0.55, 0.03); k.texFill('metal', '#6d7376', col, 0.55); k.stroke(k.INK, 0.012); [[0.45, 0.8], [1.35, 0.8]].forEach(([x, y])=>{ k.c.beginPath(); k.c.arc(x, y, 0.07, 0, 6.28); k.fill('#3a3836'); });
    for(let i=0;i<6;i++){ const x = 0.25 + i*0.3; k.fillP([x - 0.04, 0.06, x + 0.04, 0.06, x, -0.12], '#8a8e90'); } // таран-шипы
    k.line([0.2, 1.38, 1.8, 1.38], '#1e1c1a', 0.04);
    if(d.tanker){ const tx = 0.15, ty = 1.45, tw = 1.7, th = 3.45; k.rr(tx + 0.1, ty + 0.12, tw, th, 0.5); k.fill('rgba(0,0,0,.4)'); k.rr(tx, ty, tw, th, 0.5); c.fillStyle = k.lin(tx, 0, tx + tw, 0, [[0, shade(col, -0.45)], [0.35, shade(col, 0.15)], [0.65, col], [1, shade(col, -0.5)]]); c.fill(); k.stroke(k.INK, 0.014);
      c.save(); k.rr(tx, ty, tw, th, 0.5); c.clip(); for(let i=1;i<5;i++) k.seam([tx, ty + i*th/5, tx + tw, ty + i*th/5], 0.012); for(let i=0;i<14;i++) k.rust(k.R(tx + 0.1, tx + tw - 0.1), k.R(ty + 0.2, ty + th - 0.2), k.R(0.05, 0.14), d.burnt && i < 3); if(d.burnt) for(let i=0;i<8;i++) k.blot(k.R(0.4, 1.6), k.R(1.7, 4.7), k.R(0.1, 0.25), k.pick(['#0c0b0a', '#b8b2a6']), 0.6); c.restore();
      [2.3, 3.6].forEach(y=>{ k.c.beginPath(); k.c.arc(1, y, 0.16, 0, 6.28); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); k.c.beginPath(); k.c.arc(1, y, 0.06, 0, 6.28); k.fill('#2a2826'); }); k.line([0.3, 1.7, 0.3, 4.7], '#3a3836', 0.025); k.line([1.7, 1.7, 1.7, 4.7], '#3a3836', 0.025); }
    else { const tx = 0.12, ty = 1.45, tw = 1.76, th = 3.45; k.rr(tx + 0.1, ty + 0.12, tw, th, 0.04); k.fill('rgba(0,0,0,.4)'); for(let j=0;j<6;j++) for(let i=0;i<2;i++) bits.sheet(k, [tx + i*tw/2, ty + j*th/6, tx + (i + 1)*tw/2, ty + j*th/6, tx + (i + 1)*tw/2, ty + (j + 1)*th/6, tx + i*tw/2, ty + (j + 1)*th/6], [null, '#5a6a6e', '#6a4a36', '#4e5a44'][(i + j*2)%4], (i + j)%2===0);
      [[0.6, 2.2], [1.4, 3.8]].forEach(([x, y])=>{ k.c.beginPath(); k.c.arc(x, y, 0.22, 0, 6.28); k.fill('#3a3e40'); k.stroke(k.INK, 0.01); k.line([x, y, x + (x < 1 ? -0.35 : 0.35), y - 0.25], '#1a1a18', 0.035); }); for(let i=0;i<8;i++){ const y = 1.6 + i*0.42; k.fillP([0.12, y - 0.04, 0.12, y + 0.04, -0.06, y], '#8a8e90'); k.fillP([1.88, y - 0.04, 1.88, y + 0.04, 2.06, y], '#8a8e90'); } bits.skull(k, 1, 4.75, 0.08, 0); }
    if(d.burnt) k.radial(1, 2.5, 2.2, '#0c0a08', 0.3); }
  const RIG = [{n:'Цистерна', tanker:true}, {n:'Бронированный кузов'}, {n:'Сгоревшая цистерна', tanker:true, burnt:true}];
  // Металлолом и свалка
  function scrapPileDraw(g, W, H, d){ const k = hk(g), c = k.c, cx = W/2, cy = H/2, rx = W*0.46, ry = H*0.44;
    k.organic(cx, cy, rx, 0.25, ry); k.fill('#5a4a3e', 0.45); k.organic(cx, cy, rx*0.75, 0.3, ry*0.75); k.fill('#3a3028', 0.4);
    const N = Math.round(W*H*(d.big ? 3.2 : 4));
    for(let i=0;i<N;i++){ const a = k.rnd()*6.28, r = Math.sqrt(k.rnd()); const x = cx + Math.cos(a)*rx*r*0.85, y = cy + Math.sin(a)*ry*r*0.85, t = k.rnd();
      if(t < 0.3){ const w = k.R(0.25, 0.6), h = k.R(0.15, 0.4), an = k.rnd()*6.28; c.save(); c.translate(x, y); c.rotate(an); bits.sheet(k, [-w/2, -h/2, w/2, -h/2, w/2 + k.R(-0.05, 0.05), h/2, -w/2, h/2], k.pick([null, '#5a6a6e', '#8a7a4a', '#4e5a44', '#8e3a2e']), k.rnd() < 0.5); c.restore(); }
      else if(t < 0.45){ c.save(); c.translate(x, y); c.rotate(k.rnd()*6.28); const L = k.R(0.3, 0.8); k.rr(-L/2 + 0.03, -0.04 + 0.04, L, 0.08, 0.04); k.fill('rgba(0,0,0,.35)'); k.rr(-L/2, -0.04, L, 0.08, 0.04); c.fillStyle = k.lin(0, -0.04, 0, 0.04, [[0, '#9aa0a2'], [1, '#4a5052']]); c.fill(); k.stroke(k.INK, 0.006); k.rust(0, 0, 0.04, false); c.restore(); }
      else if(t < 0.55) k.tire(x, y, k.R(0.12, 0.18)); else if(t < 0.63) bits.barrel(k, x, y, k.R(0.1, 0.15), k.pick(['#4a5a6a', '#6a4a36', '#5a6040']), k.rnd() < 0.3);
      else if(t < 0.72 && d.big){ c.save(); c.translate(x, y); c.rotate(k.R(-0.3, 0.3)); const w = 0.32, h = 0.4; k.rr(-w/2 + 0.04, -h/2 + 0.05, w, h, 0.03); k.fill('rgba(0,0,0,.38)'); k.rr(-w/2, -h/2, w, h, 0.03); c.fillStyle = k.lin(-w/2, -h/2, w/2, h/2, [[0, '#d6d2c6'], [1, '#8a867c']]); c.fill(); k.stroke(k.INK, 0.008); if(k.rnd() < 0.5){ k.c.beginPath(); k.c.arc(0, 0.04, 0.1, 0, 6.28); k.fill('#2a2e30'); k.stroke('#6a6e70', 0.01); } else k.line([-w/2 + 0.03, -0.05, w/2 - 0.03, -0.05], 'rgba(0,0,0,.35)', 0.01); k.rust(0.05, 0.1, 0.05, false); c.restore(); }
      else k.chunk(x, y, k.R(0.05, 0.12), k.pick(['#6a4a36', '#5a5e60', '#7a6a5a']), 0.03); }
    for(let i=0;i<Math.round(W*H*2);i++) k.rebar([cx + k.R(-rx, rx)*0.7, cy + k.R(-ry, ry)*0.7, cx + k.R(-rx, rx)*0.8, cy + k.R(-ry, ry)*0.8]);
    if(d.bags) for(let i=0;i<Math.round(W*H*1.2);i++){ const x = cx + k.R(-rx, rx)*0.8, y = cy + k.R(-ry, ry)*0.8; k.organic(x, y, k.R(0.1, 0.16), 0.25, k.R(0.08, 0.13)); k.c.fillStyle = k.lin(x - 0.15, y - 0.15, x + 0.15, y + 0.15, [[0, '#3a3e36'], [1, '#141512']]); k.c.fill(); }
    if(d.fire){ bits.fire(k, cx + rx*0.3, cy - ry*0.2, 0.18, 0.8); k.radial(cx + rx*0.3, cy - ry*0.5, 0.8, '#3a3634', 0.3); }
    k.trash(cx - rx, cy - ry, rx*2, ry*2, Math.round(W*H*3)); k.leaves(0, 0, W, H, Math.round(W*H*3)); }
  const SCRAP_PILE = [{n:'Ржавый лом'}, {n:'Трубы и бочки'}, {n:'С покрышками'}, {n:'Тлеющий', fire:true}];
  const JUNK = [{n:'Свалка бытовой техники', big:true}, {n:'Мусорные мешки', big:true, bags:true}, {n:'Горящая свалка', big:true, fire:true}];
  // Самолёт: фюзеляж, крылья с двигателями, хвост, обломки, выжженная полоса
  function planeDraw(g, d){ const k = hk(g), c = k.c, col = d.mil ? '#5a6050' : '#b9b6ac';
    c.save(); c.globalAlpha = 0.5; k.organic(3.1, 3.4, 2.6, 0.3, 1.3); k.fill('#1a1612'); c.restore(); for(let i=0;i<30;i++) k.chunk(k.R(0.4, 5.6), k.R(1, 5.8), k.R(0.04, 0.12), k.pick(['#9a9e9c', '#6a6e6c', '#7a4a36']), 0.03);
    const wing = (sx)=>{ const P = [3, 2.3, 3 + sx*2.7, 2.75, 3 + sx*2.75, 3.1, 3, 3.0]; k.fillP(P.map((v, i)=>v + (i%2 ? 0.14 : 0.1)), 'rgba(0,0,0,.4)'); k.poly(P); k.texFill('metal', '#8a9094', col, 0.5); c.save(); k.poly(P); c.clip(); for(let i=1;i<6;i++) k.seam([3 + sx*i*0.45, 2.3, 3 + sx*i*0.45, 3.1], 0.008, 0.7); for(let i=0;i<6;i++) k.rust(3 + sx*k.R(0.3, 2.5), k.R(2.4, 3.0), k.R(0.05, 0.12), false); c.restore(); k.poly(P); k.stroke(k.INK, 0.014);
      const ex = 3 + sx*1.2; k.rr(ex - 0.16 + 0.06, 2.0 + 0.08, 0.32, 0.8, 0.14); k.fill('rgba(0,0,0,.35)'); k.rr(ex - 0.16, 2.0, 0.32, 0.8, 0.14); c.fillStyle = k.lin(ex - 0.16, 0, ex + 0.16, 0, [[0, '#4a4e50'], [0.5, '#9aa0a2'], [1, '#3a3e40']]); c.fill(); k.stroke(k.INK, 0.01); k.c.beginPath(); k.c.ellipse(ex, 2.02, 0.13, 0.05, 0, 0, 6.28); k.fill('#141210'); };
    wing(-1); if(d.wingOff){ c.save(); c.translate(5.0, 4.6); c.rotate(0.6); c.translate(-4.4, -2.7); wing(1); c.restore(); } else wing(1);
    const fus = (y0, y1, nose)=>{ k.rr(2.6 + 0.12, y0 + 0.14, 0.8, y1 - y0, 0.38); k.fill('rgba(0,0,0,.4)'); k.rr(2.6, y0, 0.8, y1 - y0, nose ? 0.4 : 0.1); c.fillStyle = k.lin(2.6, 0, 3.4, 0, [[0, shade(col, -0.4)], [0.4, shade(col, 0.15)], [1, shade(col, -0.45)]]); c.fill(); k.stroke(k.INK, 0.014);
      c.save(); k.rr(2.6, y0, 0.8, y1 - y0, 0.38); c.clip(); for(let y=y0 + 0.3;y<y1;y+=0.35) k.seam([2.6, y, 3.4, y], 0.008, 0.6); if(!d.mil) for(let y=y0 + 0.4;y<y1 - 0.2;y+=0.18){ k.rr(2.63, y, 0.05, 0.08, 0.01); k.fill('#1e2426'); k.rr(3.32, y, 0.05, 0.08, 0.01); k.fill('#1e2426'); } if(!d.mil) { c.fillStyle = '#3e5a7a'; c.fillRect(2.6, y0, 0.06, y1 - y0); c.fillRect(3.34, y0, 0.06, y1 - y0); } for(let i=0;i<8;i++) k.rust(k.R(2.7, 3.3), k.R(y0 + 0.2, y1 - 0.2), k.R(0.04, 0.1), false); if(d.burnt) for(let i=0;i<10;i++) k.blot(k.R(2.7, 3.3), k.R(y0 + 0.2, y1 - 0.2), k.R(0.1, 0.2), k.pick(['#0c0b0a', '#7a4126', '#b8b2a6']), 0.65); c.restore();
      if(nose){ k.poly([2.78, y0 + 0.2, 3.22, y0 + 0.2, 3.16, y0 + 0.35, 2.84, y0 + 0.35]); k.fill(d.burnt ? '#0e0c0a' : '#2a3536'); } };
    fus(0.15, 3.3, true); c.save(); c.translate(3.0, 3.8); c.rotate(0.35); c.translate(-3, -3.8); fus(3.55, 5.6, false);
      k.poly([3, 5.0, 4.2, 5.35, 4.2, 5.6, 3, 5.5]); k.texFill('metal', '#8a9094', col, 0.5); k.stroke(k.INK, 0.012); k.poly([3, 5.0, 1.8, 5.35, 1.8, 5.6, 3, 5.5]); k.texFill('metal', '#8a9094', col, 0.5); k.stroke(k.INK, 0.012); k.rr(2.95, 4.9, 0.1, 0.75, 0.03); k.fill(d.mil ? '#3a3e30' : '#8e2e26'); c.restore();
    k.organic(3.0, 3.42, 0.5, 0.4, 0.15); k.fill('#0e0c0a'); for(let i=0;i<12;i++) k.rebar([k.R(2.6, 3.4), 3.32, k.R(2.5, 3.5), k.R(3.3, 3.6)]);
    for(let i=0;i<6;i++){ c.save(); c.translate(k.R(0.5, 5.5), k.R(3.8, 5.8)); c.rotate(k.rnd()*6.28); k.rr(-0.12, -0.08, 0.24, 0.16, 0.02); k.fill('#5a4a3e'); k.stroke(k.INK, 0.006); c.restore(); } // кресла/чемоданы
    if(d.burnt) k.radial(3, 3, 3, '#0c0a08', 0.3); }
  const PLANE = [{n:'Пассажирский'}, {n:'Военный транспортник', mil:true}, {n:'Сгоревший, без крыла', burnt:true, wingOff:true}];
  function moistDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    for(let i=0;i<3;i++){ const a = i*2.09 + 0.3; k.line([x + 0.03, y + 0.04, x + Math.cos(a)*0.46 + 0.03, y + Math.sin(a)*0.46 + 0.04], 'rgba(0,0,0,.35)', 0.04); k.line([x, y, x + Math.cos(a)*0.46, y + Math.sin(a)*0.46], '#5a5e60', 0.035); k.c.beginPath(); k.c.arc(x + Math.cos(a)*0.46, y + Math.sin(a)*0.46, 0.04, 0, 6.28); k.fill('#3a3e40'); }
    c.beginPath(); c.arc(x + 0.04, y + 0.05, 0.32, 0, 6.28); k.fill('rgba(0,0,0,.38)'); c.beginPath(); c.arc(x, y, 0.32, 0, 6.28); k.texFill('metal', '#8a9094', d.rust ? '#7a5a40' : null, 0.4); k.stroke(k.INK, 0.012);
    for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([x + Math.cos(a)*0.16, y + Math.sin(a)*0.16, x + Math.cos(a)*0.31, y + Math.sin(a)*0.31], 'rgba(0,0,0,.3)', 0.016); k.line([x + Math.cos(a + 0.05)*0.16, y + Math.sin(a + 0.05)*0.16, x + Math.cos(a + 0.05)*0.31, y + Math.sin(a + 0.05)*0.31], 'rgba(255,255,255,.2)', 0.006); }
    c.beginPath(); c.arc(x, y, 0.15, 0, 6.28); c.fillStyle = k.lin(x - 0.15, y - 0.15, x + 0.15, y + 0.15, [[0, '#7aa0aa'], [1, '#2f4a52']]); c.fill(); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x - 0.04, y - 0.04, 0.04, 0, 6.28); k.fill('rgba(255,255,255,.5)');
    if(d.rust) for(let i=0;i<5;i++) k.rust(x + k.R(-0.25, 0.25), y + k.R(-0.25, 0.25), k.R(0.03, 0.07), false); if(d.leak) k.puddle(0.7, 0.75, 0.2, 0.14); if(d.jugs) [[0.15, 0.85], [0.85, 0.15]].forEach(([jx, jy])=>{ k.rr(jx - 0.07, jy - 0.07, 0.14, 0.14, 0.03); k.fill('#c8c2a8'); k.stroke(k.INK, 0.006); k.c.beginPath(); k.c.arc(jx, jy - 0.07, 0.025, 0, 6.28); k.fill('#3e5a6a'); }); }
  const MOIST = [{n:'Влагосборник', jugs:true}, {n:'Ржавый', rust:true}, {n:'Протекает', rust:true, leak:true}];
  function waterTowerDraw(g, d){ const k = hk(g), c = k.c, x = 1, y = 1;
    [[0.2, 0.2], [1.8, 0.2], [0.2, 1.8], [1.8, 1.8]].forEach(([px, py])=>{ k.line([px, py, px + 0.2, py + 0.25], 'rgba(0,0,0,.35)', 0.08); k.c.beginPath(); k.c.arc(px, py, 0.06, 0, 6.28); k.fill(d.metal ? '#4a4e50' : '#5e4630'); });
    c.beginPath(); c.arc(x + 0.14, y + 0.18, 0.85, 0, 6.28); k.fill('rgba(0,0,0,.4)');
    if(d.metal){ c.beginPath(); c.arc(x, y, 0.85, 0, 6.28); k.texFill('metal', '#8a9094', '#5a6a6e', 0.35); c.save(); c.beginPath(); c.arc(x, y, 0.85, 0, 6.28); c.clip(); c.fillStyle = k.lin(0.15, 0.15, 1.85, 1.85, [[0, 'rgba(255,250,240,.15)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 2); for(let i=0;i<10;i++) k.rust(k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.05, 0.14), false); for(let i=0;i<8;i++){ const a = i/8*6.28; k.seam([x, y, x + Math.cos(a)*0.85, y + Math.sin(a)*0.85], 0.008, 0.6); } c.restore(); }
    else { c.beginPath(); c.arc(x, y, 0.85, 0, 6.28); k.texFill('wood', '#6b5236'); c.save(); c.beginPath(); c.arc(x, y, 0.85, 0, 6.28); c.clip(); c.fillStyle = k.lin(0.15, 0.15, 1.85, 1.85, [[0, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 2); for(let i=0;i<16;i++){ const a = i/16*6.28; k.line([x, y, x + Math.cos(a)*0.85, y + Math.sin(a)*0.85], 'rgba(30,20,12,.45)', 0.012); } k.moss(1.3, 0.6, 0.15); c.restore(); [0.6, 0.82].forEach(r=>{ c.beginPath(); c.arc(x, y, r, 0, 6.28); k.stroke('#3a3e40', 0.03); }); }
    c.beginPath(); c.arc(x, y, 0.85, 0, 6.28); k.stroke(k.INK, 0.014); c.beginPath(); c.arc(x, y, 0.22, 0, 6.28); k.fill(d.metal ? '#5a5e60' : '#5e4630'); k.stroke(k.INK, 0.01); k.line([x - 0.15, y, x + 0.15, y], 'rgba(0,0,0,.4)', 0.012);
    k.line([1.75, 1.0, 1.95, 1.0], '#3a3e40', 0.025); for(let i=0;i<4;i++) k.line([1.78 + i*0.05, 0.95, 1.78 + i*0.05, 1.05], '#3a3e40', 0.01); if(d.leak){ k.puddle(1.4, 1.75, 0.3, 0.2); for(let i=0;i<4;i++) k.streak(k.R(1.1, 1.6), 1.4, 0.4, 0.03, '#6a8a9a', 0.35); } }
  const WATER_TOWER = [{n:'Деревянная бочка'}, {n:'Металлический бак', metal:true}, {n:'Протекает', leak:true}];
  function windmillDraw(g, d){ const k = hk(g), c = k.c, x = 1, y = 1;
    [[0.3, 0.3], [1.7, 0.3], [0.3, 1.7], [1.7, 1.7]].forEach(([px, py])=>{ k.line([x, y, px, py], 'rgba(0,0,0,.3)', 0.05); k.line([x, y, px, py], '#4a4e50', 0.035); });
    const n = d.blades || 5, rot = d.broken ? 0.4 : 0; for(let i=0;i<n;i++){ if(d.broken && i===1) continue; const a = rot + i*6.28/n; const p = [x, y, x + Math.cos(a - 0.12)*0.92, y + Math.sin(a - 0.12)*0.92, x + Math.cos(a + 0.1)*0.95, y + Math.sin(a + 0.1)*0.95]; k.fillP(p.map((v, j)=>v + (j%2 ? 0.08 : 0.06)), 'rgba(0,0,0,.3)'); if(d.sheet){ bits.sheet(k, p, i%2 ? '#5a6a6e' : null, false); } else { k.poly(p); k.texFill('wood', '#6b5236'); k.poly(p); k.stroke(k.INK, 0.01); } }
    if(d.broken){ const a = rot + 6.28/n; c.save(); c.translate(1.6, 1.75); c.rotate(a); k.poly([0, 0, 0.8, -0.06, 0.82, 0.08]); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.01); c.restore(); }
    k.line([x, y, x - 0.6, y + 0.35], '#3a3836', 0.03); k.poly([x - 0.55, y + 0.25, x - 0.85, y + 0.35, x - 0.75, y + 0.55, x - 0.55, y + 0.45]); k.texFill('rust', '#6b5546'); k.stroke(k.INK, 0.01);
    c.beginPath(); c.arc(x, y, 0.12, 0, 6.28); k.fill('#3a3e40'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x - 0.03, y - 0.03, 0.04, 0, 6.28); k.fill('rgba(255,255,255,.3)'); k.rust(x + 0.05, y + 0.04, 0.04, false); }
  const WINDMILL = [{n:'Деревянный', blades:6}, {n:'Из листов металла', blades:5, sheet:true}, {n:'Сломанный', blades:5, broken:true}];
  function totemDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    k.radial(x, y, 0.45, '#2a2018', 0.35); for(let i=0;i<6;i++) k.chunk(x + Math.cos(i)*0.3, y + Math.sin(i)*0.3, 0.06, '#7a766e', 0.02);
    for(let i=0;i<(d.cloth ? 4 : 0);i++){ const a = i*1.6 + 0.4; c.save(); c.translate(x, y); c.rotate(a); bits.fabric(k, [0.05, -0.04, 0.42, -0.06, 0.4, 0.05, 0.05, 0.04], k.pick(['#7a2a22', '#4a4a3a', '#8a7a5a']), 2, 'v'); c.restore(); }
    if(d.feathers) for(let i=0;i<7;i++){ const a = i*0.9; c.save(); c.translate(x + Math.cos(a)*0.1, y + Math.sin(a)*0.1); c.rotate(a); c.beginPath(); c.ellipse(0.12, 0, 0.12, 0.025, 0, 0, 6.28); k.fill(k.pick(['#2a2622', '#d8d0bc', '#5a3a2a'])); k.line([0, 0, 0.24, 0], 'rgba(0,0,0,.4)', 0.004); c.restore(); }
    c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.08, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.texFill('wood', '#5e4630'); k.stroke(k.INK, 0.008);
    const n = d.skulls || 4; for(let i=0;i<n;i++){ const a = i/n*6.28 + 0.6; bits.skull(k, x + Math.cos(a)*0.27, y + Math.sin(a)*0.27, 0.11, a + Math.PI/2); }
    if(d.horns){ k.line([x - 0.05, y, x - 0.3, y - 0.3, x - 0.25, y - 0.42], '#d8d0bc', 0.03); k.line([x + 0.05, y, x + 0.3, y - 0.3, x + 0.25, y - 0.42], '#d8d0bc', 0.03); } }
  const TOTEM = [{n:'Черепа', skulls:4}, {n:'С перьями и тряпьём', skulls:3, feathers:true, cloth:true}, {n:'С рогами', skulls:2, horns:true, cloth:true}];
  function cartDraw(g, d){ const k = hk(g), c = k.c;
    [[0.15, 1.6], [1.85, 1.6]].forEach(([x, y])=>{ c.save(); c.translate(x, y); k.rr(-0.07 + 0.03, -0.42 + 0.04, 0.14, 0.84, 0.04); k.fill('rgba(0,0,0,.35)'); k.rr(-0.07, -0.42, 0.14, 0.84, 0.04); k.texFill('wood', '#5e4630'); k.stroke(k.INK, 0.01); for(let i=0;i<6;i++) k.line([-0.07, -0.35 + i*0.14, 0.07, -0.35 + i*0.14], '#2a2018', 0.01); k.line([-0.07, -0.42, -0.07, 0.42], '#3a3e40', 0.02); c.restore(); });
    k.line([1, 0.35, 1, -0.2], '#5e4630', 0.06); k.line([0.85, -0.1, 1.15, -0.1], '#5e4630', 0.05); k.line([1, 0.35, 0.6, 0.0], '#5e4630', 0.04);
    k.rr(0.25 + 0.08, 0.35 + 0.1, 1.5, 2.45, 0.03); k.fill('rgba(0,0,0,.38)'); k.rr(0.25, 0.35, 1.5, 2.45, 0.03); k.texFill('wood', '#6b5236'); k.rr(0.25, 0.35, 1.5, 2.45, 0.03); k.stroke(k.INK, 0.014);
    if(d.covered){ const P = [0.22, 0.45, 1.78, 0.45, 1.78, 2.6, 0.22, 2.6]; bits.fabric(k, P, '#a69a7a', 7, 'h'); c.save(); k.poly(P); c.clip(); c.fillStyle = k.lin(0.22, 0, 1.78, 0, [[0, 'rgba(0,0,0,.35)'], [0.4, 'rgba(255,250,240,.12)'], [1, 'rgba(0,0,0,.4)']]); c.fillRect(0, 0, 2, 3); c.restore(); for(let i=0;i<5;i++) k.line([0.22, 0.6 + i*0.45, 1.78, 0.6 + i*0.45], 'rgba(60,40,24,.5)', 0.02); k.poly(P); k.stroke(k.INK, 0.012); if(d.torn){ k.organic(1.2, 1.4, 0.25, 0.5, 0.3); k.fill('#141210'); c.save(); k.organic(1.2, 1.4, 0.25, 0.5, 0.3); c.clip(); houseBits.crate(k, 1.2, 1.4, 0.3, 0.25, 0.3); c.restore(); } }
    else { houseBits.crate(k, 0.65, 0.8, 0.45, 0.4, 0.05); houseBits.crate(k, 1.3, 0.85, 0.4, 0.35, -0.1); bits.barrel(k, 0.65, 1.55, 0.2, '#5a6040'); bits.barrel(k, 1.3, 1.55, 0.2, '#6a4a36'); for(let i=0;i<3;i++){ k.organic(0.6 + i*0.35, 2.3, 0.16, 0.3, 0.12); k.fill('#8a7a5a'); k.stroke(k.INK, 0.008); k.line([0.6 + i*0.35 - 0.1, 2.3, 0.6 + i*0.35 + 0.1, 2.3], 'rgba(0,0,0,.3)', 0.01); } k.line([0.3, 1.2, 1.7, 1.25], '#8a7a5a', 0.015); }
    if(d.abandoned){ k.radial(1, 1.5, 1.4, '#0c0a08', 0.2); k.trash(0, 0.3, 2, 2.6, 10); k.plank(1.7, 2.7, 0.6, 0.1, 0.8, '#5e4630', true); } }
  const CART = [{n:'Крытая повозка', covered:true}, {n:'Открытая, с грузом'}, {n:'Брошенная, тент порван', covered:true, torn:true, abandoned:true}];
  function gateDraw(g, d){ const k = hk(g), c = k.c;
    const tower = (x)=>{ k.rr(x + 0.07, 0.08 + 0.09, 0.8, 0.84, 0.02); k.fill('rgba(0,0,0,.4)'); if(d.wood){ k.rr(x, 0.08, 0.8, 0.84, 0.02); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.012); for(let i=0;i<6;i++) k.line([x + 0.05 + i*0.13, 0.1, x + 0.05 + i*0.13, 0.9], 'rgba(30,20,12,.4)', 0.012); } else bits.sheet(k, [x, 0.08, x + 0.8, 0.08, x + 0.8, 0.92, x, 0.92], '#6a4a36', true);
      for(let i=0;i<5;i++){ const a = i/5*3.14 + 3.3; houseBits.sandbag(k, x + 0.4 + Math.cos(a)*0.28, 0.5 + Math.sin(a)*0.28, a + Math.PI/2); } bits.barrel(k, x + 0.4, 0.62, 0.11, '#4a3a2a', true); bits.fire(k, x + 0.4, 0.62, 0.08, 0.7); };
    tower(0); tower(3.2);
    if(d.wood){ for(let i=0;i<15;i++){ const x = 0.85 + i*0.16; if(d.broken && i > 5 && i < 9) continue; c.beginPath(); c.arc(x + 0.02, 0.52, 0.08, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, 0.5, 0.075, 0, 6.28); k.texFill('wood', '#5e4630'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x - 0.01, 0.49, 0.03, 0, 6.28); k.fill('rgba(255,240,220,.2)'); } }
    else { const gw = d.broken ? 0.9 : 1.2; [[0.8, 0.8 + gw], [3.2 - gw, 3.2]].forEach(([a, b], i)=>{ if(d.broken && i===1){ c.save(); c.translate(2.6, 0.8); c.rotate(0.6); bits.sheet(k, [-0.6, -0.15, 0.6, -0.15, 0.6, 0.15, -0.6, 0.15], '#5a6a6e', true); c.restore(); return; } bits.sheet(k, [a, 0.3, b, 0.3, b, 0.7, a, 0.7], i ? '#5a6a6e' : null, true); for(let x=a + 0.1;x<b;x+=0.25) k.line([x, 0.3, x, 0.7], '#3a3836', 0.02); }); k.line([2.0, 0.28, 2.0, 0.72], '#1e1c1a', 0.03); }
    bits.skull(k, 2.0, 0.15, 0.08, 0); for(let i=0;i<2;i++) k.line([0.4 + i*3.2, 0.08, 0.4 + i*3.2, -0.1], '#3a3836', 0.03); k.trash(0.8, 0.7, 2.4, 0.3, 8); }
  const GATE = [{n:'Металлические ворота'}, {n:'Частокол', wood:true}, {n:'Выбитые ворота', broken:true}];
  function drumFireDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    if(d.tipped){ c.save(); c.translate(x, y); c.rotate(0.5); k.rr(-0.38 + 0.04, -0.27 + 0.05, 0.76, 0.54, 0.04); k.fill('rgba(0,0,0,.38)'); k.rr(-0.38, -0.27, 0.76, 0.54, 0.04); c.fillStyle = k.lin(0, -0.27, 0, 0.27, [[0, '#7a4a36'], [0.4, '#a06a46'], [1, '#3a2418']]); c.fill(); k.stroke(k.INK, 0.012); [-0.15, 0.15].forEach(dx=>k.line([dx, -0.27, dx, 0.27], 'rgba(0,0,0,.4)', 0.02)); k.c.beginPath(); k.c.ellipse(0.38, 0, 0.06, 0.26, 0, 0, 6.28); k.fill('#141210'); for(let i=0;i<4;i++) k.rust(k.R(-0.3, 0.3), k.R(-0.2, 0.2), 0.05, false); c.restore(); bits.embers(k, 0.82, 0.78, 0.12); k.blot(0.82, 0.8, 0.15, '#5a5550', 0.7); return; }
    bits.barrel(k, x, y, 0.33, '#6a4a36', true); c.save(); c.beginPath(); c.arc(x, y, 0.26, 0, 6.28); c.clip(); bits.logs(k, x, y, 0.15, 4, true); if(d.state==='smoulder') bits.embers(k, x, y, 0.2); c.restore();
    for(let i=0;i<6;i++){ const a = i/6*6.28; c.beginPath(); c.arc(x + Math.cos(a)*0.29, y + Math.sin(a)*0.29, 0.025, 0, 6.28); k.fill('#0c0a08'); }
    if(d.state==='fire') bits.fire(k, x, y, 0.2, 1); else k.radial(x, y, 0.4, '#c85a20', 0.3); }
  const DRUM_FIRE = [{n:'Горит', state:'fire'}, {n:'Тлеет', state:'smoulder'}, {n:'Опрокинута', tipped:true}];
  /* ---- Дополнительная детализация военных объектов и пустошей ----
     EX[id](g, d) рисуется поверх основного рисунка: снаряжение, тросы, трафареты, мелкий скарб. */
  const xb = {
    jerry(k, x, y, a, col){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-0.08 + 0.02, -0.11 + 0.03, 0.16, 0.22, 0.02); k.fill('rgba(0,0,0,.38)'); k.rr(-0.08, -0.11, 0.16, 0.22, 0.02); c.fillStyle = k.lin(-0.08, -0.11, 0.08, 0.11, [[0, shade(col, 0.2)], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.006);
      k.line([-0.05, -0.06, 0.05, 0.06], 'rgba(0,0,0,.3)', 0.012); k.line([0.05, -0.06, -0.05, 0.06], 'rgba(0,0,0,.3)', 0.012); k.rr(-0.06, -0.13, 0.12, 0.03, 0.01); k.fill('#2a2826'); c.beginPath(); c.arc(0.05, -0.12, 0.018, 0, 6.28); k.fill('#5a5e60'); k.rust(-0.03, 0.06, 0.025, false); c.restore(); },
    cone(k, x, y, r, fallen){ const c = k.c; if(fallen){ c.save(); c.translate(x, y); c.rotate(0.7); k.poly([-r, -r*0.4, r*1.4, 0, -r, r*0.4]); k.fill('#c8582a'); k.stroke(k.INK, 0.006); k.line([0, -r*0.25, 0, r*0.25], '#e4ddca', r*0.25); c.restore(); return; } k.rr(x - r, y - r, r*2, r*2, r*0.2); k.fill('#2a2826'); c.beginPath(); c.arc(x + r*0.15, y + r*0.2, r*0.8, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, r*0.8, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#e07a3a'], [1, '#9a3a1a']]); c.fill(); c.beginPath(); c.arc(x, y, r*0.55, 0, 6.28); k.stroke('#e4ddca', r*0.18); c.beginPath(); c.arc(x, y, r*0.2, 0, 6.28); k.fill('#5a2a14'); },
    cable(k, pts, col, w){ const c = k.c; c.beginPath(); c.moveTo(pts[0], pts[1]); for(let i=2;i<pts.length - 2;i+=2) c.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[i + 2])/2, (pts[i + 1] + pts[i + 3])/2); c.lineTo(pts[pts.length - 2], pts[pts.length - 1]); k.stroke(col || '#1a1816', w || 0.018); },
    tow(k, x0, y0, x1, y1){ const c = k.c, n = Math.round(Math.hypot(x1 - x0, y1 - y0)/0.04); for(let i=0;i<n;i++){ const t = i/n, x = x0 + (x1 - x0)*t, y = y0 + (y1 - y0)*t; c.beginPath(); c.ellipse(x, y, 0.022, 0.012, Math.atan2(y1 - y0, x1 - x0) + (i%2 ? 0.6 : -0.6), 0, 6.28); k.fill(i%2 ? '#4a4844' : '#2e2c2a'); } [[x0, y0], [x1, y1]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.stroke('#3a3836', 0.014); }); },
    box(k, x, y, w, h, a, col){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-w/2 + 0.02, -h/2 + 0.03, w, h, 0.01); k.fill('rgba(0,0,0,.35)'); k.rr(-w/2, -h/2, w, h, 0.01); k.texFill('metal', '#6d7376', col, 0.55); k.rr(-w/2, -h/2, w, h, 0.01); k.stroke(k.INK, 0.006); k.line([-w/2 + 0.01, -h/2 + 0.01, w/2 - 0.01, -h/2 + 0.01], 'rgba(255,255,255,.25)', 0.006); [[-w/2 + 0.03, 0], [w/2 - 0.03, 0]].forEach(([lx])=>{ k.rr(lx - 0.012, -0.02, 0.024, 0.04, 0.004); k.fill('#2a2826'); }); c.restore(); },
    links(k, x, y, n, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); for(let i=0;i<n;i++){ k.rr(-0.1 + 0.015, i*0.075 + 0.02, 0.2, 0.065, 0.008); k.fill('rgba(0,0,0,.3)'); k.rr(-0.1, i*0.075, 0.2, 0.065, 0.008); k.fill('#2e2c2a'); k.line([-0.08, i*0.075 + 0.032, 0.08, i*0.075 + 0.032], '#5a5650', 0.012); k.rust(k.R(-0.06, 0.06), i*0.075 + 0.03, 0.015, false); } c.restore(); },
    smoke(k, x, y, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a); for(let i=0;i<3;i++){ c.beginPath(); c.arc(i*0.055, 0, 0.025, 0, 6.28); k.fill('#2a2e24'); k.stroke(k.INK, 0.005); c.beginPath(); c.arc(i*0.055, 0, 0.012, 0, 6.28); k.fill('#0e0e0c'); } c.restore(); },
    star(k, x, y, r, col){ const c = k.c; c.beginPath(); for(let i=0;i<10;i++){ const an = -Math.PI/2 + i*Math.PI/5, rr = i%2 ? r*0.42 : r; c.lineTo(x + Math.cos(an)*rr, y + Math.sin(an)*rr); } c.closePath(); k.fill(col || '#8e2e26', 0.8); k.stroke('rgba(230,224,210,.6)', r*0.08); },
    mud(k, x0, y0, w, h, n){ for(let i=0;i<n;i++){ const x = x0 + k.rnd()*w, y = y0 + k.rnd()*h; k.blot(x, y, k.R(0.03, 0.09), k.pick(['#5a4a36', '#4a3e30', '#6a5a44']), 0.55, 0.6); } },
    bedroll(k, x, y, a, col){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a); k.rr(-0.25 + 0.02, -0.07 + 0.03, 0.5, 0.14, 0.06); k.fill('rgba(0,0,0,.3)'); k.rr(-0.25, -0.07, 0.5, 0.14, 0.06); c.fillStyle = k.lin(0, -0.07, 0, 0.07, [[0, shade(col, 0.2)], [1, shade(col, -0.3)]]); c.fill(); k.stroke(k.INK, 0.006); [-0.15, 0.15].forEach(sx=>k.line([sx, -0.07, sx, 0.07], '#3a2a1a', 0.014)); for(let i=0;i<5;i++) k.line([-0.22 + i*0.1, -0.05, -0.2 + i*0.1, 0.05], 'rgba(0,0,0,.15)', 0.006); c.restore(); },
    pot(k, x, y, r){ const c = k.c; c.beginPath(); c.arc(x + r*0.2, y + r*0.25, r, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = k.lin(x - r, y - r, x + r, y + r, [[0, '#6a6e70'], [1, '#1e2022']]); c.fill(); k.stroke(k.INK, r*0.08); c.beginPath(); c.arc(x, y, r*0.75, 0, 6.28); k.fill('#141210'); c.beginPath(); c.arc(x, y, r*1.15, -2.4, -0.7); k.stroke('#3a3836', r*0.12); },
    firewood(k, x, y, n, a){ for(let i=0;i<n;i++) k.plank(x + (i%3)*0.07 - 0.07, y + Math.floor(i/3)*0.06, 0.32, 0.07, (a || 0) + k.R(-0.08, 0.08), k.pick(['#6a5236', '#5e4630', '#7a6040']), false); },
    laundry(k, x0, y0, x1, y1){ const c = k.c; k.line([x0, y0, x1, y1], '#c8c0a8', 0.007); [[x0, y0], [x1, y1]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.03, 0, 6.28); k.fill('#5e4630'); }); const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)/0.3)); for(let i=0;i<n;i++){ const t = (i + 0.5)/n, x = x0 + (x1 - x0)*t, y = y0 + (y1 - y0)*t; c.save(); c.translate(x, y); c.rotate(Math.atan2(y1 - y0, x1 - x0) + k.R(-0.1, 0.1)); k.rr(-0.08, 0, 0.16, k.R(0.12, 0.22), 0.01); k.fill(k.pick(['#8a7a6a', '#5a6a7a', '#9a8a5a', '#7a4a3a', '#c9c1a8', '#4a5a4a']), 0.92); k.stroke('rgba(0,0,0,.35)', 0.005); c.restore(); } },
    lantern(k, x, y){ k.radial(x, y, 0.35, '#f0b050', 0.35); const c = k.c; c.beginPath(); c.arc(x, y, 0.05, 0, 6.28); k.fill('#3a3836'); c.beginPath(); c.arc(x, y, 0.032, 0, 6.28); k.fill('#ffe0a0'); },
    plate(k, x, y, w, h, txt, col, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a || 0); k.rr(-w/2 + 0.015, -h/2 + 0.02, w, h, 0.01); k.fill('rgba(0,0,0,.35)'); k.rr(-w/2, -h/2, w, h, 0.01); k.fill(col || '#d8d0bc'); k.stroke(k.INK, 0.006); bits.stencil(k, 0, 0.005, txt, h*0.55, '#2a2422', 0.9); k.rust(w*0.3, h*0.2, h*0.2, false); c.restore(); },
    craters(k, pts, n, r){ for(let i=0;i<n;i++){ const p = Math.floor(k.rnd()*pts.length/2)*2, x = pts[p] + k.R(-0.12, 0.12), y = pts[p + 1] + k.R(-0.12, 0.12); k.organic(x, y, r*k.R(0.6, 1.2), 0.5); k.fill('#5a5650'); k.c.beginPath(); k.c.arc(x, y, r*0.3, 0, 6.28); k.fill('#1a1816'); k.organic(x - r*0.15, y - r*0.15, r*0.8, 0.5); k.stroke('rgba(230,226,216,.35)', r*0.12); } },
  };
  // мешок с песком: плетение, шов, перевязанный край, выцветшая маркировка (для всех укреплений)
  houseBits.sandbag = function(k, x, y, a){ const c = k.c; c.save(); c.translate(x, y); c.rotate(a);
    c.beginPath(); c.ellipse(0.025, 0.035, 0.17, 0.09, 0, 0, 6.28); k.fill('rgba(0,0,0,.38)');
    c.beginPath(); c.moveTo(-0.17, 0); c.bezierCurveTo(-0.17, -0.1, 0.13, -0.1, 0.17, -0.03); c.lineTo(0.19, 0); c.lineTo(0.17, 0.03); c.bezierCurveTo(0.13, 0.1, -0.17, 0.1, -0.17, 0); c.closePath(); c.fillStyle = k.lin(-0.17, -0.09, 0.17, 0.09, [[0, '#c9b483'], [0.5, '#a8925f'], [1, '#7a6844']]); c.fill(); k.stroke('rgba(30,24,16,.75)', 0.009);
    c.save(); c.clip(); for(let i=-8;i<=8;i++) k.line([i*0.022 - 0.04, -0.1, i*0.022 + 0.04, 0.1], 'rgba(60,48,30,.14)', 0.004); for(let i=-4;i<=4;i++) k.line([-0.2, i*0.022, 0.2, i*0.022], 'rgba(255,245,220,.08)', 0.004); k.radial(-0.05, -0.03, 0.12, '#f0e4c4', 0.25); c.restore();
    k.line([-0.14, 0.035, 0.12, 0.04], 'rgba(60,48,30,.45)', 0.005, null, [0.012, 0.008]); k.line([0.15, -0.035, 0.15, 0.035], '#5a4628', 0.014); k.line([0.17, -0.02, 0.2, -0.04], '#5a4628', 0.006);
    if(k.rnd() < 0.3) bits.stencil(k, -0.03, -0.005, 'ВС', 0.05, '#3a3020', 0.35); c.restore(); };
  const EX = {
    bunker(g, d){ const k = hk(g), c = k.c;
      for(let i=0;i<8;i++){ const cx = 0.7 + i*0.38; c.beginPath(); c.ellipse(cx, 0.45, 0.17, 0.09, 0, 0, 6.28); k.stroke('#3e4244', 0.014); for(let j=0;j<6;j++){ const an = j/6*6.28; k.line([cx + Math.cos(an)*0.17 - 0.012, 0.45 + Math.sin(an)*0.09, cx + Math.cos(an)*0.17 + 0.012, 0.45 + Math.sin(an)*0.09], '#3e4244', 0.008); } }
      bits.stencil(k, 2.0, 2.85, 'Б-12', 0.24, '#c8a040', 0.55); k.c.save(); k.c.translate(2.0, 3.24); for(let i=0;i<6;i++){ k.poly([-0.42 + i*0.14, -0.07, -0.35 + i*0.14, -0.07, -0.42 + i*0.14 + 0.07, 0.07, -0.49 + i*0.14 + 0.07, 0.07]); k.fill(i%2 ? '#c8a030' : '#1e1c1a', 0.75); } k.c.restore();
      xb.cable(k, [2.7, 1.2, 2.9, 1.6, 2.95, 2.2, 2.9, 2.6]); k.line([3.3, 0.85, 3.3, 0.6], '#2a2826', 0.03); k.c.beginPath(); k.c.arc(3.3, 0.85, 0.05, 0, 6.28); k.fill('#3a3e40'); for(let i=0;i<3;i++) k.streak(1.2 + i*0.03, 1.38, 0.5, 0.03, '#6a4028', 0.35);
      xb.jerry(k, 1.05, 3.65, 0.2, '#4a5a34'); xb.jerry(k, 1.25, 3.7, -0.1, '#8e3a2e'); houseBits.crate(k, 3.0, 3.7, 0.36, 0.26, 0.15); k.rr(1.85, 2.55, 0.3, 0.2, 0.01); k.fill('#2a2826'); for(let i=0;i<5;i++) k.line([1.88 + i*0.06, 2.57, 1.88 + i*0.06, 2.73], '#5a5e60', 0.012); },
    pillbox(g, d){ const k = hk(g); const emb = [1, 0.25, 0.32, 0.65, 1.68, 0.65]; xb.craters(k, emb, d.ruined ? 8 : 16, 0.035); [[1, 0.36], [0.4, 0.72], [1.6, 0.72]].forEach(([x, y])=>k.radial(x, y + 0.05, 0.2, '#0c0a08', 0.4)); bits.stencil(k, 1, 1.05, '17', 0.2, '#d8d0bc', 0.45); k.organic(1.35, 1.3, 0.1, 0.5); k.fill('#5a5650'); for(let i=0;i<4;i++) k.rebar([1.3 + i*0.03, 1.25, 1.33 + i*0.03, 1.38]); xb.jerry(k, 1.55, 1.85, 0.4, '#4a5a34'); },
    checkpoint(g, d){ const k = hk(g), c = k.c; if(!d.scrap){ [[2.1, 1.7], [2.45, 1.75], [2.8, 1.68]].forEach(([x, y], i)=>xb.cone(k, x, y, 0.09, d.burnt && i===1)); }
      k.rr(1.5, 1.5, 1.35, 0.06, 0.01); k.fill('#1e1c1a'); for(let x=1.53;x<2.85;x+=0.06) k.fillP([x, 1.5, x + 0.03, 1.5, x + 0.015, 1.44], '#9a9e9c');
      k.line([0.95, 0.35, 0.95, 0.1], '#2a2826', 0.02); if(!d.burnt){ c.save(); c.translate(0.3, 0.4); k.rr(-0.06, -0.04, 0.12, 0.08, 0.02); k.fill('#3a3e40'); c.restore(); xb.lantern(k, 0.3, 0.32); }
      xb.cable(k, [0.95, 0.15, 1.3, 0.05, 1.8, 0.12, 2.9, 0.05], '#1a1816', 0.012); if(!d.scrap) xb.plate(k, 1.65, 0.95, 0.5, 0.16, d.sign==='ПОСТ' ? 'ДОКУМЕНТЫ' : 'СТОЙ!', '#d8d0bc', 0); for(let i=0;i<3;i++) k.puddle(k.R(1.4, 2.8), k.R(0.9, 1.4), k.R(0.08, 0.15), k.R(0.06, 0.1)); },
    czech_hedgehog(g, d){ const k = hk(g); k.organic(0.5, 0.5, 0.18, 0.4); k.fill('#8a7a5e', 0.6); for(let i=0;i<6;i++){ const an = i/6*6.28; k.line([0.5 + Math.cos(an)*0.07, 0.5 + Math.sin(an)*0.07, 0.5 + Math.cos(an + 0.5)*0.07, 0.5 + Math.sin(an + 0.5)*0.07], '#8a6a4a', 0.012); } [[0.14, 0.14], [0.86, 0.86], [0.86, 0.14], [0.14, 0.86], [0.18, 0.5], [0.82, 0.5]].forEach(([x, y])=>{ for(let j=0;j<2;j++){ k.c.beginPath(); k.c.arc(x + (j ? 0.03 : -0.03), y, 0.012, 0, 6.28); k.fill('#5a5e60'); } }); k.tufts(0.2, 0.2, 0.6, 0.6, 5); },
    ammo_crate(g, d){ if(d.stack || d.zinc) return; const k = hk(g); if(!d.open){ bits.stencil(k, 0.5, 0.36, '440 ШТ', 0.06, '#d8d0b0', 0.55); bits.stencil(k, 0.5, 0.64, 'ПС ГЖ', 0.06, '#d8d0b0', 0.55); xb.plate(k, 0.25, 0.62, 0.16, 0.08, '№3', '#c9c1a8', 0); } [[0.08, 0.5], [0.92, 0.5]].forEach(([x, y])=>{ k.line([x, y - 0.06, x + (x < 0.5 ? -0.05 : 0.05), y, x, y + 0.06], '#8a7a5a', 0.012); }); },
    tank_wreck(g, d){ const k = hk(g), c = k.c; xb.tow(k, 0.42, 0.65, 0.42, 2.2); xb.tow(k, 1.58, 0.65, 1.58, 2.2); if(!d.burnt){ xb.links(k, 0.75, 0.24, 3, 0); xb.links(k, 1.25, 0.24, 3, 0); xb.box(k, 0.52, 1.2, 0.14, 0.35, 0, '#4e5440'); xb.box(k, 1.48, 1.6, 0.14, 0.35, 0, '#4e5440'); }
      xb.mud(k, 0.38, 0.3, 1.24, 0.4, 12); xb.mud(k, 0.38, 2.4, 1.24, 0.45, 12); [[0.5, 0.25], [1.5, 0.25]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill(d.burnt ? '#141210' : '#c8c2a8'); k.stroke(k.INK, 0.006); });
      k.radial(1, 2.85, 0.4, '#0c0a08', 0.35); if(!d.turretOff){ const rot = d.turretRot || 0; c.save(); c.translate(1, 1.35); c.rotate(rot); xb.smoke(k, -0.42, -0.15, -0.6); xb.smoke(k, 0.3, -0.25, 0.6); bits.stencil(k, 0, 0.3, '214', 0.12, '#d8d0bc', d.burnt ? 0.15 : 0.6); if(!d.burnt){ xb.star(k, -0.3, -0.05, 0.07); k.line([0.35, 0.1, 0.55, 0.42], '#141210', 0.008); } c.restore(); } },
    apc_wreck(g, d){ const k = hk(g), c = k.c; xb.tow(k, 0.25, 0.9, 0.25, 3.4); xb.tow(k, 1.75, 0.9, 1.75, 3.4); bits.stencil(k, 1, 2.35, '132', 0.16, '#d8d0bc', d.burnt ? 0.15 : 0.6); c.save(); c.translate(1, 1.35); xb.smoke(k, -0.3, -0.25, -0.5); xb.smoke(k, 0.18, -0.3, 0.5); c.restore(); for(let i=0;i<4;i++){ k.rr(0.45 + i*0.3, 0.52, 0.12, 0.05, 0.01); k.fill('#1e2426'); } xb.mud(k, 0.2, 3.4, 1.6, 0.45, 14); if(!d.burnt){ c.beginPath(); c.arc(1, 3.55, 0.18, 0, 6.28); k.fill('#1c1b1a'); c.beginPath(); c.arc(1, 3.55, 0.09, 0, 6.28); k.fill('#4a4e3a'); xb.jerry(k, 0.4, 3.62, 0, '#4a5a34'); xb.jerry(k, 1.6, 3.62, 0, '#4a5a34'); } },
    watchtower(g, d){ if(d.ruined) return; const k = hk(g); ventPipe(k, 0.5, 0.5, 0.06); k.line([0.3, 1.7, 0.3, 1.95], '#2a2826', 0.02); xb.cable(k, [1.95, 1.2, 1.7, 1.5, 1.3, 1.6, 0.4, 1.7], '#1a1816', 0.012); k.rr(0.8, 0.8, 0.4, 0.4, 0.02); k.fill('rgba(0,0,0,.25)'); k.rr(0.8, 0.8, 0.4, 0.4, 0.02); k.stroke('rgba(0,0,0,.45)', 0.012); k.line([0.8, 0.86, 1.2, 0.86], '#2a2826', 0.02); },
    vault_door(g, d){ const k = hk(g); for(let i=0;i<14;i++){ const x = 0.6 + i*0.13; k.poly([x, 0.8, x + 0.065, 0.8, x + 0.11, 0.9, x + 0.045, 0.9]); k.fill(i%2 ? '#c8a030' : '#1e1c1a', 0.7); } xb.cable(k, [0.05, 0.25, 0.4, 0.3, 0.9, 0.25], '#2a2826', 0.03); xb.cable(k, [2.95, 0.25, 2.6, 0.3, 2.1, 0.25], '#2a2826', 0.03); xb.lantern(k, 0.5, 0.3); },
    turret(g, d){ const k = hk(g); if(d.broken) return; xb.cable(k, [0.62, 0.55, 0.75, 0.75, 0.9, 0.8, 0.98, 0.95], '#1a1816', 0.016); k.line([0.62, 0.55, 0.72, 0.4, 0.75, 0.25], '#a8853a', 0.02, 0.9, [0.015, 0.008]); },
    weapon_rack(g, d){ const k = hk(g); if(d.broken) return; for(let i=0;i<(d.full ? 6 : 2);i++){ const x = 0.25 + i*0.3 + (d.full ? 0 : 0.3); k.rr(x - 0.04, 0.42, 0.08, 0.05, 0.005); k.fill('#c9c1a8'); } xb.box(k, 1.7, 0.85, 0.3, 0.12, 0, '#4e5a34'); },
    tent(g, d){ const k = hk(g); xb.bedroll(k, 0.6, 1.92, 0.1, '#5a6a4a'); xb.jerry(k, 1.45, 1.88, 0.3, '#8e3a2e'); if(!d.camp) xb.pot(k, 0.25, 1.85, 0.07); for(let i=0;i<2;i++){ k.rr(1.05 + i*0.09, 1.9, 0.06, 0.09, 0.02); k.fill('#2a2018'); } k.line([0.32, 0.31, 0.32, 1.69], 'rgba(0,0,0,.3)', 0.01, null, [0.03, 0.02]); k.line([1.68, 0.31, 1.68, 1.69], 'rgba(0,0,0,.3)', 0.01, null, [0.03, 0.02]); },
    big_tent(g, d){ const k = hk(g); if(d.market) return; xb.lantern(k, 1.5, 1.5); houseBits.crate(k, 0.25, 2.75, 0.3, 0.22, 0.3); xb.bedroll(k, 2.75, 2.6, 1.2, '#7a3a2e'); xb.jerry(k, 2.85, 0.3, 0.4, '#4a5a34'); k.rr(1.3, 2.88, 0.4, 0.12, 0.02); k.fill('#7a3a2e', 0.9); for(let i=0;i<6;i++) k.line([1.32 + i*0.06, 2.89, 1.32 + i*0.06, 2.99], '#c9a24a', 0.006); },
    campfire(g, d){ const k = hk(g); k.plank(0.15, 0.85, 0.35, 0.1, 0.3, '#5e4630', false); k.plank(0.88, 0.25, 0.32, 0.1, -1.2, '#5e4630', false); for(let i=0;i<3;i++){ k.c.save(); k.c.translate(k.R(0.15, 0.85), k.R(0.8, 0.95)); k.c.rotate(k.rnd()*6.28); k.rr(-0.04, -0.008, 0.08, 0.016, 0.008); k.fill('#d8d0bc'); k.c.restore(); } if(d.state!=='out' && !d.pot) xb.pot(k, 0.85, 0.82, 0.06); },
    gas_station(g, d){ const k = hk(g); for(let i=0;i<4;i++) k.tire(0.35, 3.0 - i*0.06 + (i%2)*0.02, 0.17); [[3.45, 3.6], [3.45, 0.4]].forEach(([x, y])=>{ k.rr(x - 0.09, y - 0.09, 0.18, 0.18, 0.03); k.fill('#3e4a3e'); k.stroke(k.INK, 0.008); k.c.beginPath(); k.c.arc(x, y, 0.05, 0, 6.28); k.fill('#141210'); }); xb.jerry(k, 1.6, 3.7, 0.5, '#8e3a2e'); xb.jerry(k, 1.8, 3.72, -0.2, '#8e3a2e'); if(!d.burnt && !d.collapsed){ k.c.save(); k.c.translate(4.1, 3.6); k.rr(-0.35, -0.15, 0.7, 0.3, 0.03); k.fill('#c9c6bd'); k.stroke(k.INK, 0.008); bits.stencil(k, 0, 0, 'ЛЁД', 0.12, '#3e5a7a', 0.8); k.c.restore(); } },
    scrap_shack(g, d){ const k = hk(g); k.rr(0.5, 2.95, 0.5, 0.05, 0.01); k.fill('rgba(170,190,180,.55)'); xb.laundry(k, 2.95, 0.4, 2.95, 2.4); bits.barrel(k, 0.2, 2.75, 0.13, '#3e5a6a', true); xb.firewood(k, 2.45, 2.75, 6, 0); if(!d.fort) dish(k, 0.6, 0.4, 0.14); k.radial(2.25, 0.5, 0.35, '#1a1612', 0.3); },
    scrap_tower(g, d){ const k = hk(g); for(let i=0;i<6;i++) k.line([0.9, 1.82 + i*0.03, 1.1, 1.82 + i*0.03], '#7a6a4a', 0.008); k.line([0.2, 0.2, 0.2, -0.0], '#3a3836', 0.025); bits.fabric(k, [0.2, 0.0, 0.5, 0.02, 0.48, 0.12, 0.2, 0.1], '#8e2e26', 2, 'v'); xb.jerry(k, 1.55, 1.5, 0.3, '#4a5a34'); },
    buggy(g, d){ const k = hk(g); if(d.wreck) return; xb.jerry(k, 0.88, 1.15, 0, '#8e3a2e'); k.c.beginPath(); k.c.arc(0.5, 1.88, 0.14, 0, 6.28); k.fill('#1c1b1a'); k.c.beginPath(); k.c.arc(0.5, 1.88, 0.07, 0, 6.28); k.fill('#4a4844'); [[0.32, 0.13], [0.68, 0.13]].forEach(([x, y])=>{ k.c.beginPath(); k.c.arc(x, y, 0.035, 0, 6.28); k.fill('#c8c2a8'); k.stroke(k.INK, 0.005); }); bits.stencil(k, 0.5, 1.02, '13', 0.08, '#e4ddca', 0.7); k.line([0.66, 1.6, 0.72, 1.82], '#2a2826', 0.025); },
    war_rig(g, d){ const k = hk(g); [[0.25, 1.4], [1.75, 1.4]].forEach(([x, y])=>{ k.c.beginPath(); k.c.arc(x, y, 0.07, 0, 6.28); k.fill('#2a2826'); k.stroke(k.INK, 0.008); k.c.beginPath(); k.c.arc(x, y, 0.04, 0, 6.28); k.fill('#0c0a08'); k.radial(x + 0.05, y + 0.1, 0.3, '#1a1612', 0.35); }); for(let i=0;i<8;i++) k.line([1.9, 1.6 + i*0.12, 1.93, 1.62 + i*0.12], '#5a5e60', 0.02); xb.cable(k, [0.3, 4.85, 0.6, 4.95, 1.0, 4.9, 1.5, 4.95], '#3e4244', 0.02); if(d.tanker) xb.plate(k, 1, 4.3, 0.7, 0.16, 'ОГНЕОПАСНО', '#c8a030', 0); },
    plane_wreck(g, d){ const k = hk(g), c = k.c; [-1, 1].forEach(sx=>{ const ex = 3 + sx*1.2; if(sx > 0 && d.wingOff) return; c.save(); c.translate(ex, 2.02); for(let i=0;i<12;i++){ const an = i/12*6.28; k.line([0, 0, Math.cos(an)*0.12, Math.sin(an)*0.045], '#6a6e70', 0.012); } c.restore(); }); if(!d.mil){ bits.stencil(k, 1.5, 2.85, 'RA-6' + (d.burnt ? '1' : '5') + '04', 0.16, '#2a2826', 0.6); } else xb.star(k, 1.4, 2.78, 0.1, '#8e2e26'); for(let i=0;i<5;i++) k.line([3.6 + i*0.4, 2.95, 3.6 + i*0.4, 3.08], 'rgba(0,0,0,.35)', 0.012); if(!d.burnt){ c.save(); c.translate(3.8, 1.2); c.rotate(0.5); k.rr(-0.5, -0.15, 1.0, 0.3, 0.12); k.fill('#c8682a', 0.9); k.stroke(k.INK, 0.008); c.restore(); } },
    water_tower(g, d){ const k = hk(g); for(let i=0;i<6;i++) k.line([0.12, 1.05 + i*0.12, 0.28, 1.05 + i*0.12], '#5a5e60', 0.014); k.line([0.12, 1.0, 0.12, 1.75], '#5a5e60', 0.02); k.line([0.28, 1.0, 0.28, 1.75], '#5a5e60', 0.02); xb.cable(k, [1.0, 1.85, 1.2, 1.95, 1.6, 1.95, 1.95, 1.85], '#2a2e30', 0.04); },
    windmill(g, d){ const k = hk(g); xb.box(k, 1.4, 1.55, 0.3, 0.2, 0.2, '#5a6040'); xb.cable(k, [1.0, 1.0, 1.2, 1.3, 1.4, 1.55], '#1a1816', 0.014); xb.cable(k, [1.55, 1.55, 1.8, 1.7, 1.95, 1.95], '#1a1816', 0.014); },
    caravan_cart(g, d){ const k = hk(g); xb.lantern(k, 1.0, 0.45); if(!d.abandoned){ xb.bedroll(k, 0.5, 2.85, 0, '#5a6a4a'); xb.pot(k, 1.55, 2.9, 0.06); } for(let i=0;i<3;i++) k.line([0.85 + i*0.15, -0.15, 0.85 + i*0.15, 0.1], '#5e4630', 0.015); },
    settlement_gate(g, d){ const k = hk(g); xb.plate(k, 2.0, 0.85, 0.6, 0.14, 'ВХОД', '#d8d0bc', 0.03); xb.cable(k, [0.4, 0.62, 1.2, 0.45, 2.0, 0.4, 2.8, 0.45, 3.6, 0.62], '#1a1816', 0.012); [1.2, 2.0, 2.8].forEach(x=>xb.lantern(k, x, 0.45)); },
    oil_drum_fire(g, d){ if(d.tipped) return; const k = hk(g); for(let i=0;i<5;i++) k.line([0.28 + i*0.11, 0.25, 0.28 + i*0.11, 0.75], 'rgba(40,36,32,.85)', 0.014); k.line([0.25, 0.3, 0.75, 0.3], 'rgba(40,36,32,.85)', 0.014); k.line([0.25, 0.7, 0.75, 0.7], 'rgba(40,36,32,.85)', 0.014); },
  };
  const GAS = [{n:'Заброшенная'}, {n:'Навес обрушен', collapsed:true}, {n:'Укреплённая', fort:true}, {n:'Сгоревшая', burnt:true}];
  const PICKUP = [
    {n:'Ржавый пикап', body:'pickup', paint:'#7a4a36', rust:3, glass:{ws:'crack', l:'gone'}, wheels:['ok', 'flat', 'ok', 'ok'], dents:3},
    {n:'Техничка с пулемётом', body:'pickup', paint:'#6a6448', rust:2, glass:{ws:'gone'}, gun:true, dents:2},
    {n:'С грузом', body:'pickup', paint:'#5a3a2e', rust:3, cargo:true, glass:{ws:'web'}, dents:2},
  ];
  function pickupDraw(g, d){ carDraw(g, d); if(d.gun){ const k = hk(g); [[0.5, 1.5, 0, 0.25], [0.5, 1.5, -0.2, -0.12], [0.5, 1.5, 0.2, -0.12]].forEach(([x, y, dx, dy])=>k.line([x, y, x + dx, y + dy + 0.12], '#2a2826', 0.02)); k.rr(0.42, 1.4, 0.16, 0.22, 0.02); k.fill('#2a2826'); k.stroke(k.INK, 0.008); k.line([0.5, 1.4, 0.5, 0.95], '#141210', 0.03); k.rr(0.6, 1.45, 0.14, 0.1, 0.01); k.fill('#4a5a3a'); bits.casings(k, 0.2, 1.3, 0.6, 0.5, 14); for(let i=0;i<5;i++) houseBits.sandbag(k, 0.25 + i*0.125, 1.85, 0); } }
  A('bunker', 'Бункер', 'military', 4, 4, {t:'бункер укрытие убежище', v:BUNKER.length, vn:VN(BUNKER), hd:true}, (g, v)=>{ const d = PV(BUNKER, v); bunkerDraw(g, d); EX.bunker(g, d); });
  A('pillbox', 'ДОТ', 'military', 2, 2, {t:'дот огневая точка укрепление', v:PILLBOX.length, vn:VN(PILLBOX), hd:true}, (g, v)=>{ const d = PV(PILLBOX, v); pillboxDraw(g, d); EX.pillbox(g, d); });
  A('checkpoint', 'КПП', 'military', 3, 2, {t:'кпп пост шлагбаум блокпост', v:CHECKPOINT.length, vn:VN(CHECKPOINT), hd:true}, (g, v)=>{ const d = PV(CHECKPOINT, v); checkpointDraw(g, d); EX.checkpoint(g, d); });
  A('sandbags_arc', 'Мешки с песком (дуга)', 'military', 3, 2, {t:'мешки песок укрытие окоп пулемёт', v:BAGS_ARC.length, vn:VN(BAGS_ARC), hd:true}, (g, v)=>bagsArcDraw(g, PV(BAGS_ARC, v)));
  A('sandbags_line', 'Мешки с песком (ряд)', 'military', 3, 1, {t:'мешки песок укрытие', v:BAGS_LINE.length, vn:VN(BAGS_LINE), hd:true}, (g, v)=>bagsLineDraw(g, PV(BAGS_LINE, v)));
  A('czech_hedgehog', 'Противотанковый ёж', 'military', 1, 1, {t:'ёж противотанковый заграждение', v:HEDGEHOG.length, vn:VN(HEDGEHOG), hd:true}, (g, v)=>{ const d = PV(HEDGEHOG, v); hedgehogDraw(g, d); EX.czech_hedgehog(g, d); });
  A('barbed_wire', 'Колючая проволока', 'military', 3, 1, {t:'колючая проволока заграждение егоза', v:WIRE.length, vn:VN(WIRE), hd:true}, (g, v)=>wireDraw(g, PV(WIRE, v)));
  A('watchtower', 'Вышка', 'military', 2, 2, {t:'вышка сторожевая наблюдение прожектор', v:WATCHTOWER.length, vn:VN(WATCHTOWER), hd:true}, (g, v)=>{ const d = PV(WATCHTOWER, v); watchtowerDraw(g, d); EX.watchtower(g, d); });
  A('barracks', 'Казарма', 'military', 6, 3, {t:'казарма барак здание', v:BARRACKS.length, vn:VN(BARRACKS), hd:true}, (g, v)=>houseDraw(g, 6, 3, PV(BARRACKS, v)));
  A('ammo_crate', 'Ящик с боеприпасами', 'military', 1, 1, {t:'ящик боеприпасы патроны цинк', v:AMMO.length, vn:VN(AMMO), hd:true}, (g, v)=>{ const d = PV(AMMO, v); ammoDraw(g, d); EX.ammo_crate(g, d); });
  A('weapon_rack', 'Оружейная стойка', 'military', 2, 1, {t:'оружие стойка арсенал автомат', v:RACK.length, vn:VN(RACK), hd:true}, (g, v)=>{ const d = PV(RACK, v); rackDraw(g, d); EX.weapon_rack(g, d); });
  A('lab_bench', 'Лабораторный стол', 'military', 2, 1, {t:'лаборатория стол колбы микроскоп', v:LAB.length, vn:VN(LAB), hd:true}, (g, v)=>labDraw(g, PV(LAB, v)));
  A('vault_door', 'Гермодверь убежища', 'military', 3, 1, {t:'гермодверь убежище бункер дверь', v:VAULT.length, vn:VN(VAULT), hd:true}, (g, v)=>{ const d = PV(VAULT, v); vaultDraw(g, d); EX.vault_door(g, d); });
  A('radar', 'Радар', 'military', 2, 2, {t:'радар антенна локатор', v:RADAR.length, vn:VN(RADAR), hd:true}, (g, v)=>radarDraw(g, PV(RADAR, v)));
  A('tank_wreck', 'Остов танка', 'military', 2, 3, {t:'танк остов бронетехника', v:TANK.length, vn:VN(TANK), hd:true}, (g, v)=>{ const d = PV(TANK, v); tankDraw(g, d); EX.tank_wreck(g, d); });
  A('apc_wreck', 'Остов БТР', 'military', 2, 4, {t:'бтр бронетранспортёр остов', v:APC.length, vn:VN(APC), hd:true}, (g, v)=>{ const d = PV(APC, v); apcDraw(g, d); EX.apc_wreck(g, d); });
  A('mine_field', 'Знак «Мины»', 'military', 1, 1, {t:'мины минное поле знак опасность растяжка', v:MINE.length, vn:VN(MINE), hd:true}, (g, v)=>mineDraw(g, PV(MINE, v)));
  A('turret', 'Автоматическая турель', 'military', 1, 1, {t:'турель пулемёт автоматическая', v:TURRET.length, vn:VN(TURRET), hd:true}, (g, v)=>{ const d = PV(TURRET, v); turretDraw(g, d); EX.turret(g, d); });
  A('tent', 'Палатка', 'waste', 2, 2, {t:'палатка лагерь стоянка', v:TENT.length, vn:VN(TENT), hd:true}, (g, v)=>{ const d = PV(TENT, v); tentDraw(g, d); EX.tent(g, d); });
  A('big_tent', 'Большой шатёр', 'waste', 3, 3, {t:'шатёр тент лагерь рынок навес', v:BIG_TENT.length, vn:VN(BIG_TENT), hd:true}, (g, v)=>{ const d = PV(BIG_TENT, v); bigTentDraw(g, d); EX.big_tent(g, d); });
  A('campfire', 'Костёр', 'waste', 1, 1, {t:'костёр огонь лагерь котелок', v:CAMPFIRE.length, vn:VN(CAMPFIRE), hd:true, lit:true}, (g, v)=>{ const d = PV(CAMPFIRE, v); campfireDraw(g, d); EX.campfire(g, d); });
  A('gas_station', 'Заправка', 'waste', 5, 4, {t:'заправка азс бензин колонка', v:GAS.length, vn:VN(GAS), hd:true}, (g, v)=>{ const d = PV(GAS, v); gasDraw(g, d); EX.gas_station(g, d); });
  A('fuel_pump', 'Топливная колонка', 'waste', 1, 1, {t:'колонка бензин топливо', v:PUMP.length, vn:VN(PUMP), hd:true}, (g, v)=>pumpDraw(g, PV(PUMP, v)));
  A('scrap_shack', 'Хижина из металлолома', 'waste', 3, 3, {t:'хижина лачуга металлолом жильё', v:SHACK.length, vn:VN(SHACK), hd:true}, (g, v)=>{ const d = PV(SHACK, v); shackDraw(g, d); EX.scrap_shack(g, d); });
  A('scrap_tower', 'Сторожевая башня из лома', 'waste', 2, 2, {t:'башня вышка металлолом', v:SCRAP_TOWER.length, vn:VN(SCRAP_TOWER), hd:true}, (g, v)=>{ const d = PV(SCRAP_TOWER, v); scrapTowerDraw(g, d); EX.scrap_tower(g, d); });
  A('pickup_rust', 'Ржавый пикап', 'waste', 1, 2, {t:'пикап машина ржавый транспорт техничка', v:PICKUP.length, vn:VN(PICKUP), hd:true}, (g, v)=>pickupDraw(g, PV(PICKUP, v)));
  A('buggy', 'Боевой багги', 'waste', 1, 2, {t:'багги машина боевой транспорт рейдер', v:BUGGY.length, vn:VN(BUGGY), hd:true}, (g, v)=>{ const d = PV(BUGGY, v); buggyDraw(g, d); EX.buggy(g, d); });
  A('war_rig', 'Грузовик-крепость', 'waste', 2, 5, {t:'грузовик крепость рейдер фура цистерна', v:RIG.length, vn:VN(RIG), hd:true}, (g, v)=>{ const d = PV(RIG, v); rigDraw(g, d); EX.war_rig(g, d); });
  A('scrap_pile', 'Куча металлолома', 'waste', 2, 2, {t:'металлолом свалка мусор', v:SCRAP_PILE.length, vn:VN(SCRAP_PILE), hd:true}, (g, v)=>scrapPileDraw(g, 2, 2, PV(SCRAP_PILE, v)));
  A('junk_mound', 'Свалка', 'waste', 4, 4, {t:'свалка мусор помойка техника', v:JUNK.length, vn:VN(JUNK), hd:true}, (g, v)=>scrapPileDraw(g, 4, 4, PV(JUNK, v)));
  A('plane_wreck', 'Остов самолёта', 'waste', 6, 6, {t:'самолёт остов крушение', v:PLANE.length, vn:VN(PLANE), hd:true}, (g, v)=>{ const d = PV(PLANE, v); planeDraw(g, d); EX.plane_wreck(g, d); });
  A('moisture_trap', 'Влагосборник', 'waste', 1, 1, {t:'влагосборник вода конденсатор дюна', v:MOIST.length, vn:VN(MOIST), hd:true}, (g, v)=>moistDraw(g, PV(MOIST, v)));
  A('water_tower', 'Водонапорная бочка', 'waste', 2, 2, {t:'вода бак водонапорная', v:WATER_TOWER.length, vn:VN(WATER_TOWER), hd:true}, (g, v)=>{ const d = PV(WATER_TOWER, v); waterTowerDraw(g, d); EX.water_tower(g, d); });
  A('windmill', 'Ветряк', 'waste', 2, 2, {t:'ветряк мельница энергия', v:WINDMILL.length, vn:VN(WINDMILL), hd:true}, (g, v)=>{ const d = PV(WINDMILL, v); windmillDraw(g, d); EX.windmill(g, d); });
  A('skull_totem', 'Тотем из черепов', 'waste', 1, 1, {t:'тотем череп рейдеры племя', v:TOTEM.length, vn:VN(TOTEM), hd:true}, (g, v)=>totemDraw(g, PV(TOTEM, v)));
  A('caravan_cart', 'Повозка каравана', 'waste', 2, 3, {t:'повозка караван телега', v:CART.length, vn:VN(CART), hd:true}, (g, v)=>{ const d = PV(CART, v); cartDraw(g, d); EX.caravan_cart(g, d); });
  A('settlement_gate', 'Ворота поселения', 'waste', 4, 1, {t:'ворота поселение вход частокол', v:GATE.length, vn:VN(GATE), hd:true, lit:true}, (g, v)=>{ const d = PV(GATE, v); gateDraw(g, d); EX.settlement_gate(g, d); });
  A('oil_drum_fire', 'Бочка-костёр', 'waste', 1, 1, {t:'бочка огонь костёр', v:DRUM_FIRE.length, vn:VN(DRUM_FIRE), hd:true, lit:true}, (g, v)=>{ const d = PV(DRUM_FIRE, v); drumFireDraw(g, d); EX.oil_drum_fire(g, d); });

  /* ===================== ЛАГЕРЬ ===================== */
  /* ---- Лагерь (HD): быт, загоны и клетки, знаки ---- */
  const pole = (k, x, y, r, col)=>{ const c = k.c; c.beginPath(); c.arc(x + r*0.5, y + r*0.7, r*1.1, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, r, 0, 6.28); k.texFill('wood', '#5a4632', col, 0.4); k.stroke(k.INK, r*0.25); c.beginPath(); c.arc(x - r*0.3, y - r*0.3, r*0.35, 0, 6.28); k.fill('rgba(255,240,210,.25)'); };
  function gardenBedDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.05, 0.08, 2.9, 0.84, 0.04, 0.06); k.rr(0.05, 0.08, 2.9, 0.84, 0.04); k.texFill('wood', '#5a4632', d.frame || null, 0.4); k.stroke(k.INK, 0.012);
    k.rr(0.13, 0.16, 2.74, 0.68, 0.02); k.texFill('dirt', '#4a3a28'); k.fill('rgba(30,20,10,.35)'); for(let i=0;i<9;i++) k.line([0.18, 0.22 + i*0.07, 2.82, 0.22 + i*0.07 + k.R(-0.02, 0.02)], 'rgba(20,14,8,.18)', 0.012);
    for(let x=0.3;x<2.8;x+=0.32) for(const y of [0.32, 0.68]){ if(d.dry && k.rnd() < 0.4) continue; const s = d.big ? 0.17 : 0.11;
      if(d.dry){ for(let j=0;j<4;j++) k.line([x, y, x + k.R(-0.12, 0.12), y + k.R(-0.12, 0.12)], '#7a6a44', 0.015); continue; }
      if(d.pumpkin){ k.line([x - 0.15, y, x + 0.15, y + 0.05], '#4a6a2a', 0.02); c.beginPath(); c.ellipse(x + 0.02, y + 0.03, 0.12, 0.1, 0, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.ellipse(x, y, 0.12, 0.1, 0, 0, 6.28); k.fill(x%0.64 < 0.32 ? '#b86a2a' : '#8a9a3a'); for(let j=-1;j<=1;j++) k.line([x + j*0.05, y - 0.09, x + j*0.05, y + 0.09], 'rgba(0,0,0,.2)', 0.008); continue; }
      for(let j=0;j<6;j++){ const a = j/6*6.28 + k.rnd(); c.beginPath(); c.ellipse(x + Math.cos(a)*s*0.5, y + Math.sin(a)*s*0.5, s*0.55, s*0.28, a, 0, 6.28); k.fill(k.pick(d.cols)); } c.beginPath(); c.arc(x, y, s*0.25, 0, 6.28); k.fill(d.cols[0]); }
    if(d.film){ c.save(); k.rr(0.1, 0.1, 2.8, 0.8, 0.3); c.fillStyle = 'rgba(220,235,235,.32)'; c.fill(); for(let x=0.3;x<2.8;x+=0.5) k.line([x, 0.1, x, 0.9], 'rgba(255,255,255,.35)', 0.02); k.line([0.2, 0.3, 2.8, 0.25], 'rgba(255,255,255,.4)', 0.03); c.restore(); }
    if(d.can){ c.beginPath(); c.arc(2.75, 0.85, 0.09, 0, 6.28); k.texFill('metal', '#6a7a6a'); k.stroke(k.INK, 0.008); } }
  const GBED = [{n:'Зелень', cols:['#4a6a2a', '#5a7a34', '#6a8a3a']}, {n:'Кукуруза', cols:['#6a7a2a', '#8a9a3a', '#5a6a24'], big:true, can:true}, {n:'Мутировавшие тыквы', pumpkin:true}, {n:'Под плёнкой', cols:['#4a6a2a', '#5a7a34'], film:true}, {n:'Засохшая', dry:true, frame:'#6a5a4a'}];
  function latrineDraw(g, d){ const k = hk(g), c = k.c;
    if(d.pit){ k.organic(0.5, 0.55, 0.38, 0.2); k.texFill('dirt', '#5a4a36'); c.beginPath(); c.ellipse(0.5, 0.55, 0.2, 0.15, 0, 0, 6.28); k.fill('#140e08'); k.plank(0.2, 0.42, 0.6, 0.1, 0, '#6a5038'); k.plank(0.2, 0.7, 0.6, 0.1, 0, '#6a5038');
      bits.fabric(k, [0.05, 0.1, 0.95, 0.1, 0.95, 0.22, 0.05, 0.22], d.col || '#7a6a50', 4, 0); [0.05, 0.95].forEach(x=>pole(k, x, 0.16, 0.05)); return; }
    fx.sh(k, 0.1, 0.1, 0.8, 0.8, 0.02, 0.1); k.rr(0.1, 0.1, 0.8, 0.8, 0.02);
    if(d.tin){ k.texFill('corrugated', '#7a7e80', '#8a6a4a', 0.4); for(let x=0.15;x<0.9;x+=0.08) k.line([x, 0.1, x, 0.9], 'rgba(0,0,0,.18)', 0.012); for(let i=0;i<4;i++) k.rust(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.06, false); }
    else { k.texFill('wood', '#6a5038', '#7a6040', 0.4); for(let y=0.1;y<0.9;y+=0.16) k.line([0.1, y, 0.9, y], 'rgba(0,0,0,.3)', 0.012); }
    k.stroke(k.INK, 0.012); k.line([0.1, 0.12, 0.9, 0.12], 'rgba(255,250,240,.25)', 0.02); c.beginPath(); c.arc(0.72, 0.28, 0.06, 0, 6.28); k.fill('#3a3a36'); k.stroke(k.INK, 0.006);
    k.rr(0.3, 0.86, 0.4, 0.08, 0.01); k.fill('#3a2c1c'); bits.stencil(k, 0.5, 0.5, d.tin ? 'WC' : '♥', 0.18, '#2a2018', 0.5); k.blot(0.5, 1.0, 0.15, '#3a3020', 0.3); }
  const LATRINE = [{n:'Будка из досок'}, {n:'Будка из жести', tin:true}, {n:'Яма с ширмой', pit:true}];
  function canopyDraw(g, d){ const k = hk(g), c = k.c;
    const P = [[0.25, 0.25], [2.75, 0.25], [2.75, 2.75], [0.25, 2.75]];
    c.save(); c.translate(0.18, 0.26); k.organic(1.5, 1.5, 1.35, 0.06); k.fill('rgba(0,0,0,.28)'); c.restore();
    const pts = [0.15, 0.15, 1.5, 0.3, 2.85, 0.15, 2.7, 1.5, 2.85, 2.85, 1.5, 2.7, 0.15, 2.85, 0.3, 1.5];
    if(d.net){ k.poly(pts); c.fillStyle = 'rgba(70,82,50,.55)'; c.fill(); c.save(); k.poly(pts); c.clip(); bits.camo(k, 0, 0, 3, 3, ['#4a5236', '#5a6040', '#3a4028']); for(let i=0;i<40;i++){ const x = k.R(0.2, 2.8), y = k.R(0.2, 2.8); k.blot(x, y, 0.12, k.pick(['#4a5a30', '#6a6a3a', '#3a4428']), 0.85); } for(let i=0;i<=12;i++){ k.line([0.15 + i*0.225, 0.1, 0.15 + i*0.225, 2.9], 'rgba(20,24,12,.35)', 0.012); k.line([0.1, 0.15 + i*0.225, 2.9, 0.15 + i*0.225], 'rgba(20,24,12,.35)', 0.012); } c.restore(); }
    else { k.poly(pts); k.texFill(d.tin ? 'corrugated' : 'concrete', d.col, d.col, 0.85); if(!d.tin){ k.poly(pts); k.fill(d.col, 0.55); }
      c.save(); k.poly(pts); c.clip(); const gr = c.createRadialGradient(1.5, 1.5, 0.2, 1.5, 1.5, 1.6); gr.addColorStop(0, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(255,250,240,.12)'); c.fillStyle = gr; c.fillRect(0, 0, 3, 3);
        if(d.tin) for(let x=0.2;x<2.9;x+=0.12) k.line([x, 0, x, 3], 'rgba(0,0,0,.18)', 0.02); else { k.line([0.15, 0.15, 2.85, 2.85], 'rgba(0,0,0,.15)', 0.05); k.line([2.85, 0.15, 0.15, 2.85], 'rgba(0,0,0,.15)', 0.05); }
        for(let i=0;i<6;i++) k.streak(k.R(0.3, 2.7), 0.3, 1.5, 0.08, '#3a3026', 0.2); if(d.tin) for(let i=0;i<6;i++) k.rust(k.R(0.3, 2.7), k.R(0.3, 2.7), 0.12, false); c.restore();
      if(d.torn){ for(let i=0;i<3;i++){ const x = k.R(0.7, 2.3), y = k.R(0.7, 2.3); k.organic(x, y, k.R(0.2, 0.35), 0.5); c.save(); c.globalCompositeOperation = c.canvas.__sprite ? 'destination-out' : 'source-over'; k.fill(c.canvas.__sprite ? '#000' : 'rgba(0,0,0,.45)'); c.restore(); } }
      k.poly(pts); k.stroke(k.INK, 0.014); }
    P.forEach(([x, y])=>{ pole(k, x, y, 0.07); k.line([x, y, x + (x < 1.5 ? -0.2 : 0.2), y + (y < 1.5 ? -0.2 : 0.2)], 'rgba(200,190,160,.7)', 0.01); });
    if(d.under) d.under.forEach(([a, x, y])=>{ if(a==='crate'){ k.rr(x, y, 0.4, 0.4, 0.02); k.texFill('wood', '#6a5038'); k.stroke(k.INK, 0.008); } }); }
  const CANOPY = [{n:'Брезент', col:'#7a6e4e'}, {n:'Синий тент', col:'#3a5a7a'}, {n:'Жесть', col:'#7a7e80', tin:true}, {n:'Маскировочная сеть', net:true}, {n:'Рваный', col:'#8a7a5a', torn:true}];
  function dryingRackDraw(g, d){ const k = hk(g), c = k.c;
    [0.15, 2.85].forEach(x=>{ pole(k, x, 0.5, 0.06); k.line([x, 0.5, x + (x < 1 ? -0.12 : 0.12), 0.2], '#5a4632', 0.03); k.line([x, 0.5, x + (x < 1 ? -0.12 : 0.12), 0.8], '#5a4632', 0.03); });
    k.line([0.17, 0.52, 2.83, 0.52], 'rgba(0,0,0,.3)', 0.02); const sag = (t)=>0.5 + Math.sin(t*Math.PI)*0.08; c.beginPath(); for(let t=0;t<=1;t+=0.05) c.lineTo(0.15 + t*2.7, sag(t)); k.stroke('#c8b88a', 0.018);
    if(d.empty) return; let x = 0.35; while(x < 2.6){ const t = (x - 0.15)/2.7, y = sag(t), w = d.hides ? k.R(0.35, 0.5) : d.meat ? 0.08 : k.R(0.2, 0.35);
      if(d.hides){ c.beginPath(); c.ellipse(x + w/2 + 0.03, y + 0.06, w/2, 0.22, 0, 0, 6.28); k.fill('rgba(0,0,0,.3)'); k.organic(x + w/2, y + 0.04, w/2, 0.3, 0.2); k.fill(k.pick(['#8a6a4a', '#6a5038', '#9a8a6a'])); k.stroke('rgba(40,26,14,.6)', 0.01); }
      else if(d.meat){ k.line([x, y, x + 0.02, y + 0.22], k.pick(['#8a3a2a', '#6a2a1a', '#9a4a3a']), 0.06); k.line([x - 0.015, y + 0.02, x, y + 0.2], 'rgba(255,220,200,.25)', 0.012); }
      else { k.rr(x, y - 0.04, w, 0.26, 0.02); k.fill(k.pick(d.cols)); k.stroke('rgba(0,0,0,.35)', 0.008); k.line([x + 0.02, y, x + w - 0.02, y], 'rgba(255,255,255,.2)', 0.01); c.beginPath(); c.arc(x + 0.03, y - 0.02, 0.015, 0, 6.28); k.fill('#c8b060'); }
      x += w + (d.meat ? 0.07 : 0.06); } }
  const DRYRACK = [{n:'Бельё', cols:['#9a9080', '#5a6a7a', '#8a5a4a', '#c8c0a8', '#6a7a5a']}, {n:'Шкуры', hides:true}, {n:'Вяленое мясо', meat:true}, {n:'Пустая', empty:true}];
  function fieldKitchenDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    if(d.truck){ fx.sh(k, 0.2, 0.1, 1.6, 1.8, 0.1, 0.12); k.rr(0.2, 0.1, 1.6, 1.8, 0.1); k.texFill('metal', '#55605a', '#4a5a3a', 0.6); k.stroke(k.INK, 0.012); [0.45, 1.55].forEach(x=>{ c.beginPath(); c.arc(x, 0.55, 0.24, 0, 6.28); k.fill('#2a2c2a'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x - 0.05, 0.5, 0.16, 0, 6.28); k.texFill('metal', '#8a9094'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x, 0.55, 0.05, 0, 6.28); k.fill('#3a3836'); });
      k.rr(0.75, 1.2, 0.5, 0.35, 0.03); k.fill('#2a2826'); k.line([1, 1.2, 1, 0.9], '#3a3836', 0.08); xb.smoke && xb.smoke(k, 1, 0.75, 0.4); [0.15, 1.85].forEach(x=>{ c.beginPath(); c.arc(x, 1.75, 0.12, 0, 6.28); k.fill('#1e1c1a'); }); bits.stencil(k, 1, 1.72, 'КП-130', 0.12, '#e4ddca', 0.5); return; }
    if(d.drum){ bits.barrel(k, cx, cy, 0.4, '#5a4a3a', false); k.rr(cx - 0.28, cy - 0.28, 0.56, 0.56, 0.04); k.fill('#2a2622'); k.stroke(k.INK, 0.01); for(let i=0;i<4;i++) k.line([cx - 0.25 + i*0.16, cy - 0.28, cx - 0.25 + i*0.16, cy + 0.28], '#4a4440', 0.03); k.radial(cx, cy + 0.42, 0.3, '#ff8a2a', 0.5); k.rr(cx - 0.12, cy + 0.32, 0.24, 0.1, 0.02); k.fill('#ff9a3a');
      xb.pot(k, cx + 0.05, cy - 0.02, 0.18); k.line([cx + 0.4, cy - 0.3, cx + 0.4, cy - 0.85], '#3a3836', 0.07); xb.firewood(k, 1.65, 1.6, 4, 0.3); return; }
    if(!d.cold){ bits.logs(k, cx, cy, 0.4, 5, false); bits.fire(k, cx, cy + 0.28, 0.22, 1); bits.fire(k, cx - 0.3, cy + 0.12, 0.16, 1); } else { bits.logs(k, cx, cy, 0.38, 5, true); k.blot(cx, cy, 0.3, '#2a2420', 0.5); }
    for(let i=0;i<3;i++){ const a = i*2.09 + 0.5; k.line([cx + Math.cos(a)*0.75 + 0.03, cy + Math.sin(a)*0.75 + 0.04, cx + 0.03, cy - 0.1 + 0.04], 'rgba(0,0,0,.3)', 0.06); k.line([cx + Math.cos(a)*0.75, cy + Math.sin(a)*0.75, cx, cy - 0.1], '#3a3430', 0.05); }
    c.beginPath(); c.arc(cx + 0.06, cy + 0.08, 0.36, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, 0.36, 0, 6.28); k.texFill('metal', '#3a3836', null, 0.4); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(cx, cy, 0.29, 0, 6.28);
    c.fillStyle = k.lin(cx - 0.3, cy - 0.3, cx + 0.3, cy + 0.3, [[0, d.cold ? '#5a5040' : '#8a6a3a'], [1, d.cold ? '#3a3020' : '#5a3a1a']]); c.fill(); if(!d.cold){ for(let i=0;i<5;i++){ c.beginPath(); c.arc(cx + k.R(-0.18, 0.18), cy + k.R(-0.18, 0.18), 0.03, 0, 6.28); k.fill('rgba(255,240,200,.5)'); } k.radial(cx, cy - 0.3, 0.5, '#e8e0d0', 0.18); }
    k.line([cx - 0.1, cy - 0.05, cx + 0.55, cy - 0.45], '#6a5038', 0.04); xb.firewood(k, 1.6, 1.65, 4, 0.2); k.rr(0.1, 1.45, 0.45, 0.45, 0.03); k.texFill('wood', '#6a5038'); k.stroke(k.INK, 0.008); for(let i=0;i<3;i++){ c.beginPath(); c.arc(0.2 + i*0.13, 1.6, 0.05, 0, 6.28); k.fill(k.pick(['#c8b060', '#8a5a3a', '#6a7a4a'])); } }
  const FKITCHEN = [{n:'Котёл на огне'}, {n:'Котёл остыл', cold:true}, {n:'Печь из бочки', drum:true}, {n:'Армейская кухня', truck:true}];
  function cisternDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    if(d.stand){ [[0.35, 0.35], [1.65, 0.35], [0.35, 1.65], [1.65, 1.65]].forEach(([x, y])=>pole(k, x, y, 0.06)); }
    c.beginPath(); c.arc(cx + 0.1, cy + 0.14, 0.78, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, 0.78, 0, 6.28); k.texFill(d.plastic ? 'concrete' : 'metal', d.col, d.col, 0.6); k.stroke(k.INK, 0.014);
    const gr = c.createRadialGradient(cx - 0.3, cy - 0.3, 0.05, cx, cy, 0.8); gr.addColorStop(0, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(0,0,0,.3)'); c.beginPath(); c.arc(cx, cy, 0.78, 0, 6.28); c.fillStyle = gr; c.fill();
    for(let r=0.3;r<0.78;r+=0.16){ c.beginPath(); c.arc(cx, cy, r, 0, 6.28); k.stroke('rgba(0,0,0,.18)', 0.02); } c.beginPath(); c.arc(cx, cy, 0.18, 0, 6.28); k.fill('#2a2c2e'); k.stroke(k.INK, 0.01);
    if(d.filter){ k.rr(cx + 0.35, cy - 0.65, 0.4, 0.3, 0.03); k.texFill('metal', '#6a7a7a'); k.stroke(k.INK, 0.008); xb.cable(k, [cx + 0.55, cy - 0.35, cx + 0.3, cy - 0.1], '#3a3e40', 0.04); }
    k.line([cx + 0.7, cy + 0.3, cx + 0.95, cy + 0.42], '#5a5e60', 0.06); c.beginPath(); c.arc(cx + 0.95, cy + 0.42, 0.05, 0, 6.28); k.fill('#c83a2a');
    [[1.75, 1.7], [1.45, 1.85]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.12, 0, 6.28); k.texFill('metal', '#7a7e80'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x, y, 0.08, 0, 6.28); k.fill('rgba(60,90,100,.7)'); });
    if(d.rust){ for(let i=0;i<10;i++) k.rust(cx + k.R(-0.6, 0.6), cy + k.R(-0.6, 0.6), k.R(0.04, 0.1), i%5===0); k.puddle(1.7, 1.2, 0.3, 0.2); } else k.puddle(1.85, 1.55, 0.14, 0.1); }
  const CISTERN = [{n:'Бочка на подставке', col:'#4a6a8a', stand:true}, {n:'Пластиковая ёмкость', col:'#c8c0a8', plastic:true}, {n:'Ржавая, протекает', col:'#6a5a4a', rust:true}, {n:'С фильтром', col:'#5a6a6a', filter:true}];
  function cageDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.1, 0.1, 1.8, 1.8, 0.02, 0.1); k.rr(0.1, 0.1, 1.8, 1.8, 0.02); k.texFill('dirt', '#4a3e30'); k.fill('rgba(0,0,0,.2)');
    if(d.who==='prisoner'){ c.beginPath(); c.ellipse(1.05, 1.15, 0.28, 0.2, 0.4, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(1, 1.1, 0.26, 0.18, 0.4, 0, 6.28); k.fill('#6a5a48'); c.beginPath(); c.arc(0.78, 0.95, 0.1, 0, 6.28); k.fill('#a07a5a'); k.line([1.1, 1.2, 1.4, 1.4], '#6a5a48', 0.08); bits.fabric(k, [0.4, 1.4, 0.8, 1.4, 0.8, 1.7, 0.4, 1.7], '#7a6a50', 3, 0); xb.links(k, 0.3, 0.3, 5, 0.6); }
    if(d.who==='bones'){ bits.skull(k, 1.1, 0.9, 0.12, 0.5); for(let i=0;i<6;i++) k.line([k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.4, 1.6), k.R(0.4, 1.6)], '#d4cbb2', 0.035); k.blot(1, 1.2, 0.3, '#3a1a10', 0.4); }
    if(d.who==='mutant'){ c.beginPath(); c.ellipse(1.05, 1.08, 0.45, 0.3, -0.3, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(1, 1, 0.42, 0.28, -0.3, 0, 6.28); k.fill('#5a6a4a'); for(let i=0;i<6;i++){ const a = i/6*6.28; k.line([1 + Math.cos(a)*0.3, 1 + Math.sin(a)*0.2, 1 + Math.cos(a)*0.55, 1 + Math.sin(a)*0.4], '#4a5a3a', 0.05); } c.beginPath(); c.arc(0.7, 0.85, 0.035, 0, 6.28); k.fill('#e8c040'); }
    k.blot(0.6, 0.6, 0.15, '#2a2018', 0.35); k.leaves(0.2, 0.2, 1.6, 1.6, 5);
    const bars = (o)=>{ for(let i=0;i<=8;i++){ const t = 0.1 + i*0.225; k.line([t + 0.03, 0.1 + 0.04, t + 0.03, 1.9 + 0.04], 'rgba(0,0,0,.35)', 0.04); k.line([t, 0.1, t, 1.9], '#4a4e50', 0.035); k.line([t - 0.01, 0.1, t - 0.01, 1.9], 'rgba(220,225,230,.3)', 0.01); } };
    bars(); for(let i=0;i<=8;i++){ const t = 0.1 + i*0.225; k.line([0.1, t, 1.9, t], '#3e4244', 0.025); } k.rr(0.1, 0.1, 1.8, 1.8, 0.02); k.stroke('#2a2c2e', 0.05);
    for(let i=0;i<12;i++) k.rust(k.R(0.1, 1.9), k.R(0.1, 1.9), 0.04, false);
    if(d.open){ c.save(); c.translate(1.9, 0.6); c.rotate(0.9); k.rr(0, -0.04, 0.8, 0.08, 0.01); k.fill('#4a4e50'); c.restore(); k.line([1.9, 0.55, 1.9, 1.35], 'rgba(0,0,0,.6)', 0.06); }
    else { k.rr(1.82, 0.85, 0.16, 0.22, 0.03); k.texFill('metal', '#8a7a3a'); k.stroke(k.INK, 0.008); } }
  const CAGE = [{n:'С пленником', who:'prisoner'}, {n:'Пустая'}, {n:'Кости', who:'bones', open:true}, {n:'С мутантом', who:'mutant'}, {n:'Открыта', open:true}];
  function penDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.1, 0.1, 3.8, 3.8, 0.02); k.texFill('mud', '#5a4a36'); k.fill('rgba(70,56,36,.35)'); for(let i=0;i<14;i++) k.blot(k.R(0.4, 3.6), k.R(0.4, 3.6), k.R(0.08, 0.2), '#3a2a18', 0.4); k.tufts(0.2, 0.2, 3.6, 3.6, 10, ['#7a7a40', '#8a8a4a']);
    // сено, поилка
    k.organic(0.75, 0.8, 0.45, 0.4, 0.35); k.fill('#c8a860'); for(let i=0;i<20;i++){ const a = k.R(0, 6.28), r = k.R(0, 0.4); k.line([0.75 + Math.cos(a)*r, 0.8 + Math.sin(a)*r*0.8, 0.75 + Math.cos(a)*r + k.R(-0.12, 0.12), 0.8 + Math.sin(a)*r*0.8 + k.R(-0.08, 0.08)], k.pick(['#a8884a', '#d8b870']), 0.015); }
    k.rr(2.6, 0.45, 1.0, 0.32, 0.04); k.texFill('wood', '#5a4632'); k.stroke(k.INK, 0.01); k.rr(2.66, 0.51, 0.88, 0.2, 0.02); k.fill('rgba(50,80,90,.75)'); k.line([2.7, 0.55, 3.2, 0.55], 'rgba(220,235,240,.35)', 0.02);
    const posts = []; for(let i=0;i<=6;i++){ const t = 0.15 + i*0.617; posts.push([t, 0.15], [t, 3.85]); if(i>0 && i<6) posts.push([0.15, t], [3.85, t]); }
    const gateGap = (x, y)=>!d.broken && y > 3.8 && x > 1.4 && x < 2.6;
    const rail = (pts)=>{ if(d.wire){ k.line(pts.map(v=>v + 0.03), 'rgba(0,0,0,.3)', 0.05); k.line(pts, 'rgba(175,182,188,.9)', 0.04, 1, [0.04, 0.05]); k.line(pts, 'rgba(150,158,165,.8)', 0.012); } else { for(const o of [-0.06, 0.06]){ const q = pts.map((v, i)=>v + (pts[0]===pts[2] ? (i%2 ? 0 : o) : (i%2 ? o : 0))); k.line(q.map(v=>v + 0.04), 'rgba(0,0,0,.4)', 0.07); k.line(q, '#8a6a48', 0.07); k.line(q.map((v, i)=>v - 0.015), 'rgba(255,235,200,.3)', 0.018); } } };
    rail([0.15, 0.15, 3.85, 0.15]); rail([0.15, 0.15, 0.15, 3.85]); rail([3.85, 0.15, 3.85, 3.85]);
    if(d.broken){ rail([0.15, 3.85, 1.3, 3.85]); rail([2.9, 3.85, 3.85, 3.85]); k.plank(1.4, 3.5, 0.9, 0.08, 0.6, '#6a5038', true); } else { rail([0.15, 3.85, 1.4, 3.85]); rail([2.6, 3.85, 3.85, 3.85]); c.save(); c.translate(1.4, 3.85); c.rotate(-0.6); k.rr(0, -0.05, 1.2, 0.1, 0.02); k.fill('#7a5a3a'); k.stroke(k.INK, 0.008); c.restore(); }
    posts.forEach(([x, y])=>{ if(gateGap(x, y)) return; pole(k, x, y, 0.07); }); }
  const PEN = [{n:'Деревянный'}, {n:'Из сетки', wire:true}, {n:'Разломан', broken:true}];
  function packAnimalDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 1.05;
    c.beginPath(); c.ellipse(cx + 0.08, cy + 0.12, 0.36, 0.72, 0, 0, 6.28); k.fill('rgba(0,0,0,.35)');
    if(d.dead){ c.save(); c.translate(cx, cy); c.rotate(1.2); } else { c.save(); c.translate(cx, cy); }
    const hide = d.col; k.line([0, 0.6, 0.06, 0.88, 0.02, 0.93], '#3a2a1a', 0.035);
    k.rr(-0.33, -0.55, 0.66, 1.15, 0.3); k.texFill('dirt', hide, hide, 0.8); k.fill(hide, 0.6); k.stroke('rgba(30,20,10,.6)', 0.015);
    for(let i=0;i<5;i++) k.blot(k.R(-0.2, 0.2), k.R(-0.4, 0.4), k.R(0.05, 0.12), d.spot || '#3a2a1a', 0.5); c.beginPath(); c.ellipse(-0.08, -0.15, 0.12, 0.35, 0, 0, 6.28); k.fill('rgba(255,240,210,.15)');
    k.line([0, 0.55, 0.05, 0.85], hide, 0.05);
    const heads = d.oneHead ? [0] : [-0.13, 0.13]; heads.forEach(hx=>{ k.line([0, -0.5, hx*1.2, -0.68], hide, 0.14); c.beginPath(); c.ellipse(hx*1.2, -0.74, 0.12, 0.17, hx*1.5, 0, 6.28); k.fill(hide); c.beginPath(); c.ellipse(hx*1.2 - 0.12, -0.66, 0.06, 0.03, -0.5, 0, 6.28); k.fill(hide); c.beginPath(); c.ellipse(hx*1.2 + 0.12, -0.66, 0.06, 0.03, 0.5, 0, 6.28); k.fill(hide); k.stroke('rgba(30,20,10,.6)', 0.012); c.beginPath(); c.ellipse(hx*1.3, -0.84, 0.07, 0.05, 0, 0, 6.28); k.fill('#c8a090'); k.line([hx*1.2 - 0.1, -0.7, hx*1.2 - 0.2, -0.78], '#e0d8c0', 0.025); k.line([hx*1.2 + 0.1, -0.7, hx*1.2 + 0.2, -0.78], '#e0d8c0', 0.025); });
    if(d.packs){ [-1, 1].forEach(s=>{ k.rr(s*0.28 - (s < 0 ? 0.2 : 0), -0.25, 0.2, 0.42, 0.05); k.texFill('wood', '#6a5038', '#7a6a4a', 0.5); k.stroke(k.INK, 0.008); }); k.rr(-0.24, -0.18, 0.48, 0.28, 0.04); k.fill('#7a6a50'); k.stroke(k.INK, 0.008); k.line([-0.3, -0.05, 0.3, -0.05], '#4a3a28', 0.025); }
    if(d.dead){ k.blot(0.1, 0.3, 0.3, '#5a1a10', 0.5); } c.restore(); }
  const PACK = [{n:'Брамин с поклажей', col:'#8a6a4a', packs:true}, {n:'Брамин пасётся', col:'#9a7a5a'}, {n:'Мутировавший вол', col:'#6a6a5a', spot:'#4a5a3a', oneHead:true}, {n:'Мёртвый', col:'#7a6a5a', dead:true}];
  function arenaDraw(g, d){ const k = hk(g), c = k.c, cx = 2, cy = 2;
    k.organic(cx, cy, 1.85, 0.05); k.texFill('dirt', '#6a5a44'); k.organic(cx, cy, 1.45, 0.08); const gr = c.createRadialGradient(cx, cy, 0.2, cx, cy, 1.5); gr.addColorStop(0, '#5a4630'); gr.addColorStop(0.8, '#3a2c1e'); gr.addColorStop(1, '#1e160e'); c.fillStyle = gr; c.fill();
    c.save(); k.organic(cx, cy, 1.45, 0.08); c.clip(); for(let i=0;i<10;i++) k.blot(cx + k.R(-1, 1), cy + k.R(-1, 1), k.R(0.08, 0.25), d.abandoned ? '#3a3020' : '#5a1a10', 0.45); for(let i=0;i<12;i++) k.line([cx + k.R(-1, 1), cy + k.R(-1, 1), cx + k.R(-1, 1), cy + k.R(-1, 1)], 'rgba(0,0,0,.15)', 0.02); if(!d.abandoned){ xb.links(k, cx - 0.2, cy - 0.1, 7, 0.4); bits.skull(k, cx + 0.6, cy + 0.5, 0.1, 1); } else k.tufts(cx - 1, cy - 1, 2, 2, 8); c.restore();
    if(d.net){ for(let i=0;i<20;i++){ const a = i/20*6.28; pole(k, cx + Math.cos(a)*1.6, cy + Math.sin(a)*1.6, 0.05); } c.beginPath(); c.arc(cx, cy, 1.6, 0, 6.28); k.stroke('rgba(170,175,180,.75)', 0.03); c.beginPath(); c.arc(cx, cy, 1.55, 0, 6.28); k.stroke('rgba(170,175,180,.45)', 0.015, 0.8); }
    else for(let i=0;i<22;i++){ if(d.abandoned && i%5===0) continue; const a = i/22*6.28; k.tire(cx + Math.cos(a)*1.62, cy + Math.sin(a)*1.62, 0.2); }
    if(!d.abandoned){ k.rr(cx - 0.4, 0.02, 0.8, 0.22, 0.03); k.texFill('wood', '#6a5038'); k.stroke(k.INK, 0.008); xb.lantern && xb.lantern(k, 0.4, 0.4); xb.lantern && xb.lantern(k, 3.6, 3.6); } }
  const ARENA = [{n:'Яма в покрышках'}, {n:'Ринг из сетки', net:true}, {n:'Заброшенная', abandoned:true}];
  function bannerDraw(g, d){ const k = hk(g), c = k.c;
    const cloth = ()=>{ c.beginPath(); c.moveTo(0.3, 0.37); c.bezierCurveTo(0.5, 0.3, 0.7, 0.44, 0.97, 0.36); if(d.torn){ c.lineTo(0.86, 0.43); c.lineTo(0.95, 0.47); c.lineTo(0.84, 0.52); } c.lineTo(0.95, 0.55); c.bezierCurveTo(0.7, 0.63, 0.5, 0.49, 0.3, 0.56); c.closePath(); };
    c.save(); c.translate(0.1, 0.16); cloth(); k.fill('rgba(0,0,0,.3)'); c.restore(); cloth();
    c.fillStyle = k.lin(0.3, 0.3, 0.95, 0.6, [[0, shade(d.col, 0.12)], [0.5, d.col], [1, shade(d.col, -0.25)]]); c.fill(); k.stroke('rgba(20,14,8,.5)', 0.01);
    c.save(); c.clip(); for(let i=0;i<3;i++) k.line([0.4 + i*0.18, 0.25, 0.42 + i*0.18, 0.65], 'rgba(0,0,0,.18)', 0.05); k.line([0.3, 0.33, 0.95, 0.38], 'rgba(255,255,255,.2)', 0.03);
      for(let i=0;i<3;i++) k.line([0.45 + i*0.17, 0.3, 0.47 + i*0.17, 0.62], 'rgba(0,0,0,.14)', 0.06);
      if(d.sign==='skull') bits.skull(k, 0.62, 0.45, 0.07, 0); if(d.sign==='star') xb.star(k, 0.62, 0.45, 0.09, '#e8c040'); if(d.sign==='leaf'){ k.line([0.55, 0.52, 0.7, 0.38], '#e4ddca', 0.03); k.line([0.58, 0.48, 0.66, 0.5], '#e4ddca', 0.02); } if(d.sign==='wheel'){ c.beginPath(); c.arc(0.62, 0.45, 0.08, 0, 6.28); k.stroke('#2a2018', 0.02); for(let i=0;i<4;i++){ const a = i*0.785; k.line([0.62 - Math.cos(a)*0.08, 0.45 - Math.sin(a)*0.08, 0.62 + Math.cos(a)*0.08, 0.45 + Math.sin(a)*0.08], '#2a2018', 0.012); } } c.restore();
    pole(k, 0.3, 0.46, 0.07); c.beginPath(); c.arc(0.3, 0.46, 0.03, 0, 6.28); k.fill('#c8b060'); [[0.05, 0.85], [0.55, 0.9], [0.1, 0.1]].forEach(([x, y])=>k.line([0.3, 0.46, x, y], 'rgba(200,190,160,.5)', 0.008)); }
  const BANNER = [{n:'Рейдерское знамя', col:'#2a2420', sign:'skull'}, {n:'Флаг поселения', col:'#4a6a3a', sign:'leaf'}, {n:'Военный флаг', col:'#8e2e26', sign:'star'}, {n:'Караванный вымпел', col:'#c8a040', sign:'wheel'}, {n:'Рваное полотнище', col:'#7a6a5a', torn:true}];
  function signpostDraw(g, d){ const k = hk(g), c = k.c;
    if(d.stop){ c.save(); c.translate(0.08, 0.1); c.beginPath(); for(let i=0;i<8;i++){ const a = i/8*6.28 + 0.39; c.lineTo(0.5 + Math.cos(a)*0.3, 0.5 + Math.sin(a)*0.3); } k.fill('rgba(0,0,0,.35)'); c.restore();
      c.beginPath(); for(let i=0;i<8;i++){ const a = i/8*6.28 + 0.39; c.lineTo(0.5 + Math.cos(a)*0.3, 0.5 + Math.sin(a)*0.3); } k.fill('#a82a22'); k.stroke('#e4ddca', 0.03); bits.stencil(k, 0.5, 0.5, 'СТОЙ', 0.11, '#e4ddca', 1); for(let i=0;i<4;i++) k.rust(k.R(0.3, 0.7), k.R(0.3, 0.7), 0.04, i===0); return; }
    if(d.skulls){ pole(k, 0.5, 0.5, 0.06); [[0.25, 0.3], [0.72, 0.35], [0.4, 0.75]].forEach(([x, y], i)=>{ k.line([0.5, 0.5, x, y], '#5a4632', 0.03); bits.skull(k, x, y, 0.08, i); }); bits.stencil(k, 0.5, 0.92, 'ВОН', 0.1, '#c83a2a', 0.8); return; }
    [[0.12, -0.5, '#6a5038', 'Вода 2 км'], [0.08, 0.6, '#5a4632', 'Рынок'], [0.1, 2.6, '#6a5a3a', 'Город †']].forEach(([w, a, col, txt])=>{ c.save(); c.translate(0.5, 0.5); c.rotate(a); c.translate(0.04, 0.06); k.fillP([0, -0.07, 0.36, -0.07, 0.44, 0, 0.36, 0.07, 0, 0.07], 'rgba(0,0,0,.3)'); c.translate(-0.04, -0.06); k.fillP([0, -0.07, 0.36, -0.07, 0.44, 0, 0.36, 0.07, 0, 0.07], col); k.poly([0, -0.07, 0.36, -0.07, 0.44, 0, 0.36, 0.07, 0, 0.07]); k.stroke(k.INK, 0.008); k.line([0.03, 0, 0.3, 0], 'rgba(230,220,200,.5)', 0.02); c.restore(); });
    pole(k, 0.5, 0.5, 0.06); }
  const SIGNPOST = [{n:'Стрелки'}, {n:'«Стой»', stop:true}, {n:'Черепа на кольях', skulls:true}];
  function searchlightDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.55;
    if(d.on){ c.save(); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 3.2, -Math.PI/2 - 0.22, -Math.PI/2 + 0.22); c.closePath(); const gr = c.createRadialGradient(cx, cy, 0.1, cx, cy, 3.2); gr.addColorStop(0, 'rgba(255,250,215,.45)'); gr.addColorStop(1, 'rgba(255,250,215,0)'); c.fillStyle = gr; c.fill(); c.restore(); }
    for(let i=0;i<3;i++){ const a = i*2.09 + 1.57; k.line([cx + 0.03, cy + 0.04, cx + Math.cos(a)*0.4 + 0.03, cy + Math.sin(a)*0.4 + 0.04], 'rgba(0,0,0,.35)', 0.05); k.line([cx, cy, cx + Math.cos(a)*0.4, cy + Math.sin(a)*0.4], '#4a4e50', 0.04); }
    c.save(); c.translate(cx, cy); c.rotate(d.broken ? 0.9 : 0); k.rr(-0.18, -0.3, 0.36, 0.42, 0.06); k.texFill('metal', '#5a6060', '#4a5a3a', 0.5); k.stroke(k.INK, 0.01); c.beginPath(); c.ellipse(0, -0.3, 0.17, 0.06, 0, 0, 6.28); k.fill(d.on ? '#fffbe0' : d.broken ? '#1a1c1e' : '#9aa0a0'); k.stroke(k.INK, 0.008);
    if(d.broken) for(let i=0;i<5;i++) k.line([0, -0.3, k.R(-0.14, 0.14), -0.3 + k.R(-0.05, 0.05)], 'rgba(220,230,230,.6)', 0.006); c.restore();
    if(d.on) k.radial(cx, cy - 0.3, 0.4, '#fffbe0', 0.6); xb.cable(k, [cx, cy + 0.1, cx + 0.25, cy + 0.35, cx + 0.45, cy + 0.4], '#1a1816', 0.02); }
  const SEARCH = [{n:'Светит', on:true}, {n:'Выключен'}, {n:'Разбит', broken:true}];
  function radioMastDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    for(let i=0;i<4;i++){ const a = i*1.57 + 0.785, ex = cx + Math.cos(a)*0.92, ey = cy + Math.sin(a)*0.92; k.line([cx + 0.02, cy + 0.03, ex + 0.02, ey + 0.03], 'rgba(0,0,0,.3)', 0.014); k.line([cx, cy, ex, ey], 'rgba(205,200,190,.8)', 0.012); pole(k, ex, ey, 0.045); }
    if(d.pipes){ c.beginPath(); c.arc(cx + 0.06, cy + 0.08, 0.12, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, 0.11, 0, 6.28); k.texFill('metal', '#6a6e70', '#7a5a3a', 0.6); k.stroke(k.INK, 0.01); for(let i=0;i<4;i++) k.rust(cx + k.R(-0.08, 0.08), cy + k.R(-0.08, 0.08), 0.03, false); k.line([cx, cy, cx + 0.5, cy - 0.35], '#6a6e70', 0.04); k.line([cx, cy, cx - 0.45, cy - 0.3], '#6a6e70', 0.03); }
    else { const tri = (r, col)=>{ c.beginPath(); for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } c.closePath(); k.stroke(col, 0.025); }; shadowRing(k, cx, cy, 0.3); tri(0.3, '#c8302a'); tri(0.2, '#e4ddca'); tri(0.1, '#c8302a'); for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; k.line([cx, cy, cx + Math.cos(a)*0.3, cy + Math.sin(a)*0.3], '#8a8e90', 0.015); } }
    if(d.dish) dish(k, cx + 0.45, cy + 0.3, 0.22); k.rr(cx - 0.75, cy + 0.45, 0.4, 0.3, 0.03); k.texFill('metal', '#55605a'); k.stroke(k.INK, 0.008); xb.cable(k, [cx - 0.55, cy + 0.45, cx - 0.2, cy + 0.15, cx, cy], '#1a1816', 0.015);
    c.beginPath(); c.arc(cx, cy, 0.05, 0, 6.28); k.fill('#e8402a'); k.radial(cx, cy, 0.25, '#ff5030', 0.35); }
  function shadowRing(k, cx, cy, r){ const c = k.c; c.beginPath(); c.arc(cx + 0.06, cy + 0.08, r, 0, 6.28); k.fill('rgba(0,0,0,.25)'); }
  const RMAST = [{n:'Решётчатая мачта'}, {n:'С тарелкой', dish:true}, {n:'Самодельная из труб', pipes:true}];
  function trophyPoleDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.5;
    if(d.gallows){ k.line([0.15 + 0.04, 0.5 + 0.05, 0.85 + 0.04, 0.5 + 0.05], 'rgba(0,0,0,.35)', 0.1); k.line([0.15, 0.5, 0.85, 0.5], '#5a4632', 0.09); pole(k, 0.15, 0.5, 0.08); k.line([0.7, 0.5, 0.7, 0.62], '#c8b88a', 0.015);
      c.beginPath(); c.ellipse(0.74, 0.86, 0.14, 0.2, 0.2, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.ellipse(0.7, 0.8, 0.12, 0.17, 0.2, 0, 6.28); k.fill('#5a4a3a'); c.beginPath(); c.arc(0.7, 0.66, 0.07, 0, 6.28); k.fill('#8a7058'); return; }
    pole(k, cx, cy, 0.09); const items = d.helmets ? 'h' : 's';
    for(let i=0;i<5;i++){ const a = i/5*6.28 + 0.3, r = 0.3, x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r; k.line([cx, cy, x, y], d.helmets ? '#5a5e60' : '#c8b88a', 0.012);
      if(items==='s') bits.skull(k, x, y, 0.08, a); else { c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.09, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.09, 0, 6.28); k.texFill('metal', '#55605a', i%2 ? '#4a5a3a' : '#6a6a6a', 0.6); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x - 0.03, y - 0.03, 0.03, 0, 6.28); k.fill('rgba(255,255,255,.3)'); } }
    xb.links(k, cx - 0.05, cy + 0.15, 4, 1.4); k.blot(cx, cy + 0.3, 0.12, '#4a1a10', 0.4); }
  const TROPHY = [{n:'Черепа'}, {n:'Шлемы и доспехи', helmets:true}, {n:'Виселица', gallows:true}];
  A('garden_bed', 'Огородная грядка', 'camp', 3, 1, {t:'грядка огород овощи посадки ферма', v:GBED.length, vn:VN(GBED), hd:true}, (g, v)=>gardenBedDraw(g, PV(GBED, v)));
  A('latrine', 'Отхожее место', 'camp', 1, 1, {t:'туалет отхожее место будка нужник', v:LATRINE.length, vn:VN(LATRINE), hd:true}, (g, v)=>latrineDraw(g, PV(LATRINE, v)));
  A('canopy', 'Навес на столбах', 'camp', 3, 3, {t:'навес тент брезент столбы укрытие', v:CANOPY.length, vn:VN(CANOPY), hd:true}, (g, v)=>canopyDraw(g, PV(CANOPY, v)));
  A('drying_rack', 'Сушилка', 'camp', 3, 1, {t:'сушилка верёвка бельё шкуры мясо', v:DRYRACK.length, vn:VN(DRYRACK), hd:true}, (g, v)=>dryingRackDraw(g, PV(DRYRACK, v)));
  A('field_kitchen', 'Полевая кухня', 'camp', 2, 2, {t:'кухня котёл костёр еда печь', v:FKITCHEN.length, vn:VN(FKITCHEN), hd:true, lit:true}, (g, v)=>fieldKitchenDraw(g, PV(FKITCHEN, v)));
  A('water_cistern', 'Цистерна с водой', 'camp', 2, 2, {t:'вода цистерна бочка запас', v:CISTERN.length, vn:VN(CISTERN), hd:true}, (g, v)=>cisternDraw(g, PV(CISTERN, v)));
  A('cage', 'Клетка', 'camp', 2, 2, {t:'клетка пленник тюрьма решётка', v:CAGE.length, vn:VN(CAGE), hd:true}, (g, v)=>cageDraw(g, PV(CAGE, v)));
  A('animal_pen', 'Загон', 'camp', 4, 4, {t:'загон скот изгородь брамин ферма', g:true, v:PEN.length, vn:VN(PEN), hd:true}, (g, v)=>penDraw(g, PV(PEN, v)));
  A('pack_animal', 'Вьючное животное', 'camp', 1, 2, {t:'брамин вол корова вьючное животное караван', v:PACK.length, vn:VN(PACK), hd:true}, (g, v)=>packAnimalDraw(g, PV(PACK, v)));
  A('arena_pit', 'Арена-яма', 'camp', 4, 4, {t:'арена яма бои ринг', g:true, v:ARENA.length, vn:VN(ARENA), hd:true}, (g, v)=>arenaDraw(g, PV(ARENA, v)));
  A('banner', 'Знамя', 'camp', 1, 1, {t:'флаг знамя вымпел штандарт', v:BANNER.length, vn:VN(BANNER), hd:true}, (g, v)=>bannerDraw(g, PV(BANNER, v)));
  A('signpost', 'Указатель', 'camp', 1, 1, {t:'указатель знак табличка столб', v:SIGNPOST.length, vn:VN(SIGNPOST), hd:true}, (g, v)=>signpostDraw(g, PV(SIGNPOST, v)));
  A('searchlight', 'Прожектор', 'camp', 1, 1, {t:'прожектор свет фонарь охрана', v:SEARCH.length, vn:VN(SEARCH), hd:true, lit:true}, (g, v)=>searchlightDraw(g, PV(SEARCH, v)));
  A('radio_mast', 'Радиомачта', 'camp', 2, 2, {t:'радио мачта антенна связь', v:RMAST.length, vn:VN(RMAST), hd:true}, (g, v)=>radioMastDraw(g, PV(RMAST, v)));
  A('trophy_pole', 'Столб с трофеями', 'camp', 1, 1, {t:'трофеи черепа столб виселица', v:TROPHY.length, vn:VN(TROPHY), hd:true}, (g, v)=>trophyPoleDraw(g, PV(TROPHY, v)));

  /* ===================== ЗОНЫ АНОМАЛИЙ ===================== */
  /* ---- Аномалии (HD) ---- */
  // камень сверху: гранёный силуэт, свет с северо-запада, трещины, лишайник
  function hdRock(k, cx, cy, r, col, opt){ opt = opt || {}; const c = k.c, n = 7 + Math.floor(k.rnd()*4), pts = [];
    for(let i=0;i<n;i++){ const a = i/n*6.28 + k.R(-0.2, 0.2), rr = r*k.R(0.72, 1.08)*(opt.flat ? (Math.abs(Math.sin(a)) > 0.6 ? 0.7 : 1) : 1); pts.push(cx + Math.cos(a)*rr, cy + Math.sin(a)*rr*(opt.ry || 1)); }
    c.save(); c.translate(r*0.18, r*0.24); k.poly(pts); k.fill('rgba(0,0,0,.45)'); c.restore(); k.poly(pts); k.texFill('rock', col || '#7a7468', opt.tint, 0.35); k.poly(pts); k.fill(col || '#7a7468', 0.5);
    c.save(); k.poly(pts); c.clip(); const tx = cx + k.R(-0.2, 0.2)*r, ty = cy + k.R(-0.2, 0.2)*r;
    for(let i=0;i<n;i++){ const j = (i + 1)%n, a = Math.atan2(pts[i*2 + 1] + pts[j*2 + 1] - 2*cy, pts[i*2] + pts[j*2] - 2*cx), lit = Math.cos(a + 2.36); k.fillP([tx, ty, pts[i*2], pts[i*2 + 1], pts[j*2], pts[j*2 + 1]], lit > 0 ? '#fff8ec' : '#0a0806', Math.abs(lit)*0.3); k.line([tx, ty, pts[i*2], pts[i*2 + 1]], lit > 0 ? 'rgba(255,250,240,.12)' : 'rgba(0,0,0,.14)', r*0.012); }
    for(let i=0;i<4;i++){ let x = cx + k.R(-0.6, 0.6)*r, y = cy + k.R(-0.6, 0.6)*r; const p = [x, y]; for(let j=0;j<3;j++){ x += k.R(-0.18, 0.18)*r; y += k.R(-0.18, 0.18)*r; p.push(x, y); } k.line(p.map((v, j)=>v + 0.006), 'rgba(255,250,240,.18)', r*0.012); k.line(p, 'rgba(15,12,10,.6)', r*0.016); } for(let i=0;i<Math.round(r*40);i++){ c.beginPath(); c.arc(cx + k.R(-0.8, 0.8)*r, cy + k.R(-0.8, 0.8)*r, r*k.R(0.008, 0.02), 0, 6.28); k.fill(k.rnd() < 0.5 ? 'rgba(0,0,0,.35)' : 'rgba(255,250,240,.3)'); }
    if(opt.moss !== false) for(let i=0;i<3;i++) k.moss(cx + k.R(-0.5, 0.2)*r, cy + k.R(-0.5, 0.3)*r, r*k.R(0.12, 0.25)); if(opt.lichen) for(let i=0;i<6;i++) k.blot(cx + k.R(-0.6, 0.6)*r, cy + k.R(-0.6, 0.6)*r, r*k.R(0.05, 0.12), '#a8a060', 0.5);
    c.restore(); k.poly(pts); k.stroke('rgba(20,16,12,.7)', r*0.025); return pts; }
  function hdCanopy(k, cx, cy, r, cols, opt){ opt = opt || {}; const c = k.c; c.beginPath(); c.ellipse(cx + r*0.3, cy + r*0.38, r*1.02, r*0.95, 0, 0, 6.28); k.fill('rgba(0,0,0,.38)');
    const lobes = 7 + Math.floor(k.rnd()*4); for(let L=0;L<3;L++){ const rr = r*(1 - L*0.24); for(let i=0;i<lobes;i++){ const a = i/lobes*6.28 + L*0.5 + k.R(-0.3, 0.3), d = rr*0.55; const x = cx + Math.cos(a)*d - L*r*0.08, y = cy + Math.sin(a)*d - L*r*0.1; k.blot(x, y, rr*k.R(0.4, 0.55), cols[Math.min(L, cols.length - 1)], 1, 0.5); } }
    for(let i=0;i<Math.round(r*90);i++){ const a = k.rnd()*6.28, d = Math.sqrt(k.rnd())*r*0.95, x = cx + Math.cos(a)*d, y = cy + Math.sin(a)*d, lit = -(Math.cos(a)*d + Math.sin(a)*d)/r; c.fillStyle = lit > 0.2 ? `rgba(220,230,170,${0.25*lit})` : `rgba(10,15,5,${0.3*(0.3 - lit)})`; c.beginPath(); c.ellipse(x, y, r*0.05, r*0.03, k.rnd()*3, 0, 6.28); c.fill(); }
    if(opt.sparse) for(let i=0;i<6;i++) k.line([cx, cy, cx + k.R(-r, r), cy + k.R(-r, r)], '#3a2e22', r*0.05); }
  function hdBranches(k, x, y, a, L, w, depth, col){ if(depth <= 0 || L < 0.05) return; const x1 = x + Math.cos(a)*L, y1 = y + Math.sin(a)*L; k.line([x + 0.02, y + 0.03, x1 + 0.02, y1 + 0.03], 'rgba(0,0,0,.35)', w); k.line([x, y, x1, y1], col || '#4a3e32', w); k.line([x - 0.01, y - 0.01, x1 - 0.01, y1 - 0.01], 'rgba(255,240,220,.15)', w*0.3); const n = 2 + (k.rnd() < 0.3 ? 1 : 0); for(let i=0;i<n;i++) hdBranches(k, x1, y1, a + k.R(-0.7, 0.7), L*k.R(0.55, 0.75), w*0.65, depth - 1, col); }
  function anomGravityDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5, col = d.col;
    // вдавленная почва: концентрические тени и растянутые к центру борозды
    const gr = c.createRadialGradient(cx, cy, 0, cx, cy, 1.45); gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(0.25, 'rgba(8,6,12,.7)'); gr.addColorStop(0.7, 'rgba(20,16,24,.25)'); gr.addColorStop(1, 'rgba(20,16,24,0)'); c.beginPath(); c.arc(cx, cy, 1.45, 0, 6.28); c.fillStyle = gr; c.fill();
    for(let i=0;i<40;i++){ const a = i/40*6.28 + k.R(-0.05, 0.05), r0 = k.R(0.3, 0.5), r1 = k.R(1.0, 1.42); c.beginPath(); for(let t=0;t<=1;t+=0.1){ const r = r1 + (r0 - r1)*t, an = a + t*0.9; c.lineTo(cx + Math.cos(an)*r, cy + Math.sin(an)*r); } k.stroke(i%2 ? 'rgba(0,0,0,.35)' : 'rgba(255,240,220,.08)', 0.025); }
    for(let i=0;i<9;i++){ const a0 = i/9*6.28; c.beginPath(); for(let t=0;t<1;t+=0.02){ const a = a0 + t*4.5, r = 1.35*(1 - t); c.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r); } k.stroke(col, 0.025, 0.35); }
    for(let i=0;i<26;i++){ const a = k.R(0, 6.28), r = k.R(0.35, 1.35), s = k.R(0.03, 0.09); c.save(); c.translate(cx + Math.cos(a)*r, cy + Math.sin(a)*r); c.rotate(a + 1.57); k.rr(-s, -s*0.3, s*2, s*0.6, s*0.2); k.fill(k.pick(['#5a5650', '#6a5a4a', '#4a4844'])); c.restore(); k.line([cx + Math.cos(a)*r, cy + Math.sin(a)*r, cx + Math.cos(a + 0.3)*r*1.08, cy + Math.sin(a + 0.3)*r*1.08], col, 0.008, 0.35); }
    k.radial(cx, cy, 1.2, col, 0.18); c.beginPath(); c.arc(cx, cy, 0.2, 0, 6.28); k.fill('#000'); c.beginPath(); c.arc(cx, cy, 0.26, 0, 6.28); k.stroke(col, 0.025, 0.8); c.beginPath(); c.ellipse(cx, cy, 0.5, 0.16, 0.4, 0, 6.28); k.stroke(col, 0.012, 0.5);
    if(d.debris){ for(let i=0;i<5;i++){ const a = k.R(0, 6.28), r = k.R(0.5, 1.1); c.save(); c.translate(cx + Math.cos(a)*r, cy + Math.sin(a)*r); c.rotate(a); k.rr(-0.12, -0.05, 0.24, 0.1, 0.02); k.texFill('metal', '#6d7376', '#6a4a3a', 0.6); k.stroke(k.INK, 0.006); c.restore(); } bits.skull(k, cx + 0.7, cy - 0.5, 0.07, 1); } }
  const AGRAV = [{n:'Воронка', col:'#b4a0ff'}, {n:'С мусором на орбите', col:'#b4a0ff', debris:true}, {n:'Красная', col:'#ff786e', debris:true}];
  function anomElectroDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1, col = d.col || '#9fd8ff';
    for(let i=0;i<10;i++) k.blot(cx + k.R(-0.8, 0.8), cy + k.R(-0.8, 0.8), k.R(0.08, 0.2), '#0a0806', 0.5); for(let i=0;i<6;i++){ const a = k.R(0, 6.28); k.line([cx + Math.cos(a)*0.3, cy + Math.sin(a)*0.3, cx + Math.cos(a)*0.95, cy + Math.sin(a)*0.95], 'rgba(10,8,6,.5)', 0.04); }
    k.radial(cx, cy, 0.95, col, 0.35); const bolt = (x0, y0, x1, y1, w, depth)=>{ const pts = [x0, y0]; const n = 6; for(let i=1;i<n;i++){ const t = i/n; pts.push(x0 + (x1 - x0)*t + k.R(-0.12, 0.12), y0 + (y1 - y0)*t + k.R(-0.12, 0.12)); } pts.push(x1, y1); k.line(pts, col, w*3, 0.25); k.line(pts, '#ffffff', w); if(depth > 0) for(let i=0;i<2;i++){ const j = 2 + Math.floor(k.rnd()*3)*2; bolt(pts[j], pts[j + 1], pts[j] + k.R(-0.4, 0.4), pts[j + 1] + k.R(-0.4, 0.4), w*0.6, depth - 1); } };
    const nArc = d.storm ? 9 : 5; for(let i=0;i<nArc;i++){ const a = i/nArc*6.28 + k.R(-0.3, 0.3); bolt(cx, cy, cx + Math.cos(a)*k.R(0.6, 0.95), cy + Math.sin(a)*k.R(0.6, 0.95), 0.018, 1); }
    c.beginPath(); c.arc(cx, cy, 0.12, 0, 6.28); k.fill('#ffffff'); k.radial(cx, cy, 0.35, col, 0.6);
    if(d.pylon){ [[0.3, 0.35], [1.7, 1.6]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.1, 0, 6.28); k.texFill('metal', '#6d7376', '#6a4a3a', 0.6); k.stroke(k.INK, 0.008); k.radial(x, y, 0.25, col, 0.35); }); bolt(0.3, 0.35, cx, cy, 0.014, 0); bolt(1.7, 1.6, cx, cy, 0.014, 0); } }
  const AELECTRO = [{n:'Разряд'}, {n:'Гроза', storm:true}, {n:'Между столбами', pylon:true}, {n:'Фиолетовая', col:'#c89fff', storm:true}];
  function anomThermalDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.orgK(cx, cy, 0.9, 0.25); c.fillStyle = k.lin(0, 0, 2, 2, [[0, '#2a1a10'], [1, '#140a06']]); c.fill(); c.save(); k.orgK(cx, cy, 0.9, 0.25); c.clip(); for(let i=0;i<14;i++){ const a = k.R(0, 6.28), r = k.R(0.1, 0.8); k.line([cx + Math.cos(a)*r*0.3, cy + Math.sin(a)*r*0.3, cx + Math.cos(a + 0.2)*r, cy + Math.sin(a + 0.2)*r, cx + Math.cos(a - 0.1)*(r + 0.15), cy + Math.sin(a - 0.1)*(r + 0.15)], d.blue ? '#7ad8ff' : '#ff8a20', 0.03); } for(let i=0;i<20;i++){ const x = cx + k.R(-0.7, 0.7), y = cy + k.R(-0.7, 0.7); k.fillP([x, y, x + 0.08, y + 0.03, x + 0.04, y + 0.1, x - 0.04, y + 0.06], '#2a1e16', 0.9); } c.restore();
    k.radial(cx, cy, 0.95, d.blue ? '#5ab8ff' : '#ff6a10', 0.5); k.radial(cx, cy, 0.35, d.blue ? '#e0f8ff' : '#ffe080', 0.7);
    if(d.vent){ for(let i=0;i<3;i++){ const x = cx + k.R(-0.4, 0.4), y = cy + k.R(-0.4, 0.4); c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#ffd060'); k.radial(x, y, 0.2, '#ffe0a0', 0.6); } }
    if(d.ash){ for(let i=0;i<14;i++) k.blot(cx + k.R(-1, 1), cy + k.R(-1, 1), k.R(0.05, 0.14), '#3a3430', 0.6); bits.skull(k, cx + 0.45, cy + 0.4, 0.07, 0.4); } }
  const ATHERMAL = [{n:'Жар'}, {n:'С выбросами', vent:true}, {n:'Пепелище', ash:true}, {n:'Холодное пламя', blue:true}];
  function toxicPuddleDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    k.orgK(1, 1, 0.92, 0.35, 0.8); k.fill('rgba(30,40,10,.45)'); k.orgK(1, 1, 0.8, 0.3, 0.68); c.fillStyle = k.lin(0.2, 0.3, 1.8, 1.7, [[0, col[0]], [1, col[1]]]); c.fill();
    c.save(); k.orgK(1, 1, 0.8, 0.3, 0.68); c.clip(); for(let i=0;i<10;i++){ const x = k.R(0.4, 1.6), y = k.R(0.4, 1.6), r = k.R(0.03, 0.09); c.beginPath(); c.arc(x, y, r, 0, 6.28); k.stroke('rgba(255,255,220,.45)', 0.01); c.beginPath(); c.arc(x - r*0.3, y - r*0.3, r*0.3, 0, 6.28); k.fill('rgba(255,255,255,.5)'); } for(let i=0;i<4;i++) k.line([k.R(0.3, 1.0), k.R(0.4, 1.6), k.R(1.0, 1.7), k.R(0.4, 1.6)], 'rgba(255,255,255,.12)', 0.02); k.radial(0.7, 0.7, 0.6, '#ffffff', 0.12); if(d.drums){ c.save(); c.translate(1.3, 1.1); c.rotate(0.6); k.rr(-0.25, -0.15, 0.5, 0.3, 0.05); k.texFill('metal', '#6d7376', '#c8a030', 0.6); k.fill('rgba(0,0,0,.2)'); c.restore(); } c.restore();
    k.orgK(1, 1, 0.8, 0.3, 0.68); k.stroke(col[2], 0.04, 0.6); k.radial(1, 1, 1.0, col[2], 0.18); for(let i=0;i<8;i++){ const a = k.R(0, 6.28); k.blot(1 + Math.cos(a)*0.85, 1 + Math.sin(a)*0.7, k.R(0.05, 0.12), '#d8d0a0', 0.35); }
    if(d.drums){ bits.barrel(k, 0.3, 0.4, 0.17, '#c8a030', false); bits.skull(k, 1.6, 0.4, 0.06, 0.3); } if(d.bones) for(let i=0;i<4;i++) k.line([k.R(0.5, 1.5), k.R(0.5, 1.5), k.R(0.5, 1.5), k.R(0.5, 1.5)], '#d8d0b0', 0.03, 0.7); }
  const TOXIC_P = [{n:'Зелёная', col:['#6ab030', '#2a5a10', '#a8f050']}, {n:'Жёлтая кислота', col:['#c8b020', '#6a5a10', '#f0e060'], bones:true}, {n:'Фиолетовая', col:['#8a40b0', '#3a1a5a', '#d090ff']}, {n:'С бочками', col:['#6ab030', '#2a5a10', '#a8f050'], drums:true}];
  function crystalDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    k.organic(1, 1, 0.85, 0.3); k.fill('rgba(0,0,0,.25)'); for(let i=0;i<6;i++) hdRock(k, 1 + k.R(-0.5, 0.5), 1 + k.R(-0.5, 0.5), k.R(0.12, 0.22), '#5a5650', {moss:false});
    const n = d.big ? 9 : 14; for(let i=0;i<n;i++){ const a = k.R(0, 6.28), r = d.big ? k.R(0, 0.5) : k.R(0, 0.7), x = 1 + Math.cos(a)*r, y = 1 + Math.sin(a)*r, L = d.big ? k.R(0.35, 0.7) : k.R(0.15, 0.4), w = L*0.28, ang = k.R(0, 6.28);
      c.save(); c.translate(x, y); c.rotate(ang); k.fillP([0.04, 0.06, L + 0.04, 0.06, 0.04, w + 0.06], '#000', 0.35); k.fillP([0, -w, L*0.8, -w*0.6, L, 0, 0, 0], col[0]); k.fillP([0, w, L*0.8, w*0.6, L, 0, 0, 0], col[1]); k.line([0, 0, L, 0], col[2], 0.012); k.line([0.03, -w*0.6, L*0.6, -w*0.4], 'rgba(255,255,255,.55)', 0.01); c.restore(); }
    k.radial(1, 1, 0.9, col[2], 0.3); for(let i=0;i<10;i++){ const x = k.R(0.3, 1.7), y = k.R(0.3, 1.7); c.beginPath(); c.arc(x, y, 0.012, 0, 6.28); k.fill('#ffffff'); } }
  const CRYSTAL = [{n:'Голубые', col:['#7ad8ff', '#2a6a9a', '#b8f0ff']}, {n:'Фиолетовые', col:['#c88aff', '#5a2a8a', '#e8c8ff']}, {n:'Красные', col:['#ff7a6a', '#8a2a1a', '#ffc0b0']}, {n:'Крупные зелёные', col:['#8aff9a', '#2a7a3a', '#d0ffd8'], big:true}];
  function mutantTreeDraw(g, d){ const k = hk(g), c = k.c;
    for(let i=0;i<7;i++){ const a = i/7*6.28 + k.R(-0.3, 0.3); k.line([1, 1, 1 + Math.cos(a)*0.5, 1 + Math.sin(a)*0.5, 1 + Math.cos(a + 0.4)*0.9, 1 + Math.sin(a + 0.4)*0.9], '#3a2a24', 0.06); }
    if(d.bare){ for(let i=0;i<6;i++) hdBranches(k, 1, 1, i/6*6.28 + k.R(-0.2, 0.2), 0.45, 0.09, 3, '#4a2e30'); for(let i=0;i<10;i++){ const x = k.R(0.2, 1.8), y = k.R(0.2, 1.8); c.beginPath(); c.arc(x, y, 0.05, 0, 6.28); k.fill(d.pods || '#c84a8a'); k.radial(x, y, 0.15, d.pods || '#ff6ab0', 0.35); } }
    else { hdCanopy(k, 1, 1, 0.85, d.cols); for(let i=0;i<8;i++){ const x = 1 + k.R(-0.6, 0.6), y = 1 + k.R(-0.6, 0.6); c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill(d.pods); k.radial(x, y, 0.18, d.pods, 0.3); } for(let i=0;i<5;i++){ const a = k.R(0, 6.28); k.line([1 + Math.cos(a)*0.5, 1 + Math.sin(a)*0.5, 1 + Math.cos(a)*0.95, 1 + Math.sin(a)*0.95, 1 + Math.cos(a + 0.4)*1.0, 1 + Math.sin(a + 0.4)*1.0], '#5a3a4a', 0.025); } }
    c.beginPath(); c.arc(1, 1, 0.15, 0, 6.28); k.fill('#3a2a24'); k.stroke(k.INK, 0.01); }
  const MUTREE = [{n:'Пурпурная крона', cols:['#4a2a4a', '#6a3a5a', '#8a4a6a'], pods:'#e0ff6a'}, {n:'Ядовито-зелёная', cols:['#3a5a1a', '#5a7a1a', '#8aa82a'], pods:'#ff5a3a'}, {n:'Голые ветви с наростами', bare:true}];
  function glowMushDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    k.orgK(0.5, 0.5, 0.42, 0.3); k.texFill('dirt', '#3a3026'); k.fill('rgba(0,0,0,.3)'); k.moss(0.3, 0.6, 0.15); k.moss(0.65, 0.35, 0.12);
    k.radial(0.5, 0.5, 0.55, col, 0.35); const n = d.cluster ? 16 : 10; for(let i=0;i<n;i++){ const x = 0.5 + k.R(-0.3, 0.3), y = 0.5 + k.R(-0.3, 0.3), r = d.cluster ? k.R(0.022, 0.045) : k.R(0.03, 0.075); k.line([x, y, x + 0.03, y + 0.05], '#d8d0b0', r*0.4, 0.6); c.beginPath(); c.arc(x + 0.015, y + 0.02, r, 0, 6.28); k.fill('rgba(0,0,0,.4)'); const gr = c.createRadialGradient(x - r*0.3, y - r*0.3, 0, x, y, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, col); gr.addColorStop(1, d.dark); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = gr; c.fill(); for(let j=0;j<3;j++){ c.beginPath(); c.arc(x + k.R(-0.5, 0.5)*r, y + k.R(-0.5, 0.5)*r, r*0.12, 0, 6.28); k.fill('rgba(255,255,255,.7)'); } k.radial(x, y, r*2.5, col, 0.3); } }
  const GLOWM = [{n:'Бирюзовые', col:'#5affd8', dark:'#1a6a5a'}, {n:'Янтарные гроздья', col:'#ffc84a', dark:'#7a4a10', cluster:true}, {n:'Розовые', col:'#ff7ad8', dark:'#6a1a5a'}];
  function riftDraw(g, d){ const k = hk(g), c = k.c; const L = [], R = []; for(let i=0;i<=12;i++){ const y = 0.1 + i*4.8/12, w = (Math.sin(i/12*3.14)*0.55 + 0.08)*(d.wide ? 1.4 : 1), x = 1 + Math.sin(i*1.3)*0.18; L.push(x - w*k.R(0.8, 1.1), y); R.push(x + w*k.R(0.8, 1.1), y); }
    const P = L.concat(R.reduce((a, _, i, s)=>i%2 ? a : [s[i], s[i + 1]].concat(a), [])); c.save(); c.translate(0.12, 0.08); k.poly(P.map((v, i)=>i%2 ? v : (v - 1)*1.4 + 1)); k.fill('rgba(0,0,0,.35)'); c.restore();
    k.poly(P.map((v, i)=>i%2 ? v : (v - 1)*1.3 + 1)); k.texFill('rock', '#5a5248'); k.poly(P); c.fillStyle = k.lin(0, 0, 2, 0, [[0, '#2a241e'], [0.5, '#000'], [1, '#14100c']]); c.fill();
    c.save(); k.poly(P); c.clip(); if(d.glow){ k.radial(1, 2.5, 1.6, d.glow, 0.6); for(let i=0;i<14;i++) k.line([1 + k.R(-0.15, 0.15), k.R(0.4, 4.6), 1 + k.R(-0.15, 0.15), k.R(0.4, 4.6)], d.glow, 0.02, 0.6); } else if(d.water){ k.poly(P.map((v, i)=>i%2 ? v : (v - 1)*0.4 + 1)); c.fillStyle = k.lin(0, 0, 0, 5, [[0, '#1a2a2a'], [1, '#2a3a3a']]); c.fill(); k.line([1, 0.5, 1.05, 4.5], 'rgba(200,220,220,.25)', 0.02); } for(let i=0;i<12;i++) k.chunk(1 + k.R(-0.3, 0.3), k.R(0.3, 4.7), k.R(0.04, 0.1), '#5a5248', 0.02); c.restore();
    for(let i=0;i<12;i++){ const j = Math.floor(k.rnd()*13)*2, s = k.rnd() < 0.5 ? L : R; k.line([s[j], s[j + 1], s[j] + (s===L ? -1 : 1)*k.R(0.2, 0.5), s[j + 1] + k.R(-0.3, 0.3)], 'rgba(10,8,6,.6)', 0.02); } k.line(L, 'rgba(255,240,220,.3)', 0.025); k.line(R, 'rgba(0,0,0,.5)', 0.025); for(let i=0;i<14;i++) k.chunk(1 + (k.rnd() < 0.5 ? -1 : 1)*k.R(0.5, 0.9), k.R(0.3, 4.7), k.R(0.04, 0.12), '#7a7266', 0.03); }
  const RIFT = [{n:'Трещина'}, {n:'Широкий провал', wide:true}, {n:'Светится изнутри', glow:'#ff6a20'}, {n:'Аномальное сияние', glow:'#7ad8ff', wide:true}, {n:'С водой на дне', water:true}];
  function labRuinDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.1, 0.1, 5.8, 5.8, 0.03); k.texFill('tiles', '#a8a49c', '#9aa8a0', 0.3); c.save(); k.rr(0.1, 0.1, 5.8, 5.8, 0.03); c.clip(); for(let i=0;i<20;i++) k.blot(k.R(0.3, 5.7), k.R(0.3, 5.7), k.R(0.1, 0.4), '#3a3026', 0.3); k.leaves(0, 0, 6, 6, 60); k.tufts(0, 0, 6, 6, 30); c.restore();
    const wall = (p)=>{ k.line(p.map((v, i)=>v + (i%2 ? 0.07 : 0.05)), 'rgba(0,0,0,.4)', 0.26); k.line(p, '#8a8780', 0.22); k.line(p, 'rgba(255,250,240,.25)', 0.04); };
    wall([0.2, 0.2, 5.8, 0.2]); wall([0.2, 0.2, 0.2, 5.8]); wall([5.8, 0.2, 5.8, 2.6]); wall([0.2, 5.8, 3.2, 5.8]); wall([2.6, 0.2, 2.6, 2.3]); wall([0.2, 3.0, 2.0, 3.0]); for(let i=0;i<40;i++) k.chunk(k.R(3, 5.8), k.R(2.6, 5.8), k.R(0.08, 0.25), '#8a8780', 0.05); for(let i=0;i<10;i++) k.rebar([k.R(3, 5.8), k.R(2.6, 5.8), k.R(3, 5.8), k.R(2.6, 5.8)]);
    for(let i=0;i<3;i++){ const x = 0.6 + i*0.6; k.rr(x, 0.5, 0.45, 1.4, 0.03); k.texFill('metal', '#c8ccc8', null, 0.3); k.stroke(k.INK, 0.008); k.rr(x + 0.05, 0.55, 0.35, 0.15, 0.01); k.fill('#2a4a5a'); }
    k.rr(3.2, 0.6, 2.0, 0.6, 0.03); k.texFill('metal', '#b8bcb8'); k.stroke(k.INK, 0.01); for(let i=0;i<5;i++) fx.bottle(k, 3.4 + i*0.35, 0.9, 0.06, ['#6ab030', '#4a8ab0', '#c84a3a'][i%3]);
    c.beginPath(); c.arc(1.2, 4.4, 0.7, 0, 6.28); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(1.2, 4.4, 0.55, 0, 6.28); k.fill(d.breach ? '#0a0806' : 'rgba(120,200,190,.45)'); if(d.breach){ for(let i=0;i<10;i++){ const a = k.R(0, 6.28); k.fillP([1.2 + Math.cos(a)*0.55, 4.4 + Math.sin(a)*0.55, 1.2 + Math.cos(a + 0.2)*0.55, 4.4 + Math.sin(a + 0.2)*0.55, 1.2 + Math.cos(a + 0.1)*k.R(0.75, 0.95), 4.4 + Math.sin(a + 0.1)*k.R(0.75, 0.95)], 'rgba(198,220,220,.6)'); } k.puddle(2.2, 4.8, 0.6, 0.35); k.radial(1.2, 4.4, 1.3, '#8aff6a', 0.25); for(let i=0;i<4;i++) k.line([1.4 + i*0.3, 4.2, 2.2 + i*0.4, 3.6 + k.R(-0.4, 0.4)], '#3a2a22', 0.04, 0.6); } else { k.radial(1.2, 4.4, 0.6, '#8affd8', 0.35); c.beginPath(); c.ellipse(1.2, 4.4, 0.15, 0.3, 0.4, 0, 6.28); k.fill('rgba(40,30,40,.7)'); }
    xb.cable(k, [1.9, 4.4, 2.6, 4.0, 3.0, 3.2], '#1a1816', 0.03); xb.cable(k, [1.9, 4.6, 2.8, 4.9], '#c83a2a', 0.02); fx.paper(k, 4.0, 1.6, 0.2, 0.3); fx.paper(k, 1.4, 2.4, 0.2, 0.3); bits.stencil(k, 4.4, 2.2, 'СЕКТОР Б', 0.18, '#c8a040', 0.6); }
  const LABRUIN = [{n:'Капсула цела'}, {n:'Прорыв', breach:true}];
  function radSignDraw(g, d){ const k = hk(g), c = k.c;
    k.line([0.52, 0.55, 0.52, 0.95], 'rgba(0,0,0,.4)', 0.06); k.line([0.5, 0.5, 0.5, 0.92], '#5a5e60', 0.05);
    c.save(); c.translate(0.5, 0.4); if(d.bent) c.rotate(0.5); fx.sh(k, -0.32, -0.28, 0.64, 0.56, 0.03, 0.05); if(d.tri){ k.poly([0, -0.32, 0.34, 0.26, -0.34, 0.26]); k.fill('#e8c030'); k.stroke(k.INK, 0.012); k.poly([0, -0.24, 0.26, 0.21, -0.26, 0.21]); k.stroke('#1a1816', 0.025); } else { k.rr(-0.32, -0.28, 0.64, 0.56, 0.03); k.fill('#e8c030'); k.stroke(k.INK, 0.012); }
    const cy0 = d.tri ? 0.04 : 0; c.beginPath(); c.arc(0, cy0, 0.035, 0, 6.28); k.fill('#1a1816'); for(let i=0;i<3;i++){ const a = i*2.094 - 1.57; c.beginPath(); c.moveTo(0, cy0); c.arc(0, cy0, d.tri ? 0.15 : 0.2, a - 0.52, a + 0.52); c.closePath(); k.fill('#1a1816'); c.beginPath(); c.arc(0, cy0, 0.055, 0, 6.28); k.fill('#e8c030'); c.beginPath(); c.arc(0, cy0, 0.035, 0, 6.28); k.fill('#1a1816'); }
    c.save(); k.rr(-0.32, -0.28, 0.64, 0.56, 0.03); c.clip(); for(let i=0;i<7;i++) k.rust(k.R(-0.28, 0.28), k.R(-0.25, 0.25), 0.05, d.shot && i%2===0); k.streak(-0.1, 0.1, 0.2, 0.05, '#5a3a22', 0.4); if(d.shot) for(let i=0;i<5;i++){ const x = k.R(-0.25, 0.25), y = k.R(-0.2, 0.2); c.beginPath(); c.arc(x, y, 0.02, 0, 6.28); k.fill('#0a0806'); c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.stroke('rgba(200,200,190,.5)', 0.008); } c.restore(); c.restore(); }
  const RADSIGN = [{n:'Квадратный'}, {n:'Треугольный', tri:true}, {n:'Прострелен', shot:true}, {n:'Погнут', bent:true, tri:true}];
  function podDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    c.beginPath(); c.arc(cx + 0.08, cy + 0.1, 0.9, 0, 6.28); k.fill('rgba(0,0,0,.45)'); c.beginPath(); c.arc(cx, cy, 0.9, 0, 6.28); k.texFill('metal', '#8a8e90', '#9a9ea0', 0.3); k.stroke(k.INK, 0.014); for(let i=0;i<12;i++){ const a = i/12*6.28; c.beginPath(); c.arc(cx + Math.cos(a)*0.82, cy + Math.sin(a)*0.82, 0.03, 0, 6.28); k.fill('#3a3e40'); }
    c.beginPath(); c.arc(cx, cy, 0.68, 0, 6.28); k.fill('#141a1a'); c.beginPath(); c.arc(cx, cy, 0.62, 0, 6.28); if(d.broken){ k.fill('#0a0806'); for(let i=0;i<12;i++){ const a = k.R(0, 6.28); k.fillP([cx + Math.cos(a)*0.62, cy + Math.sin(a)*0.62, cx + Math.cos(a + 0.25)*0.62, cy + Math.sin(a + 0.25)*0.62, cx + Math.cos(a + 0.1)*k.R(0.35, 0.5), cy + Math.sin(a + 0.1)*k.R(0.35, 0.5)], 'rgba(170,220,210,.5)'); } k.puddle(cx + 0.6, cy + 0.7, 0.5, 0.3); for(let i=0;i<4;i++) k.line([cx, cy, cx + k.R(0.4, 1.1), cy + k.R(0.4, 1.1)], '#4a3a3a', 0.03, 0.6); } else { c.fillStyle = k.lin(cx - 0.6, cy - 0.6, cx + 0.6, cy + 0.6, [[0, d.col[0]], [1, d.col[1]]]); c.fill(); c.save(); c.beginPath(); c.arc(cx, cy, 0.62, 0, 6.28); c.clip(); for(let i=0;i<12;i++){ const x = k.R(0.5, 1.5), y = k.R(0.5, 1.5); c.beginPath(); c.arc(x, y, k.R(0.01, 0.03), 0, 6.28); k.fill('rgba(255,255,255,.6)'); } if(d.creature){ c.beginPath(); c.ellipse(cx, cy + 0.05, 0.22, 0.35, 0.2, 0, 6.28); k.fill('rgba(40,30,30,.75)'); for(let i=0;i<4;i++) k.line([cx, cy, cx + k.R(-0.45, 0.45), cy + k.R(-0.45, 0.45)], 'rgba(40,30,30,.6)', 0.035); c.beginPath(); c.arc(cx - 0.05, cy - 0.15, 0.03, 0, 6.28); k.fill('#ffe060'); } k.line([cx - 0.45, cy - 0.3, cx - 0.1, cy - 0.55], 'rgba(255,255,255,.4)', 0.04); c.restore(); k.radial(cx, cy, 0.9, d.col[0], 0.25); }
    c.beginPath(); c.arc(cx, cy, 0.68, 0, 6.28); k.stroke('#5a5e60', 0.05); [[cx - 0.75, cy + 0.55], [cx + 0.75, cy + 0.55]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill(d.broken ? '#3a2a22' : '#3ae050'); }); xb.cable(k, [cx + 0.85, cy - 0.3, 1.95, cy - 0.6, 1.98, 0.1], '#1a1816', 0.035); xb.cable(k, [cx - 0.85, cy + 0.1, 0.05, cy + 0.5], '#2a3a5a', 0.03); }
  const POD = [{n:'Образец', col:['#4ac8a0', '#1a5a4a'], creature:true}, {n:'Пустая', col:['#6ab0c8', '#1a3a5a']}, {n:'Разбита', broken:true}];
  function artifactDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.5, col = d.col;
    k.organic(cx, cy, 0.3, 0.3); k.fill('rgba(0,0,0,.25)'); k.radial(cx, cy, 0.48, col, 0.45);
    if(d.shape === 'orb'){ const gr = c.createRadialGradient(cx - 0.05, cy - 0.06, 0, cx, cy, 0.15); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, col); gr.addColorStop(1, d.dark); c.beginPath(); c.arc(cx, cy, 0.15, 0, 6.28); c.fillStyle = gr; c.fill(); for(let i=0;i<3;i++){ c.beginPath(); c.ellipse(cx, cy, 0.24, 0.07, i*1.05, 0, 6.28); k.stroke(col, 0.008, 0.7); } }
    else if(d.shape === 'shard'){ for(let i=0;i<3;i++){ c.save(); c.translate(cx, cy); c.rotate(i*2.09 + 0.3); k.fillP([0, -0.04, 0.22, 0, 0, 0.04], col); k.fillP([0, 0, 0.22, 0, 0, 0.04], d.dark); c.restore(); } c.beginPath(); c.arc(cx, cy, 0.05, 0, 6.28); k.fill('#ffffff'); }
    else { k.organic(cx, cy, 0.14, 0.4); k.fill(d.dark); k.organic(cx - 0.02, cy - 0.02, 0.1, 0.4); k.fill(col); for(let i=0;i<6;i++){ c.beginPath(); c.arc(cx + k.R(-0.1, 0.1), cy + k.R(-0.1, 0.1), 0.015, 0, 6.28); k.fill('#ffffff'); } }
    for(let i=0;i<8;i++){ const a = k.R(0, 6.28), r = k.R(0.25, 0.42); c.beginPath(); c.arc(cx + Math.cos(a)*r, cy + Math.sin(a)*r, 0.012, 0, 6.28); k.fill(col); } }
  const ARTIFACT = [{n:'Сфера', shape:'orb', col:'#7ad8ff', dark:'#1a4a8a'}, {n:'Осколок', shape:'shard', col:'#ff8a5a', dark:'#8a2a1a'}, {n:'Сгусток', shape:'blob', col:'#a8ff6a', dark:'#2a6a1a'}, {n:'Тёмная сфера', shape:'orb', col:'#c88aff', dark:'#1a0a2a'}];
  function cocoonDraw(g, d){ const k = hk(g), c = k.c;
    for(let i=0;i<14;i++){ const a = k.R(0, 6.28); k.line([0.5, 1, 0.5 + Math.cos(a)*0.55, 1 + Math.sin(a)*0.95], 'rgba(230,226,215,.35)', 0.008); } for(let r=0.15;r<0.5;r+=0.1){ c.beginPath(); for(let i=0;i<=12;i++){ const a = i/12*6.28; c.lineTo(0.5 + Math.cos(a)*r, 1 + Math.sin(a)*r*1.8); } k.stroke('rgba(230,226,215,.18)', 0.006); }
    c.beginPath(); c.ellipse(0.55, 1.06, 0.26, 0.6, 0.08, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.ellipse(0.5, 1, 0.26, 0.6, 0.08, 0, 6.28); const gr = c.createRadialGradient(0.42, 0.8, 0.02, 0.5, 1, 0.65); gr.addColorStop(0, d.open ? '#a8a090' : '#e8e2d0'); gr.addColorStop(1, d.open ? '#4a443a' : '#9a9280'); c.fillStyle = gr; c.fill(); k.stroke('rgba(40,36,30,.6)', 0.01);
    c.save(); c.beginPath(); c.ellipse(0.5, 1, 0.26, 0.6, 0.08, 0, 6.28); c.clip(); for(let i=0;i<22;i++){ const y = 0.4 + i*0.055; k.line([0.2, y + k.R(-0.03, 0.03), 0.8, y + k.R(-0.05, 0.05)], 'rgba(255,255,250,.3)', 0.01); k.line([0.2, y + 0.02, 0.8, y + 0.03], 'rgba(60,50,40,.18)', 0.006); }
    if(d.open){ k.organic(0.5, 0.9, 0.13, 0.4, 0.35); k.fill('#1a1410'); k.organic(0.5, 0.9, 0.13, 0.4, 0.35); k.stroke('#8a8070', 0.02); k.puddle(0.5, 1.3, 0.12, 0.08); } if(d.body){ c.beginPath(); c.ellipse(0.5, 0.6, 0.11, 0.09, 0, 0, 6.28); k.fill('rgba(120,90,80,.5)'); k.line([0.42, 0.75, 0.4, 1.2], 'rgba(90,60,50,.3)', 0.04); } c.restore();
    if(d.glow) k.radial(0.5, 1, 0.5, '#a8ff6a', 0.3); }
  const COCOON = [{n:'Целый'}, {n:'С жертвой', body:true}, {n:'Вскрытый', open:true}, {n:'Пульсирует', glow:true}];
  function boneFieldDraw(g, d){ const k = hk(g), c = k.c;
    for(let i=0;i<6;i++) k.blot(k.R(0.4, 2.6), k.R(0.4, 2.6), k.R(0.3, 0.6), d.burnt ? '#1a1410' : '#3a3026', 0.3); k.tufts(0.2, 0.2, 2.6, 2.6, d.burnt ? 0 : 12, ['#6a6a40', '#5a5a34']);
    const n = d.dense ? 70 : 40; for(let i=0;i<n;i++){ const x = k.R(0.2, 2.8), y = k.R(0.2, 2.8), a = k.R(0, 3.14), L = k.R(0.1, 0.3), dx = Math.cos(a)*L/2, dy = Math.sin(a)*L/2, col = d.burnt ? (i%2 ? '#3a3430' : '#5a5048') : i%4 ? '#d4cbb2' : '#b8ab88'; k.line([x - dx + 0.01, y - dy + 0.015, x + dx + 0.01, y + dy + 0.015], 'rgba(0,0,0,.4)', 0.03); k.line([x - dx, y - dy, x + dx, y + dy], col, 0.026); c.beginPath(); c.arc(x - dx, y - dy, 0.018, 0, 6.28); k.fill(col); c.beginPath(); c.arc(x + dx, y + dy, 0.018, 0, 6.28); k.fill(col); }
    for(let i=0;i<(d.dense ? 8 : 5);i++) bits.skull(k, k.R(0.3, 2.7), k.R(0.3, 2.7), 0.07, k.R(-1, 1));
    for(let i=0;i<3;i++){ const x = k.R(0.6, 2.4), y = k.R(0.6, 2.4), a = k.R(0, 3.14); for(let j=0;j<6;j++){ const t = (j - 2.5)*0.06; c.beginPath(); c.arc(x + Math.cos(a)*t, y + Math.sin(a)*t, 0.12, a + 0.3, a + 2.8); k.stroke('#cfc6ae', 0.018); } k.line([x - Math.cos(a)*0.2, y - Math.sin(a)*0.2, x + Math.cos(a)*0.2, y + Math.sin(a)*0.2], '#cfc6ae', 0.025); }
    if(d.weapons){ for(let i=0;i<3;i++){ c.save(); c.translate(k.R(0.5, 2.5), k.R(0.5, 2.5)); c.rotate(k.R(0, 3)); k.rr(-0.3, -0.03, 0.6, 0.06, 0.01); k.texFill('metal', '#3a3836', '#5a4a3a', 0.6); k.rr(0.05, 0.02, 0.06, 0.1, 0.01); k.fill('#2a2826'); c.restore(); } bits.casings(k, 0.6, 1.6, 1.0, 0.8, 14); } }
  const BONEF = [{n:'Поле'}, {n:'Густое', dense:true}, {n:'С оружием', weapons:true}, {n:'Обгоревшее', burnt:true}];

  A('anom_gravity', 'Гравитационная воронка', 'anomaly', 3, 3, {t:'аномалия гравитация воронка', g:true, v:AGRAV.length, vn:VN(AGRAV), hd:true}, (g, v)=>anomGravityDraw(g, PV(AGRAV, v)));
  A('anom_electro', 'Электро-аномалия', 'anomaly', 2, 2, {t:'аномалия электричество молния', g:true, v:AELECTRO.length, vn:VN(AELECTRO), hd:true, lit:true}, (g, v)=>anomElectroDraw(g, PV(AELECTRO, v)));
  A('anom_thermal', 'Термо-аномалия', 'anomaly', 2, 2, {t:'аномалия жар огонь', g:true, v:ATHERMAL.length, vn:VN(ATHERMAL), hd:true, lit:true}, (g, v)=>anomThermalDraw(g, PV(ATHERMAL, v)));
  A('toxic_puddle', 'Токсичная лужа', 'anomaly', 2, 2, {t:'токсичная лужа кислота жижа', g:true, v:TOXIC_P.length, vn:VN(TOXIC_P), hd:true}, (g, v)=>toxicPuddleDraw(g, PV(TOXIC_P, v)));
  A('crystal_growth', 'Кристаллические наросты', 'anomaly', 2, 2, {t:'кристаллы наросты аномалия', v:CRYSTAL.length, vn:VN(CRYSTAL), hd:true, lit:true}, (g, v)=>crystalDraw(g, PV(CRYSTAL, v)));
  A('mutant_tree', 'Мутировавшее дерево', 'anomaly', 2, 2, {t:'дерево мутант растение', v:MUTREE.length, vn:VN(MUTREE), hd:true}, (g, v)=>mutantTreeDraw(g, PV(MUTREE, v)));
  A('glow_mushrooms', 'Светящиеся грибы', 'anomaly', 1, 1, {t:'грибы светящиеся подземелье', v:GLOWM.length, vn:VN(GLOWM), hd:true, lit:true}, (g, v)=>glowMushDraw(g, PV(GLOWM, v)));
  A('rift', 'Разлом в земле', 'anomaly', 2, 5, {t:'разлом трещина провал', g:true, v:RIFT.length, vn:VN(RIFT), hd:true}, (g, v)=>riftDraw(g, PV(RIFT, v)));
  A('lab_ruin', 'Руины исследовательского корпуса', 'anomaly', 6, 6, {t:'лаборатория руины институт корпус', v:LABRUIN.length, vn:VN(LABRUIN), hd:true}, (g, v)=>labRuinDraw(g, PV(LABRUIN, v)));
  A('rad_sign', 'Знак радиации', 'anomaly', 1, 1, {t:'радиация знак опасность', v:RADSIGN.length, vn:VN(RADSIGN), hd:true}, (g, v)=>radSignDraw(g, PV(RADSIGN, v)));
  A('containment_pod', 'Капсула содержания', 'anomaly', 2, 2, {t:'капсула контейнер образец', v:POD.length, vn:VN(POD), hd:true}, (g, v)=>podDraw(g, PV(POD, v)));
  A('artifact', 'Артефакт', 'anomaly', 1, 1, {t:'артефакт находка аномалия', v:ARTIFACT.length, vn:VN(ARTIFACT), hd:true, lit:true}, (g, v)=>artifactDraw(g, PV(ARTIFACT, v)));
  A('cocoon', 'Кокон', 'anomaly', 1, 2, {t:'кокон паутина гнездо', v:COCOON.length, vn:VN(COCOON), hd:true}, (g, v)=>cocoonDraw(g, PV(COCOON, v)));
  A('bone_field', 'Поле костей', 'anomaly', 3, 3, {t:'кости останки скелеты', g:true, v:BONEF.length, vn:VN(BONEF), hd:true}, (g, v)=>boneFieldDraw(g, PV(BONEF, v)));

  /* ===================== ПОДЗЕМЕЛЬЯ ===================== */
  /* ---- Подземелья (HD) ---- */
  function grimeRing(k, cx, cy, r){ k.radial(cx, cy, r*1.5, '#14110c', 0.35); for(let i=0;i<4;i++) k.blot(cx + k.R(-r, r), cy + k.R(-r, r), k.R(0.08, 0.2), '#2a2418', 0.3); }
  function sewerGrateDraw(g, d){ const k = hk(g), c = k.c;
    grimeRing(k, 0.5, 0.5, 0.42); k.rr(0.12, 0.12, 0.76, 0.76, 0.03); k.texFill('concrete', '#6a6760'); k.stroke(k.INK, 0.01); k.rr(0.18, 0.18, 0.64, 0.64, 0.02); k.fill('#070605');
    c.save(); k.rr(0.18, 0.18, 0.64, 0.64, 0.02); c.clip(); c.fillStyle = k.lin(0, 0.2, 0, 0.8, [[0, 'rgba(60,70,60,.0)'], [1, 'rgba(60,80,60,.45)']]); c.fillRect(0.18, 0.18, 0.64, 0.64); if(d.round){ c.restore(); c.save(); }
    const bars = d.diag ? 7 : 6; for(let i=0;i<bars;i++){ if(d.broken && (i===2 || i===3)) continue; const x = 0.2 + (i + 0.5)*0.6/bars; if(d.diag){ c.save(); c.translate(0.5, 0.5); c.rotate(0.785); k.line([x - 0.5, -0.45, x - 0.5, 0.45], '#3a3a36', 0.05); c.restore(); } else { k.line([x + 0.012, 0.19, x + 0.012, 0.81], 'rgba(0,0,0,.6)', 0.05); k.line([x, 0.19, x, 0.81], '#4a4a46', 0.045); k.line([x - 0.012, 0.19, x - 0.012, 0.81], 'rgba(200,200,190,.25)', 0.01); } }
    k.line([0.19, 0.5, 0.81, 0.5], '#3e3e3a', 0.04); if(d.broken){ k.line([0.36, 0.2, 0.42, 0.45], '#4a4a46', 0.04); for(let i=0;i<3;i++) k.chunk(k.R(0.3, 0.7), k.R(0.3, 0.7), 0.04, '#6a6760', 0.02); }
    c.restore(); for(let i=0;i<4;i++) k.rust(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.04, false); k.leaves(0.1, 0.1, 0.8, 0.8, d.leaves ? 14 : 3); if(d.leaves) k.trash(0.2, 0.2, 0.6, 0.6, 4); k.streak(0.5, 0.82, 0.15, 0.4, '#2a2418', 0.3); }
  const SGRATE = [{n:'Решётка'}, {n:'Диагональная', diag:true}, {n:'Забита мусором', leaves:true}, {n:'Проломлена', broken:true}];
  function manholeDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.5;
    grimeRing(k, cx, cy, 0.4); c.beginPath(); c.arc(cx, cy, 0.44, 0, 6.28); k.texFill('asphalt', '#3e3b37'); c.beginPath(); c.arc(cx, cy, 0.4, 0, 6.28); k.fill('#2a2826'); k.stroke(k.INK, 0.01);
    const lid = (x, y)=>{ c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.37, 0, 6.28); k.fill('rgba(0,0,0,.5)'); c.beginPath(); c.arc(x, y, 0.37, 0, 6.28); k.texFill('metal', '#55585a', '#3a3a36', 0.5); k.stroke(k.INK, 0.01); c.save(); c.beginPath(); c.arc(x, y, 0.33, 0, 6.28); c.clip(); for(let i=-6;i<=6;i++){ k.line([x - 0.4, y + i*0.06, x + 0.4, y + i*0.06], 'rgba(0,0,0,.35)', 0.018); k.line([x - 0.4, y + i*0.06 - 0.012, x + 0.4, y + i*0.06 - 0.012], 'rgba(220,220,210,.12)', 0.008); } c.restore(); c.beginPath(); c.arc(x, y, 0.33, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.015); c.beginPath(); c.arc(x, y, 0.12, 0, 6.28); k.fill('#46484a'); bits.stencil(k, x, y, d.text || 'ВОДОКАНАЛ', 0.05, '#2a2826', 0.7); [[0.22, 0], [-0.22, 0]].forEach(([dx, dy])=>{ c.beginPath(); c.arc(x + dx, y + dy, 0.025, 0, 6.28); k.fill('#0a0908'); }); for(let i=0;i<5;i++) k.rust(x + k.R(-0.28, 0.28), y + k.R(-0.28, 0.28), 0.04, false); k.radial(x - 0.1, y - 0.12, 0.3, '#ffffff', 0.08); };
    if(d.open){ c.beginPath(); c.arc(cx, cy, 0.34, 0, 6.28); k.fill('#020202'); c.save(); c.beginPath(); c.arc(cx, cy, 0.34, 0, 6.28); c.clip(); for(let i=0;i<5;i++){ k.rr(cx - 0.12, cy - 0.28 + i*0.12, 0.24, 0.025, 0.01); k.fill('#5a4a3a'); } k.radial(cx, cy + 0.2, 0.3, '#000', 0.7); c.restore(); c.save(); c.translate(0.36, 0.3); lid(0, 0); c.restore(); if(d.steam){ for(let i=0;i<5;i++) k.radial(cx + k.R(-0.15, 0.15), cy + k.R(-0.2, 0.1), k.R(0.18, 0.3), '#d8dcd8', 0.2); } }
    else lid(cx, cy); }
  const MANHOLE = [{n:'Закрыт'}, {n:'Связь', text:'ГТС'}, {n:'Открыт', open:true}, {n:'Открыт, пар', open:true, steam:true}];
  function collectorDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    c.beginPath(); c.arc(cx + 0.06, cy + 0.08, 0.95, 0, 6.28); k.fill('rgba(0,0,0,.45)'); c.beginPath(); c.arc(cx, cy, 0.95, 0, 6.28); k.texFill(d.brick ? 'brickwall' : 'concrete', d.brick ? '#7a4a36' : '#6a6760', null, 0.3); k.stroke(k.INK, 0.014);
    if(d.brick){ c.save(); c.beginPath(); c.arc(cx, cy, 0.95, 0, 6.28); c.clip(); for(let i=0;i<28;i++){ const a = i/28*6.28; c.save(); c.translate(cx + Math.cos(a)*0.86, cy + Math.sin(a)*0.86); c.rotate(a); k.rr(-0.06, -0.1, 0.12, 0.2, 0.01); k.fill(i%3 ? '#7a4a36' : '#6a3a2a'); k.stroke('rgba(30,20,15,.6)', 0.008); c.restore(); } c.restore(); }
    else for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([cx + Math.cos(a)*0.78, cy + Math.sin(a)*0.78, cx + Math.cos(a)*0.95, cy + Math.sin(a)*0.95], 'rgba(0,0,0,.35)', 0.012); }
    c.beginPath(); c.arc(cx, cy, 0.76, 0, 6.28); c.fillStyle = k.lin(0, 0.24, 0, 1.76, [[0, '#0a0908'], [0.55, '#14120e'], [1, '#2a2618']]); c.fill(); k.stroke('rgba(255,250,240,.15)', 0.02);
    c.save(); c.beginPath(); c.arc(cx, cy, 0.76, 0, 6.28); c.clip(); const lvl = d.dry ? 1.65 : d.flood ? 0.9 : 1.35; c.fillStyle = k.lin(0, lvl, 0, 1.8, [[0, d.toxic ? 'rgba(110,160,50,.9)' : 'rgba(60,72,58,.9)'], [1, d.toxic ? 'rgba(50,90,20,.95)' : 'rgba(30,36,28,.95)']]); c.fillRect(0, lvl, 2, 1); k.line([0.2, lvl, 1.8, lvl], d.toxic ? 'rgba(200,255,120,.5)' : 'rgba(200,210,190,.35)', 0.015); for(let i=0;i<5;i++) k.line([k.R(0.4, 1.4), lvl + k.R(0.05, 0.25), k.R(0.6, 1.6), lvl + k.R(0.05, 0.25)], 'rgba(255,255,255,.08)', 0.01); if(d.toxic) k.radial(cx, lvl + 0.2, 0.7, '#a8e050', 0.3); for(let i=0;i<5;i++) k.streak(k.R(0.4, 1.6), 0.3, lvl - 0.3, 0.04, '#2a3a20', 0.35); k.moss(0.5, lvl - 0.05, 0.12); k.moss(1.5, lvl - 0.05, 0.1); if(!d.dry) k.trash(0.4, lvl, 1.2, 0.2, 3); c.restore();
    if(d.pipe){ k.line([0.2, 0.5, 1.8, 0.5], '#4a4e50', 0.12); k.line([0.2, 0.48, 1.8, 0.48], 'rgba(255,255,255,.15)', 0.02); k.rust(1.2, 0.5, 0.05, false); } }
  const COLLECTOR = [{n:'Бетонный'}, {n:'Кирпичный', brick:true}, {n:'Затоплен', flood:true}, {n:'Токсичный сток', toxic:true, pipe:true}, {n:'Сухой', dry:true, brick:true}];
  function metroCarDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.15, 0.05, 1.7, 5.9, 0.15, 0.1); k.rr(0.15, 0.05, 1.7, 5.9, 0.18); k.texFill('metal', '#6d7376', d.col, 0.55); k.stroke(k.INK, 0.016);
    c.save(); k.rr(0.15, 0.05, 1.7, 5.9, 0.18); c.clip(); c.fillStyle = k.lin(0.15, 0, 1.85, 0, [[0, 'rgba(0,0,0,.35)'], [0.3, 'rgba(255,255,255,.1)'], [0.7, 'rgba(255,255,255,.05)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 6);
    for(let y=0.6;y<5.6;y+=0.6) k.seam([0.2, y, 1.8, y], 0.012, 0.4); for(let i=0;i<4;i++){ k.rr(0.55, 0.4 + i*1.4, 0.9, 0.5, 0.06); k.texFill('metal', '#55585a', null, 0.3); k.stroke(k.INK, 0.01); for(let j=0;j<4;j++){ c.beginPath(); c.arc(0.7 + j*0.2, 0.55 + i*1.4, 0.05, 0, 6.28); k.fill('#2a2c2e'); } }
    if(d.burnt){ k.radial(1, 3.4, 1.4, '#0a0806', 0.85); for(let i=0;i<20;i++) k.blot(k.R(0.3, 1.7), k.R(2.2, 4.8), k.R(0.08, 0.25), '#1a120c', 0.6); for(let i=0;i<14;i++) k.rust(k.R(0.3, 1.7), k.R(2, 5), 0.07, i%4===0); k.radial(1, 3.4, 0.5, '#e85a20', 0.15); }
    if(d.graffiti){ k.graffiti(0.3, 1.0, 1.4, 0.7, '#e83a8a'); k.graffiti(0.3, 3.6, 1.4, 0.6, '#3ac8e8'); }
    for(let i=0;i<12;i++) k.streak(k.R(0.3, 1.7), k.R(0.2, 5.5), k.R(0.2, 0.6), 0.03, '#3a3026', 0.25); c.restore();
    [0.12, 5.88].forEach(y=>{ k.rr(0.5, y - 0.07, 1.0, 0.14, 0.03); k.fill('#2a2826'); k.stroke(k.INK, 0.008); }); [0.07, 5.93].forEach(y=>[0.45, 1.55].forEach(x=>{ c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill(d.burnt ? '#2a2826' : y < 1 ? '#f0e8c0' : '#c83a2a'); if(!d.burnt) k.radial(x, y, 0.2, y < 1 ? '#f0e8c0' : '#e83a2a', 0.3); }));
    if(d.derail){ for(let i=0;i<20;i++) k.chunk(k.R(0, 2), k.R(4.6, 6), k.R(0.05, 0.14), '#5a5650', 0.03); k.line([0.2, 5.9, 0.4, 5.4, 0.15, 5.1], '#3a3e40', 0.03); } }
  const METRO = [{n:'Вагон', col:'#3a5a7a'}, {n:'Старый зелёный', col:'#4a6a4a'}, {n:'В граффити', col:'#5a5e60', graffiti:true}, {n:'Сгоревший', col:'#3a3634', burnt:true}, {n:'Сошёл с рельсов', col:'#6a4a3a', derail:true}];
  function platformDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0, 0, 1, 6, 0.01); k.texFill(d.marble ? 'tiles' : 'concrete', d.marble ? '#b8b0a0' : '#8a8780', d.marble ? '#c8b8a0' : null, 0.25); c.save(); k.rr(0, 0, 1, 6, 0.01); c.clip(); if(d.marble) for(let i=0;i<12;i++) k.line([k.R(0, 0.7), k.R(0, 6), k.R(0, 0.7), k.R(0, 6)], 'rgba(90,80,70,.25)', 0.008); k.leaves(0, 0, 0.7, 6, d.ruined ? 30 : 6); k.trash(0, 0, 0.7, 6, d.ruined ? 12 : 3); for(let i=0;i<5;i++) k.blot(k.R(0.1, 0.6), k.R(0.3, 5.7), k.R(0.08, 0.2), '#2a2418', 0.3); c.restore();
    k.rr(0.66, 0, 0.12, 6, 0); k.fill('#c8a030'); for(let y=0.05;y<6;y+=0.08) k.rr(0.68, y, 0.08, 0.04, 0.01), k.fill('rgba(0,0,0,.25)');
    k.rr(0.78, 0, 0.22, 6, 0); k.fill('#0a0908'); c.fillStyle = k.lin(0.78, 0, 1, 0, [[0, 'rgba(0,0,0,.6)'], [1, 'rgba(40,36,30,.6)']]); c.fillRect(0.78, 0, 0.22, 6); k.line([0.78, 0, 0.78, 6], 'rgba(255,250,240,.35)', 0.012);
    if(d.ruined){ for(let i=0;i<3;i++){ const y = k.R(0.5, 5.5); k.organic(0.6, y, 0.25, 0.4, 0.18); k.fill('#0a0908'); for(let j=0;j<6;j++) k.chunk(0.9 + k.R(-0.05, 0.08), y + k.R(-0.3, 0.3), k.R(0.04, 0.09), '#8a8780', 0.02); } }
    if(d.bench){ [1.2, 4.2].forEach(y=>{ fx.wood(k, 0.1, y, 0.3, 0.9, '#6a4a2a', 0.03); }); k.rr(0.12, 2.6, 0.3, 0.6, 0.04); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.008); bits.stencil(k, 0.27, 2.9, 'М', 0.2, '#c83a2a', 0.9); } }
  const PLATFORM = [{n:'Бетон'}, {n:'Мрамор, скамьи', marble:true, bench:true}, {n:'Разрушенный', ruined:true}];
  function turnstileDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.02, 0.05, 2.96, 0.9, 0.02); k.texFill('tiles', '#9a968e', '#8a8478', 0.3); c.save(); k.rr(0.02, 0.05, 2.96, 0.9, 0.02); c.clip(); for(let i=0;i<8;i++) k.blot(k.R(0.1, 2.9), k.R(0.1, 0.9), k.R(0.05, 0.15), '#2a2418', 0.3); k.trash(0.1, 0.1, 2.8, 0.8, d.broken || d.welded ? 8 : 2); c.restore(); k.rr(0.02, 0.05, 2.96, 0.9, 0.02); k.stroke('rgba(0,0,0,.4)', 0.01);
    [0.45, 1.35, 2.25].forEach(x=>{ if(d.broken && x===2.25) return; k.rr(x - 0.42, 0.12, 0.84, 0.03, 0.01); k.fill('rgba(170,200,205,.5)'); }); for(let i=0;i<4;i++){ const x = 0.15 + i*0.9; if(d.broken && i===2) continue; fx.sh(k, x - 0.11, 0.12, 0.22, 0.76, 0.04, 0.06); k.rr(x - 0.11, 0.12, 0.22, 0.76, 0.04); k.texFill('metal', '#8a8e90', '#9a9ea0', 0.3); k.stroke(k.INK, 0.01); k.rr(x - 0.08, 0.16, 0.16, 0.2, 0.02); k.fill('#2a2c2e'); k.rr(x - 0.06, 0.18, 0.12, 0.08, 0.01); k.fill(d.off || d.broken ? '#1a1c1e' : '#2a4a5a'); for(let j=0;j<3;j++) k.rust(x + k.R(-0.08, 0.08), k.R(0.2, 0.85), 0.025, false); k.streak(x, 0.88, 0.1, 0.03, '#3a3026', 0.3); }
    for(let i=0;i<4;i++){ const x = 0.15 + i*0.9; if(d.broken && i===2){ c.save(); c.translate(x + 0.1, 0.5); c.rotate(1.2); k.rr(-0.08, -0.35, 0.16, 0.7, 0.03); k.texFill('metal', '#8a8e90'); k.stroke(k.INK, 0.008); c.restore(); continue; } fx.sh(k, x - 0.08, 0.15, 0.16, 0.7, 0.03); k.rr(x - 0.08, 0.15, 0.16, 0.7, 0.03); k.texFill('metal', '#8a8e90', '#9a9ea0', 0.3); k.stroke(k.INK, 0.008); k.line([x - 0.06, 0.18, x - 0.06, 0.82], 'rgba(255,255,255,.4)', 0.01); c.beginPath(); c.arc(x, 0.3, 0.035, 0, 6.28); k.fill(d.off || d.broken ? '#3a2a22' : i%2 ? '#3ae050' : '#e83a2a'); if(!(d.off || d.broken)) k.radial(x, 0.3, 0.12, i%2 ? '#3ae050' : '#e83a2a', 0.35); k.rr(x - 0.05, 0.55, 0.1, 0.12, 0.01); k.fill('#1a1c1e');
      if(i < 3){ const open = d.broken && i===1; c.save(); c.translate(x + 0.08, 0.5); c.rotate(open ? 1.3 : 0); for(let j=0;j<3;j++){ c.rotate(j ? 2.09 : 0); k.line([0, 0, 0.32, 0], '#b8bcbe', 0.025); } c.restore(); } }
    if(d.welded){ k.line([0.1, 0.1, 2.9, 0.9], '#5a4a3a', 0.06); k.line([0.1, 0.9, 2.9, 0.1], '#5a4a3a', 0.06); for(let i=0;i<6;i++) k.rust(k.R(0.3, 2.7), 0.5, 0.05, false); } }
  const TURN = [{n:'Работают'}, {n:'Обесточены', off:true}, {n:'Выломаны', broken:true}, {n:'Заварены', off:true, welded:true}];
  function stairsDownDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05, 0.05, 1.9, 1.9, 0.02); k.texFill('concrete', '#7a7670'); k.stroke(k.INK, 0.012);
    for(let i=0;i<10;i++){ const y = 0.25 + i*0.16, t = i/10; k.rr(0.3, y, 1.4, 0.16, 0); c.fillStyle = `rgb(${Math.round(150 - t*130)},${Math.round(146 - t*128)},${Math.round(138 - t*122)})`; c.fill(); k.line([0.3, y, 1.7, y], `rgba(255,250,240,${0.35*(1 - t)})`, 0.012); if(d.wet && i > 5){ k.rr(0.3, y, 1.4, 0.16, 0); k.fill('rgba(40,60,60,.45)'); } if(d.ruined && k.rnd() < 0.4) k.chunk(k.R(0.4, 1.6), y + 0.08, k.R(0.05, 0.12), '#7a7670', 0.03); }
    if(d.wet){ k.line([0.3, 1.85, 1.7, 1.85], 'rgba(160,200,200,.35)', 0.02); }
    [0.25, 1.75].forEach(x=>{ k.line([x + 0.02, 0.15, x + 0.02, 1.9], 'rgba(0,0,0,.4)', 0.05); k.line([x, 0.15, x, 1.9], '#6d7376', 0.04); k.line([x - 0.01, 0.15, x - 0.01, 1.4], 'rgba(220,230,230,.4)', 0.008); });
    c.fillStyle = k.lin(0, 1.1, 0, 1.9, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.75)']]); c.fillRect(0.3, 1.1, 1.4, 0.8);
    if(d.sign){ k.rr(0.75, 0.08, 0.5, 0.14, 0.02); k.fill('#c83a2a'); bits.stencil(k, 1, 0.15, 'М', 0.12, '#f0f0e8', 1); }
    if(d.ruined){ k.trash(0.3, 0.3, 1.4, 1.5, 8); for(let i=0;i<5;i++) k.rebar([k.R(0.3, 1.7), k.R(0.3, 1.8), k.R(0.3, 1.7), k.R(0.3, 1.8)]); }
    if(d.grate){ for(let x=0.35;x<1.7;x+=0.12) k.line([x, 0.22, x, 1.88], '#3a3a36', 0.025); k.line([0.3, 0.6, 1.7, 0.6], '#3a3a36', 0.04); k.line([0.3, 1.4, 1.7, 1.4], '#3a3a36', 0.04); xb.links(k, 0.9, 1.0, 6, 0.2); } }
  const STAIRS_D = [{n:'Спуск в метро', sign:true}, {n:'Подтоплен', wet:true}, {n:'Разрушен', ruined:true}, {n:'Закрыт решёткой', grate:true}];
  function elPanelDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.12, 0.12, 0.76, 0.76, 0.03); k.rr(0.12, 0.12, 0.76, 0.76, 0.03); k.texFill('metal', '#6d7376', d.col || '#5a6a5a', 0.5); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.12, 0.12, 0.76, 0.76, 0.03), 0.02);
    if(d.open){ k.rr(0.17, 0.17, 0.66, 0.66, 0.02); k.fill('#141210'); for(let r=0;r<3;r++) for(let i=0;i<6;i++){ k.rr(0.2 + i*0.1, 0.22 + r*0.2, 0.07, 0.13, 0.01); k.fill(i%3 ? '#d8d4c8' : '#2a2a2a'); k.rr(0.215 + i*0.1, 0.26 + r*0.2, 0.04, 0.04, 0); k.fill(k.rnd() < 0.5 ? '#1a1a1a' : '#c83a2a'); } xb.cable(k, [0.3, 0.83, 0.25, 0.95], '#1a1816', 0.02); xb.cable(k, [0.5, 0.83, 0.55, 0.98], '#c83a2a', 0.015); if(d.sparks){ k.radial(0.55, 0.5, 0.35, '#a8d8ff', 0.45); for(let i=0;i<6;i++){ const a = k.R(0, 6.28); k.line([0.55, 0.5, 0.55 + Math.cos(a)*0.2, 0.5 + Math.sin(a)*0.2], '#e8f8ff', 0.008); } k.blot(0.55, 0.45, 0.12, '#0a0806', 0.6); } }
    else { k.rr(0.22, 0.2, 0.56, 0.6, 0.02); k.stroke('rgba(0,0,0,.35)', 0.012); k.rr(0.7, 0.45, 0.04, 0.12, 0.01); k.fill('#2a2826'); xb.plate(k, 0.5, 0.35, 0.3, 0.2, '⚡', '#e8c030', 0); }
    for(let i=0;i<5;i++) k.rust(k.R(0.15, 0.85), k.R(0.15, 0.85), 0.04, false); k.streak(0.3, 0.88, 0.1, 0.04, '#3a3026', 0.3); }
  const EPANEL = [{n:'Закрыт'}, {n:'Серый', col:'#7a7a76'}, {n:'Вскрыт', open:true}, {n:'Искрит', open:true, sparks:true}];
  function nicheDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05, 0.05, 0.9, 1.9, 0.08); k.texFill(d.brick ? 'brickwall' : 'rock', d.brick ? '#6a4a36' : '#7a7266', null, 0.3); k.stroke(k.INK, 0.012);
    k.rr(0.17, 0.17, 0.66, 1.66, 0.25); c.fillStyle = k.lin(0, 0.17, 0, 1.83, [[0, '#1a1612'], [1, '#2a241c']]); c.fill(); k.stroke('rgba(0,0,0,.6)', 0.02);
    c.save(); k.rr(0.17, 0.17, 0.66, 1.66, 0.25); c.clip();
    if(d.shrouded){ bits.fabric(k, [0.25, 0.3, 0.75, 0.3, 0.75, 1.7, 0.25, 1.7], '#8a8070', 4, 1); bits.skull(k, 0.5, 0.35, 0.1, 0); }
    else if(d.empty){ for(let i=0;i<8;i++) k.chunk(k.R(0.25, 0.75), k.R(0.3, 1.7), k.R(0.02, 0.05), '#c8c0a8', 0.01); k.leaves(0.2, 0.2, 0.6, 1.6, 6); }
    else { bits.skull(k, 0.5, 0.35, 0.11, 0); for(let i=0;i<5;i++){ const y = 0.6 + i*0.2; k.line([0.32, y, 0.68, y + k.R(-0.04, 0.04)], '#c8c0a8', 0.035); k.line([0.32, y - 0.015, 0.68, y - 0.015], 'rgba(255,255,255,.2)', 0.008); } k.line([0.36, 1.55, 0.42, 1.8], '#c8c0a8', 0.04); k.line([0.64, 1.55, 0.58, 1.8], '#c8c0a8', 0.04); }
    if(d.candles){ fx.candle(k, 0.3, 1.66, 0.06, true); fx.candle(k, 0.7, 1.68, 0.05, true); fx.candle(k, 0.5, 1.74, 0.045, true); }
    k.moss(0.3, 1.7, 0.12); for(let i=0;i<10;i++) k.line([k.R(0.2, 0.8), k.R(0.2, 1.8), k.R(0.2, 0.8), k.R(0.2, 1.8)], 'rgba(220,220,220,.07)', 0.004); c.restore(); }
  const NICHE = [{n:'Скелет'}, {n:'В саване', shrouded:true}, {n:'Со свечами', candles:true}, {n:'Пустая, кирпич', empty:true, brick:true}];
  function bonePileDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(0.5, 0.55, 0.42, 0.3, 0.36); k.fill('rgba(0,0,0,.3)'); k.organic(0.5, 0.5, 0.4, 0.3, 0.34); k.texFill('dirt', '#5a4a36', null, 0.3); k.fill('rgba(0,0,0,.25)');
    const n = d.big ? 26 : 16; for(let i=0;i<n;i++){ const x = 0.5 + k.R(-0.32, 0.32), y = 0.5 + k.R(-0.28, 0.28), a = k.R(0, 3.14), L = k.R(0.12, 0.28); const dx = Math.cos(a)*L/2, dy = Math.sin(a)*L/2, col = d.burnt ? (i%3 ? '#4a4038' : '#2a2420') : i%4 ? '#cfc6ae' : '#b8ab88'; k.line([x - dx + 0.01, y - dy + 0.015, x + dx + 0.01, y + dy + 0.015], 'rgba(0,0,0,.4)', 0.035); k.line([x - dx, y - dy, x + dx, y + dy], col, 0.03); [[-1], [1]].forEach(([s])=>{ c.beginPath(); c.arc(x + s*dx, y + s*dy, 0.022, 0, 6.28); k.fill(col); }); }
    for(let i=0;i<(d.big ? 4 : 2);i++) bits.skull(k, 0.5 + k.R(-0.25, 0.25), 0.5 + k.R(-0.22, 0.22), 0.08, k.R(-1, 1));
    if(d.burnt){ for(let i=0;i<5;i++) k.blot(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.1, '#0a0806', 0.5); bits.embers(k, 0.5, 0.5, 0.25); }
    if(d.rats) for(let i=0;i<3;i++){ const x = k.R(0.2, 0.8), y = k.R(0.2, 0.8); c.beginPath(); c.ellipse(x, y, 0.05, 0.025, k.R(0, 3), 0, 6.28); k.fill('#3a3430'); k.line([x, y, x + 0.08, y + 0.03], '#5a4a44', 0.006); } }
  const BONES = [{n:'Груда'}, {n:'Большая', big:true}, {n:'Обгоревшие', burnt:true}, {n:'С крысами', rats:true}];
  function columnDraw(g, d){ const k = hk(g), c = k.c, cx = 0.5, cy = 0.5;
    if(d.round){ c.beginPath(); c.arc(cx + 0.05, cy + 0.07, 0.36, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(cx, cy, 0.36, 0, 6.28); k.texFill(d.marble ? 'tiles' : 'concrete', d.marble ? '#c8c0b0' : '#8a8780', null, 0.25); c.save(); c.beginPath(); c.arc(cx, cy, 0.36, 0, 6.28); c.clip(); const gr = c.createRadialGradient(cx - 0.12, cy - 0.12, 0.02, cx, cy, 0.4); gr.addColorStop(0, 'rgba(255,250,240,.35)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); c.fillStyle = gr; c.fillRect(0, 0, 1, 1); if(d.marble) for(let i=0;i<4;i++) k.line([k.R(0.2, 0.8), k.R(0.2, 0.8), k.R(0.2, 0.8), k.R(0.2, 0.8)], 'rgba(90,80,70,.3)', 0.008); c.restore(); c.beginPath(); c.arc(cx, cy, 0.36, 0, 6.28); k.stroke(k.INK, 0.012); c.beginPath(); c.arc(cx, cy, 0.42, 0, 6.28); k.stroke('rgba(0,0,0,.3)', 0.03); }
    else { fx.sh(k, 0.15, 0.15, 0.7, 0.7, 0.02); k.rr(0.15, 0.15, 0.7, 0.7, 0.02); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.15, 0.15, 0.7, 0.7, 0.02), 0.03); c.save(); k.rr(0.15, 0.15, 0.7, 0.7, 0.02); c.clip(); k.concreteDetail(0.15, 0.15, 0.7, 0.7, 0.25); if(d.stripes) for(let i=-3;i<6;i++) k.line([0.15 + i*0.15, 0.85, 0.15 + i*0.15 + 0.3, 0.55], '#c8a030', 0.05); c.restore(); }
    if(d.cracked){ k.line([0.3, 0.2, 0.45, 0.45, 0.4, 0.7, 0.55, 0.85], 'rgba(15,12,10,.7)', 0.015); for(let i=0;i<6;i++) k.chunk(k.R(0.05, 0.95), k.R(0.05, 0.95), k.R(0.03, 0.07), '#8a8780', 0.02); k.rebar([0.62, 0.22, 0.75, 0.12]); k.rebar([0.7, 0.3, 0.86, 0.26]); }
    k.moss(0.2, 0.8, 0.08); for(let i=0;i<3;i++) k.streak(k.R(0.25, 0.75), 0.4, 0.4, 0.04, '#2a2418', 0.25); }
  const COLUMN = [{n:'Квадратная'}, {n:'Круглая', round:true}, {n:'Мраморная', round:true, marble:true}, {n:'С разметкой', stripes:true}, {n:'Треснувшая', cracked:true}];
  function minePropsDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0, 0.1, 2, 0.8, 0); k.texFill('rock', '#5a5248'); k.fill('rgba(0,0,0,.3)'); for(let i=0;i<8;i++) k.chunk(k.R(0.1, 1.9), k.R(0.2, 0.8), k.R(0.04, 0.1), '#6a6258', 0.03);
    if(d.metal){ [0.15, 1.85].forEach(x=>{ k.rr(x - 0.07, 0.05, 0.14, 0.9, 0.01); k.texFill('metal', '#55585a', '#5a4a3a', 0.6); k.stroke(k.INK, 0.008); for(let i=0;i<4;i++) k.rust(x, k.R(0.1, 0.9), 0.04, false); }); k.rr(0.05, 0.42, 1.9, 0.16, 0.02); k.texFill('metal', '#55585a', '#5a4a3a', 0.6); k.stroke(k.INK, 0.008); for(let x=0.3;x<1.8;x+=0.3){ c.beginPath(); c.arc(x, 0.5, 0.025, 0, 6.28); k.fill('#2a2826'); } }
    else { const broken = d.broken; [0.18, 1.82].forEach((x, i)=>{ if(broken && i===1){ k.plank(1.6, 0.6, 0.85, 0.16, 0.5, '#6a4a2a', true); return; } fx.wood(k, x - 0.09, 0.05, 0.18, 0.9, '#6a4a2a', 0.05); }); if(broken){ k.plank(0.3, 0.5, 1.2, 0.18, 0.25, '#5a3e22', true); for(let i=0;i<10;i++) k.chunk(k.R(1.0, 1.9), k.R(0.2, 0.8), k.R(0.05, 0.12), '#6a6258', 0.03); } else fx.wood(k, 0.05, 0.4, 1.9, 0.2, '#5a3e22', 0.03); }
    if(d.lamp){ xb.cable(k, [0.0, 0.3, 0.6, 0.38, 1.4, 0.38, 2.0, 0.3], '#1a1816', 0.015); xb.lantern(k, 1.0, 0.38); } }
  const MINE_P = [{n:'Деревянная'}, {n:'Металлическая', metal:true}, {n:'С лампой', lamp:true}, {n:'Обвал', broken:true}];
  function hatchDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.15, 0.15, 1.7, 1.7, 0.04); k.texFill('concrete', '#7a7670'); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.15, 0.15, 1.7, 1.7, 0.04), 0.03);
    const lid = ()=>{ k.rr(0.3, 0.3, 1.4, 1.4, 0.03); k.texFill('metal', '#6d7376', d.col || '#4a5a4a', 0.55); k.stroke(k.INK, 0.012); c.save(); k.rr(0.3, 0.3, 1.4, 1.4, 0.03); c.clip(); for(let i=0;i<14;i++) for(let j=0;j<14;j++) if((i + j)%2===0) k.line([0.35 + i*0.1, 0.35 + j*0.1, 0.4 + i*0.1, 0.4 + j*0.1], 'rgba(255,255,255,.12)', 0.015); c.restore(); [[0.4, 0.4], [1.6, 0.4], [0.4, 1.6], [1.6, 1.6]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#2a2826'); }); k.rr(0.8, 0.95, 0.4, 0.1, 0.04); k.stroke('#2a2826', 0.03); for(let i=0;i<6;i++) k.rust(k.R(0.4, 1.6), k.R(0.4, 1.6), 0.05, false); xb.plate(k, 1.0, 0.55, 0.5, 0.15, 'ТЕХ. ЭТАЖ', '#e8c030', 0); };
    if(d.open){ k.rr(0.3, 0.3, 1.4, 1.4, 0.03); k.fill('#030302'); c.save(); k.rr(0.3, 0.3, 1.4, 1.4, 0.03); c.clip(); for(let i=0;i<8;i++){ k.rr(0.85, 0.4 + i*0.16, 0.3, 0.03, 0.01); k.fill('#5a5e60'); } k.line([0.85, 0.35, 0.85, 1.65], '#4a4e50', 0.03); k.line([1.15, 0.35, 1.15, 1.65], '#4a4e50', 0.03); c.fillStyle = k.lin(0, 0.3, 0, 1.7, [[0, 'rgba(0,0,0,.1)'], [1, 'rgba(0,0,0,.85)']]); c.fillRect(0.3, 0.3, 1.4, 1.4); c.restore(); if(d.light) k.radial(1, 1.2, 0.6, '#e8a040', 0.3); c.save(); c.translate(0, -0.08); c.transform(1, 0, 0, 0.18, 0, 0.2); lid(); c.restore(); }
    else lid(); k.streak(1.85, 0.6, 0.6, 0.05, '#3a3026', 0.3); }
  const HATCH = [{n:'Закрыт'}, {n:'Жёлто-серый', col:'#8a7a3a'}, {n:'Открыт', open:true}, {n:'Открыт, свет снизу', open:true, light:true}];
  function pumpStDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.05, 0.05, 2.9, 1.9, 0.03); k.texFill('concrete', '#7a7670'); k.stroke(k.INK, 0.012); c.save(); k.rr(0.05, 0.05, 2.9, 1.9, 0.03); c.clip(); k.concreteDetail(0.05, 0.05, 2.9, 1.9, 0.5); if(d.flood){ k.puddle(1.5, 1.1, 1.3, 0.8); } k.leaves(0, 0, 3, 2, 8); c.restore();
    [[0.75, 0.8], [2.0, 0.8]].forEach(([x, y], i)=>{ const dead = d.dead && i===1; c.beginPath(); c.arc(x + 0.05, y + 0.07, 0.4, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.arc(x, y, 0.4, 0, 6.28); k.texFill('metal', '#6d7376', dead ? '#6a4a3a' : d.col || '#3a5a7a', 0.6); k.stroke(k.INK, 0.012); const gr = c.createRadialGradient(x - 0.15, y - 0.15, 0.02, x, y, 0.42); gr.addColorStop(0, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, 0.4, 0, 6.28); c.fillStyle = gr; c.fill(); for(let j=0;j<8;j++){ const a = j/8*6.28; c.beginPath(); c.arc(x + Math.cos(a)*0.32, y + Math.sin(a)*0.32, 0.025, 0, 6.28); k.fill('#2a2826'); } c.beginPath(); c.arc(x, y, 0.14, 0, 6.28); k.fill('#46484a'); k.stroke(k.INK, 0.008); if(dead) for(let j=0;j<8;j++) k.rust(x + k.R(-0.3, 0.3), y + k.R(-0.3, 0.3), 0.06, j%3===0); else k.rr(x - 0.25, y + 0.42, 0.5, 0.2, 0.02), k.texFill('metal', '#55585a'), k.stroke(k.INK, 0.008); });
    k.line([0.05, 1.55, 2.95, 1.55], 'rgba(0,0,0,.4)', 0.2); k.line([0.05, 1.5, 2.95, 1.5], '#5a5e60', 0.18); k.line([0.05, 1.45, 2.95, 1.45], 'rgba(255,255,255,.2)', 0.03); [0.75, 2.0].forEach(x=>{ k.line([x, 1.2, x, 1.45], '#5a5e60', 0.12); }); for(let x=0.3;x<2.9;x+=0.6) k.rr(x, 1.38, 0.05, 0.24, 0.01), k.fill('#3a3e40');
    k.rr(2.5, 0.15, 0.4, 0.5, 0.02); k.texFill('metal', '#6d7376', '#5a6a5a', 0.5); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(2.6, 0.3, 0.03, 0, 6.28); k.fill(d.dead ? '#3a2a22' : '#3ae050'); if(!d.dead) k.radial(2.6, 0.3, 0.12, '#3ae050', 0.35); xb.cable(k, [2.7, 0.65, 2.6, 0.9, 2.2, 0.85], '#1a1816', 0.015);
    if(d.dead) for(let i=0;i<6;i++) k.streak(k.R(0.3, 2.5), 1.6, 0.3, 0.05, '#5a3a22', 0.4); }
  const PUMP_ST = [{n:'Работает'}, {n:'Красная', col:'#7a3a2a'}, {n:'Подтоплена', flood:true}, {n:'Мёртвая', dead:true}];

  A('sewer_grate', 'Решётка стока', 'under', 1, 1, {t:'решётка канализация сток', g:true, v:SGRATE.length, vn:VN(SGRATE), hd:true}, (g, v)=>sewerGrateDraw(g, PV(SGRATE, v)));
  A('manhole', 'Люк', 'under', 1, 1, {t:'люк канализация вход', g:true, v:MANHOLE.length, vn:VN(MANHOLE), hd:true}, (g, v)=>manholeDraw(g, PV(MANHOLE, v)));
  A('collector', 'Коллектор (сечение)', 'under', 2, 2, {t:'коллектор труба канализация тоннель', v:COLLECTOR.length, vn:VN(COLLECTOR), hd:true}, (g, v)=>collectorDraw(g, PV(COLLECTOR, v)));
  A('metro_car', 'Вагон метро', 'under', 2, 6, {t:'вагон метро поезд', v:METRO.length, vn:VN(METRO), hd:true}, (g, v)=>metroCarDraw(g, PV(METRO, v)));
  A('platform_edge', 'Край платформы', 'under', 1, 6, {t:'платформа метро станция', v:PLATFORM.length, vn:VN(PLATFORM), hd:true}, (g, v)=>platformDraw(g, PV(PLATFORM, v)));
  A('turnstiles', 'Турникеты', 'under', 3, 1, {t:'турникет метро вход', v:TURN.length, vn:VN(TURN), hd:true}, (g, v)=>turnstileDraw(g, PV(TURN, v)));
  A('stairs_down', 'Лестница вниз', 'under', 2, 2, {t:'лестница спуск вниз подвал', v:STAIRS_D.length, vn:VN(STAIRS_D), hd:true}, (g, v)=>stairsDownDraw(g, PV(STAIRS_D, v)));
  A('electric_panel', 'Электрощит', 'under', 1, 1, {t:'щит электрощиток распределительный', v:EPANEL.length, vn:VN(EPANEL), hd:true}, (g, v)=>elPanelDraw(g, PV(EPANEL, v)));
  A('catacomb_niche', 'Ниша с костями', 'under', 1, 2, {t:'катакомбы ниша кости склеп', v:NICHE.length, vn:VN(NICHE), hd:true}, (g, v)=>nicheDraw(g, PV(NICHE, v)));
  A('bone_pile', 'Груда костей', 'under', 1, 1, {t:'кости череп останки', v:BONES.length, vn:VN(BONES), hd:true}, (g, v)=>bonePileDraw(g, PV(BONES, v)));
  A('column', 'Колонна', 'under', 1, 1, {t:'колонна опора столб', v:COLUMN.length, vn:VN(COLUMN), hd:true}, (g, v)=>columnDraw(g, PV(COLUMN, v)));
  A('mine_props', 'Шахтная крепь', 'under', 2, 1, {t:'крепь шахта опора тоннель', v:MINE_P.length, vn:VN(MINE_P), hd:true}, (g, v)=>minePropsDraw(g, PV(MINE_P, v)));
  A('maintenance_hatch', 'Технический люк', 'under', 2, 2, {t:'люк технический этаж вентиляция', g:true, v:HATCH.length, vn:VN(HATCH), hd:true}, (g, v)=>hatchDraw(g, PV(HATCH, v)));
  A('pump_station', 'Насосная станция', 'under', 3, 2, {t:'насос станция вода дренаж', v:PUMP_ST.length, vn:VN(PUMP_ST), hd:true}, (g, v)=>pumpStDraw(g, PV(PUMP_ST, v)));

  /* ===================== ПРИРОДА ===================== */
  /* ---- Природа (HD) ---- */
  function rockBigDraw(g, d){ const k = hk(g), c = k.c;
    if(d.split){ hdRock(k, 0.7, 0.9, 0.62, d.col, {lichen:true}); hdRock(k, 1.35, 1.15, 0.58, d.col, {lichen:true}); k.line([1.0, 0.3, 1.05, 1.0, 0.95, 1.7], '#0a0806', 0.06); }
    else if(d.stack){ hdRock(k, 1.0, 1.05, 0.88, d.col, {flat:true}); hdRock(k, 0.85, 0.85, 0.5, d.col, {lichen:true}); hdRock(k, 1.45, 1.4, 0.3, d.col); }
    else hdRock(k, 1, 1, 0.9, d.col, {lichen: !d.dry});
    for(let i=0;i<(d.dry ? 10 : 6);i++) hdRock(k, 1 + Math.cos(i*1.7)*k.R(0.85, 0.98), 1 + Math.sin(i*1.7)*k.R(0.85, 0.98), k.R(0.05, 0.12), d.col, {moss:false});
    if(!d.dry) k.tufts(0.05, 0.05, 1.9, 1.9, 8); }
  const ROCKBIG = [{n:'Скала', col:'#7a7468'}, {n:'Расколотая', col:'#6a6458', split:true}, {n:'Плитняк', col:'#8a8070', stack:true}, {n:'Рыжий песчаник', col:'#9a6a48', dry:true}, {n:'Тёмный базальт', col:'#46423e'}];
  function boulderDraw(g, d){ const k = hk(g), c = k.c; hdRock(k, 0.5, 0.5, 0.4, d.col, {lichen:d.lichen, moss:!d.dry, ry:d.ry}); if(d.pair) hdRock(k, 0.78, 0.75, 0.16, d.col); if(!d.dry) k.tufts(0, 0.6, 1, 0.4, 4); }
  const BOULDER = [{n:'Серый', col:'#7a7468'}, {n:'Мшистый', col:'#6a6a5a', lichen:true}, {n:'Плоский', col:'#8a8070', ry:0.65, pair:true}, {n:'Песчаник', col:'#9a6a48', dry:true}, {n:'Базальт', col:'#46423e'}];
  function rocksScatterDraw(g, d){ const k = hk(g); const n = d.dense ? 26 : 14; for(let i=0;i<n;i++){ const x = k.R(0.2, 1.8), y = k.R(0.2, 1.8); hdRock(k, x, y, k.R(0.05, d.dense ? 0.16 : 0.22), d.col, {moss:false}); } for(let i=0;i<30;i++) k.chunk(k.R(0.1, 1.9), k.R(0.1, 1.9), k.R(0.015, 0.04), d.col, 0.01); if(d.grass) k.tufts(0, 0, 2, 2, 12); }
  const ROCKS = [{n:'Россыпь', col:'#7a7468', grass:true}, {n:'Щебень', col:'#8a8478', dense:true}, {n:'Красные камни', col:'#9a6a48'}, {n:'Тёмная галька', col:'#4a4640', dense:true, grass:true}];
  function duneDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    const crest = []; for(let i=0;i<=16;i++){ const x = 0.1 + i*3.8/16; crest.push(x, 1.5 + Math.sin(i/16*3.14*(d.double ? 2 : 1))*(-0.8) + Math.sin(i*0.9)*0.08); }
    k.orgK(2, 1.5, 1.9, 0.12, 1.4); c.fillStyle = k.lin(0, 0, 0, 3, [[0, col[0]], [1, col[1]]]); c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1; c.save(); k.orgK(2, 1.5, 1.9, 0.12, 1.4); c.clip();
    k.poly(crest.concat([3.9, 2.9, 0.1, 2.9])); c.fillStyle = k.lin(0, 1, 0, 2.9, [[0, 'rgba(40,20,0,.5)'], [0.4, 'rgba(40,20,0,.22)'], [1, 'rgba(0,0,0,0)']]); c.fill();
    k.poly(crest.concat([3.9, 0.1, 0.1, 0.1])); c.fillStyle = k.lin(0, 0.1, 0, 1.5, [[0, 'rgba(255,245,220,0)'], [1, 'rgba(255,248,225,.45)']]); c.fill();
    k.line(crest, 'rgba(255,248,230,.55)', 0.03); k.line(crest.map((v, i)=>i%2 ? v + 0.05 : v), 'rgba(60,40,20,.35)', 0.03);
    for(let j=0;j<10;j++){ const y0 = 0.4 + j*0.25, pts = []; for(let i=0;i<=20;i++) pts.push(0.2 + i*0.18, y0 + Math.sin(i*0.8 + j)*0.04); k.line(pts, 'rgba(90,60,30,.12)', 0.012); }
    c.restore(); k.orgK(2, 1.5, 1.9, 0.12, 1.4); k.stroke('rgba(80,60,30,.25)', 0.03); if(d.bones){ for(let i=0;i<6;i++) k.line([k.R(1, 3), k.R(1.8, 2.6), k.R(1, 3), k.R(1.8, 2.6)], '#e0d8c0', 0.03, 0.8); bits.skull(k, 2.6, 2.2, 0.08, 0.6); } if(d.grass) k.tufts(0.3, 2.2, 3.4, 0.6, 10, ['#8a8a50', '#6a6a3a']); }
  const DUNE = [{n:'Бархан', col:['#d8b880', '#a8885a']}, {n:'Двойной гребень', col:['#d0b078', '#9a7a4a'], double:true}, {n:'Пепельная', col:['#a8a094', '#6a645a']}, {n:'С костями', col:['#d8b880', '#a8885a'], bones:true}, {n:'Поросший', col:['#c8b080', '#8a7a5a'], grass:true}];
  function ravineDraw(g, d){ const k = hk(g), c = k.c; const L = [], R = []; for(let i=0;i<=14;i++){ const y = 0.05 + i*5.9/14, x = 1 + Math.sin(i*0.7)*0.25, w = d.wide ? 0.75 : 0.55; L.push(x - w*k.R(0.85, 1.1), y); R.push(x + w*k.R(0.85, 1.1), y); }
    const P = L.concat(R.reduce((a, _, i, s)=>i%2 ? a : [s[i], s[i + 1]].concat(a), [])); const scale = (s)=>P.map((v, i)=>i%2 ? v : (v - 1)*s + 1);
    k.poly(scale(1.25)); k.texFill('dirt', '#6a5a44'); k.fill('rgba(0,0,0,.15)'); k.poly(P); c.fillStyle = k.lin(0, 0, 2, 0, [[0, '#3a3024'], [0.35, '#1a1610'], [0.65, '#1a1610'], [1, '#2a2218']]); c.fill();
    c.save(); k.poly(P); c.clip(); for(let i=0;i<20;i++){ const y = k.R(0.2, 5.8); k.line([0.2, y, 1.8, y + k.R(-0.1, 0.1)], 'rgba(90,70,50,.18)', 0.03); } if(d.stream){ const S = []; for(let i=0;i<=14;i++) S.push(1 + Math.sin(i*0.7)*0.25 + k.R(-0.04, 0.04), 0.05 + i*5.9/14); k.line(S, '#2a3a3a', 0.2); k.line(S, 'rgba(160,200,200,.35)', 0.05); } for(let i=0;i<14;i++) hdRock(k, 1 + k.R(-0.4, 0.4), k.R(0.2, 5.8), k.R(0.05, 0.14), '#6a6458', {moss:false}); if(d.bush) for(let i=0;i<5;i++) houseBits.bush(k, 1 + k.R(-0.4, 0.4), k.R(0.4, 5.6), 0.18); if(d.trash) k.trash(0.4, 0.3, 1.2, 5.4, 20); c.restore();
    k.line(L, 'rgba(255,240,220,.25)', 0.03); k.line(R, 'rgba(0,0,0,.4)', 0.03); for(let i=0;i<10;i++){ const j = Math.floor(k.rnd()*15)*2, s = k.rnd() < 0.5 ? L : R; k.line([s[j], s[j + 1], s[j] + (s===L ? -1 : 1)*k.R(0.1, 0.3), s[j + 1] + k.R(-0.2, 0.2)], 'rgba(10,8,6,.5)', 0.02); } k.tufts(0, 0, 2, 6, 20); }
  const RAVINE = [{n:'Сухой'}, {n:'С ручьём', stream:true}, {n:'Заросший', bush:true, wide:true}, {n:'Свалка', trash:true}];
  function deadTreeDraw(g, d){ const k = hk(g), c = k.c;
    for(let i=0;i<6;i++){ const a = i/6*6.28 + k.R(-0.3, 0.3); k.line([1, 1, 1 + Math.cos(a)*0.35, 1 + Math.sin(a)*0.35, 1 + Math.cos(a + 0.3)*0.55, 1 + Math.sin(a + 0.3)*0.55], '#3a2e24', 0.05); }
    if(d.fallen){ c.save(); c.translate(1, 1); c.rotate(0.5); k.rr(-0.9, -0.12, 1.7, 0.24, 0.1); k.texFill('wood', '#5a4a3a', '#6a5a4a', 0.5); k.stroke(k.INK, 0.01); for(let i=0;i<6;i++) k.line([-0.8 + i*0.28, -0.1, -0.7 + i*0.28, 0.1], 'rgba(0,0,0,.3)', 0.012); c.beginPath(); c.ellipse(-0.9, 0, 0.06, 0.12, 0, 0, 6.28); k.fill('#8a7058'); for(let r=0.03;r<0.12;r+=0.03){ c.beginPath(); c.ellipse(-0.9, 0, r*0.5, r, 0, 0, 6.28); k.stroke('rgba(60,40,20,.5)', 0.006); } for(let i=0;i<4;i++) hdBranches(k, 0.8 - i*0.35, 0, (i%2 ? 1 : -1)*k.R(0.6, 1.2), 0.3, 0.05, 2, '#4a3e32'); c.restore(); c.beginPath(); c.arc(0.25, 0.6, 0.13, 0, 6.28); k.fill('#5a4a3a'); return; }
    for(let i=0;i<(d.burnt ? 4 : 6);i++) hdBranches(k, 1, 1, i/(d.burnt ? 4 : 6)*6.28 + k.R(-0.3, 0.3), 0.42, 0.1, d.burnt ? 2 : 4, d.burnt ? '#1a1612' : '#4a3e32');
    c.beginPath(); c.arc(1, 1, 0.17, 0, 6.28); k.fill(d.burnt ? '#14100c' : '#4a3e32'); k.stroke(k.INK, 0.01); for(let r=0.04;r<0.16;r+=0.04){ c.beginPath(); c.arc(1, 1, r, 0, 6.28); k.stroke('rgba(0,0,0,.25)', 0.006); }
    if(d.burnt){ bits.embers(k, 1, 1, 0.2); for(let i=0;i<8;i++) k.blot(1 + k.R(-0.8, 0.8), 1 + k.R(-0.8, 0.8), 0.12, '#14100c', 0.4); }
    if(d.crows) for(let i=0;i<3;i++){ const x = 1 + k.R(-0.6, 0.6), y = 1 + k.R(-0.6, 0.6); k.fillP([x - 0.06, y, x, y - 0.02, x + 0.06, y, x, y + 0.03], '#0a0a0a'); }
    if(d.noose){ k.line([1.4, 0.7, 1.45, 0.95], '#a8946a', 0.015); c.beginPath(); c.arc(1.45, 1.0, 0.04, 0, 6.28); k.stroke('#a8946a', 0.012); } }
  const DEADTREE = [{n:'Сухое'}, {n:'Обгоревшее', burnt:true}, {n:'Поваленное', fallen:true}, {n:'С воронами', crows:true}, {n:'С петлёй', noose:true}];
  function treeSparseDraw(g, d){ const k = hk(g), c = k.c; for(let i=0;i<5;i++) hdBranches(k, 1, 1, i/5*6.28, 0.4, 0.08, 3, '#4a3a2a'); hdCanopy(k, d.ox || 1, d.oy || 1, d.r || 0.75, d.cols, {sparse:d.sparse}); if(d.sparse) for(let i=0;i<4;i++) hdBranches(k, 1, 1, k.R(0, 6.28), 0.5, 0.05, 2, '#4a3a2a'); if(d.second) hdCanopy(k, 1.45, 1.4, 0.4, d.cols); k.leaves(0, 0, 2, 2, 10); }
  const TREE_S = [{n:'Пыльная зелень', cols:['#4a5a34', '#5a6a3a', '#7a8a4a']}, {n:'Осенняя', cols:['#6a4a24', '#8a6a2a', '#b8902a']}, {n:'Редкая крона', cols:['#4e5a3a', '#5a6640', '#6a7448'], sparse:true, r:0.65}, {n:'Хвойная', cols:['#24382a', '#2e4434', '#3e5a40'], r:0.7}, {n:'Две кроны', cols:['#4a5a34', '#5a6a3a', '#7a8a4a'], ox:0.8, oy:0.8, r:0.6, second:true}];
  function cactusDraw(g, d){ const k = hk(g), c = k.c; k.organic(0.5, 0.55, 0.38, 0.3); k.texFill('sand', '#c8a878'); k.fill('rgba(0,0,0,.1)');
    const body = (x, y, r)=>{ c.beginPath(); c.arc(x + 0.03, y + 0.04, r, 0, 6.28); k.fill('rgba(0,0,0,.4)'); const gr = c.createRadialGradient(x - r*0.4, y - r*0.4, 0, x, y, r); gr.addColorStop(0, d.col[1]); gr.addColorStop(1, d.col[0]); c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = gr; c.fill(); for(let i=0;i<10;i++){ const a = i/10*6.28; k.line([x, y, x + Math.cos(a)*r, y + Math.sin(a)*r], 'rgba(0,0,0,.25)', r*0.06); c.beginPath(); c.arc(x + Math.cos(a)*r*0.7, y + Math.sin(a)*r*0.7, r*0.05, 0, 6.28); k.fill('#e8e0c0'); } if(d.flower){ c.beginPath(); c.arc(x, y, r*0.25, 0, 6.28); k.fill('#e85a8a'); c.beginPath(); c.arc(x, y, r*0.1, 0, 6.28); k.fill('#f0d040'); } };
    if(d.group){ body(0.3, 0.35, 0.14); body(0.65, 0.4, 0.18); body(0.45, 0.7, 0.16); body(0.75, 0.75, 0.1); } else { body(0.5, 0.5, 0.22); [[0.22, 0.45], [0.78, 0.55]].forEach(([x, y])=>{ k.line([0.5, 0.5, x, y], d.col[0], 0.12); body(x, y, 0.1); }); } hdRock(k, 0.15, 0.85, 0.07, '#9a7a58', {moss:false}); }
  const CACTUS = [{n:'Ветвистый', col:['#3a5a2a', '#7a9a4a']}, {n:'Группа', col:['#4a6a3a', '#8aaa5a'], group:true}, {n:'Цветущий', col:['#3a5a2a', '#7a9a4a'], group:true, flower:true}];
  function dryBushDraw(g, d){ const k = hk(g), c = k.c; c.beginPath(); c.arc(0.55, 0.58, 0.36, 0, 6.28); k.fill('rgba(0,0,0,.3)');
    for(let i=0;i<(d.dense ? 34 : 24);i++){ const a = k.R(0, 6.28), L = k.R(0.18, 0.42), mx = 0.5 + Math.cos(a)*L*0.5 + k.R(-0.04, 0.04), my = 0.5 + Math.sin(a)*L*0.5; k.line([0.51, 0.52, mx + 0.01, my + 0.015, 0.5 + Math.cos(a)*L + 0.01, 0.5 + Math.sin(a)*L + 0.015], 'rgba(0,0,0,.35)', 0.022); k.line([0.5, 0.5, mx, my, 0.5 + Math.cos(a)*L, 0.5 + Math.sin(a)*L], d.col, 0.02); k.line([mx, my, mx + Math.cos(a + 0.6)*L*0.35, my + Math.sin(a + 0.6)*L*0.35], d.col, 0.012); }
    for(let i=0;i<(d.dense ? 90 : 55);i++){ const a = k.R(0, 6.28), r = Math.sqrt(k.rnd())*0.4; c.beginPath(); c.ellipse(0.5 + Math.cos(a)*r, 0.5 + Math.sin(a)*r, 0.035, 0.016, k.R(0, 3), 0, 6.28); k.fill(k.pick(d.leaf)); }
    if(d.berries) for(let i=0;i<8;i++){ c.beginPath(); c.arc(0.5 + k.R(-0.3, 0.3), 0.5 + k.R(-0.3, 0.3), 0.022, 0, 6.28); k.fill('#a82a3a'); } if(d.tumble){ for(let r=0.12;r<0.36;r+=0.06){ c.beginPath(); c.arc(0.5, 0.5, r, k.R(0, 3), k.R(3, 6)); k.stroke('rgba(160,130,90,.6)', 0.008); } } }
  const DRYBUSH = [{n:'Сухой', col:'#6a5440', leaf:['#8a7a50', '#7a6a44', '#9a8a5a']}, {n:'Колючий густой', col:'#4a3a2a', leaf:['#5a6040', '#6a6a44'], dense:true}, {n:'С ягодами', col:'#5a4430', leaf:['#5a6a3a', '#6a7a44'], berries:true}, {n:'Перекати-поле', col:'#9a7a50', leaf:['#b89a6a', '#a8885a'], tumble:true}];
  function mutantPlantDraw(g, d){ const k = hk(g), c = k.c, cx = 1, cy = 1;
    k.organic(cx, cy, 0.9, 0.3); k.texFill('mud', '#3a3020'); k.fill('rgba(0,0,0,.2)'); for(let i=0;i<6;i++) k.blot(cx + k.R(-0.7, 0.7), cy + k.R(-0.7, 0.7), 0.12, '#4a6a2a', 0.4);
    for(let i=0;i<7;i++){ const a = i/7*6.28 + k.R(-0.2, 0.2), pts = []; for(let t=0;t<=10;t++){ const r = 0.15 + t*0.08, w = Math.sin(t*0.9 + i)*0.25; pts.push(cx + Math.cos(a + w)*r, cy + Math.sin(a + w)*r); } k.line(pts.map((v, j)=>v + (j%2 ? 0.04 : 0.03)), 'rgba(0,0,0,.4)', 0.08); k.line(pts, d.col[0], 0.07); k.line(pts, d.col[1], 0.025); for(let t=2;t<10;t+=2){ c.beginPath(); c.arc(pts[t*2], pts[t*2 + 1], 0.012, 0, 6.28); k.fill('#e8e0c0'); } }
    for(let i=0;i<5;i++){ const a = i/5*6.28; c.save(); c.translate(cx + Math.cos(a)*0.35, cy + Math.sin(a)*0.35); c.rotate(a); c.beginPath(); c.ellipse(0.12, 0, 0.18, 0.08, 0, 0, 6.28); k.fill(d.col[2]); k.stroke('rgba(0,0,0,.4)', 0.008); k.line([0, 0, 0.28, 0], 'rgba(0,0,0,.3)', 0.01); c.restore(); }
    c.beginPath(); c.arc(cx, cy, 0.25, 0, 6.28); k.fill(d.col[0]); c.beginPath(); c.arc(cx, cy, 0.18, 0, 6.28); k.fill('#3a0a14'); for(let i=0;i<14;i++){ const a = i/14*6.28; k.fillP([cx + Math.cos(a)*0.18, cy + Math.sin(a)*0.18, cx + Math.cos(a + 0.2)*0.18, cy + Math.sin(a + 0.2)*0.18, cx + Math.cos(a + 0.1)*0.1, cy + Math.sin(a + 0.1)*0.1], '#e8e0c8'); } k.radial(cx, cy, 0.12, '#8a1a2a', 0.6); if(d.glow) k.radial(cx, cy, 0.8, d.col[1], 0.3); if(d.prey) bits.skull(k, cx + 0.55, cy + 0.6, 0.07, 0.6); }
  const MUTPLANT = [{n:'Пасть', col:['#3a5a2a', '#8ab04a', '#5a7a34']}, {n:'Багровая', col:['#5a1a2a', '#c84a5a', '#7a2a3a'], prey:true}, {n:'Светящаяся', col:['#2a4a4a', '#6affd8', '#3a6a5a'], glow:true}];
  function stumpsDraw(g, d){ const k = hk(g), c = k.c;
    const st = (x, y, r)=>{ c.beginPath(); c.arc(x + 0.04, y + 0.06, r, 0, 6.28); k.fill('rgba(0,0,0,.4)'); for(let i=0;i<4;i++){ const a = i*1.57 + k.R(-0.3, 0.3); k.line([x, y, x + Math.cos(a)*r*1.6, y + Math.sin(a)*r*1.6], '#3a2e24', r*0.3); } c.beginPath(); c.arc(x, y, r, 0, 6.28); k.fill(d.burnt ? '#2a2018' : '#5a4a3a'); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x, y, r*0.85, 0, 6.28); k.fill(d.burnt ? '#1a1410' : d.fresh ? '#c8a878' : '#8a7058'); for(let rr=r*0.15;rr<r*0.85;rr+=r*0.13){ c.beginPath(); c.arc(x, y, rr, 0, 6.28); k.stroke(d.burnt ? 'rgba(255,120,40,.12)' : 'rgba(80,50,30,.35)', 0.006); } k.line([x, y, x + r*0.7, y - r*0.3], 'rgba(30,20,10,.5)', 0.01); if(d.moss) k.moss(x - r*0.3, y + r*0.2, r*0.4); if(d.axe && r > 0.2){ c.save(); c.translate(x, y); c.rotate(0.6); k.rr(-0.02, -0.25, 0.04, 0.3, 0.01); k.fill('#6a4a2a'); k.fillP([-0.02, -0.25, 0.12, -0.3, 0.12, -0.18, -0.02, -0.2], '#8a8e90'); c.restore(); } };
    st(0.45, 0.5, 0.28); st(1.3, 0.4, 0.2); st(1.65, 0.7, 0.14); if(d.fresh){ for(let i=0;i<20;i++) k.chunk(k.R(0.2, 1.8), k.R(0.2, 0.9), 0.02, '#c8a878', 0.005); } k.tufts(0, 0, 2, 1, 6); k.leaves(0, 0, 2, 1, 8); }
  const STUMPS = [{n:'Старые', moss:true}, {n:'Свежие, с топором', fresh:true, axe:true}, {n:'Обгоревшие', burnt:true}];
  function reedsDraw(g, d){ const k = hk(g), c = k.c; k.orgK(0.5, 0.5, 0.4, 0.2); k.texFill(d.dry ? 'mud' : 'water', d.dry ? '#4a3e2a' : '#2a3a3a'); c.save(); k.orgK(0.5, 0.5, 0.4, 0.2); c.clip(); k.radial(0.5, 0.5, 0.45, '#000000', 0.0); for(let i=0;i<14;i++) k.blot(0.5 + k.R(-0.35, 0.35), 0.5 + k.R(-0.35, 0.35), k.R(0.05, 0.12), d.dry ? '#6a5a3a' : '#3a4a2a', 0.6); c.restore(); k.orgK(0.5, 0.5, 0.4, 0.2); k.stroke(d.dry ? 'rgba(90,70,40,.6)' : 'rgba(60,70,40,.7)', 0.04);
    for(let i=0;i<(d.dense ? 90 : 60);i++){ const cl = i%5, x = 0.5 + Math.cos(cl*1.26)*0.18 + k.R(-0.16, 0.16), y = 0.5 + Math.sin(cl*1.26)*0.18 + k.R(-0.16, 0.16), a = k.R(-2.4, -0.7), L = k.R(0.12, 0.3); k.line([x + 0.01, y + 0.015, x + Math.cos(a)*L + 0.01, y + Math.sin(a)*L + 0.015], 'rgba(0,0,0,.3)', 0.014); k.line([x, y, x + Math.cos(a)*L, y + Math.sin(a)*L], k.pick(d.cols), 0.016); k.line([x, y, x + Math.cos(a)*L*0.6, y + Math.sin(a)*L*0.6], 'rgba(255,255,220,.25)', 0.005); if(d.cattail && k.rnd() < 0.25){ c.beginPath(); c.ellipse(x + Math.cos(a)*L*0.8, y + Math.sin(a)*L*0.8, 0.035, 0.014, a, 0, 6.28); k.fill('#5a3a22'); } } }
  const REEDS = [{n:'Камыш', cols:['#6a7a3a', '#8a9a4a', '#5a6a34'], cattail:true}, {n:'Сухой', cols:['#a8945a', '#8a7a4a', '#c8b07a'], dry:true}, {n:'Густой', cols:['#4a6a2a', '#6a8a3a', '#3a5a2a'], dense:true}];
  function natureRuinsDraw(g, d){ const k = hk(g), c = k.c;
    k.rr(0.2, 0.2, 2.6, 2.6, 0.02); k.texFill('tiles', '#a8a49c', '#a89a80', 0.3); c.save(); k.rr(0.2, 0.2, 2.6, 2.6, 0.02); c.clip(); for(let i=0;i<14;i++) k.blot(k.R(0.3, 2.7), k.R(0.3, 2.7), k.R(0.1, 0.3), '#4a5a2a', 0.5); k.tufts(0, 0, 3, 3, 40); c.restore();
    [[0.6, 0.6], [2.4, 0.6], [0.6, 2.4], [2.4, 2.4]].forEach(([x, y], i)=>{ if(d.fallen && i===1){ c.save(); c.translate(1.9, 1.0); c.rotate(-0.5); k.rr(-0.9, -0.2, 1.8, 0.4, 0.2); k.texFill('concrete', '#c8c0b0'); k.stroke(k.INK, 0.01); for(let j=0;j<6;j++) k.line([-0.8 + j*0.3, -0.2, -0.8 + j*0.3, 0.2], 'rgba(0,0,0,.2)', 0.015); c.restore(); return; } c.beginPath(); c.arc(x + 0.05, y + 0.07, 0.3, 0, 6.28); k.fill('rgba(0,0,0,.45)'); c.beginPath(); c.arc(x, y, 0.3, 0, 6.28); k.texFill('concrete', '#c8c0b0', '#c8b898', 0.3); for(let j=0;j<12;j++){ const a = j/12*6.28; k.line([x + Math.cos(a)*0.2, y + Math.sin(a)*0.2, x + Math.cos(a)*0.3, y + Math.sin(a)*0.3], 'rgba(0,0,0,.2)', 0.015); } k.radial(x - 0.1, y - 0.1, 0.25, '#ffffff', 0.2); c.beginPath(); c.arc(x, y, 0.3, 0, 6.28); k.stroke(k.INK, 0.01); });
    const vines = d.dense ? 9 : 5; for(let i=0;i<vines;i++){ const pts = []; let x = k.R(0.2, 2.8), y = k.R(0.2, 2.8); for(let j=0;j<8;j++){ pts.push(x, y); x += k.R(-0.3, 0.3); y += k.R(-0.3, 0.3); } k.line(pts, '#3a4a24', 0.03); for(let j=0;j<pts.length;j+=2) k.blot(pts[j], pts[j + 1], 0.08, k.pick(['#4a6a2a', '#5a7a34']), 0.9); }
    for(let i=0;i<(d.dense ? 5 : 3);i++) houseBits.bush(k, k.R(0.4, 2.6), k.R(0.4, 2.6), 0.22); if(d.dense) hdCanopy(k, 1.5, 1.6, 0.6, ['#3a4a24', '#4a5a2a', '#6a7a3a']); }
  const NRUINS = [{n:'Колонны'}, {n:'Упавшая колонна', fallen:true}, {n:'Джунгли', dense:true}];
  function craterDraw(g, d){ const k = hk(g), c = k.c, cx = 1.5, cy = 1.5;
    for(let i=0;i<24;i++){ const a = i/24*6.28 + k.R(-0.1, 0.1), r = k.R(1.0, 1.45); k.line([cx + Math.cos(a)*1.0, cy + Math.sin(a)*1.0, cx + Math.cos(a)*r, cy + Math.sin(a)*r], 'rgba(30,24,18,.35)', k.R(0.04, 0.1)); }
    k.orgK(cx, cy, 1.15, 0.12); k.texFill('dirt', '#5a4a36'); k.orgK(cx, cy, 1.15, 0.12); k.stroke('rgba(255,240,220,.15)', 0.04);
    const gr = c.createRadialGradient(cx + 0.15, cy + 0.2, 0.05, cx, cy, 0.95); gr.addColorStop(0, d.water ? '#1a2a2a' : '#140e0a'); gr.addColorStop(0.6, '#2a2018'); gr.addColorStop(1, '#4a3a2a'); k.orgK(cx, cy, 0.9, 0.12); c.fillStyle = gr; c.fill();
    c.save(); k.orgK(cx, cy, 0.9, 0.12); c.clip(); c.fillStyle = k.lin(cx - 0.9, cy - 0.9, cx + 0.9, cy + 0.9, [[0, 'rgba(0,0,0,.45)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(255,240,220,.15)']]); c.fillRect(0, 0, 3, 3); if(d.water){ k.orgK(cx + 0.05, cy + 0.08, 0.5, 0.2); k.fill('rgba(40,60,60,.85)'); k.line([cx - 0.3, cy - 0.1, cx + 0.2, cy - 0.25], 'rgba(200,220,220,.3)', 0.02); } for(let i=0;i<10;i++) k.chunk(cx + k.R(-0.7, 0.7), cy + k.R(-0.7, 0.7), k.R(0.04, 0.1), '#5a4a36', 0.03); c.restore();
    for(let i=0;i<30;i++){ const a = k.R(0, 6.28), r = k.R(0.95, 1.4); k.chunk(cx + Math.cos(a)*r, cy + Math.sin(a)*r, k.R(0.03, 0.1), '#6a5a44', 0.03); }
    if(d.shell){ c.save(); c.translate(cx + 0.1, cy); c.rotate(0.7); k.rr(-0.2, -0.06, 0.4, 0.12, 0.05); k.texFill('metal', '#55585a', '#4a5a3a', 0.6); k.stroke(k.INK, 0.008); k.rr(0.12, -0.065, 0.06, 0.13, 0.01); k.fill('#8a6a3a'); c.restore(); } if(d.smoke) xb.smoke(k, cx, cy, 0.6); }
  const CRATER = [{n:'Воронка'}, {n:'С водой', water:true}, {n:'Неразорвавшийся снаряд', shell:true}, {n:'Дымится', smoke:true}];
  function beastBonesDraw(g, d){ const k = hk(g), c = k.c, bone = d.old ? '#a89a7a' : '#ddd4bc';
    for(let i=0;i<5;i++) k.blot(k.R(0.5, 4.5), k.R(0.5, 2.5), k.R(0.3, 0.6), '#3a3026', 0.25); k.tufts(0, 0, 5, 3, d.old ? 30 : 12);
    const spine = []; for(let i=0;i<=16;i++) spine.push(0.6 + i*0.24, 1.5 + Math.sin(i*0.5)*0.35); for(let i=0;i<16;i++){ const x = spine[i*2], y = spine[i*2 + 1]; c.beginPath(); c.ellipse(x + 0.03, y + 0.04, 0.1, 0.07, 0, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.ellipse(x, y, 0.1, 0.07, 0, 0, 6.28); k.fill(bone); k.stroke('rgba(60,50,40,.5)', 0.008); }
    for(let i=1;i<11;i++){ if(d.broken && i%3===0) continue; const x = spine[i*2], y = spine[i*2 + 1], L = 0.9 - Math.abs(i - 5)*0.07; [-1, 1].forEach(s=>{ c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 0.3, y + s*L*0.6, x + 0.1, y + s*L); k.stroke('rgba(0,0,0,.35)', 0.07); c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 0.3, y + s*L*0.6, x + 0.1, y + s*L); k.stroke(bone, 0.055); }); }
    c.save(); c.translate(0.45, 1.45); c.rotate(-0.2); c.beginPath(); c.ellipse(0.05, 0.06, 0.42, 0.3, 0, 0, 6.28); k.fill('rgba(0,0,0,.4)'); c.beginPath(); c.ellipse(0, 0, 0.42, 0.3, 0, 0, 6.28); k.fill(bone); k.stroke('rgba(60,50,40,.6)', 0.01); [[-0.1, -0.12], [-0.1, 0.12]].forEach(([x, y])=>{ c.beginPath(); c.ellipse(x, y, 0.08, 0.06, 0, 0, 6.28); k.fill('#1a1410'); }); for(let i=0;i<7;i++) k.fillP([-0.4, -0.18 + i*0.06, -0.55, -0.15 + i*0.06, -0.4, -0.12 + i*0.06], bone); for(let i=0;i<3;i++) k.line([0.1, k.R(-0.2, 0.2), 0.3, k.R(-0.2, 0.2)], 'rgba(60,50,40,.4)', 0.01); c.restore();
    if(d.old){ for(let i=0;i<10;i++) k.moss(k.R(0.5, 4.5), k.R(0.8, 2.2), 0.1); k.leaves(0, 0, 5, 3, 30); } else { for(let i=0;i<6;i++) k.blot(k.R(1, 4), k.R(1, 2), 0.12, '#5a2a1a', 0.35); } if(d.broken) for(let i=0;i<14;i++) k.line([k.R(0.5, 4.5), k.R(0.3, 2.7), k.R(0.5, 4.5), k.R(0.3, 2.7)], bone, 0.03, 0.7); }
  const BEAST = [{n:'Свежий скелет'}, {n:'Древний, в мху', old:true}, {n:'Разбросанный', broken:true, old:true}];
  function puddleDraw(g, d){ const k = hk(g), c = k.c;
    k.orgK(1, 0.5, 0.92, 0.14, 0.42); k.fill('rgba(30,24,18,.35)'); k.orgK(1, 0.5, 0.82, 0.14, 0.36); c.fillStyle = k.lin(0, 0.1, 0, 0.9, [[0, d.col[0]], [1, d.col[1]]]); c.fill();
    c.save(); k.orgK(1, 0.5, 0.82, 0.14, 0.36); c.clip(); k.line([0.4, 0.3, 1.2, 0.25], 'rgba(255,255,255,.25)', 0.03); k.line([0.7, 0.55, 1.5, 0.5], 'rgba(255,255,255,.1)', 0.02); if(d.oil){ for(let i=0;i<9;i++){ c.beginPath(); c.ellipse(1 + k.R(-0.4, 0.4), 0.5 + k.R(-0.1, 0.1), k.R(0.1, 0.35), k.R(0.04, 0.12), k.R(-0.3, 0.3), 0, 6.28); k.stroke(['#c850e0', '#50c8a0', '#e8c840', '#5080e8'][i%4], 0.02, 0.28); } } if(d.rain) for(let i=0;i<8;i++){ c.beginPath(); c.arc(k.R(0.4, 1.6), k.R(0.25, 0.75), k.R(0.03, 0.08), 0, 6.28); k.stroke('rgba(220,230,230,.35)', 0.008); } if(d.blood) k.radial(1.1, 0.5, 0.6, '#6a0a0a', 0.6); k.leaves(0.2, 0.1, 1.6, 0.8, 4); c.restore();
    k.orgK(1, 0.5, 0.82, 0.14, 0.36); k.stroke('rgba(20,16,12,.4)', 0.025); for(let i=0;i<6;i++) k.blot(1 + k.R(-0.9, 0.9), 0.5 + k.R(-0.45, 0.45), 0.05, '#2a2018', 0.4); }
  const PUDDLE = [{n:'Вода', col:['#3a4a4a', '#2a3434']}, {n:'Бензиновая', col:['#2a2a2a', '#1a1a1e'], oil:true}, {n:'Под дождём', col:['#3a4a4e', '#2a3438'], rain:true}, {n:'Мутная', col:['#5a4a34', '#3a3024']}, {n:'Кровавая', col:['#3a1a14', '#2a0e0a'], blood:true}];

  A('rock_big', 'Скала', 'nature', 2, 2, {t:'скала камень утёс', v:ROCKBIG.length, vn:VN(ROCKBIG), hd:true}, (g, v)=>rockBigDraw(g, PV(ROCKBIG, v)));
  A('boulder', 'Валун', 'nature', 1, 1, {t:'валун камень', v:BOULDER.length, vn:VN(BOULDER), hd:true}, (g, v)=>boulderDraw(g, PV(BOULDER, v)));
  A('rocks_scatter', 'Россыпь камней', 'nature', 2, 2, {t:'камни россыпь', g:true, v:ROCKS.length, vn:VN(ROCKS), hd:true}, (g, v)=>rocksScatterDraw(g, PV(ROCKS, v)));
  A('dune', 'Дюна', 'nature', 4, 3, {t:'дюна песок бархан', g:true, v:DUNE.length, vn:VN(DUNE), hd:true}, (g, v)=>duneDraw(g, PV(DUNE, v)));
  A('ravine', 'Овраг', 'nature', 2, 6, {t:'овраг расщелина балка', g:true, v:RAVINE.length, vn:VN(RAVINE), hd:true}, (g, v)=>ravineDraw(g, PV(RAVINE, v)));
  A('dead_tree', 'Мёртвое дерево', 'nature', 2, 2, {t:'дерево мёртвое сухое', v:DEADTREE.length, vn:VN(DEADTREE), hd:true}, (g, v)=>deadTreeDraw(g, PV(DEADTREE, v)));
  A('tree_sparse', 'Чахлое дерево', 'nature', 2, 2, {t:'дерево крона растительность', v:TREE_S.length, vn:VN(TREE_S), hd:true}, (g, v)=>treeSparseDraw(g, PV(TREE_S, v)));
  A('cactus', 'Кактусы', 'nature', 1, 1, {t:'кактус пустыня растение', v:CACTUS.length, vn:VN(CACTUS), hd:true}, (g, v)=>cactusDraw(g, PV(CACTUS, v)));
  A('dry_bush', 'Сухой куст', 'nature', 1, 1, {t:'куст кустарник сухой', v:DRYBUSH.length, vn:VN(DRYBUSH), hd:true}, (g, v)=>dryBushDraw(g, PV(DRYBUSH, v)));
  A('mutant_plant', 'Плотоядное растение', 'nature', 2, 2, {t:'растение мутант щупальца флора', v:MUTPLANT.length, vn:VN(MUTPLANT), hd:true}, (g, v)=>mutantPlantDraw(g, PV(MUTPLANT, v)));
  A('stumps', 'Пни', 'nature', 2, 1, {t:'пень пни вырубка', v:STUMPS.length, vn:VN(STUMPS), hd:true}, (g, v)=>stumpsDraw(g, PV(STUMPS, v)));
  A('reeds', 'Камыш', 'nature', 1, 1, {t:'камыш тростник болото', g:true, v:REEDS.length, vn:VN(REEDS), hd:true}, (g, v)=>reedsDraw(g, PV(REEDS, v)));
  A('nature_ruins', 'Колонны в зарослях', 'nature', 3, 3, {t:'руины колонны заросли природа', v:NRUINS.length, vn:VN(NRUINS), hd:true}, (g, v)=>natureRuinsDraw(g, PV(NRUINS, v)));
  A('crater', 'Воронка от взрыва', 'nature', 3, 3, {t:'воронка кратер взрыв', g:true, v:CRATER.length, vn:VN(CRATER), hd:true}, (g, v)=>craterDraw(g, PV(CRATER, v)));
  A('beast_bones', 'Кости огромного зверя', 'nature', 5, 3, {t:'кости скелет червь зверь', v:BEAST.length, vn:VN(BEAST), hd:true}, (g, v)=>beastBonesDraw(g, PV(BEAST, v)));
  A('puddle', 'Лужа', 'nature', 2, 1, {t:'лужа вода', g:true, v:PUDDLE.length, vn:VN(PUDDLE), hd:true}, (g, v)=>puddleDraw(g, PV(PUDDLE, v)));

  /* ===================== ИНТЕРЬЕР И ПРЕДМЕТЫ ===================== */
  /* ---- Интерьер и предметы (HD) ---- */
  function doorDraw(g, d){ const k = hk(g), c = k.c, col = d.metal ? null : '#6b5236';
    const jamb = ()=>{ [[0.02, 0.38], [0.92, 0.38]].forEach(([x, y])=>{ k.rr(x, y, 0.06, 0.24, 0.01); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.008); }); };
    const leaf = (x, y, w, h)=>{ fx.sh(k, x, y, w, h, 0.01, 0.03); k.rr(x, y, w, h, 0.01); if(d.metal) k.texFill('metal', '#6d7376', '#5a6268', 0.4); else k.texFill('wood', '#6b5236', col, 0.4); k.stroke(k.INK, 0.008); k.line([x + 0.01, y + 0.01, x + w - 0.01, y + 0.01], 'rgba(255,250,240,.3)', 0.008); };
    jamb();
    if(d.open){ c.save(); c.translate(0.08, 0.5); c.rotate(-0.6); leaf(0, -0.05, 0.84, 0.1); c.restore(); c.beginPath(); c.arc(0.08, 0.5, 0.84, -0.6, 0); k.stroke('rgba(30,24,18,.3)', 0.008, null); k.c.setLineDash([]); return; }
    if(d.broken){ c.save(); c.translate(0.55, 0.62); c.rotate(0.35); leaf(-0.42, -0.05, 0.84, 0.1); for(let i=0;i<3;i++) k.line([k.R(-0.3, 0.3), -0.05, k.R(-0.3, 0.3), 0.05], '#2a1e14', 0.01); c.restore(); for(let i=0;i<6;i++) k.plank(k.R(0.2, 0.8), k.R(0.2, 0.9), k.R(0.15, 0.3), 0.04, k.rnd()*6.28, '#5e4630', true); return; }
    leaf(0.08, 0.45, 0.84, 0.1); c.beginPath(); c.arc(0.8, 0.5, 0.022, 0, 6.28); k.fill(d.metal ? '#3a3e40' : '#8a7a5a');
    if(d.metal){ for(let i=0;i<4;i++){ c.beginPath(); c.arc(0.15 + i*0.22, 0.5, 0.012, 0, 6.28); k.fill('#3a3e40'); } k.rust(0.3, 0.5, 0.03, false); } }
  const DOOR = [{n:'Деревянная'}, {n:'Металлическая', metal:true}, {n:'Открыта', open:true}, {n:'Выбита', broken:true}];
  function dDoorDraw(g, d){ const k = hk(g), c = k.c;
    [[0.02, 0.38], [1.92, 0.38]].forEach(([x, y])=>{ k.rr(x, y, 0.06, 0.24, 0.01); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.008); });
    const leaf = (x, y, w, a)=>{ c.save(); c.translate(x, y); c.rotate(a); fx.sh(k, 0, -0.05, w, 0.1, 0.01, 0.03); k.rr(0, -0.05, w, 0.1, 0.01); k.texFill('wood', '#6b5236', '#7a5a3a', 0.4); k.stroke(k.INK, 0.008); k.rr(w*0.35, -0.035, 0.12, 0.07, 0.005); k.fill('rgba(150,180,180,.55)'); c.restore(); };
    if(d.open){ leaf(0.08, 0.5, 0.92, -1.2); leaf(1.92, 0.5, -0.92, 1.2); }
    else { leaf(0.08, 0.5, 0.92, 0); leaf(1.92, 0.5, -0.92, 0); [[0.95, 0.5], [1.05, 0.5]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.02, 0, 6.28); k.fill('#8a7a5a'); }); }
    if(d.barricade){ k.plank(1, 0.4, 1.7, 0.1, 0.12, '#5e4630', false); k.plank(1, 0.6, 1.7, 0.1, -0.1, '#6a5236', false); houseBits.crate(k, 0.6, 0.15, 0.3, 0.24, 0.1); bits.barrel(k, 1.45, 0.12, 0.12, '#4a5a6a'); } }
  const DDOOR = [{n:'Закрыта'}, {n:'Распахнута', open:true}, {n:'Забаррикадирована', barricade:true}];
  function windowDraw(g, d){ const k = hk(g), c = k.c;
    [[0, 0.36, 0.12], [0.88, 0.36, 0.12]].forEach(([x, y, w])=>{ k.rr(x, y, w, 0.28, 0.01); k.texFill('brickwall', '#7a4c3e'); k.stroke(k.INK, 0.008); });
    k.rr(0.12, 0.44, 0.76, 0.12, 0.01); k.texFill('wood', '#6b5236', '#d8d0bc', 0.5); k.stroke(k.INK, 0.008);
    if(d.boarded){ for(let i=0;i<3;i++) k.plank(0.5, 0.42 + i*0.08, 1.0, 0.08, k.R(-0.12, 0.12), '#5e4630', false); return; }
    k.rr(0.16, 0.47, 0.68, 0.06, 0.005); k.fill(d.broken ? '#1a1612' : 'rgba(150,180,190,.75)'); k.line([0.5, 0.45, 0.5, 0.55], '#5a4630', 0.015);
    if(d.broken) for(let i=0;i<10;i++){ const x = k.R(0.1, 0.9), y = k.rnd() < 0.5 ? k.R(0.25, 0.42) : k.R(0.58, 0.8); k.fillP([x, y, x + 0.04, y + 0.01, x + 0.015, y + 0.035], 'rgba(198,212,212,.75)'); } }
  const WINDOW = [{n:'Целое'}, {n:'Разбито', broken:true}, {n:'Заколочено', boarded:true}];
  function gateDraw2(g, d){ const k = hk(g), c = k.c;
    [[0, 0.3], [2.86, 0.3]].forEach(([x, y])=>{ k.rr(x, y, 0.14, 0.4, 0.01); k.texFill('concrete', '#8a8780'); k.stroke(k.INK, 0.01); });
    const panel = (x0, x1, a)=>{ c.save(); c.translate(x0, 0.5); c.rotate(a || 0); const L = x1 - x0; k.line([0, 0.03, L, 0.03], 'rgba(0,0,0,.35)', 0.07); k.line([0, 0, L, 0], '#4a4e50', 0.05); k.line([0, -0.01, L, -0.01], 'rgba(255,255,255,.2)', 0.012); for(let x=0.08;x<L;x+=0.12){ c.beginPath(); c.arc(x, 0, 0.022, 0, 6.28); k.fill('#5a5e60'); k.stroke(k.INK, 0.004); } for(let i=0;i<3;i++) k.rust(k.R(0.1, L - 0.1), 0, 0.03, false); c.restore(); };
    if(d.open){ panel(0.14, 1.0, -1.3); panel(2.86, 2.0, 1.3); }
    else if(d.torn){ panel(0.14, 1.5, 0); c.save(); c.translate(2.0, 0.75); c.rotate(0.4); panel(-0.7, 0.7, 0); c.restore(); }
    else { panel(0.14, 1.5, 0); panel(1.5, 2.86, 0); k.rr(1.44, 0.44, 0.12, 0.12, 0.02); k.fill('#2a2826'); k.line([1.42, 0.5, 1.58, 0.5], '#8a7a3a', 0.02); } }
  const GATE2 = [{n:'Закрыты на замок'}, {n:'Открыты', open:true}, {n:'Створка сорвана', torn:true}];
  function stairsDraw(g, d){ const k = hk(g), c = k.c, n = 10;
    for(let i=0;i<n;i++){ const y = 0.05 + i*0.29, dk = i/n; k.rr(0.1, y, 1.8, 0.27, 0.01); if(d.mat==='grate'){ k.texFill('metal', '#6d7376'); c.save(); k.rr(0.1, y, 1.8, 0.27, 0.01); c.clip(); for(let x=0.12;x<1.9;x+=0.06) k.line([x, y, x, y + 0.27], 'rgba(0,0,0,.45)', 0.012); c.restore(); } else k.texFill(d.mat, '#8a8780');
      k.fill(`rgba(0,0,0,${dk*0.55})`); k.line([0.1, y + 0.005, 1.9, y + 0.005], 'rgba(255,250,240,.35)', 0.012); k.line([0.1, y + 0.27, 1.9, y + 0.27], 'rgba(0,0,0,.6)', 0.014); if(k.rnd() < 0.3) k.chunk(k.R(0.2, 1.8), y + 0.25, 0.05, '#8a8780', 0.01); }
    [0.08, 1.92].forEach(x=>{ k.line([x + 0.02, 0.05, x + 0.02, 2.95], 'rgba(0,0,0,.35)', 0.05); k.line([x, 0.05, x, 2.95], d.mat==='wood' ? '#5e4630' : '#4a4e50', 0.04); }); k.leaves(0.1, 0.1, 1.8, 2.8, 14); }
  const STAIRS = [{n:'Бетонная', mat:'concrete'}, {n:'Деревянная', mat:'wood'}, {n:'Решётчатая металлическая', mat:'grate'}];
  function ladderDraw(g, d){ const k = hk(g), c = k.c, rail = d.metal ? '#5a5e60' : '#6a5236';
    c.save(); c.translate(0.5, 1); c.rotate(d.fallen ? 0.35 : 0);
    if(d.rope){ [-0.22, 0.22].forEach(x=>{ c.beginPath(); c.moveTo(x, -0.95); c.bezierCurveTo(x + 0.05, -0.3, x - 0.05, 0.3, x, 0.95); k.stroke('#8a7a5a', 0.03); k.stroke('rgba(40,30,20,.3)', 0.008); }); for(let i=0;i<9;i++){ const y = -0.85 + i*0.21; k.plank(0, y, 0.48, 0.05, k.R(-0.05, 0.05), '#6a5236', false); } c.restore(); return; }
    [-0.22, 0.22].forEach(x=>{ k.line([x + 0.025, -0.95, x + 0.025, 0.95].map((v, i)=>v + (i%2 ? 0.03 : 0)), 'rgba(0,0,0,.35)', 0.06); k.line([x, -0.95, x, 0.95], rail, 0.05); k.line([x - 0.012, -0.95, x - 0.012, 0.95], 'rgba(255,255,255,.2)', 0.01); });
    for(let i=0;i<8;i++){ const y = -0.82 + i*0.235; k.line([-0.22, y + 0.02, 0.22, y + 0.02], 'rgba(0,0,0,.3)', 0.04); k.line([-0.22, y, 0.22, y], rail, 0.035); if(d.metal) k.rust(k.R(-0.15, 0.15), y, 0.015, false); }
    c.restore(); }
  const LADDER = [{n:'Деревянная'}, {n:'Металлическая', metal:true}, {n:'Верёвочная', rope:true}];
  function partitionDraw(g, d){ const k = hk(g), c = k.c;
    if(d.screen){ for(let i=0;i<3;i++){ c.save(); c.translate(0.2 + i*0.62, 0.5); c.rotate(i%2 ? -0.3 : 0.3); fx.sh(k, -0.04, -0.3, 0.08, 0.6, 0.01, 0.03); k.rr(-0.04, -0.3, 0.08, 0.6, 0.01); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.006); c.restore(); } bits.fabric(k, [0.2, 0.45, 1.85, 0.45, 1.85, 0.55, 0.2, 0.55], '#7a6a4a', 2, 'v'); return; }
    if(d.mesh){ k.line([0.1, 0.5, 1.9, 0.5], '#4a4e50', 0.03); for(let x=0.1;x<1.9;x+=0.05){ k.line([x, 0.44, x + 0.05, 0.56], '#7a7e80', 0.006); k.line([x + 0.05, 0.44, x, 0.56], '#7a7e80', 0.006); } [0.1, 1.0, 1.9].forEach(x=>{ c.beginPath(); c.arc(x, 0.5, 0.04, 0, 6.28); k.fill('#3a3e40'); }); return; }
    fx.sh(k, 0.05, 0.42, 1.9, 0.16, 0.01, 0.04); k.rr(0.05, 0.42, 1.9, 0.16, 0.01); k.texFill('concrete', '#c8c2b4', '#d8d0c0', 0.4); k.stroke(k.INK, 0.008); k.line([0.07, 0.44, 1.93, 0.44], 'rgba(255,255,255,.35)', 0.01); k.organic(1.4, 0.5, 0.1, 0.5, 0.06); k.fill('#5a5248'); k.graffiti(0.2, 0.43, 0.6, 0.13, '#8a3a5a'); }
  const PARTITION = [{n:'Гипсокартон'}, {n:'Ширма', screen:true}, {n:'Сетка', mesh:true}];
  function crateWoodDraw(g, d){ const k = hk(g), c = k.c;
    if(d.smashed){ for(let i=0;i<7;i++) k.plank(k.R(0.2, 0.8), k.R(0.2, 0.8), k.R(0.3, 0.6), 0.1, k.rnd()*6.28, '#7a6040', true); k.blot(0.5, 0.5, 0.25, '#c8b880', 0.6); k.trash(0.1, 0.1, 0.8, 0.8, 5); return; }
    houseBits.crate(k, 0.5, 0.5, 0.8, 0.8, d.a || 0.04);
    if(d.open){ k.rr(0.17, 0.17, 0.66, 0.66, 0.01); k.fill('#2a2016'); c.save(); k.rr(0.17, 0.17, 0.66, 0.66, 0.01); c.clip(); for(let i=0;i<30;i++) k.line([k.R(0.15, 0.85), k.R(0.15, 0.85), k.R(0.15, 0.85), k.R(0.15, 0.85)], k.pick(['#c8b070', '#a89050', '#d8c080']), 0.008); fx.can(k, 0.4, 0.45, 0.06); fx.bottle(k, 0.6, 0.6, 0.6); c.restore(); k.plank(0.5, 0.06, 0.85, 0.12, 0.08, '#7a6040', false); }
    if(d.stencil) bits.stencil(k, 0.5, 0.5, 'ХРУПКОЕ', 0.07, '#2a1e14', 0.55); }
  const CRATE_W = [{n:'Закрытый', stencil:true}, {n:'Открыт, со стружкой', open:true}, {n:'Разбит', smashed:true}, {n:'Повёрнут', a:0.4}];
  function crateMetalDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.12, 0.15, 0.76, 0.7, 0.03, 0.05); k.rr(0.12, 0.15, 0.76, 0.7, 0.03); k.texFill('metal', '#6d7376', d.col, 0.5); k.stroke(k.INK, 0.01);
    for(let i=0;i<3;i++) k.line([0.15, 0.3 + i*0.2, 0.85, 0.3 + i*0.2], 'rgba(0,0,0,.3)', 0.012); [[0.18, 0.2], [0.82, 0.2], [0.18, 0.8], [0.82, 0.8]].forEach(([x, y])=>{ k.rr(x - 0.04, y - 0.04, 0.08, 0.08, 0.01); k.fill('#3a3e40'); });
    [[0.12, 0.5], [0.88, 0.5]].forEach(([x, y])=>{ k.rr(x - 0.03, y - 0.06, 0.06, 0.12, 0.01); k.fill('#2a2826'); });
    if(d.open){ k.rr(0.17, 0.2, 0.66, 0.6, 0.02); k.fill('#141210'); c.save(); k.rr(0.17, 0.2, 0.66, 0.6, 0.02); c.clip(); for(let i=0;i<3;i++) rifle(k, 0.5, 0.3 + i*0.2, 0, 0.6, i===1); c.restore(); }
    if(d.label) bits.stencil(k, 0.5, 0.5, d.label, 0.09, '#d8d0b0', 0.6); for(let i=0;i<3;i++) k.rust(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.03, false); }
  const CRATE_M = [{n:'Оливковый', col:'#4e5a34', label:'ОПАСНО'}, {n:'Открыт, с оружием', col:'#4a5040', open:true}, {n:'Серый', col:'#6a7074', label:'№ 04'}];
  function barrelPropDraw(g, d){ const k = hk(g), c = k.c;
    if(d.wood){ c.beginPath(); c.arc(0.55, 0.57, 0.36, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(0.5, 0.5, 0.36, 0, 6.28); k.texFill('wood', '#6b5236'); k.stroke(k.INK, 0.012); for(let i=0;i<10;i++){ const a = i/10*6.28; k.line([0.5 + Math.cos(a)*0.08, 0.5 + Math.sin(a)*0.08, 0.5 + Math.cos(a)*0.36, 0.5 + Math.sin(a)*0.36], 'rgba(30,20,12,.35)', 0.01); } [0.33, 0.25].forEach(r=>{ c.beginPath(); c.arc(0.5, 0.5, r, 0, 6.28); k.stroke('#3a3e40', 0.025); }); c.beginPath(); c.arc(0.5, 0.5, 0.05, 0, 6.28); k.fill('#3a2a1c'); return; }
    bits.barrel(k, 0.5, 0.5, 0.36, d.col, d.open); if(d.open) c.save(), k.c.beginPath(), k.c.arc(0.5, 0.5, 0.27, 0, 6.28), k.fill(d.liquid || '#2a2418'), c.restore();
    if(d.stencil) bits.stencil(k, 0.5, 0.5, d.stencil, 0.1, '#d8d0b0', 0.55); }
  const BARREL = [{n:'Синяя', col:'#3e5a6a', stencil:'H₂O'}, {n:'Ржавая', col:'#6a4a36'}, {n:'Деревянная', wood:true}, {n:'Открыта, с маслом', col:'#4a5a3a', open:true, liquid:'#1a1610'}];
  function toxicBarrelDraw(g, d){ const k = hk(g), c = k.c;
    if(d.leak){ k.organic(0.6, 0.65, 0.35, 0.4, 0.28); k.fill('#6a8a2a', 0.75); k.radial(0.6, 0.65, 0.4, '#c8f060', 0.3); for(let i=0;i<6;i++){ c.beginPath(); c.arc(0.6 + k.R(-0.25, 0.25), 0.65 + k.R(-0.2, 0.2), 0.02, 0, 6.28); k.stroke('rgba(230,250,190,.6)', 0.005); } }
    c.save(); if(d.leak){ c.translate(0.45, 0.42); c.rotate(0.5); c.translate(-0.45, -0.42); } bits.barrel(k, d.leak ? 0.42 : 0.5, d.leak ? 0.42 : 0.5, 0.34, '#a88a2a', false); c.restore();
    const x = d.leak ? 0.42 : 0.5, y = d.leak ? 0.42 : 0.5; c.beginPath(); for(let i=0;i<3;i++){ const a = -Math.PI/2 + i*2.094; c.moveTo(x, y); c.arc(x, y, 0.16, a - 0.5, a + 0.5); c.closePath(); } k.fill('#1e1c1a', 0.85); c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#1e1c1a'); }
  const TOXIC_B = [{n:'Отходы'}, {n:'Протекает', leak:true}, {n:'Опрокинута, лужа', leak:true}];
  function containerDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    fx.sh(k, 0.06, 0.06, 1.88, 4.88, 0.02, 0.1); k.rr(0.06, 0.06, 1.88, 4.88, 0.02); k.texFill('corrugated', '#7f8588', col, 0.62); k.stroke(k.INK, 0.014);
    c.save(); k.rr(0.06, 0.06, 1.88, 4.88, 0.02); c.clip(); c.fillStyle = k.lin(0.06, 0, 1.94, 0, [[0, 'rgba(0,0,0,.3)'], [0.4, 'rgba(255,250,240,.1)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, 2, 5); for(let i=0;i<14;i++) k.rust(k.R(0.1, 1.9), k.R(0.1, 4.9), k.R(0.04, 0.14), d.holes && i < 3); for(let i=0;i<5;i++) k.streak(k.R(0.15, 1.85), k.R(0.2, 2), k.R(0.5, 1.5), 0.05, '#6a3a1e', 0.3); for(let i=0;i<3;i++) k.dent(k.R(0.3, 1.7), k.R(0.5, 4.5), 0.25); if(d.label) bits.stencil(k, 1.0, 2.5, d.label, 0.3, '#e4ddca', 0.45); c.restore();
    k.rr(0.06, 0.06, 1.88, 4.88, 0.02); k.stroke('rgba(0,0,0,.4)', 0.04); [[0.06, 0.06], [1.82, 0.06], [0.06, 4.82], [1.82, 4.82]].forEach(([x, y])=>{ k.rr(x, y, 0.12, 0.12, 0.01); k.fill('#3a3836'); k.stroke(k.INK, 0.006); c.beginPath(); c.arc(x + 0.06, y + 0.06, 0.03, 0, 6.28); k.fill('#141210'); });
    if(d.open){ [[0.06, -1], [1.94, 1]].forEach(([x, s])=>{ c.save(); c.translate(x, 4.94); c.rotate(s*1.0); k.rr(s > 0 ? -0.94 : 0, -0.04, 0.94, 0.06, 0.01); k.texFill('corrugated', '#7f8588', col, 0.62); k.stroke(k.INK, 0.008); c.restore(); }); k.rr(0.1, 4.6, 1.8, 0.3, 0.01); k.fill('#141210'); houseBits.crate(k, 0.6, 4.5, 0.4, 0.3, 0.1); }
    else { k.line([1, 4.6, 1, 4.94], 'rgba(0,0,0,.5)', 0.014); [0.7, 1.3].forEach(x=>k.line([x, 4.6, x, 4.94], '#3a3836', 0.02)); } }
  const CONTAINER = [{n:'Красный', col:'#8a3a2e', label:'MAERSK'}, {n:'Синий', col:'#2e4a6a', label:'CMA'}, {n:'Зелёный', col:'#3e5a3a', label:'EVER'}, {n:'Ржавый, дырявый', col:'#6a4a36', holes:true}, {n:'Двери открыты', col:'#7a6a3a', open:true}];
  function trashDraw(g, d){ const k = hk(g), c = k.c;
    k.organic(0.5, 0.5, 0.42, 0.35, 0.36); k.fill('#5a4e40', 0.35);
    if(d.bags) for(let i=0;i<3;i++){ const x = k.R(0.25, 0.75), y = k.R(0.25, 0.75); k.organic(x, y, 0.16, 0.25, 0.12); k.c.fillStyle = k.lin(x - 0.15, y - 0.15, x + 0.15, y + 0.15, [[0, '#3a3e36'], [1, '#141512']]); k.c.fill(); }
    if(d.paper) for(let i=0;i<10;i++) fx.paper(k, k.R(0.1, 0.9), k.R(0.1, 0.9), 0.14, 0.1, k.rnd()*6.28, 2);
    if(d.bottles) for(let i=0;i<6;i++) fx.bottle(k, k.R(0.15, 0.85), k.R(0.15, 0.85), k.rnd()*6.28, k.pick(['rgba(60,90,50,.85)', 'rgba(110,70,30,.85)', 'rgba(170,190,180,.6)']));
    k.trash(0.05, 0.05, 0.9, 0.9, 16); if(d.bones) for(let i=0;i<4;i++){ c.save(); c.translate(k.R(0.2, 0.8), k.R(0.2, 0.8)); c.rotate(k.rnd()*6.28); k.rr(-0.07, -0.01, 0.14, 0.02, 0.01); k.fill('#d8d0b8'); c.restore(); } }
  const TRASH = [{n:'Мешки', bags:true}, {n:'Бумага и банки', paper:true}, {n:'Бутылки', bottles:true}, {n:'Объедки, кости', bones:true, bags:true}];
  function barricadeDraw(g, d){ const k = hk(g), c = k.c;
    if(d.furniture){ fx.chair(k, 0.3, 0.45, 0.8, 'wood'); c.save(); c.translate(1.15, 0.5); c.rotate(-0.15); fx.wood(k, -0.55, -0.3, 1.1, 0.6, '#5a4030', 0.02); c.restore(); fx.chair(k, 1.75, 0.55, -2.2, 'wood'); houseBits.crate(k, 0.75, 0.2, 0.3, 0.25, 0.3); k.plank(1.0, 0.85, 1.6, 0.1, 0.05, '#6a5236', true); return; }
    for(let i=0;i<5;i++) k.plank(1.0 + k.R(-0.1, 0.1), 0.25 + i*0.13, k.R(1.5, 1.9), 0.11, k.R(-0.12, 0.12), k.pick(['#6a5236', '#5e4630', '#7a6040']), k.rnd() < 0.4);
    [0.2, 1.0, 1.8].forEach(x=>{ k.line([x - 0.15, 0.15, x + 0.15, 0.85], '#4a3624', 0.07); k.line([x + 0.15, 0.15, x - 0.15, 0.85], '#4a3624', 0.07); });
    if(d.mixed){ bits.sheet(k, [0.6, 0.15, 1.2, 0.12, 1.25, 0.5, 0.62, 0.52], '#6a4a36', true); k.tire(1.65, 0.3, 0.15); for(let i=0;i<10;i++) k.line([0.1 + i*0.2, 0.1, 0.18 + i*0.2, 0.18], '#7a7e80', 0.008); } }
  const BARRICADE = [{n:'Из досок'}, {n:'Из мебели', furniture:true}, {n:'Доски и железо', mixed:true}];
  function carBarricadeDraw(g, d){ const k = hk(g), c = k.c;
    c.save(); c.translate(0.1, 0.0); c.rotate(-1.3); c.translate(-1.1, 0.35); carDraw({ctx:c, rnd:k.rnd}, CAR_VARIANTS[d.a]); c.restore();
    c.save(); c.translate(1.55, 1.6); c.rotate(-1.75); carDraw({ctx:c, rnd:k.rnd}, CAR_VARIANTS[d.b]); c.restore();
    if(d.bags) for(let i=0;i<5;i++) houseBits.sandbag(k, 2.2 + (i%2)*0.2, 0.3 + i*0.3, 1.4); if(d.wire) for(let i=0;i<6;i++){ c.beginPath(); c.ellipse(0.4 + i*0.45, 1.85, 0.2, 0.1, 0, 0, 6.28); k.stroke('#3e4244', 0.014); } k.trash(0, 0, 3, 2, 10); }
  const CAR_BARRICADE = [{n:'Две легковушки', a:7, b:5, bags:true}, {n:'С колючкой', a:13, b:7, wire:true}, {n:'Сгоревшие', a:7, b:13}];
  function bearTrapDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    if(d.blood) k.blot(0.55, 0.55, 0.28, '#5a1a14', 0.55);
    k.line([x, y, 0.92, 0.85], '#3e4244', 0.012); c.beginPath(); c.arc(0.92, 0.85, 0.03, 0, 6.28); k.fill('#3e4244');
    c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.3, 0, 6.28); k.stroke('rgba(0,0,0,.35)', 0.04);
    if(d.closed){ c.beginPath(); c.ellipse(x, y, 0.3, 0.1, 0, 0, 6.28); k.stroke('#5a5e60', 0.035); for(let i=0;i<9;i++) k.fillP([x - 0.26 + i*0.065, y - 0.02, x - 0.23 + i*0.065, y + 0.06, x - 0.2 + i*0.065, y - 0.02], '#8a8e90'); }
    else { c.beginPath(); c.arc(x, y, 0.3, 0, 6.28); k.stroke(d.rust ? '#6a4a36' : '#5a5e60', 0.035); c.beginPath(); c.arc(x - 0.006, y - 0.006, 0.3, 3.4, 5.6); k.stroke('rgba(255,255,255,.25)', 0.008); for(let i=0;i<16;i++){ const a = i/16*6.28; k.fillP([x + Math.cos(a - 0.12)*0.29, y + Math.sin(a - 0.12)*0.29, x + Math.cos(a)*0.21, y + Math.sin(a)*0.21, x + Math.cos(a + 0.12)*0.29, y + Math.sin(a + 0.12)*0.29], d.rust ? '#7a5a40' : '#9aa0a2'); } c.beginPath(); c.arc(x, y, 0.08, 0, 6.28); k.fill('#3a3e40'); k.stroke(k.INK, 0.006); k.line([x - 0.3, y, x + 0.3, y], '#4a4e50', 0.02); }
    if(d.rust) for(let i=0;i<5;i++) k.rust(x + k.R(-0.25, 0.25), y + k.R(-0.25, 0.25), 0.03, false); }
  const BEAR = [{n:'Взведён'}, {n:'Сработал, кровь', closed:true, blood:true}, {n:'Ржавый', rust:true}];
  function tripDraw(g, d){ const k = hk(g), c = k.c;
    [[0.1, 0.5], [2.9, 0.5]].forEach(([x, y])=>{ c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.05, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, 0.045, 0, 6.28); k.fill('#5e4630'); });
    k.line([0.12, 0.53, 2.92, 0.51], 'rgba(0,0,0,.35)', 0.016); k.line([0.1, 0.5, 2.9, 0.48], '#5a5e60', 0.014); k.line([0.1, 0.495, 2.9, 0.475], 'rgba(235,230,220,.6)', 0.005);
    if(d.cans) for(let i=0;i<5;i++){ const x = 0.5 + i*0.5; k.line([x, 0.49, x, 0.62], '#8a8478', 0.004); fx.can(k, x, 0.66, 0.04); }
    else { c.beginPath(); c.arc(0.25, 0.62, 0.07, 0, 6.28); c.fillStyle = k.lin(0.18, 0.55, 0.32, 0.69, [[0, '#6a7a4a'], [1, '#2a3a1e']]); c.fill(); k.stroke(k.INK, 0.006); for(let i=0;i<4;i++) k.line([0.19, 0.58 + i*0.025, 0.31, 0.58 + i*0.025], 'rgba(0,0,0,.35)', 0.004); k.rr(0.22, 0.52, 0.06, 0.04, 0.01); k.fill('#9a9e8a'); k.line([0.25, 0.53, 0.18, 0.5], '#c8b070', 0.006); }
    if(d.hidden) k.tufts(0, 0, 3, 1, 22); }
  const TRIP = [{n:'С гранатой'}, {n:'С банками-сигнализацией', cans:true}, {n:'Спрятана в траве', hidden:true}];
  function landmineDraw(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    k.organic(x, y, 0.32, 0.3); k.texFill('dirt', '#776753'); if(d.flag){ k.line([0.85, 0.85, 0.85, 0.35], '#5e4630', 0.02); k.fillP([0.85, 0.35, 0.6, 0.42, 0.85, 0.5], '#c8a030'); }
    if(d.ap){ c.beginPath(); c.arc(x, y, 0.09, 0, 6.28); c.fillStyle = k.lin(x - 0.09, y - 0.09, x + 0.09, y + 0.09, [[0, '#7a8064'], [1, '#3a3e2e']]); c.fill(); k.stroke(k.INK, 0.006); c.beginPath(); c.arc(x, y, 0.03, 0, 6.28); k.fill('#2a2e22'); for(let i=0;i<3;i++) k.line([x, y, x + Math.cos(i*2.1)*0.06, y + Math.sin(i*2.1)*0.06], '#9a9e8a', 0.008); return; }
    c.beginPath(); c.arc(x + 0.02, y + 0.03, 0.24, 0, 6.28); k.fill('rgba(0,0,0,.35)'); c.beginPath(); c.arc(x, y, 0.24, 0, 6.28); c.fillStyle = k.lin(x - 0.24, y - 0.24, x + 0.24, y + 0.24, [[0, '#7a8064'], [1, '#3a3e2e']]); c.fill(); k.stroke(k.INK, 0.01); c.beginPath(); c.arc(x, y, 0.16, 0, 6.28); k.stroke('rgba(0,0,0,.4)', 0.01); c.beginPath(); c.arc(x, y, 0.06, 0, 6.28); k.fill('#2a2e22'); k.stroke('#8a8e70', 0.006); for(let i=0;i<3;i++) k.rust(x + k.R(-0.18, 0.18), y + k.R(-0.18, 0.18), 0.03, false); k.organic(x + 0.1, y + 0.15, 0.18, 0.4, 0.06); k.texFill('dirt', '#776753'); }
  const LANDMINE = [{n:'Противотанковая'}, {n:'Противопехотная', ap:true}, {n:'Отмечена флажком', flag:true}];
  function safeDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.14, 0.14, 0.72, 0.72, 0.03, 0.06); k.rr(0.14, 0.14, 0.72, 0.72, 0.03); k.texFill('metal', '#6d7376', '#3a4a40', 0.5); k.stroke(k.INK, 0.012); k.bevel(()=>k.rr(0.14, 0.14, 0.72, 0.72, 0.03), 0.02);
    if(d.open){ k.rr(0.2, 0.2, 0.6, 0.6, 0.02); k.fill('#1a1814'); for(let i=0;i<4;i++){ k.rr(k.R(0.25, 0.55), k.R(0.25, 0.6), 0.2, 0.1, 0.01); k.fill('#6a7a4a'); k.stroke('rgba(0,0,0,.4)', 0.005); } fx.paper(k, 0.6, 0.65, 0.16, 0.12, 0.3, 3); c.save(); c.translate(0.86, 0.86); c.rotate(1.1); k.rr(-0.72, -0.04, 0.72, 0.08, 0.01); k.texFill('metal', '#6d7376', '#3a4a40', 0.5); k.stroke(k.INK, 0.006); c.restore(); return; }
    c.beginPath(); c.arc(0.5, 0.5, 0.13, 0, 6.28); k.fill('#c8c2b0'); k.stroke(k.INK, 0.008); for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([0.5 + Math.cos(a)*0.1, 0.5 + Math.sin(a)*0.1, 0.5 + Math.cos(a)*0.13, 0.5 + Math.sin(a)*0.13], '#2a2826', 0.006); } k.line([0.5, 0.5, 0.5, 0.39], '#8e2e26', 0.01); k.rr(0.68, 0.45, 0.1, 0.1, 0.02); k.fill('#9a8a50');
    if(d.cracked){ for(let i=0;i<5;i++) k.dent(k.R(0.25, 0.75), k.R(0.25, 0.75), 0.08); k.organic(0.32, 0.5, 0.05, 0.5); k.fill('#141210'); k.radial(0.32, 0.5, 0.12, '#0c0a08', 0.5); } }
  const SAFE = [{n:'Закрыт'}, {n:'Открыт, деньги и бумаги', open:true}, {n:'Взломан', cracked:true}];
  function terminalDraw(g, d){ const k = hk(g), c = k.c;
    fx.enamel(k, 0.12, 0.1, 0.76, 0.56, '#b8b2a0', 0.04); k.rr(0.2, 0.16, 0.6, 0.38, 0.03); k.fill('#121614');
    if(!d.broken){ k.radial(0.5, 0.35, 0.35, '#7ad28a', d.dead ? 0 : 0.35); if(!d.dead){ c.save(); c.fillStyle = 'rgba(150,240,160,.85)'; c.font = '600 0.045px monospace'; ['> STATUS: OK', '> DOOR 7: LOCK', '> _'].forEach((t, i)=>c.fillText(t, 0.24, 0.24 + i*0.07)); c.restore(); } }
    else { for(let i=0;i<8;i++) k.line([0.5, 0.35, 0.5 + k.R(-0.28, 0.28), 0.35 + k.R(-0.17, 0.17)], 'rgba(220,228,228,.5)', 0.004); }
    keyboard(k, 0.5, 0.78, 0); xb.cable(k, [0.85, 0.4, 0.95, 0.6, 0.9, 0.95], '#1a1816', 0.016); if(d.broken) xb.cable(k, [0.15, 0.3, 0.05, 0.6, 0.12, 0.95], '#8a3a2e', 0.012); }
  const TERMINAL = [{n:'Работает'}, {n:'Погас', dead:true}, {n:'Разбит, искрит', broken:true}];
  function radioDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.14, 0.24, 0.72, 0.52, 0.03); k.rr(0.14, 0.24, 0.72, 0.52, 0.03); k.texFill('metal', '#6d7376', d.ham ? '#3a3a3a' : '#4e5a34', 0.55); k.stroke(k.INK, 0.01);
    k.rr(0.2, 0.3, 0.3, 0.16, 0.01); k.fill(d.broken ? '#1a1612' : '#1e2a1e'); if(!d.broken){ for(let i=0;i<10;i++) k.line([0.22 + i*0.026, 0.4, 0.22 + i*0.026, 0.4 - k.R(0.02, 0.07)], '#8ad890', 0.006); }
    [[0.62, 0.36], [0.75, 0.36], [0.62, 0.6], [0.75, 0.6]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#1e1c1a'); k.stroke('#6a6e70', 0.006); k.line([x, y, x + 0.02, y - 0.03], '#c8c2b0', 0.006); }); for(let i=0;i<5;i++) k.line([0.2, 0.52 + i*0.04, 0.5, 0.52 + i*0.04], 'rgba(0,0,0,.4)', 0.01);
    k.line([0.8, 0.26, 0.95, 0.04], '#2a2826', 0.012); if(d.ham){ xb.cable(k, [0.2, 0.75, 0.15, 0.9, 0.35, 0.95], '#1a1816', 0.01); c.beginPath(); c.arc(0.4, 0.92, 0.05, 0, 6.28); k.fill('#2a2826'); }
    if(d.broken){ k.dent(0.5, 0.5, 0.12); k.line([0.25, 0.75, 0.15, 0.95], '#8a3a2e', 0.008); } }
  const RADIO = [{n:'Армейская'}, {n:'Любительская, с микрофоном', ham:true}, {n:'Разбита', broken:true}];
  function medkitDraw(g, d){ const k = hk(g), c = k.c;
    fx.sh(k, 0.18, 0.24, 0.64, 0.52, 0.06); k.rr(0.18, 0.24, 0.64, 0.52, 0.06); c.fillStyle = k.lin(0.18, 0.24, 0.82, 0.76, [[0, '#e4ded0'], [1, '#a8a294']]); c.fill(); k.stroke(k.INK, 0.01);
    if(d.open || d.empty){ k.rr(0.22, 0.28, 0.56, 0.44, 0.04); k.fill('#c8c2b4'); if(!d.empty){ k.rr(0.27, 0.33, 0.18, 0.08, 0.02); k.fill('#e8e4d8'); k.stroke('rgba(0,0,0,.3)', 0.004); for(let i=0;i<3;i++){ k.rr(0.5 + i*0.08, 0.33, 0.05, 0.15, 0.02); k.fill(k.pick(['#c8b080', '#a8c0c8', '#d8d0c0'])); k.stroke('rgba(0,0,0,.3)', 0.004); } k.rr(0.28, 0.5, 0.16, 0.16, 0.06); k.fill('#d8d4c8'); k.stroke('rgba(0,0,0,.3)', 0.004); k.line([0.55, 0.6, 0.72, 0.62], '#5a8a9a', 0.02); } c.save(); c.translate(0.5, 0.24); k.rr(-0.32, -0.2, 0.64, 0.2, 0.05); k.fill('#d8d2c4'); k.stroke(k.INK, 0.008); c.restore(); }
    else { k.rr(0.42, 0.34, 0.16, 0.32, 0.01); k.fill('#a8352b'); k.rr(0.34, 0.42, 0.32, 0.16, 0.01); k.fill('#a8352b'); k.rr(0.42, 0.2, 0.16, 0.06, 0.02); k.fill('#5a5e60'); }
    if(d.empty) k.trash(0.05, 0.75, 0.9, 0.2, 4); }
  const MEDKIT = [{n:'Закрыта'}, {n:'Открыта, бинты и ампулы', open:true}, {n:'Пустая', empty:true}];
  function lampDraw2(g, d){ const k = hk(g), c = k.c, x = 0.5, y = 0.5;
    if(d.oil){ k.radial(x, y, 0.55, '#f0b050', 0.32); c.beginPath(); c.arc(x + 0.03, y + 0.04, 0.16, 0, 6.28); k.fill('rgba(0,0,0,.3)'); c.beginPath(); c.arc(x, y, 0.16, 0, 6.28); k.fill('#5a4a2a'); k.stroke(k.INK, 0.008); c.beginPath(); c.arc(x, y, 0.11, 0, 6.28); k.fill('rgba(240,220,160,.75)'); k.radial(x, y, 0.14, '#fff0b0', 0.85); c.beginPath(); c.arc(x, y - 0.18, 0.07, Math.PI, 0); k.stroke('#3a3836', 0.012); return; }
    c.beginPath(); c.arc(x + 0.04, y + 0.05, 0.12, 0, 6.28); k.fill('rgba(0,0,0,.3)');
    if(d.broken){ c.save(); c.translate(x, y); c.rotate(0.8); k.line([0, 0, 0.42, 0], '#3a3e40', 0.025); c.beginPath(); c.arc(0.42, 0, 0.13, -1.4, 1.4); k.fill('#7a6a4a'); k.stroke(k.INK, 0.006); c.restore(); for(let i=0;i<5;i++) k.fillP((()=>{ const px = k.R(0.6, 0.95), py = k.R(0.6, 0.95); return [px, py, px + 0.03, py + 0.01, px + 0.01, py + 0.03]; })(), 'rgba(230,226,210,.7)'); return; }
    k.radial(x, y, 0.45, '#f0c060', 0.18); c.beginPath(); c.arc(x, y, 0.25, 0, 6.28); c.fillStyle = k.lin(x - 0.25, y - 0.25, x + 0.25, y + 0.25, [[0, '#d8c8a0'], [1, '#8a7a5a']]); c.fill(); k.stroke(k.INK, 0.008); for(let i=0;i<12;i++){ const a = i/12*6.28; k.line([x + Math.cos(a)*0.08, y + Math.sin(a)*0.08, x + Math.cos(a)*0.24, y + Math.sin(a)*0.24], 'rgba(0,0,0,.12)', 0.012); } c.beginPath(); c.arc(x, y, 0.07, 0, 6.28); k.fill('#fff4d0'); k.radial(x, y, 0.12, '#ffe8a0', 0.6); }
  const LAMP2 = [{n:'Керосиновая', oil:true}, {n:'Торшер'}, {n:'Разбит', broken:true}];
  function rugDraw(g, d){ const k = hk(g), c = k.c;
    if(d.skin){ c.save(); c.translate(1, 1.5); k.organic(0, 0, 0.75, 0.25, 1.15); c.fillStyle = k.lin(-0.7, -1, 0.7, 1, [[0, '#8a6a4a'], [1, '#4a3424']]); c.fill(); c.restore(); for(let i=0;i<80;i++) k.line([k.R(0.4, 1.6), k.R(0.5, 2.5), k.R(0.4, 1.6), k.R(0.5, 2.5)].map((v, j)=>j===2 ? v : v), 'rgba(40,26,16,.15)', 0.006); [[0.4, 0.8], [1.6, 0.8], [0.45, 2.3], [1.55, 2.3]].forEach(([x, y])=>{ k.organic(x, y, 0.16, 0.4, 0.1); k.fill('#5a4030'); }); k.organic(1, 0.35, 0.2, 0.2, 0.18); k.fill('#6a5038'); return; }
    const P = [0.1, 0.1, 1.9, 0.1, 1.9, 2.9, 0.1, 2.9]; k.poly(P); k.fill(d.col); c.save(); k.poly(P); c.clip();
    if(d.persian){ k.rr(0.25, 0.25, 1.5, 2.5, 0.02); k.stroke('#c8a050', 0.06); k.rr(0.38, 0.38, 1.24, 2.24, 0.02); k.stroke('#1e2a4a', 0.04); c.beginPath(); c.ellipse(1, 1.5, 0.45, 0.8, 0, 0, 6.28); k.fill('#1e2a4a'); c.beginPath(); c.ellipse(1, 1.5, 0.3, 0.55, 0, 0, 6.28); k.fill('#c8a050'); c.beginPath(); c.ellipse(1, 1.5, 0.15, 0.3, 0, 0, 6.28); k.fill('#7a2a24'); for(let i=0;i<20;i++){ const a = i/20*6.28; c.beginPath(); c.arc(1 + Math.cos(a)*0.55, 1.5 + Math.sin(a)*0.95, 0.03, 0, 6.28); k.fill('#c8a050'); } }
    else { for(let i=0;i<12;i++) k.line([0.1, 0.25 + i*0.22, 1.9, 0.25 + i*0.22], 'rgba(0,0,0,.12)', 0.05); }
    c.fillStyle = 'rgba(255,240,210,.12)'; c.fillRect(0, 0, 2, 3); for(let i=0;i<4;i++) k.blot(k.R(0.4, 1.6), k.R(0.4, 2.6), k.R(0.12, 0.3), '#3a2a1c', 0.3); k.organic(1.2, 2.2, 0.35, 0.4, 0.5); k.fill('rgba(255,245,220,.15)'); c.restore();
    for(let i=0;i<20;i++){ const x = 0.15 + i*0.09; k.line([x, 0.1, x, 0.02], '#d8c8a0', 0.01); k.line([x, 2.9, x, 2.98], '#d8c8a0', 0.01); } }
  const RUG = [{n:'Персидский', col:'#7a2a24', persian:true}, {n:'Затёртый', col:'#5a6a5a'}, {n:'Шкура', skin:true}];
  function corpseDraw(g, d){ const k = hk(g), c = k.c;
    if(d.bag){ k.organic(0.5, 1.0, 0.32, 0.1, 0.92); c.fillStyle = k.lin(0.2, 0, 0.8, 0, [[0, '#1e2220'], [0.5, '#3a403a'], [1, '#141614']]); c.fill(); k.stroke(k.INK, 0.008); k.line([0.5, 0.15, 0.5, 1.85], '#8a8e90', 0.012); fx.paper(k, 0.5, 0.25, 0.12, 0.08, 0, 2); return; }
    if(d.skeleton){ bits.skull(k, 0.5, 0.22, 0.1, 0); for(let i=0;i<7;i++){ k.line([0.5, 0.42 + i*0.07, 0.36, 0.45 + i*0.07], '#d8d0b8', 0.015); k.line([0.5, 0.42 + i*0.07, 0.64, 0.45 + i*0.07], '#d8d0b8', 0.015); } k.line([0.5, 0.35, 0.5, 1.0], '#d8d0b8', 0.025); k.organic(0.5, 1.05, 0.12, 0.3, 0.07); k.fill('#d0c8b0'); [[-1], [1]].forEach(([s])=>{ k.line([0.5 + s*0.08, 1.08, 0.5 + s*0.14, 1.5, 0.5 + s*0.12, 1.9], '#d8d0b8', 0.025); k.line([0.5 + s*0.12, 0.42, 0.5 + s*0.3, 0.75, 0.5 + s*0.32, 1.05], '#d8d0b8', 0.02); }); k.leaves(0.1, 0.1, 0.8, 1.8, 10); bits.fabric(k, [0.3, 0.5, 0.7, 0.5, 0.72, 0.95, 0.28, 0.95], '#4a4a3a', 2, 'h'); return; }
    k.blot(0.55, 1.1, 0.4, '#4a1410', 0.55); c.save(); c.translate(0.5, 1); c.rotate(0.1);
    [[-1], [1]].forEach(([s])=>{ k.rr(s*0.1 - 0.06, 0.15, 0.12, 0.75, 0.05); k.fill('#3a3e44'); k.stroke(k.INK, 0.006); k.rr(s*0.1 - 0.06, 0.82, 0.12, 0.12, 0.04); k.fill('#2a2018'); k.line([s*0.18, -0.55, s*0.36, -0.15, s*0.3, 0.15], '#4a5a3a', 0.09); });
    k.rr(-0.2, -0.6, 0.4, 0.8, 0.1); k.fill('#4a5a3a'); k.stroke(k.INK, 0.008); for(let i=0;i<3;i++) k.line([-0.18, -0.4 + i*0.2, 0.18, -0.38 + i*0.2], 'rgba(0,0,0,.25)', 0.01); c.beginPath(); c.arc(0, -0.78, 0.13, 0, 6.28); k.fill('#8a6a50'); k.stroke(k.INK, 0.006); k.organic(0, -0.82, 0.12, 0.3, 0.08); k.fill('#2a1e14'); c.restore(); }
  const CORPSE = [{n:'Тело'}, {n:'Скелет', skeleton:true}, {n:'Мешок для трупа', bag:true}];
  function bloodDraw(g, d){ const k = hk(g), c = k.c;
    if(d.trail){ c.save(); c.globalAlpha = 0.85; for(let i=0;i<10;i++) k.blot(0.1 + i*0.09, 0.15 + i*0.08 + Math.sin(i)*0.04, 0.06 + k.rnd()*0.04, '#5a1612', 0.7, 0.6); c.restore(); k.line([0.1, 0.15, 0.95, 0.9], 'rgba(90,22,18,.45)', 0.08); return; }
    k.blot(0.5, 0.5, d.pool ? 0.38 : 0.2, '#4a120e', 0.85, d.pool ? 0.25 : 0.5); k.blot(0.45, 0.45, d.pool ? 0.28 : 0.12, '#6a1a14', 0.7); if(d.pool) k.line([0.38, 0.38, 0.5, 0.4], 'rgba(255,220,210,.25)', 0.02);
    for(let i=0;i<(d.pool ? 6 : 16);i++){ const a = k.rnd()*6.28, r = k.R(0.22, 0.48); c.beginPath(); c.arc(0.5 + Math.cos(a)*r, 0.5 + Math.sin(a)*r, k.R(0.01, 0.04), 0, 6.28); k.fill('#5a1612', 0.85); } }
  const BLOOD = [{n:'Брызги'}, {n:'Лужа', pool:true}, {n:'След волочения', trail:true}];
  function sleepbagDraw(g, d){ const k = hk(g), c = k.c, col = d.col;
    if(d.rolled){ k.c.save(); k.c.translate(0.5, 1.0); k.c.scale(1.7, 1.7); xb.bedroll(k, 0, 0, Math.PI/2, col); k.c.restore(); return; }
    fx.sh(k, 0.15, 0.1, 0.7, 1.8, 0.25, 0.05); k.rr(0.15, 0.1, 0.7, 1.8, 0.25); c.fillStyle = k.lin(0.15, 0, 0.85, 0, [[0, shade(col, -0.3)], [0.5, shade(col, 0.15)], [1, shade(col, -0.35)]]); c.fill(); k.stroke(k.INK, 0.008);
    for(let i=1;i<9;i++) k.line([0.17, 0.1 + i*0.2, 0.83, 0.1 + i*0.2], 'rgba(0,0,0,.2)', 0.012); k.line([0.82, 0.3, 0.82, 1.7], '#2a2826', 0.012, null, [0.02, 0.01]);
    if(d.person){ k.organic(0.5, 0.28, 0.13, 0.15, 0.11); k.fill('#6a4a34'); k.radial(0.5, 1.0, 0.4, '#000000', 0.15); bits.fabric(k, [0.25, 0.4, 0.75, 0.4, 0.78, 0.6, 0.22, 0.6], shade(col, 0.2), 2, 'v'); }
    if(d.torn){ k.organic(0.5, 1.2, 0.15, 0.6, 0.2); k.fill('#d8d0b8'); k.trash(0.1, 1.5, 0.8, 0.45, 3); }
    k.rr(0.25, 0.12, 0.5, 0.18, 0.06); k.fill(shade(col, 0.1)); k.stroke('rgba(0,0,0,.3)', 0.005); }
  const SLEEPBAG = [{n:'Расстелен', col:'#4a5a3a'}, {n:'Кто-то спит', col:'#3e5a6a', person:true}, {n:'Рваный', col:'#7a4a36', torn:true}, {n:'Скатан', col:'#5a5a48', rolled:true}];
  function smallTableDraw(g, d){ const k = hk(g), c = k.c;
    if(d.flipped){ c.save(); c.translate(0.5, 0.5); c.rotate(0.5); fx.wood(k, -0.32, -0.32, 0.64, 0.64, '#5a4030', 0.02); [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.04, 0, 6.28); k.fill('#3a2a1c'); }); c.restore(); k.trash(0, 0.7, 1, 0.3, 4); return; }
    if(d.metal){ fx.sh(k, 0.15, 0.15, 0.7, 0.7, 0.03); k.rr(0.15, 0.15, 0.7, 0.7, 0.03); k.texFill('metal', '#6d7376'); k.stroke(k.INK, 0.01); for(let i=0;i<4;i++) k.rust(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.04, false); } else fx.wood(k, 0.15, 0.15, 0.7, 0.7, '#5e4630', 0.03);
    fx.cup(k, 0.35, 0.35, 0.05); fx.candle(k, 0.65, 0.4, 0.03, !d.metal); fx.paper(k, 0.55, 0.65, 0.2, 0.15, 0.3, 4); if(d.metal){ c.beginPath(); c.arc(0.35, 0.65, 0.06, 0, 6.28); k.fill('#3a3836'); for(let i=0;i<5;i++) k.fillP([0.3 + i*0.02, 0.62, 0.32 + i*0.02, 0.6, 0.31 + i*0.02, 0.66], '#a8853a'); } }
  const SMALL_TABLE = [{n:'Деревянный'}, {n:'Металлический', metal:true}, {n:'Опрокинут', flipped:true}];
  function tvDraw(g, d){ const k = hk(g), c = k.c;
    if(d.flat){ k.rr(0.06 + 0.03, 0.42 + 0.04, 0.88, 0.1, 0.01); k.fill('rgba(0,0,0,.3)'); k.rr(0.06, 0.42, 0.88, 0.1, 0.01); k.fill('#1a1c1e'); k.stroke(k.INK, 0.006); k.rr(0.38, 0.52, 0.24, 0.16, 0.02); k.fill('#2a2c2e'); return; }
    fx.wood(k, 0.12, 0.15, 0.76, 0.66, '#4a3626', 0.05); k.rr(0.2, 0.22, 0.48, 0.38, 0.06); k.fill('#141816'); if(d.smashed){ k.organic(0.44, 0.41, 0.15, 0.5, 0.12); k.fill('#000'); for(let i=0;i<8;i++) k.line([0.44, 0.41, 0.44 + k.R(-0.22, 0.22), 0.41 + k.R(-0.18, 0.18)], 'rgba(220,228,228,.55)', 0.004); } else { k.radial(0.4, 0.35, 0.2, '#8aa0a0', 0.15); c.beginPath(); c.moveTo(0.25, 0.3); c.lineTo(0.4, 0.28); k.stroke('rgba(255,255,255,.3)', 0.01); }
    [[0.77, 0.3], [0.77, 0.42]].forEach(([x, y])=>{ c.beginPath(); c.arc(x, y, 0.035, 0, 6.28); k.fill('#c8b890'); k.stroke(k.INK, 0.005); }); for(let i=0;i<4;i++) k.line([0.72, 0.5 + i*0.05, 0.84, 0.5 + i*0.05], 'rgba(0,0,0,.4)', 0.01); k.line([0.35, 0.15, 0.25, 0.02], '#5a5e60', 0.01); k.line([0.45, 0.15, 0.58, 0.03], '#5a5e60', 0.01); }
  const TV = [{n:'Ламповый'}, {n:'Плоский', flat:true}, {n:'Разбит', smashed:true}];
  function shelfDraw(g, d){ const k = hk(g), c = k.c;
    if(d.fallen){ c.save(); c.translate(1, 0.55); c.rotate(0.15); fx.wood(k, -0.95, -0.35, 1.9, 0.7, '#5a4030', 0.02); c.restore(); for(let i=0;i<18;i++) fx.book(k, k.R(0.1, 1.9), k.R(0.6, 0.98), 0.12, 0.16, k.rnd()*6.28); for(let i=0;i<6;i++) fx.paper(k, k.R(0.1, 1.9), k.R(0.7, 0.98), 0.12, 0.15, k.rnd()*6.28, 3); return; }
    fx.wood(k, 0.04, 0.2, 1.92, 0.6, '#5a4030', 0.02); for(let i=1;i<4;i++) k.line([0.04 + i*0.48, 0.2, 0.04 + i*0.48, 0.8], 'rgba(0,0,0,.45)', 0.025);
    for(let s=0;s<4;s++){ const x0 = 0.08 + s*0.48; fx.spines(k, x0, 0.28, d.half && s%2 ? 0.2 : 0.42, 0.46, d.half ? 5 : 12, s===2); }
    if(d.half){ fx.book(k, 1.3, 0.92, 0.16, 0.22, 0.4); fx.paper(k, 0.5, 0.9, 0.15, 0.12, 0.6, 3); } }
  const SHELF = [{n:'Полный'}, {n:'Полупустой', half:true}, {n:'Упал, книги рассыпаны', fallen:true}];
  function coverDraw(g, d){ const k = hk(g), c = k.c;
    const P = d.broken ? [0.05, 0.25, 0.95, 0.22, 1.1, 0.35, 1.25, 0.25, 1.95, 0.25, 1.95, 0.75, 0.05, 0.75] : [0.05, 0.25, 1.95, 0.25, 1.95, 0.75, 0.05, 0.75];
    k.fillP(P.map((v, i)=>v + (i%2 ? 0.09 : 0.07)), 'rgba(0,0,0,.4)'); k.poly(P); k.texFill('concrete', '#8a8780'); c.save(); k.poly(P); c.clip(); k.concreteDetail(0.05, 0.25, 1.9, 0.5, 0.5); if(d.graffiti) k.graffiti(0.2, 0.32, 1.4, 0.3, '#3a6a8a'); c.restore(); k.poly(P); k.stroke(k.INK, 0.012); k.bevel(()=>k.poly(P), 0.03);
    bits.casings(k, 0.1, 0.78, 1.8, 0.2, d.fight ? 18 : 4); if(d.broken){ for(let i=0;i<6;i++) k.rebar([k.R(0.9, 1.3), 0.3, k.R(0.9, 1.3), k.R(0.1, 0.25)]); for(let i=0;i<8;i++) k.chunk(k.R(0.9, 1.4), k.R(0.0, 0.2), 0.05, '#8a8780', 0.02); } if(d.fight) xb.craters(k, [0.5, 0.3, 1.0, 0.3, 1.5, 0.3], 10, 0.03); }
  const COVER = [{n:'Бетонный блок', graffiti:true}, {n:'Со следами боя', fight:true}, {n:'Расколот', broken:true}];
  function tireStackDraw(g, d){ const k = hk(g), c = k.c;
    if(d.scatter){ [[0.3, 0.3], [0.7, 0.35], [0.45, 0.72]].forEach(([x, y])=>k.tire(x, y, 0.2)); return; }
    if(d.burning){ k.radial(0.5, 0.5, 0.6, '#1a1612', 0.45); }
    for(let i=0;i<4;i++) k.tire(0.5 - i*0.015, 0.5 - i*0.02, 0.36 - i*0.005);
    if(d.burning){ bits.fire(k, 0.5, 0.45, 0.22, 1); for(let i=0;i<4;i++) k.blot(k.R(0.2, 0.8), k.R(0.2, 0.8), 0.08, '#1a1612', 0.5); } else { k.c.beginPath(); k.c.arc(0.44, 0.44, 0.17, 0, 6.28); k.fill('#141210'); k.puddle(0.44, 0.44, 0.1, 0.1); } }
  const TIRES = [{n:'Стопка'}, {n:'Раскиданы', scatter:true}, {n:'Горят', burning:true}];

  A('door', 'Дверь', 'props', 1, 1, {t:'дверь вход проём', v:DOOR.length, vn:VN(DOOR), hd:true}, (g, v)=>doorDraw(g, PV(DOOR, v)));
  A('double_door', 'Двойная дверь', 'props', 2, 1, {t:'дверь двойная ворота', v:DDOOR.length, vn:VN(DDOOR), hd:true}, (g, v)=>dDoorDraw(g, PV(DDOOR, v)));
  A('window', 'Окно', 'props', 1, 1, {t:'окно стекло проём', v:WINDOW.length, vn:VN(WINDOW), hd:true}, (g, v)=>windowDraw(g, PV(WINDOW, v)));
  A('gate_metal', 'Металлические ворота', 'props', 3, 1, {t:'ворота гараж металл', v:GATE2.length, vn:VN(GATE2), hd:true}, (g, v)=>gateDraw2(g, PV(GATE2, v)));
  A('stairs', 'Лестница', 'props', 2, 3, {t:'лестница ступени подъём', v:STAIRS.length, vn:VN(STAIRS), hd:true}, (g, v)=>stairsDraw(g, PV(STAIRS, v)));
  A('ladder', 'Приставная лестница', 'props', 1, 2, {t:'лестница стремянка', v:LADDER.length, vn:VN(LADDER), hd:true}, (g, v)=>ladderDraw(g, PV(LADDER, v)));
  A('partition', 'Перегородка', 'props', 2, 1, {t:'перегородка ширма стена', v:PARTITION.length, vn:VN(PARTITION), hd:true}, (g, v)=>partitionDraw(g, PV(PARTITION, v)));
  A('crate_wood', 'Деревянный ящик', 'props', 1, 1, {t:'ящик деревянный груз', v:CRATE_W.length, vn:VN(CRATE_W), hd:true}, (g, v)=>crateWoodDraw(g, PV(CRATE_W, v)));
  A('crate_metal', 'Металлический ящик', 'props', 1, 1, {t:'ящик металл контейнер', v:CRATE_M.length, vn:VN(CRATE_M), hd:true}, (g, v)=>crateMetalDraw(g, PV(CRATE_M, v)));
  A('barrel', 'Бочка', 'props', 1, 1, {t:'бочка', v:BARREL.length, vn:VN(BARREL), hd:true}, (g, v)=>barrelPropDraw(g, PV(BARREL, v)));
  A('barrel_toxic', 'Бочка с отходами', 'props', 1, 1, {t:'бочка токсичные отходы радиация', v:TOXIC_B.length, vn:VN(TOXIC_B), hd:true}, (g, v)=>toxicBarrelDraw(g, PV(TOXIC_B, v)));
  A('shipping_container', 'Морской контейнер', 'props', 2, 5, {t:'контейнер морской склад', v:CONTAINER.length, vn:VN(CONTAINER), hd:true}, (g, v)=>containerDraw(g, PV(CONTAINER, v)));
  A('trash', 'Мусор', 'props', 1, 1, {t:'мусор хлам обломки', g:true, v:TRASH.length, vn:VN(TRASH), hd:true}, (g, v)=>trashDraw(g, PV(TRASH, v)));
  A('barricade', 'Баррикада из досок', 'props', 2, 1, {t:'баррикада доски укрытие', v:BARRICADE.length, vn:VN(BARRICADE), hd:true}, (g, v)=>barricadeDraw(g, PV(BARRICADE, v)));
  A('barricade_car', 'Баррикада из машин', 'props', 3, 2, {t:'баррикада машины заслон', v:CAR_BARRICADE.length, vn:VN(CAR_BARRICADE), hd:true}, (g, v)=>carBarricadeDraw(g, PV(CAR_BARRICADE, v)));
  A('bear_trap', 'Капкан', 'props', 1, 1, {t:'капкан ловушка', v:BEAR.length, vn:VN(BEAR), hd:true}, (g, v)=>bearTrapDraw(g, PV(BEAR, v)));
  A('tripwire', 'Растяжка', 'props', 3, 1, {t:'растяжка ловушка граната', v:TRIP.length, vn:VN(TRIP), hd:true}, (g, v)=>tripDraw(g, PV(TRIP, v)));
  A('landmine', 'Мина', 'props', 1, 1, {t:'мина взрывчатка ловушка', v:LANDMINE.length, vn:VN(LANDMINE), hd:true}, (g, v)=>landmineDraw(g, PV(LANDMINE, v)));
  A('safe', 'Сейф', 'props', 1, 1, {t:'сейф тайник', v:SAFE.length, vn:VN(SAFE), hd:true}, (g, v)=>safeDraw(g, PV(SAFE, v)));
  A('terminal', 'Компьютерный терминал', 'props', 1, 1, {t:'терминал компьютер консоль', v:TERMINAL.length, vn:VN(TERMINAL), hd:true}, (g, v)=>terminalDraw(g, PV(TERMINAL, v)));
  A('radio', 'Радиостанция', 'props', 1, 1, {t:'радио рация связь', v:RADIO.length, vn:VN(RADIO), hd:true}, (g, v)=>radioDraw(g, PV(RADIO, v)));
  A('medkit', 'Аптечка', 'props', 1, 1, {t:'аптечка медицина лечение', v:MEDKIT.length, vn:VN(MEDKIT), hd:true}, (g, v)=>medkitDraw(g, PV(MEDKIT, v)));
  A('lamp', 'Лампа', 'props', 1, 1, {t:'лампа свет фонарь', v:LAMP2.length, vn:VN(LAMP2), hd:true, lit:true}, (g, v)=>lampDraw2(g, PV(LAMP2, v)));
  A('rug', 'Ковёр', 'props', 2, 3, {t:'ковёр палас', g:true, v:RUG.length, vn:VN(RUG), hd:true}, (g, v)=>rugDraw(g, PV(RUG, v)));
  A('corpse', 'Тело', 'props', 1, 2, {t:'тело труп мертвец', v:CORPSE.length, vn:VN(CORPSE), hd:true}, (g, v)=>corpseDraw(g, PV(CORPSE, v)));
  A('blood', 'Пятно крови', 'props', 1, 1, {t:'кровь пятно', g:true, v:BLOOD.length, vn:VN(BLOOD), hd:true}, (g, v)=>bloodDraw(g, PV(BLOOD, v)));
  A('sleeping_bag', 'Спальник', 'props', 1, 2, {t:'спальник ночлег лагерь', v:SLEEPBAG.length, vn:VN(SLEEPBAG), hd:true}, (g, v)=>sleepbagDraw(g, PV(SLEEPBAG, v)));
  A('table_small', 'Столик', 'props', 1, 1, {t:'столик стол тумба', v:SMALL_TABLE.length, vn:VN(SMALL_TABLE), hd:true}, (g, v)=>smallTableDraw(g, PV(SMALL_TABLE, v)));
  A('tv', 'Старый телевизор', 'props', 1, 1, {t:'телевизор экран', v:TV.length, vn:VN(TV), hd:true}, (g, v)=>tvDraw(g, PV(TV, v)));
  A('bookshelf', 'Книжный шкаф', 'props', 2, 1, {t:'книги шкаф библиотека', v:SHELF.length, vn:VN(SHELF), hd:true}, (g, v)=>shelfDraw(g, PV(SHELF, v)));
  A('cover_concrete', 'Бетонное укрытие', 'props', 2, 1, {t:'укрытие бетон блок', v:COVER.length, vn:VN(COVER), hd:true}, (g, v)=>coverDraw(g, PV(COVER, v)));
  A('tire_stack', 'Покрышки', 'props', 1, 1, {t:'покрышки шины колёса укрытие', v:TIRES.length, vn:VN(TIRES), hd:true, lit:true}, (g, v)=>tireStackDraw(g, PV(TIRES, v)));

  /* ---------- рисующий API ---------- */
  function shade(hex, k){
    if(typeof hex!=='string' || hex[0]!=='#') return hex;
    const n = parseInt(hex.slice(1), 16); let r = n>>16, g = (n>>8)&255, b = n&255;
    if(k>=0){ r += (255 - r)*k; g += (255 - g)*k; b += (255 - b)*k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return '#' + [r, g, b].map(x=>Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  }
  function mulberry(seed){ let a = seed >>> 0; return function(){ a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1 | a); t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }
  function hashStr(s){ let h = 2166136261; for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  // g — API для рисования ассета в его собственных координатах (клетки). lw — базовая толщина обводки.
  function makeG(ctx, seed, lw, shadow){
    const rnd = mulberry(seed);
    let shadowNext = !!shadow;
    function paint(fill, o){
      o = o || {};
      if(o.alpha!=null) ctx.globalAlpha = o.alpha;
      if(shadowNext && fill){ ctx.save(); ctx.shadowColor = 'rgba(20,16,12,.38)'; ctx.shadowBlur = 0; const sc = ctx.getTransform(); ctx.shadowOffsetX = Math.max(1, sc.a*0.07); ctx.shadowOffsetY = Math.max(1, sc.a*0.09); ctx.fillStyle = fill; ctx.fill(); ctx.restore(); shadowNext = false; }
      else if(fill){ ctx.fillStyle = fill; ctx.fill(); }
      if(o.s !== false){ ctx.lineWidth = lw*(o.lw || 1); ctx.strokeStyle = o.color || 'rgba(24,20,16,.5)'; ctx.stroke(); }
      if(o.alpha!=null) ctx.globalAlpha = 1;
    }
    const g = {
      rnd, shade, ctx, // ctx — для детальных (HD) рисунков: градиенты, кривые
      r(x, y, w, h, fill, o){ o = o || {}; ctx.beginPath();
        if(o.rot){ ctx.save(); ctx.translate(x + w/2, y + h/2); ctx.rotate(o.rot); x = -w/2; y = -h/2; }
        if(o.rad){ const r = Math.min(o.rad, w/2, h/2); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
        else ctx.rect(x, y, w, h);
        paint(fill, o); if(o.rot) ctx.restore(); },
      c(cx, cy, r, fill, o){ ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.001, r), 0, Math.PI*2); paint(fill, o); },
      e(cx, cy, rx, ry, fill, o){ ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, Math.PI*2); paint(fill, o); },
      p(pts, fill, o){ ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for(let i=2;i<pts.length;i+=2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); paint(fill, o); },
      l(pts, color, w, o){ o = o || {}; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for(let i=2;i<pts.length;i+=2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.save(); if(o.alpha!=null) ctx.globalAlpha = o.alpha; if(o.dash) ctx.setLineDash(o.dash); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); ctx.restore(); },
      arc(cx, cy, r, a0, a1, color, w, o){ o = o || {}; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.save(); if(o.dash) ctx.setLineDash(o.dash); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); ctx.restore(); },
      grid(x, y, w, h, nx, ny, color, lwid){ ctx.beginPath(); for(let i=1;i<nx;i++){ ctx.moveTo(x + i*w/nx, y); ctx.lineTo(x + i*w/nx, y + h); } for(let j=1;j<ny;j++){ ctx.moveTo(x, y + j*h/ny); ctx.lineTo(x + w, y + j*h/ny); } ctx.lineWidth = lwid; ctx.strokeStyle = color; ctx.stroke(); },
      // неровное пятно (обломок, лужа, камень) — многоугольник со случайными радиусами
      blob(cx, cy, r, fill, o){ const n = 9, pts = []; for(let i=0;i<n;i++){ const a = i/n*Math.PI*2, rr = r*(0.72 + rnd()*0.38); pts.push(cx + Math.cos(a)*rr, cy + Math.sin(a)*rr); } g.p(pts, fill, o); },
      // россыпь мелких обломков в прямоугольнике
      rub(x, y, w, h, n, colors){ for(let i=0;i<n;i++){ const cx = x + rnd()*w, cy = y + rnd()*h, r = 0.05 + rnd()*0.16, a = rnd()*Math.PI; const k = 3 + Math.floor(rnd()*3), pts = [];
        for(let j=0;j<k;j++){ const aa = a + j/k*Math.PI*2, rr = r*(0.6 + rnd()*0.6); pts.push(cx + Math.cos(aa)*rr, cy + Math.sin(aa)*rr); } g.p(pts, colors[Math.floor(rnd()*colors.length)], {lw:0.6}); } },
      // полосы опасности (жёлто-чёрные)
      hz(x, y, w, h){ ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.fillStyle = P.yel; ctx.fillRect(x, y, w, h); ctx.beginPath(); const s = Math.max(0.12, Math.min(w, h)*0.5);
        for(let t=-h; t<w + h; t+=s*2){ ctx.moveTo(x + t, y + h); ctx.lineTo(x + t + s, y + h); ctx.lineTo(x + t + s + h, y); ctx.lineTo(x + t + h, y); ctx.closePath(); } ctx.fillStyle = P.bk; ctx.fill(); ctx.restore(); },
      glow(cx, cy, r, color){ const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, hexA(color, 0.55)); gr.addColorStop(1, hexA(color, 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill(); },
      spiral(cx, cy, r, a0, color, w){ ctx.beginPath(); for(let t=0;t<=1.0001;t+=0.05){ const a = a0 + t*Math.PI*2.2, rr = r*(1 - t); const x = cx + Math.cos(a)*rr, y = cy + Math.sin(a)*rr; t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); },
    };
    return g;
  }
  function hexA(c, a){ if(typeof c==='string' && c[0]==='#'){ const n = parseInt(c.slice(1), 16); return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`; } if(typeof c==='string' && c.indexOf('rgba(')===0) return c.replace(/,[^,)]*\)$/, ',' + a + ')'); return c; }
  // Нарисовать ассет: ctx уже в координатах карты (1 = клетка). o — объект карты {a,x,y,r,s,v,f}.
  function drawObject(ctx, o, k){
    const a = BY_ID[o.a];
    ctx.save();
    ctx.translate(o.x, o.y);
    if(o.r) ctx.rotate(o.r*Math.PI/180);
    const s = o.s || 1; ctx.scale(o.f ? -s : s, s);
    if(a && a.custom){ // свой объект — картинка как есть (без износа), с мягкой тенью
      if(!a.img){ ctx.lineWidth = 0.03; ctx.setLineDash([0.12, 0.08]); ctx.strokeStyle = a.broken ? 'rgba(168,53,43,.8)' : 'rgba(60,54,46,.7)'; ctx.strokeRect(-a.w/2, -a.h/2, a.w, a.h); ctx.setLineDash([]); ctx.restore(); return; }
      if(!a.g && typeof MapTex!=='undefined' && MapTex.enabled){ const sh = MapTex.shadowFromImage(a); if(sh){ const m = ctx.getTransform(), px = Math.hypot(m.a, m.b), det = m.a*m.d - m.b*m.c, ox = 0.05*px, oy = 0.065*px; if(det){ const lx = (m.d*ox - m.c*oy)/det, ly = (-m.b*ox + m.a*oy)/det; ctx.drawImage(sh.cv, -a.w/2 - sh.pad + lx, -a.h/2 - sh.pad + ly, a.w + sh.pad*2, a.h + sh.pad*2); } } }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(a.img, -a.w/2, -a.h/2, a.w, a.h); ctx.restore(); return; }
    if(!a){ ctx.fillStyle = 'rgba(168,53,43,.5)'; ctx.fillRect(-0.5, -0.5, 1, 1); ctx.restore(); return; } // неизвестный ассет (карта из более новой версии)
    const v = Math.min(a.v - 1, o.v || 0), ps = photoSprite(a, v);
    if(ps){ // реалистичный спрайт этого варианта — картинкой с мягкой тенью, как свой объект
      if(!a.g && typeof MapTex!=='undefined' && MapTex.enabled){ const sh = MapTex.shadowFromImage(ps); if(sh){ const m = ctx.getTransform(), px = Math.hypot(m.a, m.b), det = m.a*m.d - m.b*m.c, ox = 0.05*px, oy = 0.065*px; if(det){ const lx = (m.d*ox - m.c*oy)/det, ly = (-m.b*ox + m.a*oy)/det; ctx.drawImage(sh.cv, -a.w/2 - sh.pad + lx, -a.h/2 - sh.pad + ly, a.w + sh.pad*2, a.h + sh.pad*2); } } }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(ps.img, -a.w/2, -a.h/2, a.w, a.h); ctx.restore(); return; }
    ctx.translate(-a.w/2, -a.h/2);
    if(typeof MapTex!=='undefined' && MapTex.enabled && ctx.getTransform){
      const m = ctx.getTransform(), px = Math.hypot(m.a, m.b); // пикселей холста на клетку объекта
      const sp = MapTex.sprite(a, v, px);
      if(sp){
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
        if(sp.shadow){ // тень всегда падает вниз-вправо по экрану: смещение переводим в координаты повёрнутого объекта
          const det = m.a*m.d - m.b*m.c, ox = 0.05*px, oy = 0.065*px;
          if(det){ const lx = (m.d*ox - m.c*oy)/det, ly = (-m.b*ox + m.a*oy)/det; ctx.drawImage(sp.shadow, -sp.pad + lx, -sp.pad + ly, sp.w, sp.h); } }
        ctx.drawImage(sp.cv, -sp.pad, -sp.pad, sp.w, sp.h);
        ctx.restore(); return;
      }
    }
    const lw = Math.max(0.025, 1.1/Math.max(8, k*s)); // обводка ~1px, но не тоньше 0.025 клетки
    try{ a.draw(makeG(ctx, hashStr(a.id) ^ (v*7919) ^ (o.seed||0), lw, !a.g), v); }catch(e){ console.warn('[Карта] ассет', a.id, e); }
    ctx.restore();
  }
  // Габарит объекта на карте (для выделения и отсечения): полуширина/полувысота с поворотом и масштабом
  function objectBounds(o){
    const a = BY_ID[o.a] || {w:1, h:1}, s = o.s || 1, rad = (o.r||0)*Math.PI/180;
    const hw = a.w*s/2, hh = a.h*s/2, c = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
    const ex = hw*c + hh*sn, ey = hw*sn + hh*c;
    return {x0:o.x - ex, y0:o.y - ey, x1:o.x + ex, y1:o.y + ey, hw, hh};
  }
  const thumbs = {};
  /* ---- реалистичные спрайты: assets/map/sprites (генерируются tools/sprites) — картинка вместо процедурного рисунка ----
     Манифест {version, sprites:{id:{"<вариант>":"файл.webp"}}}; у варианта без картинки — процедурный рисунок. */
  const SPR_DIR = '/assets/map/sprites/', sprImg = {}; let sprMan = null, sprState = 0;
  function sprLoad(){ if(sprState || typeof fetch==='undefined' || typeof location==='undefined' || !/^https?:$/.test(location.protocol)) return; sprState = 1;
    fetch(SPR_DIR + 'manifest.json', {cache:'no-cache'}).then(r=>r.ok ? r.json() : null).then(j=>{ sprMan = j && j.sprites && typeof j.sprites==='object' ? j : {sprites:{}}; sprNotify(); }).catch(()=>{ sprMan = {sprites:{}}; }); }
  let sprT = 0; function sprNotify(){ clearTimeout(sprT); sprT = setTimeout(()=>{ for(const k in thumbs) delete thumbs[k]; try{ window.dispatchEvent(new Event('reincarnator-assets')); }catch(e){} }, 150); }
  function photoSprite(a, v){ sprLoad(); if(!sprMan || a.custom) return null; const m = sprMan.sprites[a.id], f = m && m[v]; if(typeof f!=='string' || !/^[a-z0-9_-]{1,80}\.(webp|png)$/.test(f)) return null;
    const key = a.id + ':' + v; let s = sprImg[key];
    if(!s){ s = sprImg[key] = {w:a.w, h:a.h, img:null, _src:SPR_DIR + f + '?v=' + (Number(sprMan.version) || 1), shadow:null}; const img = new Image(); img.onload = ()=>{ s.img = img; sprNotify(); }; img.src = s._src; }
    return s.img ? s : null; }
  function thumbnail(id, v, size){
    const ca = BY_ID[id]; if(ca && ca.custom){ const dpr = Math.min(2, window.devicePixelRatio || 1), cv = document.createElement('canvas'); cv.width = cv.height = Math.round(size*dpr); cv.style.width = cv.style.height = size + 'px';
      if(ca.img){ const c = cv.getContext('2d'), k = (size*dpr - 6*dpr)/Math.max(ca.w, ca.h), w = ca.w*k, h = ca.h*k; c.imageSmoothingQuality = 'high'; c.drawImage(ca.img, (cv.width - w)/2, (cv.height - h)/2, w, h); } return cv; } // свои — без кэша (картинка может догрузиться)
    const key = id + ':' + (v||0) + ':' + size;
    if(thumbs[key]) return thumbs[key];
    const a = BY_ID[id]; const cv = document.createElement('canvas'); const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(size*dpr); cv.style.width = cv.style.height = size + 'px';
    if(a){ const ctx = cv.getContext('2d'); const k = (size*dpr - 6*dpr)/Math.max(a.w, a.h); ctx.setTransform(k, 0, 0, k, cv.width/2, cv.height/2); drawObject(ctx, {a:id, x:0, y:0, r:0, s:1, v:v||0}, k); }
    return thumbs[key] = cv;
  }
  P.ash = '#5a5550'; P.ash2 = '#4a3a30'; P.sewer = '#4b503f'; P.dirt2 = '#6e5a40'; P.dirt3 = '#7d6548';
  // kit — для дополнений (03b-map-wilds.js): регистрация объектов и те же помощники HD-рисунков
  const kit = {A, hk, fx, bits, xb, hdRock, hdCanopy, hdBranches, VN, PV, shade, P};
  return { P, CATS, LIST, BY_ID, CUSTOM, drawObject, objectBounds, thumbnail, makeG, shade, hexA, hashStr, mulberry, kit };
})();

/* ---------- свои объекты: PNG/WebP/JPG из файлов ----------
   Хранятся в IndexedDB этого браузера (reincarnator_assets_v1): картинка (уменьшенная до 1024 px по большей
   стороне, с прозрачностью) + название, размер в клетках, тип (объект с тенью / наземный). В библиотеке —
   раздел «Свои». Каждый регистрируется в MapAssets.BY_ID с id «u:…», поэтому выбор, поворот, масштаб, сетка
   и стол работают как у встроенных. Карта хранит в doc.assets размер/название и ссылку /user-assets/… —
   её загружает Мастер, отправляя карту на стол; в экспорт .rmap.json картинки встраиваются целиком. */
const CustomAssets = (function(){
  const DB = 'reincarnator_assets_v1', ST = 'assets', ID_RE = /^u:[a-z0-9]{6,40}$/;
  let dbp = null, ready = null;
  function db(){ if(dbp) return dbp; dbp = new Promise((res, rej)=>{ if(typeof indexedDB==='undefined') return rej(new Error('Браузер не поддерживает IndexedDB')); const r = indexedDB.open(DB, 1); r.onupgradeneeded = ()=>{ if(!r.result.objectStoreNames.contains(ST)) r.result.createObjectStore(ST, {keyPath:'id'}); }; r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); }); return dbp; }
  function tx(mode, fn){ return db().then(d=>new Promise((res, rej)=>{ const t = d.transaction(ST, mode), r = fn(t.objectStore(ST)); t.oncomplete = ()=>res(r && r.result); t.onerror = ()=>rej(t.error); t.onabort = ()=>rej(t.error); })); }
  function notify(){ try{ window.dispatchEvent(new Event('reincarnator-assets')); }catch(e){} }
  // запись в библиотеку объектов: тот же интерфейс, что у встроенных (w, h, g, name, v…)
  function makeAsset(m){
    let a = MapAssets.BY_ID[m.id];
    if(!a){ a = {id:m.id, cat:'custom', v:1, custom:true, draw(){}}; MapAssets.BY_ID[m.id] = a; }
    if(!m.ghost && MapAssets.CUSTOM.indexOf(a) < 0){ MapAssets.CUSTOM.push(a); a.deleted = false; }
    a.name = m.name || a.name || 'Свой объект'; a.w = m.w || a.w || 1; a.h = m.h || a.h || 1; a.g = m.g!=null ? !!m.g : !!a.g; a.t = 'свой png ' + (m.tags || '');
    if(m.url) a.url = m.url; a.shadow = null;
    return a;
  }
  function setImage(a, src){ if(!src || a._src===src) return; a._src = src; const img = new Image(); img.onload = ()=>{ a.img = img; a.broken = false; a.shadow = null; notify(); }; img.onerror = ()=>{ a.broken = true; notify(); }; img.src = src; }
  function loadAll(){
    if(ready) return ready;
    ready = tx('readonly', s=>s.getAll()).then(list=>{ (list || []).forEach(r=>{ const a = makeAsset(r); if(r.blob) setImage(a, URL.createObjectURL(r.blob)); }); notify(); return list || []; })
      .catch(e=>{ console.warn('[Свои объекты]', e); return []; });
    return ready;
  }
  const getRec = (id)=>tx('readonly', s=>s.get(id));
  const putRec = (rec)=>tx('readwrite', s=>s.put(rec));
  function newAssetId(){ return 'u:' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toLowerCase(); }
  // картинку — в канвас не больше 1024 px по большей стороне; WebP (если браузер умеет), иначе PNG
  function shrink(img){ return new Promise((res, rej)=>{ const k = Math.min(1, 1024/Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height)), w = Math.max(1, Math.round((img.naturalWidth || img.width)*k)), h = Math.max(1, Math.round((img.naturalHeight || img.height)*k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(img, 0, 0, w, h);
    // синхронно через dataURL (toBlob в фоновых вкладках может не вызвать колбэк): WebP, если браузер умеет, иначе PNG
    let du = cv.toDataURL('image/webp', 0.92); if(du.indexOf('data:image/webp')!==0) du = cv.toDataURL('image/png');
    const comma = du.indexOf(','), mime = du.slice(5, du.indexOf(';')), bin = atob(du.slice(comma + 1)), arr = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
    res({blob:new Blob([arr], {type:mime}), w, h}); }); }
  function loadImage(src){ return new Promise((res, rej)=>{ const img = new Image(); img.onload = ()=>res(img); img.onerror = ()=>rej(new Error('Это не картинка или формат не поддерживается')); img.src = src; }); }
  function fromFile(file, meta){
    if(!/^image\/(png|webp|jpeg|gif|avif)$/.test(file.type || '')) return Promise.reject(new Error('Нужен файл PNG, WebP или JPG'));
    if(file.size > 25*1024*1024) return Promise.reject(new Error('Файл больше 25 МБ'));
    const url = URL.createObjectURL(file);
    return loadImage(url).then(shrink).then(r=>{ URL.revokeObjectURL(url); const rec = Object.assign({id:newAssetId(), created:Date.now(), blob:r.blob, px:[r.w, r.h]}, meta);
      return putRec(rec).then(()=>{ const a = makeAsset(rec); setImage(a, URL.createObjectURL(r.blob)); notify(); return a; }); }, e=>{ URL.revokeObjectURL(url); throw e; });
  }
  function update(id, meta){ return getRec(id).then(rec=>{ const a = MapAssets.BY_ID[id]; if(!rec){ if(a) makeAsset(Object.assign({id}, meta)); notify(); return a; } Object.assign(rec, meta); return putRec(rec).then(()=>{ const x = makeAsset(rec); notify(); return x; }); }); }
  function remove(id){ return tx('readwrite', s=>s.delete(id)).then(()=>{ const a = MapAssets.BY_ID[id]; if(a){ const i = MapAssets.CUSTOM.indexOf(a); if(i >= 0) MapAssets.CUSTOM.splice(i, 1); a.deleted = true; } notify(); }); }
  function blobToDataURL(b){ return new Promise((res, rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(fr.result); fr.onerror = ()=>rej(fr.error); fr.readAsDataURL(b); }); }
  // данные картинки для экспорта: из IndexedDB, а если её там нет (пришла со стола) — из загруженного изображения
  function dataURL(id){ return getRec(id).then(rec=>{ if(rec && rec.blob) return blobToDataURL(rec.blob); const a = MapAssets.BY_ID[id]; if(a && a.img){ const cv = document.createElement('canvas'); cv.width = a.img.naturalWidth; cv.height = a.img.naturalHeight; cv.getContext('2d').drawImage(a.img, 0, 0); return cv.toDataURL('image/png'); } return null; }).catch(()=>null); }
  // импорт из файла карты: встроенные картинки — в библиотеку браузера (если такой ещё нет)
  function importData(id, meta, data){ if(!ID_RE.test(id) || !data) return Promise.resolve(); return getRec(id).then(rec=>{ if(rec) return; return fetch(data).then(r=>r.blob()).then(blob=>putRec(Object.assign({id, created:Date.now(), blob}, meta)).then(()=>{ const a = makeAsset(Object.assign({id}, meta)); setImage(a, URL.createObjectURL(blob)); notify(); })); }).catch(e=>console.warn('[Свои объекты] импорт', id, e)); }
  // Мастер: загрузить картинку на сервер игры, чтобы её увидели игроки
  function upload(id){
    if(typeof session==='undefined' || session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN) return Promise.reject(new Error('Нужна активная сессия Мастера'));
    return getRec(id).then(rec=>{ const a = MapAssets.BY_ID[id]; if(!rec || !rec.blob){ if(a && a.url) return a.url; throw new Error('Картинки «' + (a ? a.name : id) + '» нет в библиотеке этого браузера'); }
      return fetch('/asset-upload', {method:'POST', headers:{'Content-Type':rec.blob.type || 'image/png', 'X-Client-Id':session.myId, 'X-Asset-Id':id.slice(2)}, body:rec.blob})
        .then(r=>r.json().then(j=>{ if(!r.ok || !j.url) throw new Error(j.error || ('Ошибка ' + r.status)); rec.url = j.url; if(a) a.url = j.url; return putRec(rec).then(()=>j.url); })); });
  }
  // объекты карты: размер/название из doc.assets, картинка — встроенная, по ссылке или из библиотеки браузера
  function registerDoc(doc){ const as = doc && doc.assets; if(!as) return; let needLocal = false;
    Object.keys(as).forEach(id=>{ const m = as[id], known = MapAssets.BY_ID[id]; const a = makeAsset(Object.assign({id, ghost:!(known && known.custom && !known.deleted)}, m)); if(a.img) return; if(m.data) setImage(a, m.data); else if(m.url) setImage(a, m.url); else needLocal = true; });
    if(needLocal) loadAll(); }
  function meta(id){ const a = MapAssets.BY_ID[id]; return a ? {name:a.name, w:a.w, h:a.h, g:!!a.g, url:a.url || undefined} : null; }
  function list(){ return MapAssets.CUSTOM.filter(a=>!a.deleted); }
  return { loadAll, fromFile, update, remove, dataURL, importData, upload, registerDoc, meta, list, loadImage, ID_RE };
})();


/* ---------- HD-фактуры: кисти ландшафта, стены, дороги и износ объектов ----------
   Всё процедурное и считается в браузере (без картинок и внешних сервисов), один раз на тип, затем из кэша.
   Ландшафт — бесшовные текстуры 512×512 px на 4×4 клетки (128 px на клетку), привязанные к координатам
   карты: узор не «плывёт» при прокрутке и одинаков в редакторе, на столе и в PNG. Объекты рисуются в
   спрайт нужного разрешения и проходят общий слой износа: серее палитра, грязь, ржавчина, химические
   потёки и разводы, копоть, сколы и царапины, мелкая фактура материала, объём от света.
   Выключается галочкой «HD-фактуры» во вкладке «Карта» редактора (для слабых устройств). */
const MapTex = (function(){
  const mulberry = MapAssets.mulberry, hashStr = MapAssets.hashStr;
  const S = 512, CELLS = 4, C = S/CELLS;           // текстура ландшафта: 512 px = 4 клетки, 128 px на клетку
  const HD_KEY = 'reincarnator_map_hd_v1';
  let enabled = (function(){ try{ return localStorage.getItem(HD_KEY)!=='0'; }catch(e){ return true; } })();
  function setEnabled(v){ enabled = !!v; try{ localStorage.setItem(HD_KEY, enabled ? '1' : '0'); }catch(e){} }
  function canvas(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rgb(hex){ const n = parseInt(hex.slice(1), 16); return [n>>16, (n>>8)&255, n&255]; }
  function mix(a, b, t){ return [a[0] + (b[0] - a[0])*t, a[1] + (b[1] - a[1])*t, a[2] + (b[2] - a[2])*t]; }
  const clamp01 = (t)=>t < 0 ? 0 : t > 1 ? 1 : t;
  const smooth = (a, b, t)=>{ t = clamp01((t - a)/(b - a)); return t*t*(3 - 2*t); };

  /* ---- бесшовный шум ---- */
  // fbm из value noise: решётка base×base, каждая октава вдвое мельче; период = size (бесшовно)
  function noise(size, seed, octaves, base){
    const rnd = mulberry(seed), out = new Float32Array(size*size); let amp = 1, total = 0;
    for(let o=0;o<octaves;o++){
      const n = base << o; if(n > size) break;
      const L = new Float32Array(n*n); for(let i=0;i<L.length;i++) L[i] = rnd();
      const step = size/n;
      for(let y=0;y<size;y++){
        const fy = y/step, y0 = Math.floor(fy), ty = fy - y0, sy = ty*ty*(3 - 2*ty), r0 = (y0%n)*n, r1 = ((y0 + 1)%n)*n, row = y*size;
        for(let x=0;x<size;x++){
          const fx = x/step, x0 = Math.floor(fx), tx = fx - x0, sx = tx*tx*(3 - 2*tx), c0 = x0%n, c1 = (x0 + 1)%n;
          const a = L[r0 + c0] + (L[r0 + c1] - L[r0 + c0])*sx, b = L[r1 + c0] + (L[r1 + c1] - L[r1 + c0])*sx;
          out[row + x] += (a + (b - a)*sy)*amp;
        }
      }
      total += amp; amp *= 0.5;
    }
    for(let i=0;i<out.length;i++) out[i] /= total;
    return out;
  }
  // бесшовные ячейки Вороного: расстояние до границы ячеек (F2 − F1), в пикселях — трещины, плиты, корка
  function cells(size, n, seed, warp){
    const rnd = mulberry(seed), pts = new Float32Array(n*n*2), step = size/n, out = new Float32Array(size*size);
    const wx = warp ? noise(size, seed + 31, 3, 4) : null, wy = warp ? noise(size, seed + 37, 3, 4) : null;
    for(let i=0;i<n*n;i++){ pts[i*2] = 0.1 + rnd()*0.8; pts[i*2 + 1] = 0.1 + rnd()*0.8; }
    for(let y0=0;y0<size;y0++){
      for(let x0=0;x0<size;x0++){ const ii = y0*size + x0, x = wx ? x0 + (wx[ii] - 0.5)*warp*2 : x0, y = wy ? y0 + (wy[ii] - 0.5)*warp*2 : y0;
        const cx = Math.floor(x/step), cy = Math.floor(y/step); let d1 = 1e12, d2 = 1e12;
        for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++){
          const gx = cx + i, gy = cy + j, wi = (((gy%n) + n)%n)*n + (((gx%n) + n)%n);
          const px = (gx + pts[wi*2])*step - x, py = (gy + pts[wi*2 + 1])*step - y, d = px*px + py*py;
          if(d < d1){ d2 = d1; d1 = d; } else if(d < d2) d2 = d;
        }
        out[ii] = Math.sqrt(d2) - Math.sqrt(d1);
      }
    }
    return out;
  }

  /* ---- пиксельная основа: два цвета по шуму + пятна-«заплаты» + ячейки + рябь + зерно + разводы ---- */
  function basePixels(ctx, seed, o){
    const c0 = rgb(o.c0), c1 = rgb(o.c1), rnd = mulberry(seed ^ 0x51ed);
    const n = noise(S, seed, o.oct || 6, o.base || 4), st = noise(S, seed + 2, 3, 2);
    const patches = (o.patches || []).map((p, i)=>({c:rgb(p.c), th:p.th, amt:p.amt, soft:p.soft || 0.12, f:noise(S, seed + 11 + i*7, p.oct || 5, p.base || 4)}));
    const cel = o.cells ? {f:cells(S, o.cells.n, seed + 5, o.cells.warp || 0), w:o.cells.w, c:rgb(o.cells.c), a:o.cells.a, lift:o.cells.lift || 0} : null;
    const rip = o.ripple ? {f:noise(S, seed + 9, 3, 4), kx:o.ripple.kx, ky:o.ripple.ky, warp:o.ripple.warp, a:o.ripple.a} : null;
    const img = ctx.createImageData(S, S), d = img.data, rough = noise(S, seed + 77, 3, 32), bump = o.bump==null ? 1 : o.bump;
    const grain = o.grain==null ? 18 : o.grain, stain = o.stain==null ? 0.22 : o.stain, contrast = o.contrast || 1.4;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const i = y*S + x;
      let c = mix(c0, c1, clamp01((n[i] - 0.5)*contrast + 0.5));
      for(let j=0;j<patches.length;j++){ const p = patches[j], t = smooth(p.th, p.th + p.soft, p.f[i])*p.amt; if(t > 0) c = mix(c, p.c, t); }
      if(cel){ const e = cel.f[i], ww = cel.w*(0.45 + n[i]*1.1); if(e < ww) c = mix(c, cel.c, cel.a*(1 - e/ww)); else if(cel.lift) c = mix(c, [255, 255, 255], cel.lift*smooth(ww, ww*6, e)); }
      if(rip){ const v = Math.sin((rip.kx*x + rip.ky*y)/S*Math.PI*2 + rip.f[i]*rip.warp); c = mix(c, v > 0 ? [255, 250, 240] : [40, 34, 28], Math.abs(v)*Math.abs(v)*rip.a); }
      const xl = y*S + ((x + S - 1)%S), xr = y*S + ((x + 1)%S), yu = ((y + S - 1)%S)*S + x, yd = ((y + 1)%S)*S + x;
      const gx = (n[xr] - n[xl])*6 + (rough[xr] - rough[xl])*1.1, gy = (n[yd] - n[yu])*6 + (rough[yd] - rough[yu])*1.1; // рельеф: крупные бугры + мелкая шероховатость
      const lit = 1 + (gx*0.62 + gy*0.78)*bump*1.3; // склон к свету (сверху-слева) светлее
      const s = st[i] > 0.56 ? (st[i] - 0.56)/0.44 : 0, k = (1 - s*stain)*Math.max(0.6, Math.min(1.4, lit)), g = (rnd() - 0.5)*grain;
      d[i*4] = c[0]*k + g; d[i*4 + 1] = c[1]*k + g; d[i*4 + 2] = c[2]*k + g; d[i*4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return {n, st};
  }

  /* ---- детали поверх основы (бесшовно: у края рисуются и с противоположной стороны) ---- */
  function W(x, y, r, fn){ for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){ const X = x + ox*S, Y = y + oy*S; if(X + r < 0 || X - r > S || Y + r < 0 || Y - r > S) continue; fn(X, Y); } }
  function stains(ctx, rnd, n, r0, r1, color, a0, a1, op){
    ctx.save(); ctx.globalCompositeOperation = op || 'source-over';
    for(let i=0;i<n;i++){ const x = rnd()*S, y = rnd()*S, r = r0 + rnd()*(r1 - r0), a = a0 + rnd()*(a1 - a0), sx = 0.6 + rnd()*0.8;
      W(x, y, r*1.6, (X, Y)=>{ ctx.save(); ctx.translate(X, Y); ctx.scale(sx, 1/sx); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, hexA(color, a)); g.addColorStop(0.6, hexA(color, a*0.55)); g.addColorStop(1, hexA(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill(); ctx.restore(); });
    }
    ctx.restore();
  }
  function pebbles(ctx, rnd, n, r0, r1, cols, shadowA){
    for(let i=0;i<n;i++){ const x = rnd()*S, y = rnd()*S, r = r0 + rnd()*(r1 - r0), col = cols[Math.floor(rnd()*cols.length)], ar = 0.6 + rnd()*0.4, rot = rnd()*Math.PI;
      W(x, y, r + 3, (X, Y)=>{ ctx.save(); ctx.translate(X, Y); ctx.rotate(rot);
        ctx.fillStyle = `rgba(20,17,14,${shadowA==null ? 0.38 : shadowA})`; ctx.beginPath(); ctx.ellipse(r*0.22, r*0.3, r, r*ar, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, r, r*ar, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,252,245,.16)'; ctx.beginPath(); ctx.ellipse(-r*0.28, -r*0.26*ar, r*0.5, r*0.36*ar, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore(); });
    }
  }
  function crackLines(ctx, rnd, n, len, width, color, branch){
    for(let i=0;i<n;i++){
      const walk = (x, y, ang, L, w, depth)=>{
        const pts = [[x, y]]; let travelled = 0;
        while(travelled < L){ const st = 5 + rnd()*9; ang += (rnd() - 0.5)*0.9; x += Math.cos(ang)*st; y += Math.sin(ang)*st; travelled += st; pts.push([x, y]);
          if(branch && depth < 2 && rnd() < 0.08) walk(x, y, ang + (rnd() < 0.5 ? -1 : 1)*(0.6 + rnd()*0.7), L*0.45, w*0.65, depth + 1); }
        let mx = 0, my = 0; pts.forEach(p=>{ mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length;
        W(mx, my, L, (X, Y)=>{ const dx = X - mx, dy = Y - my;
          ctx.beginPath(); pts.forEach((p, j)=>j ? ctx.lineTo(p[0] + dx, p[1] + dy) : ctx.moveTo(p[0] + dx, p[1] + dy));
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(255,250,240,.12)'; ctx.lineWidth = w + 1.6; ctx.stroke();
          ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); });
      };
      walk(rnd()*S, rnd()*S, rnd()*Math.PI*2, len*(0.6 + rnd()*0.8), width*(0.7 + rnd()*0.6), 0);
    }
  }
  function strokes(ctx, rnd, n, l0, l1, w, cols, angBase, angSpread){
    ctx.lineCap = 'round';
    for(let i=0;i<n;i++){ const x = rnd()*S, y = rnd()*S, l = l0 + rnd()*(l1 - l0), a = angBase==null ? rnd()*Math.PI*2 : angBase + (rnd() - 0.5)*angSpread, bend = (rnd() - 0.5)*l*0.5;
      const ex = Math.cos(a)*l, ey = Math.sin(a)*l, col = cols[Math.floor(rnd()*cols.length)];
      W(x, y, l + 2, (X, Y)=>{ ctx.beginPath(); ctx.moveTo(X, Y); ctx.quadraticCurveTo(X + ex/2 - ey/l*bend, Y + ey/2 + ex/l*bend, X + ex, Y + ey); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); });
    }
  }
  function specks(ctx, rnd, n, r0, r1, cols){ for(let i=0;i<n;i++){ const x = rnd()*S, y = rnd()*S, r = r0 + rnd()*(r1 - r0); ctx.fillStyle = cols[Math.floor(rnd()*cols.length)]; W(x, y, r, (X, Y)=>{ ctx.fillRect(X - r/2, Y - r/2, r, r); }); } }
  function hexA(c, a){ if(c[0]==='#'){ const v = rgb(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; } return c; }
  function rivet(ctx, x, y, r){ ctx.fillStyle = 'rgba(15,14,13,.5)'; ctx.beginPath(); ctx.arc(x + 0.8, y + 1, r, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = '#8c9296'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(x - r*0.3, y - r*0.3, r*0.4, 0, Math.PI*2); ctx.fill(); }

  /* ---- рецепты: ландшафт и материалы стен/дорог. Палитра намеренно серее, с усталостью материала ---- */
  const RUST = '#6f4a33', SOOT = '#1d1b19', CHEM = '#8f9150', LIME = '#c9c4ae';
  const R = {
    sand(c, rnd, s){ basePixels(c, s, {c0:'#b8a989', c1:'#9f927a', base:4, grain:20, stain:0.15, ripple:{kx:5, ky:2, warp:7, a:0.13}, patches:[{c:'#8e8576', th:0.62, amt:0.35}]});
      specks(c, rnd, 900, 1, 2.2, ['rgba(80,72,60,.5)', 'rgba(240,232,214,.5)', 'rgba(110,104,96,.45)']); pebbles(c, rnd, 26, 2, 5, ['#8b857b', '#9c958a', '#6f6a63']); stains(c, rnd, 4, 20, 50, '#6a6155', 0.12, 0.2, 'multiply'); },
    dust(c, rnd, s){ basePixels(c, s, {c0:'#a09380', c1:'#877b69', base:4, grain:16, cells:{n:11, w:1.8, c:'#3d352c', a:0.8, lift:0.07, warp:12}, patches:[{c:'#b4aa98', th:0.6, amt:0.4}]});
      pebbles(c, rnd, 40, 1.5, 4, ['#7d766c', '#948d82', '#625c55']); specks(c, rnd, 500, 1, 2, ['rgba(60,52,44,.45)', 'rgba(220,212,196,.4)']); },
    dirt(c, rnd, s){ basePixels(c, s, {c0:'#776753', c1:'#5e5143', base:5, grain:22, contrast:1.7, patches:[{c:'#4a3f34', th:0.6, amt:0.5}, {c:'#8a7d6a', th:0.66, amt:0.35, base:8}]});
      pebbles(c, rnd, 70, 1.5, 5, ['#6e675e', '#837b70', '#55504a', '#5f5245']); strokes(c, rnd, 40, 6, 18, 1.2, ['rgba(52,42,32,.6)', 'rgba(90,76,60,.5)']); specks(c, rnd, 700, 1, 2.4, ['rgba(40,33,26,.5)', 'rgba(150,138,120,.4)']); },
    mud(c, rnd, s){ basePixels(c, s, {c0:'#51473d', c1:'#3f372f', base:4, grain:12, contrast:1.6, patches:[{c:'#373831', th:0.62, amt:0.55}, {c:'#6b6052', th:0.7, amt:0.3, base:8}]});
      stains(c, rnd, 18, 8, 26, '#d6d8d4', 0.05, 0.12); // влажные блики
      for(let i=0;i<2;i++){ const y = rnd()*S, a = (rnd() - 0.5)*0.4; c.save(); c.globalAlpha = 0.35; for(let x=-20;x<S + 20;x+=9){ const yy = y + x*a; W(x, yy, 8, (X, Y)=>{ c.fillStyle = '#2a241e'; c.fillRect(X, Y - 10, 5, 3); c.fillRect(X, Y + 8, 5, 3); }); } c.restore(); } },
    grass(c, rnd, s){ basePixels(c, s, {c0:'#6f6a50', c1:'#5c5843', base:5, grain:14, patches:[{c:'#7a6a52', th:0.64, amt:0.6}]});
      strokes(c, rnd, 2600, 5, 13, 1.1, ['#8f8a64', '#7c785a', '#a29c74', '#6a664c', '#8a8060', '#9a9070'], -Math.PI/2, 1.6);
      strokes(c, rnd, 500, 4, 9, 1, ['rgba(40,36,26,.5)'], -Math.PI/2, 1.8); pebbles(c, rnd, 12, 2, 4, ['#7a746a', '#8c857a']); },
    mutant(c, rnd, s){ basePixels(c, s, {c0:'#5a5260', c1:'#463f4b', base:4, grain:14, patches:[{c:'#6e6070', th:0.6, amt:0.5}, {c:'#4d5246', th:0.68, amt:0.35}]});
      crackLines(c, rnd, 14, 120, 2.2, 'rgba(120,96,124,.55)', true); crackLines(c, rnd, 20, 60, 1.2, 'rgba(160,140,150,.35)', true);
      for(let i=0;i<70;i++){ const x = rnd()*S, y = rnd()*S, r = 2 + rnd()*6; W(x, y, r + 2, (X, Y)=>{ c.fillStyle = 'rgba(30,24,32,.45)'; c.beginPath(); c.arc(X + 1, Y + 1.5, r, 0, Math.PI*2); c.fill(); c.fillStyle = rnd() < 0.5 ? '#86737a' : '#7a6e66'; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.fill(); c.fillStyle = 'rgba(230,220,200,.35)'; c.beginPath(); c.arc(X - r*0.35, Y - r*0.35, r*0.35, 0, Math.PI*2); c.fill(); }); }
      specks(c, rnd, 400, 1, 2, ['rgba(214,204,190,.45)']); },
    rock(c, rnd, s){ basePixels(c, s, {c0:'#7c7873', c1:'#5d5a56', base:3, grain:16, contrast:2.1, cells:{n:5, w:2, c:'#24221f', a:0.75, lift:0.05, warp:34}, patches:[{c:'#6e7262', th:0.66, amt:0.45, base:8}, {c:'#93908a', th:0.62, amt:0.3}]});
      crackLines(c, rnd, 10, 90, 1.4, 'rgba(28,26,24,.6)', true); specks(c, rnd, 500, 1, 2.5, ['rgba(200,196,188,.35)', 'rgba(30,28,26,.4)']); },
    gravel(c, rnd, s){ basePixels(c, s, {c0:'#77736c', c1:'#66625c', base:6, grain:12});
      pebbles(c, rnd, 2300, 2.5, 6.5, ['#8d8880', '#9e9990', '#77726b', '#6a665f', '#a8a39a', '#81786c'], 0.45); },
    ash(c, rnd, s){ basePixels(c, s, {c0:'#5c5956', c1:'#4a4744', base:5, grain:20, patches:[{c:'#2c2a28', th:0.64, amt:0.5}, {c:'#77736e', th:0.66, amt:0.35, base:8}]});
      strokes(c, rnd, 160, 3, 10, 2.2, ['rgba(18,16,15,.75)', 'rgba(36,32,29,.7)']); specks(c, rnd, 700, 1, 2.5, ['rgba(200,196,190,.4)', 'rgba(150,146,140,.4)']); specks(c, rnd, 26, 1.5, 2.5, ['rgba(170,90,48,.55)']); },
    saltflat(c, rnd, s){ basePixels(c, s, {c0:'#c9c5b8', c1:'#b4afa2', base:4, grain:12, cells:{n:7, w:2.4, c:'#6d675c', a:0.55, lift:0.12, warp:10}, patches:[{c:'#a59f90', th:0.62, amt:0.4}]});
      specks(c, rnd, 900, 1, 2.2, ['rgba(255,255,250,.55)', 'rgba(120,114,104,.35)']); },
    asphalt(c, rnd, s){ basePixels(c, s, {c0:'#4b4a48', c1:'#3f3e3c', base:5, grain:26, stain:0.3, patches:[{c:'#585653', th:0.62, amt:0.5}, {c:'#36332f', th:0.68, amt:0.4, base:3}]});
      specks(c, rnd, 2200, 1, 2.6, ['rgba(140,136,130,.55)', 'rgba(110,106,100,.5)', 'rgba(20,19,18,.5)']); stains(c, rnd, 8, 12, 30, '#141210', 0.06, 0.13, 'multiply'); },
    cracked(c, rnd, s){ R.asphalt(c, rnd, s); crackLines(c, rnd, 16, 150, 2.2, 'rgba(14,13,12,.82)', true); crackLines(c, rnd, 26, 50, 1.1, 'rgba(18,17,16,.6)', false);
      for(let i=0;i<6;i++){ const x = rnd()*S, y = rnd()*S, r = 4 + rnd()*6; W(x, y, r + 2, (X, Y)=>{ c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.fill(); }); } // мелкие выщерблины
      strokes(c, rnd, 80, 3, 7, 1.2, ['#6b6a4c', '#5d5c43', '#7a7656'], -Math.PI/2, 1.8); },
    concrete(c, rnd, s){ basePixels(c, s, {c0:'#97948d', c1:'#85827b', base:4, grain:14, stain:0.3, patches:[{c:'#a6a39c', th:0.62, amt:0.35}, {c:'#6d6a64', th:0.7, amt:0.35, base:3}]});
      c.fillStyle = 'rgba(30,28,26,.55)'; for(let i=0;i<S;i+=256){ c.fillRect(i, 0, 2.5, S); c.fillRect(0, i, S, 2.5); } c.fillStyle = 'rgba(255,255,250,.18)'; for(let i=0;i<S;i+=256){ c.fillRect(i + 2.5, 0, 1, S); c.fillRect(0, i + 2.5, S, 1); }
      specks(c, rnd, 900, 1, 2.2, ['rgba(40,38,36,.5)', 'rgba(190,186,178,.4)']); crackLines(c, rnd, 6, 70, 1, 'rgba(30,28,26,.55)', true);
      stains(c, rnd, 5, 10, 30, RUST, 0.18, 0.3, 'multiply'); stains(c, rnd, 4, 30, 70, '#5a5c4a', 0.08, 0.16, 'multiply'); },
    tiles(c, rnd, s){ basePixels(c, s, {c0:'#bab4a5', c1:'#aaa496', base:8, grain:10, stain:0.3});
      const t = 64; for(let y=0;y<S;y+=t) for(let x=0;x<S;x+=t){ const v = rnd();
        if(v < 0.05){ c.fillStyle = "#5d5952"; c.fillRect(x, y, t, t); continue; } // выпавшая плитка
        c.fillStyle = `rgba(${v < 0.5 ? '255,250,240' : '40,36,30'},${0.04 + rnd()*0.08})`; c.fillRect(x, y, t, t);
        if(v > 0.85){ c.strokeStyle = 'rgba(40,36,30,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + rnd()*t, y); c.lineTo(x + t*0.5 + (rnd() - 0.5)*20, y + t*0.5); c.lineTo(x + rnd()*t, y + t); c.stroke(); } }
      c.fillStyle = '#6a655b'; for(let i=0;i<S;i+=t){ c.fillRect(i - 1.5, 0, 3, S); c.fillRect(0, i - 1.5, S, 3); } c.fillRect(S - 1.5, 0, 1.5, S); c.fillRect(0, S - 1.5, S, 1.5);
      stains(c, rnd, 8, 20, 60, '#6c6650', 0.12, 0.22, 'multiply'); stains(c, rnd, 3, 8, 20, RUST, 0.2, 0.3, 'multiply'); },
    metal(c, rnd, s){ basePixels(c, s, {c0:'#6d7376', c1:'#5c6265', base:6, grain:12, patches:[{c:RUST, th:0.64, amt:0.75}, {c:'#7e5a3e', th:0.72, amt:0.5, base:8}]});
      for(let y=0;y<S;y+=C) for(let x=0;x<S;x+=C){ if(((x + y)/C)%2===0){ c.fillStyle = 'rgba(160,168,172,.22)'; for(let j=6;j<C;j+=12) for(let i=6 + (j/12%2)*6;i<C;i+=12){ c.save(); c.translate(x + i, y + j); c.rotate(0.785); c.fillRect(-4, -1.2, 8, 2.4); c.restore(); } } }
      c.fillStyle = 'rgba(20,20,20,.6)'; for(let i=0;i<S;i+=C){ c.fillRect(i, 0, 2, S); c.fillRect(0, i, S, 2); } c.fillStyle = 'rgba(220,226,230,.18)'; for(let i=0;i<S;i+=C){ c.fillRect(i + 2, 0, 1, S); c.fillRect(0, i + 2, S, 1); }
      for(let y=0;y<S;y+=C) for(let x=0;x<S;x+=C) [[10, 10], [C - 10, 10], [10, C - 10], [C - 10, C - 10]].forEach(p=>rivet(c, x + p[0], y + p[1], 3));
      strokes(c, rnd, 120, 8, 28, 0.8, ['rgba(220,226,230,.25)', 'rgba(20,20,20,.3)']); stains(c, rnd, 5, 14, 34, CHEM, 0.1, 0.18); },
    wood(c, rnd, s){ basePixels(c, s, {c0:'#776551', c1:'#665645', base:4, grain:10});
      const ph = 32; for(let y=0;y<S;y+=ph){ let x = -rnd()*S*0.5; while(x < S){ const L = 96 + rnd()*260, col = mix(rgb('#7a6650'), rgb(rnd() < 0.3 ? '#8a8378' : '#5e4c3b'), rnd()*0.6);
        const draw = (X)=>{ c.fillStyle = `rgb(${col[0]|0},${col[1]|0},${col[2]|0})`; c.fillRect(X, y + 1, L - 2, ph - 2);
          for(let g=0;g<6;g++){ const gy = y + 4 + rnd()*(ph - 8), amp = 1 + rnd()*2, f = 0.02 + rnd()*0.04; c.beginPath(); for(let t=0;t<=L - 2;t+=6) { const yy = gy + Math.sin(t*f + g)*amp; t ? c.lineTo(X + t, yy) : c.moveTo(X + t, yy); } c.strokeStyle = `rgba(${rnd() < 0.5 ? '40,30,22' : '200,190,170'},${0.15 + rnd()*0.15})`; c.lineWidth = 0.8 + rnd()*0.8; c.stroke(); }
          c.fillStyle = 'rgba(20,16,12,.55)'; c.fillRect(X + L - 2, y, 2, ph); c.fillStyle = 'rgba(30,26,22,.7)'; c.fillRect(X + 5, y + 6, 2.5, 2.5); c.fillRect(X + 5, y + ph - 9, 2.5, 2.5); c.fillRect(X + L - 10, y + 6, 2.5, 2.5); c.fillRect(X + L - 10, y + ph - 9, 2.5, 2.5); };
        draw(x); if(x + L > S) draw(x - S); if(x < 0) draw(x + S); x += L; } }
      c.fillStyle = 'rgba(18,14,10,.75)'; for(let y=0;y<S;y+=ph) c.fillRect(0, y, S, 1.5);
      stains(c, rnd, 6, 18, 50, '#3e443a', 0.18, 0.3, 'multiply'); stains(c, rnd, 4, 30, 60, '#a8a294', 0.1, 0.18); },
    carpet(c, rnd, s){ basePixels(c, s, {c0:'#5c4c49', c1:'#4c3f3d', base:6, grain:30, contrast:1.2, patches:[{c:'#7a6c66', th:0.6, amt:0.45}]});
      strokes(c, rnd, 1600, 2, 4, 0.8, ['rgba(30,22,20,.35)', 'rgba(140,120,112,.3)']); stains(c, rnd, 7, 14, 40, '#2a2420', 0.2, 0.35, 'multiply'); stains(c, rnd, 4, 10, 26, '#5a6450', 0.15, 0.25, 'multiply'); },
    water(c, rnd, s){ basePixels(c, s, {c0:'#3b4c50', c1:'#2e3c40', base:3, grain:8, stain:0.2, ripple:{kx:3, ky:5, warp:9, a:0.08}, patches:[{c:'#4a5552', th:0.62, amt:0.4}]});
      strokes(c, rnd, 140, 10, 30, 1, ['rgba(190,205,205,.16)', 'rgba(150,170,172,.14)'], 0.3, 0.6); stains(c, rnd, 3, 30, 70, '#7a6a8a', 0.05, 0.08); specks(c, rnd, 30, 2, 4, ['rgba(110,100,80,.6)']); },
    sewer(c, rnd, s){ basePixels(c, s, {c0:'#45483a', c1:'#373a2e', base:3, grain:8, ripple:{kx:2, ky:4, warp:8, a:0.06}, patches:[{c:'#6a6a50', th:0.66, amt:0.55, base:6}]});
      for(let i=0;i<60;i++){ const x = rnd()*S, y = rnd()*S, r = 2 + rnd()*5; W(x, y, r + 1, (X, Y)=>{ c.strokeStyle = 'rgba(170,170,140,.35)'; c.lineWidth = 1; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.stroke(); }); } },
    toxic(c, rnd, s){ basePixels(c, s, {c0:'#66733a', c1:'#525d2d', base:4, grain:10, contrast:1.6, patches:[{c:'#8f8b56', th:0.64, amt:0.6, base:6}, {c:'#3a3f22', th:0.68, amt:0.45}]});
      for(let i=0;i<110;i++){ const x = rnd()*S, y = rnd()*S, r = 1.5 + rnd()*6; W(x, y, r + 2, (X, Y)=>{ c.fillStyle = 'rgba(40,48,20,.35)'; c.beginPath(); c.arc(X + 1, Y + 1.2, r, 0, Math.PI*2); c.fill(); c.fillStyle = 'rgba(160,176,90,.55)'; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.fill(); c.fillStyle = 'rgba(235,240,200,.45)'; c.beginPath(); c.arc(X - r*0.35, Y - r*0.35, r*0.3, 0, Math.PI*2); c.fill(); }); } },
    rad(c, rnd, s){ basePixels(c, s, {c0:'#706f58', c1:'#5e5d49', base:4, grain:16, cells:{n:8, w:1.5, c:'#2f2e24', a:0.55, warp:16}, patches:[{c:'#7f8450', th:0.64, amt:0.45}]});
      for(let i=0;i<42;i++){ const x = rnd()*S, y = rnd()*S, r = 6 + rnd()*12; W(x, y, r, (X, Y)=>{ const g = c.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, 'rgba(214,236,120,.55)'); g.addColorStop(0.25, 'rgba(190,214,96,.25)'); g.addColorStop(1, 'rgba(190,214,96,0)'); c.fillStyle = g; c.beginPath(); c.arc(X, Y, r, 0, Math.PI*2); c.fill(); c.fillStyle = 'rgba(236,250,180,.85)'; c.fillRect(X - 1, Y - 1, 2, 2); }); }
      pebbles(c, rnd, 30, 2, 5, ['#8a8e78', '#9aa08a', '#6a6c5c']); },
    // крыши (для объектов; серые — тон задаёт сам объект)
    rooftile(c, rnd, s){ basePixels(c, s, {c0:'#8a8580', c1:'#76716b', base:6, grain:10, patches:[{c:'#5d6648', th:0.66, amt:0.45}]});
      const th = 32, tw = 32; for(let y=0;y<S;y+=th){ const off = (y/th)%2 ? tw/2 : 0; for(let x=-tw;x<S + tw;x+=tw){ const X = x + off, v = rnd();
        if(v < 0.03){ c.fillStyle = '#2a2622'; c.fillRect(X, y, tw, th); c.fillStyle = 'rgba(120,90,60,.6)'; c.fillRect(X, y + th*0.3, tw, 3); continue; } // выпавшая черепица: видна обрешётка
        const g = c.createLinearGradient(X, y, X + tw, y); g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(0.35, 'rgba(255,255,255,.12)'); g.addColorStop(0.7, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); c.fillStyle = g; c.fillRect(X, y, tw, th);
        c.fillStyle = `rgba(${v < 0.5 ? '255,250,240' : '30,26,22'},${0.03 + rnd()*0.08})`; c.fillRect(X, y, tw, th);
        c.beginPath(); c.moveTo(X, y + th); c.quadraticCurveTo(X + tw/2, y + th + 5, X + tw, y + th); c.strokeStyle = 'rgba(15,12,10,.6)'; c.lineWidth = 2.5; c.stroke();
        if(v > 0.93){ c.strokeStyle = 'rgba(20,16,14,.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X + rnd()*tw, y); c.lineTo(X + rnd()*tw, y + th); c.stroke(); } } } },
    corrugated(c, rnd, s){ basePixels(c, s, {c0:'#7f8588', c1:'#6c7275', base:5, grain:8, patches:[{c:'#7a4f33', th:0.6, amt:0.75}, {c:'#5a3a26', th:0.7, amt:0.6, base:8}]});
      const p = 16; for(let x=0;x<S;x+=p){ const g = c.createLinearGradient(x, 0, x + p, 0); g.addColorStop(0, 'rgba(0,0,0,.3)'); g.addColorStop(0.3, 'rgba(255,255,255,.18)'); g.addColorStop(0.55, 'rgba(255,255,255,.04)'); g.addColorStop(1, 'rgba(0,0,0,.32)'); c.fillStyle = g; c.fillRect(x, 0, p, S); }
      for(let y=0;y<S;y+=128){ c.fillStyle = 'rgba(10,10,10,.55)'; c.fillRect(0, y, S, 2); for(let x=8;x<S;x+=32) rivet(c, x, y + 8, 2.2); }
      for(let i=0;i<40;i++){ const x = Math.floor(rnd()*S/p)*p + p*0.4, y = rnd()*S; const g = c.createLinearGradient(x, y, x, y + 60); g.addColorStop(0, 'rgba(110,60,30,.5)'); g.addColorStop(1, 'rgba(110,60,30,0)'); c.fillStyle = g; c.fillRect(x - 2, y, 4, 60); } },
    roofing(c, rnd, s){ basePixels(c, s, {c0:'#4c4a47', c1:'#3f3d3a', base:5, grain:22, stain:0.32, patches:[{c:'#5a5752', th:0.6, amt:0.45}, {c:'#2f2d2a', th:0.68, amt:0.5, base:3}]});
      for(let y=0;y<S;y+=128){ c.fillStyle = 'rgba(15,14,13,.6)'; c.fillRect(0, y, S, 3); c.fillStyle = 'rgba(200,196,188,.12)'; c.fillRect(0, y + 3, S, 2); }
      specks(c, rnd, 1600, 1, 2.5, ['rgba(150,146,140,.55)', 'rgba(110,106,100,.5)', 'rgba(20,19,18,.5)']);
      for(let i=0;i<14;i++){ const x = rnd()*S, y = rnd()*S, r = 6 + rnd()*14; W(x, y, r + 2, (X, Y)=>{ c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.arc(X - 1, Y - 1, r, 0, Math.PI*2); c.fill(); c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.arc(X + 1.5, Y + 1.5, r, 0, Math.PI*2); c.fill(); }); } // вздутия
      for(let i=0;i<5;i++){ const x = rnd()*S, y = rnd()*S, w = 40 + rnd()*80, h = 30 + rnd()*50; W(x + w/2, y + h/2, Math.max(w, h), (X, Y)=>{ c.fillStyle = 'rgba(30,29,27,.55)'; c.fillRect(X - w/2, Y - h/2, w, h); c.strokeStyle = 'rgba(10,10,10,.5)'; c.lineWidth = 1.5; c.strokeRect(X - w/2, Y - h/2, w, h); }); } }, // заплаты
    // материалы только для стен
    brickwall(c, rnd, s){ basePixels(c, s, {c0:'#7a4c3e', c1:'#653e33', base:8, grain:18, patches:[{c:'#5a5650', th:0.62, amt:0.5}, {c:SOOT, th:0.7, amt:0.4, base:3}]});
      specks(c, rnd, 1200, 1.5, 3.5, ['rgba(160,150,138,.55)', 'rgba(40,24,18,.5)', 'rgba(150,90,70,.5)']); },
    rust(c, rnd, s){ basePixels(c, s, {c0:'#6b5546', c1:'#54443a', base:5, grain:18, contrast:1.8, patches:[{c:'#7e5034', th:0.56, amt:0.8}, {c:'#5e6468', th:0.66, amt:0.55, base:8}, {c:'#9a6a3e', th:0.72, amt:0.5, base:6}]});
      strokes(c, rnd, 160, 10, 40, 1, ['rgba(20,18,16,.4)', 'rgba(200,190,170,.2)']); },
  };

  /* ---- фото-фактуры: assets/map/tex (CC0, Poly Haven, см. tools/sprites/fetch_textures.py) ----
     Манифест и картинки грузятся фоном при первой отрисовке; пока не догрузились (или без сервера) — процедурная
     фактура. Масштаб — из манифеста: сколько клеток (по 3 м) покрывает одна плитка картинки. */
  const PHOTO_DIR = '/assets/map/tex/', photo = {}; let photoState = 0; // 0 — не запрашивали, 1 — грузятся, 2 — готово
  function loadPhotos(){ if(photoState || typeof fetch==='undefined' || typeof location==='undefined' || !/^https?:$/.test(location.protocol)) return; photoState = 1;
    fetch(PHOTO_DIR + 'manifest.json', {cache:'no-cache'}).then(r=>r.ok ? r.json() : null).then(j=>{ const ts = j && j.textures; if(!ts){ photoState = 2; return; } let left = 0;
      Object.keys(ts).forEach(id=>{ const m = ts[id]; if(!m || typeof m.file!=='string' || !/^[a-z0-9_-]+\.(webp|jpg|png)$/.test(m.file) || !(m.cells > 0 && m.cells <= 16)) return; left++; const img = new Image();
        img.onload = ()=>{ photo[id] = {img, cells:m.cells}; delete tex[id]; if(--left===0) photoState = 2; photoReady(); };
        img.onerror = ()=>{ if(--left===0) photoState = 2; };
        img.src = PHOTO_DIR + m.file + '?v=' + (Number(j.version) || 1); });
      if(!left) photoState = 2; }).catch(()=>{ photoState = 2; }); }
  // догрузились: объекты с этими материалами перерисуются заново, редактор и стол — по общему событию
  let photoT = 0; function photoReady(){ clearTimeout(photoT); photoT = setTimeout(()=>{ sprites.clear(); spritePx = 0; try{ window.dispatchEvent(new Event('reincarnator-assets')); }catch(e){} }, 150); }

  /* ---- кэш текстур ---- */
  const tex = {};          // id → {cv, avg, pat}
  function texture(id){
    if(tex[id]) return tex[id];
    loadPhotos();
    const ph = photo[id];
    if(ph){ const w = ph.img.naturalWidth, h = ph.img.naturalHeight, cv = canvas(w, h), c = cv.getContext('2d'); c.drawImage(ph.img, 0, 0);
      const one = canvas(1, 1), oc = one.getContext('2d'); oc.drawImage(cv, 0, 0, 1, 1); const a = oc.getImageData(0, 0, 1, 1).data, pat = c.createPattern(cv, 'repeat');
      if(pat && pat.setTransform && typeof DOMMatrix!=='undefined') pat.setTransform(new DOMMatrix().scale(ph.cells/w));
      return tex[id] = {cv, avg:`rgb(${a[0]},${a[1]},${a[2]})`, pat, photo:true}; }
    const recipe = R[id]; if(!recipe) return null;
    const cv = canvas(S, S), c = cv.getContext('2d');
    try{ recipe(c, mulberry(hashStr('tex:' + id)), hashStr('seed:' + id)); }catch(e){ console.warn('[Карта] текстура', id, e); return tex[id] = null; }
    const one = canvas(1, 1), oc = one.getContext('2d'); oc.drawImage(cv, 0, 0, 1, 1); const a = oc.getImageData(0, 0, 1, 1).data;
    const pat = c.createPattern(cv, 'repeat');
    if(pat && pat.setTransform && typeof DOMMatrix!=='undefined') pat.setTransform(new DOMMatrix().scale(CELLS/S)); // 1 единица = 1 клетка
    return tex[id] = {cv, avg:`rgb(${a[0]},${a[1]},${a[2]})`, pat};
  }
  // заливка клеток типа id при масштабе k (пикселей на клетку): вблизи — фактура, издалека — её средний цвет
  function terrainFill(id, k){ const t = texture(id); if(!t) return null; return k < 6 || !t.pat ? t.avg : t.pat; }
  function pattern(id){ const t = texture(id); return t && t.pat; }
  // «высота» грунта для смешивания по рельефу: яркость фактуры (светлое — выпуклое), 256×256 на плитку, без среднего,
  // в долях разброса; cells — сколько клеток покрывает плитка
  const heights = {};
  let heightSn = 0;
  function heightMap(id){ const t = texture(id); if(!t) return null; if(heights[id] && heights[id].t===t) return heights[id]; const n = 256, cv = canvas(n, n), c = cv.getContext('2d', {willReadFrequently:true});
    c.filter = 'blur(1.5px)'; for(const dx of [-n, 0, n]) for(const dy of [-n, 0, n]) c.drawImage(t.cv, dx, dy, n, n); c.filter = 'none'; // с заворотом — без шва на краю
    const d = c.getImageData(0, 0, n, n).data, h = new Float32Array(n*n); let sm = 0, sq = 0;
    for(let i=0;i<n*n;i++){ const v = (0.299*d[i*4] + 0.587*d[i*4 + 1] + 0.114*d[i*4 + 2])/255; h[i] = v; sm += v; sq += v*v; }
    const mean = sm/(n*n), sd = Math.sqrt(Math.max(1e-6, sq/(n*n) - mean*mean)); for(let i=0;i<n*n;i++) h[i] = Math.max(-2.5, Math.min(2.5, (h[i] - mean)/sd))/2.5;
    return heights[id] = {h, n, t, sn:++heightSn, cells:t.photo && photo[id] ? photo[id].cells : CELLS}; } // t — от какой фактуры (догрузилось фото — пересчёт)
  // крупные разводы поверх всего ландшафта (период 24 клетки) — убирают повтор плиток текстуры
  let macro = null;
  function macroPattern(){
    if(macro!==null) return macro;
    const n = 256, f = noise(n, 9173, 5, 2), f2 = noise(n, 4421, 4, 4), cv = canvas(n, n), c = cv.getContext('2d'), img = c.createImageData(n, n), d = img.data;
    for(let i=0;i<n*n;i++){ const b = smooth(0.45, 0.85, f[i])*0.28 + smooth(0.55, 0.9, f2[i])*0.12; const v = mix([255, 255, 255], [118, 108, 96], b); d[i*4] = v[0]; d[i*4 + 1] = v[1]; d[i*4 + 2] = v[2]; d[i*4 + 3] = 255; }
    c.putImageData(img, 0, 0);
    macro = c.createPattern(cv, 'repeat');
    if(macro && macro.setTransform && typeof DOMMatrix!=='undefined') macro.setTransform(new DOMMatrix().scale(24/n)); else macro = null;
    return macro;
  }
  let macro2 = null;
  function macroPattern2(){
    if(macro2!==null) return macro2;
    const n = 256, f = noise(n, 31337, 5, 3), cv = canvas(n, n), c = cv.getContext('2d'), img = c.createImageData(n, n), d = img.data;
    for(let i=0;i<n*n;i++){ const b = smooth(0.3, 0.9, f[i]); const v = mix([255, 255, 255], [150, 140, 126], b*0.55); d[i*4] = v[0]; d[i*4 + 1] = v[1]; d[i*4 + 2] = v[2]; d[i*4 + 3] = 255; }
    c.putImageData(img, 0, 0); macro2 = c.createPattern(cv, 'repeat');
    if(macro2 && macro2.setTransform && typeof DOMMatrix!=='undefined') macro2.setTransform(new DOMMatrix().translate(7.3, 3.1).scale(37/n)); else macro2 = null;
    return macro2;
  }
  // постепенный прогрев: по одной текстуре за такт, чтобы не подвисал интерфейс
  function warm(ids, onEach){ const q = ids.filter(id=>R[id] && !(id in tex)); const step = ()=>{ const id = q.shift(); if(!id) return; texture(id); if(onEach) onEach(id); setTimeout(step, 0); }; setTimeout(step, 0); }
  function swatch(id){ const t = tex[id]; if(!t) return null; if(!t.url){ const cv = canvas(48, 48), s = Math.min(160, t.cv.width); cv.getContext('2d').drawImage(t.cv, 0, 0, s, s, 0, 0, 48, 48); t.url = cv.toDataURL(); } return t.url; }

  /* ---- общий слой износа для объектов ---- */
  let grimeCv = null, grainCv = null;
  function grimeTile(){ // светлое с тёмными разводами — под multiply
    if(grimeCv) return grimeCv;
    const n = 256, f = noise(n, 777, 6, 4), f2 = noise(n, 778, 4, 8), rnd = mulberry(779), cv = canvas(n, n), c = cv.getContext('2d'), img = c.createImageData(n, n), d = img.data;
    for(let i=0;i<n*n;i++){ const b = smooth(0.48, 0.82, f[i])*0.6 + smooth(0.6, 0.85, f2[i])*0.25, v = mix([252, 250, 246], [104, 94, 82], clamp01(b)), g = (rnd() - 0.5)*10; d[i*4] = v[0] + g; d[i*4 + 1] = v[1] + g; d[i*4 + 2] = v[2] + g; d[i*4 + 3] = 255; }
    c.putImageData(img, 0, 0); return grimeCv = cv;
  }
  function grainTile(){ // серое ±, под overlay — мелкая фактура материала
    if(grainCv) return grainCv;
    const n = 128, f = noise(n, 881, 3, 16), rnd = mulberry(882), cv = canvas(n, n), c = cv.getContext('2d'), img = c.createImageData(n, n), d = img.data;
    for(let i=0;i<n*n;i++){ const v = 128 + (f[i] - 0.5)*70 + (rnd() - 0.5)*46; d[i*4] = d[i*4 + 1] = d[i*4 + 2] = v; d[i*4 + 3] = 255; }
    c.putImageData(img, 0, 0); return grainCv = cv;
  }
  function patTo(c, cv, m){ const p = c.createPattern(cv, 'repeat'); if(p && p.setTransform && typeof DOMMatrix!=='undefined') p.setTransform(m); return p; }
  /* ---- Рельеф: локальный контраст по яркости (впадины темнее, рёбра светлее) + тень внутрь у краёв силуэта.
     Как «запечённое» затенение в 3D: каждая деталь рисунка получает объём, у всех объектов сразу. ---- */
  function boxBlur(src, w, h, r){ // разделимое размытие окном (2r+1), края — по ближайшему пикселю
    const tmp = new Float32Array(w*h), out = new Float32Array(w*h), n = 2*r + 1;
    for(let y=0;y<h;y++){ const row = y*w; let s = 0; for(let i=-r;i<=r;i++) s += src[row + Math.min(w - 1, Math.max(0, i))];
      for(let x=0;x<w;x++){ tmp[row + x] = s/n; s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
    for(let x=0;x<w;x++){ let s = 0; for(let i=-r;i<=r;i++) s += tmp[Math.min(h - 1, Math.max(0, i))*w + x];
      for(let y=0;y<h;y++){ out[y*w + x] = s/n; s += tmp[Math.min(h - 1, y + r + 1)*w + x] - tmp[Math.max(0, y - r)*w + x]; } }
    return out;
  }
  function relief(cv, a, res){
    const w = cv.width, h = cv.height; if(w*h > 3.2e6) return; // огромные спрайты не трогаем — дорого
    const c = cv.getContext('2d'), img = c.getImageData(0, 0, w, h), d = img.data, N = w*h;
    const la = new Float32Array(N), al = new Float32Array(N);
    for(let i=0;i<N;i++){ const A = d[i*4 + 3]/255; al[i] = A; la[i] = (0.299*d[i*4] + 0.587*d[i*4 + 1] + 0.114*d[i*4 + 2])/255*A; }
    const r1 = Math.max(1, Math.round(res*0.03)), r2 = Math.max(2, Math.round(res*0.07));
    const bl = boxBlur(la, w, h, r1), ba = boxBlur(al, w, h, r1), ba2 = boxBlur(al, w, h, r2);
    const k = a.g ? 1.0 : 2.0, edge = a.g ? 0 : 0.14;
    for(let i=0;i<N;i++){ const A = al[i]; if(A < 0.02) continue;
      const L = la[i]/A, Lb = ba[i] > 0.001 ? bl[i]/ba[i] : L, dl = L - Lb;   // >0 — ребро, <0 — впадина
      let f = 1 + dl*k*1.6; if(dl < 0) f -= Math.min(0.12, -dl*0.5);           // во впадинах — ещё и грязь
      f *= 1 - edge*(1 - Math.min(1, ba2[i]*1.15));                            // тень внутрь у краёв силуэта
      d[i*4] = d[i*4]*f + (dl < 0 ? -dl*18 : 0); d[i*4 + 1] = d[i*4 + 1]*f + (dl < 0 ? -dl*10 : 0); d[i*4 + 2] = d[i*4 + 2]*f; }
    c.putImageData(img, 0, 0);
  }
  let reliefOn = true;
  function weather(cv, a, v, res){
    const w = cv.width, h = cv.height, rnd = mulberry(hashStr('wear:' + a.id + ':' + v));
    const soft = (a.cat==='anomaly' ? 0.45 : a.g ? 0.6 : a.cat==='nature' ? 0.7 : 1)*(a.hd ? 0.45 : 1)*(a.lit ? 0.4 : 1); // аномалии, наземные пятна, детально перерисованные (hd) и светящиеся (lit) — мягче
    const mask = canvas(w, h); mask.getContext('2d').drawImage(cv, 0, 0);
    const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
    // 1. серее: часть насыщенности уходит
    c.globalCompositeOperation = 'saturation'; c.globalAlpha = 0.42*soft; c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
    // 2. объём от света: свет сверху слева
    c.globalCompositeOperation = 'soft-light'; c.globalAlpha = a.hd ? 0 : 0.32; const lg = c.createLinearGradient(0, 0, w*0.7, h); // у детальных (hd) — своя светотень lg.addColorStop(0, '#f4f0e8'); lg.addColorStop(0.5, '#808080'); lg.addColorStop(1, '#262422'); c.fillStyle = lg; c.fillRect(0, 0, w, h);
    // 3. въевшаяся грязь
    c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.8*soft; c.fillStyle = patTo(c, grimeTile(), new DOMMatrix().scale(res*2.4/256).translate(rnd()*256, rnd()*256)); c.fillRect(0, 0, w, h);
    // 4. фактура материала
    c.globalCompositeOperation = 'overlay'; c.globalAlpha = 0.5; c.fillStyle = patTo(c, grainTile(), new DOMMatrix().scale(Math.max(0.25, res*0.6/128)).translate(rnd()*128, rnd()*128)); c.fillRect(0, 0, w, h);
    // 5. пятна: ржавчина, копоть, химия, солевые разводы
    const area = a.w*a.h, blob = (col, alpha, r0, r1, op)=>{ const x = rnd()*w, y = rnd()*h, r = (r0 + rnd()*(r1 - r0))*res; c.globalCompositeOperation = op; c.globalAlpha = 1;
      const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, hexA(col, alpha)); g.addColorStop(0.55, hexA(col, alpha*0.5)); g.addColorStop(1, hexA(col, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI*2); c.fill(); };
    const nb = Math.min(14, Math.round(area*0.9*soft) + 1);
    for(let i=0;i<nb;i++){ const t = rnd();
      if(t < 0.4) blob(RUST, 0.45, 0.08, 0.35, 'multiply'); else if(t < 0.62) blob(SOOT, 0.3, 0.1, 0.4, 'multiply'); else if(t < 0.82) blob(CHEM, 0.22, 0.08, 0.3, 'source-over'); else blob(LIME, 0.18, 0.1, 0.35, 'source-over'); }
    // 6. потёки (вниз по карте) — ржавые и грязные
    c.globalCompositeOperation = 'multiply'; c.globalAlpha = 1;
    const ns = Math.min(18, Math.round(area*1.4*soft));
    for(let i=0;i<ns;i++){ const x = rnd()*w, y = rnd()*h*0.8, L = (0.15 + rnd()*0.6)*res, sw = Math.max(1, (0.015 + rnd()*0.05)*res), col = rnd() < 0.6 ? RUST : '#4a4238';
      const g = c.createLinearGradient(x, y, x, y + L); g.addColorStop(0, hexA(col, 0.5)); g.addColorStop(1, hexA(col, 0)); c.fillStyle = g; c.fillRect(x - sw/2, y, sw, L); }
    // 7. сколы и царапины: светлые штрихи и точки
    c.globalCompositeOperation = 'source-over';
    const nc = Math.min(260, Math.round(area*22*Math.max(0.5, soft)));
    for(let i=0;i<nc;i++){ const x = rnd()*w, y = rnd()*h, L = (0.03 + rnd()*0.18)*res, an = rnd()*Math.PI*2;
      c.globalAlpha = 0.18 + rnd()*0.22; c.strokeStyle = rnd() < 0.7 ? '#e2ddd2' : '#1e1c1a'; c.lineWidth = Math.max(0.6, res*0.008); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(an)*L, y + Math.sin(an)*L); c.stroke(); }
    // фаска по силуэту: светлая кромка сверху-слева, тень снизу-справа
    const bd = Math.max(1, res*0.035), edge = (dx, dy, col, alpha, op)=>{ const e = canvas(w, h), ec = e.getContext('2d'); ec.drawImage(mask, 0, 0); ec.globalCompositeOperation = 'destination-out'; ec.drawImage(mask, dx, dy); ec.globalCompositeOperation = 'source-in'; ec.fillStyle = col; ec.fillRect(0, 0, w, h); c.globalCompositeOperation = op; c.globalAlpha = alpha; c.drawImage(e, 0, 0); };
    edge(bd, bd, '#fffaf0', 0.28*soft + 0.1, 'source-over'); edge(-bd, -bd, '#0c0a08', 0.4, 'multiply');
    // выбоины со светлой кромкой и волосяные трещины — тем больше, чем больше площадь
    const np = Math.min(320, Math.round(area*30*Math.max(0.5, soft))); c.globalCompositeOperation = 'source-over';
    for(let i=0;i<np;i++){ const x = rnd()*w, y = rnd()*h, r = Math.max(0.7, res*(0.006 + rnd()*0.012)); c.globalAlpha = 0.35 + rnd()*0.3; c.fillStyle = '#1a1612'; c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill(); c.globalAlpha *= 0.6; c.strokeStyle = '#e8e2d6'; c.lineWidth = Math.max(0.5, r*0.35); c.beginPath(); c.arc(x - r*0.3, y - r*0.3, r, 3.4, 5.6); c.stroke(); }
    const nh = Math.min(40, Math.round(area*3*soft)); c.lineCap = 'round'; for(let i=0;i<nh;i++){ let x = rnd()*w, y = rnd()*h, an = rnd()*6.28; c.globalAlpha = 0.3 + rnd()*0.25; c.strokeStyle = '#141210'; c.lineWidth = Math.max(0.6, res*0.006); c.beginPath(); c.moveTo(x, y); for(let j=0;j<6;j++){ an += (rnd() - 0.5)*1.0; x += Math.cos(an)*res*0.05; y += Math.sin(an)*res*0.05; c.lineTo(x, y); } c.stroke(); }
    // по форме исходного рисунка
    c.globalAlpha = 1; c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, 0, 0); c.globalCompositeOperation = 'source-over';
  }

  /* ---- спрайты объектов: разрешение по месту на экране, кэш с ограничением памяти ---- */
  /* ---- Освещение по карте высот (как в 3D): высота = скругление силуэта к краям + яркость деталей
     (светлое выше, тёмное ниже). Нормали по градиенту, один источник сверху-слева, мягкий блик. ---- */
  const LV = (function(){ const x = -0.5, y = -0.62, z = 0.6, l = Math.hypot(x, y, z); return [x/l, y/l, z/l]; })();
  function heightOf(cv){ const w = cv.width, h = cv.height; if(w*h > 3.2e6 || w < 8 || h < 8) return null; const d = cv.getContext('2d').getImageData(0, 0, w, h).data, N = w*h, al = new Float32Array(N), lu = new Float32Array(N);
    for(let i=0;i<N;i++){ const A = d[i*4 + 3]/255; al[i] = A; lu[i] = (0.299*d[i*4] + 0.587*d[i*4 + 1] + 0.114*d[i*4 + 2])/255*A; } return {al, lu}; }
  function lightPass(cv, a, res, hm){
    if(!hm) return; const w = cv.width, h = cv.height, c = cv.getContext('2d'), img = c.getImageData(0, 0, w, h), d = img.data, al = hm.al;
    const rb = Math.max(2, Math.round(res*(a.g ? 0.03 : 0.07))), Ab = boxBlur(al, w, h, rb), Ls = boxBlur(hm.lu, w, h, Math.max(1, Math.round(res*0.008)));
    const s1 = rb*(a.g ? 0.6 : 2.2), s2 = Math.max(0.8, res*0.011), spK = a.g ? 0.04 : 0.12, base = 0.42 + 0.9*LV[2];
    for(let y=1;y<h - 1;y++) for(let x=1;x<w - 1;x++){ const i = y*w + x; if(al[i] < 0.02) continue;
      const nx = -((Ab[i + 1] - Ab[i - 1])*s1 + (Ls[i + 1] - Ls[i - 1])*s2), ny = -((Ab[i + w] - Ab[i - w])*s1 + (Ls[i + w] - Ls[i - w])*s2), inv = 1/Math.sqrt(nx*nx + ny*ny + 1);
      const ex = nx*inv, ey = ny*inv, ez = inv, dif = Math.max(0, ex*LV[0] + ey*LV[1] + ez*LV[2]);
      const f = (0.42 + 0.9*dif)/base, rz = 2*dif*ez - LV[2], sp = rz > 0 ? Math.pow(rz, 22)*spK*255 : 0;
      d[i*4] = d[i*4]*f + sp; d[i*4 + 1] = d[i*4 + 1]*f + sp; d[i*4 + 2] = d[i*4 + 2]*f + sp*0.95; }
    c.putImageData(img, 0, 0);
  }
  // тень в два слоя: плотная контактная у основания + широкая размытая (небо); смещения запечены внутрь
  function shadowLayer(cv, q, alpha){ const w = cv.width, h = cv.height, sw = Math.max(1, Math.round(w/q)), sh = Math.max(1, Math.round(h/q)); const small = canvas(sw, sh), sc = small.getContext('2d'); sc.drawImage(cv, 0, 0, sw, sh); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = `rgba(10,8,6,${alpha})`; sc.fillRect(0, 0, sw, sh); return small; }
  function shadowOf(cv, res){
    const w = cv.width, h = cv.height, out = canvas(w, h), oc = out.getContext('2d'); oc.imageSmoothingEnabled = true;
    oc.drawImage(shadowLayer(cv, Math.max(3, Math.round(res*0.14)), 0.34), res*0.05, res*0.07, w, h);   // широкая мягкая
    oc.drawImage(shadowLayer(cv, Math.max(2, Math.round(res*0.03)), 0.5), -res*0.035, -res*0.045, w, h); // контактная
    return out;
  }
  // тень для своего объекта: силуэт картинки → те же два слоя (кэш по размеру и источнику)
  function shadowFromImage(a){ const key = a.w + 'x' + a.h + ':' + a._src; if(a.shadow && a.shadow.key===key) return a.shadow; const img = a.img; if(!img) return null;
    const res = Math.max(16, Math.min(128, Math.round((img.naturalWidth || img.width)/a.w))), pad = 0.3, cw = Math.ceil((a.w + pad*2)*res), ch = Math.ceil((a.h + pad*2)*res); if(cw*ch > 4e6) return null;
    const cv = canvas(cw, ch); cv.getContext('2d').drawImage(img, pad*res, pad*res, a.w*res, a.h*res); a.shadow = {cv:shadowOf(cv, res), pad, key}; return a.shadow; }
  const sprites = new Map(); let spritePx = 0; const BUDGET = 24e6; // ~96 МБ в худшем случае
  const LEVELS = [24, 48, 96, 160, 256];
  function sprite(a, v, need){
    let res = LEVELS[LEVELS.length - 1]; for(let i=0;i<LEVELS.length;i++) if(need <= LEVELS[i]){ res = LEVELS[i]; break; }
    const pad = a.cat==='anomaly' ? 0.6 : 0.3, W0 = a.w + pad*2, H0 = a.h + pad*2;
    if(Math.max(W0, H0)*res > 2048) res = Math.max(8, Math.floor(2048/Math.max(W0, H0)));
    const key = a.id + ':' + v + ':' + res; let sp = sprites.get(key);
    if(sp){ sprites.delete(key); sprites.set(key, sp); return sp; }
    const cw = Math.ceil(W0*res), ch = Math.ceil(H0*res), cv = canvas(cw, ch), c = cv.getContext('2d'); cv.__sprite = true; // рисунки знают, что они в спрайте (можно стирать своё)
    c.setTransform(res, 0, 0, res, pad*res, pad*res);
    try{ a.draw(MapAssets.makeG(c, hashStr(a.id) ^ (v*7919), Math.max(0.018, 1.25/res), false), v); }catch(e){ console.warn('[Карта] ассет', a.id, e); }
    let hm = null; if(reliefOn) try{ hm = heightOf(cv); relief(cv, a, res); }catch(e){ console.warn('[Карта] рельеф', a.id, e); }
    try{ weather(cv, a, v, res); }catch(e){ console.warn('[Карта] износ', a.id, e); }
    if(hm) try{ lightPass(cv, a, res, hm); }catch(e){ console.warn('[Карта] свет', a.id, e); }
    sp = {cv, pad, w:cw/res, h:ch/res, shadow:a.g ? null : shadowOf(cv, res)};
    sprites.set(key, sp); spritePx += cw*ch*(sp.shadow ? 2 : 1);
    while(spritePx > BUDGET && sprites.size > 1){ const k0 = sprites.keys().next().value, s0 = sprites.get(k0); sprites.delete(k0); spritePx -= s0.cv.width*s0.cv.height*(s0.shadow ? 2 : 1); }
    return sp;
  }
  // рецепт фактуры из дополнения (новые типы ландшафта); kit — те же помощники, что у встроенных рецептов
  function addRecipe(id, fn){ if(typeof fn==='function' && !R[id]){ R[id] = fn; delete tex[id]; } }
  const kit = {basePixels, specks, pebbles, stains, crackLines, strokes, W, rivet, mix, rgb, S, C};
  return { macroPattern2, shadowFromImage, get enabled(){ return enabled; }, setEnabled, setRelief(v){ reliefOn = !!v; sprites.clear(); spritePx = 0; }, terrainFill, pattern, heightMap, macroPattern, warm, swatch, sprite, get TERRAIN_IDS(){ return Object.keys(R); }, addRecipe, kit };
})();

/* ---------- отрисовка карты — общая для редактора и игрового стола ----------
   ctx уже переведён в координаты карты: 1 единица = 1 клетка, (0,0) — левый верхний угол карты.
   k — пикселей на клетку на экране (для уровня детализации и толщины линий), view — видимая область
   в клетках (рисуется только она). hidden — скрытые слои (только в редакторе). */
const MapRender = (function(){
  const T = MapFormat.TERRAIN, T_IDX = MapFormat.T_INDEX, P = MapAssets.P;
  const LAYERS = [ // снизу вверх
    {id:'terrain', name:'Ландшафт'}, {id:'paths', name:'Дороги и пути'}, {id:'ground', name:'Наземные объекты'},
    {id:'walls', name:'Стены'}, {id:'objects', name:'Объекты'}, {id:'labels', name:'Надписи'},
  ];
  function cellHash(x, y, s){ let h = (x*374761393 + y*668265263 + (s||0)*2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const HD = ()=>typeof MapTex!=='undefined' && MapTex.enabled;
  // «Мягкие» типы (песок, пепел, грунт…) языками заходят на соседние твёрдые и менее мягкие — граница не по линейке
  const SOFT = {sand:3, dust:2, dirt:2, mud:2, grass:2, mutant:4, ash:3, gravel:1, saltflat:2, rad:4, toxic:5, bog:3, acid:5, rustwater:5, copper:2, frost:3, crystal:2, scrap:2, cave:1};
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function drawSpill(ctx, doc, x0, y0, x1, y1){
    const cols = doc.cols, rows = doc.rows, ter = doc.terrain, N = 4;
    for(let y=Math.max(0, y0 - 1);y<Math.min(rows, y1 + 1);y++) for(let x=Math.max(0, x0 - 1);x<Math.min(cols, x1 + 1);x++){
      const t = T[ter[y*cols + x]], p = t && SOFT[t.id]; if(!p) continue;
      let fill = null;
      for(let d=0;d<4;d++){
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if(nx<0 || ny<0 || nx>=cols || ny>=rows) continue;
        const tn = T[ter[ny*cols + nx]]; if(!tn || tn===t || !tn.color || (SOFT[tn.id] || 0) >= p) continue;
        if(!fill){ fill = MapTex.pattern(t.id); if(!fill) break; ctx.fillStyle = fill; }
        const ax = DIRS[d][0]===1 ? x + 1 : x, ay = DIRS[d][1]===1 ? y + 1 : y, along = DIRS[d][0]===0, ex = along ? ax + 1 : ax, ey = along ? ay : ay + 1;
        const P = [];
        for(let i=0;i<=N;i++){ const f = i/N, bx = along ? ax + f : ax, by = along ? ay : ay + f;
          const dep = i===0 ? 0.04 + cellHash(ax, ay, 77)*0.14 : i===N ? 0.04 + cellHash(ex, ey, 77)*0.14 : 0.05 + cellHash(ax*2 + (along ? 0 : 1) + i*131, ay*3 + i, 78)*0.2;
          P.push([bx + DIRS[d][0]*dep, by + DIRS[d][1]*dep]); }
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P[0][0], P[0][1]);
        for(let i=1;i<N;i++) ctx.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0])/2, (P[i][1] + P[i + 1][1])/2);
        ctx.lineTo(P[N][0], P[N][1]); ctx.lineTo(ex, ey); ctx.closePath(); ctx.fill();
      }
    }
  }
  // Плавные стыки природных грунтов (HD), «мягкий рельеф»: граница каждого грунта — размытая маска клеток, порог которой
  // сдвинут бесшовным шумом (край неровный, сетка клеток не читается) и разницей высот фактур (яркость: светлое выше) —
  // верхний грунт сперва проступает на своих выпуклостях и затекает во впадины нижнего (песок — в трещины глины, щебень —
  // между плитами). Фактура заливает маску на отдельном холсте и ложится только на природные клетки (кафель, доски,
  // ковролин, металл и толща породы — с чёткими краями; асфальт и бетон — плавно). Внутри сгенерированных зданий и снаружи
  // смешивается по отдельности. Порядок — от «твёрдых» к «текучим». Маски считаются на всю карту и кэшируются.
  const BLEND = {asphalt:0, cracked:0, concrete:0, rock:1, gravel:1, cave:1, glass:1, saltflat:1, dust:2, dirt:2, sand:2, copper:2, crystal:2, frost:2, scrap:2, ash:3, grass:3, mud:3, bog:3, mutant:4, rad:4, water:5, sewer:5, toxic:5, acid:5, rustwater:5};
  const EDGE = {blur:2.4, amp:0.9, w:0.08, h:0.15}; // размытие маски (клеток), сила шума, ширина мягкой полосы, вес рельефа
  let blendCv = null, natCv = null, cellCv = null;
  // бесшовный шум для края: 256 px на 12 клеток, три октавы
  let edgeNoise = null; const EN = 256, EN_CELLS = 12;
  function edgeNoiseTile(){ if(edgeNoise) return edgeNoise; const n = new Float32Array(EN*EN), oct = [[4, 0.55], [8, 0.3], [24, 0.15]];
    oct.forEach(([g, wgt], o)=>{ const r = MapAssets.mulberry(9001 + o), v = Array.from({length:g*g}, ()=>r()), at = (i, j)=>v[((j%g + g)%g)*g + (i%g + g)%g], sm = (t)=>t*t*(3 - 2*t);
      for(let y=0;y<EN;y++) for(let x=0;x<EN;x++){ const fx = x/EN*g, fy = y/EN*g, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1); n[y*EN + x] += wgt*(a + (b - a)*tx + (c - a)*ty + (a - b - c + d)*tx*ty); } });
    return edgeNoise = n; }
  const hAt = (hm, wx, wy)=>{ const u = ((wx/hm.cells)%1 + 1)%1, v = ((wy/hm.cells)%1 + 1)%1; return hm.h[Math.floor(v*hm.n)*hm.n + Math.floor(u*hm.n)]; };
  // кэш мягких масок на всю карту: ключ — содержимое клеток, область (внутри/снаружи), грунт, разрешение, высоты фактур
  const layers = new Map(); let layerPx = 0; const LAYER_BUDGET = 24e6;
  function softLayer(cols, rows, on, R, top, under, key){
    let L = layers.get(key); if(L){ layers.delete(key); layers.set(key, L); return L; }
    if(!cellCv) cellCv = document.createElement('canvas'); if(cellCv.width!==cols || cellCv.height!==rows){ cellCv.width = cols; cellCv.height = rows; }
    const cc = cellCv.getContext('2d'), ci = cc.createImageData(cols, rows); for(let i=0;i<cols*rows;i++){ ci.data[i*4] = ci.data[i*4 + 1] = ci.data[i*4 + 2] = 255; ci.data[i*4 + 3] = on[i] ? 255 : 0; } cc.putImageData(ci, 0, 0);
    const W = cols*R, H = rows*R, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const hc = cv.getContext('2d', {willReadFrequently:true}); hc.filter = `blur(${EDGE.blur*R*0.5}px)`; hc.imageSmoothingEnabled = true; hc.drawImage(cellCv, -R*0.5, -R*0.5, W + R, H + R); hc.filter = 'none';
    const im = hc.getImageData(0, 0, W, H), d = im.data, nz = edgeNoiseTile(), sc = EN/(EN_CELLS*R);
    for(let y=0;y<H;y++){ const ny = Math.floor(y*sc)%EN, wy = (y + 0.5)/R; for(let x=0;x<W;x++){ const i = (y*W + x)*4, m = d[i + 3]/255; d[i] = d[i + 1] = d[i + 2] = 255; if(m < 0.004 || m > 0.996) continue;
      const wx = (x + 0.5)/R, t = 0.5 + (nz[ny*EN + Math.floor(x*sc)%EN] - 0.5)*EDGE.amp - (top ? EDGE.h*(hAt(top, wx, wy) - (under ? hAt(under, wx, wy) : 0)) : 0);
      const u = Math.min(1, Math.max(0, (m - t + EDGE.w)/(2*EDGE.w))); d[i + 3] = u*u*(3 - 2*u)*255; } }
    hc.putImageData(im, 0, 0); L = cv; layers.set(key, L); layerPx += W*H;
    while(layerPx > LAYER_BUDGET && layers.size > 1){ const k0 = layers.keys().next().value, c0 = layers.get(k0); layerPx -= c0.width*c0.height; layers.delete(k0); }
    return L; }
  // клетки внутри сгенерированных зданий (doc.gen.parts) — их полы не размываются наружу и наоборот; кэш по списку частей
  const indoorCache = new WeakMap();
  function indoor(doc){ const ps = doc.gen && doc.gen.parts; if(!ps || !ps.length) return null; let m = indoorCache.get(ps); if(m && m.length===doc.cols*doc.rows) return m;
    m = new Uint8Array(doc.cols*doc.rows); ps.forEach(p=>{ if(p.k!=='b') return; for(let y=Math.max(0, p.y);y<Math.min(doc.rows, p.y + p.h);y++) for(let x=Math.max(0, p.x);x<Math.min(doc.cols, p.x + p.w);x++) m[y*doc.cols + x] = 1; });
    indoorCache.set(ps, m); return m; }
  function blendTerrain(ctx, doc, k, x0, y0, x1, y1){
    const m = ctx.getTransform && ctx.getTransform(); if(!m || m.b || m.c || !ctx.canvas) return false;
    const cols = doc.cols, rows = doc.rows, ter = doc.terrain, bx0 = Math.max(0, x0 - 1), by0 = Math.max(0, y0 - 1), bx1 = Math.min(cols, x1 + 1), by1 = Math.min(rows, y1 + 1), bw = bx1 - bx0, bh = by1 - by0;
    if(bw < 2 || bh < 2) return false;
    const W = ctx.canvas.width, H = ctx.canvas.height; if(W*H > 16e6) return false;
    if(!blendCv){ blendCv = document.createElement('canvas'); natCv = document.createElement('canvas'); }
    if(blendCv.width!==W || blendCv.height!==H){ blendCv.width = W; blendCv.height = H; }
    if(natCv.width!==bw || natCv.height!==bh){ natCv.width = bw; natCv.height = bh; }
    const bc = blendCv.getContext('2d'), nc = natCv.getContext('2d'), nimg = nc.createImageData(bw, bh), nd = nimg.data;
    // разрешение маски — по масштабу ступенями (меньше пересчётов при зуме), на больших картах ниже
    const R = [4, 8, 12, 16, 24].reduce((a, r)=>r <= Math.max(4, k/4) ? r : a, 4), Rm = Math.min(R, Math.max(2, Math.floor(Math.sqrt(4e6/(cols*rows)))));
    const inB = indoor(doc); let sig = 2166136261; for(let i=0;i<ter.length;i++) sig = Math.imul(sig ^ (ter[i] + (inB && inB[i] ? 97 : 0)), 16777619);
    sig = (sig >>> 0).toString(36) + ':' + cols + 'x' + rows; let any = false;
    // внутри сгенерированных зданий и снаружи — по отдельности: мягкий край не просачивается сквозь стену
    (inB ? [0, 1] : [0]).forEach(reg=>{
      const nat = (i)=>{ const t = T[ter[i]]; return t && BLEND[t.id]!=null && (!inB || inB[i]===reg); };
      const ids = new Set(); for(let y=by0;y<by1;y++) for(let x=bx0;x<bx1;x++) if(nat(y*cols + x)) ids.add(T[ter[y*cols + x]].id);
      if(ids.size < 2) return; any = true;
      // маска области — без сглаживания (чёткая граница с полами и стенами, без швов между клетками)
      for(let y=0;y<bh;y++) for(let x=0;x<bw;x++){ const i = (y*bw + x)*4; nd[i] = nd[i + 1] = nd[i + 2] = 255; nd[i + 3] = nat((by0 + y)*cols + bx0 + x) ? 255 : 0; }
      nc.putImageData(nimg, 0, 0);
      // первый (самый «твёрдый») грунт — подложкой на всю область, остальные поверх с мягким краем
      const order = [...ids].sort((a, b)=>BLEND[a] - BLEND[b]), hb = MapTex.heightMap(order[0]);
      order.forEach((id, n)=>{
        const ti = T_IDX[id], fill = MapTex.terrainFill(id, k); if(!fill) return;
        bc.setTransform(1, 0, 0, 1, 0, 0); bc.globalCompositeOperation = 'source-over'; bc.clearRect(0, 0, W, H); bc.setTransform(m);
        if(n===0){ bc.imageSmoothingEnabled = false; bc.drawImage(natCv, bx0, by0, bw, bh); }
        else { const ht = MapTex.heightMap(id), key = [sig, reg, id, Rm, ht ? ht.sn : 0, hb ? hb.sn : 0].join('|');
          const L = layers.get(key) || softLayer(cols, rows, Uint8Array.from(ter, (v, i)=>v===ti && nat(i) ? 1 : 0), Rm, ht, hb, key);
          bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high'; bc.drawImage(L, bx0*Rm, by0*Rm, bw*Rm, bh*Rm, bx0, by0, bw, bh); }
        bc.globalCompositeOperation = 'source-in'; bc.fillStyle = fill; bc.fillRect(bx0, by0, bw, bh);
        bc.globalCompositeOperation = 'destination-in'; bc.imageSmoothingEnabled = false; bc.drawImage(natCv, bx0, by0, bw, bh);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(blendCv, 0, 0); ctx.restore(); }); });
    return any;
  }
  function drawTerrain(ctx, doc, k, v){
    const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(doc.cols, Math.ceil(v.x1)), y1 = Math.min(doc.rows, Math.ceil(v.y1));
    const pad = 0.5/Math.max(1, k); // без щелей между клетками при дробном масштабе
    const hd = HD(), runs = hd && k >= 6 ? [] : null;
    for(let y=y0;y<y1;y++){
      let x = x0;
      while(x < x1){ // склеиваем подряд идущие клетки одного типа в одну заливку
        const ti = doc.terrain[y*doc.cols + x]; let e = x + 1;
        while(e < x1 && doc.terrain[y*doc.cols + e]===ti) e++;
        const t = T[ti];
        if(t && t.color){ ctx.fillStyle = (hd && MapTex.terrainFill(t.id, k)) || t.color; ctx.fillRect(x, y, e - x + pad, 1 + pad); if(runs) runs.push(x, y, e - x); }
        x = e;
      }
    }
    if(hd){
      const blended = k >= 6 && blendTerrain(ctx, doc, k, x0, y0, x1, y1);
      if(k >= 10 && !blended) drawSpill(ctx, doc, x0, y0, x1, y1); // «языки» — только без плавных стыков (иначе снова резкий край)
      const mp = runs && runs.length && MapTex.macroPattern();
      // разводы — одним контуром: у отрезков с нахлёстом умножение ложилось бы дважды (тёмные полосы по стыкам клеток)
      if(mp){ const area = new Path2D(); for(let i=0;i<runs.length;i+=3) area.rect(runs[i], runs[i + 1], runs[i + 2], 1);
        ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = mp; ctx.fill(area); const mp2 = MapTex.macroPattern2(); if(mp2){ ctx.fillStyle = mp2; ctx.fill(area); } ctx.restore(); }
      return;
    }
    if(k < 10) return; // мелкая фактура — только при достаточном масштабе
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
      const t = T[doc.terrain[y*doc.cols + x]]; if(!t || !t.color) continue;
      if(t.sp){ for(let i=0;i<3;i++){ const hx = cellHash(x, y, i), hy = cellHash(y, x, i + 7), hs = cellHash(x + i, y, 3); ctx.fillStyle = t.sp[i%2]; const s = 0.06 + hs*0.12; ctx.fillRect(x + hx*(1 - s), y + hy*(1 - s), s, s); } }
      if(t.tile){ ctx.strokeStyle = t.tile; ctx.lineWidth = 0.03; ctx.strokeRect(x + 0.02, y + 0.02, 0.46, 0.46); ctx.strokeRect(x + 0.52, y + 0.02, 0.46, 0.46); ctx.strokeRect(x + 0.02, y + 0.52, 0.46, 0.46); ctx.strokeRect(x + 0.52, y + 0.52, 0.46, 0.46); }
      if(t.plate){ ctx.strokeStyle = t.plate; ctx.lineWidth = 0.04; ctx.strokeRect(x + 0.04, y + 0.04, 0.92, 0.92); ctx.fillStyle = t.plate; [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]].forEach(([a, b])=>ctx.fillRect(x + a - 0.03, y + b - 0.03, 0.06, 0.06)); }
      if(t.plank){ ctx.strokeStyle = t.plank; ctx.lineWidth = 0.03; ctx.beginPath(); for(let i=1;i<4;i++){ ctx.moveTo(x, y + i*0.25); ctx.lineTo(x + 1, y + i*0.25); } const off = cellHash(x, y, 9)*0.8 + 0.1; ctx.moveTo(x + off, y); ctx.lineTo(x + off, y + 0.25); ctx.moveTo(x + (off + 0.5)%1, y + 0.5); ctx.lineTo(x + (off + 0.5)%1, y + 0.75); ctx.stroke(); }
      if(t.cracks && cellHash(x, y, 4) < 0.45){ ctx.strokeStyle = 'rgba(25,22,19,.55)'; ctx.lineWidth = 0.025; ctx.beginPath(); let cx = x + cellHash(x, y, 5), cy = y; ctx.moveTo(cx, cy); for(let i=1;i<=4;i++){ cx = x + Math.min(1, Math.max(0, cx - x + (cellHash(x, y, 10 + i) - 0.5)*0.5)); cy = y + i*0.25; ctx.lineTo(cx, cy); } ctx.stroke(); }
      if(t.glow && cellHash(x, y, 6) < 0.3){ ctx.fillStyle = 'rgba(220,245,107,.35)'; ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.18, 0, Math.PI*2); ctx.fill(); }
    }
  }
  function strokePath(ctx, pts, w, color, dash){ ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
  /* ---------- Пути в HD: объём слоями (тень, бровка, полотно, разметка), детали вдоль пути ----------
     Детали (выбоины, шпалы, фланцы, рябь…) стоят по шагу вдоль ломаной и зависят только от id пути — одинаковы
     в редакторе и на столе и не «плавают» при перерисовке. */
  // ломаная, смещённая вбок на d (d > 0 — вправо по ходу пути), с поправкой на угол излома
  function offsetPts(pts, d){
    const nrm = (p, q)=>{ const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [-dy/L, dx/L]; };
    return pts.map((p, i)=>{ let nx = 0, ny = 0;
      if(i > 0){ const n = nrm(pts[i - 1], p); nx += n[0]; ny += n[1]; } if(i < pts.length - 1){ const n = nrm(p, pts[i + 1]); nx += n[0]; ny += n[1]; }
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L; let m = 1;
      if(i > 0 && i < pts.length - 1){ const n1 = nrm(pts[i - 1], p); m = 1/Math.max(0.4, n1[0]*nx + n1[1]*ny); }
      return [p[0] + nx*d*m, p[1] + ny*d*m]; });
  }
  // точки через шаг вдоль ломаной: fn(x, y, угол, № по порядку)
  function walkPath(pts, step, start, fn){ let carry = start || 0, n = 0;
    for(let i=0;i<pts.length - 1;i++){ const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay); if(!L) continue; const ang = Math.atan2(by - ay, bx - ax);
      let t = carry; while(t <= L){ fn(ax + (bx - ax)*t/L, ay + (by - ay)*t/L, ang, n++); t += step; } carry = t - L; } }
  // тень под приподнятым (трубы, рельсы, бордюры): смещение вниз-вправо, как у объектов карты
  function shadowed(ctx, dx, dy, blur, a, fn){ const s = ctx.getTransform().a || 1; ctx.save(); ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowOffsetX = dx*s; ctx.shadowOffsetY = dy*s; ctx.shadowBlur = blur*s; fn(); ctx.restore(); }
  // перпендикулярная планка (шпала, доска, фланец) в точке пути
  function crossBar(ctx, x, y, ang, len, th, fill, edge, jit){ ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI/2 + (jit || 0)); ctx.fillStyle = fill; ctx.fillRect(-len/2, -th/2, len, th); if(edge){ ctx.strokeStyle = edge; ctx.lineWidth = Math.min(0.02, th*0.2); ctx.strokeRect(-len/2, -th/2, len, th); } ctx.restore(); }
  function side(x, y, ang, d){ return [x - Math.sin(ang)*d, y + Math.cos(ang)*d]; }
  function crackAt(ctx, R, x, y, ang, len){ let cx = x, cy = y, a = ang + (R() - 0.5)*2; ctx.beginPath(); ctx.moveTo(cx, cy); for(let i=0;i<4;i++){ a += (R() - 0.5)*1.1; cx += Math.cos(a)*len/4; cy += Math.sin(a)*len/4; ctx.lineTo(cx, cy); }
    ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(14,12,10,.6)'; ctx.stroke(); ctx.translate(0.012, 0.012); ctx.lineWidth = 0.015; ctx.strokeStyle = 'rgba(255,250,240,.08)'; ctx.stroke(); ctx.translate(-0.012, -0.012); }
  function pothole(ctx, R, x, y){ const rx = 0.16 + R()*0.24, ry = 0.11 + R()*0.16, rot = R()*3; const gr = ctx.createRadialGradient(x - rx*0.2, y - ry*0.2, 0, x, y, rx);
    gr.addColorStop(0, 'rgba(12,10,8,.8)'); gr.addColorStop(0.75, 'rgba(32,28,24,.55)'); gr.addColorStop(1, 'rgba(60,54,46,0)'); ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 6.28); ctx.fillStyle = gr; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0.2, 2.6); ctx.lineWidth = 0.03; ctx.strokeStyle = 'rgba(255,248,235,.16)'; ctx.stroke();
    if(R() < 0.45){ ctx.beginPath(); ctx.ellipse(x + 0.02, y + 0.02, rx*0.6, ry*0.55, rot, 0, 6.28); ctx.fillStyle = 'rgba(62,84,92,.55)'; ctx.fill(); ctx.beginPath(); ctx.ellipse(x - rx*0.15, y - ry*0.15, rx*0.25, ry*0.12, rot, 0, 6.28); ctx.fillStyle = 'rgba(220,235,240,.25)'; ctx.fill(); } }
  function stain(ctx, x, y, r, col){ const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r*2, r*2); }
  function drawPathHD(ctx, p, k, layer){
    const LY = (n)=>layer==null || layer===n;
    if(!/^(road|highway|sidewalk)$/.test(p.kind) && !LY(1)) return; // у остальных видов — один слой
    const w = p.width, pts = p.points, T = (id, fb)=>MapTex.pattern(id) || fb, O = (d)=>offsetPts(pts, d), R = MapAssets.mulberry(MapAssets.hashStr(p.id || (p.kind + pts.length)));
    const sp = (q, ww, col, dash)=>strokePath(ctx, q, ww, col, dash);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = /^(rail|pipe|road|highway)$/.test(p.kind) ? 'butt' : 'round';
    switch(p.kind){
      case 'road': case 'highway': {
        const hw = p.kind==='highway';
        // слой 0: бордюр/обочина с тенью; слой 1: полотно, кювет у кромки, светлый «горб»; слой 2: разметка, детали
        if(LY(0)){ shadowed(ctx, 0.05, 0.08, 0.12, 0.45, ()=>sp(pts, w + (hw ? 0.5 : 0.22), '#3a3632'));
          sp(pts, w + (hw ? 0.5 : 0.22), T('concrete', '#8e8a80')); sp(pts, w + (hw ? 0.5 : 0.22), 'rgba(0,0,0,.22)', [0.04, 0.55]); }
        if(LY(1)){ sp(pts, w - 0.04, T('asphalt', '#45423e')); ctx.globalAlpha = 0.4; sp(pts, w - 0.1, T('cracked', '#4a4743')); ctx.globalAlpha = 1;
          sp(pts, w*0.4, 'rgba(255,250,240,.05)');
          [-1, 1].forEach(s=>{ sp(O(s*(w/2 - 0.1)), 0.2, 'rgba(18,15,12,.4)'); sp(O(s*(w/2 - 0.02)), 0.04, 'rgba(255,250,240,.18)'); }); }
        if(!LY(2)) break;
        // разметка: стёртая, с пропусками
        if(hw){ [-0.08, 0.08].forEach(d=>sp(O(d), 0.06, 'rgba(206,176,92,.7)')); [-1, 1].forEach(s=>{ sp(O(s*w/4), 0.08, 'rgba(228,224,212,.55)', [1, 1]); sp(O(s*(w/2 - 0.38)), 0.08, 'rgba(228,224,212,.5)', [3.2 + R(), 0.3]); }); }
        else { sp(pts, 0.09, 'rgba(206,176,92,.72)', [0.7, 0.55]); [-1, 1].forEach(s=>sp(O(s*(w/2 - 0.3)), 0.06, 'rgba(225,220,205,.45)', [2.2 + R(), 0.4])); }
        if(hw){ // отбойники на стойках, деформационные швы
          [-1, 1].forEach(s=>{ const q = O(s*(w/2 + 0.14)); walkPath(q, 1.2, 0.4, (x, y)=>{ ctx.fillStyle = '#2e3236'; ctx.fillRect(x - 0.05, y - 0.05, 0.1, 0.1); });
            shadowed(ctx, 0.04, 0.07, 0.06, 0.5, ()=>sp(q, 0.09, '#8f989d')); sp(q, 0.03, 'rgba(235,240,245,.6)'); });
          walkPath(pts, 6, 3, (x, y, a)=>crossBar(ctx, x, y, a, w - 0.2, 0.03, 'rgba(0,0,0,.35)')); }
        // заплатки, выбоины, трещины, пятна масла
        walkPath(pts, hw ? 2.2 : 1.5, R()*1.5, (x, y, a)=>{ const r = R(), [px, py] = side(x, y, a, (R() - 0.5)*(w - 0.8));
          if(r < 0.17){ ctx.save(); ctx.translate(px, py); ctx.rotate(a + (R() - 0.5)*0.3); const pw = 0.4 + R()*0.9, ph = 0.3 + R()*0.5; ctx.fillStyle = 'rgba(28,26,24,.55)'; ctx.fillRect(-pw/2, -ph/2, pw, ph); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.025; ctx.strokeRect(-pw/2, -ph/2, pw, ph); ctx.restore(); }
          else if(r < 0.3) pothole(ctx, R, px, py);
          else if(r < 0.52) crackAt(ctx, R, px, py, a, 0.6 + R()*0.8);
          else if(r < 0.6) stain(ctx, px, py, 0.3 + R()*0.3, 'rgba(8,8,10,.35)'); });
        break; }
      case 'sidewalk': {
        if(!LY(0)) break;
        sp(pts, w + 0.12, 'rgba(40,36,32,.35)'); sp(pts, w, T('concrete', '#9a968c')); sp(pts, w, 'rgba(255,250,240,.06)');
        [-1, 1].forEach(s=>sp(O(s*(w/2 - 0.04)), 0.08, 'rgba(30,26,22,.35)'));
        walkPath(pts, 1, R()*0.5, (x, y, a)=>{ crossBar(ctx, x, y, a, w, 0.025, 'rgba(30,26,22,.35)'); if(R() < 0.25){ const [px, py] = side(x, y, a, (R() - 0.5)*(w - 0.4)); ctx.strokeStyle = 'rgba(96,110,52,.8)'; ctx.lineWidth = 0.02; for(let b=0;b<4;b++){ ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (R() - 0.5)*0.18, py - 0.06 - R()*0.1); ctx.stroke(); } } });
        walkPath(pts, 1.7, R(), (x, y, a)=>{ const r = R(), [px, py] = side(x, y, a, (R() - 0.5)*(w - 0.6)); if(r < 0.3) crackAt(ctx, R, px, py, a, 0.4 + R()*0.4); else if(r < 0.42) stain(ctx, px, py, 0.25, 'rgba(20,18,14,.25)'); else if(r < 0.5){ ctx.fillStyle = 'rgba(40,36,30,.4)'; ctx.fillRect(px - 0.2, py - 0.15, 0.4, 0.3); } });
        break; }
      case 'trail': { // натоптанная тропа: мягкая кромка, светлее посередине, следы и камешки
        for(let i=0;i<4;i++) sp(pts, w*(1.5 - i*0.18), 'rgba(110,88,62,.12)'); sp(pts, w*0.8, 'rgba(120,98,70,.25)'); sp(pts, w*0.4, 'rgba(160,138,104,.18)');
        walkPath(pts, 0.35, R()*0.3, (x, y, a)=>{ if(R() < 0.5){ const [px, py] = side(x, y, a, (R() - 0.5)*w*0.6); ctx.beginPath(); ctx.ellipse(px, py, 0.06, 0.035, a, 0, 6.28); ctx.fillStyle = 'rgba(70,52,34,.35)'; ctx.fill(); } if(R() < 0.25){ const [px, py] = side(x, y, a, (R() - 0.5)*w*1.4); ctx.beginPath(); ctx.arc(px, py, 0.025 + R()*0.03, 0, 6.28); ctx.fillStyle = R() < 0.5 ? '#6f675c' : '#8a8276'; ctx.fill(); } });
        break; }
      case 'track': {
        sp(pts, w + 0.6, 'rgba(110,88,60,.22)'); sp(pts, w + 0.25, 'rgba(120,96,66,.45)'); sp(pts, w, '#7a6247'); sp(pts, w, T('dirt', '#8f7553')); sp(pts, w*0.9, 'rgba(128,104,74,.35)');
        sp(pts, w*0.3, 'rgba(96,100,56,.18)'); // травяная полоса между колеями
        [-1, 1].forEach(s=>{ const q = O(s*w*0.25); sp(q, w*0.22, 'rgba(50,36,22,.6)'); sp(q, w*0.12, 'rgba(30,22,14,.35)'); sp(O(s*w*0.25 + s*0.07), w*0.05, 'rgba(255,240,210,.12)'); sp(O(s*w*0.25 - s*0.08), w*0.04, 'rgba(0,0,0,.2)'); });
        walkPath(pts, 0.32, R()*0.3, (x, y, a)=>{ if(R() < 0.6){ const [px, py] = side(x, y, a, (R() - 0.5)*w*0.25); ctx.strokeStyle = R() < 0.5 ? 'rgba(110,122,62,.75)' : 'rgba(140,140,80,.7)'; ctx.lineWidth = 0.02; for(let b=0;b<3;b++){ ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (R() - 0.5)*0.16, py - 0.08 - R()*0.1); ctx.stroke(); } } });
        walkPath(pts, 2.2, R()*2, (x, y, a)=>{ if(R() < 0.4){ const s = R() < 0.5 ? -1 : 1, [px, py] = side(x, y, a, s*w*0.25); ctx.beginPath(); ctx.ellipse(px, py, 0.32 + R()*0.3, 0.1, a, 0, 6.28); ctx.fillStyle = 'rgba(58,78,84,.6)'; ctx.fill(); ctx.beginPath(); ctx.ellipse(px - 0.06, py - 0.03, 0.12, 0.03, a, 0, 6.28); ctx.fillStyle = 'rgba(220,235,240,.3)'; ctx.fill(); } });
        walkPath(pts, 0.45, R()*0.4, (x, y, a)=>{ if(R() < 0.5){ const [px, py] = side(x, y, a, (R() - 0.5)*(w + 0.4)); ctx.beginPath(); ctx.arc(px, py, 0.03 + R()*0.04, 0, 6.28); ctx.fillStyle = R() < 0.5 ? '#5f574c' : '#7e766a'; ctx.fill(); } });
        break; }
      case 'rail': {
        const bw = w*1.55;
        sp(pts, bw + 0.15, 'rgba(0,0,0,.25)'); sp(pts, bw, T('gravel', '#8a8478')); sp(pts, bw, 'rgba(0,0,0,.18)'); sp(pts, bw*0.8, T('gravel', '#8a8478')); sp(pts, bw*0.5, 'rgba(255,250,240,.05)');
        // шпалы с тенью, часть сгнила/сдвинута
        shadowed(ctx, 0.03, 0.05, 0.05, 0.55, ()=>walkPath(pts, 0.42, 0.2, (x, y, a)=>{ if(R() < 0.04) return; const sh = 0.75 + R()*0.35; crossBar(ctx, x, y, a, w*1.28, 0.17, T('wood', '#5a4632'), 'rgba(20,14,8,.6)', (R() - 0.5)*0.08); crossBar(ctx, x, y, a, w*1.28, 0.17, `rgba(30,20,12,${(1 - sh)*0.8 + 0.1})`); }));
        // рельсы: основание, головка с бликом, ржавчина; подкладки
        [-1, 1].forEach(s=>{ const q = O(s*w*0.36); walkPath(q, 0.42, 0.2, (x, y)=>{ ctx.fillStyle = '#2b2826'; ctx.fillRect(x - 0.07, y - 0.07, 0.14, 0.14); });
          shadowed(ctx, 0.04, 0.06, 0.05, 0.6, ()=>sp(q, 0.11, '#3a3634')); sp(q, 0.07, '#77736e'); sp(O(s*w*0.36 - 0.018), 0.025, 'rgba(232,236,240,.7)'); sp(q, 0.09, 'rgba(120,62,30,.35)', [0.25 + R()*0.3, 0.5 + R()*0.5]); });
        break; }
      case 'pipe': {
        // опоры, тень, цилиндр (тень снизу-справа, блик сверху-слева), фланцы с болтами, ржавые потёки
        walkPath(pts, 3, 1.5, (x, y, a)=>{ shadowed(ctx, 0.05, 0.08, 0.08, 0.5, ()=>crossBar(ctx, x, y, a, w + 0.35, 0.3, T('concrete', '#8e8a80'), 'rgba(0,0,0,.4)')); });
        shadowed(ctx, 0.12, 0.18, 0.16, 0.5, ()=>sp(pts, w, '#3c464c'));
        sp(pts, w, T('metal', '#5a676e')); sp(pts, w, 'rgba(60,75,85,.3)');
        for(let i=0;i<pts.length - 1;i++){ const seg = [pts[i], pts[i + 1]], a = Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]), nx = -Math.sin(a), ny = Math.cos(a), s = (nx*-0.7 + ny*-0.7) > 0 ? 1 : -1;
          const os = (d)=>offsetPts(seg, d); sp(os(-s*w*0.3), w*0.32, 'rgba(0,0,0,.32)'); sp(os(-s*w*0.42), w*0.12, 'rgba(0,0,0,.25)'); sp(os(s*w*0.2), w*0.16, 'rgba(255,255,255,.28)'); sp(os(s*w*0.24), w*0.05, 'rgba(255,255,255,.6)'); }
        walkPath(pts, 2.8, 1.4, (x, y, a)=>{ shadowed(ctx, 0.04, 0.06, 0.05, 0.45, ()=>crossBar(ctx, x, y, a, w*1.32, 0.12, '#4b565c', 'rgba(0,0,0,.5)')); crossBar(ctx, x, y, a, w*1.32, 0.04, 'rgba(255,255,255,.18)');
          for(const d of [-0.5, 0.5]){ const [bx, by] = side(x, y, a, d*w*1.15); ctx.beginPath(); ctx.arc(bx, by, 0.025, 0, 6.28); ctx.fillStyle = '#23292c'; ctx.fill(); } });
        walkPath(pts, 0.9, R()*0.9, (x, y, a)=>{ if(R() < 0.35){ const [px, py] = side(x, y, a, (R() - 0.3)*w*0.6); stain(ctx, px, py, 0.08 + R()*0.12, 'rgba(130,64,26,.55)'); } });
        break; }
      case 'river': {
        sp(pts, w + 1.1, 'rgba(96,82,56,.16)'); sp(pts, w + 0.7, T('mud', '#6d5c45')); sp(pts, w + 0.7, 'rgba(60,48,32,.25)'); sp(pts, w + 0.22, 'rgba(36,30,22,.6)');
        sp(pts, w, T('water', '#3d5c67')); sp(pts, w, 'rgba(26,56,70,.22)'); for(let i=1;i<=8;i++) sp(pts, w*(1 - i/9), 'rgba(6,20,30,.075)'); // глубина к середине — плавно
        sp(pts, w*0.12, 'rgba(160,200,210,.08)'); // стрежень
        [-1, 1].forEach(s=>sp(O(s*(w/2 - 0.07)), 0.06, 'rgba(225,238,238,.35)', [0.5 + R()*0.4, 0.3]));
        walkPath(pts, 0.5, R()*0.5, (x, y, a)=>{ if(R() < 0.75){ const [px, py] = side(x, y, a, (R() - 0.5)*w*0.8), L = 0.25 + R()*0.35; ctx.beginPath(); ctx.moveTo(px - Math.cos(a)*L/2, py - Math.sin(a)*L/2); ctx.quadraticCurveTo(px - Math.sin(a)*0.06, py + Math.cos(a)*0.06, px + Math.cos(a)*L/2, py + Math.sin(a)*L/2); ctx.lineWidth = 0.025; ctx.strokeStyle = 'rgba(200,226,232,.28)'; ctx.stroke(); } });
        walkPath(pts, 1.3, R(), (x, y, a)=>{ const s = R() < 0.5 ? -1 : 1, r = R(), [px, py] = side(x, y, a, s*(w/2 + 0.2 + R()*0.15));
          if(r < 0.35){ shadowed(ctx, 0.03, 0.05, 0.04, 0.5, ()=>{ ctx.beginPath(); ctx.ellipse(px, py, 0.1 + R()*0.12, 0.08 + R()*0.08, R()*3, 0, 6.28); ctx.fillStyle = '#7f786e'; ctx.fill(); }); }
          else if(r < 0.65){ ctx.strokeStyle = 'rgba(96,110,52,.85)'; ctx.lineWidth = 0.022; for(let b=0;b<5;b++){ ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (R() - 0.5)*0.22, py - 0.12 - R()*0.16); ctx.stroke(); } } });
        break; }
      case 'dryriver': {
        sp(pts, w + 0.6, 'rgba(120,96,64,.22)'); sp(pts, w + 0.25, T('dust', '#a08760')); sp(pts, w, T('sand', '#c4ab7b')); sp(pts, w, 'rgba(120,96,60,.12)'); sp(pts, w*0.4, 'rgba(90,70,45,.14)');
        [-1, 1].forEach(s=>sp(O(s*(w/2 - 0.05)), 0.08, 'rgba(70,54,34,.35)'));
        walkPath(pts, 0.45, R()*0.4, (x, y, a)=>{ const [px, py] = side(x, y, a, (R() - 0.5)*w*0.8); ctx.save(); crackAt(ctx, R, px, py, a, 0.35 + R()*0.4); ctx.restore(); });
        walkPath(pts, 0.22, R()*0.2, (x, y, a)=>{ if(R() < 0.55){ const [px, py] = side(x, y, a, (R() - 0.5)*w*0.9), r = 0.025 + R()*0.045; ctx.beginPath(); ctx.arc(px + 0.012, py + 0.015, r, 0, 6.28); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill(); ctx.beginPath(); ctx.arc(px, py, r, 0, 6.28); ctx.fillStyle = R() < 0.5 ? '#8c8072' : '#b0a594'; ctx.fill(); } });
        break; }
      case 'trench': {
        // бруствер с двух сторон, глубина ямы, мешки по фронту, настил по дну, стойки обшивки
        [-1, 1].forEach(s=>{ const q = O(s*(w/2 + 0.18)); shadowed(ctx, 0.05, 0.08, 0.1, 0.45, ()=>sp(q, 0.36, T('dirt', '#7a6448'))); sp(O(s*(w/2 + 0.24)), 0.1, 'rgba(255,240,210,.12)'); });
        walkPath(O(-(w/2 + 0.18)), 0.36, 0.1, (x, y, a, i)=>{ ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, 0.2, 0.13, 0, 0, 6.28); ctx.fillStyle = i%2 ? '#b39b6a' : '#c5ad7a'; ctx.fill(); ctx.strokeStyle = 'rgba(60,46,26,.55)'; ctx.lineWidth = 0.018; ctx.stroke(); ctx.restore(); });
        sp(pts, w, '#241d15'); sp(pts, w*0.78, T('mud', '#3f352a')); sp(pts, w*0.78, 'rgba(0,0,0,.38)');
        [-1, 1].forEach(s=>sp(O(s*(w/2 - 0.06)), 0.12, 'rgba(0,0,0,.45)'));
        walkPath(pts, 0.3, 0.1, (x, y, a)=>{ if(R() < 0.08) return; crossBar(ctx, x, y, a, w*0.5, 0.11, T('wood', '#5a4632'), 'rgba(20,14,8,.6)', (R() - 0.5)*0.1); });
        [-1, 1].forEach(s=>walkPath(O(s*(w/2 - 0.04)), 1.1, 0.3, (x, y)=>{ ctx.fillStyle = '#3a2c1c'; ctx.fillRect(x - 0.05, y - 0.05, 0.1, 0.1); }));
        break; }
      case 'cable': {
        const cw = Math.max(0.08, w);
        shadowed(ctx, 0.04, 0.07, 0.06, 0.55, ()=>sp(pts, cw, '#151311')); sp(O(-cw*0.2), cw*0.22, 'rgba(255,255,255,.16)');
        walkPath(pts, 2, 1, (x, y, a)=>crossBar(ctx, x, y, a, cw*2.2, 0.06, '#5a5e60', 'rgba(0,0,0,.5)'));
        break; }
    }
    ctx.restore();
  }
  // layer: 0 — тротуары, бордюры, тени; 1 — полотно; 2 — разметка и детали; без слоя — всё сразу
  function drawPath(ctx, p, k, layer){ if(HD() && (k || 64) >= 6 && p.points && p.points.length >= 2) return drawPathHD(ctx, p, k, layer); if(layer==null || layer===1) return drawPathFlat(ctx, p, k); }
  // плоский вид путей — при выключенном HD и на мелком масштабе
  function drawPathFlat(ctx, p, k){
    const w = p.width, pts = p.points, hd = HD() && (k || 64) >= 6, tx = (id, fb)=>(hd && MapTex.pattern(id)) || fb;
    ctx.save(); ctx.lineCap = p.kind==='rail' || p.kind==='pipe' ? 'butt' : 'round'; ctx.lineJoin = 'round';
    switch(p.kind){
      case 'road': strokePath(ctx, pts, w + 0.12, '#2c2a27'); strokePath(ctx, pts, w, tx('cracked', '#4a4743')); strokePath(ctx, pts, 0.08, hd ? 'rgba(190,168,104,.7)' : '#d0a72c', [0.5, 0.45]); break;
      case 'highway': strokePath(ctx, pts, w + 0.3, tx('concrete', '#8e8a80')); strokePath(ctx, pts, w, tx('asphalt', '#45423e')); strokePath(ctx, pts, w*0.45, hd ? 'rgba(214,208,192,.4)' : 'rgba(233,227,211,.55)', [0.6, 0.6]); strokePath(ctx, pts, w*0.45 - 0.12, tx('asphalt', '#45423e')); strokePath(ctx, pts, 0.1, hd ? 'rgba(190,168,104,.75)' : '#d0a72c'); break;
      case 'sidewalk': strokePath(ctx, pts, w, tx('concrete', '#9a968c')); break;
      case 'trail': strokePath(ctx, pts, w, 'rgba(120,96,66,.35)'); break;
      case 'track': strokePath(ctx, pts, w, tx('dirt', '#8f7553')); strokePath(ctx, pts, w*0.55, 'rgba(94,72,48,.55)'); strokePath(ctx, pts, w*0.3, tx('dirt', '#8f7553')); break;
      case 'rail': strokePath(ctx, pts, w, '#6b5a45', [0.12, 0.2]); strokePath(ctx, pts, w*0.62, '#5e5850'); strokePath(ctx, pts, w*0.46, '#9a948a'); strokePath(ctx, pts, w*0.36, '#5e5850'); break;
      case 'pipe': strokePath(ctx, pts, w, '#4f5a60'); strokePath(ctx, pts, w*0.78, '#8a979e'); strokePath(ctx, pts, w*0.2, 'rgba(255,255,255,.25)'); strokePath(ctx, pts, w, 'rgba(30,27,24,.45)', [0.06, 1.5]); break;
      case 'river': strokePath(ctx, pts, w + 0.3, tx('mud', '#7d6a4c')); strokePath(ctx, pts, w, tx('water', '#3d5c67')); strokePath(ctx, pts, w*0.4, 'rgba(120,160,170,.25)'); break;
      case 'dryriver': strokePath(ctx, pts, w + 0.2, tx('dust', '#a08760')); strokePath(ctx, pts, w, tx('sand', '#c4ab7b')); strokePath(ctx, pts, w*0.7, 'rgba(120,96,64,.35)', [0.15, 0.25]); break;
      case 'trench': strokePath(ctx, pts, w + 0.3, '#b39b6a', [0.3, 0.06]); strokePath(ctx, pts, w, tx('mud', '#3f352a')); strokePath(ctx, pts, 0.06, '#6b5a45', [0.3, 0.3]); break;
      case 'cable': strokePath(ctx, pts, Math.max(0.08, w), '#151311'); break;
    }
    ctx.restore();
  }
  function drawWall(ctx, wl, k){
    const kind = MapFormat.WALL_KINDS[wl.kind] || MapFormat.WALL_KINDS.concrete, pts = wl.points, w = kind.w;
    ctx.save(); ctx.lineJoin = 'miter'; ctx.miterLimit = 3; ctx.lineCap = 'square';
    if(kind.fence){ strokePath(ctx, pts, w, '#6e7880', [0.05, 0.05]); pts.forEach(p=>{ ctx.fillStyle = '#4c555a'; ctx.fillRect(p[0] - 0.07, p[1] - 0.07, 0.14, 0.14); }); ctx.restore(); return; }
    if(kind.bags){ for(let i=0;i<pts.length - 1;i++){ const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len/0.42)), ang = Math.atan2(by - ay, bx - ax);
      for(let j=0;j<n;j++){ const t = (j + 0.5)/n; ctx.save(); ctx.translate(ax + (bx - ax)*t, ay + (by - ay)*t); ctx.rotate(ang); ctx.beginPath(); ctx.ellipse(0, 0, len/n/2 + 0.02, w/2, 0, 0, Math.PI*2); ctx.fillStyle = j%2 ? '#b39b6a' : '#c5ad7a'; ctx.fill(); ctx.lineWidth = 0.025; ctx.strokeStyle = '#1e1b18'; ctx.stroke(); ctx.restore(); } } ctx.restore(); return; }
    strokePath(ctx, pts, w + Math.max(0.05, 2/Math.max(1, k)), '#1e1b18');
    const wt = HD() && (k || 64) >= 6 && MapTex.pattern({concrete:'concrete', brick:'brickwall', metal:'metal', wood:'wood', scrap:'rust', rock:'rock', plaster:'tiles'}[wl.kind] || 'concrete');
    strokePath(ctx, pts, w, wt || kind.fill);
    if(wt){ ctx.globalAlpha = 0.35; strokePath(ctx, pts, w*0.3, 'rgba(255,250,240,.25)'); ctx.globalAlpha = 1; } // гребень стены светлее
    else {
      if(kind.hatch) strokePath(ctx, pts, w*0.55, MapAssets.shade(kind.fill, -0.18), [0.12, 0.1]);
      if(kind.rough) strokePath(ctx, pts, w*0.4, MapAssets.shade(kind.fill, 0.15), [0.08, 0.17]);
    }
    ctx.restore();
  }
  function drawLabel(ctx, l){
    ctx.save(); ctx.font = `700 ${l.size}px 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = l.size*0.18; ctx.strokeStyle = l.color.toLowerCase()==='#e9e3d3' ? 'rgba(30,27,24,.85)' : 'rgba(239,230,204,.92)';
    String(l.text).split('\n').forEach((line, i, arr)=>{ const y = l.y + (i - (arr.length - 1)/2)*l.size*1.15; ctx.strokeText(line, l.x, y); ctx.fillStyle = l.color; ctx.fillText(line, l.x, y); });
    ctx.restore();
  }
  function isGround(o){ const a = MapAssets.BY_ID[o.a]; return !!(a && a.g); }
  function visibleBox(b, v){ return !(b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1); }
  function pathBox(pts, pad){ let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach(p=>{ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return {x0:x0 - pad, y0:y0 - pad, x1:x1 + pad, y1:y1 + pad}; }
  // Вся карта. opts: {k, view, hidden:{layerId:true}, clip:true}
  function drawMap(ctx, doc, opts){
    const k = opts.k, v = opts.view || {x0:0, y0:0, x1:doc.cols, y1:doc.rows}, hid = opts.hidden || {};
    ctx.save();
    if(opts.clip !== false){ ctx.beginPath(); ctx.rect(0, 0, doc.cols, doc.rows); ctx.clip(); }
    if(!hid.terrain) drawTerrain(ctx, doc, k, v);
    if(!hid.paths){ const vis = doc.paths.filter(p=>visibleBox(pathBox(p.points, p.width + 1), v)); if(HD() && (k || 64) >= 6) [0, 1, 2].forEach(layer=>vis.forEach(p=>drawPath(ctx, p, k, layer))); else vis.forEach(p=>drawPath(ctx, p, k)); }
    if(!hid.ground) doc.objects.forEach(o=>{ if(isGround(o) && visibleBox(MapAssets.objectBounds(o), v)) MapAssets.drawObject(ctx, o, k); });
    if(!hid.walls) doc.walls.forEach(w=>{ if(visibleBox(pathBox(w.points, 0.5), v)) drawWall(ctx, w, k); });
    if(!hid.objects) doc.objects.forEach(o=>{ if(!isGround(o) && visibleBox(MapAssets.objectBounds(o), v)) MapAssets.drawObject(ctx, o, k); });
    if(!hid.labels) doc.labels.forEach(l=>{ if(l.x > v.x0 - 10 && l.x < v.x1 + 10 && l.y > v.y0 - 4 && l.y < v.y1 + 4) drawLabel(ctx, l); });
    ctx.restore();
  }
  return { LAYERS, drawMap, drawTerrain, drawPath, drawWall, drawLabel, pathBox, isGround };
})();

/* ---------- хранилище карт ----------
   Библиотека редактора — в localStorage этого браузера (у Мастера). Для игрового стола карта
   передаётся ссылкой: в сессии Мастер загружает JSON на сервер игры (/user-maps/<id>.json), игроки
   скачивают его по HTTP; без сессии (локальный стол) — «local:<id>», прямо из библиотеки. */
const MapStore = (function(){
  const LIB_KEY = 'reincarnator_maps_v1';
  function readLib(){ try{ const v = JSON.parse(localStorage.getItem(LIB_KEY)||'null'); return v && typeof v==='object' && v.maps ? v : {maps:{}}; }catch(e){ return {maps:{}}; } }
  function list(){ return Object.values(readLib().maps).map(m=>({id:m.id, name:m.name, cols:m.cols, rows:m.rows, updated:m.updated})).sort((a, b)=>b.updated - a.updated); }
  function get(id){ const raw = readLib().maps[id]; if(!raw) return null; try{ return MapFormat.fromJSON(raw); }catch(e){ return null; } }
  function save(doc){
    const lib = readLib(); lib.maps[doc.id] = MapFormat.toJSON(doc);
    try{ localStorage.setItem(LIB_KEY, JSON.stringify(lib)); return true; }
    catch(e){ return false; } // переполнено хранилище браузера
  }
  function remove(id){ const lib = readLib(); delete lib.maps[id]; try{ localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }catch(e){} }
  function upload(doc){
    return new Promise((resolve, reject)=>{
      if(typeof session==='undefined' || session.role!=='gm' || !session.ws || session.ws.readyState!==WebSocket.OPEN) return reject(new Error('Нужна активная сессия Мастера'));
      const out = MapFormat.toJSON(doc); if(out.gen) delete out.gen.note; // заметка Мастеру к препятствию — не игрокам
      fetch('/map-upload', {method:'POST', headers:{'Content-Type':'application/json', 'X-Client-Id':session.myId}, body:JSON.stringify(out)})
        .then(r=>r.json().then(j=>{ if(!r.ok || !j.url) throw new Error(j.error || ('Ошибка ' + r.status)); resolve(j.url); })).catch(reject);
    });
  }
  // Карта для стола по ссылке сцены: кэш по url+rev, загрузка асинхронно, onReady — перерисовать
  const sceneCache = {};
  function sceneDoc(scene, onReady){
    if(!scene) return null;
    const key = scene.url + '#' + scene.rev;
    const c = sceneCache[key];
    if(c) return c.doc;
    sceneCache[key] = {doc:null};
    if(scene.url.indexOf('local:')===0){ sceneCache[key].doc = get(scene.url.slice(6)); CustomAssets.registerDoc(sceneCache[key].doc); return sceneCache[key].doc; }
    fetch(scene.url + (scene.url.indexOf('?')<0 ? '?' : '&') + 'rev=' + scene.rev, {cache:'no-store'})
      .then(r=>r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(j=>{ sceneCache[key].doc = MapFormat.fromJSON(j); CustomAssets.registerDoc(sceneCache[key].doc); if(onReady) onReady(); })
      .catch(e=>{ console.warn('[Игровой стол] карта не загрузилась', scene.url, e); setTimeout(()=>{ if(sceneCache[key] && !sceneCache[key].doc){ delete sceneCache[key]; if(onReady) onReady(); } }, 5000); }); // повтор: следующая отрисовка запросит снова
    return null;
  }
  function invalidateLocal(id){ Object.keys(sceneCache).forEach(k=>{ if(k.indexOf('local:' + id + '#')===0) delete sceneCache[k]; }); }
  return { list, get, save, remove, upload, sceneDoc, invalidateLocal };
})();

/* ---------- процедурная генерация базовой планировки ----------
   Заполняет текущую карту (её размер сохраняется): ландшафт, пути, стены, объекты. Всё на сетке —
   стены по линиям клеток, объекты по клеткам. Дальше карту можно доделывать вручную. */
const MapGen = (function(){
  const TI = MapFormat.T_INDEX, newId = MapFormat.newId;
  // названия вариантов, означающие поломку/разгром — в целых зданиях не используются
  const DAMAGED = /разби|разгром|разграб|повал|опрокин|перев[её]рн|упал|лежит|вскры|взлома|слома|выбит|сорван|рухн|обруш|провал|сгор|горят|взорв|рван|искрит|осколк|пробит|расколот|рассыпан|разлив|сгнил|в крови|тело под|разобран|раскидан|засыпан|протека|пуст[ао]я, сломан/i;
  function ctxFor(doc, seed){
    seed = (seed >>> 0) || ((Date.now() ^ Math.floor(Math.random()*4294967295)) >>> 0) || 1;
    const rnd = MapAssets.mulberry(seed);
    const occ = new Uint8Array(doc.cols*doc.rows);
    const g = {
      doc, rnd, occ, seed, opts:{},
      ri: (a, b)=>a + Math.floor(rnd()*(b - a + 1)),
      pick: (arr)=>arr[Math.floor(rnd()*arr.length)],
      shuffle(a){ for(let i=a.length - 1;i>0;i--){ const j = Math.floor(rnd()*(i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; },
      bags:{}, vc:{}, built:[],
      // «колода»: элементы выходят без повторов, колода пополняется, только когда опустела
      bag(key, arr){ let b = g.bags[key]; if(!b || !b.length) b = g.bags[key] = g.shuffle(arr.slice()); return b.pop(); },
      uses:{},
      bagFit(key, arr, ok){ let b = g.bags[key]; if(!b || !b.length) b = g.bags[key] = g.shuffle(arr.slice()); const id = (x)=>key + ':' + (x.id || x); let got = null;
        for(let i=b.length - 1;i>=0;i--) if(ok(b[i])){ got = b.splice(i, 1)[0]; break; }
        if(!got){ const fit = g.shuffle(arr.filter(ok)); if(!fit.length) return null; got = fit.reduce((m, x)=>(g.uses[id(x)] || 0) < (g.uses[id(m)] || 0) ? x : m, fit[0]); }
        g.uses[id(got)] = (g.uses[id(got)] || 0) + 1; return got; },
      // вариант исполнения, который на этой карте встречался реже всего
      variant(a, state, prefer){ const as = MapAssets.BY_ID[a]; if(!as || !(as.v > 1)) return 0; let best = [], bc = Infinity;
        let pool = Array.from({length:as.v}, (_, i)=>i); if(state && as.vn){ const dmg = pool.filter(v=>DAMAGED.test(as.vn[v])), ok = pool.filter(v=>!DAMAGED.test(as.vn[v]));
          if(state==='intact' && ok.length) pool = ok; else if(state==='ruined' && dmg.length && rnd() < 0.55) pool = dmg;
          if(prefer){ const pf = Array.from({length:as.v}, (_, i)=>i).filter(v=>prefer.test(as.vn[v]) && (state!=='intact' || !DAMAGED.test(as.vn[v]))); if(pf.length && rnd() < 0.7) pool = pf; } }
        for(const v of pool){ const c = g.vc[a + ':' + v] || 0; if(c < bc){ bc = c; best = [v]; } else if(c===bc) best.push(v); } const v = g.pick(best); g.vc[a + ':' + v] = bc + 1; return v; },
      setT(x, y, id){ if(x>=0 && y>=0 && x<doc.cols && y<doc.rows) doc.terrain[y*doc.cols + x] = TI[id]; },
      rectT(x, y, w, h, id){ for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) g.setT(i, j, id); },
      free(x, y, w, h){ if(x<0 || y<0 || x + w>doc.cols || y + h>doc.rows) return false; for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) if(occ[j*doc.cols + i]) return false; return true; },
      mark(x, y, w, h){ for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) if(i>=0 && j>=0 && i<doc.cols && j<doc.rows) occ[j*doc.cols + i] = 1; },
      // объект по клетке левого верхнего угла габарита (с учётом поворота на 90°)
      obj(a, x, y, r, v, force){ const as = MapAssets.BY_ID[a]; if(!as) return false; r = r || 0; const sw = r%180 ? as.h : as.w, sh = r%180 ? as.w : as.h;
        if(!force && !g.free(x, y, sw, sh)) return false; if(!as.g) g.mark(x, y, sw, sh);
        doc.objects.push({id:newId('o'), a, x:x + sw/2, y:y + sh/2, r, s:1, v:v==null ? g.variant(a) : v, f:false}); return true; },
      tryObj(a, x0, y0, x1, y1, tries, r){ for(let t=0;t<(tries||12);t++){ const rr = r==null ? g.pick([0, 90, 180, 270]) : r; const as = MapAssets.BY_ID[a]; const sw = rr%180 ? as.h : as.w, sh = rr%180 ? as.w : as.h;
        if(x1 - x0 < sw || y1 - y0 < sh) return false; if(g.obj(a, g.ri(x0, x1 - sw), g.ri(y0, y1 - sh), rr)) return true; } return false; },
      wall(kind, pts){ doc.walls.push({id:newId('w'), kind, points:pts}); },
      path(kind, width, pts){ doc.paths.push({id:newId('p'), kind, width, points:pts}); },
      noise(scale, s){ const cache = {}; const val = (ix, iy)=>{ const k = ix + ',' + iy; if(cache[k]==null){ const h = MapAssets.hashStr(k + ':' + s); cache[k] = (h % 10000)/10000; } return cache[k]; };
        return (x, y)=>{ const fx = x/scale, fy = y/scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx*tx*(3 - 2*tx), sy = ty*ty*(3 - 2*ty);
          const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1); return a + (b - a)*sx + (c - a)*sy + (a - b - c + d)*sx*sy; }; },
    };
    return g;
  }
  function reset(doc, base){ doc.terrain.fill(TI[base]); doc.paths = []; doc.walls = []; doc.objects = []; doc.labels = []; }
  // Стены по границе маски «пол»: каждое ребро клетки между полом и не-полом, склеенное в длинные отрезки
  function wallsFromMask(g, mask, kind){
    const {cols, rows} = g.doc, M = (x, y)=>x>=0 && y>=0 && x<cols && y<rows && mask[y*cols + x];
    for(let y=0;y<=rows;y++){ let start = -1; for(let x=0;x<=cols;x++){ const edge = x<cols && (M(x, y - 1) !== M(x, y)); if(edge && start<0) start = x; if(!edge && start>=0){ g.wall(kind, [[start, y], [x, y]]); start = -1; } } }
    for(let x=0;x<=cols;x++){ let start = -1; for(let y=0;y<=rows;y++){ const edge = y<rows && (M(x - 1, y) !== M(x, y)); if(edge && start<0) start = y; if(!edge && start>=0){ g.wall(kind, [[x, start], [x, y]]); start = -1; } } }
  }
  /* ---------- Здания: тип → форма корпуса → комнаты → роли → мебель у стен ----------
     Уникальность на карте: тип, форма и отделка тянутся «из колоды» (повтор — только когда колода
     кончилась), похожие корпуса (тот же тип и форма, близкий размер) перегенерируются, а варианты
     предметов берутся те, что на карте встречались реже. */
  // Спинка предмета при r=0 — сверху. Эти вытянуты вдоль Y и встают к стене длинной стороной (спинка слева).
  const BACK_LEFT = {shelf:1, checkout:1, fridge_display:1};
  // Комнаты: sz — желаемый размер (2 большая, 1 средняя, 0 маленькая), fl — полы, it — мебель:
  // m: wall (спиной к стене), corner, center, rows (ряды стеллажей), grid (парты/столы рядами, лицом к focus), floor (наземное)
  const ROLES = {
    living:    {sz:2, fl:['wood', 'carpet', 'wood'], it:[{a:['sofa'], m:'wall', focus:1}, {a:['tv'], m:'wall', p:0.7}, {a:['rug'], m:'floor', p:0.7}, {a:['table_small'], m:'center'}, {a:['bookshelf', 'wardrobe'], m:'wall', p:0.6}, {a:['chair'], m:'center', n:[0, 2]}, {a:['lamp'], m:'corner', p:0.5}]},
    kitchen:   {sz:1, fl:['tiles'], it:[{a:['stove'], m:'wall'}, {a:['fridge'], m:'wall'}, {a:['sink'], m:'wall'}, {a:['pantry_shelves'], m:'wall', p:0.6}, {a:['washing'], m:'wall', p:0.3}, {a:['table_dining', 'table_small'], m:'center', p:0.8}, {a:['chair'], m:'center', n:[0, 2]}]},
    bedroom:   {sz:1, fl:['wood', 'carpet'], it:[{a:['bed'], m:'wall', n:[1, 2]}, {a:['wardrobe'], m:'wall'}, {a:['table_small'], m:'wall', p:0.6}, {a:['rug'], m:'floor', p:0.4}, {a:['lamp'], m:'corner', p:0.4}, {a:['tv', 'bookshelf'], m:'wall', p:0.3}]},
    bath:      {sz:0, fl:['tiles'], it:[{a:['toilet'], m:'corner'}, {a:['sink'], m:'wall'}, {a:['bathtub', 'shower'], m:'wall'}, {a:['washing'], m:'wall', p:0.4}]},
    storage:   {sz:0, fl:['concrete', 'wood'], it:[{a:['pantry_shelves'], m:'wall', n:[1, 2]}, {a:['crate_wood', 'crate_metal', 'barrel'], m:'corner', n:[1, 3]}, {a:['shelf'], m:'wall', p:0.4}, {a:['tire_stack', 'safe'], m:'corner', p:0.25}]},
    hall:      {sz:1, fl:['tiles', 'wood', 'concrete'], it:[{a:['locker', 'wardrobe'], m:'wall', p:0.4}, {a:['chair'], m:'wall', n:[0, 2]}, {a:['vending'], m:'wall', p:0.3}, {a:['rug'], m:'floor', p:0.3}]},
    sales_food:{sz:2, fl:['tiles', 'concrete'], it:[{a:['checkout'], m:'wall', n:[1, 2]}, {a:['fridge_display'], m:'wall', n:[1, 3]}, {a:['shelf'], m:'rows'}, {a:['carts'], m:'corner', p:0.6}, {a:['vending'], m:'wall', p:0.5}, {a:['pallet'], m:'corner', p:0.4}]},
    sales_drug:{sz:2, fl:['tiles'], it:[{a:['reception'], m:'wall', focus:1}, {a:['shelf'], m:'wall', n:[2, 4]}, {a:['fridge_display'], m:'wall', p:0.5}, {a:['medkit'], m:'corner', n:[1, 2]}, {a:['chair'], m:'wall', n:[0, 2]}, {a:['vending'], m:'wall', p:0.4}]},
    sales_tool:{sz:2, fl:['concrete', 'wood'], it:[{a:['checkout'], m:'wall'}, {a:['shelf', 'pantry_shelves'], m:'rows'}, {a:['pallet'], m:'corner', n:[1, 2]}, {a:['crate_wood', 'crate_metal'], m:'corner', n:[1, 2]}, {a:['tire_stack', 'barrel'], m:'corner', p:0.5}, {a:['workbench'], m:'wall', p:0.4}]},
    office:    {sz:1, fl:['carpet', 'wood', 'tiles'], it:[{a:['office_desk'], m:'wall', n:[1, 3]}, {a:['bookshelf'], m:'wall', p:0.7}, {a:['locker'], m:'wall', p:0.3}, {a:['chair'], m:'center', n:[0, 1]}, {a:['terminal', 'radio'], m:'wall', p:0.4}, {a:['safe'], m:'corner', p:0.3}]},
    boss:      {sz:1, fl:['carpet', 'wood'], it:[{a:['office_desk'], m:'wall'}, {a:['bookshelf'], m:'wall', n:[1, 2]}, {a:['sofa'], m:'wall', p:0.7}, {a:['safe'], m:'corner'}, {a:['rug'], m:'floor', p:0.7}, {a:['tv'], m:'wall', p:0.4}, {a:['lamp'], m:'corner', p:0.5}]},
    archive:   {sz:1, fl:['wood', 'concrete'], it:[{a:['bookshelf', 'pantry_shelves'], m:'rows'}, {a:['office_desk'], m:'wall', p:0.4}, {a:['safe', 'crate_wood'], m:'corner', p:0.5}]},
    workshop:  {sz:1, fl:['concrete', 'metal'], it:[{a:['workbench'], m:'wall', n:[1, 2]}, {a:['lathe'], m:'wall'}, {a:['press'], m:'wall', p:0.4}, {a:['tire_stack', 'barrel', 'crate_metal'], m:'corner', n:[1, 3]}, {a:['generator'], m:'corner', p:0.3}, {a:['pantry_shelves'], m:'wall', p:0.5}]},
    garage_bay:{sz:2, fl:['concrete'], it:[{a:['car_wreck', 'pickup_rust', 'buggy', 'car_burnt'], m:'center', n:[1, 2]}, {a:['workbench'], m:'wall'}, {a:['tire_stack'], m:'corner', n:[1, 3]}, {a:['barrels_group', 'barrel'], m:'corner', p:0.7}, {a:['pantry_shelves', 'shelf'], m:'wall', p:0.6}, {a:['lathe', 'press'], m:'wall', p:0.4}]},
    reception: {sz:1, fl:['tiles'], it:[{a:['reception'], m:'wall', focus:1}, {a:['chair'], m:'wall', n:[2, 4]}, {a:['table_small'], m:'center', p:0.5}, {a:['vending'], m:'wall', p:0.4}, {a:['sofa'], m:'wall', p:0.3}]},
    ward:      {sz:2, fl:['tiles'], it:[{a:['hospital_bed'], m:'wall', n:[2, 4]}, {a:['stretcher'], m:'wall', p:0.5}, {a:['table_small'], m:'wall', p:0.6}, {a:['medkit'], m:'corner', p:0.6}, {a:['sink'], m:'wall', p:0.5}]},
    surgery:   {sz:1, fl:['tiles'], it:[{a:['hospital_bed', 'stretcher'], m:'center'}, {a:['lab_bench'], m:'wall'}, {a:['terminal'], m:'wall', p:0.6}, {a:['medkit'], m:'corner', n:[1, 2]}, {a:['sink'], m:'wall'}, {a:['lamp'], m:'corner', p:0.6}]},
    classroom: {sz:2, fl:['wood'], it:[{a:['chalkboard'], m:'wall', focus:1}, {a:['school_desk'], m:'grid'}, {a:['bookshelf', 'locker'], m:'wall', p:0.5}, {a:['office_desk'], m:'wall', p:0.4}]},
    dining:    {sz:2, fl:['wood', 'tiles'], it:[{a:['reception'], m:'wall'}, {a:['restaurant_table', 'table_dining'], m:'grid'}, {a:['vending'], m:'wall', p:0.4}, {a:['tv'], m:'wall', p:0.3}, {a:['pantry_shelves'], m:'wall', p:0.4}]},
    stockroom: {sz:2, fl:['concrete'], it:[{a:['shelf'], m:'rows'}, {a:['pallet'], m:'corner', n:[2, 4]}, {a:['crate_wood', 'crate_metal'], m:'corner', n:[1, 3]}, {a:['barrels_group'], m:'corner', p:0.5}, {a:['shipping_container'], m:'center', p:0.2}]},
    chapel:    {sz:2, fl:['wood', 'carpet'], it:[{a:['table_small'], m:'wall', focus:1}, {a:['chair'], m:'grid'}, {a:['rug'], m:'floor', p:0.6}, {a:['lamp'], m:'corner', n:[1, 2]}, {a:['bookshelf'], m:'wall', p:0.4}]},
    arsenal:   {sz:1, fl:['concrete', 'metal'], it:[{a:['weapon_rack'], m:'wall', n:[1, 3]}, {a:['ammo_crate'], m:'corner', n:[1, 3]}, {a:['crate_metal'], m:'corner', p:0.6}, {a:['locker'], m:'wall', p:0.5}]},
    cell:      {sz:0, fl:['concrete'], it:[{a:['bunk', 'bed'], m:'wall'}, {a:['toilet'], m:'corner', p:0.7}, {a:['sleeping_bag'], m:'center', p:0.3}]},
    lockerroom:{sz:1, fl:['tiles'], it:[{a:['locker'], m:'wall', n:[1, 2]}, {a:['shower'], m:'wall', n:[1, 2]}, {a:['chair'], m:'center', n:[0, 2]}, {a:['sink'], m:'wall', p:0.5}]},
    lab:       {sz:1, fl:['tiles', 'metal'], it:[{a:['lab_bench'], m:'wall', n:[2, 3]}, {a:['terminal'], m:'wall'}, {a:['barrel_toxic'], m:'corner', p:0.5}, {a:['containment_pod'], m:'center', p:0.35}, {a:['sink'], m:'wall', p:0.6}]},
    server:    {sz:0, fl:['metal', 'tiles'], it:[{a:['terminal'], m:'wall', n:[1, 2]}, {a:['radio'], m:'wall'}, {a:['electric_panel'], m:'wall'}, {a:['office_desk'], m:'wall', p:0.5}]},
    boilerroom:{sz:2, fl:['concrete', 'metal'], it:[{a:['boiler'], m:'wall', n:[1, 2]}, {a:['tank_horiz', 'tank_big'], m:'corner', p:0.6}, {a:['valve'], m:'wall', n:[1, 3]}, {a:['electric_panel'], m:'wall'}, {a:['barrels_group', 'barrel'], m:'corner', n:[1, 2]}, {a:['pipe_straight'], m:'wall', p:0.6}, {a:['workbench'], m:'wall', p:0.4}]},
    substation:{sz:2, fl:['concrete'], it:[{a:['transformer'], m:'center', n:[1, 2]}, {a:['electric_panel'], m:'wall', n:[2, 3]}, {a:['generator'], m:'corner', p:0.6}, {a:['locker'], m:'wall', p:0.4}, {a:['crate_metal'], m:'corner', p:0.5}]},
    guard:     {sz:1, fl:['wood', 'concrete'], it:[{a:['office_desk'], m:'wall'}, {a:['radio'], m:'wall'}, {a:['tv'], m:'wall', p:0.6}, {a:['locker', 'weapon_rack'], m:'wall'}, {a:['chair'], m:'center'}, {a:['bunk', 'sleeping_bag'], m:'wall', p:0.6}, {a:['stove'], m:'corner', p:0.4}]},
    laundry_big:{sz:2, fl:['tiles'], it:[{a:['washing'], m:'wall', n:[4, 7]}, {a:['table_small'], m:'center', n:[1, 2]}, {a:['chair'], m:'wall', n:[1, 3]}, {a:['vending'], m:'wall', p:0.6}, {a:['pantry_shelves'], m:'wall', p:0.5}, {a:['sink'], m:'wall', p:0.5}]},
    laundry:   {sz:0, fl:['tiles'], it:[{a:['washing'], m:'wall', n:[2, 3]}, {a:['sink'], m:'wall'}, {a:['pantry_shelves'], m:'wall', p:0.5}]},
  };
  // Типы зданий: размер (w/h — диапазоны в клетках), формы, стены, программа комнат (первая — главная), вход
  const ARCH = [
    {id:'house', name:'Жилой дом', w:[6, 10], h:[6, 9], shapes:['rect', 'L', 'T', 'L'], ext:['brick', 'wood', 'brick'], prog:['living', 'kitchen', 'bedroom', 'bath', 'bedroom', 'storage'], room:[9, 18], yard:['dead_tree', 'tree_sparse', 'dry_bush', 'car_wreck', 'yard', 'trash']},
    {id:'cottage', name:'Домик', w:[5, 7], h:[5, 7], shapes:['rect', 'L'], ext:['wood', 'brick'], prog:['living', 'bedroom', 'kitchen', 'bath'], room:[7, 14], yard:['dead_tree', 'dry_bush', 'tire_stack', 'barrel']},
    {id:'apartment', name:'Малоэтажка', w:[9, 12], h:[8, 11], shapes:['rect', 'wings', 'U'], ext:['concrete', 'brick'], prog:['hall', 'living', 'kitchen', 'bedroom', 'bath', 'living', 'kitchen', 'bedroom', 'bath', 'laundry'], room:[8, 16], entry:['hall'], yard:['dumpster', 'car_wreck', 'yard', 'bus_stop', 'trash']},
    {id:'grocery', name:'Продуктовый', w:[7, 10], h:[6, 9], shapes:['rect', 'L'], ext:['concrete', 'brick'], prog:['sales_food', 'storage', 'office', 'bath'], room:[8, 18], main:0.62, door:'double_door', shop:true, yard:['dumpster', 'pallet', 'carts', 'trash']},
    {id:'pharmacy', name:'Аптека', w:[6, 8], h:[6, 8], shapes:['rect', 'L'], ext:['concrete', 'brick'], prog:['sales_drug', 'storage', 'office', 'bath'], room:[7, 14], main:0.55, shop:true, yard:['dumpster', 'trash', 'phone_booth']},
    {id:'hardware', name:'Хозмаг', w:[7, 10], h:[6, 9], shapes:['rect', 'L', 'T'], ext:['concrete', 'brick'], prog:['sales_tool', 'storage', 'workshop', 'office'], room:[8, 18], main:0.58, door:'double_door', shop:true, yard:['pallet', 'tire_stack', 'scrap_pile', 'dumpster']},
    {id:'garage', name:'Автомастерская', w:[7, 11], h:[6, 9], shapes:['rect', 'L'], ext:['metal', 'concrete', 'brick'], prog:['garage_bay', 'workshop', 'office', 'storage'], room:[8, 20], main:0.6, door:'gate_metal', yard:['tire_stack', 'car_wreck', 'barrels_group', 'scrap_pile', 'pickup_rust']},
    {id:'clinic', name:'Клиника', w:[9, 12], h:[8, 11], shapes:['rect', 'L', 'T', 'wings'], ext:['concrete', 'brick'], prog:['reception', 'ward', 'surgery', 'ward', 'office', 'bath', 'storage', 'lab'], room:[8, 16], door:'double_door', yard:['stretcher', 'dumpster', 'car_wreck', 'trash']},
    {id:'office', name:'Контора', w:[9, 12], h:[8, 12], shapes:['rect', 'U', 'court'], ext:['concrete', 'brick'], prog:['hall', 'office', 'office', 'boss', 'archive', 'bath', 'kitchen', 'server'], room:[8, 16], entry:['hall'], door:'double_door', yard:['car_wreck', 'lamp_post', 'jersey', 'dumpster']},
    {id:'school', name:'Школа', w:[10, 12], h:[9, 12], shapes:['L', 'U', 'wings', 'court'], ext:['brick', 'concrete'], prog:['hall', 'classroom', 'classroom', 'office', 'bath', 'classroom', 'storage', 'archive'], room:[10, 20], entry:['hall'], door:'double_door', yard:['yard', 'dead_tree', 'tree_sparse', 'bus_stop']},
    {id:'bar', name:'Бар', w:[7, 10], h:[6, 9], shapes:['rect', 'L'], ext:['brick', 'wood'], prog:['dining', 'kitchen', 'storage', 'bath'], room:[8, 20], main:0.58, yard:['dumpster', 'barrel', 'oil_drum_fire', 'trash']},
    {id:'warehouse', name:'Склад', w:[9, 12], h:[7, 10], shapes:['rect', 'rect', 'L'], ext:['metal', 'concrete'], prog:['stockroom', 'office', 'storage'], room:[8, 16], main:0.72, door:'gate_metal', yard:['pallet', 'shipping_container', 'barrels_group', 'crate_wood']},
    {id:'chapel', name:'Часовня', w:[6, 9], h:[7, 10], shapes:['rect', 'T'], ext:['brick', 'wood'], prog:['chapel', 'storage', 'office'], room:[8, 16], main:0.66, door:'double_door', yard:['dead_tree', 'skull_totem', 'tree_sparse']},
    {id:'police', name:'Участок', w:[9, 12], h:[8, 11], shapes:['rect', 'L', 'T'], ext:['concrete', 'brick'], prog:['reception', 'office', 'arsenal', 'cell', 'cell', 'lockerroom', 'bath', 'server'], room:[7, 14], door:'double_door', yard:['car_wreck', 'jersey', 'sandbags_line', 'barricade']},
    {id:'boxgarage', name:'Гаражный бокс', w:[4, 6], h:[5, 7], shapes:['rect'], ext:['metal', 'brick', 'concrete'], prog:['garage_bay'], room:[30, 40], door:'gate_metal', yard:['tire_stack', 'car_wreck', 'barrel', 'scrap_pile']},
    {id:'boiler', name:'Котельная', w:[5, 8], h:[5, 7], shapes:['rect', 'L'], ext:['brick', 'concrete'], prog:['boilerroom', 'storage'], room:[12, 30], main:0.7, yard:['chimney', 'pipe_straight', 'barrels_group', 'scrap_pile']},
    {id:'substation', name:'Трансформаторная', w:[4, 6], h:[4, 6], shapes:['rect'], ext:['brick', 'concrete'], prog:['substation'], room:[30, 40], door:'gate_metal', yard:['transformer', 'jersey', 'electric_panel']},
    {id:'guardhouse', name:'Сторожка', w:[4, 6], h:[4, 6], shapes:['rect', 'L'], ext:['wood', 'brick', 'metal'], prog:['guard', 'bath'], room:[10, 20], main:0.7, yard:['barricade', 'oil_drum_fire', 'lamp_post', 'sandbags_line']},
    {id:'laundromat', name:'Прачечная', w:[6, 8], h:[5, 7], shapes:['rect', 'L'], ext:['brick', 'concrete'], prog:['laundry_big', 'storage', 'bath'], room:[8, 18], main:0.65, door:'double_door', shop:true, yard:['dumpster', 'carts', 'trash']},
    {id:'cafe', name:'Кафе', w:[5, 8], h:[5, 7], shapes:['rect', 'L'], ext:['brick', 'wood'], prog:['dining', 'kitchen', 'bath'], room:[8, 18], main:0.6, shop:true, yard:['restaurant_table', 'trash', 'dumpster']},
    {id:'lab', name:'Лаборатория', w:[9, 12], h:[8, 11], shapes:['rect', 'L', 'wings'], ext:['concrete', 'metal'], prog:['hall', 'lab', 'lab', 'server', 'storage', 'bath', 'office'], room:[8, 16], entry:['hall'], yard:['barrel_toxic', 'rad_sign', 'generator', 'transformer']},
  ];
  const ARCH_BY = {}; ARCH.forEach(a=>{ ARCH_BY[a.id] = a; });
  const ARCH_X = []; // типы зданий из дополнений (addArch): мотель, закусочная, цех, пультовая…
  function addArch(a){ if(!a || ARCH_BY[a.id]) return; ARCH_X.push(a); ARCH_BY[a.id] = a; }
  const THEMES = {live:['house', 'cottage', 'apartment', 'laundromat', 'cafe', 'bar', 'guardhouse', 'chapel'], trade:['grocery', 'pharmacy', 'hardware', 'bar', 'cafe', 'laundromat', 'warehouse'],
    industry:['garage', 'boxgarage', 'warehouse', 'boiler', 'substation', 'guardhouse', 'hardware', 'lab'], civic:['clinic', 'office', 'school', 'chapel', 'police', 'lab', 'pharmacy']};
  const RUIN_POOL = {low:['abandoned', 'barricaded', 'flooded', 'looted'], high:['burnt', 'collapsed', 'looted', 'raiders', 'overgrown']};
  const SCENE_P = {none:0, normal:0.55, many:0.9};
  const SHAPE_MIN = {rect:[4, 4], L:[6, 6], T:[7, 6], U:[8, 7], court:[10, 10], wings:[10, 5]};
  // Прямоугольники корпуса в локальных координатах (0..w, 0..h)
  function shapeRects(g, shape, w, h){
    const tr = (rs)=>rs.map(([x, y, rw, rh])=>[y, x, rh, rw]);
    const mx = (rs, W)=>rs.map(([x, y, rw, rh])=>[W - x - rw, y, rw, rh]), my = (rs, H)=>rs.map(([x, y, rw, rh])=>[x, H - y - rh, rw, rh]);
    let rs;
    if(shape==='L'){ const cw = g.ri(Math.ceil(w*0.35), Math.floor(w*0.55)), ch = g.ri(Math.ceil(h*0.35), Math.floor(h*0.55)); rs = [[0, 0, w - cw, h], [w - cw, ch, cw, h - ch]]; if(g.rnd() < 0.5) rs = mx(rs, w); if(g.rnd() < 0.5) rs = my(rs, h); }
    else if(shape==='T'){ const T = (W, H)=>{ const hb = g.ri(Math.max(3, Math.ceil(H*0.4)), Math.max(3, Math.floor(H*0.55))), sw = g.ri(Math.max(3, Math.ceil(W*0.35)), Math.max(3, Math.floor(W*0.55))), sx = Math.max(0, Math.min(W - sw, Math.floor((W - sw)/2) + g.ri(-1, 1))); return [[0, 0, W, hb], [sx, hb, sw, H - hb]]; };
      rs = w >= h || h < 7 ? T(w, h) : tr(T(h, w)); if(g.rnd() < 0.5) rs = w >= h || h < 7 ? my(rs, h) : mx(rs, w); }
    else if(shape==='U'){ const U = (W, H)=>{ const lw = g.ri(3, Math.max(3, Math.floor(W*0.35))), rw = g.ri(3, Math.max(3, Math.floor(W*0.35))), bh = g.ri(3, Math.max(3, Math.floor(H*0.45))); if(W - lw - rw < 2) return [[0, 0, W, H]]; return [[0, 0, lw, H], [W - rw, 0, rw, H], [lw, H - bh, W - lw - rw, bh]]; };
      rs = U(w, h); if(g.rnd() < 0.5) rs = my(rs, h); }
    else if(shape==='court'){ const t = g.ri(3, 4); if(w - 2*t < 3 || h - 2*t < 3) return [[0, 0, w, h]]; rs = [[0, 0, w, t], [0, h - t, w, t], [0, t, t, h - 2*t], [w - t, t, t, h - 2*t]]; }
    else if(shape==='wings'){ const Wg = (W, H)=>{ const a = g.ri(4, Math.max(4, Math.floor(W*0.42))), b = g.ri(4, Math.max(4, Math.floor(W*0.42))); if(W - a - b < 1) return [[0, 0, W, H]]; const cy = g.ri(0, Math.max(0, H - 2)); return [[0, 0, a, H], [W - b, 0, b, H], [a, cy, W - a - b, 2]]; };
      rs = w >= h ? Wg(w, h) : tr(Wg(h, w)); }
    else rs = [[0, 0, w, h]];
    return rs;
  }
  // Деление прямоугольника на комнаты (BSP); main — доля главного зала у первого прямоугольника
  function splitRooms(g, r, area, main, out){
    const [x, y, w, h] = r, minD = Math.min(w, h) < 3 ? Math.min(w, h) : 3;
    if(main && Math.max(w, h) >= 6){ const along = w >= h, len = along ? w : h, cut = Math.max(3, Math.min(len - 3, Math.round(len*main)));
      if(along){ out.push([x, y, cut, h, 1]); splitRooms(g, [x + cut, y, w - cut, h], area, 0, out); } else { out.push([x, y, w, cut, 1]); splitRooms(g, [x, y + cut, w, h - cut], area, 0, out); } return; }
    const target = area[0] + g.rnd()*(area[1] - area[0]);
    if(w*h <= target || (w < 6 && h < 6) || minD < 3){ out.push([x, y, w, h, 0]); return; }
    const along = w > h || (w===h && g.rnd() < 0.5), len = along ? w : h; if(len < 6){ out.push([x, y, w, h, 0]); return; }
    const cut = g.ri(3, len - 3);
    if(along){ splitRooms(g, [x, y, cut, h], area, 0, out); splitRooms(g, [x + cut, y, w - cut, h], area, 0, out); }
    else { splitRooms(g, [x, y, w, cut], area, 0, out); splitRooms(g, [x, y + cut, w, h - cut], area, 0, out); }
  }
  // План здания (без записи в карту): форма, комнаты с ролями, грани стен, двери и окна
  function planBuilding(g, arch, x0, y0, w, h, front){
    const shapes = arch.shapes.filter(s=>w >= SHAPE_MIN[s][0] && h >= SHAPE_MIN[s][1] || (s==='wings' || s==='T') && h >= SHAPE_MIN[s][0] && w >= SHAPE_MIN[s][1]);
    const shape = g.bagFit('shape:' + arch.id, arch.shapes, s=>shapes.indexOf(s) >= 0) || 'rect';
    const rects = shapeRects(g, shape, w, h).filter(r=>r[2] > 0 && r[3] > 0);
    rects.sort((a, b)=>b[2]*b[3] - a[2]*a[3]);
    const raw = []; rects.forEach((r, i)=>splitRooms(g, r, arch.room, i===0 && arch.main ? arch.main : 0, raw));
    const R = new Int16Array(w*h).fill(-1), rooms = raw.map(([x, y, rw, rh, m], i)=>{ for(let j=y;j<y + rh;j++) for(let k=x;k<x + rw;k++) R[j*w + k] = i; return {i, x, y, w:rw, h:rh, main:!!m}; });
    const at = (x, y)=>x >= 0 && y >= 0 && x < w && y < h ? R[y*w + x] : -1;
    // роли: главная — самой большой (или выделенному залу), остальные по желаемому размеру
    const prog = arch.prog.slice(); const extra = ['storage', 'office', 'bath', 'bedroom', 'hall'];
    while(prog.length < rooms.length) prog.push(g.pick(extra));
    const order = rooms.slice().sort((a, b)=>(b.main - a.main) || (b.w*b.h - a.w*a.h));
    const rest = prog.slice(1, rooms.length).map((r, i)=>({r, i})).sort((a, b)=>(ROLES[b.r].sz - ROLES[a.r].sz) || (a.i - b.i)).map(x=>x.r);
    order.forEach((rm, i)=>{ rm.role = i===0 ? prog[0] : rest[i - 1]; });
    // маленькая комната, доставшаяся «большой» роли, получает подходящую маленькую
    rooms.forEach(rm=>{ if(rm.w < 3 || rm.h < 3){ rm.role = rm.w*rm.h <= 4 ? 'storage' : 'hall'; } });
    const pal = {}; rooms.forEach(rm=>{ if(!pal[rm.role]) pal[rm.role] = g.pick(ROLES[rm.role].fl); rm.floor = pal[rm.role]; });
    // грани: h:x:y — горизонтальная грань над клеткой (x, y); v:x:y — вертикальная слева от (x, y)
    const edges = []; for(let y=0;y<=h;y++) for(let x=0;x<w;x++){ const a = at(x, y - 1), b = at(x, y); if(a!==b) edges.push({k:'h:' + x + ':' + y, o:'h', x, y, a, b, ext:a < 0 || b < 0, side:a < 0 ? 0 : b < 0 ? 2 : -1}); }
    for(let x=0;x<=w;x++) for(let y=0;y<h;y++){ const a = at(x - 1, y), b = at(x, y); if(a!==b) edges.push({k:'v:' + x + ':' + y, o:'v', x, y, a, b, ext:a < 0 || b < 0, side:a < 0 ? 3 : b < 0 ? 1 : -1}); }
    const E = {}; edges.forEach(e=>{ E[e.k] = e; });
    const open = {}, doors = [], windows = [];
    // смежность комнат и дверь в середине общей стены
    const shared = {}; edges.forEach(e=>{ if(e.ext) return; const p = Math.min(e.a, e.b) + '-' + Math.max(e.a, e.b); (shared[p] = shared[p] || []).push(e); });
    const pairs = Object.keys(shared).map(p=>({p, a:+p.split('-')[0], b:+p.split('-')[1], es:shared[p]}));
    const doorOn = (es)=>{ const s = es.slice().sort((a, b)=>(a.x - b.x) || (a.y - b.y)); const pick = s.length >= 3 ? s[g.ri(1, s.length - 2)] : s[0]; open[pick.k] = 1; doors.push({es:[pick], ext:false}); };
    const entryRoles = arch.entry || [prog[0]];
    const entry = rooms.find(rm=>entryRoles.indexOf(rm.role) >= 0) || order[0];
    const conn = new Set([entry.i]); let guard = 0;
    while(conn.size < rooms.length && guard++ < 200){ const cand = pairs.filter(q=>conn.has(q.a)!==conn.has(q.b)); if(!cand.length) break; const q = g.pick(cand); doorOn(q.es); conn.add(q.a); conn.add(q.b); q.used = 1; }
    pairs.forEach(q=>{ if(!q.used && g.rnd() < 0.18) doorOn(q.es); });
    // наружные грани комнаты, сгруппированные в непрерывные отрезки по стороне
    function extRuns(rm, side){ const es = edges.filter(e=>e.ext && (e.a===rm.i || e.b===rm.i) && (side==null || e.side===side) && !open[e.k]);
      const by = {}; es.forEach(e=>{ const key = e.o + ':' + (e.o==='h' ? e.y : e.x) + ':' + e.side; (by[key] = by[key] || []).push(e); });
      const runs = []; Object.values(by).forEach(list=>{ list.sort((a, b)=>e2p(a) - e2p(b)); let cur = [list[0]]; for(let i=1;i<list.length;i++){ if(e2p(list[i]) === e2p(list[i - 1]) + 1) cur.push(list[i]); else { runs.push(cur); cur = [list[i]]; } } runs.push(cur); }); return runs; }
    const e2p = (e)=>e.o==='h' ? e.x : e.y;
    function placeOpening(rm, len, sides, kind){ for(const side of sides){ const runs = g.shuffle(extRuns(rm, side).filter(r=>r.length >= len + 2)); if(!runs.length) continue; const run = runs[0], st = g.ri(1, run.length - len - 1), es = run.slice(st, st + len); es.forEach(e=>{ open[e.k] = 1; }); return es; } return null; }
    const dLen = arch.door==='gate_metal' ? 3 : arch.door==='double_door' ? 2 : 1;
    const sides = [front].concat(g.shuffle([0, 1, 2, 3].filter(s=>s!==front)));
    let es = placeOpening(entry, dLen, sides) || placeOpening(entry, 1, sides) || rooms.map(rm=>placeOpening(rm, 1, sides)).find(Boolean);
    if(es) doors.push({es, ext:true, kind:es.length===dLen ? (arch.door || 'door') : 'door'});
    if(g.rnd() < 0.5 || arch.shop){ const back = rooms.filter(rm=>rm!==entry && ['storage', 'kitchen', 'workshop', 'hall', 'garage_bay'].indexOf(rm.role) >= 0); const rm = back.length ? g.pick(back) : null; const e2 = rm && placeOpening(rm, 1, g.shuffle([0, 1, 2, 3].filter(s=>s!==front))); if(e2) doors.push({es:e2, ext:true, kind:'door'}); }
    // окна: витрины у магазина на фасаде, обычные — через 2–4 клетки
    const dark = {bath:0.35, storage:0.15, cell:0, arsenal:0, server:0, stockroom:0.2, lab:0.6};
    rooms.forEach(rm=>{
      if(arch.shop && rm===entry){ for(let t=0;t<2;t++){ const w3 = placeOpening(rm, 3, [front]); if(w3) windows.push({es:w3, kind:'display_window'}); } }
      const pw = dark[rm.role]==null ? 1 : dark[rm.role]; if(g.rnd() > pw) return;
      extRuns(rm).forEach(run=>{ const step = g.ri(2, 4); for(let i=1 + g.ri(0, 1);i<run.length - 1;i+=step){ const e = run[i]; if(open[e.k] || run[i - 1] && open[run[i - 1].k] || run[i + 1] && open[run[i + 1].k]) continue; open[e.k] = 1; windows.push({es:[e], kind:'window'}); } });
    });
    return {arch, shape, x0, y0, w, h, rooms, edges, open, doors, windows, front, R};
  }
  function tooSimilar(g, p){ return g.built.some(b=>b.arch===p.arch.id && (b.shape===p.shape && Math.abs(b.w - p.w) + Math.abs(b.h - p.h) <= 3 || b.rooms===p.rooms.length && b.shape===p.shape)); }
  // Запись плана в карту: полы, стены (наружные + перегородки), двери, окна, мебель, двор
  // Состояние здания: одно на здание, из колоды карты. v — какие варианты предметов (intact/ruined), prefer — какие
  // варианты брать охотнее, drop — доля мебели, которой нет, wallLoss — доля обрушенных стен, остальное — что добавить.
  const BSTATES = [
    {id:'abandoned', name:'брошен', v:'intact', prefer:/разворош|грязн|потёрт|почти|пыльн/i, junk:['trash'], drop:0.1},
    {id:'looted', name:'разграблен', v:'ruined', prefer:/вскры|открыт|разграб|пуст|выбит|распахн|почти/i, drop:0.3, junk:['trash', 'trash', 'blood'], doorsOpen:1},
    {id:'burnt', name:'сгорел', v:'ruined', prefer:/сгор|обгор|горят|взорв/i, drop:0.35, ash:0.5, wallLoss:0.1, junk:['rubble_pile', 'trash']},
    {id:'flooded', name:'затоплен', v:'intact', prefer:/мутн|ржав|плесен|протека/i, water:0.45, junk:['trash', 'barrel']},
    {id:'barricaded', name:'забаррикадирован', v:'intact', prefer:/заколоч|забаррик/i, windows:/заколоч/i, guard:['barricade', 'cover_concrete', 'sandbags_line'], camp:['sleeping_bag', 'medkit', 'lamp', 'barrel']},
    {id:'overgrown', name:'зарос', v:'ruined', prefer:/ржав|сгни|плесен|пыльн/i, grass:0.5, plants:['dry_bush', 'dry_bush', 'tree_sparse', 'reeds', 'glow_mushrooms', 'mutant_plant'], wallLoss:0.05, drop:0.15},
    {id:'raiders', name:'логово рейдеров', v:'ruined', prefer:/разгром|разграб|вскры|открыт/i, windows:/заколоч/i, camp:['sleeping_bag', 'sleeping_bag', 'oil_drum_fire', 'weapon_rack', 'scrap_pile', 'tire_stack', 'ammo_crate'], outside:['skull_totem', 'barricade_car', 'oil_drum_fire'], guard:['barricade']},
    {id:'collapsed', name:'обрушен', v:'ruined', wallLoss:0.12, junk:['rubble_pile', 'rubble_pile', 'trash'], drop:0.2},
  ];
  // Мини-сцены: каждая — не больше раза на карту; ставятся в подходящую комнату по тем же правилам расстановки
  const VIGNETTES = [
    {id:'last_stand', name:'последняя оборона', roles:null, it:[{a:['barricade', 'cover_concrete'], m:'center'}, {a:['corpse'], m:'center', n:[1, 2]}, {a:['blood'], m:'floor', n:[2, 3]}, {a:['ammo_crate'], m:'corner'}, {a:['weapon_rack'], m:'wall', p:0.5}]},
    {id:'field_hospital', name:'лазарет выживших', roles:['living', 'hall', 'classroom', 'dining', 'ward', 'office', 'chapel'], it:[{a:['sleeping_bag'], m:'wall', n:[2, 4]}, {a:['medkit'], m:'corner', n:[1, 2]}, {a:['table_small'], m:'center'}, {a:['lamp'], m:'corner'}, {a:['blood'], m:'floor'}]},
    {id:'cult', name:'логово культа', roles:null, it:[{a:['rug'], m:'floor'}, {a:['skull_totem'], m:'center'}, {a:['bone_pile'], m:'corner', n:[1, 3]}, {a:['blood'], m:'floor', n:[1, 2]}, {a:['lamp'], m:'corner', n:[2, 3]}, {a:['table_small'], m:'wall'}]},
    {id:'drifters', name:'стоянка бродяг', roles:null, it:[{a:['sleeping_bag'], m:'wall', n:[1, 2]}, {a:['oil_drum_fire', 'campfire'], m:'center'}, {a:['trash'], m:'floor', n:[1, 2]}, {a:['tire_stack', 'crate_wood'], m:'corner'}]},
    {id:'execution', name:'место казни', roles:null, it:[{a:['corpse'], m:'wall', n:[2, 3]}, {a:['blood'], m:'floor', n:[2, 4]}, {a:['chair'], m:'center'}]},
    {id:'lair', name:'логово мутанта', roles:null, it:[{a:['bone_pile'], m:'corner', n:[2, 3]}, {a:['cocoon'], m:'wall', n:[1, 2]}, {a:['blood'], m:'floor', n:[1, 2]}, {a:['glow_mushrooms'], m:'corner', n:[1, 3]}]},
    {id:'stash', name:'тайник мародёров', roles:['storage', 'archive', 'office', 'boss', 'stockroom', 'garage_bay', 'workshop', 'b_store', 'b_pantry'], it:[{a:['crate_metal'], m:'corner', n:[2, 3]}, {a:['safe'], m:'corner'}, {a:['ammo_crate'], m:'corner', n:[1, 2]}, {a:['barrel'], m:'corner'}]},
    {id:'tripwire', name:'растяжка у входа', roles:null, door:1, it:[{a:['tripwire'], m:'door'}, {a:['bear_trap'], m:'center', p:0.7}]},
    {id:'radio', name:'радиоузел выживших', roles:['office', 'boss', 'server', 'hall', 'living', 'b_server', 'b_guard'], it:[{a:['radio'], m:'wall'}, {a:['terminal'], m:'wall'}, {a:['generator'], m:'corner', p:0.6}, {a:['sleeping_bag'], m:'wall'}, {a:['lamp'], m:'corner'}]},
    {id:'stalker', name:'погибший сталкер', roles:null, it:[{a:['corpse'], m:'center'}, {a:['artifact'], m:'center'}, {a:['medkit'], m:'center', p:0.6}, {a:['blood'], m:'floor'}]},
    {id:'ambush', name:'засада', roles:null, door:1, it:[{a:['sandbags_line', 'cover_concrete'], m:'facedoor'}, {a:['ammo_crate'], m:'corner'}, {a:['sleeping_bag'], m:'wall', p:0.5}]},
  ];
  function commitBuilding(g, p, st){
    const {x0, y0, w, h, rooms, edges, open, arch} = p, doc = g.doc;
    rooms.forEach(rm=>g.rectT(x0 + rm.x, y0 + rm.y, rm.w, rm.h, rm.floor));
    // внутренний двор / ниша формы — грунт или трава
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(p.R[y*w + x] < 0) g.setT(x0 + x, y0 + y, g.pick(['dirt', 'grass', 'dust']));
    // состояние меняет пол: пепел, вода, поросль
    const nz = g.noise(2.5, g.ri(1, 9999));
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ if(p.R[y*w + x] < 0) continue; const v = nz(x0 + x, y0 + y);
      if(st.ash && v < st.ash) g.setT(x0 + x, y0 + y, 'ash'); else if(st.water && v < st.water*1.2) g.setT(x0 + x, y0 + y, v < st.water*0.75 ? 'water' : 'mud'); else if(st.grass && v < st.grass) g.setT(x0 + x, y0 + y, v < 0.12 ? 'mutant' : 'grass'); }
    const extKind = g.bag('ext:' + arch.id, arch.ext), gone = {}, loss = st.wallLoss || 0;
    if(loss){ edges.forEach(e=>{ if(!open[e.k] && g.rnd() < (e.ext ? loss*0.7 : loss)){ let k = e, n = g.ri(1, 3); while(k && n--){ gone[k.k] = 1; k = edges.find(q=>q.o===k.o && q.ext===k.ext && (k.o==='h' ? q.y===k.y && q.x===k.x + 1 : q.x===k.x && q.y===k.y + 1)); } } }); }
    // отрезки стен: подряд идущие грани одной линии и одного вида
    ['h', 'v'].forEach(o=>{ const list = edges.filter(e=>e.o===o && !open[e.k] && !gone[e.k]).sort((a, b)=>o==='h' ? (a.y - b.y) || (a.x - b.x) : (a.x - b.x) || (a.y - b.y));
      let run = null; const flush = ()=>{ if(!run) return; const kind = run.ext ? extKind : 'plaster'; if(o==='h') g.wall(kind, [[x0 + run.s, y0 + run.l], [x0 + run.e + 1, y0 + run.l]]); else g.wall(kind, [[x0 + run.l, y0 + run.s], [x0 + run.l, y0 + run.e + 1]]); run = null; };
      list.forEach(e=>{ const l = o==='h' ? e.y : e.x, pos = o==='h' ? e.x : e.y; if(run && run.l===l && run.ext===e.ext && run.e===pos - 1) run.e = pos; else { flush(); run = {l, s:pos, e:pos, ext:e.ext}; } }); flush(); });
    const mid = (es)=>{ const a = es[0], b = es[es.length - 1]; return a.o==='h' ? [x0 + (a.x + b.x + 1)/2, y0 + a.y, 0] : [x0 + a.x, y0 + (a.y + b.y + 1)/2, 90]; };
    // клетки по обе стороны двери — проход: туда не ставится мебель, от них проверяется доступность
    const entries = [], keep = (e)=>{ const cs = e.o==='h' ? [[e.x, e.y - 1], [e.x, e.y]] : [[e.x - 1, e.y], [e.x, e.y]]; cs.forEach(([cx, cy])=>{ if(cx >= 0 && cy >= 0 && cx < w && cy < h && p.R[cy*w + cx] >= 0){ g.mark(x0 + cx, y0 + cy, 1, 1); entries.push([x0 + cx, y0 + cy, e]); } }); };
    const vs = {state:st.v, prefer:st.prefer};
    p.doors.forEach(d=>{ d.es.forEach(keep); if(st.v==='ruined' && !d.ext && g.rnd() < 0.3) return; const [cx, cy, r] = mid(d.es); const a = d.kind || 'door';
      doc.objects.push({id:newId('o'), a, x:cx, y:cy, r, s:1, v:g.variant(a, st.v, st.doorsOpen ? /открыт|распахн|выбит|сорван/i : st.prefer), f:g.rnd() < 0.5}); });
    p.windows.forEach(wd=>{ const [cx, cy, r] = mid(wd.es); doc.objects.push({id:newId('o'), a:wd.kind, x:cx, y:cy, r, s:1, v:g.variant(wd.kind, st.v, st.windows || st.prefer), f:false}); });
    // мебель: комнаты в глобальных координатах, со входами
    const R = rooms.map(rm=>({x:x0 + rm.x, y:y0 + rm.y, w:rm.w, h:rm.h, role:rm.role, entries:entries.filter(([ex, ey])=>ex >= x0 + rm.x && ey >= y0 + rm.y && ex < x0 + rm.x + rm.w && ey < y0 + rm.y + rm.h)}));
    R.forEach(rm=>furnish(g, rm, Object.assign({drop:st.drop || 0, ruined:st.v==='ruined'}, vs)));
    // следы состояния
    R.forEach(rm=>{
      if(st.junk) for(let i=0;i<g.ri(0, 2);i++) placeSpecs(g, rm, [{a:st.junk, m:g.rnd() < 0.5 ? 'floor' : 'center'}], vs);
      if(st.plants && g.rnd() < 0.6) placeSpecs(g, rm, [{a:st.plants, m:'center', n:[1, 2]}], vs);
      if(st.camp && g.rnd() < 0.45) placeSpecs(g, rm, [{a:st.camp, m:'wall', n:[1, 2]}], vs);
    });
    if(st.guard) R.forEach(rm=>{ if(rm.entries.some(e=>e[2].ext)) placeSpecs(g, rm, [{a:st.guard, m:'facedoor'}], vs); });
    // мини-сцена — в одной комнате, без повторов на карте
    if(g.rnd() < (SCENE_P[g.opts.scenes] != null ? SCENE_P[g.opts.scenes] : 0.55)){ const rms = g.shuffle(R.slice()).sort((a, b)=>ownSceneFits(g, b) - ownSceneFits(g, a)); for(const rm of rms){ const id = placeScene(g, rm); if(id){ p.scene = id; break; } } }
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(p.R[y*w + x] >= 0) g.occ[(y0 + y)*doc.cols + x0 + x] = 1;
    if(st.outside) for(let i=0;i<g.ri(1, 2);i++) g.tryObj(g.pick(st.outside), Math.max(0, x0 - 3), Math.max(0, y0 - 3), Math.min(doc.cols, x0 + w + 3), Math.min(doc.rows, y0 + h + 3), 8);
    g.built.push({arch:arch.id, shape:p.shape, w, h, rooms:rooms.length});
    p.rmG = R.map(rm=>[rm.x, rm.y, rm.w, rm.h, rm.role]);
  }
  /* ---------- Заготовки: нарисованные вручную комнаты и сцены ----------
     Генератор ставит заготовку целиком (с поворотом на 90°×k и отражением), если комната подходит по типу и
     размеру и все предметы встают, не перекрывая проходов. Своя заготовка — выделенные в редакторе предметы,
     сохранённые в этом браузере. Каждая заготовка — не больше раза на карту. */
  const PF_KEY = 'reincarnator_prefabs_v1';
  const PF_GROUPS = {
    any:['Любая', null],
    living:['Жилая / отдых', ['living', 'b_rec', 'hall']],
    bedroom:['Спальня / казарма', ['bedroom', 'b_barracks', 'cell', 'b_isol', 'b_director']],
    kitchen:['Кухня / столовая', ['kitchen', 'b_mess', 'dining', 'b_pantry']],
    bath:['Санузел / душевые', ['bath', 'b_wash', 'lockerroom', 'b_decon', 'laundry', 'laundry_big']],
    storage:['Склад / подсобка', ['storage', 'stockroom', 'archive', 'b_store', 'b_pantry', 'sales_tool']],
    office:['Кабинет / пост', ['office', 'boss', 'b_cmd', 'b_guard', 'reception', 'b_director', 'server', 'b_server', 'guard', 'b_check']],
    shop:['Магазин', ['sales_food', 'sales_drug', 'sales_tool']],
    work:['Мастерская / техника', ['workshop', 'garage_bay', 'b_power', 'b_pump', 'boilerroom', 'substation', 'b_vent']],
    med:['Медицина', ['ward', 'surgery', 'b_med', 'b_quar', 'b_morgue']],
    lab:['Лаборатория', ['lab', 'b_biolab', 'b_chemlab', 'b_cryo', 'b_anomlab', 'b_observe']],
    hall:['Зал / класс', ['hall', 'classroom', 'chapel', 'dining']],
  };
  // взаимозаменяемые предметы: при «заменах» заготовка выглядит чуть иначе каждый раз
  const PF_SWAP = [['crate_wood', 'crate_metal', 'ammo_crate'], ['barrel', 'barrel_toxic'], ['bed', 'bunk'], ['terminal', 'radio'], ['bookshelf', 'pantry_shelves'], ['trash', 'blood'], ['lamp', 'medkit']];
  // встроенные: [предмет, x, y (левый верхний угол клетки), поворот]
  const PFB = (id, name, kind, group, w, h, items)=>({id, name, kind, group, w, h, swap:true, builtin:true, items:items.map(([a, x, y, r])=>{ const as = MapAssets.BY_ID[a] || {w:1, h:1}, q = (r || 0)%180===90; return {a, x:x + (q ? as.h : as.w)/2, y:y + (q ? as.w : as.h)/2, r:r || 0, v:null, f:false, s:1}; })});
  const PREFABS_BUILTIN = [
    PFB('bedroom_cozy', 'Уютная спальня', 'room', 'bedroom', 5, 4, [['bed', 0, 0, 0], ['table_small', 1, 0, 0], ['wardrobe', 3, 0, 0], ['rug', 2, 1, 90], ['chair', 4, 3, 0], ['lamp', 0, 3, 0]]),
    PFB('kitchen_family', 'Семейная кухня', 'room', 'kitchen', 5, 4, [['stove', 0, 0, 0], ['sink', 1, 0, 0], ['fridge', 2, 0, 0], ['pantry_shelves', 3, 0, 0], ['table_dining', 1, 2, 0], ['washing', 4, 3, 180]]),
    PFB('bath_full', 'Совмещённый санузел', 'room', 'bath', 3, 3, [['toilet', 0, 0, 0], ['sink', 1, 0, 0], ['bathtub', 2, 0, 0], ['washing', 0, 2, 180]]),
    PFB('living_tv', 'Гостиная с телевизором', 'room', 'living', 5, 5, [['tv', 2, 0, 0], ['rug', 1, 1, 0], ['table_small', 2, 2, 0], ['sofa', 1, 4, 180], ['bookshelf', 4, 1, 90], ['lamp', 0, 4, 0], ['chair', 3, 3, 0]]),
    PFB('workshop_bench', 'Слесарный угол', 'room', 'work', 5, 4, [['workbench', 0, 0, 0], ['lathe', 2, 0, 0], ['tire_stack', 4, 0, 0], ['press', 3, 2, 0], ['barrel', 0, 3, 0], ['crate_metal', 1, 3, 0]]),
    PFB('office_boss', 'Кабинет начальника', 'room', 'office', 4, 4, [['lamp', 0, 0, 0], ['office_desk', 1, 0, 0], ['chair', 3, 1, 0], ['bookshelf', 0, 3, 180], ['safe', 3, 3, 0]]),
    PFB('med_dressing', 'Перевязочная', 'room', 'med', 5, 4, [['hospital_bed', 0, 0, 0], ['medkit', 1, 0, 0], ['hospital_bed', 2, 0, 0], ['sink', 4, 0, 0], ['stretcher', 4, 2, 0], ['table_small', 1, 3, 0]]),
    PFB('storage_supply', 'Склад припасов', 'room', 'storage', 4, 3, [['pantry_shelves', 0, 0, 0], ['pantry_shelves', 2, 0, 0], ['crate_wood', 0, 2, 0], ['crate_metal', 1, 2, 0], ['barrel', 3, 2, 0]]),
    PFB('barracks_corner', 'Угол отделения', 'room', 'bedroom', 5, 4, [['bunk', 0, 0, 0], ['bunk', 1, 0, 0], ['bunk', 2, 0, 0], ['table_small', 4, 1, 0], ['locker', 2, 3, 180]]),
    PFB('lab_stand', 'Исследовательский стенд', 'room', 'lab', 5, 4, [['lab_bench', 0, 0, 0], ['terminal', 2, 0, 0], ['lab_bench', 3, 0, 0], ['containment_pod', 2, 2, 0], ['barrel_toxic', 0, 3, 0]]),
    PFB('scene_supper', 'Последний ужин', 'scene', 'any', 4, 4, [['corpse', 0, 0, 0], ['table_dining', 1, 1, 0], ['blood', 3, 1, 0], ['trash', 0, 3, 0], ['lamp', 3, 3, 0]]),
    PFB('scene_cards', 'Карточная игра', 'scene', 'any', 4, 3, [['chair', 1, 0, 0], ['chair', 0, 1, 0], ['table_small', 1, 1, 0], ['chair', 2, 1, 0], ['trash', 0, 2, 0], ['lamp', 3, 2, 0]]),
    PFB('scene_shrine', 'Алтарь', 'scene', 'any', 4, 4, [['lamp', 0, 0, 0], ['table_small', 1, 0, 0], ['skull_totem', 2, 0, 0], ['lamp', 3, 0, 0], ['rug', 1, 1, 0], ['blood', 2, 2, 0], ['bone_pile', 3, 3, 0]]),
    PFB('scene_night', 'Брошенная ночёвка', 'scene', 'any', 4, 3, [['sleeping_bag', 0, 0, 0], ['sleeping_bag', 1, 0, 0], ['oil_drum_fire', 3, 0, 0], ['trash', 2, 2, 0], ['radio', 3, 2, 0]]),
  ];
  function validPrefab(p){ return !!(p && typeof p.id==='string' && /^[a-z0-9_]{2,40}$/.test(p.id) && Array.isArray(p.items) && p.items.length && p.items.length <= 120 && p.w > 0 && p.h > 0 && p.w <= 30 && p.h <= 30 && PF_GROUPS[p.group]); }
  function userPrefabs(){ try{ const u = JSON.parse(localStorage.getItem(PF_KEY) || '[]'); return Array.isArray(u) ? u.filter(validPrefab) : []; }catch(e){ return []; } }
  function prefabList(){ return PREFABS_BUILTIN.concat(userPrefabs()); }
  function saveUserPrefabs(list){ try{ localStorage.setItem(PF_KEY, JSON.stringify(list.filter(validPrefab).slice(0, 200))); return true; }catch(e){ return false; } }
  function pfFits(p, rm){ const g2 = PF_GROUPS[p.group]; if(g2 && g2[1] && g2[1].indexOf(rm.role) < 0) return false; return Math.min(p.w, p.h) <= Math.min(rm.w, rm.h) && Math.max(p.w, p.h) <= Math.max(rm.w, rm.h); }
  const PF_P = {none:0, some:0.3, often:0.6};
  const ownSceneFits = (g, rm)=>userPrefabs().some(p=>p.kind==='scene' && !g.uses['pf:' + p.id] && pfFits(p, rm)) ? 1 : 0;
  // мини-сцена комнаты: своя/встроенная сцена-заготовка или процедурная; каждая — раз на карту
  function placeScene(g, rm){
    const pfs = prefabList().filter(p=>p.kind==='scene' && !g.uses['pf:' + p.id] && pfFits(p, rm));
    const vg = VIGNETTES.filter(v=>!g.uses['vg:' + v.id] && (!v.roles || v.roles.indexOf(rm.role) >= 0) && (!v.door || (rm.entries || []).length));
    const own = pfs.filter(p=>!p.builtin); // свои сцены — намеренно нарисованные, им приоритет
    if(pfs.length && (own.length && g.rnd() < 0.75 || g.rnd() < 0.4 || !vg.length)){ const pf = g.pick(own.length ? own : pfs); rm.prefab = null; placeSpecs(g, rm, [{m:'prefab', pf}], {state:'ruined'}); if(rm.prefab===pf.id){ g.uses['pf:' + pf.id] = 1; return pf.id; } }
    if(vg.length){ const v = g.pick(vg); g.uses['vg:' + v.id] = 1; placeSpecs(g, rm, v.it, {state:'ruined'}); return v.id; }
    return null;
  }
  // Мебель комнаты по рецепту роли + добор до плотности. opts: {state, prefer, drop, ruined}
  function furnish(g, rm, opts){
    if(typeof opts !== 'object' || !opts) opts = {ruined:!!opts, state:opts ? 'ruined' : 'intact'};
    const role = ROLES[rm.role]; if(!role) return;
    const pp = PF_P[g.opts && g.opts.prefabs]; let pf = null;
    if(g.rnd() < (pp == null ? PF_P.some : pp)){ const c = prefabList().filter(p=>p.kind!=='scene' && !g.uses['pf:' + p.id] && pfFits(p, rm)); if(c.length){ pf = g.pick(c); placeSpecs(g, rm, [{m:'prefab', pf}], opts); if(rm.prefab===pf.id) g.uses['pf:' + pf.id] = 1; else pf = null; } }
    if(!pf) placeSpecs(g, rm, role.it, opts);
    const dens = rm.role==='hall' ? 0.09 : role.sz===2 ? 0.2 : role.sz===1 ? 0.24 : 0.28, more = role.it.filter(it=>!it.focus && (it.m==='wall' || it.m==='corner' || it.m==='center'));
    for(let t=0;t<12 + rm.w*rm.h/3 && rm._used < rm.w*rm.h*dens*(1 - (opts.drop || 0)) && more.length;t++) placeSpecs(g, rm, [Object.assign({}, g.pick(more), {n:1, p:null})], opts);
    if(opts.ruined) placeSpecs(g, rm, [{a:['rubble_pile', 'trash', 'blood', 'corpse', 'trash'], m:'center', n:[0, 2]}], opts);
  }
  // Расстановка по списку правил с проверкой доступности: от каждого входа комнаты можно дойти
  // до остальных входов и встать вплотную к каждому предмету (к кровати — сбоку или в ногах).
  function placeSpecs(g, rm, specs, opts){
    opts = opts || {};
    const BY = MapAssets.BY_ID, doc = g.doc, cols = doc.cols;
    if(!rm._W){ rm._W = new Uint8Array(rm.w*rm.h); rm._items = []; rm._used = 0;
      const ent = {}; (rm.entries || []).forEach(([x, y])=>{ ent[x + ',' + y] = 1; });
      // уже занятое (не проходы у дверей) — препятствие
      for(let y=0;y<rm.h;y++) for(let x=0;x<rm.w;x++){ const gx = rm.x + x, gy = rm.y + y; if(g.occ[gy*cols + gx] && !ent[gx + ',' + gy]) rm._W[y*rm.w + x] = 1; } }
    const W = rm._W, items = rm._items, inR = (x, y)=>x >= rm.x && y >= rm.y && x < rm.x + rm.w && y < rm.y + rm.h, ix = (x, y)=>(y - rm.y)*rm.w + (x - rm.x);
    const entries = (rm.entries || []).filter(([x, y])=>inR(x, y));
    const rotFor = (a, side)=>BACK_LEFT[a] ? ((side + 1)%4)*90 : side*90;
    const dims = (a, r)=>{ const as = BY[a]; return r%180 ? [as.h, as.w] : [as.w, as.h]; };
    const access = (x, y, fw, fh, back)=>{ const out = []; for(let i=0;i<fw;i++){ if(back!==0) out.push([x + i, y - 1]); if(back!==2) out.push([x + i, y + fh]); } for(let j=0;j<fh;j++){ if(back!==3) out.push([x - 1, y + j]); if(back!==1) out.push([x + fw, y + j]); } return out.filter(([a, b])=>inR(a, b)); };
    function reachable(){
      const seen = new Uint8Array(W.length), st = [];
      let starts = entries.length ? entries : []; if(!starts.length){ for(let i=0;i<W.length;i++) if(!W[i]){ starts = [[rm.x + i%rm.w, rm.y + Math.floor(i/rm.w)]]; break; } }
      starts.forEach(([x, y])=>{ const i = ix(x, y); if(!W[i] && !seen[i]){ seen[i] = 1; st.push(i); } });
      while(st.length){ const i = st.pop(), cx = i%rm.w, cy = (i - cx)/rm.w; if(cx > 0 && !W[i - 1] && !seen[i - 1]){ seen[i - 1] = 1; st.push(i - 1); } if(cx < rm.w - 1 && !W[i + 1] && !seen[i + 1]){ seen[i + 1] = 1; st.push(i + 1); }
        if(cy > 0 && !W[i - rm.w] && !seen[i - rm.w]){ seen[i - rm.w] = 1; st.push(i - rm.w); } if(cy < rm.h - 1 && !W[i + rm.w] && !seen[i + rm.w]){ seen[i + rm.w] = 1; st.push(i + rm.w); } }
      if(entries.some(([x, y])=>!seen[ix(x, y)])) return false;
      return items.every(it=>it.acc.some(([x, y])=>seen[ix(x, y)]));
    }
    // занять клетки предмета; если после этого что-то стало недоступно — откатить
    function claim(x, y, fw, fh, back){ const cells = []; for(let j=y;j<y + fh;j++) for(let i=x;i<x + fw;i++){ if(!inR(i, j)) continue; const k = ix(i, j); if(W[k]) return false; cells.push(k); }
      cells.forEach(k=>{ W[k] = 1; }); items.push({acc:access(x, y, fw, fh, back), cells});
      if(!reachable()){ cells.forEach(k=>{ W[k] = 0; }); items.pop(); return false; } return true; }
    const unclaim = ()=>{ const it = items.pop(); if(it) it.cells.forEach(k=>{ W[k] = 0; }); };
    const put = (a, x, y, r, back, force)=>{ const as = BY[a]; if(!as) return false; const [fw, fh] = dims(a, r);
      if(!as.g){ if(!force && !g.free(x, y, fw, fh)) return false; if(!force && !claim(x, y, fw, fh, back)) return false; g.mark(x, y, fw, fh); rm._used += fw*fh; }
      doc.objects.push({id:newId('o'), a, x:x + fw/2, y:y + fh/2, r, s:1, v:g.variant(a, opts.state, opts.prefer), f:g.rnd() < 0.3}); return true; };
    const wallSpots = (a, side, corner)=>{ const r = rotFor(a, side), [fw, fh] = dims(a, r), out = [];
      if(side===0 || side===2){ const y = side===0 ? rm.y : rm.y + rm.h - fh; for(let x=rm.x;x<=rm.x + rm.w - fw;x++) out.push([x, y]); }
      else { const x = side===3 ? rm.x : rm.x + rm.w - fw; for(let y=rm.y;y<=rm.y + rm.h - fh;y++) out.push([x, y]); }
      return {r, list:corner ? (out.length > 1 ? [out[0], out[out.length - 1]] : out) : out}; };
    // сторона «спинки» для предмета у стены: спинка у стены side, доступ — с остальных сторон
    const backOf = (a, side)=>side;
    specs.forEach(it=>{
      if(it.p != null && g.rnd() > it.p) return;
      if(opts.drop && !it.focus && it.m!=='floor' && it.m!=='prefab' && g.rnd() < opts.drop) return;
      const n = Array.isArray(it.n) ? g.ri(it.n[0], it.n[1]) : (it.n == null ? 1 : it.n);
      for(let c=0;c<n;c++){
        if(it.m==='prefab'){ // заготовка: поворот 90°×k, отражение, у стены или свободно; все твёрдые предметы — или ничего
          const pf = it.pf;
          for(let t=0;t<14;t++){
            const rot = g.ri(0, 3), mir = g.rnd() < 0.5, W2 = rot%2 ? pf.h : pf.w, H2 = rot%2 ? pf.w : pf.h; if(W2 > rm.w || H2 > rm.h) continue;
            const ox = g.rnd() < 0.7 ? g.pick([rm.x, rm.x + rm.w - W2]) : g.ri(rm.x, rm.x + rm.w - W2), oy = g.rnd() < 0.7 ? g.pick([rm.y, rm.y + rm.h - H2]) : g.ri(rm.y, rm.y + rm.h - H2);
            const tr = pf.items.map(o=>{ let x = o.x, y = o.y, r = o.r || 0, f = !!o.f, w0 = pf.w, h0 = pf.h; if(mir){ x = w0 - x; r = (360 - r)%360; f = !f; }
              for(let k=0;k<rot;k++){ const nx = h0 - y, ny = x; x = nx; y = ny; r = (r + 90)%360; const q = w0; w0 = h0; h0 = q; }
              let a = o.a; if(pf.swap){ const grp = PF_SWAP.find(q=>q.indexOf(a) >= 0); if(grp && g.rnd() < 0.35) a = g.pick(grp); }
              return {a, x:ox + x, y:oy + y, r, f, s:o.s || 1, v:o.v}; });
            let ok = true, nc = 0; const boxes = [];
            for(const o of tr){ const as = BY[o.a]; if(!as){ ok = false; break; } if(as.g) continue; const q = Math.round(((o.r%180) + 180)%180)===90, fw = (q ? as.h : as.w)*o.s, fh = (q ? as.w : as.h)*o.s;
              const bx = Math.round(o.x - fw/2), by = Math.round(o.y - fh/2), cw = Math.max(1, Math.round(fw)), ch = Math.max(1, Math.round(fh));
              if(bx < rm.x || by < rm.y || bx + cw > rm.x + rm.w || by + ch > rm.y + rm.h || !g.free(bx, by, cw, ch) || !claim(bx, by, cw, ch)){ ok = false; break; } nc++; boxes.push([bx, by, cw, ch]); }
            if(!ok){ while(nc--) unclaim(); continue; }
            boxes.forEach(([bx, by, cw, ch])=>{ g.mark(bx, by, cw, ch); rm._used += cw*ch; });
            tr.forEach(o=>{ doc.objects.push({id:newId('o'), a:o.a, x:o.x, y:o.y, r:o.r, s:o.s, v:o.v==null || pf.swap ? g.variant(o.a, opts.state, opts.prefer) : o.v, f:o.f}); });
            rm.prefab = pf.id; break;
          }
          break;
        }
        const a = g.pick(it.a), as = BY[a]; if(!as) continue;
        if(it.m==='floor'){ const [fw, fh] = dims(a, 0); if(rm.w - 2 >= fw && rm.h - 2 >= fh) put(a, g.ri(rm.x + 1, rm.x + rm.w - 1 - fw), g.ri(rm.y + 1, rm.y + rm.h - 1 - fh), g.pick([0, 180]), null, true); else if(rm.w >= fw && rm.h >= fh) put(a, rm.x, rm.y, 0, null, true); continue; }
        if(it.m==='wall' || it.m==='corner'){ let ok = false; for(const side of g.shuffle([0, 1, 2, 3])){ const s = wallSpots(a, side, it.m==='corner'); for(const [x, y] of g.shuffle(s.list)){ if(put(a, x, y, s.r, backOf(a, side))){ ok = true; if(it.focus) rm.focus = side; break; } } if(ok) break; } continue; }
        if(it.m==='center'){ for(let t=0;t<16;t++){ const r = g.pick([0, 90, 180, 270]), [fw, fh] = dims(a, r); if(rm.w - 2 < fw || rm.h - 2 < fh) break; if(put(a, g.ri(rm.x + 1, rm.x + rm.w - 1 - fw), g.ri(rm.y + 1, rm.y + rm.h - 1 - fh), r)) break; } continue; }
        if(it.m==='door' || it.m==='facedoor'){ // у входа: растяжка поперёк прохода / укрытие лицом к двери через клетку
          const e = entries.length ? g.pick(entries) : null; if(!e) continue; const ed = e[2], horiz = ed.o==='h', r = horiz ? 0 : 90, [fw, fh] = dims(a, r);
          const inward = horiz ? (e[1] - rm.y < rm.h/2 ? 1 : -1) : (e[0] - rm.x < rm.w/2 ? 1 : -1), off = it.m==='door' ? 1 : 2;
          const cx = horiz ? e[0] - Math.floor((fw - 1)/2) : e[0] + inward*off - (inward < 0 ? fw - 1 : 0), cy = horiz ? e[1] + inward*off - (inward < 0 ? fh - 1 : 0) : e[1] - Math.floor((fh - 1)/2);
          if(inR(cx, cy) && inR(cx + fw - 1, cy + fh - 1)) put(a, cx, cy, r, null, it.m==='door' && as.g); continue; }
        if(it.m==='center1'){ const [fw, fh] = dims(a, 0), x = Math.round(rm.x + (rm.w - fw)/2), y = Math.round(rm.y + (rm.h - fh)/2); if(!put(a, x, y, 0)) put(a, x, y, 0, null, true); rm.c1 = {x:x + fw/2, y:y + fh/2, R:Math.max(fw, fh)/2}; break; }
        if(it.m==='ring'){ const cc = rm.c1 || {x:rm.x + rm.w/2, y:rm.y + rm.h/2, R:1}, R = Math.max(cc.R + 1, Math.min(cc.R + 1.6, Math.min(rm.w, rm.h)/2 - 0.7)), st = g.rnd()*Math.PI;
          for(let j=0;j<n;j++){ const th = st + j/n*Math.PI*2, px = cc.x + Math.cos(th)*R, py = cc.y + Math.sin(th)*R, x = Math.floor(px - as.w/2 + 0.5), y = Math.floor(py - as.h/2 + 0.5);
            if(x < rm.x || y < rm.y || x + as.w > rm.x + rm.w || y + as.h > rm.y + rm.h || !g.free(x, y, as.w, as.h) || !claim(x, y, as.w, as.h)) continue;
            g.mark(x, y, as.w, as.h); rm._used += as.w*as.h; doc.objects.push({id:newId('o'), a, x:px, y:py, r:Math.round((th*180/Math.PI + 90 + 720)%360), s:1, v:g.variant(a, opts.state, opts.prefer), f:false}); }
          break; }
        if(it.m==='rows'){ // ряды вдоль длинной стороны комнаты, проходы в клетку
          const alongX = rm.w >= rm.h, r = (as.w >= as.h) === alongX ? 0 : 90, [fw, fh] = dims(a, r);
          if(alongX){ for(let y=rm.y + 2;y + fh <= rm.y + rm.h - 1;y+=fh + 1) for(let x=rm.x + 1;x + fw <= rm.x + rm.w - 1;x+=fw) if(!(opts.ruined && g.rnd() < 0.15)) put(a, x, y, r); }
          else { for(let x=rm.x + 2;x + fw <= rm.x + rm.w - 1;x+=fw + 1) for(let y=rm.y + 1;y + fh <= rm.y + rm.h - 1;y+=fh) if(!(opts.ruined && g.rnd() < 0.15)) put(a, x, y, r); }
          break; }
        if(it.m==='grid'){ // парты, столы, скамьи — лицом к доске/алтарю (focus)
          const r = rm.focus != null ? rm.focus*90 : 0, [fw, fh] = dims(a, r), sx = fw + (fw > 1 ? 1 : 0), sy = fh + 1;
          for(let y=rm.y + 1 + (rm.focus===0 ? 1 : 0);y + fh <= rm.y + rm.h - 1 - (rm.focus===2 ? 1 : 0);y+=sy) for(let x=rm.x + 1 + (rm.focus===3 ? 1 : 0);x + fw <= rm.x + rm.w - 1 - (rm.focus===1 ? 1 : 0);x+=sx) if(!(opts.ruined && g.rnd() < 0.25)) put(a, x, y, r);
          break; }
      }
    });
  }
  // Здание в свободной области (bx0..bx1, by0..by1): тип из колоды, подходящий по месту; похожие корпуса перегенерируются
  function building(g, bx0, by0, bx1, by1, ruined, front, force, exact){
    const fits = (a)=>a.id!==g.avoidArch && Math.min(a.w[0], a.h[0]) <= Math.min(bx1 - bx0, by1 - by0) && Math.max(a.w[0], a.h[0]) <= Math.max(bx1 - bx0, by1 - by0);
    const th = THEMES[g.opts.theme], pool = RUIN_POOL[g.opts.ruin];
    // типы из дополнений (ARCH_X) — только в своей теме: у прежних районов колода та же, что и раньше (то же зерно — та же карта)
    const AP = th && ARCH_X.some(a=>th.indexOf(a.id) >= 0) ? ARCH.concat(ARCH_X.filter(a=>th.indexOf(a.id) >= 0)) : ARCH;
    for(let t=0;t<(force ? 1 : 8);t++){
      let arch = force ? ARCH_BY[force] : null;
      if(!arch && th && g.rnd() < 0.8) arch = g.bagFit('arch', AP, a=>fits(a) && th.indexOf(a.id) >= 0);
      if(!arch) arch = g.bagFit('arch', AP, fits); if(!arch) return null;
      const tries = force ? 16 : 6;
      for(let s=0;s<tries;s++){
        // последняя попытка при перегенерации — точно в прежнем пятне здания (оно расчищено)
        const last = exact && s===tries - 1;
        let w = last ? exact.w : g.ri(arch.w[0], arch.w[1]), h = last ? exact.h : g.ri(arch.h[0], arch.h[1]); if(!last && g.rnd() < 0.5){ const q = w; w = h; h = q; }
        if(last && Math.min(w, h) < Math.min(arch.w[0], arch.h[0])) continue; // в прежнее пятно не влезает минимальный размер типа
        if(!last){ w = Math.min(w, bx1 - bx0); h = Math.min(h, by1 - by0); if(w < Math.min(arch.w[0], arch.h[0]) || h < Math.min(arch.w[0], arch.h[0])) continue; }
        const x = last ? exact.x : g.ri(bx0, bx1 - w), y = last ? exact.y : g.ri(by0, by1 - h); if(last ? !g.free(x, y, w, h) : !g.free(x - 1, y - 1, w + 2, h + 2)) continue;
        const dd = [y - by0, bx1 - (x + w), by1 - (y + h), x - bx0], mn = Math.min.apply(null, dd), f = front!=null ? front : g.pick([0, 1, 2, 3].filter(i=>dd[i]===mn)); // фасад — к ближайшему краю квартала (к дороге)
        const plan = planBuilding(g, arch, x, y, w, h, f);
        if(tooSimilar(g, plan) && s < tries - 1) continue;
        const st = g.bagFit('bstate', BSTATES, q=>(!pool || pool.indexOf(q.id) >= 0) && q.id!==g.avoidState) || g.bagFit('bstate', BSTATES, q=>!pool || pool.indexOf(q.id) >= 0);
        commitBuilding(g, plan, st); g.mark(x - 1, y - 1, w + 2, h + 2);
        // двор: пара предметов у здания
        for(let i=0;i<g.ri(1, 3);i++) g.tryObj(g.pick(arch.yard), Math.max(0, x - 3), Math.max(0, y - 3), Math.min(g.doc.cols, x + w + 3), Math.min(g.doc.rows, y + h + 3), 6);
        return {x, y, w, h, arch, st:st.id, shape:plan.shape, rooms:plan.rooms.length, rm:plan.rmG, scene:plan.scene};
      }
    }
    return null;
  }
  const partOf = (b, lot)=>({k:'b', x:b.x, y:b.y, w:b.w, h:b.h, lot, arch:b.arch.id, name:b.arch.name, st:b.st, shape:b.shape, rooms:b.rooms, rm:b.rm, scene:b.scene});
  function cityRuins(doc, opts){
    opts = opts || {}; const g = ctxFor(doc, opts.seed); g.opts = opts; reset(doc, 'dust');
    doc.gen = {id:'city', seed:g.seed, opts:{density:opts.density || 'normal', ruin:opts.ruin || 'normal', theme:opts.theme || 'mixed', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal'}, parts:[]};
    // ---- улицы: магистраль, ответвления (Т-образные примыкания), редкий второй сквозной путь, проулки ----
    const {cols, rows} = doc, AREA = cols*rows, K = AREA/3072, n = g.noise(6, 1);
    const DSCALE = {sparse:0.6, normal:1, dense:1.35}[opts.density] || 1;
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const v = n(x, y); if(v > 0.62) g.setT(x, y, 'gravel'); else if(v < 0.25) g.setT(x, y, 'grass'); }
    const roads = [];
    const chaikin = (p, it)=>{ for(let k=0;k<it;k++){ const q = [p[0]]; for(let i=0;i<p.length - 1;i++){ const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax*0.75 + bx*0.25, ay*0.75 + by*0.25], [ax*0.25 + bx*0.75, ay*0.25 + by*0.75]); } q.push(p[p.length - 1]); p = q; } return p; };
    // линия от a к b: плавная кривая / ломаная / почти прямая
    function roadLine(a, b, mode, wob){ const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nseg = Math.max(2, Math.round(L/g.ri(7, 11))), nx = -(b[1] - a[1])/L, ny = (b[0] - a[0])/L; const pts = [a];
      let off = 0; for(let i=1;i<nseg;i++){ const t = i/nseg; off = mode==='straight' ? (g.rnd() - 0.5)*0.6 : off*0.4 + (g.rnd() - 0.5)*2*(wob || 3.5); pts.push([a[0] + (b[0] - a[0])*t + nx*off, a[1] + (b[1] - a[1])*t + ny*off]); }
      pts.push(b); return mode==='curve' ? chaikin(pts, 3) : pts; }
    const segDist = (px, py, ax, ay, bx, by)=>{ const dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy || 1; let t = ((px - ax)*dx + (py - ay)*dy)/L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - dx*t, py - ay - dy*t); };
    const distTo = (r, x, y)=>{ let m = Infinity; for(let i=0;i<r.pts.length - 1;i++){ const d = segDist(x, y, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]); if(d < m) m = d; } return m; };
    const pointAt = (r, t)=>{ let tot = 0; const ls = []; for(let i=0;i<r.pts.length - 1;i++){ const l = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]); ls.push(l); tot += l; }
      let s = t*tot; for(let i=0;i<ls.length;i++){ if(s <= ls[i] || i===ls.length - 1){ const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1], u = ls[i] ? Math.min(1, s/ls[i]) : 0; return {x:ax + (bx - ax)*u, y:ay + (by - ay)*u, a:Math.atan2(by - ay, bx - ax), len:tot}; } s -= ls[i]; } };
    const edgePt = (side, f)=>side===0 ? [cols*f, -2] : side===1 ? [cols + 2, rows*f] : side===2 ? [cols*f, rows + 2] : [-2, rows*f];
    const horiz = cols >= rows ? g.rnd() < 0.75 : g.rnd() < 0.25, mode0 = g.pick(['curve', 'curve', 'broken', 'straight']);
    const big = AREA > 3500 && g.rnd() < 0.3;
    roads.push({pts:roadLine(horiz ? edgePt(3, 0.35 + g.rnd()*0.3) : edgePt(0, 0.35 + g.rnd()*0.3), horiz ? edgePt(1, 0.3 + g.rnd()*0.4) : edgePt(2, 0.3 + g.rnd()*0.4), mode0, 4), w:big ? 5 : 3, kind:big ? 'highway' : 'road', main:1});
    if(g.rnd() < 0.3) roads.push({pts:roadLine(horiz ? edgePt(0, 0.25 + g.rnd()*0.5) : edgePt(3, 0.25 + g.rnd()*0.5), horiz ? edgePt(2, 0.25 + g.rnd()*0.5) : edgePt(1, 0.25 + g.rnd()*0.5), g.pick(['curve', 'broken']), 3), w:3, kind:'road', main:1});
    // ответвления: от точки на существующей улице под ~90° (±25°), до края карты или тупиком
    const branch = (count, w, kind, minL, maxL, parents)=>{ for(let c=0, tries=0;c<count && tries<count*12;tries++){
      const par = g.pick(parents()); if(!par) break; const p = pointAt(par, 0.12 + g.rnd()*0.76), s = g.rnd() < 0.5 ? 1 : -1, ang = p.a + s*(Math.PI/2) + (g.rnd() - 0.5)*0.9;
      const toEdge = g.rnd() < 0.5, L = toEdge ? 200 : g.ri(minL, maxL); let ex = p.x + Math.cos(ang)*L, ey = p.y + Math.sin(ang)*L;
      if(toEdge){ const tx = Math.cos(ang) > 0 ? (cols + 2 - p.x)/Math.cos(ang) : Math.cos(ang) < 0 ? (-2 - p.x)/Math.cos(ang) : Infinity, ty = Math.sin(ang) > 0 ? (rows + 2 - p.y)/Math.sin(ang) : Math.sin(ang) < 0 ? (-2 - p.y)/Math.sin(ang) : Infinity, tt = Math.min(tx, ty); if(tt > 60 || tt < minL) continue; ex = p.x + Math.cos(ang)*tt; ey = p.y + Math.sin(ang)*tt; }
      else if(ex < 3 || ey < 3 || ex > cols - 3 || ey > rows - 3) continue;
      const start = [p.x + Math.cos(ang)*(par.w/2 - 0.1), p.y + Math.sin(ang)*(par.w/2 - 0.1)], line = roadLine(start, [ex, ey], g.pick(['curve', 'curve', 'broken', 'straight']), Math.min(2.5, Math.hypot(ex - start[0], ey - start[1])/9));
      // не вплотную и не параллельно к уже проложенным
      const cand = {pts:line, w, kind, end:toEdge ? null : [ex, ey], ang, from:p, parent:par};
      if(roads.some(r=>r!==par && line.slice(Math.floor(line.length*0.25)).some(([x, y])=>distTo(r, x, y) < (r.w + w)/2 + 5))) continue;
      roads.push(cand); c++; } };
    branch(Math.max(1, Math.round(2.4*K)) + g.ri(0, 1), 2.5, 'road', 10, 22, ()=>roads.filter(r=>r.main));
    branch(g.ri(0, Math.max(1, Math.round(1.5*K))), 2, g.rnd() < 0.5 ? 'track' : 'road', 6, 13, ()=>roads.filter(r=>!r.main));
    // разметка дорог: асфальт под полотном, тротуар у городских улиц; занятость
    const roadD = new Float32Array(AREA).fill(99);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ let best = 99, br = null; roads.forEach(r=>{ const d = distTo(r, x + 0.5, y + 0.5) - r.w/2; if(d < best){ best = d; br = r; } }); roadD[y*cols + x] = best;
      if(best < (br && br.kind==='track' ? 0.6 : 1.4)) g.occ[y*cols + x] = 1; }
    const rp = (r)=>r.pts.map(([x, y])=>[Math.round(x*100)/100, Math.round(y*100)/100]);
    roads.forEach(r=>{ if(r.kind!=='track') g.path('sidewalk', r.w + 2.6, rp(r)); }); roads.forEach(r=>g.path(r.kind, r.w, rp(r)));
    // объект в произвольной точке с поворотом: занятость — по описанному прямоугольнику
    const BY = MapAssets.BY_ID, cars = [];
    function put(a, cx, cy, rdeg, force){ const as = BY[a]; if(!as) return false; const t = rdeg*Math.PI/180, bw = Math.abs(Math.cos(t))*as.w + Math.abs(Math.sin(t))*as.h, bh = Math.abs(Math.sin(t))*as.w + Math.abs(Math.cos(t))*as.h;
      const x0 = Math.floor(cx - bw/2), y0 = Math.floor(cy - bh/2), cw = Math.ceil(cx + bw/2) - x0, ch = Math.ceil(cy + bh/2) - y0;
      if(x0 < 0 || y0 < 0 || x0 + cw > cols || y0 + ch > rows) return false; if(!force && !as.g && !g.free(x0, y0, cw, ch)) return false; if(!as.g) g.mark(x0, y0, cw, ch);
      doc.objects.push({id:newId('o'), a, x:Math.round(cx*100)/100, y:Math.round(cy*100)/100, r:Math.round(((rdeg%360) + 360)%360), s:1, v:g.variant(a, g.opts.ruin==='low' ? 'intact' : null), f:g.rnd() < 0.3}); return true; }
    // тупики: завал или баррикада в конце; у примыкания — иногда «зебра»
    roads.forEach(r=>{ if(r.end && g.rnd() < 0.75){ const a = g.pick(['jersey', 'barricade_car', 'rubble_pile', 'rubble_big', 'barricade']); put(a, r.end[0], r.end[1], r.ang*180/Math.PI + 90, true); }
      if(r.from && r.kind==='road' && g.rnd() < 0.35){ const d = r.parent.w/2 + 1.8; put('zebra', r.from.x + Math.cos(r.ang)*d, r.from.y + Math.sin(r.ang)*d, r.ang*180/Math.PI + 90, true); } });
    // ---- здания вдоль улиц: фасадом к дороге, с отступом ----
    const tries = Math.round(26*K*DSCALE); let fails = 0;
    const weighted = roads.filter(r=>r.kind!=='track');
    for(let t=0;t<tries*3 && fails < 40;t++){
      const r = g.pick(weighted.concat(roads.filter(q=>q.main))), p = pointAt(r, 0.04 + g.rnd()*0.92), s = g.rnd() < 0.5 ? 1 : -1, nx = -Math.sin(p.a)*s, ny = Math.cos(p.a)*s;
      const back = r.w/2 + 1.4 + g.ri(1, opts.density==='dense' ? 1 : 3), cx = p.x + nx*(back + 5.5), cy = p.y + ny*(back + 5.5);
      const bx0 = Math.max(0, Math.round(cx - 6)), by0 = Math.max(0, Math.round(cy - 6)), bx1 = Math.min(cols, Math.round(cx + 6)), by1 = Math.min(rows, Math.round(cy + 6));
      if(bx1 - bx0 < 5 || by1 - by0 < 5){ fails++; continue; }
      const front = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 3 : 1) : (ny > 0 ? 0 : 2); // фасад смотрит на дорогу
      const b = building(g, bx0, by0, bx1, by1, undefined, front); if(b){ doc.gen.parts.push(partOf(b, [bx0, by0, bx1, by1])); fails = 0; } else fails++;
      if(doc.gen.parts.length >= tries) break;
    }
    // ---- машины: вдоль полотна, по направлению движения, редко ----
    for(let i=0, n2 = Math.round(AREA/240*DSCALE);i<n2*4 && cars.length < n2;i++){ const r = g.pick(roads), p = pointAt(r, g.rnd()), lat = (g.rnd() - 0.5)*(r.w - 1.2), cx = p.x - Math.sin(p.a)*lat, cy = p.y + Math.cos(p.a)*lat;
      if(cx < 1 || cy < 1 || cx > cols - 1 || cy > rows - 1 || cars.some(c=>Math.hypot(c[0] - cx, c[1] - cy) < 3)) continue;
      const a = g.pick(['car_wreck', 'car_wreck', 'car_burnt', 'pickup_rust', 'bus_wreck', 'rubble_pile', 'trash', 'car_wreck']); if(put(a, cx, cy, p.a*180/Math.PI + 90 + (g.rnd() < 0.5 ? 180 : 0) + (g.rnd() - 0.5)*40, true)) cars.push([cx, cy]); }
    // фонари вдоль главных улиц, через одну сторону
    roads.filter(r=>r.kind!=='track').forEach(r=>{ const L = pointAt(r, 0).len, step = g.ri(7, 10); for(let s0=g.ri(2, 5), k=0;s0<L;s0+=step, k++){ if(g.rnd() < 0.25) continue; const p = pointAt(r, s0/L), sd = k%2 ? 1 : -1, d = r.w/2 + 0.8;
      put('lamp_post', p.x - Math.sin(p.a)*d*sd, p.y + Math.cos(p.a)*d*sd, p.a*180/Math.PI + (sd > 0 ? 180 : 0)); } });
    // ---- экстерьер: разнообразно, но редко; у каждого вида — свой лимит на карту ----
    const EXT = [
      // у тротуара
      ['bus_stop', 'side', 2, 2], ['phone_booth', 'side', 1, 1], ['hydrant', 'side', 2, 2], ['road_sign', 'side', 2, 3], ['kiosk', 'side', 1, 1], ['dumpster', 'side', 2, 3], ['parking', 'side', 1, 2], ['checkpoint', 'side', 0.3, 1], ['barricade_car', 'side', 0.6, 1], ['jersey', 'side', 1, 2],
      // на пустыре
      ['tree_sparse', 'open', 4, 6], ['dead_tree', 'open', 4, 6], ['dry_bush', 'open', 3, 5], ['boulder', 'open', 1, 2], ['rocks_scatter', 'open', 1, 2], ['rubble_pile', 'open', 2, 4], ['rubble_big', 'open', 0.8, 1], ['scrap_pile', 'open', 1, 2],
      ['junk_mound', 'open', 0.4, 1], ['crater', 'open', 0.6, 2], ['puddle', 'open', 1, 2], ['tire_stack', 'open', 1, 2], ['barrels_group', 'open', 0.6, 1], ['shipping_container', 'open', 0.5, 1], ['ruin_corner', 'open', 0.6, 1], ['ruin_house', 'open', 0.5, 1],
      ['yard', 'open', 0.5, 1], ['water_tower', 'open', 0.3, 1], ['windmill', 'open', 0.2, 1], ['tent', 'open', 0.4, 1], ['campfire', 'open', 0.4, 1], ['skull_totem', 'open', 0.2, 1], ['oil_drum_fire', 'open', 0.4, 1],
      ['pickup_rust', 'open', 0.5, 1], ['apc_wreck', 'open', 0.25, 1], ['tank_wreck', 'open', 0.15, 1], ['plane_wreck', 'open', 0.08, 1], ['watchtower', 'open', 0.2, 1], ['pillbox', 'open', 0.15, 1], ['overpass_pillar', 'open', 0.25, 1],
    ].filter(e=>BY[e[0]]);
    const used = {}, nExt = Math.round(AREA/110*DSCALE);
    for(let i=0, placed=0;i<nExt*8 && placed<nExt;i++){
      const pool = EXT.filter(e=>(used[e[0]] || 0) < e[3]); if(!pool.length) break; let tot = 0; pool.forEach(e=>{ tot += e[2]; }); let q = g.rnd()*tot, e = pool[0]; for(const c of pool){ q -= c[2]; if(q <= 0){ e = c; break; } }
      let ok = false;
      if(e[1]==='side'){ const r = g.pick(roads.filter(q2=>q2.kind!=='track')); if(!r) continue; const p = pointAt(r, 0.05 + g.rnd()*0.9), sd = g.rnd() < 0.5 ? 1 : -1, d = r.w/2 + 1.3 + (BY[e[0]].h > 1 ? BY[e[0]].h/2 : 0.5);
        ok = put(e[0], p.x - Math.sin(p.a)*d*sd, p.y + Math.cos(p.a)*d*sd, p.a*180/Math.PI + (sd > 0 ? 180 : 0)); }
      else { const x = g.rnd()*cols, y = g.rnd()*rows, rd = roadD[Math.floor(y)*cols + Math.floor(x)]; if(rd < 2) continue; ok = put(e[0], x, y, g.rnd() < 0.7 ? g.pick([0, 90, 180, 270]) : g.rnd()*360); }
      if(ok){ used[e[0]] = (used[e[0]] || 0) + 1; placed++;
        // небольшие группы: у деревьев — ещё куст, у костра — палатка/спальник
        if(e[0]==='tree_sparse' && g.rnd() < 0.5){ const c = doc.objects[doc.objects.length - 1]; put('dry_bush', c.x + 1.3, c.y + 1, 0); }
        if(e[0]==='campfire'){ const c = doc.objects[doc.objects.length - 1]; put('sleeping_bag', c.x + 1.5, c.y + 0.5, 90); } }
    }
    // сквер: пятно травы с деревьями (редко)
    if(g.rnd() < 0.35){ for(let t=0;t<20;t++){ const x = g.ri(2, cols - 8), y = g.ri(2, rows - 7); if(!g.free(x, y, 6, 5)) continue; const nz = g.noise(2, g.ri(1, 999));
      for(let j=0;j<5;j++) for(let i=0;i<6;i++) if(nz(x + i, y + j) < 0.8) g.setT(x + i, y + j, 'grass'); for(let k=0;k<g.ri(2, 4);k++) g.tryObj(g.pick(['tree_sparse', 'tree_sparse', 'dead_tree', 'dry_bush']), x, y, x + 6, y + 5, 6); g.mark(x, y, 6, 5); break; } }
  }
  /* ---------- Подземный комплекс: маршрут «вход → охрана → жилой → технический → исследования → ядро» ----------
     Комнаты связаны деревом коридоров (минимальное остовное по расстоянию + несколько петель); глубина комнаты
     от входа определяет зону, тип комнаты тянется из колоды своей зоны — повторов нет. */
  const BROLES = {
    b_gate:    {sz:1, fl:['concrete'], it:[{a:['turret'], m:'corner', n:[1, 2]}, {a:['sandbags_line', 'sandbags_arc'], m:'center', n:[1, 2]}, {a:['electric_panel'], m:'wall'}, {a:['locker'], m:'wall', p:0.5}, {a:['rad_sign'], m:'corner', p:0.5}]},
    b_guard:   {sz:1, fl:['concrete'], it:[{a:['office_desk'], m:'wall', n:[1, 2]}, {a:['terminal'], m:'wall', n:[1, 2]}, {a:['weapon_rack'], m:'wall'}, {a:['locker'], m:'wall'}, {a:['chair'], m:'center', n:[1, 2]}, {a:['radio'], m:'wall', p:0.6}, {a:['turret'], m:'corner', p:0.4}]},
    b_decon:   {sz:1, fl:['tiles'], it:[{a:['shower'], m:'wall', n:[2, 4]}, {a:['locker'], m:'wall', n:[1, 2]}, {a:['sink'], m:'wall'}, {a:['barrel_toxic'], m:'corner', p:0.5}, {a:['rad_sign'], m:'corner', p:0.6}]},
    b_barracks:{sz:2, fl:['concrete', 'tiles'], it:[{a:['bunk'], m:'wall', n:[3, 6]}, {a:['locker'], m:'wall', n:[1, 2]}, {a:['table_small', 'table_dining'], m:'center'}, {a:['chair'], m:'center', n:[1, 2]}, {a:['radio', 'tv'], m:'wall', p:0.4}, {a:['sleeping_bag'], m:'center', p:0.3}]},
    b_mess:    {sz:2, fl:['tiles'], it:[{a:['stove'], m:'wall', n:[1, 2]}, {a:['fridge'], m:'wall'}, {a:['sink'], m:'wall'}, {a:['pantry_shelves'], m:'wall'}, {a:['table_dining', 'restaurant_table'], m:'grid'}]},
    b_med:     {sz:2, fl:['tiles'], it:[{a:['hospital_bed'], m:'wall', n:[2, 4]}, {a:['stretcher'], m:'wall'}, {a:['medkit'], m:'corner', n:[1, 2]}, {a:['sink'], m:'wall'}, {a:['terminal'], m:'wall', p:0.6}, {a:['lab_bench'], m:'wall', p:0.4}]},
    b_wash:    {sz:0, fl:['tiles'], it:[{a:['toilet'], m:'wall', n:[2, 3]}, {a:['shower'], m:'wall', n:[1, 3]}, {a:['sink'], m:'wall', n:[1, 2]}]},
    b_rec:     {sz:1, fl:['tiles', 'carpet'], it:[{a:['sofa'], m:'wall', focus:1}, {a:['tv'], m:'wall'}, {a:['bookshelf'], m:'wall'}, {a:['table_dining'], m:'center'}, {a:['chair'], m:'center', n:[1, 3]}, {a:['rug'], m:'floor', p:0.6}, {a:['vending'], m:'wall', p:0.5}]},
    b_cmd:     {sz:1, fl:['carpet', 'tiles'], it:[{a:['office_desk'], m:'wall'}, {a:['safe'], m:'corner'}, {a:['radio'], m:'wall'}, {a:['bookshelf'], m:'wall'}, {a:['bed', 'bunk'], m:'wall', p:0.6}, {a:['rug'], m:'floor', p:0.6}, {a:['weapon_rack'], m:'wall', p:0.4}]},
    b_power:   {sz:2, fl:['metal', 'concrete'], it:[{a:['generator'], m:'rows'}, {a:['transformer'], m:'corner', p:0.7}, {a:['electric_panel'], m:'wall', n:[2, 3]}, {a:['barrels_group'], m:'corner', p:0.6}]},
    b_pump:    {sz:2, fl:['concrete', 'metal'], it:[{a:['pump_station'], m:'center'}, {a:['valve'], m:'wall', n:[2, 3]}, {a:['pipe_straight'], m:'wall', n:[1, 2]}, {a:['tank_horiz'], m:'corner', p:0.5}, {a:['electric_panel'], m:'wall'}, {a:['sewer_grate'], m:'floor', p:0.7}]},
    b_store:   {sz:1, fl:['concrete'], it:[{a:['shelf'], m:'rows'}, {a:['crate_metal', 'ammo_crate'], m:'corner', n:[2, 4]}, {a:['pallet'], m:'corner', p:0.6}]},
    b_server:  {sz:1, fl:['metal'], it:[{a:['terminal'], m:'rows'}, {a:['office_desk'], m:'wall'}, {a:['electric_panel'], m:'wall', n:[1, 2]}, {a:['radio'], m:'wall', p:0.6}]},
    b_vent:    {sz:1, fl:['metal'], it:[{a:['roof_vent'], m:'center', n:[1, 2]}, {a:['electric_panel'], m:'wall'}, {a:['pipe_straight'], m:'wall', n:[1, 2]}, {a:['maintenance_hatch'], m:'floor', p:0.5}]},
    b_biolab:  {sz:2, fl:['tiles'], it:[{a:['containment_pod'], m:'wall', n:[1, 3]}, {a:['lab_bench'], m:'rows'}, {a:['sink'], m:'wall'}, {a:['terminal'], m:'wall'}, {a:['barrel_toxic'], m:'corner', p:0.6}]},
    b_chemlab: {sz:1, fl:['tiles', 'metal'], it:[{a:['lab_bench'], m:'wall', n:[3, 5]}, {a:['barrel_toxic'], m:'corner', n:[2, 3]}, {a:['toxic_puddle'], m:'floor', p:0.6}, {a:['sink'], m:'wall'}, {a:['shelf'], m:'wall', p:0.6}]},
    b_cryo:    {sz:1, fl:['metal'], it:[{a:['containment_pod'], m:'wall', n:[3, 6]}, {a:['terminal'], m:'wall', n:[1, 2]}, {a:['electric_panel'], m:'wall'}]},
    b_morgue:  {sz:1, fl:['tiles'], it:[{a:['catacomb_niche'], m:'wall', n:[2, 4]}, {a:['stretcher'], m:'grid'}, {a:['sink'], m:'wall'}, {a:['medkit'], m:'corner', p:0.5}]},
    b_isol:    {sz:1, fl:['concrete', 'tiles'], it:[{a:['bunk', 'hospital_bed'], m:'wall'}, {a:['toilet'], m:'corner'}, {a:['blood'], m:'floor', n:[1, 2]}, {a:['cocoon', 'corpse'], m:'center', p:0.5}]},
    b_anomlab: {sz:2, fl:['metal', 'tiles'], it:[{a:['containment_pod', 'crystal_growth', 'anom_electro'], m:'center1'}, {a:['terminal'], m:'ring', n:[4, 6]}, {a:['lab_bench'], m:'wall', n:[1, 2]}, {a:['electric_panel'], m:'wall'}]},
    b_observe: {sz:2, fl:['tiles', 'metal'], it:[{a:['tv', 'terminal'], m:'wall', focus:1}, {a:['office_desk'], m:'grid'}, {a:['radio'], m:'wall', p:0.5}]},
    b_core:    {sz:2, fl:['metal'], it:[{a:['anom_gravity', 'crystal_growth', 'artifact', 'anom_electro', 'containment_pod'], m:'center1'}, {a:['terminal'], m:'ring', n:[4, 8]}, {a:['electric_panel'], m:'wall', n:[2, 4]}, {a:['rad_sign'], m:'corner', n:[1, 2]}]},
    b_check:   {sz:1, fl:['concrete'], it:[{a:['turnstiles'], m:'center'}, {a:['terminal'], m:'wall'}, {a:['sandbags_line'], m:'center', p:0.6}, {a:['turret'], m:'corner', p:0.5}, {a:['locker'], m:'wall', p:0.5}, {a:['chair'], m:'wall'}]},
    b_quar:    {sz:1, fl:['tiles'], it:[{a:['hospital_bed'], m:'wall', n:[2, 3]}, {a:['shower'], m:'wall'}, {a:['rad_sign'], m:'corner'}, {a:['barrel_toxic'], m:'corner', p:0.6}, {a:['terminal'], m:'wall', p:0.6}, {a:['blood'], m:'floor', p:0.4}]},
    b_lib:     {sz:1, fl:['carpet', 'tiles'], it:[{a:['bookshelf'], m:'rows'}, {a:['table_dining'], m:'center', p:0.7}, {a:['chair'], m:'center', n:[1, 2]}, {a:['lamp'], m:'corner', p:0.6}]},
    b_pantry:  {sz:0, fl:['concrete'], it:[{a:['pantry_shelves'], m:'wall', n:[2, 4]}, {a:['crate_wood'], m:'corner', n:[1, 2]}, {a:['fridge'], m:'wall', p:0.6}, {a:['barrel'], m:'corner', p:0.5}]},
    b_director:{sz:1, fl:['carpet'], it:[{a:['office_desk'], m:'wall'}, {a:['bed'], m:'wall'}, {a:['safe'], m:'corner'}, {a:['bookshelf'], m:'wall', n:[1, 2]}, {a:['rug'], m:'floor'}, {a:['sofa'], m:'wall', p:0.5}]},
  };
  Object.assign(ROLES, BROLES);
  const BZONES = {
    sec:  [['Пост охраны', 'b_guard', 9], ['Арсенал', 'arsenal', 6], ['Санпропускник', 'b_decon', 9], ['КПП', 'b_check', 9], ['Карантин', 'b_quar', 12]],
    live: [['Казарма', 'b_barracks', 20], ['Столовая', 'b_mess', 20], ['Медблок', 'b_med', 16], ['Душевые', 'b_wash', 6], ['Комната отдыха', 'b_rec', 12], ['Кабинет коменданта', 'b_cmd', 9], ['Прачечная', 'laundry_big', 9], ['Библиотека', 'b_lib', 12], ['Кладовая', 'b_pantry', 6]],
    tech: [['Генераторная', 'b_power', 16], ['Насосная', 'b_pump', 16], ['Склад', 'b_store', 9], ['Мастерская', 'workshop', 9], ['Серверная', 'b_server', 9], ['Вентиляционная', 'b_vent', 9], ['Котельная', 'boilerroom', 12], ['Трансформаторная', 'substation', 9], ['Гараж', 'garage_bay', 20]],
    sci:  [['Биолаборатория', 'b_biolab', 20], ['Химлаборатория', 'b_chemlab', 12], ['Крио-хранилище', 'b_cryo', 12], ['Морг', 'b_morgue', 12], ['Изолятор', 'b_isol', 6], ['Аномальная лаборатория', 'b_anomlab', 20], ['Зал наблюдения', 'b_observe', 16], ['Архив', 'archive', 9], ['Покои директора', 'b_director', 9]],
  };
  const ZNEXT = {sec:['live', 'tech'], live:['sec', 'tech', 'sci'], tech:['live', 'sci', 'sec'], sci:['tech', 'live']};
  const BZONE_FLOOR = {gate:'concrete', sec:'concrete', live:'tiles', tech:'metal', sci:'tiles', core:'metal'};
  function bunker(doc, opts){
    opts = opts || {}; const g = ctxFor(doc, opts.seed); g.opts = opts; reset(doc, 'rock');
    doc.gen = {id:'bunker', seed:g.seed, opts:{rooms:opts.rooms || 'normal', cond:opts.cond || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal'}, parts:[]};
    const RS = {small:[11, 10], normal:[15, 13], large:[20, 17]}[opts.rooms] || [15, 13];
    const {cols, rows} = doc, n = g.noise(5, 7);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const v = n(x, y); if(v > 0.7) g.setT(x, y, 'gravel'); else if(v < 0.18) g.setT(x, y, 'dirt'); }
    const mask = new Uint8Array(cols*rows), rid = new Int16Array(cols*rows).fill(-1), rooms = [];
    const cond = ['abandoned', 'flooded', 'infested', 'wrecked'].indexOf(opts.cond) >= 0 ? opts.cond : g.pick(['abandoned', 'flooded', 'infested', 'wrecked', 'abandoned']); // общее состояние комплекса
    function split(x, y, w, h, depth){
      if(depth > 5 || (w < RS[0] && h < RS[1]) || depth > 2 && g.rnd() < 0.18){
        const rw = g.ri(Math.min(5, w - 3), Math.max(5, w - 3)), rh = g.ri(Math.min(4, h - 3), Math.max(4, h - 3));
        const rx = x + g.ri(1, Math.max(1, w - rw - 1)), ry = y + g.ri(1, Math.max(1, h - rh - 1));
        if(rw >= 4 && rh >= 4) rooms.push({x:rx, y:ry, w:rw, h:rh}); return;
      }
      if(w >= h){ const s = g.ri(Math.floor(w*0.35), Math.floor(w*0.65)); split(x, y, s, h, depth + 1); split(x + s, y, w - s, h, depth + 1); }
      else { const s = g.ri(Math.floor(h*0.35), Math.floor(h*0.65)); split(x, y, w, s, depth + 1); split(x, y + s, w, h - s, depth + 1); }
    }
    split(1, 1, cols - 2, rows - 2, 0);
    if(!rooms.length) rooms.push({x:2, y:2, w:Math.max(4, cols - 4), h:Math.max(4, rows - 4)});
    rooms.forEach((r, i)=>{ r.i = i; r.cx = r.x + r.w/2; r.cy = r.y + r.h/2; for(let j=r.y;j<r.y + r.h;j++) for(let k=r.x;k<r.x + r.w;k++){ mask[j*cols + k] = 1; rid[j*cols + k] = i; } });
    // граф: минимальное остовное дерево по расстоянию + пара петель
    const links = [], inT = new Set([0]), dist = (a, b)=>Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    while(inT.size < rooms.length){ let best = null; inT.forEach(i=>rooms.forEach(b=>{ if(inT.has(b.i)) return; const d = dist(rooms[i], b); if(!best || d < best.d) best = {a:i, b:b.i, d}; })); links.push(best); inT.add(best.b); }
    const all = []; rooms.forEach(a=>rooms.forEach(b=>{ if(a.i < b.i && !links.some(l=>(l.a===a.i && l.b===b.i) || (l.a===b.i && l.b===a.i))) all.push({a:a.i, b:b.i, d:dist(a, b)}); }));
    all.sort((p, q)=>p.d - q.d).slice(0, Math.max(1, Math.round(rooms.length*0.2))).forEach(l=>{ if(g.rnd() < 0.6) links.push(l); });
    const adj = rooms.map(()=>[]); links.forEach(l=>{ adj[l.a].push(l.b); adj[l.b].push(l.a); });
    // вход — комната у края карты; глубина — шаги по графу от входа; ядро — самая глубокая
    const edgeD = (r)=>Math.min(r.x, r.y, cols - r.x - r.w, rows - r.y - r.h);
    const entry = rooms.slice().sort((a, b)=>edgeD(a) - edgeD(b) || a.w*a.h - b.w*b.h)[0];
    const depth = rooms.map(()=>-1), q = [entry.i]; depth[entry.i] = 0; while(q.length){ const c = q.shift(); adj[c].forEach(nb=>{ if(depth[nb] < 0){ depth[nb] = depth[c] + 1; q.push(nb); } }); }
    const order = rooms.slice().sort((a, b)=>depth[a.i] - depth[b.i] || dist(a, entry) - dist(b, entry));
    const core = order.length > 2 ? order.slice(-Math.min(3, order.length - 1)).sort((a, b)=>b.w*b.h - a.w*a.h)[0] : null;
    order.forEach((r, k)=>{ if(r===entry){ r.zone = 'gate'; return; } if(r===core){ r.zone = 'core'; return; } const t = k/(order.length - 1); r.zone = t <= 0.22 ? 'sec' : t <= 0.5 ? 'live' : t <= 0.74 ? 'tech' : 'sci'; });
    // коридоры: Г-образные; к входу и ядру — шириной 3, остальные 2
    const corridorCells = [];
    const carve = (x, y, w, h, t)=>{ for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) if(i>0 && j>0 && i<cols - 1 && j<rows - 1 && rid[j*cols + i] < 0){ if(!mask[j*cols + i]) corridorCells.push([i, j]); mask[j*cols + i] = 1; g.setT(i, j, t); } };
    links.forEach(l=>{ const a = rooms[l.a], b = rooms[l.b], wd = (a===entry || b===entry || a===core || b===core) ? 3 : 2, t = g.pick(['metal', 'concrete']);
      const ax = Math.floor(a.cx) - (wd>>1), ay = Math.floor(a.cy) - (wd>>1), bx = Math.floor(b.cx) - (wd>>1), by = Math.floor(b.cy) - (wd>>1);
      if(g.rnd() < 0.5){ carve(Math.min(ax, bx), ay, Math.abs(bx - ax) + wd, wd, t); carve(bx, Math.min(ay, by), wd, Math.abs(by - ay) + wd, t); }
      else { carve(ax, Math.min(ay, by), wd, Math.abs(by - ay) + wd, t); carve(Math.min(ax, bx), by, Math.abs(bx - ax) + wd, wd, t); } });
    // туннель от входа к краю карты, лестница наверх
    { const r = entry, opts = [[r.y, 0], [cols - r.x - r.w, 1], [rows - r.y - r.h, 2], [r.x, 3]].sort((p, q2)=>p[0] - q2[0]), side = opts[0][1], cx = Math.floor(r.cx) - 1, cy = Math.floor(r.cy) - 1;
      const T = (x, y, w, h)=>{ for(let j=y;j<y + h;j++) for(let i=x;i<x + w;i++) if(i>=0 && j>=0 && i<cols && j<rows && rid[j*cols + i] < 0){ mask[j*cols + i] = 1; g.setT(i, j, 'concrete'); } };
      if(side===0){ T(cx, 0, 3, r.y); g.doc.objects.push({id:newId('o'), a:'stairs', x:cx + 1.5, y:1.5, r:0, s:1, v:g.variant('stairs'), f:false}); }
      else if(side===2){ T(cx, r.y + r.h, 3, rows - r.y - r.h); g.doc.objects.push({id:newId('o'), a:'stairs', x:cx + 1.5, y:rows - 1.5, r:180, s:1, v:g.variant('stairs'), f:false}); }
      else if(side===3){ T(0, cy, r.x, 3); g.doc.objects.push({id:newId('o'), a:'stairs', x:1.5, y:cy + 1.5, r:270, s:1, v:g.variant('stairs'), f:false}); }
      else { T(r.x + r.w, cy, cols - r.x - r.w, 3); g.doc.objects.push({id:newId('o'), a:'stairs', x:cols - 1.5, y:cy + 1.5, r:90, s:1, v:g.variant('stairs'), f:false}); } }
    // типы комнат: колода своей зоны, по размеру
    const usedT = {};
    order.forEach(r=>{
      if(r.zone==='gate'){ r.name = 'Шлюз'; r.role = 'b_gate'; }
      else if(r.zone==='core'){ r.name = g.pick(['Ядро комплекса', 'Хранилище образца', 'Реакторный зал', 'Объект «Ноль»']); r.role = 'b_core'; }
      else { const area = r.w*r.h; let pick = null;
        for(const z of [r.zone].concat(ZNEXT[r.zone])){ const c = BZONES[z].filter(t=>t[2] <= area && !usedT[t[0]]); if(c.length){ pick = g.pick(c); break; } }
        if(!pick){ const c = BZONES[r.zone].filter(t=>t[2] <= area); pick = c.length ? g.pick(c) : ['Подсобка', 'b_store', 0]; }
        usedT[pick[0]] = 1; r.name = pick[0]; r.role = pick[1]; }
      const fl = (ROLES[r.role] && ROLES[r.role].fl) || [BZONE_FLOOR[r.zone]]; r.floor = g.pick(fl); g.rectT(r.x, r.y, r.w, r.h, r.floor);
    });
    // одинаковые названия (если колода зоны кончилась) — с номером
    const seen = {}; rooms.forEach(r=>{ seen[r.name] = (seen[r.name] || 0) + 1; if(seen[r.name] > 1) r.name += ' №' + seen[r.name]; });
    if(cond==='flooded'){ const low = order.slice(Math.floor(order.length*0.6)); low.forEach(r=>{ if(g.rnd() < 0.5) for(let j=r.y;j<r.y + r.h;j++) for(let i=r.x;i<r.x + r.w;i++) if(g.rnd() < 0.85) g.setT(i, j, g.pick(['water', 'sewer'])); }); corridorCells.forEach(([i, j])=>{ if(g.noise(4, 9)(i, j) > 0.62) g.setT(i, j, 'sewer'); }); }
    wallsFromMask(g, mask, 'concrete');
    for(let i=0;i<cols*rows;i++) if(!mask[i]) g.occ[i] = 1;
    // проёмы комнат в коридор → двери (1 — дверь, 2 — двойная, 3 — гермодверь); клетки у проёма свободны от мебели
    rooms.forEach(r=>{ r.entries = [];
      const runs = []; const scan = (o, line, from, to, inside, outside)=>{ let st = -1; for(let p=from;p<=to;p++){ const ok = p < to && (()=>{ const [ix, iy] = inside(p), [ox, oy] = outside(p); return ox>=0 && oy>=0 && ox<cols && oy<rows && mask[oy*cols + ox] && rid[oy*cols + ox] < 0; })(); if(ok && st < 0) st = p; if(!ok && st >= 0){ runs.push({o, line, s:st, e:p - 1, inside, outside}); st = -1; } } };
      scan('h', r.y, r.x, r.x + r.w, p=>[p, r.y], p=>[p, r.y - 1]); scan('h', r.y + r.h, r.x, r.x + r.w, p=>[p, r.y + r.h - 1], p=>[p, r.y + r.h]);
      scan('v', r.x, r.y, r.y + r.h, p=>[r.x, p], p=>[r.x - 1, p]); scan('v', r.x + r.w, r.y, r.y + r.h, p=>[r.x + r.w - 1, p], p=>[r.x + r.w, p]);
      runs.forEach(run=>{ const len = run.e - run.s + 1; for(let p=run.s;p<=run.e;p++){ const [ix, iy] = run.inside(p), [ox, oy] = run.outside(p); g.mark(ix, iy, 1, 1); g.mark(ox, oy, 1, 1); r.entries.push([ix, iy, {o:run.o, ext:true}]); }
        const a = len===3 && (r.zone==='gate' || r.zone==='core' || r.zone==='sci' && g.rnd() < 0.5) ? 'vault_door' : len===2 ? 'double_door' : len===1 ? 'door' : null; if(!a) return;
        const c = (run.s + run.e + 1)/2; g.doc.objects.push({id:newId('o'), a, x:run.o==='h' ? c : run.line, y:run.o==='h' ? run.line : c, r:run.o==='h' ? 0 : 90, s:1, v:g.variant(a, cond==='wrecked' ? 'ruined' : null), f:g.rnd() < 0.5}); });
    });
    // мебель по типу; разгромленный комплекс — чаще сломанные варианты
    rooms.forEach(r=>furnish(g, r, cond==='wrecked' ? g.rnd() < 0.75 : g.rnd() < 0.2));
    const nsc = {none:0, normal:g.ri(2, 3), many:g.ri(4, 6)}[opts.scenes] != null ? {none:0, normal:g.ri(2, 3), many:g.ri(4, 6)}[opts.scenes] : g.ri(2, 3);
    g.shuffle(rooms.filter(r=>r.zone!=='gate' && r.zone!=='core')).sort((a, b)=>ownSceneFits(g, b) - ownSceneFits(g, a)).slice(0, nsc).forEach(r=>{ const id = placeScene(g, r); if(id) r.scene = id; });
    // коридоры: лампы, трубы и кабели вдоль стен, обвалы
    corridorCells.forEach(([i, j], k)=>{ if(k%7===3 && g.free(i, j, 1, 1) && g.rnd() < 0.6) g.obj('lamp', i, j, 0); });
    for(let t=0;t<Math.round(corridorCells.length/40);t++){ const [i, j] = g.pick(corridorCells); g.tryObj(g.pick(['rubble_pile', 'electric_panel', 'barrel', 'crate_metal', 'trash', 'valve', 'blood']), i - 1, j - 1, i + 2, j + 2, 4); }
    if(g.rnd() < 0.7 && corridorCells.length){ const [i, j] = g.pick(corridorCells); g.obj('rubble_pile', i - 1, j - 1, 0, null, true); }
    // состояние комплекса
    const decor = {abandoned:['trash', 'blood', 'corpse', 'sleeping_bag'], flooded:['trash', 'sewer_grate', 'barrel'], infested:['cocoon', 'glow_mushrooms', 'glow_mushrooms', 'blood', 'bone_pile'], wrecked:['rubble_pile', 'blood', 'corpse', 'trash', 'trash']}[cond];
    rooms.forEach(r=>{ for(let k=0;k<g.ri(0, 2);k++) g.tryObj(g.pick(decor), r.x, r.y, r.x + r.w, r.y + r.h, 5); });
    rooms.forEach(r=>{
      doc.gen.parts.push({k:'r', x:r.x, y:r.y, w:r.w, h:r.h, zone:r.zone, role:r.role, name:r.name, scene:r.scene, ent:(r.entries || []).map(([x, y, e])=>[x, y, e.o])}); });
    doc.gen.cond = cond;
    doc.gen.title = {x:cols/2, y:rows - 0.7, text:{abandoned:'Комплекс заброшен', flooded:'Нижние уровни затоплены', infested:'Комплекс заражён', wrecked:'Комплекс разгромлен'}[cond]};
  }
  /* ---------- Лагерь: тип → место → граница и ограда → зоны по схеме (функциональная / кольцами / улицей) → состояние ----------
     Зоны — части карты (подписи, перегенерация по одной), как комнаты бункера. */
  const CROLES = {
    c_tents:   {sz:2, fl:['dirt'], it:[{a:['tent'], m:'grid'}, {a:['sleeping_bag'], m:'wall', n:[0, 2]}, {a:['oil_drum_fire', 'campfire'], m:'center', p:0.4}, {a:['drying_rack'], m:'wall', p:0.4}, {a:['trash'], m:'floor', p:0.4}]},
    c_shacks:  {sz:2, fl:['dirt', 'dust'], it:[{a:['scrap_shack'], m:'center', n:[1, 3]}, {a:['sleeping_bag'], m:'wall', n:[0, 2]}, {a:['barrel', 'water_cistern'], m:'corner', p:0.6}, {a:['drying_rack'], m:'wall', p:0.5}, {a:['tire_stack', 'crate_wood'], m:'corner', p:0.5}]},
    c_kitchen: {sz:1, fl:['dust'], it:[{a:['field_kitchen'], m:'center1'}, {a:['table_dining'], m:'center', p:0.6}, {a:['barrel'], m:'corner', n:[1, 2]}, {a:['water_cistern'], m:'corner', p:0.5}, {a:['crate_wood'], m:'corner', p:0.7}, {a:['crate_wood'], m:'wall', p:0.3}]},
    c_storage: {sz:1, fl:['gravel', 'dust'], it:[{a:['canopy'], m:'center1'}, {a:['crate_wood', 'crate_metal'], m:'corner', n:[2, 4]}, {a:['barrels_group', 'barrel'], m:'corner', n:[1, 2]}, {a:['pallet'], m:'wall', p:0.6}, {a:['shipping_container'], m:'wall', p:0.2}]},
    c_workshop:{sz:1, fl:['gravel'], it:[{a:['canopy'], m:'center1', p:0.6}, {a:['workbench'], m:'wall'}, {a:['scrap_pile'], m:'corner'}, {a:['tire_stack'], m:'corner', n:[1, 2]}, {a:['generator'], m:'corner', p:0.5}, {a:['lathe'], m:'wall', p:0.3}, {a:['barrel'], m:'corner', p:0.6}]},
    c_garden:  {sz:2, fl:['dirt'], it:[{a:['garden_bed'], m:'grid'}, {a:['moisture_trap'], m:'corner', n:[1, 2]}, {a:['water_cistern'], m:'corner', p:0.4}]},
    c_water:   {sz:1, fl:['dust'], it:[{a:['water_cistern'], m:'center1'}, {a:['moisture_trap'], m:'ring', n:[2, 4]}, {a:['barrel'], m:'corner', p:0.6}]},
    c_market:  {sz:2, fl:['dust'], it:[{a:['market_stall', 'market_tent'], m:'grid'}, {a:['canopy'], m:'corner', p:0.3}, {a:['crate_wood'], m:'corner', n:[1, 2]}, {a:['banner'], m:'corner', p:0.6}]},
    c_elder:   {sz:1, fl:['dust'], it:[{a:['scrap_shack', 'big_tent'], m:'center1'}, {a:['banner'], m:'corner'}, {a:['radio'], m:'corner', p:0.4}, {a:['crate_metal'], m:'corner'}, {a:['table_small'], m:'center', p:0.5}]},
    c_latrine: {sz:0, fl:['dirt'], it:[{a:['latrine'], m:'wall', n:[1, 2]}, {a:['trash'], m:'floor', p:0.5}]},
    c_pen:     {sz:1, fl:['mud'], it:[{a:['animal_pen'], m:'center1'}, {a:['pack_animal'], m:'center', n:[1, 3]}]},
    c_watch:   {sz:0, fl:['dust'], it:[{a:['watchtower', 'scrap_tower'], m:'center1'}, {a:['searchlight'], m:'corner', p:0.6}, {a:['sandbags_line'], m:'wall', p:0.5}, {a:['ammo_crate'], m:'corner', p:0.4}]},
    c_barracks:{sz:2, fl:['dirt', 'dust'], it:[{a:['scrap_shack', 'big_tent'], m:'center', n:[1, 2]}, {a:['sleeping_bag'], m:'wall', n:[2, 4]}, {a:['oil_drum_fire'], m:'center', p:0.7}, {a:['weapon_rack'], m:'wall', p:0.5}, {a:['trash'], m:'floor', n:[1, 2]}, {a:['tire_stack'], m:'corner', p:0.5}]},
    c_boss:    {sz:1, fl:['dust'], it:[{a:['big_tent', 'scrap_shack'], m:'center1'}, {a:['trophy_pole'], m:'corner', n:[1, 2]}, {a:['banner'], m:'corner'}, {a:['crate_metal', 'safe'], m:'corner'}, {a:['oil_drum_fire'], m:'corner', p:0.7}]},
    c_garage:  {sz:2, fl:['gravel'], it:[{a:['war_rig', 'buggy', 'pickup_rust'], m:'center', n:[1, 2]}, {a:['tire_stack'], m:'corner', n:[1, 3]}, {a:['fuel_pump'], m:'wall'}, {a:['barrels_group'], m:'corner'}, {a:['workbench'], m:'wall', p:0.5}, {a:['scrap_pile'], m:'corner', p:0.6}]},
    c_cages:   {sz:1, fl:['dirt'], it:[{a:['cage'], m:'grid'}, {a:['blood'], m:'floor', n:[1, 2]}, {a:['trophy_pole'], m:'corner', p:0.5}]},
    c_arena:   {sz:2, fl:['dust'], it:[{a:['arena_pit'], m:'center1'}, {a:['trophy_pole'], m:'corner', p:0.6}, {a:['oil_drum_fire'], m:'corner', n:[1, 2]}, {a:['banner'], m:'corner', p:0.5}]},
    c_shrine:  {sz:0, fl:['ash', 'dust'], it:[{a:['skull_totem'], m:'center1'}, {a:['trophy_pole'], m:'ring', n:[3, 5]}, {a:['bone_pile'], m:'corner', n:[1, 2]}, {a:['blood'], m:'floor'}]},
    c_loot:    {sz:1, fl:['gravel'], it:[{a:['crate_metal', 'crate_wood', 'ammo_crate'], m:'corner', n:[2, 4]}, {a:['barrels_group'], m:'corner'}, {a:['shipping_container'], m:'wall', p:0.4}, {a:['scrap_pile'], m:'corner', p:0.6}, {a:['weapon_rack'], m:'wall', p:0.5}, {a:['safe'], m:'corner', p:0.3}]},
    c_wagons:  {sz:2, fl:['dirt'], it:[{a:['caravan_cart'], m:'center', n:[1, 3]}, {a:['pack_animal'], m:'center', n:[1, 2]}, {a:['crate_wood'], m:'corner', n:[1, 2]}, {a:['barrel'], m:'corner', p:0.6}]},
    c_plaza:   {sz:1, fl:['dust'], it:[{a:['campfire'], m:'center1'}, {a:['sleeping_bag'], m:'ring', n:[3, 6]}, {a:['crate_wood'], m:'corner', p:0.6}, {a:['banner'], m:'corner', p:0.6}]},
    c_trade:   {sz:2, fl:['dust'], it:[{a:['market_stall'], m:'grid'}, {a:['market_tent'], m:'corner', p:0.5}, {a:['crate_wood'], m:'corner', n:[1, 2]}]},
    c_bedroll: {sz:1, fl:['dirt'], it:[{a:['sleeping_bag'], m:'grid'}, {a:['tent'], m:'corner', p:0.6}, {a:['lamp'], m:'corner', p:0.5}]},
    c_goods:   {sz:1, fl:['gravel'], it:[{a:['canopy'], m:'center1'}, {a:['crate_wood', 'crate_metal'], m:'corner', n:[2, 3]}, {a:['barrels_group', 'pallet'], m:'corner', n:[1, 2]}]},
    c_guard:   {sz:0, fl:['dust'], it:[{a:['sandbags_line', 'sandbags_arc'], m:'center1'}, {a:['oil_drum_fire'], m:'corner', p:0.7}, {a:['searchlight'], m:'corner', p:0.5}, {a:['ammo_crate'], m:'corner', p:0.5}]},
    c_miltents:{sz:2, fl:['dust'], it:[{a:['big_tent', 'tent'], m:'grid'}]},
    c_hq:      {sz:1, fl:['gravel'], it:[{a:['big_tent'], m:'center1'}, {a:['radio_mast'], m:'corner'}, {a:['banner'], m:'corner'}, {a:['radio', 'terminal'], m:'corner', p:0.6}, {a:['generator'], m:'corner', p:0.5}]},
    c_comms:   {sz:0, fl:['gravel'], it:[{a:['radio_mast'], m:'center1'}, {a:['generator'], m:'corner'}, {a:['radio'], m:'corner'}, {a:['crate_metal'], m:'corner', p:0.5}]},
    c_armory:  {sz:1, fl:['gravel'], it:[{a:['canopy'], m:'center1'}, {a:['weapon_rack'], m:'wall', n:[2, 3]}, {a:['ammo_crate'], m:'corner', n:[2, 4]}, {a:['crate_metal'], m:'corner', p:0.6}]},
    c_mess:    {sz:1, fl:['dust'], it:[{a:['field_kitchen'], m:'center1'}, {a:['table_dining'], m:'corner', n:[1, 2]}, {a:['water_cistern'], m:'corner'}, {a:['crate_wood'], m:'corner', p:0.6}]},
    c_motor:   {sz:2, fl:['gravel'], it:[{a:['pickup_rust', 'buggy', 'apc_wreck', 'war_rig'], m:'center', n:[1, 3]}, {a:['fuel_pump'], m:'wall'}, {a:['tire_stack', 'barrels_group'], m:'corner', n:[1, 3]}]},
    c_medic:   {sz:1, fl:['dust'], it:[{a:['big_tent'], m:'center1'}, {a:['stretcher'], m:'wall', n:[1, 3]}, {a:['medkit'], m:'corner', n:[1, 2]}, {a:['water_cistern'], m:'corner', p:0.4}]},
  };
  Object.assign(ROLES, CROLES);
  // [роль, название, ширина[min,max], высота[min,max], вероятность, место, количество]
  const CAMP_TYPES = {
    settle:{name:'Поселение', perim:['scrap', 'scrap', 'palisade', 'vehicles', 'wire', 'none'], schemes:['zones', 'radial', 'street'], banner:1, zones:[
      ['c_kitchen', 'Общая кухня', [5, 6], [5, 6], 1, 'center'], ['c_market', 'Рынок', [6, 8], [5, 6], 0.7, 'center'], ['c_shacks', 'Жилые хижины', [6, 8], [6, 7], 1, 'ring', 2], ['c_tents', 'Палатки', [6, 8], [5, 7], 0.7, 'ring'],
      ['c_elder', 'Дом старосты', [5, 6], [5, 6], 0.8, 'ring'], ['c_storage', 'Склад', [5, 6], [5, 6], 1, 'gate'], ['c_workshop', 'Мастерская', [5, 6], [5, 6], 1, 'outer'], ['c_garden', 'Огород', [6, 8], [4, 6], 1, 'outer', 2],
      ['c_water', 'Водосбор', [4, 5], [4, 5], 0.8, 'outer'], ['c_pen', 'Загон', [5, 6], [5, 6], 0.5, 'gate'], ['c_watch', 'Дозорный пост', [3, 4], [3, 4], 0.7, 'gate'], ['c_latrine', 'Отхожее место', [3, 4], [2, 3], 1, 'downwind']]},
    raiders:{name:'Лагерь банды', perim:['scrap', 'vehicles', 'vehicles', 'wire', 'none'], schemes:['zones', 'radial'], banner:1, zones:[
      ['c_arena', 'Арена', [6, 7], [6, 7], 0.6, 'center'], ['c_boss', 'Логово вожака', [6, 7], [5, 6], 1, 'ring'], ['c_barracks', 'Бараки', [6, 8], [5, 7], 1, 'ring', 2], ['c_garage', 'Гараж', [6, 8], [6, 7], 1, 'gate'],
      ['c_cages', 'Клетки', [5, 7], [4, 5], 1, 'outer'], ['c_loot', 'Добыча', [5, 6], [4, 5], 1, 'outer'], ['c_kitchen', 'Кухня', [5, 6], [5, 6], 0.7, 'ring'], ['c_shrine', 'Святилище', [4, 5], [4, 5], 0.5, 'outer'],
      ['c_watch', 'Дозор', [3, 4], [3, 4], 0.8, 'gate'], ['c_latrine', 'Отхожее место', [3, 4], [2, 3], 1, 'downwind']]},
    caravan:{name:'Стоянка каравана', perim:['vehicles', 'vehicles', 'none', 'wire'], schemes:['radial', 'radial', 'zones'], banner:1, zones:[
      ['c_plaza', 'Общий костёр', [6, 7], [6, 7], 1, 'center'], ['c_wagons', 'Повозки', [7, 8], [6, 7], 1, 'ring', 2], ['c_trade', 'Торговые ряды', [7, 8], [5, 6], 1, 'ring'], ['c_bedroll', 'Ночлег', [6, 7], [5, 6], 1, 'ring'],
      ['c_pen', 'Загон', [5, 6], [5, 6], 1, 'outer'], ['c_goods', 'Товары', [5, 6], [5, 6], 1, 'outer'], ['c_water', 'Вода', [4, 5], [4, 5], 0.5, 'outer'], ['c_guard', 'Охрана', [3, 4], [3, 4], 1, 'gate'], ['c_latrine', 'Отхожее место', [3, 4], [2, 3], 0.6, 'downwind']]},
    military:{name:'Военный лагерь', perim:['wire', 'wire', 'sandbag'], schemes:['street'], rect:1, banner:1, zones:[
      ['c_hq', 'Штаб', [6, 7], [6, 7], 1, 'center'], ['c_miltents', 'Палаточный городок', [8, 10], [7, 8], 1, 'ring', 2], ['c_comms', 'Связь', [4, 5], [4, 5], 1, 'ring'], ['c_armory', 'Оружейная', [5, 6], [5, 6], 1, 'ring'],
      ['c_mess', 'Полевая кухня', [6, 7], [5, 6], 1, 'ring'], ['c_motor', 'Автопарк', [7, 8], [6, 7], 1, 'gate'], ['c_medic', 'Лазарет', [6, 7], [5, 6], 0.8, 'outer'], ['c_guard', 'КПП', [3, 4], [3, 4], 1, 'gate'], ['c_latrine', 'Отхожее место', [3, 4], [2, 3], 1, 'downwind']]},
  };
  const CAMP_NAMES = {settle:['Ржавый Ключ', 'Новая Надежда', 'Пыльный Колодец', 'Тихий Угол', 'Последний Приют', 'Солёная Балка', 'Сухой Ручей'], raiders:['Черепа', 'Ржавые Псы', 'Пыльные Волки', 'Палачи', 'Красные Бензобаки', 'Шакалы'],
    caravan:['Медный Путь', 'Три Брамина', 'Соляной Караван', 'Длинная Дорога', 'Звон Монет'], military:null};
  function wasteCamp(doc, opts){
    opts = opts || {}; const g = ctxFor(doc, opts.seed); g.opts = opts; const {cols, rows} = doc, AREA = cols*rows;
    const typeId = CAMP_TYPES[opts.ctype] ? opts.ctype : g.pick(Object.keys(CAMP_TYPES)), T = CAMP_TYPES[typeId];
    const terr = ['waste', 'ruins', 'dryriver', 'rocks'].indexOf(opts.terr) >= 0 ? opts.terr : g.pick(['waste', 'waste', 'ruins', 'dryriver', 'rocks']);
    const perim = ['scrap', 'palisade', 'wire', 'vehicles', 'none', 'sandbag'].indexOf(opts.perim) >= 0 ? opts.perim : g.pick(T.perim);
    const cstate = ['living', 'abandoned', 'ravaged'].indexOf(opts.cstate) >= 0 ? opts.cstate : g.pick(['living', 'living', 'living', 'abandoned', 'ravaged']);
    const scheme = g.pick(T.schemes);
    reset(doc, terr==='rocks' ? 'dust' : 'sand');
    doc.gen = {id:'camp', seed:g.seed, opts:{ctype:opts.ctype || 'random', perim:opts.perim || 'random', terr:opts.terr || 'random', csize:opts.csize || 'medium', cstate:opts.cstate || 'random', scenes:opts.scenes || 'normal', prefabs:opts.prefabs || 'some', labels:opts.labels || 'buildings', lsize:opts.lsize || 'normal'}, parts:[]};
    const n1 = g.noise(7, 2), n2 = g.noise(3, 3);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const v = n1(x, y), w = n2(x, y); if(terr==='rocks'){ if(v > 0.6) g.setT(x, y, 'gravel'); else if(v < 0.25) g.setT(x, y, 'rock'); } else { if(v > 0.66) g.setT(x, y, 'dust'); else if(v < 0.2) g.setT(x, y, 'saltflat'); if(w > 0.83) g.setT(x, y, 'gravel'); } }
    // граница лагеря: неровный эллипс (у военных — прямоугольник)
    const fr = {small:0.27, medium:0.37, full:0.46}[opts.csize] || 0.37, R = Math.max(7, Math.min(cols, rows)*fr);
    const cx = cols/2 + g.ri(-2, 2), cy = rows/2 + g.ri(-2, 2), asp = T.rect ? 1 : 0.85 + g.rnd()*0.3;
    let poly = [];
    if(T.rect){ const hw = Math.round(R*1.1*Math.min(1.2, cols/rows)), hh = Math.round(R); poly = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]].map(([x, y])=>[Math.round(x), Math.round(y)]); }
    else { const nV = g.ri(13, 18), ph = g.rnd()*6.28, nz = g.noise(1.4, g.ri(1, 999)); for(let i=0;i<nV;i++){ const a = i/nV*6.28 + (g.rnd() - 0.5)*0.15, r = R*(0.86 + nz(i, 3)*0.28); poly.push([Math.round((cx + Math.cos(a + ph)*r*asp)*2)/2, Math.round((cy + Math.sin(a + ph)*r/asp)*2)/2]); } }
    poly = poly.map(([x, y])=>[Math.max(1.5, Math.min(cols - 1.5, x)), Math.max(1.5, Math.min(rows - 1.5, y))]);
    const inPoly = (x, y)=>{ let c = false; for(let i=0, j=poly.length - 1;i<poly.length;j=i++){ const [xi, yi] = poly[i], [xj, yj] = poly[j]; if((yi > y) !== (yj > y) && x < (xj - xi)*(y - yi)/(yj - yi) + xi) c = !c; } return c; };
    const edgeDist = (x, y)=>{ let m = Infinity; for(let i=0;i<poly.length;i++){ const [ax, ay] = poly[i], [bx, by] = poly[(i + 1)%poly.length], dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy || 1; let t = ((x - ax)*dx + (y - ay)*dy)/L2; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(x - ax - dx*t, y - ay - dy*t)); } return m; };
    // ворота: со стороны ближайшего края карты, куда уходит дорога; ветер — для отхожего места
    const sides = [[cy, 0, -Math.PI/2], [cols - cx, 1, 0], [rows - cy, 2, Math.PI/2], [cx, 3, Math.PI]].sort((a, b)=>a[0] - b[0]), gateAng = sides[g.rnd() < 0.7 ? 0 : 1][2] + (g.rnd() - 0.5)*0.5;
    const rayHit = (ang)=>{ let best = null; for(let i=0;i<poly.length;i++){ const [ax, ay] = poly[i], [bx, by] = poly[(i + 1)%poly.length], dx = Math.cos(ang), dy = Math.sin(ang), ex = bx - ax, ey = by - ay, den = dx*ey - dy*ex; if(Math.abs(den) < 1e-9) continue; const t = ((ax - cx)*ey - (ay - cy)*ex)/den, u = ((ax - cx)*dy - (ay - cy)*dx)/den; if(t > 0 && u >= 0 && u <= 1 && (!best || t < best.t)) best = {t, i, u, x:cx + dx*t, y:cy + dy*t}; } return best; };
    const gate = rayHit(gateAng) || {t:R, i:0, u:0.5, x:(poly[0][0] + poly[1][0])/2, y:(poly[0][1] + poly[1][1])/2}, gate2 = g.rnd() < 0.4 ? rayHit(gateAng + Math.PI + (g.rnd() - 0.5)*1.2) : null, wind = gateAng + Math.PI/2 + (g.rnd() < 0.5 ? 0 : Math.PI) + (g.rnd() - 0.5)*0.8;
    const attackAng = cstate==='ravaged' ? gateAng + (g.rnd() - 0.5)*2.4 : null;
    // местность вокруг: скалы с одной-двух сторон, руины, сухое русло
    const occAll = (x, y)=>x < 0 || y < 0 || x >= cols || y >= rows;
    let cliffAng = null;
    if(terr==='rocks'){ cliffAng = gateAng + Math.PI + (g.rnd() - 0.5)*1.4; const span = 0.9 + g.rnd()*0.7;
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx), da = Math.abs(((a - cliffAng + Math.PI*3)%(Math.PI*2)) - Math.PI), d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if(da < span && d > R*(1.02 + n2(x, y)*0.15)){ g.setT(x, y, 'rock'); if(!inPoly(x + 0.5, y + 0.5)) g.occ[y*cols + x] = 1; } } }
    if(terr==='dryriver'){ const off = R*(1.05 + g.rnd()*0.25), ra = gateAng + Math.PI/2 + (g.rnd() < 0.5 ? 0 : Math.PI), px = cx + Math.cos(ra)*off, py = cy + Math.sin(ra)*off, dir = ra + Math.PI/2;
      const pts = []; for(let t=-1.3;t<=1.3;t+=0.26){ const L = Math.max(cols, rows)*t, w = Math.sin(t*3 + g.rnd())*2.5; pts.push([px + Math.cos(dir)*L + Math.cos(ra)*w, py + Math.sin(dir)*L + Math.sin(ra)*w]); }
      g.path('dryriver', g.ri(2, 3), pts); }
    // ---- ограда ----
    const breach = new Set();
    const wallKind = {scrap:'scrap', palisade:'wood', wire:'fence', sandbag:'sandbag'}[perim];
    const segGate = (i, u0)=>[gate, gate2].some(gt=>gt && gt.i===i);
    const placed = [], put = (a, x, y, r, force)=>{ const as = MapAssets.BY_ID[a]; if(!as) return false; const t = r*Math.PI/180, bw = Math.abs(Math.cos(t))*as.w + Math.abs(Math.sin(t))*as.h, bh = Math.abs(Math.sin(t))*as.w + Math.abs(Math.cos(t))*as.h;
      const x0 = Math.floor(x - bw/2), y0 = Math.floor(y - bh/2), cw = Math.ceil(x + bw/2) - x0, ch = Math.ceil(y + bh/2) - y0; if(x0 < 0 || y0 < 0 || x0 + cw > cols || y0 + ch > rows) return false;
      if(!force && !as.g && !g.free(x0, y0, cw, ch)) return false; if(!as.g) g.mark(x0, y0, cw, ch); const o = {id:newId('o'), a, x:Math.round(x*100)/100, y:Math.round(y*100)/100, r:Math.round(((r%360) + 360)%360), s:1, v:g.variant(a, cstate==='living' ? 'intact' : 'ruined', cstate==='abandoned' ? /пуст|потух|остыл|рван|ржав|брош|выключ|засох/i : null), f:g.rnd() < 0.3}; doc.objects.push(o); placed.push(o); return o; };
    const inCliff = (x, y)=>{ const cx2 = Math.floor(x), cy2 = Math.floor(y); return cx2 >= 0 && cy2 >= 0 && cx2 < cols && cy2 < rows && doc.terrain[cy2*cols + cx2]===TI.rock; };
    for(let i=0;i<poly.length;i++){
      const a = poly[i], b = poly[(i + 1)%poly.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // отрезок стены, кроме проёма ворот и пролома; у скалы вместо ограды — скальный край
      const gts = [gate, gate2].filter(gt=>gt && gt.i===i).map(gt=>gt.u*len);
      const pieces = []; let s0 = 0; gts.sort((p, q)=>p - q).forEach(p=>{ pieces.push([s0, Math.max(s0, p - 2)]); s0 = p + 2; }); pieces.push([s0, len]);
      pieces.forEach(([s1, s2])=>{ if(s2 - s1 < 0.3) return; let pts = [[a[0] + Math.cos(ang)*s1, a[1] + Math.sin(ang)*s1], [a[0] + Math.cos(ang)*s2, a[1] + Math.sin(ang)*s2]];
        const mid = [(pts[0][0] + pts[1][0])/2, (pts[0][1] + pts[1][1])/2], midAng = Math.atan2(mid[1] - cy, mid[0] - cx);
        if(cliffAng != null && inCliff(mid[0] + Math.cos(midAng)*1.5, mid[1] + Math.sin(midAng)*1.5)){ g.wall('rock', pts); return; }
        if(attackAng != null && Math.abs(((midAng - attackAng + Math.PI*3)%(Math.PI*2)) - Math.PI) < 0.28){ breach.add(i); const m1 = s1 + (s2 - s1)*0.3, m2 = s1 + (s2 - s1)*0.7; pts = [[a[0] + Math.cos(ang)*s1, a[1] + Math.sin(ang)*s1], [a[0] + Math.cos(ang)*m1, a[1] + Math.sin(ang)*m1]];
          if(wallKind) g.wall(wallKind, pts); if(wallKind) g.wall(wallKind, [[a[0] + Math.cos(ang)*m2, a[1] + Math.sin(ang)*m2], [a[0] + Math.cos(ang)*s2, a[1] + Math.sin(ang)*s2]]); return; }
        if(perim==='vehicles'){ let s = s1 + 0.6; while(s < s2 - 1){ const A = g.pick(typeId==='caravan' ? ['caravan_cart', 'caravan_cart', 'car_wreck', 'pickup_rust'] : ['car_wreck', 'car_wreck', 'bus_wreck', 'pickup_rust', 'car_burnt', 'war_rig']), as = MapAssets.BY_ID[A], L = Math.max(as.w, as.h);
            if(s + L > s2) break; const px = a[0] + Math.cos(ang)*(s + L/2), py = a[1] + Math.sin(ang)*(s + L/2); put(A, px, py, ang*180/Math.PI + 90 + (as.h > as.w ? 0 : -90) + (g.rnd() - 0.5)*14, true); s += L + (g.rnd() < 0.3 ? 0.8 : 0.15);
            if(g.rnd() < 0.25 && s < s2 - 2){ put(g.pick(['jersey', 'barricade', 'tire_stack']), a[0] + Math.cos(ang)*(s + 1), a[1] + Math.sin(ang)*(s + 1), ang*180/Math.PI, true); s += 2; } } return; }
        pts = pts.map(p=>p.map(v=>Math.round(v*100)/100)); if(wallKind) g.wall(wallKind, pts);
        if(perim==='wire'){ for(let s=s1 + 1.5;s<s2 - 1.5;s+=3.2) put('barbed_wire', a[0] + Math.cos(ang)*s + Math.cos(ang - Math.PI/2)*0.8, a[1] + Math.sin(ang)*s + Math.sin(ang - Math.PI/2)*0.8, ang*180/Math.PI, true); } });
    }
    // ворота, вышки по ограде, дорога наружу, указатель
    const gateObj = {scrap:'settlement_gate', palisade:'settlement_gate', wire:'gate_metal', sandbag:'checkpoint', vehicles:null, none:null}[perim];
    [gate, gate2].forEach((gt, gi)=>{ if(!gt) return; const a = poly[gt.i], b = poly[(gt.i + 1)%poly.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if(gateObj) put(gateObj, gt.x, gt.y, ang*180/Math.PI + (gateObj==='checkpoint' ? 90 : 0), true);
      else if(perim==='none') [-1, 1].forEach(s=>put(g.pick(['sandbags_line', 'barricade']), gt.x + Math.cos(ang)*s*2.6, gt.y + Math.sin(ang)*s*2.6, ang*180/Math.PI, true));
      const out = Math.atan2(gt.y - cy, gt.x - cx), pts = [[gt.x, gt.y]]; let px = gt.x, py = gt.y, a2 = out; for(let k=0;k<30;k++){ a2 += (g.rnd() - 0.5)*0.35; a2 = a2*0.7 + out*0.3; px += Math.cos(a2)*3; py += Math.sin(a2)*3; pts.push([Math.round(px*100)/100, Math.round(py*100)/100]); if(px < -2 || py < -2 || px > cols + 2 || py > rows + 2) break; }
      g.path('track', 2, pts); if(gi===0) put('signpost', gt.x + Math.cos(out)*3 + Math.cos(out + Math.PI/2)*2, gt.y + Math.sin(out)*3 + Math.sin(out + Math.PI/2)*2, 0); });
    if(perim==='scrap' || perim==='palisade' || T.rect){ const nT = T.rect ? 4 : g.ri(2, 4); const idx = T.rect ? [0, 1, 2, 3] : g.shuffle(poly.map((_, i)=>i)).slice(0, nT);
      idx.forEach(i=>{ const [x, y] = poly[i], ia = Math.atan2(cy - y, cx - x); put(T.rect || perim==='palisade' ? 'watchtower' : 'scrap_tower', x + Math.cos(ia)*1.6, y + Math.sin(ia)*1.6, 0, true); if(g.rnd() < 0.5) put('searchlight', x + Math.cos(ia)*3, y + Math.sin(ia)*3, ia*180/Math.PI - 90); }); }
    // занятость: вне лагеря и полоса вдоль ограды — заняты (зоны внутри с отступом)
    const inside = new Uint8Array(AREA); for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const px = x + 0.5, py = y + 0.5; if(inPoly(px, py) && edgeDist(px, py) > 1.6) inside[y*cols + x] = 1; }
    const occBefore = g.occ.slice(); for(let i=0;i<AREA;i++) if(!inside[i]) g.occ[i] = 1;
    // ---- зоны ----
    const list = []; T.zones.forEach(z=>{ const cnt = z[6] || 1; for(let i=0;i<cnt;i++) if(g.rnd() < z[4] || (i===0 && z[4]===1)) list.push(z); });
    const ringZ = list.filter(z=>z[5]==='ring'), outerZ = list.filter(z=>z[5]==='outer'), base = g.rnd()*6.28;
    const target = (z, k)=>{ // куда тянется зона по выбранной схеме
      if(z[5]==='center') return [cx, cy];
      if(z[5]==='gate') return [gate.x - Math.cos(gateAng)*(4 + k*2), gate.y - Math.sin(gateAng)*(4 + k*2)];
      if(z[5]==='downwind') return [cx + Math.cos(wind)*R*0.8, cy + Math.sin(wind)*R*0.8];
      if(scheme==='street'){ const all = ringZ.concat(outerZ), j = all.indexOf(z), t = (j + 1)/(all.length + 1), sd = j%2 ? 1 : -1, sx = gate.x + (cx - gate.x)*t*1.6, sy = gate.y + (cy - gate.y)*t*1.6, pa = gateAng + Math.PI/2; return [sx + Math.cos(pa)*sd*5.5, sy + Math.sin(pa)*sd*5.5]; }
      if(scheme==='radial'){ const arr = z[5]==='ring' ? ringZ : outerZ, j = arr.indexOf(z), a = base + (j + 0.5)/arr.length*6.28, r = (z[5]==='ring' ? 0.48 : 0.78)*R; return [cx + Math.cos(a)*r, cy + Math.sin(a)*r]; }
      // функциональные кварталы: жильё / хозяйство / земледелие — каждый в своей стороне
      const grp = /c_(tents|shacks|elder|barracks|boss|bedroll|miltents|kitchen|mess|plaza|hq|comms|wagons)/.test(z[0]) ? 0 : /c_(garden|pen|water|cages|shrine|medic)/.test(z[0]) ? 2 : 1, a = gateAng + Math.PI + (grp - 1)*2.1 + (g.rnd() - 0.5)*0.6;
      return [cx + Math.cos(a)*R*(z[5]==='ring' ? 0.45 : 0.72), cy + Math.sin(a)*R*(z[5]==='ring' ? 0.45 : 0.72)]; };
    const zones = []; let gk = 0;
    const ZK = Math.max(1, Math.min(1.7, R/12)); // крупнее лагерь — крупнее зоны
    list.forEach(z=>{ let [tx, ty] = target(z, z[5]==='gate' ? gk++ : 0); let done = false;
      for(let shrink=0;shrink<4 && !done;shrink++){ const w = Math.max(3, Math.round(g.ri(z[2][0], z[2][1])*(z[0]==='c_latrine' || z[0]==='c_watch' || z[0]==='c_guard' ? 1 : ZK)) - shrink), h = Math.max(2, Math.round(g.ri(z[3][0], z[3][1])*(z[0]==='c_latrine' || z[0]==='c_watch' || z[0]==='c_guard' ? 1 : ZK)) - shrink);
        for(let r=0;r<R*1.2 && !done;r+=1){ const steps = Math.max(1, Math.round(r*4)); for(let s=0;s<steps;s++){ const a = s/steps*6.28 + base, x = Math.round(tx + Math.cos(a)*r - w/2), y = Math.round(ty + Math.sin(a)*r - h/2);
          if(g.free(x - 1, y - 1, w + 2, h + 2)){ zones.push({x, y, w, h, role:z[0], name:z[1]}); g.mark(x - 1, y - 1, w + 2, h + 2); done = true; break; } } } } });
    // одинаковые зоны — с номером; вход в зону — со стороны центра лагеря
    const cnt = {}; zones.forEach(z=>{ cnt[z.name] = (cnt[z.name] || 0) + 1; if(cnt[z.name] > 1) z.name += ' ' + cnt[z.name]; });
    for(let i=0;i<AREA;i++) g.occ[i] = occBefore[i] || !inside[i] ? 1 : 0; zones.forEach(z=>g.mark(z.x - 1, z.y - 1, 0, 0));
    zones.forEach(z=>{ const zx = z.x + z.w/2, zy = z.y + z.h/2, dx = cx - zx, dy = cy - zy; z.entries = [];
      if(Math.abs(dx) > Math.abs(dy)){ const ex = dx > 0 ? z.x + z.w - 1 : z.x; for(let y=z.y + Math.floor(z.h/2) - 1;y<=z.y + Math.floor(z.h/2);y++) z.entries.push([ex, y, {o:'v', ext:true}]); }
      else { const ey = dy > 0 ? z.y + z.h - 1 : z.y; for(let x=z.x + Math.floor(z.w/2) - 1;x<=z.x + Math.floor(z.w/2);x++) z.entries.push([x, ey, {o:'h', ext:true}]); }
      // пятно земли под зоной — зоны читаются на карте
      const fl = g.pick((ROLES[z.role] || {fl:['dust']}).fl), nz = g.noise(1.8, g.ri(1, 999)); for(let y=z.y - 1;y<=z.y + z.h;y++) for(let x=z.x - 1;x<=z.x + z.w;x++){ if(x < 0 || y < 0 || x >= cols || y >= rows) continue; const edge = x < z.x || y < z.y || x >= z.x + z.w || y >= z.y + z.h; if(!edge || nz(x, y) < 0.45) g.setT(x, y, fl); } });
    // улица от ворот к центру (схема «улица»)
    if(scheme==='street') g.path('trail', 2.2, [[gate.x, gate.y], [cx + (gate.x - cx)*0.4 + g.ri(-1, 1), cy + (gate.y - cy)*0.4 + g.ri(-1, 1)], [cx, cy]].map(p=>p.map(v=>Math.round(v*100)/100)));
    // мебель зон (с проверкой проходов); каждая зона — в отдельности
    const ruinedZone = (z)=>cstate==='abandoned' ? g.rnd() < 0.6 : cstate==='ravaged' && attackAng!=null ? Math.abs(((Math.atan2(z.y + z.h/2 - cy, z.x + z.w/2 - cx) - attackAng + Math.PI*3)%(Math.PI*2)) - Math.PI) < 1.1 : false;
    zones.forEach(z=>{ z.ruined = ruinedZone(z); furnish(g, z, {state:z.ruined ? 'ruined' : 'intact', ruined:z.ruined, drop:cstate==='abandoned' ? 0.3 : z.ruined ? 0.25 : 0, prefer:cstate==='abandoned' ? /пуст|потух|остыл|рван|ржав|брош|выключ|засох/i : z.ruined ? /сгор|обгор|разбит|рван|разлом|мёртв|опрокин/i : null}); });
    // натоптанные тропы от входов зон к центру лагеря
    if(cstate!=='abandoned' || g.rnd() < 0.5) zones.forEach(z=>{ if(!z.entries.length || z.role==='c_kitchen' && scheme!=='street') return; const [ex, ey] = z.entries[0], tx = cx + (g.rnd() - 0.5)*2, ty = cy + (g.rnd() - 0.5)*2; if(Math.hypot(ex - tx, ey - ty) < 3) return;
      const mx = (ex + tx)/2 + (g.rnd() - 0.5)*3, my = (ey + ty)/2 + (g.rnd() - 0.5)*3; g.path('trail', 1.1, [[ex + 0.5, ey + 0.5], [mx, my], [tx, ty]].map(p=>p.map(v=>Math.round(v*100)/100))); });
    // жизнь между зонами: мелочи по типу лагеря (редко, со своими лимитами)
    const FILL = {settle:['barrel', 'crate_wood', 'sleeping_bag', 'trash', 'drying_rack', 'water_cistern', 'oil_drum_fire', 'tire_stack', 'pallet'], raiders:['oil_drum_fire', 'tire_stack', 'trash', 'trophy_pole', 'barrel', 'scrap_pile', 'blood', 'skull_totem'], caravan:['crate_wood', 'barrel', 'sleeping_bag', 'pack_animal', 'campfire', 'pallet', 'trash'], military:['crate_metal', 'ammo_crate', 'sandbags_line', 'jerry' in MapAssets.BY_ID ? 'jerry' : 'barrel', 'barrel', 'lamp_post', 'radio']}[typeId];
    const fN = Math.round(AREA/170*(cstate==='abandoned' ? 0.5 : 1)), fUsed = {}; for(let i=0, k=0;i<fN*10 && k<fN;i++){ const a = g.pick(FILL); if((fUsed[a] || 0) >= 3) continue; const x = cx + (g.rnd() - 0.5)*R*1.8, y = cy + (g.rnd() - 0.5)*R*1.8; if(!inPoly(x, y) || edgeDist(x, y) < 1.8) continue; if(put(a, x, y, g.rnd() < 0.7 ? g.pick([0, 90, 180, 270]) : g.rnd()*360)){ fUsed[a] = (fUsed[a] || 0) + 1; k++; } }
    // мини-сцены в зонах
    const nsc = {none:0, normal:g.ri(1, 2), many:g.ri(3, 4)}[opts.scenes]; g.shuffle(zones.slice()).slice(0, nsc == null ? 1 : nsc).forEach(z=>{ const id = placeScene(g, z); if(id) z.scene = id; });
    // знамёна у ворот и в центре
    if(cstate!=='abandoned'){ const bv = {settle:1, raiders:0, caravan:3, military:2}[typeId]; [gate].concat(gate2 ? [gate2] : []).forEach(gt=>{ const ia = Math.atan2(cy - gt.y, cx - gt.x); const o = put('banner', gt.x + Math.cos(ia)*2 + Math.cos(ia + 1.57)*2.5, gt.y + Math.sin(ia)*2 + Math.sin(ia + 1.57)*2.5, 0); if(o) o.v = cstate==='ravaged' ? 4 : bv; }); }
    // состояние: следы боя у пролома / запустение
    if(cstate==='ravaged' && attackAng != null){ const bx = cx + Math.cos(attackAng)*R, by = cy + Math.sin(attackAng)*R;
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){ const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by); if(d < R*0.7 && n2(x*1.7, y*1.7) < 0.55 - d/(R*2)) g.setT(x, y, 'ash'); }
      for(let k=0;k<g.ri(3, 6);k++){ const a = attackAng + (g.rnd() - 0.5)*1.2, r = R*(0.6 + g.rnd()*0.6); put(g.pick(['corpse', 'blood', 'blood', 'rubble_pile', 'car_burnt', 'corpse']), cx + Math.cos(a)*r, cy + Math.sin(a)*r, g.rnd()*360, true); }
      for(let k=0;k<g.ri(1, 3);k++){ const a = attackAng + (g.rnd() - 0.5)*0.8, r = R*(1.1 + g.rnd()*0.4); put('crater', cx + Math.cos(a)*r, cy + Math.sin(a)*r, 0); } }
    if(cstate==='abandoned'){ for(let k=0;k<Math.round(AREA/300);k++) g.tryObj(g.pick(['dry_bush', 'trash', 'dry_bush', 'rocks_scatter']), 0, 0, cols, rows, 4); for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(inside[y*cols + x] && n1(x*2.3, y*2.3) > 0.72) g.setT(x, y, 'sand'); }
    // окрестности: руины / скалы / пустошь
    for(let i=0;i<AREA;i++) if(!inside[i] && !occBefore[i]) g.occ[i] = 0;
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(inPoly(x + 0.5, y + 0.5) || edgeDist(x + 0.5, y + 0.5) < 2.2) g.occ[y*cols + x] = 1;
    if(terr==='ruins'){ for(let k=0;k<g.ri(3, 6);k++){ const a = g.rnd()*6.28, r = R*(1.15 + g.rnd()*0.5), x = Math.round(cx + Math.cos(a)*r), y = Math.round(cy + Math.sin(a)*r), L1 = g.ri(3, 6), L2 = g.ri(2, 5), kind = g.pick(['brick', 'concrete']);
        if(x < 2 || y < 2 || x > cols - 3 || y > rows - 3 || !g.free(x - 1, y - 1, 3, 3)) continue; g.wall(kind, [[x + L1, y], [x, y], [x, y + L2]]); g.tryObj(g.pick(['rubble_pile', 'rubble_big', 'ruin_corner']), x - 2, y - 2, x + L1 + 2, y + L2 + 2, 4); }
      for(let k=0;k<g.ri(2, 4);k++) g.tryObj(g.pick(['ruin_house', 'ruin_corner', 'rubble_big', 'car_wreck', 'lamp_post', 'bus_wreck']), 0, 0, cols, rows, 8); }
    if(terr==='rocks'){ for(let k=0;k<Math.round(AREA/120);k++){ const a = cliffAng + (g.rnd() - 0.5)*2, r = R*(1.15 + g.rnd()*0.6); const x = Math.round(cx + Math.cos(a)*r), y = Math.round(cy + Math.sin(a)*r); g.tryObj(g.pick(['rock_big', 'rock_big', 'boulder', 'rocks_scatter']), x - 2, y - 2, x + 2, y + 2, 3); } }
    for(let i=0;i<Math.round(AREA/140);i++) g.tryObj(g.pick(terr==='rocks' ? ['boulder', 'rocks_scatter', 'dry_bush', 'cactus', 'beast_bones'] : ['dune', 'rock_big', 'boulder', 'rocks_scatter', 'cactus', 'dry_bush', 'beast_bones', 'crater', 'tire_stack', 'scrap_pile']), 0, 0, cols, rows, 5);
    // части карты: зоны; заголовок лагеря
    zones.forEach(z=>doc.gen.parts.push({k:'z', x:z.x, y:z.y, w:z.w, h:z.h, role:z.role, name:z.name, zone:typeId, scene:z.scene, ent:z.entries.map(([x, y, e])=>[x, y, e.o])}));
    const nm = CAMP_NAMES[typeId], title = typeId==='military' ? 'Блокпост №' + g.ri(3, 49) : T.name + ' «' + g.pick(nm) + '»';
    const topY = Math.min.apply(null, poly.map(p=>p[1])); doc.gen.title = {x:cx, y:Math.max(1, topY - 1.3), text:title + (cstate==='abandoned' ? ' (брошен)' : cstate==='ravaged' ? ' (разорён)' : '')};
    doc.gen.camp = typeId;
  }
  // перегенерация зоны лагеря: та же или другая зона того же типа лагеря
  function rerollZone(doc, part, mode){
    const g = ctxFor(doc, 0), {cols} = doc; g.opts = Object.assign({}, doc.gen.opts);
    const others = doc.gen.parts.filter(p=>p!==part), T = CAMP_TYPES[part.zone] || CAMP_TYPES.settle;
    const inside = (x, y)=>x > part.x + 0.01 && y > part.y + 0.01 && x < part.x + part.w - 0.01 && y < part.y + part.h - 0.01;
    doc.objects = doc.objects.filter(o=>!inside(o.x, o.y));
    g.occ.fill(1); for(let y=part.y;y<part.y + part.h;y++) for(let x=part.x;x<part.x + part.w;x++) g.occ[y*cols + x] = 0;
    const entries = (part.ent || []).map(([x, y, o])=>[x, y, {o, ext:true}]); seedUniqueness(g, doc, others);
    if(mode==='type'){ const used = {}; others.forEach(p=>{ used[p.role] = 1; }); const area = part.w*part.h;
      const fit = (z)=>z[0]!==part.role && z[2][0]*z[3][0] <= area + 4, fresh = T.zones.filter(z=>fit(z) && !used[z[0]]), pool = fresh.length ? fresh : T.zones.filter(fit); if(pool.length){ const z = g.pick(pool); part.role = z[0]; part.name = z[1]; } }
    const rm = {x:part.x, y:part.y, w:part.w, h:part.h, role:part.role, entries}; furnish(g, rm, {state:'intact'});
    delete part.scene; return true;
  }
  /* ---------- Утряска: физически возможная расстановка после любого генератора ----------
     Генераторы ставят предметы по своим правилам (занятость клеток, сцены, свалки под углом), но не знают о стенах,
     ямах и чужих предметах. Здесь по очереди (раньше поставленное — главнее) каждый предмет проверяется:
     не стоит на стене или ограде (кроме дверей, окон и того, что ставится в проём), не наезжает на другой предмет,
     не стоит в яме и не лежит ямой под стеной или предметом, деревья — не на асфальте, полу и дорогах, ямы и площадки —
     не в зданиях, всё — в пределах карты и не в толще породы. Нарушитель сдвигается на ближайшее допустимое место
     в той же части карты (в том же здании или так же снаружи), а если места нет — убирается. */
  const SET_WALL = /^(door|double_door|window|gate_metal|broken_window|display_window|vault_door|settlement_gate|partition|barricade|barricade_car|turnstiles|platform_edge|barbed_wire|sandbags_line|sandbags_arc|ladder|web_mass|bridge|skywalk|sky_bridge|cable_bridge)$/;
  const SET_HIGH = /^(window|broken_window|display_window|skywalk|sky_bridge|bridge|cable_bridge|gantry_crane|crane_beam)$/; // окна, переходы и краны — выше: под ними можно стоять
  const SET_HOLE = /^(crater|ravine|rift|anom_gravity|geyser|slag_pool|toxic_puddle|arena_pit)$/;    // впадины: в них ничего не стоит
  const SET_AREA = /^(yard|crossroad|zebra|parking|helipad|animal_pen|arena_pit)$/;                    // площадки — только снаружи
  const SET_TREE = /^(dead_tree|tree_sparse|mutant_tree|crystal_tree)$/, SET_PLANT = /^(cactus|dry_bush|mutant_plant|stumps|reeds|mineral_spikes)$/;
  const SET_KEEP = /^(stairs|stairs_down|ladder|vault_door|mine_headframe|door|double_door|gate_metal|window)$/; // ключевое — не убирается
  const SET_PAVE = {parking:'cracked', helipad:'concrete'};
  const PAVED = /^(asphalt|cracked|concrete|tiles|wood|carpet|metal)$/, FLOOR = /^(tiles|wood|carpet|metal)$/, SOLID = /^(bedrock|void)$/;
  function settle(doc, fixed){
    const BY = MapAssets.BY_ID, T = MapFormat.TERRAIN, {cols, rows} = doc;
    const ter = (x, y)=>{ x = Math.floor(x); y = Math.floor(y); return x<0 || y<0 || x>=cols || y>=rows ? 'void' : (T[doc.terrain[y*cols + x]] || {}).id || 'void'; };
    const box = (o, x, y)=>{ const a = BY[o.a], s = o.s || 1, t = (o.r || 0)*Math.PI/180; return {x, y, hw:a.w*s/2, hh:a.h*s/2, c:Math.cos(t), s:Math.sin(t), a, id:o.a}; };
    const corners = (b, m)=>{ const hw = Math.max(0.05, b.hw - m), hh = Math.max(0.05, b.hh - m); return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v])=>[b.x + u*b.c - v*b.s, b.y + u*b.s + v*b.c]); };
    const segHit = (p, q, b, m)=>{ // отрезок стены и прямоугольник предмета (в его системе координат), m — допуск у края
      const hw = b.hw - m, hh = b.hh - m; if(hw <= 0 || hh <= 0) return false; const L = (pt)=>{ const dx = pt[0] - b.x, dy = pt[1] - b.y; return [dx*b.c + dy*b.s, -dx*b.s + dy*b.c]; };
      const P0 = L(p), P1 = L(q), dx = P1[0] - P0[0], dy = P1[1] - P0[1]; let t0 = 0, t1 = 1;
      const cl = (pp, qq)=>{ if(pp===0) return qq >= 0; const t = qq/pp; if(pp < 0){ if(t > t1) return false; if(t > t0) t0 = t; } else { if(t < t0) return false; if(t < t1) t1 = t; } return true; };
      return cl(-dx, P0[0] + hw) && cl(dx, hw - P0[0]) && cl(-dy, P0[1] + hh) && cl(dy, hh - P0[1]); };
    const sat = (A, B, ma, mb)=>{ // пересечение двух повёрнутых прямоугольников с допуском
      const ax = [[A.c, A.s], [-A.s, A.c], [B.c, B.s], [-B.s, B.c]], ha = [A.hw - ma, A.hh - ma], hb = [B.hw - mb, B.hh - mb]; if(ha[0] <= 0 || ha[1] <= 0 || hb[0] <= 0 || hb[1] <= 0) return false;
      const dx = B.x - A.x, dy = B.y - A.y;
      return ax.every(([nx, ny])=>{ const ra = ha[0]*Math.abs(A.c*nx + A.s*ny) + ha[1]*Math.abs(-A.s*nx + A.c*ny), rb = hb[0]*Math.abs(B.c*nx + B.s*ny) + hb[1]*Math.abs(-B.s*nx + B.c*ny); return Math.abs(dx*nx + dy*ny) < ra + rb; }); };
    const dSeg = (x, y, p, q)=>{ const dx = q[0] - p[0], dy = q[1] - p[1], L = dx*dx + dy*dy || 1, t = Math.max(0, Math.min(1, ((x - p[0])*dx + (y - p[1])*dy)/L)); return Math.hypot(x - p[0] - t*dx, y - p[1] - t*dy); };
    const onRoad = (x, y)=>doc.paths.some(p=>/^(road|highway|rail|sidewalk)$/.test(p.kind) && p.points.some((pt, i)=>i && dSeg(x, y, p.points[i - 1], pt) < p.width/2 + 0.2));
    const part = (x, y)=>{ const p = partAt(doc, x, y); return p && p.k==='b' ? p : null; };
    const segs = []; doc.walls.forEach(w=>w.points.forEach((pt, i)=>{ if(i) segs.push([w.points[i - 1], pt]); }));
    const placed = [];
    function bad(o, b){ const a = b.a, id = o.a, cs = corners(b, 0.05);
      if(cs.some(([x, y])=>x < -0.01 || y < -0.01 || x > cols + 0.01 || y > rows + 0.01)) return true;
      if(!SET_WALL.test(id)){ const m = a.g ? 0.1 : 0.15; if(segs.some(([p, q])=>segHit(p, q, b, m))) return true; }
      if(cs.concat([[b.x, b.y]]).some(([x, y])=>SOLID.test(ter(x, y)))) return true;
      const B = part(b.x, b.y), t = ter(b.x, b.y);
      const ruined = B && /^(overgrown|collapsed)$/.test(B.st || '');
      if(SET_TREE.test(id) && (PAVED.test(t) || (B && !ruined) || onRoad(b.x, b.y))) return true;
      if(SET_PLANT.test(id) && ((FLOOR.test(t) || B) && !ruined || t==='asphalt' || onRoad(b.x, b.y) && id!=='reeds')) return true;
      if(SET_AREA.test(id) && (B || FLOOR.test(t))) return true;
      if(SET_HOLE.test(id) && (B || FLOOR.test(t)) && !(id==='slag_pool' || id==='toxic_puddle' || id==='crater' && B && B.st==='collapsed')) return true;
      for(const q of placed){ if(q.o===o) continue; const qa = q.b.a, qid = q.o.a;
        if(!a.g && !qa.g){ if(SET_WALL.test(id) && SET_WALL.test(qid) || SET_HIGH.test(id) || SET_HIGH.test(qid)) continue; if(sat(b, q.b, 0.12, 0.12)) return true; }
        else if(SET_HOLE.test(id) && !qa.g || SET_HOLE.test(qid) && !a.g){ if(sat(b, q.b, 0.2, 0.2)) return true; }
        else if(SET_HOLE.test(id) && SET_HOLE.test(qid)){ if(sat(b, q.b, Math.min(b.hw, b.hh)*0.35, Math.min(q.b.hw, q.b.hh)*0.35)) return true; } }
      return false; }
    const keep = []; let moved = 0;
    // сначала то, что трогать нельзя (стоит не от генератора), потом предметы, потом наземное — ямы подстраиваются под предметы
    const order = doc.objects.filter(o=>BY[o.a]).map((o, i)=>({o, i, k:fixed && fixed.has(o) ? 0 : BY[o.a].g ? 2 : 1})).sort((p, q)=>p.k - q.k || p.i - q.i);
    for(const {o, k} of order){ const b = box(o, o.x, o.y);
      if(k===0 || BY[o.a].custom || !bad(o, b)){ placed.push({o, b}); keep.push(o); continue; }
      const p0 = part(o.x, o.y), axis = Math.abs(((o.r || 0)%90)) < 0.01, st = axis ? 1 : 0.5; let got = null;
      for(let r=st;r<=4 && !got;r+=st){ const ring = [];
        for(let dx=-r;dx<=r;dx+=st) for(let dy=-r;dy<=r;dy+=st) if(Math.max(Math.abs(dx), Math.abs(dy))===r) ring.push([dx, dy]);
        ring.sort((p, q)=>Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
        for(const [dx, dy] of ring){ const x = o.x + dx, y = o.y + dy; if(part(x, y)!==p0) continue; const nb = box(o, x, y); if(!bad(o, nb)){ got = nb; break; } } }
      if(got){ o.x = Math.round(got.x*1000)/1000; o.y = Math.round(got.y*1000)/1000; placed.push({o, b:got}); keep.push(o); moved++; }
      else if(SET_KEEP.test(o.a)){ placed.push({o, b}); keep.push(o); } }
    const ks = new Set(keep), n0 = doc.objects.length; doc.objects = doc.objects.filter(o=>!BY[o.a] || ks.has(o));
    // разметка парковки и площадки — на покрытии, а не на голой земле: под ними кладётся битый асфальт / бетон
    doc.objects.forEach(o=>{ const pave = SET_PAVE[o.a]; if(!pave || fixed && fixed.has(o)) return; const b = box(o, o.x, o.y), w = Math.abs(b.hw*b.c) + Math.abs(b.hh*b.s), h = Math.abs(b.hw*b.s) + Math.abs(b.hh*b.c);
      for(let y=Math.max(0, Math.round(o.y - h));y<Math.min(rows, Math.round(o.y + h));y++) for(let x=Math.max(0, Math.round(o.x - w));x<Math.min(cols, Math.round(o.x + w));x++) if(!PAVED.test(ter(x, y)) && !part(x + 0.5, y + 0.5)) doc.terrain[y*cols + x] = MapFormat.T_INDEX[pave]; });
    return {moved, removed:n0 - doc.objects.length};
  }
  const LIST = [
    {id:'city', name:'Руины городского квартала', run:(d, o)=>{ cityRuins(d, o); applyLabels(d); }},
    {id:'bunker', name:'Подземный комплекс / бункер', run:(d, o)=>{ bunker(d, o); applyLabels(d); }},
    {id:'camp', name:'Лагерь', run:(d, o)=>{ wasteCamp(d, o); applyLabels(d); }},
  ];
  const settled = (gen)=>{ const run = gen.run; gen.run = (d, o)=>{ const r = run(d, o); settle(d); return r; }; return gen; };
  LIST.forEach(settled);
  const STATE_NAME = {}; BSTATES.forEach(q=>{ STATE_NAME[q.id] = q.name; });
  // Часть (здание/комната), в которой лежит точка
  function partAt(doc, x, y){ const ps = doc.gen && doc.gen.parts || []; return ps.find(p=>x >= p.x - 0.01 && y >= p.y - 0.01 && x <= p.x + p.w + 0.01 && y <= p.y + p.h + 0.01) || null; }
  function partTitle(p){ return p.k==='b' ? (p.name || (ARCH_BY[p.arch] || {}).name || 'Здание') + (STATE_NAME[p.st] ? ' · ' + STATE_NAME[p.st] : '') : (p.name || 'Комната'); }
  function seedUniqueness(g, doc, others){ // учесть уже стоящее: варианты предметов, сцены, типы и состояния других частей
    doc.objects.forEach(o=>{ g.vc[o.a + ':' + o.v] = (g.vc[o.a + ':' + o.v] || 0) + 1; });
    others.forEach(p=>{ if(p.scene){ g.uses['vg:' + p.scene] = 1; g.uses['pf:' + p.scene] = 1; } if(p.arch) g.uses['arch:' + p.arch] = (g.uses['arch:' + p.arch] || 0) + 1; if(p.st) g.uses['bstate:' + p.st] = (g.uses['bstate:' + p.st] || 0) + 1; }); }
  function rerollBuilding(doc, part, mode){
    const g = ctxFor(doc, 0), {cols, rows} = doc; g.opts = Object.assign({}, doc.gen.opts);
    const others = doc.gen.parts.filter(p=>p!==part && p.k==='b'), lot = part.lot || [Math.max(0, part.x - 2), Math.max(0, part.y - 2), Math.min(cols, part.x + part.w + 2), Math.min(rows, part.y + part.h + 2)];
    const inRect = (x, y, p, m)=>x >= p.x - m && y >= p.y - m && x <= p.x + p.w + m && y <= p.y + p.h + m, inLot = (x, y)=>x >= lot[0] && y >= lot[1] && x <= lot[2] && y <= lot[3];
    // убрать старое здание (стены, двери, окна, мебель, подпись) и его двор (то, что в участке, но не у других зданий)
    doc.walls = doc.walls.filter(w=>!w.points.every(q=>inRect(q[0], q[1], part, 0.01)));
    doc.objects = doc.objects.filter(o=>!(inRect(o.x, o.y, part, 0.5) || inLot(o.x, o.y) && !others.some(p=>inRect(o.x, o.y, p, 1.5))));
    doc.labels = doc.labels.filter(l=>l.id!==part.label);
    // пол под старым зданием — грунт вокруг него
    const cnt = {}; for(let x=part.x - 1;x<=part.x + part.w;x++) for(let y=part.y - 1;y<=part.y + part.h;y++){ if(x>=part.x && y>=part.y && x<part.x + part.w && y<part.y + part.h) continue; if(x<0 || y<0 || x>=cols || y>=rows || others.some(p=>inRect(x + 0.5, y + 0.5, p, 0))) continue; const t = doc.terrain[y*cols + x]; cnt[t] = (cnt[t] || 0) + 1; }
    const base = +Object.keys(cnt).sort((a, b)=>cnt[b] - cnt[a])[0]; if(!isNaN(base)) for(let y=part.y;y<part.y + part.h;y++) for(let x=part.x;x<part.x + part.w;x++) doc.terrain[y*cols + x] = base;
    // занятость: всё вне участка, соседние здания с отступом, оставшиеся предметы
    g.occ.fill(1); for(let y=lot[1] - 1;y<=lot[3];y++) for(let x=lot[0] - 1;x<=lot[2];x++) if(x>=0 && y>=0 && x<cols && y<rows) g.occ[y*cols + x] = 0; // участок + клетка отступа
    others.forEach(p=>g.mark(p.x - 1, p.y - 1, p.w + 2, p.h + 2));
    doc.objects.forEach(o=>{ const a = MapAssets.BY_ID[o.a]; if(!a || a.g) return; const s = o.s || 1, q = Math.round(((o.r||0)%180 + 180)%180)===90, w = (q ? a.h : a.w)*s, h = (q ? a.w : a.h)*s; g.mark(Math.floor(o.x - w/2), Math.floor(o.y - h/2), Math.ceil(w), Math.ceil(h)); });
    seedUniqueness(g, doc, others); others.forEach(p=>g.built.push({arch:p.arch, shape:p.shape, w:p.w, h:p.h, rooms:p.rooms}));
    const thX = THEMES[g.opts.theme], APX = thX ? ARCH.concat(ARCH_X.filter(a=>thX.indexOf(a.id) >= 0)) : ARCH; g.bags.arch = g.shuffle(APX.filter(a=>!g.uses['arch:' + a.id])); g.bags.bstate = g.shuffle(BSTATES.filter(q=>!g.uses['bstate:' + q.id]));
    g.avoidState = part.st; if(mode==='type') g.avoidArch = part.arch;
    let force = mode==='same' ? part.arch : null;
    if(mode==='type'){ // другой тип — сперва из ещё не встречавшихся на карте, по возможности в теме района
      const lw = lot[2] - lot[0], lh = lot[3] - lot[1], th = THEMES[g.opts.theme], cand = APX.filter(a=>a.id!==part.arch && !g.uses['arch:' + a.id] && Math.min(a.w[0], a.h[0]) <= Math.min(lw, lh) && Math.max(a.w[0], a.h[0]) <= Math.max(lw, lh));
      const themed = th ? cand.filter(a=>th.indexOf(a.id) >= 0) : []; const c = themed.length ? themed : cand; if(c.length) force = g.pick(c).id; }
    const exact = {x:part.x, y:part.y, w:part.w, h:part.h};
    let b = building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, force, exact);
    if(!b && mode==='type') b = building(g, lot[0], lot[1], lot[2], lot[3], undefined, undefined, part.arch, exact); // другого типа не влезло — тот же тип заново
    if(!b) return false; Object.assign(part, partOf(b, lot)); return true;
  }
  function rerollRoom(doc, part, mode){
    const g = ctxFor(doc, 0), {cols} = doc; g.opts = Object.assign({}, doc.gen.opts);
    const others = doc.gen.parts.filter(p=>p!==part && p.k==='r');
    const inside = (x, y)=>x > part.x + 0.01 && y > part.y + 0.01 && x < part.x + part.w - 0.01 && y < part.y + part.h - 0.01;
    doc.objects = doc.objects.filter(o=>!inside(o.x, o.y)); doc.labels = doc.labels.filter(l=>l.id!==part.label);
    g.occ.fill(1); for(let y=part.y;y<part.y + part.h;y++) for(let x=part.x;x<part.x + part.w;x++) g.occ[y*cols + x] = 0;
    const entries = (part.ent || []).map(([x, y, o])=>[x, y, {o, ext:true}]); entries.forEach(([x, y])=>g.mark(x, y, 1, 1));
    seedUniqueness(g, doc, others);
    if(mode==='type' && BZONES[part.zone]){ const used = {}; others.forEach(p=>{ used[String(p.name).replace(/ №\d+$/, '')] = 1; }); const area = part.w*part.h; let pick = null;
      for(const z of [part.zone].concat(ZNEXT[part.zone] || [])){ const c = BZONES[z].filter(t=>t[2] <= area && !used[t[0]] && t[0]!==part.name); if(c.length){ pick = g.pick(c); break; } }
      if(!pick){ const c = BZONES[part.zone].filter(t=>t[2] <= area && t[0]!==part.name); if(c.length) pick = g.pick(c); }
      if(pick){ part.name = pick[0]; part.role = pick[1]; } }
    const role = ROLES[part.role]; if(role) g.rectT(part.x, part.y, part.w, part.h, g.pick(role.fl));
    const rm = {x:part.x, y:part.y, w:part.w, h:part.h, role:part.role, entries}, cond = doc.gen.cond;
    furnish(g, rm, cond==='wrecked' ? g.rnd() < 0.75 : g.rnd() < 0.2);
    delete part.scene; const sp = {none:0, normal:0.35, many:0.7}[g.opts.scenes]; if(g.rnd() < (sp == null ? 0.35 : sp)){ const id = placeScene(g, rm); if(id) part.scene = id; }
    return true;
  }
  function reroll(doc, part, mode){ const before = new Set(doc.objects); // утряска — только нового: остальное (и поставленное Мастером) не двигается
    const ok = part.k==='b' ? rerollBuilding(doc, part, mode) : part.k==='z' ? rerollZone(doc, part, mode) : rerollRoom(doc, part, mode); settle(doc, before); applyLabels(doc); return ok; }
  // Подписи сгенерированного: строятся заново по сведениям о генерации (меняются без перегенерации карты).
  // labels: none — без подписей; buildings — здания (тип · состояние) и комнаты бункера; rooms — ещё и помещения внутри
  // зданий; full — ещё мини-сцены (красным) и общий заголовок. Свои надписи Мастера не трогаются.
  const ROLE_NAME = {living:'Гостиная', kitchen:'Кухня', bedroom:'Спальня', bath:'Санузел', storage:'Кладовая', hall:'Холл', sales_food:'Торговый зал', sales_drug:'Торговый зал', sales_tool:'Торговый зал',
    office:'Кабинет', boss:'Кабинет начальника', archive:'Архив', workshop:'Мастерская', garage_bay:'Бокс', reception:'Приёмная', ward:'Палата', surgery:'Операционная', classroom:'Класс', dining:'Зал',
    stockroom:'Склад', chapel:'Молельный зал', arsenal:'Оружейная', cell:'Камера', lockerroom:'Раздевалка', lab:'Лаборатория', server:'Серверная', laundry:'Постирочная', laundry_big:'Прачечная',
    boilerroom:'Котельная', substation:'Трансформаторная', guard:'Пост охраны'};
  const LSIZE = {small:0.45, normal:0.65, large:0.9};
  const TITLE_FULL = ['bunker', 'plains', 'caves']; // заголовок карты — только в режиме «+ мини-сцены и заголовок»
  function applyLabels(doc){
    const gn = doc.gen; if(!gn) return; const mode = gn.opts.labels || 'buildings', sz = LSIZE[gn.opts.lsize] || LSIZE.normal;
    const old = new Set(gn.parts.map(p=>p.label).filter(Boolean)); gn.parts.forEach(p=>{ delete p.label; });
    doc.labels = doc.labels.filter(l=>!/^lgen/.test(l.id) && !old.has(l.id));
    if(mode==='none') return;
    const add = (x, y, text, size, color)=>{ if(!text) return; const hw = String(text).length*size*0.27; x = Math.max(Math.min(hw + 0.2, doc.cols/2), Math.min(doc.cols - hw - 0.2, x)); // подпись целиком в пределах карты
      if(text) doc.labels.push({id:'lgen' + newId(''), x:Math.round(x*1000)/1000, y:Math.round(y*1000)/1000, text:String(text).slice(0, 200), size:Math.round(size*1000)/1000, color:color || '#1e1b18'}); };
    const sceneName = (id)=>{ const v = VIGNETTES.find(q=>q.id===id); if(v) return v.name; const pf = prefabList().find(q=>q.id===id); return pf ? pf.name : null; };
    gn.parts.forEach(p=>{
      if(p.k==='b'){ add(p.x + p.w/2, Math.max(sz*0.7, p.y - sz*0.75), partTitle(p), sz);
        if(mode==='rooms' || mode==='full') (p.rm || []).forEach(([x, y, w, h, role])=>{ if(w*h >= 6 && Math.min(w, h) >= 2) add(x + w/2, y + h/2, ROLE_NAME[role], sz*0.7, '#4f4336'); }); }
      else add(p.x + p.w/2, p.y + Math.min(0.15 + sz*0.6, p.h/2), p.name, sz);
      if(mode==='full' && p.scene){ const n = sceneName(p.scene); if(n) add(p.x + p.w/2, p.y + p.h - Math.min(sz*0.65, p.h/3), '⚑ ' + n, sz*0.75, '#9c2f1c'); }
    });
    if(gn.title && (mode==='full' || TITLE_FULL.indexOf(gn.id) < 0)) add(gn.title.x, gn.title.y, gn.title.text, sz*1.35, gn.id==='bunker' ? '#9c2f1c' : '#1e1b18');
  }
  // Дополнения (03b-map-wilds.js): свой генератор в списке и общие части — контекст, здания, мебель, подписи
  function register(gen){ if(gen && gen.id && !LIST.some(x=>x.id===gen.id)) LIST.push(settled(gen)); }
  const kit = {ctxFor, reset, furnish, placeSpecs, placeScene, building, partOf, addArch, ARCH_BY, THEMES, ROLES, ROLE_NAME, BSTATES, wallsFromMask};
  return { LIST, settle, wallsFromMask, partAt, partTitle, reroll, applyLabels, prefabList, userPrefabs, saveUserPrefabs, validPrefab, PF_GROUPS, register, kit };
})();
