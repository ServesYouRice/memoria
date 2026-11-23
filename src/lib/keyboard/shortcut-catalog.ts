export interface ShortcutEntry {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

/**
 * Single source of truth for keyboard shortcuts shown in both the global `?`
 * shortcuts dialog and Settings -> Keyboard shortcuts.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Canvas tools",
    shortcuts: [
      { keys: ["V"], description: "Select tool" },
      { keys: ["H"], description: "Pan tool" },
      { keys: ["N"], description: "Add sticky note" },
      { keys: ["T"], description: "Text tool" },
      { keys: ["R"], description: "Shape tool" },
      { keys: ["A"], description: "Arrow tool" },
      { keys: ["P"], description: "Draw tool" },
    ],
  },
  {
    title: "Canvas navigation",
    shortcuts: [
      { keys: ["Space", "+", "Drag"], description: "Pan canvas" },
      { keys: ["Scroll"], description: "Zoom in or out" },
      { keys: ["Ctrl/Cmd", "+", "0"], description: "Reset zoom" },
    ],
  },
  {
    title: "Canvas actions",
    shortcuts: [
      {
        keys: ["Arrow keys"],
        description: "Nudge selected item (Shift = 10px)",
      },
      { keys: ["Ctrl/Cmd", "+", "C"], description: "Copy selected item" },
      { keys: ["Ctrl/Cmd", "+", "V"], description: "Paste item" },
      { keys: ["Ctrl/Cmd", "+", "D"], description: "Duplicate selected item" },
      { keys: ["Ctrl/Cmd", "+", "A"], description: "Select all items" },
      { keys: ["Delete"], description: "Delete selected items" },
    ],
  },
  {
    title: "Collaboration",
    shortcuts: [
      { keys: ["/"], description: "Cursor chat at pointer" },
      { keys: ["E"], description: "Emoji reaction at pointer" },
      { keys: ["Ctrl/Cmd", "+", "Enter"], description: "Submit comment" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: ["Ctrl/Cmd", "+", "K"], description: "Search all canvases" },
      { keys: ["Ctrl/Cmd", "+", "J"], description: "Ask Memoria AI" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Deselect or close dialog" },
    ],
  },
];
