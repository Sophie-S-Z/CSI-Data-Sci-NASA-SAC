import rules from '../data/rules.json';
import mission from '../data/mission.json';
import {
  SENSORS, SHELTER_FACTOR, baselineMSvH, cabinReadingsMSv, personalReadingMSv, qualityOf, gcrDoseMSv, radFilled,
  MISSION_END_MIN, phaseAt, type Quality,
} from './doseModel';
import { REPLAY, flareRank, type DonkiRecord } from './donki';
import { at, dayOf, stamp, duration } from './time';
import { atMultiple, multipleOf, fmt } from './units';
import { evaluateBody, simVitals, limitRange, BODY_RULE, type BodyFinding, type BodyInput } from './bodyRules';

export type Level = 'advisory' | 'verify' | 'caution' | 'warning';
export const LEVEL_RANK: Record<Level, number> = { advisory: 1, verify: 2, caution: 3, warning: 4 };
export type Visibility = 'private' | 'cmo' | 'crew' | 'ground';
export const VISIBILITY_ORDER: Visibility[] = ['private', 'cmo', 'crew', 'ground'];
export type LinkState = 'live' | 'd5' | 'd14' | 'd22' | 'blackout';
export const LINK_DELAY_MIN: Record<LinkState, number | null> = { live: 0, d5: 5, d14: 14, d22: 22, blackout: null };

export interface AlertStep { t: number; level: Level | 'clear'; ruleId: string; reason: string }

export interface Alert {
  id: string;
  kind: 'radiation' | 'sensor';
  level: Level;
  peak: Level;
  ruleId: string;
  reason: string;
  openedAt: number;
  changedAt: number;
  closedAt?: number;
  history: AlertStep[];
  acked: boolean;
  suppressed: boolean;
  quality: Quality;
  measured: string;
  donkiRefs: string[];
  levelWall: number;
  shelterWall?: number;
  eventDoseMSv: number;
  /** Part of eventDoseMSv that the crew member got in the shelter. */
  shelterDoseMSv: number;
  savedMSv: number;
  shelterMin: number;
}

export type LogKind = 'alert' | 'clear' | 'advisory' | 'action' | 'checkin' | 'summary' | 'system' | 'visibility';

export interface CheckIn {
  sleepH: number;
  symptoms: string[];
  note: string;
  /** 1 (poor) to 5 (great). */
  sleepQuality?: number;
  /** 1 (low) to 5 (high). */
  mood?: number;
  /** 0 (none) to 10 (worst). */
  pain?: number;
}

export interface GroundSummary {
  sentT: number;
  arriveT: number | null;
  link: LinkState;
  lines: { t: number; text: string }[];
  withheld: number;
}

export interface LogEntry {
  seq: number;
  t: number;
  wall: number;
  kind: LogKind;
  text: string;
  visibility: Visibility;
  ruleId?: string;
  level?: Level;
  alertId?: string;
  inputs?: Record<string, string | number>;
  checkin?: CheckIn;
  summary?: GroundSummary;
  targetSeq?: number;
}

export type Action =
  | { type: 'ack' | 'suppress' | 'unsuppress'; alertId: string }
  | { type: 'inhibit' | 'enable'; ruleId: string }
  | { type: 'procStart'; alertId: string | null }
  | { type: 'procStep'; step: number; choice?: string }
  | { type: 'shelterExit' }
  | { type: 'checkin'; data: CheckIn; visibility: Visibility }
  | { type: 'visibility'; seq: number; visibility: Visibility }
  | { type: 'link'; link: LinkState }
  | { type: 'summary' }
  | { type: 'limit'; ruleId: string; param: string; value: number };

export interface RecordedAction { t: number; wall: number; action: Action }

export interface Sample {
  t: number;
  cabin: (number | null)[]; // mSv/h
  quality: Quality[];
  personal: number; // mSv/h
  mean: number; // mean of good sensors, mSv/h
  B: number;
  /** The RAD bin has no accepted value, so the replay fills it by a straight line. Alarm timers do not count it. */
  filled: boolean;
}

const TH = rules.thresholds;
const TM = rules.timing;
export const RULES = Object.fromEntries(rules.rules.map((r) => [r.id, r])) as Record<string, (typeof rules.rules)[number]>;

