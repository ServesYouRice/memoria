/**
 * Performance Measurement Utilities
 *
 * Simple utilities for measuring component and operation performance.
 *
 * @module lib/utils/performance
 */

import { logger } from '@/lib/logger';

/**
 * Measure execution time of a sync function
 */
export function measureSync<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
        const result = fn();
        const duration = performance.now() - start;
        logPerformance(name, duration);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        logPerformance(name, duration, true);
        throw error;
    }
}

/**
 * Measure execution time of an async function
 */
export async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
        const result = await fn();
        const duration = performance.now() - start;
        logPerformance(name, duration);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        logPerformance(name, duration, true);
        throw error;
    }
}

/**
 * Log performance measurement
 */
function logPerformance(name: string, durationMs: number, failed = false): void {
    const severity = durationMs > 1000 ? 'warn' : 'debug';
    const method = failed ? 'warn' : severity;

    logger[method]({
        type: 'performance',
        operation: name,
        durationMs: Math.round(durationMs * 100) / 100,
        failed,
    }, `${name} took ${durationMs.toFixed(2)}ms${failed ? ' (failed)' : ''}`);
}

/**
 * Create a named performance marker
 */
export function mark(name: string): void {
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(name);
    }
}

/**
 * Measure between two marks
 */
export function measureBetween(
    name: string,
    startMark: string,
    endMark: string
): number | null {
    if (typeof performance !== 'undefined' && performance.measure) {
        try {
            const measure = performance.measure(name, startMark, endMark);
            return measure.duration;
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Create a timing wrapper for React useEffect
 */
export function useEffectTiming(effectName: string): {
    start: () => void;
    end: () => void;
} {
    let startTime: number;

    return {
        start: () => {
            startTime = performance.now();
        },
        end: () => {
            const duration = performance.now() - startTime;
            if (duration > 16) {
                // Longer than one frame
                logger.debug({
                    type: 'effect-timing',
                    effect: effectName,
                    durationMs: duration,
                }, `Effect ${effectName} took ${duration.toFixed(2)}ms`);
            }
        },
    };
}

/**
 * Debounce performance logging to avoid spam
 */
const performanceBuffer: Map<string, number[]> = new Map();

export function bufferPerformance(name: string, durationMs: number): void {
    if (!performanceBuffer.has(name)) {
        performanceBuffer.set(name, []);
    }
    performanceBuffer.get(name)!.push(durationMs);

    // Flush every 10 measurements
    if (performanceBuffer.get(name)!.length >= 10) {
        flushPerformanceBuffer(name);
    }
}

function flushPerformanceBuffer(name: string): void {
    const buffer = performanceBuffer.get(name);
    if (!buffer || buffer.length === 0) return;

    const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    const max = Math.max(...buffer);
    const min = Math.min(...buffer);

    logger.debug({
        type: 'performance-batch',
        operation: name,
        count: buffer.length,
        avgMs: Math.round(avg * 100) / 100,
        minMs: Math.round(min * 100) / 100,
        maxMs: Math.round(max * 100) / 100,
    }, `${name} avg: ${avg.toFixed(2)}ms (n=${buffer.length})`);

    performanceBuffer.set(name, []);
}
