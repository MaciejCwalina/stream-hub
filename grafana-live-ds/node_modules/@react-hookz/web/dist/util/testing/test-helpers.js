import { expect } from 'vitest';
/**
 * Helper to assert that a hook result is successful and extract its value.
 */
export function expectResultValue(result) {
    expect(result.error).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return result.value;
}
