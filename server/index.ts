import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomHub } from './rooms';
const hub = new RoomHub();
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(req.url === '/health' ? 200 : 404);
  res.end(JSON.stringify(req.url === '/health' ? { ok: true, protocol: 1, rooms: hub.rooms.size, players: hub.peers.size } : { error: 'not found' }));
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  if (wss.clients.size > 400) { ws.close(1013, 'Server full'); return; }
  const origin = req.headers.origin;
  const allowed = ['https://shangho90-sudo.github.io', ...(process.env.ALLOWED_ORIGINS || '').split(',')];
  if (origin && !allowed.includes(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) { ws.close(1008, 'Origin denied'); return; }
  const token = new URL(req.url!, 'http://localhost').searchParams.get('token') ?? undefined;
  const id = hub.connect(m => { if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 1024 * 1024) ws.terminate(); else ws.send(JSON.stringify(m)); } }, token);
  let count = 0, reset = Date.now(), alive = true;
  ws.on('pong', () => alive = true);
  const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15000);
  ws.on('message', data => {
    if (Date.now() - reset > 1000) { count = 0; reset = Date.now(); }
    if (++count > 100) { ws.close(1008, 'Too many messages'); return; }
    try { hub.handle(id, JSON.parse(data.toString())); } catch { ws.send(JSON.stringify({ type: 'error', message: '요청을 처리할 수 없습니다.' })); }
  });
  ws.on('close', () => { clearInterval(heartbeat); hub.disconnect(id); });
  ws.on('error', () => ws.terminate());
});
const simulation = setInterval(() => hub.advance(), 50);
const cleanup = setInterval(() => hub.sweep(), 60000);
server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log('Fortress online server ready'));
process.on('SIGTERM', () => { clearInterval(simulation); clearInterval(cleanup); for (const ws of wss.clients) ws.close(1012, 'Server restarting'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
