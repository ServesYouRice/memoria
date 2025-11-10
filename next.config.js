/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // Following ADR-0002: CSP with nonces
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // Performance optimization
  webpack: (config, { isServer }) => {
    // Optimize Konva bundle size
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        konva: 'konva/lib/index-node',
      };
    }
    return config;
  },
};

module.exports = nextConfig;
