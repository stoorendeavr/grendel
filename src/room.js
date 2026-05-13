// A Room runs one match in Hrothgar's hall.
//
// Two roles:
//   - GRENDEL : the host. The kin of Cain. Cannot be wounded by iron.
//   - THANE   : every other player. Any thane may grip the beast bare-handed;
//               picking up a weapon disables their grip and instead lets them
//               stagger Grendel (which buys openings for someone else).
//
// Bots are first-class: they are full Player records with `bot: true` and have
// their `input` populated each tick by the bot AI (src/bots.js).

import {
  TICK_MS, WORLD, ROUND, ROLE,
  THANE, GRENDEL, ABILITIES, WEAPONS,
  WEAPON_SPAWN, PROJECTILE, NET, SHAPER,
} from './constants.js';
import { getMap, DEFAULT_MAP } from './maps.js';
import { sagaForEvent } from './saga.js';
import {
  clamp, dist, dist2, angleBetween, angleDiff,
  circleRectMTV, segmentRectHit, nextId,
} from './util.js';

const PHASE = { LOBBY: 'lobby', PLAYING: 'playing', ENDED: 'ended' };

const emptyInput = () => ({
  seq: 0, up: false, down: false, left: false, right: false,
  attack: false, kill: false,
  ability: null,
  aimX: 0, aimY: 0,
});

export class Room {
  constructor(code, hostSocketId, io) {
    this.code = code;
    this.hostId = hostSocketId;
    this.io = io;
    this.mapId = DEFAULT_MAP;
    this.map = getMap(this.mapId);
    this.phase = PHASE.LOBBY;
    this.players = new Map();
    this.weapons = new Map();
    this.projectiles = new Map();
    this.effects = [];
    this.saga = [];
    this.tick = 0;
    this.roundStartedAt = 0;
    this.roundEndsAt = 0;
    this.winner = null;
    this.darknessUntil = 0;
    this.weaponSpawnAt = 0;
    this.hondscioNamed = false;
    this._lastStrainAt = 0;
    this._lastBounceAt = 0;
    this._lastStrangerAt = 0;
    this._strangerNamed = false;
    this._shaperId = null;            // socketId of the Shaper this round
    this._shaperDownAnnounced = false;
    this._loop = null;
    this._lastTickAt = 0;
    this.createdAt = Date.now();
    this.botTick = null; // optional callback for bot AI
  }

  // ---------- player lifecycle ----------

  addPlayer(socketId, name, opts = {}) {
    if (this.players.size >= NET.maxPlayersPerRoom) return { error: 'room_full' };
    if (this.phase !== PHASE.LOBBY && this.phase !== PHASE.PLAYING) {
      return { error: 'room_closed' };
    }
    const isHost = socketId === this.hostId;
    const role = opts.role || (isHost ? ROLE.GRENDEL : ROLE.THANE);
    const spawn = this._pickSpawn(role);
    const baseHp = role === ROLE.GRENDEL ? GRENDEL.hp : THANE.hp;
    const baseR  = role === ROLE.GRENDEL ? GRENDEL.radius : THANE.radius;
    const p = {
      id: socketId,
      name: (name || 'Thane').slice(0, 16),
      role,
      bot: !!opts.bot,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0, angle: 0,
      hp: baseHp,
      maxHp: baseHp,
      radius: baseR,
      alive: true,
      respawnAt: 0,
      weapon: null,
      lastAttackAt: 0,
      swingUntil: 0,
      lastSwing: null,
      kills: 0,
      deaths: 0,
      damage: 0,
      cooldowns: { roar: 0, leap: 0, darkness: 0 },
      leapUntil: 0,
      leapVx: 0, leapVy: 0,
      slowUntil: 0,
      staggerUntil: 0,
      rageUsed: false,
      rageUntil: 0,
      killWindupUntil: 0,
      killWindupTarget: null,
      grappling: false,
      grappledById: null,
      shaper: false,                  // Gardner ch. 3 — one thane sings
      _lowAnnounced: false,
      input: emptyInput(),
      joinedAt: Date.now(),
    };
    this.players.set(socketId, p);
    return { player: p };
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (!p) return;
    this.players.delete(socketId);
    if (socketId === this.hostId) {
      this.phase = PHASE.ENDED;
      this.winner = 'aborted';
      this._addSaga(sagaForEvent('aborted'));
    }
  }

