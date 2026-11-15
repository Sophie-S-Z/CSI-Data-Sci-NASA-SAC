import { describe, expect, it } from 'vitest';
import { World } from '../src/engine/world';
import { dayOf } from '../src/engine/time';
import { BEATS, DEMO_START } from '../src/ui/useSim';
import { buildReport } from '../src/app/report';
import { facts } from '../src/app/ai';
import { ask } from '../src/app/assistant';
import { DOSE_LADDER, LEVEL_EFFECT } from '../src/app/health';
import { resolveSource } from '../src/app/sources';
import { DEFAULT_PROFILE } from '../src/app/profile';

const atPeak = () => {
  const w = new World(undefined, () => 0);
  w.advanceTo(DEMO_START);
  w.advanceTo(BEATS[4].t);
  return w;
};

describe('daily report', () => {
  it('lists the Warning of the storm day, with its body effect and the solar records', () => {
    const w = atPeak();
    const r = buildReport(w, dayOf(BEATS[3].t), DEFAULT_PROFILE, new Date(0));
    expect(r.summary.worstLevel).toBe('warning');
    expect(r.alerts.some((a) => a.peak === 'warning' && a.bodyEffect === LEVEL_EFFECT.warning.text)).toBe(true);
    expect(r.solar.length).toBeGreaterThan(0);
    expect(r.crew.name).toBe('Crew A');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('holds the check-ins and actions of the day, and flags the open alert today', () => {
    const w = atPeak();
    w.apply({ type: 'checkin', data: { sleepH: 5, symptoms: ['Nausea'], note: 'Felt sick after lunch' }, visibility: 'cmo' }, 0);
    const r = buildReport(w, dayOf(w.t), DEFAULT_PROFILE);
    expect(r.checkins).toHaveLength(1);
    expect(r.checkins[0].symptoms).toEqual(['Nausea']);
    expect(r.attention.some((x) => x.includes('is open: Warning'))).toBe(true);
  });
});

describe('AI facts', () => {
  it('give the model the alert, the matched answer, and the body effect', () => {
    const w = atPeak();
    const a = ask('When can I leave the shelter?', w);
    const f = facts(a, w, { ...DEFAULT_PROFILE, name: 'Sam' });
    expect(f[0]).toContain('Sam');
    expect(f).toEqual(expect.arrayContaining(a.lines));
    expect(f.some((x) => x.includes(LEVEL_EFFECT.warning.text))).toBe(true);
  });

  it('cite only sources that the source panel can open', () => {
    for (const k of [...Object.values(LEVEL_EFFECT), ...DOSE_LADDER].map((x) => x.src)) expect(resolveSource(k).length, k).toBeGreaterThan(0);
  });
});
