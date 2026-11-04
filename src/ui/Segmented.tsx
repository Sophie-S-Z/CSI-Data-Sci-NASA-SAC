import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Segmented control. Radio semantics for screen readers.
 * A thumb slides to the selected option, so the eye follows the change.
 */
export function Segmented<T extends string>({
  value, onChange, options, label, size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; aria?: string }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  const host = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  useSlidingThumb(host, thumb, '[aria-checked="true"]', value);
  return (
    <div ref={host} className={`seg ${size === 'sm' ? 'sm' : ''}`} role="radiogroup" aria-label={label}>
      <span ref={thumb} className="seg-thumb" aria-hidden="true" />
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

/** Move a thumb element under the child that matches `selector`. CSS sets the transition. */
export function useSlidingThumb(
  host: React.RefObject<HTMLElement>,
  thumb: React.RefObject<HTMLElement>,
  selector: string,
  key: unknown,
) {
  useLayoutEffect(() => {
    const h = host.current, t = thumb.current;
    if (!h || !t) return;
    const place = () => {
      const el = h.querySelector<HTMLElement>(selector);
      if (!el) { t.style.opacity = '0'; return; }
      t.style.opacity = '1';
      t.style.width = `${el.offsetWidth}px`;
      t.style.height = `${el.offsetHeight}px`;
      t.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
    };
    place();
    // The first placement must not slide in from the left edge.
    requestAnimationFrame(() => t.dataset.ready = '1');
    const ro = new ResizeObserver(place);
    ro.observe(h);
    return () => ro.disconnect();
  }, [host, thumb, selector, key]);
}
