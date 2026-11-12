import type { RefObject } from 'react';
export type HookableRefHandler<T> = (v: T) => T;
export declare function useHookableRef<T>(initialValue: T, onSet?: HookableRefHandler<T>, onGet?: HookableRefHandler<T>): RefObject<T>;
export declare function useHookableRef<T = undefined>(): RefObject<T | null | undefined>;
