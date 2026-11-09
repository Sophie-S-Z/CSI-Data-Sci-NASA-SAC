import { describe, it, expect } from 'vitest';
import { readNote, NOTE_SYMPTOMS } from '../src/app/noteReader';
import { evaluateBody } from '../src/engine/bodyRules';

describe('check-in note reader', () => {
  const cases: [string, string[]][] = [
    ['Bad headache since lunch, and my head feels full.', ['Headache', 'Stuffy head']],
    ['Felt queasy after the shelter and threw up once.', ['Nausea', 'Vomiting']],
    ['Text on the laptop is blurry up close. Pressure behind my eyes.', ['Blurred near vision', 'Eye pressure']],
    ['Lower back hurts. Knees ache after the run.', ['Back pain', 'Joint pain']],
    ['Gums bleed when I brush. New bruise on my arm.', ['Bruising', 'Bleeding gums']],
    ['Light-headed and out of breath on the bike.', ['Short of breath', 'Dizzy']],
    ['Exhausted. Muscles are sore.', ['Fatigue', 'Muscle soreness']],
    ['Chills tonight and a rash on my neck', ['Skin redness', 'Fever']],
  ];
  it.each(cases)('"%s" names %j', (note, want) => {
    expect(readNote(note)).toEqual(want);
  });

  it('skips a negated symptom, and the negation ends at "but" or a full stop', () => {
    expect(readNote('No nausea or vomiting today.')).toEqual([]);
    expect(readNote("I don't feel dizzy. Not tired.")).toEqual([]);
    expect(readNote('No nausea but a headache.')).toEqual(['Headache']);
    expect(readNote('Not dizzy. Headache.')).toEqual(['Headache']);
    expect(readNote("Can't read the small text")).toEqual(['Blurred near vision']);
  });

  it('names nothing in a note with no symptom', () => {
    for (const n of ['', 'Good day. Payload ops went well.', 'Back to work after the shelter.', 'Red light on panel 3.']) expect(readNote(n)).toEqual([]);
  });

  it('gives only chip names, so a suggestion feeds the body rules as a marked symptom', () => {
    const s = readNote('Headache and stuffy head after the shelter.');
    expect(s.every((x) => NOTE_SYMPTOMS.includes(x))).toBe(true);
    const f = evaluateBody({ checkins: [{ t: 0, c: { sleepH: 7, symptoms: s, note: '' } }], lastEvent: null, hr: [], exercise: [] });
    expect(f.map((x) => x.ruleId)).toContain('B-A1');
  });
});
