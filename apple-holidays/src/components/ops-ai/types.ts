export type ActionKind = 'READ' | 'NAV' | 'WRITE'

export interface ActionPreview {
  title: string
  lines: { label: string; before?: string; after: string }[]
}

export interface OpsAction {
  id:       string
  tool:     string
  kind:     ActionKind
  label:    string
  icon:     string
  preview:  ActionPreview | null
  envelope: Record<string, unknown>
}

export interface OpsLookup {
  tool:    string
  args:    Record<string, unknown>
  result:  unknown
  message: string
}

export interface BookingRow {
  bookingRef:    string
  status:        string
  agent:         string | null
  isNumber:      string | null
  arrivalDate:   string
  departureDate: string
  pax:           number
  country:       string | null
  destination:   string | null
}

export interface OpsMessage {
  id:      string
  role:    'user' | 'assistant'
  content: string
  actions?: OpsAction[]
  lookups?: OpsLookup[]
  error?:   boolean
  pending?: boolean
}
