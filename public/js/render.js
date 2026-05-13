// Renderer for Heorot. Strives for a darkly literary look:
//   - warm hearth-fire light pool at the centre of the hall
//   - hart-antlers above the great door, hanging shields, mead-tables
//   - helmed thanes (Anglo-Saxon spangenhelm silhouette)
//   - Beowulf with a gilded helm and bare hands (no weapon)
//   - Grendel: tall, hunched, dragging knuckles, pale yellow eyes
//   - signature "arm-rip" effect when Grendel falls
//
// Networking: snapshot interpolation for remotes; local player snapped+lerped.

import { WORLD, WEAPONS, GRENDEL, THANE, ROLE } from '/shared/constants.js?v=__BUILD__';
import { getMap } from '/shared/maps.js?v=__BUILD__';

const INTERP_DELAY_MS = 100;

export class Renderer {
  constructor(canvas, net) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.net = net;
    this.map = getMap('heorot');
    this.particles = [];
    this.effectsSeen = new Set();
    this.shake = 0;
    this.darknessFade = 0;
    this.lastWalkPhase = new Map();
    this.localLerp = { x: 0, y: 0, hasInit: false };
    this.bloodSplats = []; // persistent gore on the floor (cleared on restart)
    this.armRip = null;    // { startedAt, x, y, angle, killerX, killerY }
    this.timeOrigin = performance.now();
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
  }

  reset() {
    this.particles.length = 0;
    this.bloodSplats.length = 0;
    this.armRip = null;
    this.effectsSeen.clear();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    const sx = w / WORLD.width;
    const sy = h / WORLD.height;
    this.scale = Math.min(sx, sy);
    this.canvas.width  = Math.round(WORLD.width  * this.scale * dpr);
    this.canvas.height = Math.round(WORLD.height * this.scale * dpr);
    this.canvas.style.width  = Math.round(WORLD.width  * this.scale) + 'px';
    this.canvas.style.height = Math.round(WORLD.height * this.scale) + 'px';
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = ((w - WORLD.width  * this.scale) / 2) + 'px';
    this.canvas.style.top  = ((h - WORLD.height * this.scale) / 2) + 'px';
    this.dpr = dpr;
  }

  screenToWorld(canvasX, canvasY) {
    return {
      x: canvasX / this.dpr / this.scale,
      y: canvasY / this.dpr / this.scale,
    };
  }

  draw(now) {
    const snaps = this.net.snapshots;
    if (snaps.length === 0) { this._drawWaiting(); return; }
    const latest = snaps[snaps.length - 1];
    const targetT = latest.t - INTERP_DELAY_MS;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= targetT) { a = snaps[i]; b = snaps[Math.min(i + 1, snaps.length - 1)]; break; }
    }
    const span = Math.max(1, b.t - a.t);
    const t = Math.max(0, Math.min(1, (targetT - a.t) / span));

    this._ingestEffects(latest);
    if (latest.phase === 'lobby') this.reset();

    const darkRemaining = Math.max(0, (latest.darknessUntil || 0) - Date.now());
    const targetDark = darkRemaining > 0 ? 1 : 0;
    this.darknessFade += (targetDark - this.darknessFade) * 0.1;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.scale * this.dpr, this.scale * this.dpr);

    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - 0.4);
    }
    ctx.translate(sx, sy);

    this._drawFloor(now);
    this._drawBloodSplats();
    this._drawWalls();
    this._drawShields(now);
    this._drawAntlers();
    this._drawHearth(now);
    this._drawObstacles();
    this._drawTorches(now);

    for (const w of latest.weapons) this._drawWeaponPickup(w, now);

    this._drawProjectilesInterp(a, b, t);
    this._drawGrappleLines(latest);
    this._drawPlayers(a, b, t, latest, now);

    this._updateAndDrawParticles();
    if (this.armRip) this._drawArmRip(now);

    if (this.darknessFade > 0.01) this._drawDarkness();
    this._drawHearthLightOverlay(now); // soft glow over everything

    ctx.restore();
  }

  _drawWaiting() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0707';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale * this.dpr, this.scale * this.dpr);
    ctx.fillStyle = '#8a7765';
    ctx.font = '14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Hearing for the beast in the moor…', WORLD.width / 2, WORLD.height / 2);
    ctx.restore();
  }

  // ---------- map / hall ----------

  _drawFloor(now) {
    const ctx = this.ctx;
    ctx.fillStyle = this.map.bg;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    // plank rows
    const plankH = 28;
    for (let y = 0; y < WORLD.height; y += plankH) {
      const idx = (y / plankH) | 0;
      ctx.fillStyle = idx % 2 === 0 ? this.map.floor : this.map.floorAlt;
      ctx.fillRect(0, y, WORLD.width, plankH);
      // plank seam shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y, WORLD.width, 1);
      // wood grain — a few faint vertical streaks per plank
      ctx.fillStyle = 'rgba(255,210,160,0.025)';
      for (let i = 0; i < 6; i++) {
        const gx = ((idx * 37) + i * 213) % WORLD.width;
        ctx.fillRect(gx, y + 4, 1, plankH - 8);
      }
    }
  }

  _drawBloodSplats() {
    const ctx = this.ctx;
    for (const s of this.bloodSplats) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawWalls() {
    const ctx = this.ctx;
    for (const o of this.map.obstacles) {
      if (o.kind !== 'wall') continue;
      ctx.fillStyle = this.map.wallColor;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // carved timber edge
      ctx.fillStyle = 'rgba(255,200,140,0.06)';
      ctx.fillRect(o.x, o.y, o.w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(o.x, o.y + o.h - 2, o.w, 2);
    }
  }

  _drawShields(now) {
    const ctx = this.ctx;
    for (const sh of (this.map.shields || [])) {
      const dx = sh.side === 'east' ? -14 : 14;
      const cx = sh.x + dx;
      const cy = sh.y;
      // strap
      ctx.fillStyle = '#3a2516';
      ctx.fillRect(cx - 1, cy - 18, 2, 8);
      // shield body
      ctx.fillStyle = '#5a3a22';
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a2516';
      ctx.lineWidth = 2;
      ctx.stroke();
      // boss
      ctx.fillStyle = '#a07a3a';
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
      // bands
      ctx.strokeStyle = '#3a2516';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
    }
  }

  _drawAntlers() {
    if (!this.map.antlers) return;
    const ctx = this.ctx;
    const { x, y } = this.map.antlers;
    // gilded hart antlers above the great door
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#d8a648';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    // left antler
    for (const path of LEFT_ANTLER_PATHS) {
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
    }
    // mirror for right antler
    ctx.scale(-1, 1);
    for (const path of LEFT_ANTLER_PATHS) {
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      ctx.stroke();
    }
    ctx.restore();
    // gold dust glow
    const g = ctx.createRadialGradient(x, y, 4, x, y, 70);
    g.addColorStop(0, 'rgba(255,200,100,0.20)');
    g.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 80, y - 50, 160, 80);
  }

  _drawHearth(now) {
    if (!this.map.hearth) return;
    const ctx = this.ctx;
    const h = this.map.hearth;
    const t = (now - this.timeOrigin) / 100;
    // stone ring
    ctx.fillStyle = '#1c1410';
    ctx.beginPath(); ctx.arc(h.x, h.y, h.radius + 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2e2017';
    ctx.beginPath(); ctx.arc(h.x, h.y, h.radius + 2, 0, Math.PI * 2); ctx.fill();
    // ember bed
    ctx.fillStyle = '#3a1a08';
    ctx.beginPath(); ctx.arc(h.x, h.y, h.radius - 4, 0, Math.PI * 2); ctx.fill();
    // flames — three offset blobs
    for (let i = 0; i < 7; i++) {
      const ang = i * (Math.PI * 2 / 7) + Math.sin(t / 3 + i) * 0.25;
      const r = (h.radius - 10) + Math.sin(t / 2 + i * 1.3) * 4;
      const fx = h.x + Math.cos(ang) * (r * 0.35);
      const fy = h.y + Math.sin(ang) * (r * 0.35) - 4 - Math.sin(t / 2 + i) * 4;
      const fr = 7 + (Math.sin(t / 1.7 + i) + 1) * 5;
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
      g.addColorStop(0, 'rgba(255, 220, 120, 0.9)');
      g.addColorStop(0.4, 'rgba(255, 130, 40, 0.55)');
      g.addColorStop(1, 'rgba(255, 60, 10, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
    }
    // central bright core
    const core = ctx.createRadialGradient(h.x, h.y - 2, 0, h.x, h.y - 2, h.radius);
    core.addColorStop(0, 'rgba(255, 240, 170, 0.85)');
    core.addColorStop(0.5, 'rgba(255, 130, 40, 0.4)');
    core.addColorStop(1, 'rgba(255, 60, 10, 0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(h.x, h.y - 2, h.radius, 0, Math.PI * 2); ctx.fill();
  }

  _drawObstacles() {
    const ctx = this.ctx;
    for (const o of this.map.obstacles) {
      if (o.kind === 'wall') continue;
      if (o.kind === 'table' || o.kind === 'bench') {
        // wood slab
        const grad = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        grad.addColorStop(0, '#6a4426');
        grad.addColorStop(1, '#3a2516');
        ctx.fillStyle = grad;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        // top highlight
        ctx.fillStyle = 'rgba(255,200,140,0.08)';
        ctx.fillRect(o.x, o.y, o.w, 2);
        // bottom shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(o.x, o.y + o.h - 3, o.w, 3);
        // plank seams
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        if (o.kind === 'table') {
          for (let x = o.x + 36; x < o.x + o.w; x += 36) ctx.fillRect(x, o.y + 2, 1, o.h - 4);
        } else {
          for (let y = o.y + 36; y < o.y + o.h; y += 36) ctx.fillRect(o.x + 2, y, o.w - 4, 1);
        }
      } else if (o.kind === 'pillar') {
        ctx.fillStyle = '#3a2516';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#5a3a22';
        ctx.fillRect(o.x + 3, o.y + 3, o.w - 6, o.h - 6);
        ctx.fillStyle = '#d8a648';
        ctx.fillRect(o.x + 6, o.y + 6, o.w - 12, 2); // gold trim top
        ctx.fillRect(o.x + 6, o.y + o.h - 8, o.w - 12, 2); // gold trim bottom
      } else if (o.kind === 'hearthstone') {
        ctx.fillStyle = '#1c1410';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = 'rgba(255,160,60,0.18)';
        ctx.fillRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4);
      }
    }
  }

  _drawTorches(now) {
    // four wall torches at the side benches — small flickering points
    const ctx = this.ctx;
    const t = (now - this.timeOrigin) / 200;
    const positions = [
      { x: 90,  y: 200 }, { x: 90,  y: 600 },
      { x: WORLD.width - 90, y: 200 }, { x: WORLD.width - 90, y: 600 },
    ];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const flicker = 0.7 + Math.sin(t + i * 1.5) * 0.3;
      const fr = 14 * flicker;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 90);
      g.addColorStop(0, `rgba(255,200,90,${0.25 * flicker})`);
      g.addColorStop(0.4, `rgba(255,140,40,${0.15 * flicker})`);
      g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 90, p.y - 90, 180, 180);
      // tiny flame
      const fg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fr);
      fg.addColorStop(0, 'rgba(255,230,160,0.95)');
      fg.addColorStop(0.5, 'rgba(255,120,40,0.6)');
      fg.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(p.x, p.y, fr, 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawHearthLightOverlay(now) {
    // Subtle warm light pool centred on the hearth — gives the hall a sense of
    // pooled firelight, with deeper shadow at the edges.
    if (!this.map.hearth) return;
    const ctx = this.ctx;
    const h = this.map.hearth;
    const t = (now - this.timeOrigin) / 1000;
    const radius = WORLD.width * 0.65 + Math.sin(t * 1.5) * 8;
    const g = ctx.createRadialGradient(h.x, h.y, 40, h.x, h.y, radius);
    g.addColorStop(0,    'rgba(255,150,60,0.07)');
    g.addColorStop(0.45, 'rgba(255,150,60,0.0)');
    g.addColorStop(1,    'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }

  // ---------- weapons ----------

  _drawWeaponPickup(w, now) {
    const ctx = this.ctx;
    const cfg = WEAPONS[w.type];
    const bob = Math.sin((now + w.x * 0.13) / 240) * 3;
    const x = w.x, y = w.y + bob;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 24);
    glow.addColorStop(0, hexA(cfg.color, 0.45));
    glow.addColorStop(1, hexA(cfg.color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - 24, y - 24, 48, 48);
    drawWeaponIcon(ctx, w.type, x, y, 1, -Math.PI / 4);
  }

  // ---------- projectiles ----------

  _drawProjectilesInterp(a, b, t) {
    const ctx = this.ctx;
    const ai = new Map(a.projectiles.map(p => [p.id, p]));
    const bi = new Map(b.projectiles.map(p => [p.id, p]));
    const ids = new Set([...ai.keys(), ...bi.keys()]);
    for (const id of ids) {
      const pa = ai.get(id), pb = bi.get(id);
      let x, y, ang;
      if (pa && pb) {
        x = pa.x + (pb.x - pa.x) * t;
        y = pa.y + (pb.y - pa.y) * t;
        ang = Math.atan2(pb.vy || pa.vy, pb.vx || pa.vx);
      } else {
        const p = pb || pa;
        x = p.x; y = p.y;
        ang = Math.atan2(p.vy, p.vx);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = '#cdbb98';
      ctx.fillRect(-10, -1, 14, 2);
      ctx.fillStyle = '#f5d18a';
      ctx.beginPath();
      ctx.moveTo(4, 0); ctx.lineTo(-2, -3); ctx.lineTo(-2, 3); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8a5a32';
      ctx.fillRect(-12, -2, 3, 4);
      ctx.restore();
    }
  }

  // ---------- the grapple ----------

  _drawGrappleLines(snap) {
    const ctx = this.ctx;
    const grendel = snap.players.find(p => p.role === 'grendel');
    if (!grendel || !grendel.grappledById) return;
    const beowulf = snap.players.find(p => p.id === grendel.grappledById);
    if (!beowulf) return;

    // tense rope visual between Beowulf and Grendel
    const t = performance.now() / 100;
    const ax = beowulf.x, ay = beowulf.y, bx = grendel.x, by = grendel.y;
    const midX = (ax + bx) / 2 + Math.sin(t) * 1.5;
    const midY = (ay + by) / 2 + Math.cos(t) * 1.5;
    // outer glow
    ctx.strokeStyle = 'rgba(255, 196, 100, 0.55)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(midX, midY, bx, by); ctx.stroke();
    // inner sinew
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(midX, midY, bx, by); ctx.stroke();
    // tug particles
    if (Math.random() < 0.6) {
      this.particles.push({
        x: midX, y: midY,
        vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        g: 0, life: 0.3, size: 2, color: 'rgba(255,200,120,0.85)',
      });
    }
  }

  // ---------- players ----------

  _drawPlayers(a, b, t, latest, now) {
    const ai = new Map(a.players.map(p => [p.id, p]));
    const bi = new Map(b.players.map(p => [p.id, p]));
    const all = [...latest.players];
    all.sort((p1, p2) => (p1.role === 'grendel') - (p2.role === 'grendel'));

    for (const p of all) {
      if (!p.alive) continue;
      const pa = ai.get(p.id), pb = bi.get(p.id);
      let x, y, ang;
      const isLocal = p.id === this.net.youId;
      if (isLocal) {
        if (!this.localLerp.hasInit) { this.localLerp.x = p.x; this.localLerp.y = p.y; this.localLerp.hasInit = true; }
        this.localLerp.x += (p.x - this.localLerp.x) * 0.45;
        this.localLerp.y += (p.y - this.localLerp.y) * 0.45;
        x = this.localLerp.x; y = this.localLerp.y;
        ang = p.angle;
      } else if (pa && pb) {
        x = pa.x + (pb.x - pa.x) * t;
        y = pa.y + (pb.y - pa.y) * t;
        ang = pa.angle + shortestAngle(pa.angle, pb.angle) * t;
      } else {
        x = p.x; y = p.y; ang = p.angle;
      }

      const moving = Math.hypot(p.vx || 0, p.vy || 0) > 30;
      const prev = this.lastWalkPhase.get(p.id) ?? 0;
      const phase = prev + (moving ? 0.18 : (-prev * 0.1));
      this.lastWalkPhase.set(p.id, phase);
      const bob = Math.sin(phase) * 1.6;

      if (p.role === ROLE.GRENDEL) {
        this._drawGrendel(x, y + bob, ang, p, now, phase);
      } else {
        this._drawThane(x, y + bob, ang, p, isLocal, now);
      }

      if (p.swing) this._drawSwing(x, y + bob, p.swing);
    }
  }

  _drawThane(x, y, ang, p, isLocal, now) {
    const ctx = this.ctx;
    const r = THANE.radius;

    // The Shaper — Gardner ch. 3. Distinct soft pale-gold halo, wider than
    // the bare-handed grip aura; visible at any distance, weapon or not.
    if (p.shaper) {
      const t = (now - this.timeOrigin) / 320;
      const haloR = r + 22 + Math.sin(t) * 2;
      const halo = ctx.createRadialGradient(x, y, r, x, y, haloR);
      halo.addColorStop(0, 'rgba(255, 230, 168, 0)');
      halo.addColorStop(0.55, 'rgba(255, 230, 168, 0.20)');
      halo.addColorStop(1, 'rgba(255, 230, 168, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - haloR, y - haloR, haloR * 2, haloR * 2);
    }

    // bare-handed thanes get a faint gold aura — they can grip
    if (!p.weapon) {
      const t = (now - this.timeOrigin) / 250;
      const auraR = r + 8 + Math.sin(t) * 1.6;
      const aura = ctx.createRadialGradient(x, y, r - 2, x, y, auraR + 4);
      aura.addColorStop(0, 'rgba(244, 196, 100, 0)');
      aura.addColorStop(0.55, 'rgba(244, 196, 100, 0.22)');
      aura.addColorStop(1, 'rgba(244, 196, 100, 0)');
      ctx.fillStyle = aura;
      ctx.fillRect(x - auraR - 4, y - auraR - 4, (auraR + 4) * 2, (auraR + 4) * 2);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(x, y + r - 2, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    if (p.slowed) {
      ctx.strokeStyle = 'rgba(140,200,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }

    // cloak (back-facing colour)
    ctx.fillStyle = '#2a1c14';
    ctx.beginPath();
    ctx.arc(x, y, r + 2, ang + Math.PI - 1.2, ang + Math.PI + 1.2);
    ctx.lineTo(x, y); ctx.closePath(); ctx.fill();

    // tunic/body
    ctx.fillStyle = isLocal ? '#9a7855' : '#7a5a3a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // belt
    ctx.fillStyle = '#3a2516';
    ctx.fillRect(x - r * 0.9, y + 2, r * 1.8, 2);

    // helm — bare-handed thanes get a subtly brighter helm
    if (!p.weapon) {
      drawSpangenhelm(ctx, x, y - 2, r, ang, '#7e6238', '#4a3622', '#d8a648');
    } else {
      drawSpangenhelm(ctx, x, y - 2, r, ang, '#5e574a', '#3a352c', '#8b8275');
    }

    if (p.weapon) {
      const hx = x + Math.cos(ang) * (r + 1);
      const hy = y + Math.sin(ang) * (r + 1);
      drawWeaponIcon(ctx, p.weapon.type, hx, hy, 0.85, ang - Math.PI / 8);
    } else {
      // a faint fist mark
      const hx = x + Math.cos(ang) * (r + 4);
      const hy = y + Math.sin(ang) * (r + 4);
      ctx.fillStyle = '#d8b066';
      ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Harp glyph for the Shaper, drawn above the head.
    if (p.shaper) {
      ctx.save();
      ctx.translate(x, y - r - 16);
      ctx.strokeStyle = '#ffe6a8';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      // harp frame (triangular)
      ctx.beginPath();
      ctx.moveTo(-5, 4);
      ctx.lineTo(5, 4);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.stroke();
      // strings
      ctx.strokeStyle = 'rgba(255,196,104,0.8)';
      ctx.lineWidth = 0.6;
      for (let i = -3; i <= 3; i += 2) {
        ctx.beginPath();
        ctx.moveTo(i, 4);
        ctx.lineTo(i, 4 - (i + 5));
        ctx.stroke();
      }
      ctx.restore();
    }

    this._drawHpBar(x, y - r - 11, 32, p.hp / p.maxHp, false, !p.weapon || p.shaper);
    const nameColor = p.shaper ? '#ffe6a8' : (p.weapon ? '#d8c9a8' : '#f4c468');
    if (!isLocal) this._drawName(x, y - r - (p.shaper ? 30 : 17), p.name, nameColor);
  }

  _drawGrendel(x, y, ang, p, now, walkPhase) {
    const ctx = this.ctx;
    const r = GRENDEL.radius;

    // rage aura — sickly red
    if (p.raging) {
      const t = (now / 200) % (Math.PI * 2);
      const radius = r + 10 + Math.sin(t) * 3;
      const grad = ctx.createRadialGradient(x, y, r - 4, x, y, radius + 8);
      grad.addColorStop(0, 'rgba(255,50,30,0)');
      grad.addColorStop(0.6, 'rgba(255,50,30,0.4)');
      grad.addColorStop(1,   'rgba(255,50,30,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius - 8, y - radius - 8, (radius + 8) * 2, (radius + 8) * 2);
    }

    if (p.leaping) {
      for (let i = 1; i <= 3; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.18 / i})`;
        ctx.beginPath();
        ctx.arc(x - Math.cos(ang) * i * 6, y - Math.sin(ang) * i * 6, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // huge shadow
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath(); ctx.ellipse(x, y + r - 4, r * 1.1, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();

    // dragging long arms (knuckle-walker silhouette) — behind body
    const armR = r * 0.55;
    const armReach = r + 14;
    // arms swing slightly with walk
    const swingL = Math.sin(walkPhase) * 0.18;
    const swingR = Math.sin(walkPhase + Math.PI) * 0.18;
    const armLAng = ang + Math.PI * 0.5 + swingL;
    const armRAng = ang - Math.PI * 0.5 + swingR;
    const aLx = x + Math.cos(armLAng) * armReach;
    const aLy = y + Math.sin(armLAng) * armReach + r * 0.2;
    const aRx = x + Math.cos(armRAng) * armReach;
    const aRy = y + Math.sin(armRAng) * armReach + r * 0.2;
    ctx.strokeStyle = '#1a0f0a';
    ctx.lineWidth = armR * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(aLx, aLy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(aRx, aRy); ctx.stroke();
    // claw hands
    ctx.fillStyle = '#0e0807';
    ctx.beginPath(); ctx.arc(aLx, aLy, armR * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(aRx, aRy, armR * 0.8, 0, Math.PI * 2); ctx.fill();
    // claw spikes
    for (const [hx, hy] of [[aLx, aLy], [aRx, aRy]]) {
      for (let k = -1; k <= 1; k++) {
        const a2 = Math.atan2(hy - y, hx - x) + k * 0.4;
        ctx.fillStyle = '#3a2a22';
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(a2) * (armR * 0.8), hy + Math.sin(a2) * (armR * 0.8));
        ctx.lineTo(hx + Math.cos(a2) * (armR * 1.5), hy + Math.sin(a2) * (armR * 1.5));
        ctx.lineTo(hx + Math.cos(a2 + 0.18) * (armR * 0.9), hy + Math.sin(a2 + 0.18) * (armR * 0.9));
        ctx.closePath(); ctx.fill();
      }
    }

    // body (mottled green-grey / black)
    const bodyGrad = ctx.createRadialGradient(x, y - 4, 2, x, y, r);
    bodyGrad.addColorStop(0, '#3a2a22');
    bodyGrad.addColorStop(0.4, '#1f1410');
    bodyGrad.addColorStop(1, '#0a0605');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // hunched shoulders
    ctx.fillStyle = '#0e0a08';
    ctx.beginPath(); ctx.arc(x - Math.cos(ang + Math.PI/2) * (r * 0.55), y - Math.sin(ang + Math.PI/2) * (r * 0.55), r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + Math.cos(ang + Math.PI/2) * (r * 0.55), y + Math.sin(ang + Math.PI/2) * (r * 0.55), r * 0.5, 0, Math.PI * 2); ctx.fill();

    // pale yellow eyes (per book — Grendel's eyes are described as pale, dread)
    const eyeOff = 8;
    const ex1 = x + Math.cos(ang) * (r * 0.5) + Math.cos(ang + Math.PI / 2) * eyeOff;
    const ey1 = y + Math.sin(ang) * (r * 0.5) + Math.sin(ang + Math.PI / 2) * eyeOff;
    const ex2 = x + Math.cos(ang) * (r * 0.5) - Math.cos(ang + Math.PI / 2) * eyeOff;
    const ey2 = y + Math.sin(ang) * (r * 0.5) - Math.sin(ang + Math.PI / 2) * eyeOff;
    const eyeColor = p.raging ? '#ff7a3a' : '#f4d860';
    for (const [px, py] of [[ex1, ey1], [ex2, ey2]]) {
      const g = ctx.createRadialGradient(px, py, 0, px, py, 12);
      g.addColorStop(0, eyeColor);
      g.addColorStop(0.5, hexA(eyeColor, 0.55));
      g.addColorStop(1, hexA(eyeColor, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - 12, py - 12, 24, 24);
      ctx.fillStyle = eyeColor;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      // pupil
      ctx.fillStyle = '#0a0605';
      ctx.beginPath(); ctx.arc(px, py, 1.1, 0, Math.PI * 2); ctx.fill();
    }

    // toothy maw — a thin gash with jagged teeth when very close (only visible at scale)
    const mx = x + Math.cos(ang) * (r * 0.78);
    const my = y + Math.sin(ang) * (r * 0.78);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = '#0a0403';
    ctx.fillRect(-7, -2, 14, 4);
    ctx.fillStyle = '#efe2cf';
    for (let i = -6; i < 6; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i, -1); ctx.lineTo(i + 1, 2); ctx.lineTo(i + 2, -1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // grip indicator — show a red strain ring while gripped
    if (p.grappledById) {
      const t2 = (now / 80);
      const rr = r + 12 + Math.sin(t2) * 2;
      ctx.strokeStyle = 'rgba(255, 100, 70, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }

    if (p.killWindup > 0) {
      ctx.strokeStyle = 'rgba(255,58,44,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
    }

    this._drawHpBar(x, y - r - 14, 76, p.hp / p.maxHp, true);
  }

  _drawSwing(x, y, swing) {
    const ctx = this.ctx;
    const w = WEAPONS[swing.weapon];
    if (!w) return;
    const ttl = swing.until - Date.now();
    const total = w.swingMs;
    const k = 1 - Math.max(0, Math.min(1, ttl / total));
    const arcW = w.arc;
    const r1 = w.range;
    const ang0 = swing.angle - arcW + arcW * 2 * k;
    const ang1 = ang0 + 0.35;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r1, ang0, ang1);
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r1);
    grad.addColorStop(0, hexA(w.color, 0.5));
    grad.addColorStop(1, hexA(w.color, 0));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  _drawHpBar(x, y, w, frac, big = false, gold = false) {
    const ctx = this.ctx;
    const h = big ? 6 : 4;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - w/2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = big ? '#2a0a07' : '#3a201a';
    ctx.fillRect(x - w/2, y, w, h);
    const grad = ctx.createLinearGradient(x - w/2, y, x + w/2, y);
    if (gold) {
      grad.addColorStop(0, '#f4c468');
      grad.addColorStop(1, '#ffe6a8');
    } else {
      grad.addColorStop(0, '#ff3a2c');
      grad.addColorStop(1, '#ffb04a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x - w/2, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  _drawName(x, y, name, color = '#d8c9a8') {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(name, x, y);
  }

  // ---------- effects / particles ----------

  _ingestEffects(snap) {
    for (const eff of snap.effects || []) {
      if (this.effectsSeen.has(eff.id)) continue;
      this.effectsSeen.add(eff.id);
      switch (eff.kind) {
        case 'gore': {
          this.shake = Math.max(this.shake, 4);
          for (let i = 0; i < 32; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 60 + Math.random() * 180;
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              g: 380, life: 0.6 + Math.random() * 0.5,
              size: 2 + Math.random() * 2, color: '#a01616',
            });
          }
          // persistent splat
          for (let i = 0; i < 8; i++) {
            this.bloodSplats.push({
              x: eff.x + (Math.random() - 0.5) * 22,
              y: eff.y + (Math.random() - 0.5) * 22,
              r: 4 + Math.random() * 6,
              color: 'rgba(70, 6, 4, 0.65)',
            });
          }
          break;
        }
        case 'sparks': {
          for (let i = 0; i < 10; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 60 + Math.random() * 80;
            this.particles.push({
              x: eff.x + (Math.random() - 0.5) * 12,
              y: eff.y + (Math.random() - 0.5) * 12,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              g: 60, life: 0.4, size: 2, color: '#ffd277',
            });
          }
          break;
        }
        case 'pickup': {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
              g: 0, life: 0.5, size: 2, color: '#ffd277',
            });
          }
          break;
        }
        case 'roar': {
          this.shake = Math.max(this.shake, 3);
          this.particles.push({
            kind: 'ring',
            x: eff.x, y: eff.y,
            r: 10, vr: (eff.range - 10) / 0.6,
            life: 0.6, color: 'rgba(255,80,50,0.6)',
          });
          break;
        }
        case 'leap': {
          for (let i = 0; i < 10; i++) {
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
              g: 0, life: 0.35, size: 3, color: 'rgba(80,30,20,0.6)',
            });
          }
          break;
        }
        case 'killWindup': {
          this.particles.push({
            kind: 'ring',
            x: eff.tx, y: eff.ty,
            r: 30, vr: -40,
            life: 0.22, color: 'rgba(255,58,44,0.85)',
          });
          break;
        }
        case 'arrowBounce': {
          for (let i = 0; i < 8; i++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
              g: 80, life: 0.3, size: 2, color: '#ffd277',
            });
          }
          break;
        }
        case 'arrowHit': {
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: Math.cos(a) * 50, vy: Math.sin(a) * 50,
              g: 80, life: 0.3, size: 2, color: '#cba872',
            });
          }
          break;
        }
        case 'weaponBreak': {
          for (let i = 0; i < 10; i++) {
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: (Math.random() - 0.5) * 90,
              vy: (Math.random() - 1) * 90,
              g: 240, life: 0.55, size: 2, color: '#9aa2a8',
            });
          }
          break;
        }
        case 'rage': {
          this.shake = Math.max(this.shake, 5);
          this.particles.push({
            kind: 'ring',
            x: eff.x, y: eff.y,
            r: 4, vr: 120,
            life: 0.6, color: 'rgba(255,70,30,0.7)',
          });
          break;
        }
        case 'grappleBegin': {
          this.shake = Math.max(this.shake, 4);
          this.particles.push({
            kind: 'ring',
            x: eff.x, y: eff.y,
            r: 6, vr: 60,
            life: 0.45, color: 'rgba(255,196,100,0.85)',
          });
          break;
        }
        case 'grappleTick': {
          this.particles.push({
            x: eff.x + (Math.random() - 0.5) * 8,
            y: eff.y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 30,
            vy: -20 - Math.random() * 30,
            g: 60, life: 0.3, size: 2, color: '#a01616',
          });
          break;
        }
        case 'armRip': {
          this.shake = 18;
          this.armRip = {
            startedAt: Date.now(),
            x: eff.x, y: eff.y, angle: eff.angle,
            killerX: eff.killerX, killerY: eff.killerY,
          };
          for (let i = 0; i < 70; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 80 + Math.random() * 240;
            this.particles.push({
              x: eff.x, y: eff.y,
              vx: Math.cos(a) * s, vy: Math.sin(a) * s,
              g: 320, life: 1.0 + Math.random() * 0.8,
              size: 2 + Math.random() * 3, color: i % 3 ? '#7a0a08' : '#220606',
            });
          }
          for (let i = 0; i < 14; i++) {
            this.bloodSplats.push({
              x: eff.x + (Math.random() - 0.5) * 50,
              y: eff.y + (Math.random() - 0.5) * 50,
              r: 6 + Math.random() * 9,
              color: 'rgba(70, 6, 4, 0.75)',
            });
          }
          break;
        }
      }
    }
    if (this.effectsSeen.size > 400) this.effectsSeen = new Set([...this.effectsSeen].slice(-200));
  }

  _updateAndDrawParticles() {
    const ctx = this.ctx;
    const dt = 1 / 60;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.kind === 'ring') {
        p.r += p.vr * dt;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.r), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      ctx.globalAlpha = 1;
    }
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  _drawArmRip(now) {
    const ctx = this.ctx;
    const r = this.armRip;
    const t = (now - performance.timeOrigin - (r.startedAt - performance.timeOrigin)) / 1000;
    // The arm flies from Grendel toward (slightly past) the killer
    const tt = Math.min(1, t / 0.8);
    const ease = 1 - Math.pow(1 - tt, 2);
    const kx = (r.killerX ?? r.x);
    const ky = (r.killerY ?? r.y);
    const ax = r.x + (kx - r.x) * ease * 0.6;
    const ay = r.y + (ky - r.y) * ease * 0.6 - 80 * Math.sin(Math.PI * tt);
    const ang = Math.atan2(ky - r.y, kx - r.x) + Math.PI * tt * 1.8;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    // upper arm
    ctx.strokeStyle = '#1a0f0a';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke();
    // claw
    ctx.fillStyle = '#0e0807';
    ctx.beginPath(); ctx.arc(22, 0, 10, 0, Math.PI * 2); ctx.fill();
    // spurt of black blood
    ctx.fillStyle = 'rgba(70,6,4,0.85)';
    ctx.beginPath(); ctx.arc(-22, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // freeze-frame title shimmer near the wound
    if (t < 1.6) {
      ctx.globalAlpha = Math.max(0, 1 - t / 1.6);
      ctx.fillStyle = '#f4c468';
      ctx.font = 'bold 24px "Cinzel", serif';
      ctx.textAlign = 'center';
      ctx.fillText('the arm is torn from its socket', r.x, r.y - 60);
      ctx.globalAlpha = 1;
    }
    if (t > 1.6) this.armRip = null;
  }

  _drawDarkness() {
    const ctx = this.ctx;
    const alpha = this.darknessFade;
    ctx.fillStyle = `rgba(0,0,0,${0.78 * alpha})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }
}

// ---------- helpers ----------

function shortestAngle(a, b) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex.replace(/[\d.]+\)$/, a + ')');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Anglo-Saxon spangenhelm — dome with a vertical noseguard. Drawn relative to
// (cx, cy) and rotated such that the noseguard points along `ang`. The body
// (face) is the circle behind; this just draws the helmet on top.
function drawSpangenhelm(ctx, cx, cy, r, ang, metal, shadow, highlight) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang + Math.PI / 2); // noseguard points "down" relative to facing
  // dome (half circle)
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.85, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // brow band
  ctx.fillStyle = shadow;
  ctx.fillRect(-r * 0.85, -2, r * 1.7, 4);
  // noseguard
  ctx.fillStyle = shadow;
  ctx.fillRect(-1.5, 0, 3, r * 0.55);
  // highlight stripe over dome
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, -r * 0.85);
  ctx.lineTo(r * 0.1, -r * 0.85);
  ctx.lineTo(r * 0.04, -2);
  ctx.lineTo(-r * 0.04, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWeaponIcon(ctx, type, x, y, scale = 1, angle = -Math.PI / 4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  if (type === 'spear') {
    ctx.fillStyle = '#c9a76b';
    ctx.fillRect(-1, -14, 2, 28);
    ctx.fillStyle = '#f5d18a';
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(4, -12); ctx.lineTo(-4, -12); ctx.closePath(); ctx.fill();
  } else if (type === 'axe') {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(-1.5, -14, 3, 28);
    ctx.fillStyle = '#9aa2a8';
    ctx.beginPath();
    ctx.moveTo(2, -14); ctx.lineTo(12, -10); ctx.lineTo(12, -2); ctx.lineTo(2, -6); ctx.closePath();
    ctx.fill();
  } else if (type === 'torch') {
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(-1.5, -8, 3, 22);
    const g = ctx.createRadialGradient(0, -12, 0, 0, -12, 12);
    g.addColorStop(0, 'rgba(255,180,80,0.95)');
    g.addColorStop(0.5, 'rgba(255,120,30,0.55)');
    g.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -12, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd277';
    ctx.beginPath(); ctx.arc(0, -12, 3, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'bow') {
    ctx.strokeStyle = '#7a5a3a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, -Math.PI / 2 - 1.0, -Math.PI / 2 + 1.0);
    ctx.stroke();
    ctx.strokeStyle = '#efe2cf';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const a1 = -Math.PI / 2 - 1.0, a2 = -Math.PI / 2 + 1.0;
    ctx.moveTo(Math.cos(a1) * 12, Math.sin(a1) * 12);
    ctx.lineTo(Math.cos(a2) * 12, Math.sin(a2) * 12);
    ctx.stroke();
  }
  ctx.restore();
}

// Coordinates for a stylised hart-antler path (relative origin at the antler
// base). The right antler is drawn by mirroring along x.
const LEFT_ANTLER_PATHS = [
  // main beam
  [[-6, 0], [-16, -10], [-28, -22], [-42, -34], [-58, -42], [-70, -46]],
  // tine 1
  [[-22, -16], [-32, -28]],
  // tine 2
  [[-38, -28], [-50, -42], [-52, -54]],
  // tine 3
  [[-54, -38], [-66, -52]],
  // tine 4 (forward sweep)
  [[-66, -44], [-76, -52], [-82, -56]],
];
