/**
 * Printing one booking's settlement paperwork.
 *
 *   POST  the pack in the body, rendered as PDF or as HTML. This is the path
 *         the editor uses, so what is previewed and what is downloaded is what
 *         is *on screen* — including edits that have not been saved yet. A
 *         preview that silently printed the last saved version would be a trap:
 *         the whole point of the screen is to check the sheet before it goes out.
 *   GET   the pack in force for a booking (saved if there is one, derived if
 *         not). For a plain link — a download with no editor open.
 *
 * `?docs=` picks the sheets, comma-separated, defaulting to all four in
 * printing order — which is what "download all in one" asks for: a single PDF
 * with the landscape name board first and the three portrait forms behind it.
 *
 * ---- Two ways to make the PDF ----
 *
 * Chromium on the server, when the host has one. When it does not — an arm64
 * server the bundled x64 Chromium cannot run on, for instance — the same HTML
 * is returned instead, marked `X-Print-Fallback: browser`, and the editor hands
 * it to the operator's own browser to print. It is the *same document* either
 * way, so the sheets are identical; only the machine that renders them differs,
 * and a host that later gains a Chromium starts returning PDFs again with no
 * change here or in the editor.
 *
 * Read-only in both databases. Rendering writes nothing; the POST body is
 * printed and discarded, never stored — saving is the other route's job.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { DOC_SLUG, parseDocKinds, parsePack, type SettlementDocPack } from '@/lib/sl-settlement-docs'
import { derivePack, packForPrint } from '@/lib/sl-settlement-docs-server'
import { buildDocsHtml, buildDocsPdf } from '@/lib/sl-settlement-docs-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Chromium needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

function refOf(req: NextRequest): string | null {
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim()
  return ref && ref.length <= 60 ? ref : null
}

/** "IS48514-transport-settlement.pdf", or the whole pack under one name. */
function fileName(pack: SettlementDocPack, kinds: string[]): string {
  const stem = (pack.header.tourNo || pack.bookingRef).replace(/[^A-Za-z0-9_-]+/g, '-')
  const tail = kinds.length === 1
    ? DOC_SLUG[kinds[0] as keyof typeof DOC_SLUG]
    : 'settlement-documents'
  return `${stem}-${tail}.pdf`
}

async function render(
  pack: SettlementDocPack,
  kindsRaw: string | null,
  format: string | null,
): Promise<Response> {
  const kinds = parseDocKinds(kindsRaw)

  // Framed by the editor's preview pane, or printed by the operator's browser:
  // served as a document rather than a download, and never cached — an edited
  // pack must never be answered with the previous render.
  const asHtml = async (fallback: boolean) => new Response(await buildDocsHtml(pack, kinds), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(fallback ? { 'X-Print-Fallback': 'browser', 'X-Print-Filename': fileName(pack, kinds) } : {}),
    },
  })

  if (format === 'html') return asHtml(false)

  try {
    const pdf = await buildDocsPdf(pack, kinds)
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName(pack, kinds)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    // Any rendering failure falls back rather than failing the download: the
    // desk needs the sheet in its hands, and the browser can print the very
    // same document. The reason is logged so a broken server-side renderer is
    // still visible to us rather than hidden behind a working print dialog.
    console.warn('[drive-log/documents/print] PDF rendering unavailable, returning HTML to print:',
      err instanceof Error ? err.message : err)
    return asHtml(true)
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const ref = refOf(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  try {
    const pack = await packForPrint(ref)
    if (!pack) return buildApiError(`Booking ${ref} was not found.`, 404)
    const sp = req.nextUrl.searchParams
    return await render(pack, sp.get('docs'), sp.get('format'))
  } catch (err) {
    console.error('[drive-log/documents/print GET]', err)
    return buildApiError(err instanceof Error ? err.message : 'The documents could not be generated.', 500)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const ref = refOf(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  let body: { pack?: unknown; docs?: string; format?: string }
  try {
    body = await req.json()
  } catch {
    return buildApiError('The request body was not valid JSON.', 400)
  }

  try {
    // The derived pack supplies the identity fields, so a browser cannot print
    // one booking's sheets under another's reference.
    const derived = await derivePack(ref)
    if (!derived) return buildApiError(`Booking ${ref} was not found.`, 404)

    const pack = parsePack(body.pack, derived.pack)
    return await render(pack, body.docs ?? null, body.format ?? null)
  } catch (err) {
    console.error('[drive-log/documents/print POST]', err)
    return buildApiError(err instanceof Error ? err.message : 'The documents could not be generated.', 500)
  }
}
