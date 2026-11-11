# Spec: Timesheet (weekly entry)

| | |
|---|---|
| **Release** | 1 (milestone 1.6) |
| **Route** | `/app/time` (redirects to the current week) · `/app/time/week/[weekStart]` (`weekStart` = `YYYY-MM-DD`, must be a week-start day) · `/app/time/history` |
| **Mockup** | `mockup/Time.dc.html` → tabs "My timesheet" and "History" |
| **Status** | Draft |


> **Revised for Open Decision #3 (b), 2026-11-05:** a timesheet goes to the person's **team leader, then a principal**, as a whole (not per project). Statuses: `draft` → `submitted` ("With team leader") → `leader_approved` ("With principal") → `approved`; either reviewer can return it (`rejected`). Team leaders' own timesheets, and people with no team (or whose leader is inactive), go straight to a principal. The Approvals tab, the approver KPI tiles and the approve/return actions are milestone 1.7 (`timesheet-approval.md`). **Revised again 2026-11-09 (1.7 A, decisions #22, #23):** the route is now each firm's own list of review steps (Principal in Charge by default), saved on the sheet at submit in `timesheet_review_steps`; `leader_approved` is gone and `submitted` means "in review". Principals' own sheets are approved on submit. Rules 14, 18 and the status table below are updated; `timesheet-approval.md` has the details. Also decided 2026-11-05: draft hours are real `time_entries` (#19), billable notes can be required by a firm setting (#17), the due time is a firm setting (#21).

## Purpose
Every person logs their hours for one week against a project phase + activity, an overhead category + activity, or leave, then submits the week for approval. This is the only way time enters ArchiTrac; budgets, invoices and project snapshots read from it.

## Who can see it
| Role | Access |
|---|---|
| Owner | Own timesheet: full edit. |
| Admin | Same as owner. |
| Project manager | Same as owner. |
| Staff | Same as owner. |

Everyone sees only their own timesheet here; any URL or server-action input that targets another person's timesheet returns 404 / not found. From 1.7, team leaders and principals (`memberships.is_principal`) also see an "Approvals" tab (`timesheet-approval.md`); nobody else does.
| Client (portal) | none |

Nobody edits another person's timesheet in Release 1 (approvers view it read-only from the approval screen).

## Layout
Shared app shell (menu rail, top header with page title "Time"). Then, top to bottom:

1. **Page header** (white band, 32px padding).
   - Left: mono meta line `TIMESHEETS · APPROVALS · HISTORY` (`TIMESHEETS · HISTORY` for people without the Approvals tab), H1 "Time". (Changed by Blake, 2026-11-11: the week moved down to the week heading, item 3a.)
