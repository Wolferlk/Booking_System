'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { OperationCountry } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

// SINGAPORE and MALAYSIA are now first-class stored operationCountry values.
// SINGAPORE_MALAYSIA remains as the legacy combined value.
export type CountryFilter = OperationCountry | 'ALL'

interface CountryFilterContextValue {
  countryFilter: CountryFilter
  setCountryFilter: (c: CountryFilter) => void
  /** true only for ULTRA_SUPER_ADMIN — all other roles are locked to their assigned country */
  canFilter: boolean
  countryParam: string
}

const CountryFilterContext = createContext<CountryFilterContextValue>({
  countryFilter: 'ALL',
  setCountryFilter: () => {},
  canFilter: false,
  countryParam: '',
})

const STORAGE_KEY = 'ah_country_filter'

export function CountryFilterProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const sessionCountry = session?.user?.country as OperationCountry | undefined

  // Only ULTRA_SUPER_ADMIN can switch countries — all other roles are locked to their session country
  const canFilter = role === 'ULTRA_SUPER_ADMIN'

  const [storedFilter, setStoredFilter] = useState<CountryFilter>('ALL')

  // Load persisted selection from localStorage (Ultra admin only)
  useEffect(() => {
    if (!canFilter) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as CountryFilter | null
      if (stored) setStoredFilter(stored)
    } catch {}
  }, [canFilter])

  const setCountryFilter = (c: CountryFilter) => {
    setStoredFilter(c)
    try { localStorage.setItem(STORAGE_KEY, c) } catch {}
  }

  // All non-ultra users are locked to their session country — no override possible
  const effectiveFilter: CountryFilter = canFilter
    ? storedFilter
    : (sessionCountry ?? 'ALL')

  const countryParam = effectiveFilter && effectiveFilter !== 'ALL'
    ? `country=${effectiveFilter}`
    : ''

  return (
    <CountryFilterContext.Provider value={{
      countryFilter: effectiveFilter,
      setCountryFilter: canFilter ? setCountryFilter : () => {},
      canFilter,
      countryParam,
    }}>
      {children}
    </CountryFilterContext.Provider>
  )
}

export function useCountryFilter() {
  return useContext(CountryFilterContext)
}
