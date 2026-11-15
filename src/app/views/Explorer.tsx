import { useState } from 'react';
import { cn } from '@/lib/utils';
import ev from '../../data/real/rad-events.json';
import rules from '../../data/rules.json';
import { AREAS, FACTORS, baselineOf, doseInArea, levelAt, type AreaId, type Factor, type Zone, type ZoneLevel } from '../../engine/limits';
import { fmt, whole } from '../../engine/units';
import { FIELD, LEVEL_WORD, LevelBadge, PageHead, Panel, Prov, Seg, Src, ZoneBar } from '../parts';
import { Mic } from '../Mic';

/** The first number in a spoken phrase, for example "3.4" in "about 3.4 millimeters". */
const spokenNumber = (t: string) => Number(t.replace(',', '.').match(/-?\d+(\.\d+)?/)?.[0] ?? NaN);

type Values = Record<Factor['key'], number>;
const START = Object.fromEntries(FACTORS.map((f) => [f.key, f.start])) as Values;

// Measured peaks: MSL RAD dose rate over its background (rad-events.json), on the baseline of the area.
const peak = (id: string, area: AreaId) => {
  const e = ev.events.find((x) => x.id === id)!;
  return { label: `${new Date(e.onset_utc + 'Z').toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })} peak, measured`, area, values: { dose: Number(fmt(e.peak_ratio * baselineOf(area))) } };
};

const PRESETS: { label: string; area?: AreaId; values: Partial<Values> }[] = [
  { label: 'Normal day', values: START },
  peak('cruise_2012-1', 'cabin'),
  peak('surface_2024-0', 'surface'),
  { label: 'Crowded shelter air', values: { co2mmHg: 3.4, tempC: 24.1, rhPct: 58 } },
  { label: 'Hot and dry cabin', values: { tempC: 28, rhPct: 22 } },
];

const ORDER: ZoneLevel[] = ['advisory', 'caution', 'warning'];

/** Limits are shown as the standard defines them. Computed edges use the app number style. */
const edge = (f: Factor, x: number) => (f.key === 'dose' ? fmt(x) : String(x));

/** The ranges at Advisory or worse, for example "Caution: below 18 or above 27". */
function rangeLines(f: Factor, zones: Zone[]): { level: ZoneLevel; text: string }[] {
  return ORDER.flatMap((level) => {
    const parts = zones.filter((z) => z.level === level).map((z) =>
      z.from <= f.min ? `below ${edge(f, z.to)}` : z.to >= f.max ? `above ${edge(f, z.from)}` : `${edge(f, z.from)} to ${edge(f, z.to)}`);
    return parts.length ? [{ level, text: `${parts.join(' or ')} ${f.unit}` }] : [];
  });
}

const TEXT: Record<ZoneLevel, string> = { nominal: '', advisory: 'text-advisory', caution: 'text-caution-ink', warning: 'text-warning' };

/** The Caution and Warning ranges. A factor with no Caution limit shows its Advisory range. */
function worst(lines: { level: ZoneLevel; text: string }[]) {
  const loud = lines.filter((r) => r.level !== 'advisory');
  return loud.length ? loud : lines;
}

