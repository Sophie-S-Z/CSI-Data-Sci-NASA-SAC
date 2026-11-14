/** Prints the replay week as a story. Use it to check the rules against PRD section 07. */
import { World, PROCEDURE_SH1 } from '../src/engine/world';
import { at, stamp } from '../src/engine/time';
import { fmt } from '../src/engine/units';

const w = new World(undefined, () => 0);
w.advanceTo(at(94, '14:15'));
w.apply({ type: 'procStart', alertId: w.openAlert('radiation')?.id ?? null }, 0);
for (const s of PROCEDURE_SH1.steps.slice(0, 5)) w.apply({ type: 'procStep', step: s.n }, 45_000);
for (const t of ['14:08', '14:22', '16:30', '20:00']) {
  // print rates at a few story beats
  const s = w.history.find((h) => h.t === at(94, t));
  if (s) console.log(`  ${t} cabin mean ${fmt(s.mean)} mSv/h, sensors ${s.cabin.map((v) => (v === null ? '--' : fmt(v))).join(' ')}`);
}
w.advanceTo(at(95, '06:00'));
const ev = w.openAlert('radiation');
if (!ev && w.inShelter) w.apply({ type: 'shelterExit' }, 0);
w.advanceTo(at(95, '23:59'));
for (const e of w.log) console.log(`${stamp(e.t)}  ${e.kind.padEnd(9)} ${e.level ?? ''} ${e.text}`);
console.log('C/W by day', [...w.cautionWarningByDay()]);
console.log('Mission dose', fmt(w.missionDoseMSv), 'career', fmt(w.careerDoseMSv), 'end', fmt(w.projectedEndMSv()), 'cross day', w.crossingDay());
