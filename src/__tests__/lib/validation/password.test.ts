import { describe, it, expect } from 'vitest';
import {
  validatePasswordStrength,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_SCORE,
} from '@/lib/validation/password';

describe('Password Validation', () => {
  describe('validatePasswordStrength', () => {
    it('should reject passwords shorter than minimum length', () => {
      const result = validatePasswordStrength('short');
      expect(result.isValid).toBe(false);
      expect(result.score).toBe(0);
      expect(result.feedback.warning).toContain(`at least ${PASSWORD_MIN_LENGTH} characters`);
    });

    it('should reject weak passwords (score < 3)', () => {
      const result = validatePasswordStrength('password123');
      expect(result.isValid).toBe(false);
      expect(result.score).toBeLessThan(PASSWORD_MIN_SCORE);
    });

    it('should accept strong passwords (score >= 3)', () => {
      const result = validatePasswordStrength('MyStr0ng!P@ssw0rd2024');
      expect(result.isValid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(PASSWORD_MIN_SCORE);
    });

    it('should detect password based on user inputs', () => {
      const email = 'alice@example.com';
      const name = 'Alice';

      // Password containing user info should be weak
      const result1 = validatePasswordStrength('alice12345', [email, name]);
      expect(result1.score).toBeLessThan(3);

      // Password not containing user info should be stronger
      const result2 = validatePasswordStrength('C0mpl3xP@ssw0rd!', [email, name]);
      expect(result2.score).toBeGreaterThanOrEqual(3);
    });

    it('should provide helpful feedback for weak passwords', () => {
      const result = validatePasswordStrength('abcdefghij');
      expect(result.isValid).toBe(false);
      expect(result.feedback.suggestions.length).toBeGreaterThan(0);
    });

    it('should handle edge cases', () => {
      // Empty password
      const result1 = validatePasswordStrength('');
      expect(result1.isValid).toBe(false);

      // Very long strong password
      const result2 = validatePasswordStrength(
        'Th!s1sAV3ryL0ng@ndC0mpl3xP@ssw0rdW1thL0ts0fCh@r@ct3rs!'
      );
      expect(result2.isValid).toBe(true);
    });
  });
});
