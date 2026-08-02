import React from "react";
import { Box, Container, Skeleton, Stack } from "@mui/material";

/**
 * Neutral loading placeholder for protected routes whose data is fetched on the
 * server. It claims nothing about state — it only reserves the page shape while
 * the route segment resolves.
 */
export function RouteLoadingSkeleton() {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }} aria-busy="true" aria-live="polite">
      <Box
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        Loading…
      </Box>
      <Skeleton variant="text" width={220} height={44} />
      <Skeleton variant="text" width={340} height={24} sx={{ mb: 3 }} />
      <Stack spacing={2}>
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} variant="rounded" height={88} />
        ))}
      </Stack>
    </Container>
  );
}
