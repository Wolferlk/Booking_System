/**
 * The sales pipeline half of the Daily Sales Report — Travel Quote GPT's day.
 *
 * Re-implements, against the read-only `sales-crm-db.ts` connection, the seven
 * sections of the n8n-project's "Aahaas BLR Daily Performance" digest
 * (`quote-crm/daily-digest.service.js` and the catalogue it compiles from):
 *
 *   1. quotation status    new quotations, amendments, confirmed out of quoted,
 *                          agencies, who raised them, consultants who quoted
 *   2. confirmations       orders confirmed in the window, by `confirmed_at`
 *   3. destinations        where the floor is quoting
 *   4. calls               manual and AI, answered, agencies reached
 *   5. signups             new agencies, self vs desk-onboarded, and by whom
 *   6. agency adoption     agencies using the AI themselves, prompts
 *   7. staff performance   one row per person, zeros kept
 *
 * …and then goes further than the digest can in an email: every row behind
 * those figures, an agency-by-agency join, a team roll-up and an activity
 * heatmap, which the workbook prints on separate sheets.
 *
 * ## Rules carried over from the digest, on purpose
 *
 *  - **A quotation is one `quotation_ref`**, dated by its first version.
 *    `AH500191/AMD2` is the same quotation coming back, not a second one.
 *  - **Ownership is the first internal author**, not whoever opened it — an
 *    agency raises version 1 and the consultant who quotes it writes the rest.
 *  - **Confirmations are dated by `confirmed_at`**, which the confirmation
 *    writes itself; cancelled and B2C confirmations are not counted.
 *  - **Connected means a person answered** — `answered` on an AI call, never
 *    the accepted-dial flag.
 *  - **An agent has no team of their own**: a partner's work counts for the
 *    team of whoever permanently handles their agency.
 *  - **A team report counts its people's dialling only** — an AI call belongs
 *    to whoever created the campaign, which is not that team's day on the phone.
 *  - **A source that could not be read is named, never zeroed.**
 *
 * One deliberate difference: *Amendments* here counts every amendment document
 * issued in the window, whichever day its quotation was first written — that is
 * the work the floor did today. The digest counts amendments within the day's
 * own new quotations only. The data-notes sheet says so.
 *
 * Read-only throughout. Every query is a SELECT through `crmQuery()`.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { crmQuery, isSalesCrmConfigured, optionalCol, probeSchema, type CrmSchema } from './sales-crm-db'
import { clockInTz, dateInTz } from './report-window'
import type { MoneyByCurrency } from './booking-lines'

import { SALES_TEAMS, normalizeSalesTeam, teamLabel, type SalesTeam } from './sales-teams'

export { SALES_TEAMS, normalizeSalesTeam, teamLabel, type SalesTeam }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineWindow {
  start: Date
  end: Date
  fromDate: string
  toDate: string
  timezone: string
}

export type CreatedByKind = 'staff' | 'agency' | 'unattributed'

export interface QuoteRow {
  ref: string
  issuedAt: string
  lastIssuedAt: string
  versions: number
  ownerName: string
  ownerEmail: string
  team: string | null
  createdBy: CreatedByKind
  agency: string | null
  destination: string | null
  trip: string | null
  nights: number | null
  pax: number | null
  travelDate: string | null
  currency: string | null
  latestTotal: number | null
  quoteStatus: string
  bookingStatus: string
  confirmationType: string | null
  confirmedAt: string | null
  confirmedOrderId: number | null
  /** First version issued inside the window — a new quotation. */
  isNew: boolean
  /** Amendment documents issued inside the window against this quotation. */
  amendmentsInWindow: number
  /** Confirmed (B2B, not cancelled) with `confirmed_at` inside the window. */
  confirmedInWindow: boolean
  /** Booking status is confirmed B2B — the cohort half of "confirmed out of quoted". */
  cohortConfirmed: boolean
}

export interface AmendmentRow {
  ref: string
  version: number
  issuedAt: string
  author: string
  authorEmail: string
  team: string | null
  agency: string | null
  destination: string | null
  currency: string | null
  total: number | null
  firstIssuedAt: string
}

export interface CallRow {
  at: string
  source: 'manual' | 'ai'
  actor: string
  actorEmail: string
  team: string | null
  agency: string | null
  contact: string | null
  outcome: string | null
  connected: boolean
  interested: boolean
  durationSecs: number | null
  campaign: string | null
}

export interface SignupRow {
  at: string
  name: string
  role: string
  audience: 'agency' | 'internal'
  agency: string | null
  source: 'Onboarded by our team' | 'Registered themselves' | 'Internal account'
  onboardedBy: string | null
  status: string
  team: string | null
}

export interface StaffRow {
  name: string
  role: string
  team: string | null
  leader: string | null
  newQuotes: number
  amendments: number
  cohortConfirmed: number
  confirmations: number
  manualCalls: number
  manualConnected: number
  aiCalls: number
  agenciesHandled: number
  agenciesContacted: number
  prompts: number
  quotedValue: MoneyByCurrency[]
  confirmedValue: MoneyByCurrency[]
}

export interface AgencyRow {
  agency: string
  team: string | null
  prompts: number
  aiUsers: number
  trips: number
  quotes: number
  byAgency: number
  byStaff: number
  amendments: number
  confirmed: number
  confirmations: number
  calls: number
  connected: number
}

export interface DestinationRow {
  destination: string
  quotes: number
  amendments: number
  confirmed: number
  confirmations: number
  quotedValue: MoneyByCurrency[]
}

export interface TeamRow {
  team: string
  label: string
  quotes: number
  amendments: number
  confirmations: number
  calls: number
  connected: number
  prompts: number
  signups: number
  people: number
}

export interface PipelineCounts {
  newQuotes: number
  amendments: number
  cohortConfirmed: number
  /** Cohort confirmed ÷ new quotations, 0–1. Null when nothing was quoted. */
  conversion: number | null
  agenciesQuotedFor: number
  agencyRaised: number
  staffRaised: number
  consultants: number
  confirmations: number
  quotedValue: MoneyByCurrency[]
  confirmedValue: MoneyByCurrency[]
  calls: {
    total: number; manual: number; ai: number
    connected: number; manualConnected: number; aiConnected: number
    rate: number | null; agenciesReached: number; talkSecs: number; interested: number
  }
  signups: { total: number; agencies: number; self: number; desk: number; internal: number; pending: number }
  adoption: { activeAgencies: number; agencyPrompts: number; staffPrompts: number; prompts: number; aiUsers: number; trips: number }
}

