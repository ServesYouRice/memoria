/**
 * Global Keyboard Shortcuts Hook
 *
 * Global shortcuts are suppressed inside editors, form controls, and open
 * dialogs so plain typing is never intercepted. Opt back in per shortcut with
 * `allowInEditable` (for modifier chords that cannot be typed as text).
 */

import { useEffect } from "react";
import { shouldIgnoreGlobalShortcut } from "@/lib/keyboard/shortcuts";

interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Fire even when focus is in an editor, form control, or dialog. */
  allowInEditable?: boolean;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ignoreUnlessAllowed = shouldIgnoreGlobalShortcut(event);

      for (const shortcut of shortcuts) {
        if (ignoreUnlessAllowed && !shortcut.allowInEditable) continue;

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
