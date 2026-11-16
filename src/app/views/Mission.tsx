import { Suspense, lazy } from 'react';
import { Pause, Play, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LINK_LABEL, type LinkState } from '../../engine/world';
import { REPLAY } from '../../engine/donki';
import { MIN_PER_DAY, stamp } from '../../engine/time';
import { lightMinutes, vehicleAt, TRANSIT_DAYS } from '../../engine/orbit';
import { BEATS, DEMO_START, REPLAY_END, SPEEDS, beatIndex } from '../../ui/useSim';
import { useUi } from '../context';
import { displayName } from '../profile';
import { InfoBadge, LINK_OPTIONS, LevelBadge, LiveNum, Panel, Prov, Seg } from '../parts';
import { Decision } from './Decision';

// three.js is large, so it loads after the first paint.
const MissionView = lazy(() => import('../../ui/MissionView'));

/**
 * Landing page: the storm replay, the alert panel, and the ship on its way to Mars.
 * On a wide screen the alert panel has its own column and stays in view.
 * On a narrow screen it moves to the top during a Caution or a Warning, so the action comes first.
 */
export function MissionPage() {
  const level = useUi().sim.world.activeAlerts[0]?.level;
  const loud = level === 'warning' || level === 'caution';
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
      <div className={cn('min-w-0 xl:sticky xl:top-[4.5rem] xl:col-start-2 xl:row-span-2 xl:row-start-1', loud ? 'order-first' : 'order-2')}><Decision /></div>
      <div className="order-1 min-w-0 xl:col-start-1"><DemoGuide /></div>
      <div className="order-3 min-w-0 xl:col-start-1"><ShipPanel /></div>
    </div>
  );
}

// Track points: the start, each step, and the end, spaced evenly on the track.
const POINTS = [DEMO_START, ...BEATS.map((b) => b.t), REPLAY_END];
const GAPS = POINTS.length - 1;

/** Position 0 to 1 of minute t on the track. */
function posOf(t: number): number {
  let k = 0;
  while (k < GAPS - 1 && t >= POINTS[k + 1]) k++;
  const f = (t - POINTS[k]) / (POINTS[k + 1] - POINTS[k]);
  return Math.min(1, Math.max(0, (k + f) / GAPS));
}

/** Minute at position x (0 to 1) on the track. */
function timeAt(x: number): number {
  const u = Math.min(1, Math.max(0, x)) * GAPS;
  const k = Math.min(GAPS - 1, Math.floor(u));
  return Math.round(POINTS[k] + (u - k) * (POINTS[k + 1] - POINTS[k]));
}

