/** The crew member's profile and assistant settings. They stay in this browser only (localStorage). */

export const ROLES = ['Commander', 'Pilot', 'Flight engineer', 'Mission specialist', 'Medical officer'] as const;

export type Engine = 'builtin' | 'local' | 'anthropic' | 'openai';
export const ENGINE_LABEL: Record<Engine, string> = { builtin: 'Built-in', local: 'On this device', anthropic: 'Claude', openai: 'Other API' };

export type KeyEngine = Extract<Engine, 'anthropic' | 'openai'>;

export interface Profile {
  name: string;
  role: (typeof ROLES)[number];
  engine: Engine;
  /** Model per engine. The built-in engine has no model. */
  models: Partial<Record<Engine, string>>;
  /** API keys. Each key goes only to its own provider. */
  keys: Partial<Record<KeyEngine, string>>;
  /** Base URL of the OpenAI-compatible API. */
  baseUrl: string;
}

export const DEFAULT_MODEL: Record<Exclude<Engine, 'builtin'>, string> = {
  local: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4.1-mini',
};

export const DEFAULT_PROFILE: Profile = {
  name: '', role: 'Mission specialist', engine: 'builtin', models: {}, keys: {}, baseUrl: 'https://api.openai.com/v1',
};

const KEY = 'storm-shelter.profile.v1';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch { /* storage can be blocked */ }
  return DEFAULT_PROFILE;
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export const displayName = (p: Profile) => p.name.trim() || 'Crew A';
export const initials = (p: Profile) => displayName(p).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const modelOf = (p: Profile, e: Exclude<Engine, 'builtin'> = p.engine as Exclude<Engine, 'builtin'>) => p.models[e]?.trim() || DEFAULT_MODEL[e];