export const PROCEDURE_SH1 = {
  id: 'SH-1',
  title: 'Storm shelter entry',
  note: 'Team procedure for the demo. Not a NASA document.',
  steps: [
    { n: 1, text: 'Stop the task. Safe the payload.' },
    { n: 2, text: 'Tell the crew on the loop.' },
    { n: 3, text: 'Go to the shelter.', marksShelter: true },
    { n: 4, text: 'Put on the radiation vest.', branch: { label: 'Vest not found', goto: 5, logText: 'Vest not found. Crew continued without the vest. Tell the CMO.' } },
    { n: 5, text: 'Start the shelter dose log.' },
    { n: 6, text: 'Stay until the Warning clears (all sensors below 1.5 × B for 1 h).', waitsForClear: true },
  ],
};

export interface ProcedureState { alertId: string | null; startedAt: number; startedWall: number; confirmed: Record<number, { t: number; wall: number; choice?: string }> }

export class World {
  readonly startT: number;
  t: number;
  now: () => number;

  inShelter = false;
  shelterIntervals: { start: number; end?: number }[] = [];
  missionDoseMSv: number;

  history: Sample[] = [];
  alerts: Alert[] = [];
  log: LogEntry[] = [];
  inhibited = new Set<string>();
  procedure: ProcedureState | null = null;
  /** Delayed 5 min matches the one-way light time on the replay days (orbit.ts gives 4.9 min on day 94). */
  link: LinkState = 'd5';
  actions: RecordedAction[] = [];
  consumed = new Set<string>();
  /** Seq of the last summary sent on the link. A summary built offline waits on board. */
  lastSummarySeq = 0;
  /** The crew member's own body-rule limits. They can only be stricter than the team values. */
  personal: Record<string, Record<string, number>> = {};
  /** Real seconds from Warning to "Go to the shelter" confirmed (metric M-1). */
  m1Seconds: number[] = [];

  // rule counters (minutes)
  private warnRun = 0;
  private floorRun = 0;
  private cautRun = 0;
  private belowRun = 0;
  private singleRun = 0;
  private mismatchRun = 0;
  private missingRun: number[] = SENSORS.map(() => 0);
  private verifyFalseRun = 0;
  private seq = 0;
  private alertSeq = 0;
  private verifySensors: string[] = [];

  constructor(startT = at(mission.replay.startDay, '00:00'), now: () => number = () => Date.now()) {
    this.startT = startT;
    this.t = startT;
    this.now = now;
    this.missionDoseMSv = gcrDoseMSv(0, startT);
    this.push({ kind: 'system', text: `Replay starts. ${phaseAt(startT).label}, ${stamp(startT)}. Link: ${LINK_LABEL[this.link].toLowerCase()}.`, visibility: 'ground' });
    const end = this.projectedEndMSv();
    if (end > rules.limits.career.mSv) {
      this.push({
        kind: 'advisory', level: 'advisory',
        text: `Projected over NASA limit: waiver case. Mission-end career dose is about ${fmt(end)} mSv. The ${rules.limits.career.mSv} mSv limit is crossed on day ${this.crossingDay()}.`,
        visibility: 'ground',
      });
    }
    this.sample();
  }

  // ---------- reading the stream ----------

  private sample(): Sample {
    const B = baselineMSvH(this.t);
    const cabin = cabinReadingsMSv(this.t);
    const quality = qualityOf(cabin);
    const good = cabin.filter((v, i) => v !== null && quality[i] === 'good') as number[];
    const mean = good.length ? good.reduce((a, b) => a + b, 0) / good.length : B;
    const personal = personalReadingMSv(this.t, this.inShelter);
    const s = { t: this.t, cabin, quality, personal, mean, B, filled: radFilled(this.t) };
    this.history.push(s);
    return s;
  }

  get current(): Sample {
    return this.history[this.history.length - 1];
  }

  get B(): number {
    return baselineMSvH(this.t);
  }

  /** Minutes in the shelter so far at minute t, or 0 when the crew was outside. */
  shelterMinAt(t = this.t): number {
    const iv = this.shelterIntervals.find((x) => x.start <= t && (x.end ?? Infinity) > t);
    return iv ? t - iv.start : 0;
  }

  /**
   * Progress of the clear rule for an open Warning: minutes that all sensors stayed
   * below the Caution level, and the minutes that the rule needs. Null when no Warning is open.
   */
  warningClearProgress(): { have: number; need: number } | null {
    const a = this.openAlert('radiation');
    if (!a || a.level !== 'warning') return null;
    return { have: Math.min(this.belowRun, TM.warningClearMin), need: TM.warningClearMin };
  }

