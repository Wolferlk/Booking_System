'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, CheckCircle2, Truck } from 'lucide-react'
import Image from 'next/image'

interface VendorInfo {
  id: string
  name: string
  email: string | null
  phone: string | null
  country: string | null
  isRegistered: boolean
}

export default function VendorRegisterPage() {
  const { token } = useParams<{ token: string }>()
  const router    = useRouter()

  const [vendor, setVendor]     = useState<VendorInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone]         = useState(false)

  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [whatsapp, setWhatsapp]       = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPw, setConfirmPw]     = useState('')
  const [showPw, setShowPw]           = useState(false)
  const [submitting, setSubmitting]   = useState(false)

  useEffect(() => {
    fetch(`/api/public/vendor-register?id=${token}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setNotFound(true); return }
        setVendor(d.data)
        setName(d.data.name ?? '')
        setEmail(d.data.email ?? '')
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPw) { toast.error('Passwords do not match'); return }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/public/vendor-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendorId: token, name, email, whatsappPhone: whatsapp, password }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      setDone(true)
      setTimeout(() => router.push('/vendor/dashboard'), 2000)
    } finally { setSubmitting(false) }
  }

  if (notFound) return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-red-400 font-bold text-lg mb-2">Invalid Link</p>
        <p className="text-slate-500 text-sm">This registration link is invalid or expired.</p>
      </div>
    </div>
  )

  if (!vendor) return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
    </div>
  )

  if (vendor.isRegistered) return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center p-4">
      <div className="text-center max-w-xs">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <p className="text-white font-bold text-lg mb-1">Already Registered</p>
        <p className="text-slate-400 text-sm mb-5">{vendor.name} is already set up. Please log in.</p>
        <button onClick={() => router.push('/vendor/login')} className="bg-brand-500 text-white rounded-xl px-6 py-3 text-sm font-bold">
          Go to Login
        </button>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen bg-[#060a14] flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="text-white font-bold text-xl mb-2">Welcome aboard!</p>
        <p className="text-slate-400 text-sm">Redirecting to your dashboard…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1e] via-[#0d1628] to-[#060a14] flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-emerald-600/6 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-brand-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-3 mb-1">
            <div className="relative w-12 h-12">
              <Image src="/png/aahaslogo.png" alt="AppleHolidays" fill className="object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <p className="text-white font-black text-xl">Apple<span className="text-brand-400">Holidays</span></p>
          </div>
          <p className="text-slate-500 text-xs tracking-widest uppercase">Vendor Registration</p>
        </div>

        <div className="bg-white/4 backdrop-blur-xl border border-white/8 rounded-3xl p-6 shadow-2xl">
          {/* Vendor badge */}
          <div className="flex items-center gap-3 mb-6 p-3.5 bg-white/4 rounded-2xl border border-white/6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-brand-500/20 flex items-center justify-center">
              <Truck className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-white text-sm font-bold">{vendor.name}</p>
              <p className="text-slate-500 text-xs">Setting up your vendor account</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Company Name *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="Your company name"
                className="w-full bg-white/6 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="contact@yourcompany.com"
                className="w-full bg-white/6 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">WhatsApp Number</label>
              <input
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                placeholder="+94 77 123 4567"
                className="w-full bg-white/6 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              />
            </div>

            <div className="border-t border-white/8 pt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Password *</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="Min 6 characters"
                    className="w-full bg-white/6 border border-white/10 rounded-xl py-3 px-4 pr-12 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Confirm Password *</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  required
                  placeholder="Repeat password"
                  className="w-full bg-white/6 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !name || !password || !confirmPw}
              className="w-full bg-gradient-to-r from-emerald-500 to-brand-500 hover:from-emerald-600 hover:to-brand-600 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Account & Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
