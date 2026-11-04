import { useState } from 'react';
import { Minus, Plus, Check, DownloadSimple } from '@phosphor-icons/react';
import { Segmented } from './Segmented';
import rules from '../data/rules.json';
import { LINK_LABEL, VIS_LABEL, VISIBILITY_ORDER, RULES, type LinkState, type LogEntry, type Visibility } from '../engine/world';
import { REPLAY_PROVENANCE } from '../engine/donki';
import { dayOf, stamp, hhmm, duration } from '../engine/time';
import { fmt } from '../engine/units';
import { BODY_RULES, jitter, type BodyFinding, type BodySystem } from '../engine/bodyRules';
import { Chip, Src, sources, useUi } from './common';

// ---------------------------------------------------------------- health check (FR-05, FR-10)

/**
 * One page, no wizard: a normal day takes about 30 s. The symptom groups follow the
 * main spaceflight risks. The hints are team guidance for the demo, not a diagnosis.
 */
const GROUPS = [
  { id: 'rad', title: 'Radiation signs', hint: 'Early signs after a high dose. Most days you mark none.', items: ['Nausea', 'Vomiting', 'Diarrhea', 'Fatigue', 'Skin redness', 'Fever'] },
  { id: 'head', title: 'Head, eyes, and air', hint: 'Vision change can be a sign of SANS. Headache with a stuffy head can come from high CO2.', items: ['Headache', 'Blurred near vision', 'Eye pressure', 'Stuffy head', 'Short of breath', 'Dizzy'] },
  { id: 'body', title: 'Body', hint: 'Back pain is common in the first weeks of weightlessness.', items: ['Back pain', 'Muscle soreness', 'Joint pain', 'Bruising', 'Bleeding gums'] },
] as const;

const SCALE5 = { sleep: ['Poor', 'Fair', 'OK', 'Good', 'Great'], mood: ['Low', 'Flat', 'Steady', 'Good', 'High'] };

const VIS_HELP: Record<Visibility, string> = {
  private: 'Only you. It never leaves this vehicle.',
  cmo: 'You and the CMO.',
  crew: 'The whole crew. Not the ground.',
  ground: 'The crew, and the ground summary.',
};

export function VisibilityPicker({ value, onChange, name }: { value: Visibility; onChange: (v: Visibility) => void; name: string }) {
  return <Segmented<Visibility> label={name} value={value} onChange={onChange} options={VISIBILITY_ORDER.map((v) => ({ value: v, label: VIS_LABEL[v] }))} />;
}

function Stepper({ value, set, min, max, step, unit, label }: { value: number; set: (n: number) => void; min: number; max: number; step: number; unit: string; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => set(Math.max(min, +(value - step).toFixed(1)))}><Minus size={18} weight="bold" /></button>
      <output aria-live="polite">{step < 1 ? value.toFixed(1) : value} {unit}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => set(Math.min(max, +(value + step).toFixed(1)))}><Plus size={18} weight="bold" /></button>
    </div>
  );
}

function Finding({ f }: { f: BodyFinding }) {
  return (
    <li>
      <div><Chip level={f.level} /> <strong>{f.title}.</strong> {f.text}</div>
      <div className="meta">Seen: {f.why} · Rule <Src k={f.ruleId}>{f.ruleId}</Src> · <Src k={f.source}>{(sources as Record<string, { short: string }>)[f.source]?.short ?? f.source}</Src></div>
    </li>
  );
}

