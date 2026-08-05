/** Shapes returned by `/api/reports/auto`, shared by the page and its panels. */
import type { ReportPeriod } from '@/lib/reports/report-window'

export type { ReportPeriod }

export interface ScheduleSections {
  created: boolean
  onGround: boolean
  readiness: boolean
  complaints: boolean
  upcoming: boolean
}

export interface Schedule {
  id: string
  name: string
  enabled: boolean
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

export const SECTION_OPTIONS: { key: keyof ScheduleSections; label: string; hint: string }[] = [
  { key: 'created', label: 'Bookings created', hint: 'B2B / B2C split, country-wise, full list' },
  { key: 'onGround', label: 'On ground today', hint: 'Live tours by country, arrivals and departures' },
  { key: 'readiness', label: 'Arriving next 3 days', hint: 'Tomorrow + 2 days: client confirmation, drivers, tickets, QC' },
  { key: 'complaints', label: 'Complaints', hint: 'Every issue in detail, resolved and unresolved' },
  { key: 'upcoming', label: 'Upcoming tours', hint: 'Forward book by country and month' },
]

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

/** A blank schedule the editor starts from. */
export function emptySchedule(defaultTimezone: string): Partial<Schedule> {
  return {
    name: '',
    enabled: true,
    period: 'DAILY',
    hour: 8,
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
    sections: { created: true, onGround: true, readiness: true, complaints: true, upcoming: true },
    attachCsv: true,
    aiSummary: false,
    skipIfEmpty: false,
    maxRows: 30,
  }
}
