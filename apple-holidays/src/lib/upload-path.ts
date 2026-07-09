export function normalizeUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/api/uploads/')) return url
  if (url.startsWith('/uploads/')) return `/api${url}`
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      if (parsed.pathname.startsWith('/api/uploads/')) return parsed.pathname
      if (parsed.pathname.startsWith('/uploads/')) return `/api${parsed.pathname}`
      return url
    } catch {
      return url
    }
  }
  return url
}

export function localUploadRelativePath(url: string | null | undefined): string | null {
  const normalized = normalizeUploadUrl(url)
  if (!normalized) return null
  if (normalized.startsWith('/api/uploads/')) return normalized.replace(/^\/api\//, '')
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized)
      return parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
    } catch {
      return null
    }
  }
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}
