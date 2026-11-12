import { useMemo, useRef } from 'react';
import { useAsync } from '../useAsync/index.js';
/**
 * Like `useAsync`, but also provides `AbortSignal` as the first argument to the async function.
 *
 * @param asyncFn Function that returns a promise.
 * @param initialValue Value that will be set on initialisation before the async function is
 * executed.
 */
export function useAsyncAbortable(asyncFn, initialValue) {
    const abortController = useRef(undefined);
    const fn = async (...args) => {
        // Abort previous async
        abortController.current?.abort();
        // Create new controller for ongoing async call
        const ac = new AbortController();
        abortController.current = ac;
        // Pass down abort signal and received arguments
        // eslint-disable-next-line promise/prefer-await-to-then
        return asyncFn(ac.signal, ...args).finally(() => {
            // Unset ref uf the call is last
            if (abortController.current === ac) {
                abortController.current = undefined;
            }
        });
    };
    const [state, asyncActions, asyncMeta] = useAsync(fn, initialValue);
    return [
        state,
        useMemo(() => {
            const actions = {
                reset() {
                    actions.abort();
                    asyncActions.reset();
                },
                abort() {
                    abortController.current?.abort();
                },
            };
            return {
                ...asyncActions,
                ...actions,
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []),
        { ...asyncMeta, abortController: abortController.current },
    ];
}
