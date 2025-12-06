/**
 * useCopyToClipboard Hook
 *
 * Clipboard operations with feedback.
 *
 * @module lib/hooks/use-copy-to-clipboard
 */

'use client';

import { useState, useCallback } from 'react';

interface UseCopyToClipboardResult {
    copied: boolean;
    copy: (text: string) => Promise<boolean>;
    reset: () => void;
}

/**
 * Copy text to clipboard with status tracking
 */
export function useCopyToClipboard(resetDelay = 2000): UseCopyToClipboardResult {
    const [copied, setCopied] = useState(false);

    const copy = useCallback(
        async (text: string): Promise<boolean> => {
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    // Fallback
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }

                setCopied(true);

                if (resetDelay > 0) {
                    setTimeout(() => setCopied(false), resetDelay);
                }

                return true;
            } catch (error) {
                console.error('Failed to copy:', error);
                return false;
            }
        },
        [resetDelay]
    );

    const reset = useCallback(() => setCopied(false), []);

    return { copied, copy, reset };
}

/**
 * Copy share link
 */
export function useCopyShareLink(canvasId: string): UseCopyToClipboardResult & { shareUrl: string } {
    const { copied, copy, reset } = useCopyToClipboard();
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/canvas/${canvasId}` : '';

    const copyShareLink = useCallback(() => copy(shareUrl), [copy, shareUrl]);

    return { copied, copy: copyShareLink, reset, shareUrl };
}
