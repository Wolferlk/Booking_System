'use client'

import { cn } from '@/lib/utils'
import { LIFECYCLE_STEPS, getCurrentStep, STATUS_LABELS } from '@/lib/state-machine'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import type { BookingStatus } from '@prisma/client'

interface BookingLifecycleProps {
  status: BookingStatus
  className?: string
}

export default function BookingLifecycle({ status, className }: BookingLifecycleProps) {
  if (status === 'CANCELLED') {
    return (
      <div className={cn('flex items-center gap-2 text-red-600', className)}>
        <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
        <span className="text-sm font-medium">Booking Cancelled</span>
      </div>
    )
  }

  const currentStep = getCurrentStep(status)
  const visibleSteps = LIFECYCLE_STEPS.filter(s => !s.hidden)

  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="flex items-center gap-0 min-w-max">
        {visibleSteps.map((step, idx) => {
          const isCompleted = step.step < currentStep
          const isCurrent = step.step === currentStep
          const isUpcoming = step.step > currentStep

          return (
            <div key={step.status} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all',
                    isCompleted && 'bg-brand-500 border-brand-500 text-white',
                    isCurrent && 'bg-white border-brand-500 text-brand-600 ring-4 ring-brand-100',
                    isUpcoming && 'bg-white border-slate-200 text-slate-300',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isCurrent ? (
                    <Clock className="w-4 h-4" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium text-center max-w-[64px] leading-tight',
                    isCompleted && 'text-brand-600',
                    isCurrent && 'text-brand-700 font-semibold',
                    isUpcoming && 'text-slate-400',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {idx < visibleSteps.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 w-8 mx-1 mb-4 rounded',
                    step.step < currentStep ? 'bg-brand-500' : 'bg-slate-200',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
