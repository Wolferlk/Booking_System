import Image from 'next/image'

import { APP_LOGO } from '@/lib/brand'

/**
 * Inline branded spinner — the logo pulsing inside a spinning ring.
 *
 * Drop-in replacement for a bare `<Loader2 className="animate-spin" />` in
 * loading states that occupy a card, panel or table body.
 */
export default function LogoSpinner({
  size = 48,
  label,
  className = '',
}: {
  size?: number
  label?: string
  className?: string
}) {
  const ring = Math.round(size * 1.5)

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative flex items-center justify-center" style={{ width: ring, height: ring }}>
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 border-r-red-500/40 animate-spin" />
        <Image
          src={APP_LOGO}
          alt=""
          width={size}
          height={size}
          className="object-contain animate-pulse"
          style={{ width: size, height: size }}
        />
      </div>
      {label && <p className="text-sm text-slate-500">{label}</p>}
    </div>
  )
}
