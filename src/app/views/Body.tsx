import { Bed, Brain, Eye, Wind, HeartPulse, Dumbbell, Bone, Radiation, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dayOf } from '../../engine/time';
import { fmt } from '../../engine/units';
import { actionSentence } from '../../engine/world';
import { BODY_RULES, jitter, limitRange, paramsOf, type BodySystem } from '../../engine/bodyRules';
import { cabinAt } from '../../engine/cabin';
import { useUi } from '../context';
import { LevelBadge, PageHead, Panel, Src, Spark } from '../parts';
import { sources } from '../sources';

const ROWS: { id: string; title: string; icon: typeof Bed; systems: BodySystem[]; from: string; risk: string }[] = [
  { id: 'rad', title: 'Radiation', icon: Radiation, systems: ['radiation', 'blood'], from: 'Dose (RAD event) and check-ins', risk: 'Acute radiation effects and cancer risk' },
  { id: 'air', title: 'Air and CO2 signs', icon: Wind, systems: ['air'], from: 'Cabin CO2 and check-ins', risk: 'Cabin CO2 exposure' },
  { id: 'eyes', title: 'Eyes (SANS)', icon: Eye, systems: ['vision'], from: 'Check-ins', risk: 'Neuro-ocular syndrome' },
  { id: 'sleep', title: 'Sleep', icon: Bed, systems: ['sleep'], from: 'Check-ins', risk: 'Sleep loss and circadian change' },
  { id: 'mood', title: 'Mood', icon: Brain, systems: ['mood'], from: 'Shared check-ins', risk: 'Behavioral health' },
  { id: 'heart', title: 'Resting heart rate', icon: HeartPulse, systems: ['heart'], from: 'Wearable', risk: 'Cardiovascular change' },
  { id: 'exercise', title: 'Exercise', icon: Dumbbell, systems: ['bone'], from: 'Exercise timeline', risk: 'Bone and muscle loss' },
  { id: 'bone', title: 'Bone (hip)', icon: Bone, systems: [], from: 'Model, 1 to 1.5% per month', risk: 'Bone loss' },
];

export function BodyView() {
  const { sim } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const days = Array.from({ length: 8 }, (_, i) => day - 7 + i);
  const checks = w.log.filter((e) => e.kind === 'checkin' && e.checkin && w.visibilityOf(e) !== 'private');
  const sleep = days.map((d, i) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.sleepH ?? 6.6 + jitter(i, 1) * 1.2);
  const mood = days.map((d, i) => checks.filter((e) => dayOf(e.t) === d).pop()?.checkin?.mood ?? 3.4 + jitter(i, 2));
  const input = w.bodyInput();
  const findings = w.bodyFindings();
  const vision = checks.filter((e) => e.checkin?.symptoms.some((x) => x === 'Blurred near vision' || x === 'Eye pressure')).length;
  const co2 = days.map((d) => cabinAt(d * 1440 + 720, 0).co2mmHg);
  const bone = days.map((d) => -(d / 30) * 1.1);
  const dose = days.map((d) => w.history.filter((h) => dayOf(h.t) === d).reduce((a, h) => a + h.personal / 60, 0));

  const data: Record<string, { latest: string; trend?: number[]; min?: number; max?: number; limit?: number }> = {
    rad: { latest: `${fmt(dose[7])} mSv today`, trend: dose, min: 0 },
    air: { latest: `${fmt(co2[7])} mmHg CO2`, trend: co2, min: 0, max: 4, limit: 3 },
    eyes: { latest: `${vision} logged` },
    sleep: { latest: `${fmt(sleep[7])} h`, trend: sleep, min: 3, max: 9 },
    mood: { latest: `${fmt(mood[7])} of 5`, trend: mood, min: 1, max: 5 },
    heart: { latest: `${input.hr[7]} bpm`, trend: input.hr, min: 45, max: 80 },
    exercise: { latest: `${input.exercise[7]} min`, trend: input.exercise, min: 20, max: 110 },
    bone: { latest: `${fmt(bone[7])}%`, trend: bone, min: bone[0] - 0.4, max: bone[7] + 0.4 },
  };

  return (
    <>
      <PageHead title="Body systems" sub="One card for each health risk in space. Body rules give Advisory or Caution only. Only radiation gives a Warning." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROWS.map((r) => {
          const mine = findings.filter((f) => r.systems.includes(f.system));
          const top = mine.find((f) => f.level === 'caution') ?? mine[0];
          // The radiation card follows the open radiation alert, so it never reads "In range" during a Warning.
          const storm = r.id === 'rad' ? w.openAlert('radiation') : undefined;
          const level = storm?.level ?? top?.level;
          const ids = BODY_RULES.filter((b) => r.systems.includes(b.system)).map((b) => b.id);
          const d = data[r.id];
          const I = r.icon;
          return (
            <section key={r.id} className={cn('flex flex-col rounded-xl bg-card p-4 ring-hairline', level === 'warning' ? 'ring-2 ring-warning' : level === 'caution' && 'ring-2 ring-caution')}>
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-md bg-muted"><I className="size-4" aria-hidden="true" /></span>
                <h2 className="text-sm font-semibold">{r.title}</h2>
                <span className="ml-auto">{level ? <LevelBadge level={level} /> : <LevelBadge level="nominal">In range</LevelBadge>}</span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div className="num text-2xl font-semibold tracking-tight">{d.latest}</div>
                {d.trend && <Spark values={d.trend} min={d.min} max={d.max} limit={d.limit} label={`${r.title}, 8-day trend`} className="h-9 w-28" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.risk}</p>
              {storm ? <p className="mt-2 rounded-md bg-muted/60 p-2 text-xs">{storm.id} is open. {actionSentence(storm, w)}</p>
                : top && <p className="mt-2 rounded-md bg-muted/60 p-2 text-xs">{top.title}. {top.why}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[11px] text-muted-foreground">
                <span className="truncate">{r.from}</span>
                {ids.length > 0 && <span className="ml-auto font-mono">{ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<Src k={id}>{id}</Src></span>)}</span>}
              </div>
            </section>
          );
        })}
      </div>
      <PersonalLimits />
      <p className="mt-4 text-xs text-muted-foreground">Days with no shared check-in show simulated sleep and mood values. Private check-ins are left out. Sources: {[...new Set(BODY_RULES.map((b) => b.source))].map((s) => (sources as Record<string, { short: string }>)[s]?.short ?? s).join('; ')}.</p>
    </>
  );
}

