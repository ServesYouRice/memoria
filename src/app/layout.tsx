import type { Metadata } from 'next';
import { Providers } from './providers';
import { PWARegister } from '@/components/PWARegister';
import './tiptap.css';

export const metadata: Metadata = {
  title: 'CanvasCollect',
  description: 'A collaborative canvas for notes and bookmarks',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'CanvasCollect',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PWARegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
