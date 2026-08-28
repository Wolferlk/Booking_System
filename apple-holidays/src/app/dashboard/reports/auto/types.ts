/** Shapes returned by `/api/reports/auto`, shared by the page and its panels. */
import type { ReportPeriod } from '@/lib/reports/report-window'
import type { ReportType } from '@/lib/reports/report-schedules'

export type { ReportPeriod, ReportType }

export interface ScheduleSections {
  // Operations report
  created: boolean
  onGround: boolean
  readiness: boolean
  reconfirm: boolean
  complaints: boolean
  upcoming: boolean
  // Reconciliation report
  asStatus: boolean
  opsIntake: boolean
  accountsOutput: boolean
  countCheck: boolean
  detail: boolean
  b2c: boolean
}

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  reportType: ReportType
  period: ReportPeriod
  hour: number
  minute: number
  timezone: string
  dayOfWeek: number
  dayOfMonth: number
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  subjectPrefix: string | null
  countries: string[]
  sections: ScheduleSections
  attachCsv: boolean
  aiSummary: boolean
  skipIfEmpty: boolean
  maxRows: number
  createdAt: string
  updatedAt: string
  createdBy: string | null
  lastRunKey: string | null
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'skipped' | null
  lastError: string | null
  lastRecipients: number | null
  // Derived server-side
  cadence: string
  nextRunAt: string | null
  dueNow: boolean
  dueReason: string
  recipientCount: number
}

export interface RunLog {
  id: string
  scheduleId: string | null
  scheduleName: string
  reportType: ReportType
  period: ReportPeriod
  trigger: 'schedule' | 'manual' | 'cron-http' | 'test'
  triggeredBy: string | null
  status: 'ok' | 'error' | 'skipped'
  recipients: number
  counts: { created: number; onGround: number; complaints: number; upcoming: number }
  error: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
}

export interface AutoReportPayload {
  schedules: Schedule[]
  runs: RunLog[]
  masterEnabled: boolean
  sender: string
  defaultTimezone: string
  serverTime: string
  summary: { total: number; enabled: number; failing: number; recipients: number }
}

export const PERIOD_OPTIONS: { value: ReportPeriod; label: string; hint: string }[] = [
  { value: 'DAILY', label: 'Daily', hint: 'Covers yesterday' },
  { value: 'WEEKLY', label: 'Weekly', hint: 'Covers last Mon–Sun' },
  { value: 'MONTHLY', label: 'Monthly', hint: 'Covers last calendar month' },
]

export const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: 'VIETNAM', label: 'Vietnam' },
  { value: 'SRILANKA', label: 'Sri Lanka' },
  { value: 'SINGAPORE', label: 'Singapore' },
  { value: 'MALAYSIA', label: 'Malaysia' },
  // Legacy combined rows are split into Singapore / Malaysia by the report data
  // layer, so there is no combined option to pick here.
  { value: 'UNASSIGNED', label: 'Others' },
]

export const REPORT_TYPE_OPTIONS: {
  value: ReportType
  label: string
  hint: string
  /** Send hour a new schedule of this type starts at. */
  defaultHour: number
}[] = [
  {
    value: 'OPS',
    label: 'Operations report',
    hint: 'Bookings, tours on ground, readiness, complaints',
    defaultHour: 8,
  },
  {
    value: 'RECONCILIATION',
    label: 'System reconciliation',
    // Defaults to 03:00 so the previous day is closed everywhere — the nightly
    // Apple System P&L sync and the B2C sweep have both finished by then.
    hint: 'Apple System vs OPS vs accounts vs B2C — do the counts match?',
    defaultHour: 3,
  },
]

export interface SectionOption {
  key: keyof ScheduleSections
  label: string
  hint: string
}

export const OPS_SECTION_OPTIONS: SectionOption[] = [
  { key: 'created', label: 'Bookings created', hint: 'B2B / B2C split, country-wise, full list' },
  { key: 'onGround', label: 'On ground today', hint: 'Live tours by country, arrivals and departures' },
  { key: 'readiness', label: 'Arriving next 3 days', hint: 'Tomorrow + 2 days: client confirmation, drivers, tickets, QC' },
  { key: 'reconfirm', label: 'Guest reconfirmation (D-10)', hint: 'Bookings past the ten-days-before-travel deadline, with the reason recorded for each' },
  { key: 'complaints', label: 'Complaints', hint: 'Every issue in detail, resolved and unresolved' },
  { key: 'upcoming', label: 'Upcoming tours', hint: 'Forward book by country and month' },
]

export const RECON_SECTION_OPTIONS: SectionOption[] = [
  { key: 'countCheck', label: 'Count check', hint: 'The verdict: confirmations vs OPS bookings vs P&Ls vs invoices' },
  { key: 'detail', label: 'Booking-by-booking', hint: 'One row per confirmation, ticked through each system' },
  { key: 'asStatus', label: 'Apple System intake', hint: 'Confirmed (status 2), not confirmed (status 1), cancelled and other' },
  { key: 'opsIntake', label: 'Booking system', hint: 'Bookings OPS created and cancelled in the window' },
  { key: 'accountsOutput', label: 'Accounts output', hint: 'P&Ls and invoices by origin: AS API, OneDrive, mail, manual' },
  { key: 'b2c', label: 'Aahaas B2C', hint: 'Storefront orders followed into OPS and accounts' },
]

/** The sections a report type actually renders. Mirrors `sectionKeysFor()`. */
export function sectionOptionsFor(type: ReportType | undefined): SectionOption[] {
  return type === 'RECONCILIATION' ? RECON_SECTION_OPTIONS : OPS_SECTION_OPTIONS
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const TIMEZONE_OPTIONS = [
  'Asia/Colombo',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'UTC',
]

export const ALL_SECTIONS_ON: ScheduleSections = {
  created: true, onGround: true, readiness: true, reconfirm: true, complaints: true, upcoming: true,
  asStatus: true, opsIntake: true, accountsOutput: true, countCheck: true, detail: true, b2c: true,
}

/** A blank schedule the editor starts from. */
export function emptySchedule(defaultTimezone: string, reportType: ReportType = 'OPS'): Partial<Schedule> {
  return {
    name: '',
    enabled: true,
    reportType,
    period: 'DAILY',
    hour: REPORT_TYPE_OPTIONS.find(t => t.value === reportType)?.defaultHour ?? 8,
    minute: 0,
    timezone: defaultTimezone,
    dayOfWeek: 1,
    dayOfMonth: 1,
    to: [],
    cc: [],
    bcc: [],
    replyTo: null,
    subjectPrefix: null,
    countries: [],
    sections: { ...ALL_SECTIONS_ON },
    attachCsv: true,
    aiSummary: false,
    skipIfEmpty: false,
    maxRows: 30,
  }
}
