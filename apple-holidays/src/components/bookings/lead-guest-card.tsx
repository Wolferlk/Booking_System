'use client'

/**
 * The lead passenger, given the weight of a name rather than a table row —
 * it is who every call, message and voucher on this page is addressed to.
 *
 * Falls back to the first passenger when none is flagged lead, and renders
 * nothing when the file has no passengers yet.
 */

import { Crown, Globe, Users, Baby, User } from 'lucide-react'
import { getInitials } from '@/lib/utils'

interface Pax {
  name?: string | null
  type?: string | null
  age?: number | null
  isLead?: boolean | null
  nationality?: string | null
}

const TYPE_LABEL: Record<string, string> = { ADULT: 'Adult', CHILD: 'Child', INFANT: 'Infant' }

export default function LeadGuestCard({ passengers }: { passengers: Pax[] }) {
  const named = passengers.filter(p => (p.name ?? '').trim())
  const lead = named.find(p => p.isLead) ?? named[0]
  if (!lead) return null

  const flagged = Boolean(lead.isLead)
  const others = named.filter(p => p !== lead)
  const name = String(lead.name).trim()
  const TypeIcon = lead.type === 'CHILD' || lead.type === 'INFANT' ? Baby : User

  return (
    <div className="bk-lead mb-3 flex items-center gap-4">
      <div className="bk-lead-avatar" aria-hidden>
        {getInitials(name) || '?'}
        {flagged && <span className="bk-lead-crown"><Crown className="w-3 h-3" /></span>}
      </div>

      <div className="min-w-0 flex-1">
        <p className="bk-lead-eyebrow">
          <Crown className="w-3 h-3 text-amber-500" />
          {flagged ? 'Lead passenger' : 'Passenger'}
        </p>
        <p className="bk-lead-name truncate" title={name}>{name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {lead.type && (
            <span className="bk-lead-pill">
              <TypeIcon className="w-3 h-3" />
              {TYPE_LABEL[lead.type] ?? lead.type}{lead.age ? ` · ${lead.age}y` : ''}
            </span>
          )}
          {lead.nationality && (
            <span className="bk-lead-pill"><Globe className="w-3 h-3" /> {lead.nationality}</span>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <div className="hidden sm:flex flex-col items-end gap-1 flex-shrink-0">
          <div className="bk-lead-companions" title={others.map(o => o.name).join(', ')}>
            {others.slice(0, 4).map((o, i) => <span key={i}>{getInitials(String(o.name))}</span>)}
            {others.length > 4 && <span>+{others.length - 4}</span>}
          </div>
          <p className="bk-lead-meta text-[11px] font-medium flex items-center gap-1">
            <Users className="w-3 h-3" /> +{others.length} travelling with them
          </p>
        </div>
      )}
    </div>
  )
}
