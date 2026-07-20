/**
 * Builds a standalone HTML document for an AppleSystem booking confirmation,
 * used by the "AS Bookings V2" server-side PDF export. Two variants are produced
 * from the same template — `withCosts` toggles the financial breakdown section.
 *
 * Pure + dependency-free: takes an `ASQuoteTemplate` and returns an HTML string
 * suitable for `htmlToPdf()`. No DB, no network.
 */

import type { ASQuoteTemplate } from '@/lib/applesystem'

const BRAND = '#d97706'

// ── Cost extraction ──────────────────────────────────────────────────────────

function num(node: unknown): number {
  if (typeof node === 'number') return node
  if (typeof node === 'string') { const n = Number(node); return isNaN(n) ? 0 : n }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.total === 'number') return o.total
    if (typeof o.cost === 'number') return o.cost
  }
  return 0
}

/** `cost.transport` nests its total under `cost.total`; others expose `.cost`/`.total`. */
function nestedCost(node: unknown): number {
  if (!node || typeof node !== 'object') return num(node)
  const o = node as Record<string, unknown>
  if (o.cost && typeof o.cost === 'object') return num(o.cost)
  return num(o)
}

export interface CostLine { label: string; amount: number }
export interface CostSummary {
  symbol: string
  currencyCode: string
  total: number
  net: number
  profit: number
  margin: number
  lines: CostLine[]
  totalPax: number
  perPax: number
}

export function extractCosts(q: ASQuoteTemplate): CostSummary {
  const pnl = (q.pnl ?? {}) as Record<string, unknown>
  const cost = (pnl.cost ?? {}) as Record<string, unknown>
  const info = (pnl.quotation_info ?? {}) as Record<string, unknown>

  const currency = (cost.currency ?? {}) as Record<string, unknown>
  const symbol = String(currency.symbol ?? info.currency ?? '$')
  const currencyCode = String(currency.code ?? info.currency ?? '')

  const total = num(cost.total ?? pnl.cost)
  const net = num((pnl.cost_without_markup as Record<string, unknown>)?.total ?? pnl.cost_without_markup)
  const profit = typeof pnl.profit_loss === 'number' ? (pnl.profit_loss as number) : total - net
  const margin = total > 0 ? (profit / total) * 100 : 0

  const rawLines: CostLine[] = [
    { label: 'Hotel', amount: nestedCost(cost.hotel) },
    { label: 'Hotel Transport', amount: num(cost.hotel_transport) },
    { label: 'Transport', amount: nestedCost(cost.transport) },
    { label: 'Attractions', amount: nestedCost(cost.attraction) },
    { label: 'Meals', amount: nestedCost(cost.meal) },
    { label: 'Cruise', amount: nestedCost(cost.cruise) },
    { label: 'Supplement', amount: num(cost.supplement) },
    { label: 'Water Bottle', amount: nestedCost(cost.water_bottle) },
    { label: 'Other', amount: nestedCost(cost.other) },
  ]
  const lines = rawLines.filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount)

  const totalPax = Number(info.total_pax ?? 0)
  const perPax = totalPax > 0 ? total / totalPax : 0

  return { symbol, currencyCode, total, net, profit, margin, lines, totalPax, perPax }
}

// ── Deep extraction (transport / activities / per-person / journey) ──────────

function get(obj: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

/** Consecutive days in the same city collapse into one leg. */
function journeyLegs(pnl: Record<string, unknown>): { name: string; from: number; to: number }[] {
  const dc = pnl.day_city as Record<string, { name?: string }> | undefined
  if (!dc) return []
  const entries = Object.entries(dc)
    .map(([d, v]) => ({ day: Number(d), name: v?.name ?? '' }))
    .filter((e) => e.name)
    .sort((a, b) => a.day - b.day)
  const out: { name: string; from: number; to: number }[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last && last.name === e.name) last.to = e.day
    else out.push({ name: e.name, from: e.day, to: e.day })
  }
  return out
}

interface TransportInfo {
  vehicleType: string | null; vehicleRate: number; bata: number; paging: number
  highway: number; driverAcc: number; rateArray: number[]
  total: number; perPerson: number; distanceKm: number; additionalKm: number; waterBottle: number
}

