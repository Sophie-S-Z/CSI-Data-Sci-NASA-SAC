import { useEffect, type RefObject } from 'react';
import { animate, svg } from 'animejs';
import { prefersReducedMotion } from '../motion';

/**
 * Draws an SVG line from its start to its end once (anime.js drawable).
 * After the draw, the inline dash styles go away, so later data updates and CSS dashes work.
 */
export function useDrawIn(ref: RefObject<SVGGeometryElement>, key: unknown, duration = 900) {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const cleanup = () => {
      el.removeAttribute('pathLength');
      el.style.strokeDasharray = '';
      el.style.strokeDashoffset = '';
    };
    const [d] = svg.createDrawable(el);
    const a = animate(d, { draw: ['0 0', '0 1'], duration, ease: 'outExpo', onComplete: cleanup });
    return () => { a.pause(); cleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
