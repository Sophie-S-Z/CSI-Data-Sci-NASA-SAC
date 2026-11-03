import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Gauge, Heartbeat, ListBullets, FirstAidKit, GlobeHemisphereWest, BookOpenText, Stack, Command, Play, Pause, ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { LINK_LABEL, LINK_DELAY_MIN, type LinkState } from '../engine/world';
import { phaseAt } from '../engine/doseModel';
import { dayOf, hhmm } from '../engine/time';
import { UiContext, LevelIcon, useUi, type Tab, type Ui } from './common';
import { useSim, SPEEDS, BEATS, REPLAY_END } from './useSim';
import { ConsoleView } from './Console';
import { ProcedureSheet, SourceSheet } from './Sheets';
import { CheckInView, LogView, CmoView, GroundView, SourcesView, SystemsView } from './Pages';
import { CommandMenu } from './CommandMenu';
import { Segmented } from './Segmented';
import { DUR, EASE_OUT, SPRING } from './motion';

type Theme = 'dark' | 'light' | 'night';
const THEME_KEY = 'storm-shelter.theme';

const TABS: { id: Tab; label: string; Icon: typeof Gauge }[] = [
  { id: 'console', label: 'Console', Icon: Gauge },
  { id: 'checkin', label: 'Check-in', Icon: Heartbeat },
  { id: 'log', label: 'Log', Icon: ListBullets },
  { id: 'cmo', label: 'CMO', Icon: FirstAidKit },
  { id: 'ground', label: 'Ground', Icon: GlobeHemisphereWest },
  { id: 'sources', label: 'Rules and sources', Icon: BookOpenText },
  { id: 'systems', label: 'Body systems', Icon: Stack },
];

export function App() {
  const sim = useSim();
  const [tab, setTab] = useState<Tab>('console');
  const [source, setSource] = useState<string | null>(null);
  const [proc, setProc] = useState(false);
  const [cmd, setCmd] = useState(false);
  const [toastMsg, setToast] = useState<{ id: number; text: string } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (!toastMsg) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toastMsg]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((c) => !c); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeSource = useCallback(() => setSource(null), []);
  const closeProc = useCallback(() => setProc(false), []);
  const closeCmd = useCallback(() => setCmd(false), []);

  const ui: Ui = useMemo(() => ({
    sim,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('console'); setProc(true); },
    go: (t) => { setTab(t); window.scrollTo({ top: 0 }); },
    toast: (text) => setToast({ id: Date.now(), text }),
    openCommand: () => setCmd(true),
    theme,
  }), [sim, theme]);

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: EASE_OUT }}>
      <UiContext.Provider value={ui}>
        <a className="skip" href="#main">Skip to the main content</a>
        <div className="shell">
          <AlertBar />
          <nav className="nav" aria-label="Views">
            <div className="nav-tabs">
              {TABS.map(({ id, label, Icon }) => (
                <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => ui.go(id)}>
                  <Icon size={18} weight={tab === id ? 'fill' : 'regular'} aria-hidden="true" />
                  <span>{label}</span>
                  {tab === id && <motion.span layoutId="nav-underline" className="nav-underline" transition={SPRING} />}
                </button>
              ))}
            </div>
            <div className="nav-right">
              <AnimatePresence>
                {sim.world.procedure && (
                  <motion.button key="proc" className="btn small proc-pill" onClick={() => setProc(true)}
                    initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}>
                    <span className="live-dot" aria-hidden="true" />SH-1 open
                  </motion.button>
                )}
              </AnimatePresence>
              <button className="btn small quiet cmd-btn" onClick={() => setCmd(true)} aria-label="Open the command menu (Control K)">
                <Command size={16} aria-hidden="true" /><span>Actions</span><kbd>K</kbd>
              </button>
              <Segmented<Theme> size="sm" label="Display theme" value={theme} onChange={setTheme}
                options={[{ value: 'dark', label: 'Cabin' }, { value: 'light', label: 'Light' }, { value: 'night', label: 'Night' }]} />
            </div>
          </nav>
          <main id="main" tabIndex={-1}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: DUR.fast } }}
                transition={{ duration: DUR.slow, ease: EASE_OUT }}>
                {tab === 'console' && <ConsoleView />}
                {tab === 'checkin' && <CheckInView />}
                {tab === 'log' && <LogView />}
                {tab === 'cmo' && <CmoView />}
                {tab === 'ground' && <GroundView />}
                {tab === 'sources' && <SourcesView />}
                {tab === 'systems' && <SystemsView />}
              </motion.div>
            </AnimatePresence>
          </main>
          <ReplayDeck />
        </div>
        <AnimatePresence>
          {proc && <ProcedureSheet key="proc" onClose={closeProc} />}
          {source && <SourceSheet key="src" k={source} onClose={closeSource} />}
          {cmd && <CommandMenu key="cmd" onClose={closeCmd} />}
        </AnimatePresence>
        <div className="toast-zone" aria-live="polite">
          <AnimatePresence>
            {toastMsg && (
              <motion.div key={toastMsg.id} className="toast" role="status"
                initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, transition: { duration: DUR.fast } }}
                transition={SPRING}>
                {toastMsg.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </UiContext.Provider>
    </MotionConfig>
  );
}

