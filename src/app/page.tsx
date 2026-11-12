import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  Box,
  Button,
  Container,
  Typography,
  Stack,
  Divider,
  Link,
} from "@mui/material";
import { MemoriaLogo } from "@/components/MemoriaLogo";
import { LAUNCH_LIMITS } from "@/lib/policy/launch-limits";

// Pictures of a real canvas (IMP-081), one per colour mode. The app sets
// data-theme on <html> before paint, so the matching one shows without a
// flash; both keep fixed dimensions so nothing jumps while they load.
const DARK = '[data-theme="dark"] &';
// Sized through classes, not inline styles: the CSP blocks style attributes.
const FIT_IMAGE = {
  "& img": { display: "block", width: "100%", height: "auto" },
};
const LIGHT_ONLY = {
  ...FIT_IMAGE,
  display: "block",
  [DARK]: { display: "none" },
};
const DARK_ONLY = {
  ...FIT_IMAGE,
  display: "none",
  [DARK]: { display: "block" },
};

const HERO_PICTURE = {
  name: "canvas",
  width: 1260,
  height: 645,
  alt: "A Memoria canvas planning a weekend in Lisbon: sticky notes, a link card for Belém Tower, a sunset photo and a hand-drawn arrow.",
};

const ABILITIES = [
  {
    title: "Put it all in one place",
    text: "Sticky notes, web links, photos and quick sketches sit side by side. Drag them anywhere and zoom in or out.",
    picture: {
      name: "capture",
      width: 560,
      height: 350,
      alt: "A link card, a photo, a drawing and a note on one canvas.",
    },
  },
  {
    title: "Work on it together",
    text: "Invite people by email and choose whether they can edit or only look. You see each other's cursors as you work.",
    picture: {
      name: "share",
      width: 560,
      height: 280,
      alt: "The share window with an email box and a view or edit choice.",
    },
  },
  {
    title: "Take it with you",
    text: "Download any canvas as PNG, PDF, Markdown, or JSON whenever you like.",
    picture: {
      name: "export",
      width: 560,
      height: 431,
      alt: "The download window offering PNG, PDF, Markdown and JSON.",
    },
  },
];

type Picture = { name: string; width: number; height: number; alt: string };

function ModePicture({
  picture,
  eager = false,
}: {
  picture: Picture;
  eager?: boolean;
}) {
  return (
    <>
      {(["light", "dark"] as const).map((mode) => (
        <Box key={mode} sx={mode === "light" ? LIGHT_ONLY : DARK_ONLY}>
          <Image
            src={`/home/${picture.name}-${mode}.webp`}
            width={picture.width}
            height={picture.height}
            alt={picture.alt}
            loading={eager ? "eager" : "lazy"}
            // Already sized and compressed; served as-is.
            unoptimized
          />
        </Box>
      ))}
    </>
  );
}

