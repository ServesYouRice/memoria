'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { GlobalShortcutsProvider } from '@/components/GlobalShortcutsProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <CssBaseline />
          <GlobalShortcutsProvider>
            {children}
            {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
          </GlobalShortcutsProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
