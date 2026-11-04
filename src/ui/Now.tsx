import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle, ArrowBendDownRight, SignOut, Heartbeat } from '@phosphor-icons/react';
import rules from '../data/rules.json';
import mission from '../data/mission.json';
import { RULES, LINK_LABEL, LINK_DELAY_MIN, LEVEL_RANK, PROCEDURE_SH1, type Alert, type World } from '../engine/world';
import { SENSORS } from '../engine/doseModel';
import { REPLAY, REPLAY_PROVENANCE } from '../engine/donki';
import { at, dayOf, hhmm, stamp, duration, minuteOfDay, MIN_PER_DAY } from '../engine/time';
import { fmt } from '../engine/units';
import { vehicleAt, earthAt, marsAt, R_EARTH, R_MARS, TRANSIT_DAYS } from '../engine/orbit';
import { Chip, Src, useUi, LevelIcon, LEVEL_WORD } from './common';
import { Segmented } from './Segmented';
import { LiveDonki } from './LiveDonki';

const TH = rules.thresholds;

/**
 * The Now view answers one question: "What is my radiation risk now, and what do I do?"
 * The decision panel is the only loud element. Everything else supports it.
 */
export function NowView() {
  return (
    <div className="now">
      <div className="stack now-main">
        <Decision />
        <DoseRate />
      </div>
      <div className="stack now-side">
        <Budget />
        <Situation />
        <SolarEvents />
      </div>
      <div className="tl-wrap"><TimelineBand /></div>
    </div>
  );
}

// ---------------------------------------------------------------- decision

