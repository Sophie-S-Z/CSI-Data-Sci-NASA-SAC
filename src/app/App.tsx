import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { MotionConfig, motion } from 'motion/react';
import {
  Radiation, Wind, HeartPulse, ClipboardCheck, ScrollText, FlaskConical, Microscope, Orbit, Stethoscope, Satellite, BookOpen,
  Ellipsis, Sparkles, SunMedium, SlidersHorizontal, Play, Pause, TriangleAlert, FileText, Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { LINK_LABEL, LINK_DELAY_MIN } from '../engine/world';
import { dayOf, hhmm } from '../engine/time';
import { useSim, BEATS, REPLAY_END, beatIndex } from '../ui/useSim';
import { UiContext, useUi, type Tab, type Theme, type Ui } from './context';
import { initials, loadProfile, saveProfile, type Profile } from './profile';
import { ProfileSheet } from './ProfileSheet';
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
  report: view(() => import('./views/Report'), 'ReportView'),
  ask: view(() => import('./views/Ask'), 'AskView'),
  cmo: view(() => import('./views/Team'), 'CmoView'),
  ground: view(() => import('./views/Team'), 'GroundView'),
  explorer: view(() => import('./views/Explorer'), 'ExplorerView'),
  evidence: view(() => import('./views/Evidence'), 'EvidenceView'),
  research: view(() => import('./views/Research'), 'ResearchView'),
  sources: view(() => import('./views/Sources'), 'SourcesView'),
};

const THEME_KEY = 'storm-shelter.theme.v3';

/** `short` marks the 4 views in the phone tab bar, with the short label. */
interface NavItem { id: Tab; label: string; icon: typeof Radiation; short?: string }
interface Section { id: 'sim' | 'real'; label: string; icon: typeof Radiation; about: string; groups: { label: string; items: NavItem[] }[] }

