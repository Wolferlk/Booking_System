'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Search, ChevronRight, Truck } from 'lucide-react'
import Image from 'next/image'

interface VendorOption {
  id: string
  name: string
  country: string | null
  isRegistered: boolean
}

const FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰',
  VIETNAM: '🇻🇳',
  SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾',
  SINGAPORE_MALAYSIA: '🇸🇬🇲🇾',
}

export default function VendorLoginPage() {
  const router = useRouter()
  const [vendors, setVendors]       = useState<VendorOption[]>([])
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<VendorOption | null>(null)
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [loading, setLoading]       = useState(false)
  const [loadingVendors, setLoadingVendors] = useState(true)

  useEffect(() => {
    fetch('/api/vendor/auth/me').then(r => r.json()).then(d => {
      if (d.success) router.replace('/vendor/dashboard')
    })

    fetch('/api/ground/vendors')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setVendors(d.data.filter((v: VendorOption) => v.isRegistered))
        }
      })
      .finally(() => setLoadingVendors(false))
  }, [router])

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setLoading(true)
    try {
      const res  = await fetch('/api/vendor/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: selected.id, password }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      toast.success(`Welcome, ${data.data.name}!`)
      router.push('/vendor/dashboard')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1628] to-[#060a14] flex flex-col items-center justify-center p-4">
      {/* Background glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-purple-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] bg-brand-500/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="relative w-14 h-14">
              <Image src="/png/aahaslogo.png" alt="AppleHolidays" fill className="object-contain" onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }} />
              <div className="absolute inset-0 w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center shadow-xl shadow-brand-500/30 [&:has(+_img[style*='none'])]:flex hidden">
                <span className="text-white font-black text-lg">AH</span>
              </div>
            </div>
            <div className="text-left">
              <p className="text-white font-black text-2xl leading-tight tracking-tight">Apple<span className="text-brand-400">Holidays</span></p>
              <p className="text-slate-500 text-xs tracking-widest uppercase">Vendor Portal</p>
            </div>
          </div>
        </div>

        {!selected ? (
          /* Step 1: Select Vendor */
          <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Truck className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Select Your Company</p>
                <p className="text-slate-500 text-xs">Find and select your vendor account</p>
              </div>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search vendor name…"
                className="w-full bg-white/6 border border-white/10 rounded-xl py-3 pl-9 pr-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                autoFocus
              />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
              {loadingVendors ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-slate-500 text-sm py-6">No registered vendors found</p>
              ) : filtered.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white/4 hover:bg-white/8 border border-white/6 hover:border-white/12 transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-brand-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-base">{FLAG[v.country ?? ''] ?? '🚌'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{v.name}</p>
                    {v.country && <p className="text-slate-500 text-xs">{v.country.replace('_', ' / ')}</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-brand-400 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Step 2: Enter Password */
          <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl p-6 shadow-2xl">
            {/* Selected vendor chip */}
            <button
              onClick={() => { setSelected(null); setPassword('') }}
              className="flex items-center gap-2.5 mb-6 w-full group"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-brand-500/20 flex items-center justify-center">
                <span className="text-base">{FLAG[selected.country ?? ''] ?? '🚌'}</span>
              </div>
              <div className="flex-1 text-left">
                <p className="text-white text-sm font-bold">{selected.name}</p>
                <p className="text-brand-400 text-xs">← Tap to change</p>
              </div>
            </button>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoFocus
                    placeholder="Enter your password"
                    className="w-full bg-white/6 border border-white/10 rounded-xl py-3.5 px-4 pr-12 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg shadow-brand-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Sign In
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-slate-700 text-xs mt-6">
          © {new Date().getFullYear()} AppleHolidays · Vendor Portal
        </p>
      </div>
    </div>
  )
}
