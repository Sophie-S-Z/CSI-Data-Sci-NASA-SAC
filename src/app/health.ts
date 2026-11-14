import rules from '../data/rules.json';
import type { AnyLevel } from './parts';

const NORMAL = { text: 'Normal deep-space dose: about 1.8 mSv a day. You feel nothing. Over a full mission, the dose adds a small cancer risk.', src: 'zeitlin2013' };

/** What the radiation at each alert level does to the body. Each line names its source. */
export const LEVEL_EFFECT: Record<AnyLevel, { text: string; src: string }> = {
  warning: { text: 'Without the shelter, a big storm can give hundreds of mSv in a day. About 1,000 mSv in a few hours can cause nausea, vomiting, and fatigue, and it lowers your blood cell counts. Each mSv also adds to your lifetime cancer risk. The shelter cuts this dose.', src: 'iaeaArs' },
  caution: { text: 'This rate gives no symptoms. A storm can rise fast, so get ready now. Each extra mSv adds a little to your lifetime cancer risk.', src: 'std3001' },
  verify: { text: 'One sensor does not agree with the others. The other sensors are normal, so there is no health effect now.', src: 'zeitlin2013' },
  advisory: NORMAL,
  clear: NORMAL,
  nominal: NORMAL,
};

/** Dose steps from a normal day to acute radiation sickness. */
export const DOSE_LADDER = [
  { mSv: rules.baselines.cruise.mSvPerDay, label: 'One day in cruise', effect: 'No symptoms.', src: 'zeitlin2013' },
  { mSv: 250, label: 'NASA limit for one storm', effect: 'No symptoms. Ships must keep a big storm below this dose.', src: 'std3001' },
  { mSv: 600, label: 'NASA career limit', effect: 'About a 3% risk of death from cancer later in life.', src: 'std3001' },
  { mSv: 1000, label: 'In a few hours', effect: 'Nausea, vomiting, fatigue, fewer blood cells.', src: 'iaeaArs' },
];

export const STORM_LIMIT = DOSE_LADDER[1].mSv;

