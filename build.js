// Сборка приложения из исходников src/ в готовые HTML-страницы (их раздаёт server.js и они же уходят на хостинг).
//   node build.js                — собрать все страницы
//   node build.js --check        — только проверить, что страницы совпадают с исходниками (не правили ли их в обход src/)
//   node build.js --line N [стр] — строка N собранной страницы (например, из красной плашки ошибки) → файл и строка в src/;
//                                  стр — rein (по умолчанию), kava или index
// Страницы: rein — Реинкарнатор (шаблон src/index.html), kava — Кавалерия (src/kava/index.html), index — выбор системы
// (src/landing/index.html). Правят только src/: шаблоны страниц, стили src/styles/*.css, скрипты src/scripts/**.js.
// В шаблоне строка «/*@include путь*/» (путь — от папки src/) заменяется содержимым файла как есть. Скрипты — обычные
// (не ES-модули): куски одного блока <script> склеиваются подряд, поэтому общая глобальная область, порядок выполнения
// и inline-обработчики onclick="…" работают ровно как в едином файле. Никаких зависимостей — только встроенные модули Node.js.
'use strict';
const fs = require('fs'), path = require('path');
const PAGES = [
  {name:'rein', tpl:'index.html', out:'reincarnator_sheet_27_psi_cultist_shaman_final.html'},
  {name:'kava', tpl:'kava/index.html', out:'pages/kava.html'},
  {name:'index', tpl:'landing/index.html', out:'pages/index.html'}
];
const INCLUDE_RE = /^[ \t]*\/\*@include ([^*\r\n]+)\*\/[ \t]*\r?\n/gm;

// template — текст шаблона, read(путь) — текст файла; возвращает собранный HTML (переводы строк — \n)
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
module.exports = { build, PAGES };

if(require.main === module){
  const ROOT = __dirname, SRC = path.join(ROOT, 'src');
  const args = process.argv.slice(2);
  const make = (p)=>{
    const tplPath = path.join(SRC, p.tpl);
    if(!fs.existsSync(tplPath)){ console.error('Нет src/' + p.tpl + ' — исходники не найдены.'); process.exit(1); }
    const map = [];
    const html = build(fs.readFileSync(tplPath, 'utf8'), (f)=>{
      const full = path.join(SRC, f);
      if(!full.startsWith(SRC) || !fs.existsSync(full)) throw new Error('Нет файла src/' + f + ' (указан в src/' + p.tpl + ')');
      return fs.readFileSync(full, 'utf8');
    }, map);
    const out = path.join(ROOT, p.out);
    return {p, html, map, out, cur:fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null};
  };
  if(args[0]==='--line'){
    const n = parseInt(args[1], 10); if(!n){ console.error('Укажите номер строки: node build.js --line 12345 [rein|kava|index]'); process.exit(1); }
    const p = PAGES.find(x=>x.name===(args[2] || 'rein')); if(!p){ console.error('Нет страницы «' + args[2] + '»: rein, kava или index'); process.exit(1); }
    const {map} = make(p), hit = map.find(x=>n >= x.startLine && n < x.startLine + x.lines);
    console.log(hit ? `Строка ${n} страницы ${p.out} → src/${hit.file}:${n - hit.startLine + 1}` : `Строка ${n} — в самом шаблоне src/${p.tpl} (разметка), не во включённом файле`);
    process.exit(0);
  }
  const all = PAGES.map(make);
  if(args[0]==='--check'){
    const bad = all.filter(r=>r.cur !== r.html);
    all.forEach(r=>console.log((r.cur===r.html ? 'OK: ' : 'ОТЛИЧАЕТСЯ: ') + r.p.out + (r.cur===r.html ? ' совпадает с исходниками src/.' : '')));
    if(bad.length){ console.error('Либо страницу правили в обход src/ (перенесите правки в src/), либо после правок src/ не запускали сборку (node build.js).'); process.exit(1); }
    process.exit(0);
  }
  all.forEach(r=>{
    if(r.cur === r.html){ console.log('Без изменений: ' + r.p.out); return; }
    fs.mkdirSync(path.dirname(r.out), {recursive:true});
    fs.writeFileSync(r.out, r.html);
    console.log('Собрано: ' + r.p.out + ' (' + (Buffer.byteLength(r.html)/1024/1024).toFixed(2) + ' МБ, файлов: ' + r.map.length + ')');
  });
}
