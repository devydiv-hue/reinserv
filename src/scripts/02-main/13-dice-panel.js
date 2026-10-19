/* ======================================================================
   Полноэкранная анимация броска к20 — ОБЩАЯ для боковой панели бросков кубов (DicePanel) И основного
   броска характеристики (executeRoll): кость "от души" пролетает через весь экран, отскакивая от
   нескольких случайных точек на его границах, и всегда оседает строго по центру, где крупно виден
   результат. Раньше у основного броска была СВОЯ маленькая копия (крутящийся к20 в поповере) —
   незачем плодить сущности, теперь обе точки входа используют одну и ту же launchRollAnimation.
   ====================================================================== */
const AUTOCLOSE_MS = 1300;       // пауза с результатом на экране (по центру) перед автозакрытием
const FLIGHT_MS = 2000;          // база длительности полёта кости по экрану
const FLIGHT_MS_JITTER = 500;    // + случайная добавка 0..это, чтобы несколько костей не летели идеально синхронно
const DIE_FACES_FN = {d4:tetrahedronFaces, d6:cubeFaces, d12:dodecahedronFaces, d20:icosahedronFaces};
const DIE_SHAPE_CLASS = {d4:'shape-tri', d6:'shape-square', d12:'shape-penta', d20:'shape-tri'};
// Раньше здесь был D20_SETTLE_TILT — небольшой довесочный поворот ТОЛЬКО для d20 в settleTransformFor,
// чтобы "в лоб" на результатную грань не выглядело плоским симметричным шестиугольником. Убран: как
// только грани стали затеняться по нормали (BIG_DIE_LIGHT ниже), сам объём стало видно и без наклона
// (см. "объём в порядке" от игрока), а вот наклон при этом уводил результатную грань от зрителя —
// "20-гранники не разворачиваются гранью с результатом к пользователю", в отличие от остальных кубиков,
// у которых такого наклона никогда не было. Теперь у d20 тот же settleTransformFor(normal) без второго
// аргумента, что и у d4/d6/d12 — результатная грань у всех четырёх одинаково смотрит строго на зрителя.
// Направление света для затенения крупной модели броска — тот же приём и то же направление, что у
// мини-иконок (DIE_ICON_LIGHT внутри DicePanel), просто вынесено сюда отдельной константой: та
// функция приватна внутри своего замыкания, а buildRolledDieModel снаружи него.
const BIG_DIE_LIGHT = nrm([0.45,0.6,0.8]);
// Крупная модель СОВЕРШИВШЕГОСЯ броска: та же геометрия, что и у мини-иконок выбора кубика, но грани
// пронумерованы 1..N (в том же порядке, в каком их строит DIE_FACES_FN[type]()) и результатная грань
// довёрнута к зрителю — тот же приём, что у .d20-body/.d20-face исходной модели основного броска,
// обобщённый на все 4 формы через DIE_FACES_FN вместо жёстко зашитого icosahedronFaces(). spin
// возвращается отдельно от scene, чтобы вызывающий код мог довесить на него анимацию кувырка (полёт
// по экрану крутит .dp-flying-die целиком в launchRollAnimation — это независимая, вторая ось вращения).
function buildRolledDieModel(diceType, faceIdx){
  const faces = DIE_FACES_FN[diceType]();
  const shapeClass = DIE_SHAPE_CLASS[diceType];
  const scene = document.createElement('div'); scene.className = 'dp-die-icon';
  const spin = document.createElement('div'); spin.className = 'dp-die-spin';
  const body = document.createElement('div'); body.className = 'dp-die-body';
  // Матрица довода результатной грани к зрителю — считаем здесь ОТДЕЛЬНО от body.style.transform ниже
  // (тот вызовет settleTransformFor и пересчитает то же самое ещё раз, дёшево), потому что нужна СЕЙЧАС,
  // до цикла по граням — см. комментарий про затенение внутри цикла.
  const settleM = settleMatrixFor(faces[faceIdx].normal);
  faces.forEach((f,i)=>{
    const face = document.createElement('div');
    face.className = 'dp-die-face numbered '+shapeClass+(i===faceIdx?' is-result':'');
    // scale(1.06) — ПОСЛЕДНИЙ (правый) множитель в CSS transform-списке применяется ПЕРВЫМ, до
    // matrix3d, то есть раздувает грань в её же локальных координатах вокруг её собственного центра
    // (совпадает с центром div-а — см. геометрию выше), а уже потом matrix3d ставит её в 3D-плоскость.
    // Соседние грани при этом слегка "наезжают" друг на друга по общему ребру — тонкий зазор
    // сглаживания (при котором сквозь щель между двумя честно математически смежными гранями было
    // видно страницу позади) теперь перекрыт нахлёстом, а не остаётся дыркой.
    face.style.transform = f.matrix+' scale(1.06)';
    // Затенение по нормали грани: раньше ВСЕ грани (кроме результатной) красились в один и тот же
    // плоский var(--ink) без единого перепада яркости — соседние грани физически расположены под
    // разными углами и по-разному ловят свет, но на экране до этого ничем не отличались друг от
    // друга, поэтому вся модель в любом ракурсе читалась одним плоским тёмным пятном, а не гранёным
    // объёмом (тот же приём с затенением у мини-иконок "Выберите куб" — там же так и выглядит объёмно,
    // это подтверждает, что дело было именно в отсутствии затенения, а не в ракурсе/повороте).
    //
    // Свет считается в ИТОГОВОЙ системе координат (после довода результатной грани к зрителю), а не в
    // исходной модельной — раньше здесь стоял f.normal напрямую, и яркость результатной грани зависела
    // от того, куда её нормаль СЛУЧАЙНО смотрела в необёрнутой модели, то есть "плавала" от броска к
    // броску (особенно заметно при нескольких костях сразу: у каждой выпадает своя грань — свой
    // случайный итог освещённости). matVecDir3(settleM, f.normal) — та же нормаль, но повёрнутая ТЕМ ЖЕ
    // поворотом, что и вся модель (settleM = settleMatrixFor(faces[faceIdx].normal), см. выше) — у
    // результатной грани (i===faceIdx) она поэтому ВСЕГДА получается (0,0,1) по определению
    // settleMatrixFor, а BIG_DIE_LIGHT направлен в основном туда же — результат гарантированно "на
    // свету" при любой выпавшей грани, не только иногда повезёт.
    const litNormal = matVecDir3(settleM, f.normal);
    const light = Math.max(0, dot(litNormal, BIG_DIE_LIGHT));
    // Металлический кант (см. комментарий у .dp-die-face в <style>) продублирован здесь: inline
    // filter полностью перекрывает CSS-filter той же грани, а яркость по свету обязана быть inline
    // (разная у каждой грани) — значит кант, идущий в одном filter вместе с ней, тоже должен быть inline.
    face.style.filter = 'brightness(' + (0.55 + light*0.8).toFixed(3) + ') drop-shadow(.8px .8px .5px rgba(0,0,0,.6)) drop-shadow(-.8px -.8px .5px rgba(255,255,255,.55))';
    // Эмаль — вложенная фигура (см. .dp-die-enamel в <style>), чуть меньше самой грани: видимая полоса
    // металла между их краями и есть тот "ободок", который просили. Цифра — внутри эмали, а не прямо
    // в face, как было раньше.
    const enamel = document.createElement('div');
    enamel.className = 'dp-die-enamel '+shapeClass;
    enamel.innerHTML = '<span style="transform:rotate('+f.textRotation.toFixed(2)+'deg)">'+(i+1)+'</span>';
    face.appendChild(enamel);
    body.appendChild(face);
  });
  // грань результата смотрит на зрителя — одинаково для всех 4 типов, см. комментарий у DIE_FACES_FN
  // про то, почему у d20 больше нет отдельного наклона.
  body.style.transform = settleTransformFor(faces[faceIdx].normal);
  spin.appendChild(body);
  scene.appendChild(spin);
  return {scene, spin};
}
// Размер одной кости на полноэкранной сцене броска: ~1/10 площади экрана для одной-двух костей
// (sqrt(1/10)≈0.316 от меньшей стороны экрана — отсюда 0.32 ниже), компактнее при бросках сразу
// нескольких D4/D6/D12, но не мельче читаемого минимума.
function diceSize(count){
  const base = Math.min(window.innerWidth, window.innerHeight) * 0.32;
  if(count<=1) return Math.max(150, Math.min(base, 340));
  if(count===2) return Math.max(130, Math.min(base*0.78, 280));
  return Math.max(92, Math.min(base*0.55, 190));
}
function randomEdgePoint(){
  const w = window.innerWidth, h = window.innerHeight, pad = 36;
  const side = Math.floor(Math.random()*4);
  if(side===0) return {x: pad, y: pad + Math.random()*(h-pad*2)};
  if(side===1) return {x: w-pad, y: pad + Math.random()*(h-pad*2)};
  if(side===2) return {x: pad + Math.random()*(w-pad*2), y: pad};
  return {x: pad + Math.random()*(w-pad*2), y: h-pad};
}
// startRect — откуда "вылетает" кость (getBoundingClientRect-подобный объект с left/top); по
// умолчанию — пузырь боковой панели (её родной случай использования), но основной бросок
// характеристики (executeRoll) передаёт положение своего поповера явно, у него нет пузыря на экране.
// Возвращает Promise, который разрешается, когда ВСЕ кости долетели и результат уже показан
// достаточно долго, чтобы его успели прочитать.
function launchRollAnimation(entry, startRect){
  const stage = document.getElementById('diceRollStage');
  stage.innerHTML = '';
  stage.classList.add('show');
  let items;
  if(entry.diceType==='d20' && entry.rolls.length>1){
    items = entry.rolls.map(v=>({value:v, discarded: v!==entry.roll}));
  } else if(entry.rolls){
    items = entry.rolls.map(v=>({value:v, discarded:false}));
  } else {
    items = [{value:entry.roll, discarded:false}];
  }
  const size = diceSize(items.length);
  const centerX = window.innerWidth/2, centerY = window.innerHeight/2;
  // Оттенок зависит только от mode, а не от diceType — раньше подкрашивался только D20 боковой
  // панели, но с проверкой ресурса предмета (executeItemRoll) Преимущество/Помеха появились и у к6.
  const tintClass = entry.mode==='advantage' ? ' dp-tint-green' : entry.mode==='disadvantage' ? ' dp-tint-red' : '';
  const origin = startRect || document.getElementById('diceFab').getBoundingClientRect();
  const finishes = items.map((it,i)=>{
    const wrap = document.createElement('div');
    wrap.className = 'dp-flying-die' + (it.discarded?' dp-discarded':(tintClass||''));
    wrap.style.width = size+'px'; wrap.style.height = size+'px';
    // Грани нумеруются 1..N в том же порядке, в котором их строит геометрия (DIE_FACES_FN) —
    // тот же приём, что у executeRoll для к20 характеристики (faceIdx = roll-1).
    const faceIdx = it.value - 1;
    const {scene, spin} = buildRolledDieModel(entry.diceType, faceIdx);
    wrap.appendChild(scene);
    stage.appendChild(wrap);

    const spread = items.length>1 ? (i-(items.length-1)/2) * (size*0.92) : 0;
    const endX = centerX + spread - size/2, endY = centerY - size/2;
    const bounces = 2 + Math.floor(Math.random()*2); // 2–3 отскока от границ, не по всем сразу — не должно надоедать
    const frames = [{ transform:`translate(${origin.left}px, ${origin.top}px) rotate(0deg) scale(.5)` }];
    for(let b=1;b<=bounces;b++){
      const p = randomEdgePoint();
      frames.push({ transform:`translate(${p.x-size/2}px, ${p.y-size/2}px) rotate(${(Math.random()*720-360).toFixed(0)}deg) scale(1)` });
    }
    frames.push({ transform:`translate(${endX}px, ${endY}px) rotate(0deg) scale(1)` });
    const duration = FLIGHT_MS+Math.random()*FLIGHT_MS_JITTER;
    const anim = wrap.animate(frames, { duration, easing:'cubic-bezier(.32,.08,.2,1)', fill:'forwards' });
    // Собственный кувырок модели (независимая ось от полёта по экрану выше). spinScale переводит
    // "естественный" размер модели (150px — размер исходной .d20-scene при scale:1) в фактический
    // размер этой летящей кости (size). Масштаб здесь ПОСТОЯННЫЙ (не отдельная анимация 0.55→1): рост
    // "из точки" уже даёт внешний wrap.animate ниже (scale .5→1) — если масштабировать ещё и spin
    // отдельной кривой поверх этого, два несинхронных easing-графика перемножаются и кость на глаз
    // "сжимается-разжимается" в полёте вместо ровного роста.
    const spinScale = size/150;
    // НАСТОЯЩАЯ причина "сплющивания" — найдена через getComputedStyle РЕАЛЬНОГО интерполированного
    // кадра посреди вращения (не итоговых, "красивых" поз, которые всё это время и проверялись):
    // CSS-функция scale(s) — это ВСЕГДА 2D-масштаб, т.е. ровно scale3d(s, s, 1) — по глубине (Z) она
    // НИЧЕГО не растягивает, множитель по Z всегда 1, каким бы ни было s. Модель кубика — не плоская
    // картинка, у неё есть настоящая глубина (грани реально расставлены в 3D через translateZ), а
    // .dp-die-spin/тумбл-кадры масштабировали её через обычный scale(spinScale) — то есть ширину/высоту
    // растягивали в spinScale раз, а ГЛУБИНУ не трогали вообще. Пока кость стоит смирно результатной
    // гранью к зрителю, это почти незаметно (глубина и так в основном "торчит" в сторону от экрана),
    // но при любом реальном повороте во время кувырка эта нерастянутая глубина проворачивается в
    // произвольном направлении экрана и физически сплющивает силуэт именно по этой оси — то самое
    // "сплющено", и именно поэтому это никогда не было вопросом ракурса: масштаб был кривым в 3D с
    // самого начала, ракурс только определял, В КАКУЮ СТОРОНУ в моменте вылезет этот перекос. Проверено
    // напрямую: длины трёх столбцов реальной computed-матрицы во время поворота были 1.62/1.52/1.17
    // вместо одинаковых — не оптика, а буквально разный масштаб по трём осям. Фикс — scale3d(s,s,s)
    // вместо scale(s) везде, где масштабируется САМА 3D-модель (не плоская грань — у неё локальный z
    // всегда 0, там scale() корректен и не тронут, см. face.style.transform выше).
    spin.style.transform = `scale3d(${spinScale.toFixed(4)},${spinScale.toFixed(4)},${spinScale.toFixed(4)})`;
    // Кувырок НЕ вокруг одной оси (было rotate3d от 0° до 1080° по одной случайной оси) — у d6/d12/d20
    // (в отличие от d4) есть пары ПАРАЛЛЕЛЬНЫХ граней (у тетраэдра параллельных граней нет вовсе —
    // этим и объясняется, что жалоба "выглядит сплющенным" не касалась d4), а чистое вращение вокруг
    // одной оси на пути от 0° до 1080° неизбежно хоть раз проходит точно вдоль этой оси параллельных
    // граней — в этот момент силуэт МАТЕМАТИЧЕСКИ ровно плоский (как у куба, если смотреть точно в
    // грань) — это не ошибка рендера, а свойство самой геометрии в этом ракурсе (независимая от бага
    // со scale() выше причина — обе способствовали одной и той же жалобе). Реальная брошенная кость
    // тоже не крутится вокруг одной чистой оси, а кувыркается — несколько случайных осей подряд почти
    // никогда не совпадают с осью параллельных граней достаточно точно и достаточно надолго, чтобы это
    // было заметно глазу. Последний кадр — тоже rotate3d (угол 0°, ось не важна при угле 0, а не голый
    // scale3d): форма списка transform-функций одинакова у ВСЕХ кадров подряд, поэтому браузер
    // интерполирует rotate3d и scale3d раздельно на каждом сегменте (ось/угол отдельно от коэффициента),
    // а не откатывается на интерполяцию через разложение сырой матрицы (тот путь и сам может давать
    // сдвиг/шир на промежуточных кадрах — независимо от бага scale()→scale3d() выше). Спин всё равно
    // возвращается к исходной ориентации, и результатная грань (довёрнутая settleTransformFor на
    // .dp-die-body, см. buildRolledDieModel) оказывается спереди без рывка, как и раньше.
    const tumbleFrames = [];
    for(let t=0;t<4;t++){
      const tx=Math.random(), ty=Math.random(), tz=Math.random();
      const ang = 260 + Math.random()*400;
      tumbleFrames.push({ transform:`rotate3d(${tx.toFixed(4)},${ty.toFixed(4)},${tz.toFixed(4)},${ang.toFixed(0)}deg) scale3d(${spinScale.toFixed(4)},${spinScale.toFixed(4)},${spinScale.toFixed(4)})` });
    }
    tumbleFrames.push({ transform:`rotate3d(1,0,0,0deg) scale3d(${spinScale.toFixed(4)},${spinScale.toFixed(4)},${spinScale.toFixed(4)})` });
    spin.animate(tumbleFrames, { duration, easing:'linear', fill:'forwards' });
    return anim.finished.catch(()=>{}).then(()=>{ wrap.classList.add('dp-settled'); });
  });
  // rollGen — у каждого запуска свой номер; если пока эта кость летела, launchRollAnimation успели
  // вызвать снова (новый бросок поверх ещё не отыгранного), закрывать/чистить сцену по таймеру должен
  // только САМЫЙ ПОСЛЕДНИЙ запуск. Без этой проверки более ранний, уже "обогнанный" запуск мог по
  // своему таймеру стереть stage.innerHTML уже ПОСЛЕ того, как новый бросок успел на неё вылететь —
  // отсюда и жалоба "анимация не всегда доигрывает до конца".
  const rollGen = ++launchRollAnimation._gen;
  return Promise.all(finishes).then(()=>new Promise(resolve=>{
    setTimeout(()=>{
      if(rollGen === launchRollAnimation._gen){ stage.classList.remove('show'); stage.innerHTML=''; }
      resolve();
    }, AUTOCLOSE_MS);
  }));
}
launchRollAnimation._gen = 0;

