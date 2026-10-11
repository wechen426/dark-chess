/*
 * 暗棋連線伺服器（零相依套件）
 *   node server/server.js [port]
 * - 提供網頁檔案（http://localhost:3000）
 * - WebSocket 房間配對；伺服器保存真實棋盤並驗證每一步，只把遮蔽後的狀態傳給玩家，避免偷看暗棋
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('../shared/engine.js');

const PORT = +(process.argv[2] || process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/client/app.js': 'client/app.js',
  '/client/style.css': 'client/style.css',
  '/shared/engine.js': 'shared/engine.js',
  '/shared/ai.js': 'shared/ai.js'
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const file = STATIC[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, file), (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 最小化 WebSocket 實作（RFC 6455，僅文字訊息） ----------
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const conn = { socket, onmessage: null, onclose: null, closed: false };
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { socket.destroy(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
      }
      buf = buf.subarray(need);
      if (op === 0x1 && conn.onmessage) conn.onmessage(payload.toString('utf8'));
      else if (op === 0x8) { close(conn); return; }
      else if (op === 0x9) sendFrame(conn, payload, 0xA);
    }
  });
  socket.on('close', () => close(conn));
  socket.on('error', () => close(conn));
  return conn;
}
function sendFrame(conn, data, op = 0x1) {
  if (conn.closed) return;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  let header;
  if (payload.length < 126) header = Buffer.from([0x80 | op, payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  conn.socket.write(Buffer.concat([header, payload]));
}
function close(conn) {
  if (conn.closed) return;
  conn.closed = true;
  try { conn.socket.end(Buffer.from([0x88, 0])); } catch (e) {}
  if (conn.onclose) conn.onclose();
}
const send = (conn, obj) => conn && sendFrame(conn, JSON.stringify(obj));

// ---------- 房間 ----------
const rooms = new Map(); // code -> { mode, players: [conn, conn], state, firstSeat }

function newCode() {
  for (let k = 0; k < 1000; k++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function startGame(room) {
  // 每局交換先手：state.turn 永遠從 0 開始，用座位對應決定誰是 0 號
  room.state = G.newGame({ mode: room.mode });
  room.seatOf = room.firstSeat === 0 ? [0, 1] : [1, 0]; // seatOf[連線索引] = 遊戲中的玩家編號
  room.players.forEach((p, idx) => send(p, { type: 'start', room: room.code, seat: room.seatOf[idx], state: G.masked(room.state) }));
}

server.on('upgrade', (req, socket) => {
  const conn = wsAccept(req, socket);
  if (!conn) return;
  let room = null, idx = -1;
  conn.onmessage = text => {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.type === 'create' && !room) {
      const code = newCode();
      if (!code) { send(conn, { type: 'error', msg: '房間已滿，請稍後再試。' }); return; }
      room = { code, mode: m.mode === 'chain' ? 'chain' : 'classic', players: [conn, null], state: null, firstSeat: 0 };
      rooms.set(code, room); idx = 0;
      send(conn, { type: 'created', room: code, seat: 0 });
    } else if (m.type === 'join' && !room) {
      const r = rooms.get(String(m.room));
      if (!r) { send(conn, { type: 'error', msg: '找不到這個房號。' }); return; }
      if (r.players[1]) { send(conn, { type: 'error', msg: '這個房間已經滿了。' }); return; }
      room = r; idx = 1; r.players[1] = conn;
      startGame(r);
    } else if (m.type === 'action' && room && room.state) {
      const s = room.state, me = room.seatOf[idx];
      if (s.turn !== me) { send(conn, { type: 'error', msg: '還沒輪到你。' }); return; }
      const a = m.action || {};
      const action = { type: a.type, at: a.at, from: a.from, to: a.to };
      if (!G.isLegal(s, action)) { send(conn, { type: 'error', msg: '這步不合規則。' }); return; }
      G.apply(s, action);
      const masked = G.masked(s);
      room.players.forEach(p => send(p, { type: 'state', state: masked }));
    } else if (m.type === 'resign' && room && room.state && room.state.winner === null && room.players[1]) {
      G.resign(room.state, room.seatOf[idx]);
      const masked = G.masked(room.state);
      room.players.forEach(p => send(p, { type: 'state', state: masked }));
    } else if (m.type === 'rematch' && room && room.state && room.state.winner !== null && room.players[1]) {
      room.firstSeat = 1 - room.firstSeat;
      startGame(room);
    }
  };
  conn.onclose = () => {
    if (!room) return;
    const other = room.players[1 - idx];
    if (other) send(other, { type: 'opponent_left' });
    rooms.delete(room.code);
  };
});

server.listen(PORT, () => {
  console.log('暗棋連棋伺服器已啟動：http://localhost:' + PORT);
  console.log('同一個網址開兩個瀏覽器（或分享給區網內的朋友），一邊建立房間、一邊輸入房號加入。');
});
