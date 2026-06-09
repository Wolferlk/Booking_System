'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft, FileText, Truck, MapPin,
  BarChart2, Globe, Shield, ArrowRight,
  Users, CheckCircle2,
} from 'lucide-react'

const ROLES = [
  {
    id: 'BT_USER',
    label: 'Booking Team',
    sublabel: 'BT_USER',
    email: 'bt@apple.com',
    description: 'Create & manage travel bookings, handle change requests and passenger details.',
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
    id: 'GT_USER',
    label: 'Ground Team',
    sublabel: 'GT_USER',
    email: 'gt@apple.com',
    description: 'Review and assign ground logistics — drivers, vehicles and tour agenda.',
    icon: Truck,
    gradient: 'from-emerald-500/20 to-emerald-700/10',
    border: 'border-emerald-500/30 hover:border-emerald-400/50',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    accent: 'text-emerald-400',
    glow: 'hover:shadow-emerald-500/10',
    features: ['Ground Review', 'Drivers & Vehicles', 'Tour Agenda'],
  },
  {
    id: 'TE_USER',
    label: 'Travel Experiences',
    sublabel: 'TE_USER',
    email: 'te@apple.com',
    description: 'Guest communication, pre-trip reminders, final recheck and payment collection.',
    icon: MapPin,
    gradient: 'from-purple-500/20 to-purple-700/10',
    border: 'border-purple-500/30 hover:border-purple-400/50',
    iconBg: 'bg-purple-500/15',
    iconColor: 'text-purple-400',
    accent: 'text-purple-400',
    glow: 'hover:shadow-purple-500/10',
    features: ['Contact Log', 'Reminders', 'Payments'],
  },
  {
    id: 'AC_USER',
    label: 'Accounts Team',
    sublabel: 'AC_USER',
    email: 'ac@apple.com',
    description: 'Manage profit & loss, confirm P&L line payments and view revenue dashboards.',
    icon: BarChart2,
    gradient: 'from-amber-500/20 to-amber-700/10',
    border: 'border-amber-500/30 hover:border-amber-400/50',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    accent: 'text-amber-400',
    glow: 'hover:shadow-amber-500/10',
    features: ['P&L Management', 'Payment Confirmation', 'Profit Dashboard'],
  },
  {
    id: 'CLIENT',
    label: 'Client View',
    sublabel: 'Customer / Agent',
    email: 'client@apple.com',
    description: 'Traveller & agent portal — view trip itinerary, payments and emergency contacts.',
    icon: Globe,
    gradient: 'from-cyan-500/20 to-cyan-700/10',
    border: 'border-cyan-500/30 hover:border-cyan-400/50',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-400',
    accent: 'text-cyan-400',
    glow: 'hover:shadow-cyan-500/10',
    features: ['My Trip', 'Day-by-Day Agenda', 'Payments & Contacts'],
  },
  {
    id: 'SUPER_ADMIN',
    label: 'Super Admin',
    sublabel: 'SUPER_ADMIN',
    email: 'admin@apple.com',
    description: 'Full system access — all modules, user management and complete audit log.',
    icon: Shield,
    gradient: 'from-red-500/20 to-orange-700/10',
    border: 'border-red-500/30 hover:border-red-400/50',
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-400',
    accent: 'text-red-400',
    glow: 'hover:shadow-red-500/10',
    features: ['All Modules', 'User Management', 'Audit Log'],
  },
]

export default function VietnamPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#060a14]">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-50px] right-0 w-[700px] h-[500px] bg-red-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[500px] bg-yellow-500/5 rounded-full blur-[100px]" />
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
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">MMT Vietnam</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-8 py-14">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-4 mb-5">
            <span className="text-6xl filter drop-shadow-lg">🇻🇳</span>
            <div className="text-left">
              <h1 className="text-5xl font-black text-white tracking-tight leading-tight">
                MMT Vietnam
              </h1>
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
              6 Role Portals
            </div>
          </div>

          <p className="text-slate-500 text-sm mt-5 max-w-lg mx-auto">
            Select your role below to enter your portal. Each role has a dedicated dashboard with tailored tools and permissions.
          </p>
        </div>

        {/* Role grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {ROLES.map(role => {
            const Icon = role.icon
            return (
              <button
                key={role.id}
                onClick={() => router.push(`/login?role=${role.id}`)}
                className={`
                  group relative rounded-2xl border p-7 text-left transition-all duration-300 outline-none
                  bg-gradient-to-br ${role.gradient} bg-slate-900/80 backdrop-blur-sm
                  ${role.border}
                  cursor-pointer hover:scale-[1.02] hover:shadow-2xl ${role.glow}
                  focus:ring-2 focus:ring-brand-500/40
                `}
              >
                {/* Role code tag */}
                <div className="absolute top-5 right-5">
                  <span className="text-[10px] font-bold text-slate-600 font-mono tracking-wider">
                    {role.sublabel}
                  </span>
                </div>

                {/* Icon */}
                <div className={`w-13 h-13 rounded-xl ${role.iconBg} flex items-center justify-center mb-5 w-12 h-12`}>
                  <Icon className={`w-6 h-6 ${role.iconColor}`} />
                </div>

                {/* Label */}
                <h3 className="text-lg font-black text-white mb-1.5 tracking-tight">{role.label}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-5">{role.description}</p>

                {/* Features */}
                <div className="space-y-1.5 mb-6">
                  {role.features.map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <CheckCircle2 className={`w-3 h-3 ${role.iconColor} flex-shrink-0`} />
                      <span className="text-xs text-slate-500">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
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
