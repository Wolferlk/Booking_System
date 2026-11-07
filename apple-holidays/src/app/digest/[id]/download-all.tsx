'use client'

/** "Download all" on a ticket pack: fetches each file and zips them in the browser. */
import { useState } from 'react'
import { buildZip, uniqueNames } from '@/lib/agent-digest/mini-zip'

export interface PackDownload { url: string; name: string }
export interface PackGroup { label: string; files: PackDownload[] }

function fileNameOf(res: Response, fallback: string): string {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('content-disposition') ?? '')
  return m ? decodeURIComponent(m[1]) : fallback
}

function save(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

export default function DownloadAll({ zipName, groups }: { zipName: string; groups: PackGroup[] }) {
  const [state, setState] = useState<{ busy: boolean; done: number; total: number; note: string | null }>({ busy: false, done: 0, total: 0, note: null })

  const run = async (files: PackDownload[], name: string) => {
    setState({ busy: true, done: 0, total: files.length, note: null })
    const got: { name: string; data: Uint8Array }[] = []
    let missed = 0
    for (const f of files) {
      try {
        const res = await fetch(f.url)
        if (!res.ok) throw new Error(String(res.status))
        got.push({ name: fileNameOf(res, f.name), data: new Uint8Array(await res.arrayBuffer()) })
      } catch { missed++ }
      setState(s => ({ ...s, done: s.done + 1 }))
    }
    if (got.length) {
      const names = uniqueNames(got.map(g => g.name))
      save(buildZip(got.map((g, i) => ({ name: names[i], data: g.data }))), name)
    }
    setState({
      busy: false, done: 0, total: 0,
      note: missed ? `${missed} of ${files.length} file${files.length === 1 ? '' : 's'} could not be downloaded. Please try again or reply to the message.` : null,
    })
  }

  const all = groups.flatMap(g => g.files)
  if (!all.length) return null
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 8px 0' }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16, color: '#0f172a' }}>
        <button style={{ ...btn, background: '#0f766e', color: '#fff', opacity: state.busy ? 0.7 : 1 }} disabled={state.busy} onClick={() => run(all, `${zipName}.zip`)}>
          {state.busy ? `Downloading ${state.done} of ${state.total}…` : `Download all tickets (${all.length} file${all.length === 1 ? '' : 's'})`}
        </button>
        {groups.length > 1 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {groups.filter(g => g.files.length).map(g => (
              <button key={g.label} style={{ ...btn, background: '#ccfbf1', color: '#115e59', padding: '6px 10px', fontSize: 12 }} disabled={state.busy}
                onClick={() => run(g.files, `${g.label}-tickets.zip`)}>
                {g.label} ({g.files.length})
              </button>
            ))}
          </div>
        )}
        {state.note && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#b91c1c' }}>{state.note}</p>}
      </div>
    </div>
  )
}
