// Реинкарнатор — сервер совместной сессии.
// Не требует npm install и вообще никаких пакетов — только встроенные модули Node.js.
// Делает две вещи:
//   1. Отдаёт лист персонажа (первый .html файл в этой же папке) любому, кто открыл сервер в браузере.
//   2. Разговаривает по WebSocket — но сам НЕ знает, что такое "бросок" или "Мастер": это просто
//      тупая рассылка сообщений между подключёнными клиентами, вся игровая логика — в самом листе
//      (в браузере). Сервер только: 1) даёт каждому клиенту id при подключении, 2) если в сообщении
//      есть поле "to" — пересылает его только клиенту с этим id, 3) если поля "to" нет — рассылает
//      всем остальным подключённым клиентам.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // фиксированная строка из самого стандарта WebSocket (RFC 6455)
// Достаточно с большим запасом для самого крупного, что реально летает по этому релею (полный JSON
// листа персонажа, sheet-snapshot/sheet-push) — но не безгранично, чтобы одно испорченное или
// злонамеренное сообщение не заставило сервер копить в памяти сколько угодно байт.
const MAX_FRAME_PAYLOAD = 4 * 1024 * 1024; // 4MB

function findSheetFile() {
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.html'));
  return files[0] || null;
}

// ---- Саундпад: аудиофайлы по HTTP (не через WebSocket) ----
// Свои звуки Мастера загружаются сюда (POST /sound-upload) и раздаются по ссылке /user-sounds/<имя>;
// игрокам по сети уходит только ссылка/идентификатор звука. Звуки, которые положены рядом с приложением
// вручную, — /assets/sounds/<имя>. Никакой базы: просто папка; на хостинге без постоянного диска файлы
// могут пропасть при пересборке. Загружать может только подключённый Мастер (его WS-id оканчивается на
// -gm), с ограничениями по типу, размеру и общему объёму папки.
const USER_SOUND_DIR = path.join(DIR, 'user-sounds');
const ASSET_SOUND_DIR = path.join(DIR, 'assets', 'sounds');
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.flac': 'audio/flac' };
const MAX_SOUND_BYTES = 25 * 1024 * 1024;       // один файл (музыкальный трек в mp3 обычно 5–15 МБ)
const MAX_SOUND_DIR_BYTES = 500 * 1024 * 1024;  // вся папка своих звуков и музыки
const SOUND_NAME_RE = /^[a-zA-Z0-9_-]{1,80}\.[a-z0-9]{2,5}$/;

