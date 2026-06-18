/**
 * OneDrive / SharePoint folder monitor.
 *
 * Scans configured drives using Microsoft Graph delta API for new/changed
 * booking folders. When a TC.docx appears it creates/updates a booking;
 * when a PNL xlsx appears it updates the PNL line items.
 *
 * Drive layout expected:
 *   Vietnam  : VN OPERATION / {Year} / {Month} / [{DD Month} /] {BookingRef} - {Name} / files
 *   Sri Lanka: SL Share Drive_ / {Year} / {Month} / {BookingRef} - {Name} / files
 */

import { prisma } from '@/lib/prisma'
import {
  getUserDriveId,
  getSharePointDriveId,
  getDriveItemsDelta,
  downloadDriveItem,
  listFolderChildren,
  searchDriveItems,
  type DriveItem,
} from '@/lib/graph-client'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { extractBookingFromEmail } from '@/lib/mail-processor'
import { classifyPNLCategories } from '@/lib/openai'
import { detectCountryFromRef } from '@/lib/country-detection'
import { logActivity, ACTION } from '@/lib/activity'
import { upsertAgenda } from '@/lib/incoming-mail-automation'
import type { OperationCountry } from '@prisma/client'

// ── Drive config ──────────────────────────────────────────────────────────────

export interface DriveConfig {
  key:     string       // VN | SL | SG | MY
  label:   string
  country: OperationCountry
  type:    'personal' | 'sharepoint'
  // personal
  userUpn?:    string
  rootFolder?: string
  // sharepoint
  siteHost?: string
  sitePath?: string
  library?:  string
  rootFolder_sp?: string
}

export const DRIVE_CONFIGS: DriveConfig[] = [
  {
    key:        'VN',
    label:      'Vietnam (VN OPERATION)',
    country:    'VIETNAM',
    type:       'personal',
    userUpn:    process.env.ONEDRIVE_VN_USER ?? 'pradeep_reservation@aahaas.com',
    rootFolder: process.env.ONEDRIVE_VN_ROOT ?? 'VN OPERATION',
  },
  {
    key:           'SL',
    label:         'Sri Lanka (SL Share Drive)',
    country:       'SRILANKA',
    type:          'sharepoint',
    siteHost:      process.env.ONEDRIVE_SL_SITE_HOST  ?? 'aahaas.sharepoint.com',
    sitePath:      process.env.ONEDRIVE_SL_SITE_PATH  ?? '/sites/BookingExperienceB2B2',
    library:       'Shared Documents',
    rootFolder_sp: process.env.ONEDRIVE_SL_ROOT ?? 'SL Share Drive_',
  },
]

// ── Booking-ref detection ─────────────────────────────────────────────────────

const BOOKING_FOLDER_RE = /^(VN|IS|SG|MY|AH)\s*\d{3,}[-\s]/i

function extractRefFromFolderName(name: string): string | null {
  const m = name.match(/^([A-Z]{2,3}\d{3,})/i)
  if (m) return m[1].toUpperCase().replace(/\s+/g, '')
  return null
}

function isBookingFolder(item: DriveItem): boolean {
  return !!(item.folder && BOOKING_FOLDER_RE.test(item.name))
}

function isTCFile(name: string): boolean {
  return /^TC\.(docx?|pdf)$/i.test(name.trim())
}

function isPNLFile(name: string): boolean {
  return /pnl/i.test(name) && /\.(xlsx?|docx?)$/i.test(name)
}

// ── Drive ID resolution (cached per process lifetime) ────────────────────────

const driveIdCache: Record<string, string> = {}

async function resolveDriveId(cfg: DriveConfig): Promise<string> {
  if (driveIdCache[cfg.key]) return driveIdCache[cfg.key]

  let id: string
  if (cfg.type === 'personal') {
    id = await getUserDriveId(cfg.userUpn!)
  } else {
    id = await getSharePointDriveId(cfg.siteHost!, cfg.sitePath!, cfg.library)
  }
  driveIdCache[cfg.key] = id
  return id
}

