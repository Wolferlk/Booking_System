import { cn } from '@/lib/utils'
import { STATUS_LABELS, getDisplayStatus } from '@/lib/state-machine'
import type { BookingStatus } from '@prisma/client'

type Color = 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'gray' | 'orange' | 'teal' | 'indigo' | 'amber'

const colorClasses: Record<Color, string> = {
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
  gray: 'bg-gray-100 text-gray-600',
  orange: 'bg-orange-100 text-orange-700',
  teal: 'bg-teal-100 text-teal-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-700',
}

interface BadgeProps {
  children: React.ReactNode
  color?: Color
  className?: string
  dot?: boolean
}

export function Badge({ children, color = 'gray', className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold',
        colorClasses[color],
        className,
      )}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {children}
    </span>
  )
}

/**
 * Status pill. Pass `departureDate` (and `hasCustomerReview` when known) to opt
 * the badge into the post-travel rule: once the trip is over it reads
 * "Trip Completed & Pending Customer Review", and "Trip Completed" after the
 * guest feedback form is filled. Without `departureDate` the stored status is
 * rendered exactly as before.
 */
export function StatusBadge({
  status,
  className,
  departureDate,
  hasCustomerReview,
}: {
  status: BookingStatus
  className?: string
  departureDate?: Date | string | null
  hasCustomerReview?: boolean
}) {
  const view = getDisplayStatus(status, departureDate, hasCustomerReview ?? false)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold',
        view.color,
        className
      )}
      title={view.derived ? `Workflow status: ${STATUS_LABELS[status] ?? status}` : undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {view.label}
    </span>
  )
}
