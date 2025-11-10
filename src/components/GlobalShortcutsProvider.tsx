/**
 * Global Keyboard Shortcuts Provider
 * Handles app-wide keyboard shortcuts
 */

'use client';

import React, { useState } from 'react';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';

export function GlobalShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);

  useKeyboardShortcuts([
    {
      key: '?',
      handler: () => setShortcutsDialogOpen(true),
    },
  ]);

  return (
    <>
      {children}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen}
        onClose={() => setShortcutsDialogOpen(false)}
      />
    </>
  );
}
