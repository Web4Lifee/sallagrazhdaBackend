/** The API uses euros (e.g. 35 or 12.5); the database stores integer cents. */
export const toCents = (euros: number): number => Math.round(euros * 100);

export const fromCents = (cents: number): number => cents / 100;

/** True when the value has at most two decimal places (allowing for float noise). */
export const hasAtMostTwoDecimals = (value: number): boolean =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
