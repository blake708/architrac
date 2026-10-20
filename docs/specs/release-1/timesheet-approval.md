# Spec: Timesheet approval

| | |
|---|---|
| **Release** | 1 (milestone 1.7) |
| **Route** | `/app/time/approvals` (queue) · `/app/time/approvals/week/[weekStart]` (week overview + reminders) · `/app/time/approvals/[timesheetId]` (detail) |
| **Mockup** | `mockup/Time.dc.html` → "Approvals" tab (team tables, Approve / Return / Send reminder / Nudge, "Approve N … no flags"). Detail page and Return dialog are not in the mockup; they use the same components. |
| **Status** | Draft |

## Purpose
Project managers approve submitted time on the projects they run; owners and admins approve overhead, leave and anything a PM can't, and can approve everything. Approval freezes bill and cost rates onto each time entry so later rate changes never rewrite history. Admins also chase people who haven't submitted.

## Who can see it
| Role | Access |
|---|---|
| Owner | All timesheets in the firm (except approving their own). Sees rates. Week overview for everyone. Reopen approved timesheets. |
| Admin | Same as owner. |
| Project manager | Timesheets (not their own) that contain lines on projects where `projects.pm_membership_id` = their membership. Whole timesheet visible, hours only — **no rates or costs**. Week overview limited to people with time on their projects that week, plus their team if they are `teams.leader_membership_id`. |
| Staff | none — tab hidden, routes return 404, actions return forbidden. |
| Client (portal) | none |

## Key concept: approval lines
An **approval line** is a group of a timesheet's entries that one approver signs off. Approval is recorded per entry (`time_entries.approved_at`, `approved_by` — see Open questions).

| Entry on person P's timesheet | Designated approver | Who else may approve it |
|---|---|---|
| Project entry, project PM ≠ P and PM membership active | that PM | any owner/admin ≠ P |
| Project entry where the PM is P, or the PM membership is inactive | any owner/admin ≠ P | — |
| Overhead or leave entry | any owner/admin ≠ P | — |

Nobody approves their own entries. "**My lines**" = the unapproved entries on a timesheet where I am the designated approver. A timesheet becomes `approved` when every non-archived entry has `approved_at`.

## Layout
App shell, Time page header and KPI strip as in `timesheet.md` (the header's week navigation is replaced by the queue's view switch). "Approvals" tab is selected.

1. **View switch** (secondary Buttons as a segmented pair under the tabs): "Waiting on me" (count) · "Week overview".
2. **Route card** (white Card, flex-wrap, 14px gap) — mockup "Approval route" strip: caption `APPROVAL ROUTE`, steps `1 · Submitted` (grey) → `2 · PMs approve their projects` (blue tint) → `3 · Admin approves overhead & leave` (green tint); muted note `Rates lock when each line is approved.`; right: primary Button `Approve 4 with no flags` (`All clean timesheets approved`, disabled, when 0).
3. **Waiting on me view:** one Card per week (newest week first), header `WEEK OF OCT 12 – 18` + mono summary `4 ready for you · 2 with others`. Table (min-width 1040px, horizontal scroll in card):
   - Columns: checkbox (36px, header checkbox selects all in card) · Person 230px (Avatar, `KL · Designer`, muted `Target 40 h`) · Mon–Fri 120px (5 bars) · Total 70px · Billable 76px · Your lines minmax(160px,1fr) · Flag 150px · Actions 190px.
   - Bars: 10px wide, height `max(2, round(h / 10 × 26))px`, 0 h = #E3E3E3, > 9 h = orange #C2410C, else blue #2F5BAA; `role="img"` `aria-label="Mon to Fri: 8, 8, 8, 8, 8 hours"`.
   - Your lines: mono `12 h` + muted `2026-014 · 2026-017` (project numbers, or `Overhead`, `Leave`).
   - Actions: primary small Button "Approve" (30px), secondary "Return"; whole row (outside controls) links to the detail page.
   - **Selection bar** (sticky bottom, ink background, white text) when ≥ 1 checked: `3 selected · 96 h` + Button "Approve selected" + ghost "Clear".
