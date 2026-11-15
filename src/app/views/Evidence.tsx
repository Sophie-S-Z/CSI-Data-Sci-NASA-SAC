import { useMemo, useState } from 'react';
import { ComposedChart, Area, XAxis, YAxis, ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';
import ev from '../../data/real/rad-events.json';
import l1raw from '../../data/real/l1-summary.json';
import { PageHead, Panel, Prov, Src } from '../parts';
import { fmt, whole } from '../../engine/units';

const l1 = l1raw as { headline: string; tiles: { label: string; value: string; sub: string }[]; note: string };

type PolicyId = keyof typeof ev.policies;
const POLICY_ORDER: PolicyId[] = ['current', 'lowe', 'lowe2', 'layered2'];
const SHORT: Record<PolicyId, string> = { current: 'Old rule', lowe: 'Löwe 2025', lowe2: 'Löwe, 2 detectors', layered2: 'Storm Shelter v2' };
const SET_LABEL: Record<string, string> = { cruise_2012: 'Cruise to Mars, 2012', surface_2017: 'Mars surface, 2017', surface_2024: 'Mars surface, 2024' };

interface Score { entered_before_peak: boolean; lead_vs_2xB_min: number | null; lead_vs_10xB_min: number | null; dose_avoided_pct: number | null }

function fmtUtc(s: string) {
  const d = new Date(s + 'Z');
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function EvidenceView() {
  const [sel, setSel] = useState(ev.events[1].id);
  const [pol, setPol] = useState<PolicyId>('layered2');
  const e = ev.events.find((x) => x.id === sel)!;

  const totals = useMemo(() => POLICY_ORDER.map((p) => {
    const sc = ev.events.map((x) => (x.scores as Record<string, Score>)[p]);
    const sets = Object.values(ev.sets);
    const days = sets.reduce((a, s) => a + s.days_scored, 0);
    const pp = sets.map((s) => (s.policies as Record<string, { false_entries: number; shelter_h_per_100d: number; entries: number }>)[p]);
    const avoided = sc.map((s) => s.dose_avoided_pct ?? 0);
    return {
      p,
      caught: sc.filter((s) => s.entered_before_peak).length,
      false: pp.reduce((a, s) => a + s.false_entries, 0),
      entries: pp.reduce((a, s) => a + s.entries, 0),
      shelterH: sets.reduce((a, s, i) => a + pp[i].shelter_h_per_100d * s.days_scored / 100, 0) / days * 100,
      avoided: avoided.reduce((a, b) => a + b, 0) / avoided.length,
      days,
    };
  }), []);

  const data = useMemo(() => {
    const t0 = new Date(e.start_utc + 'Z').getTime();
    return e.ratio.map((r, i) => ({ t: t0 + i * ev.bin_min * 60_000, r: r === null ? null : Math.max(r, 0.5) }));
  }, [e]);
  const shelters = ((e.shelter as Record<string, number[][]>)[pol] ?? []).map(([a, b]) => [data[a]?.t, data[Math.min(b, data.length - 1)]?.t]);
  const score = (e.scores as Record<string, Score>)[pol];
  const ideaC = (ev.idea_c as Record<string, Record<string, number | string>[]>)[e.set].find((x) => x.onset === e.onset_utc)!;

  return (
    <>
      <PageHead title="Measured events" sub={<>We ran 4 shelter rules on each solar storm that the RAD detector on NASA's Curiosity measured: in cruise in 2012 and on Mars. We tuned the rules on 2012 and 2017 data, then tested them one time on 2024 data.</>}
        actions={<Prov kind="measured">MSL RAD, NASA PDS</Prov>} />

      <Panel title="Result on 6 real events" aside={<span className="num">{Math.round(totals[0].days)} days of RAD data scored</span>} bodyClass="px-0 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr className="border-b">
              <th className="px-5 py-2 font-medium">Rule</th><th className="py-2 pr-4 font-medium">Limits in the test</th><th className="py-2 pr-4 font-medium">Sheltered before the peak</th><th className="py-2 pr-4 font-medium">False entries</th><th className="py-2 pr-4 font-medium">Shelter h per 100 d</th><th className="py-2 pr-5 font-medium">Mean dose avoided</th>
            </tr></thead>
            <tbody className="divide-y">
              {totals.map((r) => (
                <tr key={r.p} className={cn(r.p === 'layered2' && 'bg-primary/5')}>
                  <td className="px-5 py-3"><div className="font-medium">{SHORT[r.p]}</div><div className="text-xs text-muted-foreground">{ev.policies[r.p]}</div></td>
                  <td className="py-3 pr-4 text-xs leading-relaxed"><div><span className="text-muted-foreground">Enter: </span>{ev.limits[r.p].enter}</div><div><span className="text-muted-foreground">Clear: </span>{ev.limits[r.p].clear}</div></td>
                  <td className="py-3"><span className={cn('num text-lg font-semibold', r.caught === ev.events.length ? 'text-nominal' : 'text-warning')}>{r.caught} of {ev.events.length}</span></td>
                  <td className="num py-3 text-lg font-semibold">{r.false}</td>
                  <td className="num py-3">{fmt(r.shelterH)}</td>
                  <td className="num py-3 pr-5">{whole(r.avoided)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 pt-2 text-xs text-muted-foreground">Dose avoided uses a shelter factor of <Src k="shelterFactor">0.25</Src> (team value), so 75% is the most a rule can save. "Storm Shelter v2" uses the same limits as the app's Warning rule R-W1 (<Src k="R-W1">rule</Src>): both RAD detectors must agree, and a bin with 1 detector missing does not count. The test leaves out the second R-W1 trigger, the 24 h dose projection.</p>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Replay one event" aside={<Prov kind="measured">RAD E detector</Prov>}>
          <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Event">
            {ev.events.map((x) => (
              <button key={x.id} role="radio" aria-checked={sel === x.id} onClick={() => setSel(x.id)}
                className={cn('shrink-0 rounded-md px-3 py-2 text-left ring-1 transition', sel === x.id ? 'bg-primary/8 ring-2 ring-primary' : 'ring-border hover:bg-muted/50')}>
                <div className="text-xs font-semibold">{fmtUtc(x.onset_utc).split(',')[0]}</div>
                <div className="num text-[11px] text-muted-foreground">{SET_LABEL[x.set].split(',')[0]} · peak {fmt(x.peak_ratio)}×</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Rule">
            {POLICY_ORDER.map((p) => (
              <button key={p} role="radio" aria-checked={pol === p} onClick={() => setPol(p)} className={cn('h-8 rounded-md px-3 text-xs font-medium pointer-coarse:h-10', pol === p ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>{SHORT[p]}</button>
            ))}
          </div>
          <div className="mt-3 h-72 w-full" role="img" aria-label={`Measured dose rate ratio for the event of ${fmtUtc(e.onset_utc)}, with shelter time for ${SHORT[pol]}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs><linearGradient id="evFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {shelters.map(([a, b], i) => a && b ? <ReferenceArea key={i} x1={a} x2={b} fill="var(--nominal)" fillOpacity={0.16} ifOverflow="hidden" /> : null)}
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickCount={6} tickFormatter={(t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', timeZone: 'UTC' })} tickLine={false} axisLine={false} />
                <YAxis scale="log" domain={[0.5, Math.max(20, e.peak_ratio * 1.3)]} ticks={[1, 2, 10, 30, 100].filter((x) => x <= Math.max(20, e.peak_ratio * 1.3))} allowDataOverflow tickFormatter={(v) => `${v}×`} tickLine={false} axisLine={false} width={44} />
                <ReferenceLine y={2} stroke="var(--warning)" strokeWidth={1.5} />
                <ReferenceLine y={10} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
                <RTooltip isAnimationActive={false} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} labelFormatter={(t) => new Date(Number(t)).toUTCString().slice(5, 22) + ' UTC'} formatter={(v) => [`${fmt(Number(v))} × background`, 'RAD E dose rate']} />
                <Area type="monotone" dataKey="r" stroke="var(--chart-1)" strokeWidth={2} fill="url(#evFill)" connectNulls isAnimationActive={false} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-4 rounded-sm bg-nominal/20" />In shelter, {SHORT[pol]}</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-warning" />2 × background (v2 Warning)</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 border-t border-dashed border-muted-foreground" />10 × (old Warning)</span>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="This event">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Where', SET_LABEL[e.set]],
                ['Onset', fmtUtc(e.onset_utc)],
                ['Peak', `${fmt(e.peak_ratio)}× (${fmt(e.peak_uGy_h)} µGy/h)`],
                ['Rise to peak', `${fmt(e.rise_h)} h`],
                ['Decay (e-fold)', e.decay_efold_h ? `${fmt(e.decay_efold_h)} h` : 'n/a'],
                ['Event dose (E)', `${fmt(e.event_dose_uGy / 1000)} mGy`],
                ['Split', e.split === 'tune' ? 'Tune (cycle 24)' : 'Test (cycle 25)'],
              ].map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="num font-medium">{v}</dd></div>)}
            </dl>
            <div className={cn('mt-4 rounded-md p-3 text-sm', score.entered_before_peak ? 'bg-nominal/10' : 'bg-warning/10')}>
              <b>{SHORT[pol]}:</b> {score.entered_before_peak
                ? <>sheltered {score.lead_vs_2xB_min !== null && score.lead_vs_2xB_min >= 0 ? `${score.lead_vs_2xB_min} min before` : `${Math.abs(score.lead_vs_2xB_min ?? 0)} min after`} the 2× crossing, before the peak. Avoided {whole(score.dose_avoided_pct ?? 0)}% of the event dose.</>
                : <>no shelter entry before the peak. The crew got the full event dose.</>}
            </div>
          </Panel>
          <Panel title="Cost of a late entry" aside="Idea C">
            <p className="text-xs text-muted-foreground">Share of this event's dose that the crew still gets, by entry time after the 2× crossing.</p>
            <div className="mt-3 space-y-1.5">
              {['+0h', '+0.5h', '+1h', '+2h', '+4h'].map((k) => {
                const v = Number(ideaC[k]);
                return (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="num w-12 text-muted-foreground">{k.replace('+0h', 'At 2×').replace('+', '')}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-warning/80" style={{ width: `${v}%` }} /></div>
                    <span className="num w-10 text-right font-medium">{v}%</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Early warning from electrons, near Earth" aside={<Prov kind="measured">ACE EPAM, GOES</Prov>} className="mt-4">
        <p className="text-sm leading-relaxed">{l1.headline}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {l1.tiles.map((t) => (
            <div key={t.label} className="rounded-md bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="num mt-1 text-2xl font-semibold">{t.value}</div>
              <div className="text-[11px] text-muted-foreground">{t.sub}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{l1.note}</p>
      </Panel>
    </>
  );
}
