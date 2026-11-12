import Cookies from 'js-cookie';
import { useCallback, useEffect, useState } from 'react';
import { useFirstMountState } from '../useFirstMountState/index.js';
import { useMountEffect } from '../useMountEffect/index.js';
import { useSyncedRef } from '../useSyncedRef/index.js';
import { isBrowser } from '../util/const.js';
const cookiesSetters = new Map();
const registerSetter = (key, setter) => {
    let setters = cookiesSetters.get(key);
    if (!setters) {
        setters = new Set();
        cookiesSetters.set(key, setters);
    }
    setters.add(setter);
};
const unregisterSetter = (key, setter) => {
    const setters = cookiesSetters.get(key);
    if (!setters) {
        return;
    }
    setters.delete(setter);
    if (setters.size === 0) {
        cookiesSetters.delete(key);
    }
};
const invokeRegisteredSetters = (key, value, skipSetter) => {
    const setters = cookiesSetters.get(key);
    if (!setters) {
        return;
    }
    for (const s of setters) {
        if (s !== skipSetter) {
            s(value);
        }
    }
};
/**
 * Manages a single cookie.
 *
 * @param key Name of the cookie to manage.
 * @param options Cookie options that will be used during setting and deleting the cookie.
 */
export function useCookieValue(key, options = {}) {
    if (process.env.NODE_ENV === 'development' && Cookies === undefined) {
        throw new ReferenceError('Dependency `js-cookies` is not installed, it is required for `useCookieValue` work.');
    }
    let { initializeWithValue = true, ...cookiesOptions } = options;
    if (!isBrowser) {
        initializeWithValue = false;
    }
    const methods = useSyncedRef({
        set(value) {
            setState(value);
            Cookies.set(key, value, cookiesOptions);
            // Update all other hooks with the same key
            invokeRegisteredSetters(key, value, setState);
        },
        remove() {
            setState(null);
            Cookies.remove(key, cookiesOptions);
            invokeRegisteredSetters(key, null, setState);
        },
        fetchVal: () => Cookies.get(key) ?? null,
        fetch() {
            const value = methods.current.fetchVal();
            setState(value);
            invokeRegisteredSetters(key, value, setState);
        },
    });
    const isFirstMount = useFirstMountState();
    const [state, setState] = useState(isFirstMount && initializeWithValue ? methods.current.fetchVal() : undefined);
    useMountEffect(() => {
        if (!initializeWithValue) {
            methods.current.fetch();
        }
    });
    useEffect(() => {
        registerSetter(key, setState);
        return () => {
            unregisterSetter(key, setState);
        };
    }, [key]);
    return [
        state,
        useCallback((value) => {
            methods.current.set(value);
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []),
        useCallback(() => {
            methods.current.remove();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []),
        useCallback(() => {
            methods.current.fetch();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []),
    ];
}
