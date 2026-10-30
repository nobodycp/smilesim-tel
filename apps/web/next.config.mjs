/** @type {import('next').NextConfig} */
const api = process.env.API_PROXY_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
export default nextConfig;
