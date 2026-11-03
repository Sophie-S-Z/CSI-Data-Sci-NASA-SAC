import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { MagnifyingGlass, ArrowRight } from '@phosphor-icons/react';
import { LINK_LABEL, type LinkState } from '../engine/world';
import { BEATS } from './useSim';
import { useUi, type Tab } from './common';
import { DUR, EASE_OUT } from './motion';

interface Cmd { id: string; group: string; label: string; hint?: string; run: () => void }

/** Command menu (Ctrl+K or Cmd+K). Every main action in one keyboard path. */
export function CommandMenu({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const { sim } = ui;
  const w = sim.world;
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const cmds = useMemo<Cmd[]>(() => {
    const top = w.activeAlerts.find((a) => !a.suppressed);
    const list: Cmd[] = [];
    if (top && (top.level === 'warning' || top.level === 'caution')) {
      list.push({ id: 'proc', group: 'Act', label: 'Open procedure SH-1', hint: top.id, run: () => { sim.act({ type: 'procStart', alertId: top.id }); ui.openProcedure(); } });
    }
    if (top && !top.acked) list.push({ id: 'ack', group: 'Act', label: `Acknowledge ${top.id}`, run: () => sim.act({ type: 'ack', alertId: top.id }) });
    if (w.inShelter && !w.activeAlerts.some((a) => a.level === 'warning')) list.push({ id: 'exit', group: 'Act', label: 'Leave the shelter', run: () => sim.act({ type: 'shelterExit' }) });
    list.push({ id: 'checkin', group: 'Act', label: 'Start the daily check-in', run: () => ui.go('checkin') });
    const tabs: [Tab, string][] = [['console', 'Console'], ['checkin', 'Check-in'], ['log', 'Log'], ['cmo', 'CMO case view'], ['ground', 'Link to Earth'], ['sources', 'Rules and sources'], ['systems', 'Body systems']];
    tabs.forEach(([t, l]) => list.push({ id: `go-${t}`, group: 'Go to', label: l, run: () => ui.go(t) }));
    BEATS.forEach((b) => list.push({ id: `beat-${b.label}`, group: 'Replay', label: `Jump to ${b.label.toLowerCase()}`, run: () => sim.jumpTo(b.t) }));
    list.push({ id: 'play', group: 'Replay', label: sim.playing ? 'Pause the replay' : 'Play the replay', run: () => sim.setPlaying(!sim.playing) });
    (['live', 'd5', 'd14', 'd22', 'blackout'] as LinkState[]).forEach((l) => list.push({ id: `link-${l}`, group: 'Link', label: `Set link: ${LINK_LABEL[l]}`, run: () => sim.act({ type: 'link', link: l }) }));
    ['R-A1', 'R-V1', 'R-C1', 'R-W1'].forEach((r) => list.push({ id: `src-${r}`, group: 'Sources', label: `Show source for rule ${r}`, run: () => ui.openSource(r) }));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.t, sim.playing]);

  const shown = cmds.filter((c) => (c.label + c.group).toLowerCase().includes(q.trim().toLowerCase()));
  const sel = Math.min(i, Math.max(0, shown.length - 1));

  function run(c: Cmd) { onClose(); c.run(); }

  return (
    <motion.div className="scrim cmd-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DUR.fast } }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="cmd" role="dialog" aria-modal="true" aria-label="Command menu"
        initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: DUR.fast } }}
        transition={{ duration: DUR.base, ease: EASE_OUT }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, shown.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
          if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
        }}>
        <div className="cmd-input">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Type an action, a view, or a rule" aria-label="Search actions" aria-controls="cmd-list" aria-activedescendant={shown[sel] ? `cmd-${shown[sel].id}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmd-list" className="cmd-list" role="listbox">
          {shown.length === 0 && <li className="cmd-empty">No action matches "{q}". Try "shelter", "link", or a rule such as "R-W1".</li>}
          {shown.map((c, k) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={k === sel} className={k === sel ? 'sel' : ''}
              onMouseEnter={() => setI(k)} onClick={() => run(c)}>
              {k === sel && <motion.span layoutId="cmd-sel" className="cmd-sel" transition={{ duration: DUR.fast, ease: EASE_OUT }} />}
              <span className="cmd-group">{c.group}</span>
              <span className="cmd-label">{c.label}</span>
              {c.hint && <span className="cmd-hint num">{c.hint}</span>}
              <ArrowRight size={14} className="cmd-arrow" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}
