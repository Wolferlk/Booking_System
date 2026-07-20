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
    // @sparticuz/chromium and puppeteer-core MUST stay external: the chromium
    // package resolves bin/*.br relative to __dirname, which webpack rewrites when
    // it bundles them — the extract then writes a JS chunk to /tmp/chromium and the
    // launch fails with "ELF : not found".
    serverComponentsExternalPackages: [
      'pdf-parse',
      'pdfkit',
      'puppeteer',
      'puppeteer-core',
      '@sparticuz/chromium',
      'mysql2',
    ],
  },
  images: {
    domains: ['localhost'],
  },
}

module.exports = nextConfig