// ── Delta token persistence ───────────────────────────────────────────────────

async function loadDeltaToken(driveKey: string): Promise<string | null> {
  const row = await prisma.oneDriveDeltaToken.findUnique({ where: { driveKey } })
  return row?.token ?? null
}

async function saveDeltaToken(driveKey: string, token: string): Promise<void> {
  await prisma.oneDriveDeltaToken.upsert({
    where:  { driveKey },
    create: { driveKey, token },
    update: { token },
  })
}

// ── Main scan ─────────────────────────────────────────────────────────────────

export interface ScanResult {
  driveKey:    string
  label:       string
  scanned:     number
  bookingsCreated: number
  bookingsUpdated: number
  pnlsUpdated:     number
  errors:          number
  events:          { ref: string; type: string; file: string }[]
}

export async function scanDrive(cfg: DriveConfig): Promise<ScanResult> {
  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
  } catch (err) {
    console.error(`[OneDrive] ${cfg.key}: failed to resolve drive ID:`, err)
    result.errors += 1
    return result
  }

  const rootPath = cfg.type === 'personal' ? cfg.rootFolder : cfg.rootFolder_sp
  const deltaToken = await loadDeltaToken(cfg.key)

  let items: DriveItem[]
  let newToken: string
  try {
    const r = await getDriveItemsDelta(driveId, rootPath, deltaToken)
    items    = r.items
    newToken = r.deltaToken
  } catch (err) {
    console.error(`[OneDrive] ${cfg.key}: delta fetch error:`, err)
    result.errors += 1
    return result
  }

  result.scanned = items.length
  if (newToken) await saveDeltaToken(cfg.key, newToken)

  console.log(`[OneDrive] ${cfg.key}: ${items.length} delta items`)

  // Group files by their immediate parent item ID so we can find TC/PNL per booking folder
  const filesByParent: Record<string, DriveItem[]> = {}
  const bookingFolders: Record<string, DriveItem> = {} // itemId → folder item

  for (const item of items) {
    if (item.folder) {
      if (isBookingFolder(item)) {
        bookingFolders[item.id] = item
      }
    } else if (item.file) {
      const parentId = item.parentReference?.id ?? ''
      if (!filesByParent[parentId]) filesByParent[parentId] = []
      filesByParent[parentId].push(item)
    }
  }

  // Process each booking folder that appeared in this delta
  for (const [folderId, folder] of Object.entries(bookingFolders)) {
    const bookingRef = extractRefFromFolderName(folder.name)
    if (!bookingRef) continue

    const files = filesByParent[folderId] ?? []

    // Record folder detected
    await upsertOneDriveEvent({
      driveType:  cfg.key,
      itemId:     folderId,
      itemName:   folder.name,
      itemPath:   buildPath(folder),
      webUrl:     folder.webUrl,
      eventType:  'FOLDER_DETECTED',
      bookingRef,
      status:     'PROCESSED',
    })

    // Store folder URL on booking if it exists
    const folderWebUrl = folder.webUrl
    if (folderWebUrl) {
      await prisma.booking.updateMany({
        where: { bookingRef },
        data:  { onedriveFolderUrl: folderWebUrl },
      })
    }

    // Process TC file
    const tcFile = files.find(f => isTCFile(f.name))
    if (tcFile) {
      try {
        const r = await processTCFile(driveId, tcFile, bookingRef, cfg.country, folderWebUrl)
        if (r.isNew) { result.bookingsCreated += 1 } else { result.bookingsUpdated += 1 }
        result.events.push({ ref: bookingRef, type: 'TC', file: tcFile.name })

        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'TC_PROCESSED', bookingRef, status: 'PROCESSED',
        })
      } catch (err) {
        result.errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[OneDrive] ${cfg.key}: TC error for ${bookingRef}:`, msg)
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
        })
      }
    }

    // Process PNL file
    const pnlFile = files.find(f => isPNLFile(f.name) && !f.name.toLowerCase().includes('agenda'))
    if (pnlFile) {
      try {
        const pnlLines = await processPNLFile(driveId, pnlFile, bookingRef)
        result.pnlsUpdated += 1
        result.events.push({ ref: bookingRef, type: 'PNL', file: pnlFile.name })

        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
          itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
          eventType: 'PNL_PROCESSED', bookingRef, status: 'PROCESSED',
          rawData: JSON.stringify({ linesProcessed: pnlLines }),
        })
      } catch (err) {
        result.errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[OneDrive] ${cfg.key}: PNL error for ${bookingRef}:`, msg)
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
          itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
          eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
        })
      }
    }

    // Record any other files
    for (const f of files) {
      if (f === tcFile || f === pnlFile) continue
      if (f.name.toLowerCase().includes('agenda')) continue
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: f.id, itemName: f.name,
        itemPath: buildPath(f), webUrl: f.webUrl,
        eventType: 'FILE_DETECTED', bookingRef, status: 'PROCESSED',
      })
    }
  }

  return result
}

