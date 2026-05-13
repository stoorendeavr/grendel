// Tunables for the saga of Hrothgar's hall. Following the poem:
//   "no edge of iron, no battle-blade, would bite on him; on victory-weapons
//    he had laid a spell" — Beowulf, lines ~801-805.
//
// So thane weapons do NO damage to Grendel — only a bare-handed grip can
// drain him. There is no singled-out Beowulf; ANY thane who drops their iron
// and lays hands on the beast becomes the gripper.

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

export const WORLD = {
  width: 1280,
  height: 800,
};

export const ROUND = {
  durationMs: 8 * 60 * 1000, // until dawn
  grendelKillsToWin: 20,     // the hall is emptied of life
  minPlayers: 2,
};

export const ROLE = {
  GRENDEL: 'grendel',
  THANE:   'thane',
};

export const THANE = {
  radius: 14,
  speed: 280,
  hp: 120,
  respawnMs: 5000,
  attackCooldownMs: 600,

  // Bare-handed grapple (anyone without a weapon can attempt it):
  grappleRange: 56,
  grappleDpsToGrendel:   140,  // hp/sec drained from Grendel while gripped
  grappleDpsFromGrendel: 28,   // hp/sec the gripper takes (Grendel's claws)
};

export const GRENDEL = {
  radius: 30,
  speed: 210,
  hp: 1000,
  killRange: 56,
  killWindupMs: 240,
  staggerMs: 180,           // weapon hits pause Grendel for this long
  slowDuringGrapple: 0.35,  // speed multiplier while gripped
};

export const ABILITIES = {
  roar:     { cooldownMs: 12000, range: 240, slowFactor: 0.5, slowMs: 3000 },
  leap:     { cooldownMs:  8000, distance: 260, durationMs: 280 },
  darkness: { cooldownMs: 20000, durationMs: 5000 },
  rage:     { thresholdHp: 0.30, speedBonus: 0.35, durationMs: 8000 },
};

// Weapons do 0 damage to Grendel (book canon). They exist to stagger and
// distract — and to draw Grendel's attention away from any bare-handed thane
// closing for the grip.
export const WEAPONS = {
  spear: { range: 80, arc: 0.35, damage: 0, durability: 3, swingMs: 180, color: '#c9a76b', kenning: 'ash-spear' },
  axe:   { range: 56, arc: 0.85, damage: 0, durability: 4, swingMs: 260, color: '#9aa2a8', kenning: 'wound-axe' },
  torch: { range: 50, arc: 1.10, damage: 0, durability: 3, swingMs: 200, color: '#ff9b3d', kenning: 'fire-brand' },
  bow:   { range: 600, arc: 0.0,  damage: 0, durability: 5, swingMs: 280, color: '#7a5a3a', kenning: 'yew-bow', projectileSpeed: 720 },
};

export const WEAPON_SPAWN = {
  maxOnMap: 6,
  intervalMs: 9000,
  types: ['spear', 'axe', 'torch', 'bow'],
};

export const PROJECTILE = {
  radius: 4,
  maxLifeMs: 1200,
};

export const NET = {
  maxPlayersPerRoom: 12,
  inputBufferMs: 200,
  snapshotKeepMs: 1500,
};

// The Shaper — Gardner's invention (ch. 3). An old harper whose songs
// "shape" Hart's reality. In the novel he gives the Danes their identity and
// torments Grendel by naming him "the kin of Cain." Here he's one thane,
// chosen at match start, whose presence on the floor steadies the others:
// while he is alive and near, bare-handed thanes grip the beast harder.
export const SHAPER = {
  buffRange: 220,            // proximity required for the song to nerve grippers
  gripMultiplier: 1.45,      // grip DPS to Grendel × this when Shaper is in range
};

// Demo / single-player defaults.
// Two bots, one armed (cannot wound Grendel — Dragon's gift, Gardner ch. 5)
// and one bare-handed (can grip). Grace period before bots engage lets the
// human-player Grendel orient.
export const DEMO = {
  thaneBots: 2,
  graceMs: 5500,
  strategies: ['armed', 'barehand'],
  // Names drawn from Beowulf + Gardner. Hrothulf is Hrothgar's nephew in
  // Gardner ch. 8; Unferth the failed hero in ch. 6; Aeschere the counselor;
  // Hondscio the first thane taken.
  botMaxNames: ['Hondscio', 'Aeschere', 'Unferth', 'Hrothulf', 'Wulfgar', 'Hrothmund', 'Hygelac', 'Ecglaf', 'Eofor'],
};
