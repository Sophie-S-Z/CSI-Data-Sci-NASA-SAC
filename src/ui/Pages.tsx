import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus, Check, ArrowLeft, ArrowRight, DownloadSimple, Bone, Heart, Eye, Brain, Barbell, Moon } from '@phosphor-icons/react';
import { Segmented } from './Segmented';
import { NumberTicker } from './fx/NumberTicker';
import { DUR, EASE_OUT, SPRING } from './motion';
import rules from '../data/rules.json';
import { LINK_LABEL, VIS_LABEL, VISIBILITY_ORDER, RULES, type LinkState, type LogEntry, type Visibility } from '../engine/world';
import { REPLAY_PROVENANCE } from '../engine/donki';
import { dayOf, stamp, hhmm, duration } from '../engine/time';
import { fmt } from '../engine/units';
import { BODY_RULES, jitter, type BodyFinding, type BodySystem } from '../engine/bodyRules';
import { Chip, Src, sources, useUi } from './common';

// ---------------------------------------------------------------- check-in (FR-05 daily check, FR-10 privacy)

/**
 * Check-in content. The symptom groups follow the main spaceflight risks:
 * early radiation sickness signs, head and eyes (SANS, CO2), and the body.
 * The notes below are team guidance for the demo. They are not a diagnosis.
 */
const GROUPS = [
  { id: 'rad', title: 'Radiation signs', hint: 'Early signs after a high dose. Most days you mark none.', items: ['Nausea', 'Vomiting', 'Diarrhea', 'Fatigue', 'Skin redness', 'Fever'] },
  { id: 'head', title: 'Head, eyes, and air', hint: 'Vision change can be a sign of SANS. A headache with a stuffy head can come from high CO2.', items: ['Headache', 'Blurred near vision', 'Eye pressure', 'Stuffy head', 'Short of breath', 'Dizzy'] },
  { id: 'body', title: 'Body', hint: 'Back pain is common in the first weeks of weightlessness.', items: ['Back pain', 'Muscle soreness', 'Joint pain', 'Bruising', 'Bleeding gums'] },
] as const;

const SCALE5 = { sleep: ['Poor', 'Fair', 'OK', 'Good', 'Great'], mood: ['Low', 'Flat', 'Steady', 'Good', 'High'] };

export function VisibilityPicker({ value, onChange, name }: { value: Visibility; onChange: (v: Visibility) => void; name: string }) {
  return <Segmented<Visibility> label={name} value={value} onChange={onChange} options={VISIBILITY_ORDER.map((v) => ({ value: v, label: VIS_LABEL[v] }))} />;
}

function Stepper({ value, set, min, max, step, unit, label }: { value: number; set: (n: number) => void; min: number; max: number; step: number; unit: string; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => set(Math.max(min, +(value - step).toFixed(1)))}><Minus size={20} weight="bold" /></button>
      <output aria-live="polite"><NumberTicker value={value} digits={step < 1 ? 1 : 0} /> {unit}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => set(Math.min(max, +(value + step).toFixed(1)))}><Plus size={20} weight="bold" /></button>
    </div>
  );
}

function FindingText({ f }: { f: BodyFinding }) {
  return (
    <span className="finding">
      <strong>{f.title}.</strong> {f.text}
      <span className="finding-meta"><span className="num">{f.ruleId}</span> · <Src k={f.source}>{(sources as Record<string, { short: string }>)[f.source]?.short ?? f.source}</Src></span>
    </span>
  );
}

const STEPS = ['Sleep and mood', 'Radiation signs', 'Head, eyes, and air', 'Body and sharing'];

