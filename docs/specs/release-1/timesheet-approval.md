# Spec: Timesheet approval

| | |
|---|---|
| **Release** | 1 (milestone 1.7, three PRs: **A** review route, **B** Approvals tab, **C** notifications and reminders) |
| **Route** | `/app/time/approvals` (queue) · `/app/time/approvals/week/[weekStart]` (week overview + reminders) · `/app/time/approvals/[timesheetId]` (detail) · `/app/settings/time` ("Approval route" card) |
| **Mockup** | `mockup/Time.dc.html` → "Approvals" tab; `mockup/Settings.dc.html` → Time & approvals → "Approval route" card. The mockup shows a fixed team leader → principal route; this spec replaces it with the firm's own route (below). Detail page, Return dialog and the step editor are not in the mockup; they use the same components. |
| **Status** | Draft, revised 2026-11-09 for decisions #22, #23 and #25 |

> **Revised 2026-11-09 (Blake).** Each firm builds its own **review route** from steps (decision #23). Step kinds: **Principal in Charge**, **Team leader**, **Any principal**, **A named person**. One route per firm. Default: **Principal in Charge** only. When a sheet has projects with different Principals in Charge, **each of them must approve**. Steps with nobody to fill them are skipped. Principals' own sheets are **approved on submit** (decision #22). Reminders and "your sheet was returned" go through **in-app notifications** first; email is added on top later (decision #25). This replaces the per-project PM approval and the fixed team leader → principal route from earlier drafts.

## Purpose
Every submitted timesheet is checked by the people the firm chose, in the order it chose, before it's approved. Final approval freezes bill and cost rates onto each time entry so later rate changes never rewrite history. Reviewers are told when a sheet is waiting on them, and people are reminded when theirs is missing.

## Key concepts

### Review route (the firm's setting)
An ordered list of 1 or more **steps**, set in Settings → Time & approvals. Stored in `review_steps`.

| Kind | Who must approve at this step | Skipped when |
|---|---|---|
| `principal_in_charge` | **Every** distinct Principal in Charge (`projects.principal_membership_id`) of a project with hours on the sheet. Overhead and leave lines are reviewed along with the rest. | The sheet has no project hours; or every PIC is the submitter or inactive |
| `team_leader` | The submitter's team leader (`teams.leader_membership_id`) | No team; the leader is the submitter; the leader is inactive |
| `any_principal` | Any one active principal (`memberships.is_principal`) other than the submitter | A principal already approved an earlier step of this review (checked when the step is reached) |
| `person` | The named membership (`review_steps.membership_id`) | The person is the submitter or inactive |

Rules for the route itself:
- At least one step. Removing the last step is refused: `The route needs at least one step.`
- `principal_in_charge`, `team_leader` and `any_principal` can each appear once. A named person can appear once (several different named people are fine).
- New firms start with one step, `principal_in_charge`. Existing firms get the same in the migration.
- Changing the route only affects sheets submitted afterwards. Sheets already in review keep the copy made at submit (below).

### Review (one sheet's copy of the route)
At submit the server turns the route into the sheet's **review**: rows in `timesheet_review_steps`, one per **required approver** per step (a step with two PICs has two rows; an `any_principal` step has one row with no named approver; a skipped step has one row with status `skipped` and a reason). Who must approve is saved now, so later team or PIC changes don't move a sheet already waiting.

- **Not asking twice:** a named approver already required at an earlier step is left out of later steps; if that empties a step, it's `skipped` (reason `already_reviewing`).
- **Fallback:** if every step is skipped, the review gets one `any_principal` row (decision #23: "if every step skips, it goes to any principal").
- **No one to approve:** if the review needs an `any_principal` row and the firm has no active principal other than the submitter, submit is refused: `There's no principal to approve this timesheet. Ask an admin to mark someone as a principal on the Team page.`
- **Current step** = the lowest `step_no` that still has a `waiting` row. The sheet is `approved` when no `waiting` rows remain.
- A sheet's reviews are never deleted: Recall and Return set `archived_at` on its review rows, and the next submit builds a fresh review from the route in force then.

### Principals' own sheets (decision #22)
A sheet from a member with `is_principal = true` has no review. Submitting it approves it at once: rates are frozen (rule 3c), `status='approved'`, `approved_at=now()`, `approved_by` = the principal's user, `activity_log` `status_changed` with `changes.auto = true`. A missing rate blocks submit (rule 2), with the same message. An owner/admin can Reopen it like any approved sheet.

## Who can see it
| Who | Access |
|---|---|
| Owner, admin | Approvals tab. Queue = sheets waiting on them as a reviewer. Week overview of everyone. Rates shown (owner/admin only, rule 12). Return any sheet in review; Reopen approved sheets (never their own). |
| Principal (`is_principal`) | Approvals tab. Queue = sheets waiting on them, plus every sheet whose current step is `any_principal`. Week overview of everyone. No rates unless also owner/admin. |
| Team leader | Approvals tab. Queue = sheets waiting on them. Week overview of their team. Hours only. |
| Named person on the route | Approvals tab. Queue = sheets waiting on them. Week overview of everyone. Hours only. |
| Anyone else (staff, PMs not in the above) | No Approvals tab; routes return 404; actions return forbidden. |
| Client (portal) | none |

Nobody approves or returns their own sheet. Permission to act is "I have a `waiting` row on the current step" (or, for `any_principal`, "I'm an active principal and not the submitter") — checked on the server, never from job role alone. Owner/admin may also Return (not approve) any sheet in review.

## Layout

### Settings → Time & approvals → "Approval route" card (1.7 A)
White Card under the "Timesheets" card (same width and padding). Owner/admin only. Saves each change straight away (decision #18), no Save button.
1. Title `Approval route`; hint `Who checks each timesheet, in order. Steps with nobody to fill them are skipped. Principals' own timesheets are approved when they submit.`
2. **Route strip** (as in the mockup): grey chip `Submitted` → one chip per step (`Principal in Charge`, `Team leader`, `Any principal`, or the person's name) → green chip `Approved`. Arrows between chips.
3. **Step list**: one row per step: step number (mono), label, for named people a Select of active members, then icon buttons "Move up" / "Move down" (disabled at the ends) and "Remove step" (disabled when it's the only step, title = the refusal message).
   - Under each label a muted note: Principal in Charge `Each project's Principal in Charge. When a timesheet has several projects, each of them approves.`; Team leader `The person's team leader, from the Team page.`; Any principal `Any one principal. Skipped if a principal already approved.`; named person `Always this person.`
4. Secondary Button `Add step` opening a Menu: `Principal in Charge`, `Team leader`, `Any principal`, `A named person` (kinds already on the route are disabled). Choosing "A named person" adds a row with the person Select open; the step saves when a person is picked.
5. Footer hint: `Changes apply to timesheets submitted from now on. Timesheets already in review keep their route.`

### Time page (1.7 A, changes to `timesheet.md`)
- Status badge `submitted` reads from the current step: `With JR` (team leader, PIC or named person; several = `With BM, PD`), `With a principal` (`any_principal`). Status note lists the route: `Submitted Oct 19, 8:12 AM. Route: JR, then BM. You can recall it until someone approves.` After a step is approved: `JR approved Oct 19. Waiting on BM.`
- A principal's own week: button reads `Submit and approve`; after submit, status note `Approved when you submitted, Oct 19. Locked.`

### Approvals tab (1.7 B)
App shell, Time page header and KPI strip as in `timesheet.md`. "Approvals" tab between "My timesheet" and "History".
1. **View switch** (segmented pair under the tabs): `Waiting on me` (count) · `Week overview`.
2. **Route card** (white Card, flex-wrap, 14px gap): caption `APPROVAL ROUTE`, the firm's route strip (as in Settings), muted note `Rates lock when the last step approves.`; right: primary Button `Approve 4 with no flags` (`All clean timesheets approved`, disabled, when 0).
3. **Waiting on me**: one Card per week (newest first), header `WEEK OF OCT 12 – 18` + mono summary `4 ready for you · 2 with others`. Table (min-width 1040px, horizontal scroll in card):
   - Columns: checkbox (36px, header checkbox selects all in card) · Person 230px (Avatar, `KL · Designer`, muted `Target 40 h`) · Mon–Fri 120px (5 bars) · Total 70px · Billable 76px · Step minmax(160px,1fr) · Flag 150px · Actions 190px.
   - Bars: 10px wide, height `max(2, round(h / 10 × 26))px`, 0 h = #E3E3E3, > 9 h = orange #C2410C, else blue #2F5BAA; `role="img"` `aria-label="Mon to Fri: 8, 8, 8, 8, 8 hours"`.
   - Step: `Step 2 of 2 · Principal in Charge`, muted line: who else is still needed at this step (`Also waiting on PD`) or `Last step`.
   - Actions: primary small Button "Approve" (30px), secondary "Return"; the rest of the row links to the detail page.
   - **Selection bar** (sticky bottom, ink background, white text) when ≥ 1 checked: `3 selected · 96 h` + Button "Approve selected" + ghost "Clear".
4. **Week overview** (`/app/time/approvals/week/[weekStart]`, default = the most recent week whose due time has passed): week navigation (prev / "Last week" / next) and meta `WEEK OF OCT 12 – OCT 18, 2026 · DUE MON OCT 19, 9:00 AM`. One Card per team (`teams.sort_order`; people with no team in a final "No team" card), header: team name, leader Avatar + `Team leader · JR`, mono summary `2 waiting on you · 1 with others · 1 not submitted`. Same grid, but "Step" becomes **Status** (Badge, rule 7). Actions: Approve/Return when it's waiting on me; `Send reminder` for Not submitted / Draft / Returned (label becomes `Reminder sent 2:14 PM`); `Nudge JR` for sheets waiting only on others (owner/admin and principals). Card footer when ≥ 1 missing: secondary Button `Remind all not submitted (2)`.
5. **Detail page** (`/app/time/approvals/[timesheetId]`):
   - Page header: meta `KL · DESIGNER · WEEK OF OCT 12 – OCT 18, 2026 · SUBMITTED MON OCT 19, 8:12 AM`; H1 person's full name; right: icon buttons "Previous in queue" / "Next in queue", secondary "Return", primary `Approve` (only when it's waiting on me).
   - **Review strip**: the sheet's own review as chips: `Team leader · JR ✓ Oct 19` (green), `Principal in Charge · BM` (blue, current), `PD` (blue, current), skipped steps grey with the reason (`Team leader · skipped, no team`).
   - The timesheet grid from `timesheet.md` read-only with notes expanded; owner/admin only: **Bill rate** and **Cost rate** columns 90px each, mono (`$110`, `$44`; red `No rate` when the lookup fails). Frozen values once approved, else the lookup preview.
   - Footer Card: week total, billable split bar, flags list, **History** from `activity_log` (`Submitted Oct 19, 8:12 AM`, `JR approved (step 1) Oct 19, 2:40 PM`, `Returned by BM: "…"`).
6. **Return dialog** (Dialog): title `Return timesheet to KL`; Textarea label `What needs to change?` (required, 1–1000 chars); help `KL is notified with this note. Approvals already given on this timesheet are cleared.`; footer ghost "Cancel", danger "Return timesheet".
7. **Approve confirm dialog** (bulk only): `Approve 4 timesheets?` body `This approves your step on each one. Timesheets that finish their route lock the rates in effect on each work date.` Buttons "Cancel" / primary "Approve".
8. **Reopen** (detail page of an `approved` sheet, owner/admin only, never their own): secondary Button "Reopen", opens the Return dialog titled `Reopen and return to KL`.

### Notifications (1.7 C)
- **Bell** icon button in the app header, left of the user menu, with an unread count badge (hidden at 0, `9+` above 9). `aria-label="Notifications, 3 unread"`.
- Click opens a popover (360px wide, max 480px tall, scroll): header `Notifications` + ghost `Mark all read`; newest first, 20 at a time with `Load older`. Each item: icon by kind, title (bold if unread), body (2 lines max), relative time (`2 h ago`). Clicking an item marks it read and goes to its link. Empty: `You're all caught up.`
- Unread count refreshes on navigation and every 60 s while the tab is visible (no websockets in R1).

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Route strip / step list | `review_steps` where `archived_at is null`, by `sort_order` | |
| Queue rows | `timesheets.status='submitted'` whose current step has a `waiting` row for my membership, or an `any_principal` waiting row and I'm an active principal ≠ submitter | grouped by `week_start` desc, then last name |
| Person | `users.first_name/last_name/initials`, `memberships.title`, `weekly_capacity_hours` | |
| Day bars, Total | Σ `time_entries.hours` by `work_date` (Mon–Fri bars; Total includes weekend) | non-archived entries |
| Billable % | `round(Σ billable hours / total × 100)` | |
| Step | current step's `step_no`, kind, count of steps; other `waiting` approvers on it | |
| Review strip | the sheet's non-archived `timesheet_review_steps` | |
| Flags | rule 6 | |
| Status badge | rule 7 | |
| Bill / Cost rate | frozen `time_entries.bill_rate_cents` / `cost_rate_cents` if approved, else `rateFor()` preview | owner/admin only |
| Reminder sent | latest `activity_log` `action='reminder_sent'`, `entity_type='membership'`, `entity_id` = person, `changes.week_start` = week | firm timezone |
| KPI "Ready for you" | count of queue rows (all weeks) | note `Timesheets waiting on you` |
| KPI "Not submitted" | people in my week overview for the last due week with status Not submitted / Draft / Returned | note `Week of Oct 12`; orange when > 0 |
| Tab count "Approvals" | same as "Ready for you" | |
| Bell count | `notifications` for my membership with `read_at is null` | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Add / remove / move / set person on a step (Settings) | Write `review_steps`; `activity_log` (`firm_settings`, `updated`, `changes.review_route` before/after as labels) | ≥ 1 step; kind uniqueness; person active and in firm | owner, admin |
| Submit (Time page) | Build the review (rule 1) or auto-approve a principal's sheet; notify the first step's approvers | `timesheet.md` rule 10, plus rule 1 refusals | own |
| Recall (Time page) | `status='draft'`, archive the review rows | No review row `approved` | own |
| Approve (row, detail, bulk) | `approveStep(timesheetId)` — rule 3 | Sheet `submitted`; I may act on the current step; on the last approval, every entry has a rate | the current step's approver(s), never own |
| Approve selected / Approve N with no flags | Confirm → `approveStep` per sheet, each in its own transaction; toast `Approved 4.` or `Approved 3. 1 not approved: KL has no rate on Oct 14.` | "no flags" = rows in the current view whose Flag is `—` | as above |
| Return | Return dialog → `returnTimesheet(timesheetId, note)` — rule 4 | note trimmed 1–1000 chars; status `submitted` | anyone with a row (waiting or approved) in the current review; owner/admin |
| Reopen | `reopenTimesheet(timesheetId, note)` — rule 5 | status `approved`; no entry has `invoice_id` (from 1.8) | owner/admin, never own |
| Send reminder | `sendTimesheetReminder(membershipId, weekStart)` — notification + `activity_log` | not reminded for this week in the last 12 h | owner/admin/principal; team leader for their team |
| Remind all not submitted | same, for each missing person in the card; skips anyone reminded < 12 h ago | | same |
| Nudge approver | `nudgeApprover(membershipId)` — one notification listing their waiting count | not nudged in the last 12 h | owner/admin/principal |
| Open notification / Mark all read | set `read_at` | own notifications only | the recipient |
| Previous / Next in queue | navigate within "Waiting on me" order | | |

Server actions: route editing in `src/server/settings/review-route.ts`; approvals in `src/server/time/approval-actions.ts`; notifications in `src/server/notifications/`. Each: `requireRole` / permission check → Zod → `withFirm` transaction (`select … for update` on the timesheet for approval actions) → write → `activity_log` → `revalidatePath`. Payloads to anyone but owner/admin are built without rate fields.

## Business rules
1. **Building the review** (`src/lib/calc/review-route.ts`, pure: `buildReview(route, ctx) → { kind: 'auto_approve' } | { kind: 'review', rows } | { kind: 'refuse', message }`). `ctx` = submitter (membership id, is_principal), team leader (id, active), PICs of projects with hours on the sheet (id, active), named people (id, active), active principals. Applies the step table, "not asking twice", the fallback and the refusal from Key concepts. `any_principal` skipping (a principal already approved) is decided when that step becomes current, by `advanceReview()` in the same file.
   - **Worked examples** (test fixtures; PD = a second principal, PIC of 2026-017):
     - Route [PIC]. KL: 12 h on 2026-014 (PIC BM), 4 h Overhead → one step, one row waiting on BM.
     - Route [PIC]. KL: 2026-014 (BM) and 2026-017 (PD) → step 1 has rows for BM and PD; both must approve.
     - Route [PIC]. MW: overhead only → step 1 skipped (`no_projects`) → fallback `any_principal` row.
     - Route [Team leader, PIC]. KL (team Medical, leader JR) → step 1 JR, step 2 BM.
     - Route [Team leader, PIC]. JR (leads Medical) → step 1 skipped (`is_submitter`), step 2 BM.
     - Route [Team leader, Any principal]. KL → step 1 JR, step 2 any principal; when JR approves, step 2 becomes current and waits on any principal.
     - Route [PIC, Any principal]. KL on 2026-014 → step 1 BM; when BM approves, step 2 is skipped (`principal_already_approved`) and the sheet is approved.
     - Route [Named MW, PIC]. MW's own sheet with 2026-014 time → step 1 skipped (`is_submitter`), step 2 BM.
     - BM (principal) submits → `auto_approve`.
2. **Missing rate blocks the final approval** (and a principal's submit). Rate per entry = `rateFor()` in `src/lib/calc/rates.ts` (person override → role rate → none). If any entry has none, nothing on that sheet is written. Error: `No rate for KL on Oct 14. Add one in Settings → Roles & rates.` (all missing dates, comma-separated). Earlier steps don't need rates, but the row still shows the red flag so it can be fixed early.
3. **Approve transaction** (`approveStep`) for sheet T by approver V:
   - a. T must be `submitted` and V must be able to act on the current step, else `This timesheet is no longer waiting for you.` (handles two people clicking at once).
   - b. Mark V's row `approved` (`acted_by` = V's user, `acted_at`). For an `any_principal` row, set `approver_membership_id` = V.
   - c. If the current step has no `waiting` rows left, advance: the next step becomes current (skipping `any_principal` when a principal already approved, rule 1). If none remain: re-run `timesheet.md` rule 10 b–d (defensive), freeze rates on every non-archived entry (`bill_rate_cents`, `cost_rate_cents` from `rateFor(P, work_date)`), `T.status='approved'`, `approved_at`, `approved_by` = V.
   - d. `activity_log`: `approved` row for T with `changes = { step_no, kind }`; plus `status_changed` when c approves it.
   - e. Notify the next step's approvers (1.7 C), or the submitter when approved.
   - **Rate fixture:** Designer role rate A: bill 11000, cost 4200, `effective_to` 2026-10-13; rate B: bill 11000, cost 4400, from 2026-10-14. KL's 2026-014 row = Mon 3, Tue 3, Wed 2, Thu 2, Fri 2 (12 h). On final approval Mon/Tue entries get cost 4200, Wed–Fri 4400, all bill 11000. Labor cost = 6 × 4200 + 6 × 4400 = 51,600 cents ($516). Billable value = 12 × 11000 = 132,000 cents ($1,320). With a person override for KL (bill 12000, cost 4600, from 2026-10-01), every entry gets 12000 / 4600.
4. **Return** (`returnTimesheet`): `T.status='rejected'`, `rejection_note`, `rejected_at`, `rejected_by`; archive T's review rows; clear `bill_rate_cents` / `cost_rate_cents` on its entries (none set before approval, defensive); `activity_log` `status_changed` with the note; notify P: `Your timesheet for Oct 12 – 18 was returned` with the note and a link to `/app/time/week/2026-10-12`. Allowed only while `submitted`.
5. **Reopen** (`reopenTimesheet`): only `approved` sheets with no invoiced entry (`2 entries are on invoice 2026-121. Void or edit that invoice before reopening.`, from 1.8). Same effect as rule 4 (rates cleared), `activity_log` action `reopened`.
6. **Flags** (`src/lib/calc/timesheet-flags.ts`; first matching flag shows, all show on the detail page). cap = `weekly_capacity_hours`, total = week total.
   - `No rate for Oct 14` (red #B42318) — any entry has no rate (owner/admin see dates; others see `Rate missing — ask an admin`).
   - `Over 44 h` (orange) — total > cap + 4.
   - `<cap − total> h under target` (orange) — total < cap.
   - `—` (muted) otherwise = **clean**.
   - Seed check: DS [8,8,8,8,6] = 38 → `2 h under target`; SG [10,9,9,9,9] = 46 → `Over 44 h`; KL [8,8,8,8,8] = 40 → clean; EW (cap 24) [6,6,6,6,0] = 24 → clean.
7. **Status badge** (week overview): no sheet → `Not submitted` (grey hollow dot, orange diamond if past due); `draft` → `Draft` (same); `rejected` → `Returned` (orange); `submitted` waiting on me → `Waiting on you` (orange diamond); `submitted` otherwise → `Waiting on JR` / `Waiting on BM, PD` / `Waiting on a principal` (blue); `approved` → `Approved` (green).
8. **Who appears in week overview / reminders:** active memberships created before the week ended; owner/admin/principals/named people see everyone; team leaders see their team. "Missing" = Not submitted, Draft or Returned. Contractors included (decision #11 recommendation).
9. **Reminders** (1.7 C): notification `Your timesheet for Oct 12 – 18 is due` (or `…is overdue` after the due time) with hours logged so far and a link to the week; `activity_log` (`entity_type='membership'`, `action='reminder_sent'`, `changes={week_start, automatic}`). Max one manual reminder per person per week per 12 h.
10. **Automatic reminders** (1.7 C): Vercel Cron `GET /api/cron/timesheet-reminders` hourly. Per firm, when firm-local time first passes the due time for a week, notify every missing person once (`automatic: true`), and each reviewer with waiting sheets once: `You have 5 timesheets waiting for approval`. Idempotent: re-running in the same hour sends nothing new.
11. **Invoices read only approved timesheets** (1.8): entries whose timesheet `status='approved'`.
12. **Rates privacy.** `bill_rate_cents`, `cost_rate_cents` and preview rates are removed server-side from every payload except to owner/admin.
13. **Notifications** (1.7 C, `src/server/notifications/notify.ts`): one `notify(tx, { recipients, kind, title, body, link, entity })` used by every event. Writes a `notifications` row per recipient inside the caller's transaction. Email is added later inside `notify()` only (decision #25). Kinds: `review_waiting` (a step became current; `any_principal` notifies every active principal ≠ submitter), `timesheet_returned`, `timesheet_approved`, `timesheet_reminder`, `approver_nudge`, `review_summary`.

## States
- **Empty state:** "Waiting on me" with no rows → Card `Nothing waiting on you` / `Timesheets that need your review appear here.` / Button `Go to week overview`. Week overview with nobody visible → `No one to show for this week.`
- **Loading state:** table skeleton of 4 rows per card; buttons disabled while a request is in flight, the clicked one shows a spinner.
- **Error state:** action errors inline under the row (red 12px) and as a toast; the row stays. Concurrency error (rule 3a) refreshes the row.
- **Permission-denied state:** no Approvals access → 404 for all routes; opening a sheet that isn't waiting on me and that I can't otherwise see → 404.

## Out of scope (for this release)
- Approving part of a sheet (single projects or days), editing someone's hours during review, delegation while an approver is away → Release 2+.
- Owner/admin approving a step on someone else's behalf → open question 12.
- Email delivery (added later inside `notify()`), notification preferences, Slack.
- Routes per team (decided: one per firm).

## Acceptance tests

### 1.7 A — Review route
- [ ] Given a new firm, then its route is one step, Principal in Charge.
- [ ] Given the route has one step, when an admin removes it, then it's refused with `The route needs at least one step.`
- [ ] Given Team leader is on the route, then "Add step → Team leader" is disabled; adding the same named person twice is refused.
- [ ] Given staff KL calls a route-editing action, then it returns forbidden.
- [ ] Given each worked example in rule 1, then `buildReview` returns exactly the rows listed (unit tests).
- [ ] Given route [PIC] and KL submits time on 2026-014 (BM) and 2026-017 (PD), then the sheet is `submitted` with two waiting rows (BM, PD) on step 1 and the badge reads `With BM, PD`.
- [ ] Given route [Team leader, PIC] and KL submits, then the badge reads `With JR` and the status note `Route: JR, then BM.`
- [ ] Given KL's sheet is waiting, when an admin changes the route, then KL's review rows are unchanged.
- [ ] Given KL's sheet is waiting, when 2026-014's PIC changes to PD, then KL's sheet still waits on BM.
- [ ] Given BM (principal) submits a week with rates in place, then status = `approved`, `approved_by` = BM, every entry has frozen rates, and `activity_log` has `status_changed` with `auto: true`.
- [ ] Given BM submits a week with no rate covering Oct 14, then submit is refused with `No rate for BM on Oct 14. Add one in Settings → Roles & rates.` and nothing is written.
- [ ] Given route [Any principal] and the firm's only principal BM is inactive, when MW submits, then submit is refused with the "no principal" message.
- [ ] Given a submitted sheet nobody has approved, when KL recalls, then status = `draft` and its review rows are archived; resubmitting builds a fresh review.
- [ ] Given JR approved step 1, then Recall is hidden and `recallTimesheet` is refused.
- [ ] Given existing 1.6 sheets (`submitted` with a team leader, `leader_approved`), after the migration they are `submitted` with an equivalent review (team leader row waiting or approved, then an `any_principal` row).
- [ ] Given a user in firm B reads `review_steps` or `timesheet_review_steps` of firm A, then no rows are returned (cross-firm RLS tests).

### 1.7 B — Approvals tab
- [ ] Given route [PIC] and KL's sheet waits on BM, when BM opens "Waiting on me", then KL's row shows `Step 1 of 1 · Principal in Charge`.
- [ ] Given KL's sheet waits on BM and PD, when BM approves, then it stays `submitted`, leaves BM's queue and stays in PD's; when PD approves, it's `approved`.
- [ ] Given final approval with the rule 3 fixtures, then Mon/Tue entries have `cost_rate_cents` 4200, Wed–Fri 4400, all `bill_rate_cents` 11000.
- [ ] Given KL has a person override (12000 / 4600 from Oct 1), when approved, then every entry gets 12000 / 4600.
- [ ] Given no rate covers Oct 14, when the last approver approves, then nothing is written and the error reads `No rate for KL on Oct 14. Add one in Settings → Roles & rates.`
- [ ] Given an approved entry, when an admin later edits the Designer rate, then its frozen rates are unchanged.
- [ ] Given route [Team leader, Any principal], when JR approves KL's sheet, then it appears in the queue of every active principal, and the first to approve completes it.
- [ ] Given two people approve the same step at once, then one succeeds and the other gets `This timesheet is no longer waiting for you.` or a no-op, never double-written rates.
- [ ] Given BM is an owner, then his own sheet never appears in his queue and `approveStep` on it returns forbidden.
- [ ] Given Return with an empty or whitespace note, then the dialog shows `Add a note so KL knows what to change.`; a 1001-character note shows `Notes can be up to 1000 characters.`
- [ ] Given JR approved step 1, when BM returns the sheet, then status = `rejected`, the review rows are archived and KL is notified with the note.
- [ ] Given an approved, uninvoiced sheet, when BM reopens with a note, then status = `rejected`, rates are cleared and `activity_log` action = `reopened`.
- [ ] Given seed week Oct 12, then flags show DS `2 h under target`, SG `Over 44 h`, KL `—`, EW `—`.
- [ ] Given 4 clean and 2 flagged rows waiting on me, then the button reads `Approve 4 with no flags`, and confirming approves exactly those 4.
- [ ] Given 3 selected rows where one has a missing rate on its last step, when "Approve selected" runs, then 2 are approved and the toast reads `Approved 2. 1 not approved: KL has no rate on Oct 14.`
- [ ] Given JR (not owner/admin) loads any approval page or action response, then no rate field appears in the payload.
- [ ] Given staff DS (not a leader, principal or named person) requests `/app/time/approvals`, then 404, and `approveStep` returns forbidden.
- [ ] Given a user in firm B calls `approveStep` with a firm A sheet id, then not-found.

### 1.7 C — Notifications and reminders
- [ ] Given KL submits and the sheet waits on BM, then BM has one unread `review_waiting` notification linking to the detail page, and the bell shows 1.
- [ ] Given BM opens the notification, then it's marked read and the count drops.
- [ ] Given a firm B user, then they can't read or mark firm A notifications (cross-firm RLS test), and nobody can read another member's notifications.
- [ ] Given CF and NB have no submitted sheet for Oct 12, then week overview shows them `Not submitted`, KPI "Not submitted" = 2, and the card shows `Remind all not submitted (2)`.
- [ ] Given BM reminds CF, then CF gets one notification, `activity_log` has `reminder_sent` with `week_start` 2026-10-12, and the button reads `Reminder sent <time>` and is disabled for 12 h.
- [ ] Given CF was reminded 1 h ago, when BM clicks `Remind all not submitted (2)`, then only NB is notified.
- [ ] Given the cron runs at 09:05 Mon Oct 19 firm time and again at 10:05, then missing people get exactly one automatic reminder for Oct 12.
- [ ] Given DS's sheet waits only on JR, when BM clicks `Nudge JR`, then JR gets one notification.
- [ ] Given JR (team leader, not principal) opens week overview, then only his team is listed.

## Open questions
1. ~~Per-entry approval columns~~ — not needed: approval is per sheet (decision #3 b).
2. ~~`rejected_at` / `rejected_by`~~ — added in 1.6.
3. `activity_log.action` values added: `approved`, `reopened`, `reminder_sent`, `nudged`. Free text; fine.
4. ~~Two-step route~~ — replaced by custom routes (#23).
5. Should `project_members.bill_rate_override_cents` override the bill rate at approval? This spec ignores it.
6. ~~One owner can't approve their own overhead~~ — replaced by #22: principals' sheets approve on submit. A firm still needs at least one principal for non-principal sheets.
7. Contractors get reminders (recommendation for #11). Confirm.
8. Over-hours threshold `cap + 4`; firm setting? (decision #16 open).
9. ~~What can a firm set?~~ — decided 2026-11-09 (#23): four step kinds, one route per firm, auto-skip.
10. ~~Principal sheets~~ — decided: approved on submit (#22).
11. ~~Sheets in review when the route changes~~ — decided: they keep the review made at submit.
12. Should owner/admin be able to approve a step on someone's behalf (e.g. a PIC on holiday)? Not in 1.7; Return + resubmit after a route change is the workaround.
