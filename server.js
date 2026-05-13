// GRENDEL — Node.js + Socket.IO authoritative server.
//
// Architecture:
//   - Express serves static client (public/) plus a tiny health endpoint.
//   - Socket.IO handles room signalling and per-tick state broadcast.
//   - All gameplay state lives in Room (src/room.js). Server is authoritative;
//     clients only send input intents.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { Server as IO } from 'socket.io';

import { Lobby } from './src/lobby.js';
import { NET } from './src/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build ID: a short token that changes whenever any source file changes. We
// stamp it into URLs in index.html so the browser (and the Cloudflare edge)
// fetch fresh source after every push instead of relying on TTL.
const BUILD_ID = (() => {
  try {
    const mtimes = ['public/index.html', 'public/style.css', 'public/js/main.js',
                    'src/constants.js', 'src/room.js', 'src/saga.js']
      .map(p => fs.statSync(path.join(__dirname, p)).mtimeMs)
      .reduce((a, b) => Math.max(a, b), 0);
    return Math.floor(mtimes).toString(36);
  } catch { return Date.now().toString(36); }
})();
console.log(`grendel: BUILD_ID=${BUILD_ID}`);

const PORT = parseInt(process.env.PORT || '3000', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null; // null => same-origin only (Socket.IO default)

const app = express();
app.use(compression());
app.disable('x-powered-by');

// index.html is rendered with BUILD_ID stamped into every script/style URL.
// That way the browser + Cloudflare edge fetch fresh JS/CSS every time the
// build changes, without us having to purge the CF cache.
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
function renderIndex() {
  return fs.readFileSync(INDEX_PATH, 'utf8').replace(/__BUILD__/g, BUILD_ID);
}
app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderIndex());
});

// Serve every JS source through a templating middleware so `__BUILD__`
// placeholders inside the source become the current build id. This is how
// we cache-bust ES module imports (./net.js?v=__BUILD__ etc.) without
// having to purge the Cloudflare edge. These routes must be registered
// BEFORE express.static or the static handler will win.
function serveJsTemplated(absPath) {
  return (_req, res, next) => {
    fs.readFile(absPath, 'utf8', (err, raw) => {
      if (err) return next(err);
      const body = raw.replace(/__BUILD__/g, BUILD_ID);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.send(body);
    });
  };
}
app.get('/shared/constants.js', serveJsTemplated(path.join(__dirname, 'src', 'constants.js')));
// maps.js imports ./constants.js — also patch that single import line so the
// browser-served version picks up the build-tagged dependency.
app.get('/shared/maps.js', (_req, res, next) => {
  fs.readFile(path.join(__dirname, 'src', 'maps.js'), 'utf8', (err, raw) => {
    if (err) return next(err);
    const body = raw
      .replace("from './constants.js'", `from './constants.js?v=${BUILD_ID}'`)
      .replace(/__BUILD__/g, BUILD_ID);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.send(body);
  });
});
for (const name of ['main', 'net', 'input', 'render', 'hud', 'atmosphere']) {
  app.get(`/js/${name}.js`, serveJsTemplated(path.join(__dirname, 'public', 'js', `${name}.js`)));
}

// Static client. Anything not handled above falls through here.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css|json|xml|txt|svg)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

app.get('/healthz', (_req, res) => res.json({ ok: true, ...lobby.stats() }));

const server = http.createServer(app);
const io = new IO(server, {
  cors: ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : undefined,
  pingInterval: 10_000,
  pingTimeout: 20_000,
  // per-message deflate is okay here; snapshots are small
});

const lobby = new Lobby(io);

// Basic per-socket input rate limiting: tokens refilled at TICK_RATE.
const RATE = { tokens: 60, refillPerSec: 60 };

