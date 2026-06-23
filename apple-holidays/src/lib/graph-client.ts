/**
 * Microsoft Graph API client for OneDrive / SharePoint access.
 * Uses client-credentials (app-only) flow — no user sign-in required.
 *
 * Required Azure app permissions (application type):
 *   Files.Read.All    — read personal OneDrive files
 *   Sites.Read.All    — read SharePoint site files
 */

const TENANT_ID     = process.env.Azure_TENANT_ID!
const CLIENT_ID     = process.env.Azure_CLIENT_ID!
const CLIENT_SECRET = process.env.Azure_CLIENT_SECRET!
const TOKEN_URL     = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`
const GRAPH_BASE    = 'https://graph.microsoft.com/v1.0'

// ── Token cache (process-lifetime, refreshed on expiry) ───────────────────────

let cachedToken: string | null = null
let tokenExpiresAt = 0

export async function getGraphToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken

  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  })

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph token error ${res.status}: ${text}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken      = data.access_token
  tokenExpiresAt   = Date.now() + data.expires_in * 1000
  return cachedToken!
}

// ── Generic Graph fetch ───────────────────────────────────────────────────────

export async function graphFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getGraphToken()
  const url   = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`
  const res   = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph API ${res.status} at ${url}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Drive helpers ─────────────────────────────────────────────────────────────

export interface DriveItem {
  id:          string
  name:        string
  webUrl:      string
  size?:       number
  createdDateTime?:  string
  lastModifiedDateTime?: string
  parentReference?: { path?: string; id?: string }
  folder?:     { childCount: number }
  file?:       { mimeType: string }
  '@microsoft.graph.downloadUrl'?: string
}

export interface DriveItemCollection {
  value:    DriveItem[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

/** Get the drive ID for a personal OneDrive user. */
export async function getUserDriveId(userUpn: string): Promise<string> {
  const data = await graphFetch<{ id: string }>(`/users/${encodeURIComponent(userUpn)}/drive`)
  return data.id
}

/** Get the drive ID for a SharePoint document library. */
export async function getSharePointDriveId(siteHost: string, sitePath: string, libraryName?: string): Promise<string> {
  const siteId = await getSharePointSiteId(siteHost, sitePath)
  if (!libraryName) {
    const data = await graphFetch<{ id: string }>(`/sites/${siteId}/drive`)
    return data.id
  }
  const drives = await graphFetch<{ value: { id: string; name: string }[] }>(`/sites/${siteId}/drives`)
  const drive = drives.value.find(d => d.name.toLowerCase() === libraryName.toLowerCase())
  if (!drive) throw new Error(`Drive "${libraryName}" not found in site ${siteHost}${sitePath}`)
  return drive.id
}

async function getSharePointSiteId(host: string, path: string): Promise<string> {
  const clean = path.replace(/^\/+/, '')
  const data = await graphFetch<{ id: string }>(`/sites/${host}:/${clean}`)
  return data.id
}

/** List children of a drive folder by item ID — reliable for both personal OneDrive and SharePoint. */
export async function listItemChildren(driveId: string, itemId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = []
  let url: string | undefined = `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,webUrl,folder,file,parentReference,size,createdDateTime,lastModifiedDateTime`
  while (url) {
    const page: DriveItemCollection = await graphFetch<DriveItemCollection>(url)
    items.push(...page.value)
    url = page['@odata.nextLink']
  }
  return items
}

/** List children of a drive folder by path. */
export async function listFolderChildren(driveId: string, folderPath?: string): Promise<DriveItem[]> {
  const base = `/drives/${driveId}`
  const endpoint = folderPath
    ? `${base}/root:/${encodeURIPathSegments(folderPath)}:/children`
    : `${base}/root/children`

  const items: DriveItem[] = []
  let url: string | undefined = `${GRAPH_BASE}${endpoint}?$top=200`

  while (url) {
    const page: DriveItemCollection = await graphFetch<DriveItemCollection>(url)
    items.push(...page.value)
    url = page['@odata.nextLink']
  }
  return items
}

/** Delta sync — returns changed items + new deltaLink URL to resume from. */
export async function getDriveItemsDelta(
  driveId:    string,
  folderPath: string | undefined,
  deltaLink: string | null,
): Promise<{ items: DriveItem[]; deltaToken: string }> {
  const base = `/drives/${driveId}`
  let startUrl: string

  if (deltaLink) {
    // deltaLink may be a full URL (stored from previous sync) or a legacy bare token
    startUrl = deltaLink.startsWith('http')
      ? deltaLink
      : `${GRAPH_BASE}/drives/${driveId}/root/delta?$deltatoken=${encodeURIComponent(deltaLink)}`
  } else if (folderPath) {
    startUrl = `${GRAPH_BASE}${base}/root:/${encodeURIPathSegments(folderPath)}:/delta?$top=200`
  } else {
    startUrl = `${GRAPH_BASE}${base}/root/delta?$top=200`
  }

  const items: DriveItem[] = []
  let url: string | undefined = startUrl
  let newDeltaLink: string | null = null

  while (url) {
    try {
      const page: DriveItemCollection = await graphFetch<DriveItemCollection>(url)
      items.push(...page.value)
      if (page['@odata.deltaLink']) {
        // Store the full deltaLink URL — avoids fragile token extraction
        newDeltaLink = page['@odata.deltaLink']
        url = undefined
      } else {
        url = page['@odata.nextLink']
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // 410 Gone means delta link is expired — reset to full scan
      if (msg.includes('410') || msg.includes('syncStateNotFound')) {
        return getDriveItemsDelta(driveId, folderPath, null)
      }
      throw err
    }
  }

  return { items, deltaToken: newDeltaLink ?? '' }
}

/** Download a file as Buffer. */
export async function downloadDriveItem(driveId: string, itemId: string): Promise<Buffer> {
  const token  = await getGraphToken()
  const url    = `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`
  const res    = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`)
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

/** Get a short-lived download URL for a drive item. */
export async function getDriveItemWebUrl(driveId: string, itemId: string): Promise<string> {
  const data = await graphFetch<{ '@microsoft.graph.downloadUrl'?: string; webUrl?: string }>(
    `/drives/${driveId}/items/${itemId}`,
  )
  return data['@microsoft.graph.downloadUrl'] ?? data.webUrl ?? ''
}

/** Search for items inside a drive matching a query string. */
export async function searchDriveItems(driveId: string, query: string): Promise<DriveItem[]> {
  const encoded = encodeURIComponent(query)
  const items: DriveItem[] = []
  let url: string | undefined =
    `${GRAPH_BASE}/drives/${driveId}/root/search(q='${encoded}')?$top=50&$select=id,name,webUrl,folder,file,parentReference,size,createdDateTime,lastModifiedDateTime`

  while (url) {
    const page: DriveItemCollection = await graphFetch<DriveItemCollection>(url)
    items.push(...page.value)
    url = page['@odata.nextLink']
  }
  return items
}

/** List immediate children of a folder at the given path, or root if undefined. */
export async function listChildren(driveId: string, folderPath?: string): Promise<DriveItem[]> {
  return listFolderChildren(driveId, folderPath)
}

function encodeURIPathSegments(path: string): string {
  return path.split('/').map(s => encodeURIComponent(s)).join('/')
}