/** Scan all configured drives and return combined results. */
export async function scanAllDrives(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  for (const cfg of DRIVE_CONFIGS) {
    try {
      const r = await scanDrive(cfg)
      results.push(r)
    } catch (err) {
      console.error(`[OneDrive] scanAllDrives error for ${cfg.key}:`, err)
      results.push({
        driveKey: cfg.key, label: cfg.label,
        scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0,
        errors: 1, events: [],
      })
    }
  }
  return results
}

// ── TC processing ─────────────────────────────────────────────────────────────

async function processTCFile(
  driveId:     string,
  item:        DriveItem,
  bookingRef:  string,
  country:     OperationCountry,
  folderUrl?:  string,
): Promise<{ isNew: boolean }> {
  console.log(`[OneDrive] Processing TC: ${item.name} → ${bookingRef}`)

  const buffer = await downloadDriveItem(driveId, item.id)
  const text   = await extractTextFromDocx(buffer)

  const extracted = await extractBookingFromEmail(text, 'TOUR_CONFIRMATION')

  // Override booking ref with the folder name ref (more reliable)
  if (bookingRef) extracted.bookingRef = bookingRef

  if (!extracted.arrivalDate || !extracted.departureDate) {
    // Try to get dates from the booking if it already exists
    const existing = await prisma.booking.findUnique({ where: { bookingRef } })
    if (!existing) throw new Error(`TC file for ${bookingRef} has no arrival/departure dates`)
    // Update without dates if booking already exists
    await prisma.booking.update({
      where: { bookingRef },
      data: {
        onedriveFolderUrl: folderUrl ?? undefined,
        ...(extracted.agent && { agent: extracted.agent }),
        ...(extracted.isNumber && { isNumber: extracted.isNumber }),
        ...(extracted.dealName && { dealName: extracted.dealName }),
        ...(extracted.tourDestination && { tourDestination: extracted.tourDestination }),
      },
    })
    return { isNew: false }
  }

  const createdById = await getAutomationUserId()
  const existing    = await prisma.booking.findUnique({ where: { bookingRef } })
  const isNew       = !existing

  const detectedCountry =
    detectCountryFromRef(bookingRef) ?? country

  const commonData = {
    agentBookingId:    extracted.agentBookingId    ?? undefined,
    agent:             extracted.agent             ?? 'Unknown Agent',
    fileHandler:       extracted.fileHandler       ?? undefined,
    arrivalDate:       new Date(extracted.arrivalDate),
    departureDate:     new Date(extracted.departureDate),
    paxAdults:         extracted.paxAdults,
    paxChildren:       extracted.paxChildren,
    quotedTotal:       extracted.quotedTotal       ?? 0,
    currency:          extracted.currency          ?? 'USD',
    terms:             extracted.terms             ?? undefined,
    exclusions:        extracted.exclusions        ?? undefined,
    agentEmail:        extracted.agentEmail        ?? undefined,
    agentPhone:        extracted.agentPhone        ?? undefined,
    agentWhatsapp:     extracted.agentWhatsapp     ?? undefined,
    agentCountry:      extracted.agentCountry      ?? undefined,
    agentAddress:      extracted.agentAddress      ?? undefined,
    contactEmail:      extracted.contactEmail      ?? undefined,
    contactPhone:      extracted.contactPhone      ?? undefined,
    contactWhatsapp:   extracted.contactWhatsapp   ?? undefined,
    contactCountry:    extracted.contactCountry    ?? undefined,
    contactAddress:    extracted.contactAddress    ?? undefined,
    operationCountry:  detectedCountry,
    isNumber:          extracted.isNumber          ?? undefined,
    dealName:          extracted.dealName          ?? undefined,
    tourDestination:   extracted.tourDestination   ?? undefined,
    chauffeurContact:  extracted.chauffeurContact  ?? undefined,
    languagePreference: extracted.languagePreference ?? undefined,
    specialOccasions:  extracted.specialOccasions  ?? undefined,
    checkedBy:         extracted.checkedBy         ?? undefined,
    reconfirmBy:       extracted.reconfirmBy       ?? undefined,
    sourceDocName:     item.name,
    sourceDocUrl:      item.webUrl                 ?? undefined,
    onedriveFolderUrl: folderUrl                   ?? undefined,
    status:            'GT_REVIEW' as const,
  }

  let booking: { id: string }
  if (isNew) {
    booking = await prisma.booking.create({
      data: { ...commonData, bookingRef, createdById },
    })
  } else {
    booking = await prisma.booking.update({
      where: { bookingRef },
      data:  commonData,
    })
  }

  // Replace passengers / flights / hotels / itinerary
  await replaceBookingChildren(booking.id, extracted)

  // Generate agenda (skip if one already exists)
  const agendaItems = await upsertAgenda(booking.id, bookingRef, extracted, !isNew)

  await logActivity({
    userId: createdById,
    action: isNew ? ACTION.BOOKING_CREATED : ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'onedrive', file: item.name, bookingRef, agendaItems },
  })

  console.log(`[OneDrive] ${bookingRef}: ${isNew ? 'CREATED' : 'UPDATED'} (${agendaItems} agenda items)`)
  return { isNew }
}

