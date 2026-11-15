import { useState } from 'react';
import { Check, Minus, Plus, Lock, Stethoscope, Users, Satellite } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { VIS_LABEL, VISIBILITY_ORDER, type Visibility } from '../../engine/world';
import { dayOf } from '../../engine/time';
import { useUi } from '../context';
import { LevelBadge, PageHead, Panel, Src } from '../parts';
import { sources } from '../sources';
import { LogRow } from './Log';
import { readNote, type Symptom } from '../noteReader';
import { Mic } from '../Mic';

/** One page, no wizard: a normal day takes about 30 s. */
const GROUPS = [
  { id: 'rad', title: 'Radiation signs', hint: 'Early signs after a high dose. Most days you mark none.', items: ['Nausea', 'Vomiting', 'Diarrhea', 'Fatigue', 'Skin redness', 'Fever'] },
  { id: 'head', title: 'Head, eyes, and air', hint: 'Vision change can be a sign of SANS. Headache with a stuffy head can come from high CO2.', items: ['Headache', 'Blurred near vision', 'Eye pressure', 'Stuffy head', 'Short of breath', 'Dizzy'] },
  { id: 'body', title: 'Body', hint: 'Back pain is common in the first weeks of weightlessness.', items: ['Back pain', 'Muscle soreness', 'Joint pain', 'Bruising', 'Bleeding gums'] },
] as const satisfies readonly { id: string; title: string; hint: string; items: readonly Symptom[] }[];

const SCALE5 = { sleep: ['Poor', 'Fair', 'OK', 'Good', 'Great'], mood: ['Low', 'Flat', 'Steady', 'Good', 'High'] };
const VIS_ICON = { private: Lock, cmo: Stethoscope, crew: Users, ground: Satellite } as const;
const VIS_HELP: Record<Visibility, string> = {
  private: 'Only you. It never leaves this vehicle.',
  cmo: 'You and the CMO.',
  crew: 'The whole crew. Not the ground.',
  ground: 'The crew, and the ground summary.',
};

