'use client'

/**
 * /dashboard/profile — my own record.
 *
 * The photo taken here goes into the bucket both systems share, so it is the
 * same face the Accounts desk sees beside these messages in chat. That is why
 * this page exists at all: OPS had no way to set a picture, so every OPS person
 * showed up as two grey letters everywhere, on both systems.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import { Camera, Check, Loader2, ShieldCheck, Trash2, Upload, User2 } from 'lucide-react'
import Header from '@/components/layout/header'
import { ROLE_LABELS } from '@/lib/rbac'
import { getInitials } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

interface Profile {
  id: string
  email: string
  name: string
  role: UserRole
  country: string
  phone: string | null
  avatar: string | null
  createdAt: string
}

const MAX_MB = 4

export default function ProfilePage() {
  const { data: session, update: refreshSession } = useSession()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const [loading, setLoading] = useState(true)
  const [savingDetails, setSavingDetails] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  // Bumped after every photo change: the avatar URL is cached hard on purpose,
  // so the only way to show a new face immediately is to ask for a new URL.
  const [version, setVersion] = useState(() => Date.now())
  const [photoFailed, setPhotoFailed] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/profile', { cache: 'no-store' })
    const json = await res.json()
    if (json.success) {
      setProfile(json.data)
      setName(json.data.name ?? '')
      setPhone(json.data.phone ?? '')
    } else {
      setNote({ tone: 'bad', text: json.error || 'Your profile could not be loaded.' })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const avatarSrc = profile?.avatar
    ? `/api/chat/avatar/ops/${encodeURIComponent(profile.id)}?v=${version}`
    : null

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setSavingDetails(true)
    setNote(null)

    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    })
    const json = await res.json()

    if (json.success) {
      setProfile(json.data)
      setNote({ tone: 'ok', text: 'Profile details saved.' })
      await refreshSession()
    } else {
      setNote({ tone: 'bad', text: json.error || 'Those details could not be saved.' })
    }
    setSavingDetails(false)
  }

  async function uploadPhoto(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      setNote({ tone: 'bad', text: `That photo is larger than the ${MAX_MB} MB limit.` })
      return
    }

    setSavingPhoto(true)
    setNote(null)

    const form = new FormData()
    form.append('photo', file)

    const res = await fetch('/api/profile/photo', { method: 'POST', body: form })
    const json = await res.json()

    if (json.success) {
      setProfile(p => (p ? { ...p, avatar: json.data.avatar } : p))
      setPhotoFailed(false)
      setVersion(Date.now())
      setNote({ tone: 'ok', text: 'Photo updated — it now shows in chat on both systems.' })
      await refreshSession()
    } else {
      setNote({ tone: 'bad', text: json.error || 'The photo could not be saved.' })
    }
    setSavingPhoto(false)
  }

  async function removePhoto() {
    setSavingPhoto(true)
    setNote(null)

    const res = await fetch('/api/profile/photo', { method: 'DELETE' })
    const json = await res.json()

    if (json.success) {
      setProfile(p => (p ? { ...p, avatar: null } : p))
      setVersion(Date.now())
      setNote({ tone: 'ok', text: 'Photo removed. Your initials are shown instead.' })
      await refreshSession()
    } else {
      setNote({ tone: 'bad', text: json.error || 'The photo could not be removed.' })
    }
    setSavingPhoto(false)
  }

  const initials = getInitials(profile?.name || session?.user?.name || 'U')

  return (
    <>
      <Header
        title="My Profile"
        subtitle="Your name, phone and photo — the photo follows you into chat, in Operations and in Accounts"
      />

      <div className="px-4 sm:px-8 py-6 max-w-5xl">
        {/* Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-brand-700 p-6 sm:p-8 text-white shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="relative h-24 w-24 flex-shrink-0 rounded-3xl bg-white/10 ring-4 ring-white/20 overflow-hidden grid place-items-center">
              {avatarSrc && !photoFailed ? (
                <Image
                  src={avatarSrc}
                  alt={profile?.name ?? 'Profile photo'}
                  width={96}
                  height={96}
                  unoptimized
                  onError={() => setPhotoFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-3xl font-bold tracking-wide">{initials}</span>
              )}
              {savingPhoto && (
                <span className="absolute inset-0 grid place-items-center bg-slate-900/60">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </span>
              )}
            </div>

            <div className="min-w-0">
              <h2 className="text-2xl font-bold truncate">{profile?.name ?? '…'}</h2>
              <p className="text-white/70 text-sm truncate">{profile?.email}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {profile?.role && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {ROLE_LABELS[profile.role] ?? profile.role}
                  </span>
                )}
                {profile?.country && (
                  <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">
                    {profile.country.replace(/_/g, ' ')}
                  </span>
                )}
                <span className="rounded-full bg-white/15 px-3 py-1 font-semibold">Operations</span>
              </div>
            </div>
          </div>
        </div>

        {note && (
          <div
            className={`mt-5 rounded-xl px-4 py-3 text-sm font-medium ${
              note.tone === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {note.text}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Details */}
          <form
            onSubmit={saveDetails}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h3 className="text-base font-bold text-slate-900">Profile details</h3>
            <p className="mt-1 text-sm text-slate-500">
              Your name is what colleagues see on every message, booking and log entry.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Full name</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={loading}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Phone number</span>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  disabled={loading}
                  placeholder="e.g. 94778231121"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Email address</span>
                <input
                  value={profile?.email ?? ''}
                  readOnly
                  className="mt-1.5 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
                />
                <span className="mt-1 block text-xs text-slate-400">
                  Your email is your sign-in identity — a super admin must change it.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={savingDetails || loading}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {savingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save details
            </button>
          </form>

          {/* Photo */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-slate-900">Profile photo</h3>
            <p className="mt-1 text-sm text-slate-500">JPG, PNG or WebP, up to {MAX_MB} MB.</p>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files?.[0]
                if (file) void uploadPhoto(file)
              }}
              onClick={() => fileInput.current?.click()}
              className={`mt-4 grid cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
              }`}
            >
              <div className="relative h-20 w-20 overflow-hidden rounded-2xl bg-slate-100 grid place-items-center">
                {avatarSrc && !photoFailed ? (
                  <Image
                    src={avatarSrc}
                    alt="Current photo"
                    width={80}
                    height={80}
                    unoptimized
                    onError={() => setPhotoFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User2 className="h-8 w-8 text-slate-400" />
                )}
              </div>
              <div className="text-sm">
                <span className="font-semibold text-slate-900">Click to choose</span>
                <span className="text-slate-500"> or drop an image here</span>
              </div>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void uploadPhoto(file)
                e.target.value = ''
              }}
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={savingPhoto}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload photo
              </button>

              {profile?.avatar && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={savingPhoto}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              )}
            </div>

            <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <Camera className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Your photo is stored once and shown in both systems — Operations chat and the
              Accounts system see the same picture.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
