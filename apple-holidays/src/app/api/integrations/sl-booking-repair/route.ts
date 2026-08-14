/**
 * POST /api/integrations/sl-booking-repair
 *
 * Pull one booking into this system by its IS number, on the accounts system's
 * say-so.
 *
 * Payable 1.0's booking-count check (accounts side:
 * SlBookingCountCheckService) compares the Sri Lankan bookings arriving on a day
 * here against the driver envelopes it is costing there. When accounts is
 * costing a booking this system has never heard of, operations is not
 * allocating a driver to a tour that is arriving — and the file has to be
 * created here before anyone can. That is what this endpoint does, and the only
 * thing it does.
 *
 * Two sources, tried in order — the same two a human would use:
 *
 *   1. AppleSystem — search the confirmation by IS number, fetch its quote,
 *      map it and persist it. Exactly what the "New Booking from AppleSystem"
 *      page does (POST /api/as-bookings-v2/create), minus the browser.
 *   2. OneDrive — find the booking's own folder by ref and process the travel
 *      confirmation inside it. What the nightly folder poll does, aimed at one
 *      booking instead of a date.
 *
 * Idempotent: a ref this system already holds is reported as `already_present`
 * and nothing is written. Never deletes, never updates an existing booking's
 * fields, and never touches accounts' own tables.
 *
 * Auth is a shared secret, not a session — the caller is a server, not a
 * person. `Authorization: Bearer <ACCOUNTS_INTEGRATION_SECRET>` (falling back to
 * CRON_SECRET, which the cron routes already use). With neither configured the
 * endpoint refuses every request rather than standing open.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCancellationDeadline } from '@/lib/utils'
import { searchBookings, getQuoteTemplate, type ASBookingListItem } from '@/lib/applesystem'
import { mapQuoteToBooking, normalizeIsNumber, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId, AlreadyImportedError } from '@/lib/as-booking-import'
import { DRIVE_CONFIGS, scanBookingRefInDrive } from '@/lib/onedrive-monitor'
import type { OperationCountry } from '@/lib/country-detection'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Source = 'auto' | 'applesystem' | 'onedrive'

interface Attempt {
  source: 'applesystem' | 'onedrive'
  ok: boolean
  detail: string
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ACCOUNTS_INTEGRATION_SECRET || process.env.CRON_SECRET
  if (!secret) return false

  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { isNumber?: string; source?: string; dryRun?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = String(body.isNumber ?? '').trim()
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'isNumber is required' }, { status: 400 })
  }

  const ref = normalizeIsNumber(raw)
  if (!ref) {
    return NextResponse.json({ ok: false, error: `Not an IS number: ${raw}` }, { status: 400 })
  }

  const source: Source =
    body.source === 'applesystem' || body.source === 'onedrive' ? body.source : 'auto'

  // ── Already here? ───────────────────────────────────────────────────────
  const existing = await prisma.booking.findFirst({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, arrivalDate: true, status: true, operationCountry: true },
  })
  if (existing) {
    return NextResponse.json({
      ok: true,
      status: 'already_present',
      isNumber: ref,
      booking: existing,
      attempts: [],
      message: `${ref} is already in the booking system.`,
    })
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      status: 'would_import',
      isNumber: ref,
      attempts: [],
      message: `${ref} is not in the booking system; an import would be attempted.`,
    })
  }

  const attempts: Attempt[] = []

  // ── 1. AppleSystem ──────────────────────────────────────────────────────
  if (source === 'auto' || source === 'applesystem') {
    const result = await importFromAppleSystem(raw, ref)
    attempts.push(result.attempt)

    if (result.booking) {
      return NextResponse.json({
        ok: true,
        status: 'imported',
        via: 'applesystem',
        isNumber: ref,
        booking: result.booking,
        attempts,
        message: `${ref} was imported from the Apple System.`,
      })
    }
  }

  // ── 2. OneDrive ─────────────────────────────────────────────────────────
  if (source === 'auto' || source === 'onedrive') {
    const result = await importFromOneDrive(ref)
    attempts.push(...result.attempts)

    if (result.booking) {
      return NextResponse.json({
        ok: true,
        status: 'imported',
        via: 'onedrive',
        isNumber: ref,
        booking: result.booking,
        attempts,
        message: `${ref} was imported from its OneDrive folder.`,
      })
    }
  }

  return NextResponse.json({
    ok: false,
    status: 'not_found',
    isNumber: ref,
    attempts,
    message: `${ref} could not be found in the Apple System or on OneDrive.`,
  })
}

/* ── AppleSystem ─────────────────────────────────────────────────────────── */

async function importFromAppleSystem(
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

async function importFromOneDrive(
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
