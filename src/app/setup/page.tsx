import Link from "next/link";
import { Box, Alert, Button, Typography } from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { env } from "@/lib/env";
import { isBootstrapAvailable } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";
import { SetupForm } from "./SetupForm";
import { SetupCheck } from "./SetupCheck";

export default async function SetupPage() {
  const bootstrapAvailable = await isBootstrapAvailable();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        px: 3,
        py: 8,
        bgcolor: "background.default",
      }}
    >
      {!bootstrapAvailable ? (
        <Box sx={{ maxWidth: 640, mx: "auto" }}>
          <Box sx={{ mb: 3 }}>
            <MemoriaLogo size={40} />
          </Box>
          <Alert severity="info" sx={{ mb: 3 }}>
            Setup is already done on this installation.
          </Alert>
          <Button component={Link} href="/auth/login" variant="contained">
            Go to sign in
          </Button>
        </Box>
      ) : (
        <>
          <Box sx={{ maxWidth: 640, mx: "auto", mb: 3 }}>
            <Typography
              variant="overline"
              sx={{
                color: "text.secondary",
              }}
            >
              Memoria Bootstrap
            </Typography>
          </Box>
          <SetupCheck />
          <SetupForm needsToken={Boolean(env.APP_BOOTSTRAP_TOKEN)} />
        </>
      )}
    </Box>
  );
}
