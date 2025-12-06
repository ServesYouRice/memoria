/**
 * useMediaQuery Hook
 *
 * Responsive design hook for media queries.
 *
 * @module lib/hooks/use-media-query
 */

'use client';

import { useState, useEffect } from 'react';

/**
 * Check if a media query matches
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia(query);
        setMatches(mediaQuery.matches);

        const handler = (event: MediaQueryListEvent) => {
            setMatches(event.matches);
        };

        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, [query]);

    return matches;
}

/**
 * Common breakpoints
 */
export const breakpoints = {
    sm: '(min-width: 640px)',
    md: '(min-width: 768px)',
    lg: '(min-width: 1024px)',
    xl: '(min-width: 1280px)',
    '2xl': '(min-width: 1536px)',
    mobile: '(max-width: 639px)',
    tablet: '(min-width: 640px) and (max-width: 1023px)',
    desktop: '(min-width: 1024px)',
    prefersReducedMotion: '(prefers-reduced-motion: reduce)',
    prefersDark: '(prefers-color-scheme: dark)',
    prefersLight: '(prefers-color-scheme: light)',
    touch: '(pointer: coarse)',
    mouse: '(pointer: fine)',
} as const;

/**
 * Check if mobile
 */
export function useIsMobile(): boolean {
    return useMediaQuery(breakpoints.mobile);
}

/**
 * Check if tablet
 */
export function useIsTablet(): boolean {
    return useMediaQuery(breakpoints.tablet);
}

/**
 * Check if desktop
 */
export function useIsDesktop(): boolean {
    return useMediaQuery(breakpoints.desktop);
}

/**
 * Check if user prefers reduced motion
 */
export function usePrefersReducedMotion(): boolean {
    return useMediaQuery(breakpoints.prefersReducedMotion);
}

/**
 * Check if user prefers dark mode
 */
export function usePrefersDarkMode(): boolean {
    return useMediaQuery(breakpoints.prefersDark);
}

/**
 * Check if touch device
 */
export function useIsTouchDevice(): boolean {
    return useMediaQuery(breakpoints.touch);
}
