import { VN, LK, SG, MY } from 'country-flag-icons/react/3x2'
import * as AllFlags from 'country-flag-icons/react/3x2'
import { Globe } from 'lucide-react'
import type { ComponentType } from 'react'

interface CountryFlagProps {
  country: string | null | undefined
  className?: string
}

/**
 * Renders a country flag as an inline SVG — works on all platforms including
 * Windows, which does not render regional-indicator emoji (🇻🇳, 🇱🇰, etc.).
 */
export function CountryFlag({ country, className = 'w-5 h-4' }: CountryFlagProps) {
  switch (country) {
    case 'VIETNAM':
      return <VN className={className} title="Vietnam" />
    case 'SRILANKA':
      return <LK className={className} title="Sri Lanka" />
    case 'SINGAPORE':
      return <SG className={className} title="Singapore" />
    case 'MALAYSIA':
      return <MY className={className} title="Malaysia" />
    case 'SINGAPORE_MALAYSIA':
      // Apply the sizing className to the wrapper and split the width between the
      // two flags so this works even when className only sets width (not font-size).
      return (
        <span className={`inline-flex items-center justify-center gap-0.5 ${className}`}>
          <SG className="w-1/2 h-auto rounded-[1px]" title="Singapore" />
          <MY className="w-1/2 h-auto rounded-[1px]" title="Malaysia" />
        </span>
      )
    default:
      return <Globe className="text-white"  />
  }
}

interface FlagByCodeProps {
  /** ISO 3166-1 alpha-2 country code, e.g. "IN", "GB", "AE" */
  code: string | null | undefined
  className?: string
  title?: string
}

/**
 * Renders the flag for any ISO alpha-2 country code as an inline SVG (works on
 * Windows, which does not render regional-indicator emoji). Falls back to a
 * globe icon when the code is missing or unrecognised.
 */
export function FlagByCode({ code, className = 'w-5 h-4', title }: FlagByCodeProps) {
  const iso = (code ?? '').trim().toUpperCase()
  const Flag = /^[A-Z]{2}$/.test(iso)
    ? (AllFlags as Record<string, ComponentType<{ className?: string; title?: string }>>)[iso]
    : undefined
  if (!Flag) return <Globe className={className} />
  return <Flag className={className} title={title ?? iso} />
}
