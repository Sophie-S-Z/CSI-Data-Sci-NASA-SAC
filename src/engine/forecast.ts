import radEvents from '../data/real/rad-events.json';
import rad from '../data/real/rad-replay.json';
import rules from '../data/rules.json';
import type { Sample, World } from './world';

/**
 * Clear-time forecast for an open Warning. Part of the onboard assistant.
 *
 * Analog method: each measured RAD event shows how long a falling event took to
 * go from a given dose rate down to the clear line. For the rate now, the forecast
 * takes that time from each other event. The range is the shortest and the longest.
 * There is no fit and no tuned curve. The forecast is an estimate only. It never
 * opens, holds, or clears an alert.
 */

export const BIN_MIN: number = radEvents.bin_min;
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
  /** Excess dose still to come at an unshielded point, in baseline-hours (multiply by B for mSv). */
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

export function forecastClear(series: Point[], analogs: Analog[]): ClearForecast | null {
  if (series.length < HOLD_BINS) return null;
  const s = smooth(series);
  const now = s[s.length - 1];
  if (now.r > PAST_PEAK * Math.max(...s.map((p) => p.r))) return null;
  const left: number[] = [];
  const excess: number[] = [];
  const ids: string[] = [];
  for (const a of analogs) {
    const i = a.s.findIndex((p, j) => j >= a.peakIdx && p.r <= now.r);
    if (i < 0) continue;
    left.push(Math.max(0, a.clearT - a.s[i].t));
    excess.push(a.s.filter((p) => p.t >= a.s[i].t && p.t < a.clearT).reduce((sum, p) => sum + Math.max(0, p.r - 1) * BIN_MIN / 60, 0));
    ids.push(a.id);
  }
  if (left.length < 2) return null;
  return {
    earliest: now.t + Math.min(...left), latest: now.t + Math.max(...left),
    excessLo: Math.min(...excess), excessHi: Math.max(...excess), analogs: ids,
  };
}

/** The event series from the world: the highest good sensor, as a ratio to B, every 15 min since `from`. */
export function eventSeries(history: Sample[], from: number): Point[] {
  return history
    .filter((h) => h.t >= from && (h.t - from) % BIN_MIN === 0)
    .map((h) => {
      const good = h.cabin.filter((v, i): v is number => v !== null && h.quality[i] === 'good');
      return { t: h.t, r: (good.length ? Math.max(...good) : h.mean) / h.B };
    });
}

/**
 * Leave-one-out test on the measured events: forecast each event from the others,
 * at every bin from the first 2 × B bin to the clear. A hit is a real clear time inside the
 * range (one bin of slack).
 */
export function backtest(): { checks: number; hits: number; late: number; early: number } {
  const out = { checks: 0, hits: 0, late: 0, early: 0 };
  for (const a of ANALOGS) {
    const start = a.raw.findIndex((p) => p.r >= rules.thresholds.warningMultiple.x);
    const others = ANALOGS.filter((b) => b !== a);
    for (let i = start; a.raw[i].t < a.clearT; i++) {
      const f = forecastClear(a.raw.slice(start, i + 1), others);
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