function actionSentence(a: Alert, w: World): string {
  if (a.level === 'warning') return w.inShelter ? 'Stay in the shelter.' : 'Go to the shelter now.';
  if (a.level === 'caution') return w.inShelter ? 'Stay in the shelter until the Caution clears.' : 'Safe the task. Stage the shelter.';
  if (a.level === 'verify') return 'Check the sensor. Read your personal dosimeter.';
  return 'No action now. Read at the daily review.';
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
  return 'Solar activity near Earth. The dose rate at the vehicle is normal.';
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

function nextBlock(w: World): { label: string; start: string } | null {
  const m = minuteOfDay(w.t);
  const b = mission.schedule.find((x) => at(0, x.start) > m);
  return b ? { label: b.label, start: b.start } : null;
}

function Decision() {
  const { sim, openProcedure, procOpen, setProcOpen, openSource, note } = useUi();
  const w = sim.world;
  const active = w.activeAlerts;
  const shown = active.filter((a) => !a.suppressed);
  const main = shown[0];
  const rest = shown.slice(1);
  const suppressed = active.filter((a) => a.suppressed);

  if (!main) {
    const next = nextBlock(w);
    return (
      <section className="decision lv-nominal" aria-labelledby="dec-h">
        <div className="hero" key="nominal">
        <div className="band"><span className="lvl"><LevelIcon level="nominal" size={18} />Nominal</span><span className="evt">Checked {hhmm(w.t)}</span></div>
        <div className="decide">
          <h2 id="dec-h">Dose rate normal. No action.</h2>
          <p className="why">
            Cabin mean <span className="num">{fmt(w.current.mean)} mSv/h</span>, which is <span className="num">{fmt(w.current.mean / w.B, 1)} ×</span> the
            baseline <Src k="B"><span className="num">B = {fmt(w.B, 3)} mSv/h</span></Src>. The rules check all {SENSORS.length} sensors each minute.
          </p>
          {next && !w.inShelter && <p className="muted">Next on your timeline: {next.label} at <span className="num">{next.start}</span>.</p>}
          {w.inShelter && (
            <div className="act">
              <p className="why">The Warning is clear. You can leave the shelter.</p>
              <button className="btn primary" onClick={() => { sim.act({ type: 'shelterExit' }); setProcOpen(false); note('Left the shelter'); }}><SignOut size={18} aria-hidden="true" />Leave the shelter</button>
            </div>
          )}
        </div>
        </div>
        {suppressed.length > 0 && <div className="more-alerts"><SuppressedNote alerts={suppressed} /></div>}
      </section>
    );
  }

  const rule = RULES[main.ruleId];
  const inhibited = w.inhibited.has(main.ruleId);
  const loud = main.level === 'warning' || main.level === 'caution';
  const showProc = procOpen && !!w.procedure;
  const clear = w.warningClearProgress();

  return (
    <section className={`decision lv-${main.level}`} aria-labelledby="dec-h" aria-live="assertive">
      <div className="hero" key={main.level}>
      <div className="band">
        <span className="lvl"><span className="lvl-ico"><LevelIcon level={main.level} size={18} /></span>{LEVEL_WORD[main.level]}</span>
        <span className="rule-title">{rule.title}</span>
        <span className="evt">{main.id}, since {hhmm(main.changedAt)}{main.acked ? ', acknowledged' : ''}</span>
      </div>
      <div className="decide">
        <h2 id="dec-h">{actionSentence(main, w)}</h2>
        <p className="why">{whyLine(main, w)}</p>
        {clear && w.inShelter && (
          <div className="clearbar">
            <span className="small">Clear rule: all sensors below <Src k="cautionMultiple"><span className="num">{fmt(TH.cautionMultiple.x * w.B)} mSv/h</span></Src> for 2 h. Now <span className="num">{duration(clear.have)}</span> of 2 h.</span>
            <div className="meter" role="progressbar" aria-label="Clear rule progress" aria-valuemin={0} aria-valuemax={clear.need} aria-valuenow={clear.have}><span style={{ width: `${(clear.have / clear.need) * 100}%` }} /></div>
          </div>
        )}
        <div className="act">
          {loud && !showProc && (
            <button className={`btn ${main.level === 'warning' ? 'go-warning' : 'go-caution'}`} onClick={() => { sim.act({ type: 'procStart', alertId: main.id }); openProcedure(); note(`Procedure SH-1 opened from ${main.id}`); }}>
              {w.procedure ? 'Open procedure SH-1' : 'Go to procedure SH-1'}<ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          )}
          {showProc && <button className="btn" onClick={() => setProcOpen(false)}>Show alert details</button>}
          <span className="spacer" />
          <button className="btn ghost sm why-btn" onClick={() => openSource(main.ruleId)}>Why this alert: rule {main.ruleId}</button>
        </div>
      </div>
      </div>
      {showProc ? <Procedure /> : (
        <>
          <dl className="qa">
            <div><dt>What changed?</dt><dd>{main.reason.replace(/\.$/, '')}.</dd></div>
            <div><dt>How reliable is the data?</dt><dd>{qualityLine(main, w)}</dd></div>
            <div><dt>Why does it matter?</dt><dd>{main.level === 'warning'
              ? <>Unsheltered, the next 24 h give about <Src k="projection24h"><span className="num">{fmt(w.projection24h(), 0)} mSv</span></Src> (estimate). The limit for one solar event is <Src k="singleSpe"><span className="num">250 mSv</span></Src>.</>
              : rule.basis}</dd></div>
            <div><dt>What do I do now?</dt><dd>{w.inShelter && LEVEL_RANK[main.level] >= LEVEL_RANK.caution ? 'Stay in the shelter. Finish procedure SH-1. Leave when the Warning clears.' : rule.action}</dd></div>
            <div><dt>When do I tell the CMO or the ground?</dt><dd>{tellLine(main, w)}</dd></div>
          </dl>
          <p className="ruleline">
            Rule <Src k={main.ruleId}>{main.ruleId}</Src> · {main.ruleId === 'R-W1'
              ? <><Src k="warningMultiple">≥{fmt(TH.warningMultiple.x * w.B)} mSv/h</Src> on 2 or more of 6 sensors for 5 min (now {w.current.cabin.filter((v) => v !== null && v >= TH.warningMultiple.x * w.B).length})</>
              : main.ruleId === 'R-C1'
                ? <><Src k="sepCaution">SEP ≥ S1</Src>, X1 flare with fast CME, or <Src k="cautionMultiple">≥{fmt(TH.cautionMultiple.x * w.B)} mSv/h</Src> on 2 sensors</>
                : main.reason}
            {' '}· Data {main.quality} · {main.donkiRefs.length ? `DONKI ${main.donkiRefs.length} records, replay` : 'onboard sensors'}
          </p>
        </>
      )}
      <div className="ctl" role="group" aria-label="Alert controls">
        <span className="lbl">Alert controls</span>
        <button className="btn sm" disabled={main.acked} onClick={() => { sim.act({ type: 'ack', alertId: main.id }); note(`${main.id} acknowledged`); }}>
          {main.acked ? 'Acknowledged' : 'Acknowledge'}
        </button>
        <button className="btn sm" onClick={() => { sim.act({ type: 'suppress', alertId: main.id }); note(`${main.id} suppressed. It stays in the log and the counts.`); }}>Suppress</button>
        <button className="btn sm" onClick={() => { sim.act({ type: inhibited ? 'enable' : 'inhibit', ruleId: main.ruleId }); note(`Rule ${main.ruleId} ${inhibited ? 'enabled' : 'inhibited'}`); }}>
          {inhibited ? `Enable ${main.ruleId}` : `Inhibit ${main.ruleId}`}
        </button>
      </div>
      {(rest.length > 0 || suppressed.length > 0) && (
        <div className="more-alerts">
          {rest.map((a) => <MiniAlert key={a.id} a={a} />)}
          {suppressed.length > 0 && <SuppressedNote alerts={suppressed} />}
        </div>
      )}
    </section>
  );
}

function MiniAlert({ a }: { a: Alert }) {
  const { sim, openSource, note } = useUi();
  return (
    <div className="more-alert">
      <Chip level={a.level} />
      <span className="txt">{a.reason.replace(/\.$/, '')}. <span className="muted">{RULES[a.ruleId].action}</span></span>
      <button className="btn sm" disabled={a.acked} onClick={() => { sim.act({ type: 'ack', alertId: a.id }); note(`${a.id} acknowledged`); }}>{a.acked ? 'Acknowledged' : 'Acknowledge'}</button>
      <button className="btn sm ghost" onClick={() => openSource(a.ruleId)}>Source</button>
    </div>
  );
}

function SuppressedNote({ alerts }: { alerts: Alert[] }) {
  const { sim, note } = useUi();
  return (
    <div className="more-alert">
      <span className="txt muted">{alerts.length} suppressed: {alerts.map((a) => `${a.id} (${a.level})`).join(', ')}</span>
      {alerts.map((a) => <button key={a.id} className="btn sm" onClick={() => { sim.act({ type: 'unsuppress', alertId: a.id }); note(`${a.id} shown again`); }}>Show {a.id}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- procedure SH-1 (iPV style, in place)

function Procedure() {
  const { sim, setProcOpen, note } = useUi();
  const w = sim.world;
  const p = w.procedure!;
  const alert = p.alertId ? w.alerts.find((a) => a.id === p.alertId) : undefined;
  const confirmed = p.confirmed;
  const current = PROCEDURE_SH1.steps.find((s) => !confirmed[s.n]);
  const warnActive = w.activeAlerts.some((a) => a.level === 'warning');
  const startWall = alert?.levelWall ?? p.startedWall;
  const shelterWall = alert?.shelterWall;
  const [, tick] = useState(0);
  useEffect(() => {
    if (shelterWall) return;
    const id = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [shelterWall]);
  const elapsed = Math.max(0, ((shelterWall ?? Date.now()) - startWall) / 1000);
  const done = Object.keys(confirmed).length;

  return (
    <div>
      <div className="proc-h">
        <h3>{PROCEDURE_SH1.id} {PROCEDURE_SH1.title}</h3>
        <span className="small muted">Step {Math.min(done + 1, PROCEDURE_SH1.steps.length)} of {PROCEDURE_SH1.steps.length} · {PROCEDURE_SH1.note}</span>
        <span className="watch" aria-label="Time since the alert">{shelterWall ? 'In shelter after ' : 'Elapsed '}{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>
      </div>
      <ol className="steps">
        {PROCEDURE_SH1.steps.map((s) => {
          const c = confirmed[s.n];
          const isCur = current?.n === s.n;
          const blocked = s.waitsForClear && warnActive;
          return (
            <li key={s.n} className={`step ${c ? 'done' : isCur ? 'current' : 'later'}`} aria-current={isCur ? 'step' : undefined}>
              <span className="n" aria-hidden="true">{c ? '✓' : s.n}</span>
              <div>
                <div className="t"><span className="sr-only">Step {s.n}. </span>{s.text}</div>
                {c && <div className="sub">Done at <span className="num">{hhmm(c.t)}</span>{c.choice === 'branch' ? ' · vest not found, CMO told' : ''}</div>}
                {isCur && s.waitsForClear && (
                  <div className="sub">
                    {blocked ? `The Warning is active. It clears when all sensors stay below ${fmt(3 * w.B)} mSv/h for 2 h.` : 'The Warning is clear. You can leave the shelter.'}
                    {w.inShelter && w.shelterIntervals.length > 0 && <> In the shelter for {duration(w.t - w.shelterIntervals[w.shelterIntervals.length - 1].start)}.</>}
                  </div>
                )}
              </div>
              {isCur && (
                <div className="acts">
                  {s.branch && <button className="btn" onClick={() => { sim.act({ type: 'procStep', step: s.n, choice: 'branch' }); note(`SH-1 step ${s.n}: ${s.branch!.label}`); }}><ArrowBendDownRight size={18} aria-hidden="true" />{s.branch.label}</button>}
                  {s.waitsForClear ? (
                    <button className="btn primary" disabled={blocked} onClick={() => {
                      sim.act({ type: 'procStep', step: s.n });
                      sim.act({ type: 'shelterExit' });
                      setProcOpen(false);
                      note('SH-1 done. Left the shelter');
                    }}><SignOut size={18} aria-hidden="true" />{blocked ? 'Wait for clear' : 'Leave the shelter'}</button>
                  ) : (
                    <button className="btn primary" onClick={() => { sim.act({ type: 'procStep', step: s.n }); note(`SH-1 step ${s.n} done: ${s.text}`); }}><CheckCircle size={20} weight="bold" aria-hidden="true" />Done</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {w.m1Seconds.length > 0 && (
        <p className="ruleline">Warning to shelter: <strong className="num">{Math.round(w.m1Seconds[w.m1Seconds.length - 1])} s</strong>. Metric M-1 target: median 60 s or less.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dose budget (FR-04)

function rateMark(v: number, B: number) {
  if (v >= TH.warningMultiple.x * B) return <span className="arrow-up w" aria-label="above the Warning level">↑</span>;
  if (v >= TH.cautionMultiple.x * B) return <span className="arrow-up c" aria-label="above the Caution level">↑</span>;
  return null;
}

function Budget() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const limit = rules.limits.career.mSv;
  const career = w.careerDoseMSv;
  const end = w.projectedEndMSv();
  const cross = w.crossingDay();
  const ev = w.openAlert('radiation');
  const lastSaved = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && a.shelterMin > 0);

  return (
    <section className="region" aria-labelledby="budget-h">
      <div className="rh"><h2 id="budget-h">Dose budget</h2><span className="aside"><span className="tag">Simulated</span></span></div>
      <div className="rb">
        <div className={`stat ${s.personal >= TH.warningMultiple.x * s.B ? 'w' : s.personal >= TH.cautionMultiple.x * s.B ? 'c' : ''}`}>
          <span className="stat-lbl">Your dose rate now</span>
          <span className="stat-val num">{fmt(s.personal)}<small>mSv/h</small>{rateMark(s.personal, s.B)}</span>
          <span className="stat-sub">{fmt(s.personal / s.B, 1)} × your cruise baseline</span>
        </div>
        <dl className="kv">
          {ev && ev.eventDoseMSv > 0.05 && (
            <div><dt>This event so far</dt><dd>{fmt(ev.eventDoseMSv, 1)} / <Src k="singleSpe">250</Src><small>mSv</small></dd></div>
          )}
          <div><dt>Next 24 h if unsheltered</dt><dd><Src k="projection24h">{fmt(w.projection24h(), 0)}</Src><small>mSv est.</small></dd></div>
          <div><dt>Mission so far</dt><dd>{fmt(w.missionDoseMSv, 1)}<small>mSv</small></dd></div>
          <div><dt>Career used</dt><dd>{fmt(career, 1)} / <Src k="career">{limit}</Src><small>mSv</small></dd></div>
          <div><dt>At mission end (day 860)</dt><dd>~{Math.round(end).toLocaleString('en-US')}<small>mSv</small></dd></div>
        </dl>
        <BudgetBar used={career} end={end} limit={limit} />
        {end > limit && (
          <p className="waiver"><strong>Waiver case, not an alert.</strong> Your career dose passes {limit} mSv on day <span className="num">{cross}</span>. A Mars crew passes this limit by design.</p>
        )}
        {lastSaved && (
          <p className="waiver">The shelter saved about <strong className="num">{fmt(lastSaved.savedMSv, 1)} mSv</strong> in {lastSaved.id} (<Src k="shelterFactor">estimate</Src>).</p>
        )}
      </div>
    </section>
  );
}

/** Career dose as one bar: used now, the GCR projection to mission end, and the two limits. */
function BudgetBar({ used, end, limit }: { used: number; end: number; limit: number }) {
  const max = Math.max(1100, end * 1.05);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure className="bbar" style={{ margin: '12px 0 0' }}>
      <div className="bbar-track" role="img" aria-label={`Career dose ${Math.round(used)} mSv now. Projected ${Math.round(end)} mSv at mission end. NASA limit ${limit} mSv.`}>
        <span className="bbar-proj" style={{ width: pct(end) }} />
        <span className="bbar-used" style={{ width: pct(used) }} />
        <span className="bbar-mark" style={{ left: pct(limit) }} />
        <span className="bbar-mark" style={{ left: pct(1000), opacity: 0.45 }} />
      </div>
      <div className="bbar-scale" aria-hidden="true">
        <span style={{ left: 0, transform: 'none' }}>0</span>
        <span style={{ left: pct(limit) }}>{limit} NASA</span>
        <span style={{ left: pct(1000) }}>1000</span>
      </div>
      <figcaption className="legend">
        <span><i />Used</span><span><i className="d" />Projected (GCR only)</span>
        <span>Limits: <Src k="career">NASA</Src>, <Src k="intlCareer">ESA / CSA / Roscosmos</Src></span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- dose rate and sensors

function DoseRate() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const cls = (v: number | null) => (v === null ? '' : v >= TH.warningMultiple.x * s.B ? 'w' : v >= TH.cautionMultiple.x * s.B ? 'c' : '');
  return (
    <section className="region" aria-labelledby="rate-h">
      <div className="rh">
        <h2 id="rate-h">Dose rate, last 8 h</h2>
        <span className="aside"><span className="tag">Simulated</span><span className="tag">Replay</span></span>
      </div>
      <div className="rb">
        <RateChart w={w} />
      </div>
      <div className="rb flush scroll-x">
        <table className="tbl">
          <thead><tr><th>Sensor</th><th>Place</th><th className="r">mSv/h</th><th className="r">× B</th><th>Data</th></tr></thead>
          <tbody>
            {SENSORS.map((sn, i) => {
              const v = s.cabin[i];
              const q = s.quality[i];
              return (
                <tr key={sn.id} className={cls(v)}>
                  <td className="num">{sn.id}</td>
                  <td>{sn.label}</td>
                  <td className="num r">{v === null ? '- -' : fmt(v)}{v !== null && rateMark(v, s.B)}</td>
                  <td className="num r">{v === null ? '' : fmt(v / s.B, 1)}</td>
                  <td className={`q-${q}`}>{q === 'good' ? 'Good' : q === 'poor' ? '? Poor' : 'Missing'}</td>
                </tr>
              );
            })}
            <tr className={cls(s.personal)}>
              <td className="num">{mission.dosimeter.id}</td>
              <td>Your dosimeter{w.inShelter ? ', in shelter' : ''}</td>
              <td className="num r">{fmt(s.personal)}{rateMark(s.personal, s.B)}</td>
              <td className="num r">{fmt(s.personal / s.B, 1)}</td>
              <td className="muted">Personal</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note" style={{ padding: '0 14px 12px' }}>
        Sensors store mGy. The screen shows mSv with <Src k="units">one factor</Src>. The solar event part comes from a <Src k="speModel">simulated dose model</Src>.
      </p>
    </section>
  );
}

function RateChart({ w }: { w: World }) {
  const span = 8 * 60;
  const W = 640, H = 170, P = { l: 44, r: 8, t: 10, b: 22 };
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
  const B = w.B;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / 60) * 60; t <= t1; t += 120) ticks.push(t);
  const shelters = w.shelterIntervals.filter((iv) => (iv.end ?? t1) > t0);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Cabin dose rate, last 8 hours. Now ${fmt(w.current.mean)} mSv/h.`}>
        {shelters.map((iv, i) => <rect key={i} className="shelter" x={xs(Math.max(iv.start, t0))} y={P.t} width={Math.max(1, xs(iv.end ?? t1) - xs(Math.max(iv.start, t0)))} height={H - P.t - P.b} />)}
        {[0.1, 1, 10].map((v) => (
          <g key={v}><line className="grid" x1={P.l} x2={W - P.r} y1={ys(v)} y2={ys(v)} /><text x={P.l - 6} y={ys(v) + 4} textAnchor="end">{v}</text></g>
        ))}
        <line className="th-c" x1={P.l} x2={W - P.r} y1={ys(3 * B)} y2={ys(3 * B)} />
        <line className="th-w" x1={P.l} x2={W - P.r} y1={ys(10 * B)} y2={ys(10 * B)} />
        <text x={P.l + 6} y={ys(3 * B) - 4}>Caution 3 × B</text>
        <text x={P.l + 6} y={ys(10 * B) - 4}>Warning 10 × B</text>
        <polyline className="line2" points={pers} />
        <polyline className="line" points={mean} />
        {ticks.map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle">{hhmm(t)}</text>)}
        <text x={P.l - 6} y={H - 6} textAnchor="end">mSv/h</text>
      </svg>
      <figcaption className="legend">
        <span><i />Cabin mean, good sensors</span>
        <span><i className="d" />Your dosimeter</span>
        <span><i className="c" /><Src k="cautionMultiple">Caution {fmt(3 * B)} mSv/h</Src></span>
        <span><i className="w" /><Src k="warningMultiple">Warning {fmt(10 * B)} mSv/h</Src></span>
        {shelters.length > 0 && <span>Tinted: in shelter</span>}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- situation (flat drawing)

/**
 * Where the vehicle is, where the solar event goes, and the signal path to Earth.
 * Simplified, coplanar orbits from engine/orbit.ts. It does not move by itself.
 */
function Situation() {
  const { sim } = useUi();
  const w = sim.world;
  const day = w.t / MIN_PER_DAY;
  const warn = w.activeAlerts.some((a) => a.level === 'warning');
  const sepActive = REPLAY.some((r) => r.kind === 'SEP' && r.t <= w.t && (r.tEnd ?? Infinity) > w.t);
  const caution = w.activeAlerts.some((a) => a.level === 'caution');
  const storm = warn ? 'hit' : sepActive || caution ? 'watch' : 'none';

  const S = 300, c = S / 2, k = (S / 2 - 22) / R_MARS;
  const P = (v: { x: number; y: number }) => ({ x: c + v.x * k, y: c - v.y * k });
  const v = P(vehicleAt(day)), e = P(earthAt(day)), m = P(marsAt(day));
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let d = 0; d <= TRANSIT_DAYS; d += 3) { const p = P(vehicleAt(d)); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
    return pts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const doneN = Math.min(path.length, Math.floor(day / 3) + 1);
  // A cone from the Sun toward the vehicle shows the particle event.
  const ang = Math.atan2(v.y - c, v.x - c);
  const spread = 0.32, reach = Math.hypot(v.x - c, v.y - c) * 1.25;
  const cone = `${c},${c} ${c + reach * Math.cos(ang - spread)},${c + reach * Math.sin(ang - spread)} ${c + reach * Math.cos(ang + spread)},${c + reach * Math.sin(ang + spread)}`;

  return (
    <section className="region" aria-labelledby="sit-h">
      <div className="rh">
        <h2 id="sit-h">Where you are</h2>
        <span className="aside">{storm === 'hit' ? <Chip level="warning">Protons at the vehicle</Chip> : storm === 'watch' ? <Chip level="caution">Solar event</Chip> : <span className="num">Day {Math.floor(day)} of {TRANSIT_DAYS}</span>}</span>
      </div>
      <div className="rb" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 220px) 1fr', gap: 14, alignItems: 'center' }}>
        <svg className="situ" viewBox={`0 0 ${S} ${S}`} width="100%" role="img" aria-label={`Day ${Math.floor(day)} of a ${TRANSIT_DAYS}-day transit to Mars.${storm !== 'none' ? ' A solar particle event is on the path to the vehicle.' : ''}`}>
          {storm !== 'none' && <polygon className={`storm ${storm === 'watch' ? 'watch' : ''}`} points={cone} />}
          <circle className="orbit" cx={c} cy={c} r={R_EARTH * k} />
          <circle className="orbit" cx={c} cy={c} r={R_MARS * k} strokeDasharray="3 4" />
          <polyline className="orbit" points={path.join(' ')} strokeDasharray="2 3" />
          <polyline className="path" points={path.slice(0, doneN).concat(`${v.x},${v.y}`).join(' ')} />
          <line className="signal" x1={v.x} y1={v.y} x2={e.x} y2={e.y} />
          <circle className="sun" cx={c} cy={c} r={9} />
          <circle className="body" cx={e.x} cy={e.y} r={6} />
          <circle className="body" cx={m.x} cy={m.y} r={5} />
          <rect className="me" x={v.x - 5} y={v.y - 5} width={10} height={10} transform={`rotate(45 ${v.x} ${v.y})`} />
          <text x={c} y={c + 24} textAnchor="middle">Sun</text>
          <text x={e.x + 10} y={e.y + 4}>Earth</text>
          <text x={m.x - 10} y={m.y + 4} textAnchor="end">Mars</text>
          <text x={v.x} y={v.y - 12} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 600 }}>You</text>
        </svg>
        <dl className="kv small">
          <div><dt>Transit</dt><dd>{Math.round((day / TRANSIT_DAYS) * 100)}%</dd></div>
          <div><dt>Link to Earth</dt><dd style={{ fontFamily: 'var(--font-ui)' }}>{LINK_LABEL[w.link]}</dd></div>
          <div><dt>Answer from Earth</dt><dd style={{ fontFamily: 'var(--font-ui)' }}>{LINK_DELAY_MIN[w.link] === null ? 'None until link returns' : `${2 * (LINK_DELAY_MIN[w.link] ?? 0)} min or more`}</dd></div>
        </dl>
      </div>
      <p className="note" style={{ padding: '0 14px 12px', marginTop: 0 }}>Dashed line: signal path to Earth. Simplified, coplanar orbits.</p>
    </section>
  );
}

// ---------------------------------------------------------------- solar events (FR-02)

function SolarEvents() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const [tab, setTab] = useState<'replay' | 'live'>('replay');
  const seen = REPLAY.filter((r) => r.t <= w.t && w.t - r.t < 3 * MIN_PER_DAY).reverse();
  return (
    <section className="region" aria-labelledby="wx-h">
      <div className="rh">
        <h2 id="wx-h">Solar events, NASA DONKI</h2>
        <span className="aside">
          <Segmented<'replay' | 'live'> size="sm" label="Data source" value={tab} onChange={setTab}
            options={[{ value: 'replay', label: 'Replay' }, { value: 'live', label: 'Live' }]} />
        </span>
      </div>
      <div className="rb">
        {tab === 'replay' ? (
          <>
            <p className="small muted" style={{ marginBottom: 6 }}>
              DONKI logs events near Earth. It can give Advisory or Caution, never Warning. <button className="linkish" onClick={() => openSource('donki')}>Why</button>
            </p>
            {seen.length === 0 ? <p className="muted">No solar events in the last 3 days.</p> : (
              <ul className="feed">
                {seen.map((r) => (
                  <li key={r.id}>
                    <span className="k">{r.kind}</span>
                    <span>{r.summary}{r.kind === 'SEP' && r.tEnd && w.t < r.tEnd ? <> <Chip level="caution">Active</Chip></> : null}</span>
                    <span className="when">{stamp(r.t)} · {r.id}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="note">{REPLAY_PROVENANCE}</p>
          </>
        ) : <LiveDonki />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- crew timeline (FR-05, OSTPV style)

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
    <section className="region" aria-labelledby="tl-h">
      <div className="rh">
        <h2 id="tl-h">Crew timeline</h2>
        <span className="aside">Tap the health check block to open it</span>
        <span className="aside num" style={{ marginLeft: 12 }}>Day {String(day).padStart(3, '0')}</span>
      </div>
      <div className="tl">
        <div className="tl-inner">
          <div className="tl-hours">
            <span />
            <div className="ticks">{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}</div>
          </div>
          {mission.crew.map((c) => (
            <div key={c.id} className={`tl-row ${c.isUser ? 'me' : ''}`}>
              <div className="who">{c.isUser ? 'You (Crew A)' : `${c.role}, ${c.name}`}</div>
              <div className="tl-track">
                {mission.schedule.map((b, i) => {
                  const s = at(day, b.start);
                  const e = b.end === '24:00' ? d0 + MIN_PER_DAY : at(day, b.end);
                  if (b.kind === 'health' && c.isUser) {
                    return (
                      <button key={i} type="button" className={`blk health ${checkDone ? 'done' : ''}`} style={{ left: pct(s), width: width(s, e) }} onClick={() => go('checkin')} aria-label={`Daily health check, ${checkDone ? 'done' : 'open it'}`}>
                        {checkDone ? '✓' : <Heartbeat size={16} weight="bold" aria-hidden="true" />}
                      </button>
                    );
                  }
                  const kind = b.kind === 'health' ? 'ops' : b.kind;
                  return <div key={i} className={`blk ${kind}`} style={{ left: pct(s), width: width(s, e) }}>{c.isUser || b.kind !== 'health' ? b.label : ''}</div>;
                })}
                {shelters.map((x, i) => <div key={`sh${i}`} className="blk shelter" style={{ left: pct(x.s), width: width(x.s, Math.max(x.e, x.s + 10)) }}>Shelter {duration(x.e - x.s)}</div>)}
                {shelterExt && <div className="blk shelter plan" style={{ left: pct(shelterExt.s), width: width(shelterExt.s, shelterExt.e) }}>until clear</div>}
                {planned && <div className="blk shelter plan" style={{ left: pct(planned.s), width: width(planned.s, planned.e) }}>Shelter (est. 6 h)</div>}
              </div>
            </div>
          ))}
          <div className="tl-now" style={{ left: `calc(22px + 136px + (100% - 44px - 136px) * ${(w.t - d0) / MIN_PER_DAY})` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
