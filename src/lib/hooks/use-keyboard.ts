/**
 * useKeyboard Hook
 *
 * Keyboard shortcut handling hook.
 *
 * @module lib/hooks/use-keyboard
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    handler: (event: KeyboardEvent) => void;
    enabled?: boolean;
    preventDefault?: boolean;
}

/**
 * Handle multiple keyboard shortcuts
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
    const shortcutsRef = useRef(shortcuts);
    shortcutsRef.current = shortcuts;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Ignore if typing in input
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            for (const shortcut of shortcutsRef.current) {
                if (shortcut.enabled === false) continue;
                if (matchesShortcut(event, shortcut)) {
                    if (shortcut.preventDefault !== false) {
                        event.preventDefault();
                    }
                    shortcut.handler(event);
                    break;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}

/**
 * Check if event matches shortcut
 */
function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
    const key = event.key.toLowerCase();
    if (key !== shortcut.key.toLowerCase()) return false;

    const ctrl = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const alt = event.altKey;

    if (shortcut.ctrl && !ctrl) return false;
    if (shortcut.shift && !shift) return false;
    if (shortcut.alt && !alt) return false;
    if (!shortcut.ctrl && ctrl) return false;
    if (!shortcut.shift && shift) return false;
    if (!shortcut.alt && alt) return false;

    return true;
}

/**
 * Simple single key handler
 */
export function useKeyPress(
    key: string,
    handler: () => void,
    options?: { ctrl?: boolean; shift?: boolean; alt?: boolean }
): void {
    useKeyboardShortcuts([
        {
            key,
            ctrl: options?.ctrl,
            shift: options?.shift,
            alt: options?.alt,
            handler,
        },
    ]);
}

/**
 * Escape key handler
 */
export function useEscapeKey(handler: () => void): void {
    useKeyPress('Escape', handler);
}

/**
 * Enter key handler
 */
export function useEnterKey(handler: () => void, options?: { ctrl?: boolean }): void {
    useKeyPress('Enter', handler, options);
}

/**
 * Track currently pressed keys
 */
export function usePressedKeys(): Set<string> {
    const pressedKeys = useRef(new Set<string>());

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            pressedKeys.current.add(e.key.toLowerCase());
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            pressedKeys.current.delete(e.key.toLowerCase());
        };

        const handleBlur = () => {
            pressedKeys.current.clear();
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    return pressedKeys.current;
}

/**
 * Check if space key is held (for panning)
 */
export function useSpaceHeld(): boolean {
    const pressedKeys = usePressedKeys();
    return pressedKeys.has(' ');
}
