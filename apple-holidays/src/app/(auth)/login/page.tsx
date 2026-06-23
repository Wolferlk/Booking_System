'use client'

import { useState, useEffect, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Eye, EyeOff, Loader2, ChevronLeft,
  FileText, Truck, MapPin, BarChart2, Globe, Shield, Lock,
} from 'lucide-react'

const COUNTRY_PARAM_TO_FILTER: Record<string, string> = {
  vietnam:   'VIETNAM',
  srilanka:  'SRILANKA',
  singapore: 'SINGAPORE_MALAYSIA',
  malaysia:  'SINGAPORE_MALAYSIA',
}

const DESTINATION_META: Record<string, { label: string; flag: string; code: string }> = {
  vietnam:   { label: 'Vietnam',              flag: '🇻🇳',     code: 'MMT_VN' },
  srilanka:  { label: 'Sri Lanka',            flag: '🇱🇰',     code: 'MMT_LK' },
  malaysia:  { label: 'Malaysia',             flag: '🇲🇾',     code: 'MMT_MY' },
  singapore: { label: 'Singapore & Malaysia', flag: '🇸🇬🇲🇾', code: 'MMT_SG_MY' },
}

const ROLE_META: Record<string, {
  label: string
  email: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  border: string
  description: string
}> = {
  BT_USER: {
    label: 'Booking Team',
    email: 'bt@apple.com',
    icon: FileText,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    description: 'Bookings, change requests & lifecycle management',
  },
  GT_USER: {
    label: 'Ground Team',
    email: 'gt@apple.com',
    icon: Truck,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    description: 'Ground logistics, drivers & vehicle assignments',
  },
  GT_TE_USER: {
    label: 'Ground & Travel Experience',
    email: 'sl-gte@apple.com',
    icon: Truck,
    color: 'text-teal-400',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
    description: 'Ground logistics, assignments, reminders & payments',
  },
  TE_USER: {
    label: 'Travel Experiences',
    email: 'te@apple.com',
    icon: MapPin,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    description: 'Guest communication, reminders & payments',
  },
  AC_USER: {
    label: 'Accounts Team',
    email: 'ac@apple.com',
    icon: BarChart2,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    description: 'P&L management, payment confirmation & profit reports',
  },
  CLIENT: {
    label: 'Client View',
    email: 'client@apple.com',
    icon: Globe,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    description: 'Traveller & agent portal — your trip itinerary',
  },
  SUPER_ADMIN: {
    label: 'Country Admin',
    email: 'admin@apple.com',
    icon: Shield,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    description: 'Full country access — all modules and audit log',
  },
  ULTRA_SUPER_ADMIN: {
    label: 'Ultra Super Admin',
    email: 'ultra@apple.com',
    icon: Lock,
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/30',
    description: 'All-countries system access',
  },
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const roleParam    = searchParams.get('role')    ?? ''
  const countryParam = searchParams.get('country') ?? ''
  const roleMeta        = ROLE_META[roleParam] ?? null
  const destinationMeta = DESTINATION_META[countryParam]

  const [email,            setEmail]            = useState('')
  const [password,         setPassword]         = useState('')
  const [showPw,           setShowPw]           = useState(false)
  const [loading,          setLoading]          = useState(false)

  useEffect(() => {
    if (roleMeta) {
      setEmail(roleMeta.email)
      setPassword('password123')
    }
  }, [roleMeta])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })
      if (result?.error) {
        toast.error('Invalid email or password')
      } else {
        const countryFilter = COUNTRY_PARAM_TO_FILTER[countryParam]
        if (countryFilter) {
          localStorage.setItem('ah_country_filter', countryFilter)
        }
        router.push(roleParam === 'CLIENT' ? '/portal' : '/dashboard')
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  const RoleIcon = roleMeta?.icon

  return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-brand-500/6 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/" className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-sm group">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to destinations
          </Link>
        </div>

        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
              <span className="text-white font-black text-base">AH</span>
            </div>
            <div className="text-left">
              <p className="text-white font-bold text-xl leading-tight">AppleHolidays</p>
              <p className="text-slate-500 text-xs tracking-wider">Multi-Destination Platform</p>
            </div>
          </div>

          {destinationMeta && (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 mb-4">
              <span className="text-xl">{destinationMeta.flag}</span>
              <div className="text-left">
                <p className="text-sm font-bold text-white leading-tight">{destinationMeta.label}</p>
                <p className="text-[11px] text-slate-500 tracking-wider uppercase">{destinationMeta.code}</p>
              </div>
            </div>
          )}

          {roleMeta && RoleIcon ? (
            <div className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${roleMeta.bg} ${roleMeta.border} mb-2`}>
              <RoleIcon className={`w-4 h-4 ${roleMeta.color}`} />
              <div className="text-left">
                <p className={`text-sm font-bold ${roleMeta.color} leading-tight`}>{roleMeta.label}</p>
                <p className="text-slate-500 text-xs leading-tight">{roleMeta.description}</p>
              </div>
            </div>
          ) : (
            <p className="text-slate-400 text-sm">Sign in to your account</p>
          )}
        </div>

        <div className="bg-white/4 backdrop-blur-md border border-white/8 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-white font-bold text-lg mb-6 text-center">
            {roleMeta ? `Sign in as ${roleMeta.label}` : 'Sign In'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                placeholder="you@appleholidays.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all pr-12"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-[#060a14] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2 shadow-lg shadow-brand-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                `Sign in${roleMeta ? ` as ${roleMeta.label}` : ''}`
              )}
            </button>
          </form>

          {!roleMeta && (
            <div className="mt-6 pt-5 border-t border-white/8">
              <p className="text-xs text-slate-600 text-center mb-3">Or sign in as a specific role</p>
              <Link href="/vietnam" className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-400 hover:text-white transition-colors">
                View all role portals
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-slate-700 text-xs mt-6">
          © {new Date().getFullYear()} AppleHolidays Multi-Destination
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
