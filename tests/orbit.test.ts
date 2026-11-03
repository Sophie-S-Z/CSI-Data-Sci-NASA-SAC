import { describe, it, expect } from 'vitest';
import { vehicleAt, earthAt, marsAt, lightMinutes, R_MARS } from '../src/engine/orbit';

describe('mission geometry', () => {
  it('starts at Earth and ends at Mars', () => {
    const v0 = vehicleAt(0), e0 = earthAt(0);
    expect(Math.hypot(v0.x - e0.x, v0.y - e0.y)).toBeLessThan(1e-6);
    const v1 = vehicleAt(180), m1 = marsAt(180);
    expect(Math.hypot(v1.x - m1.x, v1.y - m1.y)).toBeLessThan(1e-3);
    expect(Math.hypot(v1.x, v1.y)).toBeCloseTo(R_MARS, 3);
  });
  it('gives a light time within the 0 to 22 min range', () => {
    for (const d of [0, 30, 94, 150, 180]) {
      const m = lightMinutes(d);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(22.5);
    }
  });
});