export interface ActivityLane {
  key: string
  label: string
  values: number[]
}

export interface PipelineSection {
  available: boolean
  configured: boolean
  /** Why the whole pipeline is missing, when it is. */
  error: string | null
  team: { key: SalesTeam; label: string } | null
  /** One line per section that could not be read. Printed in the mail. */
  warnings: string[]
  counts: PipelineCounts
  previous: PipelineCounts | null
  quotes: QuoteRow[]
  amendments: AmendmentRow[]
  calls: CallRow[]
  signups: SignupRow[]
  onboarders: { name: string; count: number }[]
  destinations: DestinationRow[]
  agencies: AgencyRow[]
  /** Work with no agency on it — direct business, reported beside the ranking. */
  direct: AgencyRow | null
  staff: StaffRow[]
  teams: TeamRow[]
  /** Activity by local hour (one day) or by date (a span), per lane. */
  activity: { axis: 'hour' | 'date'; labels: string[]; lanes: ActivityLane[] }
}

export function emptyCounts(): PipelineCounts {
  return {
    newQuotes: 0, amendments: 0, cohortConfirmed: 0, conversion: null, agenciesQuotedFor: 0,
    agencyRaised: 0, staffRaised: 0, consultants: 0, confirmations: 0, quotedValue: [], confirmedValue: [],
    calls: { total: 0, manual: 0, ai: 0, connected: 0, manualConnected: 0, aiConnected: 0, rate: null, agenciesReached: 0, talkSecs: 0, interested: 0 },
    signups: { total: 0, agencies: 0, self: 0, desk: 0, internal: 0, pending: 0 },
    adoption: { activeAgencies: 0, agencyPrompts: 0, staffPrompts: 0, prompts: 0, aiUsers: 0, trips: 0 },
  }
}

function unavailable(error: string, team: PipelineSection['team'], configured: boolean): PipelineSection {
  return {
    available: false, configured, error, team, warnings: [error], counts: emptyCounts(), previous: null,
    quotes: [], amendments: [], calls: [], signups: [], onboarders: [], destinations: [], agencies: [],
    direct: null, staff: [], teams: [], activity: { axis: 'hour', labels: [], lanes: [] },
  }
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const OUTSIDE_ROLES = new Set(['partner', 'guest', 'customer'])
const CONFIRMED = 'confirmed'
const CANCELLED = 'cancelled'
/** Rows a single read may return. A month of a busy floor is well inside it. */
const ROW_CAP = 25_000
const IN_CHUNK = 500

function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}

