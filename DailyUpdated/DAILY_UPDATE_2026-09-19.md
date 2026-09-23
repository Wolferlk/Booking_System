# Daily Work Update — 19 September 2026 (Friday)

**From:** Sasindu Diluranga  
**Subject:** Daily Development Update — 19 Sep 2026 (Online Work portal: sign-in, the employee half, daily filing & shift approvals; AS P&L import by quotation number)

---

## Executive Summary

The day was spent almost entirely in the **Aahaas Online Work portal**, taking it from a screen anyone could open to a product with two halves and a door between them.

The morning put **real authentication** in front of it. The portal had no anonymous surface by design but nothing actually enforced it — four API routes still carried a "no auth here yet" comment. Sign-in, registration, sessions, lockout and middleware are now in place, and with them the **employee half of the app** (`/me`): a person's own day, calls, mail, teams and account, and nothing about anybody else.

The afternoon built the thing the portal exists to replace: the **daily filing spreadsheet**. `/me/workday` writes a day once instead of three times, `/me/shift` proposes a working week, `/approvals` decides both, and `/filings` gives a manager the one answer the spreadsheet could never give without opening every tab — **who hasn't filed**.

One strand in the Accounts System closed a real gap found while importing P&L: **a booking whose IS number was never stamped could not be imported at all.** It can now be named by its quotation / tour reference instead.

| Project | Today's commits | Branch | Worktree |
|---|---:|---|---|
| Aahaas Online Work | 2 commits | `main` | Clean |
| Accounts System | Work in progress | `REV1` | 2 files modified, uncommitted |
| Booking System / OPS | No work today | `LIVE-1.0.0v` | Clean |
| Aahaas Task Manager | No work today | `main` | Clean |
| AHS | No work today | `sewminiV3-UI-changes` | Clean |

---

## 1. Online Work — authentication and the employee portal

`44d1907` · 65 files · ~4,800 lines

### 1.1 The door

Sign-in, registration (`@aahaas.com` only), sign-out, sessions, a rate limit and lockout, and middleware that decides which half of the app you see from `users.role_id` — `super_admin` / `manager` / `team_lead` land on `/dashboard`, `user` lands on `/me` and sees only themselves.

**A side effect worth flagging:** `/api/monitoring`, `/api/demo`, `/api/call-reports` and device approval all previously carried a *"no auth here yet"* comment. They are now behind the session — **non-admins get 403, anonymous gets 401** — and those comments were updated to match. Anything already calling those endpoints without a session will now be refused.

### 1.2 The narrow write module

The database layer was, and stays, **SELECT-only** — `db.ts` is untouched. Registration needs to write, so `account-store.ts` was added as a deliberately narrow exception: it **exports no general-purpose executor**. `run()` refuses anything that is not one of four named constants — insert user, insert audit row, increment the lockout counter, clear it. Nothing else can reach the database through it.

### 1.3 Two account findings

* **`Aahaas123` is not the admin password.** Tested against the live database and it fails. `admin@aahaas.com` exists as `super_admin`, but its hash is the one the seed script generated and printed once — nothing ever *enforced* a password before today, which is why this never surfaced. The admin half was verified by minting a session directly: **all 13 admin screens render.** The password was **not** reset — that needs a word from you. (The two failed-login attempts my own tests caused were cleared.)
* **`Emp1@aahaas.com` now exists**, registered through the real form, password `Aahaas123456`. The one supplied was 9 characters and registration requires 12 — the rule was matched rather than weakened.

### 1.4 The employee half

`/me` (the day), `/me/activity`, `/me/calls`, `/me/mail`, `/me/teams`, `/me/account` — each reading only that person's own data, with an explicit *unavailable* state rather than a zero wherever a channel is not enrolled.

---

## 2. Online Work — daily filing, shifts and approvals

`ff8a278` · 24 files · ~3,200 lines

### 2.1 `/me/workday` — the day written once

The spreadsheet asks for the same day **three times**: counts at shift start, the same counts again at shift end, and narrative in a third place. Here a task is written **once** — filed in the morning as planned, moved to *done* with minutes against it at six o'clock.

> **The counts a manager reads are derived live at the bottom. Nobody types a number they have already implied.**

Each task carries title, description, kind of work, priority, status, time spent and a ticket reference. The day carries work-day status, location, shift times, break, the sheet's *technical / availability issue* field and a handover note.

Two things are pre-filled so nobody retypes them: **hours come from the person's approved shift**, and **yesterday's unfinished tasks come forward** as `carried_over`. A day strip across the top shows filed / draft / open at a glance.

### 2.2 `/me/shift` — proposing a week

A seven-day pattern editor with *copy to all* per row and a live weekly total. **Saving here raises a request; the current shift stays in force** until someone decides. Work-from-home is asked for as a dated range. Both land in the same queue.