  /** The 24 h projection: excess rate above B now, times 24 h. A high estimate. */
  projection24h(s = this.current): number {
    return Math.max(0, s.mean - s.B) * 24;
  }

  // ---------- DONKI ----------

  donkiSeen(): DonkiRecord[] {
    return REPLAY.filter((r) => r.t <= this.t);
  }

  private donkiState() {
    const seen = this.donkiSeen().filter((r) => !this.consumed.has(r.id));
    const recent = (win: number) => seen.filter((r) => this.t - r.t < win);
    const adv = recent(TM.donkiLookbackMin).filter(
      (r) => (r.kind === 'FLR' && flareRank(r.classType!) >= flareRank(TH.flareAdvisoryClass.value)) ||
             (r.kind === 'CME' && (r.speed ?? 0) >= TH.cmeAdvisoryKms.value),
    );
    const sep = seen.filter((r) => r.kind === 'SEP' && (r.tEnd ?? Infinity) > this.t);
    const fastPair = recent(TM.cautionFlareWindowMin).filter(
      (r) => r.kind === 'FLR' && flareRank(r.classType!) >= flareRank(TH.flareCautionClass.value) &&
        r.linked.some((id) => {
          const c = seen.find((x) => x.id === id && x.kind === 'CME');
          return c && (c.speed ?? 0) >= TH.cmeCautionKms.value;
        }),
    );
    return { adv, sep, fastPair };
  }

  // ---------- main loop ----------

