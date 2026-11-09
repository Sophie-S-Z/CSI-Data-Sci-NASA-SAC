import type { ReactNode } from 'react';
import { OctagonAlert, TriangleAlert, CircleHelp, Info, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Level } from '../engine/world';
import { useUi } from './context';

export type AnyLevel = Level | 'clear' | 'nominal';

export const LEVEL_WORD: Record<AnyLevel, string> = {
  warning: 'Warning', caution: 'Caution', verify: 'Verify', advisory: 'Advisory', clear: 'Clear', nominal: 'Nominal',
};

const ICONS = { warning: OctagonAlert, caution: TriangleAlert, verify: CircleHelp, advisory: Info, clear: CircleCheck, nominal: CircleCheck } as const;

/** Each level has its own icon shape, so color is never the only signal (NFR-05). */
export function LevelIcon({ level, className }: { level: AnyLevel; className?: string }) {
  const I = ICONS[level];
  return <I aria-hidden="true" className={cn('size-4 shrink-0', className)} strokeWidth={2.25} />;
}

const BADGE: Record<AnyLevel, string> = {
  warning: 'bg-warning text-white',
  caution: 'bg-caution text-[oklch(0.22_0.04_70)]',
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

/** Data label. Every number on screen says where it comes from. */
export type Provenance = 'measured' | 'simulated' | 'standard' | 'team' | 'replay' | 'estimate';
const PROV: Record<Provenance, { label: string; cls: string }> = {
  measured: { label: 'Measured', cls: 'bg-nominal/10 text-nominal ring-nominal/25' },
  standard: { label: 'NASA standard', cls: 'bg-primary/10 text-primary ring-primary/25' },
  simulated: { label: 'Simulated', cls: 'bg-muted text-muted-foreground ring-border' },
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
    <section aria-labelledby={id} className={cn('rounded-2xl bg-card text-card-foreground ring-hairline', className)}>
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
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{sub}</p>}
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
