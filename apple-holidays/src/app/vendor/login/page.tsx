'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Search, ChevronRight, Truck, Mail, Phone, ArrowLeft } from 'lucide-react'
import Image from 'next/image'

interface VendorOption {
  id: string
  name: string
  country: string | null
  phone: string | null
}

const FLAG: Record<string, string> = {
  SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬🇲🇾',
}

// Shared input class — solid dark background avoids mobile browser white-background override
const INPUT = 'w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3.5 px-4 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20'

type Tab  = 'email' | 'company'
type Step = 'pick' | 'password'

export default function VendorLoginPage() {
  const router = useRouter()

  const [tab,       setTab]       = useState<Tab>('email')
  const [step,      setStep]      = useState<Step>('pick')

  // Email / phone tab
  const [credential, setCredential] = useState('')

  // Company-name tab
  const [vendors,        setVendors]        = useState<VendorOption[]>([])
  const [loadingVendors, setLoadingVendors] = useState(true)
  const [search,         setSearch]         = useState('')
  const [selected,       setSelected]       = useState<VendorOption | null>(null)

  // Shared password step
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    fetch('/api/vendor/auth/me').then(r => r.json()).then(d => {
      if (d.success) router.replace('/vendor/dashboard')
    })
    // Load public vendor list for company-name tab
    fetch('/api/public/vendors')
      .then(r => r.json())
      .then(d => { if (d.success) setVendors(d.data) })
      .finally(() => setLoadingVendors(false))
  }, [router])

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.phone && v.phone.includes(search))
  )

  async function proceedWithCredential() {
    if (!credential.trim()) { toast.error('Enter your email or phone number'); return }
    // Directly go to password step — the login API will validate the credential
    setStep('password')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    try {
      const body = tab === 'email'
        ? { credential: credential.trim(), password }
        : { vendorId: selected!.id, password }

      const res  = await fetch('/api/vendor/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      toast.success(`Welcome, ${data.data.name}!`)
      router.push('/vendor/dashboard')
    } finally { setLoading(false) }
  }

  function goBack() {
    setStep('pick')
    setPassword('')
    setSelected(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1628] to-[#060a14] flex flex-col items-center justify-center p-4">
      {/* Ambient glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-purple-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] bg-brand-500/6 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="relative w-14 h-14">
              <Image src="/png/aahaslogo.png" alt="AppleHolidays" fill className="object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <div className="text-left">
              <p className="text-white font-black text-2xl leading-tight tracking-tight">
                Apple<span className="text-brand-400">Holidays</span>
              </p>
              <p className="text-slate-500 text-xs tracking-widest uppercase">Vendor Portal</p>
            </div>
          </div>
        </div>

        <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl shadow-2xl overflow-hidden">

          {step === 'pick' ? (
            <>
              {/* Tabs */}
              <div className="flex border-b border-white/6">
                <button
                  onClick={() => { setTab('email'); setSearch('') }}
                  className={`flex-1 py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                    tab === 'email'
                      ? 'text-white border-b-2 border-brand-400 bg-white/4'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" /> Email / Phone
                </button>
                <button
                  onClick={() => setTab('company')}
                  className={`flex-1 py-3.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                    tab === 'company'
                      ? 'text-white border-b-2 border-brand-400 bg-white/4'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" /> Company
                </button>
              </div>

              <div className="p-5">
                {tab === 'email' ? (
                  /* ── Email / Phone tab ── */
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Email address or phone number
                      </label>
                      <div className="relative">
                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                          {/^\+?[\d\s]/.test(credential)
                            ? <Phone className="w-4 h-4 text-slate-500" />
                            : <Mail  className="w-4 h-4 text-slate-500" />
                          }
                        </div>
                        <input
                          type="text"
                          value={credential}
                          onChange={e => setCredential(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && proceedWithCredential()}
                          placeholder="yourmail@example.com or +94 77 ..."
                          autoComplete="username"
                          className={`${INPUT} pl-11`}
                        />
                      </div>
                    </div>

                    <button
                      onClick={proceedWithCredential}
                      disabled={!credential.trim()}
                      className="w-full bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white rounded-xl py-3.5 text-sm font-bold transition-all shadow-lg shadow-brand-500/25 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      Continue
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                ) : (
                  /* ── Company Name tab ── */
                  <div>
                    <div className="relative mb-3">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search company name…"
                        autoFocus
                        className={`${INPUT} pl-11`}
                      />
                    </div>

                    <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-0.5">
                      {loadingVendors ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                        </div>
                      ) : filtered.length === 0 ? (
                        <p className="text-center text-slate-500 text-sm py-6">No companies found</p>
                      ) : filtered.map(v => (
                        <button
                          key={v.id}
                          onClick={() => { setSelected(v); setStep('password') }}
                          className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/4 hover:bg-white/8 border border-white/6 hover:border-white/12 transition-all text-left group"
                        >
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-brand-500/20 flex items-center justify-center flex-shrink-0">
                            <span className="text-base">{FLAG[v.country ?? ''] ?? '🚌'}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{v.name}</p>
                            {v.country && (
                              <p className="text-slate-500 text-xs">{v.country.replace('_', ' / ')}</p>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-brand-400 transition-colors flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>

          ) : (
            /* ── Password step ── */
            <div className="p-5">
              {/* Who we're logging in as */}
              <button onClick={goBack} className="flex items-center gap-2.5 mb-5 w-full group">
                <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:text-brand-400 transition-colors" />
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-bold truncate">
                    {tab === 'email' ? credential : selected?.name}
                  </p>
                  <p className="text-brand-400 text-xs">Tap to go back</p>
                </div>
                {tab === 'company' && selected?.country && (
                  <span className="text-lg">{FLAG[selected.country] ?? '🚌'}</span>
                )}
              </button>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoFocus
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      className={`${INPUT} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(s => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg shadow-brand-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Sign In
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-5">
          New vendor?{' '}
          <button onClick={() => router.push('/vendor/register')} className="text-brand-400 hover:text-brand-300 font-semibold">
            Register here
          </button>
        </p>

        <p className="text-center text-slate-700 text-xs mt-2">
          © {new Date().getFullYear()} AppleHolidays · Vendor Portal
        </p>
      </div>
    </div>
  )
}
