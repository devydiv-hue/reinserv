/* ======================================================================
   Объёмная (CSS 3D) фигура персонажа с надетой бронёй + idle-анимация по состояниям.
   Техника — классический приём "CSS-кубик": каждая часть тела/брони это .b3d (коробка WxHxD),
   у неё 4 видимых грани (перёд/верх/право/лево — зад и низ никогда не видны под нашим фиксированным
   ракурсом 3/4, не рендерим их совсем ради простоты). Суставы (плечи/локти/шея) — вложенные друг в
   друга пустые .p3d-узлы с preserve-3d: поворот узла поворачивает всё, что внутри него, как настоящий
   сустав — благодаря НАСТОЯЩЕЙ вложенности в DOM, а не отдельным независимым позициям. Один и тот же
   .p3d используется и для суставов, и как обёртка самих .b3d — оба просто "точка в родительском 3D-
   пространстве, которую можно сдвинуть/повернуть", разница только в наличии граней-детей.
   Цветовой дифференциации зон специально НЕТ (как просили) — только два тона: голое тело/одежда
   (--fig-skin) и броня (--fig-armor), плюс тёмный для мелких деталей (--fig-armor-dk). Понятно, что
   защищено, а что нет, по силуэту/объёму, а не по цвету — это читается и во время анимации.
   ====================================================================== */