### 2.3 `/approvals` and `/filings` — the admin side

* **`/approvals`** — pending first and alone, decided kept below as the record of who allowed what. A shift request renders the **whole proposed week**, not a summary of it.
* **`/filings`** — everyone's day, **leading with who hasn't filed** (the question the spreadsheet could not answer without opening every tab), then each filed day in full, in the words the person wrote.
* **`/employees/[id]`** gained an *Employee ID* panel and a *Working shift* panel. An administrator's shift **applies at once and raises nothing**, but the record keeps `setBy: "admin"` so the employee's own screen says who chose the hours.

### 2.4 Decisions worth flagging

* **The approval is enforced, not advisory.** `workday-store.ts:405` refuses a filing whose location is not covered by an approved arrangement, **by name** — it does not silently downgrade to *office*. Approving a shift request writes the request and the shift **in one call**, so a decision cannot be recorded without its effect.
* **Employee ID goes to the live database**, not a JSON file beside it — it belongs on the directory row. One statement was added to the `account-store.ts:62` allowlist (the module's own comment invites exactly that): scoped to one column, administrators only, and it files an audit row naming who issued it. Everything else — filings, shifts, requests — is JSON under `.data/workday/`, matching how the monitoring roster and call reports already work around the read-only constraint.
* **A middleware bug I introduced and fixed.** Employees need `/api/me/*`, but the branch that redirects employees away from admin screens was catching those API paths too and 307-ing the fetch. Caught in testing; `middleware.ts:72` now returns on API paths **before** the page-redirect rule.

---

## 3. Accounts System — importing a P&L by quotation number (in progress)

`ImportAsPnlByIsNumber.php` · `AppleSystemApiService.php` · **uncommitted**

**The gap.** The IS number is the normal handle for `as-pnl:import`, but the Apple System's list row only carries an `is_number` **once it has been stamped there**. A booking can be confirmed, priced and invoiced while that field is still blank — the IS number then lives only inside the quote payload, and the filter `listByIsNumber()` uses is applied upstream, so it never reaches it. Those bookings could not be imported at all.

**The fix.** They can now be named by the number actually printed on the invoice's **TOUR REF**:

```bash
php artisan as-pnl:import --quotation=473420
php artisan as-pnl:import --quotation=473420CNTL --all --dry-run
```

Three details that are easy to get wrong:

1. **The `CNTL` suffix is accepted and stripped.** `reference_id_full` shows the same number in four dresses; the digits are the part the `id` filter matches.
2. **The field names are asymmetric.** The returned row carries `quotation_no` = the number asked for, and an `id` of its own that is the *booking* id of the current revision — **473420 answers with id 474048**.
3. **A quotation lookup answers with the current revision only.** A revision in the Apple System is a new booking id, not an edit, so `--all` now walks the `quotation_updates` the row carries to reach the earlier ones. Those entries carry only the id, status and created date that differ per revision — everything else (country, pax, tour ref) is inherited from the row they hang off, and each revision's figures come from its own quote, fetched per id.

The duplicate check was adjusted to match: for a quotation lookup it matches on `as_quotation_no`, because the stored `is_number` is exactly what could not be looked up in the first place. The IS-number path is unchanged.

---

## 4. Verification

- The Online Work admin half was verified by **minting a session directly against the live database** — all 13 admin screens render. The employee account was created **through the real registration form**, not seeded around it.
- The middleware API-path bug was found in testing, before it reached anyone.
- **No password was reset, no P&L was written, and the quotation-import work has been exercised with `--dry-run` only.**
- The Accounts System change is **not committed** and has not been run against live outside dry runs.

---

## 5. Follow-Up Items

1. **`admin@aahaas.com`'s password needs a decision.** The seed-generated hash is in place and the printed password is lost. Say the word and I will reset it; until then the only way in is a minted session.
2. **`AUTH_SECRET` must be set in the deployment environment** before the portal goes anywhere — see `.env.local.example`. Sessions are signed with it.
3. **Four API endpoints changed behaviour today.** `/api/monitoring`, `/api/demo`, `/api/call-reports` and device approval now require a session. Anything calling them unauthenticated — including the Windows agent, if it does — will get 401/403 and needs checking.
4. **Filings, shifts and requests are JSON under `.data/workday/`**, not the database. That is deliberate given the read-only constraint, but it means they do not survive a deploy that does not carry that directory forward.
5. **The quotation import is uncommitted.** It needs a commit on `REV1` and one real (non-dry) run against a booking known to have a blank `is_number` before it can be relied on.
6. **Still open from 15 Sep:** the five live indexes are not yet created, `DB_READ_HOST` is not set in Amplify, Checklist VN's tables are not applied to live, and the Task Manager team backfill has not been run.
