import { cn } from '@/lib/utils';
import { fmt, whole } from '../engine/units';
import { Src, type AnyLevel } from './parts';
import { DOSE_LADDER, LEVEL_EFFECT, STORM_LIMIT } from './health';

/** A dose share as a percent. A small dose reads "under 1%", not "0%". */
const pctText = (p: number) => (p > 0 && p < 1 ? 'under 1%' : `${whole(p)}%`);

/** The body effects beside an alert: one sentence for the level, your storm dose, and the dose steps. */
export function BodyEffects({ level, stormDose, className }: { level: AnyLevel; stormDose?: number; className?: string }) {
  const e = LEVEL_EFFECT[level];
  return (
    <section aria-labelledby="body-fx" className={cn('px-5 py-4', className)}>
      <h3 id="body-fx" className="text-sm font-semibold">What this does to your body</h3>
      <p className="mt-1 text-sm leading-relaxed">{e.text} <Src k={e.src} className="text-xs text-muted-foreground">Source</Src></p>
      {stormDose !== undefined && (
        <div className="mt-3">
          <div className="flex justify-between text-xs"><span>Your dose in this storm</span><span className="num font-semibold">{fmt(stormDose)} mSv · {pctText((stormDose / STORM_LIMIT) * 100)} of the storm limit</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(100, (stormDose / STORM_LIMIT) * 100)}%` }} />
          </div>
        </div>
      )}
      <ol className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
        {DOSE_LADDER.map((d) => (
          <li key={d.mSv} className="rounded-md bg-muted/50 px-3 py-2">
            <span className="num font-semibold">{d.mSv.toLocaleString('en-US')} mSv</span> <span className="text-muted-foreground">{d.label}</span>
            <div className="mt-0.5">{d.effect} <Src k={d.src} className="text-muted-foreground">Source</Src></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
