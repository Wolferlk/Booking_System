/**
 * The entrance-ticket catalogue the Tour Settlement sheet is printed from.
 *
 * ---- What this is ----
 *
 * The desk's tour settlement is not a free-form list: it is the same column of
 * attractions every time — Sigiriya, Pinnawala, the Yala jeep, the guide
 * package, the arrival garlands — with a rate against the ones this tour
 * actually took and a blank against the ones it did not. This file is that
 * column, grouped the way a handler thinks about a day (wildlife, temples,
 * gardens, water, extras) rather than the way the spreadsheet happened to be
 * typed.
 *
 * ---- Aliases ----
 *
 * The same attraction is written four ways across the two systems — "Temple of
 * Tooth", "Temple of the Tooth", "Dalada Maligawa" — and the accounts system's
 * costed lines carry whichever the person costing it typed. `matchTicket()`
 * folds all of them onto one catalogue row so a costed figure lands on the
 * printed line it belongs to instead of arriving as a duplicate at the bottom.
 * That is the whole reason the aliases exist; they are never printed.
 *
 * The catalogue is a *default*, not a constraint. A pack keeps whatever the
 * desk edited, any line can be renamed, and anything not listed here is added
 * on the sheet as a custom line.
 */

export interface TourTicketItem {
  /** Printed on the sheet, and the name a new line is created with. */
  name: string
  /** Other spellings this attraction arrives under. Matched, never printed. */
  aliases?: string[]
}

export interface TourTicketGroup {
  /** Shown in the editor to group the rows. Not printed on the sheet. */
  title: string
  items: TourTicketItem[]
}

export const TOUR_TICKET_GROUPS: TourTicketGroup[] = [
  {
    title: 'Wildlife & safari',
    items: [
      { name: 'Udawalawa Safari Entrance', aliases: ['udawalawe safari entrance', 'udawalawa safari'] },
      { name: 'Yala Safari Entrance', aliases: ['yala safari', 'yala national park'] },
      { name: 'Safari Jeep', aliases: ['jeep', 'safari jeep hire'] },
      { name: 'Udawalawa Elephant Safari Entrance', aliases: ['udawalawa elephant safari entrance for child', 'elephant safari entrance', 'udawalawe elephant safari'] },
      { name: 'Pinnawala Orphanage', aliases: ['pinnawala', 'pinnawela', 'elephant orphanage'] },
      { name: 'Turtle Hatchery', aliases: ['turtle farm'] },
      { name: 'Whale Watching', aliases: ['whale watching mirissa'] },
    ],
  },
  {
    title: 'Temples & heritage',
    items: [
      { name: 'Temple of Tooth', aliases: ['temple of the tooth', 'dalada maligawa', 'tooth relic temple'] },
      { name: 'Sigiriya', aliases: ['sigiriya rock', 'sigiriya lion rock'] },
      { name: 'Dambulla', aliases: ['dambulla cave temple', 'golden temple dambulla'] },
      { name: 'Seetha Amman Temple', aliases: ['sita amman temple'] },
      { name: 'Ravana Cave', aliases: ['ravana caves'] },
      { name: 'Gangaramaya Temple Colombo', aliases: ['gangaramaya', 'gangarama temple colombo', 'gangarama temple'] },
      { name: 'Jaffna Fort' },
      { name: 'Cultural Show', aliases: ['kandyan cultural show', 'cultural dance show'] },
    ],
  },
  {
    title: 'Gardens & parks',
    items: [
      { name: 'Peradeniya Botanical Garden', aliases: ['peradeniya garden', 'royal botanical garden'] },
      { name: 'Hakgala Botanical Garden', aliases: ['hakgala garden'] },
      { name: 'Victoria Park Nuwara Eliya', aliases: ['victoriya park nuwaraeliya', 'victoria park'] },
      { name: 'Ambuluwawa Tower', aliases: ['ambuluwawa'] },
      { name: 'Gregory Lake Entrance', aliases: ['gregory lake'] },
      { name: 'Kinniya Hot Water Springs', aliases: ['kinniya hot water spring', 'hot water wells'] },
    ],
  },
  {
    title: 'Museums & landmarks',
    items: [
      { name: 'Colombo National Museum', aliases: ['colombo museum', 'national museum'] },
      { name: 'Galle Museum' },
      { name: 'Galle Maritime Museum', aliases: ['maritime museum'] },
      { name: 'Lotus Tower', aliases: ['nelum kuluna'] },
    ],
  },
  {
    title: 'Water & adventure',
    items: [
      { name: 'Gregory Lake Boat Ride (Speed Boat)', aliases: ['gregory lake boat ride', 'gregory lake speed boat'] },
      { name: 'Madu River Boat Ride', aliases: ['madu river', 'madu river safari'] },
      { name: 'Water Sports (Jet Ski / Banana Ride / Sofa Ride)', aliases: ['water sports', 'banana ride', 'sofa tube ride', 'jet ski ride', 'banana ride / sofa tube ride / jet ski ride'] },
      { name: 'Flying Ravana Zip Line', aliases: ['flying ravana', 'zip line'] },
      { name: 'Tuk Tuk Ride', aliases: ['tuk tuk', 'tuktuk ride'] },
    ],
  },
  {
    title: 'Guide & extras',
    items: [
      { name: 'Guide Package', aliases: ['guide fee', 'guide charges', 'guide package'] },
      { name: 'Garlands', aliases: ['arrival garlands', 'arrival garlons', 'garlons', 'garland'] },
      { name: 'Flower Bouquet', aliases: ['bouquet'] },
      { name: 'Gift Hamper (bouquet, chocolates, chips)', aliases: ['gift hamper', 'hamper'] },
      { name: 'Cake Cost', aliases: ['cake'] },
      { name: 'Water Bottles', aliases: ['water bottle', 'water botteles'] },
    ],
  },
]