function b3d(w,h,d,x,y,z,tone,extraClass,rotZ){
  const toneVar = tone ? `--tone:${tone};` : '';
  const rot = rotZ ? ` rotateZ(${rotZ}deg)` : '';
  return `<div class="p3d b3d ${extraClass||''}" style="--w:${w}px;--h:${h}px;--d:${d}px;${toneVar}transform:translate3d(${x}px,${y}px,${z}px)${rot};">
    <div class="b3d-f f-front"></div><div class="b3d-f f-top"></div><div class="b3d-f f-right"></div><div class="b3d-f f-left"></div>
  </div>`;
}
// Мелкие "линзы" противогаза — просто круглые плоские нашлёпки (border-radius через extraClass
// figeye), а не отдельная 3D-геометрия: на ростовой иконке этого достаточно, чтобы читалось как
// очки-фильтры, а не как ещё один прямоугольник.
function figEye(x,y,z){
  return `<div class="p3d figeye" style="--w:6px;--h:6px;transform:translate3d(${x}px,${y}px,${z}px);"></div>`;
}
// Древко флага/палки-посоха — просто длинный тонкий b3d, банер флага — плоская акцентная пластина у
// верхнего конца. Обе "реквизитные" детали приделаны прямо к правой кисти (внутри elbow-pivot[r]) и
// присутствуют в разметке ТОЛЬКО у своего настроения (см. вызов ниже) — жест руки для этого настроения
// уже сам несёт их из опущенного положения в конечное ("воткнуть флаг"/"опереться на посох"), отдельной
// анимации появления/исчезновения не нужно.
function flagPropHtml(){
  return `<div class="p3d flag-prop">
    ${b3d(3,64,3, 0,22,0, 'var(--fig-leather)')}
    ${b3d(20,15,2, 8,-16,0, 'var(--fig-accent)', 'flag-banner')}
  </div>`;
}
function staffPropHtml(){
  return `<div class="p3d staff-prop">
    ${b3d(3,78,3, 0,30,0, 'var(--fig-leather)')}
  </div>`;
}
function buildBodyFigureHtml(activeZones, hasSiz, mood){
  const has = z=>activeZones.has(z);
  // Рука целиком: плечевой сустав (несёт жест-анимацию по настроению, см. CSS .mood-*) → плечо
  // (широкий слоистый наплечник — по референсу игрока "Ландскнехт": основная пластина + нижняя
  // свисающая пластина внахлёст + вынесенное боковое "крыло" с акцентной полосой + клёпка) →
  // локтевой сустав (тоже может нести свою жест-анимацию в паре с плечевым) → слитые предплечье+кисть,
  // наруч и перчатка — раздельные накладки с манжетой-стыком и костяшкой. Слитые сегменты руки в
  // целом (кисть+предплечье одной деталью) — сознательное упрощение: отдельная кисть с гнущимися
  // пальцами не нужна для ростовой иконки, даже при отходе от минимализма в остальном.
  const rukiOn = has('ruki');
  // Каждый именованный сустав (torso-pivot/head-pivot/shoulder-pivot/elbow-pivot/hip-pivot/knee-pivot)
  // НЕ несёт свой собственный смещающий translate3d инлайном — этим занимается обёртка-родитель (.p3d
  // без имени), а сам именованный узел содержит ТОЛЬКО поворот (статичная поза или анимация по
  // настроению, см. CSS .mood-*/@keyframes). Иначе инлайновый transform: translate3d(...) перебивал бы
  // CSS-правило поворота по специфичности — оно бы просто никогда не применялось.
  const armWithGuards = (sideSign)=>{
    const sx = sideSign;
    const isRight = sx>0;
    return `
    <div class="p3d shoulder-pivot" data-side="${sx<0?'l':'r'}">
      ${b3d(13,30,13, 0,15,0, null)}
      ${has('plechi') ? b3d(25,19,23, 0,0,1, 'var(--fig-armor)') : ''}
      ${has('plechi') ? b3d(20,12,21, 0,12,3, 'var(--fig-armor)') : ''}
      ${has('plechi') ? b3d(9,15,9, sx*15,10,4, 'var(--fig-armor-dk)', null, sx*14) : ''}
      ${has('plechi') ? b3d(2,17,3, sx*17,9,9, 'var(--fig-accent)', null, sx*14) : ''}
      ${has('plechi') ? b3d(12,6,12, 0,-8,0, 'var(--fig-armor-dk)') : ''}
      ${has('plechi') ? b3d(16,4,4, 0,4,11, 'var(--fig-leather)') : ''}
      <div class="p3d" style="transform:translate3d(0px,30px,0px);">
        <div class="p3d elbow-pivot" data-side="${sx<0?'l':'r'}">
          ${b3d(12,28,12, 0,14,0, null)}
          ${rukiOn ? b3d(13,18,13, 0,9,0, 'var(--fig-armor)') : ''}
          ${rukiOn ? b3d(15,3,15, 0,16,0, 'var(--fig-leather)') : ''}
          ${rukiOn ? b3d(14,11,14, 0,23,0, 'var(--fig-armor-dk)') : ''}
          ${rukiOn ? b3d(9,3,4, 0,20,8, 'var(--fig-armor-dk)') : ''}
          ${b3d(4,8,4, sx*-4,26,4, 'var(--fig-skin)')}
          ${(isRight && mood==='confident') ? flagPropHtml() : ''}
          ${(isRight && mood==='tired') ? staffPropHtml() : ''}
        </div>
      </div>
    </div>`;
  };
  // Нога: бедро (тазобедренный сустав hip-pivot — несёт анимацию "пары шагов" у истощения, см. CSS)
  // → бедренная пластина + ремень-стяжка → коленный сустав knee-pivot (мелкий встречный поворот при
  // шаге, как у настоящей ноги) → наколенник + поножа на голени + отдельный сабатон на стопе.
  // Настоящий сустав вместо одной сплошной "колонны", как раньше, — и для будущей ходьбы, и просто
  // потому что латные поножи по референсу явно сочленены (см. подпись "крепится на ремнях").
  const legHtml = (sideSign)=>{
    const sx = sideSign;
    return `<div class="p3d" style="transform:translate3d(${sx*9}px,11px,0);">
      <div class="p3d hip-pivot" data-side="${sx<0?'l':'r'}">
        ${b3d(15,40,15, 0,20,0, null)}
        ${has('nogi') ? b3d(17,36,17, 0,19,0, 'var(--fig-armor)') : ''}
        ${has('nogi') ? b3d(19,4,19, 0,4,0, 'var(--fig-leather)') : ''}
        <div class="p3d" style="transform:translate3d(0px,40px,0px);">
          <div class="p3d knee-pivot" data-side="${sx<0?'l':'r'}">
            ${b3d(14,44,14, 0,22,0, null)}
            ${has('nogi') ? b3d(11,9,11, 0,1,5, 'var(--fig-armor-dk)') : ''}
            ${has('nogi') ? b3d(16,34,16, 0,22,0, 'var(--fig-armor)') : ''}
            ${has('nogi') ? b3d(17,13,21, 0,39,3, 'var(--fig-armor-dk)') : ''}
          </div>
        </div>
      </div>
    </div>`;
  };
  // Бёдра — в духе пост-апокалиптического самурая: веерная "юбка" из свисающих пластин (кусадзури),
  // разведённых по дуге, чередующихся по тону, плюс поясной ремень с пряжкой. Специально НЕ прячем
  // юбку за ноги ни в одной позе (см. ограничение "минимум 50% видимости" — дуга плат широкая, ноги
  // стоят у́же дуги, поэтому даже при сведении/разведении ног в шаге юбка их всегда перекрывает
  // спереди, а не наоборот).
  const hipSkirtHtml = ()=>{
    const plates = [-20,-11,-2,7,16];
    return plates.map((x,i)=>b3d(10,18,8, x,15,3+Math.abs(x)*0.15, i%2? 'var(--fig-armor-dk)':'var(--fig-armor)', 'hip-plate', x*0.55)).join('')
      + b3d(44,5,12, 0,2,9, 'var(--fig-leather)')
      + b3d(6,6,4, 0,2,13, 'var(--fig-accent)');
  };
  return `
    <div class="rig-tilt">
      <div class="p3d rig-bob">
        <div class="p3d pelvis-pivot">
          ${b3d(36,22,22, 0,0,0, null)}
          ${has('bedra') ? hipSkirtHtml() : ''}
          <div class="p3d" style="transform:translate3d(0px,-40px,0px);">
            <div class="p3d torso-pivot">
              ${b3d(42,56,24, 0,0,0, null)}
              ${has('tors') ? b3d(44,40,18, 0,6,5, 'var(--fig-armor)') : ''}
              ${has('tors') ? b3d(6,34,20, 0,6,7, 'var(--fig-armor-dk)') : ''}
              ${has('tors') ? b3d(30,7,19, 0,-16,4, 'var(--fig-leather)') : ''}
              ${has('tors') ? b3d(3,3,3, -13,-4,15, 'var(--fig-armor-dk)') : ''}
              ${has('tors') ? b3d(3,3,3, 13,-4,15, 'var(--fig-armor-dk)') : ''}
              ${has('tors') ? b3d(3,3,3, -13,14,15, 'var(--fig-armor-dk)') : ''}
              ${has('tors') ? b3d(3,3,3, 13,14,15, 'var(--fig-armor-dk)') : ''}
              ${has('tors') ? b3d(38,5,19, 0,24,6, 'var(--fig-leather)') : ''}
              ${has('tors') ? b3d(3,20,3, -10,-14,17, 'var(--fig-leather)', null, -8) : ''}
              ${has('tors') ? b3d(3,20,3, 10,-14,17, 'var(--fig-leather)', null, 8) : ''}
              <div class="p3d" style="transform:translate3d(0px,-47px,0px);">
                <div class="p3d head-pivot">
                  ${b3d(28,28,26, 0,0,0, 'var(--fig-skin)')}
                  ${has('golova') ? b3d(32,17,30, 0,-9,0, 'var(--fig-armor)', 'helmet-dome') : ''}
                  ${has('golova') ? b3d(37,4,35, 0,0,0, 'var(--fig-armor)', 'helmet-brim') : ''}
                  ${has('golova') ? b3d(4,4,4, 17,-8,4, 'var(--fig-armor-dk)') : ''}
                  ${has('golova') ? b3d(4,4,4, -17,-8,4, 'var(--fig-armor-dk)') : ''}
                  ${has('golova') ? b3d(18,3,5, 0,11,13, 'var(--fig-leather)') : ''}
                  ${has('golova') ? b3d(3,10,3, 15,-14,2, 'var(--fig-armor-dk)', null, -20) : ''}
                  ${(has('golova') && hasSiz) ? b3d(17,15,7, 0,5,12, 'var(--fig-armor-dk)') : ''}
                  ${(has('golova') && hasSiz) ? figEye(-5,2,15) : ''}
                  ${(has('golova') && hasSiz) ? figEye(5,2,15) : ''}
                  ${(has('golova') && hasSiz) ? b3d(6,9,6, 0,9,10, 'var(--fig-armor-dk)', 'figfilter') : ''}
                  ${(has('golova') && hasSiz) ? b3d(13,3,3, 0,7,13, 'var(--fig-leather)') : ''}
                </div>
              </div>
              <div class="p3d" style="transform:translate3d(-34px,-20px,0);">${armWithGuards(-1)}</div>
              <div class="p3d" style="transform:translate3d(34px,-20px,0);">${armWithGuards(1)}</div>
            </div>
          </div>
          ${legHtml(-1)}
          ${legHtml(1)}
        </div>
      </div>
    </div>`;
}
/* ======================================================================
   WEBGL (Three.js) ФИГУРА — попытка приблизиться к фотореализму поверх ТОЙ ЖЕ схемы суставов и тех же
   чисел, что и у CSS-3D фигуры выше (buildBodyFigureHtml) — просто отрендеренной настоящим движком со
   светом/тенями/материалами вместо плоских граней CSS. Если интернета нет и Three.js с CDN не
   загрузился — THREE_STATE остаётся 'failed' навсегда, и renderArmorZones() просто продолжает рисовать
   прежнюю CSS-3D фигуру безо всякого WebGL (см. ветку `if(THREE_STATE==='ready')` там).
   Перенос координат: у CSS ось Y направлена вниз (как везде в DOM), у Three.js — вверх; вместо того
   чтобы вручную считать матрицы поворота на бумаге (легко ошибиться в знаке), числа перенесены "как
   есть", а корректность знаков (инверсия Y и, вместе с ней, X/Z-поворотов) проверена численно прямо в
   браузере — так же, как раньше для CSS-версии проверялись через getBoundingClientRect, только здесь
   через projection mesh.getWorldPosition()→camera.project() в экранные координаты (см. README).
   ====================================================================== */
