import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, ArrowCounterClockwise, Sun, CloudMoon, Moon, SlidersHorizontal, X } from '@phosphor-icons/react';
import { LINK_LABEL, LINK_DELAY_MIN, type LinkState } from '../engine/world';
import { phaseAt } from '../engine/doseModel';
import { dayOf, hhmm } from '../engine/time';
import { UiContext, LevelIcon, useUi, type Tab, type Ui } from './common';
import { useSim, SPEEDS, BEATS, REPLAY_END } from './useSim';
import { NowView } from './Now';
import { SourceDrawer } from './Sheets';
import { CheckInView, LogView, CmoView, GroundView, SourcesView, BodyView } from './Pages';
import { Segmented, useSlidingThumb } from './Segmented';

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
        <Nav tab={tab} loud={loud} theme={theme} setTheme={setTheme} />
        <main id="main" tabIndex={-1}>
          <p className="ack-line" aria-live="polite">
            {last ? <>Last action <span className="num">{hhmm(last.t)}</span>: <b>{last.text}</b></> : 'No crew action yet in this replay.'}
          </p>
          <div className="view" key={tab}>
          {tab === 'now' && <NowView />}
          {tab === 'checkin' && <CheckInView />}
          {tab === 'body' && <BodyView />}
          {tab === 'log' && <LogView />}
          {tab === 'mission' && <Suspense fallback={<p className="muted">Loading the 3D view.</p>}><MissionTab /></Suspense>}
          {tab === 'cmo' && <CmoView />}
          {tab === 'ground' && <GroundView />}
          {tab === 'sources' && <SourcesView />}
          </div>
        </main>
        <DemoDeck />
      </div>
      {source && <SourceDrawer k={source} onClose={closeSource} />}
    </UiContext.Provider>
  );
}

const THEMES: { value: Theme; label: string; icon: JSX.Element }[] = [
  { value: 'day', label: 'Day', icon: <Sun size={16} weight="bold" aria-hidden="true" /> },
  { value: 'dim', label: 'Dim', icon: <CloudMoon size={16} weight="bold" aria-hidden="true" /> },
  { value: 'night', label: 'Night, no blue light', icon: <Moon size={16} weight="bold" aria-hidden="true" /> },
];

function Nav({ tab, loud, theme, setTheme }: { tab: Tab; loud: number; theme: Theme; setTheme: (t: Theme) => void }) {
  const { go } = useUi();
  const host = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingThumb(host, thumb, '[aria-current="page"]', tab);
  const btn = ({ id, label }: { id: Tab; label: string }) => (
    <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
      {label}
      {id === 'now' && tab !== 'now' && loud > 0 && <span className="pill" aria-label={`${loud} active`}>{loud}</span>}
    </button>
  );
  return (
    <nav className="nav" aria-label="Views">
      <div className="tabs" ref={host}>
        <span ref={thumb} className="tab-thumb" aria-hidden="true" />
        {CREW_TABS.map(btn)}
        <span className="group-sep" aria-hidden="true" />
        {OTHER_TABS.map(btn)}
      </div>
      <div className="nav-right">
        <Segmented<Theme> size="sm" label="Display" value={theme} onChange={setTheme}
          options={THEMES.map((t) => ({ value: t.value, aria: t.label, label: <>{t.icon}<span className="seg-txt">{t.value === 'night' ? 'Night' : t.label}</span></> }))} />
      </div>
    </nav>
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
        <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><rect x="2" y="2" width="60" height="60" rx="18" fill="currentColor" /><path d="M17 37 L32 21 L47 37" fill="none" stroke="var(--surface)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /><rect x="24" y="35" width="16" height="10" rx="2" fill="var(--surface)" /></svg>
        <span className="brand-name">Storm Shelter</span>
        <span className="brand-sub">Simulated replay, not for clinical use</span>
      </div>
      <div className="counts" aria-label="Alert counts">
        <span className={`count warning ${nW ? 'on' : ''}`}><LevelIcon level="warning" size={15} />Warning <b>{nW}</b></span>
        <span className={`count caution ${nC ? 'on' : ''}`}><LevelIcon level="caution" size={15} />Caution <b>{nC}</b></span>
        <span className={`count unack ${unack ? 'on' : ''}`}><span className="long">Unacknowledged</span><span className="short">Unack</span> <b>{unack}</b></span>
        <span className="count today">Today <b>{today}</b></span>
      </div>
      <div className="clock">
        <span className={`link ${linkCls}`}><span className="dot" aria-hidden="true" />{LINK_LABEL[w.link]}</span>
        <span className="when">
          <span className="phase">{phaseAt(w.t).label}</span>
          <span className="time num" aria-label="Mission time">Day {dayOf(w.t)} <b>{hhmm(w.t)}</b></span>
        </span>
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
        <span className="title"><SlidersHorizontal size={16} weight="bold" aria-hidden="true" />Demo</span>
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
        <button className="btn sm ghost toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <><X size={16} aria-hidden="true" />Hide demo controls</> : 'More demo controls'}</button>
      </div>
    </footer>
  );
}