  step(): void {
    this.t += 1;
    const s = this.sample();
    const { B, cabin, quality } = s;
    this.missionDoseMSv += s.personal / 60;

    const x = (k: number) => atMultiple(k, B);
    const nW = cabin.filter((v) => v !== null && v >= x(TH.warningMultiple.x)).length;
    const nF = cabin.filter((v) => v !== null && v >= x(TH.floorMultiple.x)).length;
    const nC = cabin.filter((v) => v !== null && v >= x(TH.cautionMultiple.x)).length;
    const belowCaution = cabin.every((v) => v === null || v < x(TH.cautionMultiple.x));
    const belowAdvisory = cabin.every((v) => v === null || v < x(TH.advisoryMultiple.x));

    // A filled RAD bin is not a measurement, so the rate timers hold (as in research/realdata/realbench.py).
    const run = (n: number, cond: boolean) => (s.filled ? n : cond ? n + 1 : 0);
    this.warnRun = run(this.warnRun, nW >= 2);
    this.floorRun = run(this.floorRun, nF >= 2);
    this.cautRun = run(this.cautRun, nC >= 2);
    this.belowRun = run(this.belowRun, belowCaution);
    // R-V1: one sensor high, and its value is far from the others (quality "poor").
    const loneHigh = nC === 1 && cabin.some((v, i) => v !== null && v >= x(TH.verifyMultiple.x) && quality[i] === 'poor');
    this.singleRun = loneHigh ? this.singleRun + 1 : 0;
    this.missingRun = cabin.map((v, i) => (v === null ? this.missingRun[i] + 1 : 0));

    const f = mission.dosimeter.cabinFactor;
    const expected = (B * f + Math.max(0, s.mean - B) * f * (this.inShelter ? SHELTER_FACTOR : 1));
    const mismatch = Math.abs(s.personal - expected) / expected > TH.dosimeterMismatchPct.value / 100;
    this.mismatchRun = mismatch ? this.mismatchRun + 1 : 0;

    const proj = this.projection24h(s);
    const d = this.donkiState();
    const on = (id: string) => !this.inhibited.has(id);

    // ----- radiation event: one event, one alert -----
    // A run counts the first minute too, so "for 5 min" needs a run of 6 samples.
    const warnBySensors = this.warnRun > TM.warningSustainMin;
    const warnByProj = proj >= TH.projection24hMSv.value;
    // The floor gives a Warning also when R-W1 is inhibited (beta report S-2).
    const warnByFloor = this.floorRun > TM.floorSustainMin;
    const warnCond = (on('R-W1') && (warnBySensors || warnByProj)) || warnByFloor;
    const cautBySensors = this.cautRun > TM.cautionSustainMin;
    const cautCond = on('R-C1') && (d.sep.length > 0 || d.fastPair.length > 0 || cautBySensors);
    const advCond = on('R-A1') && d.adv.length > 0 && belowAdvisory;

    const open = this.openAlert('radiation');
    let target: { level: Level; ruleId: string; reason: string } | null = null;
    if (warnCond) {
      target = {
        level: 'warning', ruleId: 'R-W1',
        reason: warnBySensors && on('R-W1')
          ? `≥${fmt(x(TH.warningMultiple.x))} mSv/h on ${nW} of ${SENSORS.length} sensors for ${TM.warningSustainMin} min`
          : warnByProj && on('R-W1')
            ? `Projected extra unsheltered dose ${fmt(proj)} mSv in 24 h`
            : `≥${fmt(x(TH.floorMultiple.x))} mSv/h on ${nF} sensors for ${TM.floorSustainMin} min (floor, it cannot be inhibited)`,
      };
    } else if (open?.level === 'warning' && this.belowRun < TM.warningClearMin) {
      target = { level: 'warning', ruleId: 'R-W1', reason: `Warning holds until all sensors stay below ${TH.cautionMultiple.label} for ${TM.warningClearMin} min` };
    } else if (cautCond) {
      const why = d.sep.length
        ? `DONKI SEP record ${d.sep[0].id}`
        : d.fastPair.length
          ? `DONKI flare ${d.fastPair[0].classType} with a linked CME at ≥${TH.cmeCautionKms.value.toLocaleString('en-US')} km/s`
          : `≥${fmt(x(TH.cautionMultiple.x))} mSv/h on ${nC} sensors for ${TM.cautionSustainMin} min`;
      target = { level: 'caution', ruleId: 'R-C1', reason: why };
    } else if (open && LEVEL_RANK[open.level] >= 3 && this.belowRun < TM.cautionClearMin) {
      target = { level: 'caution', ruleId: 'R-C1', reason: `Caution holds until sensors stay below ${TH.cautionMultiple.label} for ${TM.cautionClearMin} min` };
    } else if (advCond) {
      const r = d.adv[d.adv.length - 1];
      target = { level: 'advisory', ruleId: 'R-A1', reason: `DONKI ${r.kind} ${r.kind === 'FLR' ? r.classType : `${r.speed} km/s`}, dose rate normal` };
    }

    // After an event reaches Caution, it does not drop back to Advisory. It clears.
    if (target && open && target.level === 'advisory' && LEVEL_RANK[open.peak] >= LEVEL_RANK.caution) target = null;

    if (target && !open) this.openNew('radiation', target, s);
    else if (target && open) this.updateLevel(open, target, s);
    else if (!target && open) this.close(open);

    const ev = this.openAlert('radiation');
    if (ev) {
      for (const r of this.donkiSeen()) if (this.t - r.t < TM.donkiLookbackMin && !ev.donkiRefs.includes(r.id) && !this.consumed.has(r.id)) ev.donkiRefs.push(r.id);
      const excess = Math.max(0, s.personal - B);
      ev.eventDoseMSv += excess / 60;
      if (this.inShelter) {
        ev.shelterMin += 1;
        ev.shelterDoseMSv += excess / 60;
        // Estimate: what the same minute gives outside the shelter, minus what it gave inside.
        ev.savedMSv += (excess / SHELTER_FACTOR - excess) / 60;
      }
      ev.measured = `${fmt(s.mean)} mSv/h cabin mean, ${fmt(multipleOf(s.mean, B))} × B`;
      ev.quality = worstQuality(quality);
    }

    // ----- sensor check (Verify) -----
    const missingIdx = this.missingRun.findIndex((m) => m > TM.missingDataMin);
    const singleIdx = cabin.findIndex((v, i) => v !== null && v >= x(TH.verifyMultiple.x) && quality[i] === 'poor');
    const vReason = this.singleRun >= TM.verifySingleSensorMin && singleIdx >= 0
      ? `${SENSORS[singleIdx].id} reads ${fmt(cabin[singleIdx]!)} mSv/h. The other sensors do not agree.`
      : missingIdx >= 0
        ? `${SENSORS[missingIdx].id} sends no data for ${this.missingRun[missingIdx]} min.`
        : this.mismatchRun > TM.verifyMismatchMin
          ? `Personal dosimeter and cabin mean differ by more than ${TH.dosimeterMismatchPct.value}% for ${this.mismatchRun} min.`
          : null;
    const vOpen = this.openAlert('sensor');
    if (vReason && on('R-V1')) {
      this.verifyFalseRun = 0;
      const sid = singleIdx >= 0 && this.singleRun >= TM.verifySingleSensorMin ? SENSORS[singleIdx].id : missingIdx >= 0 ? SENSORS[missingIdx].id : 'PD-A';
      if (!vOpen) {
        this.verifySensors = [sid];
        this.openNew('sensor', { level: 'verify', ruleId: 'R-V1', reason: vReason }, s);
      } else if (!this.verifySensors.includes(sid)) this.verifySensors.push(sid);
    } else if (vOpen) {
      this.verifyFalseRun += 1;
      if (this.verifyFalseRun >= TM.verifyClearMin) this.close(vOpen);
    }
  }

