import rules from '../data/rules.json';
import mission from '../data/mission.json';
import { RULES, LINK_LABEL, LINK_DELAY_MIN, PROCEDURE_SH1, VIS_LABEL, VISIBILITY_ORDER, actionSentence, type Alert, type World } from '../engine/world';
import { SENSORS, SHELTER_FACTOR } from '../engine/doseModel';
import { BODY_RULE } from '../engine/bodyRules';
import { cabinAt, cabinFindings, CABIN } from '../engine/cabin';
import { backtest, warningForecast } from '../engine/forecast';
import { dayOf, stamp, hhmm, duration } from '../engine/time';
import { flareRank } from '../engine/donki';
import { fmt } from '../engine/units';
import { resolveSource } from './sources';
import type { Tab } from './context';

/**
 * Onboard assistant. It runs on the crew laptop with no link to Earth.
 *
 * - It reads the world. It never acts: it has no path to `World.apply`.
 * - A question goes to the topic of the nearest example question (TF-IDF, cosine score).
 *   A weak match gets "no answer", not a guess.
 * - Requests for a diagnosis, a treatment, or a change to alerts or rules get a fixed refusal.
 * - Each answer names its sources, and the same state gives the same answer.
 */

export type AnswerKind = 'state' | 'knowledge' | 'refusal' | 'none';

export interface Answer {
  topic: string;
  kind: AnswerKind;
  lines: string[];
  /** Keys for the source panel: rule IDs or source keys. */
  sources: string[];
  go?: { tab: Tab; label: string };
  /** The answer holds an estimate, not a measured value. */
  estimate?: boolean;
}

type Reply = Omit<Answer, 'topic' | 'kind'>;

interface Topic {
  id: string;
  /** The question on the suggestion button. */
  ask: string;
  examples: string[];
  answer: (w: World) => Reply;
  /** 'knowledge' for a fixed fact. Other topics read the state. */
  kind?: AnswerKind;
}

const TH = rules.thresholds;
const TM = rules.timing;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const dot = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const shown = (w: World) => w.activeAlerts.filter((a) => !a.suppressed);
const shelterMin = (w: World) => (w.inShelter ? w.t - w.shelterIntervals[w.shelterIntervals.length - 1].start : 0);

/** The brief covers this many minutes before now. */
export const BRIEF_MIN = 12 * 60;
/** The brief lists at most this many entries. The rest are on the Log. */
const BRIEF_ITEMS = 6;

let testCache: ReturnType<typeof backtest> | null = null;
/** Leave-one-out result of the forecast on the 6 measured events. Computed once, on first use. */
export function forecastTest() {
  testCache ??= backtest();
  return testCache;
}

function knowledge(key: string): Reply {
  const v = resolveSource(key)[0];
  return { lines: [[v.title, v.value].filter(Boolean).join(': '), v.basis, v.formula, v.evidence].filter((x): x is string => !!x).map(dot), sources: [key] };
}

