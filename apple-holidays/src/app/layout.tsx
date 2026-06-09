import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import Providers from '@/components/shared/providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'AppleHolidays — Travel Booking System',
  description: 'MMT Vietnam Travel Booking & Operations Management',
  icons: { icon: '/favicon.ico' },
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
