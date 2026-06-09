import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  onClick?: () => void
}

export function Card({ children, className, hover, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white rounded-xl border border-slate-200 shadow-card',
        hover && 'hover:shadow-card-hover transition-shadow cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  children,
  className,
  action,
}: {
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
}) {
  return (
    <div className={cn('flex items-center justify-between px-6 py-4 border-b border-slate-100', className)}>
      <div className="flex-1">{children}</div>
      {action && <div className="ml-4 flex-shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-6 py-4', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl', className)}>
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  icon?: React.ReactNode
  trend?: { value: number; label: string }
  color?: 'blue' | 'green' | 'yellow' | 'purple' | 'red' | 'orange'
  className?: string
}

const statColors = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  yellow: 'bg-brand-50 text-brand-600',
  purple: 'bg-purple-50 text-purple-600',
  red: 'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
}

export function StatCard({ label, value, icon, trend, color = 'blue', className }: StatCardProps) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
          {trend && (
            <p className={cn('text-xs mt-2', trend.value >= 0 ? 'text-green-600' : 'text-red-600')}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        {icon && (
          <div className={cn('p-3 rounded-xl', statColors[color])}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}
