'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Mail, Phone, PlaneTakeoff, LogIn } from 'lucide-react'
import Image from 'next/image'

const INPUT = 'w-full bg-[#0c1a24] border border-white/12 rounded-xl py-3.5 px-4 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20 transition-all'

export default function FileHandlerLoginPage() {
  const router = useRouter()
  const [credential, setCredential] = useState('')
  const [password,   setPassword]   = useState('')
  const [showPw,     setShowPw]      = useState(false)
  const [loading,    setLoading]     = useState(false)

  useEffect(() => {
    fetch('/api/filehandler/auth/me').then(r => r.json()).then(d => {
      if (d.success) router.replace('/filehandler/dashboard')
    }).catch(() => {})
  }, [router])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!credential.trim() || !password) return
    setLoading(true)
    try {
      const res  = await fetch('/api/filehandler/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credential.trim(), password }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      toast.success(`Welcome, ${data.data.name}!`)
      router.push('/filehandler/dashboard')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[#05121a] flex flex-col items-center justify-center p-4 overflow-hidden relative">
      <style>{`
        @keyframes fhAurora { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(4%,-3%) scale(1.15)} }
        @keyframes fhPlane  { 0%{transform:translate(-20vw,20vh) rotate(12deg);opacity:0} 12%{opacity:.5} 88%{opacity:.5} 100%{transform:translate(120vw,-30vh) rotate(12deg);opacity:0} }
        @keyframes fhRise   { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-25%] right-[-10%] w-[65vw] h-[65vw] rounded-full blur-[130px]" style={{ background: 'rgba(16,185,129,.10)', animation: 'fhAurora 14s ease-in-out infinite' }} />
        <div className="absolute bottom-[-25%] left-[-10%] w-[60vw] h-[60vw] rounded-full blur-[120px]" style={{ background: 'rgba(6,182,212,.10)', animation: 'fhAurora 18s ease-in-out infinite reverse' }} />
        <PlaneTakeoff className="absolute w-8 h-8 text-emerald-400/30" style={{ animation: 'fhPlane 22s linear infinite' }} />
        <PlaneTakeoff className="absolute w-5 h-5 text-cyan-400/25" style={{ animation: 'fhPlane 30s linear infinite', animationDelay: '10s' }} />
      </div>

      <div className="relative w-full max-w-sm" style={{ animation: 'fhRise .5s ease-out both' }}>
        <div className="text-center mb-8">
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

        <div className="bg-white/[0.04] backdrop-blur-xl border border-white/8 rounded-3xl shadow-2xl p-6">
          <div className="mb-5">
            <h2 className="text-white font-black text-lg">Welcome back</h2>
            <p className="text-slate-500 text-xs mt-0.5">Sign in to add flights & manage cancellations</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email or phone</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  {/^\+?[\d\s]/.test(credential) ? <Phone className="w-4 h-4 text-slate-500" /> : <Mail className="w-4 h-4 text-slate-500" />}
                </div>
                <input type="text" value={credential} onChange={e => setCredential(e.target.value)}
                  placeholder="you@example.com or +94 77 ..." autoComplete="username" className={`${INPUT} pl-11`} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  required placeholder="Enter your password" autoComplete="current-password" className={`${INPUT} pr-12`} />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading || !credential.trim() || !password}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white rounded-xl py-4 text-sm font-bold transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              Sign In
            </button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-5">
          New file handler?{' '}
          <button onClick={() => router.push('/filehandler/register')} className="text-emerald-400 hover:text-emerald-300 font-semibold">Register here</button>
        </p>
        <p className="text-center text-slate-700 text-xs mt-2">© {new Date().getFullYear()} AppleHolidays · File Handler Portal</p>
      </div>
    </div>
  )
}
