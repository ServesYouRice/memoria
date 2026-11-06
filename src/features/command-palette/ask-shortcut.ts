import {
  getShortcutForAction,
  matchesShortcut,
  type ShortcutDefinition,
} from "@/lib/keyboard/shortcuts";

/**
 * Ctrl/⌘+J opens Ask. Ctrl+K is the command palette and Ctrl+F is search,
 * so J is the free neighbour (and the common "ask AI" key).
 */
export const ASK_SHORTCUT: ShortcutDefinition = getShortcutForAction("ask") ?? {
  key: "j",
  modifiers: ["ctrl"],
  description: "Ask Memoria",
  category: "General",
  action: "ask",
};

export function isAskShortcut(event: KeyboardEvent): boolean {
  return matchesShortcut(event, ASK_SHORTCUT);
}
