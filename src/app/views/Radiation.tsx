import { memo, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, HeartPulse, ShieldCheck } from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/utils';
import rules from '../../data/rules.json';
import mission from '../../data/mission.json';
import { LEVEL_RANK, type Alert, type World } from '../../engine/world';
import { SENSORS } from '../../engine/doseModel';
import { at, dayOf, hhmm, stamp, duration, minuteOfDay, MIN_PER_DAY } from '../../engine/time';
import { fmt } from '../../engine/units';
import { useUi } from '../context';
import { LiveNum, PageHead, Panel, Prov, Seg, Src, Spark, Kv } from '../parts';

const TH = rules.thresholds;

/** Internal radiation: what the cabin sensors and your dosimeter measure. */
export function RadiationView() {
  return (
    <>
      <PageHead title="Cabin radiation" sub="Your dose, the 6 cabin sensors, and the alert limits." />
      {/* Below xl the 2 columns dissolve, so "Your dose rate" comes first on a phone. The wide layout does not change. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4 max-xl:contents">
          <div className="min-w-0 max-xl:order-2"><DoseChart /></div>
          <div className="min-w-0 max-xl:order-4"><Timeline /></div>
        </div>
        <div className="min-w-0 space-y-4 max-xl:contents">
          <div className="min-w-0 max-xl:order-3"><Exposure /></div>
          <div className="min-w-0 max-xl:order-1"><RateTile /></div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- dose rate tile

function RateTile() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const x = s.personal / s.B;
  const level = w.openAlert('radiation')?.level;
  // Color follows the open alert level, so red shows only during a Warning (beta report D-2).
  const tone = level === 'warning' ? 'text-warning' : level === 'caution' ? 'text-caution-ink' : 'text-foreground';
  const sparkBucket = Math.floor(w.t / 5);
  const spark = useMemo(() => {
    const h = w.history.filter((p) => p.t > w.t - 8 * 60);
    const step = Math.max(1, Math.floor(h.length / 60));
    return h.filter((_, i) => i % step === 0).map((p) => p.personal);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, sparkBucket]);
  return (
    <Panel title="Your dose rate" aside={<><Prov kind="measured">RAD event data</Prov></>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={cn('num text-5xl font-semibold tracking-tight', tone)}><LiveNum value={s.personal} /><span className="ml-1.5 text-base font-medium text-muted-foreground">mSv/h</span></div>
          <div className="num mt-1 text-sm text-muted-foreground"><LiveNum value={x} /> × cruise baseline{w.inShelter && <span className="ml-1.5 inline-flex items-center gap-1 text-nominal"><ShieldCheck className="size-3.5" aria-hidden="true" />in shelter</span>}</div>
        </div>
        <Spark values={spark} label="Your dose rate, last 8 hours" className="h-12 w-36" stroke={tone === 'text-warning' ? 'var(--warning)' : 'var(--chart-1)'} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ['Baseline B', fmt(s.B), 'B'],
          ['Caution', fmt(TH.cautionMultiple.x * s.B), 'cautionMultiple'],
          ['Warning', fmt(TH.warningMultiple.x * s.B), 'warningMultiple'],
        ].map(([k, v, src]) => (
          <div key={k} className="rounded-md bg-muted/60 px-2 py-2">
            <div className="text-muted-foreground">{k}</div>
            <Src k={src} className="num text-sm font-semibold">{v}</Src>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- exposure budget

/**
 * The dose of one radiation event, with the kind of each number beside it:
 * the measured RAD rate, the simulated dose to the crew member, and the modeled shelter saving.
 */
export function EventDose({ a, w }: { a: Alert; w: World }) {
  const bucket = Math.floor(w.t / 15);
  const peak = useMemo(() => w.history.reduce((m, h) => (h.t >= a.openedAt && h.t <= (a.closedAt ?? w.t) ? Math.max(m, h.mean) : m), 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, a.id, a.closedAt, bucket]);
  const before = a.eventDoseMSv - a.shelterDoseMSv;
  const rows: [string, React.ReactNode, React.ReactNode][] = [
    ['Peak cabin mean dose rate (RAD event shape × B)', <Src k="speModel">{fmt(peak)} mSv/h</Src>, <Prov kind="measured">Measured RAD</Prov>],
    ['Your dose before the shelter', `${fmt(before)} mSv`, null],
    ['Your dose in the shelter', a.shelterMin ? `${fmt(a.shelterDoseMSv)} mSv in ${duration(a.shelterMin)}` : 'Not in the shelter yet', null],
    ['Your event dose', `${fmt(a.eventDoseMSv)} mSv`, null],
    ['Dose the shelter saved', <Src k="shelterFactor">{fmt(a.savedMSv)} mSv</Src>, <Prov kind="estimate">Modeled saving</Prov>],
  ];
  return (
    <dl className="divide-y divide-border text-sm">
      {rows.map(([k, v, tag]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="num text-right font-semibold">{v}</dd>
          <dd className="col-span-2 -mt-0.5">{tag}</dd>
        </div>
      ))}
    </dl>
  );
}

function Exposure() {
  const { sim } = useUi();
  const w = sim.world;
  const limit = rules.limits.career.mSv;
  const career = w.careerDoseMSv;
  const end = w.projectedEndMSv();
  const cross = w.crossingDay();
  const ev = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && LEVEL_RANK[a.peak] >= LEVEL_RANK.caution);
  const max = Math.max(1100, end * 1.05);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <Panel title="Your exposure" aside={ev && <span className="num">{ev.id}{ev.closedAt === undefined ? ', active' : ', clear'}</span>}>
      {ev ? <EventDose a={ev} w={w} /> : <p className="text-sm text-muted-foreground">No solar event yet. The event dose shows here when a Caution or a Warning opens.</p>}
      <h3 className="mt-4 text-xs font-medium text-muted-foreground">Mission and career</h3>
      <Kv rows={[
        ['Next 24 h, unsheltered', <Src k="projection24h">{fmt(w.projection24h())} mSv</Src>],
        ['Mission so far', `${fmt(w.missionDoseMSv)} mSv`],
        ['Career used', <>{fmt(career)} / <Src k="career">{limit}</Src> mSv</>],
        ['At mission end (day 860)', `~${fmt(end)} mSv`],
      ]} />
      <div className="mt-3">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Career dose ${fmt(career)} mSv now. Projected ${fmt(end)} mSv. NASA limit ${limit} mSv.`}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[repeating-linear-gradient(135deg,var(--chart-3)_0_3px,transparent_3px_6px)] opacity-50" style={{ width: pct(end) }} />
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-primary" animate={{ width: pct(career) }} />
          <div className="absolute inset-y-[-2px] w-0.5 bg-foreground" style={{ left: pct(limit) }} />
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(limit) }}>{limit} NASA</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(rules.limits.intlCareer.mSv) }}><Src k="intlCareer">{rules.limits.intlCareer.mSv}</Src></span>
        </div>
      </div>
      {end > limit && <p className="mt-3 rounded-md bg-muted/60 p-3 text-xs leading-relaxed"><b>Waiver case, not an alert.</b> The GCR projection passes {limit} mSv on day <span className="num">{cross}</span>. A Mars crew passes this limit by design.</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------- dose chart

const WINDOWS = [{ h: 8, label: '8 h' }, { h: 24, label: '24 h' }, { h: 72, label: '3 d' }] as const;

function DoseChart() {
  const { sim } = useUi();
  const w = sim.world;
  const [span, setSpan] = useState<number>(24);
  // Rebuild the series at most each 10 to 30 replay minutes. A rebuild each tick made the demo lag.
  const bucket = Math.floor(w.t / (span <= 8 ? 10 : span <= 24 ? 15 : 30));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildSeries(w, span), [w, bucket, span, w.inShelter]);
  return (
    <Panel title="Cabin dose rate" aside={<>
      <Prov kind="measured">Event: MSL RAD, Mar 2012</Prov>
      <Seg label="Chart window" value={String(span)} onChange={(v) => setSpan(Number(v))} options={WINDOWS.map((o) => ({ value: String(o.h), label: o.label }))} />
    </>}>
      <DoseChartBody data={data} B={w.B} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-[var(--chart-1)]" />Cabin mean</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded border-t-2 border-dashed border-[var(--chart-2)]" />Your dosimeter</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-caution" /><Src k="cautionMultiple">Caution {TH.cautionMultiple.label}</Src></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-warning" /><Src k="warningMultiple">Warning {TH.warningMultiple.label}</Src></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded border-t border-dashed border-muted-foreground" /><Src k="floorMultiple">Floor {TH.floorMultiple.label}</Src></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-4 rounded-sm bg-shelter/20" />In shelter</span>
      </div>
      <SensorStrip />
    </Panel>
  );
}

interface Pt { t: number; mean: number | null; personal: number }
function buildSeries(w: World, spanH: number) {
  const t0 = w.t - spanH * 60;
  const h = w.history.filter((p) => p.t >= t0);
  const step = Math.max(1, Math.floor(h.length / 160));
  // A minute with no good sensor is a data gap. It shows as a break in the line, not as a dip (beta report D-3).
  const pts: Pt[] = h.filter((_, i) => i % step === 0 || i === h.length - 1)
    .map((p) => ({ t: p.t, mean: p.quality.includes('good') ? Math.max(p.mean, 0.01) : null, personal: Math.max(p.personal, 0.01) }));
  const shelters = w.shelterIntervals.filter((iv) => (iv.end ?? w.t) > t0).map((iv) => ({ a: Math.max(iv.start, t0), b: iv.end ?? w.t }));
  return { pts, shelters, t0, t1: w.t };
}

const DoseChartBody = memo(function DoseChartBody({ data, B }: { data: ReturnType<typeof buildSeries>; B: number }) {
  const ticks: number[] = [];
  const spanH = (data.t1 - data.t0) / 60;
  const stepMin = spanH <= 8 ? 120 : spanH <= 24 ? 360 : 720;
  for (let t = Math.ceil(data.t0 / stepMin) * stepMin; t <= data.t1; t += stepMin) ticks.push(t);
  const maxV = Math.max(...data.pts.map((p) => p.mean ?? 0), 10 * B * 1.2);
  return (
    <div className="h-64 w-full md:h-72" role="img" aria-label={`Cabin dose rate chart. Now ${fmt(data.pts[data.pts.length - 1]?.mean ?? 0)} mSv/h.`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.pts} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="meanFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {data.shelters.map((s, i) => <ReferenceArea key={i} x1={s.a} x2={s.b} fill="var(--shelter)" fillOpacity={0.14} stroke="none" ifOverflow="hidden" />)}
          <XAxis dataKey="t" type="number" domain={[data.t0, data.t1]} ticks={ticks} tickFormatter={(t) => (spanH > 24 ? `D${dayOf(t)} ${hhmm(t)}` : hhmm(t))} tickLine={false} axisLine={false} />
          <YAxis scale="log" domain={[0.03, Math.max(3, maxV * 1.3)]} ticks={[0.03, 0.1, 0.3, 1, 3]} allowDataOverflow tickFormatter={(v) => String(v)} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={TH.floorMultiple.x * B} stroke="var(--muted-foreground)" strokeDasharray="2 4" strokeOpacity={0.6} />
          <ReferenceLine y={TH.warningMultiple.x * B} stroke="var(--warning)" strokeWidth={1.5} />
          <ReferenceLine y={TH.cautionMultiple.x * B} stroke="var(--caution)" strokeWidth={1.5} />
          <RTooltip
            isAnimationActive={false}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--popover-foreground)' }}
            labelFormatter={(t) => stamp(Number(t))}
            formatter={(v, n) => [`${fmt(Number(v))} mSv/h`, n === 'mean' ? 'Cabin mean' : 'Your dosimeter']}
          />
          <Area type="linear" dataKey="mean" stroke="var(--chart-1)" strokeWidth={2} fill="url(#meanFill)" isAnimationActive={false} dot={false} connectNulls={false} />
          <Line type="linear" dataKey="personal" stroke="var(--chart-2)" strokeWidth={1.75} strokeDasharray="4 3" isAnimationActive={false} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

function SensorStrip() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const level = w.openAlert('radiation')?.level;
  const tone = (v: number | null) => (v === null ? 'ring-border'
    : level === 'warning' && v >= TH.warningMultiple.x * s.B ? 'bg-warning/12 ring-warning/40'
      : (level === 'warning' || level === 'caution') && v >= TH.cautionMultiple.x * s.B ? 'bg-caution/12 ring-caution/40' : 'bg-muted/50 ring-border');
  const cells = [
    ...SENSORS.map((sn, i) => ({ id: sn.id, label: sn.label, v: s.cabin[i], q: s.quality[i] as string })),
    { id: mission.dosimeter.id, label: w.inShelter ? 'You, in shelter' : 'Your dosimeter', v: s.personal, q: 'personal' },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {cells.map((c) => (
        <div key={c.id} className={cn('rounded-md p-2.5 ring-1 ring-inset', tone(c.v))}>
          <div className="flex items-center justify-between text-[11px]"><span className="font-mono font-medium">{c.id}</span>
            <span className={cn(c.q === 'good' ? 'text-nominal' : c.q === 'poor' ? 'text-verify' : c.q === 'missing' ? 'text-muted-foreground' : 'text-advisory')}>{c.q === 'good' ? 'Good' : c.q === 'poor' ? 'Poor' : c.q === 'missing' ? 'No data' : 'Personal'}</span>
          </div>
          <div className="num mt-1 text-base font-semibold">{c.v === null ? '- -' : fmt(c.v)}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.label}{c.v !== null && <span className="num"> · {fmt(c.v / s.B)}×</span>}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- crew timeline (OSTPV style)

function Timeline() {
  const { sim, go } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const d0 = day * MIN_PER_DAY;
  const pct = (t: number) => `${(((t - d0) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((b - a) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const checkDone = w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === day);
  const warn = w.activeAlerts.find((a) => a.level === 'warning');
  const shelters = w.shelterIntervals
    .map((iv) => ({ s: Math.max(iv.start, d0), e: Math.min(iv.end ?? w.t, d0 + MIN_PER_DAY), open: iv.end === undefined }))
    .filter((x) => x.e > x.s || x.open);
  const planned = warn && !w.inShelter ? { s: w.t, e: Math.min(w.t + 360, d0 + MIN_PER_DAY) } : null;
  const KIND: Record<string, string> = {
    sleep: 'bg-muted text-muted-foreground', ops: 'bg-primary/10 text-foreground', exercise: 'bg-chart-2/20 text-foreground',
    off: 'bg-muted/60 text-muted-foreground', health: 'bg-nominal/15 text-foreground',
  };
  const now = minuteOfDay(w.t);
  // A block that starts under a shelter block shows no label, so two labels never overlap.
  const covered = (t: number) => [...shelters, ...(planned ? [planned] : [])].some((x) => x.s <= t && t < x.e);
  return (
    <Panel title="Crew timeline" aside={<span className="num">Day {String(day).padStart(3, '0')}</span>}>
      <div className="scrollbar-none overflow-x-auto">
        <div className="min-w-[720px] pr-4">
          <div className="relative ml-36 h-5 text-[11px] text-muted-foreground">
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} className="num absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}
          </div>
          <div className="relative space-y-1.5">
            {mission.crew.map((c) => (
              <div key={c.id} className="flex items-center">
                <div className={cn('w-36 shrink-0 truncate pr-3 text-sm', c.isUser ? 'font-semibold' : 'text-muted-foreground')}>{c.isUser ? 'You (A)' : `${c.id}, ${c.name}`}</div>
                <div className={cn('relative flex-1', c.isUser ? 'h-10' : 'h-7')}>
                  {mission.schedule.map((b, i) => {
                    const s = at(day, b.start);
                    const e = b.end === '24:00' ? d0 + MIN_PER_DAY : at(day, b.end);
                    if (b.kind === 'health' && c.isUser) {
                      return (
                        <button key={i} type="button" onClick={() => go('checkin')} aria-label={`Daily health check, ${checkDone ? 'done' : 'open it'}`}
                          className={cn('absolute inset-y-0 grid place-items-center rounded-md ring-2 ring-nominal/50 transition hover:bg-nominal/30', checkDone ? 'bg-nominal text-white' : 'bg-nominal/15 text-nominal')}
                          style={{ left: pct(s), width: width(s, e) }}>
                          {checkDone ? <Check className="size-4" aria-hidden="true" /> : <HeartPulse className="size-4" aria-hidden="true" />}
                        </button>
                      );
                    }
                    return <div key={i} className={cn('absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-xs whitespace-nowrap', KIND[b.kind] ?? KIND.ops)} style={{ left: pct(s), width: width(s, e) }} title={b.label}>{c.isUser && !covered(s) ? b.label : ''}</div>;
                  })}
                  {shelters.map((x, i) => <div key={`sh${i}`} className="absolute inset-y-0 flex items-center overflow-hidden rounded-md bg-shelter px-2 text-xs font-medium whitespace-nowrap text-shelter-foreground" style={{ left: pct(x.s), width: width(x.s, Math.max(x.e, x.s + 10)) }}>Shelter {duration(x.e - x.s)}</div>)}
                  {planned && <div className="absolute inset-y-0 flex items-center overflow-hidden rounded-md border-2 border-dashed border-shelter bg-card px-2 text-xs font-medium whitespace-nowrap text-shelter" style={{ left: pct(planned.s), width: width(planned.s, planned.e) }}>Shelter (plan)</div>}
                </div>
              </div>
            ))}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 ml-36 w-[calc(100%-9rem)]">
              <div className="absolute inset-y-[-4px] w-0.5 rounded bg-foreground" style={{ left: `${(now / MIN_PER_DAY) * 100}%` }}>
                <div className="absolute -top-1 -left-[3px] size-2 rounded-full bg-foreground" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground md:hidden">Swipe sideways to see the full day.</p>
    </Panel>
  );
}
