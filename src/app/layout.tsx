/**
 * Root Layout
 *
 * - Uses a hermetic system font stack (no build-time network dependency)
 * - Analytics integration (Issue #40)
 * - CSP nonce integration for MUI/Emotion
 */

import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { PWARegister } from "@/components/PWARegister";
import { getNonce } from "@/lib/nonce";
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
    <html lang="en">
      <body>
        <PWARegister />
        <Providers nonce={nonce}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
