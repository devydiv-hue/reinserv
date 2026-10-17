/* ======================================================================
   RENDERING
   ====================================================================== */
// Полный список источников бонусов характеристики (character.log[statKey] — архетип/подтип/
// происхождение/специализация/статические бонусы/выбранное игроком/случайное — всё, что копило туда
// addLog по ходу генерации) — по наведению мыши на саму характеристику в блоке статов. Раньше это же
// показывалось тегами прямо в поповере броска — убрали оттуда (у прокачанного персонажа тегов
// набиралось слишком много для маленького поповера, см. openRollPicker), сюда просто перенесли. Ничего
// не подсказываем текстом про саму эту возможность — не для рядового игрока, кто наведёт, тот увидит.
let _statSourcesPopupEl = null;
function hideStatSourcesPopup(){
  if(_statSourcesPopupEl){ _statSourcesPopupEl.remove(); _statSourcesPopupEl = null; }
}
function showStatSourcesPopup(statKey, anchorEl){
  hideStatSourcesPopup();
  if(!character) return;
  const entries = character.log[statKey] || [];
  const rows = entries.length
    ? entries.map(l=>`<div class="stat-src-row"><span>${escapeHtml(l.source)}</span><b>${l.delta>0?'+':''}${l.delta}</b></div>`).join('')
    : `<div class="stat-src-row stat-src-empty"><span>Только базовое значение</span></div>`;
  const popup = document.createElement('div');
  popup.className = 'roll-popup stat-src-popup';
  popup.innerHTML = `<div class="quad-title">${escapeHtml(STAT_LABELS[statKey])}</div><div class="stat-src-list">${rows}</div>`;
  popup.style.visibility = 'hidden';
  document.body.appendChild(popup);
  const ar = anchorEl.getBoundingClientRect(), pr = popup.getBoundingClientRect();
  let left = ar.right + 8, top = ar.top + ar.height/2 - pr.height/2;
  if(left + pr.width > window.innerWidth - 6) left = ar.left - pr.width - 8;
  left = Math.max(6, left);
  top = Math.max(6, Math.min(top, window.innerHeight - pr.height - 6));
  popup.style.left = left+'px'; popup.style.top = top+'px';
  popup.style.visibility = 'visible';
  _statSourcesPopupEl = popup;
}
function renderStatBlock(containerId, stats){
  const el = document.getElementById(containerId);
  el.innerHTML='';
  stats.forEach(s=>{
    const row = document.createElement('div');
    row.className='stat-row';
    row.innerHTML = `<span class="name">${STAT_LABELS[s]}</span><span class="val">${character?character.stats[s]:0}</span><span class="roll">${character?(character.stats[s]+10):10}</span>`;
    row.addEventListener('pointerdown', (e)=>{ if(character && e.button===0){ e.preventDefault(); openRollPicker(s, e.clientX, e.clientY); } });
    row.addEventListener('mouseenter', ()=>{ if(character) showStatSourcesPopup(s, row); });
    row.addEventListener('mouseleave', hideStatSourcesPopup);
    el.appendChild(row);
  });
}

/* ======================================================================
   ОСНОВНОЙ БРОСОК (стр. 19-20)
   к20 против Максимума [ЗХ + 10 + модификатор ситуации]; успех при итоге ≤ Максимума.
   Особое правило книги: натуральные 12 — всегда успех, 13 — всегда провал, вне зависимости
   от Максимума. При успехе категория: 1-5 → КУ1, 6-10 → КУ2, 11+ → КУ3.
   Модификаторы в книге всегда кратны 3 (+6 «Элементарно» … −18 «Невозможно», стр. 20);
   поле расширено до ±21 тем же шагом. Средний (увеличенный) ряд — −6…+6: по тексту книги
   это самые ходовые значения, −3 встречается в описаниях способностей чаще всего.
   ====================================================================== */
// Полный диапазон модификаторов ±21, а не только кратные 3 — в тексте книги названы только
// кратные 3 (+6 Элементарно … −18 Невозможно, стр. 20), но на столе они складываются с бонусами от
// ран, снаряжения и т.д. и итог не обязан быть кратен 3. Кратные 3 остаются на крупных гексагонах в
// центральном ряду (это по-прежнему самые ходовые по тексту книги значения, −3 — чаще всех), а
// промежуточные значения — мелкими гексагонами сверху и снизу, каждое строго между тем средним
// рядом, откуда оно на числовой прямой.
// Все 43 модификатора (−21…+21) уложены в 7 симметричных рядов (5,6,6,9,6,6,5 — шире всего
// в середине), чтобы вместе гексагоны укладывались в подобие окружности/гексагона, а не тянулись
// одной длинной лентой. Значения идут по возрастанию слева направо и сверху вниз, так что «−3»
// (второй слева в самом широком, среднем ряду) остаётся геометрически близко к центру поля.
const ROLL_HEX_ROW_LENGTHS = [5,6,6,9,6,6,5];
const ROLL_HEX_ROWS = (()=>{
  const vals = []; for(let v=-21; v<=21; v++) vals.push(v);
  const rows = []; let i=0;
  ROLL_HEX_ROW_LENGTHS.forEach(len=>{ rows.push(vals.slice(i,i+len)); i+=len; });
  return rows;
})();

