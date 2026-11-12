import type React from "react";

/**
 * A less-used canvas action. IMP-084 lists these by name in the top bar's
 * "More" menu on every screen size.
 */
export interface CanvasSecondaryAction {
  key: string;
  /** Visible label and accessible name. */
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: "primary" | "secondary" | "default" | "warning";
  /** Count appended to the menu label. */
  badgeCount?: number;
}