const TOPICS: Topic[] = [
  {
    id: 'now', ask: 'What do I do now?',
    examples: ['what do I do now', 'what should I do', 'what is my action', 'next step', 'what is happening', 'status', 'am I safe', 'what is my radiation risk now', 'is there an alert'],
    answer: (w) => {
      const a = shown(w)[0];
      if (!a) {
        return {
          lines: [w.inShelter ? 'The Warning is clear. You can leave the shelter.' : 'Dose rate normal. No action.',
            `The cabin mean is ${fmt(w.current.mean / w.B)} × the baseline B. The rules check all ${SENSORS.length} sensors each minute.`],
          sources: ['B'],
        };
      }
      return {
        lines: [`${cap(a.level)} ${a.id}: ${actionSentence(a, w)}`, `Reason: ${dot(a.reason)}`, `Rule ${a.ruleId}: ${RULES[a.ruleId].action}`],
        sources: [a.ruleId],
        go: { tab: 'mission', label: 'Open the alert panel' },
      };
    },
  },
  {
    id: 'clear', ask: 'When can I leave the shelter?',
    examples: ['when can I leave the shelter', 'when does the warning clear', 'how long will this last', 'when will it end', 'how long do I stay in the shelter', 'when is it over', 'time to clear', 'forecast', 'when does the event end'],
    answer: (w) => {
      const a = w.openAlert('radiation');
      if (!a || a.level !== 'warning') {
        return { lines: ['No Warning is open.', a ? `${cap(a.level)} ${a.id}: ${actionSentence(a, w)}` : w.inShelter ? 'You can leave the shelter.' : 'You do not need the shelter now.'], sources: ['R-W1'] };
      }
      const rule = `The Warning clears when all sensors stay below ${TH.cautionMultiple.label} (${fmt(TH.cautionMultiple.x * w.B)} mSv/h) for ${TM.warningClearMin} min.`;
      const p = w.warningClearProgress()!;
      if (p.have > 0) {
        return { lines: [rule, `All sensors are below the line for ${duration(p.have)}. If they stay low, the Warning clears at ${hhmm(w.t + p.need - p.have)}.`], sources: ['R-W1'] };
      }
      const f = warningForecast(w);
      if (!f) return { lines: [rule, 'No estimate yet. The dose rate is still near its peak, and it can still rise.'], sources: ['R-W1'] };
      const t = forecastTest();
      return {
        lines: [rule,
          `Estimate: the Warning clears between ${stamp(f.earliest)} and ${stamp(f.latest)}. The estimate fits the decay of the last 8 h of this event. The range comes from ${f.analogs.length} other measured RAD events.`,
          `Test on the 6 measured events (leave one out): the real clear time was in the range at ${Math.round((t.hits / t.checks) * 100)}% of ${t.checks} checks. ${t.late} misses cleared later than the range and ${t.early} earlier. A new solar event can also raise the rate again.`],
        sources: ['R-W1', 'speModel'], estimate: true,
      };
    },
  },
  {
    id: 'brief', ask: 'What happened in the last 12 h?',
    examples: ['what happened while I slept', 'what happened overnight', 'what happened today', 'catch me up', 'brief me', 'what changed', 'recap', 'any news', 'shift handover', 'what happened while I was away', 'what did I miss overnight'],
    answer: (w) => {
      const from = w.t - BRIEF_MIN;
      const entries = w.log.filter((e) => e.t > from && (e.kind === 'alert' || e.kind === 'clear' || e.kind === 'advisory'));
      const solar = w.donkiSeen().filter((r) => r.t > from);
      const flare = solar.filter((r) => r.kind === 'FLR').sort((x, y) => flareRank(y.classType!) - flareRank(x.classType!))[0];
      const cme = solar.filter((r) => r.kind === 'CME').sort((x, y) => (y.speed ?? 0) - (x.speed ?? 0))[0];
      const sep = solar.find((r) => r.kind === 'SEP');
      const dose = w.history.filter((h) => h.t > from).reduce((sum, h) => sum + h.personal / 60, 0);
      const shelter = w.shelterIntervals.reduce((sum, iv) => sum + Math.max(0, Math.min(iv.end ?? w.t, w.t) - Math.max(iv.start, from)), 0);
      const a = shown(w)[0];
      return {
        lines: [
          `Your dose in the last 12 h: ${fmt(dose)} mSv.${shelter ? ` Time in the shelter: ${duration(shelter)}.` : ''}`,
          ...(entries.length ? entries.slice(-BRIEF_ITEMS).map((e) => `${stamp(e.t)}: ${e.kind === 'alert' ? `${e.alertId} ${e.text}` : e.text}`) : ['No alerts or findings in the last 12 h.']),
          ...(entries.length > BRIEF_ITEMS ? [`${entries.length - BRIEF_ITEMS} earlier entries are on the Log.`] : []),
          ...(solar.length ? [[`Solar records: ${solar.length}.`,
            flare && `Strongest flare: ${flare.classType}.`,
            cme && `Fastest CME: ${cme.speed!.toLocaleString('en-US')} km/s.`,
            sep && `Proton event (SEP) from ${stamp(sep.t)}.`].filter(Boolean).join(' ')] : []),
          a ? `Now: ${cap(a.level)} ${a.id}. ${actionSentence(a, w)}` : 'Now: no alert is open.',
        ],
        sources: [...new Set(entries.flatMap((e) => (e.ruleId ? [e.ruleId] : [])))].concat(solar.length ? ['donki'] : []),
        go: { tab: 'log', label: 'Open the log' },
      };
    },
  },
  {
    id: 'leave', ask: 'Can I leave the shelter early?',
    examples: ['can I leave the shelter early', 'is it safe to go out', 'can I leave now', 'go back to work', 'exit the shelter', 'what if I leave the shelter', 'can I go back to my task'],
    answer: (w) => {
      const a = w.openAlert('radiation');
      if (!a) return { lines: ['Yes. No Warning or Caution is open.'], sources: ['R-W1'] };
      if (a.level !== 'warning') return { lines: [`${cap(a.level)} ${a.id}: ${actionSentence(a, w)}`, RULES[a.ruleId].action], sources: [a.ruleId] };
      const lines = [`No. Stay in the shelter while the Warning is open (rule R-W1). The cabin rate is ${fmt(w.current.mean / w.B)} × B now.`];
      const f = warningForecast(w);
      if (f) {
        const out = (x: number) => x * w.B * mission.dosimeter.cabinFactor;
        lines.push(`If you leave now, the rest of the event adds about ${fmt(out(f.excessLo))} to ${fmt(out(f.excessHi))} mSv. In the shelter, it adds about ${fmt(out(f.excessLo) * SHELTER_FACTOR)} to ${fmt(out(f.excessHi) * SHELTER_FACTOR)} mSv.`);
      }
      return { lines, sources: ['R-W1', 'shelterFactor'], estimate: !!f };
    },
  },
  {
    id: 'dose', ask: 'How much dose did I get?',
    examples: ['how much dose did I get', 'my dose', 'my exposure', 'how much radiation did I get', 'dose budget', 'career limit', 'how close am I to the limit', 'event dose', 'mission dose'],
    answer: (w) => {
      const ev = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && a.eventDoseMSv > 0);
      const cross = w.crossingDay();
      return {
        lines: [
          `Career dose: ${fmt(w.careerDoseMSv)} mSv. The NASA career limit is ${rules.limits.career.mSv} mSv.`,
          `This mission: ${fmt(w.missionDoseMSv)} mSv.`,
          ...(ev ? [`Event ${ev.id}: ${fmt(ev.eventDoseMSv)} mSv${ev.closedAt === undefined ? ' so far' : ''}. The shelter saved about ${fmt(ev.savedMSv)} mSv (estimate).`] : []),
          `At mission end: about ${fmt(w.projectedEndMSv())} mSv.${cross ? ` You pass the limit on day ${cross}. This is a waiver case, planned before flight.` : ''}`,
        ],
        sources: ['career', 'priorCareer', 'shelterFactor'],
        go: { tab: 'radiation', label: 'Open the dose budget' },
      };
    },
  },
  {
    id: 'sensor', ask: 'Can I trust the sensors?',
    examples: ['can I trust the sensors', 'is this a false alarm', 'is the sensor right', 'data quality', 'sensor fault', 'do the sensors agree', 'verify', 'dosimeter reading', 'broken sensor'],
    answer: (w) => {
      const q = w.current.quality;
      const bad = SENSORS.flatMap((s, i) => (q[i] === 'good' ? [] : [`${s.id} (${q[i]})`]));
      const v = w.openAlert('sensor');
      return {
        lines: [
          `${q.filter((x) => x === 'good').length} of ${q.length} sensors give good data now.${bad.length ? ` Not good: ${bad.join(', ')}.` : ''}`,
          ...(v ? [`Verify ${v.id}: ${dot(v.reason)} ${RULES['R-V1'].action}`] : []),
          'A Warning needs 2 or more sensors that agree. One bad sensor cannot start a Warning.',
        ],
        sources: ['R-V1', 'R-W1'],
      };
    },
  },
  {
    id: 'why', ask: 'Why did this alert start?',
    examples: ['why did this alert start', 'why the warning', 'why this alert', 'which rule', 'what is the reason', 'what triggered the alarm', 'explain the alert', 'why caution'],
    answer: (w) => {
      const a: Alert | undefined = shown(w)[0];
      if (!a) return { lines: [`No alert is open. The rules check all ${SENSORS.length} sensors each minute.`], sources: ['R-W1'] };
      const r = RULES[a.ruleId];
      return {
        lines: [`${a.id} is a ${cap(a.level)} from rule ${r.id}, "${r.title}".`, `Now: ${dot(a.reason)}`, `The rule starts on: ${r.triggers.join(' Or: ')}`, r.basis],
        sources: [a.ruleId],
      };
    },
  },
  {
    id: 'solar', ask: 'What did the Sun do?',
    examples: ['what did the sun do', 'solar flare', 'when was the last flare', 'cme', 'donki', 'solar event', 'space weather', 'sun activity', 'sep event', 'proton event'],
    answer: (w) => {
      const seen = w.donkiSeen().filter((r) => w.t - r.t < 3 * 1440).slice(-3);
      return {
        lines: [
          ...(seen.length ? seen.map((r) => `${stamp(r.t)}: ${r.summary}.`) : ['No solar record in the last 3 days.']),
          'Solar records come from near Earth. They can give an Advisory or a Caution. Only the onboard sensors can give a Warning.',
        ],
        sources: ['donki', 'R-C1'],
      };
    },
  },
  {
    id: 'privacy', ask: 'Who can see my check-ins?',
    examples: ['who can see my check-ins', 'is my data private', 'who sees my health data', 'share with the ground', 'privacy', 'can the flight surgeon see this', 'who reads my log'],
    answer: (w) => {
      const c = w.log.filter((e) => e.kind === 'checkin');
      const by = VISIBILITY_ORDER.map((v) => [v, c.filter((e) => w.visibilityOf(e) === v).length] as const).filter(([, n]) => n > 0);
      return {
        lines: [
          c.length ? `Your check-ins: ${by.map(([v, n]) => `${n} ${VIS_LABEL[v]}`).join(', ')}.` : 'No check-ins yet.',
          'Private entries stay on board. The ground summary holds only the entries that you share with Ground. You can change who sees an entry on the Log view.',
        ],
        sources: [],
        go: { tab: 'log', label: 'Open the log' },
      };
    },
  },
  {
    id: 'body', ask: 'How is my body?',
    examples: ['how is my body', 'body findings', 'my symptoms', 'my sleep', 'heart rate', 'my mood', 'vision change', 'bone loss', 'exercise', 'how am I doing', 'health', 'I feel tired', 'fatigue'],
    answer: (w) => {
      const f = w.bodyFindings();
      return {
        lines: [
          ...(f.length ? f.map((x) => `${cap(x.level)} ${x.ruleId}: ${x.title}. ${x.why}`) : ['No body rule is active.']),
          'Body rules give an Advisory or a Caution only. I do not diagnose. Talk to the CMO about symptoms.',
        ],
        sources: f.map((x) => x.ruleId),
        go: { tab: 'body', label: 'Open Body' },
      };
    },
  },
  {
    id: 'cabin', ask: 'Is the cabin air OK?',
    examples: ['is the cabin air ok', 'co2', 'carbon dioxide', 'air quality', 'cabin temperature', 'humidity', 'oxygen', 'cabin pressure', 'stuffy air'],
    answer: (w) => {
      const r = cabinAt(w.t, shelterMin(w));
      const f = cabinFindings(r);
      return {
        lines: [
          `CO2 ${fmt(r.co2mmHg)} mmHg (limit ${CABIN.limits.co2HourMmHg.max}). Temperature ${fmt(r.tempC)} °C. Humidity ${fmt(r.rhPct)}%. ppO2 ${fmt(r.ppO2mmHg)} mmHg.`,
          ...(f.length ? f.map((x) => `${cap(x.level)}: ${x.title}. ${x.text}`) : ['All values are inside the NASA-STD-3001 limits.']),
          'The cabin values are simulated.',
        ],
        sources: ['cabinCo2', 'cabinTemp'],
        go: { tab: 'air', label: 'Open Cabin air' },
      };
    },
  },
  {
    id: 'missing', ask: 'What is still open?',
    examples: ['what is still open', 'what did I forget', 'open items', 'what do I still need to do', 'anything left to do', 'checklist', 'what is missing'],
    answer: (w) => {
      const items: string[] = [];
      for (const a of shown(w)) if (!a.acked && a.level !== 'advisory') items.push(`${cap(a.level)} ${a.id} is not acknowledged.`);
      if (w.procedure) {
        const open = PROCEDURE_SH1.steps.filter((s) => !w.procedure!.confirmed[s.n]);
        if (open.length) items.push(`${PROCEDURE_SH1.id} step ${open[0].n} is next: ${open[0].text}`);
      }
      if (!w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === dayOf(w.t))) items.push(`No health check today (day ${dayOf(w.t)}).`);
      w.current.cabin.forEach((v, i) => { if (v === null) items.push(`${SENSORS[i].id} sends no data.`); });
      if (w.inhibited.size) items.push(`Inhibited rules: ${[...w.inhibited].join(', ')}.`);
      if (LINK_DELAY_MIN[w.link] === null) items.push('The link to Earth is down. The ground summary waits for the link.');
      return { lines: items.length ? items : ['Nothing is open.'], sources: [] };
    },
  },
  {
    id: 'ground', ask: 'When does the ground know?',
    examples: ['when does the ground know', 'mission control', 'flight surgeon', 'link to earth', 'communication delay', 'contact earth', 'summary to the ground', 'call houston'],
    answer: (w) => {
      const d = LINK_DELAY_MIN[w.link];
      const last = [...w.log].reverse().find((e) => e.kind === 'summary');
      return {
        lines: [
          `Link: ${LINK_LABEL[w.link]}.`,
          d === null ? 'There is no link now. The app builds a summary when the link returns.' : d === 0 ? 'Messages arrive at once.' : `A message takes ${d} min to arrive, and an answer takes ${d * 2} min or more. Do not wait for the ground before you act.`,
          last ? `Last ground summary: ${stamp(last.t)}, ${last.summary!.lines.length} entries.` : 'No ground summary yet.',
        ],
        sources: [],
        go: { tab: 'ground', label: 'Open Ground link' },
      };
    },
  },
  { id: 'baseline', ask: 'What is the baseline B?', examples: ['what is the baseline', 'what is b', 'background dose rate', 'cruise baseline', 'normal dose rate', 'galactic cosmic rays'], answer: () => knowledge('B'), kind: 'knowledge' },
  { id: 'shelter', ask: 'How much does the shelter protect me?', examples: ['how much does the shelter protect me', 'shelter factor', 'shielding', 'how good is the shelter', 'water wall'], answer: () => knowledge('shelterFactor'), kind: 'knowledge' },
  { id: 'units', ask: 'What is the difference between mGy and mSv?', examples: ['mgy and msv', 'unit conversion', 'gray and sievert', 'what are the units', 'absorbed dose'], answer: () => knowledge('units'), kind: 'knowledge' },
  { id: 'data', ask: 'Is this real data?', examples: ['is this real data', 'where does the data come from', 'rad instrument', 'curiosity', 'measured or simulated', 'mars science laboratory'], answer: () => knowledge('speModel'), kind: 'knowledge' },
];

