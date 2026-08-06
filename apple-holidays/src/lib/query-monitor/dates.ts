/**
 * Excel serial-date helpers.
 *
 * The master workbook stores real dates, not text: column A is a date serial
 * formatted `dd-mmm-yy`, D/E are datetime serials formatted `m/d/yyyy h:mm`, and
 * J is a date serial formatted `m/d/yyyy`. Writing strings there would break the
 * team's pivots and sorting, so every date we push goes through here.
 *
 * Graph hands us UTC instants; the sheet is read by people in Sri Lanka, so the
 * serial is built from the wall-clock time in QUERY_MONITOR_TZ.
 */

export const SHEET_TZ = process.env.QUERY_MONITOR_TZ || 'Asia/Colombo'

/** Excel's day zero (the 1900 leap-year bug means the epoch is 30 Dec 1899). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The wall-clock reading of an instant in the sheet's timezone. */
export function wallClockInTz(date: Date, tz = SHEET_TZ): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  // Intl renders midnight as hour "24" in some ICU versions.
  const hour = get('hour') % 24

  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour, minute: get('minute'), second: get('second'),
  }
}

/** Date + time as an Excel serial (e.g. 46237.4076388889). */
export function toExcelDateTimeSerial(date: Date | null | undefined, tz = SHEET_TZ): number | '' {
  if (!date || Number.isNaN(date.getTime())) return ''
  const w = wallClockInTz(date, tz)
  const days = (Date.UTC(w.year, w.month - 1, w.day) - EXCEL_EPOCH_UTC) / MS_PER_DAY
  const dayFraction = (w.hour * 3600 + w.minute * 60 + w.second) / 86_400
  // 10 decimals is what Excel itself round-trips; more just adds noise.
  return Number((days + dayFraction).toFixed(10))
}

/** Midnight-anchored serial — for the Date and Travel Date columns. */
export function toExcelDateSerial(date: Date | null | undefined, tz = SHEET_TZ): number | '' {
  if (!date || Number.isNaN(date.getTime())) return ''
  const w = wallClockInTz(date, tz)
  return (Date.UTC(w.year, w.month - 1, w.day) - EXCEL_EPOCH_UTC) / MS_PER_DAY
}

/** Inverse of the above — used when reading existing rows back for verification. */
export function fromExcelSerial(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial * MS_PER_DAY))
}

/** `2026-08-06` in the sheet timezone — for grouping and day filters. */
export function isoDateInTz(date: Date, tz = SHEET_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}