export function CheckInView() {
  const { sim, toast, go } = useUi();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [sleep, setSleep] = useState(6.5);
  const [sleepQ, setSleepQ] = useState(3);
  const [mood, setMood] = useState(3);
  const [pain, setPain] = useState(0);
  const [sym, setSym] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [vis, setVis] = useState<Visibility>('cmo');
  const w = sim.world;
  const recent = w.log.filter((e) => e.kind === 'checkin').slice(-5).reverse();
  const draft = { sleepH: sleep, symptoms: sym, note, sleepQuality: sleepQ, mood, pain };
  const flags = w.bodyFindings(draft).filter((f) => f.system !== 'heart' && f.system !== 'bone');
  const toggle = (x: string) => setSym((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  const goStep = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };

  function save() {
    sim.act({ type: 'checkin', data: draft, visibility: vis });
    toast(flags.some((f) => f.level === 'caution') ? 'Check-in saved. Tell the CMO now.' : `Check-in saved. Shared with: ${VIS_LABEL[vis]}`);
    setSym([]); setNote(''); setStep(0);
    go('console');
  }

  const group = step >= 1 && step <= 3 ? GROUPS[step - 1] : null;

  return (
    <div className="checkin-layout">
      <section className="panel checkin">
        <header>
          <h2>Daily health check</h2>
          <span className="aside num">Step {step + 1} of {STEPS.length}</span>
        </header>
        <div className="body">
          <ol className="ci-steps" aria-label="Check-in steps">
            {STEPS.map((t, i) => (
              <li key={t}>
                <button type="button" className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => goStep(i)}>
                  <span className="num">{i + 1}</span>{t}
                  {i === step && <motion.span layoutId="ci-step" className="ci-step-bar" transition={SPRING} />}
                </button>
              </li>
            ))}
          </ol>
          <div className="ci-stage">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div key={step} custom={dir}
                initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -16, transition: { duration: DUR.fast } }}
                transition={{ duration: DUR.slow, ease: EASE_OUT }}>
                {step === 0 && (
                  <>
                    <div className="field"><span className="lbl">Sleep last night</span><Stepper value={sleep} set={setSleep} min={0} max={12} step={0.5} unit="h" label="Sleep" /></div>
                    <div className="field"><span className="lbl">Sleep quality</span>
                      <Segmented<string> label="Sleep quality" value={String(sleepQ)} onChange={(v) => setSleepQ(+v)} options={SCALE5.sleep.map((l, i) => ({ value: String(i + 1), label: l }))} /></div>
                    <div className="field"><span className="lbl">Mood now</span>
                      <Segmented<string> label="Mood" value={String(mood)} onChange={(v) => setMood(+v)} options={SCALE5.mood.map((l, i) => ({ value: String(i + 1), label: l }))} /></div>
                  </>
                )}
                {group && (
                  <div className="field">
                    <span className="lbl">{group.title}</span>
                    <span className="faint" style={{ fontSize: 13.5 }}>{group.hint}</span>
                    <div className="toggles">
                      {group.items.map((x) => (
                        <motion.button key={x} type="button" className="btn tog" aria-pressed={sym.includes(x)} onClick={() => toggle(x)} whileTap={{ scale: 0.97 }}>
                          <motion.span className="tog-check" initial={false} animate={{ scale: sym.includes(x) ? 1 : 0, opacity: sym.includes(x) ? 1 : 0 }} transition={SPRING} aria-hidden="true"><Check size={16} weight="bold" /></motion.span>
                          {x}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}
                {step === 3 && (
                  <>
                    <div className="field"><span className="lbl">Pain level</span><Stepper value={pain} set={setPain} min={0} max={10} step={1} unit="of 10" label="Pain" /></div>
                    <div className="field"><label htmlFor="note">Note (optional)</label>
                      <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the CMO should know" /></div>
                    <div className="field"><span className="lbl">Who can see this entry</span>
                      <VisibilityPicker value={vis} onChange={setVis} name="Who can see this entry" />
                      <span className="faint" style={{ fontSize: 13 }}>
                        {vis === 'private' ? 'Only you. It never leaves the vehicle.' : vis === 'cmo' ? 'You and the CMO.' : vis === 'crew' ? 'The whole crew. Not the ground.' : 'The crew and the ground summary.'}
                      </span></div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="ci-nav">
            <button className="btn" disabled={step === 0} onClick={() => goStep(step - 1)}><ArrowLeft size={18} aria-hidden="true" />Back</button>
            {step < STEPS.length - 1
              ? <button className="btn primary" onClick={() => goStep(step + 1)}>Next<ArrowRight size={18} aria-hidden="true" /></button>
              : <button className="btn primary" onClick={save}><Check size={18} weight="bold" aria-hidden="true" />Save check-in</button>}
          </div>
        </div>
      </section>
      <aside className="ci-side">
        <section className="panel">
          <header><h2>What the tool sees</h2><span className="aside">{sym.length} marked</span></header>
          <div className="body">
            {flags.length === 0
              ? <p className="muted" style={{ margin: 0 }}>No notes. Marked symptoms appear here with the next step to take.</p>
              : (
                <ul className="flags">
                  <AnimatePresence initial={false}>
                    {flags.map((f) => (
                      <motion.li key={f.ruleId} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: DUR.fast } }}>
                        <Chip level={f.level} />
                        <FindingText f={f} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>Rules B-RAD1 to B-B2 use team values. The tool gives advice. It does not diagnose.</p>
          </div>
        </section>
        <section className="panel">
          <header><h2>Your recent check-ins</h2></header>
          <div className="body">
            {recent.length === 0 ? <p className="muted" style={{ margin: 0 }}>No check-ins yet. The daily check is on your timeline at 07:00.</p> : (
              <ul className="log">{recent.map((e) => <LogRow key={e.seq} e={e} />)}</ul>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- log (NFR-07)

function LogRow({ e }: { e: LogEntry }) {
  const { sim } = useUi();
  const w = sim.world;
  const vis = w.visibilityOf(e);
  const canShare = e.kind === 'checkin' || e.kind === 'action';
  return (
    <li>
      <span className="when">{stamp(e.t)}</span>
      <div className="what">
        <div>{e.level ? <Chip level={e.level} /> : e.kind === 'clear' ? <Chip level="clear" /> : <span className="tag" style={{ borderStyle: 'solid', color: 'var(--muted)', borderColor: 'var(--line)' }}>{e.kind}</span>} {e.text}</div>
        {e.inputs && <div className="inputs">{Object.entries(e.inputs).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div>}
        {e.summary && (
          <div className="inputs"><span>Sent {stamp(e.summary.sentT)}</span><span>{e.summary.arriveT === null ? 'Queued until the link returns' : `Arrives ${hhmm(e.summary.arriveT)}`}</span></div>
        )}
      </div>
      <div className="vis">
        {canShare ? (
          <select aria-label={`Who can see entry ${e.seq}`} value={vis} onChange={(ev) => sim.act({ type: 'visibility', seq: e.seq, visibility: ev.target.value as Visibility })}>
            {VISIBILITY_ORDER.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
          </select>
        ) : <span className="faint" style={{ fontSize: 12.5 }}>{VIS_LABEL[vis]}</span>}
      </div>
    </li>
  );
}

export function LogView() {
  const { sim } = useUi();
  const w = sim.world;
  const [f, setF] = useState<'all' | 'alerts' | 'actions' | 'checkins' | 'ground'>('all');
  const rows = w.log.filter((e) => e.kind !== 'visibility').filter((e) =>
    f === 'all' ? true : f === 'alerts' ? ['alert', 'clear', 'advisory'].includes(e.kind) : f === 'actions' ? e.kind === 'action' : f === 'checkins' ? e.kind === 'checkin' : e.kind === 'summary' || e.kind === 'system');
  const byDay = w.cautionWarningByDay();
  const days = Array.from({ length: dayOf(w.t) - dayOf(w.startT) + 1 }, (_, i) => dayOf(w.startT) + i);
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);

  function download() {
    const blob = new Blob([JSON.stringify(w.log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `storm-shelter-log-day${dayOf(w.t)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="page-head">
        <h1>Event log</h1>
        <p>Append-only. Each entry has a time, the rule, the inputs, and the crew action.</p>
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={download}><DownloadSimple size={16} aria-hidden="true" />Export log as JSON</button>
      </div>
      <section className="panel" style={{ marginBottom: 16 }}>
        <header><h2>Alarm burden</h2><span className="aside">Metric M-3: 3 or fewer per 7 days</span></header>
        <div className="body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {days.map((d) => (
            <div key={d} className="count" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '6px 12px' }}>
              <span className="faint num" style={{ fontSize: 12 }}>Day {d}</span>
              <b>{byDay.get(d) ?? 0}</b>
            </div>
          ))}
          <p style={{ margin: '0 0 0 8px' }}><strong className="num">{total}</strong> Caution or Warning {total === 1 ? 'event' : 'events'} in {days.length} simulated days.</p>
        </div>
      </section>
      <div className="filters">
        <Segmented<typeof f> label="Filter the log" value={f} onChange={setF}
          options={[{ value: 'all', label: 'All' }, { value: 'alerts', label: 'Alerts' }, { value: 'actions', label: 'Actions' }, { value: 'checkins', label: 'Check-ins' }, { value: 'ground', label: 'Link and summaries' }]} />
      </div>
      <section className="panel"><div className="body">
        {rows.length === 0 ? <p className="muted">No entries match this filter yet.</p> : (
          <ul className="log">
            <AnimatePresence initial={false}>
              {[...rows].reverse().slice(0, 200).map((e) => (
                <motion.div key={e.seq} layout="position" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
                  <LogRow e={e} />
                </motion.div>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div></section>
    </>
  );
}

// ---------------------------------------------------------------- CMO (FR-12, FR-13)

export function CmoView() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const ev = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && (a.peak === 'caution' || a.peak === 'warning'));
  const shared = w.log.filter((e) => e.kind === 'checkin' && w.visibilityOf(e) !== 'private');
  const hidden = w.log.filter((e) => e.kind === 'checkin' && w.visibilityOf(e) === 'private').length;
  const lastShared = shared[shared.length - 1];
  const poorSleep = lastShared?.checkin && lastShared.checkin.sleepH < 6;
  const infectionWatch = ev && ev.eventDoseMSv > 1 && poorSleep;

  return (
    <>
      <div className="page-head"><h1>CMO case view</h1><p>The CMO sees only the entries that the crew member shares.</p></div>
      {!ev ? <div className="notice">No Caution or Warning event in this replay yet. The case view opens when one starts.</div> : (
        <div className="two">
          <section className="panel">
            <header><h2>{ev.id}</h2><span className="aside"><Chip level={ev.peak}>Peak: {ev.peak[0].toUpperCase() + ev.peak.slice(1)}</Chip></span></header>
            <div className="body">
              <dl className="kv">
                <div><dt>Opened</dt><dd>{stamp(ev.openedAt)}</dd></div>
                <div><dt>Status</dt><dd>{ev.closedAt ? `Clear at ${stamp(ev.closedAt)}` : `Active, ${ev.level}`}</dd></div>
                <div><dt>Event dose, Crew A</dt><dd>{fmt(ev.eventDoseMSv, 1)}<small>mSv</small></dd></div>
                <div><dt>Time in shelter</dt><dd>{ev.shelterMin ? duration(ev.shelterMin) : 'None'}</dd></div>
                <div><dt>Dose saved (estimate)</dt><dd>{fmt(ev.savedMSv, 1)}<small>mSv</small></dd></div>
                <div><dt>Data quality now</dt><dd>{ev.quality}</dd></div>
              </dl>
              <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Level history</h3>
              <ul className="log">
                {ev.history.map((h, i) => (
                  <li key={i}><span className="when">{stamp(h.t)}</span><div className="what"><div>{h.level === 'clear' ? <Chip level="clear" /> : <Chip level={h.level} />} {h.reason}</div></div><button className="linkish" onClick={() => openSource(h.ruleId)}>{h.ruleId}</button></li>
                ))}
              </ul>
            </div>
          </section>
          <section className="panel">
            <header><h2>Shared symptoms</h2><span className="aside">{hidden ? `${hidden} private ${hidden === 1 ? 'entry' : 'entries'} not shown` : ''}</span></header>
            <div className="body">
              {infectionWatch && (
                <div className="mini-alert" style={{ marginBottom: 12 }}>
                  <Chip level="advisory" />
                  <span className="txt"><strong>Infection watch.</strong> Event dose plus short sleep ({lastShared!.checkin!.sleepH} h). Watch for signs of infection. Evidence level: emerging (animal and organ-chip studies; herpesvirus shedding in 61% of ISS crew, n = 23).</span>
                </div>
              )}
              {shared.length === 0 ? <p className="muted">No shared check-ins.</p> : (
                <ul className="log">{[...shared].reverse().map((e) => (
                  <li key={e.seq}><span className="when">{stamp(e.t)}</span><div className="what"><div>{e.text}</div></div><span className="faint" style={{ fontSize: 12.5 }}>{VIS_LABEL[w.visibilityOf(e)]}</span></li>
                ))}</ul>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ground (FR-07, FR-11)

export function GroundView() {
  const { sim, toast } = useUi();
  const w = sim.world;
  const summaries = w.log.filter((e) => e.kind === 'summary').reverse();
  return (
    <>
      <div className="page-head"><h1>Link to Earth</h1><p>No step waits for the ground. Private entries never leave the vehicle.</p></div>
      <div className="two">
        <section className="panel">
          <header><h2>Link state</h2></header>
          <div className="body">
            <LinkSwitch />
            <p className="muted" style={{ fontSize: 14 }}>When the link returns from a blackout, the app builds a summary for the flight surgeon. It holds only entries shared with Ground.</p>
            <button className="btn primary" onClick={() => { sim.act({ type: 'summary' }); toast('Ground summary built'); }}>Build summary now</button>
          </div>
        </section>
        <section className="panel">
          <header><h2>What the flight surgeon sees</h2></header>
          <div className="body">
            {summaries.length === 0 ? <p className="muted">No summary yet. Set the link to Offline, then back to Delayed or Live.</p> : summaries.map((s) => (
              <div key={s.seq} className="summary-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong>Summary from {stamp(s.summary!.sentT)}</strong>
                  <span className="muted num" style={{ fontSize: 13 }}>{s.summary!.arriveT === null ? 'Queued' : `Arrives ${hhmm(s.summary!.arriveT)}`}</span>
                </div>
                {s.summary!.lines.length === 0 ? <p className="muted">No shared entries since the last summary.</p> : (
                  <ol>{s.summary!.lines.slice(-12).map((l, i) => <li key={i}><span className="num muted">{hhmm(l.t)}</span> {l.text}</li>)}</ol>
                )}
                {s.summary!.lines.length > 12 && <p className="faint" style={{ fontSize: 12.5 }}>And {s.summary!.lines.length - 12} earlier entries.</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

export function LinkSwitch() {
  const { sim, toast } = useUi();
  const short: Record<LinkState, string> = { live: 'Live', d5: '5 min', d14: '14 min', d22: '22 min', blackout: 'Offline' };
  return (
    <div style={{ marginBottom: 12 }}>
      <Segmented<LinkState> label="Link to Earth" value={sim.world.link} onChange={(o) => { sim.act({ type: 'link', link: o }); toast(`Link: ${LINK_LABEL[o]}`); }}
        options={(['live', 'd5', 'd14', 'd22', 'blackout'] as LinkState[]).map((o) => ({ value: o, label: short[o] }))} />
    </div>
  );
}

// ---------------------------------------------------------------- sources (FR-06)

export function SourcesView() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  return (
    <>
      <div className="page-head"><h1>Rules and sources</h1><p>{rules.note}</p></div>
      <section className="panel" style={{ marginBottom: 16, overflowX: 'auto' }}>
        <div className="body">
          <table className="rules">
            <thead><tr><th>Rule</th><th>Level</th><th>Trigger (any line is enough)</th><th>Crew action</th><th>State</th></tr></thead>
            <tbody>
              {rules.rules.map((r) => (
                <tr key={r.id}>
                  <td><button className="linkish num" onClick={() => openSource(r.id)}>{r.id}</button></td>
                  <td><Chip level={r.level as 'advisory'} /></td>
                  <td><ul>{r.triggers.map((t, i) => <li key={i}>{t}</li>)}</ul></td>
                  <td>{r.action}</td>
                  <td>
                    {w.inhibited.has(r.id)
                      ? <button className="btn small" onClick={() => sim.act({ type: 'enable', ruleId: r.id })}>Enable</button>
                      : <button className="btn small" onClick={() => sim.act({ type: 'inhibit', ruleId: r.id })}>Inhibit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Baseline B: <Src k="B">{rules.baselines.cruise.mSvPerHour} mSv/h in cruise</Src>. Clear rules: a Warning clears when all sensors stay below 3 × B for 2 h. A Caution clears when the SEP record ends and the sensors stay below 3 × B for 1 h. {RULES['R-W1'].basis}
          </p>
        </div>
      </section>
      <section className="panel">
        <header><h2>Citations</h2></header>
        <div className="body">
          <ul className="log">
            {Object.entries(sources).map(([k, s]) => (
              <li key={k}><span className="when">{s.short}</span><div className="what"><div>{s.citation}</div><div className="faint" style={{ fontSize: 13 }}>{s.evidence}</div></div>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">Open</a> : <span />}</li>
            ))}
          </ul>
          <p className="faint" style={{ fontSize: 12.5 }}>Replay data: {REPLAY_PROVENANCE}</p>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- systems (FR-14)

/** Small sparkline for a trend card. */
function Spark({ values, min, max, unit }: { values: number[]; min: number; max: number; unit: string }) {
  const W = 220, H = 56;
  const xs = (i: number) => (i / Math.max(1, values.length - 1)) * (W - 8) + 4;
  const ys = (v: number) => H - 6 - ((v - min) / (max - min || 1)) * (H - 12);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="spark" role="img" aria-label={`Trend, last value ${values[values.length - 1]?.toFixed(1)} ${unit}`}>
      <motion.path d={d} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: EASE_OUT }} />
      
    </svg>
  );
}

/** Repeatable noise for the simulated trends. */

const CARD_SYSTEMS: Record<string, BodySystem[]> = {
  sleep: ['sleep'], mood: ['mood'], bone: ['bone', 'blood'], heart: ['heart'], eyes: ['vision', 'air'], muscle: ['bone'],
};

function TileRules({ system, findings }: { system: BodySystem[]; findings: BodyFinding[] }) {
  const mine = findings.filter((f) => system.includes(f.system));
  const rules = BODY_RULES.filter((r) => system.includes(r.system));
  return (
    <div className="tile-rules">
      <AnimatePresence initial={false} mode="popLayout">
        {mine.length === 0
          ? <motion.p key="ok" className="tile-ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Chip level="nominal">In range</Chip></motion.p>
          : mine.map((f) => (
            <motion.div key={f.ruleId} className="tile-finding" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
              <Chip level={f.level} />
              <span>{f.why}</span>
            </motion.div>
          ))}
      </AnimatePresence>
      <p className="tile-rule-ids faint">Rules: {rules.map((r) => r.id).join(', ')}</p>
    </div>
  );
}

export function SystemsView() {
  const { sim } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const days = Array.from({ length: 8 }, (_, i) => day - 7 + i);
  const checks = w.log.filter((e) => e.kind === 'checkin' && e.checkin && w.visibilityOf(e) !== 'private');
  const sleepFor = (d: number, i: number) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.sleepH ?? 6.6 + jitter(i, 1) * 1.2;
  const moodFor = (d: number, i: number) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.mood ?? 3.4 + jitter(i, 2);
  const sleep = days.map(sleepFor);
  const mood = days.map(moodFor);
  const bone = days.map((d) => -(d / 30) * 1.1);
  const input = w.bodyInput();
  const hr = input.hr;
  const exercise = input.exercise;
  const findings = w.bodyFindings();
  const cards = [
    { id: 'sleep', Icon: Moon, title: 'Sleep', value: sleep[7], unit: 'h', digits: 1, data: sleep, min: 3, max: 9, note: 'From your check-ins. Days with no check-in show simulated values.', cls: 'wide' },
    { id: 'mood', Icon: Brain, title: 'Mood', value: mood[7], unit: 'of 5', digits: 1, data: mood, min: 1, max: 5, note: 'Isolation and confinement change mood over months. Shared check-ins only.', cls: 'tall' },
    { id: 'bone', Icon: Bone, title: 'Bone (hip)', value: bone[7], unit: '% since launch', digits: 1, data: bone, min: bone[0] - 0.4, max: bone[7] + 0.4, note: 'About 1 to 1.5% of hip bone mass per month in weightlessness. Simulated.', cls: '' },
    { id: 'heart', Icon: Heart, title: 'Resting heart rate', value: hr[7], unit: 'bpm', digits: 0, data: hr, min: 48, max: 76, note: 'Simulated. A stress response can raise it during an event.', cls: '' },
    { id: 'eyes', Icon: Eye, title: 'Eyes (SANS)', value: 0, unit: 'changes logged', digits: 0, data: [], min: 0, max: 1, note: 'Mark "Blurred near vision" in the check-in. The CMO sees it.', cls: '' },
    { id: 'muscle', Icon: Barbell, title: 'Exercise', value: exercise[7], unit: 'min per day', digits: 0, data: exercise, min: 30, max: 110, note: 'From the crew timeline. Exercise protects bone and muscle.', cls: '' },
  ];
  const vision = checks.filter((e) => e.checkin?.symptoms.some((x) => x === 'Blurred near vision' || x === 'Eye pressure')).length;
  cards[4].value = vision;
  return (
    <>
      <div className="page-head"><h1>Body systems</h1><p>Each card shows its rules and where its data comes from. Body rules give Advisory or Caution only. They do not count toward the radiation alarm limit.</p></div>
      <motion.div className="bento" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
        {cards.map(({ id, Icon, title, value, unit, digits, data, min, max, note, cls }) => (
          <motion.section key={id} className={`panel tile ${cls}`} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } } }}>
            <header><Icon size={20} aria-hidden="true" /><h2>{title}</h2><span className="aside"><span className="tag">{id === 'sleep' || id === 'mood' || id === 'eyes' ? 'Check-ins' : 'Simulated'}</span></span></header>
            <div className="body">
              <div className="tile-value"><NumberTicker value={value} digits={digits} /><small>{unit}</small></div>
              {data.length > 0 && <Spark values={data} min={min} max={max} unit={unit} />}
              <p className="tile-note">{note}</p>
              <TileRules system={CARD_SYSTEMS[id]} findings={findings} />
            </div>
          </motion.section>
        ))}
      </motion.div>
    </>
  );
}