/* ======================================================================
   DicePanel — боковая панель быстрого броска кубов (D4/D6/D12/D20), поверх существующей системы:
   геометрия кубиков — tetrahedronFaces/cubeFaces/dodecahedronFaces/icosahedronFaces (см. выше,
   icosahedronFaces — ТА ЖЕ функция, что рисует существующий интерактивный D20 при основном
   броске); запись результата — recordAndShareQuickRoll (тонкий адаптер к тем же
   addRollLogEntry/session.log/sendMsg/RoomTransport, что и обычный бросок характеристики, см. выше);
   успех/провал D20 — evaluateD20Check (та же формула КУ1/2/3 и натуральных 12/13, что у основного
   броска); анимация полёта кости — launchRollAnimation (см. выше, до этого блока — общая с основным
   броском характеристики). Ничего из этого не продублировано — только переиспользовано.

   Состояния: CLOSED → OPEN (выбор кубика) → SELECTING (параметры, возможно несколько уровней
   подряд — «path») → ROLLING (бросок + анимация) → CLOSING → CLOSED. Один и тот же выбор (клик или
   удержание наведения ~1с) ведёт в chooseItem() — единая точка входа, поэтому клик и жест НИКОГДА
   не описывают выбор дважды разными путями. `locked` гасит повторное срабатывание внутри одного
   уровня (двойной клик, клик во время ещё не остановленного таймера жеста и т.п.).
   ====================================================================== */
