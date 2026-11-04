import { describe, it, expect } from 'vitest';
import { World, replayWorld, PROCEDURE_SH1 } from '../src/engine/world';
import { at, hhmm, dayOf } from '../src/engine/time';
import { toMSv, toMGy, MSV_PER_MGY } from '../src/engine/units';
import { flareRank } from '../src/engine/donki';
import rules from '../src/data/rules.json';

const clock = () => 0;

function runWeek(shelterAt?: string) {
  const w = new World(undefined, clock);
  if (shelterAt) {
    w.advanceTo(at(94, shelterAt));
    w.apply({ type: 'procStart', alertId: w.openAlert('radiation')?.id ?? null }, 0);
    for (const s of PROCEDURE_SH1.steps.slice(0, 3)) w.apply({ type: 'procStep', step: s.n }, 0);
  }
  w.advanceTo(at(95, '23:59'));
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

describe('demo story, PRD section 07', () => {
  const w = runWeek('14:16');
  const ev = w.alerts.find((a) => a.peak === 'warning')!;

  it('gives Caution at 06:40 from the X2 flare and fast CME', () => {
    expect(hhmm(ev.openedAt)).toBe('06:40');
    expect(dayOf(ev.openedAt)).toBe(94);
    expect(ev.history[0].level).toBe('caution');
    expect(ev.history[0].ruleId).toBe('R-C1');
  });

  it('gives one Verify for the single sensor spike near 13:52', () => {
    const v = w.alerts.filter((a) => a.kind === 'sensor' && dayOf(a.openedAt) === 94);
    expect(v).toHaveLength(1);
    expect(v[0].openedAt).toBeGreaterThanOrEqual(at(94, '13:52'));
    expect(v[0].openedAt).toBeLessThanOrEqual(at(94, '13:55'));
  });

  it('raises Warning at 14:13 on the same event (one event, one alert)', () => {
    const wHist = ev.history.find((h) => h.level === 'warning')!;
    expect(hhmm(wHist.t)).toBe('14:13');
    expect(wHist.ruleId).toBe('R-W1');
    expect(w.alerts.filter((a) => a.kind === 'radiation' && dayOf(a.openedAt) === 94)).toHaveLength(1);
  });

  it('clears the Warning near day 95 02:30 and estimates the dose saved', () => {
    expect(dayOf(ev.closedAt!)).toBe(95);
    expect(ev.closedAt!).toBeGreaterThanOrEqual(at(95, '02:00'));
    expect(ev.closedAt!).toBeLessThanOrEqual(at(95, '03:00'));
    expect(ev.savedMSv).toBeGreaterThan(0);
    expect(w.log.some((e) => e.kind === 'advisory' && e.text.includes('estimate'))).toBe(true);
  });

  it('meets M-3: at most 3 Caution or Warning events in 7 days', () => {
    const total = [...w.cautionWarningByDay().values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(3);
    expect(total).toBe(1);
  });

  it('never raises Warning from DONKI alone (FR-02)', () => {
    const before = new World(undefined, clock);
    before.advanceTo(at(94, '13:57'));
    expect(before.alerts.some((a) => a.history.some((h) => h.level === 'warning'))).toBe(false);
  });

  it('matches the 24 h projection in the PRD at 14:22 (about 31 mSv)', () => {
    const s = w.history.find((h) => h.t === at(94, '14:22'))!;
    expect(w.projection24h(s)).toBeGreaterThan(25);
    expect(w.projection24h(s)).toBeLessThan(37);
  });
});

describe('quiet days', () => {
  it('give no Caution or Warning before day 94', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '06:00'));
    expect(w.alerts.every((a) => a.peak === 'advisory' || a.peak === 'verify')).toBe(true);
  });
});

describe('shelter', () => {
  it('lowers the personal dose', () => {
    const inside = runWeek('14:16');
    const outside = runWeek();
    expect(inside.missionDoseMSv).toBeLessThan(outside.missionDoseMSv - 5);
  });
});

describe('alert controls', () => {
  it('inhibit stops a rule, enable restores it', () => {
    const w = new World(undefined, clock);
    w.apply({ type: 'inhibit', ruleId: 'R-C1' }, 0);
    w.apply({ type: 'inhibit', ruleId: 'R-A1' }, 0);
    w.advanceTo(at(94, '07:00'));
    expect(w.openAlert('radiation')).toBeUndefined();
    w.apply({ type: 'enable', ruleId: 'R-C1' }, 0);
    w.advanceTo(at(94, '07:01'));
    expect(w.openAlert('radiation')?.level).toBe('caution');
  });

  it('ack resets when the level goes up', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '07:00'));
    const a = w.openAlert('radiation')!;
    w.apply({ type: 'ack', alertId: a.id }, 0);
    expect(a.acked).toBe(true);
    w.advanceTo(at(94, '14:20'));
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
    const w = runWeek('14:16');
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
    const w = runWeek('14:16');
    const copy = replayWorld(w.actions, w.t, clock);
    expect(copy.missionDoseMSv).toBeCloseTo(w.missionDoseMSv, 6);
    expect(copy.log.length).toBe(w.log.length);
  });
});

describe('warning clear progress', () => {
  it('is null with no Warning, and counts toward 2 h during a Warning', () => {
    const w = new World(undefined, clock);
    w.advanceTo(at(94, '10:00'));
    expect(w.warningClearProgress()).toBeNull();
    w.advanceTo(at(94, '14:20'));
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
