'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2, PlaneTakeoff } from 'lucide-react'
import Image from 'next/image'

interface FHSession { id: string; name: string; email: string; country: string | null }

export default function FileHandlerDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [fh, setFh] = useState<FHSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/filehandler/auth/me')
      .then(r => r.json())
      .then(d => { if (!d.success) { router.replace('/filehandler/login'); return } setFh(d.data) })
      .finally(() => setLoading(false))
  }, [router])

  async function logout() {
    await fetch('/api/filehandler/auth/logout', { method: 'POST' })
    router.replace('/filehandler/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-[#05121a] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
    </div>
  )
  if (!fh) return null

  return (
    <div className="min-h-screen bg-[#05121a] text-white flex flex-col">
      <header className="sticky top-0 z-30 bg-[#071a24]/90 backdrop-blur-md border-b border-white/6 px-4 sm:px-6 py-3 flex items-center gap-3">
        <div className="relative w-9 h-9 flex-shrink-0 rounded-xl overflow-hidden bg-white">
          <Image src="/png/aahaslogo.png" alt="AH" fill className="object-contain p-1"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm leading-tight truncate flex items-center gap-1.5">
            {fh.name}
          </p>
          <p className="text-emerald-300/70 text-[11px] tracking-wide flex items-center gap-1">
            <PlaneTakeoff className="w-3 h-3" /> File Handler Portal
          </p>
        </div>
        <button onClick={logout} title="Sign out"
          className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" />
        </button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
