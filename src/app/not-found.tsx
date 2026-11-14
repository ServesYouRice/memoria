"use client";

import { Box, Button, Container, Link, Typography } from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";

export default function NotFound() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <Box sx={{ p: 2 }}>
        <Link
          href="/"
          aria-label="Memoria home"
          underline="none"
          color="text.primary"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            fontWeight: 700,
          }}
        >
          <MemoriaLogo size={32} />
          Memoria
        </Link>
      </Box>

      <Container
        maxWidth="sm"
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          pb: 8,
        }}
      >
        <Typography component="h1" variant="h4" sx={{ mb: 2 }}>
          Page not found
        </Typography>
        <Typography variant="body1" sx={{ color: "text.secondary", mb: 4 }}>
          The link may be old or mistyped.
        </Typography>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Button href="/dashboard" variant="contained" size="large">
            Go to my canvases
          </Button>
          <Button href="/search" variant="outlined" size="large">
            Search
          </Button>
        </Box>
      </Container>
    </Box>
  );
}
