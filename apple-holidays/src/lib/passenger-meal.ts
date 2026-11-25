/**
 * One place that answers "what does this passenger eat?".
 *
 * A passenger's dietary needs live in two stores:
 *   • `Passenger.mealPreference` — the meal chips on the booking page
 *     ("Vegetarian, Halal"), and whatever the TC extraction found.
 *   • `passenger_special_notes` — the free-text Special Note on the booking
 *     page ("Only veg", "Severe nut allergy"). See src/lib/passenger-notes.ts.
 *
 * The agenda page, PDF and Word used to read only the first, so a meal need
 * typed as a Special Note never reached the movement chart. Everything that
 * shows meals reads through here instead.
 *
 * Pure and import-free so both client pages and server renderers can use it.
 */

/** Words that make a Special Note a food/diet matter (and so safe and useful to print on the guest's agenda). */
const DIETARY_RE = new RegExp(
  '\\b(' + [
    'veg', 'vegs', 'veggie', 'vegetarian', 'vegan', 'non[- ]?veg', 'pure[- ]?veg', 'eggetarian',
    'halal', 'kosher', 'jain', 'satvik', 'sattvic',
    'gluten', 'celiac', 'coeliac', 'lactose', 'dairy', 'milk',
    'nuts?', 'peanuts?', 'allerg\\w*', 'intoleran\\w*',
    'pork', 'beef', 'mutton', 'chicken', 'meat', 'seafood', 'shellfish', 'prawns?', 'fish', 'eggs?',
    'onion', 'garlic', 'spicy', 'diabet\\w*', 'sugar[- ]?free', 'low[- ]?salt',
    'meals?', 'food', 'diet\\w*', 'breakfast', 'lunch', 'dinner',
  ].join('|') + ')\\b',
  'i',
)

/** True when a Special Note is about food or diet. */
export function isDietaryNote(note: string | null | undefined): boolean {
  return !!note && DIETARY_RE.test(note)
}

/** "Vegetarian, Halal" → ["Vegetarian", "Halal"]. */
export function mealPreferenceList(pref: string | null | undefined): string[] {
  return String(pref ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * The text for a "Meal Preference" cell on a printed agenda.
 * Chips first, then a dietary Special Note. Non-dietary notes ("surprise
 * anniversary cake") are internal and stay off customer documents.
 */
export function mealCellText(pref: string | null | undefined, note: string | null | undefined): string {
  const parts = mealPreferenceList(pref)
  const n = String(note ?? '').replace(/\s+/g, ' ').trim()
  if (n && isDietaryNote(n) && !parts.some(p => p.toLowerCase() === n.toLowerCase())) parts.push(n)
  return parts.join(' · ')
}
