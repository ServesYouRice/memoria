/**
 * Root Layout
 *
 * - Brand fonts ship with the app (@fontsource-variable): no build-time
 *   network access and no third-party font request at runtime
 * - Analytics integration (Issue #40)
 * - CSP nonce integration for MUI/Emotion
 */

import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { PWARegister } from "@/components/PWARegister";
import { getNonce } from "@/lib/nonce";
import {
  DEFAULT_THEME_MODE,
  THEME_ATTRIBUTE,
  THEME_INIT_SCRIPT,
} from "@/lib/theme-preference";
import "@fontsource-variable/figtree";
import "@fontsource-variable/bricolage-grotesque";
import "./tiptap.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Memoria",
    template: "%s | Memoria",
  },
  description: "A collaborative canvas for notes and bookmarks",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Memoria",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = await getNonce();

  return (
    // The init script below rewrites the theme attribute before hydration, so
    // a server/client attribute difference on <html> is expected.
    <html
      lang="en"
      suppressHydrationWarning
      {...{ [THEME_ATTRIBUTE]: DEFAULT_THEME_MODE }}
      style={{ colorScheme: DEFAULT_THEME_MODE }}
    >
      <body>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <PWARegister />
        <Providers nonce={nonce}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
