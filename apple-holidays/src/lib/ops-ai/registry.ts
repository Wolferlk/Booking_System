import type { Permission } from '@/lib/rbac'
import { SERVICE_TYPE_VALUES } from '@/lib/service-types'

/**
 * OPS_AI_AGENT — capability registry.
 *
 * This file is the ONLY place a capability can be granted to the agent. The
 * executor refuses any tool name that is not a key of `OPS_TOOLS`, so adding a
 * capability is a deliberate, reviewable edit here — never something the model
 * can talk its way into.
 *
 * Deliberate omissions (do not add): booking deletion, bulk delete, cancellation,
 * status transitions, user/role management, payment confirmation, raw SQL. Those
 * are destructive or financially binding and stay behind the human UI.
 */

export type ToolKind =
  | 'READ'   // reads data, runs immediately, no confirmation
  | 'NAV'    // moves the user around the app, runs immediately, no writes
  | 'WRITE'  // mutates data — ALWAYS rendered as a confirm-gated action card

export interface OpsTool {
  name:        string
  kind:        ToolKind
  label:       string
  icon:        string   // lucide-react icon name, resolved by the action card
  /** Any-of: the user needs at least one of these to run the tool. */
  permission?: Permission[]
  description: string
  parameters:  Record<string, unknown>
}

/** Booking columns the agent may write. Everything else is rejected server-side. */
export const EDITABLE_BOOKING_FIELDS = {
  agent:              { type: 'string',  label: 'Agent name' },
  fileHandler:        { type: 'string',  label: 'File handler' },
  agentBookingId:     { type: 'string',  label: 'Agent booking ID' },
  cntlNumber:         { type: 'string',  label: 'CNTL number' },
  isNumber:           { type: 'string',  label: 'IS number' },
  dealName:           { type: 'string',  label: 'Deal name' },
  tourDestination:    { type: 'string',  label: 'Tour destination' },
  arrivalDate:        { type: 'date',    label: 'Arrival date' },
  departureDate:      { type: 'date',    label: 'Departure date' },
  paxAdults:          { type: 'int',     label: 'Adults' },
  paxChildren:        { type: 'int',     label: 'Children' },
  paxInfants:         { type: 'int',     label: 'Infants' },
  quotedTotal:        { type: 'decimal', label: 'Quoted total' },
  currency:           { type: 'string',  label: 'Currency' },
  terms:              { type: 'text',    label: 'Terms' },
  exclusions:         { type: 'text',    label: 'Exclusions' },
  policyNotes:        { type: 'text',    label: 'Policy notes' },
  clientRequest:      { type: 'text',    label: 'Client request' },
  importantNotes:     { type: 'text',    label: 'Important notes' },
  otherNote:          { type: 'text',    label: 'Other note' },
  packageIncludes:    { type: 'text',    label: 'Package includes' },
  packageExcludes:    { type: 'text',    label: 'Package excludes' },
  tips:               { type: 'text',    label: 'Tips' },
  valueAddedServices: { type: 'text',    label: 'Value added services' },
  specialOccasions:   { type: 'text',    label: 'Special occasions' },
  languagePreference: { type: 'string',  label: 'Language preference' },
  reconfirmBy:        { type: 'string',  label: 'Reconfirm by' },
  checkedBy:          { type: 'string',  label: 'Checked by' },
  chauffeurContact:   { type: 'text',    label: 'Chauffeur contact' },
  agentEmail:         { type: 'string',  label: 'Agent email' },
  agentPhone:         { type: 'string',  label: 'Agent phone' },
  agentWhatsapp:      { type: 'string',  label: 'Agent WhatsApp' },
  agentAddress:       { type: 'text',    label: 'Agent address' },
  agentCountry:       { type: 'string',  label: 'Agent country' },
  contactEmail:       { type: 'string',  label: 'Contact email' },
  contactPhone:       { type: 'string',  label: 'Contact phone' },
  contactWhatsapp:    { type: 'string',  label: 'Contact WhatsApp' },
  contactAddress:     { type: 'text',    label: 'Contact address' },
  contactCountry:     { type: 'string',  label: 'Contact country' },
  amendmentNote:      { type: 'text',    label: 'Amendment note' },
} as const

