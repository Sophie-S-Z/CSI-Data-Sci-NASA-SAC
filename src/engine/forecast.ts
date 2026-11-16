import radEvents from '../data/real/rad-events.json';
import rad from '../data/real/rad-replay.json';
import rules from '../data/rules.json';
import { multipleOf } from './units';
import type { Sample, World } from './world';

/**
 * Clear-time forecast for an open Warning. Part of the onboard assistant.
 *
 * A solar proton event falls about exponentially after its peak. The forecast fits
 * the decay time of the last 8 h of this event, and projects the fall to the clear
 * line, plus the clear hold. The range comes from the other measured RAD events:
 * the smallest and the largest ratio of the real time left to the projected time left.
 * The forecast is an estimate only. It never opens, holds, or clears an alert.
 */

const BIN_MIN: number = radEvents.bin_min;
const CLEAR_X = rules.thresholds.cautionMultiple.x;
const HOLD_BINS = rules.timing.warningClearMin / BIN_MIN;
/** No forecast until the rate falls below this part of the event peak. Before that, the rate can still rise. */
export const PAST_PEAK = 0.5;

/** Dose rate as a ratio to the background, in 15 min bins. t is in minutes. */
export interface Point { t: number; r: number }

/** A measured event. `raw` is the 15 min series and `s` is the same series smoothed. */
export interface Analog { id: string; onsetUtc: string; raw: Point[]; s: Point[]; peakIdx: number; clearT: number }

export interface ClearForecast {
  /** Earliest and latest clear time, in mission minutes. */
  earliest: number;
  latest: number;
  /** Excess absorbed dose still to come at an unshielded point, in baseline-hours (multiply by B × SPE_PER_GCR for mSv). */
  excessLo: number;
  excessHi: number;
  analogs: string[];
}

/** 1 h running median, so one noisy bin does not move the forecast. */
function smooth(s: Point[]): Point[] {
  return s.map((p, i) => {
    const w = s.slice(Math.max(0, i - 3), i + 1).map((q) => q.r).sort((a, b) => a - b);
    return { t: p.t, r: w[Math.floor(w.length / 2)] };
  });
}

/** The clear rule on one series: below the Caution line for the hold time, after the peak. */
function clearTime(s: Point[], from: number): number | null {
  let run = 0;
  for (let i = from; i < s.length; i++) {
    run = s[i].r < CLEAR_X ? run + 1 : 0;
    if (run >= HOLD_BINS) return s[i].t;
  }
  return null;
}

export const ANALOGS: Analog[] = radEvents.events.flatMap((e) => {
  const raw = e.ratio.map((r, i) => ({ t: i * BIN_MIN, r }));
  const s = smooth(raw);
  const peakIdx = s.reduce((m, p, i) => (p.r > s[m].r ? i : m), 0);
  const clearT = clearTime(s, peakIdx);
  return clearT === null ? [] : [{ id: e.id, onsetUtc: e.onset_utc, raw, s, peakIdx, clearT }];
});

/** The replay is the March 2012 event, so that event cannot be its own analog. */
const REPLAY_T0 = Date.parse(rad.start_utc);
const REPLAY_T1 = REPLAY_T0 + rad.ratio_E.length * rad.bin_min * 60_000;
export const REPLAY_ANALOGS = ANALOGS.filter((a) => {
  const t = Date.parse(`${a.onsetUtc}Z`);
  return t < REPLAY_T0 || t >= REPLAY_T1;
});

/** Fit window for the decay time: the last 8 h. */
const FIT_BINS = 32;

