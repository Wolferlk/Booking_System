'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { OperationCountry } from '@/lib/country-detection'
import { canSeeAllCountries } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

type CountryFilter = OperationCountry | 'ALL'

interface CountryFilterContextValue {
  countryFilter: CountryFilter
  setCountryFilter: (c: CountryFilter) => void
  // true only for users who can choose a different country
  canFilter: boolean
  // the param string to append to fetch URLs — '' if no filter needed
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
  const sessionCountry = (session?.user as any)?.country as OperationCountry | undefined

  // Determine if this user can switch countries
  const canFilter = !!(role && canSeeAllCountries(role, sessionCountry ?? 'ALL'))

  // Initialise from localStorage (only for admins); scoped users always see their own country
  const [countryFilter, setCountryFilterState] = useState<CountryFilter>('ALL')

  useEffect(() => {
    if (!canFilter) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as CountryFilter | null
      if (stored) setCountryFilterState(stored)
    } catch {}
  }, [canFilter])

  const setCountryFilter = (c: CountryFilter) => {
    setCountryFilterState(c)
    try { localStorage.setItem(STORAGE_KEY, c) } catch {}
  }

  // For country-scoped users, effective filter is always their session country
  const effectiveFilter: CountryFilter = canFilter
    ? countryFilter
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
