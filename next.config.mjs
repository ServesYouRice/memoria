import { env } from './src/lib/env.ts';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Optimize bundle size (ADR-0007: Performance Budgets)
  experimental: {
    optimizePackageImports: ['@mui/material', '@mui/icons-material'],
  },

  // Webpack optimizations for Konva
  webpack: (config) => {
    // Optimize konva bundle size - exclude server-side canvas
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },

  // Security Headers (ADR-0012: Security Headers & CORS Policy)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Referrer Policy
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Prevent clickjacking
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Minimal Permissions Policy
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          // Strict Transport Security (HTTPS only in production)
          ...(env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },

  // CSP is handled via middleware for nonce-based implementation (ADR-0002)
};

export default nextConfig;
