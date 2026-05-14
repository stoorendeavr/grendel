# Grendel Claude Code guidance

Grendel is a real-time browser game prototype inspired by Beowulf and John Gardner's *Grendel*.

When asked to work on this repo:

- Preserve the existing gameplay premise: one Grendel, thanes, bare-handed grapple, Shaper/canon flavor, demo bots, launchd/tunnel deployment.
- Prefer small cohesive fixes over broad rewrites.
- Add or update tests for simulation/server behavior whenever practical.
- Run `npm test` before reporting completion.
- Do not read `.env` files or introduce secrets.
- Do not remove deploy/launchd files unless explicitly asked.

## Useful commands

```bash
npm test
npm run test:unit
node server.js
curl -I http://127.0.0.1:3000
```

## Deployment notes

- `deploy/grendel-git-pull.sh` follows `origin/main` in `/Users/shauryasagents/Code/grendel`.
- Launchd server job runs `node --watch server.js` from this repo root.
- Keep deploy scripts compatible with macOS launchd and `/bin/bash`.

## Review checklist

Before making a gameplay/server change, inspect:

- `README.md`
- `server.js`
- `src/room.js`
- `src/bots.js`
- `src/saga.js`
- relevant tests under `test/`

Before finishing, report:

- files changed
- tests run and result
- follow-up ideas, clearly separated from completed work
