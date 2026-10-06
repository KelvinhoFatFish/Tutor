import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the project root. Without this, Next walks up looking for a lockfile and
  // can pick up an unrelated one from a parent folder, which makes deploys
  // bundle the wrong files.
  outputFileTracingRoot: path.join(__dirname),

  // `pg` is a native-ish Node package; keep it out of the bundler so it loads
  // normally at runtime (only used when DB_DRIVER=postgres).
  serverExternalPackages: ['pg'],

  // Camera access requires a secure context (https:// or http://localhost).
  // These headers are a small hardening bonus and do not enable the camera by
  // themselves; the browser still asks the user for permission.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
