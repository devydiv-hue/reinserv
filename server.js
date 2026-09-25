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

// ---- Раздача самого файла листа персонажа по обычному HTTP ----
const httpServer = http.createServer((req, res) => {
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
setInterval(() => {
  clients.forEach(socket => { try { socket.write(encodePingFrame()); } catch (e) { /* сокет уже мог закрыться */ } });
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
  const stale = clients.get(id);
  if (stale && stale !== socket) { try { stale.destroy(); } catch (e) {} }
  clients.set(id, socket);
  // Вернулся до истечения grace-периода (см. pendingLeave выше) — остальные участники так и не узнают,
  // что было кратковременное отключение, их peer-соединение к этому id ни разу не рвалось с их стороны.
  if (pendingLeave.has(id)) { clearTimeout(pendingLeave.get(id)); pendingLeave.delete(id); }
  send(socket, { type: 'welcome', id });
  console.log('[Server] Client connected', id, cid ? '(постоянный cid)' : '(случайный)', '- online now:', clients.size);

  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
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

      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
      msg.from = id;
      if (msg.to) {
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
