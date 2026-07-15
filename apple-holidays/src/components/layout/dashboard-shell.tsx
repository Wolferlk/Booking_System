'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/hooks/use-sidebar'
import Sidebar from './sidebar'

// Routes that render their own full-screen chrome instead of the persistent
// sidebar shell — e.g. the WhatsApp inbox, which opens in its own browser tab
// and wants the whole viewport, like a dedicated portal.
const FULL_SCREEN_ROUTES = ['/dashboard/whatsapp']

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()
  const pathname = usePathname()

  if (FULL_SCREEN_ROUTES.some(route => pathname === route || pathname.startsWith(`${route}/`))) {
    return <div className="min-h-screen bg-slate-50">{children}</div>
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main
        className={cn(
          'flex-1 min-w-0 transition-all duration-300',
          'ml-0',
          isCollapsed ? 'lg:ml-16' : 'lg:ml-[260px]',
        )}
      >
        {children}
      </main>
    </div>
  )
}