/** A `YYYY-MM-DD HH:MM:SS` UTC wall-clock string → ISO instant. */
function iso(v: unknown): string {
  if (!v) return ''
  const s = String(v)
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`)
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function clean(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s : null
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
const agencyKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

function chunks<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function addMoney(map: Map<string, number>, currency: string | null, amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return
  const c = (currency || 'Unpriced').toUpperCase()
  map.set(c, (map.get(c) ?? 0) + amount)
}

function moneyList(map: Map<string, number>): MoneyByCurrency[] {
  return Array.from(map.entries()).map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
}

// ─── Reference data: people, agencies, handlers ──────────────────────────────

interface UserRef {
  id: number
  email: string
  name: string
  role: string
  agency: string | null
  reportsTo: number | null
  status: string
  team: string | null
}

interface Reference {
  byEmail: Map<string, UserRef>
  byId: Map<number, UserRef>
  /** agencyKey → office team, through the agency's permanent handler. */
  agencyTeam: Map<string, string>
  /** handler email → agencies they permanently handle. */
  handled: Map<string, number>
}

interface UserDbRow extends RowDataPacket {
  id: number; email: string | null; name: string | null; role: string | null
  agency_name: string | null; reports_to: number | null; status: string | null; work_team: string | null
}

interface HandlerDbRow extends RowDataPacket { scope: string; subject_id: string | null; handler_email: string | null }

async function loadReference(schema: CrmSchema): Promise<Reference> {
  const has = (c: string) => schema.has('ai_users', c)
  const rows = await crmQuery<UserDbRow>(
    `SELECT u.id, LOWER(u.email) AS email, ${has('name') ? 'u.name' : 'NULL'} AS name, u.role,
            ${has('agency_name') ? 'u.agency_name' : 'NULL'} AS agency_name,
            ${has('reports_to') ? 'u.reports_to' : 'NULL'} AS reports_to,
            ${has('status') ? 'u.status' : 'NULL'} AS status,
            ${optionalCol(schema, 'ai_users', 'u.work_team', 'work_team', 'work_team')}
       FROM ai_users u
      WHERE u.role IN ('partner', 'staff', 'leader', 'manager', 'super_admin')
      LIMIT 60000`,
  )
  const byEmail = new Map<string, UserRef>()
  const byId = new Map<number, UserRef>()
  for (const r of rows) {
    const u: UserRef = {
      id: Number(r.id),
      email: lower(r.email),
      name: clean(r.name) ?? lower(r.email),
      role: lower(r.role),
      agency: clean(r.agency_name),
      reportsTo: n(r.reports_to),
      status: lower(r.status) || 'active',
      team: clean(r.work_team)?.toLowerCase() ?? null,
    }
    if (u.email) byEmail.set(u.email, u)
    byId.set(u.id, u)
  }

  const agencyTeam = new Map<string, string>()
  const handled = new Map<string, number>()
  if (schema.has('tbl_future_travel_quote_handler', 'handler_email')) {
    const handlers = await crmQuery<HandlerDbRow>(
      `SELECT h.scope, h.subject_id, LOWER(h.handler_email) AS handler_email
         FROM tbl_future_travel_quote_handler h
        WHERE h.scope IN ('agency', 'account')
        LIMIT 60000`,
    )
    // An agency's anchor is its lowest partner id — the key the handler rows
    // are written against, the same anchor the agency book uses.
    const anchorOf = new Map<number, string>()
    const minByAgency = new Map<string, number>()
    byId.forEach(u => {
      if (u.role !== 'partner' || !u.agency) return
      const k = agencyKey(u.agency)
      const cur = minByAgency.get(k)
      if (cur === undefined || u.id < cur) minByAgency.set(k, u.id)
    })
    minByAgency.forEach((id, k) => anchorOf.set(id, k))

    const viaAgency = new Map<string, string>()
    const viaAccount = new Map<string, string>()
    for (const h of handlers) {
      const anchor = anchorOf.get(Number(h.subject_id))
      const handler = byEmail.get(lower(h.handler_email))
      if (h.scope === 'agency' && h.handler_email) {
        handled.set(lower(h.handler_email), (handled.get(lower(h.handler_email)) ?? 0) + 1)
      }
      if (!anchor || !handler?.team) continue
      if (h.scope === 'agency' && !viaAgency.has(anchor)) viaAgency.set(anchor, handler.team)
      if (h.scope === 'account' && !viaAccount.has(anchor)) viaAccount.set(anchor, handler.team)
    }
    // The permanent handler wins; the account manager is the fallback.
    viaAccount.forEach((t, k) => agencyTeam.set(k, t))
    viaAgency.forEach((t, k) => agencyTeam.set(k, t))
  }

  return { byEmail, byId, agencyTeam, handled }
}

/** A person's team: their own pick, or — for an agent — their agency's. */
function teamOf(ref: Reference, u: UserRef | undefined | null): string | null {
  if (!u) return null
  if (u.role === 'partner') return u.agency ? ref.agencyTeam.get(agencyKey(u.agency)) ?? null : null
  return u.team
}

// ─── Raw reads for one window ─────────────────────────────────────────────────

interface VersionDbRow extends RowDataPacket {
  quotation_ref: string; version: number | null; portfolio_id: string | null; user_email: string | null
  trip_title: string | null; country: string | null; currency: string | null; payable_total: string | number | null
  nights: number | null; created_at: string; confirmed_order_id: number | null; confirmed_at: string | null
}
interface StateDbRow extends RowDataPacket {
  portfolio_id: string; quote_status: string | null; booking_status: string | null
  agency_id: number | null; quoted_as_id: number | null; confirmation_type: string | null
}
interface PortfolioDbRow extends RowDataPacket {
  portfolio_id: string; name: string | null; country: string | null
  adults: number | null; children: number | null; start_date: string | null
}
interface RefDbRow extends RowDataPacket { quotation_ref: string }

interface QuoteRead { quotes: QuoteRow[]; amendments: AmendmentRow[] }

async function readQuotes(schema: CrmSchema, ref: Reference, w: PipelineWindow): Promise<QuoteRead> {
  const Q = 'tbl_future_travel_quotation'
  if (!schema.has(Q, 'quotation_ref') || !schema.has(Q, 'created_at')) {
    throw new Error('the quotation table is not readable')
  }
  const from = utcStamp(w.start)
  const to = utcStamp(w.end)
  const hasConfirmedAt = schema.has(Q, 'confirmed_at')

  const [touched, confirmed] = await Promise.all([
    crmQuery<RefDbRow>(
      `SELECT DISTINCT q.quotation_ref FROM ${Q} q
        WHERE q.created_at >= ? AND q.created_at < ? LIMIT ${ROW_CAP}`, [from, to]),
    hasConfirmedAt
      ? crmQuery<RefDbRow>(
          `SELECT DISTINCT q.quotation_ref FROM ${Q} q
            WHERE q.confirmed_at >= ? AND q.confirmed_at < ? LIMIT ${ROW_CAP}`, [from, to])
      : Promise.resolve([] as RefDbRow[]),
  ])
  const refs = Array.from(new Set([...touched, ...confirmed].map(r => r.quotation_ref).filter(Boolean)))
  if (!refs.length) return { quotes: [], amendments: [] }

  const col = (c: string, expr = `q.${c}`) => optionalCol(schema, Q, expr, c, c)
  const versions: VersionDbRow[] = []
  for (const part of chunks(refs)) {
    versions.push(...await crmQuery<VersionDbRow>(
      `SELECT q.quotation_ref, ${col('version')}, ${col('portfolio_id')}, LOWER(q.user_email) AS user_email,
              ${col('trip_title')}, ${col('country')}, ${col('currency')}, ${col('payable_total')}, ${col('nights')},
              q.created_at, ${col('confirmed_order_id')}, ${col('confirmed_at')}
         FROM ${Q} q
        WHERE q.quotation_ref IN (?)
        ORDER BY q.quotation_ref, q.created_at`, [part]))
  }

  const portfolioIds = Array.from(new Set(versions.map(v => v.portfolio_id).filter((p): p is string => !!p)))
  const states = new Map<string, StateDbRow>()
  const portfolios = new Map<string, PortfolioDbRow>()
  const S = 'tbl_future_travel_quote_state'
  const P = 'tbl_future_travel_portfolio'
  if (portfolioIds.length && schema.has(S, 'portfolio_id')) {
    const sc = (c: string) => optionalCol(schema, S, `s.${c}`, c, c)
    for (const part of chunks(portfolioIds)) {
      for (const r of await crmQuery<StateDbRow>(
        `SELECT s.portfolio_id, ${sc('quote_status')}, ${sc('booking_status')}, ${sc('agency_id')},
                ${sc('quoted_as_id')}, ${sc('confirmation_type')}
           FROM ${S} s WHERE s.portfolio_id IN (?)`, [part])) states.set(String(r.portfolio_id), r)
    }
  }
  if (portfolioIds.length && schema.has(P, 'portfolio_id')) {
    // The plan lives in a LONGTEXT; one malformed blob must not fail the read.
    const plan = (path: string, cast: boolean) => schema.has(P, 'data')
      ? `CASE WHEN JSON_VALID(p.data) THEN ${cast ? `CAST(JSON_EXTRACT(p.data, '${path}') AS SIGNED)` : `JSON_UNQUOTE(JSON_EXTRACT(p.data, '${path}'))`} ELSE NULL END`
      : 'NULL'
    const kids = schema.has(P, 'data')
      ? `CASE WHEN JSON_VALID(p.data) AND JSON_TYPE(JSON_EXTRACT(p.data, '$.pax.children_ages')) = 'ARRAY' THEN JSON_LENGTH(JSON_EXTRACT(p.data, '$.pax.children_ages')) ELSE NULL END`
      : 'NULL'
    for (const part of chunks(portfolioIds)) {
      for (const r of await crmQuery<PortfolioDbRow>(
        `SELECT p.portfolio_id, ${optionalCol(schema, P, 'p.name', 'name', 'name')}, ${optionalCol(schema, P, 'p.country', 'country', 'country')},
                ${plan('$.pax.adults', true)} AS adults, ${kids} AS children, ${plan('$.trip.start_date', false)} AS start_date
           FROM ${P} p WHERE p.portfolio_id IN (?)`, [part])) portfolios.set(String(r.portfolio_id), r)
    }
  }

  const byRef = new Map<string, VersionDbRow[]>()
  for (const v of versions) {
    const list = byRef.get(v.quotation_ref) ?? []
    list.push(v)
    byRef.set(v.quotation_ref, list)
  }

  const startMs = w.start.getTime()
  const endMs = w.end.getTime()
  const inWindow = (s: string) => { const t = Date.parse(s); return t >= startMs && t < endMs }

  const quotes: QuoteRow[] = []
  const amendments: AmendmentRow[] = []

  byRef.forEach((list, quotationRef) => {
    list.sort((a, b) => (n(a.version) ?? 0) - (n(b.version) ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
    const first = list[0]
    const latest = list[list.length - 1]
    // Ownership: the FIRST INTERNAL author, falling back to whoever opened it.
    const internal = list.find(v => { const u = ref.byEmail.get(lower(v.user_email)); return !!u && u.role !== 'partner' })
    const ownerEmail = lower((internal ?? first).user_email)
    const owner = ref.byEmail.get(ownerEmail)
    const originator = ref.byEmail.get(lower(first.user_email))
    const createdBy: CreatedByKind = !originator ? 'unattributed' : originator.role === 'partner' ? 'agency' : 'staff'

    const state = first.portfolio_id ? states.get(String(first.portfolio_id)) : undefined
    const portfolio = first.portfolio_id ? portfolios.get(String(first.portfolio_id)) : undefined
    const agencyUser = ref.byId.get(Number(state?.quoted_as_id ?? state?.agency_id ?? NaN))
    const agency = clean(agencyUser?.agency) ?? clean(owner?.agency) ?? null

    const bookingStatus = lower(state?.booking_status) || 'pending'
    const confirmationType = lower(state?.confirmation_type) || null
    const notB2c = (confirmationType ?? 'b2b') !== 'b2c'
    const confirmedAtRaw = list.map(v => v.confirmed_at).filter(Boolean).sort()[0] ?? null
    const confirmedOrderId = list.map(v => n(v.confirmed_order_id)).filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null
    const confirmedAt = confirmedAtRaw ? iso(confirmedAtRaw) : null

    const firstIso = iso(first.created_at)
    const isNew = inWindow(firstIso)
    let amendmentsInWindow = 0
    list.forEach((v, i) => {
      if (i === 0) return
      const at = iso(v.created_at)
      if (!inWindow(at)) return
      amendmentsInWindow++
      const author = ref.byEmail.get(lower(v.user_email))
      amendments.push({
        ref: quotationRef,
        version: n(v.version) ?? i + 1,
        issuedAt: at,
        author: author?.name ?? (lower(v.user_email) || 'Unattributed'),
        authorEmail: lower(v.user_email),
        team: teamOf(ref, author ?? owner),
        agency,
        destination: clean(v.country) ?? clean(latest.country) ?? clean(portfolio?.country),
        currency: clean(v.currency),
        total: n(v.payable_total),
        firstIssuedAt: firstIso,
      })
    })

    const adults = n(portfolio?.adults)
    const children = n(portfolio?.children)
    quotes.push({
      ref: quotationRef,
      issuedAt: firstIso,
      lastIssuedAt: iso(latest.created_at),
      versions: list.length,
      ownerName: owner?.name ?? (ownerEmail || 'Unattributed'),
      ownerEmail,
      team: teamOf(ref, owner),
      createdBy,
      agency,
      destination: clean(latest.country) ?? clean(portfolio?.country),
      trip: clean(latest.trip_title) ?? clean(portfolio?.name),
      nights: list.reduce<number | null>((m, v) => { const x = n(v.nights); return x === null ? m : Math.max(m ?? 0, x) }, null),
      pax: adults === null && children === null ? null : (adults ?? 0) + (children ?? 0),
      travelDate: clean(portfolio?.start_date)?.slice(0, 10) ?? null,
      currency: clean(latest.currency),
      latestTotal: n(latest.payable_total),
      quoteStatus: lower(state?.quote_status) || 'generated',
      bookingStatus,
      confirmationType,
      confirmedAt,
      confirmedOrderId,
      isNew,
      amendmentsInWindow,
      confirmedInWindow: !!confirmedAt && inWindow(confirmedAt) && confirmedOrderId !== null
        && bookingStatus !== CANCELLED && notB2c,
      cohortConfirmed: bookingStatus === CONFIRMED && notB2c,
    })
  })

  quotes.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
  amendments.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
  return { quotes, amendments }
}

interface ManualCallDbRow extends RowDataPacket {
  occurred_at: string; actor_email: string | null; actor_name: string | null; agency_name: string | null
  contact_name: string | null; outcome: string | null; connected: number | null; interested: number | null; campaign_id: string | null
}
interface AiCallDbRow extends RowDataPacket {
  created_at: string; outcome: string | null; answered: number | null; campaign_id: string | null
  duration_secs: number | null; company: string | null; lead_name: string | null; interest: string | null
  creator_email: string | null; creator_name: string | null
}

async function readCalls(schema: CrmSchema, ref: Reference, w: PipelineWindow): Promise<{ calls: CallRow[]; missing: string[] }> {
  const from = utcStamp(w.start)
  const to = utcStamp(w.end)
  const A = 'tbl_future_travel_crm_activity'
  const C = 'tbl_sales_call'
  const missing: string[] = []
  const calls: CallRow[] = []

  if (schema.has(A, 'activity_type') && schema.has(A, 'occurred_at')) {
    const ac = (c: string) => optionalCol(schema, A, `a.${c}`, c, c)
    const rows = await crmQuery<ManualCallDbRow>(
      `SELECT a.occurred_at, LOWER(a.actor_email) AS actor_email, ${ac('actor_name')}, ${ac('agency_name')},
              ${ac('contact_name')}, ${ac('outcome')}, ${ac('connected')}, ${ac('interested')}, ${ac('campaign_id')}
         FROM ${A} a
        WHERE a.activity_type = 'manual_call'
          ${schema.has(A, 'deleted_at') ? 'AND a.deleted_at IS NULL' : ''}
          AND a.occurred_at >= ? AND a.occurred_at < ?
        LIMIT ${ROW_CAP}`, [from, to])
    for (const r of rows) {
      const u = ref.byEmail.get(lower(r.actor_email))
      calls.push({
        at: iso(r.occurred_at), source: 'manual',
        actor: u?.name ?? clean(r.actor_name) ?? (lower(r.actor_email) || 'Unknown'),
        actorEmail: lower(r.actor_email), team: teamOf(ref, u),
        agency: clean(r.agency_name), contact: clean(r.contact_name), outcome: clean(r.outcome),
        connected: Number(r.connected) === 1, interested: Number(r.interested) === 1,
        durationSecs: null, campaign: clean(r.campaign_id),
      })
    }
  } else missing.push('manual calls (CRM activity table not readable)')

  if (schema.has(C, 'created_at')) {
    const cc = (c: string) => optionalCol(schema, C, `c.${c}`, c, c)
    const L = 'tbl_sales_lead'
    const leadJoin = schema.has(L, 'id') && schema.has(C, 'lead_id')
    const campJoin = schema.has('tbl_sales_campaign', 'slug') && schema.has(C, 'campaign_id')
    const rows = await crmQuery<AiCallDbRow>(
      `SELECT c.created_at, ${cc('outcome')}, ${cc('answered')}, ${cc('campaign_id')}, ${cc('duration_secs')},
              ${leadJoin ? optionalCol(schema, L, 'l.company', 'company', 'company') : 'NULL AS company'},
              ${leadJoin ? optionalCol(schema, L, 'l.name', 'name', 'lead_name') : 'NULL AS lead_name'},
              ${leadJoin ? optionalCol(schema, L, 'l.interest', 'interest', 'interest') : 'NULL AS interest'},
              ${campJoin ? optionalCol(schema, 'tbl_sales_campaign', 'LOWER(cp.created_by_email)', 'created_by_email', 'creator_email') : 'NULL AS creator_email'},
              ${campJoin ? optionalCol(schema, 'tbl_sales_campaign', 'cp.created_by_name', 'created_by_name', 'creator_name') : 'NULL AS creator_name'}
         FROM ${C} c
         ${leadJoin ? `LEFT JOIN ${L} l ON l.id = c.lead_id` : ''}
         ${campJoin ? 'LEFT JOIN tbl_sales_campaign cp ON cp.slug = c.campaign_id' : ''}
        WHERE c.created_at >= ? AND c.created_at < ?
        LIMIT ${ROW_CAP}`, [from, to])
    for (const r of rows) {
      const u = ref.byEmail.get(lower(r.creator_email))
      calls.push({
        at: iso(r.created_at), source: 'ai',
        actor: u?.name ?? clean(r.creator_name) ?? 'AI caller',
        actorEmail: lower(r.creator_email), team: teamOf(ref, u),
        agency: clean(r.company), contact: clean(r.lead_name), outcome: clean(r.outcome),
        // ⚠️ answered, never the accepted-dial flag.
        connected: Number(r.answered) === 1,
        interested: ['yes', 'high', 'interested'].includes(lower(r.interest)),
        durationSecs: n(r.duration_secs), campaign: clean(r.campaign_id),
      })
    }
  } else missing.push('AI calls (sales call table not readable)')

  calls.sort((a, b) => b.at.localeCompare(a.at))
  return { calls, missing }
}

interface PromptPairDbRow extends RowDataPacket { email: string | null; portfolio_id: string | null; n: number }
interface PromptHourDbRow extends RowDataPacket { email: string | null; hr: string; n: number }

interface PromptRead { pairs: PromptPairDbRow[]; hours: PromptHourDbRow[] }

async function readPrompts(schema: CrmSchema, w: PipelineWindow): Promise<PromptRead> {
  const M = 'tbl_future_travel_message'
  if (!schema.has(M, 'role') || !schema.has(M, 'created_at')) throw new Error('the prompt log is not readable')
  const from = utcStamp(w.start)
  const to = utcStamp(w.end)
  const trip = schema.has(M, 'portfolio_id') ? 'm.portfolio_id' : 'NULL'
  const [pairs, hours] = await Promise.all([
    crmQuery<PromptPairDbRow>(
      `SELECT LOWER(m.user_email) AS email, ${trip} AS portfolio_id, COUNT(*) AS n
         FROM ${M} m
        WHERE m.role = 'user' AND m.created_at >= ? AND m.created_at < ?
        GROUP BY LOWER(m.user_email), ${trip}
        LIMIT ${ROW_CAP}`, [from, to]),
    crmQuery<PromptHourDbRow>(
      `SELECT LOWER(m.user_email) AS email, DATE_FORMAT(m.created_at, '%Y-%m-%d %H:00:00') AS hr, COUNT(*) AS n
         FROM ${M} m
        WHERE m.role = 'user' AND m.created_at >= ? AND m.created_at < ?
        GROUP BY LOWER(m.user_email), DATE_FORMAT(m.created_at, '%Y-%m-%d %H:00:00')
        LIMIT ${ROW_CAP}`, [from, to]),
  ])
  return { pairs, hours }
}

interface SignupDbRow extends RowDataPacket {
  id: number; name: string | null; role: string | null; agency_name: string | null; status: string | null
  created_at: string; crm_source: string | null; crm_created_by: number | null; work_team: string | null
}

async function readSignups(schema: CrmSchema, ref: Reference, w: PipelineWindow): Promise<SignupRow[]> {
  if (!schema.has('ai_users', 'created_at')) throw new Error('the account table has no created_at')
  const uc = (c: string) => optionalCol(schema, 'ai_users', `u.${c}`, c, c)
  const rows = await crmQuery<SignupDbRow>(
    `SELECT u.id, ${uc('name')}, u.role, ${uc('agency_name')}, ${uc('status')}, u.created_at,
            ${uc('crm_source')}, ${uc('crm_created_by')}, ${uc('work_team')}
       FROM ai_users u
      WHERE u.created_at >= ? AND u.created_at < ?
      ORDER BY u.created_at DESC
      LIMIT ${ROW_CAP}`, [utcStamp(w.start), utcStamp(w.end)])
  return rows.map(r => {
    const role = lower(r.role)
    // Same line as the digest: partners and guests are the outside world.
    const outside = role === 'partner' || role === 'guest'
    const desk = outside && lower(r.crm_source) === 'desk'
    const onboarder = r.crm_created_by ? ref.byId.get(Number(r.crm_created_by)) : undefined
    const agency = clean(r.agency_name)
    const team = outside
      ? (agency ? ref.agencyTeam.get(agencyKey(agency)) ?? null : null) ?? (desk ? teamOf(ref, onboarder) : null)
      : clean(r.work_team)?.toLowerCase() ?? null
    return {
      at: iso(r.created_at),
      name: clean(r.name) ?? `Account #${r.id}`,
      role,
      audience: outside ? 'agency' : 'internal',
      agency,
      source: !outside ? 'Internal account' : desk ? 'Onboarded by our team' : 'Registered themselves',
      onboardedBy: desk ? onboarder?.name ?? 'Unknown colleague' : null,
      status: lower(r.status) || 'active',
      team,
    }
  })
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

