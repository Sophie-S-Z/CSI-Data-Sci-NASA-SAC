import replay from '../data/replay-donki.json';
import { at } from './time';

/** DONKI records on mission time. They give Advisory or Caution only. Never Warning (FR-02). */
export interface DonkiRecord {
  id: string;
  kind: 'FLR' | 'CME' | 'SEP';
  t: number;
  tEnd?: number;
  summary: string;
  classType?: string;
  speed?: number;
  linked: string[];
}

export function flareRank(cls: string): number {
  const letter = cls[0]?.toUpperCase();
  const mag = parseFloat(cls.slice(1)) || 1;
  const base: Record<string, number> = { A: 0.001, B: 0.01, C: 0.1, M: 1, X: 10 };
  return (base[letter] ?? 0) * mag;
}

export const REPLAY: DonkiRecord[] = [
  ...replay.flares.map((f) => ({
    id: f.flrID, kind: 'FLR' as const, t: at(f.day, f.hhmm), classType: f.classType, linked: f.linkedEvents,
    summary: `Flare class ${f.classType} at ${f.sourceLocation}`,
  })),
  ...replay.cmes.map((c) => ({
    id: c.activityID, kind: 'CME' as const, t: at(c.day, c.hhmm), speed: c.speed, linked: c.linkedEvents,
    summary: `CME at ${c.speed.toLocaleString('en-US')} km/s`,
  })),
  ...replay.seps.map((s) => ({
    id: s.sepID, kind: 'SEP' as const, t: at(s.day, s.hhmm), tEnd: at(s.endDay, s.endHhmm), linked: s.linkedEvents,
    summary: `Solar energetic particle event (${s.instruments.join(', ')})`,
  })),
].sort((a, b) => a.t - b.t);

export const REPLAY_PROVENANCE = replay.provenance;
