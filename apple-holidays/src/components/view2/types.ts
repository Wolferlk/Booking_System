/** Shapes of the feeds the Command Center (/view2) reads. Mirror the routes. */

/** /api/public/view-dashboard — the same feed as /view. */
export interface LiveBooking {
  id: string; bookingRef: string; agent: string | null; operationCountry: string | null
  paxAdults: number; paxChildren: number; arrivalDate: string; departureDate: string; createdAt: string
}
export interface ViewData {
  generatedAt: string
  totals: {
    totalBookings: number; ongoingToday: number; upcoming: number; paxOnTour: number
    arrivalFlightsToday: number; flightsToday: number
    createdToday: number; createdTodayPax: number; createdYesterdayToNow: number
  }
  byCountry: {
    ongoing: Record<string, number>; upcoming: Record<string, number>
    lifetime: Record<string, number>; createdToday: Record<string, number>
  }
  createdTodayByHour: number[]
  lastCreatedAt: string | null
  recentBookings: LiveBooking[]
}

/** /api/public/view2 */
export interface CompareRow { key: string; label: string; yesterday: number; yesterdaySoFar: number; today: number }
export interface HourRow { hour: number; bookings: number; actions: number; agendas: number; drivers: number }
export interface PipelineRow { status: string; label: string; wip: number; movedToday: number }
export interface LeaderRow { name: string; role: string | null; actions: number; created: number; total: number; topStage: string | null }
export interface FeedItem { id: string; kind: 'status' | 'booking' | 'agenda' | 'driver' | 'cancel' | string; at: string; title: string; sub: string; country: string | null }
export interface FeedbackItem {
  id: string; source: 'guest_form' | 'post_tour' | 'on_tour_call'; at: string; bookingRef: string | null
  country: string | null; stars: number | null; sentiment: string | null; text: string; who: string | null
}
export interface MapCity { name: string; lat: number; lng: number; country: string | null; groups: number; pax: number; arriving: number }
export interface MapLeg { from: { name: string; lat: number; lng: number }; to: { name: string; lat: number; lng: number }; groups: number; country: string | null }
export interface MapFlight {
  id: string; flightNo: string; airline: string | null; depTime: string | null; arrTime: string | null
  from: { iata: string; city: string; lat: number; lng: number }
  to: { iata: string; city: string; lat: number; lng: number }
  pax: number; country: string | null; phase: 'scheduled' | 'airborne' | 'landed' | 'unknown'; progress: number
}
export interface View2Data {
  generatedAt: string; tz: string; today: string
  compare: CompareRow[]
  hourly: HourRow[]
  pipeline: PipelineRow[]
  leaderboard: LeaderRow[]
  trend: { date: string; received: number; confirmed: number }[]
  ahead: { date: string; arrivals: number; pax: number; byCountry: Record<string, number> }[]
  feed: FeedItem[]
  feedback: {
    items: FeedbackItem[]
    stats: { count30: number; avgStars: number | null; ratedCount: number; recommendPct: number | null; sentiment: Record<string, number> }
  }
  ops: {
    movementsToday: number; movementsNeedingDriver: number; unassignedMovements: number
    driversOnRoad: number; vehiclesOnRoad: number; actionsToday: number; activeStaffToday: number
  }
  map: { cities: MapCity[]; legs: MapLeg[]; flights: MapFlight[]; countries: Record<string, { groups: number; pax: number; pinned: number }> }
}

/** /api/public/view2/forecast */
export interface ForecastData {
  generatedAt: string
  source: 'openai' | 'baseline'
  model: string | null
  headline: string
  insights: string[]
  confidence: 'low' | 'medium' | 'high'
  nextWeekTotal: number
  lastWeekTotal: number
  history: { date: string; received: number; confirmed: number }[]
  forecast: { date: string; weekday: string; bookings: number; low: number; high: number }[]
  ahead: { date: string; arrivals: number }[]
}

/** /api/public/te-alerts */
export interface TEAlert {
  id: number; booking_ref: string | null; customer_name: string | null
  call_kind: string | null; category: string | null; severity: string | null
  title: string | null; details: string | null; customer_quote: string | null; at: string | null
}

/** /api/public/filehandler-events */
export interface FHEvent {
  id: string; action: 'FLIGHT_ADDED' | 'FLIGHT_UPDATED' | 'CANCEL_REQUESTED'
  fileHandlerName: string; bookingRef: string | null; isNumber: string | null
  operationCountry: string | null; details: string | null; createdAt: string
}
