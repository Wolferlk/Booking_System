'use client'

/**
 * Light / dark mode for the booking detail page — one choice per signed-in user.
 *
 * The choice is stored against the user's id (so two people sharing a desk
 * machine keep their own), applied as `bk-dark` on <html> while the page is
 * open, and removed on the way out so no other route changes. The palette for
 * dark mode lives in `app/dashboard/bookings/[ref]/booking-*.css`.
 *
 * Stored in the browser, not the database: it is a viewing preference, and a
 * column for it would be a live schema change for something cosmetic.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export type BookingTheme = 'light' | 'dark'

const keyFor = (userId?: string | null) => `ops.bookingTheme.${userId || 'anon'}`

// useLayoutEffect on the client (no flash of the wrong theme), plain effect on the server.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

function read(userId?: string | null): BookingTheme {
  try { return localStorage.getItem(keyFor(userId)) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export function useBookingTheme(userId?: string | null) {
  const [theme, setThemeState] = useState<BookingTheme>('light')

  // Re-read once the session (and so the user id) is known.
  useIsoLayoutEffect(() => { setThemeState(read(userId)) }, [userId])

  useIsoLayoutEffect(() => {
    const html = document.documentElement
    html.classList.toggle('bk-dark', theme === 'dark')
    return () => { html.classList.remove('bk-dark') }
  }, [theme])

  // Same user, another tab: follow along.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === keyFor(userId)) setThemeState(read(userId)) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [userId])

  const setTheme = useCallback((next: BookingTheme) => {
    const html = document.documentElement
    html.classList.add('bk-theme-anim')
    window.setTimeout(() => html.classList.remove('bk-theme-anim'), 450)
    setThemeState(next)
    try { localStorage.setItem(keyFor(userId), next) } catch { /* private window — applies for this visit only */ }
  }, [userId])

  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}

const STARS = [[18, 30], [30, 62], [44, 24], [12, 70], [36, 44]] as const

export function ThemeSwitch({ theme, onToggle }: { theme: BookingTheme; onToggle: () => void }) {
  const on = theme === 'dark'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? 'Switch to light mode' : 'Switch to dark mode'}
      title={on ? 'Dark mode — click for light' : 'Light mode — click for dark'}
      onClick={onToggle}
      data-on={on}
      className="bk-switch"
    >
      <span className="bk-switch-stars" aria-hidden>
        {STARS.map(([l, t], i) => (
          <i key={i} style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 0.4}s` }} />
        ))}
      </span>
      <span className="bk-switch-knob">
        {on ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-4 h-4" />}
      </span>
    </button>
  )
}
