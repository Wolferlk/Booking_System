/**
 * Driver-Auto — the morning "open trips" message.
 *
 * Every morning (country-local `sendHour`) each active driver / vendor
 * registered for a country gets their personal trip-board link, IF that
 * country has at least one open trip. One message per party per channel per
 * local day: the UNIQUE (partyKey, sendDate, channel) index on
 * `driver_board_sends` is the guard, so the in-process scheduler, the cron
 * route and a staff "Send now" can never double-message anyone.
 *
 * WhatsApp goes as an approved template (TEMPLATE_DRIVER_BOARD) — drivers rarely
 * message the ops number, so free-form text would be dropped outside the 24h
 * window. Free-form is only the fallback when the template send fails AND the
 * driver is inside that window.
 */
import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'
import { isWithin24hWindow, normalisePhone, sendViaMetaTemplate, sendWhatsAppText } from '@/lib/whatsapp'
import { listOpenTrips } from './open-trips'
import {
  boardUrl, isDaTableMissing, localHour, localToday, partnerServes, readSettings,
  SETUP_MESSAGE,
} from './server'
import {
  DA_COUNTRIES, DA_COUNTRY_META, fmtTripDay, partyKey,
  type DaCountry, type DaSettings, type OpenTrip, type PartyType, type PartyView,
} from './shared'

export const TEMPLATE_DRIVER_BOARD =
  process.env.WHATSAPP_DRIVER_BOARD_TEMPLATE?.trim() || 'aahaas_driver_open_trips'
export const DRIVER_BOARD_TEMPLATE_LANG =
  process.env.WHATSAPP_DRIVER_TEMPLATE_LANG?.trim() || 'en'

/** The exact body submitted to Meta — also used to render the preview. */
export const DRIVER_BOARD_BODY =
  'Hi {{1}}, there are {{2}} open trips available in {{3}} ({{4}}).\n\n' +
  'Open your personal trip board to see them and request the ones you can drive:\n{{5}}\n\n' +
  'This link is personal to you, so please do not share it.'

export const DRIVER_BOARD_TEMPLATE_DEF = {
  name: TEMPLATE_DRIVER_BOARD,
  category: 'UTILITY',
  language: DRIVER_BOARD_TEMPLATE_LANG,
  bodyText: DRIVER_BOARD_BODY,
  bodyExamples: ['Nimal', '6', 'Sri Lanka', '04 Oct – 13 Oct', 'https://ops.aahaas.com/driver-board/d-cm1abc234?t=0123456789abcdef0123456789abcdef'],
  footerText: 'AppleHolidays Operations',
}

function param(v: string): string {
  const clean = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean || '—'
}

export function boardMessageParams(name: string, trips: OpenTrip[], country: DaCountry, link: string): string[] {
  const first = trips[0]?.startDate
  const last = trips.reduce((m, t) => (t.startDate > m ? t.startDate : m), first ?? '')
  const range = first ? (first === last ? fmtTripDay(first) : `${fmtTripDay(first)} – ${fmtTripDay(last)}`) : '—'
  return [param(name || 'Driver'), String(trips.length), DA_COUNTRY_META[country].label, param(range), link]
}

