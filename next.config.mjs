/**
 * Next.js Configuration
 *
 * IMPORTANT: This is the ONLY Next.js config file.
 * Do not create next.config.js or next.config.ts files.
 *
 * Next.js precedence: .ts > .mjs > .js
 * We use .mjs to support ES modules and TypeScript imports (env.ts)
 *
 * See CODE_AUDIT_REPORT.md Issue #1 for details on why we consolidated configs.
 *
 * ENHANCED: Issue #27 - Bundle size analysis with @next/bundle-analyzer
 * Run: ANALYZE=true pnpm build
 */
// import { env } from './src/lib/env.ts';
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Logging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  // Optimize bundle size (ADR-0007: Performance Budgets)
  experimental: {
    optimizePackageImports: ['@mui/material', '@mui/icons-material'],
  },

  // Webpack optimizations for Konva (Issue #17)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Browser-only optimizations

      // Exclude canvas module from browser bundle (only needed server-side)
      config.externals = {
        ...(typeof config.externals === 'object' ? config.externals : {}),
        canvas: 'canvas',
      };

      // Tree-shake unused Konva features for smaller bundle
      config.resolve.alias = {
        ...config.resolve.alias,
        // Use the main Konva bundle with tree-shaking support
        'konva': require.resolve('konva/lib/index.js'),
      };

      // Enable webpack's built-in optimizations
      config.optimization = {
        ...config.optimization,
        usedExports: true, // Tree shaking
        sideEffects: true, // Respect package.json sideEffects field
      };
    }

    return config;
  },

  // Security headers are applied in middleware (src/middleware/security-headers.ts)

  // ESLint: Enforced during Next.js build to keep CI gate intact
  eslint: {
    ignoreDuringBuilds: false,
  },

  // TypeScript: Build will fail on type errors (OPUS.md Issue #9 - re-enabled)
  // TypeScript compiles cleanly: npx tsc --noEmit passes with no errors
  typescript: {
    ignoreBuildErrors: false,
  },

  // CSP is handled via middleware for nonce-based implementation (ADR-0002)
};

// Wrap config with bundle analyzer (Issue #27)
export default withBundleAnalyzer(nextConfig);
