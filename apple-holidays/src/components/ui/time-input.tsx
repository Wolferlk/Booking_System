'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { join12h, parse12h, split12h, to12h } from '@/lib/clock-time'

interface TimeInputProps {
  /** Stored value, 24-hour `"HH:MM"`. Empty string means "not set". */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  /** Quick-pick chips shown under the field, as stored 24-hour strings. */
  presets?: string[]
}

/**
 * Meeting-time field on explicit 12-hour notation.
 *
 * `<input type="time">` was doing the job before, but it renders on the
 * browser's locale: the Vietnam desk saw "15:45" and a colleague on a
 * US-locale laptop saw "3:45 PM" for the same pickup, and neither could tell
 * which the guest would read. This spells the meridiem out as its own control,
 * so what is on screen is what is meant.
 *
 * Typing stays fast and forgiving — "3:45 pm", "1545", "9am" and "15.45" all
 * land on the same stored value, and the AM/PM buttons flip an already-typed
 * time rather than clearing it. The value handed back is always the same
 * `"HH:MM"` string the column has always held.
 */
export function TimeInput({
  value, onChange, disabled = false, className = '', placeholder = 'e.g. 3:45 PM', presets,
}: TimeInputProps) {
  const parts = split12h(value)
  /** What the user sees while typing; committed to `value` on blur/Enter. */
  const [text, setText] = useState(() => to12h(value))
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Follow external changes (AI fill, itinerary import, reload) — but never
  // while the field has focus, or the caret jumps mid-keystroke.
  useEffect(() => {
    if (!focused) setText(to12h(value))
  }, [value, focused])

  function commit(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) { onChange(''); setText(''); return }
    const parsed = parse12h(trimmed)
    if (parsed === null) {
      // Not a time — put the last good value back rather than saving noise.
      setText(to12h(value))
      return
    }
    onChange(parsed)
    setText(to12h(parsed))
  }

  function setMeridiem(meridiem: 'AM' | 'PM') {
    if (disabled) return
    // Flip an existing time; with the field empty, seed a sensible hour so one
    // click already gives a valid value instead of doing nothing.
    const current = parse12h(text) ?? value
    const base = current ? split12h(current) : { hour: '9', minute: '00', meridiem }
    const next = join12h({ ...base, meridiem })
    if (!next) return
    onChange(next)
    setText(to12h(next))
  }

  const active = parse12h(text) ?? value
  const meridiem = active ? split12h(active).meridiem : parts.meridiem

  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-1">
        <div className="relative flex-1 min-w-0">
          <Clock className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={text}
            placeholder={placeholder}
            aria-label="Meeting time"
            className={`${className} pl-7`}
            onFocus={() => setFocused(true)}
            onChange={e => setText(e.target.value)}
            onBlur={e => { setFocused(false); commit(e.target.value) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(text); inputRef.current?.blur() }
              if (e.key === 'Escape') { setText(to12h(value)); inputRef.current?.blur() }
            }}
          />
        </div>
        <div className="flex flex-col rounded-lg border border-slate-200 overflow-hidden flex-shrink-0">
          {(['AM', 'PM'] as const).map(m => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => setMeridiem(m)}
              aria-pressed={!!active && meridiem === m}
              className={`px-1.5 flex-1 text-[10px] font-semibold leading-none transition-colors disabled:opacity-40 ${
                active && meridiem === m
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {presets && presets.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-1">
          {presets.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => { onChange(p); setText(to12h(p)) }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                value === p
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {to12h(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
