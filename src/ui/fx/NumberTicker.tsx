import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '../motion';

/**
 * Number ticker (Magic UI pattern, GSAP engine). The value rolls to its new reading,
 * so the eye sees the direction of change. Tabular figures keep the width fixed.
 */
export function NumberTicker({ value, digits = 1, className }: { value: number; digits?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useRef({ v: value });
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || Math.abs(value - state.current.v) < 10 ** -(digits + 1)) {
      state.current.v = value;
      el.textContent = fmt(value);
      return;
    }
    const tw = gsap.to(state.current, {
      v: value,
      duration: 0.6,
      ease: 'expo.out',
      overwrite: true,
      onUpdate: () => { el.textContent = fmt(state.current.v); },
    });
    return () => { tw.kill(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, digits]);

  return <span ref={ref} className={`num ${className ?? ''}`} aria-live="off">{fmt(state.current.v)}</span>;
}
