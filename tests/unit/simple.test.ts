import { describe, it, expect } from 'vitest';
import { add, TEST_CONSTANT } from '../../src/lib/test-utils';

describe('Sanity Check', () => {
    it('should run a simple test', () => {
        expect(1 + 1).toBe(2);
    });

    it('should import project code', () => {
        expect(TEST_CONSTANT).toBe(42);
        expect(add(1, 2)).toBe(3);
    });
});
