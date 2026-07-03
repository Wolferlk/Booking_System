'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, FileText, Truck, Shield,
  ArrowRight, Users, CheckCircle2,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'

const ROLES = [
  {
    id: 'BT_USER',
    label: 'Booking Team',
    sublabel: 'BT_USER',
    email: 'sgmy-bt@apple.com',
    description: 'Create and manage Singapore & Malaysia travel bookings, handle change requests.',
    icon: FileText,
    gradient: 'from-blue-500/20 to-blue-700/10',
    border: 'border-blue-500/30 hover:border-blue-400/50',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    accent: 'text-blue-400',
    glow: 'hover:shadow-blue-500/10',
    features: ['New Bookings', 'Change Requests', 'Booking Lifecycle'],
  },
  {
    id: 'GT_TE_USER',
    label: 'Ground & Travel Experience',
    sublabel: 'GT_TE_USER',
    email: 'sgmy-gte@apple.com',
    description: 'Ground logistics, driver/vehicle assignments, guest communication, reminders and payments.',
    icon: Truck,
    gradient: 'from-teal-500/20 to-teal-700/10',
    border: 'border-teal-500/30 hover:border-teal-400/50',
    iconBg: 'bg-teal-500/15',
    iconColor: 'text-teal-400',
    accent: 'text-teal-400',
    glow: 'hover:shadow-teal-500/10',
    features: ['Ground Review', 'Drivers & Vehicles', 'Reminders', 'Payments'],
  },
  {
    id: 'SUPER_ADMIN',
    label: 'SG & MY Admin',
    sublabel: 'SUPER_ADMIN',
    email: 'sgmy-admin@apple.com',
    description: 'Full access to Singapore & Malaysia operations — all modules, user management and audit log.',
    icon: Shield,
    gradient: 'from-red-600/15 to-slate-600/10',
    border: 'border-red-500/30 hover:border-red-400/50',
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-400',
    accent: 'text-red-400',
    glow: 'hover:shadow-red-500/10',
    features: ['All Modules', 'User Management', 'Audit Log'],
  },
]

export default function SingaporePage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#060a14]">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-50px] right-0 w-[700px] h-[500px] bg-red-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[500px] bg-blue-600/5 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <header className="relative z-10 border-b border-white/5 bg-[#060a14]/80 backdrop-blur-sm sticky top-0">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center gap-5">
          <Link href="/" className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-sm group">
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
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">MMT Singapore & Malaysia</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-8 py-14">
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-4 mb-5">
            <CountryFlag country="SINGAPORE_MALAYSIA" className="w-20 h-14 drop-shadow-lg" />
            <div className="text-left">
              <h1 className="text-5xl font-black text-white tracking-tight leading-tight">Singapore & Malaysia</h1>
              <p className="text-slate-400 text-xl mt-0.5">Booking & Operations System</p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-5">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              System Online
            </div>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/25 text-brand-400 text-xs font-semibold">
              <Users className="w-3.5 h-3.5" />
              3 Role Portals
            </div>
          </div>
          <p className="text-slate-500 text-sm mt-5 max-w-lg mx-auto">
            SG (Singapore) and MY (Malaysia) IS numbers are handled here. Select your role to enter the operations portal.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {ROLES.map(role => {
            const Icon = role.icon
            return (
              <button
                key={role.id}
                onClick={() => router.push(`/login?country=singapore&role=${role.id}`)}
                className={`
                  group relative rounded-2xl border p-7 text-left transition-all duration-300 outline-none
                  bg-gradient-to-br ${role.gradient} bg-slate-900/80 backdrop-blur-sm
                  ${role.border}
                  cursor-pointer hover:scale-[1.02] hover:shadow-2xl ${role.glow}
                  focus:ring-2 focus:ring-brand-500/40
                `}
              >
                <div className="absolute top-5 right-5">
                  <span className="text-[10px] font-bold text-slate-600 font-mono tracking-wider">{role.sublabel}</span>
                </div>
                <div className={`w-12 h-12 rounded-xl ${role.iconBg} flex items-center justify-center mb-5`}>
                  <Icon className={`w-6 h-6 ${role.iconColor}`} />
                </div>
                <h3 className="text-lg font-black text-white mb-1.5 tracking-tight">{role.label}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-5">{role.description}</p>
                <div className="space-y-1.5 mb-6">
                  {role.features.map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <CheckCircle2 className={`w-3 h-3 ${role.iconColor} flex-shrink-0`} />
                      <span className="text-xs text-slate-500">{f}</span>
                    </div>
                  ))}
                </div>
                <div className={`flex items-center gap-2 text-sm font-bold ${role.accent} group-hover:gap-3 transition-all`}>
                  Enter Portal
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            )
          })}
        </div>
      </main>
    </div>
  )
}
