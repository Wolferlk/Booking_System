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

/**
 * Statuses that mean "we did not do this — come back later", and nothing else.
 *
 *   429 — throttled. Graph always sends `Retry-After` with it.
 *   503 — the service behind the request is overloaded. Against a workbook this
 *         arrives as `FileOpenHostServiceUnavailable`, which is SharePoint's
 *         file-open host declining to open a busy file. It is transient: the
 *         same call succeeds seconds later.
 *   509 — bandwidth ceiling, same contract.
 *
 * Deliberately NOT 500, 502 or 504. Those can be returned *after* the work was
 * done, and this client is used to append and delete rows in a live workbook —
 * a retried delete takes a second row out, and nothing puts it back.
 */
const RETRYABLE = new Set([429, 503, 509])

/** How long Graph asked us to wait, in ms. `Retry-After` is seconds or a date. */
function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after')

  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS)
    const at = Date.parse(header)
    if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_BACKOFF_MS)
  }

  // No header: exponential, with jitter so a burst of parallel calls that were
  // all throttled together does not come back all together.
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)
  return base / 2 + Math.random() * (base / 2)
}

const MAX_BACKOFF_MS = 20_000
const MAX_ATTEMPTS   = 4

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A request that must never be replayed, however Graph answers it.
 *
 * `POST …/range/delete` shifts every row below the target up by one. Sent twice
 * it removes two rows, and the second one is a line of the team's that nothing
 * in this system knows was ever there. One 429 is not worth that risk, so these
 * fail on the first refusal and let the caller decide.
 */
const isDestructive = (url: string) => /\/(delete|clear)(\?|$)/i.test(url)

/**
 * Call Graph, retrying only the answers that explicitly mean "not done, try
 * again".
 *
 * Before this, a single transient 503 from SharePoint was a hard failure
 * everywhere it happened: rows marked FAILED and left for a human to retry, a
 * sweep downgraded to PARTIAL, and "Prepare workbook" answering 502 because the
 * very first call it makes — listing the worksheets — happened to land while the
 * file-open host was busy.
 */
export async function graphFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Fetched inside the loop: a retry after a long backoff may be reaching for
    // a token that has since expired.
    const token = await getGraphToken()

    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(opts.headers ?? {}),
      },
    })

    if (res.ok) return res.json() as Promise<T>

    const text = await res.text()
    lastError  = new Error(`Graph API ${res.status} at ${url}: ${text}`)

    const mayRetry = RETRYABLE.has(res.status)
      && !isDestructive(url)
      && attempt < MAX_ATTEMPTS - 1
    if (!mayRetry) throw lastError

    const wait = retryAfterMs(res, attempt)
    console.warn(
      `[Graph] ${res.status} on ${url.replace(GRAPH_BASE, '')} — retrying in ${Math.round(wait)}ms `
      + `(attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
    )
    await sleep(wait)
  }

  throw lastError ?? new Error(`Graph API request failed at ${url}`)
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
