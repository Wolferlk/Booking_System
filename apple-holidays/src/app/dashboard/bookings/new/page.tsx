'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Save, Upload, HardDrive, Globe } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import FileUpload from '@/components/shared/file-upload'
import CloudFilePicker, { type CloudFile } from '@/components/shared/cloud-file-picker'
import { detectCountryFromPath, detectCountryFromRef, countryLabel } from '@/lib/country-detection'

// ─── Drive options per destination country ────────────────────────────────────
const COUNTRY_DRIVES = [
  { label: 'Vietnam',   driveKey: 'VN', driveLabel: 'Vietnam (VN OPERATION)',   country: 'VIETNAM' },
  { label: 'Sri Lanka', driveKey: 'SL', driveLabel: 'Sri Lanka (SL Share Drive)', country: 'SRILANKA' },
  { label: 'Malaysia',  driveKey: 'MY', driveLabel: 'Malaysia',                  country: 'MALAYSIA' },
  { label: 'Singapore', driveKey: 'SG', driveLabel: 'Singapore',                 country: 'SINGAPORE' },
] as const

type DriveKey = typeof COUNTRY_DRIVES[number]['driveKey']

// ─── IS Number normalization ──────────────────────────────────────────────────
function normalizeISNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  return /^(VN|IS|SG|MY)\d+$/.test(cleaned) ? cleaned : null
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Passenger { name: string; type: string; age: string; isLead: boolean; passport: string; nationality: string }
interface Flight { flightNo: string; date: string; fromApt: string; depTime: string; toApt: string; arrTime: string; airline: string; notes: string }
interface Hotel { city: string; hotel: string; checkIn: string; checkOut: string; nights: string; roomType: string; mealType: string; address: string }
interface ItineraryItem { dayNo: string; date: string; title: string; description: string }
interface EmergencyContact { name: string; phone: string; role: string }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewBookingPage() {
  const router = useRouter()
  const [saving,    setSaving]    = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  // Drive picker state
  const [selectedDriveKey,  setSelectedDriveKey]  = useState<DriveKey | ''>('')
  const [drivePickerOpen,   setDrivePickerOpen]   = useState(false)
  const [sourceMode,        setSourceMode]         = useState<'pc' | 'drive' | null>(null)
  const [selectedCountry,   setSelectedCountry]   = useState<string>('')

  // Sync country from drive key whenever drive mode selection changes
  useEffect(() => {
    if (selectedDriveKey) {
      const drive = COUNTRY_DRIVES.find(d => d.driveKey === selectedDriveKey)
      if (drive) setSelectedCountry(drive.country)
    }
  }, [selectedDriveKey])

  // Form state — bookingRef starts empty, filled from IS Number on AI extraction
  const [form, setForm] = useState({
    bookingRef: '',
    agentBookingId: '',
    cntlNumber: '',
    agent: 'Make My Trip',
    fileHandler: '',
    arrivalDate: '',
    departureDate: '',
    paxAdults: '2',
    paxChildren: '0',
    quotedTotal: '',
    currency: 'USD',
    terms: '',
    exclusions: '',
    policyNotes: '',
    amendmentNote: '',
    agentEmail: '',
    agentPhone: '',
    agentWhatsapp: '',
    contactEmail: '',
    contactPhone: '',
    contactWhatsapp: '',
    // Additional TC sections
    valueAddedServices: '',
    packageIncludes: '',
    packageExcludes: '',
    importantNotes: '',
    tips: '',
    otherNote: '',
    clientRequest: '',
  })

  const [passengers,        setPassengers]        = useState<Passenger[]>([
    { name: '', type: 'ADULT', age: '', isLead: true, passport: '', nationality: '' },
  ])
  const [flights,           setFlights]           = useState<Flight[]>([
    { flightNo: '', date: '', fromApt: '', depTime: '', toApt: '', arrTime: '', airline: '', notes: '' },
  ])
  const [hotels,            setHotels]            = useState<Hotel[]>([
    { city: '', hotel: '', checkIn: '', checkOut: '', nights: '', roomType: '', mealType: '', address: '' },
  ])
  const [itinerary,         setItinerary]         = useState<ItineraryItem[]>([
    { dayNo: '1', date: '', title: '', description: '' },
  ])
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([
    { name: '', phone: '', role: '' },
  ])

