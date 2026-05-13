// Server-side bot AI. Called once per tick by the Room; reads game state
// and writes synthetic `input` records into bot players. Two behaviors:
//
//   - Grendel bot: wanders, chases the nearest thane, snatches when in range,
//     uses Roar / Leap reactively.
//   - Thane bot: alternates between two strategies — "armed" thanes pick up
//     weapons and harass; "barehand" thanes close in for the famous grip.
//     A few bots commit to each strategy so the demo feels like a real fight.

import {
  WORLD, ROLE, THANE, GRENDEL, ABILITIES,
} from './constants.js';

const dist  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

// Each bot gets a persistent strategy tag and tiny memory blob the AI can use
// across ticks. We stash it on the player record under `_ai` (which the snapshot
// builder never reads, so it's invisible to clients).
function ai(p) {
  if (!p._ai) {
    p._ai = {
      strategy: null,
      target: null,
      sinceDecisionMs: 0,
      flailX: 0, flailY: 0,
      wanderX: WORLD.width / 2, wanderY: WORLD.height / 2,
      wanderNextAt: 0,
    };
  }
  return p._ai;
}

// During the opening grace window after a match starts, bots wander
// harmlessly — no attack inputs, no grappling, no kills. This gives a
// solo-demo Grendel a chance to find her footing before the hall closes in.
function inGrace(room, nowMs) {
  const grace = room.graceMs || 0;
  if (!grace) return false;
  if (!room.roundStartedAt) return false;
  return nowMs < room.roundStartedAt + grace;
}

export function tickBots(room, nowMs = Date.now()) {
  const grace = inGrace(room, nowMs);
  for (const p of room.players.values()) {
    if (!p.bot || !p.alive) continue;
    if (p.role === ROLE.GRENDEL)      tickGrendelBot(room, p, nowMs, grace);
    else if (p.role === ROLE.THANE)   tickThaneBot(room, p, nowMs, grace);
  }
}

// ---------- Grendel ----------

function tickGrendelBot(room, p, now, grace) {
  const a = ai(p);
  a.sinceDecisionMs += 33;

  // Pick a target: nearest alive thane.
  let nearest = null, nearestD = Infinity;
  for (const o of room.players.values()) {
    if (o.role !== ROLE.THANE || !o.alive) continue;
    const d = dist2(p.x, p.y, o.x, o.y);
    if (d < nearestD) { nearest = o; nearestD = d; }
  }

  // If no thane is alive, wander toward the centre.
  let aimX, aimY, walkX, walkY;
  if (!nearest) {
    aimX = WORLD.width / 2; aimY = WORLD.height / 2;
    walkX = aimX; walkY = aimY;
  } else {
    aimX = nearest.x; aimY = nearest.y;
    walkX = nearest.x; walkY = nearest.y;
  }

  const dx = walkX - p.x, dy = walkY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = {
    up:    dy < -6,
    down:  dy > 6,
    left:  dx < -6,
    right: dx > 6,
    attack: false,
    kill:   false,
    ability: null,
    aimX, aimY,
    seq: (p.input.seq || 0) + 1,
  };

  // Reactive ability use:
  if (nearest) {
    const inKill = nearestD <= (GRENDEL.killRange + 6) ** 2;
    if (inKill) want.kill = true;

    // Roar: when several thanes are within 240, slow them.
    if (a.sinceDecisionMs > 500) {
      let close = 0;
      for (const o of room.players.values()) {
        if (o.role === ROLE.THANE && o.alive && dist(p.x, p.y, o.x, o.y) < 240) close++;
      }
      if (close >= 2 && !p.cooldowns.roar || p.cooldowns.roar <= now) {
        want.ability = 'roar';
      }
    }
    // Leap: close a gap of 130-260px to a target.
    const distNearest = Math.sqrt(nearestD);
    if (!want.ability && distNearest > 130 && distNearest < 280 && p.cooldowns.leap <= now) {
      want.ability = 'leap';
    }
    // Darkness: very occasionally
    if (!want.ability && p.cooldowns.darkness <= now && Math.random() < 0.002) {
      want.ability = 'darkness';
    }
    if (want.ability) a.sinceDecisionMs = 0;
  }

  room.setInput(p.id, want);
}

// ---------- Thane ----------

