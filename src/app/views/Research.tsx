import { useState, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { cn } from '@/lib/utils';
import raw from '../../data/real/frontier.json';
import { PageHead, Panel, Prov, Seg } from '../parts';
import { fmt, whole } from '../../engine/units';

/** One rule at one threshold on one data set (research/frontier/onset.py). */
interface OnsetRow {
  rule: string; budget: string; threshold: number | null;
  shelter_h_per_year: number; entries_per_year: number; events: number; entered: number; median_delay_h: number | null;
  dose_avoided_pct: number; gain_vs_current_pct: number; gain_vs_current_ci: [number, number];
  lost_before_entry_pct: number; lost_after_exit_pct: number;
}
interface OnsetSet { id: string; label: string; kind: 'measured' | 'modeled'; years: number; events: number; rows: OnsetRow[] }
/** One clear-time model on one set of shelter stays (research/frontier/outlook.py). */
interface Score {
  checks: number; stays: number; solar_events: number; share_of_hours_with_estimate_pct: number;
  coverage_pct: number; coverage_ci: [number, number]; coverage_at_50?: number; coverage_at_80?: number; median_width_h: number; median_width_over_left: number; median_abs_error_h: number;
}
type Band = Record<'0.05' | '0.5' | '0.95', (number | null)[]>;
interface OutlookClass {
  scores: Record<string, Record<string, Score>>;
  example: { entry: string; left_h: number[] } & Record<string, Band>;
}
interface Fit { hourly_within_factor_2: number; events: number; event_dose_within_factor_2: number; hourly_log10_error_p16_p50_p84: number[] }
interface Frontier {
  data: {
    goes: { years: number[]; noaa_events_in_period: number; noaa_events_found: number; our_peak_over_noaa_peak_p16_p50_p84: number[] };
    rad: { observations: number; cruise_median_E_uGy_day: number; loewe_2025_uGy_day: number };
    crater: { hours: number; d34_events: number; d34_events_with_goes_proton_rise: number };
  };
  audit: {
    entered: { earlier: number[]; earlier_lower_bound_pct: number; now: number[]; now_lower_bound_pct: number };
    false_entries: { earlier_days: number; earlier_upper_bound_per_year: number; now_count: number; now_years: number; now_upper_bound_per_year: number };
    clear_time: { earlier: number[]; earlier_events: number; now_coverage_pct: number; now_ci: number[]; now_stays: number };
  };
  transfer: { detectors: { id: string; label: string; fit_period: Fit; test_2020_on?: Fit; leave_one_event_out?: { modeled_over_measured_dose: number }[] }[] };
  onset: { sets: OnsetSet[] };
  outlook: Record<'shielded' | 'thin', OutlookClass>;
}
const fr = raw as unknown as Frontier;

const CURRENT = 'Current rule: 2 x background';
const LOEWE = 'Loewe 2025: 1.25 x background';
const RATIO = 'Ratio, 40 min in a row';
const SAME = 'same hours';
const RULE_NAME: Record<string, string> = { [CURRENT]: 'Current rule: 2 × background', [LOEWE]: 'Löwe 2025: 1.25 × background', [RATIO]: 'Ratio rule, lower line' };
const ruleName = (r: OnsetRow) => RULE_NAME[r.rule] ?? r.rule;

const MODELS: { id: string; name: string; how: string }[] = [
  { id: 'decay, RAD range', name: 'Decay fit, RAD range', how: 'The method in the app. Range from the RAD events before 2020.' },
  { id: 'decay, conformal', name: 'Decay fit, conformal range', how: 'Same fit. Range from the 5% and 95% points of all calibration events.' },
  { id: 'analogs', name: 'Analog events', how: 'The 50 most similar hours of earlier events.' },
  { id: 'boosted, conformal', name: 'Boosted quantiles, conformal', how: 'New. Gradient boosting on 7 inputs, with a calibration step.' },
  { id: 'climatology', name: 'Stay length only', how: 'Baseline. It knows the hours in the shelter and nothing more.' },
];
const SCORE_SETS = [
  { value: 'test, measured', label: 'Measured, 2020 to 2026' },
  { value: 'test, replay', label: 'Replay, 2020 to 2026' },
  { value: 'calibration (cross-fitted)', label: 'Calibration, 2009 to 2019' },
];

const TIP = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 };
const pct = (v: number) => `${v.toFixed(1)}%`;
const range = ([a, b]: number[]) => `${a.toFixed(1)} to ${b.toFixed(1)}`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</div>
    </div>
  );
}

