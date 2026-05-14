# Grendel polish pass

You are working on the Grendel browser game.

## Objective

Run one focused agentic polish pass. Find and fix the single highest-confidence issue or small improvement you can complete safely.

Good candidates:

- stale branch/deploy assumptions
- launchd/server/tunnel reliability problems
- obvious gameplay bugs
- bot/simulation edge cases
- socket lifecycle leaks
- missing tests around recent mechanics
- small UX copy/state issues visible from source

Avoid:

- broad rewrites
- secret/env access
- starting long-lived servers unless necessary
- committing or pushing unless explicitly asked

## Required workflow

1. Read these first:
   - `README.md`
   - `server.js`
   - `deploy/grendel-git-pull.sh`
   - `src/room.js`
   - `src/bots.js`
   - `test/*.test.js`
2. Identify 2-4 candidate issues in one short note.
3. Choose one cohesive fix and explain why it is highest-confidence.
4. Implement the fix.
5. Add or update focused tests when practical.
6. Run:
   ```bash
   npm test
   ```
7. Final response must include:
   - Summary
   - Files changed
   - Tests run
   - Follow-ups not completed

## Guardrails

- Keep deploy scripts `/bin/bash` compatible.
- Preserve Grendel/Beowulf/Gardner canon flavor.
- Keep changes easy to review and PR.
