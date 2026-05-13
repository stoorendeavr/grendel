// Decorative ember canvas behind home + lobby screens. Cheap (<1% CPU).
// Embers drift upward, a few glowing motes flicker, and a slow scanline
// suggests an old cathode glow.

export class Atmosphere {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.embers = [];
    this.motes = [];
    this.running = false;
    this._raf = 0;
    this._lastT = 0;
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
    // seed
    for (let i = 0; i < 80; i++) this.embers.push(this._spawnEmber(true));
    for (let i = 0; i < 14; i++) this.motes.push(this._spawnMote(true));
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width  = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width  = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  _spawnEmber(rand = false) {
    return {
      x: Math.random() * this.w,
      y: rand ? Math.random() * this.h : this.h + 8,
      vy: 12 + Math.random() * 28,
      vx: (Math.random() - 0.5) * 10,
      life: 4 + Math.random() * 5,
      age: rand ? Math.random() * 4 : 0,
      size: 1 + Math.random() * 2,
      hue: 18 + Math.random() * 14,
      flicker: Math.random() * Math.PI * 2,
    };
  }

  _spawnMote(rand = false) {
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      r: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.0,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastT = performance.now();
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this._lastT) / 1000);
    this._lastT = t;
    const ctx = this.ctx;
    const dpr = this.dpr;

    // background fade
    ctx.fillStyle = '#0a0707';
    ctx.fillRect(0, 0, this.w * dpr, this.h * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    // soft red glow at bottom (a hearth out of sight)
    const grad = ctx.createRadialGradient(this.w / 2, this.h + 200, 50, this.w / 2, this.h + 200, 800);
    grad.addColorStop(0, 'rgba(255,90,30,0.20)');
    grad.addColorStop(0.5, 'rgba(120,30,10,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    // motes (slow ambient specks)
    for (const m of this.motes) {
      m.phase += dt * m.speed;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < -5 || m.x > this.w + 5 || m.y < -5 || m.y > this.h + 5) {
        Object.assign(m, this._spawnMote(true));
      }
      const a = 0.15 + 0.15 * Math.sin(m.phase);
      ctx.fillStyle = `rgba(255,200,140,${a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // embers
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      e.age += dt;
      e.x += e.vx * dt;
      e.y -= e.vy * dt;
      e.flicker += dt * 8;
      if (e.age >= e.life || e.y < -20) {
        this.embers[i] = this._spawnEmber(false);
        continue;
      }
      const k = 1 - e.age / e.life;
      const flick = 0.7 + 0.3 * Math.sin(e.flicker);
      const r = e.size * (0.7 + 0.6 * flick);
      const a = k * flick * 0.85;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 6);
      g.addColorStop(0,   `hsla(${e.hue}, 90%, 60%, ${a})`);
      g.addColorStop(0.4, `hsla(${e.hue}, 90%, 45%, ${a * 0.55})`);
      g.addColorStop(1,   `hsla(${e.hue}, 90%, 30%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(e.x - r * 6, e.y - r * 6, r * 12, r * 12);
      ctx.fillStyle = `hsla(${e.hue}, 100%, 80%, ${a})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // scanline shadow
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);

    // top vignette
    const top = ctx.createLinearGradient(0, 0, 0, this.h);
    top.addColorStop(0, 'rgba(0,0,0,0.5)');
    top.addColorStop(0.4, 'rgba(0,0,0,0)');
    top.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.restore();
    this._raf = requestAnimationFrame((nt) => this._frame(nt));
  }
}
