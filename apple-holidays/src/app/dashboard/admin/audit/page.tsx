'use client'

import { useEffect, useState } from 'react'
import {
  Activity, Search, Filter, User, Calendar,
  FileText, CreditCard, Ticket, Car, Loader2,
  ChevronLeft, ChevronRight, Shield, RefreshCw,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { format } from 'date-fns'

interface LogEntry {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  details: string | null
  createdAt: string
  user: { id: string; name: string; email: string; role: string }
}

const ACTION_COLORS: Record<string, string> = {
  BOOKING_CREATED: 'bg-blue-50 text-blue-700 border-blue-100',
  BOOKING_UPDATED: 'bg-amber-50 text-amber-700 border-amber-100',
  BOOKING_DELETED: 'bg-red-50 text-red-700 border-red-100',
  STATUS_CHANGED: 'bg-purple-50 text-purple-700 border-purple-100',
  PAYMENT_CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  PAYMENT_REJECTED: 'bg-red-50 text-red-700 border-red-100',
  PAYMENT_CREATED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  TICKET_PURCHASED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  TICKET_FILE_UPLOADED: 'bg-teal-50 text-teal-700 border-teal-100',
  PNL_LINE_CONFIRMED: 'bg-green-50 text-green-700 border-green-100',
  DRIVER_UPDATED: 'bg-orange-50 text-orange-700 border-orange-100',
  DRIVER_PAYMENT_ADDED: 'bg-yellow-50 text-yellow-700 border-yellow-100',
}

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Booking: FileText, Payment: CreditCard, Ticket, Driver: Car, User,
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'text-red-600', BT_USER: 'text-blue-600', GT_USER: 'text-emerald-600',
  TE_USER: 'text-purple-600', AC_USER: 'text-amber-600', CLIENT: 'text-cyan-600',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const limit = 50

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), page: String(page) })
      if (filterAction) params.set('action', filterAction)
      const res = await fetch(`/api/admin/activity?${params}`)
      const data = await res.json()
      if (data.success) { setLogs(data.data.logs); setTotal(data.data.total) }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [page, filterAction])

  const filtered = search
    ? logs.filter(l =>
        l.user.name.toLowerCase().includes(search.toLowerCase()) ||
        l.action.toLowerCase().includes(search.toLowerCase()) ||
        (l.entityId ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : logs

  const totalPages = Math.ceil(total / limit)

  function parseDetails(raw: string | null) {
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  return (
    <div>
      <Header title="Audit Log" subtitle="Complete activity history — every user action tracked in real-time" />
      <div className="p-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Events', value: total, icon: Activity, color: 'text-blue-500' },
            { label: 'Showing', value: filtered.length, icon: Filter, color: 'text-emerald-500' },
            { label: 'Pages', value: totalPages, icon: Calendar, color: 'text-purple-500' },
            { label: 'Per Page', value: limit, icon: Shield, color: 'text-amber-500' },
          ].map(s => (
            <Card key={s.label} className="p-4">
              <div className="flex items-center gap-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="text-xl font-bold text-slate-900">{s.value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search user, action, entity…" className="form-input pl-9" />
              </div>
              <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1) }}
                className="form-select min-w-[200px]">
                <option value="">All Actions</option>
                {Object.keys(ACTION_COLORS).map(a => (
                  <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button onClick={load} className="btn-secondary btn">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
          </CardBody>
        </Card>

        {/* Table */}
        <Card>
          <CardBody className="p-0">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <Activity className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-400">No activity logs found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(log => {
                      const details = parseDetails(log.details)
                      const EIcon = log.entityType ? ENTITY_ICONS[log.entityType] : null
                      return (
                        <tr key={log.id}>
                          <td className="whitespace-nowrap text-xs">
                            <p className="font-medium text-slate-800">{format(new Date(log.createdAt), 'dd MMM yyyy')}</p>
                            <p className="text-slate-400">{format(new Date(log.createdAt), 'HH:mm:ss')}</p>
                          </td>
                          <td>
                            <p className="text-sm font-semibold text-slate-900">{log.user.name}</p>
                            <p className={`text-xs font-medium ${ROLE_COLORS[log.user.role] ?? 'text-slate-400'}`}>
                              {log.user.role.replace(/_/g, ' ')}
                            </p>
                          </td>
                          <td>
                            <span className={`badge border text-[11px] ${ACTION_COLORS[log.action] ?? 'bg-slate-100 text-slate-600 border-slate-100'}`}>
                              {log.action.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td>
                            {log.entityType && (
                              <div className="flex items-center gap-1.5">
                                {EIcon && <EIcon className="w-3.5 h-3.5 text-slate-400" />}
                                <div>
                                  <p className="text-xs font-medium text-slate-700">{log.entityType}</p>
                                  {log.entityId && <p className="text-xs text-slate-400 font-mono">{log.entityId}</p>}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="max-w-[280px]">
                            {details && (
                              <div className="text-xs text-slate-500 space-x-2">
                                {Object.entries(details).filter(([, v]) => v != null).slice(0, 4).map(([k, v]) => (
                                  <span key={k}><span className="text-slate-400">{k}:</span> {String(v)}</span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <p className="text-sm text-slate-500">Page {page} of {totalPages} · {total} total</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="btn-secondary btn btn-sm"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="btn-secondary btn btn-sm"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
