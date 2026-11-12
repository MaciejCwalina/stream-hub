import { isEqual } from '@ver0/deep-equal';
import { useEffect } from 'react';
import { useCustomCompareEffect } from '../useCustomCompareEffect/index.js';
/**
 * Like `useEffect`, but uses `@ver0/deep-equal` comparator function to validate deep
 * dependency changes.
 *
 * @param callback Function that will be passed to the underlying effect hook.
 * @param deps Dependency list like the one passed to `useEffect`.
 * @param effectHook Effect hook that will be used to run
 * `callback`. Must match the type signature of `useEffect`, meaning that the `callback` should be
 * placed as the first argument and the dependency list as second.
 * @param effectHookRestArgs Extra arguments that are passed to the `effectHook`
 * after the `callback` and the dependency list.
 */
export function useDeepCompareEffect(callback, deps, effectHook = useEffect, ...effectHookRestArgs) {
    useCustomCompareEffect(callback, deps, isEqual, effectHook, ...effectHookRestArgs);
}
