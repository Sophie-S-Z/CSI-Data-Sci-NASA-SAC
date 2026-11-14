import { describe, it, expect } from 'vitest';
import { ANALOGS, REPLAY_ANALOGS, PAST_PEAK, backtest, eventSeries, forecastClear } from '../src/engine/forecast';
import { World } from '../src/engine/world';
import { at } from '../src/engine/time';

describe('clear-time forecast (decay fit, range from measured RAD events)', () => {
  it('uses all 6 measured events, and leaves the replayed March 2012 event out of the replay analogs', () => {
    expect(ANALOGS).toHaveLength(6);
    expect(REPLAY_ANALOGS.map((a) => a.id)).not.toContain('cruise_2012-1');
    expect(REPLAY_ANALOGS).toHaveLength(5);
  });

  it('gives no forecast while the rate is near its peak', () => {
    const rising = [1, 2, 4, 8, 12, 16, 20].map((r, i) => ({ t: i * 15, r }));
    expect(forecastClear(rising, ANALOGS)).toBeNull();
  });

  it('gives an ordered range in the future after the peak', () => {
    const falling = [30, 30, 30, 30, 20, 12, 8, 6, 5, 5, 5, 5].map((r, i) => ({ t: i * 15, r }));
    const f = forecastClear(falling, ANALOGS)!;
    expect(f).not.toBeNull();
    expect(f.earliest).toBeGreaterThanOrEqual(falling[falling.length - 1].t);
    expect(f.latest).toBeGreaterThanOrEqual(f.earliest);
    expect(f.excessHi).toBeGreaterThanOrEqual(f.excessLo);
    expect(f.analogs.length).toBeGreaterThanOrEqual(2);
  });

  it('leave-one-out on the 6 events: the real clear time is in the range at 97% of checks or more', () => {
    const b = backtest();
    expect(b.checks).toBeGreaterThan(500);
    expect(b.hits + b.late + b.early).toBe(b.checks);
    expect(b.hits / b.checks).toBeGreaterThan(0.97);
  });

  it('on the replay, abstains before the 8 March peak and brackets the real clear time after it', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(at(97, '23:59'));
    const ev = w.alerts.find((a) => a.peak === 'warning')!;
    const clear = ev.history.find((h, i) => i > 0 && h.level === 'caution' && ev.history[i - 1].level === 'warning')!.t;
    const series = eventSeries(w.history, ev.openedAt);
    const peak = series.reduce((m, p) => (p.r > m.r ? p : m));
    const before = series.filter((p) => p.t < peak.t);
    expect(forecastClear(before, REPLAY_ANALOGS)).toBeNull();
    const day96 = series.filter((p) => p.t <= at(96, '12:00'));
    expect(day96[day96.length - 1].r).toBeLessThan(PAST_PEAK * peak.r);
    const f = forecastClear(day96, REPLAY_ANALOGS)!;
    expect(f.earliest).toBeLessThanOrEqual(clear);
    expect(f.latest).toBeGreaterThanOrEqual(clear);
  });
});
