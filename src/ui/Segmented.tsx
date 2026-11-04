import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { SPRING } from './motion';

/** Segmented control with a sliding thumb (shared layout animation). Radio semantics for screen readers. */
export function Segmented<T extends string>({
  value, onChange, options, label, size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; aria?: string }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            className={on ? 'on' : ''}
            onClick={() => onChange(o.value)}
          >
            {on && <motion.span layoutId={`thumb-${id}`} className="seg-thumb" transition={SPRING} aria-hidden="true" />}
            <span className="seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