// ---------------------------------------------------------------- matching

const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'am', 'was', 'be', 'i', 'me', 'my', 'it', 'this', 'that', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'do', 'did', 'can', 'will', 'there', 'any', 'you', 'what', 'how', 'with', 'at', 'get', 'got', 'should', 'about', 'too', 'right', 'until', 'over', 'have', 'has', 'been', 'would', 'could', 'if', 'so', 'by', 'than', 'tell', 'please']);

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
    .map((x) => (x.length > 4 ? x.replace(/(ing|ed|es|s)$/, '') : x))
    .filter((x) => x && !STOP.has(x));
}

type Vec = Map<string, number>;
/** One document per example question. IDF counts topics, so a word that many topics share weighs less. */
const EXAMPLES = TOPICS.flatMap((t) => [t.ask, ...t.examples].map((e) => ({ topic: t.id, words: tokens(e) })));
const IDF = (() => {
  const df = new Map<string, number>();
  for (const t of TOPICS) for (const w of new Set(tokens([t.ask, ...t.examples].join(' ')))) df.set(w, (df.get(w) ?? 0) + 1);
  return new Map([...df].map(([w, n]) => [w, Math.log(1 + TOPICS.length / n)]));
})();

/** A word that no example uses weighs as much as the rarest known word, so it lowers the score. */
const UNKNOWN = Math.log(1 + TOPICS.length);

