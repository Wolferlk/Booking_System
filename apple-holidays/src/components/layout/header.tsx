'use client'

import { useSession } from 'next-auth/react'
import { Bell, Search, HelpCircle } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/rbac'
import { getInitials } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

interface HeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined

  return (
    <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
      <div className="px-8 py-4 flex items-center justify-between gap-4">
        {/* Left: title */}
        <div>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        {/* Right: actions + user */}
        <div className="flex items-center gap-3">
          {actions}

          <button className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <Bell className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {getInitials(session?.user?.name ?? 'U')}
              </span>
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold text-slate-800 leading-tight">
                {session?.user?.name}
              </p>
              <p className="text-xs text-slate-500">
                {role ? ROLE_LABELS[role] : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
