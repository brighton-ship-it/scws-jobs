/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Handle ESM packages
  transpilePackages: ['@react-pdf/renderer'],
};

export default nextConfig;
