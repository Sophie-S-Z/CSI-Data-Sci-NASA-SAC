import { Bed, Brain, Eye, Wind, HeartPulse, Dumbbell, Bone, Radiation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dayOf } from '../../engine/time';
import { fmt } from '../../engine/units';
import { BODY_RULES, jitter, type BodySystem } from '../../engine/bodyRules';
import { cabinAt } from '../../engine/cabin';
import { useUi } from '../context';
import { LevelBadge, PageHead, Prov, Src, Spark, type Provenance } from '../parts';
import { sources } from '../sources';

const ROWS: { id: string; title: string; icon: typeof Bed; systems: BodySystem[]; prov: Provenance; from: string; risk: string }[] = [
  { id: 'rad', title: 'Radiation', icon: Radiation, systems: ['radiation', 'blood'], prov: 'measured', from: 'Dose (RAD event) and check-ins', risk: 'Acute radiation effects and cancer risk' },
  { id: 'air', title: 'Air and CO2 signs', icon: Wind, systems: ['air'], prov: 'simulated', from: 'Cabin CO2 and check-ins', risk: 'Cabin CO2 exposure' },
  { id: 'eyes', title: 'Eyes (SANS)', icon: Eye, systems: ['vision'], prov: 'replay', from: 'Check-ins', risk: 'Neuro-ocular syndrome' },
  { id: 'sleep', title: 'Sleep', icon: Bed, systems: ['sleep'], prov: 'replay', from: 'Check-ins', risk: 'Sleep loss and circadian change' },
  { id: 'mood', title: 'Mood', icon: Brain, systems: ['mood'], prov: 'replay', from: 'Shared check-ins', risk: 'Behavioral health' },
  { id: 'heart', title: 'Resting heart rate', icon: HeartPulse, systems: ['heart'], prov: 'simulated', from: 'Wearable (simulated)', risk: 'Cardiovascular change' },
  { id: 'exercise', title: 'Exercise', icon: Dumbbell, systems: ['bone'], prov: 'simulated', from: 'Timeline (simulated)', risk: 'Bone and muscle loss' },
  { id: 'bone', title: 'Bone (hip)', icon: Bone, systems: [], prov: 'simulated', from: 'Model, 1 to 1.5% per month', risk: 'Bone loss' },
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
      <PageHead title="Body systems" sub="One card for each risk that the challenge names. Body rules give Advisory or Caution only. Radiation stays the only Warning. Each card says where its data comes from." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROWS.map((r) => {
          const mine = findings.filter((f) => r.systems.includes(f.system));
          const top = mine.find((f) => f.level === 'caution') ?? mine[0];
          const ids = BODY_RULES.filter((b) => r.systems.includes(b.system)).map((b) => b.id);
          const d = data[r.id];
          const I = r.icon;
          return (
            <section key={r.id} className={cn('flex flex-col rounded-2xl bg-card p-4 ring-hairline', top?.level === 'caution' && 'ring-2 ring-caution')}>
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-muted"><I className="size-4" aria-hidden="true" /></span>
                <h2 className="text-sm font-semibold">{r.title}</h2>
                <span className="ml-auto">{top ? <LevelBadge level={top.level} /> : <LevelBadge level="nominal">In range</LevelBadge>}</span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div className="num text-2xl font-semibold tracking-tight">{d.latest}</div>
                {d.trend && <Spark values={d.trend} min={d.min} max={d.max} limit={d.limit} label={`${r.title}, 8-day trend`} className="h-9 w-28" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.risk}</p>
              {top && <p className="mt-2 rounded-lg bg-muted/60 p-2 text-xs">{top.title}. {top.why}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[11px] text-muted-foreground">
                <Prov kind={r.prov}>{r.prov === 'replay' ? 'Check-ins' : undefined}</Prov>
                <span className="truncate">{r.from}</span>
                {ids.length > 0 && <span className="ml-auto font-mono">{ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<Src k={id}>{id}</Src></span>)}</span>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Days with no shared check-in show simulated sleep and mood values. Private check-ins are left out. Sources: {[...new Set(BODY_RULES.map((b) => b.source))].map((s) => (sources as Record<string, { short: string }>)[s]?.short ?? s).join('; ')}.</p>
    </>
  );
}
