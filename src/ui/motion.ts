/**
 * Motion tokens. One rhythm for the whole app.
 * Rules: motion shows a cause and its effect. Nothing loops on the alarm path.
 * prefers-reduced-motion turns all of it off (MotionConfig, GSAP matchMedia, anime checks).
 */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]; // ease-out-expo
export const EASE_IN: [number, number, number, number] = [0.7, 0, 0.84, 0];
export const DUR = { fast: 0.15, base: 0.24, slow: 0.4 } as const;

/** Critically damped spring: weight with no overshoot (alarms must not wobble). */
export const SPRING = { type: 'spring', stiffness: 420, damping: 40, mass: 1 } as const;
export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 34, mass: 1 } as const;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
