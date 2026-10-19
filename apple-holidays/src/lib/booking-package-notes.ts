/**
 * The booking's "Package Details & Notes" fields, in the order the booking page
 * shows them. Shared by the confirmation / full-details PDF and Word documents
 * (the files sent over WhatsApp and email) and the /print/booking page, so the
 * three always carry the same sections.
 */
export const PACKAGE_NOTE_SECTIONS = [
  { key: 'valueAddedServices', label: 'Value Added Services' },
  { key: 'packageIncludes',    label: 'Above Package Includes' },
  { key: 'packageExcludes',    label: 'The Above Package Excludes' },
  { key: 'terms',              label: 'Terms & Conditions' },
  { key: 'exclusions',         label: 'Exclusions' },
  { key: 'policyNotes',        label: 'Policy Notes' },
  { key: 'importantNotes',     label: 'Important Notes' },
  { key: 'tips',               label: 'Tips' },
  { key: 'otherNote',          label: 'Other Note' },
  { key: 'clientRequest',      label: 'Client Request' },
] as const

export type PackageNoteKey = typeof PACKAGE_NOTE_SECTIONS[number]['key']

/** The sections that have text on this booking, trimmed, in display order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filledPackageNotes(booking: any): { key: PackageNoteKey; label: string; text: string }[] {
  return PACKAGE_NOTE_SECTIONS
    .map(s => ({ key: s.key, label: s.label, text: String(booking?.[s.key] ?? '').trim() }))
    .filter(s => s.text !== '')
}
