/**
 * Root Layout
 *
 * - Brand fonts ship with the app (@fontsource-variable): no build-time
 *   network access and no third-party font request at runtime
 * - Browser Sentry address rendered at request time (IMP-151)
 * - CSP nonce integration for MUI/Emotion
 */

import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import { PWARegister } from "@/components/PWARegister";
import { getNonce } from "@/lib/nonce";
import {
  BROWSER_SENTRY_META,
  getBrowserSentryConfig,
} from "@/lib/telemetry/browser-sentry";
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
  // Read per request (the layout is dynamic: it reads the CSP nonce), so the
  // image carries no build-time Sentry address.
  const sentry = getBrowserSentryConfig();

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
        {/* React hoists these tags into <head>, ahead of the client entry. */}
        {sentry && (
          <>
            <meta name={BROWSER_SENTRY_META.dsn} content={sentry.dsn} />
            {sentry.environment && (
              <meta
                name={BROWSER_SENTRY_META.environment}
                content={sentry.environment}
              />
            )}
            {sentry.release && (
              <meta
                name={BROWSER_SENTRY_META.release}
                content={sentry.release}
              />
            )}
          </>
        )}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <PWARegister />
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
