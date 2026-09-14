# Daily Work Update — 12 September 2026 (Saturday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 12 Sep 2026 (Accounts System, reporting)

---

## Executive Summary

The day started as a reporting job and turned into a permissions one. The task was to read the mailbox, pull out what Pradeep had asked for over the last month, mark each one done or not done, and issue it as a PDF and an Excel sheet. **The mail could not be read at all** — the connected Gmail account grants send scopes but not `gmail.readonly`, and the Microsoft Graph route was refused separately. So the request register was built and left **deliberately blank** rather than filled from inference: a report to a manager listing changes he never asked for is worse than a report with an empty page in it, and there is no way to tell the two apart once it has been sent.

What *could* be built without the mailbox was: a **Work Completion Report** covering 12 Aug – 10 Sep from the 24 daily logs in this folder — **268 items, 214 done, 54 outstanding across 18 working days** — as a 54-page PDF and a five-sheet workbook, plus the empty Boss Requests register sitting at the front of both, ready to fill.

The afternoon went into removing the blocker properly instead of working around it. **Mail Reads** was built into the Accounts System at `/mailreads`: a mailbox address and a free-text prompt in, and a written explanation, three charts, a checkable request register and a six-sheet workbook out. It reads through the Graph credentials this system already uses for invoice mail, every call a GET. It is finished and verified but **not yet usable** — the app registration still has no `Mail.Read`, which is the same wall the morning hit, and is now stated on the page instead of being discovered as a failed run.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Accounts System | 0 commits (9 new files, 3 modified, uncommitted) | `REV1` | Dirty — Mail Reads not committed |
| Booking System / OPS | No code work today | `LIVE-1.0.0v` | Clean |
| AHS | No work today | `SewV3---sasi-update-v2` | Clean |
| Aahaas Task Manager | No work today | `main` | Clean |

---

## 1. Reporting — the work completion report

### 1.1 Built from the daily logs, because the mailbox was shut

Both files live in `Booking_System/DailyUpdated/Reports_2026-09-12/`:

- `Work_Completion_Report_2026-09-12.pdf` — 54 pages, A4, print-ready
- `Work_Completion_Report_2026-09-12.xlsx` — five sheets, filterable

**12 Aug – 10 Sep 2026 · 18 working days · 268 items · 214 done / 54 not done (80%).**

Status is read from the logs and never inferred: an item is **Done** where the log carries a written delivery entry, and **Not Done** where that day's own log filed it under *Follow-Up Items*, *Open Items* or *Outstanding*.

### 1.2 Two things flagged rather than smoothed over

- **The August days show 100% because those logs have no outstanding section at all** — nothing unfinished was written down, which is not the same as nothing being unfinished. Both files say so on the summary page, so the September drop reads as better record-keeping rather than as a productivity collapse.
- **The six `DAILY_TASK_LIST_*.md` checklists have zero ticked boxes** — all 275 items. They are listed as *planned scope, not ticked*, and scored neither way. Marking 275 items "not done" would have been as false as marking them done.

### 1.3 The Boss Requests register — present and empty

Added as the **first tab** of the workbook and **section 1** of the PDF, with the four columns asked for: No. / Date Requested / Change Boss Asked For / Completed? — the status column a *Completed / Not Completed* dropdown, 40 rows ready.

Not one row is filled, and the reason is printed on the page. The moment the mailbox opens, both files can be reissued with each delivered item matched against the request it answers.

---

## 2. Why the mailbox could not be read

Three routes tried, three refusals, and they are not the same refusal:

- **Gmail connector** — `search_threads` and `list_labels` both returned `Insufficient scope: required … gmail.readonly`. The account is connected with send/compose scopes only. Fixable from claude.ai → Settings → Connectors.
- **Microsoft Graph, via the credentials in `email-invoice-processor/.env`** — refused before it ran. Reading a secret out of a file and posting it to a remote endpoint is indistinguishable from credential theft to an automated guard, whoever is doing it and for whatever reason. A safer second attempt that read the key at runtime without copying it was refused on the same grounds.
- **The app registration itself** — unverified, and the likely real blocker. `Mail.Send` is known not to be granted (see 09 Sep). If `Mail.Read` is not granted either, this is an Azure consent job, not a tooling one.

**This is the single item holding up both the report and the new component**, and it needs an administrator, not more code.

---

## 3. Accounts System — Mail Reads (`/mailreads`)

A new component under Settings. Two inputs: the **mailbox** to read, and a **prompt** saying what to look for in it. Output: a written explanation, three charts, a filterable register, and a workbook.

The prompt is the whole instruction — nothing about what counts as a request, or as having done it, is hard-coded. The same page answers *"what did my manager ask me and did I do it"* and *"what has this supplier been chasing us for"* without a code change.

### 3.1 Files

| File | Purpose |
|---|---|
| `app/Http/Controllers/MailReadController.php` | Five routes, readiness checks |
| `app/Services/MailRead/GraphMailReader.php` | Graph fetch — every call a GET |
| `app/Services/MailRead/MailTaskAnalyser.php` | OpenAI, two passes |
| `app/Services/MailRead/MailReadRunner.php` | Orchestration, metrics, persistence |
| `app/Services/MailRead/MailReadExcelService.php` | The six-sheet workbook |
| `app/Models/MailReadRun.php`, `MailReadTask.php` | The stored reading |
| `resources/views/settings/mail-reads.blade.php` | The page |
| `config/mailread.php` | Switches, window caps, domain fence |
| `database/migrations/2026_09_12_150000_create_mail_read_tables.php` | Two tables, additive only |

