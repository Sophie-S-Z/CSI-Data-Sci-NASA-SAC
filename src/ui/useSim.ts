import { useCallback, useEffect, useRef, useState } from 'react';
import mission from '../data/mission.json';
import { World, replayWorld, LEVEL_RANK, type Action, type Level, type RecordedAction } from '../engine/world';
import { at } from '../engine/time';

// A new key per release, so a judge never opens an old replay state (beta report D-8).
const KEY = 'vigil.replay.v4';
export const DEMO_START = at(mission.replay.demoStart.day, mission.replay.demoStart.hhmm);
export const REPLAY_END = at(mission.replay.endDay, '23:59');

export const SPEEDS = [
  { id: 'x60', label: '1 min/s', minPerSec: 1 },
  { id: 'x600', label: '10 min/s', minPerSec: 10 },
  { id: 'x3600', label: '1 h/s', minPerSec: 60 },
  { id: 'x14400', label: '4 h/s', minPerSec: 240 },
] as const;

/**
 * The demo steps. Each one jumps to a minute where the screen shows the level in `level`.
 * tests/demo.test.ts checks that each step shows its level.
 */
export const BEATS: { label: string; t: number; level: Level; text: string }[] = [
  { label: 'Solar flare', t: at(94, '00:24'), level: 'caution', text: 'An X5.4 flare and a fast CME erupt from the Sun. The dose rate at the ship is still normal, but the app gives a Caution: safe your task and stage the shelter.' },
  { label: 'Sensor spike', t: at(94, '03:11'), level: 'verify', text: 'One cabin sensor jumps. The other sensors do not agree, so the app asks you to check the sensor. It does not give a false Warning.' },
  { label: 'Dose rise', t: at(94, '06:30'), level: 'caution', text: 'Solar protons reach the ship. The cabin dose rate rises above 1.5 times the baseline on 2 or more sensors.' },
  { label: 'Warning', t: at(94, '08:45'), level: 'warning', text: 'The dose rate stays above 2 times the baseline for 30 min. The screen turns red. Press "Start procedure SH-1" and go to the shelter.' },
  { label: 'Peak', t: at(95, '17:00'), level: 'warning', text: 'The dose rate is about 35 times the baseline. Open Cabin radiation to see the dose that the shelter saves.' },
  { label: 'Leave shelter', t: at(98, '02:30'), level: 'caution', text: 'All sensors stay below 1.5 times the baseline for 1 h. The Warning drops to a Caution. You can leave the shelter.' },
];

/** The last step at or before t. -1 before the first step. */
export function beatIndex(t: number): number {
  let i = -1;
  while (i + 1 < BEATS.length && BEATS[i + 1].t <= t) i++;
  return i;
}

interface Saved { actions: RecordedAction[]; t: number }

// The world at the demo start, with no crew action. Jumps copy it, so they do not replay from day 88.
let base: World | null = null;

/** Build the world at minute t from the saved crew actions. */
function rebuild(actions: RecordedAction[], t: number): World {
  if (t < DEMO_START || actions.some((a) => a.t < DEMO_START)) return replayWorld(actions, t);
  if (!base) {
    base = new World();
    base.advanceTo(DEMO_START);
  }
  const w = base.clone();
  for (const ra of actions) {
    w.advanceTo(ra.t);
    w.apply(ra.action, ra.wall);
  }
  w.advanceTo(t);
  return w;
}

function load(): World {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.actions) && typeof s.t === 'number') return rebuild(s.actions, Math.min(s.t, REPLAY_END));
    }
  } catch {
    /* storage can be blocked; start fresh */
  }
  return rebuild([], DEMO_START);
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

/** True for a new replay: the demo start with no crew action. */
const isFresh = (w: World) => w.t === DEMO_START && w.actions.length === 0;

export function useSim() {
  const [world, setWorld] = useState(load);
  const [, setVersion] = useState(0);
  // A new replay starts by itself at 1 min/s, so the clock moves on the first screen. At the first alert it switches
  // to 1 h/s (and pauses, if "Pause at each new alert" is on), so the next Play reaches the later steps fast.
  // A speed choice, a jump, or a reset ends this intro. Reset demo leaves the replay paused.
  const [playing, setPlaying] = useState(() => isFresh(world));
  const [speed, setSpeedState] = useState<(typeof SPEEDS)[number]>(() => SPEEDS[isFresh(world) ? 0 : 2]);
  const intro = useRef(playing);
  const [pauseOnAlert, setPauseOnAlert] = useState(true);
  const carry = useRef(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const w = world;
      carry.current += speed.minPerSec / 10;
      const n = Math.floor(carry.current);
      carry.current -= n;
      for (let i = 0; i < n && w.t < REPLAY_END; i++) {
        w.step();
        const raised = raisedNow(w);
        if (raised && intro.current) {
          intro.current = false;
          setSpeedState(SPEEDS[2]);
        }
        if (pauseOnAlert && raised) {
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
  }, [world, playing, speed, pauseOnAlert, bump]);

  const setSpeed = useCallback((s: (typeof SPEEDS)[number]) => { intro.current = false; setSpeedState(s); }, []);

  const act = useCallback((a: Action) => {
    world.apply(a);
    save(world);
    bump();
  }, [world, bump]);

  const jumpTo = useCallback((t: number) => {
    intro.current = false;
    if (t >= world.t) {
      world.advanceTo(Math.min(t, REPLAY_END));
      save(world);
      bump();
      return;
    }
    const w = rebuild(world.actions.filter((a) => a.t <= t), t);
    save(w);
    setWorld(w);
  }, [world, bump]);

  const restart = useCallback(() => {
    intro.current = false;
    const w = rebuild([], DEMO_START);
    setPlaying(false);
    save(w);
    setWorld(w);
  }, []);

  return { world, playing, setPlaying, speed, setSpeed, pauseOnAlert, setPauseOnAlert, act, jumpTo, restart };
}

export type Sim = ReturnType<typeof useSim>;
