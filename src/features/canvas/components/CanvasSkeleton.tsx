import React from "react";
import { Box, Skeleton, Paper, Typography } from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { appColor } from "@/lib/theme";

export const CanvasSkeleton = () => {
  return (
    <Box
      sx={{
        width: "100%",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: appColor("canvasBackground"),
      }}
    >
      {/* Header Skeleton */}
      <Paper
        elevation={0}
        sx={{
          height: 64,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: appColor("appBarBackground"),
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          px: 2,
          gap: 1.5,
        }}
      >
        <Skeleton
          variant="rounded"
          width={36}
          height={36}
          sx={{ borderRadius: 2 }}
        />
        <Skeleton variant="text" width={180} height={30} />
        <Box sx={{ flex: 1 }} />
        <Skeleton
          variant="rounded"
          width={88}
          height={36}
          sx={{ borderRadius: 2 }}
        />
        <Skeleton variant="circular" width={36} height={36} />
      </Paper>

      {/* Canvas Area Skeleton */}
      <Box
        sx={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
          backgroundImage: `radial-gradient(${appColor("canvasDot")} 1.2px, transparent 1.2px)`,
          backgroundSize: "20px 20px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            p: 3,
            borderRadius: 4,
            bgcolor: appColor("floatingSurface"),
            backdropFilter: "blur(12px)",
            border: `1px solid ${appColor("floatingBorder")}`,
            boxShadow: appColor("floatingShadow"),
          }}
        >
          <MemoriaLogo size={44} animated={false} pulsing />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Opening canvas…
          </Typography>
        </Box>

        {/* Bottom Dock Skeleton */}
        <Paper
          elevation={0}
          sx={{
            position: "absolute",
            left: "50%",
            bottom: { xs: 8, sm: 16 },
            transform: "translateX(-50%)",
            display: "flex",
            gap: 1,
            p: 1,
            borderRadius: 3,
            bgcolor: appColor("floatingSurface"),
            border: `1px solid ${appColor("floatingBorder")}`,
            boxShadow: appColor("floatingShadow"),
          }}
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton
              key={index}
              variant="rounded"
              width={44}
              height={40}
              sx={{ borderRadius: 2 }}
            />
          ))}
        </Paper>
      </Box>
    </Box>
  );
};
