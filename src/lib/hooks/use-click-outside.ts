/**
 * useClickOutside Hook
 *
 * Detect clicks outside an element.
 *
 * @module lib/hooks/use-click-outside
 */

'use client';

import { useEffect, useRef, RefObject } from 'react';

/**
 * Handle clicks outside a ref element
 */
export function useClickOutside<T extends HTMLElement>(
    handler: () => void,
    enabled = true
): RefObject<T | null> {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                handler();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [handler, enabled]);

    return ref;
}

/**
 * Handle clicks outside multiple refs
 */
export function useClickOutsideMultiple(
    refs: RefObject<HTMLElement>[],
    handler: () => void,
    enabled = true
): void {
    useEffect(() => {
        if (!enabled) return;

        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            const isOutside = refs.every(
                (ref) => ref.current && !ref.current.contains(event.target as Node)
            );
            if (isOutside) {
                handler();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [refs, handler, enabled]);
}
