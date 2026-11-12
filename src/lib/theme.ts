"use client";

import { createTheme, type PaletteMode, alpha } from "@mui/material/styles";

/**
 * Memoria design tokens & MUI theme.
 *
 * Single source of truth for brand colors, gradients, and component
 * styling. Pages must consume these tokens (via the theme or the
 * exported `brand`/`gradients` objects) instead of hard-coding hexes.
 */

// Brand palette — indigo/violet identity
export const brand = {
  primary: {
    light: "#818cf8",
    main: "#6366f1",
    dark: "#4f46e5",
    contrastText: "#ffffff",
  },
  secondary: {
    light: "#a78bfa",
    main: "#8b5cf6",
    dark: "#7c3aed",
    contrastText: "#ffffff",
  },
  success: {
    light: "#4ade80",
    main: "#22c55e",
    dark: "#16a34a",
  },
  warning: {
    light: "#fbbf24",
    main: "#f59e0b",
    dark: "#d97706",
  },
  error: {
    light: "#f87171",
    main: "#ef4444",
    dark: "#dc2626",
  },
  info: {
    light: "#38bdf8",
    main: "#0ea5e9",
    dark: "#0284c7",
  },
};

export const gradients = {
  brand: `linear-gradient(135deg, ${brand.primary.main} 0%, ${brand.secondary.main} 100%)`,
  brandSoft: `linear-gradient(135deg, ${alpha(brand.primary.main, 0.12)} 0%, ${alpha(
    brand.secondary.main,
    0.12,
  )} 100%)`,
  hero: `radial-gradient(ellipse 80% 60% at 50% -20%, ${alpha(
    brand.primary.main,
    0.25,
  )}, transparent), radial-gradient(ellipse 60% 50% at 80% 40%, ${alpha(
    brand.secondary.main,
    0.15,
  )}, transparent)`,
};

// Glassmorphism styles (used by AppBar / dialogs)
export const glassStyles = {
  light: {
    background: "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(15, 23, 42, 0.08)",
  },
  dark: {
    background: "rgba(15, 23, 42, 0.8)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
};

// Animation timing
export const transitions = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal: "250ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "350ms cubic-bezier(0.4, 0, 0.2, 1)",
};

/**
 * Mode-specific values that are not part of the MUI palette. They are emitted
 * as CSS custom properties per colour scheme, so component styles stay the
 * same in both modes and the `data-theme` attribute (stamped before first
 * paint) picks the colours. Rendering never depends on the mode, so markup
 * from the server always matches the first client render.
 */
export const appColorTokens = {
  light: {
    border: "rgba(15, 23, 42, 0.08)",
    scrollbarThumb: "#cbd5e1",
    scrollbarTrack: "#f1f5f9",
    tooltipBackground: "#0f172a",
    tooltipText: "#f1f5f9",
    appBarBackground: glassStyles.light.background,
    appBarBorder: glassStyles.light.border,
    menuShadow: "0 10px 32px rgba(15, 23, 42, 0.12)",
    cardHoverShadow: `0 8px 24px ${alpha(brand.primary.main, 0.08)}`,
    // Flat, muted disabled fill with a label that keeps at least 3:1 contrast.
    disabledButtonBackground: "#e2e8f0",
    disabledButtonText: "#64748b",
    canvasBackground: "#f0f2f5",
    canvasGrid: "#e0e0e0",
  },
  dark: {
    border: "rgba(241, 245, 249, 0.08)",
    scrollbarThumb: "#475569",
    scrollbarTrack: "#111a2e",
    tooltipBackground: "#f1f5f9",
    tooltipText: "#0f172a",
    appBarBackground: glassStyles.dark.background,
    appBarBorder: glassStyles.dark.border,
    menuShadow: "0 10px 32px rgba(0, 0, 0, 0.5)",
    cardHoverShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    disabledButtonBackground: "#1e293b",
    disabledButtonText: "#94a3b8",
    canvasBackground: "#0d1526",
    canvasGrid: "#1e293b",
  },
} as const;

export type AppColorToken = keyof (typeof appColorTokens)["light"];

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** CSS `var()` reference for an app colour token. */
export function appColor(token: AppColorToken): string {
  return `var(--app-${kebab(token)})`;
}

function tokenDeclarations(mode: PaletteMode): Record<string, string> {
  return Object.fromEntries(
    Object.entries(appColorTokens[mode]).map(([name, value]) => [
      `--app-${kebab(name)}`,
      value,
    ]),
  );
}

/** Attribute selector MUI and the pre-paint script both use for dark mode. */
export const DARK_SCHEME_SELECTOR = '[data-theme="dark"]';