interface WindowRead {
  quotes: QuoteRow[]
  amendments: AmendmentRow[]
  calls: CallRow[]
  prompts: PromptRead
  signups: SignupRow[]
  warnings: string[]
  /** Which reads failed, so their figures are reported unavailable, not zero. */
  failed: Set<'quotes' | 'calls' | 'prompts' | 'signups'>
}

async function readWindow(schema: CrmSchema, ref: Reference, w: PipelineWindow): Promise<WindowRead> {
  const warnings: string[] = []
  const failed = new Set<'quotes' | 'calls' | 'prompts' | 'signups'>()
  const guard = async <T>(key: 'quotes' | 'calls' | 'prompts' | 'signups', label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch (err) {
      failed.add(key)
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`${label} could not be read — ${msg}`)
      console.warn(`[SalesReport] ${label} read failed:`, msg)
      return fallback
    }
  }
  const [q, c, p, s] = await Promise.all([
    guard('quotes', 'Quotations', () => readQuotes(schema, ref, w), { quotes: [], amendments: [] } as QuoteRead),
    guard('calls', 'Calls', () => readCalls(schema, ref, w), { calls: [] as CallRow[], missing: [] as string[] }),
    guard('prompts', 'AI prompts', () => readPrompts(schema, w), { pairs: [], hours: [] } as PromptRead),
    guard('signups', 'Signups', () => readSignups(schema, ref, w), [] as SignupRow[]),
  ])
  for (const m of c.missing) warnings.push(`Calls: ${m}`)
  return { quotes: q.quotes, amendments: q.amendments, calls: c.calls, prompts: p, signups: s, warnings, failed }
}

