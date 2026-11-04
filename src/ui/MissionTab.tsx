import { LINK_LABEL, LINK_DELAY_MIN } from '../engine/world';
import { REPLAY } from '../engine/donki';
import { MIN_PER_DAY } from '../engine/time';
import { TRANSIT_DAYS } from '../engine/orbit';
import { Chip, useUi } from './common';
import MissionView from './MissionView';

/**
 * Mission view for the pitch: the Sun, Earth, Mars, the vehicle, and the signal path in 3D.
 * It is on its own tab so the crew views stay calm. It draws only when something moves.
 */
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
      <div className="page-head">
        <h1>Mission</h1>
        <p>Where the vehicle is, where the solar event goes, and how far a message to Earth must travel.</p>
      </div>
      <div className="cols">
        <section className="region" aria-labelledby="mv-h">
          <div className="rh">
            <h2 id="mv-h">Inner solar system, day {Math.floor(day)}</h2>
            <span className="aside">{storm === 'hit' ? <Chip level="warning">Protons at the vehicle</Chip> : storm === 'watch' ? <Chip level="caution">Solar event</Chip> : 'No solar event'}</span>
          </div>
          <div className="rb">
            <MissionView day={day} storm={storm} theme={theme} />
            <p className="note">Drag to turn the view. Simplified, coplanar orbits from engine/orbit.ts. Not a navigation solution.</p>
          </div>
        </section>
        <section className="region" aria-labelledby="mf-h">
          <div className="rh"><h2 id="mf-h">Facts</h2></div>
          <div className="rb">
            <dl className="kv">
              <div><dt>Transit</dt><dd>{Math.floor(day)} of {TRANSIT_DAYS} d</dd></div>
              <div><dt>Link to Earth</dt><dd style={{ fontFamily: 'var(--font-ui)' }}>{LINK_LABEL[w.link]}</dd></div>
              <div><dt>Fastest answer from Earth</dt><dd style={{ fontFamily: 'var(--font-ui)' }}>{delay === null ? 'None until the link returns' : `${2 * delay} min`}</dd></div>
              <div><dt>Mission dose so far</dt><dd>{w.missionDoseMSv.toFixed(1)}<small>mSv</small></dd></div>
            </dl>
            <p className="note">The particle stream takes the alert color: yellow during a Caution, red during a Warning. DONKI logs events near Earth, so an event can reach the vehicle with a different strength.</p>
          </div>
        </section>
      </div>
    </>
  );
}
