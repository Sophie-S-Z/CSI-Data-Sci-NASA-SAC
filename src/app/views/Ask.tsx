import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { stamp } from '../../engine/time';
import { fmt } from '../../engine/units';
import { ask, suggestions, CLEAR_TEST, ASSISTANT_INFO, MIN_SCORE, type Answer } from '../assistant';
import { resolveSource } from '../sources';
import { useUi } from '../context';
import { Kv, PageHead, Panel, Prov, Src } from '../parts';

interface Item { id: number; q: string; t: number; a: Answer }

const NOTE: Partial<Record<Answer['kind'], string>> = { refusal: 'Not allowed', none: 'No answer' };
const isRuleId = (k: string) => /^[RB]-/.test(k);

export function AskView() {
  const { sim, go } = useUi();
  const w = sim.world;
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);

  const submit = (text: string) => {
    if (!text.trim()) return;
    setItems((xs) => [{ id: (xs[0]?.id ?? 0) + 1, q: text.trim(), t: w.t, a: ask(text, w) }, ...xs].slice(0, 12));
    setQ('');
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(q); };

  return (
    <>
      <PageHead title="Ask" sub="The onboard assistant answers questions from the alert rules, the crew log, and the cited sources. It operates without a link to Earth. It has read-only access, so it cannot change an alert, a rule, or a limit." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl bg-card p-4 ring-hairline md:p-5">
            <form onSubmit={onSubmit} className="flex gap-2">
              <label htmlFor="ask-q" className="sr-only">Your question</label>
              <input id="ask-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a question" autoComplete="off" enterKeyHint="send"
                className="h-12 min-w-0 flex-1 rounded-md border border-input bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
              <Button type="submit" disabled={!q.trim()} className="h-12 rounded-md px-5 text-base">
                Ask<CornerDownLeft className="size-4" aria-hidden="true" />
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
              {suggestions(w).map((s) => (
                <button key={s} type="button" onClick={() => submit(s)}
                  className="h-11 rounded-full bg-muted px-4 text-sm font-medium transition-[transform,background-color] hover:bg-accent active:scale-[0.97]">{s}</button>
              ))}
            </div>
          </section>

          <div aria-live="polite" className="space-y-3">
            {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">Tap a question, or type one. Each answer shows its sources.</p>}
            <AnimatePresence initial={false}>
              {items.map((it) => <AnswerCard key={it.id} it={it} onGo={go} />)}
            </AnimatePresence>
          </div>
        </div>
        <HowItWorks />
      </div>
    </>
  );
}

function AnswerCard({ it, onGo }: { it: Item; onGo: (t: NonNullable<Answer['go']>['tab']) => void }) {
  const { a } = it;
  return (
    <motion.article layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.16 } }} transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn('rounded-xl bg-card p-4 ring-hairline md:p-5', a.kind === 'refusal' && 'ring-2 ring-verify/40')}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{it.q}</h2>
        {a.estimate && <Prov kind="estimate" />}
        {NOTE[a.kind] && <span className="text-xs font-medium text-muted-foreground">{NOTE[a.kind]}</span>}
        <span className="num text-xs text-muted-foreground">{stamp(it.t)}</span>
      </header>
      <div className="mt-2 space-y-1.5 text-[15px] leading-relaxed">
        {a.lines.map((l, i) => (
          <motion.p key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut', delay: 0.03 * i }}>{l}</motion.p>
        ))}
      </div>
      {(a.sources.length > 0 || a.go) && (
        <footer className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          {a.sources.length > 0 && <>Sources {a.sources.map((k) => <Src key={k} k={k} className={cn(isRuleId(k) && 'font-mono')}>{isRuleId(k) ? k : resolveSource(k)[0].title}</Src>)}</>}
          {a.go && (
            <Button variant="outline" size="sm" className="ml-auto h-9 rounded-md" onClick={() => onGo(a.go!.tab)}>
              {a.go.label}<ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </footer>
      )}
    </motion.article>
  );
}

function HowItWorks() {
  const t = CLEAR_TEST;
  return (
    <Panel title="How it works" className="h-fit">
      <Kv rows={[
        ['Runs on', 'This laptop, offline'],
        ['Authority', 'Reads only. You act.'],
        ['Matching', `Nearest of ${ASSISTANT_INFO.examples} example questions, ${ASSISTANT_INFO.topics} topics`],
        ['No answer', `Below a match score of ${MIN_SCORE}`],
        ['Refuses', 'Diagnosis, treatment, changes to alerts or rules'],
        ['Last 12 h brief', 'Alerts, findings, dose, shelter time, solar records'],
        ['Check-in note', 'Names the symptoms in your note. You mark them.'],
        ['Clear-time estimate', 'Decay fit of the last 8 h. Range from the other measured RAD events'],
        ['Estimate test', `${fmt(t.coverage_pct)}% in range, ${t.stays} new shelter stays`],
      ]} />
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The clear-time estimate fits the decay of the last 8 h of the event and projects the time to the clear line. The other measured events set the width of the range.
        A test on {t.stays} new shelter stays (CRaTER and RAD, 2020 to 2026) had the real clear time in the range at {fmt(t.coverage_pct)}% of {t.checks} hourly checks.
        The 95% range of this result is {fmt(t.coverage_ci[0])}% to {fmt(t.coverage_ci[1])}%. An earlier test on 6 events gave 98%, which was too high. The Research view has the details.
        The estimate never opens, holds, or clears an alert.
      </p>
    </Panel>
  );
}