/** Narrow a window's rows to one office team. Unchanged when no team is set. */
function filterTeam(read: WindowRead, ref: Reference, team: SalesTeam | null): WindowRead {
  if (!team) return read
  const userTeam = (email: string | null) => teamOf(ref, ref.byEmail.get(lower(email)))
  return {
    ...read,
    quotes: read.quotes.filter(q => q.team === team),
    amendments: read.amendments.filter(a => a.team === team),
    // A team report counts its people's dialling only.
    calls: read.calls.filter(c => c.source === 'manual' && c.team === team),
    prompts: {
      pairs: read.prompts.pairs.filter(p => userTeam(p.email) === team),
      hours: read.prompts.hours.filter(h => userTeam(h.email) === team),
    },
    signups: read.signups.filter(s => s.team === team),
  }
}

function countsOf(read: WindowRead, ref: Reference): PipelineCounts {
  const fresh = read.quotes.filter(q => q.isNew)
  const confirmedNow = read.quotes.filter(q => q.confirmedInWindow)
  const cohortConfirmed = fresh.filter(q => q.cohortConfirmed).length
  const quoted = new Map<string, number>()
  fresh.forEach(q => addMoney(quoted, q.currency, q.latestTotal))
  const confirmedValue = new Map<string, number>()
  confirmedNow.forEach(q => addMoney(confirmedValue, q.currency, q.latestTotal))

  const manual = read.calls.filter(c => c.source === 'manual')
  const ai = read.calls.filter(c => c.source === 'ai')
  const connected = read.calls.filter(c => c.connected).length

  let agencyPrompts = 0
  let staffPrompts = 0
  let prompts = 0
  const activeAgencies = new Set<string>()
  const aiUsers = new Set<string>()
  const trips = new Set<string>()
  for (const p of read.prompts.pairs) {
    const u = ref.byEmail.get(lower(p.email))
    const count = Number(p.n) || 0
    prompts += count
    if (p.email) aiUsers.add(lower(p.email))
    if (p.portfolio_id) trips.add(String(p.portfolio_id))
    if (u?.role === 'partner') {
      agencyPrompts += count
      if (u.agency) activeAgencies.add(agencyKey(u.agency))
    } else if (u) staffPrompts += count
  }

  const agencySignups = read.signups.filter(s => s.audience === 'agency')
  return {
    newQuotes: fresh.length,
    amendments: read.amendments.length,
    cohortConfirmed,
    conversion: fresh.length ? cohortConfirmed / fresh.length : null,
    agenciesQuotedFor: new Set(fresh.map(q => agencyKey(q.agency)).filter(Boolean)).size,
    agencyRaised: fresh.filter(q => q.createdBy === 'agency').length,
    staffRaised: fresh.filter(q => q.createdBy === 'staff').length,
    consultants: new Set(fresh.map(q => q.ownerEmail).filter(Boolean)).size,
    confirmations: confirmedNow.length,
    quotedValue: moneyList(quoted),
    confirmedValue: moneyList(confirmedValue),
    calls: {
      total: read.calls.length,
      manual: manual.length,
      ai: ai.length,
      connected,
      manualConnected: manual.filter(c => c.connected).length,
      aiConnected: ai.filter(c => c.connected).length,
      rate: read.calls.length ? connected / read.calls.length : null,
      agenciesReached: new Set(read.calls.map(c => agencyKey(c.agency)).filter(Boolean)).size,
      talkSecs: ai.reduce((s, c) => s + (c.durationSecs ?? 0), 0),
      interested: read.calls.filter(c => c.interested).length,
    },
    signups: {
      total: read.signups.length,
      agencies: agencySignups.length,
      self: agencySignups.filter(s => s.source === 'Registered themselves').length,
      desk: agencySignups.filter(s => s.source === 'Onboarded by our team').length,
      internal: read.signups.filter(s => s.audience === 'internal').length,
      pending: read.signups.filter(s => s.status === 'pending').length,
    },
    adoption: {
      activeAgencies: activeAgencies.size, agencyPrompts, staffPrompts, prompts,
      aiUsers: aiUsers.size, trips: trips.size,
    },
  }
}

