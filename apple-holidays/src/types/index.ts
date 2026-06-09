import type {
  User,
  Booking,
  Passenger,
  Flight,
  Accommodation,
  ItineraryItem,
  TourAgenda,
  AgendaItem,
  Assignment,
  Ticket,
  PNL,
  PNLLineItem,
  Payment,
  ChangeRequest,
  StatusEvent,
  ContactLog,
  Reminder,
  Driver,
  Vehicle,
  BookingVersion,
  EmergencyContact,
} from '@prisma/client'

export type {
  User,
  Booking,
  Passenger,
  Flight,
  Accommodation,
  ItineraryItem,
  TourAgenda,
  AgendaItem,
  Assignment,
  Ticket,
  PNL,
  PNLLineItem,
  Payment,
  ChangeRequest,
  StatusEvent,
  ContactLog,
  Reminder,
  Driver,
  Vehicle,
  BookingVersion,
  EmergencyContact,
}

// ─── Extended types ─────────────────────────────────────────────────────

export type BookingWithRelations = Booking & {
  passengers: Passenger[]
  flights: Flight[]
  accommodations: Accommodation[]
  itineraryItems: ItineraryItem[]
  tourAgenda: (TourAgenda & { items: (AgendaItem & { assignment: Assignment | null })[] }) | null
  pnl: (PNL & { lineItems: PNLLineItem[] }) | null
  payments: Payment[]
  changeRequests: (ChangeRequest & { raisedBy: Pick<User, 'id' | 'name' | 'role'> })[]
  statusEvents: (StatusEvent & { actor: Pick<User, 'id' | 'name' | 'role'> })[]
  createdBy: Pick<User, 'id' | 'name' | 'role'>
  emergencyContacts: EmergencyContact[]
  tickets: Ticket[]
  versions: BookingVersion[]
}

export type PNLLineItemWithTotal = PNLLineItem & {
  totalCost: number
}

export type PNLWithTotals = PNL & {
  lineItems: PNLLineItemWithTotal[]
  totalRevenue: number
  totalCost: number
  profit: number
  margin: number
}

export type DashboardStats = {
  totalBookings: number
  activeBookings: number
  pendingReview: number
  awaitingPayment: number
  upcomingTrips: number
  totalRevenue: number
  totalProfit: number
  byStatus: Record<string, number>
}

export type SessionUser = {
  id: string
  email: string
  name: string
  role: string
  avatar?: string | null
}

// ─── API response types ─────────────────────────────────────────────────

export type ApiResponse<T = unknown> = {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// ─── Form types ─────────────────────────────────────────────────────────

export type BookingFormData = {
  bookingRef: string
  agentBookingId?: string
  agent?: string
  fileHandler?: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: number
  currency: string
  terms?: string
  exclusions?: string
  policyNotes?: string
  amendmentNote?: string
  passengers: {
    name: string
    type: 'ADULT' | 'CHILD'
    age?: number
    isLead: boolean
    passport?: string
    nationality?: string
    contact?: string
  }[]
  flights: {
    flightNo: string
    date: string
    fromApt: string
    depTime: string
    toApt: string
    arrTime: string
    airline?: string
  }[]
  accommodations: {
    city: string
    hotel: string
    checkIn: string
    checkOut: string
    address?: string
    contact?: string
    nights: number
    roomType?: string
    mealType?: string
  }[]
  itineraryItems: {
    dayNo: number
    date: string
    title: string
    description?: string
    inclusions?: string[]
    exclusions?: string[]
  }[]
  emergencyContacts: {
    name: string
    phone?: string
    role?: string
  }[]
}

export type AgendaItemFormData = {
  date: string
  location: string
  fromPoint?: string
  toPoint?: string
  details?: string
  mealPlan?: string
  meetingTime?: string
  serviceType: 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'
}

export type PNLLineFormData = {
  activity: string
  category: string
  mmtRate: number
  sicRate: number
  pvtRatePP: number
  adEntrance: number
  chEntrance: number
  otherRate: number
  notes?: string
}