4. **Week overview** (`/app/time/approvals/week/[weekStart]`, default = the most recent week whose due time has passed): week navigation (prev / "Last week" / next) and meta `WEEK OF OCT 12 – OCT 18, 2026 · DUE MON OCT 19, 9:00 AM`. One Card per team (`teams.sort_order`; people with no team in a final "No team" card), header: team name, leader Avatar + `Team leader · JR`, mono summary `2 waiting on you · 1 with others · 1 not submitted`. Same grid columns, but "Your lines" becomes **Status** (Badge): `Not submitted`, `Draft`, `Returned`, `Waiting on you`, `Waiting on JR` (or `Waiting on admin`), `Approved`. Actions: Approve/Return when I have lines; `Send reminder` for not submitted/draft/returned (label becomes `Reminder sent 2:14 PM`); `Nudge JR` for timesheets only waiting on another approver (owner/admin only). Card footer when ≥ 1 missing: secondary Button `Remind all not submitted (2)`.
5. **Detail page** (`/app/time/approvals/[timesheetId]`):
   - Page header: meta `KL · DESIGNER · WEEK OF OCT 12 – OCT 18, 2026 · SUBMITTED MON OCT 19, 8:12 AM`; H1 person's full name; right: icon buttons "Previous in queue" / "Next in queue", secondary "Return", primary `Approve my lines (12 h)`; owner/admin also secondary `Approve all lines (40 h)`.
   - The timesheet grid from `timesheet.md` in read-only mode with notes sub-rows expanded, plus columns after "Billing": **Approval** 140px (`Yours`, `JR`, `Admin`, or green `Approved · JR`); owner/admin only: **Bill rate** and **Cost rate** 90px each, mono (`$110`, `$44`; red `No rate` when the lookup fails). Rows not in my lines are shown with 60% opacity text.
   - Footer Card: week total, billable split bar, flags list, and a **History** list from `activity_log` (`Submitted Oct 19, 8:12 AM`, `JR approved 2026-014 (12 h) Oct 19, 2:40 PM`, `Returned by TC: "…"`).
6. **Return dialog** (Dialog): title `Return timesheet to KL`; Textarea label `What needs to change?` (required, 1–1000 chars); help `KL gets an email with this note. Approvals already given on this timesheet are cleared.`; footer: ghost "Cancel", danger "Return timesheet".
7. **Approve confirm dialog** (bulk only): `Approve 4 timesheets?` body `This approves 118.5 h and locks the rates in effect on each work date.` Buttons "Cancel" / primary "Approve".
8. **Reopen** (detail page of an `approved` timesheet, owner/admin only): secondary Button "Reopen", opens the Return dialog with title `Reopen and return to KL`.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Queue rows | `timesheets` where `status='submitted'`, `membership_id` ≠ mine, having ≥ 1 entry in my lines | grouped by `week_start` desc, then person last name |
| Person | `users.first_name/last_name/initials`, `memberships.title`, `memberships.weekly_capacity_hours` | |
| Day bars, Total | Σ `time_entries.hours` by `work_date` (Mon–Fri bars only; Total includes weekend) | |
| Billable % | `round(Σ billable hours / total × 100)` | |
| Your lines | Σ hours of my lines; distinct `projects.number` (or `Overhead` / `Leave`) | |
| Flags | rule 6 | |
| Status badge | rule 7 | |
| Approval column | `time_entries.approved_by` → `users.initials`; else designated approver | |
| Bill / Cost rate | frozen `time_entries.bill_rate_cents` / `cost_rate_cents` if approved, else `lookupRate()` preview | owner/admin only; formatted `$110` / `$44.50` |
| Reminder sent | latest `activity_log` with `action='reminder_sent'`, `entity_type='membership'`, `entity_id` = person, `changes.week_start` = week | time in firm timezone |
| KPI "Ready for you" | count of queue rows (all weeks) | note `Timesheets with lines waiting on you` |
| KPI "Not submitted" | count of people in my week overview for the last due week with status Not submitted / Draft / Returned | note `Team members, week of Oct 12`; orange when > 0 |
| Tab count "Approvals" | same as "Ready for you" | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Approve (row or detail "Approve my lines") | `approveLines(timesheetId, scope='mine')` — rule 3 | Timesheet `submitted`; ≥ 1 line mine; every line has a rate | PM / owner / admin, never own |
| Approve all lines | `approveLines(timesheetId, scope='all')` — approves every unapproved entry, including PM-designated ones | as above | owner / admin, never own |
| Approve selected / Approve N with no flags | Confirm dialog → `approveLines(scope='mine')` per timesheet, each in its own transaction; toast `Approved 4.` or `Approved 3. 1 not approved: KL has no rate on Oct 14.` | "no flags" = rows in the current view whose Flag is `—` | PM / owner / admin |
| Return | Return dialog → `returnTimesheet(timesheetId, note)` — rule 4 | note trimmed 1–1000 chars; status `submitted` | anyone who may approve ≥ 1 entry on it (approved or not) |
| Reopen | `reopenTimesheet(timesheetId, note)` — rule 5 | status `approved`; no entry has `invoice_id` | owner / admin, never own |
| Send reminder | `sendTimesheetReminder(membershipId, weekStart)` — email + `activity_log` | not sent to this person for this week in the last 12 h | owner / admin (anyone); PM for people in their week overview |
| Remind all not submitted | same, for each missing person in the card; skips anyone reminded < 12 h ago | | same |
| Nudge approver | `nudgeApprover(membershipId)` — one email to the PM listing their waiting count | not nudged in the last 12 h | owner / admin |
| Previous / Next in queue | Navigate within the "Waiting on me" order | | |

