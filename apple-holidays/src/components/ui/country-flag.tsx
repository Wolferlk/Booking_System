import { Globe } from 'lucide-react'

interface CountryFlagProps {
  country: string | null | undefined
  className?: string
}

const FLAG_MAP: Record<string, string> = {
  VIETNAM: '🇻🇳',
  SRILANKA: '🇱🇰',
  SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾',
}

export function CountryFlag({ country, className = 'w-5 h-4' }: CountryFlagProps) {
  switch (country) {
    case 'VIETNAM':
      return <span className={className} role="img" aria-label="Vietnam">{FLAG_MAP.VIETNAM}</span>
    case 'SRILANKA':
      return <span className={className} role="img" aria-label="Sri Lanka">{FLAG_MAP.SRILANKA}</span>
    case 'SINGAPORE':
      return <span className={className} role="img" aria-label="Singapore">{FLAG_MAP.SINGAPORE}</span>
    case 'MALAYSIA':
      return <span className={className} role="img" aria-label="Malaysia">{FLAG_MAP.MALAYSIA}</span>
    case 'SINGAPORE_MALAYSIA':
      return (
        <span className="inline-flex gap-0.5">
          <span className={className} role="img" aria-label="Singapore">{FLAG_MAP.SINGAPORE}</span>
          <span className={className} role="img" aria-label="Malaysia">{FLAG_MAP.MALAYSIA}</span>
        </span>
      )
    default:
      return <Globe className={`text-white ${className}`} />
  }
}
