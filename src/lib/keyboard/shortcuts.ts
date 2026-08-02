/**
 * Keyboard Shortcut Definitions
 *
 * Centralized keyboard shortcut configuration.
 *
 * @module lib/keyboard/shortcuts
 */

export interface ShortcutDefinition {
  key: string;
  modifiers?: ("ctrl" | "shift" | "alt" | "meta")[];
  description: string;
  category: string;
  action: string;
}

/**
 * All keyboard shortcuts
 */
export const SHORTCUTS: ShortcutDefinition[] = [
  // Canvas Navigation
  {
    key: "Space",
    description: "Pan canvas (hold + drag)",
    category: "Navigation",
    action: "pan",
  },
  {
    key: "0",
    modifiers: ["ctrl"],
    description: "Reset zoom",
    category: "Navigation",
    action: "resetZoom",
  },
  {
    key: "+",
    modifiers: ["ctrl"],
    description: "Zoom in",
    category: "Navigation",
    action: "zoomIn",
  },
  {
    key: "-",
    modifiers: ["ctrl"],
    description: "Zoom out",
    category: "Navigation",
    action: "zoomOut",
  },
  {
    key: "Home",
    description: "Go to canvas origin",
    category: "Navigation",
    action: "goHome",
  },

  // Selection
  {
    key: "a",
    modifiers: ["ctrl"],
    description: "Select all",
    category: "Selection",
    action: "selectAll",
  },
  {
    key: "Escape",
    description: "Deselect all",
    category: "Selection",
    action: "deselectAll",
  },
  {
    key: "Tab",
    description: "Select next item",
    category: "Selection",
    action: "selectNext",
  },
  {
    key: "Tab",
    modifiers: ["shift"],
    description: "Select previous item",
    category: "Selection",
    action: "selectPrev",
  },

  // Editing
  {
    key: "Delete",
    description: "Delete selected items",
    category: "Editing",
    action: "delete",
  },
  {
    key: "Backspace",
    description: "Delete selected items",
    category: "Editing",
    action: "delete",
  },
  {
    key: "d",
    modifiers: ["ctrl"],
    description: "Duplicate selected",
    category: "Editing",
    action: "duplicate",
  },
  {
    key: "c",
    modifiers: ["ctrl"],
    description: "Copy selected",
    category: "Editing",
    action: "copy",
  },
  {
    key: "v",
    modifiers: ["ctrl"],
    description: "Paste",
    category: "Editing",
    action: "paste",
  },
  {
    key: "x",
    modifiers: ["ctrl"],
    description: "Cut selected",
    category: "Editing",
    action: "cut",
  },

  // History
  {
    key: "z",
    modifiers: ["ctrl"],
    description: "Undo",
    category: "History",
    action: "undo",
  },
  {
    key: "y",
    modifiers: ["ctrl"],
    description: "Redo",
    category: "History",
    action: "redo",
  },
  {
    key: "z",
    modifiers: ["ctrl", "shift"],
    description: "Redo",
    category: "History",
    action: "redo",
  },

  // Layer
  {
    key: "]",
    modifiers: ["ctrl"],
    description: "Bring to front",
    category: "Layer",
    action: "bringToFront",
  },
  {
    key: "[",
    modifiers: ["ctrl"],
    description: "Send to back",
    category: "Layer",
    action: "sendToBack",
  },
  {
    key: "]",
    description: "Bring forward",
    category: "Layer",
    action: "bringForward",
  },
  {
    key: "[",
    description: "Send backward",
    category: "Layer",
    action: "sendBackward",
  },

  // Tools
  { key: "n", description: "Add note", category: "Tools", action: "addNote" },
  {
    key: "b",
    description: "Add bookmark",
    category: "Tools",
    action: "addBookmark",
  },
  { key: "i", description: "Add image", category: "Tools", action: "addImage" },
  {
    key: "g",
    description: "Toggle grid",
    category: "Tools",
    action: "toggleGrid",
  },

  // General
  {
    key: "?",
    description: "Show shortcuts",
    category: "General",
    action: "showShortcuts",
  },
  {
    key: "s",
    modifiers: ["ctrl"],
    description: "Save canvas",
    category: "General",
    action: "save",
  },
  {
    key: "f",
    modifiers: ["ctrl"],
    description: "Search",
    category: "General",
    action: "search",
  },
];

/**
 * Get shortcuts grouped by category
 */
export function getShortcutsByCategory(): Record<string, ShortcutDefinition[]> {
  const groups: Record<string, ShortcutDefinition[]> = {};
  for (const shortcut of SHORTCUTS) {
    if (!groups[shortcut.category]) {
      groups[shortcut.category] = [];
    }
    groups[shortcut.category]!.push(shortcut);
  }
  return groups;
}

/**
 * Find shortcut by action
 */
export function getShortcutForAction(
  action: string,
): ShortcutDefinition | undefined {
  return SHORTCUTS.find((s) => s.action === action);
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: ShortcutDefinition): string {
  const parts: string[] = [];
  if (shortcut.modifiers?.includes("ctrl")) parts.push("Ctrl");
  if (shortcut.modifiers?.includes("shift")) parts.push("Shift");
  if (shortcut.modifiers?.includes("alt")) parts.push("Alt");
  if (shortcut.modifiers?.includes("meta")) parts.push("⌘");
  parts.push(shortcut.key);
  return parts.join("+");
}

/** Elements that consume raw keystrokes as text entry. */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Selectors for rich-text surfaces that behave as editors even when the event
 * target itself is a nested, non-contenteditable node.
 */
const EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true"], [role="textbox"], .ProseMirror, .tiptap';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (EDITABLE_TAGS.has(element.tagName)) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return element.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * True when the keystroke belongs to a text-entry surface. Checks the event
 * target and the focused element: portalled editors can dispatch from a wrapper
 * while focus lives on the editable node.
 */
export function isEditableEventTarget(
  event: Pick<KeyboardEvent, "target">,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const active =
    typeof document !== "undefined" && document.activeElement instanceof Element
      ? document.activeElement
      : null;
  return isEditableElement(target) || isEditableElement(active);
}

/** True while a modal dialog is mounted, which owns its own key handling. */
export function hasActiveDialog(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(DIALOG_SELECTOR) !== null;
}

/**
 * Global (app-wide) shortcuts must never steal keystrokes from editors, forms,
 * or open dialogs — typing `?` in a note has to insert `?`.
 */
export function shouldIgnoreGlobalShortcut(
  event: Pick<KeyboardEvent, "target">,
): boolean {
  return isEditableEventTarget(event) || hasActiveDialog();
}

/**
 * Check if event matches shortcut
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ShortcutDefinition,
): boolean {
  const key = event.key.toLowerCase();
  if (key !== shortcut.key.toLowerCase()) return false;

  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;
  const alt = event.altKey;

  const needsCtrl =
    shortcut.modifiers?.includes("ctrl") ||
    shortcut.modifiers?.includes("meta");
  const needsShift = shortcut.modifiers?.includes("shift");
  const needsAlt = shortcut.modifiers?.includes("alt");

  return ctrl === !!needsCtrl && shift === !!needsShift && alt === !!needsAlt;
}
