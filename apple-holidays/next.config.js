/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pdfkit', 'puppeteer'],
  },
  images: {
    domains: ['localhost'],
  },
}

module.exports = nextConfig
