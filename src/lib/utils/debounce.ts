/**
 * Debounce and Throttle Utilities
 *
 * @module lib/utils/debounce
 */

/**
 * Debounce a function
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;

    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * Debounce with leading and trailing calls
 */
export function debounceLeadingTrailing<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastCallTime = 0;

    return (...args: Parameters<T>) => {
        const now = Date.now();

        if (now - lastCallTime >= delay) {
            fn(...args);
            lastCallTime = now;
        }

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            fn(...args);
            lastCallTime = Date.now();
        }, delay);
    };
}

/**
 * Rate limit a function
 */
export function rateLimit<T extends (...args: any[]) => any>(
    fn: T,
    maxCalls: number,
    period: number
): (...args: Parameters<T>) => boolean {
    const calls: number[] = [];

    return (...args: Parameters<T>): boolean => {
        const now = Date.now();

        // Remove calls outside the period
        while (calls.length > 0 && calls[0] < now - period) {
            calls.shift();
        }

        if (calls.length < maxCalls) {
            calls.push(now);
            fn(...args);
            return true;
        }

        return false;
    };
}

/**
 * Memoize a function with a cache
 */
export function memoize<T extends (...args: any[]) => any>(
    fn: T,
    getKey?: (...args: Parameters<T>) => string
): T {
    const cache = new Map<string, ReturnType<T>>();

    return ((...args: Parameters<T>) => {
        const key = getKey ? getKey(...args) : JSON.stringify(args);

        if (cache.has(key)) {
            return cache.get(key)!;
        }

        const result = fn(...args);
        cache.set(key, result);
        return result;
    }) as T;
}

/**
 * Memoize with TTL
 */
export function memoizeWithTtl<T extends (...args: any[]) => any>(
    fn: T,
    ttlMs: number,
    getKey?: (...args: Parameters<T>) => string
): T {
    const cache = new Map<string, { value: ReturnType<T>; expires: number }>();

    return ((...args: Parameters<T>) => {
        const key = getKey ? getKey(...args) : JSON.stringify(args);
        const now = Date.now();
        const cached = cache.get(key);

        if (cached && cached.expires > now) {
            return cached.value;
        }

        const result = fn(...args);
        cache.set(key, { value: result, expires: now + ttlMs });
        return result;
    }) as T;
}
