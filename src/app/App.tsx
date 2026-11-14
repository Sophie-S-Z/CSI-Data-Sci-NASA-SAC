import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { MotionConfig } from 'motion/react';
import {
  Radiation, Wind, HeartPulse, ClipboardCheck, ScrollText, FlaskConical, Orbit, Stethoscope, Satellite, BookOpen,
  Sun, Moon, Ellipsis, MessagesSquare, SunMedium, SlidersHorizontal, Play, Pause, TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { LINK_LABEL, LINK_DELAY_MIN } from '../engine/world';
import { dayOf, hhmm } from '../engine/time';
import { useSim, BEATS, REPLAY_END, beatIndex } from '../ui/useSim';
import { UiContext, useUi, type Tab, type Theme, type Ui } from './context';
import { LEVEL_WORD, LevelIcon } from './parts';
import { SourceSheet } from './SourceSheet';
import { MissionPage } from './views/Mission';

/** Each view except the landing page loads on first use, so the first load stays small. */
const view = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const VIEWS: Record<Tab, ComponentType> = {
  mission: MissionPage,
  radiation: view(() => import('./views/Radiation'), 'RadiationView'),
  weather: view(() => import('./views/SpaceWeather'), 'SpaceWeatherView'),
  air: view(() => import('./views/Cabin'), 'CabinView'),
  body: view(() => import('./views/Body'), 'BodyView'),
  checkin: view(() => import('./views/CheckIn'), 'CheckInView'),
  log: view(() => import('./views/Log'), 'LogView'),
  ask: view(() => import('./views/Ask'), 'AskView'),
  cmo: view(() => import('./views/Team'), 'CmoView'),
  ground: view(() => import('./views/Team'), 'GroundView'),
  explorer: view(() => import('./views/Explorer'), 'ExplorerView'),
  evidence: view(() => import('./views/Evidence'), 'EvidenceView'),
  sources: view(() => import('./views/Sources'), 'SourcesView'),
};

const THEME_KEY = 'storm-shelter.theme.v3';

interface NavItem { id: Tab; label: string; icon: typeof Radiation; short?: string }
interface Section { id: 'sim' | 'real'; label: string; about: string; groups: { label: string; items: NavItem[] }[] }

/** The app has 2 sections: the simulation (a replay with simulated crew data) and the real-world data behind it. */
const SECTIONS: Section[] = [
  {
    id: 'sim', label: 'Simulation', about: 'A replay of a real storm, with simulated crew data.',
    groups: [
      { label: 'Storm replay', items: [
        { id: 'mission', label: 'Mission replay', icon: Orbit, short: 'Replay' },
        { id: 'radiation', label: 'Cabin radiation', icon: Radiation, short: 'Cabin' },
        { id: 'weather', label: 'Space weather', icon: SunMedium, short: 'Space' },
        { id: 'air', label: 'Cabin air', icon: Wind, short: 'Air' },
      ] },
      { label: 'Crew', items: [
        { id: 'body', label: 'Body', icon: HeartPulse },
        { id: 'checkin', label: 'Health check', icon: ClipboardCheck },
        { id: 'log', label: 'Log', icon: ScrollText },
        { id: 'ask', label: 'Ask', icon: MessagesSquare },
      ] },
      { label: 'Mission team', items: [
        { id: 'cmo', label: 'CMO', icon: Stethoscope },
        { id: 'ground', label: 'Flight-surgeon handoff', icon: Satellite },
      ] },
      { label: 'What-if', items: [{ id: 'explorer', label: 'Limits explorer', icon: SlidersHorizontal, short: 'What-if' }] },
    ],
  },
  {
    id: 'real', label: 'Real-world data', about: 'Measured events, NASA limits, and the sources.',
    groups: [{ label: 'Measured and published', items: [
      { id: 'evidence', label: 'Measured events', icon: FlaskConical, short: 'Events' },
      { id: 'sources', label: 'Rules and sources', icon: BookOpen, short: 'Sources' },
    ] }],
  },
];
const ITEMS = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
const sectionOf = (t: Tab) => SECTIONS.find((s) => s.groups.some((g) => g.items.some((i) => i.id === t)))!;

function readTheme(): Theme {
  try {
    if (localStorage.getItem(THEME_KEY) === 'light') return 'light';
  } catch { /* storage can be blocked */ }
  return 'dark';
}

export function App() {
  const sim = useSim();
  const [tab, setTab] = useState<Tab>('mission');
  const [source, setSource] = useState<string | null>(null);
  const [procOpen, setProcOpen] = useState(false);
  const [last, setLast] = useState<{ t: number; text: string } | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F4F5F6' : '#0B0D10');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (procOpen && !sim.world.procedure) setProcOpen(false);
  }, [procOpen, sim.world.procedure]);

  const go = useCallback((t: Tab) => { setTab(t); window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, []);

  const ui: Ui = useMemo(() => ({
    sim, tab, go,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('mission'); setProcOpen(true); },
    procOpen, setProcOpen,
    note: (text) => setLast({ t: sim.world.t, text }),
    theme, setTheme,
  }), [sim, tab, go, procOpen, theme]);

  const View = VIEWS[tab];
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={300}>
        <UiContext.Provider value={ui}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to the main content</a>
          <div className="flex min-h-dvh">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar last={last} />
              <InhibitBanner />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 md:px-6 lg:px-8 lg:pb-10">
                <Suspense fallback={<p className="text-muted-foreground">Loading.</p>}><View /></Suspense>
              </main>
            </div>
          </div>
          <MobileTabs />
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
        <rect x="0" y="0" width="64" height="64" rx="10" fill="var(--primary)" />
        <path d="M16 36 L32 20 L48 36" fill="none" stroke="var(--background)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="24" y="34" width="16" height="11" rx="2" fill="var(--background)" />
      </svg>
      <div className="hidden leading-tight sm:block">
        <div className="text-[15px] font-semibold tracking-tight">Storm Shelter</div>
        <div className="text-[11px] text-muted-foreground">Crew health monitor</div>
      </div>
    </div>
  );
}

