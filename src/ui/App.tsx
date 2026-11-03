import { useCallback, useEffect, useMemo, useState } from 'react';
import { LINK_LABEL, LINK_DELAY_MIN } from '../engine/world';
import { phaseAt } from '../engine/doseModel';
import { dayOf, hhmm } from '../engine/time';
import { UiContext, LEVEL_ICON, useUi as useUiSafe, type Tab, type Ui } from './common';
import { useSim, SPEEDS, BEATS, REPLAY_END } from './useSim';
import { ConsoleView } from './Console';
import { ProcedureSheet, SourceSheet } from './Sheets';
import { CheckInView, LogView, CmoView, GroundView, SourcesView, SystemsView, LinkSwitch } from './Pages';

type Theme = 'dark' | 'light' | 'night';
const THEME_KEY = 'storm-shelter.theme';

const TABS: { id: Tab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'checkin', label: 'Check-in' },
  { id: 'log', label: 'Log' },
  { id: 'cmo', label: 'CMO' },
  { id: 'ground', label: 'Ground' },
  { id: 'sources', label: 'Rules and sources' },
  { id: 'systems', label: 'Other systems' },
];

export function App() {
  const sim = useSim();
  const [tab, setTab] = useState<Tab>('console');
  const [source, setSource] = useState<string | null>(null);
  const [proc, setProc] = useState(false);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (!toastMsg) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toastMsg]);

  const closeSource = useCallback(() => setSource(null), []);
  const closeProc = useCallback(() => setProc(false), []);

  const ui: Ui = useMemo(() => ({
    sim,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('console'); setProc(true); },
    go: setTab,
    toast: setToast,
  }), [sim]);

  return (
    <UiContext.Provider value={ui}>
      <div className="shell">
        <AlertBar />
        <nav className="nav" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
          <span style={{ marginLeft: 'auto' }} />
          {sim.world.procedure && (
            <button onClick={() => setProc(true)} style={{ color: 'var(--text)' }}>Procedure SH-1 open</button>
          )}
          <div className="seg nav-theme" role="radiogroup" aria-label="Display theme">
            {(['dark', 'light', 'night'] as Theme[]).map((t) => <button key={t} role="radio" aria-checked={theme === t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t === 'dark' ? 'Cabin' : t === 'light' ? 'Light' : 'Night'}</button>)}
          </div>
        </nav>
        <main id="main">
          {tab === 'console' && <ConsoleView />}
          {tab === 'checkin' && <CheckInView />}
          {tab === 'log' && <LogView />}
          {tab === 'cmo' && <CmoView />}
          {tab === 'ground' && <GroundView />}
          {tab === 'sources' && <SourcesView />}
          {tab === 'systems' && <SystemsView />}
        </main>
        <ReplayDeck />
      </div>
      {proc && <ProcedureSheet onClose={closeProc} />}
      {source && <SourceSheet k={source} onClose={closeSource} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </UiContext.Provider>
  );
}

function AlertBar() {
  const ui = useUiSafe();
  const w = ui.sim.world;
  const active = w.activeAlerts;
  const nW = active.filter((a) => a.level === 'warning').length;
  const nC = active.filter((a) => a.level === 'caution').length;
  const unack = active.filter((a) => !a.acked && a.level !== 'advisory').length;
  const today = w.alertsOnDay(dayOf(w.t)).length;
  const delay = LINK_DELAY_MIN[w.link];
  const linkCls = delay === null ? 'offline' : delay === 0 ? 'live' : 'delayed';
  return (
    <header className="alertbar" role="banner">
      <div className="counts" aria-label="Alert counts">
        <span className={`count warning ${nW ? 'on' : ''}`}><span aria-hidden="true">{LEVEL_ICON.warning}</span> Warning <b>{nW}</b></span>
        <span className={`count caution ${nC ? 'on' : ''}`}><span aria-hidden="true">{LEVEL_ICON.caution}</span> Caution <b>{nC}</b></span>
        <span className={`count unack ${unack ? 'on' : ''}`}><span>Unack<span className="lbl-long">nowledged</span></span> <b>{unack}</b></span>
        <span className="count today">Today <b>{today}</b></span>
      </div>
      <div className="clock">
        <div className="big" aria-label="Mission time">{phaseAt(w.t).label} <span className="num">Day {String(dayOf(w.t)).padStart(3, '0')} {hhmm(w.t)}</span></div>
        <div className="meta">
          <span className={`link-state ${linkCls}`}><span className="dot" aria-hidden="true" />{LINK_LABEL[w.link]}</span>
          <span className="tag">Replay</span>
          <span className="tag">Simulated dose</span>
          <span className="tag" style={{ borderStyle: 'solid' }}>Not for clinical use</span>
        </div>
      </div>
    </header>
  );
}

function ReplayDeck() {
  const { sim } = useUiSafe();
  const w = sim.world;
  const atEnd = w.t >= REPLAY_END;
  return (
    <footer className="deck" aria-label="Replay controls">
      <div className="group">
        <button className="btn primary" style={{ minWidth: 104 }} disabled={atEnd} onClick={() => sim.setPlaying(!sim.playing)} aria-pressed={sim.playing}>
          {sim.playing ? 'Pause' : 'Play'}
        </button>
        <div className="seg" role="radiogroup" aria-label="Replay speed">
          {SPEEDS.map((s) => <button key={s.id} role="radio" aria-checked={sim.speed.id === s.id} aria-pressed={sim.speed.id === s.id} onClick={() => sim.setSpeed(s)}>{s.label}</button>)}
        </div>
      </div>
      <span className="sep" />
      <div className="group">
        <span className="label">Jump to</span>
        {BEATS.map((b) => <button key={b.label} className="btn small" onClick={() => sim.jumpTo(b.t)}>{b.label}</button>)}
      </div>
      <span className="sep" />
      <div className="group">
        <span className="label">Link</span>
        <LinkSwitch compact />
      </div>
      <span className="sep" />
      <div className="group">
        <label className="label" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={sim.pauseOnAlert} onChange={(e) => sim.setPauseOnAlert(e.target.checked)} style={{ width: 20, height: 20 }} />
          Pause on new alert
        </label>
        <button className="btn small quiet" onClick={sim.restart}>Restart replay</button>
      </div>
    </footer>
  );
}