// Векторная арифметика 3D — общая для икосаэдра (D20) и остальных многогранников (D4/D6/D12,
// см. ниже): вынесена на верхний уровень, чтобы не дублировать при постройке новых кубиков тем же
// приёмом, что и существующий D20 (matrix3d на грань, повёрнутый к зрителю нормалью).
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scl=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const nrm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; };
const crs=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const dist=(a,b)=>len(sub(a,b));

let _icosaVerts = null;
function icosahedronVertices(){
  if(_icosaVerts) return _icosaVerts;
  const t = (1 + Math.sqrt(5)) / 2;
  _icosaVerts = [[0,1,t],[0,1,-t],[0,-1,t],[0,-1,-t],
   [1,t,0],[1,-t,0],[-1,t,0],[-1,-t,0],
   [t,0,1],[t,0,-1],[-t,0,1],[-t,0,-1]];
  return _icosaVerts;
}
// Геометрия икосаэдра считается один раз: 12 вершин, 20 граней находятся перебором троек вершин
// с минимальным попарным расстоянием (надёжнее, чем захардкоженный список индексов — не даёт
// шанса на опечатку). Для каждой грани готовится CSS matrix3d, ставящий треугольный div в её
// плоскость, и нормаль — по ней потом доворачиваем кубик нужной гранью к зрителю.
// Грани из РЕАЛЬНЫХ общих вершин (перебор троек с равной длиной ребра — как раньше только у D20,
// теперь общая функция и для D4): раз соседние треугольные грани строятся из одних и тех же вершин,
// они гарантированно сходятся рёбрами без зазоров. rPx — расстояние от центра до плоскости грани
// (инрадиус), px; localR — радиус описанной окружности треугольника внутри div-а 110×110 (см. CSS,
// .dp-die-face.shape-tri) — ОБЯЗАН совпадать с реальной геометрией clip-path, иначе грани получаются
// не того размера и между ними видны зазоры (это и было причиной "пустых" D4 — раньше его размер
// вообще не считали из вершин, а гадали по нормали, см. facesFromNormals ниже).
function facesFromTriangleVertices(verts, rPx, localR){
  let edge = Infinity;
  for(let i=0;i<verts.length;i++) for(let j=i+1;j<verts.length;j++) edge = Math.min(edge, dist(verts[i],verts[j]));
  const faces=[];
  for(let i=0;i<verts.length;i++) for(let j=i+1;j<verts.length;j++) for(let k=j+1;k<verts.length;k++){
    if(Math.abs(dist(verts[i],verts[j])-edge)<1e-6 &&
       Math.abs(dist(verts[j],verts[k])-edge)<1e-6 &&
       Math.abs(dist(verts[i],verts[k])-edge)<1e-6) faces.push([verts[i],verts[j],verts[k]]);
  }
  const result = faces.map(([A,B,C])=>{
    const G = scl(add(add(A,B),C), 1/3);
    const n = nrm(G);                       // центр фигуры в начале координат → нормаль совпадает с направлением центроида
    // e2' подобран так, чтобы локальная вершина треугольника (наверху div-а) легла в вершину A.
    // e1' = e2' × n: определитель экранного отображения грани должен быть ПОЛОЖИТЕЛЬНЫМ, иначе
    // цифра на грани рисуется зеркально (проверено рендером несимметричной буквы, а не на глаз).
    const e2 = nrm(scl(sub(A,G), -1));
    const e1 = crs(e2, n);
    const Rface = len(sub(A,G));
    const s = (Rface * rPx) / localR;      // масштаб локального треугольника до размеров грани
    const col1 = scl(e1, s), col2 = scl(e2, s), col3 = n, col4 = scl(G, rPx);
    const m = [col1[0],col1[1],col1[2],0, col2[0],col2[1],col2[2],0, col3[0],col3[1],col3[2],0, col4[0],col4[1],col4[2],1];
    return { normal:n, e1, verts:[A,B,C], centroid:G, matrix:'matrix3d('+m.map(v=>v.toFixed(5)).join(',')+')' };
  });
  // Грани смотрят в разные стороны, поэтому цифра на каждой из них после доворота к зрителю
  // оказывается повёрнутой по-своему. Считаем этот угол заранее (computeTextRotations, ниже у
  // settleMatrixFor) и компенсируем его поворотом самой цифры — иначе выпавшее число читается
  // вверх ногами.
  return computeTextRotations(result);
}
// Геометрия икосаэдра считается один раз: 12 вершин, 20 граней находятся перебором троек вершин
// с минимальным попарным расстоянием (надёжнее, чем захардкоженный список индексов — не даёт
// шанса на опечатку). Для каждой грани готовится CSS matrix3d, ставящий треугольный div в её
// плоскость, и нормаль — по ней потом доворачиваем кубик нужной гранью к зрителю.
let _icosaFaces = null;
function icosahedronFaces(){
  if(_icosaFaces) return _icosaFaces;
  _icosaFaces = facesFromTriangleVertices(icosahedronVertices(), 50, 55);
  return _icosaFaces;
}

