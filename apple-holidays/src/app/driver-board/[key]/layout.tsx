import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'My Trip Board — AppleHolidays',
  description: 'Open trips you can request, and the trips you are driving.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
}

export default function DriverBoardLayout({ children }: { children: React.ReactNode }) {
  return children
}