function Scale({ value, set, labels, label }: { value: number; set: (n: number) => void; labels: string[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1 rounded-md bg-muted p-1">
      {labels.map((l, i) => (
        <button key={l} role="radio" aria-checked={value === i + 1} onClick={() => set(i + 1)}
          className={cn('h-11 rounded-md text-sm font-medium transition', value === i + 1 ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>{l}</button>
      ))}
    </div>
  );
}

export function CheckInView() {
  const { sim, note, go } = useUi();
  const [sleep, setSleep] = useState(6.5);
  const [sleepQ, setSleepQ] = useState(3);
  const [mood, setMood] = useState(3);
  const [pain, setPain] = useState(0);
  const [sym, setSym] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [vis, setVis] = useState<Visibility>('cmo');
  const w = sim.world;
  const recent = w.log.filter((e) => e.kind === 'checkin').slice(-5).reverse();
  const draft = { sleepH: sleep, symptoms: sym, note: text, sleepQuality: sleepQ, mood, pain };
  const flags = w.bodyFindings(draft).filter((f) => f.system !== 'heart' && f.system !== 'bone');
  const toggle = (x: string) => setSym((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  const fromNote = readNote(text).filter((x) => !sym.includes(x));
  const doneToday = w.log.some((e) => e.kind === 'checkin' && dayOf(e.t) === dayOf(w.t));

  function save() {
    sim.act({ type: 'checkin', data: draft, visibility: vis });
    note(flags.some((f) => f.level === 'caution') ? 'Check-in saved. A finding needs the CMO now' : `Check-in saved. Shared with: ${VIS_LABEL[vis]}`);
    setSym([]); setText('');
    go('mission');
  }

  return (
    <>
      <PageHead title="Daily health check" sub={doneToday ? 'Done today. You can add another entry.' : 'On your timeline at 07:00. A normal day takes about 30 seconds.'} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <div className="grid gap-6 pt-5">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <div className="mb-2 text-sm font-medium">Sleep last night</div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="size-11 rounded-md" aria-label="Less sleep" onClick={() => setSleep(Math.max(0, +(sleep - 0.5).toFixed(1)))}><Minus className="size-4" /></Button>
                  <output className="num flex-1 text-center text-3xl font-semibold" aria-live="polite">{sleep.toFixed(1)}<span className="ml-1 text-sm font-normal text-muted-foreground">h</span></output>
                  <Button variant="outline" size="icon" className="size-11 rounded-md" aria-label="More sleep" onClick={() => setSleep(Math.min(12, +(sleep + 0.5).toFixed(1)))}><Plus className="size-4" /></Button>
                </div>
              </div>
              <div><div className="mb-2 text-sm font-medium">Sleep quality</div><Scale value={sleepQ} set={setSleepQ} labels={SCALE5.sleep} label="Sleep quality" /></div>
              <div><div className="mb-2 text-sm font-medium">Mood now</div><Scale value={mood} set={setMood} labels={SCALE5.mood} label="Mood" /></div>
            </div>

            <div>
              <div className="text-sm font-medium">Symptoms since the last check</div>
              <p className="text-xs text-muted-foreground">Mark only what is new or worse. No marks means no symptoms.</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {GROUPS.map((g) => (
                  <fieldset key={g.id} className="rounded-md bg-muted/40 p-3 ring-1 ring-border">
                    <legend className="sr-only">{g.title}</legend>
                    <div className="text-sm font-semibold">{g.title}</div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{g.hint}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {g.items.map((x) => {
                        const on = sym.includes(x);
                        return (
                          <button key={x} type="button" aria-pressed={on} onClick={() => toggle(x)}
                            className={cn('inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition', on ? 'bg-foreground text-background ring-foreground' : 'bg-card ring-border hover:ring-foreground/40')}>
                            {on && <Check className="size-3.5" aria-hidden="true" />}{x}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-[260px_1fr]">
              <div>
                <div className="mb-3 flex items-baseline justify-between text-sm font-medium">Pain<span className="num text-2xl font-semibold">{pain}<span className="text-sm font-normal text-muted-foreground"> of 10</span></span></div>
                <Slider value={[pain]} min={0} max={10} step={1} onValueChange={(v) => setPain(v[0])} aria-label="Pain, 0 to 10" />
              </div>
              <div>
                <label htmlFor="note" className="mb-2 block text-sm font-medium">Note (optional)</label>
                <div className="flex gap-2">
                  <Textarea id="note" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or speak. For example: headache since lunch" className="min-h-20 rounded-md" />
                  <Mic label="Speak your note" onText={(t) => setText((x) => (x ? `${x} ${t}` : t))} />
                </div>
                {fromNote.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Symptoms named in your note">
                    <span className="text-xs text-muted-foreground">Your note names:</span>
                    {fromNote.map((x) => (
                      <button key={x} type="button" onClick={() => toggle(x)} aria-label={`Mark ${x}`}
                        className="inline-flex h-10 items-center gap-1 rounded-full border border-dashed border-foreground/30 bg-card px-3 text-sm font-medium transition-[transform,border-color] hover:border-foreground/60 active:scale-[0.97]">
                        <Plus className="size-3.5" aria-hidden="true" />{x}
                      </button>
                    ))}
                    <span className="text-xs text-muted-foreground">Tap to mark. The rules read marked symptoms only.</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Who can see this entry</div>
              <div role="radiogroup" aria-label="Who can see this entry" className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {VISIBILITY_ORDER.map((v) => {
                  const I = VIS_ICON[v];
                  return (
                    <button key={v} role="radio" aria-checked={vis === v} onClick={() => setVis(v)}
                      className={cn('flex flex-col items-start gap-1 rounded-md p-3 text-left ring-1 transition', vis === v ? 'bg-primary/8 ring-2 ring-primary' : 'ring-border hover:bg-muted/50')}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold"><I className="size-4" aria-hidden="true" />{VIS_LABEL[v]}</span>
                      <span className="text-xs text-muted-foreground">{VIS_HELP[v]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button size="lg" className="h-12 rounded-md px-6 text-base" onClick={save}><Check className="size-5" aria-hidden="true" />Save check-in</Button>
              <span className="text-sm text-muted-foreground">{sym.length === 0 ? 'No symptoms marked.' : `${sym.length} marked: ${sym.join(', ')}.`}</span>
            </div>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel title="What the rules see" aside="Updates as you mark">
            {flags.length === 0 ? <p className="text-sm text-muted-foreground">No findings. A marked symptom shows here with the next step and its source.</p> : (
              <ul className="space-y-2">
                {flags.map((f) => (
                  <li key={f.ruleId} className="rounded-md bg-muted/50 p-3 text-sm">
                    <LevelBadge level={f.level} /> <b className="ml-1">{f.title}.</b> {f.text}
                    <div className="mt-1 text-xs text-muted-foreground">Seen: {f.why} · Rule <Src k={f.ruleId}><span className="font-mono">{f.ruleId}</span></Src> · <Src k={f.source}>{(sources as Record<string, { short: string }>)[f.source]?.short ?? f.source}</Src></div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Body rules give Advisory or Caution only. They use team values. The tool gives advice. It does not diagnose.</p>
          </Panel>
          <Panel title="Your recent check-ins" bodyClass="px-0 pb-2">
            {recent.length === 0 ? <p className="px-5 pb-3 text-sm text-muted-foreground">No check-ins yet in this replay.</p> : <ul className="divide-y">{recent.map((e) => <LogRow key={e.seq} e={e} />)}</ul>}
          </Panel>
        </div>
      </div>
    </>
  );
}
