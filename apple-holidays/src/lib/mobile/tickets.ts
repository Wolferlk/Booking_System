/**
 * Driver App — entrance tickets on a trip.
 *
 * The tickets are the ops rows (`tickets` + `ticket_files`) the Tickets &
 * Vouchers page shows. The driver sees the entrance ones, day by day, uploads
 * a photo / PDF of each as the guests go in, and can add one ops did not have
 * (bought at the gate). A trip cannot be finished while any of them has no file.
 *
 * Which day a ticket belongs to:
 *   1. its agenda item's date, when ops linked one;
 *   2. for a ticket the driver added, the day they added it for;
 *   3. otherwise the trip day whose stops mention the place (most P&L-generated
 *      tickets have no agenda item, e.g. "Yala National Park with Jeep Safari"
 *      lands on the day that drives to Yala).
 * A ticket that matches no day still shows on a round trip (one driver, whole
 * tour) as a trip ticket; on a transfers-only trip it is not the driver's.
 *
 * Never returns a cost or the Accounts receipt (`Ticket.fileUrl`) — rates stay
 * internal. Only the per-guest ticket files are shown.
 */
import { prisma } from '@/lib/prisma'
import { putUpload } from '@/lib/storage'
import { clearNoTicketsMark } from '@/lib/no-tickets-clear'
import { isTicketFilesMissing, TICKET_FILES_NOT_READY } from '@/lib/ticket-files'
import type { DriverTrip, TripDayPlan } from './trips'
import { MobileError } from './http'
import { isSandboxBookingId } from './sandbox'
import { notifyStaff } from './notify'

/**
 * What a guest shows at a gate. A ticket with no category at all was typed in
 * by hand on Tickets & Vouchers, so it counts; OTHER does not — the P&L import
 * files invoices and anything it cannot place there (lib/ext-pnl-tickets.ts).
 */
const ENTRANCE = new Set(['TICKETS', 'WATER', 'CRUISE', ''])
const DRIVER_NOTE = 'Added from the driver app'
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 20

export interface TripTicketFile {
  id: string
  url: string
  name: string | null
  type: 'image' | 'pdf'
  by: string | null
  at: string
  /** this driver uploaded it, so they may remove it */
  mine: boolean
}

export interface TripTicket {
  id: string
  name: string
  qty: number
  /** trip day (YYYY-MM-DD), or null for a trip-wide ticket */
  date: string | null
  dayNo: number | null
  addedByDriver: boolean
  files: TripTicketFile[]
  done: boolean
}

export interface TripTickets {
  tickets: TripTicket[]
  missing: number
  /** false until prisma/sql/apply-ticket-files.sh has been run — uploads are refused and nothing is required */
  ready: boolean
  /** test trip: shown, never saved */
  sandbox: boolean
}

const driverTag = (driverId: string) => `driver:${driverId}`

// ── matching a ticket to a day ──────────────────────────────────────────────

const STOP = new Set([
  'the', 'and', 'with', 'from', 'entrance', 'entry', 'ticket', 'tickets', 'national', 'park', 'visit', 'tour',
  'adult', 'adults', 'child', 'children', 'person', 'fees', 'jeep', 'safari', 'private', 'admission', 'only',
  'hotel', 'transfer', 'city', 'including', 'incl', 'per', 'pax', 'sic', 'pvt',
])

function words(s: string): string[] {
  return Array.from(new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w))))
}

