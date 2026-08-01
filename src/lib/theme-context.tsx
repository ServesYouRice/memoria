/**
 * Theme Context for Dark Mode
 *
 * ENHANCED: Issue #42 - Dark mode support
 *
 * Provides theme mode state and toggle functionality
 * Persists user preference in localStorage
 */

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";
import { type PaletteMode } from "@mui/material";
import {
  DEFAULT_THEME_MODE,
  THEME_STORAGE_KEY,
  applyThemeModeToDocument,
  resolvePreferredThemeMode,
} from "@/lib/theme-preference";

interface ThemeContextType {
  mode: PaletteMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "light",
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

export function ThemeModeProvider({ children }: ThemeModeProviderProps) {
  // Initialize theme from localStorage or system preference
  const [mode, setMode] = useState<PaletteMode>(DEFAULT_THEME_MODE);

  useEffect(() => {
    setMode(resolvePreferredThemeMode());

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (!window.localStorage.getItem(THEME_STORAGE_KEY)) {
        setMode(event.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    applyThemeModeToDocument(mode);
  }, [mode]);

  const toggleTheme = () => {
    setMode((prevMode) => {
      const newMode = prevMode === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, newMode);
      } catch {
        // The preference is still useful for this session when storage is blocked.
      }
      return newMode;
    });
  };

  const value = useMemo(
    () => ({
      mode,
      toggleTheme,
    }),
    [mode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
