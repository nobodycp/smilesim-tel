/** @type {import('next').NextConfig} */
const api = process.env.API_PROXY_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

// Static security headers for every route. The Content-Security-Policy is not here on purpose:
// it needs a fresh nonce per request, so proxy.ts sets it.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
export default nextConfig;
