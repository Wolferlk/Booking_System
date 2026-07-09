// Sri Lanka-specific deterministic defaults applied to auto-generated agenda movements.
// Runs after AI/skeleton generation, both on automatic (email/OneDrive) and manual (AI Generate button) paths.

const AIRPORT_ROAD_RE = /\b(airport|terminal|arr\.|dep\.|arrival|departure)\b/i
const MOVEMENT_TYPES = new Set(['PVT_TRANSFER', 'SIC_TRANSFER'])

interface SriLankaAgendaItem {
  serviceType: string
  meetingTime?: string | null
  fromPoint?: string | null
  toPoint?: string | null
  mealPlan?: string | null
}

function isHotelToHotelTransfer(item: SriLankaAgendaItem): boolean {
  if (!MOVEMENT_TYPES.has(item.serviceType)) return false
  const from = item.fromPoint ?? ''
  const to = item.toPoint ?? ''
  if (!from.trim() || !to.trim()) return false
  if (AIRPORT_ROAD_RE.test(from) || AIRPORT_ROAD_RE.test(to)) return false
  return true
}

export function applySriLankaMovementDefaults<T extends SriLankaAgendaItem>(items: T[]): T[] {
  return items.map(item => {
    let meetingTime = item.meetingTime
    let mealPlan = item.mealPlan

    if (MOVEMENT_TYPES.has(item.serviceType) && (!meetingTime || !meetingTime.trim())) {
      meetingTime = isHotelToHotelTransfer(item) ? '12:00' : '09:00'
    }

    if (item.serviceType === 'SIC_TRANSFER') {
      if (!mealPlan || !mealPlan.trim()) {
        mealPlan = '(Lunch)'
      } else if (!/lunch/i.test(mealPlan)) {
        mealPlan = `${mealPlan.trim()} (Lunch)`
      }
    }

    return { ...item, meetingTime, mealPlan }
  })
}
