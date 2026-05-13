import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, DEFAULT_MAP, getMap } from '../src/maps.js';
import { WORLD, THANE, GRENDEL } from '../src/constants.js';
import { circleRectMTV } from '../src/util.js';

test('default map exists', () => {
  assert.ok(MAPS[DEFAULT_MAP], 'default map missing');
  assert.equal(getMap(DEFAULT_MAP), MAPS[DEFAULT_MAP]);
  assert.equal(getMap('nope'), MAPS[DEFAULT_MAP]); // fallback
});

for (const [id, map] of Object.entries(MAPS)) {
  test(`${id}: has required shape`, () => {
    assert.ok(map.id);
    assert.ok(map.name);
    assert.ok(Array.isArray(map.obstacles) && map.obstacles.length > 0);
    assert.ok(Array.isArray(map.thaneSpawns) && map.thaneSpawns.length >= 4);
    assert.ok(Array.isArray(map.grendelSpawns) && map.grendelSpawns.length >= 1);
    assert.ok(Array.isArray(map.weaponSpawns) && map.weaponSpawns.length >= 4);
  });

  test(`${id}: spawn points lie inside the world bounds`, () => {
    const pad = 10;
    for (const [kind, list] of [['thane', map.thaneSpawns], ['grendel', map.grendelSpawns], ['weapon', map.weaponSpawns]]) {
      for (const s of list) {
        assert.ok(s.x >= pad && s.x <= WORLD.width - pad, `${kind} spawn x out of bounds: ${s.x}`);
        assert.ok(s.y >= pad && s.y <= WORLD.height - pad, `${kind} spawn y out of bounds: ${s.y}`);
      }
    }
  });

  test(`${id}: thane spawns clear obstacles`, () => {
    for (const s of map.thaneSpawns) {
      for (const o of map.obstacles) {
        if (o.kind === 'wall') continue; // walls hug the outer edge; spawns are padded
        const mtv = circleRectMTV(s.x, s.y, THANE.radius, o.x, o.y, o.w, o.h);
        assert.equal(mtv, null, `thane spawn (${s.x},${s.y}) intersects obstacle ${o.kind}`);
      }
    }
  });

  test(`${id}: grendel spawns clear obstacles`, () => {
    for (const s of map.grendelSpawns) {
      for (const o of map.obstacles) {
        if (o.kind === 'wall') continue;
        const mtv = circleRectMTV(s.x, s.y, GRENDEL.radius, o.x, o.y, o.w, o.h);
        assert.equal(mtv, null, `grendel spawn (${s.x},${s.y}) intersects obstacle ${o.kind}`);
      }
    }
  });
}
