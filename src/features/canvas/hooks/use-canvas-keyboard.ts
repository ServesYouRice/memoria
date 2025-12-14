import { useEffect } from 'react';


interface UseCanvasKeyboardProps {
    onDelete: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSelectAll: () => void;
    onDuplicate: () => void;
    onEscape: () => void;
    enabled?: boolean;
}

/**
 * Hook to handle global keyboard shortcuts for the canvas
 */
export function useCanvasKeyboard({
    onDelete,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onSelectAll,
    onDuplicate,
    onEscape,
    enabled = true,
}: UseCanvasKeyboardProps) {
    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input or textarea
            if (
                document.activeElement?.tagName === 'INPUT' ||
                document.activeElement?.tagName === 'TEXTAREA' ||
                (document.activeElement as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            const isCtrlOrCmd = e.ctrlKey || e.metaKey;

            // Delete
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                onDelete();
                return;
            }

            // Escape
            if (e.key === 'Escape') {
                e.preventDefault();
                onEscape();
                return;
            }

            // Undo (Ctrl+Z)
            if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                onUndo();
                return;
            }

            // Redo (Ctrl+Shift+Z or Ctrl+Y)
            if ((isCtrlOrCmd && e.key === 'z' && e.shiftKey) || (isCtrlOrCmd && e.key === 'y')) {
                e.preventDefault();
                onRedo();
                return;
            }

            // Copy (Ctrl+C)
            if (isCtrlOrCmd && e.key === 'c') {
                e.preventDefault();
                onCopy();
                return;
            }

            // Paste (Ctrl+V)
            if (isCtrlOrCmd && e.key === 'v') {
                // Paste is typically handled by the 'paste' event, but we can catch the key combo too
                // if we are doing manual clipboard handling. 
                // Note: Browser security might block readText() in keydown, better to use 'paste' event listener.
                // Assuming onPaste handles permissions or we rely on the separate paste listener.
                // For now, let's keep it consistent.
                onPaste();
                return;
            }

            // Select All (Ctrl+A)
            if (isCtrlOrCmd && e.key === 'a') {
                e.preventDefault();
                onSelectAll();
                return;
            }

            // Duplicate (Ctrl+D)
            if (isCtrlOrCmd && e.key === 'd') {
                e.preventDefault();
                onDuplicate();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        enabled,
        onDelete,
        onUndo,
        onRedo,
        onCopy,
        onPaste,
        onSelectAll,
        onDuplicate,
        onEscape,
    ]);
}