const DIRECT_LABELS = new Set(['', 'no agency', 'unattributed', 'onboarding'])

function agencyRows(read: WindowRead, ref: Reference): { rows: AgencyRow[]; direct: AgencyRow | null } {
  const map = new Map<string, AgencyRow & { users: Set<string>; tripSet: Set<string> }>()
  let direct: (AgencyRow & { users: Set<string>; tripSet: Set<string> }) | null = null
  const blank = (name: string) => ({
    agency: name, team: name ? ref.agencyTeam.get(agencyKey(name)) ?? null : null,
    prompts: 0, aiUsers: 0, trips: 0, quotes: 0, byAgency: 0, byStaff: 0, amendments: 0,
    confirmed: 0, confirmations: 0, calls: 0, connected: 0, users: new Set<string>(), tripSet: new Set<string>(),
  })
  const at = (name: string | null) => {
    const key = agencyKey(name)
    if (DIRECT_LABELS.has(key)) return (direct ??= blank('Direct business (no agency)'))
    const hit = map.get(key)
    if (hit) return hit
    const row = blank(String(name).trim())
    map.set(key, row)
    return row
  }

  // Partner turns only: this half answers "what did the AGENCY type".
  for (const p of read.prompts.pairs) {
    const u = ref.byEmail.get(lower(p.email))
    if (u?.role !== 'partner') continue
    const row = at(u.agency)
    row.prompts += Number(p.n) || 0
    if (p.email) row.users.add(lower(p.email))
    if (p.portfolio_id) row.tripSet.add(String(p.portfolio_id))
  }
  for (const q of read.quotes) {
    const row = at(q.agency)
    if (q.isNew) {
      row.quotes++
      if (q.createdBy === 'agency') row.byAgency++
      if (q.createdBy === 'staff') row.byStaff++
      if (q.cohortConfirmed) row.confirmed++
    }
    row.amendments += q.amendmentsInWindow
    if (q.confirmedInWindow) row.confirmations++
  }
  for (const c of read.calls) {
    if (!c.agency) continue
    const row = at(c.agency)
    row.calls++
    if (c.connected) row.connected++
  }

  const finish = (r: AgencyRow & { users: Set<string>; tripSet: Set<string> }): AgencyRow => {
    const { users, tripSet, ...rest } = r
    return { ...rest, aiUsers: users.size, trips: tripSet.size }
  }
  const rows = Array.from(map.values()).map(finish)
    .filter(r => r.prompts || r.quotes || r.amendments || r.confirmations || r.calls)
    .sort((a, b) => b.quotes - a.quotes || b.confirmations - a.confirmations || b.prompts - a.prompts || a.agency.localeCompare(b.agency))
  return { rows, direct: direct ? finish(direct) : null }
}

