import Image from 'next/image'

/**
 * Branded full-screen loading state.
 *
 * Shows the Apple System Operations logo on a dark backdrop (matching the
 * logo's own dark background) with a soft pulse and a spinning ring, so every
 * loading moment across the system carries the same identity.
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
      className={`${inline ? 'w-full h-full min-h-[240px]' : 'fixed inset-0 z-[200]'} flex flex-col items-center justify-center bg-[#05070d]`}
    >
      <div className="relative flex items-center justify-center">
        {/* Spinning ring */}
        <div className="absolute w-40 h-40 rounded-full border-2 border-transparent border-t-brand-500 border-r-brand-500/40 animate-spin" />
        {/* Logo with gentle pulse */}
        <div className="animate-pulse">
          <Image
            src="/apple-system-operations.png"
            alt="Apple System Operations"
            width={150}
            height={200}
            priority
            className="w-28 h-auto object-contain drop-shadow-[0_0_25px_rgba(239,68,68,0.35)]"
          />
        </div>
      </div>
      {label && (
        <p className="mt-6 text-sm font-medium tracking-wide text-slate-400 animate-pulse">
          {label}
        </p>
      )}
    </div>
  )
}
