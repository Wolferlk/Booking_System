'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Building2, Mail, Phone, Globe, CheckCircle2, ArrowRight } from 'lucide-react'
import Image from 'next/image'

const COUNTRIES = [
  { value: 'SRILANKA',           label: '🇱🇰 Sri Lanka' },
  { value: 'VIETNAM',            label: '🇻🇳 Vietnam' },
  { value: 'SINGAPORE',          label: '🇸🇬 Singapore' },
  { value: 'MALAYSIA',           label: '🇲🇾 Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: '🇸🇬🇲🇾 Singapore & Malaysia' },
]

// Solid dark background — avoids mobile browsers overriding transparent bg to white
const INPUT = 'w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3.5 px-4 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20'
const INPUT_ICON = `${INPUT} pl-11`

export default function VendorRegisterPage() {
  const router = useRouter()

  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [whatsapp,  setWhatsapp]  = useState('')
  const [country,   setCountry]   = useState('')
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)
  const [vendorName, setVendorName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    if (password.length < 6)  { toast.error('Password must be at least 6 characters'); return }

    setLoading(true)
    try {
      const res  = await fetch('/api/public/vendor-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), whatsappPhone: whatsapp.trim(), country, password }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      setVendorName(data.data.name)
      setDone(true)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1628] to-[#060a14] flex flex-col items-center justify-center p-4">
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

        {done ? (
          /* Success */
          <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl p-8 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-white font-black text-xl mb-2">Registration Submitted!</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-1">
              <span className="text-white font-semibold">{vendorName}</span> has been registered.
            </p>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              Your account is pending admin approval. You will be able to log in once activated.
            </p>
            <button
              onClick={() => router.push('/vendor/login')}
              className="w-full bg-white/8 hover:bg-white/12 border border-white/12 text-white rounded-xl py-3.5 text-sm font-semibold transition-all flex items-center justify-center gap-2"
            >
              Go to Login <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        ) : (
          /* Registration form */
          <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-white font-black text-lg">Vendor Registration</h2>
              <p className="text-slate-500 text-xs mt-0.5">Create your account to access the portal</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Company Name */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Company Name *
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <input
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your transport company name"
                    className={INPUT_ICON}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Email *
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="contact@yourcompany.com"
                    className={INPUT_ICON}
                  />
                </div>
              </div>

              {/* WhatsApp */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  WhatsApp Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <input
                    type="tel"
                    value={whatsapp}
                    onChange={e => setWhatsapp(e.target.value)}
                    placeholder="+94 77 123 4567"
                    className={INPUT_ICON}
                  />
                </div>
              </div>

              {/* Country */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Operation Country *
                </label>
                <div className="relative">
                  <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none z-10" />
                  <select
                    required
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className={`${INPUT_ICON} appearance-none`}
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="" disabled style={{ background: '#1e2d45' }}>Select your country</option>
                    {COUNTRIES.map(c => (
                      <option key={c.value} value={c.value} style={{ background: '#1e2d45' }}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-white/6 pt-1" />

              {/* Password */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Password *
                </label>
                <div className="relative">
                  <input
                    required
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    autoComplete="new-password"
                    className={`${INPUT} pr-12`}
                  />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Confirm Password *
                </label>
                <input
                  required
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  className={`${INPUT} ${confirm && confirm !== password ? 'border-red-500/50' : ''}`}
                />
                {confirm && confirm !== password && (
                  <p className="text-red-400 text-xs mt-1 pl-1">Passwords do not match</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !name || !email || !country || !password || password !== confirm}
                className="w-full bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-600 hover:to-purple-700 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg shadow-brand-500/25 disabled:opacity-40 flex items-center justify-center gap-2 mt-1"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Register as Vendor
              </button>
            </form>

            <p className="text-center text-slate-600 text-xs mt-5">
              Already registered?{' '}
              <button onClick={() => router.push('/vendor/login')} className="text-brand-400 hover:text-brand-300 font-semibold">
                Sign in here
              </button>
            </p>
          </div>
        )}

        <p className="text-center text-slate-700 text-xs mt-6">
          © {new Date().getFullYear()} AppleHolidays · Vendor Portal
        </p>
      </div>
    </div>
  )
}
