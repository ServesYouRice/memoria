/**
 * MUI Theme Configuration
 *
 * ENHANCED: Issue #42 - Dark mode support
 *
 * Provides light and dark theme variants with consistent color schemes
 */

'use client';

import { createTheme, ThemeOptions, PaletteMode } from '@mui/material/styles';

/**
 * Shared theme options for both light and dark modes
 */
const baseThemeOptions: ThemeOptions = {
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
  },
};

/**
 * Create theme based on mode (light or dark)
 *
 * @param mode - 'light' or 'dark'
 * @returns MUI theme object
 */
export function createAppTheme(mode: PaletteMode) {
  return createTheme({
    ...baseThemeOptions,
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            // Light mode colors
            primary: {
              main: '#1976d2',
              light: '#42a5f5',
              dark: '#1565c0',
            },
            secondary: {
              main: '#dc004e',
              light: '#f73378',
              dark: '#9a0036',
            },
            background: {
              default: '#f5f5f5',
              paper: '#ffffff',
            },
            text: {
              primary: '#212121',
              secondary: '#666666',
            },
          }
        : {
            // Dark mode colors
            primary: {
              main: '#90caf9',
              light: '#bbdefb',
              dark: '#42a5f5',
            },
            secondary: {
              main: '#f48fb1',
              light: '#ffc1e3',
              dark: '#bf5f82',
            },
            background: {
              default: '#121212',
              paper: '#1e1e1e',
            },
            text: {
              primary: '#ffffff',
              secondary: '#b0b0b0',
            },
          }),
    },
  });
}

// Default light theme for backward compatibility
export const theme = createAppTheme('light');
