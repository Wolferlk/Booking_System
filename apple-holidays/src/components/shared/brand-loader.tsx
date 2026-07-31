import Image from 'next/image'

import { APP_LOGO } from '@/lib/brand'

/**
 * Branded full-screen loading state.
 *
 * Shows the Apple Holidays logo with a soft pulse inside a spinning ring, so
 * every loading moment across the system carries the same identity.
 *
 * Use <BrandLoader /> as a route-level `loading.tsx` fallback, or
 * <BrandLoader inline /> to fill a container instead of the whole viewport.
 */
export default function BrandLoader({
  inline = false,
  label = 'Loading…',
}: {
  inline?: boolean
  label?: string
}) {
  return (
    <div
      className={`${inline ? 'w-full h-full min-h-[240px]' : 'fixed inset-0 z-[200]'} flex flex-col items-center justify-center bg-slate-50`}
    >
      <div className="relative flex items-center justify-center">
        {/* Spinning ring */}
        <div className="absolute w-40 h-40 rounded-full border-2 border-transparent border-t-red-500 border-r-red-500/40 animate-spin" />
        {/* Logo with gentle pulse */}
        <div className="animate-pulse">
          <Image
            src={APP_LOGO}
            alt="Apple Holidays"
            width={150}
            height={150}
            priority
            className="w-24 h-24 object-contain drop-shadow-[0_0_25px_rgba(239,68,68,0.35)]"
          />
        </div>
      </div>
      {label && (
        <p className="mt-6 text-sm font-medium tracking-wide text-slate-500 animate-pulse">
          {label}
        </p>
      )}
    </div>
  )
}
