import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  Box,
  Button,
  Container,
  Typography,
  Card,
  CardContent,
  Stack,
  Divider,
} from "@mui/material";
import {
  Dashboard as MultiCanvasIcon,
  Lock as SecurityIcon,
  Speed as PerformanceIcon,
  Devices as ExportIcon,
  BrushOutlined as CanvasIcon,
  Groups as CollaborationIcon,
  BookmarkBorder as BookmarkIcon,
} from "@mui/icons-material";
import { MemoriaLogo } from "@/components/MemoriaLogo";

const FEATURES = [
  {
    icon: MultiCanvasIcon,
    title: "Multi-canvas",
    description:
      "Create unlimited canvases to organize different projects, ideas, and workflows.",
  },
  {
    icon: CanvasIcon,
    title: "Infinite canvas",
    description:
      "Pan, zoom, and arrange your notes freely on an unlimited workspace.",
  },
  {
    icon: CollaborationIcon,
    title: "Real-time collaboration",
    description:
      "Work together with your team in real time with presence and live cursors.",
  },
  {
    icon: SecurityIcon,
    title: "Security first",
    description:
      "Enterprise-grade security with Argon2 hashing, rate limiting, and strict CSP.",
  },
  {
    icon: PerformanceIcon,
    title: "Lightning fast",
    description:
      "Optimized performance with instant autosave and efficient state management.",
  },
  {
    icon: ExportIcon,
    title: "Export anywhere",
    description:
      "Export your canvases as PNG, PDF, or JSON for sharing and presentations.",
  },
];