const DicePanel = (function(){
  const GESTURE_MS = 1000;         // жестовая задержка подтверждения — requirement 11
  const D4_COUNT_RANGE  = [1,2,3,4,5,6];
  const D6_COUNT_RANGE  = [1,2,3,4,5,6];
  const D12_COUNT_RANGE = [1,2,3,4,5,6];
  const D6_MAX_RANGE  = [1,2,3,4,5]; // явно задано в задаче
  // Книга не даёт отдельного числа для «Максимум D12» — по аналогии с D6 (диапазон ограничен самой
  // гранью кубика, не общим 1..20 основного броска) используется 1..12. Легко поменять здесь одной
  // строкой, если найдётся точное правило.
  const D12_MAX_RANGE = Array.from({length:12},(_,i)=>i+1);
  const D20_MAX_RANGE = Array.from({length:20},(_,i)=>i+1);

  let state = 'CLOSED';
  let path = [];       // накопленные выборы текущего прохода, path[0] — тип кубика
  let locked = false;  // гасит повторное срабатывание на одном и том же уровне
  let gestureEl = null, gestureId = null, gestureStart = 0, gestureRaf = null;
  // Иконка-таймер в шапке панели: по умолчанию (выкл) после броска панель закрывается целиком, как и
  // всегда (path=[] в closePanel). Включив, панель вместо закрытия возвращается на тот же экран, с
  // которого был сделан последний выбор перед броском (см. performRoll ниже) — удобно кидать несколько
  // кубов подряд одного типа, не выбирая заново тип/подрежим каждый раз. Не сбрасывается сама между
  // бросками/открытиями панели — обычный выключатель, ещё раз нажали — выключили.
  // Включённый режим заодно отключает ДВА других таймера, которые иначе мешали бы серии бросков подряд:
  //  1) наведение-жест (GESTURE_MS, см. wireHexInteraction ниже) — курсор после броска почти всегда
  //     остаётся на только что кликнутом гексе, а панель, вернувшись на тот же экран, рисует на этом
  //     месте гекс СЛЕДУЮЩЕГО выбора — без этой блокировки простое наведение (без нового клика) само
  //     запустило бы повторный выбор через секунду;
  //  2) автосворачивание по удалению мыши (proximityCloseTimer, см. handleProximityMove ниже) — серия
  //     бросков подряд часто сопровождается движением мыши в сторону (посмотреть результат, взять
  //     кубик со стола и т.п.), и панель не должна сворачиваться сама, пока игрок явно не выключил
  //     режим или не закрыл её вручную (✕/клик по пузырю).
  let stayAtStage = false;

  function el(id){ return document.getElementById(id); }

  /* ---- Иконки кубиков: те же грани/matrix3d, что у геометрии выше, отрисованные в маленьком
     фиксированном ракурсе (без нумерации граней — тут это просто объёмная иконка, не результат
     броска). Один общий строитель на все 4 формы — общий визуальный язык, как и просили.
     Центрирование модели внутри контейнера любого размера теперь делает CSS (.dp-die-icon —
     display:flex, см. <style>) — buildDieIconEl только строит грани и задаёт фиксированный ракурс
     (rotateX/rotateY), сам не заботясь о размере/позиции контейнера. ---- */
  const DIE_ICON_LIGHT = nrm([0.45,0.55,0.85]);
  // Диапазон светлоты граней (28–68%) увеличен относительно первой версии (было 15–45%) — на малом
  // размере тёмные грани на тёмном фоне гекса были почти неразличимы (см. комментарий у .dp-hex
  // .dp-die-icon в <style>).
  // Разные многогранники при ОДНОМ и том же R_PX (см. геометрию выше) дают разный истинный
  // габарит (описанный радиус всей фигуры, а не только инрадиус грани) — додекаэдр (12 пятиугольных
  // граней) визуально ближе к шару и занимает заметно меньше своего бокса, чем икосаэдр/куб/тетраэдр,
  // из-за чего на глаз казался мельче остальных, хотя технически строился тем же способом. Считано
  // один раз (вне браузера, по факту отрисованных матриц) — истинный габарит тетраэдра/куба/додекаэдра
  // приведён к габариту уже устоявшейся, не менявшейся иконки D20, чтобы все 4 кубика на экране
  // «Выберите куб» занимали примерно одинаковый квадрат.
  const DIE_ICON_SCALE = { d4:0.346, d6:0.318, d12:0.456, d20:0.29 };
  // Ракурс мини-иконки — константы, а не только строка в CSS-transform ниже: те же числа нужны и
  // JS-математике (iconTiltMatrix), которая находит, какая грань при ЭТОМ конкретном повороте
  // развёрнута к зрителю больше остальных, чтобы наклеить число именно на неё.
  const ICON_TILT_X_DEG = -16, ICON_TILT_Y_DEG = 26;
  let _iconTiltMatrix = null;
  function iconTiltMatrix(){
    if(_iconTiltMatrix) return _iconTiltMatrix;
    // CSS "rotateX(...) rotateY(...)" — правая функция применяется первой (см. matMul4 выше по
    // файлу), поэтому итоговая матрица — Xrot∘Yrot: сперва Yrot, потом Xrot.
    const xrot = rodriguesMatrix([1,0,0], ICON_TILT_X_DEG*Math.PI/180);
    const yrot = rodriguesMatrix([0,1,0], ICON_TILT_Y_DEG*Math.PI/180);
    _iconTiltMatrix = matMul4(xrot, yrot);
    return _iconTiltMatrix;
  }
  // Грань, развёрнутая к зрителю БОЛЬШЕ остальных при фиксированном ракурсе иконки — именно на неё
  // клеится число ("Выберите куб"), а не плоским текстом поверх всей иконки (тот подход полностью
  // игнорировал 3D-поворот модели — цифра "висела в воздухе", а не лежала на грани). Заодно считает
  // угол доворота самой цифры — тот же приём, что computeTextRotations, только относительно
  // фиксированного ракурса иконки (iconTiltMatrix), а не доворота конкретной грани к зрителю
  // (settleMatrixFor, для крупной модели совершившегося броска).
  function frontFacingIconFace(faces){
    const M = iconTiltMatrix();
    let bestIdx = 0, bestZ = -Infinity;
    faces.forEach((f,i)=>{
      const z = matVecDir3(M, f.normal)[2];
      if(z>bestZ){ bestZ=z; bestIdx=i; }
    });
    const e1v = matVecDir3(M, faces[bestIdx].e1);
    const textRotation = -Math.atan2(e1v[1], e1v[0]) * 180/Math.PI;
    return { idx: bestIdx, textRotation };
  }
  function buildDieIconEl(faces, shapeClass, scale, numberLabel){
    const wrap = document.createElement('div'); wrap.className = 'dp-die-icon';
    const spin = document.createElement('div'); spin.className = 'dp-die-spin';
    spin.style.transform = 'scale('+scale+') rotateX('+ICON_TILT_X_DEG+'deg) rotateY('+ICON_TILT_Y_DEG+'deg)';
    const front = numberLabel ? frontFacingIconFace(faces) : null;
    faces.forEach((f,i)=>{
      const face = document.createElement('div');
      face.className = 'dp-die-face '+shapeClass;
      const light = Math.max(0, dot(f.normal, DIE_ICON_LIGHT));
      face.style.background = 'hsl(276 16% '+(28+light*40).toFixed(0)+'%)';
      face.style.transform = f.matrix;
      if(front && i===front.idx){
        const num = document.createElement('span');
        num.className = 'dp-die-face-number';
        num.textContent = numberLabel;
        num.style.transform = 'rotate('+front.textRotation.toFixed(2)+'deg)';
        face.appendChild(num);
      }
      spin.appendChild(face);
    });
    wrap.appendChild(spin);
    return wrap;
  }
  function dieIconD4(){ return buildDieIconEl(tetrahedronFaces(), 'shape-tri', DIE_ICON_SCALE.d4, '4'); }
  function dieIconD6(){ return buildDieIconEl(cubeFaces(), 'shape-square', DIE_ICON_SCALE.d6, '6'); }
  function dieIconD12(){ return buildDieIconEl(dodecahedronFaces(), 'shape-penta', DIE_ICON_SCALE.d12, '12'); }
  function dieIconD20(){ return buildDieIconEl(icosahedronFaces(), 'shape-tri', DIE_ICON_SCALE.d20, '20'); } // существующая модель D20, не новая, размер не менялся
  const DIE_ICONS = {d4:dieIconD4, d6:dieIconD6, d12:dieIconD12, d20:dieIconD20};

  function backIconEl(){
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24');
    s.innerHTML = '<path d="M14 4 L6 12 L14 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 12 H20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
    s.style.color = 'var(--vellum-bright)';
    return s;
  }
  function fabIconEl(){
    const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
    s.setAttribute('viewBox','0 0 24 24');
    s.innerHTML = '<polygon points="12,2 21,8 21,16 12,22 3,16 3,8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2 V22 M3 8 L21 16 M21 8 L3 16" stroke="currentColor" stroke-width=".9" opacity=".7"/>';
    return s;
  }

  // Распределение N гексов по колонкам «горбом» к центру — тот же приём, что и у существующего
  // ROLL_HEX_ROWS (переменная длина полосы + центрирование вместо явных координат), только
  // колоннами вместо строк, потому что гекс здесь развёрнут на 90° (см. CSS выше).
  function hexColumnPattern(n){
    if(n<=3) return [n];
    const cols = Math.max(2, Math.round(Math.sqrt(n*1.6)));
    const base = Math.floor(n/cols), rem = n%cols;
    const lens = new Array(cols).fill(base);
    const mid = (cols-1)/2;
    const order = lens.map((_,i)=>i).sort((a,b)=>Math.abs(a-mid)-Math.abs(b-mid));
    for(let i=0;i<rem;i++) lens[order[i]]++;
    return lens;
  }

  /* ---- Экраны: явные функции на тип кубика вместо общего дерева-интерпретатора — проще
     проверить, что каждый путь (D4/D6/D12/D20 × количество/максимум) действительно ведёт куда
     нужно. Добавить новый кубик/параметр — дописать ветку здесь и в performRoll(). ---- */
  function countScreen(sides, range){
    return { title:'D'+sides+' — сколько кубиков?', items: range.map(n=>({id:String(n), label:String(n)})) };
  }
  function maxScreen(sides, range){
    return { title:'D'+sides+' — Максимум', items: range.map(n=>({id:String(n), label:String(n)})) };
  }
  function countOrMaxScreen(sides){
    return { title:'D'+sides, items:[ {id:'count', label:'#'}, {id:'max', label:'Max', wordLabel:true} ] };
  }
  function d20ModeScreen(){
    return { title:'D20 — тип броска', items:[
      {id:'disadvantage', label:'▼', tint:'red'},
      {id:'plain', label:'●'},
      {id:'advantage', label:'▲', tint:'green'},
    ]};
  }
  function getScreen(){
    if(path.length===0){
      return { title:'Выберите куб', items:[
        {id:'d4', icon:DIE_ICONS.d4, label:null},
        {id:'d6', icon:DIE_ICONS.d6, label:null},
        {id:'d12', icon:DIE_ICONS.d12, label:null},
        {id:'d20', icon:DIE_ICONS.d20, label:null},
      ]};
    }
    const diceType = path[0].id;
    if(diceType==='d4'){
      if(path.length===1) return countScreen(4, D4_COUNT_RANGE);
      return null; // готово к броску
    }
    if(diceType==='d6' || diceType==='d12'){
      const sides = diceType==='d6' ? 6 : 12;
      if(path.length===1) return countOrMaxScreen(sides);
      if(path.length===2){
        const sub = path[1].id;
        return sub==='count' ? countScreen(sides, sides===6?D6_COUNT_RANGE:D12_COUNT_RANGE)
                              : maxScreen(sides, sides===6?D6_MAX_RANGE:D12_MAX_RANGE);
      }
      return null;
    }
    if(diceType==='d20'){
      if(path.length===1) return d20ModeScreen();
      if(path.length===2) return maxScreen(20, D20_MAX_RANGE);
      return null;
    }
    return null;
  }

  // rollToken защищает от той же гонки, что раньше чинили у setTimeout-автозакрытия: если панель
  // закрыли/открыли заново, пока ПРЕДЫДУЩИЙ бросок ещё доигрывает свою полноэкранную анимацию, её
  // завершение не должно закрыть уже новую, не относящуюся к ней сессию панели.
  let rollToken = 0;
  function performRoll(){
    const myToken = rollToken;
    state = 'ROLLING';
    cancelGesture();
    el('dpLevel').innerHTML = '';
    el('dpFeedback').innerHTML = ''; el('dpFeedback').className = 'dp-feedback';
    setTitle('Бросок…');
    const diceType = path[0].id;
    let entry;
    if(diceType==='d20'){
      const mode = path[1].id, max = parseInt(path[2].id,10);
      const rolls = mode==='plain' ? [randInt(20)] : [randInt(20), randInt(20)];
      // Тем же правилом (успех лучше провала; выше категория/бросок — лучше; среди провалов больший
      // бросок — «менее плохой»), что и у основного броска характеристики — см. pickD20ForMode.
      const roll = pickD20ForMode(rolls[0], rolls[1], max, mode);
      const {success, category} = evaluateD20Check(roll, max);
      entry = {diceType:'d20', mode, max, rolls, roll, success, category};
    } else if(diceType==='d4'){
      const count = parseInt(path[1].id,10);
      const rolls = Array.from({length:count},()=>randInt(4));
      entry = {diceType:'d4', sides:4, count, rolls, sum:rolls.reduce((a,b)=>a+b,0)};
    } else {
      const sides = diceType==='d6' ? 6 : 12;
      const sub = path[1].id;
      if(sub==='count'){
        const count = parseInt(path[2].id,10);
        const rolls = Array.from({length:count},()=>randInt(sides));
        entry = {diceType, sides, count, rolls, sum:rolls.reduce((a,b)=>a+b,0)};
      } else {
        const max = parseInt(path[2].id,10);
        const roll = randInt(sides);
        entry = {diceType, sides, mode:'max', max, roll, success: roll<=max};
      }
    }
    recordAndShareQuickRoll(entry);
    if(session.role==='player' && secretRollActive()){ // тайный бросок: без кости и результата
      el('dpFeedback').innerHTML = '🤫 Тайный бросок ушёл Мастеру — результат знает только он'; el('dpFeedback').className = 'dp-feedback secret'; setTitle('Тайно');
      setTimeout(()=>{ if(myToken===rollToken) closePanel(); }, 1600); return;
    }
    const f = formatQuickRollEntry(entry); // тот же форматтер, что и в общем логе — один источник текста
    launchRollAnimation(entry).then(()=>{
      if(myToken!==rollToken) return; // панель уже открыли/закрыли заново — этот бросок больше не хозяин UI
      const fb = el('dpFeedback');
      fb.innerHTML = f.html; fb.className = 'dp-feedback '+f.cls;
      setTitle('Готово');
      if(stayAtStage){
        // Тот же таймфрейм, что и у обычного закрытия (closePanel ниже — 420мс), чтобы результат
        // "Готово" успевал точно так же мелькнуть перед глазами, а не пропадал мгновенно — просто
        // вместо закрытия панели после паузы возвращаемся на экран последнего выбора (path.pop() —
        // именно тот шаг, что привёл к броску, не весь путь целиком) и рендерим его заново.
        setTimeout(()=>{
          if(myToken!==rollToken) return; // за эти 420мс панель могли закрыть/переоткрыть вручную
          path.pop();
          renderCurrentScreen();
        }, 420);
      } else {
        closePanel();
      }
    });
  }

  function setTitle(t){ el('dpTitle').textContent = t||''; }

  function renderCurrentScreen(){
    cancelGesture();
    locked = false;
    const screen = getScreen();
    state = path.length===0 ? 'OPEN' : 'SELECTING';
    setTitle(screen.title);
    el('dpFeedback').innerHTML=''; el('dpFeedback').className='dp-feedback';
    renderHexGroup(screen.items);
    placePanel(); // высота панели меняется от шага к шагу — держим её в пределах окна у капли
  }
  function renderHexGroup(items){
    const level = el('dpLevel'); level.innerHTML = '';
    const withBack = path.length>0 ? items.concat([{id:'__back__', icon:backIconEl, isBack:true}]) : items;
    const pattern = hexColumnPattern(withBack.length);
    const group = document.createElement('div'); group.className = 'dp-hex-group';
    let idx = 0;
    pattern.forEach(colLen=>{
      const col = document.createElement('div'); col.className = 'dp-hex-col';
      for(let i=0;i<colLen;i++) col.appendChild(buildHexEl(withBack[idx++]));
      group.appendChild(col);
    });
    level.appendChild(group);
  }
  function buildHexEl(item){
    const hex = document.createElement('div');
    hex.className = 'dp-hex' + (item.isBack ? ' dp-back' : '') + (item.tint==='green' ? ' dp-tint-green' : item.tint==='red' ? ' dp-tint-red' : '');
    hex.dataset.id = item.id;
    hex.style.setProperty('--dp-p','0');
    if(item.icon) hex.appendChild(item.icon());
    if(item.label){
      const lab=document.createElement('span');
      lab.className='dp-hex-label'+(item.wordLabel?' dp-hex-label-word':'');
      lab.textContent=item.label; hex.appendChild(lab);
    }
    const prog = document.createElement('div'); prog.className='dp-progress'; hex.appendChild(prog);
    wireHexInteraction(hex, item.id);
    return hex;
  }

  function chooseItem(id){
    if(locked) return;
    cancelGesture();
    if(id==='__back__'){ locked=true; goBack(); return; }
    locked = true;
    path.push({id});
    const next = getScreen();
    if(next) renderCurrentScreen();
    else performRoll();
  }
  function goBack(){
    path.pop();
    renderCurrentScreen();
  }

  function triggerShine(hex){
    hex.classList.remove('dp-shine'); void hex.offsetWidth; hex.classList.add('dp-shine');
    hex.addEventListener('animationend', ()=>hex.classList.remove('dp-shine'), {once:true});
  }
  function triggerConfirmFx(hex){
    hex.classList.add('dp-confirmed');
    hex.addEventListener('animationend', ()=>hex.classList.remove('dp-confirmed'), {once:true});
  }
  function cancelGesture(){
    if(gestureRaf) cancelAnimationFrame(gestureRaf);
    gestureRaf = null;
    if(gestureEl){ gestureEl.classList.remove('dp-gesturing'); gestureEl.style.setProperty('--dp-p','0'); }
    gestureEl = null; gestureId = null;
  }
  function startGesture(hex, id){
    if(locked) return;
    cancelGesture();
    triggerShine(hex);
    gestureEl = hex; gestureId = id; gestureStart = performance.now();
    hex.classList.add('dp-gesturing');
    const tick = (now)=>{
      const p = Math.min(1, (now-gestureStart)/GESTURE_MS);
      hex.style.setProperty('--dp-p', p.toFixed(3));
      if(p>=1){
        hex.classList.remove('dp-gesturing'); hex.style.setProperty('--dp-p','0');
        gestureRaf=null; gestureEl=null; gestureId=null; // до chooseItem — иначе touchend/mouseleave могут сработать по уже сброшенной цели
        triggerConfirmFx(hex);
        chooseItem(id);
        return;
      }
      gestureRaf = requestAnimationFrame(tick);
    };
    gestureRaf = requestAnimationFrame(tick);
  }
  // Клик и жест ведут в один и тот же chooseItem() — единая модель выбора (requirement 3), не два
  // независимых пути. Тач: короткое касание = как клик, удержание ~1с = как наведение (requirement 21).
  function wireHexInteraction(hex, id){
    hex.addEventListener('click', ()=>{ if(locked) return; cancelGesture(); triggerShine(hex); chooseItem(id); });
    // stayAtStage выключает именно НАВЕДЕНИЕ (мышь) — см. комментарий у объявления stayAtStage выше;
    // тач (touchstart ниже) не трогаем: там нет эффекта "курсор случайно остался на гексе после
    // предыдущего клика", ради которого это отключение и делалось.
    hex.addEventListener('mouseenter', ()=>{ if(!stayAtStage && !isDocking()) startGesture(hex, id); });
    hex.addEventListener('mouseleave', ()=>{ if(gestureEl===hex) cancelGesture(); });
    hex.addEventListener('touchstart', (e)=>{ e.preventDefault(); startGesture(hex, id); }, {passive:false});
    hex.addEventListener('touchend', (e)=>{
      e.preventDefault();
      const wasGesturing = gestureEl===hex;
      const elapsed = wasGesturing ? performance.now()-gestureStart : Infinity;
      if(wasGesturing) cancelGesture();
      if(wasGesturing && elapsed < GESTURE_MS) chooseItem(id); // короткое касание — как клик
    }, {passive:false});
    hex.addEventListener('touchcancel', ()=>{ if(gestureEl===hex) cancelGesture(); });
  }

  function openPanel(){
    if(state!=='CLOSED') return;
    rollToken++; // делает недействительным ещё не завершившееся автозакрытие от предыдущего броска (см. performRoll)
    state='OPEN'; path=[]; locked=false;
    el('diceFab').classList.add('open');
    el('dicePanel').classList.add('open');
    renderCurrentScreen();
    placePanel();
  }
  function closePanel(){
    if(state==='CLOSED' || state==='CLOSING') return;
    rollToken++;
    state='CLOSING';
    cancelGesture();
    const panel = el('dicePanel');
    panel.classList.add('closing');
    panel.classList.remove('open');
    el('diceFab').classList.remove('open');
    setTimeout(()=>{
      panel.classList.remove('closing');
      path=[]; locked=false; state='CLOSED';
      el('dpLevel').innerHTML=''; el('dpFeedback').innerHTML=''; el('dpFeedback').className='dp-feedback'; setTitle('');
    }, 420);
  }

  // Открытие/закрытие приближением мыши, без клика (клик по пузырю остаётся как запасной вариант —
  // на тач-устройствах, где "приближения" мыши не существует, это единственный способ открыть).
  // Пока закрыто — сравниваем курсор с кругом вокруг пузыря; пока открыто — с расширенным
  // прямоугольником вокруг самой панели (иначе движение между дальними гексами то и дело
  // проваливалось бы за порог и мигало бы закрытием). Закрытие — с небольшой задержкой (не мгновенно
  // по первому же выходу за границу), чтобы случайный рывок мыши не захлопывал панель.
  const PROXIMITY_OPEN_RADIUS = 130;
  const PROXIMITY_CLOSE_MARGIN = 60;
  const PROXIMITY_CLOSE_DELAY_MS = 400;
  let proximityCloseTimer = null;
  function distanceOutsideRect(x, y, rect, margin){
    const left=rect.left-margin, right=rect.right+margin, top=rect.top-margin, bottom=rect.bottom+margin;
    if(x>=left && x<=right && y>=top && y<=bottom) return 0;
    const dx = x<left ? left-x : x>right ? x-right : 0;
    const dy = y<top ? top-y : y>bottom ? y-bottom : 0;
    return Math.hypot(dx,dy);
  }
  function handleProximityMove(e){
    const x = e.clientX, y = e.clientY;
    if(state==='CLOSED'){
      if(isDocking()) return; // каплю тянут пальцем/мышью — не раскрывать панель под ней
      const r = el('diceFab').getBoundingClientRect();
      const cx = r.left+r.width/2, cy = r.top+r.height/2;
      if(Math.hypot(x-cx, y-cy) <= PROXIMITY_OPEN_RADIUS) openPanel();
      return;
    }
    if(state==='OPEN' || state==='SELECTING'){
      const near = distanceOutsideRect(x,y, el('dicePanel').getBoundingClientRect(), PROXIMITY_CLOSE_MARGIN)===0
                || distanceOutsideRect(x,y, el('diceFab').getBoundingClientRect(), PROXIMITY_CLOSE_MARGIN)===0;
      // stayAtStage — см. комментарий у её объявления — отключает и это автосворачивание целиком, не
      // только продлевает задержку: иначе серия бросков подряд с движением мыши в сторону между ними
      // всё равно рано или поздно закрыла бы панель сама.
      if(near || stayAtStage || isDocking()){
        if(proximityCloseTimer){ clearTimeout(proximityCloseTimer); proximityCloseTimer=null; }
      } else if(!proximityCloseTimer){
        proximityCloseTimer = setTimeout(()=>{
          proximityCloseTimer = null;
          if(state==='OPEN' || state==='SELECTING') closePanel();
        }, PROXIMITY_CLOSE_DELAY_MS);
      }
    }
  }

  /* ---------- Капля и панель — у любого края экрана: общий механизм BlobDock (см. 12b-blob-dock.js) ----------
     Перемещение включается иконкой ✥ в панели (запоминается вместе с позицией); булавка — «ползание» капель. */
  let dockCtl = null;
  const isDocking = ()=>!!(dockCtl && dockCtl.dragging);
  function placePanel(){ if(dockCtl) dockCtl.place(); }
  function initDock(){
    dockCtl = BlobDock.create({ key:'reincarnator_dice_dock_v1', fab:el('diceFab'), panel:el('dicePanel'), edge:'left', pos:0.62, unrotVar:'--dice-unrot',
      isOpen:()=>state!=='CLOSED' && state!=='CLOSING', onDragStart:cancelGesture, dragExclude:'.dp-hex, button',
      moveBtn:el('dicePanel').querySelector('.dp-move-toggle'), pinBtn:el('dicePanel').querySelector('.dp-crawl-pin'),
      moveTitle:(on)=>'Перемещать кубы по краям экрана: ' + (on ? 'включено — тяните панель за свободное место или саму каплю к любому краю' : 'выключено') });
  }

  function init(){
    el('diceFab').addEventListener('click', ()=>{ if(dockCtl && dockCtl.consumeClick()) return; openPanel(); });
    el('dicePanel').querySelector('.dp-close').addEventListener('click', closePanel);
    const pinBtn = el('dicePanel').querySelector('.dp-pin-stage');
    pinBtn.addEventListener('click', ()=>{
      stayAtStage = !stayAtStage;
      pinBtn.classList.toggle('active', stayAtStage);
      // Если таймер сворачивания уже успел запуститься чуть РАНЬШЕ этого клика (курсор отошёл от
      // панели за миг до включения режима) — снимаем его сразу, а не ждём следующего mousemove для
      // handleProximityMove, иначе панель могла бы закрыться уже ПОСЛЕ включения "не закрывать".
      if(stayAtStage && proximityCloseTimer){ clearTimeout(proximityCloseTimer); proximityCloseTimer=null; }
    });
    el('diceFab').querySelector('.blob-icon').appendChild(fabIconEl());
    window.addEventListener('mousemove', handleProximityMove, {passive:true});
    initDock();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { openPanel, closePanel, get state(){return state;}, get path(){return path.slice();} };
})();

function handleIncomingMessage(msg){
  if(!msg || !msg.type) return;
  const fromId = msg.from;
  // Сообщения, которые по смыслу шлёт только Мастер (перезапись листа, выдача удачи/опыта, синхронизация
  // лога и чек-листа), игрок принимает только от того, кого знает как Мастера (session.gmId из gm-hello).
  // Сервер сам ставит from по соединению, подделать его нельзя — раньше любой участник мог, например,
  // переписать чужой лист или начислить опыт всем.
  const fromGm = session.role==='player' && !!fromId && fromId===session.gmId;
  if(typeof SessionExtras!=='undefined' && SessionExtras.handle(msg)) return; // встреча, раздатки, пауза, связь
  if(msg.type==='roll'){
    const entry = sanitizeRollEntry(msg.entry); // см. sanitizeRollEntry — чужие записи только через неё
    if(!entry) return;
    if(entry.priv && session.role==='gm') entry.fromId = fromId || ''; // автор личной записи — по соединению, не по словам
    if(entry.secretStub && session.log.some(x=>x.id + 's'===entry.id)) return; // у Мастера есть сам тайный бросок
    const isNew = addRollLogEntry(entry);
    if(isNew && entry.priv) return; // личное (шёпот, тайный бросок) — никому не пересылается
    console.log('[Бросок] получен по WS', entry.id, 'от', fromId, isNew ? '— добавлен' : '— ОТБРОШЕН как дубликат (совпал id с уже виденным)');
    if(isNew && session.role==='gm') relayRollToAllPlayersExcept(fromId, entry);
  } else if(msg.type==='roll-sync'){
    if(!fromGm) return;
    // silent=true — см. комментарий у addRollLogEntry: сотни save+render подряд здесь были причиной
    // многосекундного подвисания интерфейса ровно в момент подключения игрока.
    let anyNew = false;
    (Array.isArray(msg.entries) ? msg.entries : []).forEach(raw=>{
      const e = sanitizeRollEntry(raw);
      if(e && addRollLogEntry(e, true)) anyNew = true;
    });
    if(anyNew){ saveRollLog(); renderRollLog(); }
  } else if(msg.type==='offer' || msg.type==='answer' || msg.type==='ice-candidate' || msg.type==='room-join' || msg.type==='room-leave'){
    RoomTransport.handleSignal(msg);
  } else if(msg.type==='gm-hello'){
    if(session.role==='player'){
      session.gmId = fromId; session.gmName = msg.name; session.gmNewLevel = Math.min(20, Math.max(1, Math.round(+msg.newLevel || 1)));
      updateSessionStatusUI();
      if(typeof JoinScreen!=='undefined') setTimeout(()=>JoinScreen.onGmHello(), 400); // впервые за этим столом — выбор персонажа
      gtHook(g=>g.onGmHello()); // до sheet-snapshot: запрос стола заодно заново регистрирует игрока у перезагрузившегося Мастера
      sbHook(s=>s.onGmHello()); // снимок саундпада: что играет, где, какие звуки и плейлисты
      sendSheetSnapshotToGM();
      sendOwnRollBackfill(); // броски, сделанные, пока связи не было, иначе так и не дошли бы ни до кого
    }
  } else if(msg.type==='player-hello'){
    if(session.role==='gm'){
      const existed = !!session.players[fromId];
      session.players[fromId] = Object.assign({name:msg.name, character:null, extra:null}, session.players[fromId]);
      session.players[fromId].name = msg.name;
      addToXpRoster(fromId, msg.name); // см. xpRoster — опыт встречи дойдёт и после обрыва дольше 8 с
      renderPlayersList();
      // A personal reply (not just the earlier broadcast on connect) so a player who joins after the
      // GM is already up still learns who the GM is, whatever order the two of them connected in.
      sendMsg({type:'gm-hello', name: session.ownName, newLevel: gmNewCharLevel()}, fromId);
      sendMsg({type:'roll-sync', entries: rollEntriesFor(session.log, fromId)}, fromId); // пороги — только допущенным
      sendLogView(fromId); // вид лога: подробный, если Мастер допустил этого игрока
      if(typeof SessionExtras!=='undefined') SessionExtras.onPlayerHello(fromId); // пауза, список «кому», замер связи
      sendMsg({type:'xp-checklist-sync', checklist: session.xpChecklist}, fromId); // догоняющий игрок сразу видит уже отмеченные деяния этой встречи
      gtHook(g=>g.onPlayerHello(fromId)); // game-table snapshot этому игроку
      sbHook(s=>s.onPlayerHello(fromId)); // soundboard snapshot — музыка догоняет позицию
      resendPendingGrants(fromId, true); // выдачи, не дошедшие до него, пока он был отключён
    }
  } else if(msg.type==='peer-left'){
    RoomTransport.teardownPeer(msg.id);
    if(session.role==='gm' && session.players[msg.id]){ delete session.players[msg.id]; renderPlayersList(); }
    else if(session.role==='player' && msg.id===session.gmId){
      session.gmName = null; updateSessionStatusUI();
    }
    gtHook(g=>g.onPeerLeft(msg.id));
  } else if(msg.type==='sheet-snapshot'){
    if(session.role==='gm' && session.players[fromId] && isValidPayload(msg.payload)){
      session.players[fromId].character = msg.payload.character;
      session.players[fromId].extra = msg.payload.extra;
      if(typeof GmCopies!=='undefined') GmCopies.remember(fromId, session.players[fromId].name, msg.payload); // копия листа у Мастера
      reapplyPendingGrants(fromId); // ещё не подтверждённые выдачи — поверх свежего листа, чтобы копия не откатывалась
      resendPendingGrants(fromId);  // лист пришёл — игрок на связи (в т.ч. после перезагрузки самого Мастера)
      renderPlayersList();
      gtHook(g=>g.onPlayerSheet(fromId)); // HP/Psi жетона игрока — из только что пришедшего листа
    }
  } else if(msg.type==='sheet-push'){
    // isValidPayload — тот же критерий, что при загрузке сохранения: пустой/битый пакет раньше обнулял
    // персонажа в памяти до перезагрузки страницы.
    if(fromGm && isValidPayload(msg.payload)){
      // Лист Мастера уже учитывает эти выдачи (правка шла от его копии, куда они наложены) — отмечаем их
      // применёнными, чтобы досылка из очереди не начислила то же самое второй раз поверх этого листа.
      (Array.isArray(msg.grantsIncluded) ? msg.grantsIncluded : []).forEach(gid=>{
        if(typeof gid!=='string' || !gid) return;
        markGrantApplied(gid);
        sendMsg({type:'grant-ack', gid}, fromId);
      });
      applyLoadedPayload(msg.payload);
      uiToast('Мастер обновил ваш лист персонажа.', {icon:'✎'});
    }
  } else if(msg.type==='sheet-restore-request'){
    // Игрок просит свой лист (новый браузер или очищенные данные) — Мастер выбирает копию
    if(session.role==='gm' && fromId && typeof GmCopies!=='undefined') GmCopies.offer(fromId, String(msg.name || (session.players[fromId] && session.players[fromId].name) || 'Игрок').slice(0, 60));
  } else if(msg.type==='log-view'){
    if(fromGm){ session.logDetailed = !!msg.detailed; renderRollLog(); }
  } else if(msg.type==='roll-sec'){
    // Мастер допустил к порогам во время сессии — пороги уже прошедших атак
    if(fromGm && Array.isArray(msg.list)){ let n = 0; msg.list.slice(0, 200).forEach(x=>{ const e = x && session.log.find(y=>y.id===x.id);
      if(e && (e.mapAttack || e.mapGrenade) && x.sec && typeof x.sec==='object'){ e.sec = {max:Math.round(+x.sec.max || 0), max12:x.sec.max12==null ? null : Math.round(+x.sec.max12 || 0)}; n++; } });
      if(n){ saveRollLog(); renderRollLog(); } }
  } else if(msg.type==='sheet-restore-none'){
    if(fromGm) uiAlert('У Мастера нет сохранённых копий вашего листа. Создайте персонажа заново или загрузите из файла.', {title:'Вернуть у Мастера', icon:'↩'});
  } else if(msg.type==='grant'){
    // Удача/опыт/HP от Мастера — см. раздел ВЫДАЧИ МАСТЕРА С ПОДТВЕРЖДЕНИЕМ.
    if(fromGm) receiveGrant(msg.grant, fromId);
  } else if(msg.type==='grant-ack'){
    if(session.role==='gm' && fromId && typeof msg.gid==='string') acknowledgeGrant(fromId, msg.gid);
  } else if(msg.type==='roll-backfill'){
    // Игрок после переподключения досылает свои последние броски (см. sendOwnRollBackfill). Новые из них
    // Мастер добавляет к себе и одним roll-sync рассылает остальным — дубликаты гасит дедуп по id.
    if(session.role!=='gm' || !fromId) return;
    const fresh = [];
    (Array.isArray(msg.entries) ? msg.entries : []).slice(-200).forEach(raw=>{
      const e = sanitizeRollEntry(raw);
      if(e && addRollLogEntry(e, true)) fresh.push(e);
    });
    if(fresh.length){ saveRollLog(); renderRollLog(); sendMsg({type:'roll-sync', entries: rollEntriesFor(fresh, null)}); }
  } else if(msg.type==='xp-checklist-sync'){
    // Только отображение — сам опыт уже применён (или будет) отдельной выдачей; это сообщение лишь
    // синхронизирует read-only галочки чек-листа у игрока с тем, что реально отметил Мастер.
    const c = msg.checklist;
    const validShape = !!c && Array.isArray(c.minor) && Array.isArray(c.major) && c.minor.length===XP_DEEDS_MINOR.length && c.major.length===XP_DEEDS_MAJOR.length;
    if(fromGm && validShape){
      session.xpChecklist = { minor: c.minor.map(v=>v===true), major: c.major.map(v=>v===true) };
      saveXpChecklist();
      renderXpChecklist();
    }
  } else if(typeof msg.type==='string' && msg.type.indexOf('gt-')===0){
    gtHook(g=>g.handleMessage(msg)); // игровой стол: gt-snapshot/update/command/request/vitals/ping/pointer/drag
  } else if(typeof msg.type==='string' && msg.type.indexOf('sb-')===0){
    sbHook(s=>s.handleMessage(msg)); // саундпад: sb-snapshot/request/music/sound
  }
}
// Постоянный id клиента (переживает переподключение WebSocket) — раньше сервер выдавал СЛУЧАЙНЫЙ id на
// КАЖДОЕ новое соединение (server.js: crypto.randomBytes на каждый upgrade), а любой обрыв WS
// (тоннель cloudflared/ngrok периодически сам рвёт соединения, смена сети на телефоне, недолгая потеря
// сигнала — обычное дело посреди живой игры) означал новый id при реконнекте. Старые RTCPeerConnection
// у ОСТАЛЬНЫХ участников комнаты были адресованы по старому id и не могли узнать о новом — реальный
// баг, который в игре 2026-09-24 выглядел как "подключился ненадолго, но быстро отключило": WS
// реального сокета мог быть сам по себе нестабильным (слабая сеть/тоннель), и каждый его реконнект
// разносил комнату у ВСЕХ. Теперь клиент сам генерирует id один раз, хранит в localStorage и присылает
// его серверу при каждом подключении (server.js использует его вместо случайного, если он есть и не
// занят кем-то ещё живым) — id остаётся тем же и после реконнекта, RTCPeerConnection у других
// участников не считают нас новым человеком, специально разносить комнату (см. RoomTransport в
// ws.onmessage 'welcome' ниже) больше не нужно.
function getOrCreateClientId(){
  const KEY = 'reincarnator_client_id';
  let id = null;
  try{ id = localStorage.getItem(KEY); }catch(e){}
  if(id && /^[a-zA-Z0-9_-]{8,64}$/.test(id)) return id;
  id = (typeof crypto!=='undefined' && crypto.randomUUID) ? crypto.randomUUID()
    : Array.from({length:16}, ()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
  try{ localStorage.setItem(KEY, id); }catch(e){} // приватный режим/квота — не критично, просто не переживёт reload
  return id;
}
// У Мастера свой id (тот же базовый + '-gm'): иначе Мастер и игрок, открытые в одном браузере (обычное
// дело при проверке в одиночку), получали один и тот же id — сервер считал их одним участником, вторая
// вкладка вытесняла первую, а сообщения стола «самому себе» сервер не пересылает. Id игрока не меняется —
// к нему привязаны его жетон на столе и очередь выдач Мастера.
function sessionClientId(role){ const base = getOrCreateClientId(); return role==='gm' ? base + '-gm' : base; }
// ---- Столы: у каждой группы свой стол по ссылке https://адрес/КОД (КОД — 6 символов). Сервер держит
// сообщения внутри стола. «Я — Мастер» на адресе без кода создаёт новый стол (адрес в строке браузера
// меняется на ссылку стола, без перезагрузки). Роль Мастера стола защищена ключом из этого браузера
// (см. server.js: первый Мастер задаёт ключ, с другим ключом — отказ 'gm-denied').
const ROOM_CODE_RE = /^[a-z0-9]{4,16}$/;
let currentRoomCode = (function(){ const m = location.pathname.match(/^\/([a-z0-9]{4,16})\/?$/); return m ? m[1] : ''; })();
function newRoomCode(){
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = '';
  const rnd = (typeof crypto!=='undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(6)) : Array.from({length:6}, ()=>Math.floor(Math.random()*256));
  for(let i=0;i<6;i++) c += abc[rnd[i] % abc.length];
  return c;
}
function setRoomCode(code){
  currentRoomCode = code || '';
  try{ history.replaceState(null, '', '/' + currentRoomCode + location.hash); }catch(e){}
}
function roomLink(){ return location.origin + '/' + (currentRoomCode || ''); }
function gmKeyFor(room){
  const KEY = 'reincarnator_gm_keys_v1', r = room || 'main';
  let keys = {}; try{ keys = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){}
  if(!/^[a-zA-Z0-9]{16,64}$/.test(keys[r] || '')){
    keys[r] = (typeof crypto!=='undefined' && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : Array.from({length:32}, ()=>Math.floor(Math.random()*16).toString(16)).join('');
    try{ localStorage.setItem(KEY, JSON.stringify(keys)); }catch(e){}
  }
  return keys[r];
}
// Код стола из того, что ввёл игрок: сама ссылка Мастера или только код
function parseRoomInput(t){
  t = String(t || '').trim().toLowerCase();
  const m = t.match(/\/([a-z0-9]{4,16})\/?(?:[?#].*)?$/) || t.match(/^([a-z0-9]{4,16})$/);
  return m && ROOM_CODE_RE.test(m[1]) ? m[1] : '';
}
function wsUrl(role){
  return (location.protocol==='https:' ? 'wss://' : 'ws://') + location.host + '/?cid=' + encodeURIComponent(sessionClientId(role)) +
    '&room=' + encodeURIComponent(currentRoomCode) + (role==='gm' ? '&gmkey=' + gmKeyFor(currentRoomCode) : '');
}
// Уровень персонажа для новых игроков (экран Мастера → «Игроки») — уходит игрокам в приветствии Мастера
function gmNewCharLevel(){ try{ const p = JSON.parse(localStorage.getItem('reincarnator_gm_screen_v1') || '{}'); return Math.min(20, Math.max(1, Math.round(+p.newLevel || 1))); }catch(e){ return 1; } }
// «Я — Мастер»: без кода в адресе — новый стол со своей ссылкой
function startAsGm(){
  if(!currentRoomCode) setRoomCode(newRoomCode());
  connectSession('gm');
}
// «Я — игрок»: без кода в адресе — спросить ссылку или код
async function startAsPlayer(){
  if(!currentRoomCode){
    const t = await uiPrompt('Вставьте ссылку на стол, которую прислал Мастер, или её код — 6 символов в конце ссылки.', '', {title:'Ваш стол', ok:'Войти', placeholder:'например, k7m2qx'});
    if(t===null) return;
    const code = parseRoomInput(t);
    if(!code){ uiAlert('Не похоже на ссылку стола: в конце ссылки Мастера должен быть код из латинских букв и цифр, например …/k7m2qx.', {title:'Ваш стол', icon:'?'}); return; }
    setRoomCode(code);
  }
  connectSession('player');
}
// Сервер отказал в роли Мастера: у этого стола уже есть Мастер из другого браузера
async function handleGmDenied(){
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  stopHeartbeat();
  session.role = null; session.ws = null; session.myId = null; session.players = {};
  clearSessionState(); updateSessionStatusUI();
  const r = await uiDialog({title:'У этого стола уже есть Мастер', icon:'!', danger:true,
    text:'Мастер стола входит только из того браузера, где стол был создан. Создайте свой стол — получите новую ссылку для игроков — или войдите сюда игроком.',
    cancelValue:null, buttons:[{label:'Отмена', value:null}, {label:'Войти игроком', value:'player'}, {label:'Создать свой стол', value:'new', primary:true}]});
  if(r==='new'){ setRoomCode(newRoomCode()); connectSession('gm'); }
  else if(r==='player') connectSession('player');
}
let _reconnectTimer = null;
let _reconnectDelay = 2000;
// Сигнал «я жив» раз в 20 с (сервер отвечает 'hb-ack' и никуда его не пересылает). Две задачи: сервер
// по нему (и по pong) замечает тихо пропавших клиентов, а сам лист — тихо пропавший сервер: если ответ
// на ПРЕДЫДУЩИЙ сигнал так и не пришёл, соединение считается мёртвым и переустанавливается (браузер сам
// может минутами считать такой сокет открытым, а sendMsg всё это время молча отправлял бы в пустоту).
// Сравниваем именно «ответ на прошлый сигнал», а не «тишину N секунд»: в фоновой вкладке браузер
// замедляет таймеры до раза в минуту, и проверка по времени давала бы ложные переподключения. Проверка
// включается только после первого hb-ack — со старым server.js (который не отвечает) ничего не рвётся.
// Мёртвым соединение считается только после ДВУХ сигналов подряд без ответа и 45 с полной тишины: фоновую
// вкладку браузер может ненадолго «заморозить», и после разморозки таймер срабатывает раньше, чем
// обрабатываются уже пришедшие ответы, — одиночный «пропуск» тогда ложный.
// Отдельно раз в 4 минуты — обычный HTTP-запрос /healthz: бесплатный хостинг (Bonto) усыпляет приложение
// после 30 минут «неактивности» и WebSocket-трафик ею может не считать — сон рвал бы игру у всех разом.
let _hbTimer = null, _awakeTimer = null;
function stopHeartbeat(){
  if(_hbTimer){ clearInterval(_hbTimer); _hbTimer = null; }
  if(_awakeTimer){ clearInterval(_awakeTimer); _awakeTimer = null; }
}
function startHeartbeat(ws){
  stopHeartbeat();
  ws._lastHeard = Date.now(); ws._hbSentAt = 0; ws._hbMissed = 0; ws._serverHb = false;
  _awakeTimer = setInterval(()=>{
    if(session.ws!==ws || ws.readyState!==WebSocket.OPEN) return;
    try{ fetch('/healthz?t=' + Date.now(), {cache:'no-store'}).catch(()=>{}); }catch(e){}
  }, 4*60*1000);
  _hbTimer = setInterval(()=>{
    if(session.ws!==ws || ws.readyState!==WebSocket.OPEN){ stopHeartbeat(); return; }
    if(ws._serverHb && ws._hbSentAt) ws._hbMissed = ws._lastHeard < ws._hbSentAt ? (ws._hbMissed||0) + 1 : 0;
    if(ws._hbMissed >= 2 && Date.now() - ws._lastHeard > 45000){
      console.warn('[Сессия] Сервер не ответил на сигнал связи — соединение считается оборванным, переподключаемся');
      stopHeartbeat();
      const onclose = ws.onclose;
      ws.onclose = null; ws.onmessage = null; ws.onerror = null;
      try{ ws.close(); }catch(e){}
      if(onclose) onclose(); // тот же путь, что при обычном обрыве: пауза и connectSession
      return;
    }
    try{ ws.send(JSON.stringify({type:'hb'})); ws._hbSentAt = Date.now(); }catch(e){}
  }, 20000);
}
function connectSession(role){
  if(!sessionAvailable()){ uiAlert('Этот браузер не поддерживает WebSocket — совместная сессия недоступна, но лист продолжает работать как обычно.'); return; }
  if(location.protocol==='file:'){
    uiAlert('Лист открыт напрямую (двойным кликом), а не через сервер — совместная сессия работает только когда лист открыт по ссылке, которую даёт server.js/start.bat (см. инструкцию рядом с файлом листа).');
    return;
  }
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  if(session.ws){
    // Защита от «осиротевшего» сокета: если connectSession вызвали повторно, пока предыдущее
    // соединение ещё живо (например restoreSessionIfPresent() при загрузке страницы гонится с
    // ручным подключением, или два клика подряд по "Я — игрок") — старый сокет иначе никогда явно
    // не закрывается и остаётся зомби-клиентом на сервере: сервер продолжает считать его отдельным
    // живым участником и слать ему рассылки, хотя эта вкладка уже открыла новое соединение.
    const old = session.ws;
    old.onclose = null; old.onerror = null; old.onmessage = null;
    try{ old.close(); }catch(e){}
  }
  session.role = role;
  session.ownName = document.getElementById('sessionOwnName').value.trim() || (role==='gm' ? 'Мастер' : 'Игрок');
  document.getElementById('sessionSetupHint').textContent = 'Подключение…';
  const ws = new WebSocket(wsUrl(role));
  session.ws = ws;
  ws.onopen = ()=>{ console.log('[Сессия] WebSocket открыт'); };
  ws.onmessage = (ev)=>{
    let msg; try{ msg = JSON.parse(ev.data); }catch(e){ return; }
    if(!msg || typeof msg!=='object') return;
    ws._lastHeard = Date.now(); // см. startHeartbeat
    if(msg.type==='hb-ack' && msg.from==='server'){ ws._serverHb = true; return; }
    if(msg.type==='welcome'){
      session.myId = msg.id;
      if(typeof ServerCheck!=='undefined') ServerCheck.onWelcome(msg); // сервер старой версии — предупредить
      startHeartbeat(ws);
      console.log('[Сессия] Подключено, id=', msg.id);
      document.getElementById('sessionSetupHint').textContent = '';
      _reconnectDelay = 2000; // успешное подключение сбрасывает нарастающую паузу для следующего возможного обрыва
      sendMsg(role==='gm' ? {type:'gm-hello', name: session.ownName, newLevel: gmNewCharLevel()} : {type:'player-hello', name: session.ownName});
      // Мастер после (пере)подключения — свои последние броски всем: сделанные во время его обрыва иначе
      // не дошли бы до игроков (игроки свои досылают сами, см. sendOwnRollBackfill). Идёт следом за
      // gm-hello по тому же сокету — к этому моменту игроки уже знают, что это Мастер (roll-sync только от него).
      if(role==='gm') sendMsg({type:'roll-sync', entries: rollEntriesFor(session.log.slice(-100), null)}); // всем сразу — без порогов
      updateSessionStatusUI();
      saveSessionState(); // remembered across refresh/reopen — see restoreSessionIfPresent()
      // Раньше здесь стояло RoomTransport.leaveRoom()+joinRoom() — потому что id раньше менялся на
      // каждый реконнект (см. комментарий у getOrCreateClientId/wsUrl выше), и старые PeerConnection'ы
      // у ОСТАЛЬНЫХ участников оставались адресованы по уже недействительному id. Теперь id постоянный
      // (сервер получает его через ?cid= и переиспользует), поэтому сам факт обрыва/переподключения WS
      // не делает нас "новым человеком" для остальных — их RTCPeerConnection к нам не протухают, просто
      // не могли слать сигналинг, пока наш WS был недоступен (см. sendMsg: тихо ничего не делает без
      // открытого сокета, не ставит сообщения в очередь). resyncAfterReconnect подталкивает досогласовать
      // только те соединения, что не в 'connected' — то есть либо сами уже это заметили и сами
      // восстановятся (pc.onconnectionstatechange уже вызывает restartIce на 'failed'), либо застряли
      // именно из-за потерянного во время обрыва сообщения (оффер/ICE-кандидат, которому некуда было
      // уйти) — полностью рвать и пересобирать всю комнату, как раньше, для этого больше не нужно.
      if(RoomTransport.isJoined()) RoomTransport.resyncAfterReconnect();
      return;
    }
    if(msg.type==='replaced' && msg.from==='server'){ ws._replaced = true; return; } // см. onclose ниже
    if(msg.type==='gm-denied' && msg.from==='server'){ ws._gmDenied = true; return; } // см. onclose ниже
    handleIncomingMessage(msg);
  };
  ws.onclose = ()=>{
    console.warn('[Сессия] Соединение с сервером закрыто');
    if(session.ws===ws) stopHeartbeat();
    if(ws._replaced){ handleReplacedByOtherTab(); return; }
    if(ws._gmDenied){ if(session.ws===ws) handleGmDenied(); return; }
    document.getElementById('sessionSetupHint').textContent = '';
    // leaveSession() уже обнуляет session.role синхронно ДО закрытия сокета — значит, если он всё ещё
    // задан к моменту срабатывания onclose, это не явный выход, а обрыв связи (сеть моргнула, сервер
    // перезапустился и т.п.), и стоит попробовать переподключиться тем же кодом, каким шло исходное
    // подключение (см. connectSession выше) — с нарастающей паузой, чтобы не долбить сервер непрерывно.
    if(session.role){
      const delay = _reconnectDelay;
      _reconnectDelay = Math.min(_reconnectDelay * 1.5, 10000); // не дольше 10 с: хостинг просыпается за ~2 с, долгие паузы только затягивали возврат в игру
      _reconnectTimer = setTimeout(()=>connectSession(role), delay);
    }
    updateSessionStatusUI();
  };
  ws.onerror = (err)=>{
    console.error('[Сессия] Ошибка WebSocket:', err);
    document.getElementById('sessionSetupHint').textContent =
      'Не удалось подключиться к серверу. Если вы Мастер — проверьте, что server.js запущен (start.bat). Если вы игрок — проверьте ссылку у Мастера.';
  };
}
// Сервер закрыл это соединение, потому что с тем же id подключилось другое — почти всегда это вторая
// вкладка того же браузера (id клиента лежит в общем для вкладок localStorage, а сессия
// восстанавливается сама при открытии). Раньше вытесненная вкладка через 2 с переподключалась и в свою
// очередь выбивала новую — бесконечно. Теперь она просто отключается локально: роль и сохранённое
// состояние сессии НЕ стираются (им пользуется активная вкладка), а вернуть сессию сюда можно тем же
// «Я — Мастер»/«Я — игрок» — тогда уже отключится другая вкладка.
function handleReplacedByOtherTab(){
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  stopHeartbeat();
  RoomTransport.leaveRoom();
  if(session.editingPlayerId) exitGmEditMode();
  session.role=null; session.ws=null; session.myId=null; session.players={}; session.gmId=null; session.gmName=null;
  updateSessionStatusUI();
  document.getElementById('sessionSetupHint').textContent =
    'Сессия открыта в другой вкладке этого браузера, здесь она отключена. Чтобы продолжить здесь — нажмите «Я — Мастер» или «Я — игрок».';
}
// Сеть вернулась или вкладка снова на экране — не ждать очередной паузы переподключения, а сразу. Для
// уже живого соединения — сбросить счёт сигналов связи: после долгого сна вкладки он мог устареть.
function reconnectNowIfWaiting(){
  if(session.ws && session.ws.readyState===WebSocket.OPEN){ session.ws._hbSentAt = 0; session.ws._hbMissed = 0; return; }
  if(!session.role || !_reconnectTimer) return;
  clearTimeout(_reconnectTimer); _reconnectTimer = null;
  _reconnectDelay = 2000;
  connectSession(session.role);
}
window.addEventListener('online', reconnectNowIfWaiting);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') reconnectNowIfWaiting(); });
function leaveSession(){
  if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  stopHeartbeat();
  RoomTransport.leaveRoom(); // закрыть медиа/каналы ДО закрытия сокета — иначе некому отправить room-leave
  if(session.ws){ try{ session.ws.close(); }catch(e){} }
  session.role=null; session.ws=null; session.myId=null; session.players={}; session.gmId=null; session.gmName=null;
  if(session.editingPlayerId) exitGmEditMode();
  clearSessionState(); // an explicit "leave" should NOT reconnect on the next visit
  updateSessionStatusUI();
}
// Player → GM: full character sync, sent on connect and whenever the sheet actually changes
// (piggybacks on renderAll()'s own change-detection — see its call to this function below) — so the
// GM always has a reasonably fresh copy ready to load into edit mode, without the player doing anything.
function sendSheetSnapshotToGM(){
  if(session.role!=='player' || !character || !session.gmId) return;
  sendMsg({type:'sheet-snapshot', payload: buildSavePayload()}, session.gmId);
}
// Player → GM после каждого (пере)подключения: свои последние броски. sendMsg без открытого сокета
// ничего не ставит в очередь, поэтому бросок, сделанный во время обрыва, раньше оставался только у
// самого игрока. Шлём все свои недавние — Мастер сам отсеет уже виденные (дедуп по id).
function sendOwnRollBackfill(){
  if(session.role!=='player' || !session.gmId) return;
  const prefix = getDeviceId()+':';
  const own = session.log.filter(e=>typeof e.id==='string' && e.id.indexOf(prefix)===0).slice(-100);
  if(own.length) sendMsg({type:'roll-backfill', entries: own}, session.gmId);
}
function enterGmEditMode(playerId){
  const p = session.players[playerId];
  if(!p || !p.character){ uiAlert('От этого игрока ещё не пришёл лист персонажа.'); return; }
  if(session.editingPlayerId){ uiAlert('Уже редактируется лист другого игрока — сначала отправьте или отмените.'); return; }
  session.editingBackup = character ? { payload: buildSavePayload() } : null;
  session.editingPlayerId = playerId;
  // Лист игрока на момент начала правки — «общий предок» для слияния при отправке (см. mergeEditedSheet)
  session.editingBase = JSON.parse(JSON.stringify({character: p.character, extra: p.extra || {}}));
  applyLoadedPayload({character: JSON.parse(JSON.stringify(p.character)), extra: p.extra});
  renderGmEditBanner();
}
function exitGmEditMode(){
  const backup = session.editingBackup;
  session.editingPlayerId = null; session.editingBackup = null; session.editingBase = null;
  if(backup) applyLoadedPayload(backup.payload);
  else { character = null; document.getElementById('fName').value=''; document.getElementById('fPlayer').value=''; renderAll(); }
  renderGmEditBanner();
}
// Трёхстороннее слияние листа при отправке правки Мастера: base — лист игрока в момент открытия правки,
// mine — что получилось у Мастера, theirs — самый свежий лист от игрока (включая всё, что тот поменял за
// время правки, и наложенные выдачи). Поле, которое трогал только один из двух, берётся у него; поле,
// изменённое обоими по-разному, — конфликт (побеждает Мастер, но его спрашивают). Вложенные объекты
// (инвентарь, характеристики, состояния…) сливаются по своим полям, массивы — целиком. Журнал изменений —
// журнал игрока плюс новые записи, появившиеся за правку у Мастера.
const SHEET_FIELD_LABELS = {
  hpCurrent:'здоровье', psiCurrent:'пси-запас', luck:'удача', xp:'опыт', inventory:'инвентарь', weapons:'оружие',
  armor:'броня', states:'состояния', conditionsNotes:'состояния и травмы', credits:'кредиты', creditsLog:'кредиты',
  stats:'характеристики', abilities:'способности', level:'уровень', notes:'заметки', size:'размер',
  appearance:'внешность', advantages:'преимущества', flaws:'недостатки', name:'имя персонажа', player:'игрок'
};
function mergeEditedSheet(base, mine, theirs){
  const same = (a, b)=> JSON.stringify(a)===JSON.stringify(b);
  const isObj = (v)=> !!v && typeof v==='object' && !Array.isArray(v);
  const conflicts = new Set();
  function merge(b, m, t, topKey){
    if(isObj(b) && isObj(m) && isObj(t)){
      const out = {};
      new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)]).forEach(k=>{
        const v = merge(b[k], m[k], t[k], topKey || k);
        if(v!==undefined) out[k] = v;
      });
      return out;
    }
    if(same(m, b)) return t;               // Мастер не трогал — свежее от игрока
    if(same(t, b) || same(t, m)) return m; // игрок не трогал (или сделал то же самое) — правка Мастера
    conflicts.add(SHEET_FIELD_LABELS[topKey] || topKey);
    return m;
  }
  const bc = base.character || {}, mc = mine.character || {}, tc = theirs.character || {};
  const character = merge(
    Object.assign({}, bc, {history:undefined}), Object.assign({}, mc, {history:undefined}), Object.assign({}, tc, {history:undefined}), null);
  const seen = new Set((bc.history||[]).map(h=>JSON.stringify(h)));
  character.history = (tc.history||[]).concat((mc.history||[]).filter(h=>!seen.has(JSON.stringify(h)))).slice(-500);
  const extra = merge(base.extra||{}, mine.extra||{}, theirs.extra||{}, null);
  return {character, extra, conflicts: [...conflicts]};
}
async function sendEditedSheetToPlayer(){
  const playerId = session.editingPlayerId;
  const p = session.players[playerId];
  if(!p){ exitGmEditMode(); return; }
  const payload = buildSavePayload();
  // Пока Мастер правил, игрок мог сам что-то изменить (HP в бою, потратить предмет), а Мастер — выдать
  // ему удачу/опыт: раньше отправка целиком затирала всё это версией, открытой в начале правки.
  if(session.editingBase && p.character){
    const m = mergeEditedSheet(session.editingBase, payload, {character: p.character, extra: p.extra || {}});
    if(m.conflicts.length && !(await uiConfirm(
      `Пока вы правили лист, игрок сам изменил то же, что и вы: ${m.conflicts.join(', ')}.\n\n` +
      `«Отправить мои» — ваши значения этих полей (остальные изменения игрока сохранятся).`, {title:'Изменения игрока', ok:'Отправить мои', cancel:'Вернуться к правке'}))) return;
    payload.character = m.character; payload.extra = m.extra;
  }
  const grantsIncluded = pendingGrants(playerId).map(g=>g.gid); // уже наложены на копию — см. обработку sheet-push у игрока
  sendMsg({type:'sheet-push', payload, grantsIncluded}, playerId);
  p.character = payload.character; p.extra = payload.extra; // GM's own copy reflects the push immediately
  exitGmEditMode();
  renderPlayersList();
}
function renderGmEditBanner(){
  const el = document.getElementById('gmEditBanner');
  if(!session.editingPlayerId){ el.style.display='none'; el.innerHTML=''; return; }
  const p = session.players[session.editingPlayerId];
  el.style.display='flex';
  el.innerHTML = `<span>✎ Вы правите лист игрока «${escapeHtml(p&&p.name||'?')}». Правки сохранятся только у него, после отправки.</span>
    <button class="small" id="btnSendEditedSheet">Отправить игроку</button>
    <button class="small" id="btnCancelEditedSheet">Отмена</button>`;
  document.getElementById('btnSendEditedSheet').onclick = sendEditedSheetToPlayer;
  document.getElementById('btnCancelEditedSheet').onclick = exitGmEditMode;
}
document.getElementById('btnStartGM').addEventListener('click', startAsGm);
document.getElementById('btnStartPlayer').addEventListener('click', startAsPlayer);
document.getElementById('btnCopyRoomLink').addEventListener('click', ()=>{
  const link = roomLink(), manual = ()=>uiPrompt('Скопируйте ссылку на стол:', link, {title:'Ссылка для игроков', ok:'Готово'});
  try{ navigator.clipboard.writeText(link).then(()=>uiToast('Ссылка на стол скопирована — отправьте её игрокам', {icon:'⧉'}), manual); }catch(e){ manual(); }
});
{ // подсказка до подключения: на чьём столе мы
  const h = document.getElementById('sessionSetupHint');
  if(h && !h.textContent) h.textContent = currentRoomCode ? `Стол «${currentRoomCode}» — введите имя и нажмите «Я — игрок» (или «Я — Мастер», если это ваш стол).`
    : '«Я — Мастер» создаст ваш стол со своей ссылкой для игроков. Игрокам — ссылка от Мастера.';
}
document.getElementById('btnLeaveSession').addEventListener('click', ()=>{ uiConfirm('Выйти из сессии?', {title:'Сессия', ok:'Выйти'}).then(ok=>{ if(ok) leaveSession(); }); });
document.getElementById('btnRoomJoin').addEventListener('click', ()=>RoomTransport.joinRoom());
document.getElementById('btnRoomLeave').addEventListener('click', ()=>RoomTransport.leaveRoom());
document.getElementById('btnRoomMic').addEventListener('click', ()=>RoomTransport.setMic(!RoomTransport.micWanted));
document.getElementById('btnRoomCam').addEventListener('click', ()=>RoomTransport.setCam(!RoomTransport.camWanted));
document.getElementById('btnRoomPin').addEventListener('click', ()=>RoomFocusMode.togglePinned());
window.addEventListener('beforeunload', ()=>{ if(session.ws){ try{ session.ws.close(); }catch(e){} } });
updateSessionStatusUI();

// Страховка от случайного обновления/закрытия вкладки: сначала восстанавливаем персонажа (если
// был), потом — если браузер до этого был подключён к сессии — переподключаемся тем же кодом,
// каким и обычная кнопка "Я — Мастер"/"Я — игрок" (см. connectSession). Порядок специально такой:
// sendSheetSnapshotToGM() (сработает при первом же изменении после переподключения) должен застать
// персонажа уже загруженным.
loadAutosaveIfPresent();
restoreSessionIfPresent();

renderAll();