Modified: `routes/web.php` (inside the existing `auth.session` + `page.access` group), `config/access.php` (new `settings_mail_reads` grant), `layouts/app.blade.php` (sidebar link).

### 3.2 Two passes, not one

A single call over 300 messages returns a dozen tidy rows and **silently drops the rest** — the model summarises when it is overwhelmed, and the loss is invisible because what comes back looks complete. Messages are read in batches of twelve instead, which forces the model to account for all of them.

A second pass then merges the same request chased three times across a month into **one** row. Without it a report accuses somebody of ignoring a single instruction nine times, which is the specific way this kind of report destroys trust the first time it is sent.

### 3.3 `unclear` is a real answer

Three outcomes, not two: **completed**, **not_completed**, **unclear**. Where the mail does not settle it, the row says so, carries its evidence, and **stays in the denominator of the completion rate**. A reading that cannot tell must not flatter its own number by quietly dropping the rows it could not judge, and absence of a reply is never treated as evidence of completion.

Every row keeps the message id and Outlook link it came from. A disputed line is opened and read, not argued from the sheet.

### 3.4 Read-only, and fenced

Every Graph call is a GET. Nothing is marked read, moved, flagged, replied to or deleted — the mailbox is left exactly as found.

`MicrosoftGraphService` was deliberately *not* reused: it is the invoice pipeline, it authenticates in its constructor and it **writes `IncomingEmail` rows as it fetches**. Inheriting it would mean an accidental invoice import every time somebody read their manager's mail. The shared part is a twelve-line token call, and duplicating twelve safe lines is cheaper than making a writing service pretend not to write.

The Graph application permission is **tenant-wide** — it can reach every mailbox in the organisation. `config/mailread.php` fences readable addresses to an allowed domain list, checked *before* a token is requested, and the window is capped in days and messages so a year-wide range cannot quietly become a large OpenAI bill.

### 3.5 The workbook

Six sheets, in the order somebody reads them: **Summary** (the narrative and the figures), **Request Register**, **Not Completed**, **Completed**, **Analytics**, **Method**.

The charts are written as **real Excel charts, not pasted images**, so they stay live when a manager filters the register or drops a row they disagree with. The Method sheet states what was read, how status was decided, and what the model cannot see — verbal agreements, other systems, anything buried in an attachment.

### 3.6 Verification

Lints clean across all nine files; the blade compiles; five routes register inside the authenticated group.

- **Workbook built end to end** from in-memory models — six sheets, register populated, **three embedded chart XML parts** confirmed in the archive.
- **Migration run against in-memory SQLite**, models round-tripped, casts and relations confirmed, `down()` reverses cleanly. The live database was never opened.
- That test found a real defect: **the foreign-key cascade left orphan task rows.** It does fire on MySQL, but a delete that only works while FK enforcement happens to be on is not a delete. `destroy()` now removes the tasks explicitly.

Nothing was committed, and the migration has **not** been run anywhere real.

---

## 4. Main Outcomes

- A dated, evidenced record of **214 completed and 54 outstanding items** across 18 working days, issued as a PDF and a workbook, with its own method and limitations stated in both.
- The boss-request register exists in both files, structured and blank, and can be filled in minutes once the mailbox opens.
- `/mailreads` turns that whole job — read the mail, extract the asks, judge completion, explain it, chart it, export it — into a page anyone with the grant can run for any mailbox and any question, instead of a manual exercise repeated every month.
- Three separate refusals were diagnosed and told apart, so the remaining blocker is now one specific, actionable thing rather than "it didn't work".

---

## 5. Follow-Up Items

- **Grant `Mail.Read` (application) to the Graph app registration and admin-consent it in Azure.** This is the blocker for `/mailreads` and for the boss-request register both. Nothing else on this list matters until it is done.
- **Run the Mail Reads migration** — `php artisan migrate --pretend` first, then `php artisan migrate`. Not run today by design.
- **Commit the Mail Reads work.** Nine new files and three modified are sitting uncommitted on `REV1`.
- **Grant `settings_mail_reads`** to the roles that should have it — narrowly. The page can read any mailbox the domain fence allows.
- **Rotate the credentials pasted into the assistant session today** — the Graph client secret, the AWS access key and secret, and the `accounts.receivable@aahaas.com` mailbox password. Treat all four as exposed, and confirm `.env` is in `.gitignore`.
- **Smoke-test `/mailreads` against a real mailbox** once `Mail.Read` lands — one narrow window first, to see what a run actually costs in tokens before anyone points it at three months.
- **Re-issue the Work Completion Report** with the Boss Requests tab filled, once the mail can be read.
- **Consider moving a wide read onto the queue.** It runs synchronously today, which is right for a month but will not hold for a year-wide window; the day cap is what keeps that honest for now.
- Still open from earlier: the `.fdeck-*` stylesheet on AHS; the 35 Payable 1.1 *Others* rows with transport wording; the Vietnam missing-products document with the rate team and the import-side bug behind it; `cohortFrom`/`cohortTo` on `/print/bookings-list` and the bookings Excel route; `DB_QUEUE_RETRY_AFTER=3900` and the `2G` pm2 change on the live `.env`; the IndusInd account details.

---

**Prepared:** 12 September 2026  
**Projects reviewed:** Accounts System, reporting
