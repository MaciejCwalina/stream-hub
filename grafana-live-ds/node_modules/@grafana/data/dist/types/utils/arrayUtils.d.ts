import { SortOrder } from '@grafana/schema';
/** @internal */
export declare function moveItemImmutably<T>(arr: T[], from: number, to: number): T[];
/** @internal */
export declare function insertBeforeImmutably<T>(array: T[], item: T, index: number): T[];
/** @internal */
export declare function insertAfterImmutably<T>(array: T[], item: T, index: number): T[];
export declare function sortValues(sort: SortOrder.Ascending | SortOrder.Descending): (a: unknown, b: unknown) => number;
