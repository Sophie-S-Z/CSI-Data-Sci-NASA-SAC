import rules from '../data/rules.json';
import { CABIN } from './cabin';

/**
 * Safe and dangerous ranges for each environmental factor, by area.
 * The Cabin air view and the Limits explorer both read these zones, so they agree.
 * Air limits: NASA-STD-3001 Vol 2 (cabin-rules.json), the same in each pressurized area.
 * Radiation: the app rules (rules.json), on the baseline of each area.
 */
export type ZoneLevel = 'nominal' | 'advisory' | 'caution' | 'warning';
export interface Zone { from: number; to: number; level: ZoneLevel }
export type AreaId = 'cabin' | 'shelter' | 'surface';

export const AREAS: { id: AreaId; label: string; about: string }[] = [
  { id: 'cabin', label: 'Ship cabin', about: 'Deep space, on the way to Mars. The cabin walls give little protection from solar protons.' },
  { id: 'shelter', label: 'Storm shelter', about: 'The small, heavily shielded volume of the ship. It cuts the solar event dose, but 4 crew make the air worse.' },
  { id: 'surface', label: 'Mars surface habitat', about: 'Mars and its thin air block part of the radiation, so the normal dose rate is lower than in deep space.' },
];

const TH = rules.thresholds;
const L = CABIN.limits;
const SHELTER = TH.shelterFactor.value;

/** The normal (baseline) dose rate in each area, mSv/h. */
export function baselineOf(area: AreaId): number {
  return area === 'surface' ? rules.baselines.surface.mSvPerHour : rules.baselines.cruise.mSvPerHour;
}

/** Dose rate that you get in the area, for a dose rate on the cabin (or habitat) sensors. */
export function doseInArea(area: AreaId, sensorRate: number): number {
  const B = baselineOf(area);
  return area === 'shelter' ? B + Math.max(0, sensorRate - B) * SHELTER : sensorRate;
}

/** The sensor rate that gives you k × B in the area (the inverse of doseInArea). */
function sensorRateFor(area: AreaId, k: number): number {
  const B = baselineOf(area);
  return area === 'shelter' ? B + ((k - 1) * B) / SHELTER : k * B;
}

const band = (lo: number, hi: number, inner: [number, number] | null, outer: [number, number], innerLevel: ZoneLevel, outerLevel: ZoneLevel): Zone[] => {
  const z: Zone[] = [{ from: lo, to: outer[0], level: outerLevel }];
  if (inner) z.push({ from: outer[0], to: inner[0], level: innerLevel }, { from: inner[0], to: inner[1], level: 'nominal' }, { from: inner[1], to: outer[1], level: innerLevel });
  else z.push({ from: outer[0], to: outer[1], level: 'nominal' });
  z.push({ from: outer[1], to: hi, level: outerLevel });
  return z;
};

export interface Factor {
  key: 'dose' | 'co2mmHg' | 'tempC' | 'rhPct' | 'ppO2mmHg' | 'totalKPa';
  title: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Log scale for the range bar. */
  log?: boolean;
  start: number;
  /** Key for the source panel (sources.ts). */
  src: string;
  zones: (area: AreaId) => Zone[];
}

export const FACTORS: Factor[] = [
  {
    key: 'dose', title: 'Radiation dose rate on the sensors', unit: 'mSv/h', min: 0.01, max: 10, step: 0.01, log: true, start: 0.0767, src: 'B',
    zones: (a) => [
      { from: 0.01, to: sensorRateFor(a, TH.cautionMultiple.x), level: 'nominal' },
      { from: sensorRateFor(a, TH.cautionMultiple.x), to: sensorRateFor(a, TH.warningMultiple.x), level: 'caution' },
      { from: sensorRateFor(a, TH.warningMultiple.x), to: 10, level: 'warning' },
    ],
  },
  {
    key: 'co2mmHg', title: 'CO2, 1-hour average', unit: 'mmHg', min: 0, max: 6, step: 0.1, start: 2.2, src: 'cabinCo2',
    zones: () => [
      { from: 0, to: L.co2WeekMmHg.max, level: 'nominal' },
      { from: L.co2WeekMmHg.max, to: L.co2HourMmHg.max, level: 'advisory' },
      { from: L.co2HourMmHg.max, to: 6, level: 'caution' },
    ],
  },
  {
    key: 'tempC', title: 'Temperature', unit: '°C', min: 14, max: 32, step: 0.1, start: 22.5, src: 'cabinTemp',
    zones: () => band(14, 32, [L.tempComfortC.min, L.tempComfortC.max], [L.tempHealthC.min, L.tempHealthC.max], 'advisory', 'caution'),
  },
  {
    key: 'rhPct', title: 'Relative humidity', unit: '%', min: 10, max: 90, step: 1, start: 45, src: 'cabinRh',
    zones: () => band(10, 90, [L.rhComfortPct.min, L.rhComfortPct.max], [L.rhHealthPct.min, L.rhHealthPct.max], 'advisory', 'caution'),
  },
  {
    key: 'ppO2mmHg', title: 'Oxygen partial pressure', unit: 'mmHg', min: 130, max: 170, step: 1, start: 152, src: 'cabinO2',
    zones: () => band(130, 170, null, [L.ppO2TargetMmHg.min, L.ppO2TargetMmHg.max], 'advisory', 'advisory'),
  },
  {
    key: 'totalKPa', title: 'Total pressure', unit: 'kPa', min: 30, max: 110, step: 0.1, start: 101.3, src: 'cabinP',
    zones: () => band(30, 110, null, [L.totalKPa.min, L.totalKPa.max], 'caution', 'caution'),
  },
];

export const FACTOR = Object.fromEntries(FACTORS.map((f) => [f.key, f])) as Record<Factor['key'], Factor>;

export function levelAt(zones: Zone[], v: number): ZoneLevel {
  const z = zones.find((x) => v >= x.from && v < x.to);
  return z ? z.level : v < zones[0].from ? zones[0].level : zones[zones.length - 1].level;
}

/** Position 0 to 1 of a value on the factor scale. */
export function scalePos(f: Factor, v: number): number {
  const c = Math.min(f.max, Math.max(f.min, v));
  return f.log ? Math.log(c / f.min) / Math.log(f.max / f.min) : (c - f.min) / (f.max - f.min);
}