export function CheckInView() {
  const { sim, note, go } = useUi();
  const [sleep, setSleep] = useState(6.5);
  const [sleepQ, setSleepQ] = useState(3);
  const [mood, setMood] = useState(3);
  const [pain, setPain] = useState(0);
  const [sym, setSym] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [vis, setVis] = useState<Visibility>('cmo');
  const w = sim.world;
  const recent = w.log.filter((e) => e.kind === 'checkin').slice(-5).reverse();
  const draft = { sleepH: sleep, symptoms: sym, note: text, sleepQuality: sleepQ, mood, pain };
  const flags = w.bodyFindings(draft).filter((f) => f.system !== 'heart' && f.system !== 'bone');
  const toggle = (x: string) => setSym((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  const doneToday = w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === dayOf(w.t));

  function save() {
    sim.act({ type: 'checkin', data: draft, visibility: vis });
    const caution = flags.some((f) => f.level === 'caution');
    note(caution ? 'Check-in saved. A finding needs the CMO now' : `Check-in saved. Shared with: ${VIS_LABEL[vis]}`);
    setSym([]); setText('');
    go('now');
  }

  return (
    <div className="cols">
      <section className="region" aria-labelledby="ci-h">
        <div className="rh">
          <h2 id="ci-h">Daily health check</h2>
          <span className="aside">{doneToday ? 'Done today. You can add another entry.' : 'On your timeline at 07:00'}</span>
        </div>
        <div className="rb form">
          <div className="row">
            <div className="field"><span className="lbl">Sleep last night</span><Stepper value={sleep} set={setSleep} min={0} max={12} step={0.5} unit="h" label="Sleep" /></div>
            <div className="field"><span className="lbl">Sleep quality</span>
              <Segmented<string> label="Sleep quality" value={String(sleepQ)} onChange={(v) => setSleepQ(+v)} options={SCALE5.sleep.map((l, i) => ({ value: String(i + 1), label: l }))} /></div>
            <div className="field"><span className="lbl">Mood now</span>
              <Segmented<string> label="Mood" value={String(mood)} onChange={(v) => setMood(+v)} options={SCALE5.mood.map((l, i) => ({ value: String(i + 1), label: l }))} /></div>
          </div>
          <div className="field">
            <span className="lbl">Symptoms since the last check</span>
            <span className="hint">Mark only what is new or worse. No marks means no symptoms.</span>
            <div className="symptoms">
              {GROUPS.map((g) => (
                <fieldset key={g.id}>
                  <legend>{g.title}</legend>
                  <div className="hint">{g.hint}</div>
                  {g.items.map((x) => (
                    <label key={x} className="check">
                      <input type="checkbox" checked={sym.includes(x)} onChange={() => toggle(x)} />{x}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
          <div className="row">
            <div className="field"><span className="lbl">Pain</span><Stepper value={pain} set={setPain} min={0} max={10} step={1} unit="of 10" label="Pain" /></div>
            <div className="field" style={{ flex: 1, minWidth: 240 }}><label className="lbl" htmlFor="note">Note (optional)</label>
              <textarea id="note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything the CMO should know" /></div>
          </div>
          <div className="field">
            <span className="lbl">Who can see this entry</span>
            <VisibilityPicker value={vis} onChange={setVis} name="Who can see this entry" />
            <span className="vis-help">{VIS_HELP[vis]}</span>
          </div>
          <div className="save-row">
            <button className="btn primary" onClick={save}><Check size={18} weight="bold" aria-hidden="true" />Save check-in</button>
            <span className="muted small">{sym.length === 0 ? 'No symptoms marked.' : `${sym.length} marked: ${sym.join(', ')}.`}</span>
          </div>
        </div>
      </section>
      <div className="stack">
        <section className="region" aria-labelledby="see-h">
          <div className="rh"><h2 id="see-h">What the rules see</h2><span className="aside">Updates as you mark</span></div>
          <div className="rb">
            {flags.length === 0
              ? <p className="muted">No findings. A marked symptom shows here with the next step and its source.</p>
              : <ul className="findings">{flags.map((f) => <Finding key={f.ruleId} f={f} />)}</ul>}
            <p className="note">Body rules give Advisory or Caution only. They use team values. The tool gives advice. It does not diagnose.</p>
          </div>
        </section>
        <section className="region" aria-labelledby="rec-h">
          <div className="rh"><h2 id="rec-h">Your recent check-ins</h2></div>
          <div className="rb flush">
            {recent.length === 0 ? <p className="muted" style={{ padding: '12px 14px' }}>No check-ins yet in this replay.</p> : (
              <ul className="log">{recent.map((e) => <LogRow key={e.seq} e={e} />)}</ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- body systems (FR-14)

function Spark({ values, min, max, label }: { values: number[]; min: number; max: number; label: string }) {
  const W = 120, H = 28;
  if (values.length < 2) return <span className="faint small">No trend</span>;
  const xs = (i: number) => (i / (values.length - 1)) * (W - 6) + 3;
  const ys = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <path d={d} />
      <circle cx={xs(last)} cy={ys(values[last])} r={2.5} />
    </svg>
  );
}

const SYSTEM_ROWS: { id: string; title: string; systems: BodySystem[]; from: string; risk: string }[] = [
  { id: 'sleep', title: 'Sleep', systems: ['sleep'], from: 'Check-ins', risk: 'Sleep loss and circadian change' },
  { id: 'mood', title: 'Mood', systems: ['mood'], from: 'Check-ins (shared)', risk: 'Behavioral health' },
  { id: 'eyes', title: 'Eyes (SANS)', systems: ['vision'], from: 'Check-ins', risk: 'Neuro-ocular syndrome' },
  { id: 'air', title: 'Air (CO2 signs)', systems: ['air'], from: 'Check-ins', risk: 'Cabin CO2 exposure' },
  { id: 'heart', title: 'Resting heart rate', systems: ['heart'], from: 'Simulated', risk: 'Cardiovascular change' },
  { id: 'exercise', title: 'Exercise', systems: ['bone'], from: 'Simulated timeline', risk: 'Bone and muscle loss' },
  { id: 'bone', title: 'Bone (hip)', systems: [], from: 'Simulated', risk: 'Bone loss' },
  { id: 'rad', title: 'Radiation signs', systems: ['radiation', 'blood'], from: 'Check-ins and dose', risk: 'Acute radiation effects' },
];

export function BodyView() {
  const { sim } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const days = Array.from({ length: 8 }, (_, i) => day - 7 + i);
  const checks = w.log.filter((e) => e.kind === 'checkin' && e.checkin && w.visibilityOf(e) !== 'private');
  const sleepFor = (d: number, i: number) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.sleepH ?? 6.6 + jitter(i, 1) * 1.2;
  const moodFor = (d: number, i: number) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.mood ?? 3.4 + jitter(i, 2);
  const input = w.bodyInput();
  const findings = w.bodyFindings();
  const vision = checks.filter((e) => e.checkin?.symptoms.some((x) => x === 'Blurred near vision' || x === 'Eye pressure')).length;
  const co2 = checks.filter((e) => e.checkin?.symptoms.includes('Headache')).length;
  const sleep = days.map(sleepFor);
  const mood = days.map(moodFor);
  const bone = days.map((d) => -(d / 30) * 1.1);

  const data: Record<string, { latest: string; trend?: number[]; min?: number; max?: number }> = {
    sleep: { latest: `${fmt(sleep[7], 1)} h`, trend: sleep, min: 3, max: 9 },
    mood: { latest: `${fmt(mood[7], 1)} of 5`, trend: mood, min: 1, max: 5 },
    eyes: { latest: `${vision} logged` },
    air: { latest: `${co2} headaches logged` },
    heart: { latest: `${input.hr[7]} bpm`, trend: input.hr, min: 45, max: 80 },
    exercise: { latest: `${input.exercise[7]} min/day`, trend: input.exercise, min: 20, max: 110 },
    bone: { latest: `${fmt(bone[7], 1)}% since launch`, trend: bone, min: bone[0] - 0.4, max: bone[7] + 0.4 },
    rad: { latest: `${fmt(w.missionDoseMSv, 0)} mSv mission` },
  };

  return (
    <>
      <div className="page-head">
        <h1>Body systems</h1>
        <p>One row for each risk that the challenge names. Body rules give Advisory or Caution only. Radiation stays the only Warning.</p>
      </div>
      <section className="region">
        <div className="rb flush scroll-x">
          <table className="tbl">
            <thead><tr><th>System</th><th>NASA risk</th><th className="r">Latest</th><th>8 days</th><th>Data from</th><th>Status</th><th>Rules</th></tr></thead>
            <tbody>
              {SYSTEM_ROWS.map((r) => {
                const mine = findings.filter((f) => r.systems.includes(f.system));
                const ruleIds = BODY_RULES.filter((b) => r.systems.includes(b.system)).map((b) => b.id);
                const d = data[r.id];
                const top = mine.find((f) => f.level === 'caution') ?? mine[0];
                return (
                  <tr key={r.id} className={top?.level === 'caution' ? 'c' : ''}>
                    <td><strong>{r.title}</strong></td>
                    <td className="muted">{r.risk}</td>
                    <td className="num r">{d.latest}</td>
                    <td>{d.trend ? <Spark values={d.trend} min={d.min!} max={d.max!} label={`${r.title}, 8-day trend`} /> : <span className="faint small">Event log</span>}</td>
                    <td>{r.from.startsWith('Simulated') ? <span className="tag">{r.from}</span> : r.from}</td>
                    <td>{top ? <><Chip level={top.level} /> <span className="small">{top.why}</span></> : <Chip level="nominal">In range</Chip>}</td>
                    <td className="num small">{ruleIds.length ? ruleIds.map((id, i) => <span key={id}>{i ? ', ' : ''}<Src k={id}>{id}</Src></span>) : <span className="faint">None</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="note">Bone loss uses about 1 to 1.5% of hip bone mass per month in weightlessness (simulated). Days with no check-in show simulated values for sleep and mood. Private check-ins are left out.</p>
    </>
  );
}

// ---------------------------------------------------------------- log (NFR-07)

function LogRow({ e }: { e: LogEntry }) {
  const { sim, note } = useUi();
  const w = sim.world;
  const vis = w.visibilityOf(e);
  const canShare = e.kind === 'checkin' || e.kind === 'action';
  return (
    <li>
      <span className="when">{stamp(e.t)}</span>
      <div>
        <div>{e.level ? <Chip level={e.level} /> : e.kind === 'clear' ? <Chip level="clear" /> : <span className="kind">{e.kind}</span>} {e.text}</div>
        {e.inputs && <div className="inputs">{Object.entries(e.inputs).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div>}
        {e.summary && <div className="inputs"><span>Sent {stamp(e.summary.sentT)}</span><span>{e.summary.arriveT === null ? 'Queued until the link returns' : `Arrives ${hhmm(e.summary.arriveT)}`}</span></div>}
      </div>
      <div>
        {canShare ? (
          <select aria-label={`Who can see entry ${e.seq}`} value={vis} onChange={(ev) => { sim.act({ type: 'visibility', seq: e.seq, visibility: ev.target.value as Visibility }); note(`Entry ${e.seq} shared with: ${VIS_LABEL[ev.target.value as Visibility]}`); }}>
            {VISIBILITY_ORDER.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
          </select>
        ) : <span className="faint small">{VIS_LABEL[vis]}</span>}
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
        <button className="btn sm end" onClick={download}><DownloadSimple size={16} aria-hidden="true" />Export as JSON</button>
      </div>
      <section className="region" aria-labelledby="burden-h" style={{ marginBottom: 14 }}>
        <div className="rh"><h2 id="burden-h">Alarm burden</h2><span className="aside">Metric M-3: 3 or fewer Caution or Warning events per 7 days</span></div>
        <div className="rb" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="burden">
            {days.map((d) => {
              const n = byDay.get(d) ?? 0;
              return <div key={d}><div className="d">D{d}</div><div className={`v ${n ? 'hit' : ''}`}>{n}</div></div>;
            })}
          </div>
          <p><strong className="num">{total}</strong> Caution or Warning {total === 1 ? 'event' : 'events'} in {days.length} simulated days.</p>
        </div>
      </section>
      <div className="filters">
        <Segmented<typeof f> label="Filter the log" value={f} onChange={setF}
          options={[{ value: 'all', label: 'All' }, { value: 'alerts', label: 'Alerts' }, { value: 'actions', label: 'Actions' }, { value: 'checkins', label: 'Check-ins' }, { value: 'ground', label: 'Link' }]} />
      </div>
      <section className="region">
        {rows.length === 0 ? <p className="muted" style={{ padding: 14 }}>No entries match this filter yet.</p> : (
          <ul className="log">{[...rows].reverse().slice(0, 200).map((e) => <LogRow key={e.seq} e={e} />)}</ul>
        )}
      </section>
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
      <div className="page-head"><h1>CMO case view</h1><p>For the Crew Medical Officer. It shows only the entries that the crew member shares.</p></div>
      {!ev ? <div className="notice">No Caution or Warning event in this replay yet. The case view fills when one starts.</div> : (
        <div className="cols">
          <section className="region">
            <div className="rh"><h2>{ev.id}</h2><span className="aside"><Chip level={ev.peak}>Peak: {ev.peak[0].toUpperCase() + ev.peak.slice(1)}</Chip></span></div>
            <div className="rb">
              <dl className="kv">
                <div><dt>Opened</dt><dd>{stamp(ev.openedAt)}</dd></div>
                <div><dt>Status</dt><dd>{ev.closedAt ? `Clear at ${stamp(ev.closedAt)}` : `Active, ${ev.level}`}</dd></div>
                <div><dt>Event dose, Crew A</dt><dd>{fmt(ev.eventDoseMSv, 1)}<small>mSv</small></dd></div>
                <div><dt>Time in shelter</dt><dd>{ev.shelterMin ? duration(ev.shelterMin) : 'None'}</dd></div>
                <div><dt>Dose saved (estimate)</dt><dd>{fmt(ev.savedMSv, 1)}<small>mSv</small></dd></div>
                <div><dt>Data quality now</dt><dd>{ev.quality}</dd></div>
              </dl>
            </div>
            <div className="rb flush">
              <ul className="log">
                {ev.history.map((h, i) => (
                  <li key={i}><span className="when">{stamp(h.t)}</span><div>{h.level === 'clear' ? <Chip level="clear" /> : <Chip level={h.level} />} {h.reason}</div><button className="linkish num small" onClick={() => openSource(h.ruleId)}>{h.ruleId}</button></li>
                ))}
              </ul>
            </div>
          </section>
          <section className="region">
            <div className="rh"><h2>Shared symptoms</h2><span className="aside">{hidden ? `${hidden} private ${hidden === 1 ? 'entry' : 'entries'} not shown` : ''}</span></div>
            <div className="rb">
              {infectionWatch && (
                <p className="waiver" style={{ marginTop: 0, marginBottom: 10 }}>
                  <Chip level="advisory" /> <strong>Infection watch.</strong> Event dose plus short sleep ({lastShared!.checkin!.sleepH} h). Watch for signs of infection. Evidence: emerging (animal and organ-chip studies; herpesvirus shedding in 61% of ISS crew, n = 23).
                </p>
              )}
              {shared.length === 0 ? <p className="muted">No shared check-ins.</p> : (
                <ul className="findings">{[...shared].reverse().map((e) => (
                  <li key={e.seq}><span className="num small muted">{stamp(e.t)} · {VIS_LABEL[w.visibilityOf(e)]}</span><span>{e.text}</span></li>
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
  const { sim, note } = useUi();
  const w = sim.world;
  const summaries = w.log.filter((e) => e.kind === 'summary').reverse();
  return (
    <>
      <div className="page-head"><h1>Link to Earth</h1><p>No step waits for the ground. Private entries never leave the vehicle.</p></div>
      <div className="cols">
        <section className="region">
          <div className="rh"><h2>What the flight surgeon sees</h2></div>
          <div className="rb">
            {summaries.length === 0 ? <p className="muted">No summary yet. Set the link to Offline, then back to Delayed or Live.</p> : summaries.map((s) => (
              <div key={s.seq} className="summary-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong>Summary from {stamp(s.summary!.sentT)}</strong>
                  <span className="muted num small">{s.summary!.arriveT === null ? 'Queued' : `Arrives ${hhmm(s.summary!.arriveT)}`} · {s.summary!.withheld} kept on board</span>
                </div>
                {s.summary!.lines.length === 0 ? <p className="muted">No shared entries since the last summary.</p> : (
                  <ol>{s.summary!.lines.slice(-12).map((l, i) => <li key={i}><span className="num muted">{hhmm(l.t)}</span> {l.text}</li>)}</ol>
                )}
                {s.summary!.lines.length > 12 && <p className="note">And {s.summary!.lines.length - 12} earlier entries.</p>}
              </div>
            ))}
          </div>
        </section>
        <section className="region">
          <div className="rh"><h2>Link state</h2></div>
          <div className="rb form">
            <Segmented<LinkState> label="Link to Earth" value={w.link} onChange={(o) => { sim.act({ type: 'link', link: o }); note(`Link set to ${LINK_LABEL[o].toLowerCase()}`); }}
              options={(['live', 'd5', 'd14', 'd22', 'blackout'] as LinkState[]).map((o) => ({ value: o, label: ({ live: 'Live', d5: '5 min', d14: '14 min', d22: '22 min', blackout: 'Offline' } as const)[o] }))} />
            <p className="muted small">When the link returns from a blackout, the app builds a summary for the flight surgeon. It holds only entries shared with Ground.</p>
            <div><button className="btn" onClick={() => { sim.act({ type: 'summary' }); note('Ground summary built'); }}>Build summary now</button></div>
          </div>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- sources (FR-06)

export function SourcesView() {
  const { sim, openSource, note } = useUi();
  const w = sim.world;
  return (
    <>
      <div className="page-head"><h1>Rules and sources</h1><p>{rules.note}</p></div>
      <section className="region" style={{ marginBottom: 14 }}>
        <div className="rh"><h2>Radiation rules</h2><span className="aside">Baseline B: <Src k="B">{rules.baselines.cruise.mSvPerHour} mSv/h in cruise</Src></span></div>
        <div className="rb flush scroll-x">
          <table className="tbl">
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
                      ? <button className="btn sm" onClick={() => { sim.act({ type: 'enable', ruleId: r.id }); note(`Rule ${r.id} enabled`); }}>Enable</button>
                      : <button className="btn sm" onClick={() => { sim.act({ type: 'inhibit', ruleId: r.id }); note(`Rule ${r.id} inhibited`); }}>Inhibit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ padding: '0 14px 12px' }}>
          A Warning clears when all sensors stay below 3 × B for 2 h. A Caution clears when the SEP record ends and the sensors stay below 3 × B for 1 h. {RULES['R-W1'].basis}
        </p>
      </section>
      <section className="region" style={{ marginBottom: 14 }}>
        <div className="rh"><h2>Body rules</h2><span className="aside">Advisory or Caution only</span></div>
        <div className="rb flush scroll-x">
          <table className="tbl">
            <thead><tr><th>Rule</th><th>Level</th><th>Rule text</th><th>Source</th></tr></thead>
            <tbody>
              {BODY_RULES.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.id}</td>
                  <td><Chip level={r.level} /></td>
                  <td>{r.text}</td>
                  <td><Src k={r.source}>{(sources as Record<string, { short: string }>)[r.source]?.short ?? r.source}</Src></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="region">
        <div className="rh"><h2>Citations</h2></div>
        <div className="rb flush">
          <ul className="log">
            {Object.entries(sources).map(([k, s]) => (
              <li key={k}><span className="when">{s.short}</span><div><div>{s.citation}</div><div className="faint small">{s.evidence}</div></div>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">Open</a> : <span />}</li>
            ))}
          </ul>
        </div>
        <p className="note" style={{ padding: '0 14px 12px' }}>Replay data: {REPLAY_PROVENANCE}</p>
      </section>
    </>
  );
}