/* ======================================================================
   D4 / D6 / D12 — те же приёмы, что и у D20 выше (matrix3d на грань, повёрнутый к зрителю нормалью).
   D4 переиспользует facesFromTriangleVertices (грани из реальных общих вершин — гарантия отсутствия
   зазоров). D6/D12 строятся из одной только нормали (facesFromNormals) — для куба это ТОЧНО и без
   зазоров (осеориентированные грани, см. cubeFaces), а додекаэдр восстанавливается из реальных
   вершин через двойственность с икосаэдром (см. dodecahedronFaces) — тоже без зазоров.
   ====================================================================== */
// Базис (e1,e2) в плоскости грани по одной только нормали: берём любой не-параллельный опорный
// вектор, проецируем его на плоскость ⟂ нормали.
function faceBasis(n){
  const ref = Math.abs(n[2]) > 0.9 ? [1,0,0] : [0,0,1];
  const e2 = nrm(sub(ref, scl(n, dot(ref, n))));
  const e1 = crs(e2, n);
  return {e1, e2};
}
function facesFromNormals(normals, rPx, localHalf){
  const s = rPx / localHalf;
  const faces = normals.map(raw=>{
    const n = nrm(raw);
    const {e1, e2} = faceBasis(n);
    const col1=scl(e1,s), col2=scl(e2,s), col3=n, col4=scl(n,rPx);
    const m=[col1[0],col1[1],col1[2],0, col2[0],col2[1],col2[2],0, col3[0],col3[1],col3[2],0, col4[0],col4[1],col4[2],1];
    return { normal:n, e1, matrix:'matrix3d('+m.map(v=>v.toFixed(5)).join(',')+')' };
  });
  return computeTextRotations(faces);
}
// Тетраэдр самодвойствен: вершины на (±1,±1,±1) с чётным числом минусов, все 4 тройки вершин
// равноудалены друг от друга — facesFromTriangleVertices сам найдёт ровно 4 грани, как и для
// икосаэдра, только с 4 вершинами вместо 12. Раньше грани строились из нормали (4 отрицания вершин)
// через facesFromNormals — тот путь не учитывал НАСТОЯЩИЙ размер грани (гадал его по круглому
// описанному радиусу вместо реального ребра тетраэдра) и грани получались заметно мельче нужного:
// между ними были видны зазоры (модель выглядела "пустой", без рёбер).
let _tetraFaces = null;
function tetrahedronFaces(){
  if(_tetraFaces) return _tetraFaces;
  _tetraFaces = facesFromTriangleVertices([[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]], 46, 55);
  return _tetraFaces;
}
// Куб: грани осеориентированы, поэтому для НИХ (в отличие от тетраэдра/додекаэдра) построение по
// одной нормали через facesFromNormals точное, а не приближённое — faceBasis всегда возвращает e1/e2
// точно вдоль рёбер куба (проверено для всех 6 нормалей). localHalf=44, а не 55 (как раньше): грань
// куба — квадрат с clip-path 10%..90% от 110px, т.е. половина стороны в локальных px = 44, а не
// круговой описанный радиус 55 (тот годится только для треугольника/пятиугольника, где e1/e2 смотрят
// на вершину, а не вдоль ребра) — неверный локальный радиус и был причиной зазоров у D6.
let _cubeFaces = null;
function cubeFaces(){
  if(_cubeFaces) return _cubeFaces;
  _cubeFaces = facesFromNormals([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]], 50, 44);
  return _cubeFaces;
}
// Додекаэдр двойствен икосаэдру: его 12 граней смотрят в те же 12 направлений, что и вершины
// икосаэдра (нормаль), а РЕАЛЬНЫЕ 5 вершин каждой такой грани — это центроиды тех 5 граней
// икосаэдра, что сходятся в соответствующей вершине икосаэдра (та же двойственность, только теперь
// используется и для формы, не только для направления нормали — раньше грань строилась из одной
// нормали с УГАДАННЫМ размером/поворотом через facesFromNormals, и из-за этого соседние
// пятиугольники не совпадали рёбрами: модель выглядела "пустой"). Вершины сортируются по кругу
// вокруг нормали — иначе они лягут в произвольном порядке и грань получится самопересекающейся
// "звездой" вместо правильного пятиугольника.
let _dodecaFaces = null;
function dodecahedronFaces(){
  if(_dodecaFaces) return _dodecaFaces;
  const icoVerts = icosahedronVertices();   // 12 вершин икосаэдра = 12 нормалей граней додекаэдра
  const icoFaces = icosahedronFaces();      // 20 граней икосаэдра = 20 вершин додекаэдра (их центроиды)
  const R_PX = 40, LOCAL_R = 55;
  _dodecaFaces = icoVerts.map(V=>{
    // ВАЖНО: берём НЕнормированные центроиды (f.centroid), не f.normal (единичный вектор) — все
    // расчёты размера/масштаба ниже (как и в icosahedronFaces) должны идти в одних и тех же "сырых"
    // координатах, иначе относительный масштаб грань/расстояние-до-центра теряется и грани
    // получаются не того размера (это и было первой попыткой чинить D12 — не сработало: сортировка
    // по единичным направлениям даёт верную ФОРМУ, но не верный МАСШТАБ).
    const pts = icoFaces.filter(f=>f.verts.some(v=>dist(v,V)<1e-6)).map(f=>f.centroid); // 5 граней, сходящихся в V
    const nDir = nrm(V);
    const u = nrm(sub(pts[0], scl(nDir, dot(pts[0], nDir))));
    const v2 = crs(nDir, u);
    const sorted = pts.slice().sort((p,q)=>{
      const pu = sub(p, scl(nDir, dot(p,nDir))), qu = sub(q, scl(nDir, dot(q,nDir)));
      return Math.atan2(dot(pu,v2), dot(pu,u)) - Math.atan2(dot(qu,v2), dot(qu,u));
    });
    const G = scl(sorted.reduce((s,p)=>add(s,p), [0,0,0]), 1/5); // центроид ЭТОЙ грани додекаэдра (сырые координаты)
    const n = nrm(G);       // тот же приём, что у icosahedronFaces: нормаль — направление СОБСТВЕННОГО центроида грани
    const A = sorted[0];
    const e2 = nrm(scl(sub(A,G), -1));
    const e1 = crs(e2, n);
    const Rface = len(sub(A,G));
    const s = (Rface * R_PX) / LOCAL_R;
    const col1 = scl(e1, s), col2 = scl(e2, s), col3 = n, col4 = scl(G, R_PX);
    const m = [col1[0],col1[1],col1[2],0, col2[0],col2[1],col2[2],0, col3[0],col3[1],col3[2],0, col4[0],col4[1],col4[2],1];
    return { normal:n, e1, matrix:'matrix3d('+m.map(x=>x.toFixed(5)).join(',')+')' };
  });
  computeTextRotations(_dodecaFaces);
  return _dodecaFaces;
}
// Матрица поворота вокруг произвольной оси на угол (радианы) — формула Родрига, вынесена отдельно от
// settleMatrixFor (ниже), чтобы её же использовать и для ФИКСИРОВАННЫХ поворотов (rotateX/rotateY) —
// см. rotationMatrixAroundBasisAxis/iconTiltMatrix у мини-иконок панели бросков кубов.
function rodriguesMatrix(axis, angleRad){
  const [x,y,zz]=axis;
  const c=Math.cos(angleRad), s=Math.sin(angleRad), C=1-c;
  return [ c+x*x*C, y*x*C+zz*s, zz*x*C-y*s, 0,
           x*y*C-zz*s, c+y*y*C, zz*y*C+x*s, 0,
           x*zz*C+y*s, y*zz*C-x*s, c+zz*zz*C, 0,
           0,0,0,1 ];
}
// Матрица поворота, доворачивающая нормаль грани в сторону зрителя (+Z).
function settleMatrixFor(normal){
  const z=[0,0,1];
  const d = normal[0]*z[0]+normal[1]*z[1]+normal[2]*z[2];
  let axis=[normal[1]*z[2]-normal[2]*z[1], normal[2]*z[0]-normal[0]*z[2], normal[0]*z[1]-normal[1]*z[0]];
  const al=Math.hypot(axis[0],axis[1],axis[2]);
  if(al<1e-9) return d>0 ? [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] : [1,0,0,0, 0,-1,0,0, 0,0,-1,0, 0,0,0,1];
  axis=[axis[0]/al,axis[1]/al,axis[2]/al];
  return rodriguesMatrix(axis, Math.acos(Math.max(-1,Math.min(1,d))));
}
// extraTiltMatrix (опционально) — довешивается ПОСЛЕ доворота результатной гранью к зрителю (matMul4
// в порядке "сперва settle, потом extraTilt", см. комментарий у matMul4 ниже). Нужен только для D20:
// у икосаэдра ровно "в лоб" на результатную грань (без доворота) силуэт — правильный симметричный
// шестиугольник, который на плоском экране читается как плоская картинка, а не объёмный гранёный шар
// (математически модель при этом верна, зазоров/перекосов нет — дело чисто в ракурсе). У куба/тетраэдра/
// додекаэдра ракурс "в лоб" — их обычный, ожидаемый вид (плоская грань куба и должна выглядеть плоской
// гранью), поэтому им extraTiltMatrix не передаётся.
function settleTransformFor(normal, extraTiltMatrix){
  let m = settleMatrixFor(normal);
  if(extraTiltMatrix) m = matMul4(extraTiltMatrix, m);
  return 'matrix3d('+m.map(v=>v.toFixed(5)).join(',')+')';
}
// Умножение двух матриц 4×4 в CSS-раскладке matrix3d (16 чисел, КОЛОНКАМИ) — C=A·B, то есть "сперва
// B, потом A" (для точки p: (A·B)*p = A*(B*p)) — тот же порядок, что и у CSS transform-списка, где
// ПРАВАЯ функция применяется первой (см. iconTiltMatrix у мини-иконок).
function matMul4(A,B){
  const C = new Array(16);
  for(let col=0; col<4; col++) for(let row=0; row<4; row++){
    let sum=0; for(let k=0;k<4;k++) sum += A[k*4+row]*B[col*4+k];
    C[col*4+row] = sum;
  }
  return C;
}
// Преобразование НАПРАВЛЕНИЯ (не точки — перенос игнорируется, w=0) через матрицу 4×4 той же раскладки.
function matVecDir3(M, v){
  return [ M[0]*v[0]+M[4]*v[1]+M[8]*v[2], M[1]*v[0]+M[5]*v[1]+M[9]*v[2], M[2]*v[0]+M[6]*v[1]+M[10]*v[2] ];
}
// Общий для D20/D4/D6/D12: грани смотрят в разные стороны, поэтому цифра на каждой из них после
// доворота к зрителю (settleMatrixFor) оказывается повёрнутой по-своему — считаем этот угол заранее
// и компенсируем его поворотом самой цифры (span внутри грани), иначе выпавшее число читается вверх
// ногами. Раньше это было инлайном только в icosahedronFaces; вынесено сюда, т.к. крупная модель
// совершившегося броска (buildRolledDieModel) теперь нумерует грани и у D4/D6/D12 тоже.
function computeTextRotations(faces){
  faces.forEach(f=>{
    const m = settleMatrixFor(f.normal);
    const vx = m[0]*f.e1[0] + m[4]*f.e1[1] + m[8]*f.e1[2];
    const vy = m[1]*f.e1[0] + m[5]*f.e1[1] + m[9]*f.e1[2];
    f.textRotation = -Math.atan2(vy, vx) * 180 / Math.PI;
  });
  return faces;
}