  /** A deep copy. The demo uses it to jump back in time without a replay from day 88. */
  clone(): World {
    const { now, ...state } = this;
    const c = Object.assign(Object.create(World.prototype) as World, structuredClone(state));
    c.now = now;
    return c;
  }

  advanceTo(t: number): void {
    while (this.t < t) this.step();
  }

  // ---------- alerts ----------

  openAlert(kind: Alert['kind']): Alert | undefined {
    return this.alerts.find((a) => a.kind === kind && a.closedAt === undefined);
  }

  get activeAlerts(): Alert[] {
    return this.alerts.filter((a) => a.closedAt === undefined).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  }

  private openNew(kind: Alert['kind'], target: { level: Level; ruleId: string; reason: string }, s: Sample): Alert {
    this.alertSeq += 1;
    const a: Alert = {
      id: `EV-${String(dayOf(this.t)).padStart(3, '0')}-${String(this.alertSeq).padStart(2, '0')}`,
      kind, level: target.level, peak: target.level, ruleId: target.ruleId, reason: target.reason,
      openedAt: this.t, changedAt: this.t,
      history: [{ t: this.t, ...target }],
      acked: false, suppressed: false,
      quality: worstQuality(s.quality),
      measured: `${fmt(s.mean)} mSv/h cabin mean`,
      donkiRefs: [], levelWall: this.now(), eventDoseMSv: 0, shelterDoseMSv: 0, savedMSv: 0, shelterMin: 0,
    };
    this.alerts.push(a);
    this.logAlert(a, `${cap(a.level)} opened. ${RULES[a.ruleId].title}. ${stripDot(a.reason)}.`, s);
    return a;
  }

  private updateLevel(a: Alert, target: { level: Level; ruleId: string; reason: string }, s: Sample): void {
    if (a.level === target.level) {
      a.reason = target.reason;
      return;
    }
    const up = LEVEL_RANK[target.level] > LEVEL_RANK[a.level];
    a.level = target.level;
    a.ruleId = target.ruleId;
    a.reason = target.reason;
    a.changedAt = this.t;
    a.levelWall = this.now();
    a.acked = false;
    if (up) a.suppressed = false;
    if (LEVEL_RANK[target.level] > LEVEL_RANK[a.peak]) a.peak = target.level;
    a.history.push({ t: this.t, ...target });
    this.logAlert(a, `${cap(target.level)} ${up ? 'raised' : 'lowered'} on the same event. ${stripDot(target.reason)}.`, s);
  }

  private close(a: Alert): void {
    a.closedAt = this.t;
    a.history.push({ t: this.t, level: 'clear', ruleId: a.ruleId, reason: 'Clear rule met' });
    for (const id of a.donkiRefs) this.consumed.add(id);
    this.push({ kind: 'clear', alertId: a.id, ruleId: a.ruleId, text: `${a.id} clear. ${a.kind === 'radiation' ? `Peak level: ${cap(a.peak)}. Open for ${duration(this.t - a.openedAt)}.` : 'Sensor data agrees again.'}`, visibility: 'ground' });
    if (a.kind === 'radiation' && a.shelterMin > 0) {
      this.push({
        kind: 'advisory', level: 'advisory', alertId: a.id,
        text: `Dose saved by the shelter (estimate): ${fmt(a.savedMSv)} mSv. The event added ${fmt(a.eventDoseMSv)} mSv to your dose.`,
        visibility: 'ground',
      });
    }
    const left = rules.limits.career.mSv - (this.careerDoseMSv - a.eventDoseMSv);
    if (a.kind === 'radiation' && left > 0 && a.eventDoseMSv > left * (TH.budgetEventAdvisoryPct.value / 100)) {
      this.push({ kind: 'advisory', level: 'advisory', alertId: a.id, text: `This event used more than ${TH.budgetEventAdvisoryPct.value}% of the budget left.`, visibility: 'ground' });
    }
  }

