/**
 * Round half away from zero ('commercial' rounding)
 * Uses correction to offset floating-point inaccuracies.
 * Works symmetrically for positive and negative numbers.
 *
 * ref: https://stackoverflow.com/a/48764436
 */
export declare function roundDecimals(val: number, dec?: number): number;
/**
 * Tries to guess number of decimals needed to format a number
 *
 * used for determining minimum decimals required to uniformly
 * format a numric sequence, e.g. 10, 10.125, 10.25, 10.5
 *
 * good for precisce increments:  0.125            -> 3
 * bad  for arbitrary floats:     371.499999999999 -> 12
 */
export declare function guessDecimals(num: number): number;