function extractTransport(pnl: Record<string, unknown>): TransportInfo | null {
  const t = get(pnl, 'budget', 'transport') as Record<string, unknown> | undefined
  const c = get(pnl, 'cost', 'transport', 'cost') as Record<string, unknown> | undefined
  if (!t && !c) return null
  const v = get(t, 'vehicle') as Record<string, unknown> | undefined
  const r = get(t, 'rates') as Record<string, unknown> | undefined
  const m = get(t, 'mileage') as Record<string, unknown> | undefined
  return {
    vehicleType: v?.vehicle_type ? String(v.vehicle_type) : null,
    vehicleRate: num(v?.rate), bata: num(v?.bata), paging: num(v?.paging),
    highway: num(v?.highway_charges), driverAcc: num(v?.driver_accommodation),
    rateArray: Array.isArray(r?.rate_array) ? (r!.rate_array as unknown[]).map(num) : [],
    total: num(r?.total ?? c?.total), perPerson: num(r?.pp ?? c?.per_person),
    distanceKm: num(m?.actual_distance), additionalKm: num(m?.additional_distance),
    waterBottle: num(t?.per_water_bottle),
  }
}

interface ActivityItem {
  kind: string; name: string; duration: number
  adultRate: number; childRate: number; transferRate: number
  adultEntrance: number; childEntrance: number; total: number
}

