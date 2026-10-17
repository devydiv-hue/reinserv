// ОДНОРАЗОВАЯ (уже выполнена) разрезка единого HTML на исходники в src/ (шаблон + стили + скрипты). Запуск: node tools/split.js
// После разрезки правят файлы в src/, а HTML собирает build.js. Скрипты НЕ превращаются в ES-модули: куски одного
// блока <script> при сборке просто склеиваются обратно — общая глобальная область, порядок и inline-обработчики
// (onclick="…") работают как раньше. Перед записью проверяется, что сборка даёт тот же текст, что и исходный файл.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'reincarnator_sheet_27_psi_cultist_shaman_final.html');
const SRC = path.join(ROOT, 'src');
const { build } = require('../build.js');
const NL = '\n';

// Разрезка уже выполнена (18.10.2026): исходники правят в src/, а страницу собирает build.js. Повторный запуск затёр бы src/.
if(fs.existsSync(path.join(SRC, 'index.html')) && process.argv[2]!=='--force'){
  console.error('src/ уже есть — правьте исходники там и собирайте страницу командой node build.js. Повторная разрезка затёрла бы src/ (если очень нужно: --force).');
  process.exit(1);
}
const html = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, NL);

// Куски стилей: по заголовкам разделов «/* ====…» + хвост с последними добавлениями
const CSS_PARTS = [
  ['ЛИЧНОЕ ДЕЛО РЕИНКАРНАТА', '01-base.css'] // вступление до него — 00-fonts.css (переименован после разрезки),
  ['ФАКТУРЫ «АНАТОМИЧЕСКОГО АТЛАСА»', '02-textures-and-sheet.css'],
  ['Объёмная (CSS 3D) фигура', '03-body-figure.css'],
  ['DicePanel — боковая панель', '04-dice-panel.css'],
  ['Полноэкранная сцена броска', '05-roll-scene.css'],
  ['ИГРОВОЙ СТОЛ (#tableTabView', '06-game-table.css'],
  ['САУНДПАД (#soundTabView', '07-soundboard.css'],
  ['РЕДАКТОР КАРТ (#mapEditorView', '08-map-editor.css'],
  ['@TAIL@  /* Свои окна (uiAlert', '09-dialogs-play-gm.css']
];
// Куски главного скрипта: по заголовкам разделов
const MAIN_PARTS = [
  ['DATA MODEL', '01-data-model.js'],
  ['ENGINE', '02-engine.js'],
  ['RENDERING', '03-rendering-and-rolls.js'],
  ['Ссылки на бросок характеристики', '04-roll-links-saves-rumor-items.js'],
  ['Зоны защиты брони', '05-armor-weapons-attack.js'],
  ['Объёмная (CSS 3D) фигура', '06-body-figure-3d.js'],
  ['Всплывающее окно переброса', '07-reroll-and-render.js'],
  ['EVENTS', '08-events.js'],
  ['SAVE / LOAD', '09-save-load-sheet-ui.js'],
  ['СОВМЕСТНАЯ СЕССИЯ', '10-session-xp.js'],
  ['НАХОДКИ', '11-loot-grants.js'],
  ['RoomTransport', '12-room-voice-video.js'],
  ['Полноэкранная анимация броска', '13-dice-panel.js']
];
// Блоки <script> по порядку в странице; «main» режется на части выше
const BLOCK_NAMES = ['00-boot-error-banner.js', '01-ui-dialogs.js', 'main', '03-map-kit.js', '04-map-editor.js', '05-game-table.js',
  '06-bestiary.js', '07-soundboard.js', '08-sheet-masonry.js', '09-play-mode.js', '10-gm-screen.js', '11-pwa.js', '12-tips.js', '13-gm-advice.js', '14-onboarding.js'];