  private logAlert(a: Alert, text: string, s: Sample): void {
    this.push({
      kind: 'alert', level: a.level, ruleId: a.ruleId, alertId: a.id, text, visibility: 'ground',
      inputs: {
        'Cabin mean': `${fmt(s.mean)} mSv/h`,
        'Baseline B': `${fmt(s.B)} mSv/h`,
        [`Sensors ≥ ${TH.floorMultiple.label}`]: s.cabin.filter((v) => v !== null && v >= atMultiple(TH.floorMultiple.x, s.B)).length,
        [`Sensors ≥ ${TH.warningMultiple.label}`]: s.cabin.filter((v) => v !== null && v >= atMultiple(TH.warningMultiple.x, s.B)).length,
        [`Sensors ≥ ${TH.cautionMultiple.label}`]: s.cabin.filter((v) => v !== null && v >= atMultiple(TH.cautionMultiple.x, s.B)).length,
        '24 h projection': `${fmt(this.projection24h(s))} mSv`,
        'Data quality': s.quality.join(' '),
      },
    });
  }

  // ---------- log ----------

  private push(e: Omit<LogEntry, 'seq' | 't' | 'wall'> & { wall?: number }): LogEntry {
    this.seq += 1;
    const entry: LogEntry = { ...e, seq: this.seq, t: this.t, wall: e.wall ?? this.now() };
    this.log.push(Object.freeze(entry) as LogEntry); // NFR-07: append-only
    return entry;
  }

