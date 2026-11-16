import { describe, it, expect } from 'vitest';
import { readNote, NOTE_SYMPTOMS, spokenNumber, spokenStep } from '../src/app/noteReader';
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

  it('skips a negated symptom, and the negation ends at a comma, "and", "but", or a full stop', () => {
    expect(readNote('No nausea or vomiting today.')).toEqual([]);
    expect(readNote("I don't feel dizzy. Not tired.")).toEqual([]);
    expect(readNote('No nausea but a headache.')).toEqual(['Headache']);
    expect(readNote('Not dizzy. Headache.')).toEqual(['Headache']);
    expect(readNote('Not sleeping well, headache all day')).toEqual(['Headache']);
    expect(readNote('No fever and my back hurts')).toEqual(['Back pain']);
    expect(readNote('No nausea, no vomiting')).toEqual([]);
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

describe('spoken number', () => {
  it.each([
    ['6.5', 6.5], ['6,5 hours', 6.5], ['six and a half hours', 6.5], ['six point five hours', 6.5], ['pain is three', 3],
    ['7 and a half', 7.5], ['twenty five', 25], ['about 1,200 ppm', 1200], ['minus 4', -4], ['-2.5', -2.5], ['zero', 0],
    ['7 hours, no negative effects', 7], ['seven hours, woke up 2 times', 7], ['between 2 - 3', 2], ['someone', NaN], ['', NaN],
  ])('%s gives %s', (phrase, n) => {
    expect(spokenNumber(phrase)).toBe(n);
  });
});

describe('spoken scale step', () => {
  const mood = ['Low', 'Flat', 'Steady', 'Good', 'High'];
  const sleep = ['Poor', 'Fair', 'OK', 'Good', 'Great'];
  it.each([
    ['pretty good', mood, 4], ['not low, pretty high', mood, 5], ['not good', sleep, 0], ['okay I guess', sleep, 3],
    ['four', mood, 4], ['nine', mood, 0], ['great, not poor', sleep, 5],
  ] as const)('%s gives %s', (phrase, labels, n) => {
    expect(spokenStep(phrase, labels)).toBe(n);
  });
});