function destinationRows(read: WindowRead): DestinationRow[] {
  const map = new Map<string, DestinationRow & { value: Map<string, number> }>()
  const at = (d: string | null) => {
    const key = (d ?? '').trim() || 'Unknown'
    const hit = map.get(key.toLowerCase())
    if (hit) return hit
    const row = { destination: key, quotes: 0, amendments: 0, confirmed: 0, confirmations: 0, quotedValue: [], value: new Map<string, number>() }
    map.set(key.toLowerCase(), row)
    return row
  }
  for (const q of read.quotes) {
    const row = at(q.destination)
    if (q.isNew) {
      row.quotes++
      if (q.cohortConfirmed) row.confirmed++
      addMoney(row.value, q.currency, q.latestTotal)
    }
    row.amendments += q.amendmentsInWindow
    if (q.confirmedInWindow) row.confirmations++
  }
  return Array.from(map.values())
    .map(({ value, ...r }) => ({ ...r, quotedValue: moneyList(value) }))
    .filter(r => r.quotes || r.amendments || r.confirmations)
    .sort((a, b) => b.quotes - a.quotes || b.amendments - a.amendments || a.destination.localeCompare(b.destination))
}

function staffRows(read: WindowRead, ref: Reference, team: SalesTeam | null): StaffRow[] {
  type Acc = StaffRow & { qv: Map<string, number>; cv: Map<string, number>; contacted: Set<string> }
  const map = new Map<string, Acc>()
  const at = (email: string, fallbackName?: string): Acc | null => {
    const key = lower(email)
    if (!key) return null
    const hit = map.get(key)
    if (hit) return hit
    const u = ref.byEmail.get(key)
    if (u && OUTSIDE_ROLES.has(u.role)) return null
    if (!u && !fallbackName) return null
    const leader = u?.reportsTo ? ref.byId.get(u.reportsTo)?.name ?? null : null
    const row: Acc = {
      name: u?.name ?? fallbackName ?? key, role: u?.role ?? 'staff', team: u?.team ?? null, leader,
      newQuotes: 0, amendments: 0, cohortConfirmed: 0, confirmations: 0, manualCalls: 0, manualConnected: 0,
      aiCalls: 0, agenciesHandled: ref.handled.get(key) ?? 0, agenciesContacted: 0, prompts: 0,
      quotedValue: [], confirmedValue: [], qv: new Map(), cv: new Map(), contacted: new Set(),
    }
    map.set(key, row)
    return row
  }

  // The roster first, so a person who did nothing today is a row of zeros —
  // "opened nothing" is the most actionable line on a performance list. Only
  // people who have picked an office team are on it, which is everyone who
  // has signed in to Travel Quote GPT as an employee.
  ref.byEmail.forEach(u => {
    if (OUTSIDE_ROLES.has(u.role) || u.status !== 'active' || !u.team) return
    if (team && u.team !== team) return
    at(u.email)
  })

  for (const q of read.quotes) {
    const row = at(q.ownerEmail)
    if (!row) continue
    if (q.isNew) {
      row.newQuotes++
      if (q.cohortConfirmed) row.cohortConfirmed++
      addMoney(row.qv, q.currency, q.latestTotal)
    }
    if (q.confirmedInWindow) {
      row.confirmations++
      addMoney(row.cv, q.currency, q.latestTotal)
    }
  }
  for (const a of read.amendments) {
    const row = at(a.authorEmail)
    if (row) row.amendments++
  }
  for (const c of read.calls) {
    const row = at(c.actorEmail, c.source === 'manual' ? c.actor : undefined)
    if (!row) continue
    if (c.source === 'manual') {
      row.manualCalls++
      if (c.connected) row.manualConnected++
      if (c.agency) row.contacted.add(agencyKey(c.agency))
    } else row.aiCalls++
  }
  for (const p of read.prompts.pairs) {
    const u = ref.byEmail.get(lower(p.email))
    if (!u || OUTSIDE_ROLES.has(u.role)) continue
    const row = at(u.email)
    if (row) row.prompts += Number(p.n) || 0
  }

  return Array.from(map.values())
    .map(({ qv, cv, contacted, ...r }) => ({ ...r, agenciesContacted: contacted.size, quotedValue: moneyList(qv), confirmedValue: moneyList(cv) }))
    .sort((a, b) => b.newQuotes - a.newQuotes || b.confirmations - a.confirmations
      || (b.manualCalls + b.amendments) - (a.manualCalls + a.amendments) || a.name.localeCompare(b.name))
}

