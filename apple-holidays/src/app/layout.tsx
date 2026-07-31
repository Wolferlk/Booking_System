import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import Providers from '@/components/shared/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Apple System Operations',
  description: 'Multi-Destination Travel Booking & Operations Management for Vietnam, Sri Lanka, Malaysia and Singapore',
  // Browser tab icon and iOS home-screen icon. src/app/icon.png and
  // src/app/apple-icon.png are also picked up by Next.js file-based metadata;
  // these entries are declared explicitly so the logo is used everywhere,
  // including by crawlers and older browsers that only look for /favicon.png.
  icons: {
    icon: [
      { url: '/png/apple-logo.png', type: 'image/png' },
      { url: '/favicon.png', sizes: '64x64', type: 'image/png' },
    ],
    shortcut: '/favicon.png',
    apple: '/png/apple-logo.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  )
}
