'use client'

/**
 * The export column picker.
 *
 * "Customise the export" only means something if the order is the user's too,
 * so this is two panes rather than a checkbox grid: the catalogue on the left,
 * the chosen columns on the right in the order they will appear in the file.
 * Both the Excel writer and the printed report read that order, so what is
 * arranged here is literally what comes out.
 */

import { useMemo, useState } from 'react'
import {
  Check, ChevronUp, ChevronDown, X, Search, GripVertical, RotateCcw, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Modal from '@/components/ui/modal'
import {
  COLUMNS, COLUMN_GROUPS, COLUMN_PRESETS, DEFAULT_COLUMNS,
  type ColumnKey, type ColumnGroup,
} from '@/lib/activity-check-columns'

export default function ColumnPicker({
  open,
  onClose,
  selected,
  onChange,
}: {
  open: boolean
  onClose: () => void
  selected: ColumnKey[]
  onChange: (keys: ColumnKey[]) => void
}) {
  const [filter, setFilter] = useState('')

  const chosen = useMemo(() => new Set(selected), [selected])

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return COLUMN_GROUPS.map(group => ({
      group,
      columns: COLUMNS.filter(c => c.group === group && (!needle || c.label.toLowerCase().includes(needle))),
    })).filter(g => g.columns.length > 0)
  }, [filter])

  const toggle = (key: ColumnKey) => {
    // Adding appends rather than inserting at the catalogue's position: the
    // right-hand list is the file's order, and a new column belongs at the end
    // until the user moves it.
    onChange(chosen.has(key) ? selected.filter(k => k !== key) : [...selected, key])
  }

  const move = (index: number, delta: number) => {
    const next = [...selected]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customise the export"
      size="4xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <button
            onClick={() => onChange(DEFAULT_COLUMNS)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to standard
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {selected.length} column{selected.length === 1 ? '' : 's'} selected
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600"
            >
              Done
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Presets — a starting point per desk, faster than forty checkboxes. */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Start from a preset</p>
          <div className="flex flex-wrap gap-2">
            {COLUMN_PRESETS.map(p => {
              const active = p.columns.length === selected.length
                && p.columns.every((k, i) => selected[i] === k)
              return (
                <button
                  key={p.id}
                  onClick={() => onChange([...p.columns])}
                  title={p.hint}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                    active
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700',
                  )}
                >
                  {active && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: the catalogue */}
          <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[52vh]">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Find a column…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              />
              {filter && (
                <button onClick={() => setFilter('')} className="text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="overflow-y-auto p-2 space-y-3">
              {groups.map(({ group, columns }) => (
                <div key={group}>
                  <GroupHeader
                    group={group}
                    columns={columns.map(c => c.key)}
                    selected={chosen}
                    onChange={onChange}
                    current={selected}
                  />
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {columns.map(c => {
                      const on = chosen.has(c.key)
                      return (
                        <button
                          key={c.key}
                          onClick={() => toggle(c.key)}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors',
                            on ? 'bg-brand-50 text-brand-800' : 'hover:bg-slate-50 text-slate-600',
                          )}
                        >
                          <span className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                            on ? 'bg-brand-500 border-brand-500' : 'border-slate-300 bg-white',
                          )}>
                            {on && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="truncate">{c.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {groups.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">No column matches “{filter}”.</p>
              )}
            </div>
          </div>

          {/* Right: the file's own order */}
          <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[52vh]">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-brand-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Column order in the file
              </span>
            </div>
            <div className="overflow-y-auto p-2 space-y-1">
              {selected.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">
                  Nothing selected — the export will fall back to the standard columns.
                </p>
              )}
              {selected.map((key, i) => {
                const def = COLUMNS.find(c => c.key === key)
                if (!def) return null
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100 group"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                    <span className="w-5 text-[10px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
                    <span className="flex-1 text-xs text-slate-700 truncate">{def.label}</span>
                    <span className="text-[9px] uppercase tracking-wide text-slate-400 hidden sm:inline">
                      {def.group}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="p-1 rounded hover:bg-white text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === selected.length - 1}
                        className="p-1 rounded hover:bg-white text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => toggle(key)}
                        className="p-1 rounded hover:bg-white text-slate-400 hover:text-red-600"
                        aria-label="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** A group heading that doubles as an all / none toggle for that group. */
function GroupHeader({
  group, columns, selected, current, onChange,
}: {
  group: ColumnGroup
  columns: ColumnKey[]
  selected: Set<ColumnKey>
  current: ColumnKey[]
  onChange: (keys: ColumnKey[]) => void
}) {
  const allOn = columns.every(k => selected.has(k))
  return (
    <div className="flex items-center justify-between px-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</span>
      <button
        onClick={() => {
          if (allOn) onChange(current.filter(k => !columns.includes(k)))
          else onChange([...current, ...columns.filter(k => !selected.has(k))])
        }}
        className="text-[10px] font-semibold text-slate-400 hover:text-brand-600"
      >
        {allOn ? 'none' : 'all'}
      </button>
    </div>
  )
}
