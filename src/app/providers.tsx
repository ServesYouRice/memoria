/**
 * Application Providers
 *
 * ENHANCED: Issue #42 - Dark mode support
 * ENHANCED: Phase 4 - Global keyboard shortcuts
 * ENHANCED: CSP nonce integration for MUI/Emotion styles
 *
 * Wraps the application with necessary providers:
 * - ErrorBoundary for React error handling
 * - SessionProvider for authentication
 * - QueryClientProvider for server state
 * - ThemeModeProvider for dark mode state
 * - ThemeProvider for MUI theming (with CSP nonce)
 * - GlobalShortcutsProvider for keyboard shortcuts
 */

'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/lib/theme';
import { ThemeModeProvider, useThemeMode } from '@/lib/theme-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GlobalShortcutsProvider } from '@/components/GlobalShortcutsProvider';


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

interface ThemedProvidersProps {
  children: React.ReactNode;
  nonce?: string;
}

/**
 * Inner providers that depend on theme context
 */
function ThemedProviders({ children, nonce }: ThemedProvidersProps) {
  const { mode } = useThemeMode();
  const theme = React.useMemo(() => createAppTheme(mode), [mode]);

  return (
    <AppRouterCacheProvider options={{ nonce }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalShortcutsProvider>
          {children}
          {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
        </GlobalShortcutsProvider>
      </MuiThemeProvider>
    </AppRouterCacheProvider>
  );
}

interface ProvidersProps {
  children: React.ReactNode;
  nonce?: string;
}

/**
 * Main providers component
 */
export function Providers({ children, nonce }: ProvidersProps) {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeModeProvider>
            <ThemedProviders nonce={nonce}>{children}</ThemedProviders>
          </ThemeModeProvider>
        </QueryClientProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}

