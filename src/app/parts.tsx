import { useEffect, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { OctagonAlert, TriangleAlert, CircleHelp, Info, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Level, LinkState } from '../engine/world';
import { scalePos, type Factor, type Zone, type ZoneLevel } from '../engine/limits';
import { fmt } from '../engine/units';
import { useUi } from './context';

export type AnyLevel = Level | 'clear' | 'nominal';

/** One style for each text field and select. 16 px text, so a phone does not zoom in on focus. */
export const FIELD = 'h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30';

export const LEVEL_WORD: Record<AnyLevel, string> = {
  warning: 'Warning', caution: 'Caution', verify: 'Verify', advisory: 'Advisory', clear: 'Clear', nominal: 'Nominal',
};

/** The link choices, with short labels for a segmented control. */
export const LINK_OPTIONS: { value: LinkState; label: string }[] = [
  { value: 'live', label: 'Live' }, { value: 'd5', label: '5 min' }, { value: 'd14', label: '14 min' }, { value: 'd22', label: '22 min' }, { value: 'blackout', label: 'Offline' },
];

const ICONS = { warning: OctagonAlert, caution: TriangleAlert, verify: CircleHelp, advisory: Info, clear: CircleCheck, nominal: CircleCheck } as const;

/** Each level has its own icon shape, so color is never the only signal (NFR-05). */
export function LevelIcon({ level, className }: { level: AnyLevel; className?: string }) {
  const I = ICONS[level];
  return <I aria-hidden="true" className={cn('size-4 shrink-0', className)} strokeWidth={2.25} />;
}

const BADGE: Record<AnyLevel, string> = {
  warning: 'bg-warning text-white',
  caution: 'bg-caution text-caution-foreground',
  verify: 'bg-verify/12 text-verify ring-1 ring-inset ring-verify/25',
  advisory: 'bg-advisory/12 text-advisory ring-1 ring-inset ring-advisory/25',
  clear: 'bg-nominal/12 text-nominal ring-1 ring-inset ring-nominal/25',
  nominal: 'bg-nominal/12 text-nominal ring-1 ring-inset ring-nominal/25',
};

export function LevelBadge({ level, children, className }: { level: AnyLevel; children?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap', BADGE[level], className)}>
      <LevelIcon level={level} className="size-3.5" />
      {children ?? LEVEL_WORD[level]}
    </span>
  );
}

/** A level badge that opens its explanation in the source panel. */
export function InfoBadge({ level, k, children }: { level: AnyLevel; k: string; children: ReactNode }) {
  const { openSource } = useUi();
  return (
    <button type="button" onClick={() => openSource(k)} aria-label={`${typeof children === 'string' ? children : ''}: what does this mean?`}
      className="rounded-full focus-visible:ring-2 focus-visible:ring-ring">
      <LevelBadge level={level} className="cursor-pointer underline decoration-dotted underline-offset-2 hover:opacity-90">{children}<CircleHelp className="size-3.5" aria-hidden="true" /></LevelBadge>
    </button>
  );
}

/** A number that glides to each new value (200 ms, ease-out), so a live reading changes smoothly. */
export function LiveNum({ value, format = fmt }: { value: number; format?: (v: number) => string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 0.2, ease: 'easeOut' });
    return () => c.stop();
  }, [mv, value, still]);
  return <motion.span className="num">{text}</motion.span>;
}

/** Data label. Every number on screen says where it comes from. */
type Provenance = 'measured' | 'standard' | 'team' | 'replay' | 'estimate';
const PROV: Record<Provenance, { label: string; cls: string }> = {
  measured: { label: 'Measured', cls: 'bg-nominal/10 text-nominal ring-nominal/25' },
  standard: { label: 'NASA standard', cls: 'bg-primary/10 text-primary ring-primary/25' },
  team: { label: 'Team value', cls: 'bg-muted text-muted-foreground ring-border' },
  replay: { label: 'Replay', cls: 'bg-muted text-muted-foreground ring-border' },
  estimate: { label: 'Estimate', cls: 'bg-muted text-muted-foreground ring-border' },
};
export function Prov({ kind, children }: { kind: Provenance; children?: ReactNode }) {
  const p = PROV[kind];
  return <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', p.cls)}>{children ?? p.label}</span>;
}

/** A value that opens its source (FR-06). */
export function Src({ k, children, label, className }: { k: string; children: ReactNode; label?: string; className?: string }) {
  const { openSource } = useUi();
  return (
    <button type="button" onClick={() => openSource(k)} aria-label={label ?? `Show source for ${k}`}
      className={cn('cursor-pointer rounded-sm underline decoration-dotted decoration-from-font underline-offset-4 hover:decoration-solid hover:text-primary focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {children}
    </button>
  );
}

export function Panel({ title, aside, children, className, bodyClass, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn('rounded-xl bg-card text-card-foreground ring-hairline', className)}>
      {(title || aside) && (
        <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4 pb-2">
          {title && <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>}
          {aside && <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{aside}</div>}
        </header>
      )}
      <div className={cn('px-5 pb-5', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-[1_1_20rem]">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-pretty text-muted-foreground">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Small trend line. SVG, no library: it renders in under a millisecond. */
export function Spark({ values, min, max, className, label, stroke = 'var(--chart-1)', limit }: { values: number[]; min?: number; max?: number; className?: string; label: string; stroke?: string; limit?: number }) {
  const W = 120, H = 32;
  if (values.length < 2) return <span className="text-xs text-muted-foreground">No trend</span>;
  const lo = min ?? Math.min(...values), hi = max ?? Math.max(...values);
  const xs = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const ys = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area = `${d} L${xs(values.length - 1).toFixed(1)},${H} L${xs(0).toFixed(1)},${H} Z`;
  const last = values.length - 1;
  const gid = `g${label.replace(/\W/g, '')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-8 w-30', className)} role="img" aria-label={label} preserveAspectRatio="none">
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.22" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      {limit !== undefined && limit >= lo && limit <= hi && <line x1={0} x2={W} y1={ys(limit)} y2={ys(limit)} stroke="var(--caution)" strokeDasharray="3 3" strokeWidth={1} />}
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={xs(last)} cy={ys(values[last])} r={2.5} fill={stroke} />
    </svg>
  );
}

export function Kv({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="num text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Segmented choice. Each option is a radio button with a 32 px or larger target. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('h-8 rounded px-2.5 text-xs font-medium whitespace-nowrap transition-colors pointer-coarse:h-10 pointer-coarse:px-3', value === o.value ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ZONE_BG: Record<ZoneLevel, string> = { nominal: 'bg-nominal/40', advisory: 'bg-advisory/40', caution: 'bg-caution/70', warning: 'bg-warning/80' };

/** The scale of one factor, with its safe and dangerous zones, and a marker at the value. */
export function ZoneBar({ f, zones, v, className }: { f: Factor; zones: Zone[]; v: number; className?: string }) {
  const pct = (x: number) => `${scalePos(f, x) * 100}%`;
  return (
    <div className={cn('relative h-2.5 rounded-full bg-muted', className)} aria-hidden="true">
      {zones.map((z, i) => (
        <div key={i} className={cn('absolute inset-y-0', ZONE_BG[z.level], i === 0 && 'rounded-l-full', i === zones.length - 1 && 'rounded-r-full')}
          style={{ left: pct(z.from), width: `calc(${pct(z.to)} - ${pct(z.from)})` }} />
      ))}
      <div className="absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-foreground ring-2 ring-card" style={{ left: pct(v) }} />
    </div>
  );
}
