import { useMemo } from 'react';
import { useMediatedState } from '../useMediatedState/index.js';
import { useSyncedRef } from '../useSyncedRef/index.js';
import { resolveHookState } from '../util/resolve-hook-state.js';
/**
 * Tracks a numeric value.
 *
 * @param initialValue The initial value of the counter.
 * @param max The maximum value the counter is allowed to reach.
 *            If `initialValue` is greater than `max`, then `max` is set as the initial value.
 * @param min The minimum value the counter is allowed to reach.
 *            If `initialValue` is smaller than `min`, then `min` is set as the initial value.
 */
export function useCounter(initialValue = 0, max, min) {
    const [state, setState] = useMediatedState(initialValue, (v) => {
        if (max !== undefined) {
            v = Math.min(max, v);
        }
        if (min !== undefined) {
            v = Math.max(min, v);
        }
        return v;
    });
    const stateRef = useSyncedRef(state);
    return [
        state,
        useMemo(() => ({
            get: () => stateRef.current,
            set: setState,
            dec(delta = 1) {
                setState((value) => value - resolveHookState(delta, value));
            },
            inc(delta = 1) {
                setState((value) => value + resolveHookState(delta, value));
            },
            reset(value = initialValue) {
                setState((v) => resolveHookState(value, v));
            },
        }), [initialValue, setState, stateRef]),
    ];
}
