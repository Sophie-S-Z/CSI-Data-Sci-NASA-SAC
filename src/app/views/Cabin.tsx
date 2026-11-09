import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid } from 'recharts';
import { Wind, Thermometer, Droplets, Gauge, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { World } from '../../engine/world';
import { cabinAt, cabinFindings, CABIN, type CabinReading } from '../../engine/cabin';
import { dayOf, hhmm, stamp } from '../../engine/time';
import { useUi } from '../context';
import { LevelBadge, PageHead, Panel, Prov, Src } from '../parts';

const L = CABIN.limits;

function shelterMinAt(w: World, t: number): number {
  const iv = w.shelterIntervals.find((x) => x.start <= t && (x.end ?? Infinity) > t);
  return iv ? t - iv.start : 0;
}

interface Param {
  key: keyof CabinReading;
  title: string;
  unit: string;
  digits: number;
  icon: typeof Wind;
  src: string;
  domain: [number, number];
  health?: [number, number];
  comfort?: [number, number];
  max?: number;
}

const PARAMS: Param[] = [
  { key: 'co2mmHg', title: 'CO2, 1-hour average', unit: 'mmHg', digits: 2, icon: Wind, src: 'cabinCo2', domain: [0, 5], max: L.co2HourMmHg.max },
  { key: 'tempC', title: 'Temperature', unit: '°C', digits: 1, icon: Thermometer, src: 'cabinTemp', domain: [16, 29], health: [L.tempHealthC.min, L.tempHealthC.max], comfort: [L.tempComfortC.min, L.tempComfortC.max] },
  { key: 'rhPct', title: 'Relative humidity', unit: '%', digits: 0, icon: Droplets, src: 'cabinRh', domain: [15, 85], health: [L.rhHealthPct.min, L.rhHealthPct.max], comfort: [L.rhComfortPct.min, L.rhComfortPct.max] },
  { key: 'ppO2mmHg', title: 'Oxygen partial pressure', unit: 'mmHg', digits: 0, icon: Activity, src: 'cabinO2', domain: [135, 165], comfort: [L.ppO2TargetMmHg.min, L.ppO2TargetMmHg.max] },
  { key: 'totalKPa', title: 'Total pressure', unit: 'kPa', digits: 1, icon: Gauge, src: 'cabinP', domain: [95, 105], health: [L.totalKPa.min, L.totalKPa.max] },
];

function statusOf(p: Param, v: number): 'nominal' | 'advisory' | 'caution' {
  if (p.max !== undefined) return v > p.max ? 'caution' : v > p.max * 0.9 ? 'advisory' : 'nominal';
  if (p.health && (v < p.health[0] || v > p.health[1])) return 'caution';
  if (p.comfort && (v < p.comfort[0] || v > p.comfort[1])) return 'advisory';
  return 'nominal';
}

/** Where the value sits on its scale, with the limit bands. */
function Band({ p, v }: { p: Param; v: number }) {
  const [lo, hi] = p.domain;
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="relative mt-3 h-2 rounded-full bg-caution/30">
      {p.max !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-nominal/35" style={{ width: pos(p.max) }} />}
      {p.health && <div className="absolute inset-y-0 rounded-full bg-advisory/25" style={{ left: pos(p.health[0]), width: `calc(${pos(p.health[1])} - ${pos(p.health[0])})` }} />}
      {p.comfort && <div className="absolute inset-y-0 rounded-full bg-nominal/40" style={{ left: pos(p.comfort[0]), width: `calc(${pos(p.comfort[1])} - ${pos(p.comfort[0])})` }} />}
      <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow" style={{ left: pos(v) }} />
    </div>
  );
}

export function CabinView() {
  const { sim } = useUi();
  const w = sim.world;
  const shelterMin = shelterMinAt(w, w.t);
  const r = cabinAt(w.t, shelterMin);
  const findings = cabinFindings(r);
  const [sel, setSel] = useState<keyof CabinReading>('co2mmHg');
  const p = PARAMS.find((x) => x.key === sel)!;
  const bucket = Math.floor(w.t / 15);
  const series = useMemo(() => {
    const out: { t: number; v: number }[] = [];
    for (let t = w.t - 72 * 60; t <= w.t; t += 20) out.push({ t, v: cabinAt(t, shelterMinAt(w, t))[sel] });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, sel, w.shelterIntervals.length]);

  return (
    <>
      <PageHead title="Cabin air" sub={<>The air the crew breathes. Limits come from NASA-STD-3001 Volume 2. The crew values are <b>simulated</b>, because no open database gives a live crew cabin stream.</>}
        actions={<Prov kind="standard">Limits: NASA-STD-3001 Vol 2</Prov>} />
      {shelterMin > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-caution/15 p-4 text-sm ring-1 ring-caution/40">
          <LevelBadge level="advisory">Shelter effect</LevelBadge>
          <span className="flex-1">Four crew share the small shelter volume. The model raises CO2, temperature, and humidity as the stay gets longer. Run the shelter fan. Log any headache.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {PARAMS.map((x) => {
          const v = r[x.key];
          const st = statusOf(x, v);
          const I = x.icon;
          return (
            <button key={x.key} onClick={() => setSel(x.key)} aria-pressed={sel === x.key}
              className={cn('rounded-2xl bg-card p-4 text-left ring-hairline transition hover:-translate-y-0.5', sel === x.key && 'ring-2 ring-primary')}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><I className="size-4" aria-hidden="true" /><span className="truncate">{x.title}</span></div>
              <div className={cn('num mt-2 text-3xl font-semibold tracking-tight', st === 'caution' && 'text-caution-ink')}>{v.toFixed(x.digits)}<span className="ml-1 text-sm font-normal text-muted-foreground">{x.unit}</span></div>
              <Band p={x} v={v} />
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className={cn('font-medium', st === 'nominal' ? 'text-nominal' : st === 'advisory' ? 'text-advisory' : 'text-caution-ink')}>{st === 'nominal' ? 'In range' : st === 'advisory' ? 'Outside comfort' : 'Over limit'}</span>
                <Src k={x.src} className="text-muted-foreground">Limit</Src>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`${p.title}, last 72 h`} aside={<><Prov kind="simulated" /><Src k={p.src}>NASA limit</Src></>}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {p.comfort && <ReferenceArea y1={p.comfort[0]} y2={p.comfort[1]} fill="var(--nominal)" fillOpacity={0.08} />}
                {p.max !== undefined && <ReferenceLine y={p.max} stroke="var(--caution)" strokeWidth={1.5} label={{ value: `Limit ${p.max} ${p.unit}`, position: 'insideTopLeft', fontSize: 11 }} />}
                {p.key === 'co2mmHg' && <ReferenceLine y={L.co2WeekMmHg.max} stroke="var(--advisory)" strokeDasharray="4 4" label={{ value: '7-day goal 2.5', position: 'insideBottomLeft', fontSize: 11 }} />}
                {p.health && p.key !== 'totalKPa' && <><ReferenceLine y={p.health[0]} stroke="var(--caution)" /><ReferenceLine y={p.health[1]} stroke="var(--caution)" /></>}
                {w.shelterIntervals.map((iv, i) => <ReferenceArea key={i} x1={Math.max(iv.start, w.t - 72 * 60)} x2={iv.end ?? w.t} fill="var(--warning)" fillOpacity={0.07} ifOverflow="hidden" />)}
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => `D${dayOf(t)} ${hhmm(t)}`} tickCount={5} tickLine={false} axisLine={false} />
                <YAxis domain={p.key === 'co2mmHg' ? [0, 5] : ['auto', 'auto']} tickLine={false} axisLine={false} width={44} />
                <RTooltip isAnimationActive={false} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} labelFormatter={(t) => stamp(Number(t))} formatter={(v) => [`${Number(v).toFixed(p.digits)} ${p.unit}`, p.title]} />
                <Line type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Tinted red: time in the storm shelter. CO2 7-day average now <span className="num font-medium text-foreground">{r.co2Day7.toFixed(2)} mmHg</span>.</p>
        </Panel>
        <div className="space-y-4">
          <Panel title="What the rules see" aside={findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}` : 'All in range'}>
            {findings.length === 0 ? <p className="text-sm text-muted-foreground">All values are inside the NASA limits.</p> : (
              <ul className="space-y-2">{findings.map((f) => (
                <li key={f.id} className="rounded-xl bg-muted/50 p-3 text-sm"><LevelBadge level={f.level} /> <b className="ml-1">{f.title}.</b> {f.text} <Src k={f.source === 'ochmoCo2' ? 'cabinCo2' : 'cabinTemp'} className="text-xs text-muted-foreground">Source</Src></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Why CO2 matters">
            <ul className="space-y-2 text-sm leading-relaxed">
              <li>NASA limits the 1-hour average to <Src k="cabinCo2">3 mmHg</Src> [V2 6004]. ISS levels ranged from 1 to 9 mmHg.</li>
              <li>In 49 ISS crew, a 7-day average under 2.5 mmHg kept the headache risk under 1% (Law et al. 2014).</li>
              <li>Headache and vision change are also signs of fluid shift (SANS). The Body view puts CO2 and symptoms side by side.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
