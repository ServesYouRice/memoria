"use client";

import React from "react";
import { Box, Skeleton } from "@mui/material";
import { CanvasCardSkeleton, CardGrid } from "./CanvasCard";

/**
 * Suspense fallback for the dashboard page.
 * Mirrors the PageHeader + card grid layout of DashboardContent.
 */
export function DashboardSkeleton() {
  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Skeleton width={220} height={40} />
        <Skeleton width={160} height={20} />
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <CardGrid>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CanvasCardSkeleton key={i} index={i} />
          ))}
        </CardGrid>
        <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 2 }} />
      </Box>
    </Box>
  );
}
