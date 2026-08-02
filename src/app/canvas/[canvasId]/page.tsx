/**
 * Canvas Page
 *
 * Main canvas view integrating both NOTE and BOOKMARK items with zoom and pan controls
 */

"use client";

import React from "react";
import { CanvasErrorBoundary } from "@/features/canvas/components/CanvasErrorBoundary";
import dynamic from "next/dynamic";
import { CanvasSkeleton } from "@/features/canvas/components/CanvasSkeleton";

// Dynamically import CanvasBoard with SSR disabled to avoid Konva server-side issues
const CanvasBoard = dynamic(
  () =>
    import("@/features/canvas/components/CanvasBoard").then(
      (mod) => mod.CanvasBoard,
    ),
  {
    ssr: false,
    loading: () => <CanvasSkeleton />,
  },
);

interface CanvasPageProps {
  params: Promise<{
    canvasId: string;
  }>;
}

export default function CanvasPage({ params }: CanvasPageProps) {
  const { canvasId } = React.use(params);

  return (
    <CanvasErrorBoundary>
      <CanvasBoard canvasId={canvasId} />
    </CanvasErrorBoundary>
  );
}
