/**
 * Array Utilities
 *
 * Helpers for array manipulation.
 *
 * @module lib/utils/array
 */

/**
 * Group array items by a key
 */
export function groupBy<T, K extends string | number>(
    items: T[],
    keyFn: (item: T) => K
): Record<K, T[]> {
    return items.reduce((acc, item) => {
        const key = keyFn(item);
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(item);
        return acc;
    }, {} as Record<K, T[]>);
}

/**
 * Remove duplicates from array
 */
export function unique<T>(items: T[], keyFn?: (item: T) => unknown): T[] {
    if (!keyFn) {
        return [...new Set(items)];
    }
    const seen = new Set();
    return items.filter((item) => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/**
 * Flatten nested arrays
 */
export function flatten<T>(items: (T | T[])[]): T[] {
    return items.flat() as T[];
}

/**
 * Sort array by property
 */
export function sortBy<T>(
    items: T[],
    keyFn: (item: T) => string | number,
    order: 'asc' | 'desc' = 'asc'
): T[] {
    return [...items].sort((a, b) => {
        const aVal = keyFn(a);
        const bVal = keyFn(b);
        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

/**
 * Move item in array
 */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
    const result = [...items];
    const [removed] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, removed);
    return result;
}

/**
 * Find index by predicate
 */
export function findIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
    for (let i = 0; i < items.length; i++) {
        if (predicate(items[i])) return i;
    }
    return -1;
}

/**
 * Partition array into two based on predicate
 */
export function partition<T>(
    items: T[],
    predicate: (item: T) => boolean
): [T[], T[]] {
    const pass: T[] = [];
    const fail: T[] = [];
    for (const item of items) {
        if (predicate(item)) {
            pass.push(item);
        } else {
            fail.push(item);
        }
    }
    return [pass, fail];
}

/**
 * Get random item from array
 */
export function randomItem<T>(items: T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(Math.random() * items.length)];
}

/**
 * Shuffle array
 */
export function shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * Create range of numbers
 */
export function range(start: number, end: number, step = 1): number[] {
    const result: number[] = [];
    for (let i = start; i < end; i += step) {
        result.push(i);
    }
    return result;
}

/**
 * Sum array of numbers
 */
export function sum(items: number[]): number {
    return items.reduce((acc, item) => acc + item, 0);
}

/**
 * Average of array of numbers
 */
export function average(items: number[]): number {
    if (items.length === 0) return 0;
    return sum(items) / items.length;
}
