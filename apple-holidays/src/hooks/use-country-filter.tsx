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
  /** true when this user may switch country from the sidebar; false = locked to their assigned country */
  canFilter: boolean
  /** The values `setCountryFilter` will accept. Empty when `canFilter` is false. */
  allowedCountries: CountryFilter[]
  countryParam: string
}

const CountryFilterContext = createContext<CountryFilterContextValue>({
  countryFilter: 'ALL',
  setCountryFilter: () => {},
  canFilter: false,
  allowedCountries: [],
  countryParam: '',
})

const STORAGE_KEY = 'ah_country_filter'

/** Every value the sidebar selector can offer, in display order. */
const ALL_COUNTRY_FILTERS: CountryFilter[] = [
  'ALL', 'VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA',
]

/**
 * Roles allowed to switch country from the sidebar.
 *
 * ULTRA_SUPER_ADMIN always could. RS_USER joins it because the Reservation
 * Team works every country's hotels from one desk and needs to flip between
 * them — but the switch is only offered to a user whose *assigned* scope is
 * already every country (see `allowedCountries` below), so it can never widen
 * anyone's access. Server routes intersect with the session scope regardless.
 */
const COUNTRY_SWITCH_ROLES: UserRole[] = ['ULTRA_SUPER_ADMIN', 'RS_USER']

export function CountryFilterProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole | undefined
  const sessionCountry = session?.user?.country as OperationCountry | undefined
  const sessionCountries = session?.user?.countries as OperationCountry[] | null | undefined

  // What this user is allowed to pick between.
  //
  // A role outside the switch list gets nothing and stays locked to its
  // assigned country, exactly as before. Inside the list, the choices are the
  // user's *own* scope and never more: every country when they are assigned
  // ALL, otherwise just the ones on their multi-country assignment. 'ALL'
  // there means "all of mine" — it clears `countryParam`, and the server falls
  // back to the session scope. Someone pinned to a single country has nothing
  // to switch between, so they stay locked too.
  const allowedCountries: CountryFilter[] = (() => {
    if (role === 'ULTRA_SUPER_ADMIN') return ALL_COUNTRY_FILTERS
    if (!role || !COUNTRY_SWITCH_ROLES.includes(role)) return []
    if (!sessionCountry || sessionCountry === 'ALL') return ALL_COUNTRY_FILTERS

    const own = new Set<string>((sessionCountries ?? []).filter(c => c !== 'ALL'))
    return own.size > 1 ? ['ALL', ...ALL_COUNTRY_FILTERS.filter(c => own.has(c))] : []
  })()

  const canFilter = allowedCountries.length > 1

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

  // Users who cannot switch are locked to their session country — no override
  // possible. A stored value that is no longer allowed falls back to 'ALL'.
  const effectiveFilter: CountryFilter = canFilter
    ? (allowedCountries.includes(storedFilter) ? storedFilter : 'ALL')
    : (sessionCountry ?? 'ALL')

  const countryParam = effectiveFilter && effectiveFilter !== 'ALL'
    ? `country=${effectiveFilter}`
    : ''

  return (
    <CountryFilterContext.Provider value={{
      countryFilter: effectiveFilter,
      setCountryFilter: canFilter ? setCountryFilter : () => {},
      canFilter,
      allowedCountries,
      countryParam,
    }}>
      {children}
    </CountryFilterContext.Provider>
  )
}

export function useCountryFilter() {
  return useContext(CountryFilterContext)
}