export type EditableBookingField = keyof typeof EDITABLE_BOOKING_FIELDS

/** Accommodation columns the agent may write. */
export const EDITABLE_ACCOMMODATION_FIELDS = {
  city:     { type: 'string', label: 'City' },
  hotel:    { type: 'string', label: 'Hotel' },
  checkIn:  { type: 'date',   label: 'Check-in' },
  checkOut: { type: 'date',   label: 'Check-out' },
  nights:   { type: 'int',    label: 'Nights' },
  roomType: { type: 'string', label: 'Room type' },
  mealType: { type: 'string', label: 'Meal type' },
  address:  { type: 'text',   label: 'Address' },
  contact:  { type: 'string', label: 'Contact' },
} as const

/** Agenda-item columns the agent may write. */
export const EDITABLE_AGENDA_FIELDS = {
  date:        { type: 'date',    label: 'Date' },
  location:    { type: 'text',    label: 'Location' },
  fromPoint:   { type: 'text',    label: 'From' },
  toPoint:     { type: 'text',    label: 'To' },
  details:     { type: 'text',    label: 'Details' },
  mealPlan:    { type: 'string',  label: 'Meal plan' },
  meetingTime: { type: 'string',  label: 'Meeting time' },
  timeFrom:    { type: 'string',  label: 'From time' },
  timeTo:      { type: 'string',  label: 'To time' },
  serviceType: { type: 'enum',    label: 'Service type' },
} as const

export const SERVICE_TYPES = SERVICE_TYPE_VALUES

export const BOOKING_STATUSES = [
  'DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED',
  'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS',
  'TE_REVIEWED', 'DRIVER_ALLOCATED', 'QC1_PASS', 'TICKETS_ISSUED', 'QC2_PASS',
  'MSG_SENT_CUSTOMER', 'FEEDBACK_DONE', 'COMPLETED', 'CANCELLED',
] as const

/**
 * Pages the agent is allowed to navigate to. Prefix-matched, so
 * `/dashboard/bookings` also authorises `/dashboard/bookings/IS12345`.
 */
