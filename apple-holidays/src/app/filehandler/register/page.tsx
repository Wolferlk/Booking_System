'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, User2, Mail, Phone, Globe, CheckCircle2, ArrowRight, PlaneTakeoff } from 'lucide-react'
import Image from 'next/image'

const COUNTRIES = [
  { value: 'ALL',                label: '🌐 All Countries' },
  { value: 'SRILANKA',           label: '🇱🇰 Sri Lanka' },
  { value: 'VIETNAM',            label: '🇻🇳 Vietnam' },
  { value: 'SINGAPORE',          label: '🇸🇬 Singapore' },
  { value: 'MALAYSIA',           label: '🇲🇾 Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: '🇸🇬🇲🇾 Singapore & Malaysia' },
]

const INPUT = 'w-full bg-[#0c1a24] border border-white/12 rounded-xl py-3.5 px-4 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 transition-all'
const INPUT_ICON = `${INPUT} pl-11`

export default function FileHandlerRegisterPage() {
  const router = useRouter()

  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [country,  setCountry]  = useState('ALL')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const [handlerName, setHandlerName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    if (password.length < 6)  { toast.error('Password must be at least 6 characters'); return }

    setLoading(true)
    try {
      const res  = await fetch('/api/public/filehandler-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), whatsappPhone: whatsapp.trim(), country, password }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      setHandlerName(data.data.name)
      setDone(true)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[#05121a] flex flex-col items-center justify-center p-4 overflow-hidden relative">
      <style>{`
        @keyframes fhAurora { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(4%,-3%) scale(1.15)} }
        @keyframes fhPlane  { 0%{transform:translate(-20vw,20vh) rotate(12deg);opacity:0} 12%{opacity:.5} 88%{opacity:.5} 100%{transform:translate(120vw,-30vh) rotate(12deg);opacity:0} }
        @keyframes fhRise   { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fhPop    { 0%{opacity:0;transform:scale(.6)} 60%{transform:scale(1.08)} 100%{opacity:1;transform:scale(1)} }
      `}</style>
      {/* Animated aurora + flight paths */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-25%] right-[-10%] w-[65vw] h-[65vw] rounded-full blur-[130px]" style={{ background: 'rgba(16,185,129,.10)', animation: 'fhAurora 14s ease-in-out infinite' }} />
        <div className="absolute bottom-[-25%] left-[-10%] w-[60vw] h-[60vw] rounded-full blur-[120px]" style={{ background: 'rgba(6,182,212,.10)', animation: 'fhAurora 18s ease-in-out infinite reverse' }} />
        <PlaneTakeoff className="absolute w-8 h-8 text-emerald-400/30" style={{ animation: 'fhPlane 22s linear infinite' }} />
        <PlaneTakeoff className="absolute w-5 h-5 text-cyan-400/25" style={{ animation: 'fhPlane 30s linear infinite', animationDelay: '8s' }} />
      </div>

      <div className="relative w-full max-w-sm" style={{ animation: 'fhRise .5s ease-out both' }}>
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="relative w-14 h-14">
              <Image src="/png/apple-logo.png" alt="AppleHolidays" fill className="object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
            <div className="text-left">
              <p className="text-white font-black text-2xl leading-tight tracking-tight">
                Apple<span className="text-emerald-400">Holidays</span>
              </p>
              <p className="text-emerald-300/70 text-xs tracking-[0.2em] uppercase">File Handler Portal</p>
            </div>
          </div>
        </div>

        {done ? (
          <div className="bg-white/[0.04] backdrop-blur-xl border border-white/8 rounded-3xl p-8 shadow-2xl text-center" style={{ animation: 'fhPop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-white font-black text-xl mb-2">Registration Submitted!</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-1">
              <span className="text-white font-semibold">{handlerName}</span> has been registered.
            </p>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              An admin must approve your account before you can log in. You&apos;ll be notified once activated.
            </p>
            <button
              onClick={() => router.push('/filehandler/login')}
              className="w-full bg-white/8 hover:bg-white/12 border border-white/12 text-white rounded-xl py-3.5 text-sm font-semibold transition-all flex items-center justify-center gap-2"
            >
              Go to Login <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="bg-white/[0.04] backdrop-blur-xl border border-white/8 rounded-3xl p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-white font-black text-lg">File Handler Registration</h2>
              <p className="text-slate-500 text-xs mt-0.5">Create your account to manage flight details & cancellations</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Full Name *" icon={<User2 className="fh-ico" />}>
                <input required value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className={INPUT_ICON} />
              </Field>

              <Field label="Email *" icon={<Mail className="fh-ico" />}>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={INPUT_ICON} />
              </Field>

              <Field label="WhatsApp / Phone" icon={<Phone className="fh-ico" />}>
                <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+94 77 123 4567" className={INPUT_ICON} />
              </Field>

              <Field label="Operation Country" icon={<Globe className="fh-ico z-10" />}>
                <select required value={country} onChange={e => setCountry(e.target.value)} className={`${INPUT_ICON} appearance-none`} style={{ colorScheme: 'dark' }}>
                  {COUNTRIES.map(c => <option key={c.value} value={c.value} style={{ background: '#0c1a24' }}>{c.label}</option>)}
                </select>
              </Field>

              <div className="border-t border-white/6 pt-1" />

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Password *</label>
                <div className="relative">
                  <input required type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Min 6 characters" autoComplete="new-password" className={`${INPUT} pr-12`} />
                  <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Confirm Password *</label>
                <input required type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password" autoComplete="new-password"
                  className={`${INPUT} ${confirm && confirm !== password ? 'border-red-500/50' : ''}`} />
                {confirm && confirm !== password && <p className="text-red-400 text-xs mt-1 pl-1">Passwords do not match</p>}
              </div>

              <button type="submit" disabled={loading || !name || !email || !password || password !== confirm}
                className="w-full bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-40 flex items-center justify-center gap-2 mt-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlaneTakeoff className="w-4 h-4" />}
                Register as File Handler
              </button>
            </form>

            <p className="text-center text-slate-600 text-xs mt-5">
              Already registered?{' '}
              <button onClick={() => router.push('/filehandler/login')} className="text-emerald-400 hover:text-emerald-300 font-semibold">Sign in here</button>
            </p>
          </div>
        )}

        <p className="text-center text-slate-700 text-xs mt-6">© {new Date().getFullYear()} AppleHolidays · File Handler Portal</p>
      </div>

      <style>{`.fh-ico{position:absolute;left:0.875rem;top:50%;transform:translateY(-50%);width:1rem;height:1rem;color:#64748b;pointer-events:none}`}</style>
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">{icon}{children}</div>
    </div>
  )
}