/** The demo controls, with steps that explain what each moment shows. */
function DemoGuide() {
  const { sim, note, profile } = useUi();
  const w = sim.world;
  const cur = beatIndex(w.t);
  const atEnd = w.t >= REPLAY_END;
  const next = BEATS[cur + 1];
  const togglePlay = () => {
    if (atEnd) sim.restart();
    sim.setPlaying(atEnd || !sim.playing);
  };
  return (
    <Panel title="Storm replay: March 2012" aside={<Prov kind="measured">Real radiation data, MSL RAD</Prov>} id="demo-h">
      <p className="max-w-3xl text-[15px] text-muted-foreground">
        {displayName(profile)}, you are on a ship to Mars, and a real solar storm is coming. Press Play. The alert panel tells you what to do.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg" className="h-12 min-w-32 rounded-md px-5 text-base" onClick={togglePlay} aria-pressed={sim.playing}>
          {sim.playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
          {sim.playing ? 'Pause' : atEnd ? 'Play again' : 'Play'}
          <kbd className="ml-1 hidden rounded border border-current/30 px-1.5 font-sans text-[11px] font-medium opacity-70 sm:inline">Space</kbd>
        </Button>
        <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">Speed</span>
          <Seg label="Replay speed" value={sim.speed.id} onChange={(id) => sim.setSpeed(SPEEDS.find((s) => s.id === id)!)} options={SPEEDS.map((s) => ({ value: s.id, label: s.label }))} />
        </div>
        <label className="flex items-center gap-2 text-xs"><Switch checked={sim.pauseOnAlert} onCheckedChange={sim.setPauseOnAlert} />Pause at each new alert</label>
        <Button variant="outline" className="ml-auto h-10 rounded-md" onClick={() => { sim.restart(); note('Demo reset'); }}><RotateCcw className="size-4" aria-hidden="true" />Reset demo</Button>
      </div>

      {/* Time track. The steps are spaced evenly, so close steps stay apart. A tap on the track jumps to that time. */}
      <div className="mt-5">
        <div className="relative mx-4 h-10">
          <button type="button" aria-label="Jump to a time on the replay" className="absolute inset-x-0 top-3.5 h-3 cursor-pointer rounded-full bg-muted"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); sim.jumpTo(timeAt((e.clientX - r.left) / r.width)); }}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-100 ease-linear" style={{ width: `${posOf(w.t) * 100}%` }} />
          </button>
          {BEATS.map((b, i) => (
            <button key={b.label} type="button" onClick={() => sim.jumpTo(b.t)} aria-label={`Step ${i + 1}: ${b.label}`}
              className={cn('num absolute top-1 grid size-8 -translate-x-1/2 place-items-center rounded-full border-2 text-sm font-semibold transition-[color,background-color,border-color,scale] duration-200 hover:scale-110 sm:top-0 sm:size-10',
                i === cur ? 'border-primary bg-primary text-primary-foreground' : i < cur ? 'border-primary bg-card text-primary' : 'border-border bg-card text-muted-foreground')}
              style={{ left: `${posOf(b.t) * 100}%` }}>{i + 1}</button>
          ))}
        </div>
        <div className="num mt-1 flex justify-between text-[11px] text-muted-foreground"><span>Start {stamp(DEMO_START)}</span><span>End {stamp(REPLAY_END)}</span></div>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {BEATS.map((b, i) => (
          // On a phone, only the current step shows. The track above gives the others.
          <li key={b.label} className={cn(i !== Math.max(cur, 0) && 'hidden sm:block')}>
            <button type="button" onClick={() => sim.jumpTo(b.t)} aria-current={i === cur ? 'step' : undefined}
              className={cn('flex h-full w-full flex-col gap-1.5 rounded-md border p-3 text-left transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent active:translate-y-0 motion-reduce:transform-none',
                i === cur ? 'border-primary bg-accent' : 'border-border')}>
              <span className="flex items-center gap-2">
                <span className={cn('num grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold', i <= cur ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  {i < cur ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                <span className="font-semibold">{b.label}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="num text-xs whitespace-nowrap text-muted-foreground">{stamp(b.t)}</span><LevelBadge level={b.level} className="ml-auto h-5 px-2 text-[11px]" /></span>
              {i === cur && <span className="text-sm leading-snug">{b.text}</span>}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {cur < 0 ? 'Ready.' : `Step ${cur + 1} of ${BEATS.length}: ${BEATS[cur].label}.`}
        {next ? ` Next: ${next.label} at ${stamp(next.t)}.` : ' This is the last step.'}
      </p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Link to Earth: {LINK_LABEL[w.link]}</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Seg<LinkState> label="Link to Earth" value={w.link} onChange={(l) => { sim.act({ type: 'link', link: l }); note(`Link set to ${LINK_LABEL[l].toLowerCase()}`); }} options={LINK_OPTIONS} />
          <span className="text-muted-foreground">Set Offline to show a blackout. The ground gets a summary when the link returns.</span>
        </div>
      </details>
    </Panel>
  );
}

/** The ship on its transfer to Mars. The particles show the solar event. */
function ShipPanel() {
  const { sim, theme } = useUi();
  const w = sim.world;
  const day = w.t / MIN_PER_DAY;
  const level = w.openAlert('radiation')?.level;
  const sepActive = REPLAY.some((r) => r.kind === 'SEP' && r.t <= w.t && (r.tEnd ?? Infinity) > w.t);
  const storm = level === 'warning' ? 'hit' : sepActive || level === 'caution' ? 'watch' : 'none';
  const v = vehicleAt(day);
  return (
    <Panel title="Your ship" aside={storm === 'hit' ? <InfoBadge level="warning" k="protons">Protons at the ship</InfoBadge> : storm === 'watch' ? <InfoBadge level="caution" k="solarEvent">Solar event</InfoBadge> : <span>No solar event</span>} bodyClass="px-0 pb-0">
      <div className="relative">
        <Suspense fallback={<div className="mv grid place-items-center text-sm text-muted-foreground">Loading the ship view.</div>}>
          <MissionView day={day} storm={storm} shelter={w.inShelter} theme={theme} />
        </Suspense>
        <dl className="num grid grid-cols-2 gap-x-4 gap-y-0.5 border-b px-5 py-2 text-xs sm:pointer-events-none sm:absolute sm:top-3 sm:left-3 sm:rounded-md sm:border-0 sm:bg-background/85 sm:px-3">
          <div><dt className="inline text-muted-foreground">Day </dt><dd className="inline font-semibold"><LiveNum value={day} /> of {TRANSIT_DAYS}</dd></div>
          <div><dt className="inline text-muted-foreground">From the Sun </dt><dd className="inline font-semibold"><LiveNum value={Math.hypot(v.x, v.y)} /> AU</dd></div>
          <div><dt className="inline text-muted-foreground">Light time to Earth </dt><dd className="inline font-semibold"><LiveNum value={lightMinutes(day)} /> min</dd></div>
          <div><dt className="inline text-muted-foreground">Link </dt><dd className="inline font-semibold">{LINK_LABEL[w.link]}</dd></div>
        </dl>
      </div>
      <p className="px-5 py-3 text-xs text-muted-foreground">Drag to turn the view. The shell is a CME, the particles are solar protons, and the blue bubble is the shelter.</p>
    </Panel>
  );
}
