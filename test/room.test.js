// Room logic tests. We construct a Room with a stub io, drive it via step(),
// and inject inputs / weapons manually. Server tick code is exercised directly
// instead of relying on the setInterval loop.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { ROLE, THANE, GRENDEL, WEAPONS, ROUND, SHAPER } from '../src/constants.js';

const stubIo = () => ({ to: () => ({ emit: () => {} }) });

function makeRoom() {
  const room = new Room('TEST1', 'host', stubIo());
  room.addPlayer('host', 'Grendel');
  return room;
}

function addThane(room, id, name) {
  const r = room.addPlayer(id, name);
  return r.player;
}

function nearby(a, b, eps = 4) { return Math.hypot(a.x - b.x, a.y - b.y) <= eps; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

describe('Room — lifecycle', () => {
  test('host becomes Grendel', () => {
    const r = makeRoom();
    const g = [...r.players.values()].find(p => p.role === ROLE.GRENDEL);
    assert.ok(g, 'no grendel');
    assert.equal(g.id, 'host');
    assert.equal(g.maxHp, GRENDEL.hp);
  });

  test('joiners become thanes (no chosen Beowulf)', () => {
    const r = makeRoom();
    const t1 = addThane(r, 'A', 'Eofor');
    const t2 = addThane(r, 'B', 'Wulf');
    assert.equal(t1.role, ROLE.THANE);
    assert.equal(t2.role, ROLE.THANE);
    // No player has any other role
    for (const p of r.players.values()) {
      assert.ok(p.role === ROLE.GRENDEL || p.role === ROLE.THANE);
    }
  });

  test('startMatch requires host and at least one thane', () => {
    const r = makeRoom();
    let res = r.startMatch('A'); // not the host
    assert.equal(res.error, 'not_host');
    res = r.startMatch('host'); // no thanes yet
    assert.equal(res.error, 'need_more_players');
    addThane(r, 'A', 'Eofor');
    res = r.startMatch('host');
    assert.equal(res.ok, true);
    assert.equal(r.phase, 'playing');
  });

  test('removing the host ends the match as aborted', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    r.removePlayer('host');
    assert.equal(r.phase, 'ended');
    assert.equal(r.winner, 'aborted');
  });

  test('lobbyView reports phase and players', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    const lv = r.lobbyView();
    assert.equal(lv.phase, 'lobby');
    assert.equal(lv.hostId, 'host');
    assert.equal(lv.players.length, 2);
    assert.ok(lv.players.find(p => p.role === ROLE.GRENDEL));
  });
});

describe('Room — combat rules', () => {
  test('thane weapons do 0 damage to Grendel (book canon) but stagger him', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');

    const g = r._grendel();
    const hpBefore = g.hp;

    // Position thane next to Grendel; give him an axe.
    t.x = g.x + 20; t.y = g.y;
    t.weapon = { type: 'axe', durability: 4 };
    r.setInput('A', { up: false, down: false, left: false, right: false,
                       attack: true, kill: false, ability: null,
                       aimX: g.x, aimY: g.y });
    // also Grendel idle (no input)
    r.step(50);
    // Stagger should have been applied
    assert.ok(g.staggerUntil > 0, 'expected stagger after weapon hit');
    // HP unchanged
    assert.equal(g.hp, hpBefore);
  });

  test('Grendel can snatch a thane in range; first kill is Hondscio', async () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Beowulf');     // even named Beowulf — first kill renames in saga
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 30; t.y = g.y;
    r.setInput('host', { kill: true, aimX: t.x, aimY: t.y });
    // first tick arms the windup
    r.step(20);
    // wait real time past the windup, then tick again to resolve it
    await sleep(GRENDEL.killWindupMs + 40);
    r.step(20);
    assert.equal(t.alive, false, 'thane should be killed');
    assert.equal(g.kills, 1);
    const lines = r.saga.map(s => s.text).join(' | ');
    assert.match(lines, /Hondscio/);
  });

  test('Grendel cannot snatch while gripped', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    addThane(r, 'B', 'Aeschere');
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 20; t.y = g.y;
    t.weapon = null;
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    const t2 = r.players.get('B');
    t2.x = g.x - 25; t2.y = g.y;
    r.setInput('host', { kill: true, aimX: t2.x, aimY: t2.y });
    // First tick: windup arms in _resolveAttack (before grapple is resolved),
    // then _resolveGrapples engages the grip. Next tick's post-loop clears
    // the windup because the grip is now active.
    r.step(50);
    assert.equal(g.grappledById, 'A');
    r.setInput('host', { kill: true, aimX: t2.x, aimY: t2.y }); // re-assert intent
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    t.x = g.x + 20; t.y = g.y;  // pin so grip persists
    r.step(50);
    assert.equal(g.grappledById, 'A', 'grip should still hold');
    assert.equal(g.killWindupUntil, 0, 'snatch must be impossible while gripped');
  });
});

