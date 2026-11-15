/**
 * Check-in note reader. Part of the onboard assistant. It runs offline.
 *
 * It finds the symptom chips that a free-text note names, so the crew does not have to
 * mark the same thing twice. It only suggests: the crew taps a suggestion to mark it,
 * and the body rules read marked symptoms only.
 *
 * Negation: a cue word ("no", "not", "without", "n't") earlier in the same clause
 * cancels a match. A clause ends at . ; ! ? a new line, or "but". A missed symptom
 * is the safe error here, because the crew can still mark it by hand.
 */

const TERMS = {
  Nausea: /\b(nause\w*|queasy|sick to my stomach|upset stomach)\b/,
  Vomiting: /\b(vomit\w*|threw up|throw(ing)? up|puk(e|ed|ing))\b/,
  Diarrhea: /\b(diarrh\w*|loose stools?)\b/,
  Fatigue: /\b(fatigue\w*|tired|exhausted|worn out|drained|(no|low) energy)\b/,
  'Skin redness': /\b(rash|redness|red skin|skin (is |looks )?red|sunburn\w*)\b/,
  Fever: /\b(fever\w*|chills)\b/,
  Headache: /\b(head ?aches?|head (hurts|is pounding|pounds|throbs)|migraine)\b/,
  'Blurred near vision': /\b(blurr?(y|ed)?|fuzzy (vision|text)|hard to read|can'?t read)\b/,
  'Eye pressure': /\b(eye pressure|pressure (behind|in) (my )?eyes?|eyes? feels? (full|tight))\b/,
  'Stuffy head': /\b(stuffy|stuffed up|congest\w*|blocked nose|puffy face|head feels full)\b/,
  'Short of breath': /\b(short(ness)? of breath|breathless|out of breath|hard to breathe|can'?t (catch my )?breathe?)\b/,
  Dizzy: /\b(dizz(y|iness)|light[- ]?headed|vertigo)\b/,
  'Back pain': /\b(back ?(pain|aches?|hurts|is sore)|sore (lower )?back)\b/,
  'Muscle soreness': /\b(sore muscles?|muscles? (are |feel )?(sore|aching|aches?)|muscle (soreness|pain|aches?))\b/,
  'Joint pain': /\b(joints? (pain|aches?|hurts?|are sore)|(knee|elbow|shoulder|hip|wrist|ankle)s? (pain|hurts?|aches?|is sore))\b/,
  Bruising: /\b(bruis\w*)\b/,
  'Bleeding gums': /\b(bleeding gums?|gums? (bleed|bled|bleeding)|blood when i brush\w*)\b/,
} satisfies Record<string, RegExp>;

export type Symptom = keyof typeof TERMS;
export const NOTE_SYMPTOMS = Object.keys(TERMS) as Symptom[];

const NEGATION = /\b(no|not|none|never|without|nor)\b|n't\b/;
const CLAUSE_END = /[.;!?\n]|\bbut\b/;

/** The symptoms that a note names and does not negate, in chip order. */
export function readNote(note: string): Symptom[] {
  const found = new Set<Symptom>();
  for (const clause of note.toLowerCase().replace(/’/g, "'").split(CLAUSE_END)) {
    for (const s of NOTE_SYMPTOMS) {
      const m = TERMS[s].exec(clause);
      if (m && !NEGATION.test(clause.slice(0, m.index))) found.add(s);
    }
  }
  return NOTE_SYMPTOMS.filter((s) => found.has(s));
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** The value of one spoken word or digit group. NaN when it is not a number. */
function tokenValue(tok: string | undefined): number {
  if (tok === undefined) return NaN;
  if (/^-?\d/.test(tok)) return Number(tok);
  const u = UNITS.indexOf(tok);
  return u >= 0 ? u : TENS[tok] ?? NaN;
}

/**
 * The first number in a spoken phrase, for a voice entry in a number field. NaN when there is no number.
 * It reads digits ("6.5", "6,5", "1,200") and words ("six", "twenty five", "six point five", "six and a half").
 * "minus" or "negative" just before the number makes it negative.
 */
export function spokenNumber(phrase: string): number {
  const toks = phrase.toLowerCase()
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2') // 1,200 is a thousands separator
    .replace(/(\d),(\d)/g, '$1.$2') // 6,5 is a decimal comma
    .match(/-?\d+(?:\.\d+)?|[a-z]+/g) ?? [];
  for (let i = 0; i < toks.length; i++) {
    let n = tokenValue(toks[i]);
    if (Number.isNaN(n)) continue;
    let j = i + 1;
    const unit = UNITS.indexOf(toks[j]);
    if (toks[i] in TENS && unit >= 1 && unit <= 9) { n += unit; j++; }
    const frac = tokenValue(toks[j + 1]);
    if (toks[j] === 'point' && Number.isInteger(frac) && frac >= 0) n = Number(`${n}.${frac}`);
    else if (toks[j] === 'and' && toks[j + 1] === 'a' && toks[j + 2] === 'half') n += 0.5;
    return toks[i - 1] === 'minus' || toks[i - 1] === 'negative' ? -n : n;
  }
  return NaN;
}

/**
 * The step of a word scale that a spoken phrase names: the first label in the phrase that is not negated
 * ("not good" does not count), or a number from 1 to the scale length. 0 when it names none.
 */
export function spokenStep(phrase: string, labels: readonly string[]): number {
  const s = phrase.toLowerCase().replace(/\bokay\b/g, 'ok');
  let best = -1, at = Infinity;
  labels.forEach((l, i) => {
    for (const m of s.matchAll(new RegExp(`\\b${l.toLowerCase()}\\b`, 'g'))) {
      if (m.index < at && !/\b(not|no|never)\s+(\w+\s+)?$/.test(s.slice(0, m.index))) { best = i; at = m.index; }
    }
  });
  if (best >= 0) return best + 1;
  const n = spokenNumber(s);
  return n >= 1 && n <= labels.length ? Math.round(n) : 0;
}
