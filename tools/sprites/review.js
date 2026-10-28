// Выбор лучших спрайтов глазами: node tools/sprites/review.js → http://127.0.0.1:3003
// Показывает по каждому варианту объекта процедурный рисунок («как сейчас») и кандидатов из work/cut;
// выбор сохраняется сразу в work/choices.json: {"<id>_<v>": 0|1|2 (кандидат) | "keep" (оставить как есть) | "redo" (перегенерировать)}.
// Встраивание в приложение — apply.py, только по этому файлу.
const http = require('http'), fs = require('fs'), path = require('path');
const HERE = __dirname, WORK = path.join(HERE, 'work'), TEX = path.join(HERE, '..', '..', 'assets', 'map', 'tex');
const JOBS = path.join(HERE, 'jobs', 'all.json'), CHOICES = path.join(WORK, 'choices.json');
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') return sendFile(res, path.join(HERE, 'review.html'));
  if (u === '/data') {
    const jobs = readJSON(JOBS, []), cut = new Set(fs.existsSync(path.join(WORK, 'cut')) ? fs.readdirSync(path.join(WORK, 'cut')) : []);
    const items = jobs.map(j => ({ key: j.id + '_' + j.v, id: j.id, v: j.v, w: j.w, h: j.h, g: j.g, cat: j.cat, name: j.name, vname: j.vname,
      cands: j.cands.map((c, k) => cut.has(`${j.id}_${j.v}_c${k}.webp`) ? { k, mode: c.mode, strength: c.strength } : null) }));
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ items, choices: readJSON(CHOICES, {}) })); return;
  }
  if (req.method === 'POST' && u === '/choice') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => { try { const { key, pick } = JSON.parse(body); if (!/^[a-z0-9_]+_\d+$/.test(key) || !(pick === null || pick === 'keep' || pick === 'redo' || [0, 1, 2, 3].includes(pick))) throw 0;
      const ch = readJSON(CHOICES, {}); if (pick === null) delete ch[key]; else ch[key] = pick; fs.writeFileSync(CHOICES, JSON.stringify(ch, null, 1)); res.end('ok'); }
      catch (e) { res.writeHead(400); res.end(); } });
    return;
  }
  let m;
  if ((m = /^\/img\/(init|cut)\/([a-z0-9_]+\.(png|webp))$/.exec(u))) return sendFile(res, path.join(WORK, m[1], m[2]));
  if ((m = /^\/tex\/([a-z0-9_]+\.(webp|json))$/.exec(u))) return sendFile(res, path.join(TEX, m[1]));
  res.writeHead(404); res.end();
}).listen(3003, '127.0.0.1', () => console.log('Выбор спрайтов: http://127.0.0.1:3003'));