Server actions live in `src/server/time/approval-actions.ts`; each: `requireRole('owner','admin','project_manager')` → Zod → `withFirm` transaction with `select … for update` on the timesheet → permission check per entry → write → `activity_log` → `revalidatePath('/app/time')`. Responses to PMs are built without rate fields (strip on the server).

## Business rules
1. **Rate lookup** (`src/lib/calc/rates.ts`, pure: `lookupRate(rates, membership, workDate) → { billRateCents, costRateCents } | null`): candidate rows have `archived_at is null`, `effective_from ≤ D` and (`effective_to is null` or `effective_to ≥ D`). First the person override (`rates.membership_id` = P); else the role rate (`rates.firm_role_id` = `memberships.firm_role_id`); else `null`. Both values come from the same chosen row. If several rows match at one level, take the latest `effective_from`.
2. **Missing rate blocks approval.** If any entry being approved returns `null`, nothing in that timesheet is written. Error: `No rate for KL on Oct 14. Add one in Settings → Roles & rates.` (all missing dates listed, comma-separated). Shown as a red flag on the row and in the detail Bill/Cost column.
3. **Approve transaction** for timesheet T, approver V, entry set S (my lines, or all unapproved for scope `all`):
   - a. T must be `submitted`, else `This timesheet is no longer waiting for approval.` (handles two approvers clicking at once).
   - b. Re-validate T's entries with the submit checks from `timesheet.md` rule 10 b–d (defensive).
   - c. For each e in S: `bill_rate_cents`, `cost_rate_cents` = `lookupRate(P, e.work_date)`; `approved_at = now()`; `approved_by = V.user_id`.
   - d. If no non-archived entry of T has `approved_at is null`: `T.status='approved'`, `T.approved_at=now()`, `T.approved_by=V.user_id`.
   - e. `activity_log`: one `approved` row for T with `changes = { entry_ids, hours, scope }`, plus `status_changed` when d applies.
   - **Worked example (test fixtures):** Designer role rate A: bill 11000, cost 4200, `effective_to` 2026-10-13; rate B: bill 11000, cost 4400, from 2026-10-14. KL's 2026-014 DD row = Mon 3, Tue 3, Wed 2, Thu 2, Fri 2 (12 h); PM of 2026-014 is JR. JR approves: Mon/Tue entries get cost 4200, Wed–Fri get 4400, all bill 11000. Labor cost = 6 × 4200 + 6 × 4400 = 25,200 + 26,400 = 51,600 cents ($516). Billable value = 12 × 11000 = 132,000 cents ($1,320). KL's 4 h of Overhead stays unapproved, so T stays `submitted` with status note `Waiting on admin`. When BM (owner) approves the overhead, T becomes `approved`. If KL also has a person override (bill 12000, cost 4600, from 2026-10-01), every entry instead gets 12000 / 4600.
