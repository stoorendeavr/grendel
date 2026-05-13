// Lobby: registry of rooms keyed by short code. Cleans up empty rooms.

import { Room } from './room.js';
import { tickBots } from './bots.js';
import { makeRoomCode, nextId } from './util.js';
import { ROLE, DEMO } from './constants.js';

export class Lobby {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();       // code -> Room
    this.socketRoom = new Map();  // socketId -> code
    this._sweep = setInterval(() => this._gc(), 30_000);
  }

  createRoom(hostSocketId, opts = {}) {
    let code;
    do { code = makeRoomCode(); } while (this.rooms.has(code));
    const room = new Room(code, hostSocketId, this.io);
    if (opts.withBots) room.botTick = (r) => tickBots(r);
    this.rooms.set(code, room);
    room.startLoop();
    return room;
  }

  // Populate a freshly-created room with bot thanes (used by demo mode).
  // The caller supplies the human's role; the bots fill the opposite side
  // with explicit strategies + an opening grace window before they engage.
  fillBots(room, humanRole) {
    const wantThanes = DEMO.thaneBots;
    const pool = [...DEMO.botMaxNames];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const strategies = DEMO.strategies;
    for (let i = 0; i < wantThanes; i++) {
      const id = nextId('bot');
      const name = pool[i % pool.length];
      const { player } = room.addPlayer(id, name, { bot: true, role: ROLE.THANE });
      if (player) player._ai = {
        strategy: strategies[i % strategies.length],
        sinceDecisionMs: 0, wanderX: 0, wanderY: 0, wanderNextAt: 0,
      };
    }
    // Open the hall with a grace period — bots drift like sleeping thanes
    // before they notice the beast. Tuned so a solo-demo Grendel can orient.
    room.graceMs = DEMO.graceMs;
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  trackSocket(socketId, code) {
    this.socketRoom.set(socketId, code);
  }

  roomOfSocket(socketId) {
    const code = this.socketRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  leave(socketId) {
    const room = this.roomOfSocket(socketId);
    if (!room) return;
    const wasHost = socketId === room.hostId;
    room.removePlayer(socketId);
    this.socketRoom.delete(socketId);
    // If the host left, tear down the whole room — including any bots that
    // were spawned (otherwise demo rooms leave bot players behind forever).
    if (wasHost || room.players.size === 0) {
      // Also clear socketRoom entries for any other humans that were in the room.
      const stale = [];
      for (const [sid, code] of this.socketRoom) {
        if (code === room.code) stale.push(sid);
      }
      for (const sid of stale) this.socketRoom.delete(sid);
      room.stopLoop();
      this.rooms.delete(room.code);
    }
  }

  _gc() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.players.size === 0 && (now - room.createdAt) > 60_000) {
        room.stopLoop();
        this.rooms.delete(code);
      }
    }
  }

  stats() {
    let totalPlayers = 0;
    for (const r of this.rooms.values()) totalPlayers += r.players.size;
    return { rooms: this.rooms.size, players: totalPlayers };
  }
}
