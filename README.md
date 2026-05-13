# GRENDEL — a saga of Hrothgar's hall

> A browser-based multiplayer arcade telling of Beowulf's first fight.
> One player is **Grendel**, the kin of Cain, stalking the mead-hall of
> Heorot. Everyone else is a **thane of Hrothgar**: their weapons cannot
> bite Grendel (his hide is spell-bound, as the poem says), but their
> blows stagger him. Any thane who drops their weapon can lay hands on
> the beast — the famous handgrip is the only way to wound him.

```
host        → Grendel (1000 HP, slower, snatches thanes 1-shot via KILL)
all thanes  → 120 HP. Armed: stagger Grendel with weapons (no damage).
              Bare-handed: close in and GRIP to drain Grendel's HP.
```

No singled-out Beowulf — any thane can be the one who tears off the arm.

## The poem, faithfully

The mechanics map to Beowulf canon:

- **"No edge of iron would bite on him"** *(lines ~801-805)*. Spears, axes,
  bows, and torches all do 0 damage to Grendel. They stagger him briefly —
  enough for Beowulf to land and hold the grapple.
- **The handgrip.** Beowulf cannot wield iron either. His attack is a sustained
  bare-handed grip when within ~55px of the beast. While gripped, Grendel's
  movement is throttled and he cannot snatch — he cannot break free.
- **Hondscio.** The first thane Grendel kills is named Hondscio in the saga.
- **The arm-tear.** When Grendel's HP reaches 0, his arm is wrenched from its
  socket and the beast flees the hall. The villagers win.
- **Until dawn.** The round ends after 8 minutes. If Grendel has slain enough
  thanes by then, the hall is empty and he reigns.

## Quick start

```sh
cd grendel
npm install
npm start
# open http://localhost:3000 in two browser tabs
#   tab 1 → "Stalk from the moor"  (becomes Grendel)
#   tab 2 → "Take a bench" with the room code (becomes a thane)
```

You need at least one thane before Grendel can begin the night.

### Demo mode (single tab, vs bots)

Click **"Try alone — versus three bot thanes"** on the home screen. The server
spins up a room, populates it with three AI thanes (some armed, some
bare-handed), and auto-starts the match. You play as Grendel.

URL trick to skip the home screen with a friend's code prefilled:
`http://localhost:3000/?code=ABCDE`.

### Dev mode (auto-reload)

```sh
npm run dev      # node --watch
```

### Tests

```sh
npm test         # full suite — unit + socket integration
npm run test:unit  # everything except the integration tests (no server needed)
```

The suite covers util math, the saga generator, map data, room lifecycle and
combat rules, lobby/room GC, bot AI sanity, and a live Socket.IO integration
test that boots the actual server and drives it through create/join/start.

### Docker

```sh
docker build -t grendel .
docker run --rm -p 3000:3000 grendel
```

## Controls

| Action            | Grendel             | Thane (armed)        | Thane (bare-handed)  |
| ----------------- | ------------------- | -------------------- | -------------------- |
| Move              | `WASD` / arrows     | `WASD` / arrows      | `WASD` / arrows      |
| Aim               | mouse               | mouse                | mouse                |
| Action            | left-click / `SPACE` to **snatch** | swing **weapon**     | hold to **grip**     |
| Pick up weapon    | —                   | walk over it         | walk over it (locks out grip) |
| Roar              | `Q`                 | —                    | —                    |
| Leap              | `E`                 | —                    | —                    |
| Darkness          | `R`                 | —                    | —                    |
| Rage              | auto at ≤30% HP     | —                    | —                    |

## Rules

- **Round timer:** 8 minutes (until dawn).
- **Grendel wins** at 20 kills, or with ≥10 kills at dawn.
- **Villagers win** when Beowulf's grapple reduces Grendel to 0 HP. The arm tears free.
- **Respawn:** 5 seconds, far from the beast. Thanes always respawn bare-handed.

## Tech

- **Server:** Node 20+, Express, Socket.IO. Authoritative game loop at 30 Hz.
- **Client:** vanilla JS + HTML5 Canvas. Snapshot interpolation for remote
  entities; local player snapped+lerped for responsiveness.
- **Rooms:** ephemeral, short uppercase codes (no DB).
- **Shared:** `src/constants.js` and `src/maps.js` are served as-is to the
  client at `/shared/*` so both sides stay in sync.

### Project layout

```
grendel/
  server.js          # Express + Socket.IO entry, room signalling, /healthz
  src/
    constants.js     # all tunables (HP, speed, cooldowns, ROLE enum)
    maps.js          # Hrothgar's hall of Heorot: hearth, antlers, shields
    room.js          # game state, tick, physics, grapple, Hondscio, arm-rip
    lobby.js         # room registry, GC, bot filling
    bots.js          # server-side AI for demo mode (Grendel + thane)
    saga.js          # alliterative scop kennings
    util.js          # collision math, ids
  public/
    index.html       # screens: home / lobby / game
    style.css        # one stylesheet for everything
    js/
      main.js        # screen routing, input → server, render loop
      net.js         # Socket.IO wrapper, snapshot buffer
      input.js       # keyboard/mouse → input intent
      render.js      # canvas drawing, interpolation, particles
      hud.js         # HUD DOM updates
      atmosphere.js  # decorative ember canvas behind home/lobby
  test/
    util.test.js     # math helpers
    saga.test.js     # event templates render correctly
    maps.test.js     # spawns inside bounds, clear of obstacles
    room.test.js     # combat rules, grapple, win conditions
    lobby.test.js    # room registry, fillBots
    bots.test.js     # bot AI smoke
    integration.test.js  # live server over Socket.IO
  Dockerfile
  package.json
```

### Networking model

```
client                                server
  │  create / join (lobby) ──────────►  │
  │  ◄───── 'lobby' (player list,        │
  │          beowulfId once chosen)      │
  │  start ─────────────────────────►   │
  │  ◄───── 'lobby' (phase: playing)     │
  │  input {seq, keys, aim} ─30 Hz─►    │
  │  ◄───── 'state' snapshot ─30 Hz     │
```

Snapshots include round meta, every player's pose/HP/cooldowns/role/grapple
state, weapon pickups on the floor, in-flight arrows, ephemeral effects (gore,
sparks, ripples, the arm-rip cinematic), and the saga feed.

## Deployment

Any container host works (Fly.io, Render, Railway, Cloud Run, Heroku, a VPS).
One process = one shard; players in different rooms don't interact, but a
single Node instance can comfortably host a few dozen concurrent rooms.

**Environment variables:**

- `PORT` — HTTP port (default `3000`).
- `ALLOWED_ORIGINS` — comma-separated origin allowlist for Socket.IO CORS.
  Omit to enforce same-origin (recommended when the client is served by this
  same server, which it is by default).

**Behind a reverse proxy:** enable WebSocket upgrades. Example nginx:

```
location / {
  proxy_pass http://grendel:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

**Scaling:** if you outgrow one process, run multiple replicas with
sticky-by-room-code routing. Each room lives entirely on one server.

## Tuning

All knobs are in `src/constants.js`. Want a longer hunt? Bump `GRENDEL.hp`.
Want the grip to drain Grendel faster? Increase `THANE.grappleDpsToGrendel`.
Want weapons to actually wound (un-canonical)? Set `WEAPONS.*.damage` above 0.
Want more bots in the demo? Bump `DEMO.thaneBots`.

## License

MIT.