/** A what-if tool: type a value for each factor and see if it is safe in each area. */
export function ExplorerView() {
  const [area, setArea] = useState<AreaId>('cabin');
  const [v, setV] = useState<Values>(START);
  const a = AREAS.find((x) => x.id === area)!;
  return (
    <>
      <PageHead title="Limits explorer" sub="Type or say a value, or pick an example. Then pick an area. You see if each value is safe there." actions={<Prov kind="standard">NASA-STD-3001 and app rules</Prov>} />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 pt-4">
          <span className="text-sm font-medium">Area</span>
          <Seg<AreaId> label="Area" value={area} onChange={setArea} options={AREAS.map((x) => ({ value: x.id, label: x.label }))} />
          <p className="w-full text-sm text-muted-foreground">{a.about}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Examples</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => { setV({ ...START, ...p.values }); if (p.area) setArea(p.area); }} className="h-9 rounded-md border px-3 text-sm transition-[transform,background-color] hover:bg-accent active:scale-[0.97] pointer-coarse:h-11">{p.label}</button>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {FACTORS.map((f) => {
          const zones = f.zones(area);
          const value = v[f.key];
          const level = levelAt(zones, value);
          const id = `in-${f.key}`;
          return (
            <Panel key={f.key} title={<label htmlFor={id}>{f.title}</label>} aside={<LevelBadge level={level} />}>
              <div className="flex flex-wrap items-center gap-3">
                <input id={id} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} value={value}
                  onChange={(e) => { const x = e.target.valueAsNumber; if (Number.isFinite(x)) setV({ ...v, [f.key]: x }); }}
                  className={cn(FIELD, 'num w-32 text-lg font-semibold')} />
                <span className="text-sm text-muted-foreground">{f.unit}</span>
                <Mic label={`Say a value for ${f.title}`} onText={(t) => { const x = spokenNumber(t); if (Number.isFinite(x)) setV((cur) => ({ ...cur, [f.key]: x })); }} />
                <input type="range" aria-label={`${f.title} slider`} min={f.min} max={f.max} step={f.step} value={Math.min(f.max, Math.max(f.min, value))}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.valueAsNumber })} className="w-full min-w-0 accent-[var(--primary)] sm:w-auto sm:flex-1" />
              </div>
              <ZoneBar f={f} zones={zones} v={value} className="mt-4" />
              <div className="num mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{f.min}</span><span>{f.max}{f.log ? ' (log scale)' : ''}</span></div>
              <ul className="mt-2 space-y-1 text-sm">
                {rangeLines(f, zones).map((r) => <li key={r.level}><b>{LEVEL_WORD[r.level]}:</b> {r.text}</li>)}
              </ul>
              {f.key === 'dose' && <DoseNote area={area} rate={value} />}
              <Src k={f.src} className="mt-2 inline-block text-xs text-muted-foreground">Source of the limits</Src>
            </Panel>
          );
        })}
      </div>

      <Panel title="Dangerous ranges in each area" className="mt-4" bodyClass="px-0 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b"><th className="px-5 py-2 font-medium">Factor</th>{AREAS.map((x) => <th key={x.id} className="py-2 pr-4 font-medium">{x.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {FACTORS.map((f) => (
                <tr key={f.key} className="align-top">
                  <td className="px-5 py-3 font-medium">{f.title}</td>
                  {AREAS.map((x) => (
                    <td key={x.id} className="py-3 pr-4">
                      {worst(rangeLines(f, f.zones(x.id))).map((r) => <div key={r.level}><span className={TEXT[r.level]}>{LEVEL_WORD[r.level]}</span> {r.text}</div>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 pt-2 text-xs text-muted-foreground">
          Air limits are the same in each pressurized area. Radiation ranges change with the normal dose rate of the area and with the shelter. Team values are not NASA flight rules.
        </p>
      </Panel>
    </>
  );
}

function DoseNote({ area, rate }: { area: AreaId; rate: number }) {
  const you = doseInArea(area, rate);
  const day = you * 24;
  return (
    <p className="mt-2 rounded-md bg-muted/60 p-3 text-sm leading-relaxed">
      {area === 'shelter' && <>In the shelter you get <b className="num">{fmt(you)} mSv/h</b>, because the shelter keeps <Src k="shelterFactor">25%</Src> of the event dose. </>}
      The normal rate here is <Src k="B"><span className="num">{fmt(baselineOf(area))} mSv/h</span></Src>.
      {' '}24 h at this rate gives <b className="num">{fmt(day)} mSv</b>, which is <span className="num">{whole((day / rules.limits.singleSpe.mSv) * 100)}%</span> of the <Src k="singleSpe">{rules.limits.singleSpe.mSv} mSv</Src> NASA design limit for one solar event.
    </p>
  );
}
