"use client";

import Link from "next/link";
import {
  Box,
  Button,
  Container,
  Divider,
  Stack,
  Typography,
} from "@mui/material";

export function PublicInfoPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
        <Button component={Link} href="/" sx={{ mb: 4 }}>
          ← Memoria
        </Button>
        <Typography component="h1" variant="h2" sx={{ textWrap: "balance" }}>
          {title}
        </Typography>
        <Typography
          sx={{
            color: "text.secondary",
            mt: 2,
            mb: 5,
            textWrap: "pretty",
          }}
        >
          {description}
        </Typography>
        <Stack spacing={4}>{children}</Stack>
        <Divider sx={{ my: 5 }} />
        <Stack
          direction="row"
          useFlexGap
          spacing={2}
          sx={{
            flexWrap: "wrap",
          }}
        >
          <Button component={Link} href="/help">
            Help
          </Button>
          <Button component={Link} href="/status">
            Status
          </Button>
          <Button component={Link} href="/privacy">
            Privacy
          </Button>
          <Button component={Link} href="/terms">
            Terms
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}

export function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box component="section">
      <Typography
        component="h2"
        variant="h5"
        gutterBottom
        sx={{ textWrap: "balance" }}
      >
        {title}
      </Typography>
      <Typography
        component="div"
        sx={{
          color: "text.secondary",
          lineHeight: 1.75,
          textWrap: "pretty",
        }}
      >
        {children}
      </Typography>
    </Box>
  );
}
