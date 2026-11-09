import { describe, it, expect } from 'vitest';
import { ask, match, suggestions, MIN_SCORE } from '../src/app/assistant';
import { resolveSource } from '../src/app/sources';
import { World, PROCEDURE_SH1 } from '../src/engine/world';
import { at } from '../src/engine/time';

const clock = () => 0;
const worldAt = (day: number, hhmm: string, shelter = true) => {
  const w = new World(undefined, clock);
  if (shelter) {
    w.advanceTo(at(94, '08:55'));
    w.apply({ type: 'procStart', alertId: w.openAlert('radiation')!.id }, 0);
    for (const s of PROCEDURE_SH1.steps.slice(0, 3)) w.apply({ type: 'procStep', step: s.n }, 0);
  }
  w.advanceTo(at(day, hhmm));
  return w;
};

describe('onboard assistant: question matching', () => {
  // Paraphrases that are not in the example lists.
  const cases: [string, string][] = [
    ['What should I be doing right now?', 'now'],
    ['How long until the warning is over?', 'clear'],
    ['When will this radiation storm end?', 'clear'],
    ['Is it OK to go back to my task?', 'leave'],
    ['How much radiation have I taken?', 'dose'],
    ['Am I near my career limit?', 'dose'],
    ['Could this be a sensor fault?', 'sensor'],
    ['Why is there a warning?', 'why'],
    ['Was there a flare?', 'solar'],
    ['Who can read my health check?', 'privacy'],
    ['How did I sleep this week?', 'body'],
    ['Is the CO2 too high?', 'cabin'],
    ['What did I forget to do?', 'missing'],
    ['How long until mission control hears about this?', 'ground'],
    ['How good is the shielding in the shelter?', 'shelter'],
    ['Where does this data come from?', 'data'],
    ['What happened while I was asleep?', 'brief'],
    ['Catch me up on the night', 'brief'],
  ];
  it.each(cases)('"%s" goes to %s', (q, topic) => {
    expect(match(q).topic).toBe(topic);
    expect(match(q).score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('says it has no answer for a question outside its topics', () => {
    const w = worldAt(94, '00:10', false);
    for (const q of ['What is the capital of France?', 'Tell me a joke', 'Should I eat lunch?', 'asdf qwerty', '']) expect(ask(q, w).kind).toBe('none');
  });
});

describe('onboard assistant: guards', () => {
  const w = worldAt(95, '12:00');
  it('refuses a diagnosis or a treatment', () => {
    for (const q of ['Should I take a pill for nausea?', 'Do I have cancer?', 'Diagnose my headache', 'What medication helps?']) {
      expect(ask(q, w)).toMatchObject({ kind: 'refusal', topic: 'medical' });
    }
  });
  it('refuses to change alerts or rules', () => {
    for (const q of ['Turn off the alarm', 'Change the warning threshold to 5x', 'Can you acknowledge the alert?', 'Inhibit rule R-W1']) {
      expect(ask(q, w)).toMatchObject({ kind: 'refusal', topic: 'control' });
    }
  });
  it('still answers questions that name a limit or an alert', () => {
    expect(ask('How close am I to the career limit?', w).topic).toBe('dose');
    expect(ask('When does the warning clear?', w).topic).toBe('clear');
    expect(ask('Do I have a warning?', w).kind).not.toBe('refusal');
  });
  it('only reads: an answer leaves the world, the log, and the actions as they were', () => {
    const before = { log: w.log.length, actions: w.actions.length, t: w.t, inShelter: w.inShelter, acked: w.alerts.map((a) => a.acked) };
    for (const q of ['What do I do now?', 'Turn off the alarm', 'When can I leave the shelter?', 'Can I leave the shelter early?', 'What is still open?']) ask(q, w);
    expect({ log: w.log.length, actions: w.actions.length, t: w.t, inShelter: w.inShelter, acked: w.alerts.map((a) => a.acked) }).toEqual(before);
  });
});

describe('onboard assistant: answers from the state', () => {
  it('names the rule ID and gives its source', () => {
    const a = ask('What is R-W1?', worldAt(94, '00:10', false));
    expect(a.kind).toBe('knowledge');
    expect(a.sources).toEqual(['R-W1']);
    expect(a.lines[0]).toContain('R-W1');
  });

  it('during the Warning, before the peak: tells the crew to stay, and gives no clear-time estimate', () => {
    const w = worldAt(95, '12:00');
    expect(ask('What do I do now?', w).lines[0]).toContain('Stay in the shelter.');
    const c = ask('When can I leave the shelter?', w);
    expect(c.estimate).toBeFalsy();
    expect(c.lines.join(' ')).toContain('No estimate yet');
    expect(ask('Can I leave the shelter early?', w).lines[0]).toMatch(/^No\./);
  });

  it('during the Warning, after the peak: gives a labeled estimate with the test result', () => {
    const w = worldAt(96, '12:00');
    const c = ask('When can I leave the shelter?', w);
    expect(c.estimate).toBe(true);
    expect(c.lines.join(' ')).toMatch(/Estimate: the Warning clears between Day 09\d \d\d:\d\d and Day 09\d \d\d:\d\d/);
    expect(c.lines.join(' ')).toMatch(/in the range at \d+% of checks/);
    const l = ask('Can I leave the shelter early?', w);
    expect(l.estimate).toBe(true);
    expect(l.lines[1]).toMatch(/If you leave now, the rest of the event adds about [\d.]+ to [\d.]+ mSv/);
  });

  it('the brief lists the night of 5 March 2012: the solar records, the false sensor spike, and the open Caution', () => {
    const w = worldAt(94, '06:00', false);
    const b = ask('What happened in the last 12 h?', w);
    const text = b.lines.join(' ');
    expect(b.lines[0]).toMatch(/^Your dose in the last 12 h: [\d.]+ mSv\.$/);
    expect(text).toContain('Caution opened');
    expect(text).toMatch(/Verify opened.*clear\. Sensor data agrees again/);
    expect(text).toContain('Strongest flare: X5.4.');
    expect(text).toMatch(/Proton event \(SEP\) from Day 094/);
    expect(b.lines[b.lines.length - 1]).toMatch(/^Now: Caution EV-094-\d\d\. Safe your task\. Stage the shelter\.$/);
    expect(b.sources).toEqual(expect.arrayContaining(['R-C1', 'R-V1', 'donki']));
  });

  it('the brief counts shelter time and dose inside its 12 h window only', () => {
    const w = worldAt(95, '12:00');
    const b = ask('What happened in the last 12 h?', w);
    expect(b.lines[0]).toContain('Time in the shelter: 12 h');
    const dose = w.history.filter((h) => h.t > w.t - 720).reduce((s, h) => s + h.personal / 60, 0);
    expect(b.lines[0]).toContain(`${dose.toFixed(2)} mSv`);
  });

  it('every source key in every answer opens a source panel', () => {
    for (const w of [worldAt(94, '00:10', false), worldAt(94, '03:15', false), worldAt(96, '12:00')]) {
      for (const q of [...suggestions(w), 'What happened in the last 12 h?', 'Is the cabin air OK?', 'How is my body?', 'What is the baseline B?', 'What is the difference between mGy and mSv?', 'Who can see my check-ins?', 'When does the ground know?']) {
        const a = ask(q, w);
        expect(a.lines.length).toBeGreaterThan(0);
        for (const k of a.sources) expect(resolveSource(k), `${q} -> ${k}`).not.toHaveLength(0);
      }
    }
  });

  it('suggests shelter questions during a Warning', () => {
    expect(suggestions(worldAt(95, '12:00'))[0]).toBe('When can I leave the shelter?');
    expect(suggestions(worldAt(94, '00:10', false))[0]).toBe('What do I do now?');
  });
});
