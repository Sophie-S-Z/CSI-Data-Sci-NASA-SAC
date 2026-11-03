/** Mission time is a whole number of minutes after launch (day 0, 00:00). */
export const MIN_PER_DAY = 1440;

export function at(day: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return day * MIN_PER_DAY + h * 60 + m;
}

export function dayOf(t: number): number {
  return Math.floor(t / MIN_PER_DAY);
}

export function minuteOfDay(t: number): number {
  return ((t % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
}

export function hhmm(t: number): string {
  const m = minuteOfDay(t);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function stamp(t: number): string {
  return `Day ${String(dayOf(t)).padStart(3, '0')} ${hhmm(t)}`;
}

export function duration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
