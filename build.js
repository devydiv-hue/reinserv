// Сборка приложения из исходников src/ в единый HTML (его раздаёт server.js и он же уходит на хостинг).
//   node build.js           — собрать reincarnator_sheet_27_psi_cultist_shaman_final.html из src/
//   node build.js --check   — только проверить, что HTML совпадает с исходниками (не правили ли его в обход src/)
//   node build.js --line N  — строка N собранного HTML (например, из красной плашки ошибки) → файл и строка в src/
// Правят только src/: шаблон страницы src/index.html, стили src/styles/*.css, скрипты src/scripts/**.js. В шаблоне
// строка «/*@include путь*/» заменяется содержимым файла как есть. Скрипты — обычные (не ES-модули): куски одного
// блока <script> склеиваются подряд, поэтому общая глобальная область, порядок выполнения и inline-обработчики
// onclick="…" работают ровно как в едином файле. Никаких зависимостей — только встроенные модули Node.js.
'use strict';
const fs = require('fs'), path = require('path');
const OUT_NAME = 'reincarnator_sheet_27_psi_cultist_shaman_final.html';
const INCLUDE_RE = /^[ \t]*\/\*@include ([^*\r\n]+)\*\/[ \t]*\r?\n/gm;

// template — текст src/index.html, read(путь) — текст файла; возвращает собранный HTML (переводы строк — \n)
function build(template, read, map){
  let out = '', last = 0, m;
  const norm = (t)=>String(t).replace(/\r\n/g, '\n');
  template = norm(template); INCLUDE_RE.lastIndex = 0;
  while((m = INCLUDE_RE.exec(template))){
    out += template.slice(last, m.index);
    const body = norm(read(m[1].trim()));
    if(map) map.push({file:m[1].trim(), startLine:out.split('\n').length, lines:body.split('\n').length - (body.endsWith('\n') ? 1 : 0)});
    out += body; last = m.index + m[0].length;
  }
  return out + template.slice(last);
}
module.exports = { build };

if(require.main === module){
  const ROOT = __dirname, SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, OUT_NAME);
  const args = process.argv.slice(2);
  const tplPath = path.join(SRC, 'index.html');
  if(!fs.existsSync(tplPath)){ console.error('Нет src/index.html — исходники не найдены.'); process.exit(1); }
  const map = [];
  const html = build(fs.readFileSync(tplPath, 'utf8'), (p)=>{
    const full = path.join(SRC, p);
    if(!full.startsWith(SRC) || !fs.existsSync(full)) throw new Error('Нет файла src/' + p + ' (указан в src/index.html)');
    return fs.readFileSync(full, 'utf8');
  }, map);
  if(args[0]==='--line'){
    const n = parseInt(args[1], 10); if(!n){ console.error('Укажите номер строки: node build.js --line 12345'); process.exit(1); }
    const hit = map.find(x=>n >= x.startLine && n < x.startLine + x.lines);
    console.log(hit ? `Строка ${n} собранного HTML → src/${hit.file}:${n - hit.startLine + 1}` : `Строка ${n} — в самом шаблоне src/index.html (разметка), не во включённом файле`);
    process.exit(0);
  }
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : null;
  if(args[0]==='--check'){
    if(cur === html){ console.log('OK: ' + OUT_NAME + ' совпадает с исходниками src/.'); process.exit(0); }
    console.error('ОТЛИЧАЕТСЯ: ' + OUT_NAME + ' не совпадает с src/. Либо его правили в обход src/ (перенесите правки в src/),\n' +
      'либо после правок src/ не запускали сборку (node build.js).'); process.exit(1);
  }
  if(cur === html){ console.log('Без изменений: ' + OUT_NAME); process.exit(0); }
  fs.writeFileSync(OUT, html);
  console.log('Собрано: ' + OUT_NAME + ' (' + (Buffer.byteLength(html)/1024/1024).toFixed(2) + ' МБ, файлов: ' + map.length + ')');
}
