import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid } from 'recharts';
import { Wind, Thermometer, Droplets, Gauge, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cabinAt, cabinFindings, type CabinReading } from '../../engine/cabin';
import { FACTOR, levelAt, type Factor, type ZoneLevel } from '../../engine/limits';
import { dayOf, hhmm, stamp } from '../../engine/time';
import { fmt } from '../../engine/units';
import { useUi } from '../context';
import { LevelBadge, PageHead, Panel, Prov, Src, ZoneBar } from '../parts';

const PARAMS: { key: keyof CabinReading & Factor['key']; icon: typeof Wind }[] = [
  { key: 'co2mmHg', icon: Wind },
  { key: 'tempC', icon: Thermometer },
  { key: 'rhPct', icon: Droplets },
  { key: 'ppO2mmHg', icon: Activity },
  { key: 'totalKPa', icon: Gauge },
];

const RANK: Record<ZoneLevel, number> = { nominal: 0, advisory: 1, caution: 2, warning: 3 };
const STATUS: Record<ZoneLevel, string> = { nominal: 'In range', advisory: 'Outside comfort', caution: 'Over limit', warning: 'Over limit' };

export function CabinView() {
  const { sim } = useUi();
  const w = sim.world;
  const shelterMin = w.shelterMinAt();
  const r = cabinAt(w.t, shelterMin);
  const findings = cabinFindings(r);
  const [sel, setSel] = useState<(typeof PARAMS)[number]['key']>('co2mmHg');
  const p = FACTOR[sel];
  const zones = p.zones('cabin');
  // One line at each zone edge, in the color of the worse side.
  const edges = zones.slice(1).map((z, i) => ({ y: z.from, level: RANK[z.level] > RANK[zones[i].level] ? z.level : zones[i].level }));
  const bucket = Math.floor(w.t / 15);
  const series = useMemo(() => {
    const out: { t: number; v: number }[] = [];
    for (let t = w.t - 72 * 60; t <= w.t; t += 20) out.push({ t, v: cabinAt(t, w.shelterMinAt(t))[sel] });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, sel, w.shelterIntervals.length]);

  return (
    <>
      <PageHead title="Cabin air" sub="The air you breathe. The limits come from NASA-STD-3001 Volume 2."
        actions={<Prov kind="standard">Limits: NASA-STD-3001 Vol 2</Prov>} />
      {shelterMin > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-shelter/40 bg-shelter/10 p-4 text-sm">
          <LevelBadge level="advisory">Shelter effect</LevelBadge>
          <span className="flex-1">Four crew share the small shelter volume. The model raises CO2, temperature, and humidity as the stay gets longer. Run the shelter fan. Log any headache.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {PARAMS.map(({ key, icon: I }) => {
          const x = FACTOR[key];
          const v = r[key];
          const st = levelAt(x.zones('cabin'), v);
          return (
            <button key={key} onClick={() => setSel(key)} aria-pressed={sel === key}
              className={cn('rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', sel === key && 'border-primary')}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><I className="size-4" aria-hidden="true" /><span className="truncate">{x.title}</span></div>
              <div className={cn('num mt-2 text-3xl font-semibold tracking-tight', st === 'caution' && 'text-caution-ink')}>{fmt(v)}<span className="ml-1 text-sm font-normal text-muted-foreground">{x.unit}</span></div>
              <ZoneBar f={x} zones={x.zones('cabin')} v={v} className="mt-3" />
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className={cn('font-medium', st === 'nominal' ? 'text-nominal' : st === 'advisory' ? 'text-advisory' : 'text-caution-ink')}>{STATUS[st]}</span>
                <Src k={x.src} className="text-muted-foreground">Limit</Src>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`${p.title}, last 72 h`} aside={<Src k={p.src}>NASA limit</Src>}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {zones.filter((z) => z.level === 'nominal').map((z, i) => <ReferenceArea key={`n${i}`} y1={z.from} y2={z.to} fill="var(--nominal)" fillOpacity={0.07} ifOverflow="hidden" />)}
                {edges.map((e) => <ReferenceLine key={e.y} y={e.y} stroke={`var(--${e.level})`} strokeDasharray={e.level === 'advisory' ? '4 4' : undefined} label={{ value: `${e.y} ${p.unit}`, position: 'insideTopRight', fontSize: 11 }} />)}
                {w.shelterIntervals.map((iv, i) => <ReferenceArea key={i} x1={Math.max(iv.start, w.t - 72 * 60)} x2={iv.end ?? w.t} fill="var(--shelter)" fillOpacity={0.14} ifOverflow="hidden" />)}
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => `D${dayOf(t)} ${hhmm(t)}`} tickCount={5} tickLine={false} axisLine={false} />
                <YAxis domain={p.key === 'co2mmHg' ? [0, 5] : ['auto', 'auto']} tickLine={false} axisLine={false} width={44} />
                <RTooltip isAnimationActive={false} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} labelFormatter={(t) => stamp(Number(t))} formatter={(v) => [`${fmt(Number(v))} ${p.unit}`, p.title]} />
                <Line type="linear" dataKey="v" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Shaded blue: time in the storm shelter. CO2 7-day average now <span className="num font-medium text-foreground">{fmt(r.co2Day7)} mmHg</span>.</p>
        </Panel>
        <div className="space-y-4">
          <Panel title="What the rules see" aside={findings.length ? `${findings.length} finding${findings.length > 1 ? 's' : ''}` : 'All in range'}>
            {findings.length === 0 ? <p className="text-sm text-muted-foreground">All values are inside the NASA limits.</p> : (
              <ul className="space-y-2">{findings.map((f) => (
                <li key={f.id} className="rounded-md bg-muted/50 p-3 text-sm"><LevelBadge level={f.level} /> <b className="ml-1">{f.title}.</b> {f.text} <Src k={f.param in FACTOR ? FACTOR[f.param as Factor['key']].src : 'cabinCo2'} className="text-xs text-muted-foreground">Source</Src></li>
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
