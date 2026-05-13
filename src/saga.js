// Saga feed in Gardner's voice. References are to John Gardner's novel
// *Grendel* (Knopf, 1971), cited by chapter (the book has 12 chapters, one
// for each zodiac sign, in order Aries through Pisces). Chapter citations
// are durable across editions; page numbers are not.
//
// Famous Gardner moments referenced below:
//   - Ch. 1 (Aries): "The old ram"; "I alone exist"; "Stones; dirt; trees";
//                    "I create the whole universe, blink by blink".
//   - Ch. 5 (Leo):   The Dragon's nihilism + invulnerability enchantment
//                    ("no edge will bite him"). This is Gardner's gloss on the
//                    Beowulf poem's spell-on-weapons (poem ll. 801b–805).
//   - Ch. 6 (Virgo): The twelve-year war on Hart begins.
//   - Ch. 11 (Aqu.): The Stranger arrives. "Cold steel eyes." "Fingers as
//                    hard as horn."
//   - Ch. 12 (Pi.):  The fight. The arm tears. Final whispered curse —
//                    "Poor Grendel's had an accident. So may you all."

const VICTIM_DEATHS = [
  '{victim} is reft of life. So it goes.',
  'The pointless monster takes {victim}. (Gardner, ch. 1)',
  '{victim} screams, then quiet.',
  'The shadow swallows {victim}. (ch. 1)',
  '{victim} falls where he slept. The hall is mostly bones. (cf. ch. 5)',
  'Grendel feasts on {victim}.',
  '{victim} dies like Unferth would — half-heroic, half-pathetic. (cf. Gardner, ch. 6)',
  'Hrothgar will weep over {victim}\'s corpse in the morning. (cf. ch. 1)',
  'The priests mutter prayers. Grendel laughs. {victim} is dead. (cf. ch. 9)',
];

// Hondscio is the Geat the source-text names as Grendel's first kill in the
// hall — Gardner's novel doesn't name him, but he is the first thane in the
// underlying story Gardner inherits.
const HONDSCIO_DEATH = [
  'Hondscio falls first — chewed, swallowed, forgotten. Stones; dirt; trees. (cf. Gardner, ch. 1)',
  "The first one is Hondscio. So it goes. (cf. ch. 6)",
];

// In Gardner ch. 5, the Dragon lays a charm on Grendel: no edge will harm him.
// This is the novel's gloss on the older poem's spell-on-weapons.
const WEAPON_BOUNCE = [
  "The Dragon's gift holds — no edge bites the beast. (Gardner, ch. 5)",
  "{attacker}'s {weapon} sparks off the charmed hide. (ch. 5)",
  'Iron is a joke. The Dragon laughs in his pile of gold. (ch. 5)',
];

const GRAPPLE_BEGIN = [
  'A hand of horn closes upon the beast. (cf. ch. 11)',
  '{attacker} seizes him — cold-eyed, indifferent. (cf. ch. 12)',
  'The Stranger\'s grip. Something is wrong with the world. (ch. 12)',
];

const GRAPPLE_STRAIN = [
  'Hart shakes. Mead-benches break. (Gardner, ch. 12)',
  'The hall is wrecked in the wrestling. (ch. 12)',
  'The world resists. The beast resists. (cf. ch. 1)',
];

const GRENDEL_LOW = [
  "Something is wrong with the world. (Gardner, ch. 12)",
  'He has met his master at last. The dragon-gift fails him.',
  '"Mama!" the beast wants to cry. (cf. ch. 12)',
];

const ARM_RIP = [
  'The arm pops free at the socket. (Gardner, ch. 12)',
  "Poor Grendel's had an accident. (ch. 12, closing line)",
  'The wall is smashed; the arm hangs. Animals gape. (ch. 12)',
];

const ROAR = [
  'He bellows at the indifferent stars. (Gardner, ch. 1)',
  '"Stupidly triumphant," he roars.',
];

const DARKNESS = [
  'The world goes dark. Grendel pulls in the night. (cf. Gardner, ch. 1)',
  'The torches die. The hall holds its breath.',
];

const RAGE = [
  'Spasms of fury overtake him. (cf. Gardner, ch. 2)',
  'Pointless, ridiculous, raging.',
];

