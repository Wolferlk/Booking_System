/**
 * Server side of the customer brand switch — see customer-branding.ts.
 *
 * Read on every send, so the policy is cached briefly: a burst of daily-plan
 * messages costs one settings read, and a change in Settings is live within
 * half a minute. An unreadable row falls back to the default policy (name
 * hidden from guests), which is the safer mistake for a white-label sender.
 */

import { prisma } from '@/lib/prisma'
import {
  CUSTOMER_BRANDING_KEY, DEFAULT_CUSTOMER_BRANDING, makeBrandGuard, parseCustomerBranding,
  type BrandAudience, type BrandChannel, type BrandGuard, type CustomerBrandingPolicy,
} from '@/lib/customer-branding'

const TTL_MS = 30_000
let cached: { at: number; policy: CustomerBrandingPolicy } | null = null

export async function getCustomerBranding(): Promise<CustomerBrandingPolicy> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.policy
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: CUSTOMER_BRANDING_KEY } })
    const policy = parseCustomerBranding(row?.value)
    cached = { at: Date.now(), policy }
    return policy
  } catch {
    return { ...DEFAULT_CUSTOMER_BRANDING, hide: { ...DEFAULT_CUSTOMER_BRANDING.hide } }
  }
}

/** Forget the cached policy (call after saving the setting in this process). */
export function invalidateCustomerBranding() {
  cached = null
}

/** The rewriters for one send: `guard.text(msg)`, `guard.html(body)`, `guard.file(name)`. */
export async function brandGuard(channel: BrandChannel, audience: BrandAudience = 'guest'): Promise<BrandGuard> {
  return makeBrandGuard(await getCustomerBranding(), channel, audience)
}

/**
 * Make every string a PDFKit document draws pass through the guard — catches
 * brand text that arrives from the database (package notes, remarks) as well
 * as the generator's own literals. No-op when the name is shown.
 */
export function guardPdfText<T extends { text: (...args: any[]) => any }>(doc: T, guard: BrandGuard): T {
  if (!guard.hidden) return doc
  const original = doc.text.bind(doc)
  ;(doc as { text: (...args: any[]) => any }).text = (value: unknown, ...rest: any[]) =>
    original(typeof value === 'string' ? guard.text(value) : value, ...rest)
  return doc
}

/**
 * Rewrite a finished .docx: every text run in the body, headers and footers,
 * plus the document's "creator" property. One call at the end of a Word
 * builder covers literals and database text alike. No-op when shown.
 *
 * jszip is the library `docx` itself writes with, so it is always installed.
 */
export async function guardDocx(buffer: Buffer, guard: BrandGuard): Promise<Buffer> {
  if (!guard.hidden) return buffer
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fix = (inner: string) => escape(guard.text(unescape(inner)))
  const targets = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n) || n === 'docProps/core.xml')
  for (const name of targets) {
    const xml = await zip.file(name)!.async('string')
    if (!/apple/i.test(xml)) continue
    const out = xml
      .replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (_m, a: string, t: string, b: string) => a + fix(t) + b)
      .replace(/(<(dc:creator|cp:lastModifiedBy|dc:title|dc:description)>)([^<]*)(<\/\2>)/g, (_m, a: string, _tag: string, t: string, b: string) => a + fix(t) + b)
    zip.file(name, out)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
