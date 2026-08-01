"use client";

import { useEffect } from "react";
import { Box, Button, Container, Typography, alpha } from "@mui/material";
import {
  Refresh as RefreshIcon,
  Home as HomeIcon,
  Warning as ErrorIcon,
} from "@mui/icons-material";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Application error:", error);
  }, [error]);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Container maxWidth="sm">
        <Box sx={{ textAlign: "center", animation: "fadeIn 0.5s ease-out" }}>
          <Box
            sx={{
              width: 104,
              height: 104,
              borderRadius: "50%",
              bgcolor: (theme) => alpha(theme.palette.error.main, 0.1),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mx: "auto",
              mb: 4,
              animation: "pulse 2s ease-in-out infinite",
            }}
          >
            <ErrorIcon sx={{ fontSize: 52, color: "error.main" }} />
          </Box>

          <Typography variant="h4" sx={{ mb: 2 }}>
            Something went wrong
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 2, maxWidth: 400, mx: "auto", lineHeight: 1.7 }}
          >
            We encountered an unexpected error. Changes that had not finished
            saving may not have been stored. Please try again or return to the
            home page.
          </Typography>

          {error.digest && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 4, fontFamily: "monospace" }}
            >
              Error ID: {error.digest}
            </Typography>
          )}

          <Box
            sx={{
              display: "flex",
              gap: 2,
              justifyContent: "center",
              flexWrap: "wrap",
              mt: 2,
            }}
          >
            <Button
              onClick={reset}
              variant="contained"
              size="large"
              startIcon={<RefreshIcon />}
            >
              Try again
            </Button>
            <Button
              href="/"
              variant="outlined"
              size="large"
              startIcon={<HomeIcon />}
            >
              Go home
            </Button>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
