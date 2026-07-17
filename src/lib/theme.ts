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

export function createAppTheme(mode: PaletteMode) {
  const isLight = mode === "light";

  return createTheme({
    palette: {
      mode,
      primary: {
        light: brand.primary.light,
        main: isLight ? brand.primary.main : brand.primary.light,
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
      divider: isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(241, 245, 249, 0.08)",
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
            "& *:focus-visible": {
              outline: `2px solid ${brand.primary.main}`,
              outlineOffset: "2px",
            },
          },
          body: {
            scrollbarWidth: "thin",
            "&::-webkit-scrollbar": { width: "8px", height: "8px" },
            "&::-webkit-scrollbar-track": {
              background: isLight ? "#f1f5f9" : "#111a2e",
            },
            "&::-webkit-scrollbar-thumb": {
              background: isLight ? "#cbd5e1" : "#475569",
              borderRadius: "4px",
            },
            "&::-webkit-scrollbar-thumb:hover": {
              background: isLight ? "#94a3b8" : "#64748b",
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
          containedPrimary: {
            background: gradients.brand,
            "&:hover": {
              background: gradients.brand,
              filter: "brightness(1.08)",
              boxShadow: `0 4px 16px ${alpha(brand.primary.main, 0.35)}`,
            },
          },
          sizeLarge: {
            padding: "12px 28px",
            fontSize: "1rem",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            backgroundImage: "none",
            boxShadow: "none",
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(241, 245, 249, 0.08)"}`,
            transition: `border-color ${transitions.fast}, box-shadow ${transitions.fast}, transform ${transitions.fast}`,
            "&:hover": {
              borderColor: alpha(brand.primary.main, 0.4),
              boxShadow: isLight
                ? `0 8px 24px ${alpha(brand.primary.main, 0.08)}`
                : "0 8px 24px rgba(0, 0, 0, 0.4)",
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
            borderColor: isLight
              ? "rgba(15, 23, 42, 0.08)"
              : "rgba(241, 245, 249, 0.08)",
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
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(241, 245, 249, 0.08)"}`,
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
            backgroundColor: isLight ? "#0f172a" : "#f1f5f9",
            color: isLight ? "#f1f5f9" : "#0f172a",
          },
        },
      },
      MuiAppBar: {
        defaultProps: {
          color: "transparent",
        },
        styleOverrides: {
          root: {
            ...(isLight ? glassStyles.light : glassStyles.dark),
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
            borderRight: isLight
              ? "1px solid rgba(15, 23, 42, 0.08)"
              : "1px solid rgba(241, 245, 249, 0.08)",
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            marginTop: 8,
            border: `1px solid ${isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(241, 245, 249, 0.08)"}`,
            boxShadow: isLight
              ? "0 10px 32px rgba(15, 23, 42, 0.12)"
              : "0 10px 32px rgba(0, 0, 0, 0.5)",
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

// Default light theme for backwards compatibility
export const theme = createAppTheme("light");
