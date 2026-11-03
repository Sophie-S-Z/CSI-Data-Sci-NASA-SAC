import rules from '../data/rules.json';

/**
 * NFR-02. Sensors give absorbed dose in mGy. The screen shows dose equivalent in mSv.
 * This file holds the one conversion factor. No other file converts units.
 */
export const MSV_PER_MGY: number = rules.units.mSvPerMGy;

export const toMSv = (mGy: number): number => mGy * MSV_PER_MGY;
export const toMGy = (mSv: number): number => mSv / MSV_PER_MGY;

export function fmt(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
