"use client";

import { createTheme, type PaletteMode, alpha } from "@mui/material/styles";

/**
 * Memoria design tokens & MUI theme.
 *
 * Single source of truth for brand colors, fonts, surfaces, and component
 * styling. Pages must consume these tokens (via the theme or the
 * exported `brand`/`surfaces` objects) instead of hard-coding hexes.
 */

// Brand palette, taken from the logo (IMP-079): navy for headings and dark
// surfaces, one solid blue for actions, yellow only as a highlight, red only
// for errors, destructive actions and unread counts. No gradients.
export const brand = {
  primary: {
    light: "#93c5fd",
    main: "#2c5fc9",
    dark: "#1f4aa8",
    contrastText: "#ffffff",
  },
  secondary: {
    light: "#3a4580",
    main: "#1c2452",
    dark: "#121836",
    contrastText: "#ffffff",
  },
  highlight: "#fbbf24",
  success: {
    light: "#4ade80",
    main: "#16a34a",
    dark: "#15803d",
  },
  warning: {
    light: "#fbbf24",
    main: "#f59e0b",
    dark: "#d97706",
  },
  // The logo red, nudged one step darker so error text keeps 4.5:1 on the
  // page background as well as on white.
  error: {
    light: "#fb7185",
    main: "#d61a44",
    dark: "#be123c",
  },
  info: {
    light: "#93c5fd",
    main: "#2c5fc9",
    dark: "#1f4aa8",
  },
};

