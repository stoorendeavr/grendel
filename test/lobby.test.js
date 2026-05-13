import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../src/lobby.js';
import { ROLE, DEMO } from '../src/constants.js';

const stubIo = () => ({ to: () => ({ emit: () => {} }) });

describe('Lobby', () => {
  test('createRoom produces a unique room with the caller as host', () => {
    const lobby = new Lobby(stubIo());
    const r1 = lobby.createRoom('socket1');
    const r2 = lobby.createRoom('socket2');
    assert.notEqual(r1.code, r2.code);
    assert.equal(r1.hostId, 'socket1');
    // remember to stop loops + sweep so the test process can exit
    r1.stopLoop(); r2.stopLoop();
    clearInterval(lobby._sweep);
  });

  test('trackSocket / roomOfSocket / leave', () => {
    const lobby = new Lobby(stubIo());
    const room = lobby.createRoom('host');
    room.addPlayer('host', 'Grendel');
    lobby.trackSocket('host', room.code);
    assert.equal(lobby.roomOfSocket('host'), room);
    lobby.leave('host');
    assert.equal(lobby.roomOfSocket('host'), null);
    clearInterval(lobby._sweep);
  });

  test('leaving the last player tears the room down', () => {
    const lobby = new Lobby(stubIo());
    const room = lobby.createRoom('host');
    room.addPlayer('host', 'Grendel');
    lobby.trackSocket('host', room.code);
    lobby.leave('host');
    assert.equal(lobby.getRoom(room.code), undefined);
    clearInterval(lobby._sweep);
  });

  test('stats counts rooms and players', () => {
    const lobby = new Lobby(stubIo());
    const r = lobby.createRoom('host');
    r.addPlayer('host', 'Grendel');
    r.addPlayer('A', 'Eofor');
    const s = lobby.stats();
    assert.equal(s.rooms, 1);
    assert.equal(s.players, 2);
    r.stopLoop();
    clearInterval(lobby._sweep);
  });

  test('fillBots adds the configured number of bot thanes', () => {
    const lobby = new Lobby(stubIo());
    const room = lobby.createRoom('host', { withBots: true });
    room.addPlayer('host', 'Grendel');
    lobby.fillBots(room, ROLE.GRENDEL);
    const bots = [...room.players.values()].filter(p => p.bot);
    assert.equal(bots.length, DEMO.thaneBots);
    for (const b of bots) {
      assert.equal(b.role, ROLE.THANE);
      assert.ok(DEMO.botMaxNames.includes(b.name));
    }
    room.stopLoop();
    clearInterval(lobby._sweep);
  });
});
