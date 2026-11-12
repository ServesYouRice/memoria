"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { surfaces } from "@/lib/theme";

export interface AuthLayoutProps {
  children: React.ReactNode;
  /** One short line shown under the canvas picture on the desktop panel. */
  headline?: string;
}

/**
 * Shared split layout for authentication pages (IMP-082): on desktop the
 * form takes at least half the width and the navy panel shows a picture of
 * a real canvas with one short line; on a phone only the logo remains.
 */
export function AuthLayout({
  children,
  headline = "Your notes, links and pictures on one canvas.",
}: AuthLayoutProps) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex" }}>
      {/* Brand panel */}
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flex: "1 1 0",
          minWidth: 0,
          background: surfaces.navy,
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          p: 6,
          color: "common.white",
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
            background: surfaces.glow,
            top: -140,
            right: -80,
          }}
        />

        <Box sx={{ position: "relative", width: "100%", maxWidth: 560 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              mb: 4,
            }}
          >
            <MemoriaLogo size={40} />
            <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
              Memoria
            </Typography>
          </Box>
          <Box
            sx={{
              borderRadius: 3,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              mb: 3,
              "& img": { display: "block", width: "100%", height: "auto" },
            }}
          >
            {/* The dark picture suits the navy panel in both colour modes. */}
            <Image
              src="/home/canvas-dark.webp"
              width={1260}
              height={645}
              alt=""
              loading="eager"
              unoptimized
            />
          </Box>
          <Typography
            variant="h5"
            component="p"
            sx={{ fontWeight: 600, lineHeight: 1.4 }}
          >
            {headline}
          </Typography>
        </Box>
      </Box>

      {/* Form column */}
      <Box
        sx={{
          // At least half the width on desktop (IMP-082).
          flex: { xs: "1 1 0", md: "0 0 50%" },
          minWidth: 0,
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
              sx={{
                justifyContent: "center",
                mt: 4,
              }}
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
