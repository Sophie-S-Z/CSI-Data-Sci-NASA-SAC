import bodyRules from '../data/body-rules.json';
import type { CheckIn } from './world';
import { dayOf } from './time';
import { fmt } from './units';

/**
 * Body-system rules (scope change 3B). Pure functions over check-ins and
 * simulated vitals. They give Advisory or Caution only, never Warning, and
 * they stay apart from the radiation alarm count (M-3).
 */

export type BodyLevel = 'advisory' | 'caution';
export type BodySystem = 'radiation' | 'vision' | 'air' | 'sleep' | 'mood' | 'heart' | 'bone' | 'blood';

export interface BodyRule {
  id: string;
  system: BodySystem;
  title: string;
  level: BodyLevel;
  text: string;
  params: Record<string, number>;
  /** Values a crew member can make stricter: [team value, strictest, step, unit, label]. */
  personal?: Record<string, [number, number, number, string, string]>;
  source: string;
}

export type Params = Record<string, Record<string, number>>;

export const BODY_RULES = bodyRules.rules as BodyRule[];
export const BODY_RULE = Object.fromEntries(BODY_RULES.map((r) => [r.id, r])) as Record<string, BodyRule>;

/** The range of a personal limit, or null if the crew cannot change the value. */
export function limitRange(ruleId: string, param: string) {
  const p = BODY_RULE[ruleId]?.personal?.[param];
  if (!p) return null;
  const [team, strict, step, unit, label] = p;
  return { team, strict, step, unit, label, min: Math.min(team, strict), max: Math.max(team, strict) };
}

/** Rule values with the crew member's personal limits on top. */
export const paramsOf = (id: string, own?: Params) => ({ ...BODY_RULE[id].params, ...own?.[id] });

/** Rule text with its values filled in, for example "Sleep under 6 h". */
export const ruleText = (id: string, own?: Params) => {
  const v = paramsOf(id, own);
  return BODY_RULE[id].text.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]));
};

export interface BodyFinding {
  ruleId: string;
  system: BodySystem;
  level: BodyLevel;
  title: string;
  text: string;
  /** What the rule saw, in plain words. */
  why: string;
  source: string;
}

export interface DatedCheckIn { t: number; c: CheckIn }

export interface BodyInput {
  /** Check-ins, oldest first. The last one is the newest. */
  checkins: DatedCheckIn[];
  /** The last radiation event that reached Caution or Warning. */
  lastEvent: { t: number; doseMSv: number } | null;
  /** Simulated daily resting heart rate, oldest first. The last value is today. */
  hr: number[];
  /** Simulated daily exercise minutes, oldest first. The last value is today. */
  exercise: number[];
  /** Personal limits of the crew member. */
  params?: Params;
}

const GI = ['Nausea', 'Vomiting', 'Diarrhea'];
const VISION = ['Blurred near vision', 'Eye pressure'];
const CO2_SIGNS = ['Stuffy head', 'Short of breath', 'Dizzy'];
const BLOOD = ['Bruising', 'Bleeding gums'];

const hasAny = (c: CheckIn, list: string[]) => c.symptoms.some((s) => list.includes(s));

function finding(id: string, why: string, own?: Params): BodyFinding {
  const r = BODY_RULE[id];
  return { ruleId: r.id, system: r.system, level: r.level, title: r.title, text: ruleText(id, own), why, source: r.source };
}

/** Deterministic noise in [-0.5, 0.5]. */
export const jitter = (i: number, k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;

/** Simulated vitals for one mission day. A Warning adds a stress response. */
export function simVitals(day: number, stressed: boolean): { hr: number; exercise: number } {
  return {
    hr: Math.round(58 + jitter(day, 3) * 4 + (stressed ? 9 : 0)),
    exercise: Math.round(85 + jitter(day, 4) * 12 - (stressed ? 40 : 0)),
  };
}

export function evaluateBody(input: BodyInput): BodyFinding[] {
  const out: BodyFinding[] = [];
  const { checkins, lastEvent, hr, exercise, params: own } = input;
  const prm = (id: string) => paramsOf(id, own);
  const add = (id: string, why: string) => out.push(finding(id, why, own));
  const last = checkins[checkins.length - 1];

  if (last) {
    const c = last.c;
    const p = prm('B-RAD1');
    if (hasAny(c, GI) && lastEvent && lastEvent.doseMSv > p.minEventMSv && last.t - lastEvent.t <= p.windowH * 60 && last.t >= lastEvent.t) {
      const h = Math.round((last.t - lastEvent.t) / 60);
      add('B-RAD1', `${c.symptoms.filter((s) => GI.includes(s)).join(', ')} ${h} h after an event dose of ${fmt(lastEvent.doseMSv)} mSv.`);
    }

    if (hasAny(c, VISION)) {
      const days = prm('B-V2').days;
      const today = dayOf(last.t);
      const streak = Array.from({ length: days }, (_, k) => today - k).every((d) =>
        checkins.some((x) => dayOf(x.t) === d && hasAny(x.c, VISION)),
      );
      if (streak) add('B-V2', `Vision symptoms on days ${today - days + 1} to ${today}.`);
      else add('B-V1', `Logged: ${c.symptoms.filter((s) => VISION.includes(s)).join(', ')}.`);
    }

    if (c.symptoms.includes('Headache') && hasAny(c, CO2_SIGNS)) {
      add('B-A1', `Headache with ${c.symptoms.filter((s) => CO2_SIGNS.includes(s)).join(', ').toLowerCase()}.`);
    }

    if (hasAny(c, BLOOD)) add('B-B2', `Logged: ${c.symptoms.filter((s) => BLOOD.includes(s)).join(', ')}.`);
  }

  {
    const { underH, nights } = prm('B-S1');
    const recent = checkins.slice(-nights);
    if (recent.length === nights && recent.every((x) => x.c.sleepH < underH)) {
      add('B-S1', `Sleep: ${recent.map((x) => `${x.c.sleepH} h`).join(', ')}.`);
    }
  }

  {
    const { atOrBelow, count, of } = prm('B-M1');
    const recent = checkins.slice(-of).filter((x) => x.c.mood !== undefined);
    const low = recent.filter((x) => (x.c.mood ?? 5) <= atOrBelow).length;
    if (low >= count) add('B-M1', `Mood ${atOrBelow} or lower on ${low} of the last ${recent.length} check-ins.`);
  }

  if (hr.length) {
    const { highBpm, lowBpm } = prm('B-H1');
    const now = hr[hr.length - 1];
    if (now > highBpm || now < lowBpm) add('B-H1', `Resting heart rate ${now} bpm.`);
    else if (hr.length > 1) {
      const prior = hr.slice(0, -1);
      const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (now - mean > prm('B-H2').riseBpm) {
        add('B-H2', `Resting heart rate ${now} bpm. The 7-day mean is ${Math.round(mean)} bpm.`);
      }
    }
  }

  if (exercise.length) {
    const { minPerDay, count, of } = prm('B-B1');
    const recent = exercise.slice(-of);
    const lowDays = recent.filter((m) => m < minPerDay).length;
    if (lowDays >= count) add('B-B1', `Exercise under ${minPerDay} min on ${lowDays} of the last ${recent.length} days.`);
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'caution' ? -1 : 1));
}
