import { Box, Button, Container, Typography } from "@mui/material";
import {
  Home as HomeIcon,
  ErrorOutline as NotFoundIcon,
} from "@mui/icons-material";
import { gradients } from "@/lib/theme";

export default function NotFound() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background: gradients.hero,
          pointerEvents: "none",
        }}
      />

      <Container maxWidth="sm" sx={{ position: "relative" }}>
        <Box sx={{ textAlign: "center", animation: "fadeIn 0.5s ease-out" }}>
          <Box
            sx={{
              width: 104,
              height: 104,
              borderRadius: "50%",
              bgcolor: "rgba(99, 102, 241, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mx: "auto",
              mb: 4,
              animation: "float 4s ease-in-out infinite",
            }}
          >
            <NotFoundIcon sx={{ fontSize: 52, color: "primary.main" }} />
          </Box>

          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: "5rem", md: "7rem" },
              lineHeight: 1,
              mb: 2,
              background: gradients.brand,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            404
          </Typography>

          <Typography variant="h4" sx={{ mb: 2 }}>
            Page not found
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 4, maxWidth: 400, mx: "auto", lineHeight: 1.7 }}
          >
            Oops! The canvas you&apos;re looking for seems to have wandered off
            into the infinite void. Let&apos;s get you back on track.
          </Typography>

          <Box
            sx={{
              display: "flex",
              gap: 2,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Button
              href="/dashboard"
              variant="contained"
              size="large"
              startIcon={<HomeIcon />}
            >
              Go to dashboard
            </Button>
            <Button href="/" variant="outlined" size="large">
              Go home
            </Button>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
