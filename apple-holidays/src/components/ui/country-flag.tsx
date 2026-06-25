import VN from 'country-flag-icons/react/3x2/VN'
import LK from 'country-flag-icons/react/3x2/LK'
import SG from 'country-flag-icons/react/3x2/SG'
import MY from 'country-flag-icons/react/3x2/MY'
import { Globe } from 'lucide-react'

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
      return (
        <span className="inline-flex gap-0.5">
          <SG className={className} title="Singapore" />
          <MY className={className} title="Malaysia" />
        </span>
      )
    default:
      return <Globe className="text-white"  />
  }
}