// ── PNL processing ────────────────────────────────────────────────────────────

async function processPNLFile(
  driveId:    string,
  item:       DriveItem,
  bookingRef: string,
): Promise<number> {
  console.log(`[OneDrive] Processing PNL: ${item.name} → ${bookingRef}`)

  const buffer   = await downloadDriveItem(driveId, item.id)
  const parsed   = parsePNLXlsx(buffer)

  // Find existing booking — try exact ref, then numeric suffix fallback
  let booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) {
    const numeric = bookingRef.replace(/[^0-9]/g, '')
    if (numeric.length >= 4) {
      booking = await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numeric } },
        orderBy: { createdAt: 'desc' },
      }) ?? null
    }
  }
  if (!booking) {
    throw new Error(`No booking found for PNL ref "${bookingRef}"`)
  }

  let lines = parsed.lineItems.map(l => ({ ...l }))
  const paxAdults   = parsed.paxAdults   || booking.paxAdults
  const paxChildren = parsed.paxChildren || booking.paxChildren

  // AI category classification
  if (lines.length > 0 && process.env.OPENAI_API_KEY) {
    try {
      const cats = await classifyPNLCategories(lines.map(l => l.activity))
      lines = lines.map((l, i) => ({ ...l, category: cats[i] ?? l.category }))
    } catch { /* keep existing categories */ }
  }

  let pnl = await prisma.pNL.findUnique({ where: { bookingId: booking.id } })
  if (!pnl) {
    pnl = await prisma.pNL.create({ data: { bookingId: booking.id, paxAdults, paxChildren } })
  } else {
    pnl = await prisma.pNL.update({ where: { id: pnl.id }, data: { paxAdults, paxChildren } })
  }

  await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

  const TICKETABLE = new Set(['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS'])
  const createdLines: { id: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const created = await prisma.pNLLineItem.create({
      data: {
        pnlId:      pnl.id,
        activity:   line.activity,
        category:   line.category as never,
        mmtRate:    line.mmtRate,
        sicRate:    line.sicRate,
        pvtRatePP:  line.pvtRatePP,
        adEntrance: line.adEntrance,
        chEntrance: line.chEntrance,
        otherRate:  line.otherRate,
        sortOrder:  i,
      },
    })
    createdLines.push(created)

    if (TICKETABLE.has(line.category)) {
      await prisma.ticket.create({
        data: {
          bookingId: booking.id,
          pnlLineId: created.id,
          type:      line.activity,
          qty:       paxAdults + paxChildren,
          currency:  booking.currency ?? 'USD',
          status:    'DRAFT',
          activated: false,
        },
      })
    }
  }

  if (booking.status === 'DRAFT') {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'GT_REVIEW' } })
  }

  const createdById = await getAutomationUserId()
  await logActivity({
    userId: createdById,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'onedrive', file: item.name, bookingRef, pnlLines: createdLines.length },
  })

  console.log(`[OneDrive] ${bookingRef}: PNL updated — ${createdLines.length} lines`)
  return createdLines.length
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAutomationUserId(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } })
  if (u) return u.id
  const bt = await prisma.user.findFirst({ where: { role: 'BT_USER' }, select: { id: true } })
  if (bt) return bt.id
  throw new Error('No automation user found (need SUPER_ADMIN or BT_USER)')
}