2. **KPI strip** — grid of KPI tiles, `repeat(auto-fit, minmax(180px, 1fr))`: "This week", "Billable". (1.7 adds "Ready for you" and "Not submitted" for team leaders and principals.)
3. **Tabs** — "My timesheet", "History" (count = past timesheets). Tabs are links to their routes. (1.7 adds "Approvals" between them for team leaders and principals.)
3a. **Week heading** (above the status bar): H2 `Week of Oct 12 – Oct 18, 2026` (22px, weight 600). The due date shows in the status note. (Blake, 2026-11-11.)
4. **Status bar** (My timesheet): status Badge with dot + label, a muted status note, autosave indicator (`Saving…` / `Saved 10:42 AM` / `Couldn't save. Retrying…` in orange), and on the right the week navigation — icon button "Previous week" (`aria-label`), button "This week", icon button "Next week". "This week" is a secondary Button; when the current week is shown it has `aria-pressed="true"` and does nothing. (Moved here from the page header by Blake, 2026-11-11.)
5. **Rejection banner** (only when status = `rejected`): orange-tint card, text `Returned by JR on Oct 20: "<rejection_note>"` and `Fix the rows below and resubmit.`
6. **Weekly grid** (Card containing a real `<table>`, `min-width: 960px`, `table-layout: fixed`, horizontal scroll inside the card on narrow screens).
   - Header: "Project · phase · activity" (fluid), "Billing" (104px), 7 day columns (58px each: day-of-week + mono `Oct 12`; weekend columns use surface-2 background), "Total" (76px, right), remove column (44px, visually-hidden header "Remove").
   - Row, first cell, stacked with 6px gap:
     - Unset row: one Select "Choose a project…" (label visually hidden: "Project for new row"). Day inputs are disabled until a choice is made.
     - Set row: line 1 = mono number (12px, muted) + name in weight 600 (`2026-014 Medical Office Building`; overhead shows `OH Overhead`; leave shows `LEAVE <category name>`).
     - Line 2 (editable states): a `flex-wrap: nowrap` row, 6px gap, of two Selects, both 30px high, 12.5px text. **Phase select:** wrapper `flex: 1 1 450px; max-width: 450px; min-width: 150px`. **Activity select:** wrapper `flex: 1 1 300px; max-width: 300px; min-width: 120px`. Each select is `width: 100%`. A select with no value has an orange border and orange text. Visually hidden labels "Phase for <project>" / "Activity for <project>".
     - Line 2 (read-only states): muted 12.5px text `Design Development · Meetings`.
   - Billing cell: toggle Badge button "Billable" (blue tint, filled blue dot) / "Non-bill." (grey tint, hollow dot); `aria-label` "Billable, select to change".
   - Day cells: number input 52×34px, centered mono 13px, `inputmode="decimal"`, placeholder `—`, empty when 0. Read-only states: transparent border and background.
   - Total cell: mono 13px weight 600, right-aligned.
   - Last cell: "Remove row" icon button (×). `aria-label`s include the project name.
   - **Note icon** (changed by Blake, 2026-11-05, replacing a notes sub-row): a small speech-bubble button under each day's hours, only on days with hours. Faint = no note, blue (filled) = has a note, orange = the firm requires one and it's missing. It opens a small popover: `NOTE · TUE OCT 13` and the row name, a 3-line text box (max 500 characters, counter `28/500`), Cancel and Save (Ctrl/⌘+Enter saves). On a locked sheet the icon shows only where there's a note, and the popover is read-only.
   - **Day total row** (surface-2 background): "Day total" spanning first two columns, 7 mono totals, week total (14px, weight 700). A Mon–Fri total below the daily target is orange with a 3px orange bottom inset bar.
6a. **Action row** (under the grid): on the left secondary buttons "Copy last week" and "Add row" (only when editable); on the right secondary Button "Recall timesheet" when submitted and recall is allowed, and primary Button "Submit for approval" (`Resubmit` when rejected; principals see `Submit and approve`). Disabled submit = grey #C4C4C4 background, `aria-disabled="true"`, cursor not-allowed. (Moved by Blake, 2026-11-11.)
7. **Footer card** (white, flex-wrap): left block (flex `1 1 360px`):
   - `WEEK TOTAL` caption + mono `32.5 / 40 h` + muted `28 billable · 4.5 non-billable · 86% billable`.
   - 10px stacked bar: billable segment blue #2F5BAA, non-billable segment #A9BDE3, track #EBEBEB; legend "Billable", "Non-billable". `role="img"` with `aria-label` "32.5 of 40 hours, 28 billable".
   - Blocking message (orange, diamond icon) when submit is blocked — first blocking message from Validation, e.g. `2 rows need a phase and an activity before you can submit.`
   - (Removed by Blake, 2026-11-11: the `FEEDS PROJECT SNAPSHOTS` phase summary line and the short-week warning line. The "This week" KPI already shows `7.5 h short of 40`. The submit buttons moved to the action row, 6a.)
