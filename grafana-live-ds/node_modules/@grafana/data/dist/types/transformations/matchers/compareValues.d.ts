import { ComparisonOperation } from '@grafana/schema';
/**
 * Compare two values
 *
 * @internal -- not yet exported in `@grafana/data`
 */
export declare function compareValues(left: string | number | boolean | null | undefined, op: ComparisonOperation, right: string | number | boolean | null | undefined): boolean;
