'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Car, User2, Settings, LogOut, Loader2 } from 'lucide-react'
import Image from 'next/image'

interface VendorSession {
  id: string
  name: string
  email: string | null
  country: string | null
}

const NAV = [
  { href: '/vendor/dashboard',          icon: CalendarDays, label: 'Trips' },
  { href: '/vendor/dashboard/drivers',  icon: User2,        label: 'Drivers' },
  { href: '/vendor/dashboard/vehicles', icon: Car,          label: 'Vehicles' },
  { href: '/vendor/dashboard/profile',  icon: Settings,     label: 'Profile' },
]

export default function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [vendor, setVendor]   = useState<VendorSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vendor/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!d.success) { router.replace('/vendor/login'); return }
        setVendor(d.data)
      })
      .finally(() => setLoading(false))
  }, [router])

  async function logout() {
    await fetch('/api/vendor/auth/logout', { method: 'POST' })
    router.replace('/vendor/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    </div>
  )

  if (!vendor) return null

  const isTripsRoot = pathname === '/vendor/dashboard'

  return (
    <div className="min-h-screen bg-[#070b18] flex flex-col max-w-lg mx-auto">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-[#070b18]/95 backdrop-blur-sm border-b border-white/6 px-4 py-3 flex items-center gap-3">
        <div className="relative w-8 h-8 flex-shrink-0">
          <Image
            src="/png/aahaslogo.png"
            alt="AH"
            fill
            className="object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate">{vendor.name}</p>
          <p className="text-slate-500 text-xs">Vendor Portal</p>
        </div>
        <button
          onClick={logout}
          className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-30 bg-[#0a0f1e]/95 backdrop-blur-xl border-t border-white/8 grid grid-cols-4 safe-area-bottom">
        {NAV.map(item => {
          const Icon   = item.icon
          const active = item.href === '/vendor/dashboard'
            ? isTripsRoot
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-3 px-2 transition-colors ${
                active ? 'text-brand-400' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span className={`text-[10px] font-semibold tracking-wide ${active ? 'text-brand-400' : 'text-slate-600'}`}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
