import mission from '../data/mission.json';
import rules from '../data/rules.json';
import rad from '../data/real/rad-replay.json';
import { at, dayOf } from './time';
import { SPE_PER_GCR } from './units';

/**
 * Dosimeter stream (PRD section 09, "The dose model").
 * Two parts: a GCR baseline for the mission phase, and an SPE part from measured
 * MSL RAD data (5 to 11 March 2012, cruise to Mars). Each sensor follows one RAD
 * detector (E or B). Sensor layout and noise are simulated. Rates are dose equivalent, mSv/h.
 */

export type PhaseId = 'cruise' | 'surface';
export type Quality = 'good' | 'poor' | 'missing';
export type Detector = 'E' | 'B';

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
const RATIO: Record<Detector, (number | null)[]> = { E: rad.ratio_E, B: rad.ratio_B };
const FILLED = new Set(rad.filled);

/** True when the RAD bin at minute t has no accepted measurement: a gap or an outlier, filled by a straight line. */
export function radFilled(t: number): boolean {
  const x = (t - REPLAY_START) / BIN;
  return x >= 0 && FILLED.has(Math.floor(x));
}

/** Measured RAD ratio (rate / fitted background) of one detector at minute t. Linear between 15 min bins. 1 outside the replay. */
export function radRatio(t: number, det: Detector = 'E'): number {
  const r = RATIO[det];
  const x = (t - REPLAY_START) / BIN;
  if (x < 0 || x >= r.length - 1) return 1;
  const i = Math.floor(x);
  const a = r[i], b = r[i + 1];
  if (a === null && b === null) return 1;
  if (a === null) return b!;
  if (b === null) return a;
  return a + (b - a) * (x - i);
}

/**
 * SPE excess dose rate at an unshielded cabin point, in mSv/h. From measured MSL RAD data (March 2012).
 * The excess absorbed dose is (ratio − 1) × B. Solar protons give less dose equivalent per mGy than GCR.
 */
export function speExcessMSvH(t: number, det: Detector = 'E'): number {
  return Math.max(0, radRatio(t, det) - 1) * baselineMSvH(t) * SPE_PER_GCR;
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

/** Cabin sensor readings at minute t, in mSv/h. null means no data. */
export function cabinReadingsMSv(t: number): (number | null)[] {
  const b = baselineMSvH(t);
  const e = { E: speExcessMSvH(t, 'E'), B: speExcessMSvH(t, 'B') };
  return SENSORS.map((s, i) => {
    const fault = FAULTS.find((f) => f.sensor === s.id && t >= f.t0 && t < f.t1);
    if (fault?.type === 'missing') return null;
    if (fault?.type === 'spike' && fault.value) return fault.value * (1 + 0.02 * noise(t, i));
    return (b * (0.92 + 0.08 * s.shielding) + e[s.detector as Detector] * s.shielding) * (1 + 0.04 * noise(t, i + 1));
  });
}

/** Personal dosimeter rate in mSv/h: the mean of the 2 detectors. In the shelter, the SPE part drops by the shelter factor. */
export function personalReadingMSv(t: number, inShelter: boolean): number {
  const f = mission.dosimeter.cabinFactor;
  const e = ((speExcessMSvH(t, 'E') + speExcessMSvH(t, 'B')) / 2) * f * (inShelter ? SHELTER_FACTOR : 1);
  return (baselineMSvH(t) * f + e) * (1 + 0.03 * noise(t, 99));
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