describe('Room — bare-handed grapple', () => {
  test('only bare-handed thanes can grip; armed thanes cannot', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 20; t.y = g.y;
    t.weapon = { type: 'spear', durability: 3 };
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    r.step(50);
    assert.equal(g.grappledById, null, 'armed thane must not engage grip');
  });

  test('grapple drains Grendel HP and damages the gripper', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 20; t.y = g.y;
    t.weapon = null;
    const gHp0 = g.hp;
    const tHp0 = t.hp;
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    // step 1 second total in 50ms slices, holding the grip
    for (let i = 0; i < 20; i++) {
      r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
      // pin positions so simulation can't drift them out of range
      t.x = g.x + 20; t.y = g.y;
      r.step(50);
    }
    // ~1s drain: ~THANE.grappleDpsToGrendel hp; ~THANE.grappleDpsFromGrendel on gripper
    const gDrained = gHp0 - g.hp;
    const tDrained = tHp0 - t.hp;
    assert.ok(gDrained > THANE.grappleDpsToGrendel * 0.5, `grendel drained too little: ${gDrained}`);
    assert.ok(tDrained > THANE.grappleDpsFromGrendel * 0.4, `gripper not hurt enough: ${tDrained}`);
  });

  test('Grendel HP -> 0 via grip triggers villager win and arm-rip', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    // Drop grendel HP very low to make this fast
    g.hp = 5;
    t.x = g.x + 20; t.y = g.y;
    t.weapon = null;
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    // Step until winner declared (cap at 1s of frames)
    for (let i = 0; i < 40 && r.winner == null; i++) {
      r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
      t.x = g.x + 20; t.y = g.y;
      r.step(50);
    }
    assert.equal(r.winner, 'villagers');
    assert.equal(r.phase, 'ended');
    const lines = r.saga.map(s => s.text).join(' | ');
    assert.match(lines, /arm|limb|shoulder/i, 'expected arm-rip saga line');
  });

  test('gripper death ends the grip without ending the round', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    addThane(r, 'B', 'spare');         // keeps a thane alive so round continues
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 20; t.y = g.y;
    t.hp = 1; // about to die in the first tick
    t.weapon = null;
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    r.step(60);
    // After one tick of grapple, gripper should be dead, grip released, round still on.
    assert.equal(t.alive, false);
    assert.equal(g.grappledById, null);
    assert.equal(r.phase, 'playing');
  });
});

describe('Room — abilities, projectiles, weapons', () => {
  test('roar slows all thanes in range', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 100; t.y = g.y;
    r.setInput('host', { ability: 'roar', aimX: t.x, aimY: t.y });
    r.step(50);
    assert.ok(t.slowUntil > Date.now(), 'thane should be slowed by roar');
    // Roar puts roar on cooldown
    assert.ok(g.cooldowns.roar > Date.now());
  });

  test('leap moves Grendel forward', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    const x0 = g.x;
    // aim east
    r.setInput('host', { ability: 'leap', aimX: g.x + 500, aimY: g.y });
    // tick across the leap window
    for (let i = 0; i < 10; i++) r.step(40);
    assert.ok(g.x > x0 + 50, `expected Grendel to have leapt east; x went ${x0} → ${g.x}`);
  });

  test('darkness sets a darkness expiry on the room', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    r.setInput('host', { ability: 'darkness', aimX: 640, aimY: 400 });
    r.step(50);
    assert.ok(r.darknessUntil > Date.now());
  });

  test('weapon pickup happens when a thane walks over a weapon', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    r.weapons.set('wpn', { id: 'wpn', type: 'spear', x: t.x, y: t.y, spawnedAt: Date.now() });
    r.step(40);
    assert.ok(t.weapon, 'thane should pick up the spear');
    assert.equal(t.weapon.type, 'spear');
    assert.equal(r.weapons.has('wpn'), false);
  });

  test('weapon breaks when durability runs out', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    t.x = g.x + 20; t.y = g.y;
    t.weapon = { type: 'spear', durability: 1 };
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
    r.step(50);
    assert.equal(t.weapon, null, 'weapon should break when durability hits 0');
  });

  test('dropWeapon returns the weapon to the floor', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    t.weapon = { type: 'axe', durability: 4 };
    const ok = r.dropWeapon('A');
    assert.equal(ok, true);
    assert.equal(t.weapon, null);
    const dropped = [...r.weapons.values()].find(w => w.type === 'axe');
    assert.ok(dropped, 'dropped weapon should appear in r.weapons');
  });
});