function tickThaneBot(room, p, now, grace) {
  const a = ai(p);

  // Decide a strategy on first tick or after long inactivity.
  if (!a.strategy) {
    a.strategy = Math.random() < 0.5 ? 'armed' : 'barehand';
  }

  const grendel = room._grendel ? room._grendel() : findGrendel(room);
  if (!grendel || !grendel.alive) {
    room.setInput(p.id, { ...zero(), aimX: p.x, aimY: p.y, seq: (p.input.seq || 0) + 1 });
    return;
  }

  // During the grace period, the bot wanders harmlessly. No attack input, no
  // grapple, no chase. Just drifts toward a slowly-changing point along the
  // edges of the hall — the thane has not yet noticed the beast.
  if (grace) {
    if (!a.wanderNextAt || now >= a.wanderNextAt) {
      a.wanderX = 120 + Math.random() * (WORLD.width - 240);
      a.wanderY = 120 + Math.random() * (WORLD.height - 240);
      a.wanderNextAt = now + 1500 + Math.random() * 2000;
    }
    const inp = dirInput(p, a.wanderX, a.wanderY, false, false, { x: a.wanderX, y: a.wanderY });
    room.setInput(p.id, inp);
    return;
  }

  const dG = dist(p.x, p.y, grendel.x, grendel.y);

  if (a.strategy === 'barehand') {
    // If somehow holding a weapon, drop it so we can grip.
    if (p.weapon) room.dropWeapon(p.id);
    // Approach and grip when in range; back off slightly when very low HP.
    const veryLow = p.hp / p.maxHp < 0.25;
    if (veryLow) {
      // retreat from Grendel toward the nearest wall corner
      const tx = p.x < WORLD.width / 2 ? 80 : WORLD.width - 80;
      const ty = p.y < WORLD.height / 2 ? 80 : WORLD.height - 80;
      room.setInput(p.id, dirInput(p, tx, ty, false, false, grendel));
      return;
    }
    const inGrip = dG <= THANE.grappleRange + grendel.radius;
    room.setInput(p.id, dirInput(p, grendel.x, grendel.y, inGrip, false, grendel));
    return;
  }

  // armed strategy
  if (!p.weapon) {
    // Find nearest weapon on the floor.
    let nearest = null, nd = Infinity;
    for (const w of room.weapons.values()) {
      const d = dist2(p.x, p.y, w.x, w.y);
      if (d < nd) { nearest = w; nd = d; }
    }
    if (nearest) {
      room.setInput(p.id, dirInput(p, nearest.x, nearest.y, false, false, grendel));
      return;
    }
    // No weapon available — switch to barehand strategy this round.
    a.strategy = 'barehand';
    room.setInput(p.id, dirInput(p, grendel.x, grendel.y, false, false, grendel));
    return;
  }

  // armed: maintain weapon range, swing when in arc; flee if too close
  const weapon = p.weapon.type;
  const idealMin = weapon === 'bow' ? 200 : 30;
  const idealMax = weapon === 'bow' ? 450 : 60;
  let walkX = grendel.x, walkY = grendel.y;
  let approaching = true;
  if (dG < idealMin) {
    // back away — walk in the opposite direction
    walkX = p.x + (p.x - grendel.x);
    walkY = p.y + (p.y - grendel.y);
    approaching = false;
  } else if (dG > idealMax) {
    walkX = grendel.x; walkY = grendel.y;
  } else {
    walkX = p.x; walkY = p.y; // hold position
    approaching = false;
  }
  const inSwing = dG <= idealMax + grendel.radius && approaching === false;
  room.setInput(p.id, dirInput(p, walkX, walkY, inSwing, false, grendel));
}

function zero() {
  return { up: false, down: false, left: false, right: false,
           attack: false, kill: false, ability: null, aimX: 0, aimY: 0 };
}

function dirInput(p, tx, ty, attack, kill, aimTarget) {
  const dx = tx - p.x, dy = ty - p.y;
  const aim = aimTarget ?? { x: tx, y: ty };
  return {
    seq: (p.input.seq || 0) + 1,
    up:    dy < -6,
    down:  dy >  6,
    left:  dx < -6,
    right: dx >  6,
    attack: !!attack,
    kill:   !!kill,
    ability: null,
    aimX: aim.x, aimY: aim.y,
  };
}

function findGrendel(room) {
  for (const p of room.players.values()) if (p.role === ROLE.GRENDEL) return p;
  return null;
}
