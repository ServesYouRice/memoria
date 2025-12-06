'use client';

import { createTheme, PaletteMode, alpha } from '@mui/material/styles';

/**
 * Modern Theme Configuration for CanvasCollect
 * 
 * Color Psychology:
 * - Ocean blues: Trust, focus, calm productivity
 * - Seafoam/Teal accents: Clarity, creativity
 * - Warm coral: Energy for CTAs
 * - Soft gradients: Premium, modern feel
 */

// Core color palette - Oceanic & Calming
const colors = {
  // Primary - Deep ocean blue (focus & trust)
  primary: {
    light: '#4fc3f7',
    main: '#0288d1',
    dark: '#01579b',
    contrastText: '#ffffff',
  },
  // Secondary - Seafoam teal (creativity & clarity)
  secondary: {
    light: '#80cbc4',
    main: '#26a69a',
    dark: '#00796b',
    contrastText: '#ffffff',
  },
  // Accent - Coral (energy for CTAs)
  accent: {
    light: '#ff8a80',
    main: '#ff5252',
    dark: '#d32f2f',
  },
  // Success - Mint green
  success: {
    light: '#81c784',
    main: '#4caf50',
    dark: '#388e3c',
  },
  // Warning - Warm amber
  warning: {
    light: '#ffb74d',
    main: '#ff9800',
    dark: '#f57c00',
  },
  // Error - Soft red
  error: {
    light: '#e57373',
    main: '#f44336',
    dark: '#d32f2f',
  },
  // Gradients
  gradients: {
    primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    secondary: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    ocean: 'linear-gradient(135deg, #2E3192 0%, #1BFFFF 100%)',
    sunset: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    aurora: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    midnight: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
  },
};

// Glassmorphism styles
export const glassStyles = {
  light: {
    background: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
  },
  dark: {
    background: 'rgba(30, 30, 30, 0.8)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
};

// Animation timing
export const transitions = {
  fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
  normal: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
  slow: '350ms cubic-bezier(0.4, 0, 0.2, 1)',
  bounce: '500ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
};

export function createAppTheme(mode: PaletteMode) {
  const isLight = mode === 'light';

  return createTheme({
    palette: {
      mode,
      primary: {
        light: colors.primary.light,
        main: isLight ? colors.primary.main : colors.primary.light,
        dark: colors.primary.dark,
        contrastText: colors.primary.contrastText,
      },
      secondary: {
        light: colors.secondary.light,
        main: isLight ? colors.secondary.main : colors.secondary.light,
        dark: colors.secondary.dark,
        contrastText: colors.secondary.contrastText,
      },
      success: colors.success,
      warning: colors.warning,
      error: colors.error,
      background: {
        default: isLight ? '#f8fafc' : '#0f172a',
        paper: isLight ? '#ffffff' : '#1e293b',
      },
      text: {
        primary: isLight ? '#1e293b' : '#f1f5f9',
        secondary: isLight ? '#64748b' : '#94a3b8',
      },
      divider: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)',
    },
    typography: {
      fontFamily: '"Inter", "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif',
      h1: {
        fontWeight: 800,
        letterSpacing: '-0.02em',
      },
      h2: {
        fontWeight: 700,
        letterSpacing: '-0.01em',
      },
      h3: {
        fontWeight: 700,
        letterSpacing: '-0.01em',
      },
      h4: {
        fontWeight: 600,
      },
      h5: {
        fontWeight: 600,
      },
      h6: {
        fontWeight: 600,
      },
      button: {
        fontWeight: 600,
        letterSpacing: '0.01em',
      },
    },
    shape: {
      borderRadius: 12,
    },
    shadows: [
      'none',
      '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
      '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
      '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
      '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      // Colored shadows for special elements
      `0 10px 40px -10px ${alpha(colors.primary.main, 0.4)}`,
      `0 10px 40px -10px ${alpha(colors.secondary.main, 0.4)}`,
      `0 10px 40px -10px ${alpha(colors.accent.main, 0.4)}`,
      // Keep rest as standard
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    ],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            scrollBehavior: 'smooth',
          },
          body: {
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: isLight ? '#f1f5f9' : '#1e293b',
            },
            '&::-webkit-scrollbar-thumb': {
              background: isLight ? '#cbd5e1' : '#475569',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: isLight ? '#94a3b8' : '#64748b',
            },
          },
          '@keyframes fadeIn': {
            from: { opacity: 0, transform: 'translateY(10px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '@keyframes slideIn': {
            from: { opacity: 0, transform: 'translateX(-10px)' },
            to: { opacity: 1, transform: 'translateX(0)' },
          },
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 },
          },
          '@keyframes shimmer': {
            '0%': { backgroundPosition: '-200% 0' },
            '100%': { backgroundPosition: '200% 0' },
          },
          '@keyframes float': {
            '0%, 100%': { transform: 'translateY(0px)' },
            '50%': { transform: 'translateY(-10px)' },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 10,
            padding: '10px 20px',
            transition: `all ${transitions.normal}`,
            '&:hover': {
              transform: 'translateY(-2px)',
            },
            '&:active': {
              transform: 'translateY(0)',
            },
          },
          contained: {
            boxShadow: '0 4px 14px 0 rgba(0, 0, 0, 0.1)',
            '&:hover': {
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
            },
          },
          containedPrimary: {
            background: colors.gradients.primary,
            '&:hover': {
              background: colors.gradients.primary,
              filter: 'brightness(1.1)',
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            transition: `all ${transitions.normal}`,
            border: isLight ? '1px solid rgba(0, 0, 0, 0.05)' : '1px solid rgba(255, 255, 255, 0.05)',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: isLight
                ? '0 20px 40px rgba(0, 0, 0, 0.12)'
                : '0 20px 40px rgba(0, 0, 0, 0.4)',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          elevation1: {
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
          },
          elevation2: {
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
          },
          elevation3: {
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
              transition: `all ${transitions.normal}`,
              '&:hover': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: colors.primary.main,
                },
              },
              '&.Mui-focused': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: 2,
                },
              },
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 20,
            ...(isLight ? glassStyles.light : glassStyles.dark),
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
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '8px 12px',
            backgroundColor: isLight ? '#1e293b' : '#f1f5f9',
            color: isLight ? '#f1f5f9' : '#1e293b',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            ...(isLight ? glassStyles.light : glassStyles.dark),
            boxShadow: 'none',
            borderBottom: isLight
              ? '1px solid rgba(0, 0, 0, 0.08)'
              : '1px solid rgba(255, 255, 255, 0.08)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            borderRight: isLight
              ? '1px solid rgba(0, 0, 0, 0.08)'
              : '1px solid rgba(255, 255, 255, 0.08)',
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            marginTop: 8,
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)',
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: '2px 8px',
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
      MuiAvatar: {
        styleOverrides: {
          root: {
            border: '2px solid',
            borderColor: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)',
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
    },
  });
}

// Export gradients for use in components
export const gradients = colors.gradients;

// Default light theme for backwards compatibility
export const theme = createAppTheme('light');