  setInput(socketId, input) {
    const p = this.players.get(socketId);
    if (!p) return;
    p.input = {
      seq: input.seq | 0,
      up: !!input.up, down: !!input.down, left: !!input.left, right: !!input.right,
      attack: !!input.attack, kill: !!input.kill,
      ability: ['roar','leap','darkness'].includes(input.ability) ? input.ability : null,
      aimX: clamp(+input.aimX || 0, 0, WORLD.width),
      aimY: clamp(+input.aimY || 0, 0, WORLD.height),
    };
  }

  // ---------- match lifecycle ----------

  startMatch(socketId) {
    if (socketId !== this.hostId) return { error: 'not_host' };
    if (this.phase === PHASE.PLAYING) return { error: 'already_playing' };
    const thanes = [...this.players.values()].filter(p => p.role !== ROLE.GRENDEL);
    if (thanes.length < ROUND.minPlayers - 1) return { error: 'need_more_players' };
    this._resetMatch();
    this._chooseShaper();
    this.phase = PHASE.PLAYING;
    this.roundStartedAt = Date.now();
    this.roundEndsAt = this.roundStartedAt + ROUND.durationMs;
    this.weaponSpawnAt = Date.now() + 1500;
    this._addSaga(sagaForEvent('roundStart'));
    if (this._shaperId) {
      const s = this.players.get(this._shaperId);
      if (s) this._addSaga(sagaForEvent('shaperBegin', { shaper: s.name }));
    }
    return { ok: true };
  }

  // Force start (used by demo path). Does not require a host caller.
  forceStart() {
    if (this.phase === PHASE.PLAYING) return { error: 'already_playing' };
    this._resetMatch();
    this._chooseShaper();
    this.phase = PHASE.PLAYING;
    this.roundStartedAt = Date.now();
    this.roundEndsAt = this.roundStartedAt + ROUND.durationMs;
    this.weaponSpawnAt = Date.now() + 1500;
    this._addSaga(sagaForEvent('roundStart'));
    if (this._shaperId) {
      const s = this.players.get(this._shaperId);
      if (s) this._addSaga(sagaForEvent('shaperBegin', { shaper: s.name }));
    }
    return { ok: true };
  }

  _chooseShaper() {
    const thanes = [...this.players.values()].filter(p => p.role === ROLE.THANE);
    for (const p of thanes) p.shaper = false;
    this._shaperId = null;
    this._shaperDownAnnounced = false;
    if (thanes.length === 0) return;
    const pick = thanes[Math.floor(Math.random() * thanes.length)];
    pick.shaper = true;
    this._shaperId = pick.id;
  }

  requestRestart(socketId) {
    if (socketId !== this.hostId) return { error: 'not_host' };
    if (this.phase !== PHASE.ENDED) return { error: 'not_ended' };
    this.phase = PHASE.LOBBY;
    this._resetMatch();
    return { ok: true };
  }

  _resetMatch() {
    this.tick = 0;
    this.weapons.clear();
    this.projectiles.clear();
    this.effects.length = 0;
    this.saga.length = 0;
    this.winner = null;
    this.darknessUntil = 0;
    this.hondscioNamed = false;
    this._lastStrainAt = 0;
    this._lastBounceAt = 0;
    for (const p of this.players.values()) {
      const spawn = this._pickSpawn(p.role);
      const base = p.role === ROLE.GRENDEL ? GRENDEL.hp : THANE.hp;
      p.x = spawn.x; p.y = spawn.y; p.vx = 0; p.vy = 0;
      p.hp = base; p.maxHp = base;
      p.radius = p.role === ROLE.GRENDEL ? GRENDEL.radius : THANE.radius;
      p.alive = true;
      p.respawnAt = 0;
      p.weapon = null;
      p.kills = 0; p.deaths = 0; p.damage = 0;
      p.cooldowns = { roar: 0, leap: 0, darkness: 0 };
      p.leapUntil = 0; p.leapVx = 0; p.leapVy = 0;
      p.slowUntil = 0; p.staggerUntil = 0;
      p.rageUsed = false; p.rageUntil = 0;
      p.killWindupUntil = 0; p.killWindupTarget = null;
      p.lastAttackAt = 0; p.swingUntil = 0; p.lastSwing = null;
      p.grappling = false; p.grappledById = null; p._lowAnnounced = false;
    }
  }

