/**
 * Reads a fetch Response as our standard { success, data, error } envelope,
 * without ever throwing on non-JSON bodies.
 *
 * The OPS_AI routes always return JSON, but the things *between* the browser and
 * those routes do not: an un-deployed route serves a 404 HTML page, a Lambda cold
 * start or timeout serves a gateway HTML page, an auth redirect serves the login
 * HTML. Calling res.json() on any of those throws "Unexpected token '<'". This
 * turns all of that into a readable error the UI can show.
 */
export async function readApi<T = unknown>(
  res: Response,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const text = await res.text().catch(() => '')

  try {
    return JSON.parse(text) as { success: boolean; data?: T; error?: string }
  } catch {
    // Not JSON — almost always an HTML error page from the host, not the route.
    if (res.status === 404) return { success: false, error: 'Voice endpoint not found — the server may need to be redeployed.' }
    if (res.status === 401 || res.status === 403) return { success: false, error: 'Your session has expired — please sign in again.' }
    if (res.status >= 500) return { success: false, error: `Server error (${res.status}). Please try again.` }
    return { success: false, error: 'Unexpected response from the server.' }
  }
}
