/**
 * Root Layout
 *
 * ENHANCED: Issue #40 - Analytics integration
 */

import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'CanvasCollect',
  description: 'A collaborative canvas for notes and bookmarks',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
