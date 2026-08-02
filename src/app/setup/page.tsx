import { Box, Alert, Typography } from "@mui/material";
import { env } from "@/lib/env";
import { isBootstrapAvailable } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";
import { SetupForm } from "./SetupForm";

export default async function SetupPage() {
  const bootstrapAvailable = await isBootstrapAvailable();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        px: 3,
        py: 8,
        background: "linear-gradient(180deg, #f4efe2 0%, #ffffff 100%)",
      }}
    >
      {!bootstrapAvailable ? (
        <Box sx={{ maxWidth: 640, mx: "auto" }}>
          <Alert severity="info">
            Initial setup is disabled because this instance already has at least
            one user.
          </Alert>
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
          <SetupForm needsToken={Boolean(env.APP_BOOTSTRAP_TOKEN)} />
        </>
      )}
    </Box>
  );
}
