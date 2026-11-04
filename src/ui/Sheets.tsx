import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import rules from '../data/rules.json';
import { resolveSource, sources } from './common';

/**
 * Source drawer (FR-06). Each threshold on screen opens this panel: the value, the
 * citation, the evidence level, and a flag when the value is a team value.
 */
export function SourceDrawer({ k, onClose }: { k: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  const views = resolveSource(k);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="src-h">
        <header>
          <h2 id="src-h">Source</h2>
          <button className="btn sm" onClick={onClose}><X size={16} weight="bold" aria-hidden="true" />Close</button>
        </header>
        <div className="content">
          {views.length === 0 && <p>No source entry for {k}.</p>}
          {views.map((v, i) => {
            const src = sources[v.sourceKey];
            return (
              <section key={i} className="src">
                <h3>{v.title}</h3>
                <div className="val">{v.value}</div>
                {v.team && <p><span className="team-flag">Team value for demo</span>Not a NASA flight rule.</p>}
                {v.basis && <p>{v.basis}</p>}
                {v.formula && <p className="num small">{v.formula}</p>}
                <p><strong>Citation.</strong> {src.citation} {src.url && <a href={src.url} target="_blank" rel="noreferrer">Open</a>}</p>
                <p className="muted"><strong>Evidence.</strong> {v.evidence}</p>
              </section>
            );
          })}
          <p className="note">All thresholds are in one file, rules.json ({rules.version}). The Science owner can change a value with no code change.</p>
        </div>
      </div>
    </div>
  );
}
