import { LEVEL_RANK, RULES, type CheckIn, type Level, type World } from '../engine/world';
import { MIN_PER_DAY, dayOf, stamp } from '../engine/time';
import { LEVEL_EFFECT } from './health';
import { fmt } from '../engine/units';
import { displayName, type Profile } from './profile';

/** The daily report: what needs attention, and each alert, solar event, check-in, and crew action of one mission day. */
export interface DailyReport {
  app: 'Storm Shelter';
  crew: { name: string; role: string };
  day: number;
  /** Mission time of the last data in the report. */
  through: string;
  createdUtc: string;
  summary: { worstLevel: Level | 'nominal'; alerts: number; doseMSv: number; shelterMin: number; checkins: number; actions: number };
  attention: string[];
  alerts: { id: string; peak: Level; rule: string; opened: string; closed: string | null; eventDoseMSv: number; bodyEffect: string }[];
  solar: { time: string; kind: string; summary: string }[];
  checkins: ({ time: string } & CheckIn)[];
  log: { time: string; kind: string; text: string }[];
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function buildReport(w: World, day: number, p: Profile, now = new Date()): DailyReport {
  const from = day * MIN_PER_DAY;
  const to = Math.min(from + MIN_PER_DAY, w.t + 1);
  const onDay = (t: number) => t >= from && t < to;
  const log = w.log.filter((e) => onDay(e.t) && e.kind !== 'visibility');
  const alerts = w.alertsOnDay(day);
  const worst = alerts.reduce<Level | 'nominal'>((m, a) => (m === 'nominal' || LEVEL_RANK[a.peak] > LEVEL_RANK[m] ? a.peak : m), 'nominal');
  const shelterMin = w.shelterIntervals.reduce((s, iv) => s + Math.max(0, Math.min(iv.end ?? w.t, to) - Math.max(iv.start, from)), 0);
  const doseMSv = w.history.filter((h) => onDay(h.t)).reduce((s, h) => s + h.personal / 60, 0);
  const isToday = day === dayOf(w.t);

  const attention = [
    ...(isToday ? w.activeAlerts.map((a) => `${a.id} is open: ${a.level[0].toUpperCase()}${a.level.slice(1)}${a.acked ? '' : ', not acknowledged'}${a.suppressed ? ', suppressed' : ''}.`) : []),
    ...(isToday ? [...w.inhibited].map((r) => `Rule ${r} is inhibited.`) : []),
    ...(isToday ? w.bodyFindings().filter((f) => f.level === 'caution').map((f) => `${f.title}: ${f.text}`) : []),
    ...(doseMSv > 2 * w.B * 24 ? [`Your dose today is ${fmt(doseMSv)} mSv, more than 2 times a normal day.`] : []),
  ];

  return {
    app: 'Storm Shelter',
    crew: { name: displayName(p), role: p.role },
    day,
    through: stamp(to - 1),
    createdUtc: now.toISOString(),
    summary: { worstLevel: worst, alerts: alerts.length, doseMSv: round(doseMSv), shelterMin, checkins: log.filter((e) => e.kind === 'checkin').length, actions: log.filter((e) => e.kind === 'action').length },
    attention,
    alerts: alerts.map((a) => ({
      id: a.id, peak: a.peak, rule: `${a.ruleId} ${RULES[a.ruleId].title}`, opened: stamp(a.openedAt),
      closed: a.closedAt === undefined ? null : stamp(a.closedAt), eventDoseMSv: round(a.eventDoseMSv), bodyEffect: LEVEL_EFFECT[a.peak].text,
    })),
    solar: w.donkiSeen().filter((r) => onDay(r.t)).map((r) => ({ time: stamp(r.t), kind: r.kind, summary: r.summary })),
    checkins: log.flatMap((e) => (e.checkin ? [{ time: stamp(e.t), ...e.checkin }] : [])),
    log: log.map((e) => ({ time: stamp(e.t), kind: e.kind, text: e.alertId ? `${e.alertId} ${e.text}` : e.text })),
  };
}