function dayText(d: TripDayPlan): string {
  return d.movements
    .filter(m => m.mine)
    .map(m => [m.location, m.from, m.to, m.details].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase()
}

/** The trip day that mentions this place most, earliest on a tie. */
function matchDay(name: string, days: TripDayPlan[]): string | null {
  const ws = words(name)
  if (!ws.length) return null
  let best: string | null = null
  let score = 0
  for (const d of days) {
    const text = dayText(d)
    const s = ws.filter(w => text.includes(w)).length
    if (s > score) { score = s; best = d.date }
  }
  return best
}

// ── reading ─────────────────────────────────────────────────────────────────

function sandboxTickets(trip: DriverTrip): TripTickets {
  const tickets: TripTicket[] = []
  for (const d of trip.days) {
    const stop = d.movements.find(m => m.mine && !m.noDriverNeeded && (m.to || m.location))
    if (!stop || tickets.length >= 3) continue
    tickets.push({
      id: `sbx-tkt-${d.date}`, name: `Entrance — ${stop.to || stop.location}`, qty: trip.pax.adults + trip.pax.children,
      date: d.date, dayNo: d.dayNo, addedByDriver: false, files: [], done: false,
    })
  }
  return { tickets, missing: 0, ready: true, sandbox: true }
}

export async function tripTickets(driverId: string, trip: DriverTrip): Promise<TripTickets> {
  if (isSandboxBookingId(trip.bookingId)) return sandboxTickets(trip)

  const rows = await prisma.ticket.findMany({
    where: { bookingId: trip.bookingId },
    select: {
      id: true, type: true, qty: true, category: true, notes: true, createdAt: true,
      agendaItem: { select: { date: true } },
      pnlLine: { select: { category: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const entrance = rows.filter(r => ENTRANCE.has(String(r.pnlLine?.category ?? r.category ?? '').toUpperCase()))

  let ready = true
  const files = new Map<string, TripTicketFile[]>()
  if (entrance.length) {
    try {
      const fs = await prisma.ticketFile.findMany({
        where: { ticketId: { in: entrance.map(r => r.id) } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
      for (const f of fs) {
        const list = files.get(f.ticketId) ?? []
        list.push({
          id: f.id, url: f.fileUrl, name: f.fileName, type: f.fileType === 'pdf' ? 'pdf' : 'image',
          by: f.uploadedByName, at: f.createdAt.toISOString(), mine: f.uploadedById === driverTag(driverId),
        })
        files.set(f.ticketId, list)
      }
    } catch (err) {
      if (!isTicketFilesMissing(err)) throw err
      ready = false
    }
  }

  const dayNo = new Map(trip.days.map(d => [d.date, d.dayNo]))
  const tickets: TripTicket[] = []
  for (const r of entrance) {
    const addedByDriver = !!r.notes?.startsWith(DRIVER_NOTE)
    const linked = r.agendaItem ? r.agendaItem.date.toISOString().slice(0, 10) : null
    const added = addedByDriver ? r.notes!.match(/for (\d{4}-\d{2}-\d{2})/)?.[1] ?? null : null
    const date = [linked, added].find(d => d && dayNo.has(d)) ?? matchDay(r.type, trip.days)
    // On a transfers-only trip, a ticket for a day the driver does not drive is someone else's.
    if (trip.mode === 'MOVEMENTS' && (!date || (linked && !dayNo.has(linked)))) continue
    const fl = files.get(r.id) ?? []
    tickets.push({
      id: r.id, name: r.type, qty: r.qty, date, dayNo: date ? dayNo.get(date) ?? null : null,
      addedByDriver, files: fl, done: fl.length > 0,
    })
  }
  tickets.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  return { tickets, missing: ready ? tickets.filter(t => !t.done).length : 0, ready, sandbox: false }
}

/** Refuse to finish the trip while an entrance ticket has nothing uploaded. */
export async function requireTicketsUploaded(driverId: string, trip: DriverTrip) {
  const { tickets, missing } = await tripTickets(driverId, trip)
  if (!missing) return
  const names = tickets.filter(t => !t.done).map(t => t.name)
  throw new MobileError(
    `Upload the entrance tickets first (${missing} missing): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.`,
    409, 'tickets_missing',
  )
}

// ── writing ─────────────────────────────────────────────────────────────────

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] }

function filesOf(form: FormLike): File[] {
  const fs = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
  if (fs.length > MAX_FILES) throw new MobileError(`Up to ${MAX_FILES} files at a time.`)
  for (const f of fs) {
    if (!ALLOWED_TYPES.includes(f.type)) throw new MobileError('Only photos or PDF files can be uploaded.')
    if (f.size > MAX_BYTES) throw new MobileError('A file is too large (max 10 MB).')
  }
  return fs
}

function refuseSandbox(trip: DriverTrip) {
  if (isSandboxBookingId(trip.bookingId)) throw new MobileError('Test trip — tickets are not saved.', 409, 'sandbox')
}

async function storeFiles(driver: { driverId: string; name: string }, ticketId: string, files: File[]) {
  let position: number
  try {
    const last = await prisma.ticketFile.findFirst({ where: { ticketId }, orderBy: { position: 'desc' }, select: { position: true } })
    position = (last?.position ?? -1) + 1
  } catch (err) {
    if (isTicketFilesMissing(err)) throw new MobileError(TICKET_FILES_NOT_READY, 503, 'setup_required')
    throw err
  }
  for (let n = 0; n < files.length; n++) {
    const f = files[n]
    const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg'
    const fileUrl = await putUpload(`tickets/ticket-${ticketId}-${Date.now()}-${n}.${ext}`, Buffer.from(await f.arrayBuffer()), f.type)
    await prisma.ticketFile.create({
      data: {
        ticketId, fileUrl,
        fileName: (f.name || `ticket-${n + 1}.${ext}`).slice(0, 255),
        fileType: f.type === 'application/pdf' ? 'pdf' : 'image',
        label: `Driver upload ${position + n + 1}`,
        position: position + n,
        uploadedById: driverTag(driver.driverId),
        uploadedByName: `${driver.name} (driver)`.slice(0, 191),
      },
    })
  }
}

/** Upload files onto one of this trip's tickets — form field `files`, repeated. */
export async function uploadTicketFiles(driver: { driverId: string; name: string }, trip: DriverTrip, ticketId: string, form: FormLike) {
  refuseSandbox(trip)
  const { tickets } = await tripTickets(driver.driverId, trip)
  if (!tickets.some(t => t.id === ticketId)) throw new MobileError('That ticket is not on this trip.', 404, 'not_found')
  const files = filesOf(form)
  if (!files.length) throw new MobileError('No file received.')
  await storeFiles(driver, ticketId, files)
}

/** Remove a file this driver uploaded. */
export async function removeTicketFile(driverId: string, trip: DriverTrip, ticketId: string, fileId: string) {
  refuseSandbox(trip)
  const t = await prisma.ticket.findFirst({ where: { id: ticketId, bookingId: trip.bookingId }, select: { id: true } })
  if (!t) throw new MobileError('That ticket is not on this trip.', 404, 'not_found')
  const { count } = await prisma.ticketFile.deleteMany({ where: { id: fileId, ticketId, uploadedById: driverTag(driverId) } })
  if (!count) throw new MobileError('You can only remove files you uploaded.', 403, 'forbidden')
}

/**
 * A ticket ops did not have — bought at the gate. Created as a DRAFT entrance
 * ticket on the booking (so it shows on Tickets & Vouchers), linked to the
 * driver's first stop that day when there is one, with the photos attached.
 */
export async function addDriverTicket(driver: { driverId: string; name: string }, trip: DriverTrip, form: FormLike) {
  refuseSandbox(trip)
  const name = String(form.get('name') ?? '').trim().slice(0, 191)
  const qty = Math.max(1, Math.min(99, Math.round(Number(form.get('qty')) || 1)))
  const date = String(form.get('date') ?? '')
  if (!name) throw new MobileError('Enter what the ticket is for.')
  const day = trip.days.find(d => d.date === date)
  if (!day) throw new MobileError('Pick a day of this trip.')
  const files = filesOf(form)
  if (!files.length) throw new MobileError('Add a photo of the ticket.')

  const ticket = await prisma.ticket.create({
    data: {
      bookingId: trip.bookingId,
      agendaItemId: day.movements.find(m => m.mine)?.id ?? null,
      type: name,
      qty,
      category: 'TICKETS',
      status: 'DRAFT',
      notes: `${DRIVER_NOTE} by ${driver.name} for ${date}.`,
    },
  })
  await clearNoTicketsMark(trip.bookingId)
  try {
    await storeFiles(driver, ticket.id, files)
  } catch (err) {
    // No file, no ticket — otherwise it would sit there as "missing" with nothing behind it.
    await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => {})
    throw err
  }
  await notifyStaff(trip.country, {
    kind: 'TICKET_ADDED',
    title: `Driver added a ticket · ${trip.fileNo}`,
    body: `${driver.name}: ${name} × ${qty} (day ${day.dayNo}).`,
    data: { bookingRef: trip.bookingRef },
    dedupeKey: `ticket-added:${ticket.id}`,
  }).catch(err => console.error('[mobile addDriverTicket notify]', err))
  return ticket.id
}
