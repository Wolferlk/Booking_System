/**
 * Permanent, code-level kill switches for the background automation.
 *
 * These live in their own dependency-free module so any caller (including the
 * boot scheduler) can check them without pulling in the heavy monitor / mail
 * modules. Flipping one to `false` and redeploying is the ONLY way to re-enable
 * the corresponding automation — the DB toggles and the admin UI switches are
 * powerless while a switch is `true`.
 */

/**
 * Automatic mail reading (Graph 5-min scheduler tick, Vercel HTTP cron route,
 * IMAP IDLE watcher, Graph mail webhook). While `true`, incoming mail is still
 * fetched and cached so it stays visible in Mail Inbox — it just never gets
 * auto-extracted into a booking. Manual `POST /api/mail/process` still works.
 * DB toggle overridden: `auto_mail_enabled`.
 */
export const AUTO_MAIL_HARD_DISABLED: boolean = true

/**
 * The automatic OneDrive/SharePoint poll (3-min scheduler tick, Vercel HTTP
 * cron route, on-login trigger). Manual, explicitly targeted scans from the
 * admin OneDrive page (scan a drive / a date / a booking ref) still work.
 * DB toggle overridden: `auto_onedrive_enabled`.
 */
export const ONEDRIVE_AUTO_POLL_HARD_DISABLED: boolean = true