/** Projected minutes from the last point to the clear, or null if no projection is possible yet. */
function project(series: Point[]): { now: Point; tau: number; left: number } | null {
  if (series.length < HOLD_BINS) return null;
  const s = smooth(series);
  const now = s[s.length - 1];
  if (now.r > PAST_PEAK * Math.max(...s.map((p) => p.r))) return null;
  // Least-squares slope of ln(rate) over time. A falling rate gives the decay time tau, in minutes.
  const w = s.slice(-FIT_BINS);
  const xm = w.reduce((a, p) => a + p.t, 0) / w.length;
  const ym = w.reduce((a, p) => a + Math.log(p.r), 0) / w.length;
  const k = w.reduce((a, p) => a + (p.t - xm) * (Math.log(p.r) - ym), 0) / w.reduce((a, p) => a + (p.t - xm) ** 2, 0);
  if (!(k < 0)) return null;
  const tau = -1 / k;
  return { now, tau, left: tau * Math.log(Math.max(now.r, CLEAR_X) / CLEAR_X) + HOLD_BINS * BIN_MIN };
}

/** Each check of one event: its series from the first 2 × B bin up to a bin before the clear. */
function* checks(a: Analog) {
  const start = a.raw.findIndex((p) => p.r >= rules.thresholds.warningMultiple.x);
  for (let i = start; i >= 0 && a.raw[i].t < a.clearT; i++) yield a.raw.slice(start, i + 1);
}

/** Real time left over projected time left, at each check of an event. Computed once for each event. */
const ratioCache = new Map<string, number[]>();
function ratios(a: Analog): number[] {
  let r = ratioCache.get(a.id);
  if (!r) {
    r = [];
    for (const series of checks(a)) {
      const p = project(series);
      if (p && p.left > 0) r.push((a.clearT - p.now.t) / p.left);
    }
    ratioCache.set(a.id, r);
  }
  return r;
}

export function forecastClear(series: Point[], analogs: Analog[]): ClearForecast | null {
  const p = project(series);
  if (!p) return null;
  const used = analogs.filter((a) => ratios(a).length > 0);
  if (used.length < 2) return null;
  const all = used.flatMap(ratios);
  const lo = Math.min(...all), hi = Math.max(...all);
  // Excess dose to the clear line for decay time tau × f: integral of (r − 1) dt, in baseline-hours.
  const excess = (f: number) => {
    const tau = p.tau * f;
    return Math.max(0, tau * (p.now.r - CLEAR_X) - tau * Math.log(Math.max(p.now.r, CLEAR_X) / CLEAR_X)) / 60;
  };
  return {
    earliest: Math.max(p.now.t, Math.floor(p.now.t + p.left * lo)), latest: Math.ceil(p.now.t + p.left * hi),
    excessLo: excess(lo), excessHi: excess(hi), analogs: used.map((a) => a.id),
  };
}

/** The event series from the world: the highest good sensor, as a ratio to B, every 15 min since `from`. */
export function eventSeries(history: Sample[], from: number): Point[] {
  return history
    .filter((h) => h.t >= from && (h.t - from) % BIN_MIN === 0)
    .map((h) => {
      const good = h.cabin.filter((v, i): v is number => v !== null && h.quality[i] === 'good');
      return { t: h.t, r: multipleOf(good.length ? Math.max(...good) : h.mean, h.B) };
    });
}

/**
 * Leave-one-out test on the measured events: forecast each event with the range from
 * the other events only, at every bin from the first 2 × B bin to the clear.
 * A hit is a real clear time inside the range (one bin of slack).
 */
export function backtest(): { checks: number; hits: number; late: number; early: number } {
  const out = { checks: 0, hits: 0, late: 0, early: 0 };
  for (const a of ANALOGS) {
    const others = ANALOGS.filter((b) => b !== a);
    for (const series of checks(a)) {
      const f = forecastClear(series, others);
      if (!f) continue;
      out.checks += 1;
      if (a.clearT < f.earliest - BIN_MIN) out.early += 1;
      else if (a.clearT > f.latest + BIN_MIN) out.late += 1;
      else out.hits += 1;
    }
  }
  return out;
}

/** The forecast for the open Warning in the world, or null. */
export function warningForecast(w: World): ClearForecast | null {
  const a = w.openAlert('radiation');
  if (!a || a.level !== 'warning') return null;
  return forecastClear(eventSeries(w.history, a.openedAt), REPLAY_ANALOGS);
}
