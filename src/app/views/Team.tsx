import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LINK_LABEL, VIS_LABEL, type LinkState, type LogEntry } from '../../engine/world';
import { stamp, hhmm } from '../../engine/time';
import { useUi } from '../context';
import { Kv, LevelBadge, PageHead, Panel, Prov } from '../parts';
import { EventDose } from './Radiation';

export function CmoView() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const ev = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && (a.peak === 'caution' || a.peak === 'warning'));
  const shared = w.log.filter((e) => e.kind === 'checkin' && w.visibilityOf(e) !== 'private');
  const hidden = w.log.filter((e) => e.kind === 'checkin' && w.visibilityOf(e) === 'private').length;
  const lastShared = shared[shared.length - 1];
  const poorSleep = lastShared?.checkin && lastShared.checkin.sleepH < 6;
  const infectionWatch = ev && ev.eventDoseMSv > 1 && poorSleep;
  return (
    <>
      <PageHead title="CMO case view" sub="For the Crew Medical Officer. It shows only the entries that the crew member shares." />
      {!ev ? <Panel><p className="pt-5 text-sm text-muted-foreground">No Caution or Warning event in this replay yet. The case view fills when one starts.</p></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={ev.id} aside={<LevelBadge level={ev.peak}>Peak: {ev.peak[0].toUpperCase() + ev.peak.slice(1)}</LevelBadge>}>
            <Kv rows={[
              ['Opened', stamp(ev.openedAt)],
              ['Status', ev.closedAt ? `Clear at ${stamp(ev.closedAt)}` : `Active, ${ev.level}`],
              ['Data quality now', ev.quality],
            ]} />
            <h3 className="mt-4 text-xs font-medium text-muted-foreground">Crew A exposure</h3>
            <EventDose a={ev} w={w} />
            <ol className="mt-4 space-y-2 border-l-2 pl-4">
              {ev.history.map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-border ring-4 ring-card" />
                  <div className="num text-xs text-muted-foreground">{stamp(h.t)} · <button className="font-mono underline decoration-dotted underline-offset-4" onClick={() => openSource(h.ruleId)}>{h.ruleId}</button></div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5"><LevelBadge level={h.level === 'clear' ? 'clear' : h.level} />{h.reason}</div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Shared symptoms" aside={hidden ? `${hidden} private ${hidden === 1 ? 'entry' : 'entries'} not shown` : undefined}>
            {infectionWatch && (
              <p className="mb-3 rounded-md bg-advisory/10 p-3 text-sm"><LevelBadge level="advisory" /> <b>Infection watch.</b> Event dose plus short sleep ({lastShared!.checkin!.sleepH} h). Watch for signs of infection. Evidence: emerging (herpesvirus shedding in 61% of ISS crew, n = 23).</p>
            )}
            {shared.length === 0 ? <p className="text-sm text-muted-foreground">No shared check-ins.</p> : (
              <ul className="space-y-2">{[...shared].reverse().map((e) => (
                <li key={e.seq} className="rounded-md bg-muted/50 p-3 text-sm"><div className="num text-xs text-muted-foreground">{stamp(e.t)} · {VIS_LABEL[w.visibilityOf(e)]}</div>{e.text}</li>
              ))}</ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

const LINKS: LinkState[] = ['live', 'd5', 'd14', 'd22', 'blackout'];
const LINK_SHORT: Record<LinkState, string> = { live: 'Live', d5: '5 min', d14: '14 min', d22: '22 min', blackout: 'Offline' };

export function GroundView() {
  const { sim, note } = useUi();
  const w = sim.world;
  const all = w.log.filter((e) => e.kind === 'summary').reverse();
  // A summary built offline waits on board. The next summary sent on the link holds its entries.
  const queued = all.filter((s) => s.summary!.arriveT === null && s.seq > w.lastSummarySeq);
  const sent = all.filter((s) => s.summary!.arriveT !== null);
  const received = sent.filter((s) => s.summary!.arriveT! <= w.t);
  const transit = sent.filter((s) => s.summary!.arriveT! > w.t);
  return (
    <>
      <PageHead title="Simulated flight-surgeon handoff" sub="This view shows what a flight surgeon on Earth receives from the ship. The flight surgeon is simulated. No crew step waits for the ground, and private entries stay on the ship." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Received by the flight surgeon" aside={<Prov kind="simulated">Simulated ground</Prov>}>
            {received.length === 0 ? <p className="text-sm text-muted-foreground">No summary received yet. Set the link to Offline, then back to Delayed or Live.</p> : (
              <div className="space-y-3">{received.map((s) => <SummaryCard key={s.seq} e={s} status={`Received ${hhmm(s.summary!.arriveT!)}`} />)}</div>
            )}
          </Panel>
          {(transit.length > 0 || queued.length > 0) && (
            <Panel title="Not received yet">
              <div className="space-y-3">
                {transit.map((s) => <SummaryCard key={s.seq} e={s} status={`On the link. Arrives ${hhmm(s.summary!.arriveT!)}`} />)}
                {queued.map((s) => <SummaryCard key={s.seq} e={s} status="Queued on board. It goes with the next summary when the link returns." />)}
              </div>
            </Panel>
          )}
        </div>
        <Panel title="Link state">
          <div role="radiogroup" aria-label="Link to Earth" className="grid grid-cols-5 gap-1 rounded-md bg-muted p-1">
            {LINKS.map((o) => (
              <button key={o} role="radio" aria-checked={w.link === o} onClick={() => { sim.act({ type: 'link', link: o }); note(`Link set to ${LINK_LABEL[o].toLowerCase()}`); }}
                className={cn('h-10 rounded text-xs font-medium', w.link === o ? 'bg-card ring-1 ring-border' : 'text-muted-foreground')}>{LINK_SHORT[o]}</button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">When the link returns after a blackout, the ship sends one summary. It holds all entries shared with Ground since the last summary that the ship sent, so the flight surgeon gets each entry one time.</p>
          <Button variant="outline" className="mt-3 rounded-md" onClick={() => { sim.act({ type: 'summary' }); note(w.link === 'blackout' ? 'Ground summary queued on board' : 'Ground summary sent'); }}>
            {w.link === 'blackout' ? 'Build summary (queued)' : 'Send summary now'}
          </Button>
        </Panel>
      </div>
    </>
  );
}

function SummaryCard({ e, status }: { e: LogEntry; status: string }) {
  const s = e.summary!;
  return (
    <div className="rounded-md bg-muted/40 p-4 ring-1 ring-border">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><b>Summary from {stamp(s.sentT)}</b><span className="num text-xs text-muted-foreground">{status} · {s.withheld} kept on board</span></div>
      {s.lines.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No shared entries since the last summary.</p> : (
        <ol className="mt-2 space-y-1 text-sm">{s.lines.slice(-12).map((l, i) => <li key={i}><span className="num mr-2 text-muted-foreground">{hhmm(l.t)}</span>{l.text}</li>)}</ol>
      )}
    </div>
  );
}
