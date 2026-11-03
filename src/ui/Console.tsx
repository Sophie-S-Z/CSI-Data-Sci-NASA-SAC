import { Suspense, lazy, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import gsap from 'gsap';
import { ArrowUpRight, ShieldCheck } from '@phosphor-icons/react';
import rules from '../data/rules.json';
import mission from '../data/mission.json';
import { RULES, LINK_LABEL, LINK_DELAY_MIN, LEVEL_RANK, type Alert, type World } from '../engine/world';
import { SENSORS, SHELTER_FACTOR, gcrDoseMSv, MISSION_END_MIN } from '../engine/doseModel';
import { REPLAY, REPLAY_PROVENANCE } from '../engine/donki';
import { at, dayOf, hhmm, stamp, duration, MIN_PER_DAY } from '../engine/time';
import { fmt } from '../engine/units';
import { Chip, Src, useUi, LevelIcon } from './common';
import { NumberTicker } from './fx/NumberTicker';
import { useDrawIn } from './fx/useDrawIn';
import { Segmented } from './Segmented';
import { DUR, EASE_OUT, prefersReducedMotion } from './motion';

const MissionView = lazy(() => import('./MissionView'));
import { LiveDonki } from './LiveDonki';

const TH = rules.thresholds;

export function ConsoleView() {
  return (
    <div className="console">
      <div className="area-timeline"><TimelineBand /></div>
      <div className="col">
        <div className="area-alert"><AlertPanel /></div>
        <div className="area-sensors"><SensorPanel /></div>
      </div>
      <div className="col">
        <div className="area-budget"><BudgetPanel /></div>
        <div className="area-mission"><MissionPanel /></div>
        <div className="area-weather"><WeatherPanel /></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- alert

function actionSentence(a: Alert, w: World): string {
  if (a.level === 'warning') return w.inShelter ? 'Stay in the shelter.' : 'Go to the shelter now.';
  if (a.level === 'caution') return w.inShelter ? 'Stay in the shelter until the Caution clears.' : 'Safe the task. Stage the shelter.';
  if (a.level === 'verify') return 'Check the sensor. Read your personal dosimeter.';
  return 'Read at the next daily review.';
}

function whyLine(a: Alert, w: World): string {
  const s = w.current;
  const x = s.mean / s.B;
  if (a.level === 'warning') return `Dose rate is ${fmt(x, 0)} times your cruise baseline.`;
  if (a.level === 'caution') {
    if (x >= TH.cautionMultiple.x) return `Dose rate is ${fmt(x, 1)} times your cruise baseline and rising.`;
    return `A solar particle event is likely. The dose rate at the vehicle is normal now. Safe the task by ${hhmm(a.changedAt + 30)}.`;
  }
  if (a.level === 'verify') return a.reason.endsWith('.') ? a.reason : `${a.reason}.`;
  return 'Solar activity near Earth. The dose rate here is normal.';
}

function tellLine(a: Alert, w: World): string {
  const delay = LINK_DELAY_MIN[w.link];
  const ground = delay === null ? 'The ground gets a summary when the link returns.' : `The ground gets a summary on the link (${LINK_LABEL[w.link].toLowerCase()}).`;
  if (a.level === 'warning') return `Tell the crew on the loop now. ${ground} Do not wait for the ground.`;
  if (a.level === 'caution') return `Tell the CMO when you stage the shelter. ${ground}`;
  if (a.level === 'verify') return 'Tell the CMO if the sensor stays poor after your check.';
  return 'At the daily review.';
}

function qualityLine(a: Alert, w: World): string {
  const q = w.current.quality;
  const good = q.filter((x) => x === 'good').length;
  if (a.quality === 'good') return `Good. ${good} of ${q.length} sensors agree.`;
  if (a.quality === 'poor') return `Poor on ${q.length - good} sensor. ${good} of ${q.length} agree.`;
  return `Missing data on ${q.filter((x) => x === 'missing').length} sensor. ${good} of ${q.length} agree.`;
}

function AlertPanel() {
  const { sim, openProcedure, openSource, toast } = useUi();
  const w = sim.world;
  const active = w.activeAlerts;
  const shown = active.filter((a) => !a.suppressed);
  const main = shown[0];
  const rest = shown.slice(1);
  const suppressed = active.filter((a) => a.suppressed);
  const root = useRef<HTMLElement>(null);
  const stateKey = main ? `${main.id}:${main.level}` : 'calm';

  // The one orchestrated moment: a new Warning or Caution enters with a band wipe and the action words rise.
  // It takes under 0.6 s and never hides the text for longer. Reduced motion skips it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !main || prefersReducedMotion()) return;
    if (main.level !== 'warning' && main.level !== 'caution') return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      tl.fromTo('.alert-head', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.38 })
        .fromTo('.alert-action .w', { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.42, stagger: 0.035 }, '-=0.22')
        .fromTo('.alert-why', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 }, '-=0.3')
        .fromTo('.btn.go, .btn.go-caution', { scale: 0.96 }, { scale: 1, duration: 0.5, clearProps: 'transform' }, '-=0.35')
        .fromTo('.go-ring', { opacity: 0.7, scale: 1 }, { opacity: 0, scale: 1.18, duration: 0.9, ease: 'power2.out' }, '<');
    }, el);
    return () => ctx.revert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  if (!main) {
    return (
      <motion.section ref={root} key="calm" className="panel alert-panel" aria-labelledby="alert-h"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.slow, ease: EASE_OUT }}>
        <div className="calm">
          <ShieldCheck className="calm-mark" size={120} weight="thin" aria-hidden="true" />
          <div className="status"><span className="orb" aria-hidden="true" /><Chip level="nominal">Nominal</Chip></div>
          <h2 id="alert-h">Dose rate normal. No action.</h2>
          <p className="muted">
            Cabin mean <span className="num">{fmt(w.current.mean)} mSv/h</span> against baseline{' '}
            <Src k="B"><span className="num">{fmt(w.current.B, 3)} mSv/h</span></Src>. The rules check every sensor each minute.
            {w.inShelter ? ' You are in the shelter. You can leave it now.' : ''}
          </p>
          {w.inShelter && (
            <div><button className="btn primary" onClick={() => { sim.act({ type: 'shelterExit' }); toast('Left the shelter'); }}>Leave the shelter</button></div>
          )}
          {suppressed.length > 0 && <SuppressedNote alerts={suppressed} />}
        </div>
      </motion.section>
    );
  }

  const rule = RULES[main.ruleId];
  const inhibited = w.inhibited.has(main.ruleId);
  return (
    <section ref={root} className={`panel alert-panel level-${main.level}`} aria-labelledby="alert-h" aria-live="assertive">
      <div className="alert-head">
        <span className="lvl"><LevelIcon level={main.level} size={20} />{main.level.toUpperCase()}</span>
        <span>{rule.title}</span>
        <span className="evt">{main.id}{main.acked ? ' · acknowledged' : ''}</span>
      </div>
      <div className="alert-main">
        <h2 id="alert-h" className="alert-action" aria-label={actionSentence(main, w)}>
          {actionSentence(main, w).split(' ').map((word, i) => <span key={`${stateKey}-${i}`} className="w" aria-hidden="true">{word} </span>)}
        </h2>
        <p className="alert-why">{whyLine(main, w)}</p>
      </div>
      <div className="alert-buttons">
        {(main.level === 'warning' || main.level === 'caution') && (
          <button className={`btn ${main.level === 'warning' ? 'go' : 'go-caution'}`} onClick={() => { sim.act({ type: 'procStart', alertId: main.id }); openProcedure(); }}>
            <span className="go-ring" aria-hidden="true" />
            {w.procedure ? 'Open procedure SH-1' : 'Go to procedure SH-1'}
            <ArrowUpRight size={18} weight="bold" aria-hidden="true" />
          </button>
        )}
        <button className="btn" disabled={main.acked} onClick={() => { sim.act({ type: 'ack', alertId: main.id }); toast(`${main.id} acknowledged`); }}>
          {main.acked ? 'Acknowledged' : 'Acknowledge'}
        </button>
        <button className="btn" onClick={() => { sim.act({ type: 'suppress', alertId: main.id }); toast(`${main.id} suppressed. It stays in the log.`); }}>Suppress</button>
        <button className="btn" onClick={() => { sim.act({ type: inhibited ? 'enable' : 'inhibit', ruleId: main.ruleId }); toast(`Rule ${main.ruleId} ${inhibited ? 'enabled' : 'inhibited'}`); }}>
          {inhibited ? `Enable ${main.ruleId}` : `Inhibit ${main.ruleId}`}
        </button>
        <span className="spacer" />
        <button className="btn quiet" onClick={() => openSource(main.ruleId)}>Source</button>
      </div>
      <dl className="five">
        <div><dt>What changed?</dt><dd>{main.reason.replace(/\.$/, '')}.</dd></div>
        <div><dt>How reliable is the data?</dt><dd>{qualityLine(main, w)}</dd></div>
        <div><dt>Why does it matter?</dt><dd>{main.level === 'warning'
          ? <>Unsheltered, the next 24 h give about <Src k="projection24h"><span className="num">{fmt(w.projection24h(), 0)} mSv</span></Src> (estimate). The limit for one SPE is <Src k="singleSpe"><span className="num">250 mSv</span></Src>.</>
          : rule.basis}</dd></div>
        <div><dt>What do I do now?</dt><dd>{w.inShelter && LEVEL_RANK[main.level] >= LEVEL_RANK.caution ? 'Stay in the shelter. Finish procedure SH-1. Leave when the Warning clears.' : rule.action}</dd></div>
        <div><dt>When do I tell the CMO or the ground?</dt><dd>{tellLine(main, w)}</dd></div>
      </dl>
      <p className="rule-line">
        Rule <Src k={main.ruleId}>{main.ruleId}</Src> · {main.ruleId === 'R-W1' ? <><Src k="warningMultiple">≥{fmt(TH.warningMultiple.x * w.B)} mSv/h</Src> on 2 or more of 6 sensors for 5 min (now {w.current.cabin.filter((v) => v !== null && v >= TH.warningMultiple.x * w.B).length})</> : main.ruleId === 'R-C1' ? <><Src k="sepCaution">SEP ≥ S1</Src>, X1 flare with fast CME, or <Src k="cautionMultiple">≥{fmt(TH.cautionMultiple.x * w.B)} mSv/h</Src> on 2 sensors</> : main.reason}
        {' '}· Data {main.quality} · {main.donkiRefs.length ? `DONKI ${main.donkiRefs.length} records, replay` : 'onboard sensors'} · since {hhmm(main.changedAt)}
      </p>
      {(rest.length > 0 || suppressed.length > 0) && (
        <div className="secondary-alerts">
          <AnimatePresence initial={false}>
            {rest.map((a) => (
              <motion.div key={a.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: DUR.fast } }}>
                <MiniAlert a={a} />
              </motion.div>
            ))}
          </AnimatePresence>
          {suppressed.length > 0 && <SuppressedNote alerts={suppressed} />}
        </div>
      )}
    </section>
  );
}

