import { describe, it, expect } from 'vitest';
import { evaluateBody, BODY_RULES, type BodyInput } from '../src/engine/bodyRules';
import { World } from '../src/engine/world';
import { at } from '../src/engine/time';
import type { CheckIn } from '../src/engine/world';
import sources from '../src/data/sources.json';

const ci = (day: number, c: Partial<CheckIn>) => ({ t: at(day, '07:00'), c: { sleepH: 7, symptoms: [], note: '', mood: 4, ...c } });
const base = (over: Partial<BodyInput> = {}): BodyInput => ({ checkins: [], lastEvent: null, hr: [60, 60, 60], exercise: [90, 90, 90], ...over });
const ids = (i: BodyInput) => evaluateBody(i).map((f) => f.ruleId);

describe('body-system rules (3B)', () => {
  it('never gives Warning, and every rule has a source', () => {
    for (const r of BODY_RULES) {
      expect(['advisory', 'caution']).toContain(r.level);
      expect((sources as Record<string, unknown>)[r.source]).toBeTruthy();
    }
  });

  it('gives no findings on a normal day', () => {
    expect(ids(base({ checkins: [ci(94, {})] }))).toEqual([]);
  });

  it('B-RAD1: GI signs within 48 h after an event dose give Caution', () => {
    const ev = { t: at(94, '06:40'), doseMSv: 3 };
    expect(ids(base({ checkins: [ci(95, { symptoms: ['Nausea'] })], lastEvent: ev }))).toContain('B-RAD1');
    expect(ids(base({ checkins: [ci(97, { symptoms: ['Nausea'] })], lastEvent: ev }))).not.toContain('B-RAD1');
    expect(ids(base({ checkins: [ci(95, { symptoms: ['Nausea'] })], lastEvent: { ...ev, doseMSv: 0.2 } }))).not.toContain('B-RAD1');
    expect(evaluateBody(base({ checkins: [ci(95, { symptoms: ['Vomiting'] })], lastEvent: ev }))[0].level).toBe('caution');
  });

  it('B-V1 then B-V2: vision symptoms on 2 days in a row escalate', () => {
    const one = [ci(94, { symptoms: ['Blurred near vision'] })];
    expect(ids(base({ checkins: one }))).toEqual(['B-V1']);
    const two = [ci(93, { symptoms: ['Eye pressure'] }), ...one];
    expect(ids(base({ checkins: two }))).toEqual(['B-V2']);
  });

  it('B-A1: headache needs a CO2 sign', () => {
    expect(ids(base({ checkins: [ci(94, { symptoms: ['Headache'] })] }))).toEqual([]);
    expect(ids(base({ checkins: [ci(94, { symptoms: ['Headache', 'Stuffy head'] })] }))).toEqual(['B-A1']);
  });

  it('B-S1: 3 short nights in a row', () => {
    const c = [ci(92, { sleepH: 5.5 }), ci(93, { sleepH: 5 }), ci(94, { sleepH: 5.8 })];
    expect(ids(base({ checkins: c }))).toEqual(['B-S1']);
    expect(ids(base({ checkins: c.slice(1) }))).toEqual([]);
  });

  it('B-M1: low mood on 3 of the last 5', () => {
    const c = [ci(90, { mood: 2 }), ci(91, { mood: 4 }), ci(92, { mood: 1 }), ci(93, { mood: 4 }), ci(94, { mood: 2 })];
    expect(ids(base({ checkins: c }))).toEqual(['B-M1']);
    expect(ids(base({ checkins: c.slice(0, 4) }))).toEqual([]);
  });

  it('B-H1 and B-H2: heart rate range and rise', () => {
    expect(ids(base({ hr: [60, 60, 104] }))).toEqual(['B-H1']);
    expect(ids(base({ hr: [60, 60, 38] }))).toEqual(['B-H1']);
    expect(ids(base({ hr: [60, 60, 85] }))).toEqual(['B-H2']);
    expect(ids(base({ hr: [60, 60, 75] }))).toEqual([]);
  });

  it('B-B1: low exercise on 3 of the last 7 days', () => {
    expect(ids(base({ exercise: [90, 50, 90, 40, 90, 55, 90] }))).toEqual(['B-B1']);
    expect(ids(base({ exercise: [90, 50, 90, 40, 90, 90, 90] }))).toEqual([]);
  });

  it('sorts Caution before Advisory', () => {
    const f = evaluateBody(base({ checkins: [ci(95, { symptoms: ['Nausea', 'Bruising'] })], lastEvent: { t: at(94, '14:00'), doseMSv: 4 } }));
    expect(f.map((x) => x.level)).toEqual(['caution', 'advisory']);
  });
});

describe('body rules in the world', () => {
  it('logs findings with the check-in visibility, and adds no radiation alert', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(at(94, '08:00'));
    const before = w.alerts.length;
    w.apply({ type: 'checkin', data: { sleepH: 7, symptoms: ['Blurred near vision'], note: '' }, visibility: 'cmo' }, 0);
    const e = w.log.find((x) => x.ruleId === 'B-V1')!;
    expect(e).toBeTruthy();
    expect(e.kind).toBe('advisory');
    expect(e.visibility).toBe('cmo');
    expect(w.alerts.length).toBe(before);
  });

  it('previews a draft check-in without a log entry', () => {
    const w = new World(undefined, () => 0);
    const n = w.log.length;
    expect(w.bodyFindings({ sleepH: 7, symptoms: ['Headache', 'Dizzy'], note: '' }).map((f) => f.ruleId)).toEqual(['B-A1']);
    expect(w.log.length).toBe(n);
  });
});
