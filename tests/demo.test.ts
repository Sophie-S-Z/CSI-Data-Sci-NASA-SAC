import { describe, expect, it } from 'vitest';
import { World } from '../src/engine/world';
import { BEATS, DEMO_START } from '../src/ui/useSim';

describe('demo steps', () => {
  it('each step shows the level that its text names', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(DEMO_START);
    for (const b of BEATS) {
      w.advanceTo(b.t);
      expect(w.activeAlerts.map((a) => a.level), b.label).toContain(b.level);
    }
  });

  it('a step that starts an alert is at the minute where Play pauses for it', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(DEMO_START);
    for (const b of BEATS.filter((x) => ['Solar flare', 'Sensor spike', 'Warning'].includes(x.label))) {
      w.advanceTo(b.t);
      expect(w.activeAlerts.find((a) => a.level === b.level)?.changedAt, b.label).toBe(b.t);
    }
  });

  it('a copy of the world runs the same as the original', () => {
    const a = new World(undefined, () => 0);
    a.advanceTo(DEMO_START);
    const b = a.clone();
    a.advanceTo(BEATS[3].t);
    b.advanceTo(BEATS[3].t);
    expect(b.activeAlerts.map((x) => x.level)).toEqual(a.activeAlerts.map((x) => x.level));
    expect(b.missionDoseMSv).toBeCloseTo(a.missionDoseMSv, 9);
    expect(b.log.length).toBe(a.log.length);
  });
});