export const NAVIGABLE_ROUTES: { path: string; label: string; hint: string }[] = [
  { path: '/dashboard',                       label: 'Dashboard',        hint: 'KPI overview and status funnel' },
  { path: '/dashboard/bookings',              label: 'All Bookings',     hint: 'Master booking list. Query: search, status, dateFilter, dateFrom, dateTo, dateField (arrivalDate|createdAt), sortBy, sortDir' },
  { path: '/dashboard/bookings/new',          label: 'New Booking',      hint: 'Create a booking from a TC document' },
  { path: '/dashboard/change-requests',       label: 'Change Requests',  hint: 'Open amendment queue' },
  { path: '/dashboard/as-bookings',           label: 'AS Bookings',      hint: 'AppleSystem bookings feed' },
  { path: '/dashboard/as-bookings-v2',        label: 'AS Bookings V2',   hint: 'AppleSystem bookings V2' },
  { path: '/dashboard/new-as-booking',        label: 'New AS Booking',   hint: 'Create an AppleSystem booking' },
  { path: '/dashboard/accounts/pnl',          label: 'P&L Management',   hint: 'Per-booking P&L lines and payment confirmation' },
  { path: '/dashboard/accounts/profit',       label: 'Profit',           hint: 'Profit analysis' },
  { path: '/dashboard/accounts/reports',      label: 'Accounts Reports', hint: 'Financial reports' },
  { path: '/dashboard/accounts/cancellations',label: 'Cancellations',    hint: 'Cancellation approval queue' },
  { path: '/dashboard/accounts/credit-agents',label: 'Credit Agents',    hint: 'Agent credit ledger' },
  { path: '/dashboard/ground/assignments',    label: 'Assignments',      hint: 'Driver/vehicle movement assignments' },
  { path: '/dashboard/ground/drivers',        label: 'Drivers',          hint: 'Driver directory' },
  { path: '/dashboard/ground/vehicles',       label: 'Vehicles',         hint: 'Vehicle directory' },
  { path: '/dashboard/ground/vendors',        label: 'Vendors',          hint: 'Transport vendor directory' },
  // { path: '/dashboard/ground/tickets',        label: 'Tickets',          hint: 'Ticket purchasing queue' },
  { path: '/dashboard/ground/review',         label: 'Ground Review',    hint: 'Ground team review queue' },
  { path: '/dashboard/ground/allocation',     label: 'Allocation',       hint: 'Vehicle allocation planner' },
  { path: '/dashboard/te/live',               label: 'Live Overview',    hint: 'Tours currently in progress' },
  { path: '/dashboard/te/analytics',          label: 'TE Analytics',     hint: 'Travel Experience analytics' },
  { path: '/dashboard/te/review',             label: 'TE Review Queue',  hint: 'Travel Experience review queue' },
  { path: '/dashboard/te/contacts',           label: 'Contact Log',      hint: 'Customer contact history' },
  { path: '/dashboard/te/reminders',          label: 'Reminders',        hint: 'Scheduled reminders' },
  { path: '/dashboard/te/payments',           label: 'Payments',         hint: 'Customer payment records' },
  // { path: '/dashboard/te/tickets',            label: 'Tickets & Vouchers',hint: 'Voucher tracking' },
  { path: '/dashboard/mc-report',             label: 'MC Report',        hint: 'Movement control report' },
  { path: '/dashboard/srilanka/driver-allocation', label: 'SL Driver Allocation', hint: 'Sri Lanka driver allocation board' },
  { path: '/dashboard/srilanka/drive-log',    label: 'SL Drive Log',     hint: 'Sri Lanka transport cost, driver advance and settlement' },
  { path: '/dashboard/admin/users',           label: 'Users',            hint: 'User administration' },
  { path: '/dashboard/admin/audit',           label: 'Audit Log',        hint: 'System activity audit trail' },
  { path: '/dashboard/admin/config',          label: 'Config',           hint: 'System settings' },
  { path: '/dashboard/admin/schedules',       label: 'Schedules',        hint: 'Automation schedules' },
  { path: '/dashboard/admin/mail-inbox',      label: 'Mail Inbox',       hint: 'Incoming mail automation' },
  { path: '/dashboard/admin/onedrive',        label: 'OneDrive',         hint: 'Drive sync status' },
  { path: '/dashboard/admin/file-handlers',   label: 'File Handlers',    hint: 'File handler accounts' },
]

