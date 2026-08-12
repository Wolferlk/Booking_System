'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * Sidebar state.
 *
 * The rail is collapsed to icons by default and expands while the pointer is
 * over it, so the dashboard gets the full width of the screen without anyone
 * having to keep clicking a toggle. Two separate notions of "open" fall out of
 * that, and keeping them apart is the whole point of this hook:
 *
 *  - `isCollapsed` — what the sidebar *looks* like right now. False while
 *    hovering, so labels appear.
 *  - `isPinned` — whether the user has deliberately locked it open. This, not
 *    the hover state, drives the page's left margin: a hover-expanded rail
 *    floats over the content instead of shoving it sideways, which would make
 *    the page jump every time the mouse crossed the edge of the screen.
 */
interface SidebarCtxType {
  /** Visual state — collapsed unless pinned or hovered. */
  isCollapsed: boolean
  /** The user's persisted preference. Drives layout, never hover. */
  isPinned: boolean
  isMobileOpen: boolean
  /** Pin open / unpin. Persisted to localStorage. */
  toggleCollapse: () => void
  setHovered: (hovered: boolean) => void
  openMobile: () => void
  closeMobile: () => void
}

const SidebarCtx = createContext<SidebarCtxType>({
  isCollapsed: true,
  isPinned: false,
  isMobileOpen: false,
  toggleCollapse: () => {},
  setHovered: () => {},
  openMobile: () => {},
  closeMobile: () => {},
})

const STORAGE_KEY = 'sidebar-pinned'

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isPinned, setIsPinned] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  // Clicking "Collapse" while the pointer is still over the rail would
  // immediately re-expand it on hover. Ignore hover until the pointer leaves.
  const hoverLocked = useRef(false)

  useEffect(() => {
    try {
      // Collapsed is the default, so only an explicit "true" opens the rail.
      // Read the legacy `sidebar-collapsed` key too, so anyone who had pinned
      // the old sidebar open keeps it that way.
      const pinned = localStorage.getItem(STORAGE_KEY)
      if (pinned !== null) { setIsPinned(pinned === 'true'); return }
      if (localStorage.getItem('sidebar-collapsed') === 'false') setIsPinned(true)
    } catch { /* private mode — fall back to the default */ }
  }, [])

  const toggleCollapse = useCallback(() => {
    setIsPinned(prev => {
      const next = !prev
      if (!next) {
        // Unpinning: collapse now rather than waiting for the pointer to leave.
        hoverLocked.current = true
        setIsHovered(false)
      }
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const setHovered = useCallback((hovered: boolean) => {
    if (!hovered) {
      hoverLocked.current = false
      setIsHovered(false)
      return
    }
    if (hoverLocked.current) return
    setIsHovered(true)
  }, [])

  const openMobile = useCallback(() => setIsMobileOpen(true), [])
  const closeMobile = useCallback(() => setIsMobileOpen(false), [])

  return (
    <SidebarCtx.Provider
      value={{
        isCollapsed: !isPinned && !isHovered,
        isPinned,
        isMobileOpen,
        toggleCollapse,
        setHovered,
        openMobile,
        closeMobile,
      }}
    >
      {children}
    </SidebarCtx.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarCtx)
}
