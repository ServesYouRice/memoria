/**
 * Canvas Page
 *
 * Main canvas view integrating both NOTE and BOOKMARK items with zoom and pan controls
 */

'use client';

import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { CanvasSkeleton } from '@/features/canvas/components/CanvasSkeleton';

const queryClient = new QueryClient();

// Dynamically import CanvasBoard with SSR disabled to avoid Konva server-side issues
const CanvasBoard = dynamic(
  () => import('@/features/canvas/components/CanvasBoard').then((mod) => mod.CanvasBoard),
  {
    ssr: false,
    loading: () => <CanvasSkeleton />,
  }
);

interface CanvasPageProps {
  params: {
    canvasId: string;
  };
}

export default function CanvasPage({ params }: CanvasPageProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <CanvasBoard canvasId={params.canvasId} />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
