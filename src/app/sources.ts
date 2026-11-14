import rules from '../data/rules.json';
import sources from '../data/sources.json';
import mission from '../data/mission.json';
import cabin from '../data/cabin-rules.json';
import { fmt } from '../engine/units';
import { BODY_RULE, ruleText } from '../engine/bodyRules';

type SourceKey = keyof typeof sources;
export interface SourceView {
  title: string;
  value: string;
  basis?: string;
  sourceKey: SourceKey;
  evidence: string;
  team: boolean;
  formula?: string;
}

const B = rules.baselines.cruise.mSvPerHour;
const TH = rules.thresholds;

export function resolveSource(key: string): SourceView[] {
  const s = (sk: string) => sk as SourceKey;
  const rule = rules.rules.find((r) => r.id === key);
  if (rule) {
    const views: SourceView[] = [{
      title: `Rule ${rule.id}: ${rule.title}`,
      value: rule.triggers.join(' Or: '),
      basis: `${rule.basis} Crew action: ${rule.action}`,
      sourceKey: s(rule.source), evidence: sources[s(rule.source)].evidence, team: rule.source === 'team',
    }];
    if (rule.id === 'R-W1') views.push(...resolveSource('warningMultiple'), ...resolveSource('projection24h'));
    if (rule.id === 'R-C1') views.push(...resolveSource('sepCaution'), ...resolveSource('cautionMultiple'));
    if (rule.id === 'R-V1') views.push(...resolveSource('verifyMultiple'));
    if (rule.id === 'R-A1') views.push(...resolveSource('donki'));
    return views;
  }
  switch (key) {
    case 'B':
    case 'cruise':
      return [{
        title: 'Baseline rate B, Mars cruise', value: `${fmt(B)} mSv/h (${rules.baselines.cruise.mSvPerDay} mSv/d)`,
        basis: 'Galactic cosmic rays in the MSL cruise stage. The rules switch B with the mission phase.',
        sourceKey: 'zeitlin2013', evidence: rules.baselines.cruise.evidence, team: false,
      }, {
        title: 'Baseline rate B, Mars surface', value: `${fmt(rules.baselines.surface.mSvPerHour)} mSv/h (${rules.baselines.surface.mSvPerDay} mSv/d)`,
        sourceKey: 'hassler2014', evidence: rules.baselines.surface.evidence, team: false,
      }];
    case 'warningMultiple':
    case 'floorMultiple':
    case 'cautionMultiple':
    case 'verifyMultiple':
    case 'advisoryMultiple': {
      const th = TH[key];
      return [{
        title: `Threshold ${th.label}`, value: `${fmt(th.x * B)} mSv/h in cruise`,
        basis: `${th.label} of the cruise baseline B (${fmt(B)} mSv/h).`,
        sourceKey: 'team', evidence: sources.team.evidence, team: true,
      }, ...resolveSource('B').slice(0, 1)];
    }
    case 'projection24h':
      return [{
        title: '24 h projection, unsheltered', value: `≥ ${TH.projection24hMSv.value} mSv gives Warning`,
        basis: TH.projection24hMSv.basis, formula: '(cabin mean rate − B) × 24 h. It assumes the rate does not fall, so it is a high estimate.',
        sourceKey: 'team', evidence: 'Estimate. Team value for demo.', team: true,
      }, ...resolveSource('singleSpe')];
    case 'sepCaution':
      return [{ title: 'SEP event threshold', value: TH.sepCaution.label, sourceKey: 'noaaScale', evidence: sources.noaaScale.evidence, team: false }];
    case 'career':
      return [{ title: rules.limits.career.label, value: `${rules.limits.career.mSv} mSv`, basis: 'A Mars crew passes this limit by design. The budget shows a waiver state, not an alert.', sourceKey: 'std3001', evidence: sources.std3001.evidence, team: false }];
    case 'intlCareer':
      return [{ title: rules.limits.intlCareer.label, value: `${rules.limits.intlCareer.mSv} mSv`, sourceKey: 'nasem2021', evidence: sources.nasem2021.evidence, team: false }];
    case 'singleSpe':
      return [{ title: rules.limits.singleSpe.label, value: `${rules.limits.singleSpe.mSv} mSv`, basis: rules.limits.singleSpe.note, sourceKey: 'std3001', evidence: sources.std3001.evidence, team: false }];
    case 'shelterFactor':
      return [{
        title: 'Shelter factor', value: `${TH.shelterFactor.value} × cabin SPE rate`, basis: `${TH.shelterFactor.label}. ${TH.shelterFactor.basis}`,
        formula: 'Dose saved (estimate) = Σ minutes in shelter × (rate outside − rate inside). Rate outside = rate inside ÷ shelter factor.',
        sourceKey: 'team', evidence: 'Team value for demo, compared with Orion data.', team: true,
      }, { title: rules.limits.shelterGoal.label, value: `≤ ${rules.limits.shelterGoal.mSv} mSv`, sourceKey: 'george2024', evidence: sources.george2024.evidence, team: false }];
    case 'units':
      return [{
        title: 'Unit conversion (NFR-02)', value: `1 mGy = ${rules.units.mSvPerMGy} mSv`, basis: rules.units.factorBasis,
        sourceKey: 'zeitlin2013', evidence: 'One documented factor. Sensors store mGy. The screen shows mSv.', team: false,
      }];
    case 'priorCareer':
      return [{ title: TH.priorCareerMSv.label, value: `${TH.priorCareerMSv.value} mSv`, sourceKey: 'team', evidence: 'Team value for demo.', team: true }];
    case 'protons':
      return [{
        title: 'Protons at the ship', value: 'Solar energetic protons raise the cabin dose rate to 2 × B or more',
        basis: 'A large solar flare and a fast CME speed up protons near the Sun. The fastest protons reach a ship near the Earth-Mars path in under 1 h. The event can continue for 1 to 3 days. The ship walls stop part of the protons, but the rest give dose in the cabin. The app shows this label while a radiation Warning (rule R-W1) is open. Go to the shelter: it cuts the event dose.',
        sourceKey: 'noaaScale', evidence: sources.noaaScale.evidence, team: false,
      }, ...resolveSource('R-W1').slice(0, 1), ...resolveSource('speModel').slice(0, 1)];
    case 'solarEvent':
      return [{
        title: 'Solar event', value: 'A solar record or a dose rise that can come before a proton event',
        basis: 'The label shows while an SEP record from DONKI is open, or while a radiation Caution (rule R-C1) is open. The dose rate at the ship can still be normal. Safe your task and stage the shelter.',
        sourceKey: 'donki', evidence: sources.donki.evidence, team: false,
      }, ...resolveSource('R-C1').slice(0, 1)];
    case 'speModel':
      return [{
        title: mission.spe.label, value: 'Measured dose-rate ratio, applied to the cruise baseline B',
        basis: mission.spe.basis, formula: 'Cabin SPE rate = (RAD E rate ÷ fitted RAD background − 1) × B × sensor shielding.',
        sourceKey: 'rad2012', evidence: sources.rad2012.evidence, team: false,
      }, ...resolveSource('lowe2025')];
    case 'cabinCo2':
      return [{ title: 'CO2 limit, 1-hour average', value: `≤ ${cabin.limits.co2HourMmHg.max} mmHg [${cabin.limits.co2HourMmHg.req}]`, sourceKey: 'ochmoCo2', evidence: sources.ochmoCo2.evidence, team: false },
        { title: 'CO2, 7-day average', value: `< ${cabin.limits.co2WeekMmHg.max} mmHg keeps headache risk under 1%`, sourceKey: 'ochmoCo2', evidence: sources.ochmoCo2.evidence, team: false }];
    case 'cabinTemp':
      return [{ title: 'Temperature', value: `Health ${cabin.limits.tempHealthC.min} to ${cabin.limits.tempHealthC.max} °C [V2 6012]. Comfort ${cabin.limits.tempComfortC.min} to ${cabin.limits.tempComfortC.max} °C [V2 6013].`, sourceKey: 'ochmoEclss', evidence: sources.ochmoEclss.evidence, team: false }];
    case 'cabinRh':
      return [{ title: 'Relative humidity', value: `Health ${cabin.limits.rhHealthPct.min} to ${cabin.limits.rhHealthPct.max}% [V2 6012]. Comfort ${cabin.limits.rhComfortPct.min} to ${cabin.limits.rhComfortPct.max}% [V2 6013].`, sourceKey: 'ochmoEclss', evidence: sources.ochmoEclss.evidence, team: false }];
    case 'cabinO2':
      return [{ title: 'Oxygen partial pressure', value: `Normoxia target ${cabin.limits.ppO2TargetMmHg.min} to ${cabin.limits.ppO2TargetMmHg.max} mmHg`, sourceKey: 'ochmoEclss', evidence: sources.ochmoEclss.evidence, team: false }];
    case 'cabinP':
      return [{ title: 'Total pressure', value: `${cabin.limits.totalKPa.min} to ${cabin.limits.totalKPa.max} kPa for indefinite exposure [V2 6006]`, sourceKey: 'ochmoEclss', evidence: sources.ochmoEclss.evidence, team: false }];
    case 'donki':
      return [{ title: 'NASA DONKI', value: 'FLR, CME, SEP records', basis: 'DONKI gives early notice from near Earth. It never sets a Warning by itself.', sourceKey: 'donki', evidence: sources.donki.evidence, team: false }];
    default: {
      const br = BODY_RULE[key];
      if (br) {
        return [{
          title: `Rule ${br.id}: ${br.title}`, value: `${br.level === 'caution' ? 'Caution' : 'Advisory'}. ${ruleText(br.id)}`,
          basis: 'Body rules give Advisory or Caution only. They do not count toward the radiation alarm limit.',
          sourceKey: s(br.source), evidence: `${sources[s(br.source)]?.evidence ?? ''} Thresholds are team values for the demo.`, team: true,
        }];
      }
      if (key in sources) return [{ title: sources[s(key)].short, value: '', sourceKey: s(key), evidence: sources[s(key)].evidence, team: key === 'team' }];
      return [];
    }
  }
}

export { sources };

