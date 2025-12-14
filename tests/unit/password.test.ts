import { describe, it, expect } from 'vitest';
import { validatePasswordStrength } from '../src/lib/validation/password';

describe('Password Validation', () => {
    it('should fail for short passwords', async () => {
        const result = await validatePasswordStrength('short');
        expect(result.isValid).toBe(false);
        expect(result.feedback.warning).toBeDefined();
    });

    it('should pass for strong passwords', async () => {
        // A long password to ensure zxcvbn gives it a good score
        const result = await validatePasswordStrength('correct-horse-battery-staple-long');
        expect(result.isValid).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(3);
    });
});