function vec(ts: string[]): Vec {
  const v: Vec = new Map();
  for (const w of ts) v.set(w, (v.get(w) ?? 0) + (IDF.get(w) ?? UNKNOWN));
  const n = Math.hypot(...v.values()) || 1;
  for (const [w, x] of v) v.set(w, x / n);
  return v;
}
const VECS = EXAMPLES.map((e) => vec(e.words));

/** Below this cosine score, the assistant says it has no answer. */
export const MIN_SCORE = 0.4;

/** The topic of the nearest example question, by cosine score of TF-IDF vectors. */
export function match(q: string): { topic: string; score: number } {
  const v = vec(tokens(q));
  let best = { topic: 'none', score: 0 };
  VECS.forEach((e, i) => {
    let s = 0;
    for (const [w, x] of v) s += x * (e.get(w) ?? 0);
    if (s > best.score) best = { topic: EXAMPLES[i].topic, score: s };
  });
  return best;
}

// ---------------------------------------------------------------- guards

const MEDICAL = /\b(diagnos\w*|treat\w*|medicat\w*|medicine|drugs?|pills?|tablets?|prescri\w*|cancer|sick|ill|disease|infect\w*|antibiotic\w*)\b/i;
/** An order to the assistant: "(can you) <verb> ... <alert or rule>". */
const CONTROL = /^(please |can you |could you |will you )?(ack(nowledge)?|inhibit|suppress|silence|mute|disable|enable|turn off|switch off|stop|change|set|raise|lower|edit|clear)\b.*\b(alarms?|alerts?|warnings?|cautions?|rules?|thresholds?|limits?)\b/i;
const RULE_ID = /\b([RB]-[A-Z]+\d)\b/i;

