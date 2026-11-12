import { useStorageValue } from '../useStorageValue/index.js';
import { isBrowser, noop } from '../util/const.js';
let IS_LOCAL_STORAGE_AVAILABLE;
try {
    IS_LOCAL_STORAGE_AVAILABLE = isBrowser && Boolean(globalThis.localStorage);
}
catch {
    IS_LOCAL_STORAGE_AVAILABLE = false;
}
/**
 * Manages a single localStorage key.
 */
export const useLocalStorageValue = IS_LOCAL_STORAGE_AVAILABLE
    ? (key, options) => useStorageValue(localStorage, key, options)
    : (_key, _options) => {
        if (isBrowser && process.env.NODE_ENV === 'development') {
            console.warn('LocalStorage is not available in this environment');
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        return { value: undefined, set: noop, remove: noop, fetch: noop };
    };
