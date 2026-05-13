import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, lerp, dist, dist2, angleBetween, angleDiff,
  circleRectMTV, segmentRectHit, nextId, makeRoomCode,
} from '../src/util.js';

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

test('lerp interpolates linearly', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(-10, 10, 0.5), 0);
});

test('dist / dist2 are euclidean', () => {
  assert.equal(dist(0, 0, 3, 4), 5);
  assert.equal(dist2(0, 0, 3, 4), 25);
  assert.equal(dist(1, 1, 1, 1), 0);
});

test('angleBetween points', () => {
  assert.equal(angleBetween(0, 0, 1, 0), 0);
  assert.ok(Math.abs(angleBetween(0, 0, 0, 1) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(angleBetween(0, 0, -1, 0) - Math.PI) < 1e-9);
});

test('angleDiff returns signed shortest path in [-PI, PI]', () => {
  assert.ok(Math.abs(angleDiff(0.1, -0.1) - 0.2) < 1e-9);
  // 3PI/4 to -3PI/4 should be -PI/2 (going the short way through PI)
  const d = angleDiff(3 * Math.PI / 4, -3 * Math.PI / 4);
  assert.ok(Math.abs(d - (-Math.PI / 2)) < 1e-9, `got ${d}`);
});

test('circleRectMTV: no overlap returns null', () => {
  assert.equal(circleRectMTV(0, 0, 5, 100, 100, 50, 50), null);
  assert.equal(circleRectMTV(60, 0, 5, 0, 0, 50, 50), null); // just to the right, no contact
});

test('circleRectMTV: overlap from the right pushes right', () => {
  // circle centred at (55, 25) radius 10, rect (0,0,50,50). Closest point on rect to circle is (50,25).
  // distance 5, so overlap 5 -> push +5 along +x.
  const mtv = circleRectMTV(55, 25, 10, 0, 0, 50, 50);
  assert.ok(mtv && Math.abs(mtv.x - 5) < 1e-9 && Math.abs(mtv.y) < 1e-9);
});

test('circleRectMTV: centre inside rect pushes out the nearest edge', () => {
  // Centre at (5, 25): nearest edge is left (5 away). Push -10 (=  -(5 + radius)) along -x.
  const mtv = circleRectMTV(5, 25, 5, 0, 0, 50, 50);
  assert.ok(mtv);
  assert.ok(mtv.x < 0 && Math.abs(mtv.y) < 1e-9);
  assert.ok(Math.abs(mtv.x) >= 5); // pushed out beyond the edge
});

test('segmentRectHit: segment passing through a rect returns t in [0,1]', () => {
  // horizontal segment from (-10, 25) to (60, 25) crosses rect (0,0,50,50)
  const t = segmentRectHit(-10, 25, 60, 25, 0, 0, 50, 50);
  assert.ok(t !== null);
  assert.ok(t >= 0 && t <= 1);
  // Should enter at x=0 → t = 10/70
  assert.ok(Math.abs(t - 10 / 70) < 1e-9);
});

test('segmentRectHit: segment missing a rect returns null', () => {
  // segment above the rect
  const t = segmentRectHit(0, 100, 50, 100, 0, 0, 50, 50);
  assert.equal(t, null);
});

test('segmentRectHit: segment starting inside a rect returns 0', () => {
  const t = segmentRectHit(25, 25, 100, 25, 0, 0, 50, 50);
  assert.equal(t, 0);
});

test('nextId produces unique ids in a sequence', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(nextId('x'));
  assert.equal(ids.size, 200);
});

test('makeRoomCode is uppercase alphanumeric, length 5, no lookalikes', () => {
  for (let i = 0; i < 200; i++) {
    const c = makeRoomCode();
    assert.equal(c.length, 5);
    assert.match(c, /^[A-Z2-9]+$/);
    assert.ok(!c.includes('I') && !c.includes('O') && !c.includes('1') && !c.includes('0'));
  }
});
