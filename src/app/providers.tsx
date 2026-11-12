/**
 * Application Providers
 *
 * ENHANCED: Issue #42 - Dark mode support
 * ENHANCED: Phase 4 - Global keyboard shortcuts
 * ENHANCED: CSP nonce integration for MUI/Emotion styles
 *
 * Wraps the application with necessary providers:
 * - ErrorBoundary for React error handling
 * - QueryClientProvider for server state
 * - AppThemeProvider for MUI theming and dark mode state (CSS variables)
 * - AppRouterCacheProvider for Emotion styles (with CSP nonce)
 * - GlobalShortcutsProvider for keyboard shortcuts
 */

"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { Toaster } from "sonner";
import { AppThemeProvider, useThemeMode } from "@/lib/theme-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalShortcutsProvider } from "@/components/GlobalShortcutsProvider";
import { ConfirmDialogHost } from "@/components/ConfirmDialogHost";
import { isClientError } from "@/lib/api/fetch-client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
      // 4xx responses (401 expired session, 403, 404, validation errors)
      // won't succeed on retry — only retry transient failures.
      retry: (failureCount, error) => !isClientError(error) && failureCount < 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Side-effecting requests are not safe to replay unless the caller
      // explicitly supplies an idempotency key.
      retry: false,
    },
  },
});

/**
 * Inner providers that depend on theme context
 */
function ThemedProviders({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();

  return (
    <GlobalShortcutsProvider>
      {children}
      <ConfirmDialogHost />
      <Toaster richColors closeButton position="bottom-right" theme={mode} />
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools />}
    </GlobalShortcutsProvider>
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
      <QueryClientProvider client={queryClient}>
        <AppRouterCacheProvider options={{ nonce }}>
          <AppThemeProvider>
            <CssBaseline />
            <ThemedProviders>{children}</ThemedProviders>
          </AppThemeProvider>
        </AppRouterCacheProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
