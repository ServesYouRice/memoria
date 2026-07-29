import React from "react";
import { Box, Skeleton, Paper } from "@mui/material";

export const CanvasSkeleton = () => {
  return (
    <Box
      sx={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header Skeleton */}
      <Paper
        elevation={0}
        sx={{
          height: 64,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          px: 2,
          gap: 2,
        }}
      >
        <Skeleton
          variant="rectangular"
          width={32}
          height={32}
          sx={{ borderRadius: 1 }}
        />
        <Skeleton variant="text" width={200} height={32} />
        <Box sx={{ flex: 1 }} />
        <Skeleton variant="circular" width={40} height={40} />
        <Skeleton variant="circular" width={40} height={40} />
      </Paper>

      {/* Canvas Area Skeleton */}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          bgcolor: "background.default",
          p: 4,
        }}
      >
        {/* Simulated Items */}
        <Skeleton
          variant="rectangular"
          width={200}
          height={150}
          sx={{ position: "absolute", top: 100, left: 100, borderRadius: 2 }}
        />
        <Skeleton
          variant="rectangular"
          width={300}
          height={100}
          sx={{ position: "absolute", top: 300, left: 400, borderRadius: 2 }}
        />
        <Skeleton
          variant="rectangular"
          width={150}
          height={150}
          sx={{ position: "absolute", top: 150, left: 500, borderRadius: 2 }}
        />
      </Box>
    </Box>
  );
};
