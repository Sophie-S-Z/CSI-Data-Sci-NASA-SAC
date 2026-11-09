import { LINK_LABEL, LINK_DELAY_MIN } from '../../engine/world';
import { REPLAY } from '../../engine/donki';
import { MIN_PER_DAY } from '../../engine/time';
import { TRANSIT_DAYS } from '../../engine/orbit';
import MissionView from '../../ui/MissionView';
import { useUi } from '../context';
import { Kv, LevelBadge, PageHead, Panel } from '../parts';

/** 3D view for the pitch. It loads only when this tab opens, so the crew views stay light. */
export default function MissionTab() {
  const { sim, theme } = useUi();
  const w = sim.world;
  const day = Math.round((w.t / MIN_PER_DAY) * 100) / 100;
  const warn = w.activeAlerts.some((a) => a.level === 'warning');
  const sepActive = REPLAY.some((r) => r.kind === 'SEP' && r.t <= w.t && (r.tEnd ?? Infinity) > w.t);
  const caution = w.activeAlerts.some((a) => a.level === 'caution');
  const storm = warn ? 'hit' : sepActive || caution ? 'watch' : 'none';
  const delay = LINK_DELAY_MIN[w.link];
  return (
    <>
      <PageHead title="Mission" sub="Where the vehicle is, where the solar event goes, and how far a message to Earth must travel." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={`Inner solar system, day ${Math.floor(day)}`} aside={storm === 'hit' ? <LevelBadge level="warning">Protons at the vehicle</LevelBadge> : storm === 'watch' ? <LevelBadge level="caution">Solar event</LevelBadge> : 'No solar event'}>
          <div className="overflow-hidden rounded-xl"><MissionView day={day} storm={storm} theme={theme} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Drag to turn the view. Simplified, coplanar orbits. Not a navigation solution.</p>
        </Panel>
        <Panel title="Facts">
          <Kv rows={[
            ['Transit', `${Math.floor(day)} of ${TRANSIT_DAYS} d`],
            ['Link to Earth', LINK_LABEL[w.link]],
            ['Fastest answer from Earth', delay === null ? 'None until the link returns' : `${2 * delay} min`],
            ['Mission dose so far', `${w.missionDoseMSv.toFixed(1)} mSv`],
          ]} />
        </Panel>
      </div>
    </>
  );
}
