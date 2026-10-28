// Приёмник исходных кадров для генерации спрайтов: страница листа (в браузере) отрисовывает процедурные объекты
// карты и отправляет PNG сюда — tools/sprites/work/init/<объект>_<вариант>.png (+ jobs.json со сведениями об объектах).
// Запуск: node tools/sprites/receiver.js  (слушает только 127.0.0.1:3002)
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'work', 'init');
fs.mkdirSync(OUT, { recursive: true });
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const m = /^\/save\/([a-z0-9_]{1,80}\.(png|json))$/.exec(req.url || '');
  if (req.method !== 'POST' || !m) { res.writeHead(404); res.end(); return; }
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 30e6) req.destroy(); else chunks.push(c); });
  req.on('end', () => { fs.writeFileSync(path.join(OUT, m[1]), Buffer.concat(chunks)); res.end('ok'); });
}).listen(3002, '127.0.0.1', () => console.log('Приёмник исходных кадров: http://127.0.0.1:3002 → ' + OUT));