/** The app has 2 sections: the simulation (a replay with simulated crew data) and the real-world data behind it. */
const SECTIONS: Section[] = [
  {
    id: 'sim', label: 'Simulation', icon: Orbit, about: 'Real March 2012 storm data. The crew, sensors, and vitals are simulated.',
    groups: [
      { label: 'Storm replay', items: [
        { id: 'mission', label: 'Mission replay', icon: Orbit, short: 'Replay' },
        { id: 'radiation', label: 'Cabin radiation', icon: Radiation, short: 'Cabin' },
        { id: 'weather', label: 'Space weather', icon: SunMedium },
        { id: 'air', label: 'Cabin air', icon: Wind },
      ] },
      { label: 'Crew', items: [
        { id: 'ask', label: 'Ask AI', icon: Sparkles, short: 'Ask AI' },
        { id: 'checkin', label: 'Health check', icon: ClipboardCheck, short: 'Check-in' },
        { id: 'body', label: 'Body', icon: HeartPulse },
        { id: 'log', label: 'Log', icon: ScrollText },
        { id: 'report', label: 'Daily report', icon: FileText },
      ] },
      { label: 'Mission team', items: [
        { id: 'cmo', label: 'CMO', icon: Stethoscope },
        { id: 'ground', label: 'Flight-surgeon handoff', icon: Satellite },
      ] },
      { label: 'What-if', items: [{ id: 'explorer', label: 'Limits explorer', icon: SlidersHorizontal, short: 'What-if' }] },
    ],
  },
  {
    id: 'real', label: 'Real-world data', icon: Database, about: 'Measured spacecraft data and published NASA limits. Nothing here is simulated.',
    groups: [{ label: 'Measured and published', items: [
      { id: 'evidence', label: 'Measured events', icon: FlaskConical, short: 'Events' },
      { id: 'research', label: 'Research', icon: Microscope, short: 'Research' },
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
  const [profile, setProfileState] = useState<Profile>(loadProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const setProfile = useCallback((p: Profile) => { setProfileState(p); saveProfile(p); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F4F5F6' : '#08090B');
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // Space plays or pauses the replay, except while the focus is on a control or a text field.
  const { playing, setPlaying } = sim;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, textarea, select, button, [role="radio"], [role="tab"]')) return;
      e.preventDefault();
      setPlaying(!playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, setPlaying]);

  const go = useCallback((t: Tab) => { setTab(t); window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, []);

  const ui: Ui = useMemo(() => ({
    sim, tab, go,
    openSource: (k) => setSource(k),
    openProcedure: () => { setTab('mission'); setProcOpen(true); },
    procOpen, setProcOpen,
    note: (text) => setLast({ t: sim.world.t, text }),
    theme, setTheme, profile, setProfile,
    openProfile: () => setProfileOpen(true),
  }), [sim, tab, go, procOpen, theme, profile, setProfile]);

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
              <ModeBanner />
              <InhibitBanner />
              <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 md:px-6 lg:px-8 lg:pb-10">
                <Suspense fallback={<ViewSkeleton />}>
                  {/* Each view comes in with a short ease-out fade. No exit animation, so a tap feels instant. */}
                  <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}><View /></motion.div>
                </Suspense>
              </main>
            </div>
          </div>
          <MobileTabs />
          <SourceSheet k={source} onClose={() => setSource(null)} />
          <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
        </UiContext.Provider>
      </TooltipProvider>
    </MotionConfig>
  );
}

/** Placeholder with the shape of a view, while its code loads. */
function ViewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the view" className="animate-pulse motion-reduce:animate-none">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="mt-3 h-4 w-full max-w-xl rounded-md bg-muted" />
      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="h-80 rounded-xl bg-muted" /><div className="h-80 rounded-xl bg-muted" /></div>
    </div>
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

/**
 * Simulation or Real-world data: the first choice in the app, in the top bar on every screen.
 * A tap opens the first view of that mode.
 */
function ModeSwitch() {
  const { tab, go } = useUi();
  const cur = sectionOf(tab).id;
  return (
    <div role="tablist" aria-label="Data mode" className="grid h-10 grid-cols-2 rounded-full bg-muted p-1">
      {SECTIONS.map((s) => {
        const I = s.icon;
        const on = cur === s.id;
        return (
          <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => !on && go(s.groups[0].items[0].id)}
            className={cn('flex items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors',
              on ? (s.id === 'sim' ? 'bg-primary text-primary-foreground' : 'bg-nominal text-background') : 'text-muted-foreground hover:text-foreground')}>
            <I className="size-4" aria-hidden="true" />
            <span className="sm:hidden">{s.id === 'sim' ? 'Simulation' : 'Real data'}</span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One line under the top bar: what the data in this mode is. It replaces a "Simulated" label on each panel. */
function ModeBanner() {
  const { tab } = useUi();
  const s = sectionOf(tab);
  return (
    <div className={cn('border-b text-xs print:hidden', s.id === 'sim' ? 'bg-primary/8' : 'bg-nominal/10')}>
      <p className="mx-auto max-w-[1400px] px-4 py-1.5 md:px-6 lg:px-8"><b>{s.label}.</b> {s.about} Not for clinical use.</p>
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
  return (
    <aside className="sticky top-0 hidden print:hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar px-3 py-4 lg:flex">
      <div className="px-2 pb-2"><Brand /></div>
      <NavGroups section={sectionOf(tab)} />
    </aside>
  );
}

/** The crew member's initials. A tap opens the profile and settings. */
function ProfileButton() {
  const { profile, openProfile } = useUi();
  return (
    <button type="button" onClick={openProfile} aria-label="Profile and settings" title="Profile and settings"
      className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary ring-1 ring-primary/30 hover:bg-primary/25">
      {initials(profile)}
    </button>
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
      <button type="button" onClick={() => go('mission')} className="hidden text-left text-xs leading-tight whitespace-nowrap text-muted-foreground hover:text-foreground 2xl:block">
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
  const title = ITEMS.find((i) => i.id === tab)!.label;
  return (
    <header className="sticky top-0 z-30 border-b print:hidden bg-background pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-4 md:gap-3 md:px-6 lg:px-8">
        <div className="lg:hidden"><Brand /></div>
        <div className="hidden min-w-0 lg:block xl:w-56">
          <div className="truncate text-sm font-semibold">{title}</div>
          {inSim && <div className="truncate text-xs text-muted-foreground" aria-live="polite">{last ? <>Last action <span className="num">{hhmm(last.t)}</span>: {last.text}</> : 'No crew action yet.'}</div>}
        </div>
        <div className="hidden sm:block"><ModeSwitch /></div>
        {inSim && tab !== 'mission' && <MiniReplay />}
        {inSim && (
          <>
            <div className="ml-auto flex items-center gap-1.5" aria-label="Alert counts">
              <CountPill level="warning" n={c.warning} />
              <CountPill level="caution" n={c.caution} />
            </div>
            <div className="hidden items-center gap-2 rounded-md bg-muted px-2.5 py-1 text-xs font-medium whitespace-nowrap 2xl:flex" title="Link to Earth">
              <span className={cn('size-2 rounded-full', delay === null ? 'bg-muted-foreground' : delay === 0 ? 'bg-nominal' : 'bg-advisory')} aria-hidden="true" />
              {LINK_LABEL[w.link]}
            </div>
            <div className="num text-right text-sm leading-tight font-semibold whitespace-nowrap" aria-label="Mission time">Day {dayOf(w.t)}<br className="sm:hidden" /> <span className="sm:text-base">{hhmm(w.t)}</span></div>
          </>
        )}
        <div className={cn(!inSim && 'ml-auto')}><ProfileButton /></div>
      </div>
      <div className="px-4 pb-2 sm:hidden"><ModeSwitch /></div>
    </header>
  );
}

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
    <div role="status" className="border-b border-caution/40 print:hidden bg-caution/15">
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
  const cell = (on: boolean) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', on ? 'text-foreground' : 'text-muted-foreground');
  // The active view gets a filled pill behind its icon, as in a native tab bar.
  const pill = (on: boolean) => cn('relative grid h-7 w-14 place-items-center rounded-full transition-colors', on && 'bg-primary/20 text-primary');
  return (
    <>
      <nav aria-label="Views" className="fixed print:hidden inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${main.length + 1}, minmax(0, 1fr))` }}>
          {main.map((n) => {
            const I = n.icon;
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => go(n.id)} aria-current={active ? 'page' : undefined} className={cell(active)}>
                <span className={pill(active)}>
                  <I className="size-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  {n.id === 'mission' && (c.warning || c.caution) ? <span className={cn('absolute top-0 right-3 size-2 rounded-full', c.warning ? 'bg-warning' : 'bg-caution')} /> : null}
                </span>
                {n.short}
              </button>
            );
          })}
          <button onClick={() => setMore(true)} aria-current={inMore ? 'page' : undefined} className={cell(inMore)}>
            <span className={pill(inMore)}><Ellipsis className="size-5" aria-hidden="true" /></span>More
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-8">
          <SheetHeader><SheetTitle>{section.label}</SheetTitle><SheetDescription>{section.about}</SheetDescription></SheetHeader>
          <div className="px-4"><NavGroups section={section} onPick={() => setMore(false)} /></div>
        </SheetContent>
      </Sheet>
    </>
  );
}