let _rollOverlayEl = null;
// Снимает window-обработчики протяжного жеста (pointermove/pointerup) КОНКРЕТНОГО открытого оверлея —
// каждый openRollPicker/openItemRollPicker/openCultureRollQuad/openCatalogPicker назначает сюда свою
// функцию сразу после window.addEventListener(...). Нужно отдельно от самого удаления DOM-оверлея
// ниже: закрыть оверлей можно НЕ только естественным завершением жеста (там кое-где эти же
// removeEventListener и так уже вызывались вручную), но и Esc/кликом по фону ПОКА жест ещё не
// завершился (мышь ещё зажата) — без этого поля в таком случае window-обработчики жеста утекали бы
// (продолжали слушать pointermove/pointerup уже после того, как сам оверлей исчез).
let _rollOverlayCleanup = null;
function closeRollOverlay(){
  if(_rollOverlayCleanup){ _rollOverlayCleanup(); _rollOverlayCleanup = null; }
  if(_rollOverlayEl){ _rollOverlayEl.remove(); _rollOverlayEl = null; }
  document.body.classList.remove('roll-modal-active');
  document.removeEventListener('keydown', _rollEscHandler);
}
function _rollEscHandler(e){ if(e.key==='Escape') closeRollOverlay(); }

// Создаёт и позиционирует ЧЕТЫРЕ полоски-подсказки (Помеха/Преимущество по бокам, Чистый сверху и
// снизу) у краёв поповера — общая часть для openRollPicker (основной бросок характеристики) и
// openItemRollPicker (проверка ресурса предмета, ПР(X)): оба жеста делят одну и ту же "половины/четверти
// окошка с гексами" механику, поэтому CSS/DOM-код подсказок не дублируется между ними. Чистый — ДВЕ
// зоны (сверху И снизу, не одна) с одним и тем же смыслом: раньше "чистый" был не отдельным жестом, а
// просто ОТСУТСТВИЕМ выхода влево/вправо — вернуться к нему после того, как Помеха/Преимущество уже
// вооружены, было нечем (см. setMode в вызывающем коде). Теперь это полноценная, симметричная Помехе/
// Преимуществу зона — просто с двух сторон вместо одной, чтобы такой же лёгкой в жесте была самая
// частая ситуация (обычный бросок), а не только реже нужные модификаторы.
function buildSideHints(overlay, popupRect){
  const hintLeft = document.createElement('div');
  hintLeft.className = 'roll-side-hint disadvantage'; hintLeft.textContent = 'Помеха';
  const hintRight = document.createElement('div');
  hintRight.className = 'roll-side-hint advantage'; hintRight.textContent = 'Преимущество';
  const hintTop = document.createElement('div');
  hintTop.className = 'roll-side-hint plain plain-top'; hintTop.textContent = 'Чистый';
  const hintBottom = document.createElement('div');
  hintBottom.className = 'roll-side-hint plain plain-bottom'; hintBottom.textContent = 'Чистый';
  overlay.appendChild(hintLeft); overlay.appendChild(hintRight);
  overlay.appendChild(hintTop); overlay.appendChild(hintBottom);
  const HINT_W = 34, HINT_GAP = 6;
  [hintLeft, hintRight].forEach(h=>{ h.style.top = popupRect.top+'px'; h.style.height = popupRect.height+'px'; h.style.width = HINT_W+'px'; });
  hintLeft.style.left = (popupRect.left - HINT_W - HINT_GAP)+'px';
  hintRight.style.left = (popupRect.right + HINT_GAP)+'px';
  [hintTop, hintBottom].forEach(h=>{ h.style.left = popupRect.left+'px'; h.style.width = popupRect.width+'px'; h.style.height = HINT_W+'px'; });
  hintTop.style.top = (popupRect.top - HINT_W - HINT_GAP)+'px';
  hintBottom.style.top = (popupRect.bottom + HINT_GAP)+'px';
  // По умолчанию бросок и так "Чистый" (mode начинается с 'plain' у вызывающего кода) — подсказки
  // сверху/снизу поэтому показаны АКТИВНЫМИ сразу, ещё до первого движения курсора (в отличие от
  // Помехи/Преимущества, которые нужно сперва "вооружить" жестом); дальнейшие переключения — уже
  // через setMode у вызывающего кода, как и раньше.
  hintTop.classList.add('active'); hintBottom.classList.add('active');
  return {hintLeft, hintRight, hintTop, hintBottom};
}

