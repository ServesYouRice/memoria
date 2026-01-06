/**
 * Type declarations for zxcvbn password strength checker
 * @see https://github.com/dropbox/zxcvbn
 */

declare module 'zxcvbn' {
    interface ZxcvbnFeedback {
        warning: string;
        suggestions: string[];
    }

    interface ZxcvbnResult {
        /** 0-4 integer score (0 = weak, 4 = very strong) */
        score: 0 | 1 | 2 | 3 | 4;
        /** Feedback for the user */
        feedback: ZxcvbnFeedback;
        /** Estimated guesses needed to crack password */
        guesses: number;
        /** Order of magnitude of guesses */
        guesses_log10: number;
        /** Estimated crack times in various scenarios */
        crack_times_seconds: {
            online_throttling_100_per_hour: number;
            online_no_throttling_10_per_second: number;
            offline_slow_hashing_1e4_per_second: number;
            offline_fast_hashing_1e10_per_second: number;
        };
        /** Human-readable crack time estimates */
        crack_times_display: {
            online_throttling_100_per_hour: string;
            online_no_throttling_10_per_second: string;
            offline_slow_hashing_1e4_per_second: string;
            offline_fast_hashing_1e10_per_second: string;
        };
        /** Password token sequence */
        sequence: Array<{
            pattern: string;
            token: string;
            i: number;
            j: number;
            guesses: number;
            guesses_log10: number;
        }>;
        /** Calculation time in milliseconds */
        calc_time: number;
    }

    /**
     * Evaluate password strength
     * @param password - Password to evaluate
     * @param userInputs - Optional array of user-specific inputs to penalize (email, username, etc.)
     */
    function zxcvbn(password: string, userInputs?: string[]): ZxcvbnResult;

    export default zxcvbn;
}
