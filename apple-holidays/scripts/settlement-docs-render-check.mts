/**
 * Render check for the Sri Lankan settlement documents.
 *
 * Builds the four sheets from a made-up pack — no database of any kind is
 * touched — and writes the PDF plus a PNG of each page, so a layout change can
 * be looked at before it is put in front of the desk.
 *
 *   npx tsx scripts/settlement-docs-render-check.mts [outDir]
 */
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { buildDocsHtml, buildDocsPdf } from '../src/lib/sl-settlement-docs-pdf'
import { DOC_KINDS, defaultLocalVisit, emptyPack, type SettlementDocPack } from '../src/lib/sl-settlement-docs'

function samplePack(): SettlementDocPack {
  const p = emptyPack('IS46348', 'IS46348')
  p.header = {
    tourNo: 'IS46348', arrivalDate: '2025-12-02', departureDate: '2025-12-14', pax: 9,
    paxAdults: 7, paxChildren: 2,
    tourHandler: 'Arosha', driverName: 'Sheshan', driverPhone: '0771234567',
    guideName: 'Susantha', vehicleType: 'KDH High Roof', vehiclePlate: 'KY 9127',
  }
  p.nameBoard = { guestName: 'Mr & Mrs Munendra Yadav', subtitle: 'Welcome to Sri Lanka', footnote: '9 pax · UL 504', showReference: true }
  p.transport = {
    vehicleType: 'KDH High Roof', perKmRate: 160, maxMileage: 2000, km: 2208, packageCost: 350000,
    lines: [
      { id: 't-1', date: '2025-12-08', description: 'Kandy – Galigamuwa – Karawanella – Kitulgala – Hatton – Lidula – Nuwara Eliya (total km 208)\next 120 km × 160 (Miss Arosha and Mr Abdul approve) — reason: landslide', amount: 19200 },
    ],
    totals: { totalMileageRate: 160, totalMileageAmount: null, battaRate: 2000, battaCount: 12, battaAmount: 24000, highwayTickets: 3400, parkingTickets: 1200, fuelAdvance: null, tourAdvance: 250000 },
    chequeFavour: 'S. D. Kariyawasam', bankDetails: '8011556769\nS. D. Kariyawasam\nCommercial Bank · Kandy', idNo: '199012345678', note: 'Guide fee + entrance settled on the tour settlement sheet.',
  }
  p.localVisit = { ...defaultLocalVisit(), driverRef: '473030CNTL', note: '' }
  p.tour = {
    ...p.tour,
    guideName: 'Susantha', chauffeurName: 'Sheshan',
    showUnusedOnPrint: false,
    // The catalogue is already on the sheet; this is a tour that took five of it.
    lines: p.tour.lines.map(l => {
      switch (l.name) {
        case 'Pinnawala Orphanage':  return { ...l, active: true, perPersonRate: 3540, count: 7, childRate: 1770, childCount: 2, totalCost: null }
        case 'Temple of Tooth':      return { ...l, active: true, perPersonRate: 1500, count: 7, childRate: 750,  childCount: 2, totalCost: null }
        case 'Sigiriya':             return { ...l, active: true, perPersonRate: 6200, count: 7, childRate: 3100, childCount: 2, totalCost: null }
        case 'Safari Jeep':          return { ...l, active: true, perPersonRate: null, count: null, childRate: null, childCount: null, totalCost: 30000 }
        case 'Guide Package':        return { ...l, active: true, perPersonRate: null, count: null, childRate: null, childCount: null, totalCost: 135000 }
        default: return l
      }
    }),
    note: '',
  }

  return p
}

const outDir = process.argv[2] ?? path.join(process.cwd(), '.render-check')
await mkdir(outDir, { recursive: true })

const pack = samplePack()

const pdf = await buildDocsPdf(pack, [...DOC_KINDS])
await writeFile(path.join(outDir, 'settlement-documents.pdf'), pdf)
console.log(`PDF  ${pdf.length} bytes → ${outDir}/settlement-documents.pdf`)

// One PNG per sheet, at the size that sheet actually prints at.
const { launchBrowser } = await import('../src/lib/html-to-pdf')
const browser = await launchBrowser()
try {
  for (const kind of DOC_KINDS) {
    const html = await buildDocsHtml(pack, [kind])
    const page = await browser.newPage()
    const landscape = kind === 'name_board'
    await page.setViewport({ width: landscape ? 1123 : 794, height: landscape ? 794 : 1123, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.screenshot({ path: path.join(outDir, `${kind}.png`) as `${string}.png`, fullPage: true })
    await page.close()
    console.log(`PNG  ${kind}`)
  }
} finally {
  await browser.close()
}
