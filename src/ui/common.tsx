import { createContext, useContext, type ReactNode } from 'react';
import { WarningOctagon, Warning, Question, Info, CheckCircle } from '@phosphor-icons/react';
import rules from '../data/rules.json';
import sources from '../data/sources.json';
import mission from '../data/mission.json';
import type { Level } from '../engine/world';
import type { Sim } from './useSim';
import { fmt } from '../engine/units';
import { BODY_RULE } from '../engine/bodyRules';

export type Tab = 'now' | 'checkin' | 'body' | 'log' | 'mission' | 'cmo' | 'ground' | 'sources';

export interface Ui {
  sim: Sim;
  openSource: (key: string) => void;
  /** Show procedure SH-1 in place on the Now view. */
  openProcedure: () => void;
  procOpen: boolean;
  setProcOpen: (open: boolean) => void;
  go: (tab: Tab) => void;
  /** Record a crew action on the action line, so each tap gives a visible change. */
  note: (msg: string) => void;
  theme: string;
}
export const UiContext = createContext<Ui | null>(null);
export function useUi(): Ui {
  const u = useContext(UiContext);
  if (!u) throw new Error('UiContext missing');
  return u;
}

export const LEVEL_ICON: Record<Level | 'clear' | 'nominal', string> = {
  warning: '■', caution: '!', verify: '?', advisory: 'i', clear: '✓', nominal: '●',
};
export const LEVEL_WORD: Record<Level | 'clear' | 'nominal', string> = {
  warning: 'Warning', caution: 'Caution', verify: 'Verify', advisory: 'Advisory', clear: 'Clear', nominal: 'Nominal',
};

const ICONS = { warning: WarningOctagon, caution: Warning, verify: Question, advisory: Info, clear: CheckCircle, nominal: CheckCircle } as const;

/** Level icon. Each level has its own shape, so color is never the only signal (NFR-05). */
export function LevelIcon({ level, size = 16 }: { level: Level | 'clear' | 'nominal'; size?: number }) {
  const I = ICONS[level];
  return <I size={size} weight="bold" aria-hidden="true" />;
}

export function Chip({ level, children }: { level: Level | 'clear' | 'nominal'; children?: ReactNode }) {
  return (
    <span className={`chip ${level}`}>
      <LevelIcon level={level} size={14} />
      {children ?? LEVEL_WORD[level]}
    </span>
  );
}

/** A value with a tap target that opens its source (FR-06, US-04). */
export function Src({ k, children, label }: { k: string; children: ReactNode; label?: string }) {
  const { openSource } = useUi();
  return (
    <button type="button" className="linkish" onClick={() => openSource(k)} aria-label={label ?? `Show source for ${k}`}>
      {children}
    </button>
  );
}

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
        title: 'Baseline rate B, Mars cruise', value: `${fmt(B, 4)} mSv/h (${rules.baselines.cruise.mSvPerDay} mSv/d)`,
        basis: 'Galactic cosmic rays in the MSL cruise stage. The rules switch B with the mission phase.',
        sourceKey: 'zeitlin2013', evidence: rules.baselines.cruise.evidence, team: false,
      }, {
        title: 'Baseline rate B, Mars surface', value: `${fmt(rules.baselines.surface.mSvPerHour, 4)} mSv/h (${rules.baselines.surface.mSvPerDay} mSv/d)`,
        sourceKey: 'hassler2014', evidence: rules.baselines.surface.evidence, team: false,
      }];
    case 'warningMultiple':
    case 'cautionMultiple':
    case 'verifyMultiple':
    case 'advisoryMultiple': {
      const th = TH[key];
      return [{
        title: `Threshold ${th.label}`, value: `${fmt(th.x * B)} mSv/h in cruise`,
        basis: `${th.label} of the cruise baseline B (${fmt(B, 4)} mSv/h).`,
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
      return [{ title: rules.limits.intlCareer.label, value: `${rules.limits.intlCareer.mSv} mSv`, sourceKey: 'std3001', evidence: 'Validate: confirm the source for the ESA, CSA, and Roscosmos value.', team: false }];
    case 'singleSpe':
      return [{ title: rules.limits.singleSpe.label, value: `${rules.limits.singleSpe.mSv} mSv`, sourceKey: 'std3001', evidence: sources.std3001.evidence, team: false }];
    case 'shelterFactor':
      return [{
        title: 'Shelter factor', value: `${TH.shelterFactor.value} × cabin SPE rate`, basis: `${TH.shelterFactor.label}. ${TH.shelterFactor.basis}`,
        formula: 'Dose saved (estimate) = Σ minutes in shelter × (rate outside − rate inside). Rate outside = rate inside ÷ shelter factor.',
        sourceKey: 'team', evidence: 'Team value for demo. Validate.', team: true,
      }, { title: rules.limits.shelterGoal.label, value: `≤ ${rules.limits.shelterGoal.mSv} mSv`, sourceKey: 'berger2024', evidence: sources.berger2024.evidence, team: false }];
    case 'units':
      return [{
        title: 'Unit conversion (NFR-02)', value: `1 mGy = ${rules.units.mSvPerMGy} mSv`, basis: rules.units.factorBasis,
        sourceKey: 'zeitlin2013', evidence: 'One documented factor. Sensors store mGy. The screen shows mSv.', team: false,
      }];
    case 'priorCareer':
      return [{ title: TH.priorCareerMSv.label, value: `${TH.priorCareerMSv.value} mSv`, sourceKey: 'team', evidence: 'Team value for demo.', team: true }];
    case 'speModel':
      return [{
        title: mission.spe.label, value: `Peak ${mission.spe.peakExcessMSvPerHour} mSv/h above B`,
        basis: mission.spe.basis, formula: `Rise: peak × (t / ${mission.spe.riseMinutes} min)^${mission.spe.riseExponent}. Decay: peak × e^(−t / ${mission.spe.decayTauMinutes} min).`,
        sourceKey: 'team', evidence: 'Simulated. Team value for demo.', team: true,
      }, ...resolveSource('donki')];
    case 'donki':
      return [{ title: 'NASA DONKI', value: 'FLR, CME, SEP records', basis: 'DONKI gives early notice from near Earth. It never sets a Warning by itself.', sourceKey: 'donki', evidence: sources.donki.evidence, team: false }];
    default: {
      const br = BODY_RULE[key];
      if (br) {
        return [{
          title: `Rule ${br.id}: ${br.title}`, value: `${br.level === 'caution' ? 'Caution' : 'Advisory'}. ${br.text}`,
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
