import { describe, it, expect } from 'vitest';
import rules from '../src/data/rules.json';
import { FACTOR, FACTORS, AREAS, baselineOf, doseInArea, levelAt, scalePos } from '../src/engine/limits';
import { cabinAt, cabinFindings, type CabinReading } from '../src/engine/cabin';
import { qualityOf } from '../src/engine/doseModel';
import { fmt, whole } from '../src/engine/units';
import { duration, stamp, at } from '../src/engine/time';
import { DEFAULT_PROFILE, initials, loadProfile, modelOf } from '../src/app/profile';
import { World, PROCEDURE_SH1 } from '../src/engine/world';

const TH = rules.thresholds;
const NORMAL: CabinReading = { co2mmHg: 2.2, co2Day7: 2.2, tempC: 22.5, rhPct: 45, ppO2mmHg: 152, totalKPa: 101.3 };

describe('limit zones (Limits explorer and Cabin air)', () => {
  it('give Caution at 1.5 × B and Warning at 2 × B on the cabin sensors', () => {
    const z = FACTOR.dose.zones('cabin');
    const B = baselineOf('cabin');
    expect(levelAt(z, 1.4 * B)).toBe('nominal');
    expect(levelAt(z, TH.cautionMultiple.x * B)).toBe('caution');
    expect(levelAt(z, TH.warningMultiple.x * B)).toBe('warning');
  });

  it('move the dose edges up in the shelter, so the dose you get there matches the cabin edge', () => {
    for (const k of [TH.cautionMultiple.x, TH.warningMultiple.x]) {
      const edge = FACTOR.dose.zones('shelter').find((z) => z.level === (k === TH.cautionMultiple.x ? 'caution' : 'warning'))!.from;
      expect(doseInArea('shelter', edge)).toBeCloseTo(k * baselineOf('shelter'), 9);
    }
  });

  it('cover each factor scale with no gap', () => {
    for (const f of FACTORS) {
      for (const a of AREAS) {
        const z = f.zones(a.id);
        expect(z[0].from).toBe(f.min);
        expect(z[z.length - 1].to).toBe(f.max);
        z.slice(1).forEach((x, i) => expect(x.from).toBe(z[i].to));
      }
    }
  });

  it('clamp values outside the scale to its ends', () => {
    const f = FACTOR.tempC;
    expect(levelAt(f.zones('cabin'), 0)).toBe('caution');
    expect(levelAt(f.zones('cabin'), 99)).toBe('caution');
    expect(scalePos(f, -5)).toBe(0);
    expect(scalePos(f, 99)).toBe(1);
  });
});

describe('cabin air rules', () => {
  it('give no finding for normal air', () => {
    expect(cabinFindings(NORMAL)).toEqual([]);
  });

  it('give Caution over a health limit and Advisory outside the comfort zone', () => {
    const f = cabinFindings({ ...NORMAL, co2mmHg: 3.4, tempC: 26, rhPct: 80 });
    expect(f.map((x) => [x.id, x.level])).toEqual([['C-CO2-1', 'caution'], ['C-T-2', 'advisory'], ['C-RH-1', 'caution']]);
  });

  it('raise CO2 during a long shelter stay', () => {
    const t = at(95, '12:00');
    expect(cabinAt(t, 240).co2mmHg).toBeGreaterThan(cabinAt(t, 0).co2mmHg + 0.5);
  });
});

describe('sensor quality', () => {
  it('marks a far outlier poor and a gap missing', () => {
    expect(qualityOf([1, 1.1, 0.9, 5, null, 1])).toEqual(['good', 'good', 'good', 'poor', 'missing', 'good']);
  });
});

describe('number and time style', () => {
  it('gives 3 significant figures and whole counts', () => {
    expect(fmt(1.8412)).toBe('1.84');
    expect(fmt(12345)).toBe('12,300');
    expect(fmt(0)).toBe('0');
    expect(fmt(NaN)).toBe('-');
    expect(whole(2.6)).toBe('3');
  });

  it('writes durations and mission stamps', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(120)).toBe('2 h');
    expect(duration(135)).toBe('2 h 15 min');
    expect(stamp(at(94, '08:51'))).toBe('Day 094 08:51');
  });
});

describe('profile', () => {
  it('falls back to the default profile when storage is not there', () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it('gives initials and the default model of each engine', () => {
    expect(initials(DEFAULT_PROFILE)).toBe('CA');
    expect(initials({ ...DEFAULT_PROFILE, name: 'mae jemison' })).toBe('MJ');
    expect(modelOf({ ...DEFAULT_PROFILE, engine: 'anthropic' })).toBe('claude-opus-5-5');
    expect(modelOf({ ...DEFAULT_PROFILE, engine: 'openai', models: { openai: ' my-model ' } })).toBe('my-model');
  });
});

describe('alert log inputs', () => {
  it('count the sensors at the rule thresholds', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(at(94, '09:00'));
    const e = w.log.find((x) => x.kind === 'alert' && x.level === 'warning')!;
    expect(Object.keys(e.inputs!)).toEqual(expect.arrayContaining([
      `Sensors ≥ ${TH.floorMultiple.label}`, `Sensors ≥ ${TH.warningMultiple.label}`, `Sensors ≥ ${TH.cautionMultiple.label}`,
    ]));
    expect(Number(e.inputs![`Sensors ≥ ${TH.warningMultiple.label}`])).toBeGreaterThanOrEqual(2);
  });
});

describe('shelter time', () => {
  it('counts the minutes in the shelter, and 0 outside', () => {
    const w = new World(undefined, () => 0);
    w.advanceTo(at(94, '09:00'));
    expect(w.shelterMinAt()).toBe(0);
    w.apply({ type: 'procStart', alertId: null }, 0);
    for (const s of PROCEDURE_SH1.steps.slice(0, 3)) w.apply({ type: 'procStep', step: s.n }, 0);
    w.advanceTo(at(94, '10:30'));
    expect(w.shelterMinAt()).toBe(90);
    w.apply({ type: 'shelterExit' }, 0);
    expect(w.shelterMinAt()).toBe(0);
    expect(w.shelterMinAt(at(94, '10:00'))).toBe(60);
  });
});