/** Counts include suppressed alerts, so a hidden alert is still counted (beta report S-1). */
function useCounts() {
  const a = useUi().sim.world.activeAlerts;
  return { warning: a.filter((x) => x.level === 'warning').length, caution: a.filter((x) => x.level === 'caution').length };
}

/** Simulation or Real-world data. A tap opens the first view of the section. */
function SectionSwitch({ className }: { className?: string }) {
  const { tab, go } = useUi();
  const cur = sectionOf(tab).id;
  return (
    <div role="tablist" aria-label="App section" className={cn('grid grid-cols-2 rounded-md bg-muted p-0.5', className)}>
      {SECTIONS.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={cur === s.id} onClick={() => cur !== s.id && go(s.groups[0].items[0].id)}
          className={cn('h-9 rounded px-1 text-xs font-semibold whitespace-nowrap', cur === s.id ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function NavButton({ item, onPick }: { item: NavItem; onPick?: () => void }) {
  const { tab, go } = useUi();
  const c = useCounts();
  const active = tab === item.id;
  const I = item.icon;
  const dot = item.id === 'mission' && !active && (c.warning || c.caution) ? (c.warning ? 'bg-warning' : 'bg-caution') : null;
  return (
    <button onClick={() => { go(item.id); onPick?.(); }} aria-current={active ? 'page' : undefined}
      className={cn('relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        active ? 'bg-accent text-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded before:bg-primary' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
      <I className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      <span>{item.label}</span>
      {dot && <span className={cn('ml-auto size-2 rounded-full', dot)} aria-label="Active alert" />}
    </button>
  );
}

function NavGroups({ section, onPick }: { section: Section; onPick?: () => void }) {
  return (
    <>
      {section.groups.map((g) => (
        <nav key={g.label} aria-label={g.label} className="mt-4 space-y-0.5">
          <div className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</div>
          {g.items.map((n) => <NavButton key={n.id} item={n} onPick={onPick} />)}
        </nav>
      ))}
    </>
  );
}

function Sidebar() {
  const { tab } = useUi();
  const section = sectionOf(tab);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar px-3 py-4 lg:flex">
      <div className="px-2 pb-4"><Brand /></div>
      <SectionSwitch />
      <p className="px-1 pt-2 text-[11px] leading-snug text-muted-foreground">{section.about}</p>
      <NavGroups section={section} />
      <p className="mt-auto px-2 pt-4 text-[11px] leading-snug text-muted-foreground">Not for clinical use. Radiation event: measured MSL RAD data. Crew sensors and vitals: simulated.</p>
    </aside>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useUi();
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = next === 'light' ? Sun : Moon;
  return (
    <Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-md" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => setTheme(next)}>
      <Icon className="size-5" aria-hidden="true" />
    </Button>
  );
}

/** Small replay control for the simulation views. The full controls are on Mission replay. */
function MiniReplay() {
  const { sim, go } = useUi();
  const cur = beatIndex(sim.world.t);
  const atEnd = sim.world.t >= REPLAY_END;
  return (
    <div className="flex items-center gap-1.5">
      <Button size="icon" variant="outline" className="size-9 rounded-md" disabled={atEnd} aria-label={sim.playing ? 'Pause the replay' : 'Play the replay'} onClick={() => sim.setPlaying(!sim.playing)}>
        {sim.playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
      </Button>
      <button type="button" onClick={() => go('mission')} className="hidden text-left text-xs leading-tight text-muted-foreground hover:text-foreground xl:block">
        Step {cur + 1} of {BEATS.length}<br /><span className="font-medium text-foreground">{cur < 0 ? 'Ready' : BEATS[cur].label}</span>
      </button>
    </div>
  );
}

function TopBar({ last }: { last: { t: number; text: string } | null }) {
  const { sim, tab } = useUi();
  const w = sim.world;
  const c = useCounts();
  const inSim = sectionOf(tab).id === 'sim';
  const delay = LINK_DELAY_MIN[w.link];
  const unack = w.activeAlerts.filter((a) => !a.acked && a.level !== 'advisory').length;
  const title = ITEMS.find((i) => i.id === tab)!.label;
  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-4 md:gap-3 md:px-6 lg:px-8">
        <div className="lg:hidden"><Brand /></div>
        <div className="hidden min-w-0 lg:block">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground" aria-live="polite">
            {last ? <>Last action <span className="num">{hhmm(last.t)}</span>: {last.text}</> : 'No crew action yet in this replay.'}
          </div>
        </div>
        {inSim && tab !== 'mission' && <div className="ml-2"><MiniReplay /></div>}
        <div className="ml-auto flex items-center gap-1.5" aria-label="Alert counts">
          <CountPill level="warning" n={c.warning} />
          <CountPill level="caution" n={c.caution} />
          {unack > 0 && <span className="hidden h-7 items-center rounded-md bg-muted px-2.5 text-xs font-medium xl:inline-flex"><b className="num mr-1">{unack}</b> not acknowledged</span>}
        </div>
        <div className="hidden items-center gap-2 rounded-md bg-muted px-2.5 py-1 text-xs font-medium sm:flex" title="Link to Earth">
          <span className={cn('size-2 rounded-full', delay === null ? 'bg-muted-foreground' : delay === 0 ? 'bg-nominal' : 'bg-advisory')} aria-hidden="true" />
          {LINK_LABEL[w.link]}
        </div>
        <div className="num text-right text-sm leading-tight font-semibold whitespace-nowrap" aria-label="Mission time">Day {dayOf(w.t)}<br className="sm:hidden" /> <span className="sm:text-base">{hhmm(w.t)}</span></div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** A rule that the crew turned off shows on every view (beta report S-2). */
/**
 * A banner on every view while a rule is inhibited or an alert is suppressed.
 * A suppressed alert stays active: the banner keeps it in sight (beta report S-1).
 */
function InhibitBanner() {
  const { sim, go, note } = useUi();
  const w = sim.world;
  const off = [...w.inhibited];
  const hidden = w.activeAlerts.filter((a) => a.suppressed);
  if (!off.length && !hidden.length) return null;
  return (
    <div role="status" className="border-b border-caution/40 bg-caution/15">
      <div className="mx-auto max-w-[1400px] space-y-1.5 px-4 py-2 text-sm md:px-6 lg:px-8">
        {hidden.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <LevelIcon level={a.level} className="size-4 text-caution-ink" />
            <span className="flex-1"><b>{a.id} is suppressed, but it is still active.</b> {LEVEL_WORD[a.level]}: {a.reason.replace(/\.$/, '')}.</span>
            <Button size="sm" variant="outline" className="rounded-md" onClick={() => { sim.act({ type: 'unsuppress', alertId: a.id }); note(`${a.id} shown again`); }}>Show again</Button>
          </div>
        ))}
        {off.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <TriangleAlert className="size-4 text-caution-ink" aria-hidden="true" />
            <span className="flex-1"><b>Inhibited: {off.join(', ')}.</b> The 10 × B floor still gives a Warning.</span>
            <Button size="sm" variant="outline" className="rounded-md" onClick={() => go('sources')}>Open the rules</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function CountPill({ level, n }: { level: 'warning' | 'caution'; n: number }) {
  const on = n > 0;
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-semibold',
      on ? (level === 'warning' ? 'bg-warning text-white' : 'bg-caution text-caution-foreground') : 'bg-muted text-muted-foreground')}>
      <LevelIcon level={level} className="size-3.5" />
      <span className="hidden md:inline">{level === 'warning' ? 'Warning' : 'Caution'}</span>
      <b className="num">{n}</b>
    </span>
  );
}

function MobileTabs() {
  const { tab, go } = useUi();
  const [more, setMore] = useState(false);
  const c = useCounts();
  const section = sectionOf(tab);
  const main = section.groups.flatMap((g) => g.items).filter((i) => i.short).slice(0, 4);
  const inMore = !main.some((m) => m.id === tab);
  const cell = 'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium';
  return (
    <>
      <nav aria-label="Views" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {main.map((n) => {
            const I = n.icon;
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => go(n.id)} aria-current={active ? 'page' : undefined} className={cn(cell, active ? 'text-primary' : 'text-muted-foreground')}>
                <span className="relative">
                  <I className="size-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  {n.id === 'mission' && (c.warning || c.caution) ? <span className={cn('absolute -top-0.5 -right-1 size-2 rounded-full', c.warning ? 'bg-warning' : 'bg-caution')} /> : null}
                </span>
                {n.short}
              </button>
            );
          })}
          <button onClick={() => setMore(true)} aria-current={inMore ? 'page' : undefined} className={cn(cell, 'col-start-5', inMore ? 'text-primary' : 'text-muted-foreground')}>
            <Ellipsis className="size-5" aria-hidden="true" />More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-8">
          <SheetHeader><SheetTitle>All views</SheetTitle><SheetDescription>Pick a section, then a view.</SheetDescription></SheetHeader>
          <div className="px-4">
            <SectionSwitch />
            <NavGroups section={section} onPick={() => setMore(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
