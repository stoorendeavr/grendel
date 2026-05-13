// End-to-end socket integration. Spins up the actual HTTP+Socket.IO server in
// a child process on an ephemeral port and connects with socket.io-client.
//
// Each test is wrapped in a try/finally that disconnects its sockets so a
// failure can't leave the test runner waiting on open connections.

import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io as connect } from 'socket.io-client';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 3719;
const BASE = `http://127.0.0.1:${PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
let serverProc = null;

function waitForHealth(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const req = http.get(`${BASE}/healthz`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error('healthz timeout'));
        else setTimeout(tick, 100);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('healthz timeout'));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

function getHealth() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/healthz`, (res) => {
      let s = ''; res.on('data', c => s += c);
      res.on('end', () => resolve(JSON.parse(s)));
    }).on('error', reject);
  });
}

function client() {
  const sock = connect(BASE, { transports: ['websocket'], reconnection: false });
  const ev = { lobby: [], state: [] };
  sock.on('lobby', l => ev.lobby.push(l));
  sock.on('state', s => ev.state.push(s));
  return { sock, ev };
}

function rpc(sock, name, p) {
  return new Promise(resolve => sock.emit(name, p, resolve));
}

const TEST_OPTS = { timeout: 8000 };

before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForHealth();
});

after(async () => {
  if (!serverProc) return;
  serverProc.kill('SIGTERM');
  // give it a moment to exit so the runner can shut down cleanly
  await new Promise(r => setTimeout(r, 200));
});

describe('socket integration', () => {
  test('healthz responds 200 JSON', TEST_OPTS, async () => {
    const j = await getHealth();
    assert.equal(j.ok, true);
    assert.ok('rooms' in j && 'players' in j);
  });

  test('create / join / start, both clients see playing state', TEST_OPTS, async () => {
    const a = client(); const b = client();
    try {
      await new Promise(r => a.sock.on('connect', r));
      await new Promise(r => b.sock.on('connect', r));
      const cA = await rpc(a.sock, 'create', { name: 'Grendel' });
      assert.ok(cA.code);
      const cB = await rpc(b.sock, 'join', { code: cA.code, name: 'Eofor' });
      assert.equal(cB.code, cA.code);
      const r = await rpc(a.sock, 'start', {});
      assert.equal(r.ok, true);
      await new Promise(res => setTimeout(res, 250));
      const last = a.ev.state[a.ev.state.length - 1];
      assert.equal(last.phase, 'playing');
      assert.equal(last.players.length, 2);
    } finally {
      a.sock.disconnect(); b.sock.disconnect();
      await new Promise(r => setTimeout(r, 100));
    }
  });

  test('demo mode auto-starts with bot thanes', TEST_OPTS, async () => {
    const a = client();
    try {
      await new Promise(r => a.sock.on('connect', r));
      const cA = await rpc(a.sock, 'demo', { name: 'Tester' });
      assert.ok(cA.code);
      assert.equal(cA.role, 'grendel');
      await new Promise(res => setTimeout(res, 250));
      const last = a.ev.state[a.ev.state.length - 1];
      assert.equal(last.phase, 'playing');
      const bots = last.players.filter(p => p.bot);
      assert.ok(bots.length >= 1, 'expected at least one bot player');
    } finally {
      a.sock.disconnect();
      await new Promise(r => setTimeout(r, 100));
    }
  });

  test('host disconnect tears the room down (no leftover bots)', TEST_OPTS, async () => {
    const a = client();
    try {
      await new Promise(r => a.sock.on('connect', r));
      const cA = await rpc(a.sock, 'demo', { name: 'Tester' });
      assert.ok(cA.code);
      assert.ok(cA.you);
    } finally {
      a.sock.disconnect();
    }
    // Give the server time to process the disconnect.
    await new Promise(res => setTimeout(res, 400));
    const j = await getHealth();
    assert.equal(j.players, 0, `expected 0 players after host disconnect, got ${j.players}`);
    assert.equal(j.rooms, 0, `expected 0 rooms after host disconnect, got ${j.rooms}`);
  });

  test('rejects creating a second room while already in one', TEST_OPTS, async () => {
    const a = client();
    try {
      await new Promise(r => a.sock.on('connect', r));
      const c1 = await rpc(a.sock, 'create', { name: 'Grendel' });
      assert.ok(c1.code);
      const c2 = await rpc(a.sock, 'create', { name: 'Grendel' });
      assert.equal(c2.error, 'already_in_room');
    } finally {
      a.sock.disconnect();
      await new Promise(r => setTimeout(r, 100));
    }
  });
});
