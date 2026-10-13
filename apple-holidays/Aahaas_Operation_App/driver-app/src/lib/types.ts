export interface Movement {
  id: string; time: string | null; timeTo: string | null; from: string | null; to: string | null
  location: string; details: string | null; serviceType: string; mealPlan: string | null
  noDriverNeeded: boolean; mine: boolean
}
export interface DayPlan {
  date: string; dayNo: number; movements: Movement[]
  hotel: { name: string; city: string; address: string | null } | null
  flights: { flightNo: string; from: string; to: string; dep: string; arr: string }[]
}
export interface Trip {
  bookingId: string; bookingRef: string; fileNo: string; country: string | null; status: string
  leadGuest: string | null; pax: { adults: number; children: number }
  startDate: string; endDate: string; mode: 'ROUND_TRIP' | 'MOVEMENTS'; vehicle: string | null
  specialNotes: string | null; days: DayPlan[]
}
export interface Progress {
  today: string
  session: { id: string; status: 'ACTIVE' | 'COMPLETED' | 'HANDED_OVER'; startedAt: string; portalSkipped: boolean; feedbackStatus: string | null; completedAt: string | null; totalKm: number } | null
  days: { id: string; date: string; status: 'STARTED' | 'ENDED'; startedAt: string; endedAt: string | null; km: number; startOdometer: number | null; endOdometer: number | null }[]
  activeDay: string | null
}
export interface Feedback { submitted: boolean; at: string | null; overall: string | null }
export interface Links { portalUrl: string; feedbackUrl: string }

export interface Home {
  today: string
  name: string
  current: null | {
    trip: Omit<Trip, 'days'>
    todayPlan: DayPlan | null
    dayIndex: number | null
    dayCount: number
    isLastDay: boolean
    progress: Progress
    feedback: Feedback
    links: Links
  }
  next: null | { bookingRef: string; fileNo: string; leadGuest: string | null; pax: { adults: number; children: number }; startDate: string; endDate: string; dayCount: number; firstMovement: Movement | null }
  upcomingCount: number
  month: { km: number; daysDriven: number; trips: number }
  alerts: { vehicleCheck: { due: boolean; daysLeft: number; rejectedNote: string | null } | null; unread: number; pendingRequests: number }
}
