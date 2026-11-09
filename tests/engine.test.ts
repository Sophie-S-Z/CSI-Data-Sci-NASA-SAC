import { describe, it, expect } from 'vitest';
import { World, replayWorld, PROCEDURE_SH1 } from '../src/engine/world';
import { at, hhmm, dayOf } from '../src/engine/time';
import { toMSv, toMGy, MSV_PER_MGY } from '../src/engine/units';
import { flareRank } from '../src/engine/donki';
import rules from '../src/data/rules.json';
import bodyRules from '../src/data/body-rules.json';
import cabinRules from '../src/data/cabin-rules.json';
import sources from '../src/data/sources.json';

const clock = () => 0;

function runWeek(shelterAt?: string) {
  const w = new World(undefined, clock);
  if (shelterAt) {
    w.advanceTo(at(94, shelterAt));
    w.apply({ type: 'procStart', alertId: w.openAlert('radiation')?.id ?? null }, 0);
    for (const s of PROCEDURE_SH1.steps.slice(0, 3)) w.apply({ type: 'procStep', step: s.n }, 0);
  }
  w.advanceTo(at(97, '23:59'));
  return w;
}

describe('units (NFR-02)', () => {
  it('uses one documented factor', () => {
    expect(MSV_PER_MGY).toBe(rules.units.mSvPerMGy);
    expect(toMGy(toMSv(1.234))).toBeCloseTo(1.234, 10);
  });
});

describe('DONKI flare classes', () => {
  it('ranks classes', () => {
    expect(flareRank('X2.1')).toBeGreaterThan(flareRank('X1'));
    expect(flareRank('M1.4')).toBeGreaterThan(flareRank('M1'));
    expect(flareRank('C9.9')).toBeLessThan(flareRank('M1'));
  });
});

describe('demo story on the measured March 2012 event (MSL RAD)', () => {
  const w = runWeek('08:55');
  const ev = w.alerts.find((a) => a.peak === 'warning')!;

  it('gives Caution at 00:24 from the real X5.4 flare and its 2,684 km/s CME', () => {
    expect(hhmm(ev.openedAt)).toBe('00:24');
    expect(dayOf(ev.openedAt)).toBe(94);
    expect(ev.history[0].level).toBe('caution');
    expect(ev.history[0].ruleId).toBe('R-C1');
  });

  it('gives one Verify for the single sensor spike near 03:10', () => {
    const v = w.alerts.filter((a) => a.kind === 'sensor' && dayOf(a.openedAt) === 94);
    expect(v).toHaveLength(1);
    expect(v[0].openedAt).toBeGreaterThanOrEqual(at(94, '03:10'));
    expect(v[0].openedAt).toBeLessThanOrEqual(at(94, '03:14'));
  });

  it('raises Warning near 08:50, after 30 min at 2 x B on 2 sensors (one event, one alert)', () => {
    const wHist = ev.history.find((h) => h.level === 'warning')!;
    expect(wHist.t).toBeGreaterThanOrEqual(at(94, '08:30'));
    expect(wHist.t).toBeLessThanOrEqual(at(94, '09:15'));
    expect(wHist.ruleId).toBe('R-W1');
    expect(w.alerts.filter((a) => a.kind === 'radiation' && dayOf(a.openedAt) === 94)).toHaveLength(1);
  });

  it('warns many hours before the rate passes 10 x B (the old Warning level)', () => {
    const wT = ev.history.find((h) => h.level === 'warning')!.t;
    const old = w.history.find((h) => h.t > wT && h.mean >= 10 * h.B);
    expect(old).toBeTruthy();
    expect(old!.t - wT).toBeGreaterThan(6 * 60);
  });

  it('drops the Warning to Caution on day 97, while the NOAA S1 event goes on, and estimates the dose saved', () => {
    const down = ev.history.find((h, i) => i > 0 && ev.history[i - 1].level === 'warning' && h.level === 'caution')!;
    expect(dayOf(down.t)).toBe(97);
    expect(ev.savedMSv).toBeGreaterThan(5);
  });

  it('meets M-3: at most 3 Caution or Warning events in 7 days', () => {
    const total = [...w.cautionWarningByDay().values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it('never raises Warning from DONKI alone (FR-02)', () => {
    const before = new World(undefined, clock);
    before.advanceTo(at(94, '07:30'));
    expect(before.alerts.some((a) => a.history.some((h) => h.level === 'warning'))).toBe(false);
  });
});

describe('quiet days', () => {
  it('give no Warning before day 94; the day 92 Caution comes from the real X1.1 flare and fast CME', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '00:00'));
    expect(w.alerts.every((a) => a.peak !== 'warning')).toBe(true);
    const c = w.alerts.find((a) => a.peak === 'caution')!;
    expect(dayOf(c.openedAt)).toBe(92);
    expect(c.donkiRefs.some((id) => id.startsWith('FLR-2012-03-05'))).toBe(true);
  });
});

