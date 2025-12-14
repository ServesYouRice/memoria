'use client';

import React from 'react';
import { IconButton, Tooltip, IconButtonProps } from '@mui/material';
import { Brightness4, Brightness7 } from '@mui/icons-material';
import { useThemeMode } from '@/contexts/ThemeContext';

export function ThemeToggle(props: IconButtonProps) {
  const { mode, toggleTheme } = useThemeMode();

  return (
    <Tooltip title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
      <IconButton
        onClick={toggleTheme}
        color="inherit"
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        {...props}
      >
        {mode === 'light' ? <Brightness4 /> : <Brightness7 />}
      </IconButton>
    </Tooltip>
  );
}
