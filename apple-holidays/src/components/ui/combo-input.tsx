'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

/**
 * Textarea that grows with its content instead of scrolling — activity names
 * for multi-attraction packages run to several lines.
 */
export function AutoGrowTextarea({
  value, onChange, className = '', minRows = 1, ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // Re-measure on external value changes (AI fill, itinerary import, load).
  useEffect(resize, [value, resize])

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={e => { onChange?.(e); resize() }}
      className={`resize-none overflow-hidden ${className}`}
      {...rest}
    />
  )
}

/** A suggestion whose dropdown label reads differently from the saved value. */
export interface ComboOption { value: string; label: string }

interface ComboInputProps {
  value: string
  onChange: (value: string) => void
  /** Suggestions. May be empty — the box then behaves as a plain text field. */
  options: (string | ComboOption)[]
  /** Render as an auto-growing textarea rather than a single-line input. */
  multiline?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Cap on the rows rendered at once; the list scrolls beyond it. */
  limit?: number
}

/**
 * Free-text combo box: a dropdown of known values that never blocks typing.
 *
 * The list is a shortcut only — whatever is in the box is the value, so a tour
 * or pickup point that is not on the list ("Tour A") is typed straight in and
 * saved as typed. Picking a suggestion just fills the same box. The list itself
 * is untouched by what gets typed, so one file's one-off entry never pollutes
 * what the next user sees.
 */
export function ComboInput({
  value, onChange, options, multiline = false,
  placeholder, className = '', disabled = false, limit = 50,
}: ComboInputProps) {
  const [open,      setOpen]      = useState(false)
  /** Set by the chevron: show everything rather than filtering on the value. */
  const [showAll,   setShowAll]   = useState(false)
  const [highlight, setHighlight] = useState(-1)
  /** Viewport rect of the field — the list is portalled, see `menu` below. */
  const [rect,      setRect]      = useState<DOMRect | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const query = value.trim().toLowerCase()
  const all: ComboOption[] = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  // Both halves are searched, so "breakfast" finds the "B" meal plan.
  const matches = (showAll || !query
    ? all
    : all.filter(o => `${o.value} ${o.label}`.toLowerCase().includes(query))
  ).slice(0, limit)

  // An exact single match means the user already has that value — no point
  // covering the field with a dropdown that offers what is already typed.
  const visible = open && matches.length > 0
    && !(matches.length === 1 && matches[0].value.toLowerCase() === query)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (boxRef.current?.contains(target)) return
      if ((target as HTMLElement)?.closest?.('[data-combo-menu]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // The movement card clips its overflow, so the list is portalled to the body
  // and positioned from the field's viewport rect — it has to follow scrolling.
  useEffect(() => {
    if (!open) { setRect(null); return }
    const track = () => setRect(boxRef.current?.getBoundingClientRect() ?? null)
    track()
    window.addEventListener('scroll', track, true)
    window.addEventListener('resize', track)
    return () => {
      window.removeEventListener('scroll', track, true)
      window.removeEventListener('resize', track)
    }
  }, [open, value])

  function pick(option: string) {
    onChange(option)
    setOpen(false)
    setShowAll(false)
    setHighlight(-1)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!visible) { setOpen(true); setShowAll(false); setHighlight(0); return }
      setHighlight(h => (h + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      if (!visible) return
      e.preventDefault()
      setHighlight(h => (h <= 0 ? matches.length : h) - 1)
    } else if (e.key === 'Enter') {
      // Enter only commits a highlighted suggestion; otherwise it is left alone
      // so a multi-line activity name can still take a line break.
      if (visible && highlight >= 0) { e.preventDefault(); pick(matches[highlight].value) }
    } else if (e.key === 'Escape') {
      if (visible) { e.preventDefault(); setOpen(false) }
    }
  }

  function onType(next: string) {
    onChange(next)
    setShowAll(false)
    setHighlight(-1)
    if (options.length) setOpen(true)
  }

  const fieldClass = `${className} ${options.length ? 'pr-8' : ''}`
  const shared = {
    value,
    placeholder,
    disabled,
    onKeyDown,
    onFocus: () => { if (options.length) { setOpen(true); setShowAll(false) } },
    className: fieldClass,
  }

  const menu = visible && rect && typeof document !== 'undefined'
    ? createPortal(
        <ul
          data-combo-menu
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            maxHeight: Math.min(224, Math.max(120, window.innerHeight - rect.bottom - 16)),
          }}
          className="z-[100] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.map((option, idx) => (
            <li key={option.value}>
              <button
                type="button"
                // mousedown, not click — the field must not lose focus first.
                onMouseDown={e => { e.preventDefault(); pick(option.value) }}
                onMouseEnter={() => setHighlight(idx)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  idx === highlight ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null

  return (
    <div className="relative" ref={boxRef}>
      {multiline ? (
        <AutoGrowTextarea {...shared} onChange={e => onType(e.target.value)} />
      ) : (
        <input {...shared} onChange={e => onType(e.target.value)} autoComplete="off" />
      )}

      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Show suggestions"
          onClick={() => {
            setShowAll(true)
            setHighlight(-1)
            setOpen(o => !(o && showAll))
          }}
          className="absolute right-1.5 top-1.5 p-1 text-slate-400 hover:text-slate-600 disabled:opacity-40"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {menu}
    </div>
  )
}
