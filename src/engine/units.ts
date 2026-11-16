import rules from '../data/rules.json';

/**
 * NFR-02. The screen shows dose equivalent in mSv. This file holds the two
 * conversion factors from absorbed dose (mGy). No other file converts units.
 * The baseline B is galactic cosmic rays (GCR). The dose above B in a solar
 * particle event (SPE) is protons, which have a lower quality factor.
 */
export const MSV_PER_MGY: number = rules.units.mSvPerMGy;
const SPE_MSV_PER_MGY: number = rules.units.speMSvPerMGy;
/** SPE dose equivalent per GCR dose equivalent, for the same absorbed dose. */
export const SPE_PER_GCR = SPE_MSV_PER_MGY / MSV_PER_MGY;

/**
 * The rules count multiples of the absorbed baseline rate, as RAD measures it.
 * atMultiple gives the dose-equivalent rate (mSv/h) at k × B, for a baseline B in mSv/h.
 * multipleOf is its inverse.
 */
export const atMultiple = (k: number, B: number): number => B * (Math.min(k, 1) + Math.max(0, k - 1) * SPE_PER_GCR);
export const multipleOf = (v: number, B: number): number => (v <= B ? v / B : 1 + (v / B - 1) / SPE_PER_GCR);

/**
 * Number style for the whole app. It follows the NASA technical publication style and
 * the MSL RAD papers (for example 1.84 mSv/d and 0.481 mGy/d):
 * - Measured and modeled values: 3 significant figures, a zero before the decimal point,
 *   and a comma between thousands. fmt() is the only function that rounds these values.
 * - Counts, percents of a whole, and minutes: whole numbers (whole()).
 * - Limits and rule thresholds: the value as the standard or rules.json defines it.
 */
const SIG3 = new Intl.NumberFormat('en-US', { minimumSignificantDigits: 3, maximumSignificantDigits: 3 });
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function fmt(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return value === 0 ? '0' : SIG3.format(value);
}

export function whole(value: number): string {
  return WHOLE.format(Math.round(value));
}
