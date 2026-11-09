import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  Radiation, Wind, HeartPulse, ClipboardCheck, ScrollText, FlaskConical, Orbit, Stethoscope, Satellite, BookOpen,
  Sun, Moon, MoonStar, Ellipsis,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { LINK_LABEL, LINK_DELAY_MIN } from '../engine/world';
import { phaseAt } from '../engine/doseModel';
import { dayOf, hhmm } from '../engine/time';
import { useSim } from '../ui/useSim';
import { UiContext, useUi, type Tab, type Theme, type Ui } from './context';
import { LevelIcon } from './parts';
import { SourceSheet } from './SourceSheet';
import { DemoDock } from './DemoDock';
import { NowView } from './views/Now';
import { CabinView } from './views/Cabin';
import { BodyView } from './views/Body';
import { CheckInView } from './views/CheckIn';
import { LogView } from './views/Log';
import { EvidenceView } from './views/Evidence';
import { CmoView, GroundView } from './views/Team';
import { SourcesView } from './views/Sources';

const MissionTab = lazy(() => import('./views/Mission'));

const THEME_KEY = 'storm-shelter.theme.v3';

interface NavItem { id: Tab; label: string; icon: typeof Radiation; short?: string }
const CREW: NavItem[] = [
  { id: 'now', label: 'Radiation', icon: Radiation, short: 'Now' },
  { id: 'cabin', label: 'Cabin air', icon: Wind, short: 'Cabin' },
  { id: 'body', label: 'Body', icon: HeartPulse },
  { id: 'checkin', label: 'Health check', icon: ClipboardCheck, short: 'Check' },
  { id: 'log', label: 'Log', icon: ScrollText },
];
const TEAM: NavItem[] = [
  { id: 'evidence', label: 'Real-data test', icon: FlaskConical },
  { id: 'mission', label: 'Mission 3D', icon: Orbit },
  { id: 'cmo', label: 'CMO', icon: Stethoscope },
  { id: 'ground', label: 'Ground link', icon: Satellite },
  { id: 'sources', label: 'Rules and sources', icon: BookOpen },
];
const TITLES: Record<Tab, string> = Object.fromEntries([...CREW, ...TEAM].map((n) => [n.id, n.label])) as Record<Tab, string>;

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'day' || v === 'dim' || v === 'night') return v;
  } catch { /* storage can be blocked */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dim' : 'day';
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
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'day' ? '#F6F7F9' : theme === 'dim' ? '#12151C' : '#120D0B');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (procOpen && !sim.world.procedure) setProcOpen(false);
  }, [procOpen, sim.world.procedure]);

  const go = useCallback((t: Tab) => { setTab(t); window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, []);

  const ui: Ui = useMemo(() => ({
    sim, tab, go,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('now'); setProcOpen(true); window.scrollTo({ top: 0 }); },
    procOpen, setProcOpen,
    note: (text) => setLast({ t: sim.world.t, text }),
    theme, setTheme,
  }), [sim, tab, go, procOpen, theme]);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={300}>
        <UiContext.Provider value={ui}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to the main content</a>
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar last={last} />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-48 md:px-6 lg:px-8 lg:pb-36">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: 'easeOut' }}>
                    {tab === 'now' && <NowView />}
                    {tab === 'cabin' && <CabinView />}
                    {tab === 'body' && <BodyView />}
                    {tab === 'checkin' && <CheckInView />}
                    {tab === 'log' && <LogView />}
                    {tab === 'evidence' && <EvidenceView />}
                    {tab === 'mission' && <Suspense fallback={<p className="text-muted-foreground">Loading the 3D view.</p>}><MissionTab /></Suspense>}
                    {tab === 'cmo' && <CmoView />}
                    {tab === 'ground' && <GroundView />}
                    {tab === 'sources' && <SourcesView />}
                  </motion.div>
                </AnimatePresence>
              </main>
            </div>
          </div>
          <MobileTabs />
          <DemoDock />
          <SourceSheet k={source} onClose={() => setSource(null)} />
        </UiContext.Provider>
      </TooltipProvider>
    </MotionConfig>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden="true">
        <rect x="0" y="0" width="64" height="64" rx="18" fill="var(--foreground)" />
        <path d="M16 36 L32 20 L48 36" fill="none" stroke="var(--background)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="24" y="34" width="16" height="11" rx="2.5" fill="var(--background)" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Storm Shelter</div>
        <div className="text-[11px] text-muted-foreground">Crew health monitor</div>
      </div>
    </div>
  );
}

function useCounts() {
  const { sim } = useUi();
  const a = sim.world.activeAlerts.filter((x) => !x.suppressed);
  return {
    warning: a.filter((x) => x.level === 'warning').length,
    caution: a.filter((x) => x.level === 'caution').length,
    top: a[0]?.level,
  };
}

