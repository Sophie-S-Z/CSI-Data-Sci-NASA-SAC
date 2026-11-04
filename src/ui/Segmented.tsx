import type { ReactNode } from 'react';

/** Segmented control. Radio semantics for screen readers. The selected option fills at once. */
export function Segmented<T extends string>({
  value, onChange, options, label, size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; aria?: string }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`seg ${size === 'sm' ? 'sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.aria}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
