import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Check, CornerDownRight, LogOut, HeartPulse, Wind, ShieldCheck, Timer } from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, ReferenceLine, ReferenceArea, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import rules from '../../data/rules.json';
import mission from '../../data/mission.json';
import { RULES, LINK_LABEL, LINK_DELAY_MIN, LEVEL_RANK, PROCEDURE_SH1, actionSentence, type Alert, type World } from '../../engine/world';
import { SENSORS } from '../../engine/doseModel';
import { REPLAY, REPLAY_PROVENANCE } from '../../engine/donki';
import { at, dayOf, hhmm, stamp, duration, minuteOfDay, MIN_PER_DAY } from '../../engine/time';
import { fmt } from '../../engine/units';
import { vehicleAt, earthAt, marsAt, R_EARTH, R_MARS, TRANSIT_DAYS } from '../../engine/orbit';
import { cabinAt, CABIN } from '../../engine/cabin';
import { warningForecast } from '../../engine/forecast';
import { useUi } from '../context';
import { LevelBadge, LevelIcon, LEVEL_WORD, Panel, Prov, Src, Spark, Kv } from '../parts';

const TH = rules.thresholds;
const TM = rules.timing;

export function NowView() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Decision />
        <DoseChart />
      </div>
      <div className="min-w-0 space-y-4">
        <RateTile />
        <Exposure />
        <CabinTile />
      </div>
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <div className="grid gap-4 lg:grid-cols-2">
          <SolarEvents />
          <Situation />
        </div>
        <Timeline />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- decision

function whyLine(a: Alert, w: World): string {
  const x = w.current.mean / w.current.B;
  if (a.level === 'warning') return `The cabin dose rate is ${fmt(x, 1)} times your cruise baseline, on 2 or more sensors.`;
  if (a.level === 'caution') {
    if (x >= TH.cautionMultiple.x) return `The cabin dose rate is ${fmt(x, 1)} times your cruise baseline.`;
    return `A large solar event is likely. The dose rate at the vehicle is normal now. Safe the task by ${hhmm(a.changedAt + 30)}.`;
  }
  if (a.level === 'verify') return a.reason.endsWith('.') ? a.reason : `${a.reason}.`;
  return 'Solar activity near Earth. The dose rate at the vehicle is normal.';
}

function tellLine(a: Alert, w: World): string {
  const delay = LINK_DELAY_MIN[w.link];
  const ground = delay === null ? 'The ground gets a summary when the link returns.' : `The ground gets a summary on the link (${LINK_LABEL[w.link].toLowerCase()}).`;
  if (a.level === 'warning') return `Tell the crew on the loop now. ${ground} Do not wait for the ground.`;
  if (a.level === 'caution') return `Tell the CMO when you stage the shelter. ${ground}`;
  if (a.level === 'verify') return 'Tell the CMO if the sensor stays poor after your check.';
  return 'At the daily review.';
}

function qualityLine(a: Alert, w: World): string {
  const q = w.current.quality;
  const good = q.filter((x) => x === 'good').length;
  if (a.quality === 'good') return `Good. ${good} of ${q.length} sensors agree.`;
  if (a.quality === 'poor') return `Poor on ${q.length - good} sensor. ${good} of ${q.length} agree.`;
  return `Missing data on ${q.filter((x) => x === 'missing').length} sensor. ${good} of ${q.length} agree.`;
}

const HERO: Record<string, string> = {
  warning: 'bg-warning text-white',
  caution: 'bg-[linear-gradient(135deg,color-mix(in_oklch,var(--caution)_92%,white),var(--caution))] text-[oklch(0.2_0.04_70)]',
  verify: 'bg-card',
  advisory: 'bg-card',
  nominal: 'bg-card',
};

