import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Pause, ArrowCounterClockwise } from '@phosphor-icons/react';
import { LINK_LABEL, LINK_DELAY_MIN, type LinkState } from '../engine/world';
import { phaseAt } from '../engine/doseModel';
import { dayOf, hhmm } from '../engine/time';
import { UiContext, LevelIcon, useUi, type Tab, type Ui } from './common';
import { useSim, SPEEDS, BEATS, REPLAY_END } from './useSim';
import { NowView } from './Now';
import { SourceDrawer } from './Sheets';
import { CheckInView, LogView, CmoView, GroundView, SourcesView, BodyView } from './Pages';
import { Segmented } from './Segmented';

// The 3D view loads only when the Mission tab opens, so the crew views stay light.
const MissionTab = lazy(() => import('./MissionTab'));

type Theme = 'day' | 'dim' | 'night';
const THEME_KEY = 'storm-shelter.theme.v2';

/** Crew views first. Views for other people (CMO, ground, judges) after a divider. */
const CREW_TABS: { id: Tab; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'checkin', label: 'Health check' },
  { id: 'body', label: 'Body' },
  { id: 'log', label: 'Log' },
];
const OTHER_TABS: { id: Tab; label: string }[] = [
  { id: 'mission', label: 'Mission' },
  { id: 'cmo', label: 'CMO' },
  { id: 'ground', label: 'Ground' },
  { id: 'sources', label: 'Rules and sources' },
];

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'day' || v === 'dim' || v === 'night') return v;
  } catch { /* storage can be blocked */ }
  return 'day';
}

export function App() {
  const sim = useSim();
  const [tab, setTab] = useState<Tab>('now');
  const [source, setSource] = useState<string | null>(null);
  const [procOpen, setProcOpen] = useState(false);
  const [last, setLast] = useState<{ t: number; text: string } | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // The procedure view closes when the world has no open procedure (for example after a restart).
  useEffect(() => {
    if (procOpen && !sim.world.procedure) setProcOpen(false);
  }, [procOpen, sim.world.procedure]);

  const closeSource = useCallback(() => setSource(null), []);

  const ui: Ui = useMemo(() => ({
    sim,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('now'); setProcOpen(true); window.scrollTo({ top: 0 }); },
    procOpen,
    setProcOpen,
    go: (t) => { setTab(t); window.scrollTo({ top: 0 }); },
    note: (text) => setLast({ t: sim.world.t, text }),
    theme,
  }), [sim, procOpen, theme]);

  const loud = sim.world.activeAlerts.filter((a) => !a.suppressed && (a.level === 'warning' || a.level === 'caution')).length;

  return (
    <UiContext.Provider value={ui}>
      <a className="skip" href="#main">Skip to the main content</a>
      <div className="app">
        <StatusBar />
        <nav className="nav" aria-label="Views">
          <div className="tabs">
            {CREW_TABS.map(({ id, label }) => (
              <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => ui.go(id)}>
                {label}
                {id === 'now' && tab !== 'now' && loud > 0 && <span className="pill" aria-label={`${loud} active`}>{loud}</span>}
              </button>
            ))}
            <span className="group-sep" aria-hidden="true" />
            {OTHER_TABS.map(({ id, label }) => (
              <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => ui.go(id)}>{label}</button>
            ))}
          </div>
          <div className="nav-right">
            <label htmlFor="theme">Display</label>
            <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="day">Day</option>
              <option value="dim">Dim</option>
              <option value="night">Night (no blue)</option>
            </select>
          </div>
        </nav>
        <main id="main" tabIndex={-1}>
          <p className="ack-line" aria-live="polite">
            {last ? <>Last action <span className="num">{hhmm(last.t)}</span>: <b>{last.text}</b></> : 'No crew action yet in this replay.'}
          </p>
          {tab === 'now' && <NowView />}
          {tab === 'checkin' && <CheckInView />}
          {tab === 'body' && <BodyView />}
          {tab === 'log' && <LogView />}
          {tab === 'mission' && <Suspense fallback={<p className="muted">Loading the 3D view.</p>}><MissionTab /></Suspense>}
          {tab === 'cmo' && <CmoView />}
          {tab === 'ground' && <GroundView />}
          {tab === 'sources' && <SourcesView />}
        </main>
        <DemoDeck />
      </div>
      {source && <SourceDrawer k={source} onClose={closeSource} />}
    </UiContext.Provider>
  );
}

