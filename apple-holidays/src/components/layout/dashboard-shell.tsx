'use client'

import { cn } from '@/lib/utils'
import { useSidebar } from '@/hooks/use-sidebar'
import Sidebar from './sidebar'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()

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
