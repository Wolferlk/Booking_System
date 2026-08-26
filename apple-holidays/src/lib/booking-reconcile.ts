/**
 * Repairing one booking on the accounts system's say-so.
 *
 * Two systems hold the same trip and neither has ever checked the other. The
 * accounts system's Sync Ledger now does: for every confirmation the Apple
 * System raised on a day, it asks whether this system filed the booking, and
 * whether the file it holds is still the version the Apple System has. When the
 * answer is no, it calls in here.
 *
 * Three things a server may ask for, and nothing else:
 *
 *   • `status` — is this ref here, and how fresh is it? A pure read, so the
 *     ledger can verify its own conclusion before it changes anything.
 *   • `import` — create the missing file, from the Apple System or, failing
 *     that, from the booking's own OneDrive folder. Exactly what a person does
 *     on the "New Booking from AppleSystem" page, minus the browser.
 *   • `sync`   — the file is here but predates an upstream amendment; re-read
 *     the confirmation and refresh its *content* in place.
 *
 * ## What it will never do
 *
 * It never deletes a booking, never cancels one, and never touches workflow
 * state. `syncBookingFromAs` is explicit about that boundary — status, version,
 * the operation checklist, tickets, driver allocations, agenda, P&L, payments
 * and the StatusEvent timeline are this system's own and are left exactly as
 * they are. An `import` for a ref that already exists is reported as
 * `already_present` and writes nothing.
 *
 * The Apple System's cancellations are deliberately *not* actioned here. The
 * ledger reports them and a person decides — withdrawing a booking that
 * operations may already be running is not a call for an automation to make.
 *
 * Extracted from the SL booking-count repair endpoint so that repair and this
 * one share a single implementation: two importers that could drift would put
 * the two systems right back where they started.
 */
import { prisma } from '@/lib/prisma'
import { getCancellationDeadline } from '@/lib/utils'
import { searchBookings, getQuoteTemplate, type ASBookingListItem } from '@/lib/applesystem'
import { mapQuoteToBooking, normalizeIsNumber, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId, AlreadyImportedError } from '@/lib/as-booking-import'
import { syncBookingFromAs, getSyncState, AsSyncError } from '@/lib/as-booking-sync'
import { DRIVE_CONFIGS, scanBookingRefInDrive } from '@/lib/onedrive-monitor'
import type { OperationCountry } from '@/lib/country-detection'

export type ReconcileAction = 'status' | 'import' | 'sync'
export type ImportSource = 'auto' | 'applesystem' | 'onedrive'

export interface Attempt {
  source: 'applesystem' | 'onedrive'
  ok: boolean
  detail: string
}

export interface BookingSummary {
  id: string
  bookingRef: string
  arrivalDate?: Date | null
  status?: string | null
  operationCountry?: string | null
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* ── AppleSystem ─────────────────────────────────────────────────────────── */

export async function importFromAppleSystem(
  raw: string,
  ref: string,
): Promise<{ booking: { id: string; bookingRef: string } | null; attempt: Attempt }> {
  let items: ASBookingListItem[]
  try {
    // No status filter: a confirmation that has moved on from status 2 is still
    // a booking operations has to run.
    ;({ items } = await searchBookings({ isNumber: raw, statuses: [] }))
  } catch (err) {
    return {
      booking: null,
      attempt: { source: 'applesystem', ok: false, detail: `Lookup failed: ${message(err)}` },
    }
  }

  const match = items.find((it) => {
    const own = (it.is_number ?? '').trim()
    const candidate =
      own && own.toUpperCase() !== 'NA'
        ? own
        : it.reference_id_full?.find((r) => /^(IS|VN|SG|MY)/i.test(r))
    return candidate ? normalizeIsNumber(candidate) === ref : false
  })

  if (!match) {
    return {
      booking: null,
      attempt: {
        source: 'applesystem',
        ok: false,
        detail: items.length
          ? `The Apple System returned ${items.length} row(s) but none carrying ${ref}.`
          : 'The Apple System has no booking with this IS number.',
      },
    }
  }

  const quotationNo = String(match.quotation_no ?? '').trim()
  const referenceId = String(match.id ?? '').trim()
  if (!quotationNo || !referenceId) {
    return {
      booking: null,
      attempt: { source: 'applesystem', ok: false, detail: 'The Apple System row carries no quotation id.' },
    }
  }

  try {
    const quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
    const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: ref })

    const operationCountry = mapped.operationCountry as OperationCountry | null
    if (!operationCountry) {
      return {
        booking: null,
        attempt: {
          source: 'applesystem',
          ok: false,
          detail: 'Could not tell which country this booking is operated in.',
        },
      }
    }

    const { booking, alreadyExists } = await importMappedBooking(mapped, operationCountry, {
      createdById: await getAutomationUserId(),
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
    })

    return {
      booking,
      attempt: {
        source: 'applesystem',
        ok: true,
        detail: alreadyExists
          ? `${booking.bookingRef} was already present.`
          : `Created ${booking.bookingRef} from quotation ${quotationNo}.`,
      },
    }
  } catch (err) {
    if (err instanceof AlreadyImportedError) {
      return {
        booking: { id: err.bookingId, bookingRef: err.bookingRef },
        attempt: { source: 'applesystem', ok: true, detail: `${err.bookingRef} was already present.` },
      }
    }

    const detail = err instanceof ASMappingError ? `Could not map the quote: ${err.message}` : message(err)
    return { booking: null, attempt: { source: 'applesystem', ok: false, detail } }
  }
}

/* ── OneDrive ────────────────────────────────────────────────────────────── */

