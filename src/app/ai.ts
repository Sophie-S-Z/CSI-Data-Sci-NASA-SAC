import type { MLCEngine } from '@mlc-ai/web-llm';
import type { World } from '../engine/world';
import { ask, type Answer } from './assistant';
import { LEVEL_EFFECT } from './health';
import { displayName, modelOf, type Profile } from './profile';

/**
 * The language-model layer of Ask. The built-in assistant (assistant.ts) stays in front:
 * - It answers refusals (diagnosis, treatment, changes to alerts) itself. Those never reach a model.
 * - It gives the facts. The model only rewrites them in plain words, so it cannot add a number.
 * A model never acts on the world: it gets text and returns text.
 */

export const LOCAL_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', size: '0.9 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', size: '2.3 GB' },
];

export const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

const SYSTEM = [
  'You are the onboard assistant of Vigil, a radiation health tool for an astronaut on the way to Mars.',
  'Answer in 1 to 4 short, plain sentences. Use simple words.',
  'Use only the FACTS. If the FACTS do not answer the question, say that you do not know.',
  'Copy each number exactly as the FACTS give it.',
  'Never diagnose and never suggest a treatment. Send medical questions to the Crew Medical Officer (CMO).',
  'You cannot change alerts, rules, or limits. Never tell the crew to ignore an alert.',
].join('\n');

/** The facts that the model may use: the matched answer, the alert now, and the body effects of the level. */
export function facts(base: Answer, w: World, p: Profile): string[] {
  const now = ask('What do I do now?', w);
  const level = w.activeAlerts[0]?.level ?? 'nominal';
  return [...new Set([
    `Crew member: ${displayName(p)}, ${p.role}.`,
    ...now.lines,
    ...(base.kind === 'none' ? [] : base.lines),
    `Body effect at this level: ${LEVEL_EFFECT[level].text}`,
  ])];
}

const prompt = (q: string, lines: string[]) => `FACTS:\n${lines.map((l) => `- ${l}`).join('\n')}\n\nQUESTION: ${q}`;

let local: { id: string; engine: Promise<MLCEngine>; ready: boolean } | null = null;

/** Load a model into this browser (WebGPU). The first load downloads it; later loads use the browser cache. */
export function loadLocal(id: string, onProgress: (text: string, part: number) => void): Promise<MLCEngine> {
  if (local?.id !== id) {
    const engine = import('@mlc-ai/web-llm').then((m) => m.CreateMLCEngine(id, { initProgressCallback: (r) => onProgress(r.text, r.progress) }));
    const entry = { id, engine, ready: false };
    engine.then(() => { entry.ready = true; }, () => { if (local === entry) local = null; });
    local = entry;
  }
  return local.engine;
}

export const localReady = (id: string) => local?.id === id && local.ready;

/** Ask the model that the profile names. Throws an Error with a plain message when the call fails. */
export async function modelAnswer(q: string, lines: string[], p: Profile, onProgress: (text: string, part: number) => void): Promise<string> {
  const content = prompt(q, lines);
  if (p.engine === 'local') {
    const engine = await loadLocal(modelOf(p), onProgress);
    const r = await engine.chat.completions.create({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }], temperature: 0.2, max_tokens: 300 });
    return r.choices[0]?.message.content?.trim() ?? '';
  }
  if (p.engine === 'anthropic') {
    const key = p.keys.anthropic;
    if (!key) throw new Error('Add your Anthropic API key first.');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // The key stays in this browser. The SDK sends it only to api.anthropic.com.
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    try {
      const r = await client.beta.messages.create({
        model: modelOf(p), max_tokens: 2048, system: SYSTEM, messages: [{ role: 'user', content }],
        output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      });
      if (r.stop_reason === 'refusal') throw new Error('The model declined this question.');
      return r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic did not accept the API key.', { cause: e });
      if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limit reached. Try again in a minute.', { cause: e });
      if (e instanceof Anthropic.APIError) throw new Error(`Anthropic error ${e.status ?? ''}: ${e.message}`.trim(), { cause: e });
      throw e;
    }
  }
  if (p.engine === 'openai') {
    const key = p.keys.openai;
    if (!key) throw new Error('Add your API key first.');
    const res = await fetch(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelOf(p), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
    });
    if (!res.ok) throw new Error(`The API gave error ${res.status}. Check the key, the model, and the URL.`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() ?? '';
  }
  throw new Error('No model is selected.');
}