export function ask(question: string, w: World): Answer {
  const q = question.trim();
  if (CONTROL.test(q)) {
    return { topic: 'control', kind: 'refusal', lines: ['I cannot change alerts or rules. I only read the data.', 'Use the alert controls on the Mission replay view. Each control writes to the log.'], sources: [], go: { tab: 'mission', label: 'Open the alert panel' } };
  }
  if (MEDICAL.test(q)) {
    return { topic: 'medical', kind: 'refusal', lines: ['I do not diagnose or recommend treatment. Ask the CMO, who uses the medical kit procedures.', 'I can show your body findings and their sources.'], sources: [], go: { tab: 'body', label: 'Open Body' } };
  }
  const id = q.match(RULE_ID)?.[1].toUpperCase();
  if (id && (RULES[id] || BODY_RULE[id])) return { topic: id, kind: 'knowledge', ...knowledge(id) };
  const m = match(q);
  const t = TOPICS.find((x) => x.id === m.topic);
  if (!t || m.score < MIN_SCORE) {
    return { topic: 'none', kind: 'none', lines: ['I have no onboard answer for that.', 'I answer questions on radiation, the shelter, your dose, the sensors, cabin air, body findings, privacy, and the link to Earth.'], sources: [] };
  }
  return { topic: t.id, kind: t.kind ?? 'state', ...t.answer(w) };
}

/** Questions that fit the state now, for the suggestion buttons. */
export function suggestions(w: World): string[] {
  const a = shown(w)[0];
  const ids = !a ? ['now', 'brief', 'dose', 'missing']
    : a.level === 'warning' ? ['clear', 'leave', 'why', 'sensor']
    : a.level === 'caution' ? ['now', 'brief', 'solar', 'why']
    : a.level === 'verify' ? ['sensor', 'now', 'why', 'missing']
    : ['now', 'brief', 'solar', 'dose'];
  return ids.map((id) => TOPICS.find((t) => t.id === id)!.ask);
}

export const ASSISTANT_INFO = {
  topics: TOPICS.length,
  examples: TOPICS.reduce((n, t) => n + t.examples.length, 0),
};