export const OPS_TOOLS: Record<string, OpsTool> = {
  // ── READ ────────────────────────────────────────────────────────────────
  search_bookings: {
    name: 'search_bookings',
    kind: 'READ',
    label: 'Search bookings',
    icon: 'Search',
    permission: ['booking:read'],
    description:
      'Search bookings by free text (ref, IS number, agent, file handler, passenger name), status, and/or arrival-date range. ' +
      'Use this when the user asks "find/show/which bookings…". Returns matching rows inline.',
    parameters: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Free text: booking ref, IS number, agent name, file handler, or passenger name.' },
        status:      { type: 'string', enum: [...BOOKING_STATUSES], description: 'Restrict to one booking status.' },
        arrivalFrom: { type: 'string', description: 'Arrival date range start, YYYY-MM-DD.' },
        arrivalTo:   { type: 'string', description: 'Arrival date range end, YYYY-MM-DD. For a single day, set equal to arrivalFrom.' },
        limit:       { type: 'number', description: 'Max rows (1-25, default 10).' },
      },
      required: [],
      additionalProperties: false,
    },
  },

  read_booking: {
    name: 'read_booking',
    kind: 'READ',
    label: 'Read booking',
    icon: 'FileSearch',
    permission: ['booking:read'],
    description:
      'Load the full detail of one booking (pax, dates, agenda items with their IDs, accommodations, flights, P&L totals). ' +
      'Call this before editing a booking you do not already have in context, so you have real record IDs to work with.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference, e.g. IS23492 or VN40123.' },
      },
      required: ['bookingRef'],
      additionalProperties: false,
    },
  },

  // ── NAV ─────────────────────────────────────────────────────────────────
  open_booking: {
    name: 'open_booking',
    kind: 'NAV',
    label: 'Open booking',
    icon: 'ExternalLink',
    permission: ['booking:read'],
    description: 'Navigate the user to a specific booking detail page.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference to open.' },
      },
      required: ['bookingRef'],
      additionalProperties: false,
    },
  },

  navigate: {
    name: 'navigate',
    kind: 'NAV',
    label: 'Go to page',
    icon: 'Navigation',
    description:
      'Navigate to a system page, optionally pre-filtered via query parameters. ' +
      'Example — "bookings arriving on 1 July": path "/dashboard/bookings" with query ' +
      '{ dateFrom: "2026-07-01", dateTo: "2026-07-01", dateField: "arrivalDate" }.',
    parameters: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Route path. Must be one of the allowed routes listed in the system prompt.' },
        query: { type: 'object', description: 'Query-string parameters as a flat string map.', additionalProperties: { type: 'string' } },
        label: { type: 'string', description: 'Short human label for the button, e.g. "Bookings arriving 1 Jul 2026".' },
      },
      required: ['path', 'label'],
      additionalProperties: false,
    },
  },

  // ── WRITE ───────────────────────────────────────────────────────────────
  update_booking_field: {
    name: 'update_booking_field',
    kind: 'WRITE',
    label: 'Update booking',
    icon: 'PenLine',
    permission: ['booking:edit', 'admin:override'],
    description:
      'Change one field on one booking. Emit one call per field. ' +
      `Allowed fields: ${Object.keys(EDITABLE_BOOKING_FIELDS).join(', ')}.`,
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
        field:      { type: 'string', enum: Object.keys(EDITABLE_BOOKING_FIELDS), description: 'Field to change.' },
        value:      { type: 'string', description: 'New value. Dates as YYYY-MM-DD, numbers as plain digits. Empty string clears the field.' },
      },
      required: ['bookingRef', 'field', 'value'],
      additionalProperties: false,
    },
  },

  add_agenda_item: {
    name: 'add_agenda_item',
    kind: 'WRITE',
    label: 'Add agenda item',
    icon: 'CalendarPlus',
    permission: ['agenda:create', 'agenda:edit'],
    description:
      'Add a new movement/activity to a booking tour agenda. Give EITHER dayNumber (1 = arrival day) OR an explicit date. ' +
      'This appends — it never replaces or removes existing agenda items.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef:  { type: 'string', description: 'Booking reference.' },
        dayNumber:   { type: 'number', description: 'Tour day number, where day 1 is the arrival date. "3rd day" = 3.' },
        date:        { type: 'string', description: 'Explicit date YYYY-MM-DD. Use instead of dayNumber when the user names a date.' },
        location:    { type: 'string', description: 'Place / activity headline, e.g. "Sigiriya".' },
        details:     { type: 'string', description: 'Full description, e.g. "Full day sightseeing tour — Sigiriya Rock Fortress and Dambulla Cave Temple".' },
        fromPoint:   { type: 'string', description: 'Journey start point.' },
        toPoint:     { type: 'string', description: 'Journey end point.' },
        timeFrom:    { type: 'string', description: 'Start time HH:mm.' },
        timeTo:      { type: 'string', description: 'End time HH:mm.' },
        meetingTime: { type: 'string', description: 'Pickup / meeting time HH:mm.' },
        mealPlan:    { type: 'string', description: 'Meal plan for the day, e.g. "BB", "HB", "FB".' },
        serviceType: { type: 'string', enum: [...SERVICE_TYPES], description: 'Service type. A full-day sightseeing tour is INTERNAL_TOUR.' },
      },
      required: ['bookingRef', 'location'],
      additionalProperties: false,
    },
  },

  update_agenda_item: {
    name: 'update_agenda_item',
    kind: 'WRITE',
    label: 'Edit agenda item',
    icon: 'CalendarCog',
    permission: ['agenda:edit'],
    description:
      'Edit an existing agenda item. Requires the real agendaItemId — call read_booking first if you do not have it. ' +
      'Only the fields you pass are changed.',
    parameters: {
      type: 'object',
      properties: {
        agendaItemId: { type: 'string', description: 'Agenda item ID from read_booking.' },
        location:     { type: 'string' },
        details:      { type: 'string' },
        fromPoint:    { type: 'string' },
        toPoint:      { type: 'string' },
        timeFrom:     { type: 'string', description: 'HH:mm' },
        timeTo:       { type: 'string', description: 'HH:mm' },
        meetingTime:  { type: 'string', description: 'HH:mm' },
        mealPlan:     { type: 'string' },
        date:         { type: 'string', description: 'YYYY-MM-DD' },
        serviceType:  { type: 'string', enum: [...SERVICE_TYPES] },
      },
      required: ['agendaItemId'],
      additionalProperties: false,
    },
  },

  update_accommodation: {
    name: 'update_accommodation',
    kind: 'WRITE',
    label: 'Update accommodation',
    icon: 'BedDouble',
    permission: ['booking:edit'],
    description:
      'Edit a hotel row on a booking. Requires the real accommodationId — call read_booking first. Only passed fields change.',
    parameters: {
      type: 'object',
      properties: {
        accommodationId: { type: 'string', description: 'Accommodation ID from read_booking.' },
        hotel:    { type: 'string' },
        city:     { type: 'string' },
        roomType: { type: 'string' },
        mealType: { type: 'string' },
        checkIn:  { type: 'string', description: 'YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'YYYY-MM-DD' },
        nights:   { type: 'number' },
        address:  { type: 'string' },
        contact:  { type: 'string' },
      },
      required: ['accommodationId'],
      additionalProperties: false,
    },
  },

  assign_driver: {
    name: 'assign_driver',
    kind: 'WRITE',
    label: 'Assign driver',
    icon: 'Car',
    permission: ['assignment:create', 'assignment:edit'],
    description:
      'Attach (or replace) the driver/vehicle assignment on one agenda item. Requires the real agendaItemId. ' +
      'Does not send WhatsApp — briefings still go out from the agenda screen on save.',
    parameters: {
      type: 'object',
      properties: {
        agendaItemId: { type: 'string', description: 'Agenda item ID from read_booking.' },
        driverName:   { type: 'string' },
        driverPhone:  { type: 'string' },
        vehicleType:  { type: 'string' },
        vehiclePlate: { type: 'string' },
        vendorName:   { type: 'string' },
        notes:        { type: 'string' },
      },
      required: ['agendaItemId'],
      additionalProperties: false,
    },
  },

  create_reminder: {
    name: 'create_reminder',
    kind: 'WRITE',
    label: 'Create reminder',
    icon: 'BellPlus',
    permission: ['reminder:create'],
    description: 'Schedule a reminder against a booking for the current user.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef:  { type: 'string', description: 'Booking reference.' },
        title:       { type: 'string', description: 'Short reminder title.' },
        message:     { type: 'string', description: 'Optional longer note.' },
        scheduledAt: { type: 'string', description: 'When to fire, ISO 8601 (YYYY-MM-DDTHH:mm).' },
        type:        { type: 'string', description: 'Reminder category, e.g. FOLLOW_UP, PAYMENT, CALL.' },
      },
      required: ['bookingRef', 'title', 'scheduledAt'],
      additionalProperties: false,
    },
  },

  log_contact: {
    name: 'log_contact',
    kind: 'WRITE',
    label: 'Log contact',
    icon: 'PhoneCall',
    permission: ['contact:create'],
    description: 'Record a customer/agent contact against a booking in the contact log.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
        type:       { type: 'string', description: 'Channel: CALL, EMAIL, WHATSAPP, MEETING, OTHER.' },
        subject:    { type: 'string', description: 'What the contact was about.' },
        notes:      { type: 'string', description: 'Detail of what was discussed.' },
      },
      required: ['bookingRef', 'type', 'subject'],
      additionalProperties: false,
    },
  },

  // ── WRITE · paste-and-set child records ───────────────────────────────────
  // When the operator pastes flight / passenger / accommodation blocks, the
  // model parses each row into ONE of these calls. Emit one call per record.
  add_passenger: {
    name: 'add_passenger',
    kind: 'WRITE',
    label: 'Add passenger',
    icon: 'UserPlus',
    permission: ['booking:edit', 'booking:create', 'admin:override'],
    description:
      'Add one passenger to a booking from pasted passenger details. Emit one call per passenger. ' +
      'Set isLead:true for the lead/primary passenger only.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef:     { type: 'string', description: 'Booking reference.' },
        name:           { type: 'string', description: 'Full passenger name.' },
        type:           { type: 'string', enum: ['ADULT', 'CHILD'], description: 'ADULT or CHILD. Infants count as CHILD.' },
        age:            { type: 'number', description: 'Age in years, if given.' },
        isLead:         { type: 'boolean', description: 'True only for the lead passenger.' },
        passport:       { type: 'string', description: 'Passport number.' },
        nationality:    { type: 'string', description: 'Nationality.' },
        contact:        { type: 'string', description: 'Phone / email contact.' },
        mealPreference: { type: 'string', description: 'Meal preference, e.g. Veg, Halal.' },
      },
      required: ['bookingRef', 'name'],
      additionalProperties: false,
    },
  },

  add_flight: {
    name: 'add_flight',
    kind: 'WRITE',
    label: 'Add flight',
    icon: 'Plane',
    permission: ['booking:edit', 'booking:create', 'admin:override'],
    description:
      'Add one flight segment to a booking from pasted flight details. Emit one call per flight leg. ' +
      'Times are local, HH:mm.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
        flightNo:   { type: 'string', description: 'Flight number, e.g. VJ815.' },
        date:       { type: 'string', description: 'Flight date YYYY-MM-DD.' },
        fromApt:    { type: 'string', description: 'Departure airport code or name, e.g. SGN.' },
        depTime:    { type: 'string', description: 'Departure time HH:mm.' },
        toApt:      { type: 'string', description: 'Arrival airport code or name, e.g. HAN.' },
        arrTime:    { type: 'string', description: 'Arrival time HH:mm.' },
        airline:    { type: 'string', description: 'Airline name, e.g. VietJet.' },
        notes:      { type: 'string', description: 'Any note, e.g. baggage / terminal.' },
      },
      required: ['bookingRef', 'flightNo', 'date'],
      additionalProperties: false,
    },
  },

  add_accommodation: {
    name: 'add_accommodation',
    kind: 'WRITE',
    label: 'Add accommodation',
    icon: 'BedDouble',
    permission: ['booking:edit', 'booking:create', 'admin:override'],
    description:
      'Add one hotel stay to a booking from pasted accommodation details. Emit one call per hotel row. ' +
      'If nights is omitted it is derived from check-in/check-out.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
        city:       { type: 'string', description: 'City / area.' },
        hotel:      { type: 'string', description: 'Hotel name.' },
        checkIn:    { type: 'string', description: 'Check-in date YYYY-MM-DD.' },
        checkOut:   { type: 'string', description: 'Check-out date YYYY-MM-DD.' },
        nights:     { type: 'number', description: 'Number of nights. Optional — derived from dates when omitted.' },
        roomType:   { type: 'string', description: 'Room type, e.g. Deluxe Double.' },
        mealType:   { type: 'string', description: 'Meal plan, e.g. BB, HB, FB.' },
        address:    { type: 'string', description: 'Hotel address.' },
        contact:    { type: 'string', description: 'Hotel phone / contact.' },
      },
      required: ['bookingRef', 'city', 'hotel', 'checkIn', 'checkOut'],
      additionalProperties: false,
    },
  },

  // ── NAV · agenda (movement chart / MC) ────────────────────────────────────
  open_agenda: {
    name: 'open_agenda',
    kind: 'NAV',
    label: 'Open agenda (MC)',
    icon: 'CalendarRange',
    permission: ['booking:read'],
    description:
      'Open the tour agenda / movement chart (MC) for a booking. If the booking has no agenda yet, ' +
      'this opens the agenda page and auto-generates it first. Use when the user says "open agenda", ' +
      '"show the MC", "movement chart" for a booking.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
      },
      required: ['bookingRef'],
      additionalProperties: false,
    },
  },

  // ── READ / WRITE · AppleSystem (AS) availability + import ──────────────────
  as_check_availability: {
    name: 'as_check_availability',
    kind: 'READ',
    label: 'Check AS availability',
    icon: 'ServerCog',
    permission: ['booking:read'],
    description:
      'Check whether a booking exists and is CONFIRMED in AppleSystem (AS) by its IS number. ' +
      'Use when the user asks "is this booking available in AS?" / "check IS12345 in AppleSystem". ' +
      'Returns the AS status without importing anything.',
    parameters: {
      type: 'object',
      properties: {
        isNumber: { type: 'string', description: 'IS number to look up in AppleSystem, e.g. IS23492.' },
      },
      required: ['isNumber'],
      additionalProperties: false,
    },
  },

  as_import_booking: {
    name: 'as_import_booking',
    kind: 'WRITE',
    label: 'Import from AS',
    icon: 'DownloadCloud',
    permission: ['booking:create'],
    description:
      'Create a local booking from a CONFIRMED AppleSystem quotation, looked up by IS number. ' +
      'Idempotent — if the booking already exists it is returned as-is, never duplicated. ' +
      'Only propose this after as_check_availability shows the AS booking is confirmed/available.',
    parameters: {
      type: 'object',
      properties: {
        isNumber: { type: 'string', description: 'IS number of the confirmed AppleSystem booking to import.' },
      },
      required: ['isNumber'],
      additionalProperties: false,
    },
  },

  // ── READ · read-only SQL ──────────────────────────────────────────────────
  run_sql_query: {
    name: 'run_sql_query',
    kind: 'READ',
    label: 'Run read-only query',
    icon: 'Database',
    permission: ['booking:read'],
    description:
      'Run ONE read-only SQL SELECT against the operations database and return rows, to answer a data ' +
      'question or feed a PDF. STRICTLY read-only: a single SELECT statement only — no INSERT/UPDATE/DELETE/DDL. ' +
      'Prefer search_bookings/read_booking for ordinary lookups; use SQL for aggregates and cross-table reports. ' +
      'Always add your own WHERE/LIMIT to keep results small.',
    parameters: {
      type: 'object',
      properties: {
        sql:     { type: 'string', description: 'A single SELECT statement. No trailing semicolon needed. No comments.' },
        purpose: { type: 'string', description: 'One short line on what this query answers (shown to the user).' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },

  // ── NAV · generate + download a booking PDF ───────────────────────────────
  generate_pdf: {
    name: 'generate_pdf',
    kind: 'NAV',
    label: 'Generate booking PDF',
    icon: 'FileText',
    permission: ['booking:read'],
    description:
      'Generate and download the full booking-details PDF (passengers, flights, hotels, agenda, drivers, notes) ' +
      'for one booking. Use when the user asks to "generate a PDF" / "make the PDF" for a booking.',
    parameters: {
      type: 'object',
      properties: {
        bookingRef: { type: 'string', description: 'Booking reference.' },
      },
      required: ['bookingRef'],
      additionalProperties: false,
    },
  },
}

export const OPS_TOOL_NAMES = Object.keys(OPS_TOOLS)

/** OpenAI `tools` payload built straight from the registry. */
export function openAiToolSpecs() {
  return OPS_TOOL_NAMES.map(name => {
    const t = OPS_TOOLS[name]
    return {
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }
  })
}
