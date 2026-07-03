'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save, LogOut, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react'

interface Profile {
  id: string; name: string; email: string | null; phone: string | null
  whatsappPhone: string | null; address: string | null; country: string | null
}

export default function VendorProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [showPwSection, setShowPwSection] = useState(false)

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [phone, setPhone]       = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [address, setAddress]   = useState('')

  const [curPw, setCurPw]   = useState('')
  const [newPw, setNewPw]   = useState('')
  const [cnfPw, setCnfPw]   = useState('')
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/profile')
      .then(r => r.json())
      .then(d => {
        if (!d.success) return
        const p: Profile = d.data
        setProfile(p)
        setName(p.name); setEmail(p.email ?? ''); setPhone(p.phone ?? '')
        setWhatsapp(p.whatsappPhone ?? ''); setAddress(p.address ?? '')
      })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    if (!name.trim()) { toast.error('Name is required'); return }
    if (newPw && newPw !== cnfPw) { toast.error('Passwords do not match'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/vendor/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, whatsappPhone: whatsapp, address,
          currentPassword: curPw || undefined, newPassword: newPw || undefined }),
      })
      const data = await res.json()
      if (!data.success) { toast.error(data.error); return }
      toast.success('Profile saved')
      setCurPw(''); setNewPw(''); setCnfPw('')
      setShowPwSection(false)
    } finally { setSaving(false) }
  }

  async function logout() {
    await fetch('/api/vendor/auth/logout', { method: 'POST' })
    router.replace('/vendor/login')
  }

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>
  if (!profile) return null

  const COUNTRY_LABEL: Record<string, string> = {
    SRILANKA: '🇱🇰 Sri Lanka', VIETNAM: '🇻🇳 Vietnam',
    SINGAPORE: '🇸🇬 Singapore', MALAYSIA: '🇲🇾 Malaysia', SINGAPORE_MALAYSIA: '🇸🇬🇲🇾 SG / MY',
  }

  return (
    <div className="p-4 space-y-4 pb-8">
      <div className="pt-2">
        <h1 className="text-white font-black text-2xl">Profile</h1>
        <p className="text-slate-500 text-sm">Manage your company account</p>
      </div>

      {/* Country badge */}
      {profile.country && (
        <div className="inline-flex items-center gap-2 bg-white/4 border border-white/8 rounded-xl px-3 py-2">
          <span className="text-sm">{COUNTRY_LABEL[profile.country] ?? profile.country}</span>
        </div>
      )}

      {/* Company details */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 space-y-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Company Info</p>

        {[
          { label: 'Company Name *', val: name, set: setName, type: 'text' },
          { label: 'Email', val: email, set: setEmail, type: 'email' },
          { label: 'Phone', val: phone, set: setPhone, type: 'tel' },
          { label: 'WhatsApp', val: whatsapp, set: setWhatsapp, type: 'tel' },
          { label: 'Address', val: address, set: setAddress, type: 'text' },
        ].map(f => (
          <div key={f.label}>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">{f.label}</label>
            <input
              type={f.type}
              value={f.val}
              onChange={e => f.set(e.target.value)}
              className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
        ))}
      </div>

      {/* Change password */}
      <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowPwSection(s => !s)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Change Password</p>
          {showPwSection ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>

        {showPwSection && (
          <div className="px-5 pb-5 space-y-3 border-t border-white/6">
            <div className="relative pt-3">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Current Password</label>
              <input type={showPw ? 'text' : 'password'} value={curPw} onChange={e => setCurPw(e.target.value)}
                placeholder="Your current password"
                className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
              <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 bottom-3 text-slate-500">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">New Password</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 6 characters"
                className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Confirm Password</label>
              <input type="password" value={cnfPw} onChange={e => setCnfPw(e.target.value)} placeholder="Repeat new password"
                className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40" />
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <button
        onClick={save}
        disabled={saving || !name.trim()}
        className="w-full bg-gradient-to-r from-brand-500 to-purple-600 text-white rounded-2xl py-4 text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20 disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save Changes
      </button>

      {/* Sign out */}
      <button
        onClick={logout}
        className="w-full py-4 text-sm font-semibold text-slate-500 hover:text-red-400 flex items-center justify-center gap-2 transition-colors"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  )
}