/** The catalogue flattened, in the order it is printed. */
export const TOUR_TICKET_CATALOG: TourTicketItem[] = TOUR_TICKET_GROUPS.flatMap(g => g.items)

/** Which group a catalogue name belongs to, for the editor's headings. */
export const TICKET_GROUP_OF: Record<string, string> = Object.fromEntries(
  TOUR_TICKET_GROUPS.flatMap(g => g.items.map(i => [i.name, g.title] as const)),
)

/**
 * A name reduced to what two spellings of the same attraction have in common:
 * lower case, no punctuation, no double spaces, and the filler words the desk
 * drops at random ("the", "entrance", "ticket") taken out.
 */
export function normaliseTicketName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|of|for|and|entrance|entrances|ticket|tickets|cost|fee|fees|charges|per|pax|adult|adults|child|children|kids)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const INDEX: { key: string; item: TourTicketItem }[] = TOUR_TICKET_CATALOG.flatMap(item =>
  [item.name, ...(item.aliases ?? [])].map(k => ({ key: normaliseTicketName(k), item })),
).filter(e => e.key.length > 0)

/**
 * The catalogue row a costed line belongs on, or null for something new.
 *
 * Exact match on the folded name first, then containment either way — "Yala
 * Safari Entrance 04 Pax" contains "yala safari", and "Sigiriya" is contained
 * by "Sigiriya Rock Fortress Entrance". Containment is only trusted from four
 * characters up, so a stray "tea" or "gem" cannot capture a line it has
 * nothing to do with.
 */
export function matchTicket(rawName: string): TourTicketItem | null {
  const key = normaliseTicketName(rawName)
  if (!key) return null

  const exact = INDEX.find(e => e.key === key)
  if (exact) return exact.item

  const partial = INDEX
    .filter(e => e.key.length >= 4 && (key.includes(e.key) || e.key.includes(key)))
    // The longest overlapping key wins: "gregory lake boat ride" beats "gregory lake".
    .sort((a, b) => b.key.length - a.key.length)[0]

  return partial?.item ?? null
}
