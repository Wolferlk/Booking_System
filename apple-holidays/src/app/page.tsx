'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { MapPin, ArrowRight, Plane, Globe2 } from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'

const DESTINATIONS = [
  {
    id: 'vietnam',
    name: 'Vietnam',
    code: 'MMT_VN',
    country: 'VIETNAM',
    description: 'Ho Chi Minh · Hanoi · Da Nang · Hoi An',
    active: true,
    href: '/vietnam',
    tag: 'Live',
    gradient: 'from-red-600/25 via-red-500/12 to-yellow-600/15',
    border: 'border-red-500/35 hover:border-red-400/70',
    glow: 'hover:shadow-red-500/20',
    accent: 'text-red-400',
    accentBg: 'bg-red-500/12 border-red-500/25 hover:bg-red-500/18',
    dot: 'bg-emerald-400',
    tagBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'srilanka',
    name: 'Sri Lanka',
    code: 'MMT_LK',
    country: 'SRILANKA',
    description: 'Colombo · Kandy · Sigiriya · Galle',
    active: true,
    href: '/srilanka',
    tag: 'Live',
    gradient: 'from-yellow-700/15 via-yellow-600/10 to-orange-700/12',
    border: 'border-yellow-600/30 hover:border-yellow-500/60',
    glow: 'hover:shadow-yellow-500/20',
    accent: 'text-yellow-400',
    accentBg: 'bg-yellow-500/12 border-yellow-500/25 hover:bg-yellow-500/18',
    dot: 'bg-emerald-400',
    tagBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'singapore',
    name: 'Singapore & Malaysia',
    code: 'MMT_SG_MY',
    country: 'SINGAPORE_MALAYSIA',
    description: 'Marina Bay · Sentosa · KL · Langkawi · Penang',
    active: true,
    href: '/singapore',
    tag: 'Live',
    gradient: 'from-red-600/15 via-blue-600/10 to-slate-500/8',
    border: 'border-blue-500/30 hover:border-blue-400/60',
    glow: 'hover:shadow-blue-500/20',
    accent: 'text-blue-400',
    accentBg: 'bg-blue-500/12 border-blue-500/25 hover:bg-blue-500/18',
    dot: 'bg-emerald-400',
    tagBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'ultra',
    name: 'All Countries',
    code: 'ULTRA_ADMIN',
    country: null,
    description: 'Global view · All operations · Critical access',
    active: true,
    href: '/ultra',
    tag: 'Restricted',
    gradient: 'from-amber-600/20 via-amber-500/10 to-orange-600/12',
    border: 'border-amber-500/40 hover:border-amber-400/70',
    glow: 'hover:shadow-amber-500/20',
    accent: 'text-amber-400',
    accentBg: 'bg-amber-500/12 border-amber-500/25 hover:bg-amber-500/18',
    dot: 'bg-amber-400',
    tagBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
]

export default function HomePage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#060a14] flex flex-col overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-brand-500/6 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-[-100px] w-[600px] h-[500px] bg-blue-600/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-[-100px] w-[600px] h-[500px] bg-purple-600/5 rounded-full blur-[100px]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-5 flex items-center justify-between">
          <button
            onClick={() => router.push('/overview')}
            className="flex items-center gap-3 hover:opacity-85 transition-opacity group"
            title="Open Global Command Center"
          >
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-brand-500/20">
              <Image src="/png/aahaslogo.png" alt="Aahas Logo" fill className="object-contain" />
            </div>
            <div className="border-l border-white/10 pl-3 flex items-center gap-2">
              <div className="relative h-6 w-16 opacity-60 group-hover:opacity-80 transition-opacity">
                <Image src="/png/aahaas.png" alt="Aahaas" fill className="object-contain" />
              </div>
              <span className="text-slate-600 text-[9px] uppercase tracking-widest hidden sm:block">Subsidiary</span>
            </div>
            <div className="border-l border-white/6 pl-3 hidden sm:block">
              <p className="text-white font-bold text-base leading-tight tracking-tight">AppleHolidays</p>
              <p className="text-slate-500 text-[11px] tracking-wider uppercase">Travel Management System</p>
            </div>
          </button>

          <div className="hidden sm:flex items-center gap-6 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <Globe2 className="w-3.5 h-3.5 text-brand-500" />
              <span>Multi-Destination Platform</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Plane className="w-3.5 h-3.5 text-brand-500" />
              <span>v1.0 Production</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/25 text-brand-400 text-[11px] font-semibold tracking-widest uppercase mb-7">
            <MapPin className="w-3.5 h-3.5" />
            Select Your Destination
          </div>

          <h1 className="text-[52px] sm:text-[64px] font-black text-white mb-5 leading-[1.05] tracking-tight">
            Where are you
            <br />
            <span className="text-brand-500 relative">
              heading today?
              <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-brand-500/0 via-brand-500/60 to-brand-500/0 rounded-full" />
            </span>
          </h1>

          <p className="text-slate-400 text-lg max-w-md mx-auto leading-relaxed">
            Select a destination to access the booking and operations management portal.
          </p>
        </div>

        {/* Destination Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 w-full max-w-6xl">
          {DESTINATIONS.map(dest => (
            <button
              key={dest.id}
              onClick={() => dest.active && dest.href && router.push(dest.href)}
              disabled={!dest.active}
              className={`
                group relative rounded-3xl border text-center transition-all duration-300 outline-none overflow-hidden
                bg-gradient-to-br ${dest.gradient} bg-[#0d1628]/80 backdrop-blur-sm
                ${dest.border}
                ${dest.active
                  ? `cursor-pointer hover:scale-[1.025] hover:shadow-2xl ${dest.glow} focus:ring-2 focus:ring-brand-500/50`
                  : 'cursor-not-allowed opacity-50'
                }
              `}
            >
              {/* Top tag */}
              <div className="flex justify-end px-5 pt-5">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border tracking-wider uppercase ${dest.tagBg} flex items-center gap-1.5`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dest.dot} animate-pulse`} />
                  {dest.tag}
                </span>
              </div>

              {/* Flag — large, centered */}
              <div className="flex justify-center items-center px-6 py-6">
                <div className={`w-28 h-28 rounded-2xl flex items-center justify-center border ${dest.accentBg} transition-colors`}>
                  <CountryFlag country={dest.country} className="text-[56px] leading-none" />
                </div>
              </div>

              {/* Name & code */}
              <div className="px-6 pb-2">
                <h2 className="text-xl font-black text-white mb-1 tracking-tight leading-tight">{dest.name}</h2>
                <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${dest.accent} mb-3`}>{dest.code}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{dest.description}</p>
              </div>

              {/* CTA row */}
              <div className={`mx-5 mb-5 mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold ${dest.accent} ${dest.accentBg} transition-all group-hover:gap-3`}>
                Enter System
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>

        {/* Sub-info */}
        <p className="mt-10 text-slate-600 text-xs text-center">
          Now live for Vietnam, Sri Lanka, Malaysia and Singapore.
        </p>
      </main>

      <footer className="relative z-10 border-t border-white/5 py-5 text-center text-slate-600 text-xs">
        © {new Date().getFullYear()} AppleHolidays — All rights reserved &nbsp;·&nbsp; Travel Management System
      </footer>
    </div>
  )
}
