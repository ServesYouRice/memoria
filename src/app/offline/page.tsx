import { Box, Button, Container, Paper, Typography } from "@mui/material";

export const metadata = {
  title: "Offline | Memoria",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <Paper sx={{ p: { xs: 3, sm: 5 }, textAlign: "center" }}>
          <Typography component="h1" variant="h4" gutterBottom>
            You’re offline
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Memoria keeps private canvases on the network path, so personal data
            is never served from a shared browser cache. Reconnect to continue.
          </Typography>
          <Button href="/" variant="contained">
            Try again
          </Button>
        </Paper>
      </Box>
    </Container>
  );
}