8. **History tab** (`/app/time/history`): Card "Your past timesheets", list rows (grid `150px 1fr 80px 120px`): week range, billable/non-billable bar (scaled to 45 h), mono total `41 h`, status Badge. Row is a link to that week. Newest first, 26 weeks per page with "Load older".

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Week dates | `firm_settings.week_starts_on`, URL `weekStart` | 7 days from week start; weekend = Sat/Sun by day-of-week, not by column index |
| Due date | first `firm_settings.timesheet_lock_day` on or after the week's fifth day (`week_start + 4`), at `firm_settings.timesheet_due_time` in `firms.timezone` | `DUE MON OCT 19, 9:00 AM`. Monday due → the following Monday; Friday due → that week's Friday |
| Status badge | `timesheets.status`; no row → "Draft" | Draft = grey hollow dot; `submitted` "With JR" / "With a principal" (from the current review step) = blue dot; Approved = green filled; Returned (`rejected`) = orange diamond. "Late" suffix in orange when now > due and status is draft/rejected/none |
| Rows | `timesheet_rows` (see Open questions: data model addition) ordered by `sort_order` | one row per selection |
| Project name / number | `projects.number`, `projects.name` | |
| Phase options | `project_phases` for the row's project, `archived_at is null`, ordered `sort_order` | label suffix: `· current` (status `current`), `· closed` (status `closed`, option disabled), `· complete`, `· additional service` (`project_phases.is_additional_service`) |
| Overhead "phase" options | `overhead_categories` where `is_leave = false and active`, ordered `sort_order` | |
| Leave choice | `overhead_categories` where `is_leave = true and active` — each is its own entry in the project select | phase select shows the single disabled option "Leave" |
| Activity options | project rows: `activities` where `applies_to='project' and active`; overhead/leave rows: `activities` where `applies_to='overhead' and overhead_category_id = row category and active`; ordered `sort_order` | placeholder "Activity…"; overhead row with no category: "Pick a phase first" |
| Project select options | groups: "My projects" (`projects.status='active'` and member via `project_members`), "Other active projects" (`status='active'`, not a member), "Overhead" (one option `OH · Overhead`), "Leave" (one option per leave category) | label `2026-014 · Medical Office Building` |
| Day cell value | `time_entries.hours` where `timesheet_row_id` = row and `work_date` = day | shown via `formatHours` with up to 2 decimals, trailing zeros dropped (1.5, 2, 0.25, 6.75) — see Open question 10 |
| Row total | Σ row's entries `hours` | |
| Day total | Σ all entries on that `work_date` | |
| Week total | Σ all entries | |
| Daily target | `memberships.weekly_capacity_hours / 5` (Mon–Fri only) | 8 for 40 h |
| Week target | `memberships.weekly_capacity_hours` | |
| Billable / Non-billable | Σ hours of rows with `billable = true` / `false` | |
| Billable % | `round(billable / week × 100)`; 0 when week = 0 | |
| KPI "This week" | week total `h`; note `<target − week> h short of 40` (orange) or `Target met` | |
| KPI "Billable" | billable %; note `<billable> billable hours · target <memberships.target_utilization_bp/100>%` | |
| Notes | `time_entries.note` | |
| History rows | `timesheets` for my membership, `week_start < current week start`, plus entry sums | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Previous / Next week | Navigate to `/app/time/week/<±7 days>` | Next is disabled beyond 8 weeks after the current week | own |
| This week | Navigate to current week (computed in `firms.timezone`) | — | own |
| Add row | Appends an unset row at bottom; focuses its project select. Saved as a `timesheet_rows` record with all selection columns null | Only when editable | own |
| Choose project | Sets `project_id`, `row_type='project'`, `billable=true`, phase = the project's single `current` phase (lowest `sort_order` if several, none if zero), activity null | — | own |
| Choose Overhead | `row_type='overhead'`, `billable=false`, category null, activity null | — | own |
| Choose a leave category | `row_type='leave'`, `overhead_category_id` = category, `billable=false`; if the category has exactly one active activity it is selected | — | own |
| Change phase | Updates the row. For overhead rows, if the current activity doesn't belong to the new category, activity is cleared | Closed phases can't be chosen (option disabled; server rejects too) | own |
| Change activity | Updates the row | Activity must be valid for the row (rule 5) | own |
| Toggle billing | Flips `billable` on the row and all its entries | Project rows only; overhead/leave toggle is disabled (always non-billable) | own |
| Type hours | Debounced autosave 800 ms after the last keystroke and immediately on blur. Upserts / deletes the entry for (row, day) | rules 6–8 | own |
| Edit note | Saves `time_entries.note` for that day on blur (trimmed; blank clears it). Clearing a day's hours clears its note | ≤ 500 chars; only on a day with hours, else `Add hours to this day before adding a note.` | own |
| Remove row | Row with no hours: removed at once. Row with hours: confirm Dialog "Remove this row? Its 6.5 h will be deleted." → sets `archived_at` on the row and its entries | Only when editable | own |
| Copy last week | Copies row selections (not hours or notes) from the previous week's timesheet; see rule 13 | Only when editable | own |
| Submit / Resubmit | Runs submit validation (rule 10). On success: drops empty rows, builds the review (rule 18), sets `status='submitted'` (or `approved` for a principal's own sheet), `submitted_at=now()`, clears `rejection_note`, writes `activity_log` (`status_changed`). Toast "Timesheet submitted." | All blocking messages must be clear | own |
| Recall timesheet | `status='draft'`, `submitted_at=null`, `reviewer_membership_id=null`, activity_log | Only while no reviewer has acted (rule 14) | own |

All writes are Server Actions in `src/server/time/actions.ts`: `addRow`, `updateRow`, `removeRow`, `setHours`, `setNote`, `copyLastWeek`, `submitTimesheet`, `recallTimesheet`. Each one: `requireRole` → Zod → load timesheet and check it belongs to the caller's membership → check it is editable (rule 2) → write → `activity_log` → return the updated timesheet view model. The `timesheets` record is created on the first write for that week (status `draft`), never on view.

## Business rules
1. **Week.** `week_start` = the most recent day ≤ the date that matches `firm_settings.week_starts_on` (TMG: 1 = Monday). A URL `weekStart` that is not a week-start day redirects to the containing week. One timesheet per (`membership_id`, `week_start`).
2. **Editable states.** Editable when status is `draft`, `rejected`, or no timesheet exists. Read-only when `submitted` or `approved`. The server re-checks on every write; a write against a non-editable timesheet returns error `This timesheet is <status> and can't be changed.` and the UI reloads it.
3. **Row types.** `project` → needs `project_id`, `project_phase_id`, `activity_id`. `overhead` → needs `overhead_category_id` (non-leave) and `activity_id`. `leave` → needs leave `overhead_category_id` and `activity_id`. Entries copy the row's `project_id`, `project_phase_id`, `overhead_category_id`, `activity_id`, `billable` so reports read `time_entries` alone; changing the row updates its entries in the same transaction.
4. **Closed phases / projects.** A phase with `status='closed'`, or any phase of a project with `status='closed'`, can't be chosen and can't receive hours. If a draft row points at a phase that became closed after it was chosen, the row shows `· closed` and submit is blocked (message in Validation).
5. **Activity validity.** Project rows: activity `applies_to='project'`. Overhead/leave rows: activity `applies_to='overhead'` and `overhead_category_id` = the row's category. Inactive activities are not offered; a row already using one shows `<name> · inactive` and blocks submit.
6. **Hours input.** Accepts decimals (`1.5`, `.75`) and `h:mm` (`1:30` → 1.5). Values are rounded to the nearest 0.25 on blur (`1.1` → 1, `1.13` → 1.25, `0.1` → 0 → entry removed); when rounding changes the value a 12px muted hint `Rounded to 1.25` shows under the cell for 3 s. Empty or 0 deletes the entry. Server rejects anything that isn't `> 0`, `≤ 24` and a multiple of 0.25 (Zod refine `hours * 4` is an integer).
7. **Day limit.** Σ hours on one day across all rows ≤ 24. A cell edit that would exceed it is rejected with `Oct 14 would total 25 h. A day can't exceed 24 h.` and the cell reverts.
8. **Cells need a choice.** Day inputs on an unset row are disabled. Hours typed on a row whose phase/activity is still empty are saved (entry has null phase/activity while draft — see Open questions) but block submit.
9. **Billable.** Project rows default `true` and may be toggled. Overhead and leave rows are always `false`.
10. **Submit validation** (all run server-side; UI runs the same function from `src/lib/calc/timesheet.ts` live):
    - a. Week total > 0, else `Add your hours before submitting.`
    - b. Every row with hours has phase/category and activity, else `<n> row(s) need(s) a phase and an activity before you can submit.`
    - c. No row with hours on a closed phase/project, else `<number> <phase> is closed. Move these hours to an open phase.`
    - d. No row with hours on an inactive activity, else `<activity> is no longer offered. Pick another activity on <project>.`
    - e. No duplicate rows (same phase-or-category + activity + billable) with hours, else `Two rows are both <project> · <phase> · <activity>. Combine them.`
    - f. No day > 24 h (defensive; rule 7 should prevent it).
    - g. The week has started: `today ≥ week_start` in firm timezone, else `You can't submit a week that hasn't started.`
    - h. Notes (`firm_settings.timesheet_notes_rule`, decisions #17 and #24): `all` → every billable day with hours has a note, else `<n> billable day(s) need(s) a note before you can submit.`; `hourly` → only billable days on phases with fee type `hourly` or `nte`, else `<n> billable day(s) on hourly phases need(s) a note before you can submit.`; `optional` → never. Non-billable time never needs a note.
    - Rows with no hours are ignored by a–e and deleted (archived) on submit.
    - Short of target never blocks submit. It shows only on the "This week" KPI (`7.5 h short of 40`).
11. **Totals** (pure functions in `src/lib/calc/timesheet.ts`): `rowTotal = Σ row hours`; `dayTotal[d] = Σ hours on d`; `weekTotal = Σ dayTotal`; `billable = Σ hours where billable`; `billablePct = weekTotal ? round(billable / weekTotal × 100) : 0`; bar billable width = `min(100, billable / target × 100)%`, non-billable width = `max(0, min(100, weekTotal / target × 100) − billable width)%`.
    - **Worked example (seed week of Oct 12, BM):** rows r1 2026-014 DD Meetings [2, 1.5, 2, 1, 0, 0, 0] = 6.5; r2 2026-006 CD QA/QC review [3, 2, 3, 2, 1] = 11; r3 2025-038 Permitting [1, 2, 1, 1, 0] = 5; r4 2025-031 CA Site visit [1, 2, 1, 1, 0.5] = 5.5; r5 Overhead Marketing Proposals [1, 0, 1, 1, 1.5] = 4.5. Day totals Mon 8, Tue 7.5, Wed 8, Thu 6, Fri 3, Sat 0, Sun 0; week 32.5. Billable 28, non-billable 4.5, 28 / 32.5 = 86.15% → 86%. Tue, Thu, Fri are orange (< 8). Bar: 70% blue + 11.25% light blue. Short of target: 40 − 32.5 = 7.5 h.
12. **Phase summary.** Removed by Blake, 2026-11-11 (not needed on this page).
13. **Copy last week.** Source = timesheet with `week_start` = this week − 7 days. Copies each non-archived source row's selection and `billable` as new rows appended after existing rows. Skips: rows identical (rule 10e key) to a row already present; rows whose project/phase is now closed or whose activity is inactive. Toast: `Copied 4 rows.` or `Copied 4 rows. Skipped 1: 2026-017 Pre-Design is closed.` No source: toast `There's no timesheet for last week to copy.` Everything already here: `Last week's rows are already on this timesheet.` Only skips: `Nothing copied. Skipped 1: …`. Projects that aren't active (on hold, pursuit) and switched-off overhead phases or leave types are skipped too (`2026-020 Clinic isn't active.`, `Marketing is no longer offered.`). (1.6 B)
14. **Recall.** Allowed only while no reviewer has acted: status `submitted` and no row of its review is `approved`. Recall archives the review rows. Once someone has approved a step, the button is hidden and the status note says who.
15. **After approval.** `approved` timesheets are locked. Only an owner/admin "Reopen" (approval spec) makes them editable again; it returns status `rejected` with a note.
18. **Route (decisions #22, #23, 1.7 A).** At submit the firm's review route becomes the sheet's review (`timesheet-approval.md` rule 1), saved in `timesheet_review_steps`, so later team, PIC or route changes don't move the sheet. A principal's own sheet is approved at once (rates frozen); a missing rate blocks that submit.
16. **Rates are not set here.** `bill_rate_cents` / `cost_rate_cents` stay null until approval. This screen never returns rates to the browser.
17. **Autosave.** Optimistic UI. Writes are queued in order per timesheet; failures retry 3 times (1 s, 3 s, 9 s), then show `Couldn't save. Check your connection.` with a "Retry" link. Leaving the page with unsaved writes triggers the browser "Leave site?" prompt.

## States
- **Empty state:** no timesheet and no rows → grid shows one empty-state row: "No time this week yet" / "Add a row, or copy last week's rows." with buttons "Add row" (primary) and "Copy last week".
- **Loading state:** server-rendered; on client week change, the grid shows 5 skeleton rows and the KPIs show `—`.
- **Error state:** load failure → Card "Couldn't load this week." with "Try again". Save failure → autosave indicator (rule 17).
- **Permission-denied state:** another person's week or another firm's data → 404 page.
- **Status states:**
  | Status | Badge | Status note | Grid | Buttons |
  |---|---|---|---|---|
  | none / `draft` | Draft | `Not submitted yet. Due Mon Oct 19 at 9:00 AM.` | editable | Submit for approval |
  | `submitted`, nobody has acted | With JR / With BM, PD / With a principal | `Submitted Oct 19, 8:12 AM. Route: JR, then BM. You can recall it until someone approves.` | read-only | Recall timesheet |
  | `submitted`, a step approved | With BM | `JR approved Oct 19. Waiting on BM.` | read-only | none |
  | `approved` | Approved | `Approved Oct 20 by BM. Locked.` (principal's own: `Approved when you submitted, Oct 19. Locked.`) | read-only | none |
  | `rejected` | Returned | `Returned. Fix and resubmit.` + rejection banner | editable | Resubmit |

## Out of scope (for this release)
- Mockup "Approvals" tab content → `timesheet-approval.md`.
- Approving and returning (team leader and principal steps) → `timesheet-approval.md` (1.7).
- Entering time on behalf of another person, timers, mobile layout tuned below 640px (grid scrolls), firm holiday calendar auto-filling Holiday rows (mockup History "32 (Labor Day)") → Release 2+.
- Copying hours (not just rows) from last week.

## Acceptance tests
- [ ] Given today is Wed Oct 14 2026 (America/New_York) and `week_starts_on=1`, when BM opens `/app/time`, then he is redirected to `/app/time/week/2026-10-12` and the meta line reads `WEEK OF OCT 12 – OCT 18, 2026 · DUE MON OCT 19, 9:00 AM`.
- [ ] Given `/app/time/week/2026-10-14`, when it loads, then it redirects to `/app/time/week/2026-10-12`.
- [ ] Given BM has no timesheet for the week of Oct 26, when he views it, then no `timesheets` record is created and the empty state shows.
- [ ] Given the seed week of Oct 12, when it loads, then day totals are 8, 7.5, 8, 6, 3, 0, 0, week total 32.5, billable note `28 billable · 4.5 non-billable · 86% billable`, and Tue, Thu, Fri totals are orange.
- [ ] Given a draft week, when BM adds a row and picks `2026-014 · Medical Office Building`, then the phase select shows `Design Development · current` selected, `Schematic Design · closed` disabled, and the activity select shows `Activity…` with an orange border.
- [ ] Given a draft, when a client calls `updateRow` with a closed `project_phase_id`, then the server rejects it and nothing changes.
- [ ] Given an Overhead row with category Marketing and activity Proposals, when the category changes to Administration, then the activity is cleared and the options are Admin & IT, Accounting & billing, Office management.
- [ ] Given an Overhead row with no category, then the activity select's placeholder is `Pick a phase first`.
- [ ] Given BM picks leave category Holiday (one activity), then the activity is set to Holiday, billing shows `Non-bill.` and the toggle is disabled.
- [ ] Given a new unset row, then its day inputs are disabled.
- [ ] Given a draft cell, when BM types `1:30` and blurs, then 1.5 is saved.
- [ ] Given a draft cell, when BM types `1.13`, then 1.25 is saved and `Rounded to 1.25` shows.
- [ ] Given a draft cell, when BM types `0.1`, then the entry is removed and the cell shows `—`.
- [ ] Given a draft cell, when BM types `-2` or `abc`, then nothing is saved and the cell shows error `Enter hours like 1.5 or 1:30.`
- [ ] Given Wed Oct 14 already totals 20 h, when BM types 5 in another row's Oct 14 cell, then the cell reverts and `Oct 14 would total 25 h. A day can't exceed 24 h.` shows.
- [ ] Given a direct call to `setHours` with 1.3, then the server rejects it (not a multiple of 0.25).
- [ ] Given a row with 3 h and no activity, then submit is disabled and the footer shows `1 row needs a phase and an activity before you can submit.`
- [ ] Given a row with no hours and no activity, then submit is enabled, and after submit that row no longer exists.
- [ ] Given a draft row on 2026-017 Schematic Design with hours, when the PM sets that phase to `closed`, then BM's submit is blocked with `2026-017 Schematic Design is closed. Move these hours to an open phase.`
- [ ] Given two rows both `2026-014 · Design Development · Meetings · Billable` with hours, then submit is blocked with the duplicate message.
- [ ] Given a draft with 0 total hours, then submit is blocked with `Add your hours before submitting.`
- [ ] Given today is Oct 14 and BM views the week of Oct 19 with hours, then submit is blocked with `You can't submit a week that hasn't started.`
- [ ] Given a 32.5 h draft, then the KPI shows `7.5 h short of 40` but submit is allowed; after submit, status is `submitted`, `submitted_at` is set and an `activity_log` row with action `status_changed` exists.
- [ ] Given a submitted timesheet, when a client calls `setHours`, then the server returns `This timesheet is submitted and can't be changed.`
- [ ] Given a submitted timesheet with no approved entries, when BM clicks Recall, then status returns to `draft` and cells are editable.
- [ ] Given route [Team leader, PIC] and KL on JR's team submits, then status is `submitted`, the review waits on JR and the badge reads `With JR`. *(Replaces the 1.6 tests; see `timesheet-approval.md` 1.7 A.)*
- [ ] Given route [Team leader, PIC] and JR (the team's leader) submits, then step 1 is skipped, the badge reads `With BM` and Recall is shown.
- [ ] Given a sheet where JR approved step 1, then Recall is hidden, the server refuses `recallTimesheet`, and the status note names JR.
- [ ] Given the firm requires billable notes and a billable day with hours has no note, then submit is blocked with `1 billable day needs a note before you can submit.`; with the setting off, it isn't.
- [ ] Given the firm's due day is Friday at 5:00 PM, then the week of Oct 12 reads `DUE FRI OCT 16, 5:00 PM`.
- [ ] Given a `rejected` timesheet with note "Move Tue to Permitting", then the banner shows the note, cells are editable and the button reads `Resubmit`.
- [ ] Given an approved timesheet, then every input, select, toggle, remove and copy control is read-only or hidden.
- [ ] Given last week has rows 2026-014 DD Meetings and 2026-017 Pre-Design (now closed), when BM clicks Copy last week on an empty draft, then 1 row is added without hours and the toast reads `Copied 1 row. Skipped 1: 2026-017 Pre-Design is closed.`
- [ ] Given this week already has row 2026-014 DD Meetings Billable, when copying a last week that has the same row, then it is not duplicated.
- [ ] Given a row with 6.5 h, when BM clicks Remove, then a confirm dialog shows `Its 6.5 h will be deleted.`; confirming archives the row and its entries.
- [ ] Given a project row toggled to Non-bill., then all of that row's `time_entries.billable` are false.
- [ ] Given KL is staff and not a team leader or principal, then the Approvals tab is not rendered (1.7 adds the route itself).
- [ ] Given KL (staff) requests BM's timesheet by id through any server action, then it fails with not-found.
- [ ] Given a user in firm B, when they request a firm A timesheet id, then RLS returns nothing (cross-firm test).
- [ ] Given any timesheet response payload, then it contains no `bill_rate_cents` or `cost_rate_cents` keys.
- [ ] Given a note of 501 characters, then it is rejected with `Notes can be up to 500 characters.`
- [ ] Given the network drops during a save, then the indicator shows `Couldn't save. Check your connection.` after 3 retries and the value is saved when Retry succeeds.

## Open questions
All resolved (Blake, 2026-11-05):
1. **`timesheet_rows` table** — added in migration 0010, as proposed.
2. **`time_entries.timesheet_row_id`** — added; unique (`timesheet_row_id`, `work_date`) while not archived.
3. **Draft entries** — real `time_entries` with the relaxed check (decision #19). Submit enforces completeness.
4. **Additional service** — `project_phases.is_additional_service` already exists (1.5).
5. **Due time** — `firm_settings.timesheet_due_time`, a firm setting (decision #21).
6. **`rejected_at` / `rejected_by`** — added now with the other approval columns; written by 1.7.
7. **Notes on billable time** — firm setting `firm_settings.timesheet_notes_rule`: optional, hourly phases, or all phases (decisions #17, #24).
8. **Leave label** — `LEAVE <category name>`.
9. **Approval route** — each firm's own review route (decision #23, 1.7 A). See the note at the top.
10. **Hours format** — `formatHours` shows up to 2 decimals on time screens.
