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
