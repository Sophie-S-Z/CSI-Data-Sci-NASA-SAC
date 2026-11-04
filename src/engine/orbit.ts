/**
 * Simple heliocentric geometry for the mission view. Circular, coplanar orbits and a
 * Hohmann-type transfer ellipse. Good enough to show where the vehicle is and how far
 * a signal must travel. It is not a navigation solution.
 */
export const AU_LIGHT_SECONDS = 499.0;
const EARTH_DAYS = 365.25;
const MARS_DAYS = 686.98;
export const R_EARTH = 1.0;
export const R_MARS = 1.524;
export const TRANSIT_DAYS = 180;
export const TRANSFER_A = (R_EARTH + R_MARS) / 2;
export const TRANSFER_E = (R_MARS - R_EARTH) / (R_MARS + R_EARTH);

export interface Vec2 { x: number; y: number }

const polar = (r: number, th: number): Vec2 => ({ x: r * Math.cos(th), y: r * Math.sin(th) });

export function earthAt(day: number): Vec2 {
  return polar(R_EARTH, (2 * Math.PI * day) / EARTH_DAYS);
}

/** Mars reaches angle π (the transfer aphelion) on arrival day. */
export function marsAt(day: number): Vec2 {
  return polar(R_MARS, Math.PI - (2 * Math.PI * (TRANSIT_DAYS - day)) / MARS_DAYS);
}

/** True anomaly on the transfer for a fraction 0..1 of the transit time (Kepler's equation). */
export function transferAnomaly(frac: number): number {
  const M = Math.PI * Math.min(Math.max(frac, 0), 1);
  let E = M;
  for (let i = 0; i < 12; i++) E -= (E - TRANSFER_E * Math.sin(E) - M) / (1 - TRANSFER_E * Math.cos(E));
  return 2 * Math.atan(Math.sqrt((1 + TRANSFER_E) / (1 - TRANSFER_E)) * Math.tan(E / 2));
}

export function transferPoint(nu: number): Vec2 {
  const r = (TRANSFER_A * (1 - TRANSFER_E ** 2)) / (1 + TRANSFER_E * Math.cos(nu));
  return polar(r, nu);
}

export function vehicleAt(day: number): Vec2 {
  if (day >= TRANSIT_DAYS) return marsAt(TRANSIT_DAYS);
  return transferPoint(transferAnomaly(day / TRANSIT_DAYS));
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** One-way light time from the vehicle to Earth, in minutes. */
export function lightMinutes(day: number): number {
  return (dist(vehicleAt(day), earthAt(day)) * AU_LIGHT_SECONDS) / 60;
}