export const fonts = {
  heading:
    '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  body: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/** Solid brand surfaces (the brand uses no gradients). */
export const surfaces = {
  /** Solid brand blue: avatars and other small brand fills. */
  brand: brand.primary.main,
  /** Navy panel, for large brand areas with white text. */
  navy: brand.secondary.main,
  /** Faint blue tint behind previews and icons. */
  brandSoft: alpha(brand.primary.main, 0.1),
  /** Very faint tint for page backdrops. */
  hero: alpha(brand.primary.main, 0.05),
  /** Soft white glows drawn over the navy panel. */
  glow: `radial-gradient(circle, ${alpha("#ffffff", 0.16)} 0%, transparent 70%)`,
  glowSoft: `radial-gradient(circle, ${alpha("#ffffff", 0.12)} 0%, transparent 70%)`,
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
/**
 * IMP-090: the smallest hit area for a control on a touch screen. Mouse
 * users keep the compact sizes.
 */
export const TOUCH_TARGET = 44;
const touchTarget = {
  "@media (pointer: coarse)": {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
  },
};

export const motion = {
  /** Crisp entrance curve for panels, menus, and toolbars. */
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Faster exit curve so dismissals feel effortless. */
  easeIn: "cubic-bezier(0.7, 0, 0.84, 0)",
  /** Smooth settle curve for modals, drawers, and elevated cards. */
  springGentle: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Native CSS linear() spring for tactile micro-interactions. */
  springSnappy:
    "linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)",
} as const;

export const transitions = {
  fast: `150ms ${motion.easeOut}`,
  normal: `240ms ${motion.springGentle}`,
  slow: `340ms ${motion.springGentle}`,
  spring: `360ms ${motion.springSnappy}`,
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
    floatingSurface: "rgba(255, 255, 255, 0.86)",
    floatingBorder: "rgba(15, 23, 42, 0.09)",
    floatingShadow:
      "0 8px 28px rgba(15, 23, 42, 0.1), 0 1px 3px rgba(15, 23, 42, 0.06)",
    menuShadow: "0 10px 32px rgba(15, 23, 42, 0.12)",
    cardHoverShadow: `0 10px 28px ${alpha(brand.secondary.main, 0.09)}`,
    // Flat, muted disabled fill with a label that keeps at least 3:1 contrast.
    disabledButtonBackground: "#e2e8f0",
    disabledButtonText: "#64748b",
    canvasBackground: "#f4f5f7",
    canvasGrid: "#e2e6ed",
    /** IMP-085: the faint dots of the default canvas background. */
    canvasDot: "#cbd2de",
    focusRing: brand.primary.main,
    /** IMP-125: "Live" label on its green tint (6.1:1; success.dark is 4.3:1). */
    liveStatusText: "#166534",
  },
  dark: {
    border: "rgba(241, 245, 249, 0.08)",
    scrollbarThumb: "#475569",
    scrollbarTrack: "#111a2e",
    tooltipBackground: "#f1f5f9",
    tooltipText: "#0f172a",
    appBarBackground: glassStyles.dark.background,
    appBarBorder: glassStyles.dark.border,
    floatingSurface: "rgba(17, 26, 46, 0.86)",
    floatingBorder: "rgba(241, 245, 249, 0.1)",
    floatingShadow:
      "0 12px 32px rgba(0, 0, 0, 0.52), 0 1px 2px rgba(0, 0, 0, 0.35)",
    menuShadow: "0 10px 32px rgba(0, 0, 0, 0.5)",
    cardHoverShadow: "0 10px 28px rgba(0, 0, 0, 0.44)",
    disabledButtonBackground: "#1e293b",
    disabledButtonText: "#94a3b8",
    canvasBackground: "#0d1526",
    canvasGrid: "#1e293b",
    canvasDot: "#2b3a55",
    focusRing: brand.primary.light,
    /** IMP-125: success.light on the green tint, 7.8:1. */
    liveStatusText: brand.success.light,
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
    // Light: the solid brand blue (5.8:1 on white). Dark: the logo's light
    // blue with navy labels on filled controls.
    primary: isLight
      ? brand.primary
      : {
          light: "#bfdbfe",
          main: brand.primary.light,
          dark: "#60a5fa",
          contrastText: brand.secondary.main,
        },
    secondary: isLight
      ? brand.secondary
      : {
          light: "#e0e7ff",
          main: "#c7d2fe",
          dark: "#a5b4fc",
          contrastText: brand.secondary.main,
        },
    success: brand.success,
    warning: brand.warning,
    error: isLight
      ? brand.error
      : { light: "#fda4af", main: brand.error.light, dark: brand.error.main },
    info: isLight
      ? brand.info
      : {
          light: "#bfdbfe",
          main: brand.primary.light,
          dark: "#60a5fa",
          contrastText: brand.secondary.main,
        },
    background: {
      default: isLight ? "#f8fafc" : "#0b1120",
      paper: isLight ? "#ffffff" : "#111a2e",
    },
    text: {
      primary: isLight ? brand.secondary.main : "#f1f5f9",
      secondary: isLight ? "#55607a" : "#a3aec2",
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
      fontFamily: fonts.body,
      h1: {
        fontFamily: fonts.heading,
        fontWeight: 800,
        letterSpacing: "-0.025em",
        textWrap: "balance",
      },
      h2: {
        fontFamily: fonts.heading,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        textWrap: "balance",
      },
      h3: {
        fontFamily: fonts.heading,
        fontWeight: 700,
        letterSpacing: "-0.015em",
        textWrap: "balance",
      },
      h4: {
        fontFamily: fonts.heading,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        textWrap: "balance",
      },
      h5: { fontFamily: fonts.heading, fontWeight: 600, textWrap: "balance" },
      h6: { fontFamily: fonts.heading, fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
      body1: { textWrap: "pretty" },
      body2: { textWrap: "pretty" },
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
              outline: `2px solid ${appColor("focusRing")}`,
              outlineOffset: "2px",
            },
          },
          body: {
            minBlockSize: "100dvh",
          },
          ":root": tokenDeclarations("light"),
          [DARK_SCHEME_SELECTOR]: tokenDeclarations("dark"),
          "@media (prefers-reduced-motion: no-preference)": {
            "@view-transition": {
              navigation: "auto",
            },
          },
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
            from: { opacity: 0, transform: "translateY(6px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
          "@keyframes slideIn": {
            from: { opacity: 0, transform: "translateX(-8px)" },
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
          "@keyframes popIn": {
            "0%": { opacity: 0, transform: "scale(0.84)" },
            "100%": { opacity: 1, transform: "scale(1)" },
          },
          "@keyframes reactionFloat": {
            "0%": {
              opacity: 0,
              transform: "translate(-50%, -50%) scale(0.35)",
            },
            "14%": {
              opacity: 1,
              transform: "translate(-50%, -58%) scale(1.16)",
            },
            "24%": {
              opacity: 1,
              transform: "translate(-50%, -64%) scale(1)",
            },
            "78%": {
              opacity: 1,
              transform: "translate(-48%, -108%) scale(1)",
            },
            "100%": {
              opacity: 0,
              transform: "translate(-52%, -132%) scale(0.92)",
            },
          },
          "@keyframes bubblePop": {
            "0%": { opacity: 0, transform: "scale(0.82) translateY(4px)" },
            "100%": { opacity: 1, transform: "scale(1) translateY(0)" },
          },
          "@keyframes toolbarIn": {
            "0%": { opacity: 0, transform: "translateY(6px) scale(0.96)" },
            "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
          },
          "@keyframes livePulse": {
            "0%": { transform: "scale(1)", opacity: 0.55 },
            "70%": { transform: "scale(2.1)", opacity: 0 },
            "100%": { transform: "scale(2.1)", opacity: 0 },
          },
          "@keyframes cardShuffleIn": {
            "0%": { opacity: 0, transform: "translateX(12px)" },
            "100%": { opacity: 1, transform: "translateX(0)" },
          },
          "@keyframes checkPop": {
            "0%": { opacity: 0, transform: "scale(0.5) rotate(-20deg)" },
            "100%": { opacity: 1, transform: "scale(1) rotate(0deg)" },
          },
          "@keyframes logoBloomPulse": {
            "0%, 100%": { transform: "rotate(12deg) scale(1)" },
            "50%": { transform: "rotate(26deg) scale(1.06)" },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: `background-color ${transitions.fast}, color ${transitions.fast}, transform ${transitions.fast}`,
            "&:active:not(:disabled)": {
              transform: "scale(0.93)",
            },
            ...touchTarget,
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: { root: touchTarget },
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
            transition: `background-color ${transitions.fast}, border-color ${transitions.fast}, color ${transitions.fast}, box-shadow ${transitions.fast}, transform ${transitions.fast}`,
            "&:active:not(:disabled)": {
              transform: "scale(0.975)",
            },
            ...touchTarget,
          },
          sizeLarge: {
            padding: "12px 28px",
            fontSize: "1rem",
          },
        },
        // MUI v9 dropped the `containedPrimary` style-override slot; the same
        // rule is now expressed as a variant match. Solid fill, no gradient.
        variants: [
          {
            props: { variant: "contained", color: "primary" },
            style: {
              "&:hover": {
                boxShadow: `0 4px 16px ${alpha(brand.primary.main, 0.3)}`,
              },
              // A flat, muted disabled state whose label stays readable.
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
            transition: `background-color ${transitions.fast}, color ${transitions.fast}`,
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
