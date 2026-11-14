import type React from "react";

/**
 * A less-used canvas action. IMP-084 lists these by name in the top bar's
 * "More" menu on every screen size.
 */
export type CanvasMenuGroup = "canvas" | "view" | "ai" | "tools" | "history";

export interface CanvasSecondaryAction {
  key: string;
  /** Heading the command sits under in the "More canvas options" menu. */
  group: CanvasMenuGroup;
  /** Visible label and accessible name. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: "primary" | "secondary" | "default" | "warning";
  /** Count appended to the menu label. */
  badgeCount?: number;
}
