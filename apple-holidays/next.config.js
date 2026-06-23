/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ignore ESLint errors during builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Ignore TypeScript compile errors during builds
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pdf-parse', 'pdfkit', 'puppeteer', 'mysql2'],
  },
  images: {
    domains: ['localhost'],
  },
}

module.exports = nextConfig
