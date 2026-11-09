import mission from '../data/mission.json';
import rules from '../data/rules.json';
import rad from '../data/real/rad-replay.json';
import { at, dayOf } from './time';
import { toMGy } from './units';

/**
 * Dosimeter stream (PRD section 09, "The dose model").
 * Two parts: a GCR baseline for the mission phase, and an SPE part from measured
 * MSL RAD data (5 to 11 March 2012, cruise to Mars). Sensor layout and noise are simulated.
 * Sensors report absorbed dose rate in mGy/h.
 */

export type PhaseId = 'cruise' | 'surface';
export type Quality = 'good' | 'poor' | 'missing';

export const SENSORS = mission.sensors;
export const SHELTER_FACTOR: number = rules.thresholds.shelterFactor.value;

export function phaseAt(t: number): { id: PhaseId; label: string } {
  const d = dayOf(t);
  const p = mission.phases.find((ph) => d >= ph.startDay && d < ph.endDay) ?? mission.phases[0];
  return { id: p.id as PhaseId, label: p.label };
}

/** Baseline rate B in mSv/h for the phase at time t. */
export function baselineMSvH(t: number): number {
  return rules.baselines[phaseAt(t).id].mSvPerHour;
}

const REPLAY_START = mission.spe.startDay * 1440;
const BIN = rad.bin_min;
const RATIO = rad.ratio_E as (number | null)[];

/** Measured RAD E ratio (rate / fitted background) at minute t. Linear between 15 min bins. 1 outside the replay. */
export function radRatio(t: number): number {
  const x = (t - REPLAY_START) / BIN;
  if (x < 0 || x >= RATIO.length - 1) return 1;
  const i = Math.floor(x);
  const a = RATIO[i], b = RATIO[i + 1];
  if (a === null && b === null) return 1;
  if (a === null) return b!;
  if (b === null) return a;
  return a + (b - a) * (x - i);
}

/** SPE excess dose rate at an unshielded cabin point, in mSv/h. From measured MSL RAD data (March 2012). */
export function speExcessMSvH(t: number): number {
  return Math.max(0, radRatio(t) - 1) * baselineMSvH(t);
}

/** Small, repeatable noise so each replay gives the same numbers. */
function noise(t: number, k: number): number {
  let x = (t * 374761393 + k * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x = x ^ (x >>> 16);
  return ((x >>> 0) / 4294967295 - 0.5) * 2; // -1 .. 1
}

interface Fault { sensor: string; type: string; t0: number; t1: number; value?: number }
const FAULTS: Fault[] = mission.faults.map((f) => ({
  sensor: f.sensor,
  type: f.type,
  t0: at(f.day, f.start),
  t1: at(f.day, f.start) + f.minutes,
  value: 'valueMSvPerHour' in f ? (f as { valueMSvPerHour: number }).valueMSvPerHour : undefined,
}));

/** Cabin sensor readings at minute t, in mGy/h. null means no data. */
export function cabinReadingsMGy(t: number): (number | null)[] {
  const b = baselineMSvH(t);
  const e = speExcessMSvH(t);
  return SENSORS.map((s, i) => {
    const fault = FAULTS.find((f) => f.sensor === s.id && t >= f.t0 && t < f.t1);
    if (fault?.type === 'missing') return null;
    if (fault?.type === 'spike' && fault.value) return toMGy(fault.value * (1 + 0.02 * noise(t, i)));
    const mSv = (b * (0.92 + 0.08 * s.shielding) + e * s.shielding) * (1 + 0.04 * noise(t, i + 1));
    return toMGy(mSv);
  });
}

/** Personal dosimeter rate in mGy/h. In the shelter, the SPE part drops by the shelter factor. */
export function personalReadingMGy(t: number, inShelter: boolean): number {
  const f = mission.dosimeter.cabinFactor;
  const e = speExcessMSvH(t) * f * (inShelter ? SHELTER_FACTOR : 1);
  return toMGy((baselineMSvH(t) * f + e) * (1 + 0.03 * noise(t, 99)));
}

/** Mark each sensor good, poor, or missing. Poor: far from the median of the others. */
export function qualityOf(values: (number | null)[]): Quality[] {
  return values.map((v, i) => {
    if (v === null) return 'missing';
    const others = values.filter((o, j) => j !== i && o !== null) as number[];
    if (others.length < 2) return 'good';
    const sorted = [...others].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    return v > med * 2.5 || v < med / 2.5 ? 'poor' : 'good';
  });
}

/** GCR-only mission dose (mSv) from launch to minute t. Used for the time before the replay window. */
export function gcrDoseMSv(t0: number, t1: number): number {
  let total = 0;
  for (const ph of mission.phases) {
    const a = Math.max(t0, ph.startDay * 1440);
    const z = Math.min(t1, ph.endDay * 1440);
    if (z > a) total += ((z - a) / 60) * rules.baselines[ph.id as PhaseId].mSvPerHour;
  }
  return total;
}

export const MISSION_END_MIN = mission.phases[mission.phases.length - 1].endDay * 1440;