function buildPath(item: DriveItem): string {
  return item.parentReference?.path
    ? `${item.parentReference.path}/${item.name}`
    : item.name
}

async function replaceBookingChildren(
  bookingId: string,
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
) {
  await prisma.passenger.deleteMany({ where: { bookingId } })
  await prisma.flight.deleteMany({ where: { bookingId } })
  await prisma.accommodation.deleteMany({ where: { bookingId } })
  await prisma.itineraryItem.deleteMany({ where: { bookingId } })
  await prisma.emergencyContact.deleteMany({ where: { bookingId } })

  if (extracted.passengers.length > 0) {
    await prisma.passenger.createMany({
      data: extracted.passengers.map(p => ({
        bookingId,
        name: p.name,
        type: (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
        isLead: p.isLead ?? false,
      })),
    })
  }
  if (extracted.flights.length > 0) {
    await prisma.flight.createMany({
      data: extracted.flights.map(f => ({
        bookingId,
        flightNo: f.flightNo,
        date: new Date(f.date),
        fromApt: f.fromApt,
        depTime: f.depTime ?? '',
        toApt: f.toApt,
        arrTime: f.arrTime ?? '',
        airline: f.airline ?? null,
      })),
    })
  }
  if (extracted.accommodations.length > 0) {
    await prisma.accommodation.createMany({
      data: extracted.accommodations.map(a => ({
        bookingId,
        hotel: a.hotel,
        city: a.city,
        checkIn: new Date(a.checkIn),
        checkOut: new Date(a.checkOut),
        nights: a.nights,
        roomType: a.roomType ?? null,
        mealType: a.mealType ?? null,
      })),
    })
  }
  if (extracted.itineraryItems.length > 0) {
    await prisma.itineraryItem.createMany({
      data: extracted.itineraryItems.map(item => ({
        bookingId,
        dayNo: item.dayNo,
        date: new Date(item.date),
        title: item.title,
        description: item.description ?? null,
      })),
    })
  }
}

type OneDriveEventInput = {
  driveType:    string
  itemId:       string
  itemName:     string
  itemPath:     string
  webUrl?:      string | null
  eventType:    'FOLDER_DETECTED' | 'TC_PROCESSED' | 'PNL_PROCESSED' | 'FILE_DETECTED' | 'ERROR' | 'SKIPPED'
  bookingRef?:  string
  status:       'PENDING' | 'PROCESSED' | 'ERROR' | 'SKIPPED'
  errorMessage?: string
  rawData?:      string
}

async function upsertOneDriveEvent(input: OneDriveEventInput): Promise<void> {
  const existing = await prisma.oneDriveEvent.findFirst({
    where: { itemId: input.itemId, eventType: input.eventType },
  })
  if (existing) {
    await prisma.oneDriveEvent.update({
      where: { id: existing.id },
      data: {
        status:       input.status,
        processedAt:  new Date(),
        errorMessage: input.errorMessage ?? null,
        rawData:      input.rawData      ?? null,
        bookingRef:   input.bookingRef   ?? null,
      },
    })
  } else {
    await prisma.oneDriveEvent.create({
      data: {
        driveType:    input.driveType,
        itemId:       input.itemId,
        itemName:     input.itemName,
        itemPath:     input.itemPath,
        webUrl:       input.webUrl       ?? null,
        eventType:    input.eventType,
        bookingRef:   input.bookingRef   ?? null,
        status:       input.status,
        errorMessage: input.errorMessage ?? null,
        rawData:      input.rawData      ?? null,
        processedAt:  input.status !== 'PENDING' ? new Date() : null,
      },
    })
  }
}

/** Get all OneDrive files linked to a booking ref from the event log. */
export async function getBookingOneDriveFiles(bookingRef: string) {
  const ref = normalizeBookingRef(bookingRef)
  return prisma.oneDriveEvent.findMany({
    where: { bookingRef: ref, status: 'PROCESSED', eventType: { not: 'ERROR' } },
    orderBy: { createdAt: 'desc' },
  })
}

/** Get the OneDrive folder URL stored on the booking. */
export async function getBookingFolderUrl(bookingRef: string): Promise<string | null> {
  const ref = normalizeBookingRef(bookingRef)
  const b = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { onedriveFolderUrl: true },
  })
  return b?.onedriveFolderUrl ?? null
}

