import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { VIS_LABEL, VISIBILITY_ORDER, type LogEntry, type Visibility } from '../../engine/world';
import { dayOf, stamp, hhmm } from '../../engine/time';
import { useUi } from '../context';
import { FIELD, LevelBadge, PageHead, Panel, Seg } from '../parts';

export function LogRow({ e }: { e: LogEntry }) {
  const { sim, note } = useUi();
  const w = sim.world;
  const vis = w.visibilityOf(e);
  const canShare = e.kind === 'checkin' || e.kind === 'action';
  return (
    <li className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[110px_1fr_auto]">
      <span className="num pt-0.5 text-xs text-muted-foreground">{stamp(e.t)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {e.level ? <LevelBadge level={e.level} /> : e.kind === 'clear' ? <LevelBadge level="clear" /> : <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground capitalize">{e.kind}</span>}
          <span>{e.text}</span>
        </div>
        {e.inputs && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">{Object.entries(e.inputs).map(([k, v]) => <span key={k}>{k}: {v}</span>)}</div>}
        {e.summary && <div className="mt-1 text-xs text-muted-foreground">Sent {stamp(e.summary.sentT)} · {e.summary.arriveT === null ? 'Queued until the link returns' : `Arrives ${hhmm(e.summary.arriveT)}`}</div>}
      </div>
      <div className="col-start-2 sm:col-start-auto">
        {canShare ? (
          <select aria-label={`Who can see entry ${e.seq}`} value={vis} className={cn(FIELD, 'h-10 w-auto bg-card px-2 sm:h-8 sm:text-xs')}
            onChange={(ev) => { sim.act({ type: 'visibility', seq: e.seq, visibility: ev.target.value as Visibility }); note(`Entry ${e.seq} shared with: ${VIS_LABEL[ev.target.value as Visibility]}`); }}>
            {VISIBILITY_ORDER.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
          </select>
        ) : <span className="text-xs text-muted-foreground">{VIS_LABEL[vis]}</span>}
      </div>
    </li>
  );
}

type F = 'all' | 'alerts' | 'actions' | 'checkins' | 'ground';
const FILTERS: { value: F; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'alerts', label: 'Alerts' }, { value: 'actions', label: 'Actions' }, { value: 'checkins', label: 'Check-ins' }, { value: 'ground', label: 'Link' },
];

export function LogView() {
  const { sim, go } = useUi();
  const w = sim.world;
  const [f, setF] = useState<F>('all');
  const rows = w.log.filter((e) => e.kind !== 'visibility').filter((e) =>
    f === 'all' ? true : f === 'alerts' ? ['alert', 'clear', 'advisory'].includes(e.kind) : f === 'actions' ? e.kind === 'action' : f === 'checkins' ? e.kind === 'checkin' : e.kind === 'summary' || e.kind === 'system');
  const byDay = w.cautionWarningByDay();
  const days = Array.from({ length: dayOf(w.t) - dayOf(w.startT) + 1 }, (_, i) => dayOf(w.startT) + i);
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);
  const maxN = Math.max(1, ...byDay.values());

  return (
    <>
      <PageHead title="Event log" sub="Each alert, check-in, and crew action, with its time and rule. Entries cannot be changed." actions={<Button variant="outline" className="rounded-md" onClick={() => go('report')}><FileText className="size-4" aria-hidden="true" />Daily report</Button>} />
      <Panel title="Alarm burden" aside="Target: 3 or fewer in 7 days" className="mb-4">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex items-end gap-1.5" role="img" aria-label={`${total} Caution or Warning events in ${days.length} days`}>
            {days.map((d) => {
              const n = byDay.get(d) ?? 0;
              return (
                <div key={d} className="flex w-9 flex-col items-center gap-1">
                  <div className="num text-xs font-semibold">{n || ''}</div>
                  <div className={cn('w-full rounded-md', n ? 'bg-caution' : 'bg-muted')} style={{ height: 8 + (n / maxN) * 40 }} />
                  <div className="num text-[10px] text-muted-foreground">D{d}</div>
                </div>
              );
            })}
          </div>
          <p className="text-sm"><b className="num text-2xl">{total}</b> Caution or Warning {total === 1 ? 'event' : 'events'} in {days.length} days.</p>
        </div>
      </Panel>
      <div className="mb-3"><Seg<F> label="Filter the log" value={f} onChange={setF} options={FILTERS} /></div>
      <Panel bodyClass="px-0 pb-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No entries match this filter yet.</p> : <ul className="divide-y">{[...rows].reverse().slice(0, 200).map((e) => <LogRow key={e.seq} e={e} />)}</ul>}
      </Panel>
    </>
  );
}
