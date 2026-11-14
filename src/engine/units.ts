import rules from '../data/rules.json';

/**
 * NFR-02. Sensors give absorbed dose in mGy. The screen shows dose equivalent in mSv.
 * This file holds the one conversion factor. No other file converts units.
 */
export const MSV_PER_MGY: number = rules.units.mSvPerMGy;

export const toMSv = (mGy: number): number => mGy * MSV_PER_MGY;
export const toMGy = (mSv: number): number => mSv / MSV_PER_MGY;

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