const escRe = (t)=>t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Режет text по строкам-заголовкам «/* ====» (с отступом indentRe), за которыми идёт строка с заголовком title.
// Каждый кусок начинается с начала строки и заканчивается переводом строки.
function cutBy(text, parts, indentRe){
  const cuts = [];
  parts.forEach(([title, file])=>{
    let pos;
    if(title.startsWith('@TAIL@')){ pos = text.indexOf(NL + title.slice(6)); if(pos >= 0) pos += 1; }
    else {
      const re = new RegExp('\\n' + indentRe + '/\\* ={10,}[^\\n]*\\n[ \\t]*' + escRe(title));
      const m = re.exec(NL + text); pos = m ? m.index : -1; // m.index в NL+text = начало строки заголовка в text
    }
    if(pos < 0) throw new Error('Не найден раздел: ' + title);
    cuts.push([pos, file]);
  });
  cuts.sort((a, b)=>a[0] - b[0]);
  const out = [];
  if(cuts[0][0] > 0) out.push([cuts[0][1].replace(/^\d+/, '00'), text.slice(0, cuts[0][0])]); // вступление до первого раздела
  cuts.forEach(([pos, file], i)=>out.push([file, text.slice(pos, i + 1 < cuts.length ? cuts[i + 1][0] : text.length)]));
  return out;
}

const files = {}; // путь в src → содержимое
let template = '', rest = html, blockIdx = 0;
function addParts(dir, parts){ let tpl = ''; parts.forEach(([f, t])=>{ files[dir + f] = t; tpl += '/*@include ' + dir + f + '*/' + NL; }); return tpl; }
for(;;){
  const iStyle = rest.indexOf('<style>'), iScript = rest.indexOf('<script>');
  if(iStyle < 0 && iScript < 0){ template += rest; break; }
  const isStyle = iStyle >= 0 && (iScript < 0 || iStyle < iScript);
  const open = isStyle ? '<style>' : '<script>', close = isStyle ? '</style>' : '</script>';
  const a = (isStyle ? iStyle : iScript) + open.length, b = rest.indexOf(close, a);
  const body = rest.slice(a, b);
  if(!body.startsWith(NL)) throw new Error('блок должен начинаться с новой строки: ' + open);
  const inner = body.slice(1); // ведущий перевод строки остаётся в шаблоне
  let tpl = rest.slice(0, a) + NL;
  if(isStyle) tpl += addParts('styles/', cutBy(inner, CSS_PARTS, '[ \\t]*'));
  else {
    const name = BLOCK_NAMES[blockIdx++]; if(!name) throw new Error('лишний блок <script>');
    if(name==='main') tpl += addParts('scripts/02-main/', cutBy(inner, MAIN_PARTS, ''));
    else tpl += addParts('scripts/', [[name, inner]]);
  }
  template += tpl; rest = rest.slice(b);
}
if(blockIdx !== BLOCK_NAMES.length) throw new Error('блоков <script> меньше, чем имён: ' + blockIdx);

// проверка: сборка из этих частей = исходный файл
const rebuilt = build(template, (p)=>{ if(!(p in files)) throw new Error('нет файла ' + p); return files[p]; });
if(rebuilt !== html){
  let i = 0; while(i < html.length && html[i]===rebuilt[i]) i++;
  throw new Error('Сборка не совпала с исходником на символе ' + i + ': «' + html.slice(i - 40, i + 40) + '» / «' + rebuilt.slice(i - 40, i + 40) + '»');
}
fs.mkdirSync(path.join(SRC, 'styles'), { recursive: true });
fs.mkdirSync(path.join(SRC, 'scripts', '02-main'), { recursive: true });
fs.writeFileSync(path.join(SRC, 'index.html'), template);
Object.keys(files).forEach(p=>fs.writeFileSync(path.join(SRC, p), files[p]));
console.log('Готово: src/index.html (' + template.split(NL).length + ' строк) + ' + Object.keys(files).length + ' файлов; сборка совпадает с исходником символ в символ.');
Object.keys(files).forEach(p=>console.log('  ' + p + '  (' + files[p].split(NL).length + ' строк)'));