function paletteFor(mode: PaletteMode) {
  const isLight = mode === "light";
  return {
    mode,
    primary: {
      light: brand.primary.light,
      // The launch UI uses primary.main for normal-size links and outlined
      // controls, so the light palette needs the AA-safe brand shade.
      main: isLight ? brand.primary.dark : brand.primary.light,
      dark: brand.primary.dark,
      contrastText: brand.primary.contrastText,
    },
    secondary: {
      light: brand.secondary.light,
      main: isLight ? brand.secondary.main : brand.secondary.light,
      dark: brand.secondary.dark,
      contrastText: brand.secondary.contrastText,
    },
    success: brand.success,
    warning: brand.warning,
    error: brand.error,
    info: brand.info,
    background: {
      default: isLight ? "#f8fafc" : "#0b1120",
      paper: isLight ? "#ffffff" : "#111a2e",
    },
    text: {
      primary: isLight ? "#0f172a" : "#f1f5f9",
      secondary: isLight ? "#64748b" : "#94a3b8",
    },
    divider: appColorTokens[mode].border,
  };
}

export function createAppTheme() {
  const border = appColor("border");

  return createTheme({
    cssVariables: { colorSchemeSelector: "data-theme" },
    colorSchemes: {
      light: { palette: paletteFor("light") },
      dark: { palette: paletteFor("dark") },
    },
    typography: {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h1: { fontWeight: 800, letterSpacing: "-0.025em" },
      h2: { fontWeight: 700, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700, letterSpacing: "-0.015em" },
      h4: { fontWeight: 700, letterSpacing: "-0.01em" },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
      button: { fontWeight: 600, letterSpacing: "0.01em" },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            scrollBehavior: "smooth",
            scrollbarWidth: "thin",
            scrollbarColor: `${appColor("scrollbarThumb")} ${appColor("scrollbarTrack")}`,
            scrollbarGutter: "stable",
            "& *:focus-visible": {
              outline: `2px solid ${brand.primary.main}`,
              outlineOffset: "2px",
            },
          },
          body: {
            minBlockSize: "100dvh",
          },
          ":root": tokenDeclarations("light"),
          [DARK_SCHEME_SELECTOR]: tokenDeclarations("dark"),
          "@media (prefers-reduced-motion: reduce)": {
            html: { scrollBehavior: "auto" },
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
              scrollBehavior: "auto !important",
            },
          },
          "@keyframes fadeIn": {
            from: { opacity: 0, transform: "translateY(10px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
          "@keyframes slideIn": {
            from: { opacity: 0, transform: "translateX(-10px)" },
            to: { opacity: 1, transform: "translateX(0)" },
          },
          "@keyframes pulse": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.5 },
          },
          "@keyframes shimmer": {
            "0%": { backgroundPosition: "-200% 0" },
            "100%": { backgroundPosition: "200% 0" },
          },
          "@keyframes float": {
            "0%, 100%": { transform: "translateY(0px)" },
            "50%": { transform: "translateY(-10px)" },
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            borderRadius: 10,
            padding: "8px 18px",
            transition: `all ${transitions.fast}`,
          },
          sizeLarge: {
            padding: "12px 28px",
            fontSize: "1rem",
          },
        },
        // MUI v9 dropped the `containedPrimary` style-override slot; the same
        // rule is now expressed as a variant match.
        variants: [
          {
            props: { variant: "contained", color: "primary" },
            style: {
              background: gradients.brand,
              "&:hover": {
                background: gradients.brand,
                filter: "brightness(1.08)",
                boxShadow: `0 4px 16px ${alpha(brand.primary.main, 0.35)}`,
              },
              // The gradient `background` would otherwise survive the disabled
              // state and leave MUI's faded label unreadable on purple.
              "&.Mui-disabled": {
                background: appColor("disabledButtonBackground"),
                color: appColor("disabledButtonText"),
                filter: "none",
                boxShadow: "none",
              },
            },
          },
        ],
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            backgroundImage: "none",
            boxShadow: "none",
            border: `1px solid ${border}`,
            transition: `border-color ${transitions.fast}, box-shadow ${transitions.fast}, transform ${transitions.fast}`,
            "&:hover": {
              borderColor: alpha(brand.primary.main, 0.4),
              boxShadow: appColor("cardHoverShadow"),
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
          outlined: {
            borderColor: border,
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 10,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            border: `1px solid ${border}`,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8,
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "6px 10px",
            backgroundColor: appColor("tooltipBackground"),
            color: appColor("tooltipText"),
          },
        },
      },
      MuiAppBar: {
        defaultProps: {
          color: "transparent",
        },
        styleOverrides: {
          root: {
            background: appColor("appBarBackground"),
            backdropFilter: glassStyles.light.backdropFilter,
            border: appColor("appBarBorder"),
            color: "inherit",
            boxShadow: "none",
            borderLeft: "none",
            borderRight: "none",
            borderTop: "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: `1px solid ${border}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            marginTop: 8,
            border: `1px solid ${border}`,
            boxShadow: appColor("menuShadow"),
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: "2px 6px",
            transition: `all ${transitions.fast}`,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            height: 6,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
          },
        },
      },
    },
  });
}

// Default theme instance (light and dark schemes, switched by `data-theme`).
export const theme = createAppTheme();
