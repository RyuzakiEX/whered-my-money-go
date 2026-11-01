import type { NextConfig } from 'next';

import { missingPublicEnv } from './lib/utils/build-env';

// A Vercel build without the Supabase variables must FAIL, not deploy: a
// deployment built without them answers 500 on every page (production,
// 2026-10-31). A failed build leaves the last good deployment live. Only on
// Vercel — CI's build supplies placeholders, and local builds read .env.local.
if (process.env['VERCEL'] === '1') {
  const missing = missingPublicEnv(process.env);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} for this Vercel environment ` +
        `(${process.env['VERCEL_ENV'] ?? 'unknown'}). Set them in the Vercel ` +
        'project settings. See docs/ops/environments.md.',
    );
  }
}

const nextConfig: NextConfig = {
  // Fail the production build on a type error rather than shipping it.
  // Next's defaults already do this; stated explicitly so nobody "temporarily"
  // disables it to get a deploy out.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Security headers. The app serves financial data, so these are not
  // optional extras — see docs/security/security-model.md.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Don't leak the path a user came from to third parties.
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Disallow MIME sniffing.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // No framing: clickjacking protection for authenticated routes.
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // This app needs none of these.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },

  // Don't advertise the framework version.
  poweredByHeader: false,

  // Trailing slashes off, so URLs are canonical and filter params stay clean.
  trailingSlash: false,
};

export default nextConfig;