let THREE_STATE = 'pending'; // 'pending' | 'ready' | 'failed'
const THREE_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
function loadThreeJs(){
  if(THREE_STATE !== 'pending') return;
  const s = document.createElement('script');
  s.src = THREE_CDN_URL;
  s.onload = function(){
    THREE_STATE = (typeof THREE !== 'undefined') ? 'ready' : 'failed';
    if(typeof renderArmorZones==='function') renderArmorZones();
  };
  s.onerror = function(){ THREE_STATE = 'failed'; };
  document.head.appendChild(s);
}
// Запускаем загрузку сразу же (не дожидаясь, пока понадобится объёмная фигура) — к моменту генерации
// персонажа/надевания брони библиотека уже (скорее всего) будет готова. Важно вызывать ПОСЛЕ
// объявления THREE_STATE выше по файлу (let в temporal dead zone до своей строки — в отличие от
// function-объявлений, let не поднимается целиком, только имя; вызов раньше строки объявления бросает
// ReferenceError, а не тихо работает).
// loadThreeJs(); — 3D-фигура брони убрана: зоны показываются текстом (см. renderArmorZones)
// Базовые тона — теперь только для генерации текстур (см. fig3NoiseTexture) и как основа материала.
// FIG3_COLORS ниже — не сами цвета, а КЛЮЧИ в кэш материалов (fig3Material): у всех вызовов
// fig3Box/fig3Cyl/fig3Sphere по всему ригу сигнатура не изменилась (как и раньше, передают
// FIG3_COLORS.armor и т.п.), просто теперь это возвращает готовый материал с процедурной текстурой
// потёртостей, а не голый цвет — переделывать сами вызовы по всему ригу не пришлось.
const FIG3_TONE_HEX = { skin:0xc9ae86, armor:0x7c5a34, armorDk:0x4a3420, leather:0x2b2016, accent:0x9c2f1c };
const FIG3_COLORS = { skin:'skin', armor:'armor', armorDk:'armorDk', leather:'leather', accent:'accent' };
const FIG3_DEG = Math.PI/180;
// Оценка 1D-анимации по ключевым точкам [[процент, значение], ...] — то же самое, что CSS @keyframes,
// но интерполируется вручную в JS каждый кадр. loop=true — как CSS `infinite` (зацикливается по
// модулю длительности), loop=false — как `animation-iteration-count:1 forwards` (после конца держит
// последнее значение вечно, а не откатывается к нулю).
function fig3Eval(stops, tSec, durationSec, loop){
  let pct;
  if(loop){ pct = ((tSec % durationSec) / durationSec) * 100; }
  else { pct = Math.min(Math.max(tSec,0), durationSec) / durationSec * 100; }
  for(let i=0;i<stops.length-1;i++){
    const p0=stops[i][0], v0=stops[i][1], p1=stops[i+1][0], v1=stops[i+1][1];
    if(pct>=p0-1e-6 && pct<=p1+1e-6){
      const lt = (p1===p0) ? 0 : (pct-p0)/(p1-p0);
      return v0 + (v1-v0)*lt;
    }
  }
  return stops[stops.length-1][1];
}
// Процедурная текстура потёртостей/ржавчины/грязи — вместо внешней картинки просто рисуем мелкий
// спекл-шум (россыпь пятен чуть темнее/светлее базового тона) на offscreen-канвасе 2D и заворачиваем
// в CanvasTexture. Одна текстура на ТОН (не на меш — деталей десятки, отдельная текстура на каждую не
// нужна, узор одинаковый и тайлится через RepeatWrapping), кэшируется в fig3Material ниже.
function fig3NoiseTexture(hex){
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(hex);
  ctx.fillStyle = '#'+base.getHexString();
  ctx.fillRect(0,0,size,size);
  for(let i=0;i<700;i++){
    const shade = (Math.random()-0.5)*0.55;
    const c = base.clone().offsetHSL(0,0,shade);
    ctx.fillStyle = `rgba(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0},${0.3+Math.random()*0.45})`;
    const r = Math.random()*1.6+0.3;
    ctx.beginPath(); ctx.arc(Math.random()*size, Math.random()*size, r, 0, Math.PI*2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3,3);
  if('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  return tex;
}
const _fig3TexCache = {}, _fig3MatCache = {};
function fig3Material(toneKey){
  const key = toneKey || 'skin';
  if(_fig3MatCache[key]) return _fig3MatCache[key];
  const hex = FIG3_TONE_HEX[key]!=null ? FIG3_TONE_HEX[key] : FIG3_TONE_HEX.skin;
  if(!_fig3TexCache[key]) _fig3TexCache[key] = fig3NoiseTexture(hex);
  const mat = new THREE.MeshStandardMaterial({
    map: _fig3TexCache[key], roughness:0.8,
    metalness: key==='leather' ? 0.05 : (key==='skin' ? 0.12 : 0.32)
  });
  _fig3MatCache[key] = mat;
  return mat;
}
function fig3Box(parent, w,h,d, x,y,z, toneKey, rotZdeg){
  const geo = new THREE.BoxGeometry(w,h,d);
  const mesh = new THREE.Mesh(geo, fig3Material(toneKey));
  mesh.position.set(x, -y, z); // инверсия Y — см. общий комментарий у блока
  if(rotZdeg) mesh.rotation.z = -rotZdeg*FIG3_DEG;
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
// Цилиндр — для округлых частей (конечности, купол-обод шлема, ствол противогаза), вместо прямоугольных
// коробок: сильно ближе к реальному силуэту тела/снаряжения, чем "сосиски"-кубики из прошлой версии.
// rotXdeg кладёт цилиндр "набок" (например, чтобы ствол противогаза смотрел вперёд, а не вверх) — это
// поворот самой геометрии формы, а не перенесённое CSS-значение, поэтому знак НЕ инвертируется, в
// отличие от rotZdeg (см. общий комментарий про перенос осей у блока WEBGL ФИГУРА).
function fig3Cyl(parent, rTop, rBot, h, x,y,z, toneKey, rotXdeg, rotZdeg){
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, 14);
  const mesh = new THREE.Mesh(geo, fig3Material(toneKey));
  mesh.position.set(x,-y,z);
  if(rotXdeg) mesh.rotation.x = rotXdeg*FIG3_DEG;
  if(rotZdeg) mesh.rotation.z = -rotZdeg*FIG3_DEG;
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
// Сфера — голова, купол шлема, мелкие сглаживающие "шарниры" в местах стыка конечностей (см. вызовы
// ниже), чтобы переходы между сегментами руки/ноги читались как единая округлая форма, а не как
// торчащие друг из друга кубики.
function fig3Sphere(parent, r, x,y,z, toneKey){
  const geo = new THREE.SphereGeometry(r, 14, 10);
  const mesh = new THREE.Mesh(geo, fig3Material(toneKey));
  mesh.position.set(x,-y,z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function fig3Group(parent, x,y,z){
  const g = new THREE.Group();
  g.position.set(x, -y, z);
  parent.add(g);
  return g;
}
function fig3Eye(parent, x,y,z){
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(3,3,2,12), fig3Material('armorDk'));
  mesh.position.set(x,-y,z);
  mesh.rotation.x = Math.PI/2;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function fig3FlagProp(parent){
  fig3Box(parent, 3,64,3, 0,22,0, FIG3_COLORS.leather);
  fig3Box(parent, 20,15,2, 8,-16,0, FIG3_COLORS.accent);
}
function fig3StaffProp(parent){
  fig3Box(parent, 3,78,3, 0,30,0, FIG3_COLORS.leather);
}
// Строит ВЕСЬ риг заново (та же геометрия/числа, что у buildBodyFigureHtml — см. подробные комментарии
// там) и запоминает узлы-суставы, которые двигает анимация (fig3.joints), плюс сбрасывает таймер
// настроения, чтобы новый набор поз/жестов начал доигрывать сначала.
function fig3RebuildRig(activeZones, hasSiz, mood){
  const f = fig3EnsureScene();
  f.rigBob.clear();
  f.rigBob.position.set(0,0,0); // сброс "покачивания" от ПРЕДЫДУЩЕГО настроения — иначе при переключении
  // с confident (единственное, что двигает rigBob.position.y) на другое настроение фигура осталась бы
  // сдвинутой на последнее значение покачивания навсегда, т.к. остальные ветки fig3ApplyMood это поле не трогают
  const has = z=>activeZones.has(z);
  const rukiOn = has('ruki');
  const joints = {};
  const pelvis = fig3Group(f.rigBob, 0,0,0);
  fig3Box(pelvis, 30,20,20, 0,0,0, FIG3_COLORS.skin); // уже, чем раньше (было 36×22) — более "героическая" талия под широкими плечами/наплечниками
  if(has('bedra')){
    const plates = [-20,-11,-2,7,16];
    plates.forEach((x,i)=>fig3Box(pelvis, 10,18,8, x,15,3+Math.abs(x)*0.15, i%2?FIG3_COLORS.armorDk:FIG3_COLORS.armor, x*0.55));
    fig3Box(pelvis, 44,5,12, 0,2,9, FIG3_COLORS.leather);
    fig3Box(pelvis, 6,6,4, 0,2,13, FIG3_COLORS.accent);
  }
  const torsoWrap = fig3Group(pelvis, 0,-40,0);
  const torso = fig3Group(torsoWrap, 0,0,0);
  joints.torso = torso;
  fig3Box(torso, 42,56,24, 0,0,0, FIG3_COLORS.skin);
  if(has('tors')){
    fig3Box(torso, 44,40,18, 0,6,5, FIG3_COLORS.armor);
    fig3Box(torso, 6,34,20, 0,6,7, FIG3_COLORS.armorDk);
    fig3Box(torso, 30,7,19, 0,-16,4, FIG3_COLORS.leather);
    fig3Box(torso, 3,3,3, -13,-4,15, FIG3_COLORS.armorDk);
    fig3Box(torso, 3,3,3, 13,-4,15, FIG3_COLORS.armorDk);
    fig3Box(torso, 3,3,3, -13,14,15, FIG3_COLORS.armorDk);
    fig3Box(torso, 3,3,3, 13,14,15, FIG3_COLORS.armorDk);
    fig3Box(torso, 38,5,19, 0,24,6, FIG3_COLORS.leather);
    fig3Box(torso, 3,20,3, -10,-14,17, FIG3_COLORS.leather, -8);
    fig3Box(torso, 3,20,3, 10,-14,17, FIG3_COLORS.leather, 8);
  }
  const headWrap = fig3Group(torso, 0,-47,0);
  const head = fig3Group(headWrap, 0,0,0);
  joints.head = head;
  // Голова — сфера вместо кубика (было fig3Box(28,28,26)) — сразу перестаёт быть "коробкой на шее".
  // Купол шлема — тоже сфера (побольше, сидит поверх головы), обод — плоский цилиндр вместо
  // прямоугольного козырька, ствол противогаза — цилиндр "набок" (rotXdeg=90, смотрит вперёд по Z),
  // а не короб — вместе это самый заметный сдвиг в сторону референса из всех округлых замен.
  fig3Sphere(head, 15, 0,0,0, FIG3_COLORS.skin);
  if(has('golova')){
    fig3Sphere(head, 17, 0,-9,0, FIG3_COLORS.armor);
    fig3Cyl(head, 19,19,4, 0,0,0, FIG3_COLORS.armor);
    fig3Box(head, 4,4,4, 17,-8,4, FIG3_COLORS.armorDk);
    fig3Box(head, 4,4,4, -17,-8,4, FIG3_COLORS.armorDk);
    fig3Box(head, 18,3,5, 0,11,13, FIG3_COLORS.leather);
    fig3Box(head, 3,10,3, 15,-14,2, FIG3_COLORS.armorDk, -20);
    if(hasSiz){
      fig3Cyl(head, 8,8,10, 0,5,12, FIG3_COLORS.armorDk, 90);
      fig3Eye(head, -5,2,15); fig3Eye(head, 5,2,15);
      fig3Cyl(head, 3,3,9, 0,9,11, FIG3_COLORS.armorDk, 90);
      fig3Box(head, 13,3,3, 0,7,13, FIG3_COLORS.leather);
    }
  }
  const armWithGuards = (sideSign)=>{
    const sx = sideSign, isRight = sx>0, side = sx<0?'l':'r';
    const shoulderWrap = fig3Group(torso, sx*36, -20, 0); // чуть шире, чем раньше (было 34) — плечи заметнее талии
    const shoulder = fig3Group(shoulderWrap, 0,0,0);
    joints['shoulder'+side] = shoulder;
    fig3Sphere(shoulder, 7, 0,0,0, FIG3_COLORS.skin); // сглаживающий "шарнир" в месте стыка с плечом
    fig3Cyl(shoulder, 6,6.5,30, 0,15,0, FIG3_COLORS.skin); // цилиндр вместо кубика — плечо/бицепс
    if(has('plechi')){
      fig3Box(shoulder, 25,19,23, 0,0,1, FIG3_COLORS.armor);
      fig3Box(shoulder, 20,12,21, 0,12,3, FIG3_COLORS.armor);
      fig3Box(shoulder, 9,15,9, sx*15,10,4, FIG3_COLORS.armorDk, sx*14);
      fig3Box(shoulder, 2,17,3, sx*17,9,9, FIG3_COLORS.accent, sx*14);
      fig3Box(shoulder, 12,6,12, 0,-8,0, FIG3_COLORS.armorDk);
      fig3Box(shoulder, 16,4,4, 0,4,11, FIG3_COLORS.leather);
    }
    const elbowWrap = fig3Group(shoulder, 0,30,0);
    const elbow = fig3Group(elbowWrap, 0,0,0);
    joints['elbow'+side] = elbow;
    fig3Sphere(elbow, 6, 0,0,0, FIG3_COLORS.skin);
    fig3Cyl(elbow, 5.5,6,28, 0,14,0, FIG3_COLORS.skin);
    if(rukiOn){
      fig3Box(elbow, 13,18,13, 0,9,0, FIG3_COLORS.armor);
      fig3Box(elbow, 15,3,15, 0,16,0, FIG3_COLORS.leather);
      fig3Box(elbow, 14,11,14, 0,23,0, FIG3_COLORS.armorDk);
      fig3Box(elbow, 9,3,4, 0,20,8, FIG3_COLORS.armorDk);
    }
    fig3Box(elbow, 4,8,4, sx*-4,26,4, FIG3_COLORS.skin);
    if(isRight && mood==='confident') fig3FlagProp(elbow);
    if(isRight && mood==='tired') fig3StaffProp(elbow);
  };
  armWithGuards(-1);
  armWithGuards(1);
  const legHtml = (sideSign)=>{
    const sx = sideSign, side = sx<0?'l':'r';
    const legWrap = fig3Group(pelvis, sx*7.5, 11, 0); // уже, чем раньше (было 9) — под сузившийся таз
    const hip = fig3Group(legWrap, 0,0,0);
    joints['hip'+side] = hip;
    fig3Sphere(hip, 7.5, 0,0,0, FIG3_COLORS.skin);
    fig3Cyl(hip, 7,7.5,40, 0,20,0, FIG3_COLORS.skin);
    if(has('nogi')){
      fig3Box(hip, 17,36,17, 0,19,0, FIG3_COLORS.armor);
      fig3Box(hip, 19,4,19, 0,4,0, FIG3_COLORS.leather);
    }
    const kneeWrap = fig3Group(hip, 0,40,0);
    const knee = fig3Group(kneeWrap, 0,0,0);
    joints['knee'+side] = knee;
    fig3Sphere(knee, 6.5, 0,0,0, FIG3_COLORS.skin);
    fig3Cyl(knee, 6,6.5,44, 0,22,0, FIG3_COLORS.skin);
    if(has('nogi')){
      fig3Box(knee, 11,9,11, 0,1,5, FIG3_COLORS.armorDk);
      fig3Box(knee, 16,34,16, 0,22,0, FIG3_COLORS.armor);
      fig3Box(knee, 17,13,21, 0,39,3, FIG3_COLORS.armorDk);
    }
  };
  legHtml(-1);
  legHtml(1);
  f.joints = joints;
  f.mood = mood;
  f.moodStart = performance.now()/1000;
}
function fig3EnsureScene(){
  if(fig3) return fig3;
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.shadowMap.enabled = true;
  if(THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if('toneMapping' in renderer && THREE.ACESFilmicToneMapping){ renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; }
  if('outputColorSpace' in renderer && THREE.SRGBColorSpace){ renderer.outputColorSpace = THREE.SRGBColorSpace; }
  else if('outputEncoding' in renderer && THREE.sRGBEncoding){ renderer.outputEncoding = THREE.sRGBEncoding; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
  camera.position.set(0, 40, 270); // временные значения — fig3FrameCamera переставит сразу после первой сборки рига
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0x554e42, 0.65));
  const key = new THREE.DirectionalLight(0xfff2da, 1.35);
  key.position.set(90,180,150);
  key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  key.shadow.camera.near = 50; key.shadow.camera.far = 500;
  key.shadow.camera.left = -120; key.shadow.camera.right = 120;
  key.shadow.camera.top = 160; key.shadow.camera.bottom = -160;
  key.shadow.bias = -0.002;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb3d9, 0.55);
  rim.position.set(-130,90,-150);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400,400), new THREE.ShadowMaterial({ opacity:0.3 }));
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);
  // rigTilt стоит в мировом начале координат (0,0,0), БЕЗ ручного вертикального сдвига — раньше тут
  // было захардкожено position.set(0,95,0), подобранное на глаз, из-за чего голова/поднятая рука с
  // флагом обрезались сверху камерой ("модель стоит слишком высоко"). Теперь вместо ручного сдвига
  // рига камера САМА кадрируется под фактический размер фигуры после каждой пересборки (см.
  // fig3FrameCamera) — при любых будущих изменениях геометрии (новый реквизит, другие пропорции)
  // ничего вручную подгонять не придётся.
  const rigTilt = new THREE.Group();
  rigTilt.rotation.set(6*FIG3_DEG, 20*FIG3_DEG, 0);
  scene.add(rigTilt);
  const rigBob = new THREE.Group();
  rigTilt.add(rigBob);
  fig3 = { renderer, scene, camera, canvas:renderer.domElement, rigTilt, rigBob, ground, joints:{}, mood:null, moodStart:0 };
  requestAnimationFrame(fig3Tick);
  return fig3;
}
// Пересчитывает размер canvas/аспект камеры под текущий CSS-размер контейнера — используется и на
// каждом кадре (fig3Tick, дёшево — реальный resize вызывается, только если размер правда изменился),
// и один раз сразу после того, как канвас впервые вставлен в DOM (см. renderArmorZones) — там нужно
// получить актуальный aspect ДО первого вызова fig3FrameCamera, иначе кадрирование посчитается по
// умолчальному aspect=1 и будет неверным на первом рендере.
function fig3ResizeToCanvas(f){
  const w = f.canvas.clientWidth, h = f.canvas.clientHeight;
  if(w<=0 || h<=0) return false;
  const ratio = f.renderer.getPixelRatio();
  if(f.canvas.width !== Math.round(w*ratio) || f.canvas.height !== Math.round(h*ratio)){
    f.renderer.setSize(w, h, false);
    f.camera.aspect = w/h;
    f.camera.updateProjectionMatrix();
    return true;
  }
  return false;
}
// Сколько секунд конкретного настроения нужно "прогнать" через fig3ApplyMood, чтобы застать САМУЮ
// широкую позу за весь цикл (взмах рукой в сторону, поднятый флаг/посох, шаг) — для одноразовых
// анимаций это их полная длительность (для tired — с учётом animation-delay руки, 1.8+2.2с), для
// зацикленных (neutral) — длительность одного периода самого широкого цикла (голова, 7с; дыхание/
// покачивание амплитудой пренебрежимо малы для кадрирования, их не считаем).
const FIG3_MOOD_SWEEP_SECONDS = { confident: 3.6, tired: 4.0, neutral: 7.0 };
// Автокадрирование камеры под РЕАЛЬНЫЙ диапазон движения текущего настроения, а не под позу покоя с
// приблизительным запасом "на глаз" (первая версия так и делала — запаса всё равно не хватило: взмах
// рукой асимметричен, весь объём уезжает в одну сторону от центра позы покоя, а не раздувается
// поровну во все стороны, как предполагала бы простая доля-множитель). Вместо этого — прогоняем позу
// по нескольким точкам всей анимации, берём ОБЪЕДИНЕНИЕ (union) всех получившихся параллелепипедов
// как фактический "коридор", в котором фигура окажется за весь цикл, и кадрируем под него с небольшим
// (не угадывающим, а просто отступ по краю) запасом. После — обязательно возвращаем позу к тому
// моменту анимации, что был АКТУАЛЕН на момент вызова (см. восстановление tSec в конце), иначе кадр
// на экране "прыгнет" в последнюю просканированную позу.
function fig3FrameCamera(f){
  const sweepDur = FIG3_MOOD_SWEEP_SECONDS[f.mood] || 3.6;
  const savedTSec = f.mood ? (performance.now()/1000 - f.moodStart) : 0;
  const union = new THREE.Box3();
  const steps = 16;
  for(let i=0;i<=steps;i++){
    const t = sweepDur * i/steps;
    if(f.mood) fig3ApplyMood(f, t);
    f.rigTilt.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(f.rigTilt);
    if(!box.isEmpty()) union.union(box);
  }
  if(f.mood) fig3ApplyMood(f, savedTSec); // возвращаем позу на текущий момент анимации
  if(union.isEmpty()) return;
  const size = union.getSize(new THREE.Vector3());
  const center = union.getCenter(new THREE.Vector3());
  const margin = 1.12; // небольшой отступ по краю кадра, не "угадывающий" запас — коридор уже точный
  const fovRad = f.camera.fov * FIG3_DEG;
  const aspect = f.camera.aspect || 1;
  const distForHeight = (size.y*margin/2) / Math.tan(fovRad/2);
  const distForWidth = (size.x*margin/2) / (Math.tan(fovRad/2)*aspect);
  const dist = Math.max(distForHeight, distForWidth, 120) + size.z/2 + 20;
  f.camera.position.set(center.x, center.y, center.z + dist);
  f.camera.near = Math.max(1, dist - size.z*2);
  f.camera.far = dist + size.z*4 + 400;
  f.camera.lookAt(center.x, center.y, center.z);
  f.camera.updateProjectionMatrix();
  f.ground.position.y = union.min.y - 1;
}
// Применяет позу текущего настроения ко всем отслеженным суставам на каждый кадр — та же логика, что
// у CSS .mood-*/@keyframes (см. подробные пояснения там), просто вычислена вручную через fig3Eval
// вместо браузерного механизма CSS-анимаций.
function fig3ApplyMood(f, tSec){
  const j = f.joints, m = f.mood;
  const setRot = (obj, rx, ry, rz)=>{ if(!obj) return; if(rx!=null) obj.rotation.x = rx*FIG3_DEG; if(ry!=null) obj.rotation.y = ry*FIG3_DEG; if(rz!=null) obj.rotation.z = rz*FIG3_DEG; };
  // Инверсия Y-оси при переносе из CSS переворачивает знак поворотов вокруг X и Z, но не вокруг Y —
  // поэтому у rotateX/rotateZ ниже везде минус перед CSS-значением, у rotateY — нет (см. общий
  // комментарий у блока WEBGL ФИГУРА выше).
  if(m==='confident'){
    f.rigBob.position.y = fig3Eval([[0,0],[50,3],[100,0]], tSec, 3.2, true);
    j.torso.scale.y = fig3Eval([[0,1],[50,1.03],[100,1]], tSec, 2.6, true);
    setRot(j.head, -fig3Eval([[0,0],[15,0],[100,14]], tSec, 3.6, false), null, null);
    setRot(j.shoulderr,
      -fig3Eval([[0,4],[40,38],[70,56],[100,58]], tSec, 3.6, false),
      null,
      -fig3Eval([[0,14],[40,-72],[70,8],[100,18]], tSec, 3.6, false));
    setRot(j.elbowr, null, null, -fig3Eval([[0,6],[40,-12],[70,22],[100,16]], tSec, 3.6, false));
    setRot(j.shoulderl,
      -fig3Eval([[0,4],[100,-14]], tSec, 3.6, false),
      null,
      -fig3Eval([[0,10],[100,30]], tSec, 3.6, false));
    setRot(j.elbowl, null, null, -fig3Eval([[0,6],[100,76]], tSec, 3.6, false));
  } else if(m==='neutral'){
    j.torso.scale.y = fig3Eval([[0,1],[50,1.03],[100,1]], tSec, 3.2, true);
    setRot(j.head, null, fig3Eval([[0,0],[10,0],[32,-34],[50,-34],[72,22],[88,22],[100,0]], tSec, 7, true), null);
    setRot(j.shoulderr, 96, null, -14);
    setRot(j.elbowr, null, null, -20);
    setRot(j.shoulderl, -6, null, -10);
    setRot(j.elbowl, null, null, -8);
  } else if(m==='tired'){
    const lean = 14;
    j.torso.rotation.x = -lean*FIG3_DEG;
    j.torso.scale.y = fig3Eval([[0,1],[50,1.065],[100,1]], tSec, 3.6, true);
    setRot(j.hipr, -fig3Eval([[0,0],[22,-26],[46,4],[100,0]], tSec, 2.4, false), null, null);
    setRot(j.kneer, -fig3Eval([[0,0],[22,22],[46,0],[100,0]], tSec, 2.4, false), null, null);
    setRot(j.hipl, -fig3Eval([[0,0],[54,0],[76,-26],[96,4],[100,0]], tSec, 2.4, false), null, null);
    setRot(j.kneel, -fig3Eval([[0,0],[54,0],[76,22],[96,0],[100,0]], tSec, 2.4, false), null, null);
    const armT = Math.max(0, tSec-1.8);
    setRot(j.shoulderr,
      -fig3Eval([[0,2],[100,-46]], armT, 2.2, false),
      null,
      -fig3Eval([[0,12],[100,20]], armT, 2.2, false));
    setRot(j.elbowr, null, null, -fig3Eval([[0,8],[100,30]], armT, 2.2, false));
    setRot(j.shoulderl, -4, null, -8);
    setRot(j.elbowl, null, null, -10);
    setRot(j.head, -fig3Eval([[0,0],[100,30]], armT, 2.2, false), null, null);
  }
}
function fig3Tick(nowMs){
  requestAnimationFrame(fig3Tick);
  const f = fig3;
  if(!f || !f.canvas.isConnected) return;
  const tSec = nowMs/1000 - f.moodStart;
  if(f.mood) fig3ApplyMood(f, tSec);
  // Если размер контейнера реально поменялся (например, окно изменили) — пересчитываем и кадрирование
  // заново, аспект камеры мог измениться.
  if(fig3ResizeToCanvas(f)) fig3FrameCamera(f);
  f.renderer.render(f.scene, f.camera);
}
let fig3 = null;
// Настроение фигуры — по тем же двум флагам, что и переброс (character.states.bodrost/istoshenie, см.
// showRerollPopup): бодрость есть/нет, истощение есть/нет — независимые флаги, поэтому оба сразу
// технически возможны, хоть и не должны встречаться вместе по смыслу правил — на этот случай вместо
// модели показываем текст-подсказку, а не пытаемся анимировать противоречие (см. renderArmorZones).
function getFigureMood(){
  if(!character) return null;
  const b = !!(character.states && character.states.bodrost);
  const i = !!(character.states && character.states.istoshenie);
  if(b && i) return 'conflict';
  if(b && !i) return 'confident';
  if(!b && i) return 'tired';
  return 'neutral';
}
function renderArmorZones(){
  const el = document.getElementById('armorZonesBox');
  if(!el) return;
  if(!character){ el.innerHTML = '<span class="muted">—</span>'; return; }
  const wornItems = getWornArmorItems();
  const active = getWornArmorZones();
  const legend = ARMOR_ZONES.map(z=>`<span class="zone-legend-item${active.has(z)?' on':''}">${ARMOR_ZONE_LABELS[z]}</span>`).join('');
  const cards = wornItems.map(armorStatCardHtml).filter(Boolean).join('');
  const mood = getFigureMood();
  // WebGL-версия (см. блок выше) подключается, только когда Three.js реально загрузился с CDN —
  // THREE_STATE выставляется в 'ready' асинхронно (см. loadThreeJs), поэтому первые один-два рендера
  // после открытия листа вполне могут ещё застать 'pending' и показать CSS-версию, а когда скрипт
  // догрузится — сам вызовет renderArmorZones() ещё раз и подставит WebGL. Если интернета нет вовсе
  // (CDN недоступен) — THREE_STATE навсегда 'failed', и лист просто продолжает работать на CSS-3D,
  // ничем не отличаясь от версии до этого захода.
  // Защищённые зоны показываются только текстом: закрытые надетой бронёй выделены, открытые — зачёркнуты
  const useWebGL = false;
  const hasSiz = getWornArmorHasSiz();
  const figureHtml = mood==='conflict' ? `<div class="figure-conflict">Ты по-моему перепутал.<br>Проверь состояния.</div>` : '';
  el.innerHTML = `<div class="armor-zones-row">
      ${figureHtml}
      <div class="zone-legend"><span class="zone-legend-title">Защищённые зоны${hasSiz ? ' · есть СИЗ' : ''}</span>${legend}</div>
    </div>
    <div class="armor-stat-cards">${cards || '<span class="muted">Ничего не надето</span>'}</div>`;
  if(useWebGL){
    try{
      fig3RebuildRig(active, hasSiz, mood);
      const host = document.getElementById('figureStage3dHost');
      const canvas = fig3.canvas;
      canvas.className = 'figure-canvas-3d';
      host.appendChild(canvas);
      // Сразу же, не дожидаясь следующего кадра requestAnimationFrame (там же ещё и обновится размер
      // канваса до актуального): без этого первый показанный кадр использовал бы старый aspect камеры
      // и/или ещё не пересчитанное кадрирование.
      fig3ResizeToCanvas(fig3);
      fig3FrameCamera(fig3);
    }catch(e){
      // WebGL реально есть в браузере, но что-то в рантайме сломалось (например, контекст создать не
      // удалось) — откатываемся на CSS-версию НАВСЕГДА для этой сессии листа, а не пытаемся снова на
      // каждый рендер (дороже и бесполезно, раз уже один раз не сработало).
      THREE_STATE = 'failed';
      console.warn('[Фигура] WebGL не удалось запустить, откат на CSS-3D:', e);
      renderArmorZones();
    }
  }
}

// Тот же жест, что у основного броска характеристики (openRollPicker), просто гексы здесь выбирают
// не модификатор, а КОЛИЧЕСТВО кубиков (1..8, по умолчанию 1) — Максимум всегда фиксирован (X из
// текста предмета, см. parseResourceCheck), половины у поповера — те же Помеха/Преимущество.
function openItemRollPicker(category, itemId, clientX, clientY){
  const item = character && character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  if(!item) return;
  const max = parseResourceCheck(item.name);
  if(max==null) return;
  closeRollOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'roll-overlay';
  const popup = document.createElement('div');
  popup.className = 'roll-popup';
  popup.style.visibility = 'hidden';
  popup.innerHTML = `<div class="roll-tags"><span class="tag">${escapeHtml(item.name)}</span></div>
    <div class="hex-field"></div>
    <div class="roll-max-preview"></div>`;
  const field = popup.querySelector('.hex-field');
  const preview = popup.querySelector('.roll-max-preview');
  let mode = 'plain';
  const updatePreview = (count)=>{
    const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
    preview.innerHTML = `Максимум <b>${max}</b> · ${count}×к6${modeTxt}`;
  };
  let anchorHex = null;
  const line = document.createElement('div'); line.className = 'hex-line';
  for(let n=1;n<=8;n++){
    const hex=document.createElement('div');
    hex.textContent=String(n);
    hex.className='hex'+(n===1?' zero':'');
    hex.dataset.mod=n;
    if(n===1) anchorHex = hex;
    line.appendChild(hex);
  }
  field.appendChild(line);
  updatePreview(1);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  _rollOverlayEl = overlay;
  document.body.classList.add('roll-modal-active');

  const pr = popup.getBoundingClientRect(), hr = anchorHex.getBoundingClientRect();
  const hexCenterX = hr.left - pr.left + hr.width/2, hexCenterY = hr.top - pr.top + hr.height/2;
  let left = clientX - hexCenterX, top = clientY - hexCenterY;
  left = Math.max(6, Math.min(left, window.innerWidth - pr.width - 6));
  top = Math.max(6, Math.min(top, window.innerHeight - pr.height - 6));
  popup.style.left = left+'px'; popup.style.top = top+'px';
  popup.style.visibility = 'visible';

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
  setHovered(hexAt(clientX, clientY) || anchorHex);

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
  const onMove=(e)=>{
    const hex = hexAt(e.clientX, e.clientY);
    if(hex) setHovered(hex);
    if(e.clientX < popupRect.left) setMode('disadvantage');
    else if(e.clientX > popupRect.right) setMode('advantage');
    else if(e.clientY < popupRect.top || e.clientY > popupRect.bottom) setMode('plain');
  };
  // Тот же fallback, что и у openRollPicker (см. её onUp) — первый промах мимо гекса при отпускании
  // больше не отменяет жест, а переводит поповер в clickMode: ждём следующего pointerup, по гексу
  // засчитываем как обычно.
  let clickMode = false;
  const onUp=(e)=>{
    const hex = hexAt(e.clientX, e.clientY);
    if(hex){
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      _rollOverlayCleanup = null;
      executeItemRoll(category, itemId, max, parseInt(hex.dataset.mod,10), mode, popup);
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
window.openItemRollPicker = openItemRollPicker;
// count независимых к6-проверок ресурса (Max фиксирован из текста предмета) — при Преимуществе/
// Помехе каждая проверка сама по себе бросается дважды и берёт лучший/худший результат (тот же
// простой приём, что и у D6 боковой панели бросков кубов — своих особых правил, как у к20, здесь
// нет). Каждый ПРОВАЛ сокращает счётчик предмета на 1 — то и просили ("при провале количество
// сокращается"); успешные проверки количество не трогают.
function executeItemRoll(category, itemId, max, count, mode, popup){
  const kept = [], results = [];
  for(let i=0;i<count;i++){
    const a = randInt(6);
    let k = a;
    if(mode!=='plain'){ const b = randInt(6); k = mode==='advantage' ? Math.min(a,b) : Math.max(a,b); }
    kept.push(k); results.push(k<=max);
  }
  const item = character.inventory[category] && character.inventory[category].find(x=>x.id===itemId);
  // «Пальба»: пока это оружие экипировано, каждый провал ПР его боеприпаса тратит 3 единицы вместо одной
  const wst = item ? parseWeaponStats(item.name) : null;
  const palba = !!(wst && hasWeaponTag(wst.statText, 'пальба') && character.weapons.some(w=>w.itemId===item.id));
  const usesLost = results.filter(r=>!r).length * (palba ? 3 : 1);
  const itemName = item ? item.name : '?';
  if(item){ item.uses = Math.max(0, (item.uses==null?1:item.uses) - usesLost); }
  recordAndShareQuickRoll({diceType:'d6', sides:6, itemCheck:true, itemName, max, mode, count, kept, results, usesLost, palba});

  const startRect = popup.getBoundingClientRect();
  if(_rollOverlayEl) _rollOverlayEl.querySelectorAll('.roll-side-hint').forEach(h=>h.remove());
  const modeTxt = mode==='advantage' ? ' · Преимущество' : mode==='disadvantage' ? ' · Помеха' : '';
  const anyFail = usesLost>0;
  popup.innerHTML = `<div class="roll-outcome ${anyFail?'failure':'success'}"><span class="verdict">${anyFail?`Провал: −${usesLost}${palba?' (пальба ×3)':''}`:'Без потерь'}</span>${escapeHtml(itemName)} · ${count}×к6 (Макс.${max})${modeTxt}: ${kept.join(', ')}</div>`;
  const pr2 = popup.getBoundingClientRect();
  popup.style.left = Math.max(6, Math.min(parseFloat(popup.style.left), window.innerWidth - pr2.width - 6)) + 'px';
  popup.style.top = Math.max(6, Math.min(parseFloat(popup.style.top), window.innerHeight - pr2.height - 6)) + 'px';

  launchRollAnimation({diceType:'d6', mode, rolls:kept, roll:kept[0]}, startRect).then(()=>{
    closeRollOverlay();
    renderInventory();
  });
}

// Максимальная категория успеха, реально достижимая ОБЫЧНЫМ (не особым) броском при данном
// Максимуме — те же границы 5/10, что и у обычного успеха ниже, но используются как потолок, а не
// как формула для конкретного числа. Нужна для особого правила нат.12 (см. evaluateD20Check ниже):
// нат.12 не должен автоматически давать КУ3, если Максимум настолько низкий, что обычный успех там
// физически не мог бы подняться выше КУ1/КУ2.
function maxAttainableCategory(max){
  if(max>=11) return 3;
  if(max>=6) return 2;
  return 1;
}
// Правило книги (стр. 19) для основного броска к20: натуральные 12/13 — особые исходы вне обычной
// формулы «успех при итоге ≤ Максимума», но не полностью независимые от Максимума:
//  - нат.12 — всегда успех, но его категория — максимально ДОСТИЖИМАЯ при текущем Максимуме
//    (maxAttainableCategory), а не жёстко КУ3;
//  - нат.13 — всегда провал (с последствиями) при Максимуме до 20; при Максимуме 21 и выше перестаёт быть
//    провалом — обычный успех (КУ3). Так решил Мастер (21.10.2026: «если максимум 21 и выше, 13 перестаёт
//    быть провалом»); раньше при 21 был «провал без последствий», и у атак с карты и способностей существ —
//    где Максимум часто ровно 21 — 13 выходило провалом.
// Категория успеха (КУ1/2/3) для ОБЫЧНОГО (не нат.12/13) успеха делит диапазон 1..20 на трети.
// Вынесено отдельной функцией, чтобы боковая панель бросков кубов (D20 в ней) считала успех/провал
// ТЕМ ЖЕ правилом, а не повторяла его копией.
function evaluateD20Check(roll, max){
  if(roll===12) return {success:true, category:maxAttainableCategory(max), natConsequences:false};
  if(roll===13){
    if(max>=21) return {success:true, category:3, natConsequences:false}; // 13 всегда >10, КУ3 по обычной формуле
    return {success:false, category:null, natConsequences:true};
  }
  const success = roll<=max;
  const category = success ? (roll<=5?1:roll<=10?2:3) : null;
  return {success, category, natConsequences:false};
}
// Сравнение двух бросков к20 для Преимущества/Помехи — НЕ то же самое, что «меньше/больше числа»,
// из-за особых правил нат.12/13 выше (нат.13 может внезапно стать успехом при высоком Максимуме,
// нат.12 не обязан быть КУ3) — оба места, что выбирают из двух костей (основной бросок характеристики
// ниже и D20 боковой панели), используют ОДНО и то же правило, а не повторяют его каждое по-своему.
// Пересказ игрока: успех лучше провала; среди двух успехов — выше категория, при равной категории —
// больше число на кубе; среди двух провалов — симметрично: провал с БОЛЬШИМ числом на кубе считается
// «менее плохим» (то есть провал с меньшим числом — хуже; тай-брейк на провалах для Преимущества в
// формулировке не описан отдельно, взят симметрично уже описанному для Помехи).
// Возвращает >0, если a лучше b, <0, если a хуже b, 0 при полном равенстве.
function compareD20Outcomes(a, b, max){
  const A = evaluateD20Check(a, max), B = evaluateD20Check(b, max);
  if(A.success !== B.success) return A.success ? 1 : -1;
  if(!A.success) return a===b ? 0 : (a>b ? 1 : -1);   // оба провал: больший бросок — «менее плохой»
  if(A.category !== B.category) return A.category>B.category ? 1 : -1;
  return a===b ? 0 : (a>b ? 1 : -1);                   // оба успех, категория равна: больший бросок лучше
}
function pickD20ForMode(a, b, max, mode){
  if(mode==='advantage')    return compareD20Outcomes(a,b,max)>=0 ? a : b;
  if(mode==='disadvantage') return compareD20Outcomes(a,b,max)<=0 ? a : b;
  return a;
}
// Текстовая пометка нат.12/13 — общая для основного броска характеристики (executeRoll) и для D20
// боковой панели бросков кубов (formatQuickRollEntry), чтобы правило Максимума 21/22 (см.
// evaluateD20Check) было видно в обоих логах одинаково, а не расходилось по формулировке.
function natTagText(roll, success, natConsequences){
  if(roll===12) return ' · нат. 12';
  if(roll===13) return success ? ' · нат. 13 (Макс.≥21 — успех)' : ' · нат. 13';
  return '';
}
