/**
 * Object Utilities
 *
 * Helpers for object manipulation.
 *
 * @module lib/utils/object
 */

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    if (Array.isArray(obj)) return obj.map(deepClone) as unknown as T;

    const cloned = {} as T;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}

/**
 * Deep merge objects
 */
export function deepMerge<T extends object>(target: T, ...sources: Partial<T>[]): T {
    const result = deepClone(target);

    for (const source of sources) {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                const value = source[key];
                if (value !== undefined) {
                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        (result as any)[key] = deepMerge((result as any)[key] || {}, value);
                    } else {
                        (result as any)[key] = value;
                    }
                }
            }
        }
    }

    return result;
}

/**
 * Pick specific keys from object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
}

/**
 * Omit specific keys from object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
    const result = { ...obj };
    for (const key of keys) {
        delete result[key];
    }
    return result as Omit<T, K>;
}

/**
 * Check if object is empty
 */
export function isEmpty(obj: object): boolean {
    return Object.keys(obj).length === 0;
}

/**
 * Get nested value by path
 */
export function getByPath(obj: object, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

/**
 * Set nested value by path
 */
export function setByPath<T extends object>(obj: T, path: string, value: unknown): T {
    const result = deepClone(obj);
    const parts = path.split('.');
    let current: Record<string, unknown> = result as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
    return result;
}

/**
 * Compare two objects for equality
 */
export function isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object') return a === b;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, i) => isEqual(item, b[i]));
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) =>
        isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
}

/**
 * Get diff between two objects
 */
export function getDiff<T extends object>(before: T, after: T): Partial<T> {
    const diff: Partial<T> = {};

    for (const key of Object.keys(after) as (keyof T)[]) {
        if (!isEqual(before[key], after[key])) {
            diff[key] = after[key];
        }
    }

    return diff;
}
