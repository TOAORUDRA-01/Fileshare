/**
 * QR-Beam Signaling Server — Minimal WSS relay
 * Runs on port 8443
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8443;
const SESSION_TTL_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

const sessions = new Map();
const rateLimiter = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateLimiter.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

function purgeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  clearTimeout(s.ttlTimer);
  sessions.delete(sessionId);
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('QR-Beam Signaling Server OK');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.close(1008, 'Invalid JSON');
      return;
    }

    const { type, sessionId } = msg;
    if (!type || !sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
      ws.close(1008, 'Missing or invalid fields');
      return;
    }

    if (type === 'SENDER_READY') {
      if (!checkRateLimit(ip)) {
        ws.send(JSON.stringify({ type: 'ERROR', code: 'RATE_LIMITED' }));
        return;
      }
      if (sessions.has(sessionId)) {
        ws.send(JSON.stringify({ type: 'ERROR', code: 'SESSION_EXISTS' }));
        return;
      }
      const ttlTimer = setTimeout(() => purgeSession(sessionId), SESSION_TTL_MS);
      sessions.set(sessionId, { senderWs: ws, receiverWs: null, ttlTimer });
      ws.send(JSON.stringify({ type: 'READY', sessionId }));
      return;
    }

    if (type === 'RECEIVER_JOIN') {
      const session = sessions.get(sessionId);
      if (!session || !session.senderWs) {
        ws.send(JSON.stringify({ type: 'ERROR', code: 'SESSION_NOT_FOUND' }));
        return;
      }
      if (session.receiverWs) {
        ws.send(JSON.stringify({ type: 'ERROR', code: 'SESSION_OCCUPIED' }));
        return;
      }
      session.receiverWs = ws;
      session.senderWs.send(JSON.stringify({
        type: 'NOTIFY_SENDER',
        sessionId,
        receiverPubKey: msg.receiverPubKey,
      }));
      ws.send(JSON.stringify({ type: 'JOINED', sessionId }));
      return;
    }

    if (['SDP_OFFER', 'SDP_ANSWER', 'ICE_CANDIDATE'].includes(type)) {
      const session = sessions.get(sessionId);
      if (!session) return;
      const isFromSender = ws === session.senderWs;
      const dest = isFromSender ? session.receiverWs : session.senderWs;
      if (dest && dest.readyState === 1) {
        dest.send(JSON.stringify(msg));
      }
      return;
    }

    if (type === 'SESSION_CLOSE') {
      purgeSession(sessionId);
      return;
    }
  });

  ws.on('close', () => {
    for (const [sid, session] of sessions.entries()) {
      if (session.senderWs === ws || session.receiverWs === ws) {
        purgeSession(sid);
        break;
      }
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[QR-Beam Signaling] Listening on port ${PORT}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimiter.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimiter.delete(ip);
  }
}, 120_000);
