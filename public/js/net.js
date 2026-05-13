// Thin Socket.IO wrapper. Buffers snapshots for interpolation in render.js.

export class Net {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.youId = null;
    this.hostId = null;
    this.code = null;
    this.snapshots = [];       // ring buffer of recent snapshots (sorted by t)
    this.lastSnapshotAt = 0;
    this.lobby = null;
    this._handlers = { lobby: [], state: [], connect: [], disconnect: [] };

    this.socket.on('connect', () => this._fire('connect'));
    this.socket.on('disconnect', () => this._fire('disconnect'));
    this.socket.on('lobby', (lobby) => { this.lobby = lobby; this._fire('lobby', lobby); });
    this.socket.on('state', (snap) => {
      this.snapshots.push(snap);
      // keep ~1.5s of history
      const cutoff = snap.t - 1500;
      while (this.snapshots.length > 2 && this.snapshots[0].t < cutoff) this.snapshots.shift();
      this.lastSnapshotAt = performance.now();
      this._fire('state', snap);
    });
  }

  on(event, fn) { (this._handlers[event] = this._handlers[event] || []).push(fn); }
  _fire(event, ...args) { for (const fn of (this._handlers[event] || [])) fn(...args); }

  create(name) {
    return new Promise(resolve => this.socket.emit('create', { name }, resp => {
      if (resp?.code) { this.code = resp.code; this.youId = resp.you; this.hostId = resp.hostId; }
      resolve(resp);
    }));
  }

  demo(name) {
    return new Promise(resolve => this.socket.emit('demo', { name }, resp => {
      if (resp?.code) { this.code = resp.code; this.youId = resp.you; this.hostId = resp.hostId; }
      resolve(resp);
    }));
  }

  join(code, name) {
    return new Promise(resolve => this.socket.emit('join', { code, name }, resp => {
      if (resp?.code) { this.code = resp.code; this.youId = resp.you; this.hostId = resp.hostId; }
      resolve(resp);
    }));
  }

  start() {
    return new Promise(resolve => this.socket.emit('start', {}, resolve));
  }

  restart() {
    return new Promise(resolve => this.socket.emit('restart', {}, resolve));
  }

  sendInput(input) {
    this.socket.emit('input', input);
  }
}
