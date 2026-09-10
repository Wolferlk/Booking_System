/**
 * The parts of Activity Check that both sides need.
 *
 * `activity-check.ts` reaches the database, so importing it from a client
 * component drags Prisma into the browser bundle and the build fails. These are
 * the field names, labels and window presets the screen renders from — pure
 * data with no server dependency — kept here and re-exported from the server
 * module so there is still one place to add a field or a preset.
 */

/** The text a keyword is matched against. */
export type ActivityField = 'activity' | 'details' | 'location' | 'route'

export const ACTIVITY_FIELDS: ActivityField[] = ['activity', 'details', 'location', 'route']

export const ACTIVITY_FIELD_LABELS: Record<ActivityField, string> = {
  activity: 'Activity / tour name',
  details:  'Details & description',
  location: 'Location / city',
  route:    'Pickup & drop points',
}

/** Named date windows, so "last week" is one click rather than two pickers. */
export type RangePreset =
  | 'today' | 'tomorrow' | 'thisWeek' | 'lastWeek' | 'nextWeek'
  | 'next7' | 'next14' | 'next30' | 'last30'
  | 'thisMonth' | 'lastMonth' | 'nextMonth' | 'custom'

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today:     'Today',
  tomorrow:  'Tomorrow',
  thisWeek:  'This week',
  lastWeek:  'Last week',
  nextWeek:  'Next week',
  next7:     'Next 7 days',
  next14:    'Next 14 days',
  next30:    'Next 30 days',
  last30:    'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  nextMonth: 'Next month',
  custom:    'Custom range',
}
