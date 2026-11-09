import { useState } from 'react';
import { Play, Pause, RotateCcw, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LINK_LABEL, type LinkState } from '../engine/world';
import { SPEEDS, BEATS, REPLAY_END } from '../ui/useSim';
import { useUi } from './context';

const LINKS: { value: LinkState; label: string }[] = [
  { value: 'live', label: 'Live' }, { value: 'd5', label: '5 min' }, { value: 'd14', label: '14 min' }, { value: 'd22', label: '22 min' }, { value: 'blackout', label: 'Offline' },
];

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors', value === o.value ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Demo controls. They drive the replay for judges. They are not part of the crew tool. */
export function DemoDock() {
  const { sim, note } = useUi();
  const w = sim.world;
  const [open, setOpen] = useState(false);
  const atEnd = w.t >= REPLAY_END;
  const progress = Math.min(1, (w.t - w.startT) / (REPLAY_END - w.startT));
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-3 lg:bottom-4 lg:pl-60">
      <div className="glass pointer-events-auto w-full max-w-4xl overflow-hidden rounded-2xl ring-hairline" aria-label="Demo controls" role="region">
        <div className="h-0.5 bg-muted" aria-hidden="true"><div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress * 100}%` }} /></div>
        <div className="flex items-center gap-2 p-2">
          <span className="hidden items-center gap-1.5 pl-1 text-xs font-semibold text-muted-foreground sm:flex"><SlidersHorizontal className="size-3.5" aria-hidden="true" />Demo</span>
          <Button size="sm" className="h-8 rounded-lg" disabled={atEnd} onClick={() => sim.setPlaying(!sim.playing)} aria-pressed={sim.playing}>
            {sim.playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{sim.playing ? 'Pause' : 'Play'}
          </Button>
          <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto" role="group" aria-label="Jump to a demo beat">
            {BEATS.map((b, i) => (
              <button key={b.label} onClick={() => sim.jumpTo(b.t)}
                className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-accent', w.t >= b.t ? 'text-foreground' : 'text-muted-foreground')}>
                <span className={cn('num grid size-5 place-items-center rounded-full text-[10px]', w.t >= b.t ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{i + 1}</span>{b.label}
              </button>
            ))}
          </div>
          <Button size="icon" variant="ghost" className="size-8 rounded-lg" aria-expanded={open} aria-label={open ? 'Hide demo settings' : 'Show demo settings'} onClick={() => setOpen(!open)}>
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </Button>
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2.5 text-xs">
                <label className="flex items-center gap-2"><span className="text-muted-foreground">Speed</span>
                  <Seg label="Replay speed" value={sim.speed.id} onChange={(id) => sim.setSpeed(SPEEDS.find((s) => s.id === id)!)} options={SPEEDS.map((s) => ({ value: s.id, label: s.label }))} />
                </label>
                <label className="flex items-center gap-2"><span className="text-muted-foreground">Link</span>
                  <Seg<LinkState> label="Link to Earth" value={w.link} onChange={(l) => { sim.act({ type: 'link', link: l }); note(`Link set to ${LINK_LABEL[l].toLowerCase()}`); }} options={LINKS} />
                </label>
                <label className="flex items-center gap-2"><Switch checked={sim.pauseOnAlert} onCheckedChange={sim.setPauseOnAlert} />Pause on new alert</label>
                <Button size="sm" variant="ghost" className="h-7" onClick={sim.restart}><RotateCcw className="size-3.5" aria-hidden="true" />Restart</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
