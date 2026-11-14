import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import rules from '../../data/rules.json';
import cabin from '../../data/cabin-rules.json';
import { REPLAY_PROVENANCE } from '../../engine/donki';
import { BODY_RULES, ruleText } from '../../engine/bodyRules';
import { useUi } from '../context';
import { LevelBadge, PageHead, Panel, Src } from '../parts';
import { sources } from '../sources';

export function SourcesView() {
  const { sim, openSource, note, go } = useUi();
  const w = sim.world;
  return (
    <>
      <PageHead title="Rules and sources" sub={rules.note} actions={<Button variant="outline" className="rounded-md" onClick={() => go('body')}>Set personal body limits</Button>} />
      <div className="space-y-4">
        <Panel title="Radiation rules" aside={<>Baseline B: <Src k="B">{rules.baselines.cruise.mSvPerHour} mSv/h in cruise</Src></>} bodyClass="px-0 pb-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-5 py-2 font-medium">Rule</th><th className="py-2 font-medium">Level</th><th className="py-2 font-medium">Trigger (any line is enough)</th><th className="py-2 font-medium">Crew action</th><th className="px-5 py-2 font-medium">State</th></tr></thead>
              <tbody className="divide-y">
                {rules.rules.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-5 py-3"><button className="font-mono underline decoration-dotted underline-offset-4" onClick={() => openSource(r.id)}>{r.id}</button></td>
                    <td className="py-3"><LevelBadge level={r.level as 'advisory'} /></td>
                    <td className="py-3 pr-4"><ul className="list-disc space-y-1 pl-4">{r.triggers.map((t, i) => <li key={i}>{t}</li>)}</ul></td>
                    <td className="py-3 pr-4">{r.action}</td>
                    <td className="px-5 py-3">
                      {w.inhibited.has(r.id)
                        ? <Button size="sm" variant="outline" onClick={() => { sim.act({ type: 'enable', ruleId: r.id }); note(`Rule ${r.id} enabled`); }}>Enable</Button>
                        : <Button size="sm" variant="outline" onClick={() => { sim.act({ type: 'inhibit', ruleId: r.id }); note(`Rule ${r.id} inhibited`); }}>Inhibit</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pt-2 text-xs text-muted-foreground">A Warning clears when all sensors stay below {rules.thresholds.cautionMultiple.label} for {rules.timing.warningClearMin} min. A Caution clears when the SEP record ends and the sensors stay below {rules.thresholds.cautionMultiple.label} for {rules.timing.cautionClearMin} min.</p>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cabin air limits" aside="NASA-STD-3001 Vol 2" bodyClass="px-0 pb-2">
            <ul className="divide-y text-sm">
              {Object.entries(cabin.limits).map(([k, l]) => (
                <li key={k} className="flex flex-wrap gap-x-3 px-5 py-2.5">
                  <span className="flex-1">{l.label}</span>
                  <span className="num font-medium">{'min' in l ? `${l.min} to ${l.max}` : `≤ ${l.max}`}</span>
                  <span className="w-full font-mono text-[11px] text-muted-foreground">{l.req}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Body rules" aside="Advisory or Caution only" bodyClass="px-0 pb-2">
            <ul className="divide-y text-sm">
              {BODY_RULES.map((r) => (
                <li key={r.id} className="flex gap-3 px-5 py-2.5">
                  <span className="w-14 shrink-0 font-mono text-xs">{r.id}</span>
                  <span className="flex-1">{ruleText(r.id, w.personal)}</span>
                  <LevelBadge level={r.level} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Citations" bodyClass="px-0 pb-2">
          <ul className="divide-y">
            {Object.entries(sources).map(([k, s]) => (
              <li key={k} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[200px_1fr_auto] sm:gap-4">
                <span className="font-medium">{s.short}</span>
                <div><div>{s.citation}</div><div className="text-xs text-muted-foreground">{s.evidence}</div></div>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open<ExternalLink className="size-3.5" aria-hidden="true" /></a> : <span />}
              </li>
            ))}
          </ul>
          <p className="px-5 pt-2 text-xs text-muted-foreground">Replay data: {REPLAY_PROVENANCE}</p>
        </Panel>
      </div>
    </>
  );
}
