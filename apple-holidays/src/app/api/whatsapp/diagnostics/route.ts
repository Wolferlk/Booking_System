/**
 * What this deployment is actually sending with.
 *
 * ---- Why this exists ----
 *
 * A driver document that reads "sent" and never arrives has, by construction,
 * no evidence attached to it: the send returned 200, Meta reports the truth to
 * a webhook that belongs to n8n, and nobody at the desk can see either half.
 * Every explanation for it — the template, the number's quality rating, the
 * 24-hour window — is a guess until somebody can read the configuration this
 * host is running with and Meta's own opinion of it side by side.
 *
 * Local `.env` is not that configuration. This system runs on Amplify, where
 * the environment is set separately and has drifted before, so a diagnosis
 * built from a developer's `.env` can be an accurate description of the wrong
 * WhatsApp account entirely. This route answers from `process.env` as the
 * running server sees it, then asks Meta about those exact ids.
 *
 *   GET /api/whatsapp/diagnostics
 *
 * ---- What is deliberately not here ----
 *
 * No token, no secret, not even a truncated one. The questions worth asking are
 * "which number is this" and "is it allowed to send", and neither needs the
 * credential itself — only whether one is present and which account it points
 * at. A diagnostics page that leaks an access token is a worse problem than the
 * one it was opened to solve.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { readSendingNumberHealth } from '@/lib/whatsapp'
import { TEMPLATE_SETTLEMENT_DOCS, SETTLEMENT_DOCS_TEMPLATE_LANG } from '@/lib/sl-settlement-docs-notify'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

/** Admins only: this names the account the company sends as. */
const canRead = (role: UserRole) => role === 'SUPER_ADMIN' || role === 'ULTRA_SUPER_ADMIN'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canRead(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const wabaId        = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()

  const config = {
    apiVersion:        META_API_VERSION,
    phoneNumberId:     phoneNumberId ?? null,
    businessAccountId: wabaId ?? null,
    /** Present or absent — never the value. */
    hasAccessToken:    Boolean(accessToken),
    hasAppId:          Boolean((process.env.WHATSAPP_APP_ID || process.env.META_APP_ID)?.trim()),
    /** Without this the status webhook refuses n8n's forward with a 403. */
    hasInboundSignalSecret: Boolean(process.env.WHATSAPP_INBOUND_SIGNAL_SECRET?.trim()),
    settlementTemplate: TEMPLATE_SETTLEMENT_DOCS,
    templateLang:       SETTLEMENT_DOCS_TEMPLATE_LANG,
  }

  const [health, template, receipts, recent] = await Promise.all([
    readSendingNumberHealth(),
    templateState(accessToken, wabaId, TEMPLATE_SETTLEMENT_DOCS, SETTLEMENT_DOCS_TEMPLATE_LANG),
    receiptEvidence(),
    recentSends(),
  ])

  return buildApiSuccess({ config, numberHealth: health, template, receipts, recent })
}

/**
 * Meta's opinion of the template this host will actually use.
 *
 * Read by name from the running env rather than assumed, because the one thing
 * a misconfigured deployment will not tell you is that it is sending a template
 * nobody has been looking at.
 */
async function templateState(
  accessToken: string | undefined,
  wabaId: string | undefined,
  name: string,
  lang: string,
): Promise<{ found: boolean; status: string | null; category: string | null; language: string | null; quality: string | null; error: string | null }> {
  const miss = { found: false, status: null, category: null, language: null, quality: null, error: null as string | null }
  if (!accessToken || !wabaId) return { ...miss, error: 'WhatsApp credentials are not configured on this host.' }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/message_templates` +
        `?fields=${encodeURIComponent('name,language,status,category,quality_score')}` +
        `&name=${encodeURIComponent(name)}&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const json = await res.json() as {
      data?: Array<{ name?: string; language?: string; status?: string; category?: string; quality_score?: { score?: string } }>
      error?: { message?: string }
    }
    if (!res.ok) return { ...miss, error: json?.error?.message ?? `Graph API ${res.status}` }

    const all   = (json.data ?? []).filter(t => t.name === name)
    // The language matters as much as the name: a template approved in `en_US`
    // is not the template a send asking for `en` will find.
    const exact = all.find(t => String(t.language) === lang) ?? all[0] ?? null
    if (!exact) {
      return {
        ...miss,
        error: `No template named "${name}" exists on this WhatsApp account — every send outside the 24-hour window will fail with Meta error 132001.`,
      }
    }
    return {
      found:    true,
      status:   String(exact.status ?? '').toUpperCase() || null,
      category: exact.category ?? null,
      language: exact.language ?? null,
      quality:  exact.quality_score?.score ?? null,
      error: String(exact.language) !== lang
        ? `The template exists in "${exact.language}" but this host sends "${lang}" — a language mismatch fails as if the template did not exist.`
        : null,
    }
  } catch (err) {
    return { ...miss, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Has a Meta delivery receipt ever reached this system?
 *
 * `deliveredAt` and `readAt` are written by the receipt handler and by nothing
 * else, so their total absence is proof the webhook is not forwarding here —
 * the single fact that decides whether any status on any screen can be trusted.
 */
async function receiptEvidence() {
  try {
    const [everDelivered, lastReceipt, unconfirmed] = await Promise.all([
      prisma.driverDocSend.count({ where: { OR: [{ deliveredAt: { not: null } }, { readAt: { not: null } }] } }),
      prisma.driverDocSend.findFirst({
        where:   { OR: [{ deliveredAt: { not: null } }, { readAt: { not: null } }] },
        orderBy: { createdAt: 'desc' },
        select:  { bookingRef: true, deliveredAt: true, readAt: true },
      }),
      prisma.driverDocSend.count({ where: { status: { in: ['pending', 'accepted', 'held'] } } }),
    ])
    return {
      everReceived: everDelivered > 0,
      receiptCount: everDelivered,
      lastReceipt,
      unconfirmedSends: unconfirmed,
      note: everDelivered > 0
        ? 'Delivery receipts do reach this system.'
        : 'No delivery receipt has ever reached this system — n8n is not forwarding the statuses array to /api/webhooks/whatsapp-status-signal, so no send can ever be confirmed or corrected.',
    }
  } catch (err) {
    return { everReceived: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The last handful of sends, so a diagnosis can name real rows. */
async function recentSends() {
  try {
    const rows = await prisma.driverDocSend.findMany({
      orderBy: { createdAt: 'desc' },
      take:    10,
      select: {
        bookingRef: true, kind: true, audience: true, channel: true, status: true,
        waMessageId: true, failureReason: true, createdAt: true,
      },
    })
    // The wamid is what Meta files a receipt against; without it a send can
    // never be reconciled, so its presence is itself a diagnosis.
    return rows.map(r => ({ ...r, waMessageId: r.waMessageId ? `${r.waMessageId.slice(0, 24)}…` : null }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
