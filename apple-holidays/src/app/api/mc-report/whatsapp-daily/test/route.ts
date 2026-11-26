/**
 * MC Report → "Test send": the selected daily plans go to one or two staff
 * test numbers instead of the guests — each plan as its own WhatsApp.
 *
 *  GET  — the caller's saved test numbers.
 *  PUT  — save them ({ numbers: [{ label, phone }] }, max 2).
 *  POST — send one chunk ({ rows: [{ bookingRef, date }], phones, banner, attachments }).
 *         The page calls this in small chunks so it can show live progress and stop
 *         mid-run. Only numbers on the caller's saved list are accepted.
 *
 * Test copies are tagged TAG_DAILY_BRIEFING_TEST, so the guest's real plan for
 * that day is never deduped away, and nothing reaches the Booking Logs.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendDailyBriefingForBooking } from '@/lib/customer-whatsapp-automation'
import { normalisePhone } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ALLOWED: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const MAX_NUMBERS = 2
const MAX_ROWS_PER_CALL = 20

type TestNumber = { label: string; phone: string }

const settingKey = (userId: string) => `mc_daily_test_numbers:${userId}`

function cleanNumbers(input: unknown): TestNumber[] | string {
  if (!Array.isArray(input)) return 'numbers must be a list'
  const out: TestNumber[] = []
  for (const n of input) {
    const phone = normalisePhone(String((n as TestNumber)?.phone ?? ''))
    if (!phone) continue
    if (phone.length < 8 || phone.length > 15) return `+${phone} is not a full international number`
    if (out.some(o => o.phone === phone)) continue
    out.push({ label: String((n as TestNumber)?.label ?? '').trim().slice(0, 40) || `Test ${out.length + 1}`, phone })
  }
  if (out.length > MAX_NUMBERS) return `Up to ${MAX_NUMBERS} test numbers`
  return out
}

async function readNumbers(userId: string): Promise<TestNumber[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: settingKey(userId) } })
  if (!row?.value) return []
  try {
    const parsed = cleanNumbers(JSON.parse(row.value))
    return typeof parsed === 'string' ? [] : parsed
  } catch { return [] }
}

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!ALLOWED.includes(session.user.role as UserRole)) return { error: buildApiError('Forbidden', 403) }
  return { userId: session.user.id as string }
}

export async function GET() {
  const g = await guard()
  if ('error' in g) return g.error
  return buildApiSuccess({ numbers: await readNumbers(g.userId), max: MAX_NUMBERS })
}

export async function PUT(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error
  const body = await req.json().catch(() => null) as { numbers?: unknown } | null
  const numbers = cleanNumbers(body?.numbers)
  if (typeof numbers === 'string') return buildApiError(numbers)
  const key = settingKey(g.userId)
  const value = JSON.stringify(numbers)
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  return buildApiSuccess({ numbers }, numbers.length ? 'Test numbers saved' : 'Test numbers cleared')
}

export async function POST(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error

  const body = await req.json().catch(() => null) as {
    rows?: { bookingRef: string; date: string }[]
    phones?: string[]
    banner?: boolean
    attachments?: boolean
  } | null

  const rows = Array.isArray(body?.rows)
    ? body!.rows.filter(r => r && typeof r.bookingRef === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    : []
  if (!rows.length) return buildApiError('Select at least one movement')
  if (rows.length > MAX_ROWS_PER_CALL) return buildApiError(`Send at most ${MAX_ROWS_PER_CALL} plans per call`)

  // Only the caller's own saved numbers — a typo can't send guest plans to a stranger.
  const saved = new Set((await readNumbers(g.userId)).map(n => n.phone))
  const phones = Array.from(new Set((body?.phones ?? []).map(p => normalisePhone(String(p))).filter(Boolean)))
  if (!phones.length) return buildApiError('Pick a test number')
  const unknown = phones.find(p => !saved.has(p))
  if (unknown) return buildApiError(`+${unknown} is not one of your saved test numbers`)

  const results: {
    bookingRef: string; date: string; phone: string
    ok: boolean; reason?: string; unconfirmed?: boolean; attachments?: number
  }[] = []

  for (const row of rows) {
    for (const phone of phones) {
      try {
        const r = await sendDailyBriefingForBooking(row.bookingRef, row.date, {
          force: true,
          allowEmpty: true,
          to: phone,
          test: { banner: body?.banner !== false, attachments: body?.attachments !== false },
        })
        results.push({
          bookingRef: row.bookingRef, date: row.date, phone, ok: r.ok,
          ...(r.ok ? { unconfirmed: r.unconfirmed, attachments: r.attachments } : { reason: r.reason }),
        })
      } catch (err) {
        results.push({ bookingRef: row.bookingRef, date: row.date, phone, ok: false, reason: err instanceof Error ? err.message : 'Send failed' })
      }
    }
  }

  const sent = results.filter(r => r.ok).length
  return buildApiSuccess({ results, sent, failed: results.length - sent })
}
