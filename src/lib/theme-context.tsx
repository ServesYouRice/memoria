/**
 * Theme Context for Dark Mode
 *
 * ENHANCED: Issue #42 - Dark mode support
 *
 * Provides theme mode state and toggle functionality.
 * Persists user preference in localStorage (via MUI's colour-scheme storage).
 *
 * Colours come from CSS variables selected by `data-theme`, which an inline
 * script stamps before first paint, so the server markup is correct in both
 * modes and nothing has to re-render to change colour.
 */

"use client";

import React, { createContext, useCallback, useContext, useMemo } from "react";
import { type PaletteMode } from "@mui/material";
import {
  ThemeProvider as MuiThemeProvider,
  useColorScheme,
} from "@mui/material/styles";
import { createAppTheme } from "./theme";
import { DEFAULT_THEME_MODE, THEME_STORAGE_KEY } from "./theme-preference";

interface ThemeContextType {
  mode: PaletteMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: DEFAULT_THEME_MODE,
  toggleTheme: () => {},
});

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeModeProvider");
  }
  return context;
}

interface ThemeModeProviderProps {
  children: React.ReactNode;
}

/**
 * Must sit inside MUI's `ThemeProvider` (CSS-variables theme). MUI owns the
 * mode state, its storage and the `data-theme` attribute; this provider only
 * exposes the resolved light/dark mode and a toggle that stores an explicit
 * choice. Without a stored choice the system preference is followed.
 */
export function ThemeModeProvider({ children }: ThemeModeProviderProps) {
  const { mode: storedMode, systemMode, setMode } = useColorScheme();
  const mode: PaletteMode =
    (storedMode === "system" ? systemMode : storedMode) ?? DEFAULT_THEME_MODE;

  const toggleTheme = useCallback(() => {
    setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  const value = useMemo(() => ({ mode, toggleTheme }), [mode, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// Built once: both colour schemes live in CSS variables, so a mode switch
// changes only the `data-theme` attribute, never the rendered class names.
const appTheme = createAppTheme();

/** MUI theme (both schemes) plus the app's light/dark mode context. */
export function AppThemeProvider({ children }: ThemeModeProviderProps) {
  return (
    <MuiThemeProvider
      theme={appTheme}
      modeStorageKey={THEME_STORAGE_KEY}
      defaultMode="system"
    >
      <ThemeModeProvider>{children}</ThemeModeProvider>
    </MuiThemeProvider>
  );
}
