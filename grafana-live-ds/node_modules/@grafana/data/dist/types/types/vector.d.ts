declare global {
    interface Array<T> {
        /** @deprecated Use [idx]. This only exists to help migrate Vector to Array */
        get(idx: number): T;
        /** @deprecated Use [idx]. This only exists to help migrate Vector to Array */
        set(idx: number, value: T): void;
        /** @deprecated Use .push(value). This only exists to help migrate Vector to Array */
        add(value: T): void;
        /** @deprecated this is not necessary.  This only exists to help migrate Vector to Array */
        toArray(): T[];
    }
}
export declare function patchArrayVectorProrotypeMethods(): void;
