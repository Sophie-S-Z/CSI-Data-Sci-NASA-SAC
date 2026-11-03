import { useEffect, useRef, useState, type ReactNode } from 'react';
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
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`sheet ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header>
          <h2>{title}</h2>
          {extra}
          <button className="btn small x" onClick={onClose}>Close</button>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
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
      <p className="muted" style={{ marginTop: 0 }}>{PROCEDURE_SH1.note} Tap Done on each step.</p>
      <ol className="steps">
        {PROCEDURE_SH1.steps.map((s) => {
          const done = confirmed[s.n];
          const isCur = current?.n === s.n;
          const blocked = s.waitsForClear && warnActive;
          return (
            <li key={s.n} className={`step ${done ? 'done' : isCur ? 'current' : 'later'}`} aria-current={isCur ? 'step' : undefined}>
              <span className="n" aria-hidden="true">{done ? '✓' : s.n}</span>
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
                    }}>{blocked ? 'Wait for clear' : 'Done. Leave the shelter'}</button>
                  ) : (
                    <button className="btn primary" data-autofocus style={{ minWidth: 140, minHeight: 56, fontSize: 17 }} onClick={() => sim.act({ type: 'procStep', step: s.n })}>Done</button>
                  )}
                  {s.branch && <button className="btn" onClick={() => sim.act({ type: 'procStep', step: s.n, choice: 'branch' })}>{s.branch.label}: go to step {s.branch.goto}</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {w.m1Seconds.length > 0 && (
        <p className="muted" style={{ marginTop: 16 }}>Time from Warning to shelter: <strong className="num">{Math.round(w.m1Seconds[w.m1Seconds.length - 1])} s</strong>. Metric M-1 target: median 60 s or less.</p>
      )}
    </Sheet>
  );
}
