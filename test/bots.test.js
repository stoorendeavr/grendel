// Bot AI sanity tests. We don't tightly assert any specific behavior — just
// that the bots write valid inputs, don't crash, and produce sensible game
// state when run a couple of seconds.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { tickBots } from '../src/bots.js';
import { ROLE } from '../src/constants.js';

const stubIo = () => ({ to: () => ({ emit: () => {} }) });

function demoRoom(thaneBots = 3) {
  const r = new Room('TEST2', 'host', stubIo());
  r.botTick = (room) => tickBots(room);
  r.addPlayer('host', 'Grendel', { bot: true });
  for (let i = 0; i < thaneBots; i++) {
    r.addPlayer(`b${i}`, `Bot${i}`, { bot: true, role: ROLE.THANE });
  }
  r.forceStart();
  return r;
}

describe('Bots', () => {
  test('bots produce valid input each tick (no NaNs, no crashes)', () => {
    const r = demoRoom(3);
    for (let i = 0; i < 30; i++) r.step(33);
    for (const p of r.players.values()) {
      assert.ok(Number.isFinite(p.input.aimX) && Number.isFinite(p.input.aimY), `${p.name} bad aim`);
      assert.equal(typeof p.input.attack, 'boolean');
      assert.equal(typeof p.input.kill, 'boolean');
    }
  });

  test('Grendel bot eventually pursues a thane', () => {
    const r = demoRoom(1);
    const g = r._grendel();
    const t = [...r.players.values()].find(p => p.role === ROLE.THANE);
    // place far apart on opposite ends
    g.x = 200; g.y = 400;
    t.x = 1080; t.y = 400;
    const d0 = Math.hypot(g.x - t.x, g.y - t.y);
    for (let i = 0; i < 90; i++) r.step(33);  // ~3 sec
    const d1 = Math.hypot(g.x - t.x, g.y - t.y);
    assert.ok(d1 < d0, `Grendel did not close distance: ${d0.toFixed(0)} → ${d1.toFixed(0)}`);
  });

  test('thane bots end up doing something — moving, picking up, gripping, etc.', () => {
    const r = demoRoom(3);
    // Make weapons immediately available so the "armed" strategy is exercised.
    r.weaponSpawnAt = 0;
    const positions = new Map([...r.players.values()].map(p => [p.id, { x: p.x, y: p.y }]));
    for (let i = 0; i < 90; i++) r.step(33);
    let moved = 0;
    for (const p of r.players.values()) {
      const p0 = positions.get(p.id);
      const d = Math.hypot(p.x - p0.x, p.y - p0.y);
      if (d > 20) moved++;
    }
    assert.ok(moved >= 2, `expected ≥2 players to have moved meaningfully; got ${moved}`);
  });

  test('the simulation does not corrupt — no NaN positions after long run', () => {
    const r = demoRoom(3);
    for (let i = 0; i < 600; i++) r.step(33);  // ~20s
    for (const p of r.players.values()) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.name} NaN position`);
      assert.ok(Number.isFinite(p.hp), `${p.name} NaN hp`);
    }
  });
});