4. **Return** (`returnTimesheet`): `T.status='rejected'`, `rejection_note` = note, `rejected_at`, `rejected_by`; on every entry of T set `approved_at`, `approved_by`, `bill_rate_cents`, `cost_rate_cents` to null; `activity_log` `status_changed` with the note; email P: subject `Your timesheet for Oct 12 – 18 was returned`, body = returner's name, note, link to `/app/time/week/2026-10-12`. Allowed only while `submitted`.
5. **Reopen** (`reopenTimesheet`): only `approved` timesheets with no entry having `invoice_id`; else `2 entries are on invoice 2026-121. Void or edit that invoice before reopening.` Effect is identical to rule 4 (status `rejected`, rates cleared, email), with `activity_log` action `reopened`.
6. **Flags** (`src/lib/calc/timesheet-flags.ts`; first matching flag shows, all show on the detail page). Let cap = `weekly_capacity_hours`, total = week total.
   - `No rate for Oct 14` (red #B42318) — any of my lines has no rate (owner/admin see dates; PMs see `Rate missing — ask an admin`).
   - `Over 44 h` (orange) — total > cap + 4 (cap 40 → over 44).
   - `<cap − total> h under target` (orange) — total < cap (e.g. `2 h under target`).
   - `—` (muted) otherwise = **clean**. "Approve N with no flags" counts clean rows in the current view where I have lines.
   - Seed check: DS [8,8,8,8,6] = 38 → `2 h under target`; SG [10,9,9,9,9] = 46 → `Over 44 h`; KL [8,8,8,8,8] = 40 → clean; EW (cap 24) [6,6,6,6,0] = 24 → clean.
7. **Status badge** (week overview): no timesheet → `Not submitted` (grey hollow dot, orange diamond if past due); `draft` → `Draft` (same); `rejected` → `Returned` (orange); `submitted` with my lines unapproved → `Waiting on you` (orange diamond); `submitted`, none mine → `Waiting on <initials of designated approvers with open lines>` or `Waiting on admin` (blue); `approved` → `Approved` (green).
8. **Who appears in week overview / reminders:** memberships with `active = true` whose user has logged in at least once or was created before the week ended; owner/admin see all; PM per "Who can see it". People are "missing" when status is Not submitted, Draft or Returned.
9. **Reminders.** Email subject `Your timesheet for Oct 12 – 18 is due` (or `…is overdue` after due), body with hours logged so far and a link to the week. Logged in `activity_log` (`entity_type='membership'`, `action='reminder_sent'`, `changes={week_start, automatic}`). Max one manual reminder per person per week per 12 h; the button is disabled with `Reminder sent 2:14 PM` meanwhile.
10. **Automatic reminders.** Vercel Cron `GET /api/cron/timesheet-reminders` hourly. For each firm, when firm-local time first passes the due time for a week (lock day 09:00), email every missing person once for that week (`automatic: true`) and email each PM/admin with waiting lines a summary `You have 5 timesheets waiting for approval`. Idempotent: re-running in the same hour sends nothing new.
11. **Invoices read only approved timesheets.** Invoicing (separate spec) must select entries whose timesheet `status='approved'`, never individually approved entries on a partly approved timesheet.
12. **Rates privacy.** `bill_rate_cents`, `cost_rate_cents`, and preview rates are removed server-side from every payload sent to a PM.

## States
- **Empty state:** "Waiting on me" with no rows → Card `Nothing waiting on you` / `Submitted timesheets with lines on your projects appear here.` / Button `Go to week overview`. Week overview with nobody visible → `No one has time on your projects this week.`
- **Loading state:** table skeleton of 4 rows per card; buttons disabled while an approve/return request is in flight, the clicked button shows a spinner.
- **Error state:** action errors show inline under the row (red 12px) and as a toast; the row stays. Concurrency error (rule 3a) refreshes the row.
- **Permission-denied state:** staff → 404 for all routes; PM opening a timesheet with none of their project lines → 404.

## Out of scope (for this release)
- Mockup two-step route (team leader review → principal approval) and the "Skips · is leader" pill — see Open questions.
- Approving part of a line (single days), editing someone's hours during review, approval delegation while a PM is away → Release 2+.
- Slack / in-app notifications; email only in R1.

## Acceptance tests
- [ ] Given KL (staff) submits a week with 12 h on 2026-014 (PM JR) and 4 h Overhead, when JR opens "Waiting on me", then KL's row shows `12 h` · `2026-014` in Your lines.
- [ ] Given the same, when BM (owner) opens "Waiting on me", then KL's row shows `4 h` · `Overhead`, and the detail page offers both `Approve my lines (4 h)` and `Approve all lines (16 h)`.
- [ ] Given JR approves KL's lines with the rule 3 fixtures, then Mon/Tue entries have `cost_rate_cents` 4200, Wed–Fri 4400, all `bill_rate_cents` 11000, `approved_by` = JR, and the timesheet stays `submitted`.
- [ ] Given that, when BM approves his lines, then the timesheet is `approved`, `approved_by` = BM, and `activity_log` has `approved` and `status_changed` rows.
- [ ] Given KL has a person override (12000 / 4600 from Oct 1), when approved, then every entry gets 12000 / 4600.
- [ ] Given KL has no person rate and the Designer role has no rate covering Oct 14, when JR approves, then nothing is written and the error reads `No rate for KL on Oct 14. Add one in Settings → Roles & rates.`
- [ ] Given an approved entry, when an admin later edits the Designer rate, then that entry's frozen rates are unchanged.
- [ ] Given JR is PM of 2026-014 and submits his own timesheet with 2026-014 time, then those lines are not in JR's queue and appear in BM's lines.
- [ ] Given BM is an owner, then his own timesheet never appears in his queue and `approveLines` on it returns forbidden.
- [ ] Given JR and BM click Approve on the same lines at the same moment, then one succeeds and the other gets `This timesheet is no longer waiting for approval.` or a no-op, never double-written rates.
- [ ] Given JR clicks Return with an empty or whitespace note, then the dialog shows `Add a note so KL knows what to change.` and nothing is sent.
- [ ] Given a 1001-character note, then it is rejected with `Notes can be up to 1000 characters.`
- [ ] Given JR already approved his lines, when TC returns the timesheet with a note, then status = `rejected`, all entries have null `approved_at` and null rates, and KL receives the return email with the note.
- [ ] Given an approved timesheet with an entry on invoice 2026-121, when BM clicks Reopen, then it fails with the invoice message.
- [ ] Given an approved, uninvoiced timesheet, when BM reopens with a note, then status = `rejected`, rates are cleared and `activity_log` action = `reopened`.
- [ ] Given seed week Oct 12, then flags show DS `2 h under target`, SG `Over 44 h`, KL `—`, EW `—`.
- [ ] Given 4 clean rows and 2 flagged rows where I have lines, then the button reads `Approve 4 with no flags`, and confirming approves exactly those 4.
- [ ] Given 3 selected rows where one has a missing rate, when "Approve selected" runs, then 2 are approved and the toast reads `Approved 2. 1 not approved: KL has no rate on Oct 14.`
- [ ] Given JR (PM) loads any approval page or action response, then no `bill_rate_cents`, `cost_rate_cents` or preview rate appears in the payload.
- [ ] Given staff KL requests `/app/time/approvals`, then the response is 404, and calling `approveLines` returns forbidden.
- [ ] Given a user in firm B calls `approveLines` with a firm A timesheet id, then it returns not-found (cross-firm RLS test).
- [ ] Given CF and NB have no submitted timesheet for Oct 12, then week overview shows them `Not submitted`, the KPI "Not submitted" = 2, and the card shows `Remind all not submitted (2)`.
- [ ] Given BM sends CF a reminder, then one email is sent, `activity_log` has `reminder_sent` with `week_start` 2026-10-12, and the button reads `Reminder sent <time>` and is disabled for 12 h.
- [ ] Given CF was reminded 1 h ago, when BM clicks `Remind all not submitted (2)`, then only NB is emailed.
- [ ] Given the cron runs at 09:05 Mon Oct 19 firm time and again at 10:05, then missing people get exactly one automatic reminder for Oct 12.
- [ ] Given DS's timesheet waits only on JR, when BM clicks `Nudge JR`, then JR gets one summary email.
- [ ] Given JR (PM) opens week overview, then only people with time on JR's projects that week (plus JR's team, if he leads one) are listed.

