/**
 * Theme preference resolution
 *
 * The server cannot read `localStorage`, so it renders a deterministic default
 * mode and the client reconciles the stored preference before paint. A small
 * nonce'd inline script stamps the resolved mode onto `<html>` so the document
 * background matches before React hydrates.
 *
 * @module lib/theme-preference
 */

import type { PaletteMode } from "@mui/material";

/** localStorage key holding an explicit user choice. */
export const THEME_STORAGE_KEY = "theme-mode";

/** Attribute stamped on `<html>` so CSS can react before hydration. */
export const THEME_ATTRIBUTE = "data-theme";

/** Mode rendered on the server, before any client preference is known. */
export const DEFAULT_THEME_MODE: PaletteMode = "light";

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isPaletteMode(value: unknown): value is PaletteMode {
  return value === "light" || value === "dark";
}

/** Explicit stored choice, or `null` when the user has not chosen one. */
export function readStoredThemeMode(): PaletteMode | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPaletteMode(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Fall back to
    // the system preference rather than failing to render.
    return null;
  }
}

/** System preference, used only when there is no explicit stored choice. */
export function readSystemThemeMode(): PaletteMode {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

/** The mode the client should display: stored choice, else system preference. */
export function resolvePreferredThemeMode(): PaletteMode {
  return readStoredThemeMode() ?? readSystemThemeMode();
}

/** Keep the document element in sync so non-MUI surfaces match the theme. */
export function applyThemeModeToDocument(mode: PaletteMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, mode);
  root.style.colorScheme = mode;
}

/**
 * Inline script executed before first paint. Kept dependency-free and
 * exception-safe: a storage failure must never block document rendering.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var m=(s==='light'||s==='dark')?s:(window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches?'dark':'light');var e=document.documentElement;e.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},m);e.style.colorScheme=m;}catch(e){}})();`;
