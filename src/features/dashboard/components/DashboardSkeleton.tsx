"use client";

import React from "react";
import { Box, Skeleton } from "@mui/material";
import { PageHeader } from "@/components/layout/PageHeader";
import { CanvasCardSkeleton, CardGrid } from "./CanvasCard";

/**
 * Loading fallback for the dashboard route's Suspense boundary. Mirrors the
 * shape of DashboardContent (page header + canvas card grid) so users see the
 * familiar layout instead of a blank flash while the client bundle and data
 * hydrate.
 */
export function DashboardSkeleton() {
  return (
    <>
      <PageHeader
        title="My canvases"
        subtitle={<Skeleton width={220} />}
        actions={<Skeleton variant="rounded" width={140} height={40} />}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Box>
          <CardGrid>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <CanvasCardSkeleton key={i} index={i} />
            ))}
          </CardGrid>
        </Box>
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <Skeleton variant="rounded" height={320} />
        </Box>
      </Box>
    </>
  );
}