const ROUND_START = [
  'The old ram stands looking down over rockslides. Hart sleeps. (Gardner, ch. 1)',
  'Twelve years of war. Tonight: another raid. (cf. ch. 6)',
  '"I alone exist." Hart waits in the dark. (Gardner, ch. 1)',
  "King Hrothgar dreams in his high seat. Grendel hates that seat. (cf. Gardner, ch. 4)",
  "Wealhtheow lies sleeping. Hrothulf broods. The beast is coming. (cf. ch. 7-8)",
];

const VILLAGER_WIN = [
  "Poor Grendel's had an accident. So may you all. (Gardner, ch. 12, final line)",
  'He whispers his curse and dies under the cliffs. (ch. 12)',
  'The arm hangs from the wall. So it goes. (ch. 12)',
];

const GRENDEL_WIN = [
  'Stones; dirt; trees. The hall is empty. (Gardner, ch. 1)',
  'Pointless, ridiculous monster has feasted. (Gardner, ch. 1)',
  '"I create the whole universe, blink by blink." (Gardner, ch. 1)',
  "Hrothgar weeps in his ring-giver's chair. Grendel reigns. (cf. ch. 4)",
];

const ABORTED = [
  'The saga is abandoned. So it goes.',
];

// The Shaper — Gardner's harper, ch. 3-4. His arrival reshapes Hart.
const SHAPER_BEGIN = [
  '{shaper} takes up the harp. The hall is reshaped by his song. (Gardner, ch. 3)',
  'The Shaper sings: "He shapes the world. So it seems to him." ({shaper}, ch. 4)',
  '{shaper} strikes the harp. Even the beast pauses to listen. (cf. ch. 4)',
];

// Old Shaper dies, ch. 10. Grendel mourns him in his own way.
const SHAPER_DOWN = [
  'The Shaper falls. Hart\'s songs are silent. (Gardner, ch. 10)',
  'The harper is dead. The world un-shapes itself. (ch. 10)',
  'Even Grendel grieves the Shaper. (cf. ch. 10)',
];

// The Stranger — Beowulf's arrival and grip. Gardner ch. 11–12.
const STRANGER_COME = [
  'The Stranger has come. Cold steel eyes; fingers as hard as horn. ({attacker}, ch. 11)',
  '{attacker}\'s grip is wrong. The world is wrong. (Gardner, ch. 12)',
  '"Something is happening, something terrible." — Grendel. (cf. ch. 12)',
];

// Grendel's mother — wordless, animal, in the underwater cave (ch. 2)
const MOTHER_CAVE = [
  '"Mama!" the beast cries. The cave below the mere remembers him. (Gardner, ch. 2)',
  'The fiery cave-mother stirs. (ch. 2)',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(tpl, vars) { return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '?'); }

export function sagaForEvent(kind, vars = {}) {
  switch (kind) {
    case 'firstDeath':   return fmt(pick(HONDSCIO_DEATH), vars);
    case 'death':        return fmt(pick(VICTIM_DEATHS), vars);
    case 'weaponBounce': return fmt(pick(WEAPON_BOUNCE), vars);
    case 'grappleBegin': return fmt(pick(GRAPPLE_BEGIN), vars);
    case 'grappleStrain':return pick(GRAPPLE_STRAIN);
    case 'grendelLow':   return pick(GRENDEL_LOW);
    case 'armRip':       return pick(ARM_RIP);
    case 'rage':         return pick(RAGE);
    case 'roar':         return pick(ROAR);
    case 'darkness':     return pick(DARKNESS);
    case 'roundStart':   return pick(ROUND_START);
    case 'villagerWin':  return pick(VILLAGER_WIN);
    case 'grendelWin':   return pick(GRENDEL_WIN);
    case 'aborted':      return pick(ABORTED);
    case 'shaperBegin':  return fmt(pick(SHAPER_BEGIN), vars);
    case 'shaperDown':   return pick(SHAPER_DOWN);
    case 'strangerCome': return fmt(pick(STRANGER_COME), vars);
    case 'motherCave':   return pick(MOTHER_CAVE);
    default:             return '';
  }
}
