import { useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CornerDownLeft, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { stamp } from '../../engine/time';
import { fmt } from '../../engine/units';
import { ask, suggestions, CLEAR_TEST, ASSISTANT_INFO, type Answer } from '../assistant';
import { LOCAL_MODELS, facts, hasWebGpu, loadLocal, localReady, modelAnswer } from '../ai';
import { ENGINE_LABEL, modelOf, DEFAULT_MODEL, type Engine, type KeyEngine } from '../profile';
import { resolveSource } from '../sources';
import { useUi } from '../context';
import { Mic } from '../Mic';
import { FIELD, PageHead, Panel, Prov, Seg, Src } from '../parts';

interface Item { id: number; q: string; t: number; a: Answer; engine: Engine; text?: string; error?: string; pending?: boolean }
type Progress = { text: string; part: number } | null;

const NOTE: Partial<Record<Answer['kind'], string>> = { refusal: 'Not allowed', none: 'No answer' };
const isRuleId = (k: string) => /^[RB]-/.test(k);

export function AskView() {
  const { sim, go, profile } = useUi();
  const w = sim.world;
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const nextId = useRef(1);
  const onProgress = (text: string, part: number) => setProgress(part >= 1 ? null : { text, part });

  const submit = (text: string) => {
    const question = text.trim();
    if (!question) return;
    const a = ask(question, w);
    // Refusals and the built-in engine answer at once. A model gets the facts and rewrites them.
    const useModel = profile.engine !== 'builtin' && a.kind !== 'refusal';
    const id = nextId.current++;
    const set = (patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setItems((xs) => [{ id, q: question, t: w.t, a, engine: useModel ? profile.engine : 'builtin', pending: useModel }, ...xs].slice(0, 12));
    setQ('');
    if (useModel) {
      modelAnswer(question, facts(a, w, profile), profile, onProgress)
        .then((text) => set({ text, pending: false }), (e: unknown) => set({ error: e instanceof Error ? e.message : String(e), pending: false }));
    }
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(q); };

  return (
    <>
      <PageHead title="Ask AI" sub="Ask about your radiation, the shelter, your dose, or your body. The AI reads the alert rules and the log. It cannot change an alert." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl bg-card p-4 ring-hairline md:p-5">
            <form onSubmit={onSubmit} className="flex gap-2">
              <label htmlFor="ask-q" className="sr-only">Your question</label>
              <input id="ask-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" autoComplete="off" enterKeyHint="send"
                className={cn(FIELD, 'h-12 flex-1 px-4')} />
              <Mic label="Speak a question" className="size-12" onText={(t) => setQ((x) => (x ? `${x} ${t}` : t))} />
              <Button type="submit" disabled={!q.trim()} aria-label="Ask" className="h-12 rounded-md px-4 text-base sm:px-5">
                <span className="hidden sm:inline">Ask</span><CornerDownLeft className="size-4" aria-hidden="true" />
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
              {suggestions(w).map((s) => (
                <button key={s} type="button" onClick={() => submit(s)}
                  className="h-11 rounded-full bg-muted px-4 text-sm font-medium transition-[transform,background-color] hover:bg-accent active:scale-[0.97]">{s}</button>
              ))}
            </div>
            {progress && (
              <div className="mt-3 text-xs text-muted-foreground" role="status">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress.part * 100}%` }} /></div>
                <p className="mt-1 truncate">{progress.text}</p>
              </div>
            )}
          </section>

          <div aria-live="polite" className="space-y-3">
            <AnimatePresence initial={false}>
              {items.map((it) => <AnswerCard key={it.id} it={it} onGo={go} />)}
            </AnimatePresence>
          </div>
        </div>
        <div className="space-y-4">
          <EnginePanel onProgress={onProgress} progress={progress} />
          <HowItWorks />
        </div>
      </div>
    </>
  );
}

function AnswerCard({ it, onGo }: { it: Item; onGo: (t: NonNullable<Answer['go']>['tab']) => void }) {
  const { a } = it;
  const lines = it.text ? [it.text] : a.lines;
  return (
    <motion.article layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.16 } }} transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn('rounded-xl bg-card p-4 ring-hairline md:p-5', a.kind === 'refusal' && 'ring-2 ring-verify/40')}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold">{it.q}</h2>
        {a.estimate && <Prov kind="estimate" />}
        {NOTE[a.kind] && <span className="text-xs font-medium text-muted-foreground">{NOTE[a.kind]}</span>}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{it.engine !== 'builtin' && <Sparkles className="size-3" aria-hidden="true" />}{ENGINE_LABEL[it.engine]}</span>
        <span className="num text-xs text-muted-foreground">{stamp(it.t)}</span>
      </header>
      {it.pending ? <p className="mt-2 animate-pulse text-[15px] text-muted-foreground motion-reduce:animate-none">Thinking…</p> : (
        <div className="mt-2 space-y-1.5 text-[15px] leading-relaxed">
          {it.error && <p className="text-sm text-caution-ink">{it.error} The built-in answer is below.</p>}
          {lines.map((l, i) => <p key={i} className="whitespace-pre-line">{l}</p>)}
        </div>
      )}
      {it.text && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Facts the AI used</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{a.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      )}
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

const ENGINE_ABOUT: Record<Engine, string> = {
  builtin: `Offline and instant. It matches your question to ${ASSISTANT_INFO.topics} topics and answers from the rules.`,
  local: 'A small language model runs in this browser on your GPU. After the first download, it works offline.',
  anthropic: 'Claude writes the answer from the same facts. Needs your Anthropic API key and a network link.',
  openai: 'Any OpenAI-compatible API (OpenAI, OpenRouter, a local server). Needs your key and a network link.',
};

/** Pick the AI engine. API keys stay in this browser and go only to the provider that you pick. */
function EnginePanel({ onProgress, progress }: { onProgress: (text: string, part: number) => void; progress: Progress }) {
  const { profile: p, setProfile } = useUi();
  const [loadError, setLoadError] = useState('');
  const engine = p.engine;
  const setModel = (e: Engine, m: string) => setProfile({ ...p, models: { ...p.models, [e]: m } });
  const setKey = (e: KeyEngine, k: string) => setProfile({ ...p, keys: { ...p.keys, [e]: k } });
  const keyField = (e: KeyEngine, label: string) => (
    <div>
      <label htmlFor={`key-${e}`} className="mb-1 block text-xs font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={`key-${e}`} type="password" autoComplete="off" spellCheck={false} value={p.keys[e] ?? ''} onChange={(ev) => setKey(e, ev.target.value.trim())} placeholder="Paste your key" className={FIELD} />
        {p.keys[e] && <Button variant="outline" className="h-11 rounded-md" onClick={() => setKey(e, '')}>Forget</Button>}
      </div>
    </div>
  );
  const modelField = (e: Exclude<Engine, 'builtin' | 'local'>) => (
    <div>
      <label htmlFor={`model-${e}`} className="mb-1 block text-xs font-medium">Model</label>
      <input id={`model-${e}`} value={p.models[e] ?? ''} placeholder={DEFAULT_MODEL[e]} onChange={(ev) => setModel(e, ev.target.value)} className={FIELD} />
    </div>
  );
  const local = modelOf(p, 'local');
  const loadModel = () => { setLoadError(''); loadLocal(local, onProgress).then(() => onProgress('', 1), (e: unknown) => { onProgress('', 1); setLoadError(e instanceof Error ? e.message : String(e)); }); };

  return (
    <Panel title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden="true" />AI engine</span>}>
      <Seg<Engine> label="AI engine" value={engine} onChange={(e) => setProfile({ ...p, engine: e })} options={(Object.keys(ENGINE_LABEL) as Engine[]).map((e) => ({ value: e, label: ENGINE_LABEL[e] }))} />
      <p className="mt-3 text-sm text-muted-foreground">{ENGINE_ABOUT[engine]}</p>
      <div className="mt-3 space-y-3">
        {engine === 'local' && (hasWebGpu ? (
          <>
            <div>
              <label htmlFor="model-local" className="mb-1 block text-xs font-medium">Model</label>
              <select id="model-local" value={local} onChange={(e) => setModel('local', e.target.value)} className={FIELD}>
                {LOCAL_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.size} download)</option>)}
              </select>
            </div>
            {localReady(local) && !progress && !loadError ? <p className="text-sm text-nominal">Model ready.</p> : (
              <Button variant="outline" className="h-11 w-full rounded-md" disabled={!!progress} onClick={loadModel}>{progress ? 'Loading…' : 'Load the model now'}</Button>
            )}
            {loadError && <p className="text-sm text-caution-ink">The model did not load: {loadError}</p>}
          </>
        ) : <p className="text-sm text-caution-ink">This browser has no WebGPU. Use Chrome or Edge on a computer, or pick another engine.</p>)}
        {engine === 'anthropic' && <>{keyField('anthropic', 'Anthropic API key')}{modelField('anthropic')}</>}
        {engine === 'openai' && (
          <>
            <div>
              <label htmlFor="base-url" className="mb-1 block text-xs font-medium">API URL</label>
              <input id="base-url" value={p.baseUrl} onChange={(e) => setProfile({ ...p, baseUrl: e.target.value.trim() })} className={FIELD} />
            </div>
            {keyField('openai', 'API key')}{modelField('openai')}
          </>
        )}
        {(engine === 'anthropic' || engine === 'openai') && <p className="text-xs text-muted-foreground">Your key stays in this browser. The app sends it only to the provider above.</p>}
      </div>
    </Panel>
  );
}

function HowItWorks() {
  const t = CLEAR_TEST;
  return (
    <Panel title="How the answers stay safe" className="h-fit">
      <ul className="list-disc space-y-1.5 pl-4 text-sm">
        <li>The built-in assistant finds the facts first. An AI model can only reword them.</li>
        <li>Questions about diagnosis, treatment, or a change to an alert get a fixed refusal. They never go to a model.</li>
        <li>The assistant reads data only. You act.</li>
        <li>The clear-time estimate was right {fmt(t.coverage_pct)}% of the time on {t.stays} real shelter stays from 2020 to 2026. It never opens or clears an alert.</li>
      </ul>
    </Panel>
  );
}
