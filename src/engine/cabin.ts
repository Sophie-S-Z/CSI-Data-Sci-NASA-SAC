import cabinRules from '../data/cabin-rules.json';
import { fmt } from './units';

/**
 * Cabin air. The limits come from NASA-STD-3001 Vol 2 (OCHMO technical briefs
 * TB-002 ECLSS and TB-004 CO2). The crew values are SIMULATED: no open database
 * gives a crew cabin stream. The model is simple and deterministic, so each replay
 * gives the same numbers:
 * - CO2 follows the crew day (higher in work blocks, lower in sleep) around a
 *   level near the ISS flight-rule average.
 * - In the storm shelter, 4 crew share a small volume, so CO2 and humidity rise
 *   while the scrubber catches up. This is a team model. It shows a real link
 *   between two risks: a long shelter stay raises CO2.
 */

export type CabinLevel = 'nominal' | 'advisory' | 'caution';

export interface CabinReading {
  co2mmHg: number;      // 1-h average ppCO2
  co2Day7: number;      // 7-day average ppCO2
  tempC: number;
  rhPct: number;
  ppO2mmHg: number;
  totalKPa: number;
}

export interface CabinFinding {
  id: string;
  param: keyof CabinReading;
  level: Exclude<CabinLevel, 'nominal'>;
  title: string;
  text: string;
  source: string;
}

export const CABIN = cabinRules;

function noise(t: number, k: number): number {
  let x = (Math.floor(t) * 2654435761 + k * 40503) | 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = x ^ (x >>> 13);
  return ((x >>> 0) / 4294967295 - 0.5) * 2;
}

/** Smooth slow wave so the trend lines look like a cabin, not like white noise. */
function slow(t: number, period: number, k: number): number {
  return Math.sin((t / period) * 2 * Math.PI + k) * 0.6 + Math.sin((t / (period * 0.37)) * 2 * Math.PI + k * 2) * 0.4;
}

function dayCycle(t: number): number {
  const m = ((t % 1440) + 1440) % 1440;
  if (m < 360 || m >= 1290) return -0.25; // sleep
  if (m >= 840 && m < 930) return 0.35; // exercise
  return 0.12;
}

/**
 * Cabin reading at minute t. shelterMin is the time in the shelter so far
 * (0 when the crew is outside).
 */
export function cabinAt(t: number, shelterMin: number): CabinReading {
  const shelterRise = shelterMin > 0 ? 1.15 * (1 - Math.exp(-shelterMin / 180)) : 0;
  const co2 = 2.15 + dayCycle(t) + 0.18 * slow(t, 4 * 1440, 1) + 0.05 * noise(t / 10, 1) + shelterRise;
  let sum = 0;
  for (let d = 0; d < 7; d++) sum += 2.15 + 0.18 * slow(t - d * 1440, 4 * 1440, 1);
  return {
    co2mmHg: Math.max(0.5, co2),
    co2Day7: sum / 7 + 0.02,
    tempC: 22.4 + 0.6 * slow(t, 1440, 2) + 0.1 * noise(t / 10, 2) + (shelterMin > 0 ? 1.2 * (1 - Math.exp(-shelterMin / 120)) : 0),
    rhPct: 44 + 4 * slow(t, 2 * 1440, 3) + 0.5 * noise(t / 10, 3) + (shelterMin > 0 ? 9 * (1 - Math.exp(-shelterMin / 150)) : 0),
    ppO2mmHg: 152 + 1.5 * slow(t, 3 * 1440, 4) + 0.4 * noise(t / 10, 4),
    totalKPa: 101.3 + 0.25 * slow(t, 5 * 1440, 5),
  };
}

const L = CABIN.limits;

export function cabinFindings(r: CabinReading): CabinFinding[] {
  const out: CabinFinding[] = [];
  const f = (id: string, param: keyof CabinReading, level: 'advisory' | 'caution', title: string, text: string, source: string) =>
    out.push({ id, param, level, title, text, source });
  if (r.co2mmHg > L.co2HourMmHg.max) {
    f('C-CO2-1', 'co2mmHg', 'caution', 'CO2 above the 1-hour limit', `ppCO2 ${fmt(r.co2mmHg)} mmHg. The limit is ${L.co2HourMmHg.max} mmHg. Check the scrubber. Move air into the occupied volume. Log any headache.`, L.co2HourMmHg.source);
  } else if (r.co2Day7 > L.co2WeekMmHg.max) {
    f('C-CO2-2', 'co2Day7', 'advisory', 'CO2 weekly average high', `7-day average ${fmt(r.co2Day7)} mmHg. Below ${L.co2WeekMmHg.max} mmHg keeps the headache risk under 1%.`, L.co2WeekMmHg.source);
  }
  if (r.tempC < L.tempHealthC.min || r.tempC > L.tempHealthC.max) {
    f('C-T-1', 'tempC', 'caution', 'Temperature outside the health limit', `${fmt(r.tempC)} °C. Health limit ${L.tempHealthC.min} to ${L.tempHealthC.max} °C.`, L.tempHealthC.source);
  } else if (r.tempC < L.tempComfortC.min || r.tempC > L.tempComfortC.max) {
    f('C-T-2', 'tempC', 'advisory', 'Temperature outside the comfort zone', `${fmt(r.tempC)} °C. Comfort zone ${L.tempComfortC.min} to ${L.tempComfortC.max} °C.`, L.tempComfortC.source);
  }
  if (r.rhPct < L.rhHealthPct.min || r.rhPct > L.rhHealthPct.max) {
    f('C-RH-1', 'rhPct', 'caution', 'Humidity outside the health limit', `${fmt(r.rhPct)}%. Health limit ${L.rhHealthPct.min} to ${L.rhHealthPct.max}%.`, L.rhHealthPct.source);
  } else if (r.rhPct < L.rhComfortPct.min || r.rhPct > L.rhComfortPct.max) {
    f('C-RH-2', 'rhPct', 'advisory', 'Humidity outside the comfort zone', `${fmt(r.rhPct)}%. Comfort zone ${L.rhComfortPct.min} to ${L.rhComfortPct.max}%.`, L.rhComfortPct.source);
  }
  if (r.ppO2mmHg < L.ppO2TargetMmHg.min || r.ppO2mmHg > L.ppO2TargetMmHg.max) {
    f('C-O2-1', 'ppO2mmHg', 'advisory', 'Oxygen outside the normoxia target', `ppO2 ${fmt(r.ppO2mmHg)} mmHg. Target ${L.ppO2TargetMmHg.min} to ${L.ppO2TargetMmHg.max} mmHg.`, L.ppO2TargetMmHg.source);
  }
  return out;
}