function Th({ children, first }: { children?: ReactNode; first?: boolean }) {
  return <th className={cn('py-2 pr-4 font-medium', first && 'px-5')}>{children}</th>;
}

function Table({ head, children, min = 760 }: { head: string[]; children: ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead className="text-left text-xs text-muted-foreground"><tr className="border-b">{head.map((h, i) => <Th key={h} first={i === 0}>{h}</Th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

function OnsetPanel() {
  const [part, setPart] = useState<'test' | 'tune'>('test');
  const [source, setSource] = useState('crater_d34');
  const set = fr.onset.sets.find((s) => s.id === `${source}/${part}`)!;
  const current = set.rows.find((r) => r.rule === CURRENT)!;
  const loewe = set.rows.find((r) => r.rule === LOEWE)!;
  const others = set.rows.filter((r) => r.rule !== CURRENT && r.rule !== LOEWE && !(r.rule === RATIO && r.budget === SAME));
  const lower = [loewe, ...others.filter((r) => r.rule === RATIO)];
  const methods = others.filter((r) => r.rule !== RATIO);
  const table = [current, loewe, ...set.rows.filter((r) => r.budget === SAME && r.rule !== RATIO)];
  const floor = Math.min(60, Math.floor(current.dose_avoided_pct - 5));
  const hidden = methods.filter((r) => r.dose_avoided_pct < floor).length;
  const point = (r: OnsetRow) => ({ ...r, x: r.shelter_h_per_year, y: r.dose_avoided_pct });

  return (
    <Panel title="Step 2. When to enter the shelter" aside={<Prov kind={set.kind === 'measured' ? 'measured' : 'replay'}>{set.kind === 'measured' ? 'Measured' : 'Replay of measured flux'}</Prov>}>
      <p className="max-w-3xl text-sm leading-relaxed">We compared the current rule with 11 other rules. Each rule got the threshold that gives the same shelter hours per year on data before 2020. Then the thresholds stayed fixed for the test. A rule is better only if it avoids more dose for the same hours.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Seg label="Period" value={part} onChange={setPart} options={[{ value: 'test', label: 'Test, 2020 to 2026' }, { value: 'tune', label: 'Tuning, before 2020' }]} />
        <Seg label="Data set" value={source} onChange={setSource} options={[{ value: 'crater_d34', label: 'LRO CRaTER' }, { value: 'rad', label: 'MSL RAD' }, { value: 'replay', label: 'GOES replay' }]} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{set.label}: <span className="num">{fmt(set.years)}</span> years, <span className="num">{set.events}</span> events of 2 × background or more.</p>
      <div className="mt-2 h-72 w-full" role="img" aria-label={`Dose avoided against shelter hours per year for each rule on ${set.label}. The table below has the same numbers.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 18, left: 0 }}>
            <CartesianGrid stroke="var(--border)" />
            <XAxis dataKey="x" type="number" domain={[(min: number) => Math.floor(min * 0.9), (max: number) => Math.ceil(max * 1.05)]} tickCount={6} tickLine={false} axisLine={false} tickFormatter={(v) => whole(v)} label={{ value: 'Shelter hours per year', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis dataKey="y" type="number" domain={[floor, 76]} ticks={[floor, floor + 5, floor + 10, 75].filter((t) => t <= 75)} allowDataOverflow tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
            <ZAxis range={[70, 70]} />
            <ReferenceLine y={75} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
            <RTooltip isAnimationActive={false} cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
              const r = payload?.[0]?.payload as OnsetRow | undefined;
              return r ? (
                <div style={TIP} className="px-3 py-2">
                  <div className="font-medium">{ruleName(r)}</div>
                  <div className="num text-muted-foreground">{r.threshold ? `Threshold ${fmt(r.threshold)}, ` : ''}{fmt(r.shelter_h_per_year)} h per year</div>
                  <div className="num">{pct(r.dose_avoided_pct)} of the event dose avoided</div>
                </div>
              ) : null;
            }} />
            <Scatter name="Other methods" data={methods.map(point)} fill="var(--chart-3)" shape="circle" isAnimationActive={false} />
            <Scatter name="Ratio rule, lower line" data={lower.map(point)} fill="var(--chart-2)" shape="diamond" isAnimationActive={false} />
            <Scatter name="Current rule" data={[point(current)]} fill="var(--chart-1)" shape="square" isAnimationActive={false}><ZAxis range={[160, 160]} /></Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 bg-chart-1" />Current rule (2 × background)</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rotate-45 bg-chart-2" />Ratio rule with a lower line (1.25 × is Löwe 2025)</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-chart-3" />Other methods, at 3 budgets of shelter hours</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 border-t border-dashed border-muted-foreground" />Most that the shelter can save (75%)</span>
        {hidden > 0 && <span>{hidden} points below {floor}% are off the chart.</span>}
      </div>
      <div className="-mx-5 mt-4">
        <Table head={['Rule, at the shelter hours of the current rule', 'Threshold', 'Shelter h per year', 'Entries per year', 'Events entered', 'Median delay', 'Dose avoided', 'Gain on the current rule (95% range)']} min={980}>
          {table.map((r) => (
            <tr key={r.rule} className={cn(r.rule === CURRENT && 'bg-primary/5')}>
              <td className="px-5 py-2.5 font-medium">{ruleName(r)}{r.rule === LOEWE && <span className="font-normal text-muted-foreground"> (more hours)</span>}</td>
              <td className="num py-2.5 pr-4">{r.threshold ? fmt(r.threshold) : r.rule === CURRENT ? '2.00' : '1.25'}</td>
              <td className="num py-2.5 pr-4">{fmt(r.shelter_h_per_year)}</td>
              <td className="num py-2.5 pr-4">{fmt(r.entries_per_year)}</td>
              <td className="num py-2.5 pr-4">{r.entered} of {r.events}</td>
              <td className="num py-2.5 pr-4">{r.median_delay_h === null ? 'No entry' : `${whole(r.median_delay_h * 60)} min`}</td>
              <td className="num py-2.5 pr-4">{pct(r.dose_avoided_pct)}</td>
              <td className="num py-2.5 pr-5">{r.rule === CURRENT ? 'Reference' : `${signed(r.gain_vs_current_pct)} (${signed(r.gain_vs_current_ci[0])} to ${signed(r.gain_vs_current_ci[1])})`}</td>
            </tr>
          ))}
        </Table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Delay is the time from the 2 × crossing to the entry. A negative delay is an entry before the crossing. Threshold is a ratio to background for the ratio rules and a number of noise sigmas for the other rules. On this data set the current rule loses <span className="num">{pct(current.lost_before_entry_pct)}</span> of the event dose before the entry and <span className="num">{pct(current.lost_after_exit_pct)}</span> after the exit. The shelter factor (team value, 0.25) sets the limit of 75%.</p>
    </Panel>
  );
}

function OutlookPanel() {
  const [cls, setCls] = useState<'shielded' | 'thin'>('shielded');
  const [setId, setSetId] = useState(SCORE_SETS[0].value);
  const [model, setModel] = useState('boosted, conformal');
  const oc = fr.outlook[cls];
  const scores = oc.scores[setId];
  const ex = oc.example;
  const shown = ex[model] ? model : 'boosted, conformal';
  const band = ex[shown];
  const top = Math.ceil(ex.left_h.length / 12) * 24;  // about 2 times the stay, on a 24 h grid
  const data = ex.left_h.map((left, i) => {
    const lo = band['0.05'][i], hi = band['0.95'][i];
    return { h: i, left, mid: band['0.5'][i], band: lo === null || hi === null ? null : [lo, Math.min(hi, top)] };
  });

  return (
    <Panel title="Step 3. When to leave the shelter" aside={<Prov kind={setId === 'test, replay' ? 'replay' : 'measured'}>{setId === 'test, replay' ? 'Replay of measured flux' : 'Measured'}</Prov>}>
      <p className="max-w-3xl text-sm leading-relaxed">In each hour of a shelter stay, a model gives a range for the hours left to the all-clear. A good range has 2 properties. It holds the real value 90% of the time, and it is narrow. The models learned from the replay of 1986 to 2008. Measured events of 2009 to 2019 set the width of the ranges.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Seg label="Shielding" value={cls} onChange={setCls} options={[{ value: 'shielded', label: 'Shielded detectors' }, { value: 'thin', label: 'Thin shielding' }]} />
        <Seg label="Events" value={setId} onChange={setSetId} options={SCORE_SETS} />
      </div>
      <div className="-mx-5 mt-3">
        <Table head={['Model', 'Real value in the 90% range (95% range)', 'Median width', 'Width over time left', 'Median error', 'Hours with an estimate', 'Stays']} min={920}>
          {MODELS.filter((m) => scores[m.id]?.checks).map((m) => {
            const s = scores[m.id];
            return (
              <tr key={m.id} className={cn(m.id === 'boosted, conformal' && 'bg-primary/5')}>
                <td className="px-5 py-2.5"><div className="font-medium">{m.name}</div><div className="text-xs text-muted-foreground">{m.how}</div></td>
                <td className="num py-2.5 pr-4"><span className="font-semibold">{pct(s.coverage_pct)}</span> <span className="text-muted-foreground">({range(s.coverage_ci)})</span></td>
                <td className="num py-2.5 pr-4">{fmt(s.median_width_h)} h</td>
                <td className="num py-2.5 pr-4">{fmt(s.median_width_over_left)} ×</td>
                <td className="num py-2.5 pr-4">{fmt(s.median_abs_error_h)} h</td>
                <td className="num py-2.5 pr-4">{whole(s.share_of_hours_with_estimate_pct)}%</td>
                <td className="num py-2.5 pr-5">{s.stays}</td>
              </tr>
            );
          })}
        </Table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Shielded detectors are CRaTER D3 and D4 and RAD. They are like a crew cabin. Thin shielding is CRaTER D1, D2, D5, and D6. Each hourly check has the same weight. The 95% range of the coverage comes from a bootstrap over solar events. The decay fit gives no estimate before the dose rate falls to half of its peak.</p>

      <h3 className="mt-5 text-sm font-semibold">Example: the event of 11 November 2025 at CRaTER (test period)</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <Seg label="Model" value={shown} onChange={setModel} options={MODELS.filter((m) => ex[m.id] && m.id !== 'climatology' && m.id !== 'analogs').map((m) => ({ value: m.id, label: m.name }))} />
      </div>
      <div className="mt-2 h-64 w-full" role="img" aria-label="Hours left to the all-clear in each hour of one shelter stay: the real value, the estimate of the model, and its 90% range.">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="h" type="number" domain={[0, data.length - 1]} tickLine={false} axisLine={false} tickCount={8} label={{ value: 'Hours in the shelter', position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis domain={[0, top]} ticks={[0, top / 4, top / 2, (3 * top) / 4, top]} allowDataOverflow tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v} h`} />
            <RTooltip isAnimationActive={false} contentStyle={TIP} labelFormatter={(h) => `Hour ${h} in the shelter`}
              formatter={(v, name) => [Array.isArray(v) ? `${fmt(Number(v[0]))} to ${fmt(Number(v[1]))} h` : `${fmt(Number(v))} h`, name]} />
            <Area dataKey="band" name="90% range" stroke="none" fill="var(--chart-1)" fillOpacity={0.18} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="mid" name="Estimate" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="left" name="Real hours left" stroke="var(--foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 border-t-2 border-dashed border-foreground" />Real hours left</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-chart-1" />Estimate</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-4 rounded-sm bg-chart-1/20" />90% range (cut at {top} h)</span>
      </div>
    </Panel>
  );
}

export function ResearchView() {
  const { data, audit, transfer, onset, outlook } = fr;
  const tests = onset.sets.filter((s) => s.id.endsWith('/test'));
  const best = (s: OnsetSet) => Math.max(...s.rows.filter((r) => r.budget === SAME && r.rule !== RATIO).map((r) => r.gain_vs_current_pct));
  const d34 = transfer.detectors.find((d) => d.id === 'crater_d34')!;
  const measured = outlook.shielded.scores['test, measured'];
  const app = measured['decay, RAD range'], boosted = measured['boosted, conformal'];

  return (
    <>
      <PageHead title="Research" sub={<>When to enter the shelter, and when to leave it. We tested both on 40 years of proton data and 2 deep-space dosimeters. We tuned on data before 2020 and tested one time on 2020 to 2026.</>}
        actions={<Prov kind="measured">GOES, MSL RAD, LRO CRaTER</Prov>} />

      <div className="space-y-4">
        <Panel title="Results in short">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Do 6 events prove the rules?" value="No" sub={<>6 of 6 events proves a rate of {audit.entered.earlier_lower_bound_pct}% or more. The study adds {audit.entered.now[0]} measured events. That proves {audit.entered.now_lower_bound_pct}% or more.</>} />
            <Tile label="Can GOES stand in for a dosimeter?" value="Yes, within 2 ×" sub={<>{pct(100 * d34.test_2020_on!.hourly_within_factor_2)} of the event hours at CRaTER agree within a factor of 2 (2020 to 2026, not used in the fit).</>} />
            <Tile label="Is there a better entry rule?" value="No clear gain" sub={<>At equal shelter hours, the best of 11 other rules changed the avoided dose by {tests.map((s) => signed(best(s))).join(', ')} points on the 3 test sets (replay, RAD, CRaTER).</>} />
            <Tile label="Can the tool tell the time left?" value="Yes, with a wide range" sub={<>The range of the app held the real value in {pct(app.coverage_pct)} of the checks on new events. A new model reached {pct(boosted.coverage_pct)} and gives an estimate in each hour.</>} />
          </div>
        </Panel>

        <Panel title="Data, and a check of each data set" aside="Step 0">
          <div className="grid gap-3 md:grid-cols-3">
            <Tile label={`GOES proton flux, ${data.goes.years[0]} to ${data.goes.years[1]}`} value={`${data.goes.noaa_events_found} of ${data.goes.noaa_events_in_period}`} sub={<>events on the NOAA list show in our series. Our peak flux over the NOAA peak flux has a median of {data.goes.our_peak_over_noaa_peak_p16_p50_p84[1].toFixed(2)}. The 20 events that do not show have peaks near the 10 pfu line.</>} />
            <Tile label="MSL RAD dose rate, 2011 to 2026" value={whole(data.rad.observations)} sub={<>observations. The cruise median of detector E is {fmt(data.rad.cruise_median_E_uGy_day)} µGy per day. Löwe et al. 2025 give {fmt(data.rad.loewe_2025_uGy_day)}.</>} />
            <Tile label="LRO CRaTER dose rate, 2009 to 2026" value={`${data.crater.d34_events_with_goes_proton_rise} of ${data.crater.d34_events}`} sub={<>dose-rate events have a proton rise in GOES in the same days. The record has {whole(data.crater.hours)} hours.</>} />
          </div>
        </Panel>

        <Panel title="What the earlier tests prove" bodyClass="px-0 pb-3">
          <Table head={['Earlier claim', 'What the claim proves (95% bound)', 'Result with the new data']}>
            <tr><td className="px-5 py-3">The rule entered the shelter in {audit.entered.earlier[0]} of {audit.entered.earlier[1]} events.</td>
              <td className="py-3 pr-4">The true rate is <span className="num">{audit.entered.earlier_lower_bound_pct}%</span> or more.</td>
              <td className="py-3 pr-5"><span className="num">{audit.entered.now[0]} of {audit.entered.now[1]}</span> measured events. The true rate is <span className="num">{audit.entered.now_lower_bound_pct}%</span> or more.</td></tr>
            <tr><td className="px-5 py-3">No false entry in {audit.false_entries.earlier_days} days.</td>
              <td className="py-3 pr-4">The true rate is <span className="num">{audit.false_entries.earlier_upper_bound_per_year.toFixed(1)}</span> per year or less.</td>
              <td className="py-3 pr-5"><span className="num">{audit.false_entries.now_count}</span> entry from noise in <span className="num">{fmt(audit.false_entries.now_years)}</span> years of replay. The true rate is <span className="num">{audit.false_entries.now_upper_bound_per_year}</span> per year or less.</td></tr>
            <tr><td className="px-5 py-3">The clear-time range held the real value in {audit.clear_time.earlier[0]} of {audit.clear_time.earlier[1]} checks.</td>
              <td className="py-3 pr-4">The checks come from {audit.clear_time.earlier_events} events, so the evidence is {audit.clear_time.earlier_events} samples.</td>
              <td className="py-3 pr-5"><span className="num">{pct(audit.clear_time.now_coverage_pct)}</span> on {audit.clear_time.now_stays} new shelter stays (95% range <span className="num">{range(audit.clear_time.now_ci)}</span>).</td></tr>
          </Table>
          <p className="px-5 pt-2 text-xs text-muted-foreground">The event label and the current rule use the same line (2 × background). The first row tests the 40-minute hold and the vote of 2 detectors. It does not test the line.</p>
        </Panel>

        <Panel title="Step 1. From proton flux to dose rate" aside={<Prov kind="estimate">Fitted model</Prov>} bodyClass="px-0 pb-3">
          <p className="max-w-3xl px-5 pb-3 text-sm leading-relaxed">A dosimeter saw few events. GOES saw 40 years of events. We fitted the dose rate of each detector as a sum of 4 proton energy bands, with data before 2020. Then GOES events can go through the response of a detector, with its measured noise. We call this a replay.</p>
          <Table head={['Detector', 'Period', 'Events', 'Event hours within 2 ×', 'Event dose within 2 ×', 'Median error']}>
            {transfer.detectors.flatMap((d) => ([['Fit, before 2020', d.fit_period], ['Test, 2020 to 2026', d.test_2020_on]] as const).filter(([, f]) => f).map(([period, f]) => (
              <tr key={d.id + period}>
                <td className="px-5 py-2.5 font-medium">{d.label}</td>
                <td className="py-2.5 pr-4">{period}</td>
                <td className="num py-2.5 pr-4">{f!.events}</td>
                <td className="num py-2.5 pr-4">{pct(100 * f!.hourly_within_factor_2)}</td>
                <td className="num py-2.5 pr-4">{pct(100 * f!.event_dose_within_factor_2)}</td>
                <td className="num py-2.5 pr-5">{signed(100 * (10 ** f!.hourly_log10_error_p16_p50_p84[1] - 1))}%</td>
              </tr>
            )))}
          </Table>
          <p className="px-5 pt-2 text-xs leading-relaxed text-muted-foreground">RAD has 3 cruise events and no cruise data after 2012. Its check leaves 1 event out of the fit in turn: the modeled event dose was {transfer.detectors.find((d) => d.id === 'rad_cruise')!.leave_one_event_out!.map((e) => e.modeled_over_measured_dose.toFixed(2)).join(', ')} times the measured dose. The spacecraft was not at Earth, so GOES and RAD did not see the same flux.</p>
        </Panel>

        <OnsetPanel />
        <OutlookPanel />

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="What the results mean">
            <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed">
              <li>Keep the current entry rule. It avoids 70% to 74% of the event dose, and the shelter can save 75% at most. No other rule was better on all 3 test sets. The largest gain was 1 point.</li>
              <li>A lower line (1.25 × background) adds 1 to 4 points of avoided dose. It costs 50% to 80% more shelter hours and about 4 times the entries.</li>
              <li>The shelter factor has more effect than the entry rule. Better shielding moves the 75% limit. A better rule moves 1 point.</li>
              <li>The clear-time range of the app is honest on new events: about 90% of the real values are in the range. The earlier figure of 98% was too high.</li>
              <li>The new model gives an estimate from the first hour of a stay. The range stays wide: about 3 times the time left. The clear time of a solar event is hard to predict.</li>
            </ul>
          </Panel>
          <Panel title="Limits of this study">
            <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed">
              <li>The replay is a model. On new data it reads 15% to 20% low, and RAD has 3 cruise events for its fit.</li>
              <li>The test period has 4 RAD events and 5 replay events of 2 × background or more. The 95% ranges are wide for these sets.</li>
              <li>CRaTER is in lunar orbit and RAD is on Mars. A cabin on a Mars transit has different shielding.</li>
              <li>Dose counts only in events of 2 × background or more. Small rises are not in the score.</li>
              <li>The narrow ranges of the new model are too narrow. The 50% range held <span className="num">{whole(boosted.coverage_at_50!)}%</span> of the real values and the 80% range held <span className="num">{whole(boosted.coverage_at_80!)}%</span>. The 90% range passed.</li>
            </ul>
          </Panel>
        </div>
        <p className="text-xs text-muted-foreground">Code, method, and all numbers: <span className="font-mono">research/frontier/RESULTS.md</span>.</p>
      </div>
    </>
  );
}