/** Appendix F alert summary: counts of active Warning, Caution, and unacknowledged events, the mode, and the link. */
function StatusBar() {
  const { sim } = useUi();
  const w = sim.world;
  const active = w.activeAlerts;
  const nW = active.filter((a) => a.level === 'warning').length;
  const nC = active.filter((a) => a.level === 'caution').length;
  const unack = active.filter((a) => !a.acked && a.level !== 'advisory').length;
  const today = w.alertsOnDay(dayOf(w.t)).length;
  const delay = LINK_DELAY_MIN[w.link];
  const linkCls = delay === null ? 'offline' : delay === 0 ? 'live' : 'delayed';
  return (
    <header className="status">
      <div className="brand">
        <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true"><path d="M10 40 L32 14 L54 40" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" /><rect x="21" y="37" width="22" height="14" fill="currentColor" /></svg>
        <span>Storm Shelter</span>
      </div>
      <div className="counts" aria-label="Alert counts">
        <span className={`count warning ${nW ? 'on' : ''}`}><LevelIcon level="warning" size={15} />Warning <b>{nW}</b></span>
        <span className={`count caution ${nC ? 'on' : ''}`}><LevelIcon level="caution" size={15} />Caution <b>{nC}</b></span>
        <span className={`count unack ${unack ? 'on' : ''}`}><span className="long">Unacknowledged</span><span className="short">Unack</span> <b>{unack}</b></span>
        <span className="count today">Today <b>{today}</b></span>
      </div>
      <div className="clock">
        <span className={`link ${linkCls}`}><span className="dot" aria-hidden="true" />{LINK_LABEL[w.link]}</span>
        <span className="labels"><span className="tag">Replay</span><span className="tag">Simulated dose</span><span className="tag">Not for clinical use</span></span>
        <span className="phase">{phaseAt(w.t).label}</span>
        <span className="time" aria-label="Mission time">D{String(dayOf(w.t)).padStart(3, '0')} {hhmm(w.t)}</span>
      </div>
    </header>
  );
}

/** Demo controls. They drive the replay for judges. They are not part of the crew tool. */
function DemoDeck() {
  const { sim, note } = useUi();
  const w = sim.world;
  const [open, setOpen] = useState(false);
  const atEnd = w.t >= REPLAY_END;
  const linkOpts: { value: LinkState; label: string }[] = [
    { value: 'live', label: 'Live' }, { value: 'd5', label: '5 min' }, { value: 'd14', label: '14 min' }, { value: 'd22', label: '22 min' }, { value: 'blackout', label: 'Offline' },
  ];
  const progress = Math.min(1, (w.t - w.startT) / (REPLAY_END - w.startT));
  return (
    <footer className={`deck ${open ? 'open' : ''}`} aria-label="Demo controls">
      <div className="progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="deck-inner">
        <span className="title">DEMO</span>
        <div className="grp">
          <button className="btn sm primary" disabled={atEnd} onClick={() => sim.setPlaying(!sim.playing)} aria-pressed={sim.playing}>
            {sim.playing ? <Pause size={16} weight="fill" aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />}
            {sim.playing ? 'Pause' : 'Play'}
          </button>
          <span className="grp more">
            <Segmented size="sm" label="Replay speed" value={sim.speed.id} onChange={(id) => sim.setSpeed(SPEEDS.find((s) => s.id === id)!)}
              options={SPEEDS.map((s) => ({ value: s.id, label: s.label }))} />
          </span>
        </div>
        <div className="beats" role="group" aria-label="Jump to a demo beat">
          {BEATS.map((b, i) => (
            <button key={b.label} className={`beat ${w.t >= b.t ? 'past' : ''}`} onClick={() => sim.jumpTo(b.t)}>
              <span className="n">{i + 1}</span>{b.label}
            </button>
          ))}
        </div>
        <div className="grp more">
          <span className="lbl">Link</span>
          <Segmented<LinkState> size="sm" label="Link to Earth" value={w.link} onChange={(l) => { sim.act({ type: 'link', link: l }); note(`Link set to ${LINK_LABEL[l].toLowerCase()}`); }} options={linkOpts} />
        </div>
        <div className="grp more">
          <label className="cb"><input type="checkbox" checked={sim.pauseOnAlert} onChange={(e) => sim.setPauseOnAlert(e.target.checked)} />Pause on new alert</label>
          <button className="btn sm ghost" onClick={sim.restart}><ArrowCounterClockwise size={16} aria-hidden="true" />Restart</button>
        </div>
        <button className="btn sm ghost toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide demo controls' : 'More demo controls'}</button>
      </div>
    </footer>
  );
}