const LIMITS = BODY_RULES.flatMap((r) => Object.keys(r.personal ?? {}).map((param) => ({ ruleId: r.id, param, range: limitRange(r.id, param)! })));

/**
 * Personal alert limits. Each crew member sets them on their own device.
 * A limit can be stricter than the team value, never looser. Each change goes to the log for the CMO.
 */
function PersonalLimits() {
  const { sim, note } = useUi();
  const w = sim.world;
  const set = (ruleId: string, param: string, value: number, label: string) => {
    sim.act({ type: 'limit', ruleId, param, value });
    note(`${label} limit set to ${value}`);
  };
  return (
    <Panel title="Your alert limits" aside="Stricter than the team value only" className="mt-4">
      <p className="text-sm text-muted-foreground">Set a limit for your own body. For example, a crew member with a low normal heart rate can get an alert earlier. You cannot set a limit looser than the team value. The CMO sees each change in the log.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {LIMITS.map(({ ruleId, param, range: r }) => {
          const v = paramsOf(ruleId, w.personal)[param];
          const dir = r.strict > r.team ? 1 : -1;
          const step = (k: number) => Math.round((v + k * dir * r.step) * 100) / 100;
          return (
            <li key={`${ruleId}.${param}`} className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm"><span className="font-medium">{r.label}</span><Src k={ruleId} className="ml-auto font-mono text-xs">{ruleId}</Src></div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="icon" variant="outline" className="size-9 rounded-md" aria-label={`${r.label}: less strict`} disabled={v === r.team} onClick={() => set(ruleId, param, step(-1), r.label)}><Minus className="size-4" aria-hidden="true" /></Button>
                <span className="num min-w-20 flex-1 text-center text-lg font-semibold">{v} <span className="text-xs font-normal text-muted-foreground">{r.unit}</span></span>
                <Button size="icon" variant="outline" className="size-9 rounded-md" aria-label={`${r.label}: more strict`} disabled={v === r.strict} onClick={() => set(ruleId, param, step(1), r.label)}><Plus className="size-4" aria-hidden="true" /></Button>
              </div>
              <div className="num mt-1.5 text-[11px] text-muted-foreground">{v === r.team ? 'Team value' : `Team value ${r.team} ${r.unit}`}</div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
