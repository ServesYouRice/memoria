import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Logging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  // Experimental features
  experimental: {
    // Enable instrumentation for observability
    instrumentationHook: true,
  },

  // Webpack configuration for Konva
  webpack: (config, { isServer }) => {
    // Exclude canvas and konva from server-side bundle
    if (isServer) {
      config.externals = [...(config.externals || []), 'canvas', 'konva'];
    } else {
      // For client-side, provide empty module for canvas (not needed in browser)
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
      };
    }

    return config;
  },

  // Transpile Konva and react-konva for Next.js
  transpilePackages: ['konva', 'react-konva'],
};

export default nextConfig;
