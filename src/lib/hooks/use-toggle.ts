/**
 * useToggle Hook
 *
 * Boolean state toggle.
 *
 * @module lib/hooks/use-toggle
 */

'use client';

import { useState, useCallback } from 'react';

/**
 * Boolean toggle state
 */
export function useToggle(
    initialValue = false
): [boolean, () => void, (value: boolean) => void] {
    const [value, setValue] = useState(initialValue);

    const toggle = useCallback(() => setValue((v) => !v), []);
    const set = useCallback((v: boolean) => setValue(v), []);

    return [value, toggle, set];
}

/**
 * Boolean state with open/close
 */
export function useDisclosure(initialValue = false) {
    const [isOpen, setIsOpen] = useState(initialValue);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen((v) => !v), []);

    return { isOpen, open, close, toggle, setIsOpen };
}

/**
 * Counter state
 */
export function useCounter(
    initialValue = 0,
    options?: { min?: number; max?: number }
) {
    const [count, setCount] = useState(initialValue);
    const { min = -Infinity, max = Infinity } = options || {};

    const increment = useCallback(() => {
        setCount((c) => Math.min(max, c + 1));
    }, [max]);

    const decrement = useCallback(() => {
        setCount((c) => Math.max(min, c - 1));
    }, [min]);

    const reset = useCallback(() => setCount(initialValue), [initialValue]);

    const set = useCallback(
        (value: number) => {
            setCount(Math.max(min, Math.min(max, value)));
        },
        [min, max]
    );

    return { count, increment, decrement, reset, set };
}
