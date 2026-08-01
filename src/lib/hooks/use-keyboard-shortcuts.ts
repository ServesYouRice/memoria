/**
 * Global Keyboard Shortcuts Hook
 */

import { useEffect } from "react";
import { shouldIgnoreGlobalShortcut } from "@/lib/keyboard/shortcuts";

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  allowInEditable?: boolean;
  allowInDialog?: boolean;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        if (shouldIgnoreGlobalShortcut(event, shortcut)) continue;
        const ctrlOrMeta = event.ctrlKey || event.metaKey;

        if (
          event.key === shortcut.key &&
          (shortcut.ctrlKey === undefined || shortcut.ctrlKey === ctrlOrMeta) &&
          (shortcut.metaKey === undefined || shortcut.metaKey === ctrlOrMeta) &&
          (shortcut.shiftKey === undefined ||
            shortcut.shiftKey === event.shiftKey)
        ) {
          event.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