export async function importFromOneDrive(
  ref: string,
): Promise<{ booking: { id: string; bookingRef: string } | null; attempts: Attempt[] }> {
  const attempts: Attempt[] = []

  for (const cfg of DRIVE_CONFIGS) {
    let created = 0
    try {
      const scan = await scanBookingRefInDrive(cfg, ref)
      created = scan.bookingsCreated
      attempts.push({
        source: 'onedrive',
        ok: created > 0,
        detail:
          scan.scanned === 0
            ? `${cfg.label}: no folder for ${ref}.`
            : `${cfg.label}: created ${scan.bookingsCreated}, updated ${scan.bookingsUpdated}, errors ${scan.errors}.`,
      })
    } catch (err) {
      attempts.push({ source: 'onedrive', ok: false, detail: `${cfg.label}: ${message(err)}` })
      continue
    }

    if (created > 0) {
      const booking = await prisma.booking.findFirst({
        where: { bookingRef: ref },
        select: { id: true, bookingRef: true },
      })
      if (booking) return { booking, attempts }
    }
  }

  return { booking: null, attempts }
}

/* ── Import, either way ──────────────────────────────────────────────────── */

export interface RepairOutcome {
  ok: boolean
  status: string
  isNumber: string
  via?: string
  booking?: BookingSummary | { id: string; bookingRef: string } | null
  attempts: Attempt[]
  message: string
  [key: string]: unknown
}

/**
 * Create the booking this system is missing — the Apple System first, its
 * OneDrive folder second, which is the order a person would try.
 *
 * Idempotent: a ref already here is reported as `already_present` and nothing
 * is written.
 */
export async function importBooking(
  raw: string,
  ref: string,
  source: ImportSource = 'auto',
  dryRun = false,
): Promise<RepairOutcome> {
  const existing = await prisma.booking.findFirst({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, arrivalDate: true, status: true, operationCountry: true },
  })

  if (existing) {
    return {
      ok: true,
      status: 'already_present',
      isNumber: ref,
      booking: existing,
      attempts: [],
      message: `${ref} is already in the booking system.`,
    }
  }

  if (dryRun) {
    return {
      ok: true,
      status: 'would_import',
      isNumber: ref,
      attempts: [],
      message: `${ref} is not in the booking system; an import would be attempted.`,
    }
  }

  const attempts: Attempt[] = []

  if (source === 'auto' || source === 'applesystem') {
    const result = await importFromAppleSystem(raw, ref)
    attempts.push(result.attempt)

    if (result.booking) {
      return {
        ok: true,
        status: 'imported',
        via: 'applesystem',
        isNumber: ref,
        booking: result.booking,
        attempts,
        message: `${ref} was imported from the Apple System.`,
      }
    }
  }

  if (source === 'auto' || source === 'onedrive') {
    const result = await importFromOneDrive(ref)
    attempts.push(...result.attempts)

    if (result.booking) {
      return {
        ok: true,
        status: 'imported',
        via: 'onedrive',
        isNumber: ref,
        booking: result.booking,
        attempts,
        message: `${ref} was imported from its OneDrive folder.`,
      }
    }
  }

  return {
    ok: false,
    status: 'not_found',
    isNumber: ref,
    attempts,
    message: `${ref} could not be found in the Apple System or on OneDrive.`,
  }
}

/* ── Status ──────────────────────────────────────────────────────────────── */

/**
 * What this system currently holds for a ref, and when it last read it from
 * upstream. Read-only — the ledger uses it to confirm a difference before
 * acting on one.
 */
export async function bookingStatus(ref: string): Promise<RepairOutcome> {
  const booking = await prisma.booking.findFirst({
    where: { bookingRef: ref },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true,
      status: true, version: true, arrivalDate: true, departureDate: true,
      operationCountry: true, cancelledAt: true, updatedAt: true, createdAt: true,
    },
  })

  if (!booking) {
    return {
      ok: true,
      status: 'absent',
      isNumber: ref,
      booking: null,
      attempts: [],
      message: `${ref} is not in the booking system.`,
    }
  }

  const syncState = await getSyncState(booking.bookingRef)

  return {
    ok: true,
    status: 'present',
    isNumber: ref,
    booking,
    lastSync: syncState,
    attempts: [],
    message: `${ref} is here, last updated ${booking.updatedAt.toISOString()}.`,
  }
}

/* ── Sync ────────────────────────────────────────────────────────────────── */

/**
 * Re-read the confirmation and refresh the file's content in place.
 *
 * A ref that is not here is reported as `absent` rather than imported — the
 * caller asked to refresh a booking, and quietly creating one instead would
 * hide the fact that the two systems disagree about whether it exists.
 */
export async function syncBooking(ref: string, actorName: string): Promise<RepairOutcome> {
  const booking = await prisma.booking.findFirst({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true },
  })

  if (!booking) {
    return {
      ok: false,
      status: 'absent',
      isNumber: ref,
      booking: null,
      attempts: [],
      message: `${ref} is not in the booking system — import it before asking for a refresh.`,
    }
  }

  try {
    const result = await syncBookingFromAs(ref, {
      actorId: null,
      actorName,
      // The automated mode: no StatusEvent, no workflow transition, content only.
      mode: 'prearrival',
    })

    return {
      ok: true,
      status: result.unchanged ? 'unchanged' : 'synced',
      isNumber: ref,
      booking,
      via: 'applesystem',
      attempts: [],
      changed: result.fields.map((f) => f.field),
      sections: result.sections,
      revision: result.revision,
      message: result.unchanged
        ? `${ref} was already identical to the Apple System.`
        : `${ref} refreshed — ${result.fields.length} field(s) and ${result.sections.length} section(s) updated.`,
    }
  } catch (err) {
    const detail = err instanceof AsSyncError ? err.message : message(err)

    return {
      ok: false,
      status: 'sync_failed',
      isNumber: ref,
      booking,
      attempts: [],
      message: detail,
    }
  }
}
