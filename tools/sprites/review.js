// Выбор лучших спрайтов глазами: node tools/sprites/review.js → http://127.0.0.1:3003
// Показывает по каждому варианту объекта процедурный рисунок («как сейчас») и кандидатов из work/cut;
// выбор сохраняется сразу в work/choices.json: {"<id>_<v>": 0|1|2 (кандидат) | "keep" (оставить как есть) | "redo" (перегенерировать)}.
// /tex — выбор фактур пола (gen_tex.py, apply_tex.py). /check — проверка выбранных после вырезки: отмеченные «переделать от старого рисунка» → work/recheck.json (make_redo.py).
// Встраивание в приложение — apply.py, только по этому файлу.
const http = require('http'), fs = require('fs'), path = require('path');
const HERE = __dirname, WORK = path.join(HERE, 'work'), TEX = path.join(HERE, '..', '..', 'assets', 'map', 'tex');
const TEXRAW = path.join(WORK, 'tex', 'raw'), TEXCH = path.join(WORK, 'tex', 'choices.json'), SPR = path.join(HERE, '..', '..', 'assets', 'map', 'sprites');
const JOBS = path.join(HERE, 'jobs', 'all.json'), CHOICES = path.join(WORK, 'choices.json'), RECHECK = path.join(WORK, 'recheck.json');
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
    res.end(JSON.stringify({ items, choices: readJSON(CHOICES, {}), recheck: readJSON(RECHECK, []), edge: readJSON(path.join(WORK, 'edge.json'), {}) })); return;
  }
  if (u === '/check') return sendFile(res, path.join(HERE, 'check.html'));
  // фактуры пола (gen_tex.py → work/tex/raw): выбор → work/tex/choices.json {"<грунт>": {pick: k | 'keep', cells, bright}} (apply_tex.py)
  if (u === '/tex') return sendFile(res, path.join(HERE, 'tex.html'));
  if (u === '/texdata') {
    const raw = fs.existsSync(TEXRAW) ? new Set(fs.readdirSync(TEXRAW)) : new Set(), cur = readJSON(path.join(TEX, 'manifest.json'), {}).textures || {};
    const items = readJSON(path.join(HERE, 'jobs', 'tex.json'), []).map(t => Object.assign({}, t, { cur: cur[t.id] || null,
      cands: [0, 1, 2, 3, 4, 5].filter(k => raw.has(`${t.id}_c${k}.png`)) }));
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ items, choices: readJSON(TEXCH, {}) })); return;
  }
  if (req.method === 'POST' && u === '/texchoice') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => { try { const { id, v } = JSON.parse(body); if (!/^[a-z0-9_]+$/.test(id) || !v || !(v.pick === 'keep' || [0, 1, 2, 3, 4, 5].includes(v.pick))) throw 0;
      const ch = readJSON(TEXCH, {}); ch[id] = { pick: v.pick, cells: Math.min(8, Math.max(1, +v.cells || 2)), bright: Math.min(1.4, Math.max(0.6, +v.bright || 1)) };
      fs.writeFileSync(TEXCH, JSON.stringify(ch, null, 1)); res.end('ok'); } catch (e) { res.writeHead(400); res.end(); } });
    return;
  }
  if (req.method === 'POST' && u === '/recheck') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => { try { const { key, on } = JSON.parse(body); if (!/^[a-z0-9_]+_\d+$/.test(key)) throw 0;
      const set = new Set(readJSON(RECHECK, [])); if (on) set.add(key); else set.delete(key); fs.writeFileSync(RECHECK, JSON.stringify([...set].sort(), null, 1)); res.end('ok'); }
      catch (e) { res.writeHead(400); res.end(); } });
    return;
  }
  if (req.method === 'POST' && u === '/choice') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => { try { const { key, pick } = JSON.parse(body); if (!/^[a-z0-9_]+_\d+$/.test(key) || !(pick === null || pick === 'keep' || pick === 'redo' || [0, 1, 2, 3].includes(pick))) throw 0;
      const ch = readJSON(CHOICES, {}); if (pick === null) delete ch[key]; else ch[key] = pick; fs.writeFileSync(CHOICES, JSON.stringify(ch, null, 1)); res.end('ok'); }
      catch (e) { res.writeHead(400); res.end(); } });
    return;
  }
  let m;
  if ((m = /^\/img\/(init|cut)\/([a-z0-9_]+\.(png|webp))$/.exec(u))) {
    // «как сейчас» — процедурный рисунок; во втором круге исходник генерации заменён (поля, рисунок сверху), прежний — в round1
    const old = path.join(WORK, 'round1', 'init', m[2]);
    return sendFile(res, m[1] === 'init' && fs.existsSync(old) ? old : path.join(WORK, m[1], m[2]));
  }
  if ((m = /^\/tex\/([a-z0-9_]+\.(webp|json))$/.exec(u))) return sendFile(res, path.join(TEX, m[1]));
  if ((m = /^\/img\/tex\/([a-z0-9_]+\.png)$/.exec(u))) return sendFile(res, path.join(TEXRAW, m[1]));
  if ((m = /^\/spr\/([a-z0-9_]+\.webp)$/.exec(u))) return sendFile(res, path.join(SPR, m[1]));
  res.writeHead(404); res.end();
}).listen(3003, '127.0.0.1', () => console.log('Выбор спрайтов: http://127.0.0.1:3003'));
