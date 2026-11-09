import { useCallback, useEffect, useRef, useState } from 'react';
import mission from '../data/mission.json';
import { World, replayWorld, LEVEL_RANK, type Action, type RecordedAction } from '../engine/world';
import { at } from '../engine/time';

const KEY = 'storm-shelter.replay.v2';
export const DEMO_START = at(mission.replay.demoStart.day, mission.replay.demoStart.hhmm);
export const REPLAY_END = at(mission.replay.endDay, '23:59');

export const SPEEDS = [
  { id: 'x60', label: '1 min/s', minPerSec: 1 },
  { id: 'x600', label: '10 min/s', minPerSec: 10 },
  { id: 'x3600', label: '1 h/s', minPerSec: 60 },
  { id: 'x14400', label: '4 h/s', minPerSec: 240 },
] as const;

export const BEATS = [
  { label: 'X5.4 flare', t: at(94, '00:20') },
  { label: 'Sensor spike', t: at(94, '03:08') },
  { label: 'Dose rise', t: at(94, '06:30') },
  { label: 'Warning', t: at(94, '08:45') },
  { label: 'Peak', t: at(95, '17:00') },
  { label: 'Warning clears', t: at(97, '13:30') },
];

interface Saved { actions: RecordedAction[]; t: number }

function load(): World {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.actions) && typeof s.t === 'number') return replayWorld(s.actions, s.t);
    }
  } catch {
    /* storage can be blocked; start fresh */
  }
  const w = new World();
  w.advanceTo(DEMO_START);
  return w;
}

function save(w: World): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ actions: w.actions, t: w.t } satisfies Saved));
  } catch {
    /* ignore */
  }
}

/** True when a Caution or Warning starts, or goes up, in this minute. The replay pauses so the demo can show it. */
function raisedNow(w: World): boolean {
  return w.activeAlerts.some((a) => {
    if (a.changedAt !== w.t || LEVEL_RANK[a.level] < LEVEL_RANK.caution) return false;
    const prev = a.history[a.history.length - 2];
    return !prev || prev.level === 'clear' || LEVEL_RANK[a.level] > LEVEL_RANK[prev.level as keyof typeof LEVEL_RANK];
  });
}

export function useSim() {
  const ref = useRef<World | null>(null);
  if (!ref.current) ref.current = load();
  const [, setVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(SPEEDS[2]);
  const [pauseOnAlert, setPauseOnAlert] = useState(true);
  const carry = useRef(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const w = ref.current!;
      carry.current += speed.minPerSec / 10;
      const n = Math.floor(carry.current);
      carry.current -= n;
      for (let i = 0; i < n && w.t < REPLAY_END; i++) {
        w.step();
        if (pauseOnAlert && raisedNow(w)) {
          setPlaying(false);
          break;
        }
      }
      if (w.t >= REPLAY_END) setPlaying(false);
      if (n > 0) {
        save(w);
        bump();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, speed, pauseOnAlert, bump]);

  const act = useCallback((a: Action) => {
    ref.current!.apply(a);
    save(ref.current!);
    bump();
  }, [bump]);

  const jumpTo = useCallback((t: number) => {
    const w = ref.current!;
    if (t >= w.t) w.advanceTo(Math.min(t, REPLAY_END));
    else ref.current = replayWorld(w.actions.filter((a) => a.t <= t), t);
    save(ref.current!);
    bump();
  }, [bump]);

  const restart = useCallback(() => {
    const w = new World();
    w.advanceTo(DEMO_START);
    ref.current = w;
    setPlaying(false);
    save(w);
    bump();
  }, [bump]);

  return { world: ref.current, playing, setPlaying, speed, setSpeed, pauseOnAlert, setPauseOnAlert, act, jumpTo, restart };
}

export type Sim = ReturnType<typeof useSim>;
