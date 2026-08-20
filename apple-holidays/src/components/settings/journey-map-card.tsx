'use client'

/**
 * How the journey map's fly-through plays — set once, for everybody.
 *
 * The pace lives here rather than only in the map because the two audiences
 * cannot be asked to find it themselves: an operator scanning a file wants the
 * route read to them slowly enough to follow, and a traveller opening their
 * portal on a phone gets whatever we chose. A viewer can still override the
 * speed from the map itself, which is remembered in their own browser and
 * never written back here.
 */

import { Gauge, Film, PanelRightOpen, Maximize2 } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  DEFAULT_JM_SETTINGS, JM_SETTING_KEYS, JM_SPEED_STEPS, speedLabel,
} from '@/lib/journey-map-settings'

interface Props {
  /** The slice of the `system_settings` map this card owns. */
  settings: {
    journey_map_speed?: string
    journey_map_follow_zoom?: string
    journey_map_cinematic?: string
    journey_map_auto_open?: string
    journey_map_portal_fullscreen?: string
  }
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

/** The camera distances worth offering, described by what they show. */
const ZOOMS = [
  { value: 10.5, label: 'Regional', hint: 'the whole province around the road' },
  { value: 12.5, label: 'Town',     hint: 'streets and the town they pass through' },
  { value: 14,   label: 'Street',   hint: 'close enough to read street names' },
] as const

export default function JourneyMapCard({ settings, saving, onSave }: Props) {
  const speed = Number(settings.journey_map_speed) || DEFAULT_JM_SETTINGS.speed
  const zoom = Number(settings.journey_map_follow_zoom) || DEFAULT_JM_SETTINGS.followZoom
  const cinematic = (settings.journey_map_cinematic ?? String(DEFAULT_JM_SETTINGS.cinematic)) !== 'false'
  const autoOpen = (settings.journey_map_auto_open ?? String(DEFAULT_JM_SETTINGS.autoOpen)) !== 'false'
  const portalFs = (settings.journey_map_portal_fullscreen ?? String(DEFAULT_JM_SETTINGS.portalFullscreen)) !== 'false'

  const Toggle = ({ k, on, icon, title, blurb }: {
    k: string; on: boolean; icon: React.ReactNode; title: string; blurb: string
  }) => (
    <button
      onClick={() => void onSave(k, on ? 'false' : 'true')}
      disabled={saving === k}
      className="w-full flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
    >
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
        <span className="block text-[11.5px] text-slate-500 leading-snug">{blurb}</span>
      </span>
      <span
        className={`mt-1 relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-brand-500' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-slate-400" /> Journey Map Fly-through
        </h3>
        <p className="mt-1 text-[11.5px] text-slate-500">
          The pace and camera of the ▶ fly-through, on the booking page and in the traveller portal.
          Anyone watching can still change the speed for themselves from the map.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Speed</p>
          <div className="flex flex-wrap gap-1.5">
            {JM_SPEED_STEPS.map(s => (
              <button
                key={s}
                onClick={() => void onSave(JM_SETTING_KEYS.speed, String(s))}
                disabled={saving === JM_SETTING_KEYS.speed}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 ${
                  Math.abs(speed - s) < 1e-6
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {speedLabel(s)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Below 1× is slower. {speedLabel(DEFAULT_JM_SETTINGS.speed)} is the shipped default — one leg
            takes a few seconds, long enough to read where the coach is going before it arrives.
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            How close the camera rides
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ZOOMS.map(z => (
              <button
                key={z.value}
                onClick={() => void onSave(JM_SETTING_KEYS.followZoom, String(z.value))}
                disabled={saving === JM_SETTING_KEYS.followZoom}
                title={z.hint}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-60 ${
                  Math.abs(zoom - z.value) < 0.3
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Toggle
            k={JM_SETTING_KEYS.cinematic}
            on={cinematic}
            icon={<Film className="w-4 h-4" />}
            title="Ride with the vehicle"
            blurb="The camera follows the car, coach or plane and pushes in on each place as it arrives, instead of cutting between stops from altitude."
          />
          <Toggle
            k={JM_SETTING_KEYS.autoOpen}
            on={autoOpen}
            icon={<PanelRightOpen className="w-4 h-4" />}
            title="Open each place as it is reached"
            blurb="The detail card — photos, what to expect, the room booked there — slides in the moment the vehicle arrives."
          />
          <Toggle
            k={JM_SETTING_KEYS.portalFullscreen}
            on={portalFs}
            icon={<Maximize2 className="w-4 h-4" />}
            title="Fullscreen on the traveller portal"
            blurb="Pressing play on a guest's trip page opens the map fullscreen for the length of the run. Escape or the exit button closes it."
          />
        </div>
      </CardBody>
    </Card>
  )
}