function extractActivities(pnl: Record<string, unknown>) {
  const a = get(pnl, 'budget', 'attraction') as Record<string, unknown> | undefined
  if (!a) return null
  const items: ActivityItem[] = []
  for (const kind of ['attraction', 'city_tour', 'excursion'] as const) {
    const objs = get(a, 'items', kind) as Record<string, Record<string, unknown>> | undefined
    if (!objs || Array.isArray(objs)) continue
    for (const [id, o] of Object.entries(objs)) {
      const rate = get(a, 'rates', kind, id) as Record<string, unknown> | undefined
      const bd = get(a, 'rates', `${kind}_breakdown`, id) as Record<string, unknown> | undefined
      items.push({
        kind,
        name: String(o.name ?? o.point ?? `#${id}`),
        duration: num(o.duration),
        adultRate: num(rate?.adult), childRate: num(rate?.child),
        transferRate: num(bd?.transfer_rate),
        adultEntrance: num(bd?.adult_entrance_rate), childEntrance: num(bd?.child_entrance_rate),
        total: num(get(a, 'attraction_individual', kind, id)),
      })
    }
  }
  return {
    total: num(a.total), totalAttraction: num(a.total_attraction), totalNone: num(a.total_none_attraction),
    items: items.sort((x, y) => y.total - x.total),
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return esc(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

// ── HTML builder ─────────────────────────────────────────────────────────────

export function buildConfirmationHtml(q: ASQuoteTemplate, withCosts: boolean): string {
  const info = (q.pnl?.quotation_info ?? {}) as Record<string, unknown>
  const ref = q.reference_numbers ?? {}
  const parties = q.relevant_parties ?? {}
  const costs = extractCosts(q)

  const isNumber = String(info.is_number ?? '').trim()
  const nights = Number(info.nights ?? 0)
  const days = Number(info.days ?? 0)
  const pax = (info.pax ?? {}) as Record<string, unknown>
  const adult = Number(pax.adult ?? 0)
  const cwb = Number(pax.cwb ?? 0)
  const cnb = Number(pax.cnb ?? 0)
  const totalPax = Number(info.total_pax ?? adult + cwb + cnb)

  const acc = q.accommodation ?? []
  const itin = q.itinerary ?? []
  const includes = q.package_includes ?? []
  const excludes = q.package_excludes ?? []
  const terms = q.terms_and_conditions ?? []
  const vas = q.value_added_services ?? []
  const legs = journeyLegs((q.pnl ?? {}) as Record<string, unknown>)

  const metaChips = [
    ref.control && `<span class="chip mono">${esc(ref.control)}</span>`,
    ref.temp_po && `<span class="chip mono">${esc(ref.temp_po)}</span>`,
    parties.agent && parties.agent !== 'NA' && `<span class="chip">Agent · ${esc(parties.agent)}</span>`,
    parties.sales_person && `<span class="chip">Sales · ${esc(parties.sales_person)}</span>`,
    q.revision != null && `<span class="chip">Rev ${esc(q.revision)}</span>`,
  ].filter(Boolean).join('')

  const infoTiles = [
    ['Nights / Days', `${nights}N / ${days}D`],
    ['Total Pax', String(totalPax)],
    ['Pax Split', `${adult} Adult${cwb ? ` · ${cwb} CWB` : ''}${cnb ? ` · ${cnb} CNB` : ''}`],
    ['Currency', String(info.currency ?? costs.currencyCode ?? '—')],
  ].map(([l, v]) => `<div class="tile"><div class="tile-v">${esc(v)}</div><div class="tile-l">${esc(l)}</div></div>`).join('')

  const accRows = acc.length
    ? acc.map((a) => `
        <tr>
          <td><strong>${esc(a.city ?? '—')}</strong></td>
          <td>${fmtDate(a.check_in)}</td>
          <td>${fmtDate(a.check_out)}</td>
          <td class="center">${esc(a.nights ?? 0)}N</td>
          <td>${esc((a.type ?? '').replace(/_/g, ' '))}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="muted">No accommodation listed.</td></tr>`

  const itinBlocks = itin.map((d) => {
    const acts = (d.activities ?? []).map((ac) => `
      <div class="act">
        <span class="act-badge">${esc((ac.type ?? 'activity').replace(/_/g, ' '))}</span>
        <div>
          <div class="act-name">${esc(ac.name ?? '')}</div>
          ${ac.description ? `<div class="act-desc">${esc(ac.description)}</div>` : ''}
        </div>
      </div>`).join('')
    return `
      <div class="day">
        <div class="day-head">
          <span class="day-no">Day ${esc(d.day)}</span>
          <span class="day-date">${esc(d.date_formatted ?? fmtDate(d.date))}</span>
        </div>
        ${d.route ? `<div class="day-route">${esc(d.route)}</div>` : ''}
        ${d.description ? `<div class="day-desc">${esc(d.description)}</div>` : ''}
        ${acts ? `<div class="acts">${acts}</div>` : ''}
      </div>`
  }).join('')

  const listCol = (title: string, items: string[], cls: string) => `
    <div class="col">
      <div class="col-title ${cls}">${esc(title)}</div>
      ${items.length
        ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : `<p class="muted">None listed.</p>`}
    </div>`

  // ── Deep financial detail (with-costs copy only) ──────────────────────────
  const pnlObj = (q.pnl ?? {}) as Record<string, unknown>
  const sym = costs.symbol
  const transport = extractTransport(pnlObj)
  const acts = extractActivities(pnlObj)

  const sellAdult = (get(pnlObj, 'cost', 'pp', 'adult') ?? {}) as Record<string, unknown>
  const netAdult = (get(pnlObj, 'cost_without_markup', 'pp', 'adult') ?? {}) as Record<string, unknown>
  const adultKeys = Object.keys(sellAdult)
  const sellCwb = num(get(pnlObj, 'cost', 'pp', 'cwb'))
  const sellCnb = num(get(pnlObj, 'cost', 'pp', 'cnb'))

  const ppComponents = [
    ['Hotel', num(get(pnlObj, 'cost', 'hotel', 'cost_pp'))],
    ['Transport', num(get(pnlObj, 'cost', 'transport', 'cost', 'per_person'))],
    ['Attractions', num(get(pnlObj, 'cost', 'attraction', 'pax_cost', 'adult'))],
    ['Meals', num(get(pnlObj, 'cost', 'meal', 'pax_cost', 'adult'))],
    ['Hotel Transport', num(get(pnlObj, 'cost', 'hotel_transport', 'pp_adult'))],
  ].filter(([, v]) => (v as number) > 0) as [string, number][]

  const perPersonBlock = adultKeys.length || ppComponents.length
    ? `
      <section class="section">
        <h2>Per-Person Pricing</h2>
        ${adultKeys.length ? `
        <table class="table">
          <thead><tr><th>Pax type</th><th class="right">Selling</th><th class="right">Net</th><th class="right">Markup</th></tr></thead>
          <tbody>
            ${adultKeys.map((k) => {
              const s = num(sellAdult[k]), n = num(netAdult[k])
              return `<tr><td>Adult${adultKeys.length > 1 ? ` · option ${esc(k)}` : ''}</td><td class="right mono">${money(s, sym)}</td><td class="right mono muted">${money(n, sym)}</td><td class="right mono" style="color:#059669">${money(s - n, sym)}</td></tr>`
            }).join('')}
            ${sellCwb > 0 ? `<tr><td>Child with bed</td><td class="right mono">${money(sellCwb, sym)}</td><td class="right mono muted">${money(num(get(pnlObj, 'cost_without_markup', 'pp', 'cwb')), sym)}</td><td></td></tr>` : ''}
            ${sellCnb > 0 ? `<tr><td>Child no bed</td><td class="right mono">${money(sellCnb, sym)}</td><td class="right mono muted">${money(num(get(pnlObj, 'cost_without_markup', 'pp', 'cnb')), sym)}</td><td></td></tr>` : ''}
          </tbody>
        </table>` : ''}
        ${ppComponents.length ? `
        <p class="sub-h">Per-adult component costs</p>
        <div class="kv">${ppComponents.map(([l, v]) => `<div class="kv-i"><div class="kv-l">${esc(l)}</div><div class="kv-v">${money(v, sym)}</div></div>`).join('')}</div>` : ''}
      </section>`
    : ''

  const transportBlock = transport && (transport.total > 0 || transport.distanceKm > 0)
    ? `
      <section class="section">
        <h2>Transport Economics</h2>
        <div class="kv">
          <div class="kv-i"><div class="kv-l">Vehicle</div><div class="kv-v">${transport.vehicleType ? `#${esc(transport.vehicleType)}` : '—'}</div></div>
          <div class="kv-i"><div class="kv-l">Distance</div><div class="kv-v">${transport.distanceKm.toLocaleString()} km</div></div>
          <div class="kv-i"><div class="kv-l">Total</div><div class="kv-v">${money(transport.total, sym)}</div></div>
          <div class="kv-i"><div class="kv-l">Per person</div><div class="kv-v">${money(transport.perPerson, sym)}</div></div>
        </div>
        <div class="kv" style="margin-top:6px">
          ${[['Vehicle rate', transport.vehicleRate], ['Bata', transport.bata], ['Paging', transport.paging],
             ['Highway', transport.highway], ['Driver acc.', transport.driverAcc], ['Water bottle', transport.waterBottle]]
            .map(([l, v]) => `<div class="kv-i"><div class="kv-l">${esc(l)}</div><div class="kv-v">${money(v as number, sym)}</div></div>`).join('')}
        </div>
        ${transport.rateArray.length ? `<p class="sub-h">Rate segments</p><p class="mono" style="font-size:11px">${transport.rateArray.map((r) => money(r, sym)).join(' · ')}</p>` : ''}
      </section>`
    : ''

  const activityBlock = acts && acts.items.length
    ? `
      <section class="section">
        <h2>Activity &amp; Attraction Economics</h2>
        <div class="kv">
          <div class="kv-i"><div class="kv-l">Ticketed attractions</div><div class="kv-v">${money(acts.totalAttraction, sym)}</div></div>
          <div class="kv-i"><div class="kv-l">Transfers / non-ticketed</div><div class="kv-v">${money(acts.totalNone, sym)}</div></div>
          <div class="kv-i"><div class="kv-l">Activities total</div><div class="kv-v">${money(acts.total, sym)}</div></div>
        </div>
        <table class="table" style="margin-top:8px">
          <thead><tr><th>Activity</th><th class="right">Adult</th><th class="right">Child</th><th class="right">Transfer</th><th class="right">Total</th></tr></thead>
          <tbody>
            ${acts.items.map((it) => `
              <tr>
                <td><strong>${esc(it.name)}</strong><br/><span class="muted" style="font-size:10px">${esc(it.kind.replace(/_/g, ' '))}${it.duration > 0 ? ` · ${it.duration} min` : ''}</span></td>
                <td class="right mono">${money(it.adultRate, sym)}</td>
                <td class="right mono">${money(it.childRate, sym)}</td>
                <td class="right mono">${money(it.transferRate, sym)}</td>
                <td class="right mono"><strong>${money(it.total, sym)}</strong></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>`
    : ''

  const costSection = withCosts && (costs.total > 0 || costs.lines.length)
    ? `
      <section class="section">
        <h2>Cost Breakdown</h2>
        <table class="table">
          <thead><tr><th>Item</th><th class="right">Amount</th><th class="right">Per pax</th><th class="right">% of total</th></tr></thead>
          <tbody>
            ${costs.lines.map((l) => `
              <tr>
                <td>${esc(l.label)}</td>
                <td class="right mono">${money(l.amount, costs.symbol)}</td>
                <td class="right mono muted">${costs.totalPax > 0 ? money(l.amount / costs.totalPax, costs.symbol) : '—'}</td>
                <td class="right muted">${costs.total > 0 ? ((l.amount / costs.total) * 100).toFixed(0) : '0'}%</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr class="tot"><td>Selling Total${costs.totalPax > 0 ? ` <span class="muted">(${money(costs.perPax, costs.symbol)} / pax)</span>` : ''}</td><td class="right mono">${money(costs.total, costs.symbol)}</td><td></td><td></td></tr>
            <tr><td class="muted">Net Cost (excl. markup)</td><td class="right mono muted">${money(costs.net, costs.symbol)}</td><td></td><td></td></tr>
            <tr class="profit"><td>Markup / Profit (${costs.margin.toFixed(1)}%)</td><td class="right mono">${money(costs.profit, costs.symbol)}</td><td></td><td></td></tr>
          </tfoot>
        </table>
      </section>
      ${perPersonBlock}
      ${transportBlock}
      ${activityBlock}`
    : withCosts
      ? `<section class="section"><h2>Cost Breakdown</h2><p class="muted">No itemised costs available.</p></section>`
      : `<div class="nocost">Prices excluded from this copy.</div>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 28px 34px; font-size: 12px; line-height: 1.5; }
  .mono { font-family: 'Courier New', monospace; }
  .muted { color: #94a3b8; }
  .right { text-align: right; }
  .center { text-align: center; }

  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${BRAND}; padding-bottom: 12px; margin-bottom: 16px; }
  .doc-title { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
  .doc-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
  .quo { text-align: right; }
  .quo-no { font-size: 22px; font-weight: 800; font-family: 'Courier New', monospace; color: ${BRAND}; }
  .quo-is { display: inline-block; margin-top: 4px; font-size: 11px; font-weight: 700; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; border-radius: 6px; padding: 2px 8px; }

  .chips { margin: 4px 0 14px; }
  .chip { display: inline-block; font-size: 10px; background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; border-radius: 6px; padding: 2px 8px; margin: 0 4px 4px 0; }
  .chip.mono { font-family: 'Courier New', monospace; background: #faf5ff; border-color: #e9d5ff; color: #7c3aed; }

  .tiles { display: flex; gap: 10px; margin-bottom: 18px; }
  .tile { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #f8fafc; }
  .tile-v { font-size: 14px; font-weight: 700; }
  .tile-l { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin-top: 2px; }

  .section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-size: 13px; font-weight: 800; color: #0f172a; border-left: 4px solid ${BRAND}; padding-left: 8px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.03em; }

  .table { width: 100%; border-collapse: collapse; }
  .table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; border-bottom: 2px solid #e2e8f0; padding: 6px 8px; }
  .table td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
  .table tfoot td { border-top: 2px solid #e2e8f0; border-bottom: none; padding-top: 8px; font-weight: 600; }
  .table tfoot tr.tot td { font-size: 13px; font-weight: 800; }
  .table tfoot tr.profit td { color: #059669; font-weight: 800; }

  .day { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; }
  .day-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .day-no { font-weight: 800; color: ${BRAND}; font-size: 13px; }
  .day-date { font-size: 11px; color: #64748b; }
  .day-route { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
  .day-desc { font-size: 11px; color: #475569; }
  .acts { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .act { display: flex; gap: 8px; align-items: flex-start; background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; padding: 6px 8px; }
  .act-badge { flex-shrink: 0; font-size: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.03em; background: #ede9fe; color: #6d28d9; border-radius: 4px; padding: 2px 6px; margin-top: 1px; }
  .act-name { font-weight: 700; font-size: 11px; }
  .act-desc { font-size: 10px; color: #64748b; }

  .cols { display: flex; gap: 16px; }
  .col { flex: 1; }
  .col-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; padding: 4px 0; margin-bottom: 6px; border-bottom: 2px solid; }
  .col-title.inc { color: #059669; border-color: #a7f3d0; }
  .col-title.exc { color: #dc2626; border-color: #fecaca; }
  .col ul { margin: 0; padding-left: 16px; }
  .col li { font-size: 11px; margin-bottom: 3px; }

  .terms li { font-size: 10px; color: #475569; margin-bottom: 4px; }
  .terms ol { margin: 0; padding-left: 18px; }

  .nocost { border: 1px dashed #cbd5e1; color: #94a3b8; text-align: center; border-radius: 10px; padding: 10px; font-size: 11px; margin-bottom: 20px; }

  .journey { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 18px; }
  .leg { display: inline-block; font-size: 10px; font-weight: 700; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 7px; padding: 3px 9px; }
  .leg span { font-weight: 400; color: #c2703a; }
  .arrow { color: #cbd5e1; font-size: 11px; }

  .sub-h { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; margin: 10px 0 6px; }
  .kv { display: flex; flex-wrap: wrap; gap: 6px; }
  .kv-i { flex: 1 1 120px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 9px; background: #f8fafc; }
  .kv-l { font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; color: #94a3b8; }
  .kv-v { font-size: 12px; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 1px; }

  .vas { display: flex; flex-wrap: wrap; gap: 5px; }
  .vas span { font-size: 10px; background: #fdf2f8; border: 1px solid #fbcfe8; color: #9d174d; border-radius: 7px; padding: 3px 9px; }
</style>
</head>
<body>
  <div class="doc-head">
    <div>
      <div class="doc-title">Booking Confirmation</div>
      <div class="doc-sub">Apple Holidays · AppleSystem</div>
    </div>
    <div class="quo">
      <div class="quo-no">${esc(ref.formatted ?? q.quotation_no)}</div>
      ${isNumber && isNumber !== 'NA' ? `<div class="quo-is">IS ${esc(isNumber)}</div>` : ''}
    </div>
  </div>

  <div class="chips">${metaChips || ''}</div>

  <div class="tiles">${infoTiles}</div>

  ${legs.length ? `<div class="journey">${legs.map((l, i) => `${i > 0 ? '<span class="arrow">&rarr;</span>' : ''}<span class="leg">${esc(l.name)} <span>${l.from === l.to ? `D${l.from}` : `D${l.from}&ndash;${l.to}`}</span></span>`).join('')}</div>` : ''}

  ${vas.length ? `
  <section class="section">
    <h2>Value Added Services</h2>
    <div class="vas">${vas.map((v) => `<span>${esc(typeof v === 'string' ? v : (v as Record<string, unknown>)?.name ?? JSON.stringify(v))}</span>`).join('')}</div>
  </section>` : ''}

  <section class="section">
    <h2>Accommodation</h2>
    <table class="table">
      <thead><tr><th>City</th><th>Check-in</th><th>Check-out</th><th class="center">Nights</th><th>Type</th></tr></thead>
      <tbody>${accRows}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Itinerary${itin.length ? ` — ${itin.length} day${itin.length !== 1 ? 's' : ''}` : ''}</h2>
    ${itinBlocks || '<p class="muted">No itinerary available.</p>'}
  </section>

  <section class="section">
    <h2>Package Inclusions &amp; Exclusions</h2>
    <div class="cols">
      ${listCol('Includes', includes, 'inc')}
      ${listCol('Excludes', excludes, 'exc')}
    </div>
  </section>

  ${costSection}

  <section class="section terms">
    <h2>Terms &amp; Conditions</h2>
    ${terms.length ? `<ol>${terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : '<p class="muted">None listed.</p>'}
  </section>
</body>
</html>`
}