// ── Date-range targeted scan ──────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/** Derive (year, monthIndex) pairs covered by a date range. */
function monthsInRange(from: Date, to: Date): { year: number; month: number }[] {
  const pairs: { year: number; month: number }[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(),   to.getMonth(),   1)
  while (cur <= end) {
    pairs.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur.setMonth(cur.getMonth() + 1)
  }
  return pairs
}

/**
 * Scan a drive for booking folders that fall within a specific date range.
 * Walks Year → Month → [Date subfolder] → BookingFolder directly
 * without relying on delta tokens — useful for re-processing or backfills.
 */
export async function scanDriveByDateRange(
  cfg:      DriveConfig,
  dateFrom: Date,
  dateTo:   Date,
): Promise<ScanResult> {
  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
  } catch (err) {
    console.error(`[OneDrive] ${cfg.key}: drive ID resolve error:`, err)
    result.errors += 1
    return result
  }

  const rootPath = cfg.type === 'personal' ? cfg.rootFolder! : cfg.rootFolder_sp!
  const months   = monthsInRange(dateFrom, dateTo)

  for (const { year, month } of months) {
    const monthName  = MONTH_NAMES[month]
    const monthPath  = `${rootPath}/${year}/${monthName}`

    let monthChildren: DriveItem[]
    try {
      monthChildren = await listFolderChildren(driveId, monthPath)
    } catch {
      console.warn(`[OneDrive] ${cfg.key}: folder not found: ${monthPath}`)
      continue
    }

    // Each child is either a booking folder directly (SL) or a date subfolder (VN)
    for (const child of monthChildren) {
      result.scanned += 1

      if (child.folder && isBookingFolder(child)) {
        // Direct booking folder (SL-style)
        await processBookingFolderDirect(driveId, child, cfg, result)
      } else if (child.folder) {
        // Possible date subfolder (e.g. "02 June") — recurse one level
        let dateChildren: DriveItem[]
        try {
          dateChildren = await listFolderChildren(driveId, `${monthPath}/${child.name}`)
        } catch {
          continue
        }
        for (const dc of dateChildren) {
          result.scanned += 1
          if (dc.folder && isBookingFolder(dc)) {
            await processBookingFolderDirect(driveId, dc, cfg, result)
          }
        }
      }
    }
  }

  return result
}

/**
 * Search for a specific booking ref in a drive and process its files.
 * Uses Graph search API to locate the folder regardless of Year/Month position.
 */
