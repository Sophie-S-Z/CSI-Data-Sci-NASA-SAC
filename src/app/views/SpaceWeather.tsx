import { cn } from '@/lib/utils';
import { LINK_LABEL, LINK_DELAY_MIN } from '../../engine/world';
import { REPLAY, REPLAY_PROVENANCE } from '../../engine/donki';
import { stamp, MIN_PER_DAY } from '../../engine/time';
import { fmt, whole } from '../../engine/units';
import { vehicleAt, earthAt, lightMinutes, dist, TRANSIT_DAYS } from '../../engine/orbit';
import { useUi } from '../context';
import { InfoBadge, Kv, LevelBadge, PageHead, Panel, Prov } from '../parts';

/** External radiation: the Sun, the solar records, and where the ship is. */
export function SpaceWeatherView() {
  return (
    <>
      <PageHead title="Space weather" sub="Outside the ship. Real solar records from March 2012, and where the ship is relative to the Sun and Earth." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <SolarEvents />
        <Geometry />
      </div>
    </>
  );
}

function SolarEvents() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const seen = REPLAY.filter((r) => r.t <= w.t && w.t - r.t < 4 * MIN_PER_DAY).reverse();
  const KIND: Record<string, string> = { FLR: 'bg-caution/20 text-caution-ink', CME: 'bg-advisory/15 text-advisory', SEP: 'bg-muted text-foreground' };
  return (
    <Panel title="Solar events" aside={<><Prov kind="measured">Real, March 2012</Prov><button className="underline decoration-dotted underline-offset-4" onClick={() => openSource('goesFlares')}>Source</button></>}>
      <p className="mb-3 text-xs text-muted-foreground">Records from spacecraft near Earth. They can give an Advisory or a Caution. Only the sensors in the ship give a Warning.</p>
      {seen.length === 0 ? <p className="text-sm text-muted-foreground">No solar events in the last 4 days.</p> : (
        <ul className="space-y-2">
            {seen.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-md bg-muted/40 p-3">
                <span className={cn('mt-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold', KIND[r.kind])}>{r.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.summary}{r.kind === 'SEP' && r.tEnd && w.t < r.tEnd ? <LevelBadge level="caution" className="ml-2 h-5">Active</LevelBadge> : null}</div>
                  <div className="num text-xs text-muted-foreground">{stamp(r.t)} · {r.id.replace(/-(\d{4})-/, ' $1-').replace('T', ' ')} UTC</div>
                </div>
              </li>
            ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{REPLAY_PROVENANCE}</p>
    </Panel>
  );
}

function Geometry() {
  const { sim } = useUi();
  const w = sim.world;
  const day = w.t / MIN_PER_DAY;
  const v = vehicleAt(day), e = earthAt(day);
  const delay = LINK_DELAY_MIN[w.link];
  // Angle between Earth and the ship, seen from the Sun.
  const gap = Math.abs(((Math.atan2(v.y, v.x) - Math.atan2(e.y, e.x)) * 180) / Math.PI);
  const sep = Math.min(gap, 360 - gap);
  const warn = w.openAlert('radiation')?.level === 'warning';
  return (
    <Panel title="Ship and Earth" aside={warn ? <InfoBadge level="warning" k="protons">Protons at the ship</InfoBadge> : <Prov kind="estimate">Orbit model</Prov>}>
      <Kv rows={[
        ['Transit day', `${Math.floor(day)} of ${TRANSIT_DAYS}`],
        ['Distance from the Sun', `${fmt(Math.hypot(v.x, v.y))} AU`],
        ['Distance to Earth', `${fmt(dist(v, e))} AU`],
        ['Light time to Earth', `${fmt(lightMinutes(day))} min`],
        ['Link to Earth', LINK_LABEL[w.link]],
        ['Fastest answer from Earth', delay === null ? 'None until the link returns' : `${2 * delay} min or more`],
        ['Earth to ship angle, from the Sun', `${whole(sep)}°`],
      ]} />
      <p className="mt-3 rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
        Solar protons follow the magnetic field of the Sun, which bends in a spiral. When the angle is large, a proton event at Earth can miss the ship.
        An event on the far side of the Sun can also hit the ship with no record at Earth. For this reason, only the ship sensors give a Warning.
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">Simplified, circular, coplanar orbits. Not a navigation solution.</p>
    </Panel>
  );
}
