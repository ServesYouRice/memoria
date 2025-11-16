/**
 * Application Providers
 *
 * ENHANCED: Issue #42 - Dark mode support
 *
 * Wraps the application with necessary providers:
 * - ErrorBoundary for React error handling
 * - SessionProvider for authentication
 * - QueryClientProvider for server state
 * - ThemeModeProvider for dark mode state
 * - ThemeProvider for MUI theming
 */

'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { createAppTheme } from '@/lib/theme';
import { ThemeModeProvider, useThemeMode } from '@/lib/theme-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Inner providers that depend on theme context
 */
function ThemedProviders({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  const theme = React.useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
    </ThemeProvider>
  );
}

/**
 * Main providers component
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeModeProvider>
            <ThemedProviders>{children}</ThemedProviders>
          </ThemeModeProvider>
        </QueryClientProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
