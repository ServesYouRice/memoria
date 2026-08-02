/**
 * Theme Context for Dark Mode
 *
 * ENHANCED: Issue #42 - Dark mode support
 *
 * Provides theme mode state and toggle functionality.
 * Persists user preference in localStorage.
 *
 * The provider always renders its children — including during server rendering
 * and the first client pass — so pages keep meaningful HTML without JavaScript.
 * The stored preference is reconciled in a layout effect (before paint) rather
 * than by withholding the tree.
 */

"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { type PaletteMode } from "@mui/material";
import {
  DEFAULT_THEME_MODE,
  THEME_STORAGE_KEY,
  applyThemeModeToDocument,
  readStoredThemeMode,
  resolvePreferredThemeMode,
} from "./theme-preference";

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

// useLayoutEffect warns during server rendering; useEffect is the server-safe
// equivalent there because effects never run on the server anyway.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ThemeModeProviderProps {
  children: React.ReactNode;
}

export function ThemeModeProvider({ children }: ThemeModeProviderProps) {
  // Deterministic on the server; reconciled below before the browser paints.
  const [mode, setMode] = useState<PaletteMode>(DEFAULT_THEME_MODE);

  useIsomorphicLayoutEffect(() => {
    const preferred = resolvePreferredThemeMode();
    setMode(preferred);
    applyThemeModeToDocument(preferred);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      // Only follow the system when the user has not chosen explicitly.
      if (readStoredThemeMode() !== null) return;
      const systemMode = event.matches ? "dark" : "light";
      setMode(systemMode);
      applyThemeModeToDocument(systemMode);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setMode((prevMode) => {
      const newMode = prevMode === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, newMode);
      } catch {
        // A failed write only costs persistence, not the in-session switch.
      }
      applyThemeModeToDocument(newMode);
      return newMode;
    });
  }, []);

  const value = useMemo(() => ({ mode, toggleTheme }), [mode, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