describe('Room — win conditions', () => {
  test('Grendel wins at the kill threshold', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    g.kills = ROUND.grendelKillsToWin;
    r.step(50);
    assert.equal(r.phase, 'ended');
    assert.equal(r.winner, 'grendel');
  });

  test('time-up with low kills -> villagers win', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    r.roundEndsAt = Date.now() - 1; // already past time
    r.step(50);
    assert.equal(r.phase, 'ended');
    assert.equal(r.winner, 'villagers');
  });

  test('time-up with sufficient kills -> grendel wins on tiebreak', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const g = r._grendel();
    g.kills = Math.floor(ROUND.grendelKillsToWin / 2);
    r.roundEndsAt = Date.now() - 1;
    r.step(50);
    assert.equal(r.winner, 'grendel');
  });
});

describe('Room — the Shaper (Gardner ch. 3-4)', () => {
  test('one thane is chosen Shaper at match start', () => {
    const r = makeRoom();
    addThane(r, 'A', 'Eofor');
    addThane(r, 'B', 'Unferth');
    addThane(r, 'C', 'Hrothulf');
    r.startMatch('host');
    const shapers = [...r.players.values()].filter(p => p.shaper);
    assert.equal(shapers.length, 1, 'exactly one Shaper per round');
    assert.equal(shapers[0].role, ROLE.THANE);
    assert.equal(r._shaperId, shapers[0].id);
  });

  test('Shaper near a gripper boosts grip DPS to Grendel', async () => {
    const r = makeRoom();
    const a = addThane(r, 'A', 'Gripper');
    addThane(r, 'B', 'Hrothulf');
    r.startMatch('host');
    const g = r._grendel();
    // Force A to be Shaper AND the gripper, sitting next to Grendel.
    for (const p of r.players.values()) p.shaper = false;
    a.shaper = true;
    r._shaperId = a.id;
    a.x = g.x + 20; a.y = g.y; a.weapon = null;
    r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });

    const hp0 = g.hp;
    for (let i = 0; i < 10; i++) {
      r.setInput('A', { attack: true, aimX: g.x, aimY: g.y });
      a.x = g.x + 20; a.y = g.y;
      r.step(50);
    }
    const drained = hp0 - g.hp;
    // With multiplier 1.45 and 0.5s of grip @ 140 dps, drain should well exceed
    // the unbuffed amount of ~70 hp.
    assert.ok(drained > 70 * 1.2, `expected Shaper-boosted drain > ${70 * 1.2}, got ${drained}`);
  });

  test('killing the Shaper logs a Gardner ch. 10 saga line', () => {
    const r = makeRoom();
    const a = addThane(r, 'A', 'Theharper');
    addThane(r, 'B', 'Other');
    r.startMatch('host');
    // Force A as Shaper
    for (const p of r.players.values()) p.shaper = false;
    a.shaper = true;
    r._shaperId = a.id;
    const g = r._grendel();
    a.x = g.x + 30; a.y = g.y;
    // Manually trigger the kill
    r._killThane(a, g);
    const lines = r.saga.map(s => s.text).join(' | ');
    assert.match(lines, /Shaper falls|Hart's songs are silent|harper is dead|grieves the Shaper/);
  });

  test('snapshot carries shaperId and per-player shaper flag', () => {
    const r = makeRoom();
    const a = addThane(r, 'A', 'X');
    addThane(r, 'B', 'Y');
    r.startMatch('host');
    const snap = r._buildSnapshot(Date.now());
    assert.ok(snap.shaperId);
    const shaperSnap = snap.players.find(p => p.shaper);
    assert.ok(shaperSnap, 'snapshot should include a player with shaper:true');
    assert.equal(shaperSnap.id, snap.shaperId);
  });
});

describe('Room — snapshot', () => {
  test('snapshot contains required fields and per-player canGrip', () => {
    const r = makeRoom();
    const t = addThane(r, 'A', 'Eofor');
    r.startMatch('host');
    const snap = r._buildSnapshot(Date.now());
    assert.ok(snap.players.length === 2);
    assert.ok(snap.round && snap.round.killsToWin === ROUND.grendelKillsToWin);
    const tSnap = snap.players.find(p => p.id === 'A');
    assert.equal(tSnap.canGrip, true, 'bare-handed thane should be marked canGrip');
    t.weapon = { type: 'spear', durability: 3 };
    const snap2 = r._buildSnapshot(Date.now());
    const tSnap2 = snap2.players.find(p => p.id === 'A');
    assert.equal(tSnap2.canGrip, false, 'armed thane should NOT be marked canGrip');
  });
});
