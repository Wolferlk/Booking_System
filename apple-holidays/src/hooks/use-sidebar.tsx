'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface SidebarCtxType {
  isCollapsed: boolean
  isMobileOpen: boolean
  toggleCollapse: () => void
  openMobile: () => void
  closeMobile: () => void
}

const SidebarCtx = createContext<SidebarCtxType>({
  isCollapsed: false,
  isMobileOpen: false,
  toggleCollapse: () => {},
  openMobile: () => {},
  closeMobile: () => {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      if (saved === 'true') setIsCollapsed(true)
    } catch {}
  }, [])

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }, [])

  const openMobile = useCallback(() => setIsMobileOpen(true), [])
  const closeMobile = useCallback(() => setIsMobileOpen(false), [])

  return (
    <SidebarCtx.Provider value={{ isCollapsed, isMobileOpen, toggleCollapse, openMobile, closeMobile }}>
      {children}
    </SidebarCtx.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarCtx)
}