  // ---------- tick loop ----------

  startLoop() {
    if (this._loop) return;
    this._lastTickAt = Date.now();
    this._loop = setInterval(() => this._tick(), TICK_MS);
  }

  stopLoop() {
    if (this._loop) clearInterval(this._loop);
    this._loop = null;
  }

  // Step the simulation a fixed delta. Exposed for testing — call directly
  // instead of relying on the interval-based loop.
  step(dtMs) {
    const now = Date.now();
    const dt = Math.min(dtMs, 100) / 1000;
    this._lastTickAt = now;
    this.tick++;
    if (this.phase === PHASE.PLAYING) {
      if (this.botTick) this.botTick(this);
      this._updatePlayers(dt, now);
      this._updateProjectiles(dt, now);
      this._updateWeaponSpawns(now);
      this._resolveGrapples(dt, now);
      this._checkWinConditions(now);
    }
    const drained = this.effects.slice();
    this.effects.length = 0;
    return drained;
  }

  _tick() {
    const now = Date.now();
    const dtMs = Math.min(now - this._lastTickAt, 100);
    this._lastTickAt = now;
    const dt = dtMs / 1000;
    this.tick++;

    if (this.phase === PHASE.PLAYING) {
      if (this.botTick) this.botTick(this);
      this._updatePlayers(dt, now);
      this._updateProjectiles(dt, now);
      this._updateWeaponSpawns(now);
      this._resolveGrapples(dt, now);
      this._checkWinConditions(now);
    }

    this._broadcastState(now);
    this.effects.length = 0;
  }

  // ---------- simulation ----------