function serveSound(dir, name, res) {
  const ext = path.extname(name).toLowerCase();
  if (!SOUND_NAME_RE.test(name) || !AUDIO_TYPES[ext]) { res.writeHead(404); res.end(); return; }
  const file = path.join(dir, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': AUDIO_TYPES[ext], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}
function soundDirSize() {
  try { return fs.readdirSync(USER_SOUND_DIR).reduce((a, f) => { try { return a + fs.statSync(path.join(USER_SOUND_DIR, f)).size; } catch (e) { return a; } }, 0); }
  catch (e) { return 0; }
}
function handleSoundUpload(req, res) {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const cid = String(req.headers['x-client-id'] || '');
  if (!CLIENT_ID_RE.test(cid) || !cid.endsWith('-gm') || !clients.has(cid)) { reply(403, { error: 'Загружать звуки может только подключённый Мастер' }); req.resume(); return; }
  const ext = '.' + String(req.headers['x-file-ext'] || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  if (!AUDIO_TYPES[ext]) { reply(415, { error: 'Неподдерживаемый формат (mp3, ogg, wav, m4a, aac, webm, flac)' }); req.resume(); return; }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_SOUND_BYTES) { reply(413, { error: 'Файл больше 25 МБ' }); req.resume(); return; }
  if (soundDirSize() + declared > MAX_SOUND_DIR_BYTES) { reply(507, { error: 'Папка своих звуков заполнена (500 МБ) — удалите ненужные треки' }); req.resume(); return; }
  const chunks = []; let size = 0, aborted = false;
  req.on('data', c => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_SOUND_BYTES) { aborted = true; reply(413, { error: 'Файл больше 25 МБ' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    if (!size) { reply(400, { error: 'Пустой файл' }); return; }
    const name = crypto.randomBytes(9).toString('hex') + ext;
    fs.mkdir(USER_SOUND_DIR, { recursive: true }, (e1) => {
      if (e1) { reply(500, { error: 'Не удалось создать папку' }); return; }
      fs.writeFile(path.join(USER_SOUND_DIR, name), Buffer.concat(chunks), (e2) => {
        if (e2) { reply(500, { error: 'Не удалось сохранить файл' }); return; }
        console.log('[Server] Звук загружен', name, size, 'байт от', cid);
        reply(200, { url: '/user-sounds/' + name });
      });
    });
  });
}

// Мастер удалил звук или трек, на файл которого больше ничто не ссылается, — освобождаем место
function handleSoundDelete(req, res) {
  req.resume();
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const cid = String(req.headers['x-client-id'] || '');
  if (!CLIENT_ID_RE.test(cid) || !cid.endsWith('-gm') || !clients.has(cid)) { reply(403, { error: 'Удалять может только подключённый Мастер' }); return; }
  const name = String(req.headers['x-file-name'] || '');
  if (!SOUND_NAME_RE.test(name) || !AUDIO_TYPES[path.extname(name).toLowerCase()]) { reply(400, { error: 'Неверное имя файла' }); return; }
  fs.unlink(path.join(USER_SOUND_DIR, name), (err) => {
    if (err) { reply(404, { error: 'Файл не найден' }); return; }
    console.log('[Server] Звук удалён', name, 'по запросу', cid);
    reply(200, { ok: true });
  });
}

// ---- Редактор карт: карты для игрового стола (JSON, не картинка) ----
// Мастер загружает данные карты (POST /map-upload), игроки получают их по ссылке /user-maps/<id>.json и рисуют
// у себя тем же кодом, что и редактор. Одна карта — один файл (повторная отправка той же карты перезаписывает).
// В папке сразу кладётся .gitignore со «*», чтобы данные игры не попадали в git (корневой .gitignore не трогаем).
const USER_MAP_DIR = path.join(DIR, 'user-maps');
const MAX_MAP_BYTES = 4 * 1024 * 1024;
const MAP_FILE_RE = /^[a-zA-Z0-9_-]{4,64}\.json$/;
function handleMapUpload(req, res) {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const cid = String(req.headers['x-client-id'] || '');
  if (!CLIENT_ID_RE.test(cid) || !cid.endsWith('-gm') || !clients.has(cid)) { reply(403, { error: 'Загружать карты может только подключённый Мастер' }); req.resume(); return; }
  if (Number(req.headers['content-length'] || 0) > MAX_MAP_BYTES) { reply(413, { error: 'Карта больше 4 МБ' }); req.resume(); return; }
  const chunks = []; let size = 0, aborted = false;
  req.on('data', c => { if (aborted) return; size += c.length; if (size > MAX_MAP_BYTES) { aborted = true; reply(413, { error: 'Карта больше 4 МБ' }); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => {
    if (aborted) return;
    let map; try { map = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { reply(400, { error: 'Не JSON' }); return; }
    if (!map || map.format !== 'reincarnator-map' || !MAP_FILE_RE.test(String(map.id) + '.json')) { reply(400, { error: 'Это не карта редактора' }); return; }
    const name = map.id + '.json';
    fs.mkdir(USER_MAP_DIR, { recursive: true }, (e1) => {
      if (e1) { reply(500, { error: 'Не удалось создать папку' }); return; }
      fs.writeFile(path.join(USER_MAP_DIR, '.gitignore'), '*\n', () => {});
      fs.writeFile(path.join(USER_MAP_DIR, name), JSON.stringify(map), (e2) => {
        if (e2) { reply(500, { error: 'Не удалось сохранить карту' }); return; }
        console.log('[Server] Карта загружена', name, size, 'байт от', cid);
        reply(200, { url: '/user-maps/' + name });
      });
    });
  });
}
function serveMap(name, res) {
  if (!MAP_FILE_RE.test(name)) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(USER_MAP_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

// ---- Редактор карт: свои объекты (картинки PNG/WebP/JPG) ----
// Мастер загружает картинку, когда отправляет на стол карту с такими объектами (POST /asset-upload, заголовок
// X-Asset-Id — id объекта без «u:»); игроки берут её по ссылке /user-assets/<id>.<ext>. Тот же id — перезапись.
const USER_ASSET_DIR = path.join(DIR, 'user-assets');
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const ASSET_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const ASSET_FILE_RE = /^[a-z0-9]{6,40}\.(png|webp|jpg)$/;
function handleAssetUpload(req, res) {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const cid = String(req.headers['x-client-id'] || '');
  if (!CLIENT_ID_RE.test(cid) || !cid.endsWith('-gm') || !clients.has(cid)) { reply(403, { error: 'Загружать картинки может только подключённый Мастер' }); req.resume(); return; }
  const id = String(req.headers['x-asset-id'] || ''), ext = ASSET_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
  if (!/^[a-z0-9]{6,40}$/.test(id) || !ext) { reply(400, { error: 'Нужна картинка PNG, WebP или JPG' }); req.resume(); return; }
  if (Number(req.headers['content-length'] || 0) > MAX_ASSET_BYTES) { reply(413, { error: 'Картинка больше 8 МБ' }); req.resume(); return; }
  const chunks = []; let size = 0, aborted = false;
  req.on('data', c => { if (aborted) return; size += c.length; if (size > MAX_ASSET_BYTES) { aborted = true; reply(413, { error: 'Картинка больше 8 МБ' }); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    const magic = ext === 'png' ? buf.slice(0, 4).toString('hex') === '89504e47' : ext === 'jpg' ? buf.slice(0, 2).toString('hex') === 'ffd8' : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
    if (!magic) { reply(400, { error: 'Содержимое не похоже на картинку' }); return; }
    const name = id + '.' + ext;
    fs.mkdir(USER_ASSET_DIR, { recursive: true }, (e1) => {
      if (e1) { reply(500, { error: 'Не удалось создать папку' }); return; }
      fs.writeFile(path.join(USER_ASSET_DIR, '.gitignore'), '*\n', () => {});
      fs.writeFile(path.join(USER_ASSET_DIR, name), buf, (e2) => {
        if (e2) { reply(500, { error: 'Не удалось сохранить картинку' }); return; }
        console.log('[Server] Картинка объекта загружена', name, size, 'байт от', cid);
        reply(200, { url: '/user-assets/' + name });
      });
    });
  });
}
function serveAsset(name, res) {
  if (!ASSET_FILE_RE.test(name)) { res.writeHead(404); res.end(); return; }
  fs.readFile(path.join(USER_ASSET_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

// ---- Раздача самого файла листа персонажа по обычному HTTP ----
const httpServer = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && urlPath === '/sound-upload') { handleSoundUpload(req, res); return; }
  if (req.method === 'POST' && urlPath === '/sound-delete') { handleSoundDelete(req, res); return; }
  if (req.method === 'POST' && urlPath === '/map-upload') { handleMapUpload(req, res); return; }
  if (urlPath.indexOf('/user-maps/') === 0) { serveMap(urlPath.slice(11), res); return; }
  if (req.method === 'POST' && urlPath === '/asset-upload') { handleAssetUpload(req, res); return; }
  if (urlPath.indexOf('/user-assets/') === 0) { serveAsset(urlPath.slice(13), res); return; }
  if (urlPath.indexOf('/user-sounds/') === 0) { serveSound(USER_SOUND_DIR, urlPath.slice(13), res); return; }
  if (urlPath.indexOf('/assets/sounds/') === 0) { serveSound(ASSET_SOUND_DIR, urlPath.slice(15), res); return; }
  // Лёгкая проверка «жив ли сервер» — для хостинга (health check) и для самого листа: пока идёт сессия, он
  // раз в несколько минут обращается сюда обычным HTTP-запросом, чтобы бесплатный хостинг (Bonto и
  // подобные) не усыплял приложение «за неактивностью» посреди игры — WebSocket-трафик такие платформы
  // активностью могут не считать. Отдельный маршрут, чтобы не гонять ради этого всю страницу (~1,4 МБ).
  if ((req.url || '/').split('?')[0] === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('ok');
    return;
  }
  const sheetFile = findSheetFile();
  if (!sheetFile) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Рядом с server.js не найден ни один .html файл — положите сюда файл листа персонажа.');
    return;
  }
  fs.readFile(path.join(DIR, sheetFile), (err, data) => {
    if (err) { res.writeHead(500); res.end('Ошибка чтения файла: ' + err.message); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// ---- WebSocket-рукопожатие и разбор кадров вручную (без пакета "ws") ----
const clients = new Map(); // id -> socket
// id -> таймер отложенного peer-left — см. cleanup() ниже: короткий сетевой сбой (тоннель/сеть моргнули,
// клиент почти сразу переподключается тем же cid) не должен выглядеть для ОСТАЛЬНЫХ участников комнаты
// как настоящий уход человека — RECONNECT_GRACE_MS даёт клиенту время вернуться до того, как остальным
// разошлют peer-left (который на их стороне сразу рвёт голос/видео, см. RoomTransport.teardownPeer).
const pendingLeave = new Map();
const RECONNECT_GRACE_MS = 8000; // с запасом больше стартовой паузы клиентского реконнекта (2000мс, растёт дальше)

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

// Собирает один или несколько текстовых WebSocket-кадров без маски (сервер клиенту маску не ставит).
function encodeFrame(payloadStr) {
  const payload = Buffer.from(payloadStr, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// Разбирает входящие кадры от клиента (они обязаны быть замаскированы — так требует протокол).
// Возвращает только длину заголовка/кадра, а не сам разобранный кадр — так вызывающий код может
// сначала проверить, что в буфере реально накопился весь кадр целиком (см. цикл ниже), и только
// тогда извлекать из него данные. Раньше это не проверялось: по loopback (тест на одной машине)
// кадр почти всегда приходит одним куском, но через настоящую сеть/туннель большие сообщения (весь
// лист персонажа) неизбежно приходят несколькими TCP-пакетами — и обрезанный кадр молча ломался.
function peekFrameHeader(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null; // ещё не подъехали байты самой длины - ждём ещё данных
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const headerLen = offset + (masked ? 4 : 0);
  return { opcode, masked, headerLen, payloadLen: len, total: headerLen + len, tooLarge: len > MAX_FRAME_PAYLOAD };
}
function unmask(payload, maskKey) {
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ maskKey[i % 4];
  return out;
}

function send(socket, obj) {
  try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* сокет уже мог закрыться */ }
}
function broadcastExcept(exceptId, obj) {
  clients.forEach((socket, id) => { if (id !== exceptId) send(socket, obj); });
}

// ---- Keepalive: без этого простаивающее соединение (никто не бросает кубик, не двигает лист —
// вполне обычное дело посреди игры, когда все просто разговаривают) рано или поздно молча обрывает
// NAT/роутер/прокси на пути (частый порог — от 60 секунд до нескольких минут без трафика), безо
// всякого корректного закрытия. JS-объект WebSocket в браузере при этом может ещё какое-то время
// считать соединение открытым, и sendMsg() у листа персонажа просто тихо отправляет в никуда — это
// и была настоящая причина того, что броски "переставали доходить" не сразу, а через какое-то время
// игры, у всех одинаково. Пинг-кадр (опкод 0x9, часть самого стандарта WebSocket) даёт равномерный
// трафик, чтобы такой обрыв по таймауту не наступал; браузер отвечает на него pong автоматически, на
// уровне сетевого стека — никакого кода в листе персонажа для этого не нужно.
function encodePingFrame() {
  return Buffer.from([0x89, 0x00]); // FIN=1, opcode=0x9 (ping), пустой payload
}
const PING_INTERVAL_MS = 25000;
// Обратная сторона той же проблемы: если клиент пропал «тихо» (ноутбук уснул, сеть отвалилась без
// закрытия соединения), TCP может ещё минуты не сообщать об ошибке — всё это время сервер считал его
// подключённым и отправлял ему сообщения в пустоту (например, выданную Мастером удачу). Теперь сервер
// помнит, когда от соединения последний раз что-то приходило (pong на наш ping, сигнал 'hb' от листа
// раз в 20 с или любое обычное сообщение), и закрывает то, что молчит дольше STALE_AFTER_MS, — дальше
// обычный путь: peer-left после грейс-периода, а клиент, если он всё-таки жив, переподключится сам.
// Порог с запасом больше двух интервалов — не рвать живые соединения из-за одной задержки.
const STALE_AFTER_MS = 70000;
setInterval(() => {
  const now = Date.now();
  clients.forEach((socket, id) => {
    if (now - (socket._lastSeen || now) > STALE_AFTER_MS) {
      console.log('[Server] Client', id, 'молчит больше', STALE_AFTER_MS / 1000, 'с — закрываем как оборванный');
      try { socket.destroy(); } catch (e) {}
      return;
    }
    try { socket.write(encodePingFrame()); } catch (e) { /* сокет уже мог закрыться */ }
  });
}, PING_INTERVAL_MS);

// Клиент присылает свой собственный, постоянный (в localStorage) id строкой запроса ?cid=... —
// см. getOrCreateClientId()/wsUrl() в самом листе персонажа. Раньше id всегда генерировался здесь
// заново на КАЖДОЕ соединение, поэтому любой обрыв WebSocket (сеть/тоннель моргнули — обычное дело
// на живой игре) выглядел для остальных участников комнаты как "человек ушёл, пришёл кто-то новый":
// их RTCPeerConnection были адресованы по уже недействительному старому id. Если клиент прислал свой
// cid — используем его КАК id вместо случайного, тогда реконнект сохраняет тот же id и не рвёт
// голосовую комнату у остальных (см. соответствующий комментарий в самом листе персонажа).
// Валидация — тот же формат, что генерирует getOrCreateClientId (UUID или 32-hex), с запасом по
// длине: не доверяем клиенту чужой ввод, но и не пытаемся тут разбирать «правильный» UUID дотошно —
// одного only-безопасных-символов-и-длины достаточно, потому что это всего лишь ключ в Map, не команда.
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
function parseClientId(reqUrl) {
  try {
    const q = new URL(reqUrl, 'http://x').searchParams.get('cid');
    return q && CLIENT_ID_RE.test(q) ? q : null;
  } catch (e) { return null; }
}

httpServer.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const acceptKey = wsAccept(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
  );

  const cid = parseClientId(req.url);
  const id = cid || crypto.randomBytes(6).toString('hex');
  // Тот же cid уже числится живым (клиент реально переподключился, пока старый сокет ещё не был
  // распознан сервером как закрытый — TCP не сообщает об обрыве мгновенно) — старое соединение считаем
  // осиротевшим и закрываем, тот же приём, что уже используется в самом листе персонажа для защиты от
  // зомби-сокетов при повторном connectSession(). Без этого старый socket так и остался бы в clients,
  // и broadcastExcept/send(clients.get(msg.to)) продолжали бы слать И туда тоже.
  // Перед закрытием старому сокету сообщаем 'replaced': если он на самом деле жив (тот же браузер
  // открыл лист во второй вкладке — id хранится в общем для вкладок localStorage), клиент не должен
  // переподключаться сам, иначе две вкладки бесконечно выбивают друг друга каждые ~2 секунды.
  // Если старый сокет действительно мёртв (обычный реконнект), сообщение просто никуда не дойдёт.
  const stale = clients.get(id);
  if (stale && stale !== socket) {
    try { stale.end(encodeFrame(JSON.stringify({ type: 'replaced', from: 'server' }))); } catch (e) {}
    setTimeout(() => { try { stale.destroy(); } catch (e) {} }, 1000);
  }
  socket._lastSeen = Date.now();
  clients.set(id, socket);
  // Вернулся до истечения grace-периода (см. pendingLeave выше) — остальные участники так и не узнают,
  // что было кратковременное отключение, их peer-соединение к этому id ни разу не рвалось с их стороны.
  if (pendingLeave.has(id)) { clearTimeout(pendingLeave.get(id)); pendingLeave.delete(id); }
  send(socket, { type: 'welcome', id });
  console.log('[Server] Client connected', id, cid ? '(постоянный cid)' : '(случайный)', '- online now:', clients.size);

  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    socket._lastSeen = Date.now(); // любые байты (включая pong) — признак, что клиент жив, см. STALE_AFTER_MS
    buffer = Buffer.concat([buffer, chunk]);
    // Один вызов 'data' может содержать несколько кадров, один кадр, или только часть одного -
    // цикл забирает все кадры, которые уже накопились целиком, и останавливается, если текущий
    // кадр ещё не пришёл полностью (ждём следующего 'data').
    while (true) {
      const info = peekFrameHeader(buffer);
      if (!info) break; // ещё не знаем даже длину кадра - мало байт
      if (info.tooLarge) { socket.destroy(); return; } // заявленный размер кадра подозрительно огромный - обрываем, не копим в памяти
      if (buffer.length < info.total) break; // знаем длину, но кадр целиком ещё не пришёл
      const frameBuf = buffer.slice(0, info.total);
      buffer = buffer.slice(info.total);

      if (info.opcode === 0x8) { socket.end(); return; } // клиент закрывает соединение
      if (info.opcode !== 0x1) continue; // интересует только текстовый кадр (0x1) - JSON
      if (!info.masked) continue; // клиентские кадры без маски запрещены протоколом - игнорируем как мусор

      const maskKey = frameBuf.slice(info.headerLen - 4, info.headerLen);
      const payload = unmask(frameBuf.slice(info.headerLen, info.total), maskKey);

      // Этот сокет уже вытеснен новым соединением с тем же id (см. 'replaced' выше) — пока он
      // закрывается, его сообщения никуда не пересылаем, иначе они уходили бы от имени живого клиента.
      if (clients.get(id) !== socket) continue;
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
      // JSON может быть и не объектом ("null", число, строка, массив) — присвоение msg.from ниже на таком
      // значении бросало TypeError прямо в обработчике 'data', и весь процесс сервера падал у всех сразу.
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
      // Сигнал «я жив» от листа — только для этого сервера: отвечаем тому же клиенту (по ответу он сам
      // понимает, что сервер жив) и никому не пересылаем.
      if (msg.type === 'hb') { send(socket, { type: 'hb-ack', from: 'server' }); continue; }
      msg.from = id;
      if (typeof msg.to === 'string' && msg.to) {
        const target = clients.get(msg.to);
        if (target) send(target, msg);
      } else {
        broadcastExcept(id, msg);
      }
    }
  });
  const cleanup = () => {
    // Только если в clients под этим id всё ещё ЭТОТ сокет — если клиент успел переподключиться с тем
    // же cid ДО того, как TCP сообщил серверу о закрытии старого соединения (обычная гонка, событие
    // 'close' не мгновенно), в clients уже стоит НОВЫЙ, живой сокет — удалять его отсюда по closure
    // над старым id нельзя, иначе только что переподключившийся клиент тут же выпадает из маршрутизации,
    // хотя его соединение живо.
    if (clients.get(id) !== socket) return;
    clients.delete(id);
    console.log('[Server] Client disconnected', id, '- online now:', clients.size, '(peer-left через', RECONNECT_GRACE_MS, 'мс, если не вернётся)');
    // Не рассылаем peer-left сразу — короткий обрыв (сеть/тоннель моргнули) с последующим быстрым
    // реконнектом тем же cid не должен рвать голос/видео у всех остальных участников. Если id
    // переподключится раньше — таймер отменяется выше (см. pendingLeave.has(id) в upgrade-обработчике),
    // и остальные вообще не узнают, что было отключение.
    const timer = setTimeout(() => {
      pendingLeave.delete(id);
      broadcastExcept(id, { type: 'peer-left', id, from: 'server' });
    }, RECONNECT_GRACE_MS);
    pendingLeave.set(id, timer);
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

httpServer.listen(PORT, () => {
  const sheetFile = findSheetFile();
  console.log('========================================================');
  console.log(' Reincarnator: shared session server is running.');
  console.log(' Sheet file:', sheetFile || '(none found next to server.js - put a .html file here)');
  console.log(' Local: http://localhost:' + PORT);
  console.log(' For players outside your network - see the cloudflared window for a https://....trycloudflare.com link');
  console.log('========================================================');
});