describe('shelter', () => {
  it('lowers the personal dose', () => {
    const inside = runWeek('08:55');
    const outside = runWeek();
    expect(inside.missionDoseMSv).toBeLessThan(outside.missionDoseMSv - 5);
  });
});

describe('alert controls', () => {
  it('inhibit stops a rule, enable restores it', () => {
    const w = new World(undefined, clock);
    w.apply({ type: 'inhibit', ruleId: 'R-C1' }, 0);
    w.apply({ type: 'inhibit', ruleId: 'R-A1' }, 0);
    w.advanceTo(at(94, '02:00'));
    expect(w.openAlert('radiation')).toBeUndefined();
    w.apply({ type: 'enable', ruleId: 'R-C1' }, 0);
    w.advanceTo(at(94, '02:01'));
    expect(w.openAlert('radiation')?.level).toBe('caution');
  });

  it('ack resets when the level goes up', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '02:00'));
    const a = w.openAlert('radiation')!;
    w.apply({ type: 'ack', alertId: a.id }, 0);
    expect(a.acked).toBe(true);
    w.advanceTo(at(94, '09:30'));
    expect(a.level).toBe('warning');
    expect(a.acked).toBe(false);
  });
});

describe('privacy (M-8)', () => {
  it('keeps private entries out of the ground summary', () => {
    const w = new World(undefined, clock);
    w.apply({ type: 'link', link: 'blackout' }, 0);
    for (let i = 0; i < 3; i++) w.apply({ type: 'checkin', data: { sleepH: 5, symptoms: ['headache'], note: `secret ${i}` }, visibility: 'private' }, 0);
    w.apply({ type: 'checkin', data: { sleepH: 7, symptoms: [], note: 'shared' }, visibility: 'ground' }, 0);
    w.apply({ type: 'link', link: 'live' }, 0);
    const sum = w.log.filter((e) => e.kind === 'summary').pop()!;
    const text = sum.summary!.lines.map((l) => l.text).join('\n');
    expect(text).not.toContain('secret');
    expect(text).toContain('shared');
    expect(sum.summary!.withheld).toBeGreaterThanOrEqual(3);
  });

  it('respects a later visibility change', () => {
    const w = new World(undefined, clock);
    w.apply({ type: 'checkin', data: { sleepH: 6, symptoms: [], note: 'later private' }, visibility: 'ground' }, 0);
    const e = w.log.find((x) => x.kind === 'checkin')!;
    w.apply({ type: 'visibility', seq: e.seq, visibility: 'private' }, 0);
    const sum = w.buildSummary(0);
    expect(sum.summary!.lines.some((l) => l.text.includes('later private'))).toBe(false);
  });
});

describe('audit log (NFR-07)', () => {
  it('is append-only and frozen', () => {
    const w = runWeek('08:55');
    const seqs = w.log.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(Object.isFrozen(w.log[0])).toBe(true);
    const alert = w.log.find((e) => e.kind === 'alert')!;
    expect(alert.ruleId).toBeTruthy();
    expect(alert.inputs).toBeTruthy();
  });
});

describe('persistence', () => {
  it('rebuilds the same state from recorded actions', () => {
    const w = runWeek('08:55');
    const copy = replayWorld(w.actions, w.t, clock);
    expect(copy.missionDoseMSv).toBeCloseTo(w.missionDoseMSv, 6);
    expect(copy.log.length).toBe(w.log.length);
  });
});

describe('warning clear progress', () => {
  it('is null with no Warning, and counts toward the clear time during a Warning', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '06:00'));
    expect(w.warningClearProgress()).toBeNull();
    w.advanceTo(at(94, '09:30'));
    const p = w.warningClearProgress()!;
    expect(p.need).toBe(rules.timing.warningClearMin);
    expect(p.have).toBe(0);
    while (w.openAlert('radiation')?.level === 'warning') {
      const q = w.warningClearProgress()!;
      expect(q.have).toBeLessThanOrEqual(q.need);
      w.step();
    }
  });
});

describe('sources', () => {
  it('every source key in the data files exists in sources.json', () => {
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'source' && typeof x === 'string' ? keys.push(x) : walk(x);
    };
    [rules, bodyRules, cabinRules].forEach(walk);
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(sources, k).toHaveProperty(k);
  });
});
