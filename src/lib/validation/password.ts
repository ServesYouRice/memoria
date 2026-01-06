// zxcvbn is now lazy-loaded

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MIN_SCORE = 3; // zxcvbn score 0-4, we require >= 3

export interface PasswordStrengthResult {
  score: number;
  feedback: {
    warning: string;
    suggestions: string[];
  };
  isValid: boolean;
}

/**
 * Validate password strength using zxcvbn
 * Following ADR-0008: Enforce zxcvbn score >= 3
 *
 * @param password - The password to validate
 * @param userInputs - Optional array of user-specific inputs (email, name) to check against
 * @returns Password strength result
 */
/**
 * Validate password strength using zxcvbn (Lazy Loaded)
 * Following ADR-0008: Enforce zxcvbn score >= 3
 *
 * @param password - The password to validate
 * @param userInputs - Optional array of user-specific inputs (email, name) to check against
 * @returns Password strength result
 */
export async function validatePasswordStrength(
  password: string,
  userInputs: string[] = []
): Promise<PasswordStrengthResult> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      score: 0,
      feedback: {
        warning: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
        suggestions: [],
      },
      isValid: false,
    };
  }

  const { default: zxcvbn } = await import('zxcvbn');
  const result = zxcvbn(password, userInputs);

  return {
    score: result.score,
    feedback: {
      warning: result.feedback.warning || '',
      suggestions: result.feedback.suggestions || [],
    },
    isValid: result.score >= PASSWORD_MIN_SCORE,
  };
}
