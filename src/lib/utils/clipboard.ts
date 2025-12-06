/**
 * Clipboard Utilities
 *
 * Safe clipboard operations with fallbacks for older browsers.
 *
 * @module lib/utils/clipboard
 */

import { toast } from 'sonner';

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string, successMessage = 'Copied to clipboard'): Promise<boolean> {
    try {
        // Modern API
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            toast.success(successMessage);
            return true;
        }

        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
            toast.success(successMessage);
            return true;
        }

        toast.error('Failed to copy to clipboard');
        return false;
    } catch (error) {
        console.error('Clipboard copy failed:', error);
        toast.error('Failed to copy to clipboard');
        return false;
    }
}

/**
 * Read text from clipboard
 */
export async function readFromClipboard(): Promise<string | null> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            return await navigator.clipboard.readText();
        }
        return null;
    } catch (error) {
        console.error('Clipboard read failed:', error);
        return null;
    }
}

/**
 * Copy canvas share link
 */
export async function copyShareLink(canvasId: string): Promise<boolean> {
    const url = `${window.location.origin}/canvas/${canvasId}`;
    return copyToClipboard(url, 'Share link copied');
}

/**
 * Copy item content
 */
export async function copyItemContent(content: unknown): Promise<boolean> {
    if (typeof content === 'string') {
        return copyToClipboard(content);
    }

    if (typeof content === 'object' && content !== null) {
        // Handle note content
        if ('text' in content && typeof (content as { text?: string }).text === 'string') {
            return copyToClipboard((content as { text: string }).text);
        }

        // Handle bookmark content
        if ('url' in content && typeof (content as { url?: string }).url === 'string') {
            return copyToClipboard((content as { url: string }).url);
        }

        // Fallback to JSON
        return copyToClipboard(JSON.stringify(content, null, 2));
    }

    return false;
}
