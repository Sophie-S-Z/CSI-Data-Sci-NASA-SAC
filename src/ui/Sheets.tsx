import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, CheckCircle, ArrowBendDownRight, SignOut } from '@phosphor-icons/react';
import { DUR, EASE_OUT, SPRING, SPRING_SOFT } from './motion';
import rules from '../data/rules.json';
import { PROCEDURE_SH1 } from '../engine/world';
import { duration, hhmm } from '../engine/time';
import { resolveSource, sources, useUi } from './common';

function Sheet({ title, onClose, className, children, extra }: { title: ReactNode; onClose: () => void; className?: string; children: ReactNode; extra?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <motion.div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DUR.fast } }}>
      <motion.div ref={ref} className={`sheet ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        initial={{ x: 48, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0, transition: { duration: DUR.fast, ease: EASE_OUT } }}
        transition={SPRING_SOFT}>
        <header>
          <h2>{title}</h2>
          {extra}
          <button className="btn small x" onClick={onClose}><X size={16} weight="bold" aria-hidden="true" />Close</button>
        </header>
        <div className="content">{children}</div>
      </motion.div>
    </motion.div>
  );
}

export function SourceSheet({ k, onClose }: { k: string; onClose: () => void }) {
  const views = resolveSource(k);
  return (
    <Sheet title="Source" onClose={onClose}>
      {views.length === 0 && <p>No source entry for {k}.</p>}
      {views.map((v, i) => {
        const src = sources[v.sourceKey];
        return (
          <div key={i} className="src-block">
            <h3>{v.title}</h3>
            <div className="val">{v.value}</div>
            {v.team && <p><span className="team-flag">Team value for demo</span> Not a NASA flight rule.</p>}
            {v.basis && <p>{v.basis}</p>}
            {v.formula && <p className="num" style={{ fontSize: 13 }}>{v.formula}</p>}
            <p><strong>Citation.</strong> {src.citation} {src.url && <a href={src.url} target="_blank" rel="noreferrer">Open</a>}</p>
            <p className="muted"><strong>Evidence level.</strong> {v.evidence}</p>
          </div>
        );
      })}
      <p className="faint" style={{ fontSize: 12.5 }}>All thresholds live in one file, rules.json ({rules.version}). The Science owner edits it without code.</p>
    </Sheet>
  );
}

export function ProcedureSheet({ onClose }: { onClose: () => void }) {
  const { sim, toast } = useUi();
  const w = sim.world;
  const p = w.procedure;
  const alert = p?.alertId ? w.alerts.find((a) => a.id === p.alertId) : undefined;
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((x) => x + 1), 500); return () => window.clearInterval(id); }, []);

  if (!p) {
    return (
      <Sheet title="SH-1 Storm shelter entry" onClose={onClose} className="proc">
        <p>No procedure is open. Open SH-1 from a Caution or Warning.</p>
      </Sheet>
    );
  }
  const confirmed = p.confirmed;
  const current = PROCEDURE_SH1.steps.find((s) => !confirmed[s.n]);
  const warnActive = w.activeAlerts.some((a) => a.level === 'warning');
  const startWall = alert?.levelWall ?? p.startedWall;
  const shelterWall = alert?.shelterWall;
  const elapsed = ((shelterWall ?? Date.now()) - startWall) / 1000;

  return (
    <Sheet
      title={<>{PROCEDURE_SH1.id} {PROCEDURE_SH1.title}</>}
      onClose={onClose}
      className="proc"
      extra={<span className="stopwatch" aria-label="Time since the alert" style={{ marginLeft: 'auto' }}>{shelterWall ? 'In shelter after ' : ''}{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>}
    >
      <div className="proc-progress" role="progressbar" aria-label="Procedure progress" aria-valuemin={0} aria-valuemax={PROCEDURE_SH1.steps.length} aria-valuenow={Object.keys(confirmed).length}>
        <motion.span initial={false} animate={{ scaleX: Object.keys(confirmed).length / PROCEDURE_SH1.steps.length }} transition={SPRING} />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{PROCEDURE_SH1.note} Tap Done on each step.</p>
      <ol className="steps">
        {PROCEDURE_SH1.steps.map((s) => {
          const done = confirmed[s.n];
          const isCur = current?.n === s.n;
          const blocked = s.waitsForClear && warnActive;
          return (
            <motion.li layout transition={SPRING} key={s.n} className={`step ${done ? 'done' : isCur ? 'current' : 'later'}`} aria-current={isCur ? 'step' : undefined}>
              {isCur && <motion.span layoutId="step-focus" className="step-focus" transition={SPRING} aria-hidden="true" />}
              <span className="n" aria-hidden="true">
                <AnimatePresence mode="wait" initial={false}>
                  {done ? (
                    <motion.svg key="ok" viewBox="0 0 24 24" width="30" height="30" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}>
                      <motion.path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: DUR.slow, ease: EASE_OUT }} />
                    </motion.svg>
                  ) : <motion.span key="n" exit={{ opacity: 0, scale: 0.8, transition: { duration: DUR.fast } }}>{s.n}</motion.span>}
                </AnimatePresence>
              </span>
              <div>
                <div className="t"><span className="sr-only">Step {s.n}. </span>{s.text}</div>
                {done && <div className="muted" style={{ fontSize: 13 }}>Done at {hhmm(done.t)}{done.choice === 'branch' ? ' · vest not found, CMO told' : ''}</div>}
                {isCur && s.waitsForClear && (
                  <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                    {blocked
                      ? `The Warning is active. It clears when all sensors stay below ${(3 * w.B).toFixed(2)} mSv/h for 2 h.`
                      : 'The Warning is clear. You can leave the shelter.'}
                    {w.inShelter && w.shelterIntervals.length > 0 && <> In the shelter for {duration(w.t - w.shelterIntervals[w.shelterIntervals.length - 1].start)}.</>}
                  </div>
                )}
              </div>
              {isCur && (
                <div className="acts">
                  {s.waitsForClear ? (
                    <button className="btn primary" disabled={blocked} data-autofocus onClick={() => {
                      sim.act({ type: 'procStep', step: s.n });
                      sim.act({ type: 'shelterExit' });
                      toast('Left the shelter');
                      onClose();
                    }}><SignOut size={18} aria-hidden="true" />{blocked ? 'Wait for clear' : 'Done. Leave the shelter'}</button>
                  ) : (
                    <button className="btn primary" data-autofocus style={{ minWidth: 140, minHeight: 56, fontSize: 17 }} onClick={() => sim.act({ type: 'procStep', step: s.n })}><CheckCircle size={20} weight="bold" aria-hidden="true" />Done</button>
                  )}
                  {s.branch && <button className="btn" onClick={() => sim.act({ type: 'procStep', step: s.n, choice: 'branch' })}><ArrowBendDownRight size={18} aria-hidden="true" />{s.branch.label}: go to step {s.branch.goto}</button>}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
      {w.m1Seconds.length > 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Time from Warning to shelter: <strong className="num">{Math.round(w.m1Seconds[w.m1Seconds.length - 1])} s</strong>. Metric M-1 target: median 60 s or less.</p>
      )}
    </Sheet>
  );
}