// Один жест: нажатие на строку уже прислало сюда клиентские координаты курсора — гексагоны рисуются
// сразу под ним («−3», второй в среднем ряду, встаёт точно на курсор — это самый частый модификатор
// по книге, так что и не двигая мышь, отпустив сразу, попадаешь в него), протягивание перебирает
// соседние. Преимущество/Помеха — ПРОМЕЖУТОЧНЫЙ пункт того же жеста: половины ВНУТРИ окошка с
// гексами (слева/справа от самого поля гексов, но в пределах поповера) — стоит на пути протягивания
// пройти через половину, соответствующий режим "вооружается" (и остаётся вооружённым, даже если
// курсор потом вернётся на гекс — сбрасывается только переходом в ПРОТИВОПОЛОЖНУЮ половину). Но
// ОТПУСКАНИЕ по-прежнему обязано случиться НА гексе — это определяет модификатор; если отпущено не
// на гексе, бросок не происходит (как и было исходно). Итог: не выходили за пределы половин — чистый
// бросок с тем модификатором, где отпустили; прошли через правую половину — Преимущество; через
// левую — Помеха (с тем же модификатором).
// anchorMod — какой гекс встаёт точно под курсор при открытии: −3 для обычного броска характеристики
// (самый частый модификатор по книге, см. ниже), но 0 для брoска, вызванного из текста способности
// (см. openAbilityRollPicker) — модификатор, упомянутый в самом тексте способности, не подставляется
// автоматически, это осознанное решение (число в тексте может быть только частью условия, не всегда
// применимо буквально), игрок сам протягивает к нужному гексу.
function openRollPicker(statKey, clientX, clientY, anchorMod=-3){
  closeRollOverlay();
  // statKey — обычно ключ character.stats (бросок характеристики), но может быть и ключом из
  // SAVE_ROLL_DEFS (спасброски от вредной среды — их Максимум считается формулой, а не ЗХ+10, см.
  // определение ниже по файлу): в этом случае Максимум и подсказки-источники берём оттуда же.
  const saveDef = SAVE_ROLL_DEFS[statKey];
  const base = saveDef ? saveDef.base() : character.stats[statKey] + 10;   // «Бросок» характеристики = ЗХ + 10 (стр. 19)
  // Список источников бонусов у обычной характеристики (character.log[statKey]) СПЕЦИАЛЬНО не выводим
  // здесь тегами, как раньше — у сильно прокачанного персонажа их набирается слишком много для этого
  // маленького поповера. Полный список теперь смотрится наведением мыши на саму характеристику в
  // блоке статов (см. showStatSourcesPopup/renderStatBlock) — отдельный, более уместный по размеру
  // поповер. У spasbrosков (saveDef) источников всегда мало (2-3 строки формулы), их как показывали
  // тегами тут же, так и продолжаем — это не та проблема, которую просили решить.
  const sourcesHtml = saveDef ? saveDef.tags().map(t=>`<span class="tag">${t}</span>`).join('') : '';

  const overlay = document.createElement('div');
  overlay.className = 'roll-overlay';

  const popup = document.createElement('div');
  popup.className = 'roll-popup';
  popup.style.visibility = 'hidden'; // placed off-screen first, repositioned once real size is known
  popup.innerHTML = `<div class="roll-tags">${sourcesHtml}</div>
    <div class="hex-field"></div>
    <div class="roll-max-preview"></div>`;
  const field = popup.querySelector('.hex-field');
  const preview = popup.querySelector('.roll-max-preview');
  let mode = 'plain'; // 'plain' | 'advantage' | 'disadvantage' — см. setMode
  const updatePreview = (mod)=>{
    const max = base + mod;
    const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
    preview.innerHTML = `Максимум <b>${max}</b> (${base}${mod>=0?'+':'−'}${Math.abs(mod)})${modeTxt}`;
  };
  let anchorHex = null;
  const buildRow = (vals)=>{
    const line = document.createElement('div');
    line.className = 'hex-line';
    vals.forEach(mod=>{
      const hex=document.createElement('div');
      hex.className='hex'+(mod===0?' zero':'');
      hex.textContent=(mod>0?'+':'')+mod;
      hex.dataset.mod=mod;
      if(mod===anchorMod) anchorHex = hex;
      line.appendChild(hex);
    });
    field.appendChild(line);
  };
  ROLL_HEX_ROWS.forEach(buildRow);
  updatePreview(anchorMod);
  // Касание: «увести палец за край окна» пальцем в режиме тапов не сделать — кнопки режима; гексы крупнее
  const touchUi = _lastPointerType==='touch';
  if(touchUi){
    popup.classList.add('touch-mode');
    const bar = document.createElement('div'); bar.className = 'roll-mode-bar';
    bar.innerHTML = '<button type="button" data-rmode="disadvantage">Помеха</button><button type="button" data-rmode="plain" class="on">Чистый</button><button type="button" data-rmode="advantage">Преимущество</button>';
    popup.appendChild(bar);
    // Наведения нет — источники бонусов характеристики (на ПК — при наведении на строку) показываем по кнопке
    if(!saveDef && character && character.log && character.log[statKey]){
      const entries = character.log[statKey];
      const src = document.createElement('div'); src.className = 'roll-src';
      src.innerHTML = `<button type="button" class="roll-src-btn">ⓘ Откуда бонусы</button><div class="stat-src-list" hidden>${entries.length
        ? entries.map(l=>`<div class="stat-src-row"><span>${escapeHtml(l.source)}</span><b>${l.delta>0?'+':''}${l.delta}</b></div>`).join('')
        : '<div class="stat-src-row stat-src-empty"><span>Только базовое значение</span></div>'}</div>`;
      src.querySelector('.roll-src-btn').addEventListener('click', ()=>{ const l = src.querySelector('.stat-src-list'); l.hidden = !l.hidden; });
      popup.appendChild(src);
    }
  }
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  _rollOverlayEl = overlay;
  document.body.classList.add('roll-modal-active'); // см. .roll-overlay/body.roll-modal-active в <style> — блокирует клики/выделение текста листа под жестом

  // Position so the −3 hex's centre lands exactly on (clientX, clientY), then clamp on-screen.
  const pr = popup.getBoundingClientRect(), hr = anchorHex.getBoundingClientRect();
  const hexCenterX = hr.left - pr.left + hr.width/2, hexCenterY = hr.top - pr.top + hr.height/2;
  let left = clientX - hexCenterX, top = clientY - hexCenterY;
  left = Math.max(6, Math.min(left, window.innerWidth - pr.width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - pr.height - 6));
  popup.style.left = left+'px'; popup.style.top = top+'px';
  popup.style.visibility = 'visible';

  // "Половины/четверти окошка с гексами" — зона Помехи/Преимущества/Чистого у самого поповера (не через
  // весь экран): фиксируется один раз, сразу после его позиционирования (поповер за весь жест не двигается).
  const popupRect = popup.getBoundingClientRect();
  const {hintLeft, hintRight, hintTop, hintBottom} = buildSideHints(overlay, popupRect);

  const hexAt=(x,y)=>{ const el=document.elementFromPoint(x,y); return el&&el.classList&&el.classList.contains('hex')?el:null; };
  const setHovered=(hex)=>{
    const prev = field.querySelector('.hex.hovered');
    if(prev===hex) return; // тот же гекс, что и на прошлом mousemove — не перезапускать отблеск на каждый пиксель
    field.querySelectorAll('.hex.hovered').forEach(h=>h.classList.remove('hovered'));
    if(hex){
      hex.classList.add('hovered'); updatePreview(parseInt(hex.dataset.mod,10));
      // Металлический отблеск (см. .hex::after/.hex-shine в <style>) — на КАЖДЫЙ новый гекс под
      // курсором, включая самый первый (вызов ниже, сразу после объявления setHovered, ДО первого
      // pointermove) — то есть срабатывает и при "появлении" гексов под курсором, и при наведении на
      // соседние, тем же единым путём.
      hex.classList.remove('hex-shine'); void hex.offsetWidth; hex.classList.add('hex-shine');
      hex.addEventListener('animationend', ()=>hex.classList.remove('hex-shine'), {once:true});
    }
  };
  setHovered(hexAt(clientX, clientY) || anchorHex); // the pointer is already down — start on whatever it's over now

  // Режим "вооружается" переходом за край окошка (левый/правый — Помеха/Преимущество, верхний/
  // нижний — явный возврат к Чистому) и остаётся таким, пока не пересечена зона с ДРУГИМ режимом —
  // возврат на гекс (или в промежуток между гексами и краем окошка) его НЕ сбрасывает: это и есть
  // "промежуточный пункт" жеста, а не мгновенное состояние под курсором. Раньше "Чистый" не был такой
  // зоной вообще — это было просто отсутствие выхода влево/вправо, и вернуться к нему после того, как
  // Помеха/Преимущество уже вооружены, было нечем в рамках одного жеста.
  const setMode = (m)=>{
    if(mode===m) return;
    mode = m;
    hintLeft.classList.toggle('active', m==='disadvantage');
    hintRight.classList.toggle('active', m==='advantage');
    hintTop.classList.toggle('active', m==='plain');
    hintBottom.classList.toggle('active', m==='plain');
    const curHex = field.querySelector('.hex.hovered') || anchorHex;
    updatePreview(parseInt(curHex.dataset.mod,10));
  };
  const modeBar = popup.querySelector('.roll-mode-bar');
  if(modeBar) modeBar.addEventListener('click', (e)=>{ const b = e.target.closest('[data-rmode]'); if(!b) return;
    setMode(b.dataset.rmode); modeBar.querySelectorAll('[data-rmode]').forEach(x=>x.classList.toggle('on', x===b)); });
  let moved = false;
  const onMove=(e)=>{
    if(Math.hypot(e.clientX - clientX, e.clientY - clientY) > 8) moved = true;
    const hex = hexAt(e.clientX, e.clientY);
    if(hex) setHovered(hex);
    if(touchUi) return; // на касаниях режим — кнопками (палец, уходящий за край, ещё и прокрутил бы страницу)
    if(e.clientX < popupRect.left) setMode('disadvantage');
    else if(e.clientX > popupRect.right) setMode('advantage');
    else if(e.clientY < popupRect.top || e.clientY > popupRect.bottom) setMode('plain');
  };
  // Раньше отпускание не на гексе сразу отменяло весь жест ("отпущено не на гексе — бросок не
  // засчитывается", см. прежний комментарий) — малейший промах при протягивании заставлял начинать
  // заново целиком. Теперь первый такой промах не закрывает поповер, а переводит его в clickMode: те
  // же onMove/onUp остаются подписаны (гексы по-прежнему подсвечиваются под курсором и подсказки
  // Помехи/Преимущества/Чистого по-прежнему переключаются от положения курсора), а onUp просто ждёт
  // СЛЕДУЮЩЕГО pointerup — по гексу сработает как обычно, повторный промах мимо гекса больше ничего не
  // отменяет. Выйти можно как обычно — кликом по фону (pointerdown на overlay ниже) или Esc.
  let clickMode = false;
  const onUp=(e)=>{
    // Вооружённые Преимущество/Помеха лишь добавляются к модификатору того гекса, где произошло
    // отпускание, а не заменяют выбор точки отпускания сами по себе.
    const hex = hexAt(e.clientX, e.clientY);
    // Касание: короткий тап открывает гексы, бросок — вторым тапом (иначе тап сразу бросал бы с гексом под пальцем)
    if(touchUi && !moved && !clickMode){ clickMode = true; return; }
    if(hex){
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      _rollOverlayCleanup = null; // уже сняли выше вручную — закрытию оверлея позже нечего будет чистить второй раз
      popup.querySelectorAll('.roll-mode-bar, .roll-src').forEach(x=>x.remove()); // в окне результата — только итог
      executeRoll(statKey, base, parseInt(hex.dataset.mod,10), popup, mode);
    } else if(!clickMode){
      clickMode = true;
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  _rollOverlayCleanup = ()=>{ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  overlay.addEventListener('pointerdown',(e)=>{ if(e.target===overlay) closeRollOverlay(); });
  document.addEventListener('keydown', _rollEscHandler);
}

