import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { dayOf, duration } from '../../engine/time';
import { fmt } from '../../engine/units';
import { useUi } from '../context';
import { buildReport } from '../report';
import { FIELD, LevelBadge, PageHead, Panel } from '../parts';

/** The daily report. Download it as JSON, or print it to PDF. */
export function ReportView() {
  const { sim, profile, theme } = useUi();
  const w = sim.world;
  const first = dayOf(w.startT), last = dayOf(w.t);
  const [day, setDay] = useState(last);
  const d = Math.min(day, last);
  const r = buildReport(w, d, profile);
  const file = `storm-shelter-day${d}`;

  function json() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = `${file}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  // The print view uses the light theme, so the PDF is dark text on white paper.
  function pdf() {
    const title = document.title;
    document.title = file;
    document.documentElement.dataset.theme = 'light';
    window.print();
    document.documentElement.dataset.theme = theme;
    document.title = title;
  }

  return (
    <>
      <PageHead title="Daily report" sub="Alerts, solar events, check-ins, and actions for one day. Download it for the CMO or the ground." actions={
        <div className="flex print:hidden flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="rep-day">Mission day</label>
          <select id="rep-day" value={d} onChange={(e) => setDay(Number(e.target.value))} className={cn(FIELD, 'w-auto bg-card')}>
            {Array.from({ length: last - first + 1 }, (_, i) => last - i).map((x) => <option key={x} value={x}>Day {x}{x === last ? ' (today)' : ''}</option>)}
          </select>
          <Button variant="outline" className="h-10 rounded-md" onClick={json}><Download className="size-4" aria-hidden="true" />JSON</Button>
          <Button className="h-10 rounded-md" onClick={pdf}><FileText className="size-4" aria-hidden="true" />PDF</Button>
        </div>
      } />
      <article id="report" className="space-y-4">
        <Panel title={`Day ${r.day} · ${r.crew.name}, ${r.crew.role}`} aside={<span className="num">Data to {r.through}</span>}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Highest level', <LevelBadge key="l" level={r.summary.worstLevel} />],
              ['Alerts', r.summary.alerts],
              ['Your dose', `${fmt(r.summary.doseMSv)} mSv`],
              ['In the shelter', r.summary.shelterMin ? duration(r.summary.shelterMin) : 'No'],
              ['Check-ins', r.summary.checkins],
              ['Crew actions', r.summary.actions],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-md bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="num mt-0.5 font-semibold">{v}</dd></div>
            ))}
          </dl>
        </Panel>

        <Panel title="Needs attention">
          {r.attention.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.attention.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">Nothing open.</p>}
        </Panel>

        <Panel title="Alerts" bodyClass="px-0 pb-2">
          {r.alerts.length === 0 ? <p className="px-5 pb-3 text-sm text-muted-foreground">No alerts on this day.</p> : (
            <ul className="divide-y">
              {r.alerts.map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><LevelBadge level={a.peak} /><b>{a.id}</b><span className="text-muted-foreground">{a.rule}</span></div>
                  <div className="num mt-1 text-xs text-muted-foreground">{a.opened} to {a.closed ?? 'still open'} · event dose {fmt(a.eventDoseMSv)} mSv</div>
                  <p className="mt-1">{a.bodyEffect}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Solar events">
            {r.solar.length ? <ul className="space-y-1 text-sm">{r.solar.map((s) => <li key={s.time + s.kind}><span className="num mr-2 text-muted-foreground">{s.time.slice(-5)}</span>{s.summary}</li>)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}
          </Panel>
          <Panel title="Check-ins">
            {r.checkins.length ? (
              <ul className="space-y-2 text-sm">{r.checkins.map((c) => (
                <li key={c.time}><span className="num mr-2 text-muted-foreground">{c.time.slice(-5)}</span>Sleep {c.sleepH} h{c.pain ? `, pain ${c.pain} of 10` : ''}. {c.symptoms.length ? `Symptoms: ${c.symptoms.join(', ')}.` : 'No symptoms.'}{c.note && <> Note: {c.note}</>}</li>
              ))}</ul>
            ) : <p className="text-sm text-muted-foreground">None.</p>}
          </Panel>
        </div>

        <Panel title="Log" bodyClass="px-0 pb-2">
          {r.log.length ? (
            <ol className="divide-y text-sm">{r.log.map((e, i) => (
              <li key={i} className="grid grid-cols-[48px_72px_1fr] gap-2 px-5 py-2"><span className="num text-muted-foreground">{e.time.slice(-5)}</span><span className="text-xs text-muted-foreground capitalize">{e.kind === 'checkin' ? 'check-in' : e.kind}</span><span>{e.text}</span></li>
            ))}</ol>
          ) : <p className="px-5 pb-3 text-sm text-muted-foreground">No entries.</p>}
        </Panel>
      </article>
    </>
  );
}
