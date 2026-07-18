"use client";

import React from "react";
import Link from "next/link";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { gradients } from "@/lib/theme";

export interface AuthLayoutProps {
  children: React.ReactNode;
  /** Headline shown on the desktop brand panel. */
  headline?: string;
  /** Supporting copy shown under the headline. */
  tagline?: string;
}

/**
 * Shared split-panel layout for authentication pages:
 * brand panel (desktop only) + centered form column.
 */
export function AuthLayout({
  children,
  headline = "Welcome to Memoria",
  tagline = "A collaborative canvas for your notes, bookmarks, and ideas.",
}: AuthLayoutProps) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex" }}>
      {/* Brand panel */}
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flex: 1,
          background: gradients.brand,
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          p: 6,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 70%)",
            top: -140,
            right: -80,
            animation: "float 7s ease-in-out infinite",
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            width: 280,
            height: 280,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)",
            bottom: -80,
            left: "8%",
            animation: "float 9s ease-in-out 1s infinite",
          }}
        />

        <Box sx={{ position: "relative", textAlign: "center", maxWidth: 420 }}>
          <Box sx={{ width: 88, mx: "auto", mb: 4 }}>
            <MemoriaLogo size={88} />
          </Box>
          <Typography variant="h3" fontWeight={700} gutterBottom>
            {headline}
          </Typography>
          <Typography
            variant="h6"
            sx={{ opacity: 0.9, lineHeight: 1.7, fontWeight: 400 }}
          >
            {tagline}
          </Typography>
        </Box>
      </Box>

      {/* Form column */}
      <Box
        sx={{
          flex: { xs: 1, md: "0 0 520px" },
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          bgcolor: "background.default",
          p: { xs: 3, sm: 6 },
        }}
      >
        <Container maxWidth="sm">
          <Box sx={{ animation: "fadeIn 0.5s ease-out" }}>
            {/* Mobile logo */}
            <Box
              sx={{
                display: { xs: "flex", md: "none" },
                justifyContent: "center",
                mb: 4,
              }}
            >
              <MemoriaLogo size={56} />
            </Box>
            {children}
            <Stack
              direction="row"
              spacing={1}
              justifyContent="center"
              sx={{ mt: 4 }}
            >
              <Button component={Link} href="/privacy" size="small">
                Privacy
              </Button>
              <Button component={Link} href="/terms" size="small">
                Terms
              </Button>
              <Button component={Link} href="/help" size="small">
                Help
              </Button>
            </Stack>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