  visibilityOf(e: LogEntry): Visibility {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const v = this.log[i];
      if (v.kind === 'visibility' && v.targetSeq === e.seq) return v.visibility;
    }
    return e.visibility;
  }

  // ---------- crew actions ----------

  apply(action: Action, wall = this.now()): void {
    this.actions.push({ t: this.t, wall, action });
    const ui = (text: string, visibility: Visibility = 'crew') => this.push({ kind: 'action', text, visibility, wall });
    switch (action.type) {
      case 'ack': {
        const a = this.alerts.find((x) => x.id === action.alertId);
        if (a && !a.acked) { a.acked = true; ui(`${a.id} ${cap(a.level)} acknowledged.`, 'ground'); }
        break;
      }
      case 'suppress':
      case 'unsuppress': {
        const a = this.alerts.find((x) => x.id === action.alertId);
        // A Warning cannot be suppressed: the crew can acknowledge it, not hide it (beta report S-1).
        if (a && !(action.type === 'suppress' && a.level === 'warning')) { a.suppressed = action.type === 'suppress'; ui(`${a.id} ${action.type === 'suppress' ? 'suppressed. It stays in the log and the counts.' : 'shown again.'}`); }
        break;
      }
      case 'inhibit':
        this.inhibited.add(action.ruleId);
        ui(`Rule ${action.ruleId} inhibited. It does not raise alerts until you enable it.`, 'ground');
        break;
      case 'enable':
        this.inhibited.delete(action.ruleId);
        ui(`Rule ${action.ruleId} enabled.`, 'ground');
        break;
      case 'procStart':
        if (!this.procedure || this.procedure.alertId !== action.alertId) {
          this.procedure = { alertId: action.alertId, startedAt: this.t, startedWall: wall, confirmed: {} };
          ui(`Procedure ${PROCEDURE_SH1.id} opened${action.alertId ? ` from ${action.alertId}` : ''}.`, 'ground');
        }
        break;
      case 'procStep': {
        if (!this.procedure) break;
        const st = PROCEDURE_SH1.steps.find((x) => x.n === action.step);
        if (!st || this.procedure.confirmed[st.n]) break;
        this.procedure.confirmed[st.n] = { t: this.t, wall, choice: action.choice };
        if (action.choice === 'branch' && st.branch) {
          ui(`SH-1 step ${st.n}: ${st.branch.logText}`, 'ground');
        } else ui(`SH-1 step ${st.n} done: ${st.text}`, 'ground');
        if (st.marksShelter && !this.inShelter) {
          this.inShelter = true;
          this.shelterIntervals.push({ start: this.t });
          const a = this.procedure.alertId ? this.alerts.find((x) => x.id === this.procedure!.alertId) : this.openAlert('radiation');
          if (a && a.level === 'warning' && !a.shelterWall) {
            a.shelterWall = wall;
            const sec = Math.max(0, (wall - a.levelWall) / 1000);
            this.m1Seconds.push(sec);
            ui(`Time from Warning to shelter: ${sec.toFixed(0)} s (metric M-1).`, 'crew');
          }
        }
        break;
      }
      case 'shelterExit':
        if (this.inShelter) {
          this.inShelter = false;
          const iv = this.shelterIntervals[this.shelterIntervals.length - 1];
          iv.end = this.t;
          ui(`Left the shelter after ${duration(this.t - iv.start)}.`, 'ground');
          this.procedure = null;
        }
        break;
      case 'checkin': {
        const c = action.data;
        const parts = [`Sleep ${c.sleepH} h${c.sleepQuality ? ` (quality ${c.sleepQuality}/5)` : ''}`];
        if (c.mood) parts.push(`Mood ${c.mood}/5`);
        if (c.pain) parts.push(`Pain ${c.pain}/10`);
        parts.push(c.symptoms.length ? `Symptoms: ${c.symptoms.join(', ')}` : 'No symptoms');
        if (c.note.trim()) parts.push(`Note: ${c.note.trim()}`);
        this.push({ kind: 'checkin', text: `Daily check-in. ${parts.join('. ')}.`, checkin: c, visibility: action.visibility, wall });
        // Body-system rules (3B). Advisory or Caution only. They share the check-in's visibility.
        for (const f of this.bodyFindings()) {
          this.push({ kind: 'advisory', level: f.level, ruleId: f.ruleId, text: `${f.title}. ${f.why} ${f.text}`, visibility: action.visibility, wall });
        }
        break;
      }
      case 'visibility': {
        const target = this.log.find((e) => e.seq === action.seq);
        if (target && this.visibilityOf(target) !== action.visibility) {
          this.push({ kind: 'visibility', targetSeq: action.seq, visibility: action.visibility, text: `Entry ${action.seq} shared with: ${VIS_LABEL[action.visibility]}.`, wall });
        }
        break;
      }
      case 'link': {
        const before = this.link;
        if (before === action.link) break;
        this.link = action.link;
        this.push({ kind: 'system', text: `Link to Earth: ${LINK_LABEL[action.link]}.`, visibility: 'ground', wall });
        if (before === 'blackout' && action.link !== 'blackout') this.buildSummary(wall);
        break;
      }
      case 'summary':
        this.buildSummary(wall);
        break;
      case 'limit': {
        const r = limitRange(action.ruleId, action.param);
        if (!r) break;
        const value = Math.min(r.max, Math.max(r.min, action.value));
        (this.personal[action.ruleId] ??= {})[action.param] = value;
        ui(`Personal limit ${action.ruleId} ${r.label}: ${value} ${r.unit} (team value ${BODY_RULE[action.ruleId].params[action.param]} ${r.unit}).`, 'cmo');
        break;
      }
    }
  }

  /**
   * FR-11: a short summary for the ground. Private entries stay out.
   * Offline, the summary waits on board. The next summary sent on the link holds
   * the same entries, so the flight surgeon gets each entry one time.
   */
  buildSummary(wall = this.now()): LogEntry {
    const since = this.log.filter((e) => e.seq > this.lastSummarySeq && e.kind !== 'visibility' && e.kind !== 'summary');
    const shared = since.filter((e) => this.visibilityOf(e) === 'ground');
    const delay = LINK_DELAY_MIN[this.link];
    const entry = this.push({
      kind: 'summary', visibility: 'ground', wall,
      text: `Ground summary ${delay === null ? 'queued on board (no link)' : 'sent'}: ${shared.length} entries. ${since.length - shared.length} entries not sent by crew choice.`,
      summary: {
        sentT: this.t,
        arriveT: delay === null ? null : this.t + delay,
        link: this.link,
        lines: shared.map((e) => ({ t: e.t, text: e.text })),
        withheld: since.length - shared.length,
      },
    });
    if (delay !== null) this.lastSummarySeq = entry.seq;
    return entry;
  }

  // ---------- dose budget (FR-04) ----------

  get careerDoseMSv(): number {
    return TH.priorCareerMSv.value + this.missionDoseMSv;
  }

  projectedEndMSv(): number {
    return this.careerDoseMSv + gcrDoseMSv(this.t, MISSION_END_MIN);
  }

  /** Mission day on which the career dose passes the NASA limit (GCR projection from now). */
  crossingDay(): number | null {
    const limit = rules.limits.career.mSv;
    if (this.careerDoseMSv >= limit) return dayOf(this.t);
    let lo = this.t;
    let hi = MISSION_END_MIN;
    if (this.careerDoseMSv + gcrDoseMSv(this.t, hi) < limit) return null;
    while (hi - lo > 60) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.careerDoseMSv + gcrDoseMSv(this.t, mid) >= limit) hi = mid; else lo = mid;
    }
    return dayOf(hi);
  }

  /** FR-09: Caution and Warning events per simulated day, by the day they first reached Caution. */
  cautionWarningByDay(): Map<number, number> {
    const m = new Map<number, number>();
    for (const a of this.alerts) {
      const first = a.history.find((h) => h.level === 'caution' || h.level === 'warning');
      if (first) m.set(dayOf(first.t), (m.get(dayOf(first.t)) ?? 0) + 1);
    }
    return m;
  }

  /** Inputs for the body-system rules. `draft` adds an unsaved check-in at the end. */
  bodyInput(draft?: CheckIn): BodyInput {
    const checkins = this.log.filter((e) => e.kind === 'checkin' && e.checkin).map((e) => ({ t: e.t, c: e.checkin! }));
    if (draft) checkins.push({ t: this.t, c: draft });
    const ev = [...this.alerts].reverse().find((a) => a.kind === 'radiation' && (a.peak === 'warning' || a.peak === 'caution'));
    const today = dayOf(this.t);
    const days = Array.from({ length: 8 }, (_, i) => today - 7 + i);
    const vit = days.map((d) => simVitals(d, this.alertsOnDay(d).some((a) => a.peak === 'warning')));
    return {
      checkins,
      lastEvent: ev ? { t: ev.openedAt, doseMSv: ev.eventDoseMSv } : null,
      params: this.personal,
      hr: vit.map((v) => v.hr),
      exercise: vit.map((v) => v.exercise),
    };
  }

  bodyFindings(draft?: CheckIn): BodyFinding[] {
    return evaluateBody(this.bodyInput(draft));
  }

  alertsOnDay(day: number): Alert[] {
    return this.alerts.filter((a) => dayOf(a.openedAt) === day || (a.closedAt === undefined && dayOf(a.openedAt) < day));
  }
}

