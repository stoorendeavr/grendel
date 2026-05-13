// Keyboard + mouse → input intent. Polled at fixed rate by main.js.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.spaceLatch = false;
    this.abilityQueued = null;
    this._abilityClearAt = 0;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      // queue abilities as one-shots
      if (k === 'q') this._queueAbility('roar');
      if (k === 'e') this._queueAbility('leap');
      if (k === 'r') this._queueAbility('darkness');
      // prevent space scrolling
      if (k === ' ') e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width  / r.width);
      this.mouseY = (e.clientY - r.top ) * (canvas.height / r.height);
    });

    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener('mouseup',   (e) => { if (e.button === 0) this.mouseDown = false; });

    // pointer-locked feel without lock — touch fallback
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // blur clears keys (avoids stuck-key on alt-tab)
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
  }

  _queueAbility(name) {
    this.abilityQueued = name;
    this._abilityClearAt = performance.now() + 80;
  }

  // worldX/worldY: cursor in world coords (caller maps from screen).
  buildIntent(worldX, worldY, role) {
    const now = performance.now();
    const ability = this.abilityQueued;
    if (now > this._abilityClearAt) this.abilityQueued = null;

    const space = this.keys.has(' ') || this.keys.has('spacebar');

    return {
      seq: (this._seq = (this._seq || 0) + 1),
      up:    this.keys.has('w') || this.keys.has('arrowup'),
      down:  this.keys.has('s') || this.keys.has('arrowdown'),
      left:  this.keys.has('a') || this.keys.has('arrowleft'),
      right: this.keys.has('d') || this.keys.has('arrowright'),
      attack: (role === 'thane' || role === 'beowulf') ? (this.mouseDown || space) : false,
      kill:   role === 'grendel'                       ? (this.mouseDown || space) : false,
      ability: role === 'grendel' ? ability : null,
      aimX: worldX,
      aimY: worldY,
    };
  }
}
