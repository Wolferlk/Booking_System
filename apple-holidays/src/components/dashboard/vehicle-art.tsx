'use client'

/**
 * Vehicle art — the fleet drawn, not listed.
 *
 * The ground desk thinks in vehicle classes: a van is a different problem from a
 * 45-seat coach, and "3 van / 1 coach" is read instantly as a shape when it is
 * drawn and slowly when it is spelled. These are inline SVGs rather than image
 * files on purpose — they inherit the accent colour of whatever card they sit
 * in, cost no request, and stay crisp at any size.
 *
 * Each is a side elevation on the same 120×56 grid so a row of mixed classes
 * lines up on one road.
 */

import type { VehicleKind } from '@/lib/ops-geo'
import { cn } from '@/lib/utils'

interface Props {
  kind: VehicleKind | string
  className?: string
  /** Spins the wheels and rocks the body — used for "on the road right now". */
  moving?: boolean
  hex?: string
}

const BODY: Record<string, { body: string; glass: string; wheels: [number, number]; r: number }> = {
  car: {
    body: 'M8 40 L14 40 C16 30 22 24 34 23 L58 22 C68 22 78 26 86 32 L104 35 C110 36 112 38 112 40 L112 43 L8 43 Z',
    glass: 'M30 27 L38 27 L38 33 L26 33 Z M44 27 L58 26 C66 27 74 30 80 34 L44 34 Z',
    wheels: [30, 92], r: 8,
  },
  suv: {
    body: 'M6 40 L10 40 C11 27 18 19 32 18 L70 17 C82 17 92 22 100 30 L108 33 C113 34 114 36 114 39 L114 43 L6 43 Z',
    glass: 'M28 22 L40 22 L40 31 L22 31 Z M46 22 L66 21 C76 22 84 25 90 31 L46 31 Z',
    wheels: [30, 94], r: 9,
  },
  van: {
    body: 'M6 40 L8 40 C8 22 14 14 28 13 L84 13 C96 13 104 20 110 30 L113 35 C115 36 116 38 116 40 L116 43 L6 43 Z',
    glass: 'M20 19 L44 19 L44 30 L16 30 Z M50 19 L80 19 L86 30 L50 30 Z',
    wheels: [30, 96], r: 8,
  },
  minibus: {
    body: 'M4 40 L4 16 C4 12 7 10 12 10 L96 10 C106 10 112 16 116 26 L118 36 C119 38 118 43 116 43 L4 43 Z',
    glass: 'M12 16 L34 16 L34 28 L12 28 Z M40 16 L62 16 L62 28 L40 28 Z M68 16 L92 16 L98 28 L68 28 Z',
    wheels: [28, 98], r: 8,
  },
  bus: {
    body: 'M3 43 L3 12 C3 9 5 7 9 7 L112 7 C116 7 118 9 118 13 L118 43 Z',
    glass: 'M10 13 L32 13 L32 26 L10 26 Z M38 13 L60 13 L60 26 L38 26 Z M66 13 L88 13 L88 26 L66 26 Z M94 13 L112 13 L112 26 L94 26 Z',
    wheels: [26, 100], r: 9,
  },
  coach: {
    body: 'M2 43 L2 10 C2 7 4 5 9 5 L114 5 C118 5 120 8 120 12 L120 43 Z',
    glass: 'M9 12 L30 12 L30 24 L9 24 Z M35 12 L56 12 L56 24 L35 24 Z M61 12 L82 12 L82 24 L61 24 Z M87 12 L113 12 L113 24 L87 24 Z',
    wheels: [26, 102], r: 9,
  },
}

BODY.other = BODY.van

export default function VehicleArt({ kind, className, moving, hex = '#facc15' }: Props) {
  const art = BODY[kind] ?? BODY.other
  return (
    <svg
      viewBox="0 0 124 56"
      className={cn('w-full h-auto', className)}
      role="img"
      aria-label={`${kind} illustration`}
    >
      {/* Road shadow — gives the body something to sit on rather than float over. */}
      <ellipse cx="62" cy="50" rx="52" ry="3.4" fill="currentColor" opacity="0.16" />

      <g className={moving ? 'va-body' : undefined}>
        <path d={art.body} fill={hex} opacity="0.95" />
        <path d={art.body} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1.2" />
        <path d={art.glass} fill="#0b1220" opacity="0.62" />
      </g>

      {art.wheels.map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy={44} r={art.r} fill="#0f172a" />
          <circle cx={cx} cy={44} r={art.r * 0.45} fill="#94a3b8" className={moving ? 'va-wheel' : undefined}
            style={{ transformOrigin: `${cx}px 44px` }} />
          <rect x={cx - 0.7} y={44 - art.r * 0.45} width="1.4" height={art.r * 0.9} fill="#0f172a"
            className={moving ? 'va-wheel' : undefined} style={{ transformOrigin: `${cx}px 44px` }} />
        </g>
      ))}

      <style>{`
        @keyframes vaSpin{to{transform:rotate(360deg)}}
        @keyframes vaRock{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.9px)}}
        .va-wheel{animation:vaSpin 1.1s linear infinite}
        .va-body{animation:vaRock 1.1s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){
          .va-wheel,.va-body{animation:none}
        }
      `}</style>
    </svg>
  )
}
