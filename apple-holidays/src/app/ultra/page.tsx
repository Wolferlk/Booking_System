'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, Lock, ArrowRight, CheckCircle2, Globe2, ShieldAlert,
} from 'lucide-react'

export default function UltraAdminPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#060a14]">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-50px] right-0 w-[700px] h-[500px] bg-amber-600/6 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[500px] bg-orange-500/5 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#060a14]/80 backdrop-blur-sm sticky top-0">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center gap-5">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-sm group"
          >
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Home
          </Link>
          <div className="w-px h-5 bg-slate-700/60" />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shadow-md shadow-brand-500/30">
              <span className="text-white font-black text-xs">AH</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">AppleHolidays</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">All Countries — Critical Access</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-8 py-20">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-4 mb-5">
            <span className="text-6xl filter drop-shadow-lg">🌐</span>
            <div className="text-left">
              <h1 className="text-5xl font-black text-white tracking-tight leading-tight">
                All Countries
              </h1>
              <p className="text-slate-400 text-xl mt-0.5">Ultra Super Admin Access</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-5">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" />
              All-countries access
            </div>
          </div>

          <p className="text-slate-500 text-sm mt-5 max-w-md mx-auto leading-relaxed">
            This portal grants access to all countries and all system modules.
            Use your regular Ultra Super Admin credentials to continue.
          </p>
        </div>

        {/* Single card */}
        <button
          onClick={() => router.push('/login?role=ULTRA_SUPER_ADMIN&country=ultra')}
          className="
            group w-full relative rounded-2xl border p-8 text-left transition-all duration-300 outline-none
            bg-gradient-to-br from-amber-600/15 via-amber-500/8 to-orange-500/10 bg-slate-900/80 backdrop-blur-sm
            border-amber-500/40 hover:border-amber-400/60
            cursor-pointer hover:scale-[1.01] hover:shadow-2xl hover:shadow-amber-500/10
            focus:ring-2 focus:ring-amber-500/40
          "
        >
          {/* Tag */}
          <div className="absolute top-5 right-5">
            <span className="text-[10px] font-bold text-amber-600/70 font-mono tracking-wider">
              ULTRA_SUPER_ADMIN
            </span>
          </div>

          {/* Icon */}
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center mb-5">
            <Lock className="w-6 h-6 text-amber-400" />
          </div>

          {/* Label */}
          <h3 className="text-xl font-black text-white mb-1.5 tracking-tight">Ultra Super Admin</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-5">
            Full global system access — all countries, all modules, user management, and critical operations.
          </p>

          {/* Features */}
          <div className="grid grid-cols-2 gap-1.5 mb-6">
            {[
              'Vietnam Operations',
              'Sri Lanka Operations',
              'Singapore & Malaysia',
              'All Bookings (Global)',
              'User Management',
              'Mail Inbox (All)',
              'Full Audit Log',
              'Critical Settings',
            ].map(f => (
              <div key={f} className="flex items-center gap-2">
                <CheckCircle2 className="w-3 h-3 text-amber-400 flex-shrink-0" />
                <span className="text-xs text-slate-500">{f}</span>
              </div>
            ))}
          </div>

          {/* Country flags */}
          <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl bg-white/3 border border-white/8">
            <Globe2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <span className="text-xs text-slate-400">
              🇻🇳 Vietnam &nbsp;·&nbsp; 🇱🇰 Sri Lanka &nbsp;·&nbsp; 🇸🇬 Singapore &nbsp;·&nbsp; 🇲🇾 Malaysia
            </span>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-2 text-sm font-bold text-amber-400 group-hover:gap-3 transition-all">
            Enter Critical Portal
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>

        <p className="text-center text-slate-700 text-xs mt-8">
          Unauthorized access attempts are logged and audited.
        </p>
      </main>
    </div>
  )
}