/** The one action sentence for an alert. The decision panel and the assistant both use it. */
export function actionSentence(a: Alert, w: World): string {
  if (a.level === 'warning') return w.inShelter ? 'Stay in the shelter.' : 'Go to the shelter now.';
  if (a.level === 'caution') return w.inShelter || a.peak === 'warning' ? 'The Warning is over. You can leave the shelter. Stay ready to go back.' : 'Safe your task. Stage the shelter.';
  if (a.level === 'verify') return 'Check the sensor. Read your dosimeter.';
  return 'No action now. Read at the daily review.';
}

export const VIS_LABEL: Record<Visibility, string> = { private: 'Only me', cmo: 'CMO', crew: 'Crew', ground: 'Ground' };
export const LINK_LABEL: Record<LinkState, string> = {
  live: 'Live', d5: 'Delayed 5 min', d14: 'Delayed 14 min', d22: 'Delayed 22 min', blackout: 'Offline (blackout)',
};

function worstQuality(q: Quality[]): Quality {
  return q.includes('missing') ? 'missing' : q.includes('poor') ? 'poor' : 'good';
}

function stripDot(s: string): string {
  return s.replace(/\.+$/, '');
}

export function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Rebuild a world from saved crew actions. The model is deterministic, so the result is the same. */
export function replayWorld(actions: RecordedAction[], targetT: number, now?: () => number): World {
  const w = new World(undefined, now);
  for (const ra of actions) {
    w.advanceTo(ra.t);
    w.apply(ra.action, ra.wall);
  }
  w.advanceTo(targetT);
  return w;
}
