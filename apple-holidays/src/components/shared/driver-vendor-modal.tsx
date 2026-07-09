'use client'

import { useEffect, useState } from 'react'
import { Loader2, Phone, Mail, CreditCard, Car, Building2, MapPin } from 'lucide-react'
import Modal from '@/components/ui/modal'

interface FullDriver {
  id: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  photoUrl: string | null
  vehicle: {
    plateNo: string
    type: string
    brand: string | null
    model: string | null
    capacity: number
    description: string | null
    photoOutside: string | null
    photoInside: string | null
  } | null
}

interface FullVendor {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  drivers: {
    id: string
    name: string
    phone: string
    photoUrl: string | null
    isActive: boolean
    vehicle: { plateNo: string; type: string } | null
  }[]
  vehicles: { id: string; type: string; plateNo: string; photoOutside: string | null }[]
}

export interface DriverVendorFallback {
  driverName?: string | null
  driverPhone?: string | null
  vehicleType?: string | null
  vehiclePlate?: string | null
  vendorName?: string | null
}

interface DriverVendorModalProps {
  open: boolean
  onClose: () => void
  driverId?: string | null
  vendorId?: string | null
  fallback?: DriverVendorFallback
}

function PhotoTile({ label, src }: { label: string; src: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">{label}</p>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="w-full h-32 object-cover rounded-lg border border-slate-200" />
      ) : (
        <div className="w-full h-32 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-sm font-medium">
          N/A
        </div>
      )}
    </div>
  )
}

function DriverSection({ driver }: { driver: FullDriver }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        {driver.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={driver.photoUrl} alt={driver.name} className="w-16 h-16 rounded-full object-cover border-2 border-slate-200" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-bold flex-shrink-0">
            {driver.name.charAt(0) || '?'}
          </div>
        )}
        <div>
          <h3 className="text-lg font-bold text-slate-900">{driver.name}</h3>
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex items-center gap-1.5 text-sm text-slate-600">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              {driver.phone || <span className="text-slate-300">N/A</span>}
            </div>
            {driver.email && (
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                {driver.email}
              </div>
            )}
            {driver.licenseNo && (
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                License: <span className="font-mono">{driver.licenseNo}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Car className="w-4 h-4 text-blue-500" /> Vehicle
        </h4>
        {driver.vehicle ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'Plate Number', value: driver.vehicle.plateNo },
                { label: 'Type',         value: driver.vehicle.type },
                { label: 'Brand',        value: driver.vehicle.brand },
                { label: 'Model',        value: driver.vehicle.model },
                { label: 'Capacity',     value: driver.vehicle.capacity ? `${driver.vehicle.capacity} seats` : null },
                { label: 'Description',  value: driver.vehicle.description },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5">{value || <span className="text-slate-300">N/A</span>}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PhotoTile label="Outside Photo" src={driver.vehicle.photoOutside} />
              <PhotoTile label="Inside Photo" src={driver.vehicle.photoInside} />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400 italic">No vehicle assigned to this driver</p>
        )}
      </div>
    </div>
  )
}

export default function DriverVendorModal({ open, onClose, driverId, vendorId, fallback }: DriverVendorModalProps) {
  const [loading, setLoading]         = useState(false)
  const [fullDriver, setFullDriver]   = useState<FullDriver | null>(null)
  const [fullVendor, setFullVendor]   = useState<FullVendor | null>(null)

  useEffect(() => {
    if (!open) return
    setFullDriver(null)
    setFullVendor(null)

    if (driverId) {
      setLoading(true)
      fetch(`/api/ground/drivers/${driverId}`)
        .then(res => res.json())
        .then(json => { if (json.success) setFullDriver(json.data as FullDriver) })
        .finally(() => setLoading(false))
      return
    }

    if (vendorId) {
      setLoading(true)
      fetch(`/api/ground/vendors/${vendorId}`)
        .then(res => res.json())
        .then(json => { if (json.success) setFullVendor(json.data as FullVendor) })
        .finally(() => setLoading(false))
      return
    }
  }, [open, driverId, vendorId])

  const title = driverId ? 'Driver & Vehicle Details' : vendorId ? 'Vendor Details' : 'Assignment Details'

  const hasAnyLink = Boolean(driverId || vendorId)
  const hasFallbackDriver = Boolean(fallback?.driverName || fallback?.vehiclePlate)

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
        </div>
      ) : fullDriver ? (
        <DriverSection driver={fullDriver} />
      ) : fullVendor ? (
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-2xl font-bold flex-shrink-0">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{fullVendor.name}</h3>
              <div className="flex flex-col gap-1 mt-1">
                {fullVendor.phone && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {fullVendor.phone}
                  </div>
                )}
                {fullVendor.email && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    {fullVendor.email}
                  </div>
                )}
                {fullVendor.address && (
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {fullVendor.address}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Driver assigned to this specific movement (denormalized on the assignment) */}
          {hasFallbackDriver && (
            <div className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Car className="w-4 h-4 text-blue-500" /> Driver for this movement
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Driver</p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5">{fallback?.driverName || <span className="text-slate-300">N/A</span>}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Phone</p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5">{fallback?.driverPhone || <span className="text-slate-300">N/A</span>}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Vehicle Type</p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5">{fallback?.vehicleType || <span className="text-slate-300">N/A</span>}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Plate</p>
                  <p className="text-sm font-medium text-slate-800 mt-0.5 font-mono">{fallback?.vehiclePlate || <span className="text-slate-300 font-sans">N/A</span>}</p>
                </div>
              </div>
            </div>
          )}

          {fullVendor.drivers.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Vendor Fleet — Drivers</h4>
              <div className="space-y-2">
                {fullVendor.drivers.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    {d.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.photoUrl} alt={d.name} className="w-9 h-9 rounded-full object-cover border border-slate-200" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold flex-shrink-0">
                        {d.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
                      <p className="text-xs text-slate-500">{d.phone}{d.vehicle ? ` · ${d.vehicle.type} ${d.vehicle.plateNo}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        // No driverId/vendorId link — fall back to whatever was denormalized on the assignment
        <div className="space-y-3">
          {fallback?.vendorName && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Vendor</p>
              <p className="text-sm font-semibold text-violet-700 mt-0.5">{fallback.vendorName}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Driver</p>
            <p className="text-sm font-medium text-slate-800 mt-0.5">{fallback?.driverName || <span className="text-slate-300 italic">Not assigned</span>}</p>
          </div>
          {fallback?.driverPhone && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Phone</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5">{fallback.driverPhone}</p>
            </div>
          )}
          {(fallback?.vehicleType || fallback?.vehiclePlate) && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Vehicle</p>
              <p className="text-sm font-medium text-slate-800 mt-0.5 font-mono">{[fallback.vehicleType, fallback.vehiclePlate].filter(Boolean).join(' ')}</p>
            </div>
          )}
          {!hasAnyLink && !hasFallbackDriver && !fallback?.vendorName && (
            <p className="text-sm text-slate-400 italic">No driver or vendor assigned to this movement.</p>
          )}
        </div>
      )}
    </Modal>
  )
}