  _updatePlayers(dt, now) {
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (now >= p.respawnAt) this._respawn(p);
        continue;
      }
      if (p.role === ROLE.GRENDEL && !p.rageUsed && p.hp / p.maxHp <= ABILITIES.rage.thresholdHp) {
        p.rageUsed = true;
        p.rageUntil = now + ABILITIES.rage.durationMs;
        this._addSaga(sagaForEvent('rage'));
        // In pain, the beast cries for his underwater mother (Gardner ch. 2)
        this._addSaga(sagaForEvent('motherCave'));
        this._addEffect({ kind: 'rage', x: p.x, y: p.y, ttl: 600 });
      }
      this._movePlayer(p, dt, now);
      p.angle = angleBetween(p.x, p.y, p.input.aimX, p.input.aimY);
      this._resolveAttack(p, now);
      if (p.role === ROLE.GRENDEL && p.input.ability) this._resolveAbility(p, p.input.ability, now);
      if (p.role === ROLE.THANE) this._tryPickupWeapon(p);
    }

    for (const p of this.players.values()) {
      if (p.role !== ROLE.GRENDEL || !p.alive) continue;
      if (p.grappledById) {
        // The grip holds: Grendel cannot break free and cannot snatch.
        p.killWindupUntil = 0;
        p.killWindupTarget = null;
        continue;
      }
      if (p.killWindupUntil && now >= p.killWindupUntil) {
        const target = this.players.get(p.killWindupTarget);
        p.killWindupUntil = 0;
        p.killWindupTarget = null;
        if (target && target.alive && target.role !== ROLE.GRENDEL) {
          if (dist(p.x, p.y, target.x, target.y) <= GRENDEL.killRange + 6) {
            this._killThane(target, p);
          }
        }
      }
    }
  }

  _movePlayer(p, dt, now) {
    const i = p.input;
    let ax = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let ay = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const m = Math.hypot(ax, ay) || 1;
    ax /= m; ay /= m;

    let speed = p.role === ROLE.GRENDEL ? GRENDEL.speed : THANE.speed;
    if (p.role === ROLE.GRENDEL && now < p.rageUntil) speed *= (1 + ABILITIES.rage.speedBonus);
    if (now < p.slowUntil) speed *= ABILITIES.roar.slowFactor;
    if (now < p.staggerUntil) speed *= 0.15;
    if (p.role === ROLE.GRENDEL && p.grappledById) speed *= GRENDEL.slowDuringGrapple;

    let vx, vy;
    if (now < p.leapUntil) {
      vx = p.leapVx; vy = p.leapVy;
    } else {
      vx = ax * speed; vy = ay * speed;
    }
    p.vx = vx; p.vy = vy;

    p.x += vx * dt;
    p.y += vy * dt;
    this._resolveCollisions(p);
    p.x = clamp(p.x, p.radius, WORLD.width - p.radius);
    p.y = clamp(p.y, p.radius, WORLD.height - p.radius);
  }

  _resolveCollisions(p) {
    for (const o of this.map.obstacles) {
      const mtv = circleRectMTV(p.x, p.y, p.radius, o.x, o.y, o.w, o.h);
      if (mtv) { p.x += mtv.x; p.y += mtv.y; }
    }
  }

  _resolveAttack(p, now) {
    if (p.role === ROLE.GRENDEL) {
      if (p.input.kill && !p.killWindupUntil && !p.grappledById) {
        const target = this._closestThane(p, GRENDEL.killRange);
        if (target) {
          p.killWindupUntil = now + GRENDEL.killWindupMs;
          p.killWindupTarget = target.id;
          this._addEffect({ kind: 'killWindup', x: p.x, y: p.y, tx: target.x, ty: target.y, ttl: GRENDEL.killWindupMs });
        }
      }
      return;
    }

    // THANE.
    if (!p.weapon) {
      // Bare-handed: signal intent to grapple. Resolved in _resolveGrapples.
      p.grappling = !!p.input.attack;
      return;
    }
    p.grappling = false; // armed thanes cannot grip

    if (!p.input.attack) return;
    const w = WEAPONS[p.weapon.type];
    if (!w) return;
    if (now - p.lastAttackAt < THANE.attackCooldownMs) return;
    p.lastAttackAt = now;
    p.swingUntil = now + w.swingMs;
    p.lastSwing = { angle: p.angle, weapon: p.weapon.type, until: p.swingUntil };

    if (p.weapon.type === 'bow') {
      const proj = {
        id: nextId('pr'),
        ownerId: p.id,
        x: p.x + Math.cos(p.angle) * (p.radius + 4),
        y: p.y + Math.sin(p.angle) * (p.radius + 4),
        vx: Math.cos(p.angle) * w.projectileSpeed,
        vy: Math.sin(p.angle) * w.projectileSpeed,
        bornAt: now,
      };
      this.projectiles.set(proj.id, proj);
      this._addEffect({ kind: 'bowFire', x: proj.x, y: proj.y, angle: p.angle, ttl: 120 });
    } else {
      const grendel = this._grendel();
      if (grendel && grendel.alive) {
        const d = dist(p.x, p.y, grendel.x, grendel.y);
        if (d <= w.range + grendel.radius) {
          const aimAng = angleBetween(p.x, p.y, grendel.x, grendel.y);
          if (Math.abs(angleDiff(aimAng, p.angle)) <= w.arc) {
            this._weaponHitGrendel(grendel, p, p.weapon.type);
          }
        }
      }
    }

    p.weapon.durability -= 1;
    if (p.weapon.durability <= 0) {
      this._addEffect({ kind: 'weaponBreak', x: p.x, y: p.y, ttl: 400 });
      p.weapon = null;
    }
  }

  _resolveGrapples(dt, now) {
    const grendel = this._grendel();
    if (!grendel || !grendel.alive) return;
    let gripper = null;
    for (const p of this.players.values()) {
      if (p.role !== ROLE.THANE || !p.alive) continue;
      if (p.weapon) continue;          // armed thanes cannot grip
      if (!p.grappling) continue;
      if (dist(p.x, p.y, grendel.x, grendel.y) > THANE.grappleRange + grendel.radius) continue;
      // First valid gripper wins (closest tie-broken implicitly by iteration order)
      gripper = p;
      break;
    }
    if (!gripper) {
      if (grendel.grappledById) {
        this._addEffect({ kind: 'grappleEnd', x: grendel.x, y: grendel.y, ttl: 200 });
      }
      grendel.grappledById = null;
      this._strainStartedAt = 0;
      this._strangerNamed = false;
      return;
    }

    const wasGripped = !!grendel.grappledById;
    grendel.grappledById = gripper.id;

    // Shaper buff: if a living Shaper is within range, the song nerves on
    // the gripper and the grip drains the beast harder. (Gardner ch. 3-4)
    let multiplier = 1;
    if (this._shaperId) {
      const sh = this.players.get(this._shaperId);
      if (sh && sh.alive && dist(sh.x, sh.y, gripper.x, gripper.y) <= SHAPER.buffRange) {
        multiplier = SHAPER.gripMultiplier;
      }
    }
    const dmgG = THANE.grappleDpsToGrendel * dt * multiplier;
    const dmgB = THANE.grappleDpsFromGrendel * dt;
    grendel.hp = Math.max(0, grendel.hp - dmgG);
    gripper.damage += dmgG;
    gripper.hp = Math.max(0, gripper.hp - dmgB);

    // The Stranger (Beowulf) — once a grapple runs long enough, name the
    // gripper in the manner of Gardner ch. 11–12.
    if (!this._strangerNamed && (now - (this._strainStartedAt || now)) > 2200) {
      this._strangerNamed = true;
      this._addSaga(sagaForEvent('strangerCome', { attacker: gripper.name }));
    }
    if (!this._strainStartedAt) this._strainStartedAt = now;

    if (!wasGripped) {
      this._addEffect({ kind: 'grappleBegin', x: grendel.x, y: grendel.y, bx: gripper.x, by: gripper.y, ttl: 380 });
      this._addSaga(sagaForEvent('grappleBegin', { attacker: gripper.name }));
    }
    this._addEffect({ kind: 'grappleTick', x: grendel.x, y: grendel.y, bx: gripper.x, by: gripper.y, ttl: 80 });

    if (!this._lastStrainAt || now - this._lastStrainAt > 3000) {
      this._lastStrainAt = now;
      this._addSaga(sagaForEvent('grappleStrain'));
    }

    if (grendel.hp / grendel.maxHp <= 0.5 && !grendel._lowAnnounced) {
      grendel._lowAnnounced = true;
      this._addSaga(sagaForEvent('grendelLow'));
    }

    if (grendel.hp <= 0) this._grendelFalls(grendel, gripper);
    if (gripper.hp <= 0) {
      grendel.grappledById = null;
      gripper.grappling = false;
      this._killThane(gripper, grendel);
    }
  }

  _resolveAbility(p, ability, now) {
    if (p.cooldowns[ability] && now < p.cooldowns[ability]) return;
    const cfg = ABILITIES[ability];
    if (!cfg) return;
    if (ability === 'roar') {
      p.cooldowns.roar = now + cfg.cooldownMs;
      for (const v of this.players.values()) {
        if (v.role === ROLE.GRENDEL || !v.alive) continue;
        if (dist(p.x, p.y, v.x, v.y) <= cfg.range) {
          v.slowUntil = Math.max(v.slowUntil, now + cfg.slowMs);
        }
      }
      this._addEffect({ kind: 'roar', x: p.x, y: p.y, range: cfg.range, ttl: 700 });
      this._addSaga(sagaForEvent('roar'));
    } else if (ability === 'leap') {
      if (p.grappledById) return;
      p.cooldowns.leap = now + cfg.cooldownMs;
      const durSec = cfg.durationMs / 1000;
      const v = cfg.distance / durSec;
      p.leapVx = Math.cos(p.angle) * v;
      p.leapVy = Math.sin(p.angle) * v;
      p.leapUntil = now + cfg.durationMs;
      this._addEffect({ kind: 'leap', x: p.x, y: p.y, angle: p.angle, ttl: cfg.durationMs });
    } else if (ability === 'darkness') {
      p.cooldowns.darkness = now + cfg.cooldownMs;
      this.darknessUntil = now + cfg.durationMs;
      this._addEffect({ kind: 'darkness', ttl: cfg.durationMs });
      this._addSaga(sagaForEvent('darkness'));
    }
  }

  _updateProjectiles(dt, now) {
    for (const proj of this.projectiles.values()) {
      if (now - proj.bornAt > PROJECTILE.maxLifeMs) { this.projectiles.delete(proj.id); continue; }
      const nx = proj.x + proj.vx * dt;
      const ny = proj.y + proj.vy * dt;
      let firstT = 1;
      for (const o of this.map.obstacles) {
        const t = segmentRectHit(proj.x, proj.y, nx, ny, o.x, o.y, o.w, o.h);
        if (t !== null && t < firstT) firstT = t;
      }
      if (firstT < 1) {
        const hx = proj.x + (nx - proj.x) * firstT;
        const hy = proj.y + (ny - proj.y) * firstT;
        this._addEffect({ kind: 'arrowHit', x: hx, y: hy, ttl: 220 });
        this.projectiles.delete(proj.id);
        continue;
      }
      let hitTarget = null, hitT = 1;
      for (const p of this.players.values()) {
        if (p.id === proj.ownerId || !p.alive) continue;
        if (p.role !== ROLE.GRENDEL) continue;
        const ex = proj.x - p.x, ey = proj.y - p.y;
        const dxs = nx - proj.x, dys = ny - proj.y;
        const a = dxs*dxs + dys*dys;
        const b = 2 * (ex*dxs + ey*dys);
        const c = ex*ex + ey*ey - p.radius*p.radius;
        const disc = b*b - 4*a*c;
        if (disc < 0 || a === 0) continue;
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2 * a);
        if (t1 >= 0 && t1 <= hitT) { hitTarget = p; hitT = t1; }
      }
      if (hitTarget) {
        const owner = this.players.get(proj.ownerId);
        this._weaponHitGrendel(hitTarget, owner, 'bow');
        this._addEffect({ kind: 'arrowBounce', x: hitTarget.x, y: hitTarget.y, ttl: 240 });
        this.projectiles.delete(proj.id);
        continue;
      }
      proj.x = nx; proj.y = ny;
      if (proj.x < 0 || proj.y < 0 || proj.x > WORLD.width || proj.y > WORLD.height) {
        this.projectiles.delete(proj.id);
      }
    }
  }

  _updateWeaponSpawns(now) {
    if (now < this.weaponSpawnAt) return;
    this.weaponSpawnAt = now + WEAPON_SPAWN.intervalMs;
    if (this.weapons.size >= WEAPON_SPAWN.maxOnMap) return;
    const occupied = new Set();
    for (const w of this.weapons.values()) occupied.add(`${Math.round(w.x)},${Math.round(w.y)}`);
    const candidates = this.map.weaponSpawns.filter(s => !occupied.has(`${Math.round(s.x)},${Math.round(s.y)}`));
    if (candidates.length === 0) return;
    const spawn = candidates[Math.floor(Math.random() * candidates.length)];
    const type = WEAPON_SPAWN.types[Math.floor(Math.random() * WEAPON_SPAWN.types.length)];
    const id = nextId('w');
    this.weapons.set(id, { id, type, x: spawn.x, y: spawn.y, spawnedAt: now });
  }

  _tryPickupWeapon(p) {
    if (p.role !== ROLE.THANE) return;
    for (const w of this.weapons.values()) {
      if (dist2(p.x, p.y, w.x, w.y) <= (p.radius + 16) ** 2) {
        const cfg = WEAPONS[w.type];
        p.weapon = { type: w.type, durability: cfg.durability };
        this.weapons.delete(w.id);
        this._addEffect({ kind: 'pickup', x: w.x, y: w.y, ttl: 360 });
        break;
      }
    }
  }

  // Public: drop the thane's weapon (used by the bot AI when it decides to
  // close in for a grip). Returns true if a weapon was dropped.
  dropWeapon(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.role !== ROLE.THANE || !p.weapon) return false;
    // Spawn it back on the floor where the thane is standing.
    const w = {
      id: nextId('w'),
      type: p.weapon.type,
      x: p.x + (Math.random() - 0.5) * 30,
      y: p.y + (Math.random() - 0.5) * 30,
      spawnedAt: Date.now(),
    };
    this.weapons.set(w.id, w);
    p.weapon = null;
    return true;
  }

  // ---------- damage / death ----------

  _weaponHitGrendel(g, attacker, weaponType) {
    if (!g.alive) return;
    g.staggerUntil = Math.max(g.staggerUntil, Date.now() + GRENDEL.staggerMs);
    this._addEffect({ kind: 'sparks', x: g.x, y: g.y, ttl: 240 });
    if (!this._lastBounceAt || Date.now() - this._lastBounceAt > 4500) {
      this._lastBounceAt = Date.now();
      this._addSaga(sagaForEvent('weaponBounce', {
        attacker: attacker?.name ?? 'A thane',
        weapon: WEAPONS[weaponType]?.kenning ?? 'iron',
      }));
    }
  }

  _grendelFalls(g, killer) {
    g.alive = false;
    this.winner = 'villagers';
    this.phase = PHASE.ENDED;
    this._addSaga(sagaForEvent('armRip'));
    this._addSaga(sagaForEvent('villagerWin'));
    this._addEffect({ kind: 'armRip', x: g.x, y: g.y, angle: g.angle, killerX: killer?.x, killerY: killer?.y, ttl: 2000 });
  }

  _killThane(v, killer) {
    if (!v.alive) return;
    v.alive = false;
    v.deaths += 1;
    v.respawnAt = Date.now() + THANE.respawnMs;
    if (killer && killer.role === ROLE.GRENDEL) killer.kills += 1;
    this._addEffect({ kind: 'gore', x: v.x, y: v.y, ttl: 800 });
    if (!this.hondscioNamed) {
      this.hondscioNamed = true;
      this._addSaga(sagaForEvent('firstDeath', { victim: 'Hondscio' }));
    } else {
      this._addSaga(sagaForEvent('death', { victim: v.name }));
    }
    // The Shaper falling — Gardner ch. 10, the old harper dies.
    if (v.shaper && !this._shaperDownAnnounced) {
      this._shaperDownAnnounced = true;
      this._addSaga(sagaForEvent('shaperDown'));
    }
  }

  _respawn(p) {
    const spawn = this._pickSpawn(p.role);
    p.x = spawn.x; p.y = spawn.y; p.vx = 0; p.vy = 0;
    p.hp = p.maxHp;
    p.alive = true;
    p.weapon = null;
    p.slowUntil = 0;
    p.staggerUntil = 0;
    p.lastAttackAt = 0;
    p.grappling = false;
  }

  _closestThane(grendel, maxRange) {
    let best = null, bestD2 = (maxRange + 6) ** 2;
    for (const p of this.players.values()) {
      if (p.role === ROLE.GRENDEL || !p.alive) continue;
      const d2 = dist2(grendel.x, grendel.y, p.x, p.y);
      if (d2 <= bestD2) { best = p; bestD2 = d2; }
    }
    return best;
  }

  _grendel() {
    for (const p of this.players.values()) if (p.role === ROLE.GRENDEL) return p;
    return null;
  }

  _pickSpawn(role) {
    const points = role === ROLE.GRENDEL ? this.map.grendelSpawns : this.map.thaneSpawns;
    if (role !== ROLE.GRENDEL) {
      const g = this._grendel();
      const existing = [...this.players.values()].filter(p => p.role !== ROLE.GRENDEL && p.alive);
      // Score each spawn by (distance from Grendel) - (penalty for nearby thanes).
      let best = points[0], bestScore = -Infinity;
      for (const s of points) {
        let score = g ? dist2(s.x, s.y, g.x, g.y) : 0;
        for (const p of existing) {
          const d2 = dist2(s.x, s.y, p.x, p.y);
          if (d2 < 60 * 60) score -= 1e7; // strongly penalise overlap
        }
        // small jitter so deterministic ties don't always pick the same spawn
        score += Math.random() * 100;
        if (score > bestScore) { best = s; bestScore = score; }
      }
      return { ...best };
    }
    return { ...points[Math.floor(Math.random() * points.length)] };
  }

  // ---------- win conditions ----------

  _checkWinConditions(now) {
    if (this.phase !== PHASE.PLAYING) return;
    const grendel = this._grendel();
    if (!grendel) {
      this.phase = PHASE.ENDED;
      this.winner = 'aborted';
      this._addSaga(sagaForEvent('aborted'));
      return;
    }
    if (grendel.kills >= ROUND.grendelKillsToWin) {
      this.phase = PHASE.ENDED;
      this.winner = 'grendel';
      this._addSaga(sagaForEvent('grendelWin'));
      return;
    }
    if (now >= this.roundEndsAt) {
      this.phase = PHASE.ENDED;
      this.winner = grendel.kills >= Math.floor(ROUND.grendelKillsToWin / 2) ? 'grendel' : 'villagers';
      this._addSaga(sagaForEvent(this.winner === 'grendel' ? 'grendelWin' : 'villagerWin'));
    }
  }

  // ---------- saga / effects ----------

  _addSaga(text) {
    if (!text) return;
    this.saga.push({ id: nextId('s'), text, ts: Date.now() });
    if (this.saga.length > 40) this.saga.splice(0, this.saga.length - 40);
  }

  _addEffect(eff) {
    eff.id = nextId('fx');
    eff.startedAt = Date.now();
    this.effects.push(eff);
  }

  // ---------- broadcast ----------

  _broadcastState(now) {
    if (!this.io) return;
    this.io.to(this.code).emit('state', this._buildSnapshot(now));
  }

  _buildSnapshot(now) {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        role: p.role,
        bot: !!p.bot,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 100) / 100,
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        alive: p.alive,
        respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - now),
        weapon: p.weapon ? { type: p.weapon.type, durability: p.weapon.durability } : null,
        kills: p.kills,
        deaths: p.deaths,
        damage: Math.round(p.damage),
        slowed: now < p.slowUntil,
        staggered: now < p.staggerUntil,
        leaping: now < p.leapUntil,
        raging: now < p.rageUntil,
        swing: p.lastSwing && now < p.lastSwing.until ? p.lastSwing : null,
        cooldowns: p.role === ROLE.GRENDEL ? {
          roar:     Math.max(0, p.cooldowns.roar     - now),
          leap:     Math.max(0, p.cooldowns.leap     - now),
          darkness: Math.max(0, p.cooldowns.darkness - now),
        } : null,
        killWindup: p.role === ROLE.GRENDEL && p.killWindupUntil
          ? Math.max(0, p.killWindupUntil - now)
          : 0,
        grappling: !!p.grappling,
        grappledById: p.grappledById || null,
        canGrip: p.role === ROLE.THANE && !p.weapon,
        shaper: !!p.shaper,
      });
    }
    const weapons = [...this.weapons.values()].map(w => ({ id: w.id, type: w.type, x: w.x, y: w.y }));
    const projectiles = [...this.projectiles.values()].map(p => ({
      id: p.id, x: Math.round(p.x), y: Math.round(p.y),
      vx: Math.round(p.vx), vy: Math.round(p.vy),
    }));
    return {
      t: now,
      tick: this.tick,
      phase: this.phase,
      mapId: this.mapId,
      hostId: this.hostId,
      round: {
        startedAt: this.roundStartedAt,
        endsAt: this.roundEndsAt,
        killsToWin: ROUND.grendelKillsToWin,
      },
      darknessUntil: this.darknessUntil,
      winner: this.winner,
      shaperId: this._shaperId,
      players,
      weapons,
      projectiles,
      effects: this.effects,
      saga: this.saga.slice(-12),
    };
  }

  lobbyView() {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      shaperId: this._shaperId,
      mapId: this.mapId,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, role: p.role, bot: !!p.bot, shaper: !!p.shaper,
      })),
      minPlayers: ROUND.minPlayers,
    };
  }
}

export { PHASE };
