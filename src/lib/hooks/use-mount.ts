/**
 * useMount and useUnmount Hooks
 *
 * Lifecycle hooks.
 *
 * @module lib/hooks/use-mount
 */

'use client';

import { useEffect, useRef } from 'react';

/**
 * Run callback on component mount
 */
export function useMount(callback: () => void | (() => void)): void {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        return callbackRef.current();
    }, []);
}

/**
 * Run callback on component unmount
 */
export function useUnmount(callback: () => void): void {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        return () => callbackRef.current();
    }, []);
}

/**
 * Track if component is mounted
 */
export function useIsMounted(): () => boolean {
    const isMounted = useRef(false);

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    return () => isMounted.current;
}

/**
 * Run callback only on updates (not initial mount)
 */
export function useUpdateEffect(callback: () => void | (() => void), deps: unknown[]): void {
    const isFirst = useRef(true);

    useEffect(() => {
        if (isFirst.current) {
            isFirst.current = false;
            return;
        }
        return callback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

/**
 * Get previous value
 */
export function usePrevious<T>(value: T): T | undefined {
    const ref = useRef<T>();

    useEffect(() => {
        ref.current = value;
    }, [value]);

    return ref.current;
}