io.on('connection', (socket) => {
  socket.data.rate = { tokens: RATE.tokens, last: Date.now() };
  socket.data.name = 'Wanderer';

  socket.on('create', ({ name }, cb) => {
    if (lobby.roomOfSocket(socket.id)) return cb?.({ error: 'already_in_room' });
    const room = lobby.createRoom(socket.id);
    socket.data.name = sanitizeName(name);
    socket.join(room.code);
    const { player, error } = room.addPlayer(socket.id, socket.data.name);
    if (error) return cb?.({ error });
    lobby.trackSocket(socket.id, room.code);
    cb?.({ code: room.code, you: player.id, hostId: room.hostId });
    io.to(room.code).emit('lobby', room.lobbyView());
  });

  // Demo mode: create a room, populate with bot thanes, auto-start.
  // The human plays Grendel by default.
  socket.on('demo', ({ name }, cb) => {
    if (lobby.roomOfSocket(socket.id)) return cb?.({ error: 'already_in_room' });
    const room = lobby.createRoom(socket.id, { withBots: true });
    socket.data.name = sanitizeName(name);
    socket.join(room.code);
    const { player, error } = room.addPlayer(socket.id, socket.data.name);
    if (error) return cb?.({ error });
    lobby.trackSocket(socket.id, room.code);
    // Add bot thanes
    lobby.fillBots(room, 'grendel');
    // Auto-start the night
    const r = room.forceStart();
    if (r.error) console.warn('demo start failed', r.error);
    cb?.({ code: room.code, you: player.id, hostId: room.hostId, role: player.role });
    io.to(room.code).emit('lobby', room.lobbyView());
  });

  socket.on('join', ({ code, name }, cb) => {
    if (typeof code !== 'string') return cb?.({ error: 'bad_code' });
    const room = lobby.getRoom(code.toUpperCase());
    if (!room) return cb?.({ error: 'no_room' });
    if (lobby.roomOfSocket(socket.id)) return cb?.({ error: 'already_in_room' });
    socket.data.name = sanitizeName(name);
    const { player, error } = room.addPlayer(socket.id, socket.data.name);
    if (error) return cb?.({ error });
    socket.join(room.code);
    lobby.trackSocket(socket.id, room.code);
    cb?.({ code: room.code, you: player.id, hostId: room.hostId });
    io.to(room.code).emit('lobby', room.lobbyView());
  });

  socket.on('start', (_p, cb) => {
    const room = lobby.roomOfSocket(socket.id);
    if (!room) return cb?.({ error: 'no_room' });
    const r = room.startMatch(socket.id);
    if (r.error) return cb?.(r);
    cb?.({ ok: true });
    io.to(room.code).emit('lobby', room.lobbyView());
  });

  socket.on('restart', (_p, cb) => {
    const room = lobby.roomOfSocket(socket.id);
    if (!room) return cb?.({ error: 'no_room' });
    const r = room.requestRestart(socket.id);
    if (r.error) return cb?.(r);
    cb?.({ ok: true });
    io.to(room.code).emit('lobby', room.lobbyView());
  });

  socket.on('input', (input) => {
    // rate-limit
    const now = Date.now();
    const rate = socket.data.rate;
    const elapsed = (now - rate.last) / 1000;
    rate.tokens = Math.min(RATE.tokens, rate.tokens + elapsed * RATE.refillPerSec);
    rate.last = now;
    if (rate.tokens < 1) return;
    rate.tokens -= 1;
    const room = lobby.roomOfSocket(socket.id);
    if (!room) return;
    room.setInput(socket.id, input || {});
  });

  socket.on('disconnect', () => {
    const room = lobby.roomOfSocket(socket.id);
    lobby.leave(socket.id);
    if (room && room.players.size > 0) io.to(room.code).emit('lobby', room.lobbyView());
  });
});

function sanitizeName(n) {
  return String(n ?? '').replace(/[^\w\s\-\.]/g, '').trim().slice(0, 16) || 'Wanderer';
}

function shutdown() {
  console.log('grendel: shutting down');
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`grendel: listening on :${PORT}`);
});
