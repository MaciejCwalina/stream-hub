import { useState } from 'react';
import { useRafCallback } from '../useRafCallback/index.js';
import { useUnmountEffect } from '../useUnmountEffect/index.js';
/**
 * Like `React.useState`, but state is only updated within animation frame.
 */
export function useRafState(initialState) {
    // eslint-disable-next-line react/hook-use-state
    const [state, innerSetState] = useState(initialState);
    const [setState, cancelRaf] = useRafCallback(innerSetState);
    useUnmountEffect(cancelRaf);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return [state, setState];
}