// Keep public-page tokens server-safe: this page must render before the client
// theme provider exists, so it cannot import the client-only theme module.
const PAGE_GRADIENTS = {
  brand: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  brandSoft:
    "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.12) 100%)",
  hero: "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(99,102,241,0.25), transparent), radial-gradient(ellipse 60% 50% at 80% 40%, rgba(139,92,246,0.15), transparent)",
};
const HERO_BORDER_COLOR = "rgba(99,102,241,0.3)";
const PREVIEW_SHADOW = "0 24px 64px rgba(99,102,241,0.12)";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      {/* Top bar */}
      <Container maxWidth="lg">
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            py: 2.5,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MemoriaLogo size={34} />
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
              }}
            >
              Memoria
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5}>
            <Button href="/auth/login" color="inherit">
              Sign in
            </Button>
            <Button href="/auth/register" variant="contained">
              Get started
            </Button>
          </Stack>
        </Box>
      </Container>

      {/* Hero */}
      <Box sx={{ position: "relative", overflow: "hidden" }}>
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            background: PAGE_GRADIENTS.hero,
            pointerEvents: "none",
          }}
        />
        <Container
          maxWidth="md"
          sx={{
            position: "relative",
            textAlign: "center",
            py: { xs: 10, md: 14 },
          }}
        >
          <Typography
            variant="body2"
            sx={{
              display: "inline-block",
              px: 1.5,
              py: 0.5,
              mb: 3,
              borderRadius: 99,
              border: "1px solid",
              borderColor: HERO_BORDER_COLOR,
              color: "primary.main",
              fontWeight: 600,
            }}
          >
            Notes • Bookmarks • Images • Rich text
          </Typography>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: "2.5rem", sm: "3.25rem", md: "4rem" },
              lineHeight: 1.08,
              mb: 3,
            }}
          >
            Organize your ideas on an{" "}
            <Box
              component="span"
              sx={{
                background: PAGE_GRADIENTS.brand,
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              infinite canvas
            </Box>
          </Typography>
          <Typography
            variant="h6"
            sx={{
              color: "text.secondary",
              fontWeight: 400,
              lineHeight: 1.6,
              maxWidth: 560,
              mx: "auto",
              mb: 5,
            }}
          >
            Memoria is a collaborative canvas for notes and bookmarks —
            beautiful, secure, and blazing fast, designed for modern teams and
            creative minds.
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{
              justifyContent: "center",
            }}
          >
            <Button href="/auth/register" variant="contained" size="large">
              Get started free
            </Button>
            <Button href="/auth/login" variant="outlined" size="large">
              Sign in
            </Button>
          </Stack>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 2.5,
            }}
          >
            No credit card required • Free forever
          </Typography>

          {/* Preview card */}
          <Box
            sx={{
              mt: 8,
              mx: "auto",
              maxWidth: 480,
              p: 4,
              borderRadius: 4,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              boxShadow: PREVIEW_SHADOW,
              animation: "fadeIn 0.8s ease-out 0.2s both",
            }}
          >
            <Stack
              direction="row"
              spacing={2}
              sx={{
                justifyContent: "center",
                mb: 2.5,
              }}
            >
              {[CanvasIcon, BookmarkIcon].map((Icon, i) => (
                <Box
                  key={i}
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 3,
                    background: PAGE_GRADIENTS.brandSoft,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    animation: `float 4s ease-in-out ${i * 0.5}s infinite`,
                  }}
                >
                  <Icon sx={{ fontSize: 30, color: "primary.main" }} />
                </Box>
              ))}
            </Stack>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 600,
              }}
            >
              Everything in one place
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              Sticky notes, bookmarks, images, and rich text — arranged your
              way.
            </Typography>
          </Box>
        </Container>
      </Box>

      {/* Features */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <Box sx={{ textAlign: "center", mb: 7 }}>
          <Typography
            variant="h2"
            sx={{ fontSize: { xs: "2rem", md: "2.75rem" }, mb: 1.5 }}
          >
            Everything you need
          </Typography>
          <Typography
            variant="h6"
            sx={{
              color: "text.secondary",
              fontWeight: 400,
              maxWidth: 600,
              mx: "auto",
            }}
          >
            Powerful features to capture, organize, and collaborate on your
            ideas
          </Typography>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
            },
            gap: 3,
          }}
        >
          {FEATURES.map((feature, index) => (
            <Card
              key={feature.title}
              sx={{ animation: `fadeIn 0.5s ease-out ${index * 0.08}s both` }}
            >
              <CardContent sx={{ p: 3.5 }}>
                <Box
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: 2.5,
                    background: PAGE_GRADIENTS.brandSoft,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 2.5,
                  }}
                >
                  <feature.icon sx={{ fontSize: 26, color: "primary.main" }} />
                </Box>
                <Typography
                  variant="h6"
                  gutterBottom
                  sx={{
                    fontWeight: 600,
                  }}
                >
                  {feature.title}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    lineHeight: 1.7,
                  }}
                >
                  {feature.description}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>

      {/* CTA */}
      <Container maxWidth="md" sx={{ pb: { xs: 8, md: 12 } }}>
        <Box
          sx={{
            textAlign: "center",
            px: { xs: 3, md: 8 },
            py: { xs: 6, md: 8 },
            borderRadius: 5,
            background: PAGE_GRADIENTS.brand,
            color: "#fff",
          }}
        >
          <Typography
            variant="h3"
            gutterBottom
            sx={{ fontSize: { xs: "1.75rem", md: "2.25rem" } }}
          >
            Ready to get organized?
          </Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 480, mx: "auto", mb: 4 }}>
            Join thousands of users and experience a better way to capture and
            organize your ideas.
          </Typography>
          <Button
            href="/auth/register"
            size="large"
            variant="contained"
            sx={{
              bgcolor: "#fff",
              color: "primary.main",
              "&:hover": { bgcolor: "#fff", filter: "brightness(0.95)" },
            }}
          >
            Start free now
          </Button>
        </Box>
      </Container>

      {/* Footer */}
      <Divider />
      <Container maxWidth="lg">
        <Box
          sx={{
            py: 4,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            alignItems: { xs: "flex-start", md: "center" },
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
              }}
            >
              Memoria
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              A modern, secure, and fast note-taking application.
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Button href="/help" size="small">
              Help
            </Button>
            <Button href="/status" size="small">
              Status
            </Button>
            <Button href="/privacy" size="small">
              Privacy
            </Button>
            <Button href="/terms" size="small">
              Terms
            </Button>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              © {new Date().getFullYear()} Memoria.
            </Typography>
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