function AlertBar() {
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
    <header className="alertbar">
      <div className="brand" aria-label="Storm Shelter">
        <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><path d="M12 40 L32 14 L52 40" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" /><rect x="21" y="36" width="22" height="15" rx="2" fill="var(--caution)" /></svg>
        <span>Storm Shelter</span>
      </div>
      <div className="counts" aria-label="Alert counts">
        <span className={`count warning ${nW ? 'on' : ''}`}><LevelIcon level="warning" /> Warning <b>{nW}</b></span>
        <span className={`count caution ${nC ? 'on' : ''}`}><LevelIcon level="caution" /> Caution <b>{nC}</b></span>
        <span className={`count unack ${unack ? 'on' : ''}`}><span>Unack<span className="lbl-long">nowledged</span></span> <b>{unack}</b></span>
        <span className="count today">Today <b>{today}</b></span>
      </div>
      <div className="clock">
        <div className="big" aria-label="Mission time">{phaseAt(w.t).label} <span className="num">Day {String(dayOf(w.t)).padStart(3, '0')} {hhmm(w.t)}</span></div>
        <div className="meta">
          <span className={`link-state ${linkCls}`}><span className="dot" aria-hidden="true" />{LINK_LABEL[w.link]}</span>
          <span className="tag">Replay</span>
          <span className="tag">Simulated dose</span>
          <span className="tag solid">Not for clinical use</span>
        </div>
      </div>
    </header>
  );
}

function ReplayDeck() {
  const { sim } = useUi();
  const w = sim.world;
  const atEnd = w.t >= REPLAY_END;
  const linkOpts: { value: LinkState; label: string }[] = [
    { value: 'live', label: 'Live' }, { value: 'd5', label: '5 min' }, { value: 'd14', label: '14 min' }, { value: 'd22', label: '22 min' }, { value: 'blackout', label: 'Offline' },
  ];
  const progress = (w.t - w.startT) / (REPLAY_END - w.startT);
  return (
    <footer className="deck" aria-label="Replay controls">
      <div className="deck-progress" aria-hidden="true"><motion.span style={{ scaleX: progress }} /></div>
      <div className="group">
        <button className="btn primary play" disabled={atEnd} onClick={() => sim.setPlaying(!sim.playing)} aria-pressed={sim.playing}>
          {sim.playing ? <Pause size={18} weight="fill" aria-hidden="true" /> : <Play size={18} weight="fill" aria-hidden="true" />}
          {sim.playing ? 'Pause' : 'Play'}
        </button>
        <Segmented size="sm" label="Replay speed" value={sim.speed.id} onChange={(id) => sim.setSpeed(SPEEDS.find((s) => s.id === id)!)}
          options={SPEEDS.map((s) => ({ value: s.id, label: s.label }))} />
      </div>
      <div className="group beats" role="group" aria-label="Jump to a demo beat">
        {BEATS.map((b, i) => (
          <button key={b.label} className={`beat ${w.t >= b.t ? 'past' : ''}`} onClick={() => sim.jumpTo(b.t)}>
            <span className="beat-n num">{i + 1}</span>{b.label}
          </button>
        ))}
      </div>
      <div className="group">
        <span className="label">Link</span>
        <Segmented<LinkState> size="sm" label="Link to Earth" value={w.link} onChange={(l) => sim.act({ type: 'link', link: l })} options={linkOpts} />
      </div>
      <div className="group">
        <label className="check">
          <input type="checkbox" checked={sim.pauseOnAlert} onChange={(e) => sim.setPauseOnAlert(e.target.checked)} />
          Pause on new alert
        </label>
        <button className="btn small quiet" onClick={sim.restart}><ArrowCounterClockwise size={16} aria-hidden="true" />Restart</button>
      </div>
    </footer>
  );
}
