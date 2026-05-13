// Small math/utility helpers used across the server.

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t)    { return a + (b - a) * t; }
export function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }
export function dist(ax, ay, bx, by)  { return Math.sqrt(dist2(ax, ay, bx, by)); }
export function angleBetween(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

// Smallest signed angular difference in [-PI, PI].
export function angleDiff(a, b) {
  let d = a - b;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Circle vs axis-aligned rect: returns the minimum translation vector to push
// the circle out of the rect, or null if no overlap.
export function circleRectMTV(cx, cy, r, rx, ry, rw, rh) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 === 0) {
    // Center inside rect — push toward nearest edge.
    const left   = cx - rx;
    const right  = (rx + rw) - cx;
    const top    = cy - ry;
    const bottom = (ry + rh) - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left)   return { x: -(left + r),     y: 0 };
    if (m === right)  return { x:  (right + r),    y: 0 };
    if (m === top)    return { x: 0,               y: -(top + r) };
    return                  { x: 0,                y:  (bottom + r) };
  }
  const d = Math.sqrt(d2);
  const overlap = r - d;
  return { x: (dx / d) * overlap, y: (dy / d) * overlap };
}

// Segment vs axis-aligned rect (Liang–Barsky). Returns t in [0,1] of first hit,
// or null. Used for projectile/raycast.
export function segmentRectHit(x1, y1, x2, y2, rx, ry, rw, rh) {
  const dx = x2 - x1, dy = y2 - y1;
  let tmin = 0, tmax = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rx, (rx + rw) - x1, y1 - ry, (ry + rh) - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > tmax) return null;
        if (t > tmin) tmin = t;
      } else {
        if (t < tmin) return null;
        if (t < tmax) tmax = t;
      }
    }
  }
  return tmin;
}

// Compact unique-ish id generator (no crypto dep needed).
let _nid = 0;
export function nextId(prefix = 'e') {
  _nid = (_nid + 1) | 0;
  return `${prefix}_${Date.now().toString(36)}_${_nid.toString(36)}`;
}

export function makeRoomCode() {
  // Avoid look-alike characters (I/1, O/0).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
