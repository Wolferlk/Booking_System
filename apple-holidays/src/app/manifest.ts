import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Apple System Operations',
    short_name: 'Apple Ops',
    description:
      'Multi-Destination Travel Booking & Operations Management for Vietnam, Sri Lanka, Malaysia and Singapore',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#ef4444',
    icons: [
      { src: '/png/apple-logo.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/logo.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/favicon.png', sizes: '64x64', type: 'image/png' },
    ],
  }
}