export function renderBody(params: string[]): string {
  return DRIVER_BOARD_BODY.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

// ── Recipients ───────────────────────────────────────────────────────────────

export interface Recipient {
  key: string
  type: PartyType
  id: string
  name: string
  phone: string | null
  email: string | null
  country: string | null
  vehicle: string | null
  capacity: number | null
}

/** Every active driver and (optionally) vendor registered for a country. */
export async function listParties(country: DaCountry, includeVendors: boolean): Promise<Recipient[]> {
  const countryValues = country === 'SINGAPORE' || country === 'MALAYSIA'
    ? [country, 'SINGAPORE_MALAYSIA' as const, 'ALL' as const]
    : [country, 'ALL' as const]

  const [drivers, vendors] = await Promise.all([
    prisma.driver.findMany({
      where: { isActive: true, country: { in: countryValues } },
      select: {
        id: true, name: true, phone: true, email: true, country: true,
        vehicle: { select: { type: true, plateNo: true, capacity: true } },
      },
      orderBy: { name: 'asc' },
    }),
    includeVendors
      ? prisma.vehicleVendor.findMany({
          where: { isActive: true, country: { in: countryValues } },
          select: { id: true, name: true, phone: true, whatsappPhone: true, email: true, country: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ])

  return [
    ...drivers.filter(d => partnerServes(d.country, country)).map(d => ({
      key: partyKey('DRIVER', d.id), type: 'DRIVER' as const, id: d.id, name: d.name,
      phone: d.phone || null, email: d.email || null, country: d.country ?? null,
      vehicle: d.vehicle ? [d.vehicle.type, d.vehicle.plateNo].filter(Boolean).join(' · ') : null,
      capacity: d.vehicle?.capacity ?? null,
    })),
    ...vendors.filter(v => partnerServes(v.country, country)).map(v => ({
      key: partyKey('VENDOR', v.id), type: 'VENDOR' as const, id: v.id, name: v.name,
      phone: v.whatsappPhone || v.phone || null, email: v.email || null, country: v.country ?? null,
      vehicle: null, capacity: null,
    })),
  ]
}

export async function partyViews(country: DaCountry, settings: DaSettings): Promise<PartyView[]> {
  const parties = await listParties(country, settings.countries[country].includeVendors)
  const last = new Map<string, { at: Date; status: string }>()
  try {
    const sends = await prisma.driverBoardSend.findMany({
      where: { partyKey: { in: parties.map(p => p.key) }, channel: 'whatsapp' },
      orderBy: { createdAt: 'desc' },
      select: { partyKey: true, createdAt: true, status: true },
      take: 2000,
    })
    for (const s of sends) if (!last.has(s.partyKey)) last.set(s.partyKey, { at: s.createdAt, status: s.status })
  } catch (err) {
    if (!isDaTableMissing(err)) throw err
  }
  return parties.map(p => ({
    key: p.key, type: p.type, id: p.id, name: p.name, phone: p.phone, email: p.email,
    country: p.country, vehicle: p.vehicle, capacity: p.capacity,
    excluded: settings.excluded.includes(p.key),
    lastSentAt: last.get(p.key)?.at.toISOString() ?? null,
    lastSendStatus: last.get(p.key)?.status ?? null,
    link: boardUrl(p.key, settings),
  }))
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface SendSummary {
  country: DaCountry
  sendDate: string
  trips: number
  recipients: number
  whatsappSent: number
  emailSent: number
  skipped: number
  failed: number
  dryRun: boolean
  reason?: string
  details: { name: string; channel: string; status: string; note?: string }[]
  preview?: string
}

async function alreadySent(key: string, sendDate: string, channel: string): Promise<boolean> {
  const row = await prisma.driverBoardSend.findUnique({
    where: { partyKey_sendDate_channel: { partyKey: key, sendDate, channel } },
    select: { status: true },
  })
  return !!row && row.status === 'sent'
}

async function record(data: {
  partyKey: string; partyName: string; country: string; sendDate: string; channel: string
  recipient: string | null; tripCount: number; status: string; waMessageId?: string | null
  error?: string | null; trigger: string; sentByName?: string | null
}) {
  // A failed attempt earlier today may be retried — the row is updated in place.
  await prisma.driverBoardSend.upsert({
    where: { partyKey_sendDate_channel: { partyKey: data.partyKey, sendDate: data.sendDate, channel: data.channel } },
    create: { ...data, waMessageId: data.waMessageId ?? null, error: data.error ?? null, sentByName: data.sentByName ?? null },
    update: {
      status: data.status, recipient: data.recipient, tripCount: data.tripCount,
      waMessageId: data.waMessageId ?? null, error: data.error ?? null,
      trigger: data.trigger, sentByName: data.sentByName ?? null,
    },
  })
}

function boardEmailHtml(name: string, trips: OpenTrip[], country: DaCountry, link: string): string {
  const esc = (s: string | null | undefined) =>
    String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
  const rows = trips.slice(0, 12).map(t => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;color:#334155;font-weight:600">${esc(fmtTripDay(t.startDate))}${t.days > 1 ? `<div style="font-weight:400;color:#94a3b8;font-size:11px">${t.days} days</div>` : ''}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eef2f7;color:#0f172a">${esc(t.kind === 'BOOKING' ? t.title : t.route)}<div style="color:#94a3b8;font-size:11px">${t.pax} guest(s)${t.startTime ? ` · ${esc(t.startTime)}` : ''}</div></td>
    </tr>`).join('')
  const more = trips.length > 12 ? `<p style="color:#64748b;font-size:12px;margin:10px 0 0">+ ${trips.length - 12} more on your board.</p>` : ''
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;border-radius:16px;padding:22px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24">Open trips · ${esc(DA_COUNTRY_META[country].label)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:6px">${trips.length} trip${trips.length === 1 ? '' : 's'} waiting for a driver</div>
    </div>
    <div style="background:#fff;border-radius:16px;padding:20px;margin-top:12px">
      <p style="margin:0 0 12px;color:#0f172a">Hi ${esc(name)}, these trips do not have a driver yet. Request the ones you can drive.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>${more}
      <div style="margin-top:18px"><a href="${esc(link)}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Open my trip board</a></div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">This link is personal to you — please do not share it.</p>
    </div>
  </div></body></html>`
}

/**
 * Send (or with dryRun, only plan) the morning message for one country.
 * `only` restricts to some party keys — used by "Send to this driver".
 */
export async function sendBoardLinks(opts: {
  country: DaCountry
  trigger: 'schedule' | 'manual'
  dryRun?: boolean
  only?: string[]
  sentByName?: string | null
  now?: Date
}): Promise<SendSummary> {
  const settings = await readSettings()
  const cs = settings.countries[opts.country]
  const now = opts.now ?? new Date()
  const sendDate = localToday(opts.country, now)
  const trips = await listOpenTrips(opts.country, settings.horizonDays, now)

  const summary: SendSummary = {
    country: opts.country, sendDate, trips: trips.length, recipients: 0,
    whatsappSent: 0, emailSent: 0, skipped: 0, failed: 0, dryRun: !!opts.dryRun, details: [],
  }

  const parties = (await listParties(opts.country, cs.includeVendors))
    .filter(p => !settings.excluded.includes(p.key))
    .filter(p => !opts.only || opts.only.includes(p.key))
  summary.recipients = parties.length

  if (parties[0]) {
    summary.preview = renderBody(boardMessageParams(parties[0].name, trips, opts.country, boardUrl(parties[0].key, settings)))
  }
  if (trips.length === 0) {
    summary.reason = 'No open trips in the window — nothing to send.'
    return summary
  }
  if (opts.dryRun) return summary

  // Fail loudly, once, when the tables are missing — rather than per driver.
  try {
    await prisma.driverBoardSend.count({ where: { sendDate } })
  } catch (err) {
    if (isDaTableMissing(err)) throw new Error(SETUP_MESSAGE)
    throw err
  }

  for (const p of parties) {
    const link = boardUrl(p.key, settings)
    const params = boardMessageParams(p.name, trips, opts.country, link)
    const base = { partyKey: p.key, partyName: p.name, country: opts.country, sendDate, tripCount: trips.length, trigger: opts.trigger, sentByName: opts.sentByName ?? null }

    // WhatsApp
    const phone = normalisePhone(p.phone ?? '')
    if (!phone) {
      summary.skipped++
      summary.details.push({ name: p.name, channel: 'whatsapp', status: 'skipped', note: 'no phone' })
    } else if (await alreadySent(p.key, sendDate, 'whatsapp')) {
      summary.skipped++
      summary.details.push({ name: p.name, channel: 'whatsapp', status: 'skipped', note: 'already sent today' })
    } else {
      try {
        let waMessageId: string | null = null
        let ok = false
        let note = ''
        try {
          const res = await sendViaMetaTemplate({ to: phone, templateName: TEMPLATE_DRIVER_BOARD, lang: DRIVER_BOARD_TEMPLATE_LANG, bodyParams: params })
          if (res) {
            ok = true
            waMessageId = (res.template as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null
          } else {
            note = 'WhatsApp not configured on this server'
          }
        } catch (err) {
          note = err instanceof Error ? err.message : String(err)
          // Template unapproved / missing — free-form still lands inside the 24h window.
          if (await isWithin24hWindow(phone)) {
            ok = await sendWhatsAppText(phone, renderBody(params), p.name)
            if (ok) note = 'sent free-form (template failed, inside 24h window)'
          }
        }
        await record({ ...base, channel: 'whatsapp', recipient: phone, status: ok ? 'sent' : 'failed', waMessageId, error: ok ? null : note })
        if (ok) {
          await prisma.whatsAppMessage.create({
            data: { bookingRef: 'DRIVER-BOARD', phone, direction: 'outbound', body: renderBody(params), waMessageId, status: 'sent', senderName: `[DRIVER-BOARD] ${p.name}` },
          }).catch(() => undefined)
          summary.whatsappSent++
        } else {
          summary.failed++
        }
        summary.details.push({ name: p.name, channel: 'whatsapp', status: ok ? 'sent' : 'failed', note: note || undefined })
      } catch (err) {
        summary.failed++
        summary.details.push({ name: p.name, channel: 'whatsapp', status: 'failed', note: err instanceof Error ? err.message : String(err) })
      }
    }

    // Email
    if (cs.emailEnabled && p.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) {
      if (await alreadySent(p.key, sendDate, 'email')) continue
      try {
        await sendMailViaGraph({
          to: p.email.trim(),
          subject: `${trips.length} open trip${trips.length === 1 ? '' : 's'} in ${DA_COUNTRY_META[opts.country].label} — request yours`,
          bodyHtml: boardEmailHtml(p.name, trips, opts.country, link),
        })
        await record({ ...base, channel: 'email', recipient: p.email.trim(), status: 'sent' })
        summary.emailSent++
        summary.details.push({ name: p.name, channel: 'email', status: 'sent' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await record({ ...base, channel: 'email', recipient: p.email.trim(), status: 'failed', error: msg }).catch(() => undefined)
        summary.failed++
        summary.details.push({ name: p.name, channel: 'email', status: 'failed', note: msg })
      }
    }
  }

  console.log(`[DriverAuto] ${opts.country} ${sendDate} (${opts.trigger}) — ${trips.length} trips, WA ${summary.whatsappSent}, email ${summary.emailSent}, skipped ${summary.skipped}, failed ${summary.failed}`)
  return summary
}

/**
 * Hourly tick: sends for every country whose auto-send is on and whose local
 * clock has reached `sendHour`. Late ticks (after a restart) still send the
 * same day — the once-a-day index stops a second send.
 */
export async function runScheduledBoardSends(now = new Date()): Promise<SendSummary[]> {
  const settings = await readSettings()
  const out: SendSummary[] = []
  for (const c of DA_COUNTRIES) {
    if (!settings.countries[c].autoSend) continue
    const hour = localHour(c, now)
    // Morning window only: from sendHour until noon, so a midnight restart does
    // not wake drivers up.
    if (hour < settings.sendHour || hour >= Math.max(settings.sendHour + 1, 12)) continue
    try {
      out.push(await sendBoardLinks({ country: c, trigger: 'schedule', now }))
    } catch (err) {
      console.error(`[DriverAuto] scheduled send ${c} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** Next scheduled send moment for a country, as an ISO string — for the UI. */
export function nextSendAt(country: DaCountry, settings: DaSettings, now = new Date()): string {
  const tz = DA_COUNTRY_META[country].tz
  // Offset of the zone right now, in minutes.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now)
  const off = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off)
  const offsetMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
  const today = localToday(country, now)
  let target = Date.parse(`${today}T${String(settings.sendHour).padStart(2, '0')}:00:00Z`) - offsetMin * 60_000
  if (target <= now.getTime()) target += 86_400_000
  return new Date(target).toISOString()
}