## Open questions
1. **Data model addition needed: `time_entries.approved_at timestamptz null`, `time_entries.approved_by uuid null references users(id)`** — required for per-project approval ("PMs approve time on their projects") on a timesheet that spans several projects. The model today has approval only on `timesheets`.
2. **Data model addition needed: `timesheets.rejected_at`, `timesheets.rejected_by`** (also listed in `timesheet.md`). Confirm `timesheets.approved_by` references `users(id)`.
3. **Data model note: `activity_log.action` values** — this spec adds `approved`, `reopened`, `reminder_sent` to the listed `created/updated/status_changed/deleted`. Fine as free text; confirm.
4. **Two-step route.** The mockup shows "Team leader reviews → Principal approves" (`teams.leader_membership_id`). This spec implements PM-per-project + admin. Should team leaders also sign off (a third step), or replace PM approval?
5. Should `project_members.bill_rate_override_cents` override the bill rate at approval? The rate-lookup rule in DATA_MODEL doesn't mention it; this spec ignores it.
6. Firms with only one owner/admin can't get that person's overhead approved. Add a firm setting "Allow owners to approve their own time"? (TMG has two principals, so not blocking for TMG.)
7. Include `employment_type='contract'` people in missing-timesheet reminders? Spec: yes, all active memberships.
8. Over-hours threshold is `capacity + 4` (mockup "Over 44 h"); make it a firm setting?
