/**
 * Confirmation Dialog Store
 *
 * Promise-based confirmation dialog state, rendered by ConfirmDialogHost.
 * Replaces browser-native confirm() calls (which block the main thread,
 * ignore theming, and can be suppressed by the browser) with a themed MUI
 * dialog. Because this is a plain zustand store, `confirmDialog()` can be
 * called from anywhere — including react-konva canvas components where
 * rendering a DOM dialog inline isn't possible.
 *
 * @module stores/confirmStore
 */

import { create } from "zustand";

export interface ConfirmOptions {
  /** Dialog title */
  title?: string;
  /** Body text describing what will happen */
  message: string;
  /** Confirm button label */
  confirmText?: string;
  /** Cancel button label */
  cancelText?: string;
  /** Style the confirm button as destructive (red) */
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions;
  resolver: ((confirmed: boolean) => void) | null;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  settle: (confirmed: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: { message: "" },
  resolver: null,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is somehow already open, treat it as cancelled.
      get().resolver?.(false);
      set({ open: true, options, resolver: resolve });
    }),

  settle: (confirmed) => {
    get().resolver?.(confirmed);
    set({ open: false, resolver: null });
  },
}));

/**
 * Show the app-wide confirmation dialog and resolve with the user's choice.
 *
 * @example
 * if (await confirmDialog({ title: 'Delete note', message: 'Delete this note?', destructive: true })) {
 *     deleteItem.mutate(...);
 * }
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().confirm(options);
}