function Decision() {
  const { sim, openProcedure, procOpen, setProcOpen, openSource, note } = useUi();
  const w = sim.world;
  const shown = w.activeAlerts.filter((a) => !a.suppressed);
  const suppressed = w.activeAlerts.filter((a) => a.suppressed);
  const main = shown[0];
  const level = main?.level ?? 'nominal';
  const loud = level === 'warning' || level === 'caution';
  const showProc = procOpen && !!w.procedure;
  const clear = w.warningClearProgress();

  return (
    <section aria-labelledby="dec-h" aria-live="assertive" className="overflow-hidden rounded-3xl bg-card ring-hairline">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={level} initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }}
          className={cn('relative p-5 md:p-7', HERO[level])}>
          {loud && <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-white/15 blur-3xl" />}
          <div className="relative flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-semibold',
              loud ? 'bg-black/12 dark:bg-black/20' : (level as string) === 'nominal' ? 'bg-nominal/12 text-nominal' : level === 'verify' ? 'bg-verify/12 text-verify' : 'bg-advisory/12 text-advisory')}>
              <span className={cn('grid size-4 place-items-center rounded-full', level === 'warning' && 'pulse-ring')}><LevelIcon level={level} className="size-4" /></span>
              {LEVEL_WORD[level]}
            </span>
            {main && <span className="font-medium">{RULES[main.ruleId].title}</span>}
            <span className={cn('num ml-auto text-xs', loud ? 'opacity-80' : 'text-muted-foreground')}>
              {main ? <>{main.id} · since {hhmm(main.changedAt)}{main.acked ? ' · acknowledged' : ''}</> : <>Checked {hhmm(w.t)}</>}
            </span>
          </div>
          <h2 id="dec-h" className="relative mt-4 text-[32px] leading-[1.05] font-semibold tracking-tight text-balance md:text-5xl">
            {main ? actionSentence(main, w) : w.inShelter ? 'The Warning is clear.' : 'Dose rate normal. No action.'}
          </h2>
          <p className={cn('relative mt-3 max-w-2xl text-[15px] md:text-base', loud ? 'opacity-90' : 'text-muted-foreground')}>
            {main ? whyLine(main, w) : <>Cabin mean <span className="num font-medium text-foreground">{fmt(w.current.mean, 3)} mSv/h</span>, <span className="num">{fmt(w.current.mean / w.B, 2)} ×</span> the baseline <Src k="B"><span className="num">B</span></Src>. The rules check all {SENSORS.length} sensors each minute.</>}
          </p>
          {clear && w.inShelter && (
            <div className="relative mt-4 max-w-md">
              <div className="flex justify-between text-xs opacity-90"><span>Clear rule: all sensors below {TH.cautionMultiple.label} for {TM.warningClearMin} min</span><span className="num">{duration(clear.have)} / {duration(clear.need)}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/15" role="progressbar" aria-label="Clear rule progress" aria-valuemin={0} aria-valuemax={clear.need} aria-valuenow={clear.have}>
                <motion.div className="h-full rounded-full bg-white" animate={{ width: `${(clear.have / clear.need) * 100}%` }} transition={{ duration: 0.3 }} />
              </div>
              {clear.have === 0 && <ClearEstimate w={w} />}
            </div>
          )}
          <div className="relative mt-6 flex flex-wrap items-center gap-2">
            {main && loud && !showProc && (
              <Button size="lg" onClick={() => { sim.act({ type: 'procStart', alertId: main.id }); openProcedure(); note(`Procedure SH-1 opened from ${main.id}`); }}
                className={cn('h-14 rounded-2xl px-6 text-base font-semibold shadow-lg', level === 'warning' ? 'bg-white text-warning hover:bg-white/90' : 'bg-[oklch(0.2_0.04_70)] text-white hover:bg-[oklch(0.28_0.04_70)]')}>
                {w.procedure ? 'Open procedure SH-1' : 'Start procedure SH-1'}<ArrowRight className="size-5" aria-hidden="true" />
              </Button>
            )}
            {!main && w.inShelter && (
              <Button size="lg" className="h-14 rounded-2xl px-6 text-base" onClick={() => { sim.act({ type: 'shelterExit' }); setProcOpen(false); note('Left the shelter'); }}>
                <LogOut className="size-5" aria-hidden="true" />Leave the shelter
              </Button>
            )}
            {showProc && <Button variant="secondary" className="h-12 rounded-xl" onClick={() => setProcOpen(false)}>Show alert details</Button>}
            {main && (
              <Button variant="ghost" className={cn('ml-auto h-11 rounded-xl', loud && 'hover:bg-black/10')} onClick={() => openSource(main.ruleId)}>
                Why this alert: rule <span className="font-mono">{main.ruleId}</span>
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {main && (showProc ? <Procedure /> : (
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {[
            ['What changed?', `${main.reason.replace(/\.$/, '')}.`],
            ['How reliable is the data?', qualityLine(main, w)],
            ['Why does it matter?', main.level === 'warning'
              ? <>Unsheltered, the next 24 h give about <Src k="projection24h"><span className="num">{fmt(w.projection24h(), 0)} mSv</span></Src> (estimate). The shelter cuts the event dose. NASA asks for doses as low as reasonably achievable.</>
              : RULES[main.ruleId].basis],
            ['What do I do now?', w.inShelter && LEVEL_RANK[main.level] >= LEVEL_RANK.caution ? 'Stay in the shelter. Finish procedure SH-1. Leave when the Warning clears.' : RULES[main.ruleId].action],
            ['When do I tell the CMO or the ground?', tellLine(main, w)],
            ['Data', <>Rule <Src k={main.ruleId}><span className="font-mono">{main.ruleId}</span></Src> · data {main.quality} · {main.donkiRefs.length ? `${main.donkiRefs.length} solar records` : 'onboard sensors'} · dose from <Src k="speModel">measured RAD data</Src></>],
          ].map(([q, a], i) => (
            <div key={i} className="bg-card px-5 py-3.5">
              <div className="text-xs font-medium text-muted-foreground">{q}</div>
              <div className="mt-1 text-sm leading-relaxed">{a}</div>
            </div>
          ))}
        </div>
      ))}

      {main && (
        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <span className="mr-1 text-xs text-muted-foreground">Alert controls</span>
          <Button size="sm" variant="outline" className="rounded-lg" disabled={main.acked} onClick={() => { sim.act({ type: 'ack', alertId: main.id }); note(`${main.id} acknowledged`); }}>
            {main.acked ? <><Check className="size-4" aria-hidden="true" />Acknowledged</> : 'Acknowledge'}
          </Button>
          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => { sim.act({ type: 'suppress', alertId: main.id }); note(`${main.id} suppressed. It stays in the log and the counts.`); }}>Suppress</Button>
          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => { const inh = w.inhibited.has(main.ruleId); sim.act({ type: inh ? 'enable' : 'inhibit', ruleId: main.ruleId }); note(`Rule ${main.ruleId} ${inh ? 'enabled' : 'inhibited'}`); }}>
            {w.inhibited.has(main.ruleId) ? `Enable ${main.ruleId}` : `Inhibit ${main.ruleId}`}
          </Button>
        </div>
      )}
      {(shown.length > 1 || suppressed.length > 0) && (
        <div className="space-y-2 border-t bg-muted/40 px-5 py-3">
          {shown.slice(1).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <LevelBadge level={a.level} /><span className="min-w-0 flex-1">{a.reason.replace(/\.$/, '')}. <span className="text-muted-foreground">{RULES[a.ruleId].action}</span></span>
              <Button size="sm" variant="outline" className="rounded-lg" disabled={a.acked} onClick={() => { sim.act({ type: 'ack', alertId: a.id }); note(`${a.id} acknowledged`); }}>{a.acked ? 'Acknowledged' : 'Acknowledge'}</Button>
            </div>
          ))}
          {suppressed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {suppressed.length} suppressed: {suppressed.map((a) => `${a.id} (${a.level})`).join(', ')}
              {suppressed.map((a) => <Button key={a.id} size="sm" variant="outline" className="rounded-lg" onClick={() => { sim.act({ type: 'unsuppress', alertId: a.id }); note(`${a.id} shown again`); }}>Show {a.id}</Button>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Clear-time estimate from the measured RAD events. It never changes the alert. */
function ClearEstimate({ w }: { w: World }) {
  const { go } = useUi();
  const f = warningForecast(w);
  return (
    <button type="button" onClick={() => go('ask')} className="mt-2 block text-left text-xs opacity-90 underline decoration-dotted underline-offset-4 hover:opacity-100">
      {f ? <>Estimate: clear between <span className="num">{stamp(f.earliest)}</span> and <span className="num">{stamp(f.latest)}</span>, from {f.analogs.length} measured events</>
        : 'Clear time: no estimate while the rate is near its peak'}
    </button>
  );
}

// ---------------------------------------------------------------- procedure SH-1, in place

function Procedure() {
  const { sim, setProcOpen, note } = useUi();
  const w = sim.world;
  const p = w.procedure!;
  const alert = p.alertId ? w.alerts.find((a) => a.id === p.alertId) : undefined;
  const confirmed = p.confirmed;
  const current = PROCEDURE_SH1.steps.find((s) => !confirmed[s.n]);
  const warnActive = w.activeAlerts.some((a) => a.level === 'warning');
  const startWall = alert?.levelWall ?? p.startedWall;
  const shelterWall = alert?.shelterWall;
  const [, tick] = useState(0);
  useEffect(() => {
    if (shelterWall) return;
    const id = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [shelterWall]);
  const elapsed = Math.max(0, ((shelterWall ?? Date.now()) - startWall) / 1000);
  const done = Object.keys(confirmed).length;

  return (
    <div className="border-t p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold"><span className="font-mono">{PROCEDURE_SH1.id}</span> {PROCEDURE_SH1.title}</h3>
        <span className="text-xs text-muted-foreground">Step {Math.min(done + 1, PROCEDURE_SH1.steps.length)} of {PROCEDURE_SH1.steps.length}</span>
        <span className="num ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm font-semibold" aria-label="Time since the alert">
          <Timer className="size-4" aria-hidden="true" />{shelterWall ? 'In shelter after ' : ''}{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
        </span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-primary" animate={{ width: `${(done / PROCEDURE_SH1.steps.length) * 100}%` }} /></div>
      <ol className="mt-4 space-y-2">
        {PROCEDURE_SH1.steps.map((s) => {
          const c = confirmed[s.n];
          const isCur = current?.n === s.n;
          const blocked = s.waitsForClear && warnActive;
          return (
            <motion.li layout key={s.n} aria-current={isCur ? 'step' : undefined}
              className={cn('flex flex-wrap items-center gap-3 rounded-2xl p-3 transition-colors', isCur ? 'bg-accent ring-2 ring-primary/40' : c ? 'opacity-70' : 'opacity-60')}>
              <span className={cn('num grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold', c ? 'bg-nominal text-white' : isCur ? 'bg-primary text-primary-foreground' : 'bg-muted')} aria-hidden="true">
                {c ? <Check className="size-4" /> : s.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-[15px]', isCur && 'text-lg font-semibold')}><span className="sr-only">Step {s.n}. </span>{s.text}</div>
                {c && <div className="num text-xs text-muted-foreground">Done at {hhmm(c.t)}{c.choice === 'branch' ? ' · vest not found, CMO told' : ''}</div>}
                {isCur && s.waitsForClear && (
                  <div className="text-sm text-muted-foreground">
                    {blocked ? `The Warning is active. It clears when all sensors stay below ${fmt(TH.cautionMultiple.x * w.B, 3)} mSv/h for ${TM.warningClearMin} min.` : 'The Warning is clear. You can leave the shelter.'}
                    {w.inShelter && w.shelterIntervals.length > 0 && <> In the shelter for {duration(w.t - w.shelterIntervals[w.shelterIntervals.length - 1].start)}.</>}
                  </div>
                )}
              </div>
              {isCur && (
                <div className="flex w-full gap-2 sm:w-auto">
                  {s.branch && <Button variant="outline" className="h-12 flex-1 rounded-xl sm:flex-none" onClick={() => { sim.act({ type: 'procStep', step: s.n, choice: 'branch' }); note(`SH-1 step ${s.n}: ${s.branch!.label}`); }}><CornerDownRight className="size-4" aria-hidden="true" />{s.branch.label}</Button>}
                  {s.waitsForClear ? (
                    <Button className="h-12 flex-1 rounded-xl px-6 text-base sm:flex-none" disabled={blocked} onClick={() => { sim.act({ type: 'procStep', step: s.n }); sim.act({ type: 'shelterExit' }); setProcOpen(false); note('SH-1 done. Left the shelter'); }}>
                      <LogOut className="size-4" aria-hidden="true" />{blocked ? 'Wait for clear' : 'Leave the shelter'}
                    </Button>
                  ) : (
                    <Button className="h-12 flex-1 rounded-xl px-6 text-base sm:flex-none" onClick={() => { sim.act({ type: 'procStep', step: s.n }); note(`SH-1 step ${s.n} done: ${s.text}`); }}>
                      <Check className="size-5" aria-hidden="true" />Done
                    </Button>
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">{PROCEDURE_SH1.note}{w.m1Seconds.length > 0 && <> · Warning to shelter: <b className="num text-foreground">{Math.round(w.m1Seconds[w.m1Seconds.length - 1])} s</b> (metric M-1 target: median 60 s or less)</>}</p>
    </div>
  );
}

// ---------------------------------------------------------------- dose rate tile

function RateTile() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const x = s.personal / s.B;
  const tone = s.mean >= TH.warningMultiple.x * s.B ? 'text-warning' : s.mean >= TH.cautionMultiple.x * s.B ? 'text-caution-ink' : 'text-foreground';
  const spark = useMemo(() => {
    const h = w.history.filter((p) => p.t > w.t - 8 * 60);
    const step = Math.max(1, Math.floor(h.length / 60));
    return h.filter((_, i) => i % step === 0).map((p) => p.personal);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(w.t / 5)]);
  return (
    <Panel title="Your dose rate" aside={<><Prov kind="measured">RAD event data</Prov></>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={cn('num text-5xl font-semibold tracking-tight', tone)}>{fmt(s.personal, s.personal < 1 ? 3 : 2)}<span className="ml-1.5 text-base font-medium text-muted-foreground">mSv/h</span></div>
          <div className="num mt-1 text-sm text-muted-foreground">{fmt(x, 2)} × cruise baseline{w.inShelter && <span className="ml-1.5 inline-flex items-center gap-1 text-nominal"><ShieldCheck className="size-3.5" aria-hidden="true" />in shelter</span>}</div>
        </div>
        <Spark values={spark} label="Your dose rate, last 8 hours" className="h-12 w-36" stroke={tone === 'text-warning' ? 'var(--warning)' : 'var(--chart-1)'} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ['Baseline B', fmt(s.B, 4), 'B'],
          ['Caution', fmt(TH.cautionMultiple.x * s.B, 3), 'cautionMultiple'],
          ['Warning', fmt(TH.warningMultiple.x * s.B, 3), 'warningMultiple'],
        ].map(([k, v, src]) => (
          <div key={k} className="rounded-xl bg-muted/60 px-2 py-2">
            <div className="text-muted-foreground">{k}</div>
            <Src k={src} className="num text-sm font-semibold">{v}</Src>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- exposure budget

function Exposure() {
  const { sim } = useUi();
  const w = sim.world;
  const limit = rules.limits.career.mSv;
  const career = w.careerDoseMSv;
  const end = w.projectedEndMSv();
  const cross = w.crossingDay();
  const ev = w.openAlert('radiation');
  const lastSaved = [...w.alerts].reverse().find((a) => a.kind === 'radiation' && a.shelterMin > 0);
  const max = Math.max(1100, end * 1.05);
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <Panel title="Exposure" aside={<Prov kind="estimate" />}>
      <Kv rows={[
        ...(ev && ev.eventDoseMSv > 0.05 ? [[<>This event so far</>, <>{fmt(ev.eventDoseMSv, 1)} mSv</>] as [React.ReactNode, React.ReactNode]] : []),
        ['Next 24 h, unsheltered', <Src k="projection24h">{fmt(w.projection24h(), 1)} mSv</Src>],
        ['Mission so far', `${fmt(w.missionDoseMSv, 1)} mSv`],
        ['Career used', <>{fmt(career, 1)} / <Src k="career">{limit}</Src> mSv</>],
        ['At mission end (day 860)', `~${Math.round(end).toLocaleString('en-US')} mSv`],
      ]} />
      <div className="mt-3">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Career dose ${Math.round(career)} mSv now. Projected ${Math.round(end)} mSv. NASA limit ${limit} mSv.`}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-[repeating-linear-gradient(135deg,var(--chart-3)_0_3px,transparent_3px_6px)] opacity-50" style={{ width: pct(end) }} />
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-primary" animate={{ width: pct(career) }} />
          <div className="absolute inset-y-[-2px] w-0.5 bg-foreground" style={{ left: pct(limit) }} />
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(limit) }}>{limit} NASA</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(rules.limits.intlCareer.mSv) }}><Src k="intlCareer">{rules.limits.intlCareer.mSv}</Src></span>
        </div>
      </div>
      {end > limit && <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed"><b>Waiver case, not an alert.</b> The GCR projection passes {limit} mSv on day <span className="num">{cross}</span>. A Mars crew passes this limit by design.</p>}
      {lastSaved && <p className="mt-2 rounded-xl bg-nominal/10 p-3 text-xs leading-relaxed text-foreground">The shelter saved about <b className="num">{fmt(lastSaved.savedMSv, 1)} mSv</b> in {lastSaved.id} (<Src k="shelterFactor">estimate</Src>).</p>}
    </Panel>
  );
}

// ---------------------------------------------------------------- cabin summary tile

function CabinTile() {
  const { sim, go } = useUi();
  const w = sim.world;
  const shelterMin = w.inShelter && w.shelterIntervals.length ? w.t - w.shelterIntervals[w.shelterIntervals.length - 1].start : 0;
  const r = cabinAt(w.t, shelterMin);
  const hi = r.co2mmHg > CABIN.limits.co2HourMmHg.max;
  return (
    <button onClick={() => go('cabin')} className="group block w-full rounded-2xl bg-card p-5 text-left ring-hairline transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center gap-2 text-[15px] font-semibold"><Wind className="size-4 text-muted-foreground" aria-hidden="true" />Cabin air<span className="ml-auto"><Prov kind="simulated" /></span></div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div><div className="text-xs text-muted-foreground">CO2, 1 h</div><div className={cn('num text-xl font-semibold', hi && 'text-caution-ink')}>{r.co2mmHg.toFixed(1)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">mmHg</span></div></div>
        <div><div className="text-xs text-muted-foreground">Temp</div><div className="num text-xl font-semibold">{r.tempC.toFixed(1)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">°C</span></div></div>
        <div><div className="text-xs text-muted-foreground">Humidity</div><div className="num text-xl font-semibold">{r.rhPct.toFixed(0)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">%</span></div></div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
        {hi ? 'CO2 is above the NASA 1-hour limit of 3 mmHg.' : 'Limits from NASA-STD-3001 Vol 2.'}<ArrowRight className="ml-auto size-3.5" aria-hidden="true" />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------- dose chart

const WINDOWS = [{ h: 8, label: '8 h' }, { h: 24, label: '24 h' }, { h: 72, label: '3 d' }] as const;

function DoseChart() {
  const { sim } = useUi();
  const w = sim.world;
  const [span, setSpan] = useState<number>(24);
  const bucket = Math.floor(w.t / (span <= 8 ? 2 : span <= 24 ? 5 : 15));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildSeries(w, span), [bucket, span, w.inShelter]);
  return (
    <Panel title="Cabin dose rate" aside={<>
      <Prov kind="measured">Event: MSL RAD, Mar 2012</Prov>
      <div role="radiogroup" aria-label="Chart window" className="flex rounded-lg bg-muted p-0.5">
        {WINDOWS.map((o) => (
          <button key={o.h} role="radio" aria-checked={span === o.h} onClick={() => setSpan(o.h)} className={cn('h-7 rounded-md px-2.5 text-xs font-medium', span === o.h ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground')}>{o.label}</button>
        ))}
      </div>
    </>}>
      <DoseChartBody data={data} B={w.B} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-[var(--chart-1)]" />Cabin mean</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded border-t-2 border-dashed border-[var(--chart-2)]" />Your dosimeter</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-caution" /><Src k="cautionMultiple">Caution {TH.cautionMultiple.label}</Src></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded bg-warning" /><Src k="warningMultiple">Warning {TH.warningMultiple.label}</Src></span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 rounded border-t border-dashed border-muted-foreground" />Old rule 10 × B</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-3 w-4 rounded-sm bg-nominal/15" />In shelter</span>
      </div>
      <SensorStrip />
    </Panel>
  );
}

interface Pt { t: number; mean: number; personal: number }
function buildSeries(w: World, spanH: number) {
  const t0 = w.t - spanH * 60;
  const h = w.history.filter((p) => p.t >= t0);
  const step = Math.max(1, Math.floor(h.length / 220));
  const pts: Pt[] = h.filter((_, i) => i % step === 0 || i === h.length - 1).map((p) => ({ t: p.t, mean: Math.max(p.mean, 0.01), personal: Math.max(p.personal, 0.01) }));
  const shelters = w.shelterIntervals.filter((iv) => (iv.end ?? w.t) > t0).map((iv) => ({ a: Math.max(iv.start, t0), b: iv.end ?? w.t }));
  return { pts, shelters, t0, t1: w.t };
}

const DoseChartBody = memo(function DoseChartBody({ data, B }: { data: ReturnType<typeof buildSeries>; B: number }) {
  const ticks: number[] = [];
  const spanH = (data.t1 - data.t0) / 60;
  const stepMin = spanH <= 8 ? 120 : spanH <= 24 ? 360 : 720;
  for (let t = Math.ceil(data.t0 / stepMin) * stepMin; t <= data.t1; t += stepMin) ticks.push(t);
  const maxV = Math.max(...data.pts.map((p) => p.mean), 10 * B * 1.2);
  return (
    <div className="h-64 w-full md:h-72" role="img" aria-label={`Cabin dose rate chart. Now ${fmt(data.pts[data.pts.length - 1]?.mean ?? 0, 3)} mSv/h.`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.pts} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="meanFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {data.shelters.map((s, i) => <ReferenceArea key={i} x1={s.a} x2={s.b} fill="var(--nominal)" fillOpacity={0.12} stroke="none" ifOverflow="hidden" />)}
          <XAxis dataKey="t" type="number" domain={[data.t0, data.t1]} ticks={ticks} tickFormatter={(t) => (spanH > 24 ? `D${dayOf(t)} ${hhmm(t)}` : hhmm(t))} tickLine={false} axisLine={false} />
          <YAxis scale="log" domain={[0.03, Math.max(3, maxV * 1.3)]} ticks={[0.03, 0.1, 0.3, 1, 3]} allowDataOverflow tickFormatter={(v) => String(v)} tickLine={false} axisLine={false} width={44} />
          <ReferenceLine y={10 * B} stroke="var(--muted-foreground)" strokeDasharray="2 4" strokeOpacity={0.6} />
          <ReferenceLine y={TH.warningMultiple.x * B} stroke="var(--warning)" strokeWidth={1.5} />
          <ReferenceLine y={TH.cautionMultiple.x * B} stroke="var(--caution)" strokeWidth={1.5} />
          <RTooltip
            isAnimationActive={false}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--popover-foreground)' }}
            labelFormatter={(t) => stamp(Number(t))}
            formatter={(v, n) => [`${fmt(Number(v), 3)} mSv/h`, n === 'mean' ? 'Cabin mean' : 'Your dosimeter']}
          />
          <Area type="monotone" dataKey="mean" stroke="var(--chart-1)" strokeWidth={2} fill="url(#meanFill)" isAnimationActive={false} dot={false} />
          <Line type="monotone" dataKey="personal" stroke="var(--chart-2)" strokeWidth={1.75} strokeDasharray="4 3" isAnimationActive={false} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

function SensorStrip() {
  const { sim } = useUi();
  const w = sim.world;
  const s = w.current;
  const tone = (v: number | null) => (v === null ? '' : v >= TH.warningMultiple.x * s.B ? 'bg-warning/12 ring-warning/30' : v >= TH.cautionMultiple.x * s.B ? 'bg-caution/15 ring-caution/40' : 'bg-muted/50 ring-border');
  const cells = [
    ...SENSORS.map((sn, i) => ({ id: sn.id, label: sn.label, v: s.cabin[i], q: s.quality[i] as string })),
    { id: mission.dosimeter.id, label: w.inShelter ? 'You, in shelter' : 'Your dosimeter', v: s.personal, q: 'personal' },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {cells.map((c) => (
        <div key={c.id} className={cn('rounded-xl p-2.5 ring-1 ring-inset', tone(c.v))}>
          <div className="flex items-center justify-between text-[11px]"><span className="font-mono font-medium">{c.id}</span>
            <span className={cn(c.q === 'good' ? 'text-nominal' : c.q === 'poor' ? 'text-verify' : c.q === 'missing' ? 'text-muted-foreground' : 'text-advisory')}>{c.q === 'good' ? 'Good' : c.q === 'poor' ? 'Poor' : c.q === 'missing' ? 'No data' : 'Personal'}</span>
          </div>
          <div className="num mt-1 text-base font-semibold">{c.v === null ? '- -' : fmt(c.v, 3)}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.label}{c.v !== null && <span className="num"> · {fmt(c.v / s.B, 1)}×</span>}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- solar events

function SolarEvents() {
  const { sim, openSource } = useUi();
  const w = sim.world;
  const seen = REPLAY.filter((r) => r.t <= w.t && w.t - r.t < 4 * MIN_PER_DAY).reverse();
  const KIND: Record<string, string> = { FLR: 'bg-caution/20 text-caution-ink', CME: 'bg-advisory/15 text-advisory', SEP: 'bg-warning/12 text-warning' };
  return (
    <Panel title="Solar events" aside={<><Prov kind="measured">Real, March 2012</Prov><button className="underline decoration-dotted underline-offset-4" onClick={() => openSource('goesFlares')}>Source</button></>}>
      <p className="mb-3 text-xs text-muted-foreground">Events near Earth. They can give an Advisory or a Caution. Only the onboard sensors give a Warning.</p>
      {seen.length === 0 ? <p className="text-sm text-muted-foreground">No solar events in the last 4 days.</p> : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {seen.map((r) => (
              <motion.li key={r.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
                <span className={cn('mt-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold', KIND[r.kind])}>{r.kind}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.summary}{r.kind === 'SEP' && r.tEnd && w.t < r.tEnd ? <LevelBadge level="caution" className="ml-2 h-5">Active</LevelBadge> : null}</div>
                  <div className="num text-xs text-muted-foreground">{stamp(r.t)} · {r.id.replace(/-(\d{4})-/, ' $1-').replace('T', ' ')} UTC</div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">{REPLAY_PROVENANCE}</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- situation drawing

function Situation() {
  const { sim } = useUi();
  const w = sim.world;
  const day = w.t / MIN_PER_DAY;
  const warn = w.activeAlerts.some((a) => a.level === 'warning');
  const sepActive = REPLAY.some((r) => r.kind === 'SEP' && r.t <= w.t && (r.tEnd ?? Infinity) > w.t);
  const caution = w.activeAlerts.some((a) => a.level === 'caution');
  const storm = warn ? 'hit' : sepActive || caution ? 'watch' : 'none';
  const S = 300, c = S / 2, k = (S / 2 - 22) / R_MARS;
  const P = (v: { x: number; y: number }) => ({ x: c + v.x * k, y: c - v.y * k });
  const v = P(vehicleAt(day)), e = P(earthAt(day)), m = P(marsAt(day));
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let d = 0; d <= TRANSIT_DAYS; d += 3) { const p = P(vehicleAt(d)); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
    return pts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const doneN = Math.min(path.length, Math.floor(day / 3) + 1);
  const ang = Math.atan2(v.y - c, v.x - c);
  const spread = 0.32, reach = Math.hypot(v.x - c, v.y - c) * 1.25;
  const cone = `${c},${c} ${c + reach * Math.cos(ang - spread)},${c + reach * Math.sin(ang - spread)} ${c + reach * Math.cos(ang + spread)},${c + reach * Math.sin(ang + spread)}`;
  const delay = LINK_DELAY_MIN[w.link];
  return (
    <Panel title="Where you are" aside={storm === 'hit' ? <LevelBadge level="warning">Protons at the vehicle</LevelBadge> : storm === 'watch' ? <LevelBadge level="caution">Solar event</LevelBadge> : <span className="num">Day {Math.floor(day)} of {TRANSIT_DAYS}</span>}>
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,240px)_1fr]">
        <svg viewBox={`0 0 ${S} ${S}`} className="w-full" role="img" aria-label={`Day ${Math.floor(day)} of a ${TRANSIT_DAYS}-day transit to Mars.`}>
          {storm !== 'none' && <polygon points={cone} fill={storm === 'hit' ? 'var(--warning)' : 'var(--caution)'} opacity={0.22} />}
          <circle cx={c} cy={c} r={R_EARTH * k} fill="none" stroke="var(--border)" />
          <circle cx={c} cy={c} r={R_MARS * k} fill="none" stroke="var(--border)" strokeDasharray="3 4" />
          <polyline points={path.join(' ')} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeDasharray="2 3" />
          <polyline points={path.slice(0, doneN).concat(`${v.x},${v.y}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={2} />
          <line x1={v.x} y1={v.y} x2={e.x} y2={e.y} stroke="var(--advisory)" strokeDasharray="4 4" />
          <circle cx={c} cy={c} r={10} fill="var(--caution)" />
          <circle cx={e.x} cy={e.y} r={6} fill="var(--advisory)" />
          <circle cx={m.x} cy={m.y} r={5} fill="var(--warning)" opacity={0.7} />
          <rect x={v.x - 5} y={v.y - 5} width={10} height={10} transform={`rotate(45 ${v.x} ${v.y})`} fill="var(--foreground)" />
          <text x={c} y={c + 26} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">Sun</text>
          <text x={e.x + 10} y={e.y + 4} fontSize={11} fill="var(--muted-foreground)">Earth</text>
          <text x={m.x - 10} y={m.y + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">Mars</text>
          <text x={v.x} y={v.y - 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--foreground)">You</text>
        </svg>
        <Kv rows={[
          ['Transit', `${Math.round((day / TRANSIT_DAYS) * 100)}%`],
          ['Link to Earth', LINK_LABEL[w.link]],
          ['Answer from Earth', delay === null ? 'None until the link returns' : `${2 * delay} min or more`],
        ]} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Dashed line: signal path to Earth. Simplified, coplanar orbits.</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- crew timeline (OSTPV style)

function Timeline() {
  const { sim, go } = useUi();
  const w = sim.world;
  const day = dayOf(w.t);
  const d0 = day * MIN_PER_DAY;
  const pct = (t: number) => `${(((t - d0) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((b - a) / MIN_PER_DAY) * 100).toFixed(3)}%`;
  const checkDone = w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === day);
  const warn = w.activeAlerts.find((a) => a.level === 'warning');
  const shelters = w.shelterIntervals
    .map((iv) => ({ s: Math.max(iv.start, d0), e: Math.min(iv.end ?? w.t, d0 + MIN_PER_DAY), open: iv.end === undefined }))
    .filter((x) => x.e > x.s || x.open);
  const planned = warn && !w.inShelter ? { s: w.t, e: Math.min(w.t + 360, d0 + MIN_PER_DAY) } : null;
  const KIND: Record<string, string> = {
    sleep: 'bg-muted text-muted-foreground', ops: 'bg-primary/10 text-foreground', exercise: 'bg-chart-2/20 text-foreground',
    off: 'bg-muted/60 text-muted-foreground', health: 'bg-nominal/15 text-foreground',
  };
  const now = minuteOfDay(w.t);
  return (
    <Panel title="Crew timeline" aside={<span className="num">Day {String(day).padStart(3, '0')}</span>}>
      <div className="scrollbar-none overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="relative ml-36 h-5 text-[11px] text-muted-foreground">
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} className="num absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}
          </div>
          <div className="relative space-y-1.5">
            {mission.crew.map((c) => (
              <div key={c.id} className="flex items-center">
                <div className={cn('w-36 shrink-0 truncate pr-3 text-sm', c.isUser ? 'font-semibold' : 'text-muted-foreground')}>{c.isUser ? 'You (Crew A)' : `${c.role}, ${c.name}`}</div>
                <div className={cn('relative flex-1', c.isUser ? 'h-10' : 'h-7')}>
                  {mission.schedule.map((b, i) => {
                    const s = at(day, b.start);
                    const e = b.end === '24:00' ? d0 + MIN_PER_DAY : at(day, b.end);
                    if (b.kind === 'health' && c.isUser) {
                      return (
                        <button key={i} type="button" onClick={() => go('checkin')} aria-label={`Daily health check, ${checkDone ? 'done' : 'open it'}`}
                          className={cn('absolute inset-y-0 grid place-items-center rounded-md ring-2 ring-nominal/50 transition hover:bg-nominal/30', checkDone ? 'bg-nominal text-white' : 'bg-nominal/15 text-nominal')}
                          style={{ left: pct(s), width: width(s, e) }}>
                          {checkDone ? <Check className="size-4" aria-hidden="true" /> : <HeartPulse className="size-4" aria-hidden="true" />}
                        </button>
                      );
                    }
                    return <div key={i} className={cn('absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-xs whitespace-nowrap', KIND[b.kind] ?? KIND.ops)} style={{ left: pct(s), width: width(s, e) }}>{c.isUser ? b.label : ''}</div>;
                  })}
                  {shelters.map((x, i) => <div key={`sh${i}`} className="absolute inset-y-0 flex items-center overflow-hidden rounded-md bg-warning/85 px-2 text-xs font-medium whitespace-nowrap text-white" style={{ left: pct(x.s), width: width(x.s, Math.max(x.e, x.s + 10)) }}>Shelter {duration(x.e - x.s)}</div>)}
                  {planned && <div className="absolute inset-y-0 flex items-center overflow-hidden rounded-md border-2 border-dashed border-warning px-2 text-xs font-medium whitespace-nowrap text-warning" style={{ left: pct(planned.s), width: width(planned.s, planned.e) }}>Shelter (plan)</div>}
                </div>
              </div>
            ))}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 ml-36 w-[calc(100%-9rem)]">
              <div className="absolute inset-y-[-4px] w-0.5 rounded bg-foreground" style={{ left: `${(now / MIN_PER_DAY) * 100}%` }}>
                <div className="absolute -top-1 -left-[3px] size-2 rounded-full bg-foreground" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
