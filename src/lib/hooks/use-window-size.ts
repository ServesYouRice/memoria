/**
 * useWindowSize Hook
 *
 * Track window dimensions.
 *
 * @module lib/hooks/use-window-size
 */

'use client';

import { useState, useEffect } from 'react';

interface WindowSize {
    width: number;
    height: number;
}

/**
 * Get current window size with optional debounce
 */
export function useWindowSize(debounceMs = 100): WindowSize {
    const [size, setSize] = useState<WindowSize>({
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
    });

    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>;

        const handleResize = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                setSize({
                    width: window.innerWidth,
                    height: window.innerHeight,
                });
            }, debounceMs);
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timeoutId);
        };
    }, [debounceMs]);

    return size;
}

/**
 * Get element dimensions
 */
export function useElementSize<T extends HTMLElement>(): [
    React.RefObject<T>,
    { width: number; height: number }
] {
    const ref = { current: null as T | null };
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!ref.current) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return [ref as React.RefObject<T>, size];
}
