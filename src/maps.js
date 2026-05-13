// Heorot — Hrothgar's mead-hall, gilded with hart-antlers above the door.
// Single-screen interior: long benches along the walls, a central hearth-fire,
// hanging shields, the high seat at the north end.

import { WORLD } from './constants.js';

const W = WORLD.width;
const H = WORLD.height;

export const MAPS = {
  heorot: {
    id: 'heorot',
    name: "Hart — Hrothgar's hall (Gardner, ch. 1)",
    bg: '#0d0805',
    floor: '#241510',
    floorAlt: '#1a0e08',
    wallColor: '#3a2516',
    accent: '#c98a3a',
    hearth: { x: W / 2, y: H / 2, radius: 32 },
    antlers: { x: W / 2, y: 60 },       // above the great door (north)
    obstacles: [
      // outer walls
      { x: 0,        y: 0,        w: W,  h: 26, kind: 'wall' },
      { x: 0,        y: H - 26,   w: W,  h: 26, kind: 'wall' },
      { x: 0,        y: 0,        w: 26, h: H,  kind: 'wall' },
      { x: W - 26,   y: 0,        w: 26, h: H,  kind: 'wall' },
      // long benches (against the side walls)
      { x: 60,       y: 200,      w: 36, h: 200, kind: 'bench' },
      { x: 60,       y: H - 400,  w: 36, h: 200, kind: 'bench' },
      { x: W - 96,   y: 200,      w: 36, h: 200, kind: 'bench' },
      { x: W - 96,   y: H - 400,  w: 36, h: 200, kind: 'bench' },
      // mead-tables (north/south, leaving a path past the hearth)
      { x: 280,      y: 170,      w: 200, h: 32, kind: 'table' },
      { x: W - 480,  y: 170,      w: 200, h: 32, kind: 'table' },
      { x: 280,      y: H - 202,  w: 200, h: 32, kind: 'table' },
      { x: W - 480,  y: H - 202,  w: 200, h: 32, kind: 'table' },
      // hart-pillars flanking the high seat (north)
      { x: 540,      y: 96,       w: 28, h: 28, kind: 'pillar' },
      { x: 712,      y: 96,       w: 28, h: 28, kind: 'pillar' },
      // hart-pillars flanking the south door
      { x: 540,      y: H - 124,  w: 28, h: 28, kind: 'pillar' },
      { x: 712,      y: H - 124,  w: 28, h: 28, kind: 'pillar' },
      // hearth ring (small obstacles around the central fire)
      { x: W / 2 - 44, y: H / 2 - 44, w: 18, h: 18, kind: 'hearthstone' },
      { x: W / 2 + 26, y: H / 2 - 44, w: 18, h: 18, kind: 'hearthstone' },
      { x: W / 2 - 44, y: H / 2 + 26, w: 18, h: 18, kind: 'hearthstone' },
      { x: W / 2 + 26, y: H / 2 + 26, w: 18, h: 18, kind: 'hearthstone' },
    ],
    // shields hanging on the side walls (cosmetic, drawn by the client)
    shields: [
      { x: 24, y: 280, side: 'west' }, { x: 24, y: 460, side: 'west' }, { x: 24, y: 640, side: 'west' },
      { x: W - 24, y: 280, side: 'east' }, { x: W - 24, y: 460, side: 'east' }, { x: W - 24, y: 640, side: 'east' },
    ],
    thaneSpawns: [
      { x: 140, y: 120 }, { x: W - 140, y: 120 },
      { x: 140, y: H - 120 }, { x: W - 140, y: H - 120 },
      { x: W / 2, y: 140 }, { x: W / 2, y: H - 140 },
      { x: 140, y: H / 2 }, { x: W - 140, y: H / 2 },
    ],
    grendelSpawns: [
      { x: W / 2, y: H / 2 - 120 },
      { x: W / 2, y: H / 2 + 120 },
    ],
    weaponSpawns: [
      { x: 240, y: 120 }, { x: W - 240, y: 120 },
      { x: 240, y: H - 120 }, { x: W - 240, y: H - 120 },
      { x: 160, y: H / 2 }, { x: W - 160, y: H / 2 },
      { x: W / 2 - 120, y: H / 2 + 200 }, { x: W / 2 + 120, y: H / 2 - 200 },
    ],
  },
};

export const DEFAULT_MAP = 'heorot';

export function getMap(id) {
  return MAPS[id] ?? MAPS[DEFAULT_MAP];
}