  // ── Apply extracted data to form ──────────────────────────────────────────
  function handleAIParsed(data: Record<string, unknown>) {
    if (!data) return

    // IS Number is the booking reference — normalize and use directly
    const extractedISNumber = normalizeISNumber(data.isNumber as string | null)

    setForm(prev => ({
      ...prev,
      // bookingRef = IS Number (the extracted IS Number is the canonical booking reference)
      bookingRef:     extractedISNumber || prev.bookingRef,
      agentBookingId: (data.agentBookingId as string) || prev.agentBookingId,
      cntlNumber:     (data.cntlNumber     as string) || prev.cntlNumber,
      agent:          (data.agent          as string) || prev.agent,
      fileHandler:    (data.fileHandler    as string) || prev.fileHandler,
      arrivalDate:    (data.arrivalDate    as string)?.slice(0, 10) || prev.arrivalDate,
      departureDate:  (data.departureDate  as string)?.slice(0, 10) || prev.departureDate,
      paxAdults:      String(data.paxAdults   ?? prev.paxAdults),
      paxChildren:    String(data.paxChildren ?? prev.paxChildren),
      quotedTotal:    String(data.quotedTotal ?? prev.quotedTotal),
      currency:       (data.currency       as string) || prev.currency,
      terms:          (data.terms          as string) || prev.terms,
      exclusions:     (data.exclusions     as string) || prev.exclusions,
      policyNotes:    (data.policyNotes    as string) || prev.policyNotes,
      amendmentNote:  (data.amendmentNote  as string) || prev.amendmentNote,
      agentEmail:     (data.agentEmail     as string) || prev.agentEmail,
      agentPhone:     (data.agentPhone     as string) || prev.agentPhone,
      agentWhatsapp:  (data.agentWhatsapp  as string) || prev.agentWhatsapp,
      contactEmail:   (data.contactEmail   as string) || prev.contactEmail,
      contactPhone:   (data.contactPhone   as string) || prev.contactPhone,
      contactWhatsapp:(data.contactWhatsapp as string) || prev.contactWhatsapp,
      // Additional TC sections
      valueAddedServices: (data.valueAddedServices as string) || prev.valueAddedServices,
      packageIncludes:    (data.packageIncludes    as string) || prev.packageIncludes,
      packageExcludes:    (data.packageExcludes    as string) || prev.packageExcludes,
      importantNotes:     (data.importantNotes     as string) || prev.importantNotes,
      tips:               (data.tips               as string) || prev.tips,
      otherNote:          (data.otherNote          as string) || prev.otherNote,
      clientRequest:      (data.clientRequest      as string) || prev.clientRequest,
    }))

    const pax = data.passengers as Passenger[] | undefined
    if (pax?.length) setPassengers(pax.map(p => ({
      name:        String(p.name        ?? ''),
      type:        String(p.type        ?? 'ADULT'),
      age:         String(p.age         ?? ''),
      isLead:      Boolean(p.isLead),
      passport:    String(p.passport    ?? ''),
      nationality: String(p.nationality ?? ''),
    })))

    const fl = data.flights as Flight[] | undefined
    if (fl?.length) {
      setFlights(fl.map(f => ({
        flightNo: String(f.flightNo ?? ''),
        date:     String(f.date     ?? '').slice(0, 10),
        fromApt:  String(f.fromApt  ?? ''),
        depTime:  String(f.depTime  ?? ''),
        toApt:    String(f.toApt    ?? ''),
        arrTime:  String(f.arrTime  ?? ''),
        airline:  String(f.airline  ?? ''),
        notes:    String(f.notes    ?? ''),
      })))
    }

    const ac = data.accommodations as Record<string, unknown>[] | undefined
    if (ac?.length) setHotels(ac.map(h => ({
      city:     String(h.city     ?? ''),
      hotel:    String(h.hotel    ?? ''),
      checkIn:  String(h.checkIn  ?? ''),
      checkOut: String(h.checkOut ?? ''),
      nights:   String(h.nights   ?? ''),
      roomType: String(h.roomType ?? ''),
      mealType: String(h.mealType ?? ''),
      address:  String(h.address  ?? ''),
    })))

    const it = data.itineraryItems as ItineraryItem[] | undefined
    if (it?.length) setItinerary(it.map(i => ({
      dayNo:       String(i.dayNo       ?? ''),
      date:        String(i.date        ?? '').slice(0, 10),
      title:       String(i.title       ?? ''),
      description: String(i.description ?? ''),
    })))

    const ec = data.emergencyContacts as Record<string, unknown>[] | undefined
    if (ec?.length) setEmergencyContacts(ec.map(e => ({
      name:  String(e.name  ?? ''),
      phone: String(e.phone ?? ''),
      role:  String(e.role  ?? ''),
    })))
  }

