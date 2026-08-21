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

      // NEW independent TQ auto-processor — checks confirm.booking@aahaas.com every
      // 5 min and processes only new mail (shares dedup keys, so no double token spend).
      const { startTqAutoScheduler } = await import('@/lib/tq-auto-scheduler')
      startTqAutoScheduler()

      // Auto-report schedules are configured at runtime, so this ticks every
      // minute and evaluates due times itself rather than baking in a cron expr.
      const { startReportScheduler } = await import('@/lib/reports/report-scheduler')
      startReportScheduler()

      // Booking Team Query Monitor — hourly sweep of the file-handler mailboxes
      // into the SharePoint query sheet. Interval is a runtime setting, so this
      // also ticks every minute and evaluates due-ness itself. Gated by the
      // query_monitor_enabled switch inside the tick.
      const { startQueryMonitorScheduler } = await import('@/lib/query-monitor/scheduler')
      startQueryMonitorScheduler()

      // Pre-Arrival Sync — refreshes bookings from AppleSystem N days before
      // arrival (default T−3). Gated by the as_presync_enabled switch inside the
      // job, and ships OFF, so booting this only arms the timer.
      const { startPreArrivalSyncScheduler } = await import('@/lib/as-prearrival-scheduler')
      void startPreArrivalSyncScheduler()
    }
  }
}
