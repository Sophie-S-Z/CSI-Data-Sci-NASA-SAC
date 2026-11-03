import { useState } from 'react';
import { flareRank } from '../engine/donki';

/**
 * Live DONKI feed (FR-02, data source). The live feed is for context only.
 * The replay drives the rules, so the demo works with no network (RK-05).
 */
const KEY_STORE = 'storm-shelter.nasaKey';
const CACHE_STORE = 'storm-shelter.donkiCache';

interface LiveRow { kind: 'FLR' | 'CME' | 'SEP'; id: string; time: string; text: string; wouldGive: string }
interface Cache { fetchedAt: string; rows: LiveRow[] }

function read<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export function LiveDonki() {
  const [key, setKey] = useState<string>(() => read<string>(KEY_STORE) ?? '');
  const [cache, setCache] = useState<Cache | null>(() => read<Cache>(CACHE_STORE));
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  async function fetchLive() {
    setState('loading');
    setError('');
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400_000);
    const k = key.trim() || 'DEMO_KEY';
    write(KEY_STORE, key.trim());
    const url = (t: string) => `https://api.nasa.gov/DONKI/${t}?startDate=${ymd(start)}&endDate=${ymd(end)}&api_key=${encodeURIComponent(k)}`;
    try {
      const [flr, cme, sep] = await Promise.all(['FLR', 'CME', 'SEP'].map(async (t) => {
        const r = await fetch(url(t));
        if (!r.ok) throw new Error(`${t}: HTTP ${r.status}${r.status === 429 ? '. The key hit its hourly limit. Use a personal key.' : ''}`);
        const txt = await r.text();
        return txt ? JSON.parse(txt) : [];
      }));
      const rows: LiveRow[] = [
        ...(flr as { flrID: string; beginTime: string; classType: string }[]).map((f) => ({
          kind: 'FLR' as const, id: f.flrID, time: f.beginTime, text: `Flare ${f.classType}`,
          wouldGive: flareRank(f.classType) >= 10 ? 'Caution if a fast CME links' : flareRank(f.classType) >= 1 ? 'Advisory (R-A1)' : 'No alert',
        })),
        ...(cme as { activityID: string; startTime: string; cmeAnalyses?: { speed: number; isMostAccurate: boolean }[] }[]).map((c) => {
          const sp = c.cmeAnalyses?.find((a) => a.isMostAccurate)?.speed ?? c.cmeAnalyses?.[0]?.speed;
          return { kind: 'CME' as const, id: c.activityID, time: c.startTime, text: sp ? `CME at ${Math.round(sp)} km/s` : 'CME, no speed yet', wouldGive: sp && sp >= 500 ? 'Advisory (R-A1)' : 'No alert' };
        }),
        ...(sep as { sepID: string; eventTime: string }[]).map((s) => ({ kind: 'SEP' as const, id: s.sepID, time: s.eventTime, text: 'Solar energetic particle event', wouldGive: 'Caution (R-C1)' })),
      ].sort((a, b) => b.time.localeCompare(a.time));
      const c = { fetchedAt: new Date().toISOString(), rows };
      write(CACHE_STORE, c);
      setCache(c);
      setState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        Real records from NASA DONKI, last 30 days. They show context only. They do not change the replay.
      </p>
      <div className="field">
        <label htmlFor="nasa-key">api.nasa.gov key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="nasa-key" type="password" autoComplete="off" value={key} placeholder="Empty uses DEMO_KEY" onChange={(e) => setKey(e.target.value)} />
          <button className="btn primary" onClick={fetchLive} disabled={state === 'loading'}>{state === 'loading' ? 'Fetching' : 'Fetch'}</button>
        </div>
        <span className="faint" style={{ fontSize: 12.5 }}>The key stays in this browser only.</span>
      </div>
      {state === 'error' && <div className="notice" role="alert">Fetch failed: {error} The app keeps the last cached records. The replay still works offline.</div>}
      {cache && (
        <>
          <p className="faint" style={{ fontSize: 12.5 }}>Cached {new Date(cache.fetchedAt).toLocaleString()}. {cache.rows.length} records.</p>
          <ul className="feed">
            {cache.rows.slice(0, 12).map((r) => (
              <li key={r.id}><span className="k">{r.kind}</span><span>{r.text} <span className="muted">· {r.wouldGive}</span></span><span /><span className="when">{r.time.replace('T', ' ').replace('Z', ' UTC')}</span></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