// Keep public-page tokens server-safe: this page must render before the client
// theme provider exists, so it cannot import the client-only theme module.
// Solid brand surfaces (IMP-079: colours from the logo, no gradients).
const PAGE_SURFACES = {
  navy: "#1c2452",
  hero: "rgba(44,95,201,0.05)",
};
// Navy label on the white button: 4.5:1+ at rest and on the hover/focus tint.
const CTA_LABEL_COLOR = "#1c2452";
const PICTURE_SHADOW = "0 24px 64px rgba(28,36,82,0.16)";

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
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Memoria
            </Typography>
          </Box>
          <Button href="/auth/login" color="inherit">
            Sign in
          </Button>
        </Box>
      </Container>

      {/* Hero */}
      <Box sx={{ bgcolor: PAGE_SURFACES.hero }}>
        <Container
          maxWidth="lg"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "5fr 7fr" },
            gap: { xs: 5, md: 6 },
            alignItems: "center",
            py: { xs: 6, md: 10 },
          }}
        >
          <Box sx={{ textAlign: { xs: "center", md: "left" }, minWidth: 0 }}>
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "2.25rem", sm: "3rem", md: "3.5rem" },
                lineHeight: 1.08,
                mb: 2.5,
              }}
            >
              Your notes, links and pictures on one{" "}
              <Box component="span" sx={{ color: "primary.main" }}>
                big canvas
              </Box>
            </Typography>
            <Typography
              variant="h6"
              component="p"
              sx={{
                color: "text.secondary",
                fontWeight: 400,
                lineHeight: 1.6,
                maxWidth: 480,
                mx: { xs: "auto", md: 0 },
                mb: 4,
              }}
            >
              Lay out your ideas the way you think about them, then share the
              canvas with the people you plan with.
            </Typography>
            <Button href="/auth/register" variant="contained" size="large">
              Create account
            </Button>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 2 }}>
              Already have an account?{" "}
              <Link href="/auth/login" sx={{ fontWeight: 600 }}>
                Sign in
              </Link>
            </Typography>
          </Box>

          <Box
            sx={{
              minWidth: 0,
              borderRadius: 3,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: PICTURE_SHADOW,
            }}
          >
            <ModePicture picture={HERO_PICTURE} eager />
          </Box>
        </Container>
      </Box>

      {/* What you can do */}
      <Container maxWidth="lg" sx={{ py: { xs: 8, md: 12 } }}>
        <Typography
          variant="h2"
          sx={{
            fontSize: { xs: "2rem", md: "2.5rem" },
            textAlign: "center",
            mb: 6,
          }}
        >
          What you can do
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            gap: { xs: 5, md: 4 },
          }}
        >
          {ABILITIES.map((ability) => (
            <Box key={ability.title} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  aspectRatio: "8 / 5",
                  overflow: "hidden",
                  borderRadius: 3,
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "background.paper",
                  mb: 2.5,
                }}
              >
                <ModePicture picture={ability.picture} />
              </Box>
              <Typography variant="h5" component="h3" gutterBottom>
                {ability.title}
              </Typography>
              <Typography
                variant="body1"
                sx={{ color: "text.secondary", lineHeight: 1.7 }}
              >
                {ability.text}
              </Typography>
            </Box>
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
            background: PAGE_SURFACES.navy,
            color: "common.white",
          }}
        >
          <Typography
            variant="h3"
            gutterBottom
            sx={{ fontSize: { xs: "1.75rem", md: "2.25rem" } }}
          >
            Start your first canvas
          </Typography>
          <Typography sx={{ opacity: 0.9, maxWidth: 480, mx: "auto", mb: 4 }}>
            Make an account, open a canvas and drop in your first note.
          </Typography>
          <Button
            href="/auth/register"
            size="large"
            variant="contained"
            sx={{
              // `background` (not `bgcolor`) so the theme's gradient is
              // replaced; the dark brand shade keeps the label above 4.5:1.
              background: "#fff",
              color: CTA_LABEL_COLOR,
              "&:hover, &:focus-visible": {
                background: "#f1f5f9",
                color: CTA_LABEL_COLOR,
                filter: "none",
              },
            }}
          >
            Create account
          </Button>
          <Typography variant="body2" sx={{ opacity: 0.85, mt: 3 }}>
            You can have up to {LAUNCH_LIMITS.canvasesPerUser} canvases per
            account, with up to{" "}
            {LAUNCH_LIMITS.itemsPerCanvas.toLocaleString("en-US")} active items
            per canvas.
          </Typography>
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
              A visual canvas for your notes, links and pictures.
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
            <Button href="/help" size="small" sx={{ color: "text.secondary" }}>
              Help
            </Button>
            <Button
              href="/status"
              size="small"
              sx={{ color: "text.secondary" }}
            >
              Status
            </Button>
            <Button
              href="/privacy"
              size="small"
              sx={{ color: "text.secondary" }}
            >
              Privacy
            </Button>
            <Button href="/terms" size="small" sx={{ color: "text.secondary" }}>
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