  // ── File selected from OneDrive picker ────────────────────────────────────
  async function handleDriveFileSelected(file: CloudFile, folderPath?: string) {
    setDrivePickerOpen(false)
    if (!selectedDriveKey) return
    setAiLoading(true)
    try {
      const res  = await fetch(`/api/drives/${selectedDriveKey}/extract`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemId: file.id, itemName: file.name }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      handleAIParsed(json.data.extracted)

      const extractedRef = (json.data.extracted?.bookingRef as string) || ''
      const detected =
        detectCountryFromPath(folderPath) ||
        detectCountryFromPath(file.webUrl) ||
        (extractedRef ? detectCountryFromRef(extractedRef) : null)
      if (detected && detected !== selectedCountry) {
        setSelectedCountry(detected)
        toast.success(`Extracted from "${file.name}" — detected ${countryLabel(detected)}`)
      } else {
        toast.success(`Booking details extracted from "${file.name}"`)
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setAiLoading(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (!selectedCountry) {
        toast.error('Please select a destination country before creating the booking')
        setSaving(false)
        return
      }

      if (!form.bookingRef.trim()) {
        toast.error('Booking Reference is required. Upload a TC document to extract the IS Number, or enter it manually.')
        setSaving(false)
        return
      }

      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          operationCountry:  selectedCountry,
          paxAdults:         Number(form.paxAdults),
          paxChildren:       Number(form.paxChildren),
          quotedTotal:       Number(form.quotedTotal),
          passengers:        passengers.filter(p => p.name),
          flights:           flights.filter(f => f.flightNo),
          accommodations:    hotels.filter(h => h.hotel).map(h => ({ ...h, nights: Number(h.nights) })),
          itineraryItems:    itinerary.filter(i => i.title).map(i => ({ ...i, dayNo: Number(i.dayNo) })),
          emergencyContacts: emergencyContacts.filter(e => e.name),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Booking created successfully!')
      router.push(`/dashboard/bookings/${json.data.bookingRef}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create booking')
    } finally {
      setSaving(false)
    }
  }

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card>
      <CardHeader><h3 className="text-base font-semibold text-slate-900">{title}</h3></CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  )

  const activeDrive = COUNTRY_DRIVES.find(d => d.driveKey === selectedDriveKey)

  return (
    <div>
      <Header title="New Booking" subtitle="Create a booking from quotation or enter manually" />
      <div className="p-8 space-y-6 ">

        {/* ── AI Document Parser ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-slate-900">AI Document Parser</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload or select a tour confirmation — AI will auto-fill the form below. The IS Number from the document becomes the Booking Reference.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">

            {/* Source selector */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSourceMode(sourceMode === 'pc' ? null : 'pc')}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  sourceMode === 'pc'
                    ? 'border-brand-400 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Upload className={`w-4 h-4 ${sourceMode === 'pc' ? 'text-brand-600' : 'text-slate-500'}`} />
                  <p className="font-semibold text-slate-900 text-sm">Upload from PC</p>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Upload a .docx or .pdf file from your computer. AI will extract all booking details.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSourceMode(sourceMode === 'drive' ? null : 'drive')}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  sourceMode === 'drive'
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <HardDrive className={`w-4 h-4 ${sourceMode === 'drive' ? 'text-blue-600' : 'text-slate-500'}`} />
                  <p className="font-semibold text-slate-900 text-sm">Browse from OneDrive</p>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  Select destination country, then browse the company OneDrive and pick a file.
                </p>
              </button>
            </div>

            {/* PC upload panel */}
            {sourceMode === 'pc' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                {/* Country selector for PC mode */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-brand-500" /> Destination Country *
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {COUNTRY_DRIVES.map(d => (
                      <button
                        key={d.driveKey}
                        type="button"
                        onClick={() => setSelectedCountry(d.country)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          selectedCountry === d.country
                            ? 'border-brand-500 bg-brand-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {!selectedCountry && (
                    <p className="text-xs text-amber-600 font-medium mt-1.5">Select a country so the booking is scoped correctly.</p>
                  )}
                </div>

                {aiLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Extracting booking details with AI…
                  </div>
                ) : (
                  <FileUpload
                    uploadType="booking"
                    onParsed={handleAIParsed}
                    label="Upload Tour Confirmation"
                    description="Drag & drop a .docx or .pdf file — AI will extract all booking details"
                  />
                )}
              </div>
            )}

            {/* OneDrive panel */}
            {sourceMode === 'drive' && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
                {/* Country / drive selector */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-blue-500" /> Select Destination Country
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {COUNTRY_DRIVES.map(d => (
                      <button
                        key={d.driveKey}
                        type="button"
                        onClick={() => setSelectedDriveKey(d.driveKey)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          selectedDriveKey === d.driveKey
                            ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Open drive button */}
                {selectedDriveKey ? (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDrivePickerOpen(true)}
                      disabled={aiLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-60"
                    >
                      {aiLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting with AI…</>
                        : <><HardDrive className="w-4 h-4" /> Open {activeDrive?.label} Drive</>
                      }
                    </button>
                    <p className="text-xs text-slate-500">
                      Browse <span className="font-semibold text-slate-700">{activeDrive?.driveLabel}</span> and select a tour confirmation file.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-medium">
                    Select a country above to open the correct OneDrive.
                  </p>
                )}
              </div>
            )}

          </CardBody>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Booking details */}
          <Section title="Booking Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="form-label flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-slate-400" /> Destination Country *
                </label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {COUNTRY_DRIVES.map(d => (
                    <button
                      key={d.driveKey}
                      type="button"
                      onClick={() => setSelectedCountry(d.country)}
                      className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
                        selectedCountry === d.country
                          ? 'border-brand-500 bg-brand-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                  {!selectedCountry && (
                    <span className="text-xs text-amber-600 font-medium self-center ml-1">Required — select a country</span>
                  )}
                </div>
              </div>
              <div>
                <label className="form-label">Booking Ref (IS Number) *</label>
                <input
                  className="form-input font-mono"
                  required
                  placeholder="e.g. VN19005, IS48377, SG22232"
                  value={form.bookingRef}
                  onChange={e => setForm(p => ({ ...p, bookingRef: e.target.value.trim().toUpperCase() }))}
                />
                <p className="text-xs text-slate-400 mt-0.5">Filled automatically from the IS Number in the TC document</p>
              </div>
              <div>
                <label className="form-label">CNTL No.</label>
                <input className="form-input font-mono" placeholder="e.g. 463720CNTL, CNTL459773" value={form.cntlNumber}
                  onChange={e => setForm(p => ({ ...p, cntlNumber: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Agent Ref. No.</label>
                <input className="form-input" placeholder="Agent booking reference" value={form.agentBookingId}
                  onChange={e => setForm(p => ({ ...p, agentBookingId: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Agent</label>
                <input className="form-input" value={form.agent}
                  onChange={e => setForm(p => ({ ...p, agent: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">File Handler</label>
                <input className="form-input" value={form.fileHandler}
                  onChange={e => setForm(p => ({ ...p, fileHandler: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Arrival Date *</label>
                <input type="date" className="form-input" required value={form.arrivalDate}
                  onChange={e => setForm(p => ({ ...p, arrivalDate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Departure Date *</label>
                <input type="date" className="form-input" required value={form.departureDate}
                  onChange={e => setForm(p => ({ ...p, departureDate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Adults *</label>
                <input type="number" min="1" className="form-input" required value={form.paxAdults}
                  onChange={e => setForm(p => ({ ...p, paxAdults: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Children</label>
                <input type="number" min="0" className="form-input" value={form.paxChildren}
                  onChange={e => setForm(p => ({ ...p, paxChildren: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Quoted Total *</label>
                <div className="flex gap-2">
                  <select className="form-select w-24" value={form.currency}
                    onChange={e => setForm(p => ({ ...p, currency: e.target.value }))}>
                    <option>USD</option><option>INR</option><option>VND</option><option>SGD</option>
                    <option>LKR</option><option>MYR</option>
                  </select>
                  <input type="number" step="0.01" min="0" className="form-input flex-1" required
                    value={form.quotedTotal}
                    onChange={e => setForm(p => ({ ...p, quotedTotal: e.target.value }))} />
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="form-label">Amendment Note</label>
                <input className="form-input" placeholder="e.g. 02. AMENDED — Cruise Lunch Changed"
                  value={form.amendmentNote}
                  onChange={e => setForm(p => ({ ...p, amendmentNote: e.target.value }))} />
              </div>
            </div>
          </Section>

          {/* Passengers */}
          <Section title="Passengers">
            <div className="space-y-3">
              {passengers.map((p, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-3 bg-slate-50 rounded-lg relative">
                  <div>
                    <label className="form-label text-xs">Name</label>
                    <input className="form-input text-sm" placeholder="Full name" value={p.name}
                      onChange={e => setPassengers(ps => ps.map((px, j) => j === i ? { ...px, name: e.target.value } : px))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Type</label>
                    <select className="form-select text-sm" value={p.type}
                      onChange={e => setPassengers(ps => ps.map((px, j) => j === i ? { ...px, type: e.target.value } : px))}>
                      <option value="ADULT">Adult</option>
                      <option value="CHILD">Child</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label text-xs">Age</label>
                    <input type="number" className="form-input text-sm" value={p.age}
                      onChange={e => setPassengers(ps => ps.map((px, j) => j === i ? { ...px, age: e.target.value } : px))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Passport No</label>
                    <input className="form-input text-sm" value={p.passport}
                      onChange={e => setPassengers(ps => ps.map((px, j) => j === i ? { ...px, passport: e.target.value } : px))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Nationality</label>
                    <input className="form-input text-sm" value={p.nationality}
                      onChange={e => setPassengers(ps => ps.map((px, j) => j === i ? { ...px, nationality: e.target.value } : px))} />
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer mb-2">
                      <input type="checkbox" checked={p.isLead}
                        onChange={() => setPassengers(ps => ps.map((px, j) => ({ ...px, isLead: j === i })))} />
                      Lead
                    </label>
                    {passengers.length > 1 && (
                      <button type="button" onClick={() => setPassengers(ps => ps.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 mb-2">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
                onClick={() => setPassengers(ps => [...ps, { name: '', type: 'ADULT', age: '', isLead: false, passport: '', nationality: '' }])}>
                Add Passenger
              </Button>
            </div>
          </Section>

          {/* Flights */}
          <Section title="Flights">
            <div className="space-y-3">
              {flights.map((f, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 p-3 bg-slate-50 rounded-lg">
                  {[
                    { label: 'Flight No', key: 'flightNo', type: 'text',  placeholder: 'VJ517' },
                    { label: 'Date',      key: 'date',     type: 'date',  placeholder: '' },
                    { label: 'From',      key: 'fromApt',  type: 'text',  placeholder: 'HAN' },
                    { label: 'Dep',       key: 'depTime',  type: 'time',  placeholder: '' },
                    { label: 'To',        key: 'toApt',    type: 'text',  placeholder: 'SGN' },
                    { label: 'Arr',       key: 'arrTime',  type: 'time',  placeholder: '' },
                    { label: 'Airline',   key: 'airline',  type: 'text',  placeholder: 'Vietnam Airlines' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="form-label text-xs">{field.label}</label>
                      <input type={field.type} className="form-input text-sm" placeholder={field.placeholder}
                        value={(f as unknown as Record<string, string>)[field.key]}
                        onChange={e => setFlights(fs => fs.map((fx, j) => j === i ? { ...fx, [field.key]: e.target.value } : fx))} />
                    </div>
                  ))}
                  <div className="sm:col-span-2 lg:col-span-7">
                    <label className="form-label text-xs">Notes</label>
                    <input
                      className="form-input text-sm"
                      placeholder="Optional flight notes"
                      value={f.notes}
                      onChange={e => setFlights(fs => fs.map((fx, j) => j === i ? { ...fx, notes: e.target.value } : fx))}
                    />
                  </div>
                  <div className="flex items-end pb-0.5">
                    {flights.length > 1 && (
                      <button type="button" onClick={() => setFlights(fs => fs.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
                onClick={() => setFlights(fs => [...fs, { flightNo: '', date: '', fromApt: '', depTime: '', toApt: '', arrTime: '', airline: '', notes: '' }])}>
                Add Flight
              </Button>
            </div>
          </Section>

          {/* Hotels */}
          <Section title="Accommodation">
            <div className="space-y-3">
              {hotels.map((h, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg">
                  {[
                    { label: 'City',      key: 'city',     placeholder: 'Hanoi' },
                    { label: 'Hotel Name',key: 'hotel',    placeholder: 'Hotel Name' },
                    { label: 'Room Type', key: 'roomType', placeholder: 'Deluxe' },
                    { label: 'Meal Plan', key: 'mealType', placeholder: 'BB' },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="form-label text-xs">{field.label}</label>
                      <input className="form-input text-sm" placeholder={field.placeholder}
                        value={(h as unknown as Record<string, string>)[field.key]}
                        onChange={e => setHotels(hs => hs.map((hx, j) => j === i ? { ...hx, [field.key]: e.target.value } : hx))} />
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2 col-span-full">
                    {[
                      { label: 'Check-in',  key: 'checkIn',  type: 'date' },
                      { label: 'Check-out', key: 'checkOut', type: 'date' },
                      { label: 'Nights',    key: 'nights',   type: 'number' },
                    ].map(field => (
                      <div key={field.key}>
                        <label className="form-label text-xs">{field.label}</label>
                        <input type={field.type} className="form-input text-sm"
                          value={(h as unknown as Record<string, string>)[field.key]}
                          onChange={e => setHotels(hs => hs.map((hx, j) => j === i ? { ...hx, [field.key]: e.target.value } : hx))} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end">
                    {hotels.length > 1 && (
                      <button type="button" onClick={() => setHotels(hs => hs.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
                onClick={() => setHotels(hs => [...hs, { city: '', hotel: '', checkIn: '', checkOut: '', nights: '', roomType: '', mealType: '', address: '' }])}>
                Add Hotel
              </Button>
            </div>
          </Section>

          {/* Itinerary */}
          <Section title="Itinerary">
            <div className="space-y-3">
              {itinerary.map((it, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg">
                  <div>
                    <label className="form-label text-xs">Day</label>
                    <input type="number" className="form-input text-sm" min="1" value={it.dayNo}
                      onChange={e => setItinerary(its => its.map((ix, j) => j === i ? { ...ix, dayNo: e.target.value } : ix))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Date</label>
                    <input type="date" className="form-input text-sm" value={it.date}
                      onChange={e => setItinerary(its => its.map((ix, j) => j === i ? { ...ix, date: e.target.value } : ix))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Activity Title</label>
                    <input className="form-input text-sm" value={it.title}
                      onChange={e => setItinerary(its => its.map((ix, j) => j === i ? { ...ix, title: e.target.value } : ix))} />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="form-label text-xs">Description</label>
                      <input className="form-input text-sm" value={it.description}
                        onChange={e => setItinerary(its => its.map((ix, j) => j === i ? { ...ix, description: e.target.value } : ix))} />
                    </div>
                    {itinerary.length > 1 && (
                      <button type="button" onClick={() => setItinerary(its => its.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 self-end pb-0.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
                onClick={() => setItinerary(its => [...its, { dayNo: String(its.length + 1), date: '', title: '', description: '' }])}>
                Add Day
              </Button>
            </div>
          </Section>

          {/* Package Sections */}
          <Section title="Package Details">
            <div className="grid gap-4">
              <div>
                <label className="form-label">Value Added Services</label>
                <textarea className="form-textarea" rows={2} value={form.valueAddedServices}
                  onChange={e => setForm(p => ({ ...p, valueAddedServices: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Above Package Includes</label>
                <textarea className="form-textarea" rows={3} value={form.packageIncludes}
                  onChange={e => setForm(p => ({ ...p, packageIncludes: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">The Above Package Excludes</label>
                <textarea className="form-textarea" rows={3} value={form.packageExcludes}
                  onChange={e => setForm(p => ({ ...p, packageExcludes: e.target.value }))} />
              </div>
            </div>
          </Section>

          {/* Terms & Notes */}
          <Section title="Terms, Notes & Client Requests">
            <div className="grid gap-4">
              <div>
                <label className="form-label">Terms &amp; Conditions</label>
                <textarea className="form-textarea" rows={3} value={form.terms}
                  onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Exclusions</label>
                <textarea className="form-textarea" rows={2} value={form.exclusions}
                  onChange={e => setForm(p => ({ ...p, exclusions: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Policy Notes</label>
                <textarea className="form-textarea" rows={2} value={form.policyNotes}
                  onChange={e => setForm(p => ({ ...p, policyNotes: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Important Notes</label>
                <textarea className="form-textarea" rows={2} value={form.importantNotes}
                  onChange={e => setForm(p => ({ ...p, importantNotes: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Tips</label>
                <textarea className="form-textarea" rows={2} value={form.tips}
                  onChange={e => setForm(p => ({ ...p, tips: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Other Note</label>
                <textarea className="form-textarea" rows={2} value={form.otherNote}
                  onChange={e => setForm(p => ({ ...p, otherNote: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Client Request</label>
                <textarea className="form-textarea" rows={2} value={form.clientRequest}
                  onChange={e => setForm(p => ({ ...p, clientRequest: e.target.value }))} />
              </div>
            </div>
          </Section>

          {/* Contact Information */}
          <Section title="Contact Information">
            <p className="text-xs text-slate-500 mb-4">Auto-filled by AI from the document. Email confirmation will go to Agent email; WhatsApp will be sent to Customer.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Agent / Travel Company</p>
                {[
                  { label: 'Agent Email',    key: 'agentEmail',    type: 'email', placeholder: 'agent@travelco.com' },
                  { label: 'Agent Phone',    key: 'agentPhone',    type: 'tel',   placeholder: '+91 98765 43210' },
                  { label: 'Agent WhatsApp', key: 'agentWhatsapp', type: 'tel',   placeholder: '919876543210 (no +)' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="form-label text-xs">{f.label}</label>
                    <input className="form-input" type={f.type} placeholder={f.placeholder}
                      value={(form as unknown as Record<string, string>)[f.key]}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer / Guest</p>
                {[
                  { label: 'Customer Email',    key: 'contactEmail',    type: 'email', placeholder: 'customer@gmail.com' },
                  { label: 'Customer Phone',    key: 'contactPhone',    type: 'tel',   placeholder: '+94 77 123 4567' },
                  { label: 'Customer WhatsApp', key: 'contactWhatsapp', type: 'tel',   placeholder: '94771234567 (no +)' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="form-label text-xs">{f.label}</label>
                    <input className="form-input" type={f.type} placeholder={f.placeholder}
                      value={(form as unknown as Record<string, string>)[f.key]}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Emergency Contacts */}
          <Section title="Emergency Contacts">
            <div className="space-y-3">
              {emergencyContacts.map((ec, i) => (
                <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg">
                  <div>
                    <label className="form-label text-xs">Name</label>
                    <input className="form-input text-sm" value={ec.name}
                      onChange={e => setEmergencyContacts(ecs => ecs.map((c, j) => j === i ? { ...c, name: e.target.value } : c))} />
                  </div>
                  <div>
                    <label className="form-label text-xs">Phone</label>
                    <input className="form-input text-sm" value={ec.phone}
                      onChange={e => setEmergencyContacts(ecs => ecs.map((c, j) => j === i ? { ...c, phone: e.target.value } : c))} />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="form-label text-xs">Role</label>
                      <input className="form-input text-sm" placeholder="e.g. Operations Manager" value={ec.role}
                        onChange={e => setEmergencyContacts(ecs => ecs.map((c, j) => j === i ? { ...c, role: e.target.value } : c))} />
                    </div>
                    {emergencyContacts.length > 1 && (
                      <button type="button" onClick={() => setEmergencyContacts(ecs => ecs.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-600 self-end pb-0.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" icon={<Plus className="w-3 h-3" />}
                onClick={() => setEmergencyContacts(ecs => [...ecs, { name: '', phone: '', role: '' }])}>
                Add Contact
              </Button>
            </div>
          </Section>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} icon={<Save className="w-4 h-4" />}>
              Create Booking
            </Button>
          </div>
        </form>

      </div>

      {/* OneDrive file picker modal */}
      {selectedDriveKey && (
        <CloudFilePicker
          driveKey={selectedDriveKey}
          driveLabel={activeDrive?.driveLabel}
          open={drivePickerOpen}
          onClose={() => setDrivePickerOpen(false)}
          onSelect={handleDriveFileSelected}
          filterExtensions={['.pdf', '.docx', '.doc', '.txt']}
          title={`Browse ${activeDrive?.label} Drive`}
          selectLabel="Extract Booking Details"
        />
      )}
    </div>
  )
}