export async function scanBookingRefInDrive(
  cfg:        DriveConfig,
  bookingRef: string,
): Promise<ScanResult> {
  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
  } catch (err) {
    result.errors += 1
    console.error(`[OneDrive] ${cfg.key}: drive resolve error:`, err)
    return result
  }

  let searchResults: DriveItem[]
  try {
    searchResults = await searchDriveItems(driveId, bookingRef)
  } catch (err) {
    result.errors += 1
    console.error(`[OneDrive] ${cfg.key}: search error for ${bookingRef}:`, err)
    return result
  }

  // Find the folder whose name starts with the booking ref
  const folder = searchResults.find(
    i => i.folder && extractRefFromFolderName(i.name) === bookingRef.toUpperCase(),
  )

  if (!folder) {
    console.warn(`[OneDrive] ${cfg.key}: folder not found for ref ${bookingRef}`)
    return result
  }

  result.scanned += 1
  await processBookingFolderDirect(driveId, folder, cfg, result)
  return result
}

// ── Shared booking-folder processor (used by both date-range and ref scan) ────

async function processBookingFolderDirect(
  driveId: string,
  folder:  DriveItem,
  cfg:     DriveConfig,
  result:  ScanResult,
): Promise<void> {
  const bookingRef = extractRefFromFolderName(folder.name)
  if (!bookingRef) return

  // List files inside this booking folder
  let files: DriveItem[]
  try {
    files = await listFolderChildren(driveId, buildRelativePath(folder))
  } catch {
    files = []
  }

  const folderWebUrl = folder.webUrl
  await upsertOneDriveEvent({
    driveType: cfg.key, itemId: folder.id, itemName: folder.name,
    itemPath: buildPath(folder), webUrl: folderWebUrl,
    eventType: 'FOLDER_DETECTED', bookingRef, status: 'PROCESSED',
  })

  if (folderWebUrl) {
    await prisma.booking.updateMany({ where: { bookingRef }, data: { onedriveFolderUrl: folderWebUrl } })
  }

  const tcFile  = files.find(f => f.file && isTCFile(f.name))
  const pnlFile = files.find(f => f.file && isPNLFile(f.name) && !f.name.toLowerCase().includes('agenda'))

  if (tcFile) {
    try {
      const r = await processTCFile(driveId, tcFile, bookingRef, cfg.country, folderWebUrl)
      if (r.isNew) result.bookingsCreated += 1; else result.bookingsUpdated += 1
      result.events.push({ ref: bookingRef, type: 'TC', file: tcFile.name })
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
        itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
        eventType: 'TC_PROCESSED', bookingRef, status: 'PROCESSED',
      })
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
        itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
        eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
      })
    }
  }

  if (pnlFile) {
    try {
      const lines = await processPNLFile(driveId, pnlFile, bookingRef)
      result.pnlsUpdated += 1
      result.events.push({ ref: bookingRef, type: 'PNL', file: pnlFile.name })
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
        itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
        eventType: 'PNL_PROCESSED', bookingRef, status: 'PROCESSED',
        rawData: JSON.stringify({ linesProcessed: lines }),
      })
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
        itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
        eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
      })
    }
  }

  // Other files
  for (const f of files) {
    if (f === tcFile || f === pnlFile || !f.file) continue
    if (f.name.toLowerCase().includes('agenda')) continue
    await upsertOneDriveEvent({
      driveType: cfg.key, itemId: f.id, itemName: f.name,
      itemPath: buildPath(f), webUrl: f.webUrl,
      eventType: 'FILE_DETECTED', bookingRef, status: 'PROCESSED',
    })
  }
}

function buildRelativePath(folder: DriveItem): string {
  // parentReference.path is like "/drives/{id}/root:/VN OPERATION/2026/June/02 June"
  const raw  = folder.parentReference?.path ?? ''
  const root = raw.replace(/^.*?root:\//, '') // strip up to root:/
  return root ? `${root}/${folder.name}` : folder.name
}

function normalizeBookingRef(ref: string) {
  return ref.trim().toUpperCase()
}
