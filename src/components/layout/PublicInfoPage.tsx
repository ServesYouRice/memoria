"use client";

import Link from "next/link";
import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { useSession } from "@/lib/auth-client";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { AppShell, SHELL_MAX_WIDTH } from "@/components/layout/AppShell";

function PublicTopBar({ signInVisible }: { signInVisible: boolean }) {
  return (
    <AppBar position="sticky">
      <Container maxWidth={SHELL_MAX_WIDTH}>
        <Toolbar disableGutters sx={{ gap: 1 }}>
          <Box
            component={Link}
            href="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              textDecoration: "none",
              color: "inherit",
              flexGrow: 1,
            }}
          >
            <MemoriaLogo size={32} />
            <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
              Memoria
            </Typography>
          </Box>
          {signInVisible && (
            <Button component={Link} href="/auth/login" variant="contained">
              Sign in
            </Button>
          )}
        </Toolbar>
      </Container>
    </AppBar>
  );
}

function InfoContent({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
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
    </>
  );
}

/**
 * Help, Status, Privacy and Terms. Signed-in users get the normal app shell;
 * visitors get a simple bar with the logo and "Sign in". The page never
 * requires a session: its content renders the same either way.
 */
export function PublicInfoPage(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();

  if (session?.user) {
    return (
      <AppShell readingWidth="md">
        <InfoContent {...props} />
      </AppShell>
    );
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <PublicTopBar signInVisible={!isPending} />
      <Container
        component="main"
        id="main-content"
        maxWidth={SHELL_MAX_WIDTH}
        sx={{ py: { xs: 4, md: 8 } }}
      >
        <Box sx={{ maxWidth: (theme) => theme.breakpoints.values.md }}>
          <InfoContent {...props} />
        </Box>
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
