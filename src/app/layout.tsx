/**
 * Root Layout
 *
 * ENHANCED: Issue #40 - Analytics integration
 * ENHANCED: Modern UI with Inter font
 */

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { Providers } from './providers';
import { PWARegister } from '@/components/PWARegister';
import './tiptap.css';

// Load Inter font with all weights for premium typography
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700', '800'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'Memoria',
  description: 'A collaborative canvas for notes and bookmarks',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Memoria',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <PWARegister />
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}