function MiniAlert({ a }: { a: Alert }) {
  const { sim, openSource } = useUi();
  return (
    <div className="mini-alert">
      <Chip level={a.level} />
      <span className="txt">{a.reason.replace(/\.$/, '')}. <span className="muted">{RULES[a.ruleId].action}</span></span>
      <button className="btn small" disabled={a.acked} onClick={() => sim.act({ type: 'ack', alertId: a.id })}>{a.acked ? 'Acknowledged' : 'Acknowledge'}</button>
      <button className="btn small quiet" onClick={() => openSource(a.ruleId)}>Source</button>
    </div>
  );
}

function SuppressedNote({ alerts }: { alerts: Alert[] }) {
  const { sim } = useUi();
  return (
    <div className="mini-alert">
      <span className="txt muted">{alerts.length} suppressed {alerts.length === 1 ? 'alert' : 'alerts'}: {alerts.map((a) => `${a.id} (${a.level})`).join(', ')}</span>
      {alerts.map((a) => <button key={a.id} className="btn small" onClick={() => sim.act({ type: 'unsuppress', alertId: a.id })}>Show {a.id}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- budget

function BudgetPanel() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const limit = rules.limits.career.mSv;
  const career = w.careerDoseMSv;
  const left = limit - career;
  const end = w.projectedEndMSv();
  const cross = w.crossingDay();
  const rising = w.history.length > 15 && s.personal > w.history[w.history.length - 15].personal * 1.15;
  const lastShelterEvent = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && a.shelterMin > 0);

  return (
    <section className="panel" aria-labelledby="budget-h">
      <header><h2 id="budget-h">Dose budget</h2><span className="aside"><span className="tag">Simulated</span></span></header>
      <div className="body">
        <BudgetBar used={career} end={end} limit={limit} />
        <dl className="kv">
          <div className="hl"><dt>Rate now (personal)</dt><dd><NumberTicker value={s.personal} digits={2} /><small>mSv/h</small>{rising ? <span className="rise" aria-label="rising"> ↑</span> : null}</dd></div>
          <div><dt>Mission so far</dt><dd><NumberTicker value={w.missionDoseMSv} /><small>mSv</small></dd></div>
          <div><dt>Career used</dt><dd><NumberTicker value={career} /> / <Src k="career">{limit}</Src><small>mSv</small></dd></div>
          <div><dt>Budget left</dt><dd><NumberTicker value={Math.max(0, left)} /><small>mSv</small></dd></div>
          <div><dt>Next 24 h, unsheltered</dt><dd><Src k="projection24h"><NumberTicker value={w.projection24h()} digits={0} /></Src><small>mSv est.</small></dd></div>
          <div><dt>At mission end (day 860)</dt><dd>~{Math.round(end).toLocaleString('en-US')}<small>mSv</small></dd></div>
        </dl>
        {end > limit && (
          <div className="waiver" role="note">
            <strong>Projected over NASA limit: waiver case.</strong> The career dose passes {limit} mSv on day <span className="num">{cross}</span>. This is expected for a Mars mission. It is not an alert.
          </div>
        )}
        {lastShelterEvent && (
          <div className="saved">
            Shelter saved about <strong className="num">{fmt(lastShelterEvent.savedMSv, 1)} mSv</strong> in {lastShelterEvent.id} <span className="muted">(<Src k="shelterFactor">estimate</Src>)</span>.
          </div>
        )}
        <CareerChart w={w} />
      </div>
    </section>
  );
}

function CareerChart({ w }: { w: World }) {
  const W = 360, H = 130, P = { l: 34, r: 8, t: 10, b: 20 };
  const maxD = MISSION_END_MIN / MIN_PER_DAY;
  const maxY = 1100;
  const xs = (d: number) => P.l + (d / maxD) * (W - P.l - P.r);
  const ys = (v: number) => H - P.b - (v / maxY) * (H - P.t - P.b);
  const prior = TH.priorCareerMSv.value;
  const nowD = w.t / MIN_PER_DAY;
  const past = useMemo(() => {
    const pts: string[] = [];
    for (let d = 0; d <= Math.floor(nowD); d += 10) pts.push(`${xs(d)},${ys(prior + gcrDoseMSv(0, d * MIN_PER_DAY))}`);
    return pts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(nowD / 10)]);
  const fut: string[] = [];
  for (let d = Math.ceil(nowD / 20) * 20; d <= maxD; d += 20) fut.push(`${xs(d)},${ys(w.careerDoseMSv + gcrDoseMSv(w.t, d * MIN_PER_DAY))}`);
  const nowPt = `${xs(nowD)},${ys(w.careerDoseMSv)}`;
  const pastRef = useRef<SVGPolylineElement>(null);
  const futRef = useRef<SVGPolylineElement>(null);
  useDrawIn(pastRef, 'mount', 1100);
  useDrawIn(futRef, 'mount', 1600);
  return (
    <figure style={{ margin: '14px 0 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Career dose path. Now ${fmt(w.careerDoseMSv, 0)} mSv. Projected ${Math.round(w.projectedEndMSv())} mSv at day 860.`}>
        {[0, 180, 680, 860].map((d) => <line key={d} className="chart-grid" x1={xs(d)} x2={xs(d)} y1={P.t} y2={H - P.b} />)}
        {[0, 180, 680, 860].map((d) => <text key={`t${d}`} x={xs(d)} y={H - 6} textAnchor={d === 0 ? 'start' : d === 860 ? 'end' : 'middle'}>{d === 860 ? '860 d' : d}</text>)}
        <line className="chart-th-w" x1={P.l} x2={W - P.r} y1={ys(600)} y2={ys(600)} style={{ stroke: 'var(--muted)' }} />
        <text x={P.l - 4} y={ys(600) + 4} textAnchor="end">600</text>
        <line className="chart-grid" x1={P.l} x2={W - P.r} y1={ys(1000)} y2={ys(1000)} strokeDasharray="2 3" />
        <text x={P.l - 4} y={ys(1000) + 4} textAnchor="end">1000</text>
        <text x={P.l - 4} y={ys(0) + 4} textAnchor="end">0</text>
        <polyline ref={pastRef} className="chart-line" points={[...past, nowPt].join(' ')} />
        <polyline ref={futRef} className="chart-personal" points={[nowPt, ...fut].join(' ')} />
        <circle cx={xs(nowD)} cy={ys(w.careerDoseMSv)} r={4} fill="var(--text)" />
      </svg>
      <figcaption className="legend">
        <span><i />Career dose so far</span>
        <span><i className="personal" />GCR projection</span>
        <span>Limits: <Src k="career">600 NASA</Src>, <Src k="intlCareer">1000 ESA / CSA / Roscosmos</Src></span>
      </figcaption>
    </figure>
  );
}

/** Career budget as one bar: used now, the GCR projection to mission end, and the NASA limit mark. */
function BudgetBar({ used, end, limit }: { used: number; end: number; limit: number }) {
  const max = Math.max(1100, end * 1.05);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="bbar" role="img" aria-label={`Career dose ${Math.round(used)} of ${limit} mSv. Projected ${Math.round(end)} mSv at mission end.`}>
      <div className="bbar-track">
        <motion.span className="bbar-proj" initial={{ scaleX: 0 }} animate={{ scaleX: end / max }} transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.15 }} />
        <motion.span className="bbar-used" initial={{ scaleX: 0 }} animate={{ scaleX: used / max }} transition={{ duration: 0.9, ease: EASE_OUT }} />
        <span className="bbar-limit" style={{ left: pct(limit) }}><span>{limit}</span></span>
      </div>
      <div className="bbar-legend"><span><i className="u" />Used</span><span><i className="p" />Projected to day 860</span></div>
    </div>
  );
}

// ---------------------------------------------------------------- mission (three.js)

function MissionPanel() {
  const { sim, theme } = useUi();
  const w = sim.world;
  const day = Math.round((w.t / MIN_PER_DAY) * 100) / 100;
  const warn = w.activeAlerts.some((a) => a.level === 'warning');
  const sepActive = REPLAY.some((r) => r.kind === 'SEP' && r.t <= w.t && (r.tEnd ?? Infinity) > w.t);
  const caution = w.activeAlerts.some((a) => a.level === 'caution');
  const storm = warn ? 'hit' : sepActive || caution ? 'watch' : 'none';
  return (
    <section className="panel mission" aria-labelledby="mv-h">
      <header>
        <h2 id="mv-h">Where you are</h2>
        <span className="aside">{storm === 'hit' ? <Chip level="warning">Protons at the vehicle</Chip> : storm === 'watch' ? <Chip level="caution">Solar event</Chip> : <span className="num">Day {Math.floor(day)} of 180 out</span>}</span>
      </header>
      <Suspense fallback={<div className="mv mv-skeleton" aria-hidden="true" />}>
        <MissionView day={day} storm={storm} theme={theme} />
      </Suspense>
      <p className="mv-caption">
        Drag to turn the view. The dashed line is your signal path to Earth ({LINK_LABEL[w.link].toLowerCase()}). Simplified, coplanar orbits.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- sensors

function SensorPanel() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  return (
    <section className="panel" aria-labelledby="sensors-h">
      <header>
        <h2 id="sensors-h">Dose rate</h2>
        <span className="aside"><span className="tag">Simulated</span><span className="tag">Replay</span></span>
      </header>
      <div className="body">
        <RateChart w={w} />
        <div className="sensors">
          {SENSORS.map((sn, i) => {
            const v = s.cabin[i];
            const q = s.quality[i];
            const cls = v === null ? 'missing' : q === 'poor' ? 'poor' : v >= TH.warningMultiple.x * s.B ? 'w' : v >= TH.cautionMultiple.x * s.B ? 'c' : '';
            return (
              <div key={sn.id} className={`sensor ${cls}`}>
                <div className="id"><span>{sn.id}</span><span>{sn.label}</span></div>
                <div className="v">{v === null ? '— —' : fmt(v)}<span className="muted" style={{ fontSize: 12 }}> mSv/h</span></div>
                <div className={`q ${q}`}>{q === 'good' ? '● good' : q === 'poor' ? '? poor' : '○ missing'}</div>
              </div>
            );
          })}
          <div className="sensor personal">
            <div className="id"><span>{mission.dosimeter.id}</span><span>{w.inShelter ? 'In shelter' : 'Pocket'}</span></div>
            <div className="v">{fmt(s.personal)}<span className="muted" style={{ fontSize: 12 }}> mSv/h</span></div>
            <div className="q good">● personal</div>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          Sensors store mGy. The screen shows mSv with <Src k="units">one factor</Src>. The SPE part comes from a <Src k="speModel">simulated dose model</Src>.
        </p>
      </div>
    </section>
  );
}

function RateChart({ w }: { w: World }) {
  const span = 8 * 60;
  const W = 640, H = 190, P = { l: 44, r: 10, t: 14, b: 22 };
  const t1 = w.t;
  const t0 = t1 - span;
  const lo = Math.log10(0.03), hi = Math.log10(10);
  const xs = (t: number) => P.l + ((t - t0) / span) * (W - P.l - P.r);
  const ys = (v: number) => H - P.b - ((Math.log10(Math.max(v, 0.031)) - lo) / (hi - lo)) * (H - P.t - P.b);
  const hist = w.history.filter((h) => h.t >= t0);
  const step = Math.max(1, Math.floor(hist.length / 240));
  const pts = hist.filter((_, i) => i % step === 0 || i === hist.length - 1);
  const mean = pts.map((h) => `${xs(h.t).toFixed(1)},${ys(h.mean).toFixed(1)}`).join(' ');
  const pers = pts.map((h) => `${xs(h.t).toFixed(1)},${ys(h.personal).toFixed(1)}`).join(' ');
  const area = pts.length ? `${xs(pts[0].t)},${H - P.b} ${mean} ${xs(pts[pts.length - 1].t)},${H - P.b}` : '';
  const B = w.B;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 120) ticks.push(t);
  const shelters = w.shelterIntervals.filter((iv) => (iv.end ?? t1) > t0);
  const meanRef = useRef<SVGPolylineElement>(null);
  useDrawIn(meanRef, 'mount', 1000);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Cabin dose rate, last 8 hours. Now ${fmt(w.current.mean)} mSv/h.`}>
        {shelters.map((iv, i) => <rect key={i} className="chart-shelter" x={xs(Math.max(iv.start, t0))} y={P.t} width={xs(iv.end ?? t1) - xs(Math.max(iv.start, t0))} height={H - P.t - P.b} />)}
        {[0.1, 1, 10].map((v) => (
          <g key={v}><line className="chart-grid" x1={P.l} x2={W - P.r} y1={ys(v)} y2={ys(v)} /><text x={P.l - 6} y={ys(v) + 4} textAnchor="end">{v}</text></g>
        ))}
        <line className="chart-th-c" x1={P.l} x2={W - P.r} y1={ys(3 * B)} y2={ys(3 * B)} />
        <line className="chart-th-w" x1={P.l} x2={W - P.r} y1={ys(10 * B)} y2={ys(10 * B)} />
        <text x={P.l + 6} y={ys(3 * B) - 5} textAnchor="start">3×B caution</text>
        <text x={P.l + 6} y={ys(10 * B) - 5} textAnchor="start">10×B warning</text>
        <polygon className="chart-area" points={area} />
        <polyline ref={meanRef} className="chart-line" points={mean} />
        <polyline className="chart-personal" points={pers} />
        {ticks.map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle">{hhmm(t)}</text>)}
        <text x={P.l - 6} y={H - P.b + 14} textAnchor="end">mSv/h</text>
      </svg>
      <figcaption className="legend">
        <span><i />Cabin mean, good sensors</span>
        <span><i className="personal" />Personal dosimeter</span>
        <span><i className="c" /><Src k="cautionMultiple">3 × B = {fmt(3 * B)} mSv/h</Src></span>
        <span><i className="w" /><Src k="warningMultiple">10 × B = {fmt(10 * B)} mSv/h</Src></span>
        {shelters.length > 0 && <span>Shaded: in shelter</span>}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- weather

function WeatherPanel() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const [tab, setTab] = useState<'replay' | 'live'>('replay');
  const seen = REPLAY.filter((r) => r.t <= w.t && w.t - r.t < 3 * MIN_PER_DAY).reverse();
  const next = REPLAY.find((r) => r.t > w.t);
  return (
    <section className="panel" aria-labelledby="wx-h">
      <header>
        <h2 id="wx-h">Solar events</h2>
        <span className="aside">
          <Segmented<'replay' | 'live'> size="sm" label="Data source" value={tab} onChange={setTab}
            options={[{ value: 'replay', label: 'Replay' }, { value: 'live', label: 'Live DONKI' }]} />
        </span>
      </header>
      <div className="body">
        {tab === 'replay' ? (
          <>
            <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              DONKI logs events near Earth. It gives Advisory or Caution only. <button className="linkish" onClick={() => openSource('donki')}>Why</button>
            </p>
            {seen.length === 0 ? <p className="muted">No solar events in the last 3 days.</p> : (
              <ul className="feed">
                {seen.map((r) => (
                  <motion.li key={r.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: DUR.slow, ease: EASE_OUT }}>
                    <span className="k">{r.kind}</span>
                    <span>{r.summary}{r.kind === 'SEP' && r.tEnd && w.t < r.tEnd ? <> <Chip level="caution">Active</Chip></> : null}</span>
                    <span />
                    <span className="when">{stamp(r.t)} · {r.id}</span>
                  </motion.li>
                ))}
              </ul>
            )}
            {next && <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>The replay file holds {REPLAY.length} records.</p>}
            <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>{REPLAY_PROVENANCE}</p>
          </>
        ) : <LiveDonki />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- timeline

function TimelineBand() {
  const { sim, go } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const d0 = day * MIN_PER_DAY;
  const pct = (t: number) => `${(((t - d0) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((b - a) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const checkDone = w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === day);
  const warn = w.activeAlerts.find((a) => a.level === 'warning');
  const shelters = w.shelterIntervals
    .map((iv) => ({ s: Math.max(iv.start, d0), e: Math.min(iv.end ?? w.t, d0 + MIN_PER_DAY), open: iv.end === undefined }))
    .filter((x) => x.e > x.s || x.open);
  const planned = warn && !w.inShelter ? { s: w.t, e: Math.min(w.t + 360, d0 + MIN_PER_DAY) } : null;
  const openShelter = shelters.find((x) => x.open);
  const shelterExt = openShelter ? { s: openShelter.e, e: Math.min(openShelter.e + 240, d0 + MIN_PER_DAY) } : null;

  return (
    <section className="panel" aria-labelledby="tl-h">
      <header>
        <h2 id="tl-h">Crew timeline</h2>
        <span className="aside num">Day {String(day).padStart(3, '0')}</span>
      </header>
      <div className="tl">
        <div className="tl-inner">
          <div className="tl-hours">
            <span />
            <div className="ticks">{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}</div>
          </div>
          {mission.crew.map((c) => (
            <div key={c.id} className={`tl-row ${c.isUser ? 'me' : ''}`}>
              <div className="who">{c.role}{c.isUser ? ' (you)' : ''}</div>
              <div className="tl-track">
                {mission.schedule.map((b, i, all) => {
                  const afterHealth = c.isUser && i > 0 && all[i - 1].kind === 'health';
                  const s = at(day, b.start);
                  const e = b.end === '24:00' ? d0 + MIN_PER_DAY : at(day, b.end);
                  const label = !c.isUser && b.kind === 'health' ? '' : b.label;
                  const isHealth = b.kind === 'health' && c.isUser;
                  return isHealth ? (
                    <button key={i} type="button" className={`blk health ${checkDone ? 'done' : ''}`} style={{ left: pct(s), width: width(s, e) }} onClick={() => go('checkin')} title="Open the daily health check" aria-label={`Daily health check, ${checkDone ? 'done' : 'open it'}`}>
                      {checkDone ? '✓ Health' : 'Health chk'}
                    </button>
                  ) : (
                    <div key={i} className={`blk ${!c.isUser && b.kind === 'health' ? 'ops' : b.kind}`} style={{ left: pct(s), width: width(s, e), paddingLeft: afterHealth ? 46 : undefined }}>{label}</div>
                  );
                })}
                {shelters.map((x, i) => <div key={`sh${i}`} className="blk shelter" style={{ left: pct(x.s), width: width(x.s, Math.max(x.e, x.s + 10)) }}>Shelter {duration(x.e - x.s)}</div>)}
                {shelterExt && <div className="blk shelter plan" style={{ left: pct(shelterExt.s), width: width(shelterExt.s, shelterExt.e) }}>until clear</div>}
                {planned && <div className="blk shelter plan" style={{ left: pct(planned.s), width: width(planned.s, planned.e) }}>Shelter (est. 6 h)</div>}
              </div>
            </div>
          ))}
          <div className="tl-now" style={{ left: `calc(92px + (100% - 92px) * ${(w.t - d0) / MIN_PER_DAY})` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

export { SHELTER_FACTOR };
