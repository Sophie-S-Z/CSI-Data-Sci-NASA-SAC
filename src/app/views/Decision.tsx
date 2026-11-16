import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Check, CornerDownRight, LogOut, Square, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import rules from '../../data/rules.json';
import { RULES, LINK_LABEL, LINK_DELAY_MIN, LEVEL_RANK, PROCEDURE_SH1, actionSentence, type Alert, type World } from '../../engine/world';
import { SENSORS } from '../../engine/doseModel';
import { hhmm, duration } from '../../engine/time';
import { atMultiple, fmt, multipleOf } from '../../engine/units';
import { useUi } from '../context';
import { LevelBadge, LiveNum, LevelIcon, LEVEL_WORD, Src } from '../parts';
import { BodyEffects } from '../BodyEffects';

const TH = rules.thresholds;
const TM = rules.timing;

function whyLine(a: Alert, w: World): string {
  const x = multipleOf(w.current.mean, w.current.B);
  if (a.level === 'warning') return `The cabin dose rate is ${fmt(x)} times your cruise baseline, on 2 or more sensors.`;
  if (a.level === 'caution') {
    if (a.peak === 'warning') return `The Warning cleared at ${hhmm(a.changedAt)}. The solar proton event goes on, so the Caution stays.`;
    if (x >= TH.cautionMultiple.x) return `The cabin dose rate is ${fmt(x)} times your cruise baseline.`;
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
  // The sensors follow 2 RAD detectors (E and B). The sensor layout itself is simulated.
  // The text does not change on a filled RAD bin: it changes each 15 min, and a changing line moves the whole panel.
  // The Cabin radiation chart marks the filled bins with a dotted line.
  const agree = `${good} of ${q.length} sensors agree, on 2 RAD detectors.`;
  if (a.quality === 'good') return `Good. ${agree}`;
  const n = q.filter((x) => x === (a.quality === 'poor' ? 'poor' : 'missing')).length;
  const sensors = `${n} sensor${n === 1 ? '' : 's'}`;
  return `${a.quality === 'poor' ? 'Poor on' : 'Missing data on'} ${sensors}. ${agree}`;
}

const HERO: Record<string, string> = {
  warning: 'bg-warning text-white',
  caution: 'bg-caution text-caution-foreground',
  verify: 'bg-card',
  advisory: 'bg-card',
  nominal: 'bg-card',
};

/**
 * The alert panel: one level word, one action sentence, one button.
 * The headline uses all open alerts. A suppressed Caution still shows here (beta report S-1).
 */
export function Decision() {
  const { sim, openProcedure, procOpen, setProcOpen, openSource, note } = useUi();
  const w = sim.world;
  const active = w.activeAlerts;
  const main = active[0];
  const level = main?.level ?? 'nominal';
  const loud = level === 'warning' || level === 'caution';
  const showProc = procOpen && !!w.procedure;
  const clear = w.warningClearProgress();
  const storm = w.openAlert('radiation');
  const say = main ? `${LEVEL_WORD[level]}. ${actionSentence(main, w)}` : 'Nominal. No action.';

  return (
    <section aria-labelledby="dec-h" className="overflow-hidden rounded-xl border bg-card">
      {/* Screen readers hear a level change only, not each minute of the replay (beta report U-2). */}
      <p className="sr-only" aria-live="assertive">{say}</p>
      <div className={cn('p-5 md:p-6', HERO[level])}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn('inline-flex h-7 items-center gap-1.5 rounded px-2.5 font-semibold uppercase tracking-wide',
            loud ? 'bg-black/15' : (level as string) === 'nominal' ? 'bg-nominal/12 text-nominal' : level === 'verify' ? 'bg-verify/12 text-verify' : 'bg-advisory/12 text-advisory')}>
            <span className={cn('grid size-4 place-items-center rounded-full', level === 'warning' && 'pulse-ring')}><LevelIcon level={level} className="size-4" /></span>
            {LEVEL_WORD[level]}
          </span>
          {main && <span className="font-medium">{RULES[main.ruleId].title}</span>}
          <span className={cn('num ml-auto text-xs', !loud && 'text-muted-foreground')}>
            {main ? <>{main.id} · since {hhmm(main.changedAt)}{main.acked ? ' · acknowledged' : ''}</> : <>Checked {hhmm(w.t)}</>}
          </span>
        </div>
        <h2 id="dec-h" className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance md:text-4xl">
          {main ? actionSentence(main, w) : w.inShelter ? 'All clear. You can leave the shelter.' : 'Dose rate normal. No action.'}
        </h2>
        <p className={cn('mt-2 max-w-2xl text-[15px]', loud ? 'opacity-90' : 'text-muted-foreground')}>
          {main ? whyLine(main, w) : <>Cabin mean <span className="font-medium text-foreground"><LiveNum value={w.current.mean} /> mSv/h</span>, <LiveNum value={multipleOf(w.current.mean, w.B)} /> × the baseline <Src k="B"><span className="num">B</span></Src>. The rules check all {SENSORS.length} sensors each minute.</>}
        </p>
        {clear && w.inShelter && (
          <div className="mt-4 max-w-md">
            <div className="flex justify-between gap-2 text-xs opacity-90"><span>Clear rule: all sensors below {TH.cautionMultiple.label} for {TM.warningClearMin} min</span><span className="num">{duration(clear.have)} / {duration(clear.need)}</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/20" role="progressbar" aria-label="Clear rule progress" aria-valuemin={0} aria-valuemax={clear.need} aria-valuenow={clear.have}>
              <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${(clear.have / clear.need) * 100}%` }} />
            </div>
            {clear.have === 0 && <ClearEstimate />}
          </div>
        )}
        {(main || w.inShelter) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {main && loud && !showProc && (main.peak !== 'warning' || main.level === 'warning' || w.procedure) && (
              <Button size="lg" onClick={() => { sim.act({ type: 'procStart', alertId: main.id }); openProcedure(); note(`Procedure SH-1 opened from ${main.id}`); }}
                className={cn('h-14 w-full rounded-md px-6 text-base font-semibold sm:w-auto', level === 'warning' ? 'bg-white text-warning hover:bg-white/90' : 'bg-caution-foreground text-caution hover:bg-caution-foreground/90')}>
                {w.procedure ? 'Open procedure SH-1' : 'Start procedure SH-1'}<ArrowRight className="size-5" aria-hidden="true" />
              </Button>
            )}
            {!main && w.inShelter && (
              <Button size="lg" className="h-14 w-full rounded-md px-6 text-base sm:w-auto" onClick={() => { sim.act({ type: 'shelterExit' }); setProcOpen(false); note('Left the shelter'); }}>
                <LogOut className="size-5" aria-hidden="true" />Leave the shelter
              </Button>
            )}
            {showProc && <Button variant="secondary" className="h-12 rounded-md" onClick={() => setProcOpen(false)}>Show alert details</Button>}
            {main && (
              <Button variant="ghost" className={cn('h-11 rounded-md px-0 sm:ml-auto sm:px-3', loud && 'hover:bg-black/10')} onClick={() => openSource(main.ruleId)}>
                Why this alert: rule <span className="font-mono">{main.ruleId}</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {main && (showProc ? <Procedure /> : (
        <dl className="grid gap-px bg-border sm:grid-cols-2">
          {[
            ['What changed?', `${main.reason.replace(/\.$/, '')}.`],
            ['How reliable is the data?', qualityLine(main, w)],
            ['Why does it matter?', main.level === 'warning'
              ? <>Unsheltered, the next 24 h add about <Src k="projection24h"><span className="num">{fmt(w.projection24h())} mSv</span></Src> of extra dose (estimate). The shelter cuts the event dose. NASA asks for doses as low as reasonably achievable.</>
              : RULES[main.ruleId].basis],
            ['What do I do now?', w.inShelter && main.level === 'warning' ? 'Stay in the shelter. Finish procedure SH-1. Leave when the Warning clears.' : main.level === 'caution' && main.peak === 'warning' ? 'Leave the shelter when you are ready. Keep the vest within reach. Go back if the Warning returns.' : RULES[main.ruleId].action],
            ['When do I tell the CMO or the ground?', tellLine(main, w)],
            ['Data', <>Rule <Src k={main.ruleId}><span className="font-mono">{main.ruleId}</span></Src> · data {main.quality} · {main.donkiRefs.length ? `${main.donkiRefs.length} solar records` : 'onboard sensors'} · dose from <Src k="speModel">measured RAD data</Src></>],
          ].map(([q, a], i) => (
            <div key={i} className="bg-card px-5 py-3.5">
              <dt className="text-xs font-medium text-muted-foreground">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      ))}
      {!showProc && <BodyEffects level={level} stormDose={storm && LEVEL_RANK[storm.peak] >= LEVEL_RANK.caution ? storm.eventDoseMSv : undefined} className={cn(main && 'border-t')} />}

      {active.length > 0 && (
        <div className="space-y-2 border-t bg-muted/40 px-5 py-3">
          {active.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <LevelBadge level={a.level} />
              <span className="min-w-0 flex-1">{a.id}{a.suppressed && <span className="text-muted-foreground"> · suppressed</span>}</span>
              <Button size="sm" variant="outline" className="rounded-md" disabled={a.acked} onClick={() => { sim.act({ type: 'ack', alertId: a.id }); note(`${a.id} acknowledged`); }}>
                {a.acked ? <><Check className="size-4" aria-hidden="true" />Acknowledged</> : 'Acknowledge'}
              </Button>
              {/* A Warning cannot be suppressed. Rule inhibit is on Rules and sources (beta report S-1, S-2). */}
              {a.level !== 'warning' && (
                <Button size="sm" variant="outline" className="rounded-md" onClick={() => { const was = a.suppressed; sim.act({ type: was ? 'unsuppress' : 'suppress', alertId: a.id }); note(`${a.id} ${was ? 'shown again' : 'suppressed'}`); }}>
                  {a.suppressed ? 'Show again' : 'Suppress'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The clear-time estimate is on Ask, next to its test result (coverage and late misses).
 * The alert panel shows only the clear rule, which is the fact that ends the Warning.
 */
function ClearEstimate() {
  const { go } = useUi();
  return (
    <button type="button" onClick={() => go('ask')} className="mt-2 block text-left text-xs opacity-90 underline decoration-dotted underline-offset-4 hover:opacity-100">
      Clear-time estimate and its test result: open Ask
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (shelterWall) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [shelterWall]);
  const elapsed = Math.max(0, ((shelterWall ?? now) - startWall) / 1000);
  // On a phone the procedure opens below the fold. Bring its steps into view, so the next tap is in reach.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const done = Object.keys(confirmed).length;

  return (
    <div ref={box} className="scroll-mt-40 border-t p-5 sm:scroll-mt-20">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold"><span className="font-mono">{PROCEDURE_SH1.id}</span> {PROCEDURE_SH1.title}</h3>
        <span className="text-xs text-muted-foreground">Step {Math.min(done + 1, PROCEDURE_SH1.steps.length)} of {PROCEDURE_SH1.steps.length}</span>
        <span className="num ml-auto inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1 text-sm font-semibold" aria-label="Your time since the alert, in real seconds" title="Your time since the alert, in real seconds (metric M-1)">
          <Timer className="size-4" aria-hidden="true" />{shelterWall ? 'Your time to shelter ' : 'Your time '}{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
        </span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-nominal" animate={{ width: `${(done / PROCEDURE_SH1.steps.length) * 100}%` }} /></div>
      <ol className="mt-4 space-y-2">
        {PROCEDURE_SH1.steps.map((s) => {
          const c = confirmed[s.n];
          const isCur = current?.n === s.n;
          const blocked = s.waitsForClear && warnActive;
          return (
            <li key={s.n} aria-current={isCur ? 'step' : undefined}
              className={cn('flex flex-wrap items-center gap-3 rounded-md border-l-4 p-3 transition-colors',
                c ? 'border-nominal bg-nominal/8' : !isCur ? 'border-border bg-muted/40' : warnActive ? 'border-warning bg-warning/10 ring-1 ring-warning/40' : 'border-primary bg-primary/10 ring-1 ring-primary/40')}>
              {/* Check: done. Number: not done. Red only while the Warning is active. The icon also gives the state. */}
              <span className={cn('num grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold', c ? 'bg-nominal text-white' : !isCur ? 'border-2 border-border text-muted-foreground' : warnActive ? 'bg-warning text-white' : 'bg-primary text-primary-foreground')} aria-hidden="true">
                {c ? <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.2, ease: 'easeOut' }}><Check className="size-4" /></motion.span> : s.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-[15px]', isCur && 'text-lg font-semibold', !c && !isCur && 'text-muted-foreground')}><span className="sr-only">Step {s.n}. </span>{s.text}</div>
                <div className={cn('num text-xs font-medium', c ? 'text-nominal' : !isCur ? 'text-muted-foreground' : warnActive ? 'text-warning-ink' : 'text-primary')}>
                  {c ? `Done at ${hhmm(c.t)}${c.choice === 'branch' ? ' · vest not found, CMO told' : ''}` : isCur ? 'Not done. Do this step now.' : 'Not done'}
                </div>
                {isCur && s.waitsForClear && (
                  <div className="text-sm text-muted-foreground">
                    {blocked ? `The Warning is active. It clears when all sensors stay below ${fmt(atMultiple(TH.cautionMultiple.x, w.B))} mSv/h for ${TM.warningClearMin} min.` : 'The Warning is clear. You can leave the shelter.'}
                    {w.inShelter && <> In the shelter for {duration(w.shelterMinAt())}.</>}
                  </div>
                )}
              </div>
              {isCur && (
                <div className="flex w-full gap-2 sm:w-auto">
                  {s.branch && <Button variant="outline" className="h-12 flex-1 rounded-md sm:flex-none" onClick={() => { sim.act({ type: 'procStep', step: s.n, choice: 'branch' }); note(`SH-1 step ${s.n}: ${s.branch!.label}`); }}><CornerDownRight className="size-4" aria-hidden="true" />{s.branch.label}</Button>}
                  {s.waitsForClear ? (
                    <Button className="h-12 flex-1 rounded-md px-6 text-base sm:flex-none" disabled={blocked} onClick={() => { sim.act({ type: 'procStep', step: s.n }); sim.act({ type: 'shelterExit' }); setProcOpen(false); note('SH-1 done. Left the shelter'); }}>
                      <LogOut className="size-4" aria-hidden="true" />{blocked ? 'Wait for clear' : 'Leave the shelter'}
                    </Button>
                  ) : (
                    <Button className="h-12 flex-1 rounded-md bg-foreground px-5 text-base text-background hover:bg-foreground/90 sm:flex-none" onClick={() => { sim.act({ type: 'procStep', step: s.n }); note(`SH-1 step ${s.n} done: ${s.text}`); }}>
                      <Square className="size-5" aria-hidden="true" />Mark as done
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">{PROCEDURE_SH1.note}{w.m1Seconds.length > 0 && <> · Warning to shelter: <b className="num text-foreground">{Math.round(w.m1Seconds[w.m1Seconds.length - 1])} s</b> (metric M-1 target: median 60 s or less)</>}</p>
    </div>
  );
}