function teamRows(read: WindowRead, ref: Reference): TeamRow[] {
  const map = new Map<string, TeamRow>()
  const at = (t: string | null) => {
    const key = t ?? 'none'
    const hit = map.get(key)
    if (hit) return hit
    const row: TeamRow = { team: key, label: teamLabel(t), quotes: 0, amendments: 0, confirmations: 0, calls: 0, connected: 0, prompts: 0, signups: 0, people: 0 }
    map.set(key, row)
    return row
  }
  Object.keys(SALES_TEAMS).forEach(t => at(t))
  ref.byEmail.forEach(u => { if (!OUTSIDE_ROLES.has(u.role) && u.status === 'active' && u.team) at(u.team).people++ })
  for (const q of read.quotes) {
    if (q.isNew) at(q.team).quotes++
    if (q.confirmedInWindow) at(q.team).confirmations++
  }
  for (const a of read.amendments) at(a.team).amendments++
  for (const c of read.calls) { const r = at(c.team); r.calls++; if (c.connected) r.connected++ }
  for (const p of read.prompts.pairs) at(teamOf(ref, ref.byEmail.get(lower(p.email)))).prompts += Number(p.n) || 0
  for (const s of read.signups) at(s.team).signups++
  return Array.from(map.values())
    .filter(r => r.team !== 'none' || r.quotes || r.calls || r.prompts || r.signups)
    .sort((a, b) => b.quotes - a.quotes || b.calls - a.calls || a.label.localeCompare(b.label))
}

function activityLanes(read: WindowRead, w: PipelineWindow): PipelineSection['activity'] {
  const oneDay = w.fromDate === w.toDate
  const labels: string[] = []
  const index = new Map<string, number>()
  if (oneDay) {
    for (let h = 0; h < 24; h++) { const k = String(h).padStart(2, '0'); index.set(k, h); labels.push(`${k}:00`) }
  } else {
    let d = w.fromDate
    let guard = 0
    while (d <= w.toDate && guard++ < 400) {
      index.set(d, labels.length)
      labels.push(d)
      const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
      d = next.toISOString().slice(0, 10)
    }
  }
  const slot = (isoAt: string): number | undefined => {
    if (!isoAt) return undefined
    const at = new Date(isoAt)
    if (!Number.isFinite(at.getTime())) return undefined
    return oneDay ? index.get(String(clockInTz(at, w.timezone).hour).padStart(2, '0')) : index.get(dateInTz(at, w.timezone))
  }
  const lane = (key: string, label: string, stamps: { at: string; weight?: number }[]): ActivityLane => {
    const values = labels.map(() => 0)
    for (const s of stamps) { const i = slot(s.at); if (i !== undefined) values[i] += s.weight ?? 1 }
    return { key, label, values }
  }
  return {
    axis: oneDay ? 'hour' : 'date',
    labels,
    lanes: [
      lane('quotes', 'New quotations', read.quotes.filter(q => q.isNew).map(q => ({ at: q.issuedAt }))),
      lane('amendments', 'Amendments', read.amendments.map(a => ({ at: a.issuedAt }))),
      lane('confirmations', 'Confirmations', read.quotes.filter(q => q.confirmedInWindow && q.confirmedAt).map(q => ({ at: q.confirmedAt! }))),
      lane('manual', 'Calls by our team', read.calls.filter(c => c.source === 'manual').map(c => ({ at: c.at }))),
      lane('ai', 'Calls by the AI', read.calls.filter(c => c.source === 'ai').map(c => ({ at: c.at }))),
      lane('prompts', 'AI prompts', read.prompts.hours.map(h => ({ at: iso(h.hr), weight: Number(h.n) || 0 }))),
      lane('signups', 'Signups', read.signups.map(s => ({ at: s.at }))),
    ],
  }
}

/**
 * The whole pipeline section for a window, with the previous window's
 * headline counts beside it. Never throws: a missing connection, a missing
 * table or a failed read becomes a named warning.
 */
export async function collectSalesPipeline(opts: {
  window: PipelineWindow
  previous: PipelineWindow | null
  team?: string | null
}): Promise<PipelineSection> {
  const team = normalizeSalesTeam(opts.team)
  const teamInfo = team ? { key: team, label: SALES_TEAMS[team] } : null
  if (!isSalesCrmConfigured()) {
    return unavailable('The Travel Quote GPT database is not configured on this server (set SALES_CRM_DB_* or WA_SHARED_DB_*).', teamInfo, false)
  }

  let schema: CrmSchema
  let ref: Reference
  try {
    schema = await probeSchema()
    if (!schema.tables.size) throw new Error('none of the Travel Quote GPT tables are visible to this login')
    ref = await loadReference(schema)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[SalesReport] pipeline unavailable:', msg)
    return unavailable(`The Travel Quote GPT database could not be read (${msg}).`, teamInfo, true)
  }

  const [currentRaw, previousRaw] = await Promise.all([
    readWindow(schema, ref, opts.window),
    opts.previous ? readWindow(schema, ref, opts.previous).catch(() => null) : Promise.resolve(null),
  ])
  const current = filterTeam(currentRaw, ref, team)
  const previous = previousRaw ? filterTeam(previousRaw, ref, team) : null

  const { rows: agencies, direct } = agencyRows(current, ref)
  const onboard = new Map<string, number>()
  current.signups.forEach(s => { if (s.onboardedBy) onboard.set(s.onboardedBy, (onboard.get(s.onboardedBy) ?? 0) + 1) })

  // The previous window is a comparison, so a read that failed there removes
  // the arrow rather than inventing a fall to zero.
  const previousCounts = previous && previous.failed.size === 0 ? countsOf(previous, ref) : null

  return {
    available: current.failed.size < 4,
    configured: true,
    error: current.failed.size >= 4 ? 'Every Travel Quote GPT read failed.' : null,
    team: teamInfo,
    warnings: current.warnings,
    counts: countsOf(current, ref),
    previous: previousCounts,
    quotes: current.quotes,
    amendments: current.amendments,
    calls: current.calls,
    signups: current.signups,
    onboarders: Array.from(onboard.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    destinations: destinationRows(current),
    agencies,
    direct,
    staff: staffRows(current, ref, team),
    teams: team ? [] : teamRows(current, ref),
    activity: activityLanes(current, opts.window),
  }
}
