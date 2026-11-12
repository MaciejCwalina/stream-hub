import { useCallback, useState } from 'react';
import { useSyncedRef } from '../useSyncedRef/index.js';
import { resolveHookState } from '../util/resolve-hook-state.js';
/**
 * Like `useState`, but every value set is passed through a mediator function.
 */
export function useMediatedState(initialState, mediator) {
    const [state, setState] = useState(() => (mediator ? mediator(resolveHookState(initialState)) : initialState));
    const mediatorRef = useSyncedRef(mediator);
    return [
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        state,
        useCallback((value) => {
            if (mediatorRef.current) {
                setState((previousState) => 
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                mediatorRef.current?.(resolveHookState(value, previousState)));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                setState(value);
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []),
    ];
}
