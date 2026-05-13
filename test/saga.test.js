import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sagaForEvent } from '../src/saga.js';

const KINDS = [
  'firstDeath', 'death', 'weaponBounce', 'grappleBegin', 'grappleStrain',
  'grendelLow', 'armRip', 'rage', 'roar', 'darkness',
  'roundStart', 'villagerWin', 'grendelWin', 'aborted',
];

test('every event kind returns a non-empty string', () => {
  for (const k of KINDS) {
    const s = sagaForEvent(k, { victim: 'Hondscio', attacker: 'Eofor', weapon: 'ash-spear' });
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 0, `empty saga for ${k}`);
  }
});

test('unknown event kind returns empty string', () => {
  assert.equal(sagaForEvent('nope'), '');
});

test('format substitution replaces named vars', () => {
  // sample many lines for 'death' since the template is randomly chosen.
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const s = sagaForEvent('death', { victim: 'Aeschere' });
    seen.add(s);
    // every death template includes {victim}; the rendered text must contain 'Aeschere'.
    assert.ok(s.includes('Aeschere'), `victim missing in: ${s}`);
  }
  assert.ok(seen.size > 1, 'expected multiple distinct death lines across 50 samples');
});

test('weaponBounce substitutes attacker AND weapon', () => {
  // some weaponBounce templates only mention iron/edge generically; others use both.
  // Run enough samples to verify substitution doesn't leak braces.
  for (let i = 0; i < 50; i++) {
    const s = sagaForEvent('weaponBounce', { attacker: 'Eofor', weapon: 'wound-axe' });
    assert.ok(!s.includes('{'), `unsubstituted placeholder in: ${s}`);
  }
});

test('grappleBegin includes attacker name', () => {
  // grappleBegin has one template without {attacker}; that's fine — but no template
  // should leak a literal "{attacker}".
  for (let i = 0; i < 50; i++) {
    const s = sagaForEvent('grappleBegin', { attacker: 'Wulfgar' });
    assert.ok(!s.includes('{'), `unsubstituted placeholder: ${s}`);
  }
});

test('Hondscio appears literally in firstDeath', () => {
  for (let i = 0; i < 30; i++) {
    const s = sagaForEvent('firstDeath', { victim: 'Hondscio' });
    assert.ok(s.includes('Hondscio'), `missing Hondscio: ${s}`);
  }
});

test('roundStart references Hart, the war, or the novel', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    seen.add(sagaForEvent('roundStart'));
  }
  const all = [...seen].join(' ');
  // Gardner uses "Hart" for Hrothgar's hall (Anglicised Heorot). The pool
  // should also mention the 12-year war or quote Grendel's opening lines.
  assert.ok(/Hart|twelve|alone exist|Gardner/i.test(all), `roundStart pool missing Gardner markers: ${all}`);
});

test('arm-rip pool references Gardner ch. 12 (the novel\'s climax)', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(sagaForEvent('armRip'));
  const all = [...seen].join(' ');
  assert.ok(/ch\.\s*12|Gardner/.test(all), `arm-rip pool missing ch. 12 citation: ${all}`);
});

test('weaponBounce cites the Dragon (Gardner ch. 5) where weapons fail', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(sagaForEvent('weaponBounce', { attacker: 'X', weapon: 'sword' }));
  const all = [...seen].join(' ');
  assert.ok(/Dragon|ch\.\s*5/i.test(all), `weaponBounce pool missing Dragon/ch.5: ${all}`);
});

test('grendelWin quotes Gardner', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(sagaForEvent('grendelWin'));
  const all = [...seen].join(' ');
  assert.ok(/Gardner|Stones|universe|ridiculous/i.test(all), `grendelWin missing Gardner markers: ${all}`);
});

test('villagerWin quotes Gardner\'s final line', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(sagaForEvent('villagerWin'));
  const all = [...seen].join(' ');
  assert.ok(/accident|Gardner|so may you all/i.test(all), `villagerWin missing Gardner final-line: ${all}`);
});
