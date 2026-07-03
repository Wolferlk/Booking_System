'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Car, User2, Settings, LogOut, Loader2, ChevronRight, Menu, X } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!d.success) { router.replace('/vendor/login'); return }
        setVendor(d.data)
      })
      .finally(() => setLoading(false))
  }, [router])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

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
    <div className="min-h-screen bg-[#070b18] text-white lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-white/6 lg:bg-[#060a14]/95 lg:backdrop-blur-sm">
        <div className="px-5 py-5 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 flex-shrink-0 rounded-2xl overflow-hidden bg-white">
              <Image
                src="/png/aahaslogo.png"
                alt="AH"
                fill
                className="object-contain p-1"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-white font-black text-base leading-tight truncate">{vendor.name}</p>
              <p className="text-slate-500 text-xs">Vendor Portal</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="rounded-3xl border border-white/8 bg-white/3 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Quick Access</p>
            <div className="mt-3 space-y-1">
              {NAV.map(item => {
                const Icon = item.icon
                const active = item.href === '/vendor/dashboard'
                  ? isTripsRoot
                  : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl px-3 py-3 transition-all border',
                      active
                        ? 'bg-brand-500/10 text-brand-300 border-brand-500/20 shadow-lg shadow-brand-500/10'
                        : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-white hover:border-white/6',
                    )}
                  >
                    <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-brand-400' : 'text-slate-500')} />
                    <span className="text-sm font-semibold">{item.label}</span>
                    {active && <ChevronRight className="w-4 h-4 ml-auto text-brand-400" />}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-white/6">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-4 py-3 rounded-2xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-white/6 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-semibold">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 w-80 max-w-[86vw] bg-[#060a14] border-r border-white/6 transition-transform duration-300 lg:hidden',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="px-5 py-5 border-b border-white/6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 flex-shrink-0 rounded-2xl overflow-hidden bg-white">
              <Image
                src="/png/aahaslogo.png"
                alt="AH"
                fill
                className="object-contain p-1"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-white font-black text-sm leading-tight truncate">{vendor.name}</p>
              <p className="text-slate-500 text-xs">Vendor Portal</p>
            </div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {NAV.map(item => {
            const Icon = item.icon
            const active = item.href === '/vendor/dashboard'
              ? isTripsRoot
              : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-4 py-3 transition-all border',
                  active
                    ? 'bg-brand-500/10 text-brand-300 border-brand-500/20'
                    : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-white hover:border-white/6',
                )}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-brand-400' : 'text-slate-500')} />
                <span className="text-sm font-semibold">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-screen flex-1 flex-col lg:min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-[#070b18]/95 backdrop-blur-sm border-b border-white/6 px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            title="Open navigation"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="hidden sm:flex relative w-9 h-9 flex-shrink-0">
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
            className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-24 lg:pb-8">
          {children}
        </main>

        {/* Bottom tab bar */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/8 bg-[#0a0f1e]/95 backdrop-blur-xl grid grid-cols-4 safe-area-bottom lg:hidden">
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
    </div>
  )
}
