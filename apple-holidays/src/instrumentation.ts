// ── Master switch ─────────────────────────────────────────────────────────────
const BACKGROUND_AUTOMATION_ENABLED = true

export async function register() {
  if (!BACKGROUND_AUTOMATION_ENABLED) {
    console.log('[Instrumentation] Background automation is OFF — set BACKGROUND_AUTOMATION_ENABLED = true to re-enable')
    return
  }
  // Only run on the Node.js server side (not Edge or client)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { autoSubscribe } = await import('@/lib/mail-processor')
    await autoSubscribe()

    // Vercel cron jobs (vercel.json) only fire on Vercel infrastructure.
    // On self-hosted servers, start the background scheduler inside the process.
    if (!process.env.VERCEL) {
      const { startCronJobs } = await import('@/lib/cron-scheduler')
      startCronJobs()
    }
  }
}
