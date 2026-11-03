import { useState } from 'react';
import rules from '../data/rules.json';
import { LINK_LABEL, VIS_LABEL, VISIBILITY_ORDER, RULES, type LinkState, type LogEntry, type Visibility } from '../engine/world';
import { REPLAY_PROVENANCE } from '../engine/donki';
import { dayOf, stamp, hhmm, duration } from '../engine/time';
import { fmt } from '../engine/units';
import { Chip, Src, sources, useUi } from './common';

// ---------------------------------------------------------------- check-in (FR-05 daily check, FR-10 privacy)

const SYMPTOMS = ['Nausea', 'Fatigue', 'Headache', 'Skin redness', 'Vomiting', 'Poor sleep'];

export function VisibilityPicker({ value, onChange, name }: { value: Visibility; onChange: (v: Visibility) => void; name: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {VISIBILITY_ORDER.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>{VIS_LABEL[v]}</button>
      ))}
    </div>
  );
}

export function CheckInView() {
  const { sim, toast, go } = useUi();
  const [sleep, setSleep] = useState(6.5);
  const [sym, setSym] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [vis, setVis] = useState<Visibility>('cmo');
  const w = sim.world;
  const recent = w.log.filter((e) => e.kind === 'checkin').slice(-5).reverse();

  return (
    <div className="two">
      <section className="panel">
        <header><h2>Daily health check</h2><span className="aside">About 30 s</span></header>
        <div className="body">
          <div className="field">
            <span className="lbl" id="sleep-l">Sleep last night</span>
            <div className="stepper" role="group" aria-labelledby="sleep-l">
              <button type="button" aria-label="Less sleep" onClick={() => setSleep((s) => Math.max(0, s - 0.5))}>−</button>
              <output aria-live="polite">{sleep.toFixed(1)} h</output>
              <button type="button" aria-label="More sleep" onClick={() => setSleep((s) => Math.min(12, s + 0.5))}>+</button>
            </div>
          </div>
          <div className="field">
            <span className="lbl">Symptoms now</span>
            <div className="toggles">
              {SYMPTOMS.map((s) => (
                <button key={s} type="button" className="btn" aria-pressed={sym.includes(s)} onClick={() => setSym((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="note">Note (optional)</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the CMO should know" />
          </div>
          <div className="field">
            <span className="lbl">Who can see this entry</span>
            <VisibilityPicker value={vis} onChange={setVis} name="Who can see this entry" />
            <span className="faint" style={{ fontSize: 13 }}>
              {vis === 'private' ? 'Only you. It never leaves the vehicle.' : vis === 'cmo' ? 'You and the CMO.' : vis === 'crew' ? 'The whole crew. Not the ground.' : 'The crew and the ground summary.'}
            </span>
          </div>
          <button className="btn primary" onClick={() => {
            sim.act({ type: 'checkin', data: { sleepH: sleep, symptoms: sym, note }, visibility: vis });
            toast(`Check-in saved. Shared with: ${VIS_LABEL[vis]}`);
            setSym([]); setNote('');
            go('console');
          }}>Save check-in</button>
        </div>
      </section>
      <section className="panel">
        <header><h2>Your recent check-ins</h2></header>
        <div className="body">
          {recent.length === 0 ? <p className="muted">No check-ins yet. The daily check is on your timeline at 07:00.</p> : (
            <ul className="log">{recent.map((e) => <LogRow key={e.seq} e={e} />)}</ul>
          )}
        </div>
      </section>
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
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={download}>Export log as JSON</button>
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
      <div className="filters seg" role="group" aria-label="Filter the log" style={{ width: 'max-content', maxWidth: '100%', overflowX: 'auto' }}>
        {(['all', 'alerts', 'actions', 'checkins', 'ground'] as const).map((x) => (
          <button key={x} aria-pressed={f === x} onClick={() => setF(x)}>{x === 'all' ? 'All' : x === 'alerts' ? 'Alerts' : x === 'actions' ? 'Actions' : x === 'checkins' ? 'Check-ins' : 'Link and summaries'}</button>
        ))}
      </div>
      <section className="panel"><div className="body"><ul className="log">{[...rows].reverse().map((e) => <LogRow key={e.seq} e={e} />)}</ul></div></section>
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

export function LinkSwitch({ compact }: { compact?: boolean }) {
  const { sim, toast } = useUi();
  const w = sim.world;
  const opts: LinkState[] = ['live', 'd5', 'd14', 'd22', 'blackout'];
  const short: Record<LinkState, string> = { live: 'Live', d5: '5 min', d14: '14 min', d22: '22 min', blackout: 'Offline' };
  return (
    <div className="seg" role="radiogroup" aria-label="Link to Earth" style={compact ? undefined : { marginBottom: 12 }}>
      {opts.map((o) => (
        <button key={o} role="radio" aria-checked={w.link === o} aria-pressed={w.link === o} onClick={() => { sim.act({ type: 'link', link: o }); toast(`Link: ${LINK_LABEL[o]}`); }}>{short[o]}</button>
      ))}
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

export function SystemsView() {
  const cards = [
    { t: 'Bone', d: 'Bone loss in microgravity. About 1 to 1.5% of hip bone mass per month.' },
    { t: 'Muscle', d: 'Muscle loss and exercise countermeasures.' },
    { t: 'Heart', d: 'Cardiovascular changes and orthostatic intolerance.' },
    { t: 'Eyes (SANS)', d: 'Spaceflight-associated neuro-ocular syndrome.' },
    { t: 'Behavioral health', d: 'Isolation, confinement, sleep, and mood.' },
  ];
  return (
    <>
      <div className="page-head"><h1>Other body systems</h1><p>This build goes deep on one risk: radiation. These systems are placeholders.</p></div>
      <div className="cards">
        {cards.map((c) => (
          <div key={c.t} className="card"><h3>{c.t}</h3><p>{c.d}</p><span className="tag">Not in this build</span></div>
        ))}
      </div>
    </>
  );
}