function NavButton({ item, compact }: { item: NavItem; compact?: boolean }) {
  const { tab, go } = useUi();
  const c = useCounts();
  const active = tab === item.id;
  const I = item.icon;
  const dot = item.id === 'now' && !active && (c.warning || c.caution) ? (c.warning ? 'bg-warning' : 'bg-caution') : null;
  return (
    <button onClick={() => go(item.id)} aria-current={active ? 'page' : undefined}
      className={cn('group relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground', compact && 'justify-center px-0')}>
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-accent ring-1 ring-border" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <I className="relative size-[18px]" strokeWidth={2} aria-hidden="true" />
      <span className="relative">{item.label}</span>
      {dot && <span className={cn('relative ml-auto size-2 rounded-full', dot)} aria-label="Active alert" />}
    </button>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 lg:flex">
      <div className="px-2 pb-5"><Brand /></div>
      <nav aria-label="Crew views" className="space-y-0.5">
        <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Crew</div>
        {CREW.map((n) => <NavButton key={n.id} item={n} />)}
      </nav>
      <nav aria-label="Team views" className="mt-6 space-y-0.5">
        <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Mission team</div>
        {TEAM.map((n) => <NavButton key={n.id} item={n} />)}
      </nav>
      <div className="mt-auto space-y-3 px-1">
        <ThemeSwitch />
        <p className="px-2 text-[11px] leading-snug text-muted-foreground">Not for clinical use. Radiation event: measured MSL RAD data. Crew sensors and vitals: simulated.</p>
      </div>
    </aside>
  );
}

const THEMES: { v: Theme; label: string; icon: typeof Sun }[] = [
  { v: 'day', label: 'Day', icon: Sun },
  { v: 'dim', label: 'Dim', icon: Moon },
  { v: 'night', label: 'Night (no blue light)', icon: MoonStar },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useUi();
  return (
    <div role="radiogroup" aria-label="Display" className={cn('grid grid-cols-3 gap-1 rounded-xl bg-muted p-1', className)}>
      {THEMES.map(({ v, label, icon: I }) => (
        <button key={v} role="radio" aria-checked={theme === v} aria-label={label} onClick={() => setTheme(v)}
          className={cn('relative flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors', theme === v ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {theme === v && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          <I className="relative size-3.5" aria-hidden="true" /><span className="relative">{v === 'night' ? 'Night' : label}</span>
        </button>
      ))}
    </div>
  );
}

function TopBar({ last }: { last: { t: number; text: string } | null }) {
  const { sim, tab } = useUi();
  const w = sim.world;
  const c = useCounts();
  const delay = LINK_DELAY_MIN[w.link];
  const unack = w.activeAlerts.filter((a) => !a.acked && a.level !== 'advisory').length;
  return (
    <header className="glass sticky top-0 z-30 border-b">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 md:px-6 lg:px-8">
        <div className="lg:hidden"><Brand /></div>
        <div className="hidden min-w-0 lg:block">
          <div className="truncate text-sm font-semibold">{TITLES[tab]}</div>
          <div className="truncate text-xs text-muted-foreground" aria-live="polite">
            {last ? <>Last action <span className="num">{hhmm(last.t)}</span>: {last.text}</> : 'No crew action yet in this replay.'}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5" aria-label="Alert counts">
          <CountPill level="warning" n={c.warning} />
          <CountPill level="caution" n={c.caution} />
          {unack > 0 && <span className="hidden h-7 items-center rounded-full bg-muted px-2.5 text-xs font-medium sm:inline-flex">Unack <b className="num ml-1">{unack}</b></span>}
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-medium md:flex">
          <span className={cn('size-2 rounded-full', delay === null ? 'bg-muted-foreground' : delay === 0 ? 'bg-nominal' : 'bg-advisory')} aria-hidden="true" />
          {LINK_LABEL[w.link]}
        </div>
        <div className="text-right leading-tight">
          <div className="text-[11px] text-muted-foreground">{phaseAt(w.t).label}</div>
          <div className="num text-sm font-semibold" aria-label="Mission time">Day {dayOf(w.t)} <span className="text-base">{hhmm(w.t)}</span></div>
        </div>
      </div>
    </header>
  );
}

function CountPill({ level, n }: { level: 'warning' | 'caution'; n: number }) {
  const on = n > 0;
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors',
      on ? (level === 'warning' ? 'bg-warning text-white' : 'bg-caution text-[oklch(0.22_0.04_70)]') : 'bg-muted text-muted-foreground')}>
      <LevelIcon level={level} className="size-3.5" />
      <span className="hidden sm:inline">{level === 'warning' ? 'Warning' : 'Caution'}</span>
      <b className="num">{n}</b>
    </span>
  );
}

function MobileTabs() {
  const { tab, go } = useUi();
  const [more, setMore] = useState(false);
  const c = useCounts();
  const main: NavItem[] = CREW.slice(0, 4);
  const inMore = ![...main].some((m) => m.id === tab);
  return (
    <>
      <nav aria-label="Views" className="glass fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {main.map((n) => {
            const I = n.icon;
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => go(n.id)} aria-current={active ? 'page' : undefined} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
                <span className="relative">
                  <I className="size-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  {n.id === 'now' && (c.warning || c.caution) ? <span className={cn('absolute -top-0.5 -right-1 size-2 rounded-full', c.warning ? 'bg-warning' : 'bg-caution')} /> : null}
                </span>
                {n.short ?? n.label}
              </button>
            );
          })}
          <button onClick={() => setMore(true)} aria-current={inMore ? 'page' : undefined} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', inMore ? 'text-foreground' : 'text-muted-foreground')}>
            <Ellipsis className="size-5" aria-hidden="true" />More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="rounded-t-3xl pb-8">
          <SheetHeader><SheetTitle>More views</SheetTitle><SheetDescription>Views for the crew, the CMO, the ground, and the judges.</SheetDescription></SheetHeader>
          <div className="grid gap-1 px-4">
            {[CREW[4], ...TEAM].map((n) => <div key={n.id} onClick={() => setMore(false)}><NavButton item={n} /></div>)}
            <ThemeSwitch className="mt-3" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
