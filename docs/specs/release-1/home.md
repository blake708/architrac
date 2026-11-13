# Spec: Home (Release 1 dashboard)

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app` (signed-in landing page) |
| **Mockup** | `mockup/Home.dc.html` |
| **Status** | Ready (revised 2026-11-13 for the review route, #23) |

> **Revised 2026-11-13 (Blake).** Timesheet review now follows each firm's own review steps (decisions #3 b, #23; `timesheet-approval.md`). The approval card reuses the Approvals tab's queue. Aging uses the Invoices page's 5 buckets. Billed % uses the Projects list's math. Cards also show hours used vs budget hours. Board columns: standard phases, then optional phases in use, then "Other". All text follows `docs/TEXT_RULES.md`.

## Purpose
The page everyone lands on after signing in. In Release 1 it answers four questions with Release 1 data only: *Where is my time this week? Which projects am I on and where are they? Which timesheets wait on me? (owner/admin) What do clients owe us?* Everything else in the mockup is deferred (see Out of scope).

## Who can see it
| Role | Access |
|---|---|
| Owner | All four widgets. "Mine / All firm" toggle. Billed % and hours bar on every card. |
| Admin | Same as Owner. |
| Project manager | Your time, My projects. Billed % only on projects where they are PM. Hours bar on every card. |
| Staff | Your time, My projects. Hours bar on every card. No billed %. |
| Any approver | **Waiting on you** card for anyone who can open the Approvals tab (`approvalAccess().canOpen`): owner/admin, principals, team leaders, people named on the review route, and anyone a sheet waits on. Role does not matter. |
| Client (portal) | None. |

## Layout
`AppShell` with "HOME" crumb. The mockup's top-bar search is **not** rendered in R1 (the notification bell is part of the shell since 1.7 C). Top to bottom:
1. **PageHeader** (white band)
   - Eyebrow (mono, uppercase via CSS): "{Weekday}, {Month} {D}, {YYYY} · {n} active projects". Example: "SUNDAY, OCTOBER 18, 2026 · 10 ACTIVE PROJECTS".
   - H1: "Good {morning|afternoon|evening}, {first name}".
   - Actions: `Log time` (secondary, clock icon → `/app/time`), `New project` (primary → `/app/projects/new`, owner/admin/PM only). The mockup's `New document` button is not rendered.
   - The mockup's "Firm health" KPI strip is **not** rendered in R1.
2. **My projects** section (full width): `SectionHeader` "My projects", owner/admin `SegmentedFilter` Mine | All firm, link "All projects" → `/app/projects`. Below: a horizontally scrolling **phase board** with one read-only column per phase (rule 6). Grid `grid-auto-columns: minmax(176px, 1fr)`, column bg `#E6E6E6`, min-height 150px. Column header = phase name (uppercase via CSS) + count (mono). `ProjectCard`s inside (white, 1px `#DCDCDC` border):
   - project name (600 weight), link to `/app/projects/<id>`
   - grey line "{scope kind} · {project_type}", or only `project_type` when `scope_kind` is empty. Example: "Tenant upfit · Medical".
   - phase tag (grey, mono) with the phase name, only in the "Other" column
   - "On hold" grey tag when `status = on_hold`
   - PM avatar 22px
   - **hours bar** (5px, fill `#2F5BAA`, over budget `#B42318`) + "{used} of {budget} h" (mono), rule 8
   - **billed bar** (5px, fill `#2F5BAA`) + "{n}% billed" (mono), rule 7, only when the viewer can see it
   Cards are links. Cards are **not draggable**.
3. Two-column row (`flex-wrap`, gap 24px):
   - **Left column** (`flex: 999 1 460px`), stacked: **Waiting on you** card (approvers only) then **Invoices outstanding** card (owner/admin only). If both are hidden, the left column is not rendered and Your time takes the row at max-width 560px.
   - **Right column** (`flex: 1 1 400px`): **Your time** card.

### Your time card
Header "Your time", sub "Week of {Mon D}", status pill, link "Open timesheet" → `/app/time/week/{week_start}`. Big number = total hours (26px) + "of {capacity} hours · {b}% billable". Bar chart 116px high: one bar per weekday (Mon–Fri always, Sat/Sun only when they have hours), hours label above each bar, day label under. Under the chart, a one-line status message (rule 3). If last week needs attention, an orange banner above the chart (rule 4).

### Waiting on you card
Header "Waiting on you" + count (mono) + link "Open approvals" → `/app/time/approvals`. Up to 8 rows, in the Approvals tab's queue order (newest week first, then last name):
- avatar 28, name
- "Week of {Mon D}"
- total hours (mono), billable %
- the step the sheet waits on you for, e.g. "Principal in Charge" (from the queue item's `step.label`)
- pill "Partly approved" (`#E4EBF8/#1E3F7A`) when an earlier step, or another Principal in Charge, already approved
- chevron
Each row links to `/app/time/approvals/<timesheetId>`. If more than 8: footer "+{n} more".

### Invoices outstanding card
Header "Invoices outstanding", link "All invoices" → `/app/invoices`. Big number = total outstanding (26px) + "{n} open invoices · {m} over 60 days". Aging row: 5 cells, the same buckets and labels as the Invoices page (`AGING_BUCKETS`): Current, 1–30, 31–60, 61–90, 90+ days. Each cell shows its dollar total (mono). The 61–90 and 90+ cells use text `#B42318` when > 0. List of up to 5 open invoices, most days past due first: number (mono), project name, client name, balance (mono, right), and a flag "{d} days past due" in `#B42318` with a warning icon when d > 0, else "Due {Mon D}".

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Date line | today in `firms.timezone` | `EEEE, MMMM d, yyyy`, uppercase via CSS |
| Active projects count | count(projects) where `status = active`, not archived, whole firm | |
| Greeting name | `users.first_name` | |
| Greeting period | current hour in `firms.timezone`: 0–11 morning, 12–16 afternoon, 17–23 evening | |
| Board columns | rule 6 | |
| Card project | `projects.name`, `projects.scope_kind`, `projects.project_type`, `projects.id` | |
| Card PM avatar | `projects.pm_membership_id` → `users.initials` | Team-page avatar colour rule |
| Card hours | rule 8 | every role |
| Card billed % | rule 7 | owner/admin; PM on own projects; never in the payload otherwise |
| Your time week | week containing today, start = `firm_settings.week_starts_on` | |
| Your time hours per day | Σ `time_entries.hours` by `work_date` for my timesheet of that week | 0 if no timesheet |
| Total / capacity | Σ day hours / `memberships.weekly_capacity_hours` | "32.5", "of 40 hours" |
| Billable % | rule 2 | |
| Timesheet status pill | `timesheets.status` (no row → Draft) | Draft grey, Submitted blue, Approved green, Returned orange (status `rejected`) |
| Approval rows | rule 5 | |
| Invoice totals / aging / list | `invoices` with `status in (sent, partially_paid)`, rule 9 | |
| Invoice client / project | `invoices.client_company_id` → `companies.name`; `invoices.project_id` → `projects.name` | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Log time | navigate `/app/time` | | all |
| New project | navigate `/app/projects/new` | | owner, admin, PM |
| Mine / All firm toggle | switches board scope; choice remembered in `localStorage` key `architrac.home.projectsScope` (wrapped in try/catch; default Mine) | | owner, admin |
| Click project card | navigate `/app/projects/<id>` | | all |
| Open timesheet | navigate `/app/time/week/<week_start>` | | all |
| Click approval row | navigate `/app/time/approvals/<timesheetId>` (approving happens on the approval screen, not here) | | approvers |
| Click invoice row | navigate `/app/invoices/<id>` | | owner, admin |

Home is read-only: no writes, no `activity_log` entries.

## Business rules
1. **My projects scope.** "Mine" = projects with `status in (active, on_hold)`, not archived, where the user's membership is `principal_membership_id`, `pm_membership_id`, or has a `project_members` row. "All firm" = all projects with those statuses. On-hold cards show an "On hold" tag. `pursuit` and `closed` are excluded. Within a column, sort by `projects.number` ascending.
2. **Billable %** (Your time) = Σ hours where `billable = true` and `project_id is not null` ÷ Σ all hours for the week, rounded half-up to whole %; "—" when total = 0. Example: Mon 8, Tue 7.5, Wed 8, Thu 6, Fri 3 = 32.5 h, of which 28 billable → 28 / 32.5 = 86.15% → "32.5 of 40 hours · 86% billable".
3. **Status message** (Your time). The due date is the sheet's due date from the Timesheets settings (due day and time, decision #21; `dueDate()` in `src/lib/calc/timesheet.ts`).
   - Draft: "Not submitted · due {Ddd Mon D}". Example (TMG, due Monday): "Not submitted · due Mon Oct 19".
   - No timesheet: "Not started · due {Ddd Mon D}".
   - Submitted: "Submitted · in review".
   - Approved: "Approved".
   - Rejected: "Returned: {rejection_note}" in `#9A3412`.
4. **Last-week banner:** if the previous week's timesheet is missing, `draft` or `rejected`, and now is after its due date and time, show an orange banner "Week of {Mon D} not submitted." (or "Week of {Mon D} returned.") with link "Open timesheet" to `/app/time/week/<prev week_start>`.
5. **Waiting on you** = exactly the Approvals tab's "Waiting on me" queue: `loadQueue()` in `src/server/time/approval-read.ts`, with the same `approvalAccess()` check. Home must **not** re-implement routing. The count equals the Approvals tab count and the "Ready for you" KPI (`queueCount()`). The user's own sheet never appears. The card renders only when `approvalAccess().canOpen`; for everyone else no queue query runs. With nothing waiting, the card shows the empty state.
6. **Board columns.** A project's **current phase** is the `project_phases` row with `status = current` and lowest `sort_order`; if none, the lowest-`sort_order` `upcoming` phase; if none, the highest-`sort_order` phase. Columns, left to right:
   1. **Standard phases:** every non-archived `phase_templates` row with `is_optional = false`, by `sort_order`. Always shown, with count 0 when empty.
   2. **Optional phases:** `phase_templates` rows with `is_optional = true`, by `sort_order`. Shown only when at least one visible card is in it.
   3. **Other:** cards whose current phase `code` matches no template (custom phases added on one project). Shown only when not empty. Each card here shows its phase name as a tag.
   A card goes in the column whose template `code` equals the current phase `code` (case-insensitive, matching the `phase_templates_code_unique` index). Columns are built from the cards in the current scope (Mine or All firm).
7. **Billed %** (card) = the Projects list's billed figure: `projectBilled()` ÷ Σ `project_phases.fee_cents`, via `billedPct()` in `src/lib/calc/projects.ts`. Only sent invoices count (`sent`, `partially_paid`, `paid`, `written_off`). Fixed phases count phase-fee lines; hourly and NTE phases count hourly and adjustment lines; consultant and expense lines never count. Shown as "{n}% billed", the bar capped at 100%. Fee total 0 → no bar, text "No fee". A project shows the same % here and on the Projects list.
8. **Hours** (card) = hours logged on the project, drafts included (decision #20, `hoursByPhase()` in `src/server/time/used.ts`), vs Σ `project_phases.budget_hours`. Text "{used} of {budget} h", hours to one decimal place when not whole. Bar capped at 100%; bar fill `#B42318` when used > budget. Budget 0 → no bar, text "{used} h · no budget". Every role sees it (hours are not money).
9. **Invoices outstanding.** Open = `status in (sent, partially_paid)`. Balance = `balanceCents()`; days past due = `daysPastDue()`; buckets = `agingTotals()` (all in `src/lib/calc/receivables.ts` and `invoice.ts`). Total = Σ balance. "Over 60 days" counts invoices in the `OVER_60` buckets (61–90, 90+). Example: invoice 2026-118, Coastal Credit Union Branch, due 2026-08-17, balance $19,000. On 2026-10-18, d = 62 → in 61–90 and "over 60 days", list flag "62 days past due". Money formatted `$184,250` with `src/lib/format.ts`.
10. All widget queries run in parallel in the server component. Each widget renders on its own: one failing widget shows its own error, and the others still render.
11. Invoice data is queried only when the user is owner/admin; for other roles the server never runs or returns it. Billed % is left out of the payload for every card the viewer cannot see it on.

## States
- **Empty, My projects (Mine):** "No active projects for you." Owner/admin also get the link "Show all firm projects".
- **Empty, My projects (All firm):** "No active projects. Create a project to start." + `New project` (owner/admin/PM).
- **Empty, Your time:** no timesheet this week → 0 hours, all bars 0 height, status "Not started · due {date}".
- **Empty, Waiting on you:** green check + "No timesheets to approve."
- **Empty, Invoices outstanding:** "$0" + "No open invoices."
- **Loading:** each widget shows its own skeleton (board: 7 grey columns with 2 card skeletons; cards: grey blocks) via `Suspense` per widget. Screen-reader text "Loading {widget}…".
- **Error:** per-widget inline message "{Widget} not loaded." + `Retry` button (loads the data again).
- **Permission denied:** n/a. Every signed-in member can view Home; role-restricted widgets are not rendered.

## Out of scope (for this release)
| Mockup widget / control | Release | Why |
|---|---|---|
| Firm health strip, Receivables tile | 2 | KPI strip ships with Reports/snapshot; R1 shows receivables inside Invoices outstanding |
| Firm health, Payables tile | 2 | needs `vendor_bills` |
| Firm health, Unbilled work tile | 2 | needs the snapshot's earned-vs-billed calculation and expenses |
| Firm health, Utilization tile (firm-wide) | 2 | belongs to Reports; per-person utilization is on Team in R1 |
| Firm health, Proposals out tile | 3 | needs `proposals` (Marketing) |
| Receivables vs. payables chart/table (12 weekly snapshots) | 2 | needs AP data and weekly AR snapshots |
| Due this week: Build RFIs/submittals | 4 | `rfis`, `submittals` |
| Due this week: Schedule items (e.g. MEP kickoff) | 3 | `tasks` |
| Due this week: Marketing proposal follow-ups | 3 | `proposals`, `leads` |
| Due this week: Accounting invoice follow-ups | 2 | follow-up reminders; R1 shows past-due invoices in Invoices outstanding |
| Due this week: "Submit timesheet" | 1 (covered) | replaced by Your time status + last-week banner |
| Drag a card to move a project to another phase | later / open question | phase status changes happen on the Project page in R1 |
| `New document` button | 2 | `documents` |
| Top-bar "Search everything" | 2 | global search across modules |

## Acceptance tests
- [ ] Given today is 2026-10-18 15:00 America/New_York and the user is Blake, when `/app` loads, then the H1 reads "Good afternoon, Blake" and the eyebrow reads "SUNDAY, OCTOBER 18, 2026 · 10 ACTIVE PROJECTS".
- [ ] Given the same time at 09:00, then the greeting is "Good morning"; at 18:00, "Good evening".
- [ ] Given a staff user, then `New project` is not rendered, the Invoices outstanding card is absent, project cards have an hours bar but no billed bar, and the page payload contains no invoice amounts or billed %.
- [ ] Given a PM who is PM on project A and a team member on project B, then A's card shows billed % and B's card does not, and B's billed % is not in the payload.
- [ ] Given JR is PM on Medical Office Building (current phase DD), Northside Self-Storage (CA) and Riverside Retail Shell (PD), when JR opens Home, then exactly those 3 cards appear in the Design Development, Construction Admin and Pre-Design columns.
- [ ] Given an owner toggles to "All firm", then all 10 active/on-hold projects appear; when the page is reloaded, then "All firm" is still selected.
- [ ] Given a project with phases PD complete, SD current, DD upcoming, then its card is in the Schematic Design column.
- [ ] Given a project with no `current` phase and SD as the lowest `upcoming`, then its card is in Schematic Design.
- [ ] Given every standard phase, then each has a column even with 0 cards.
- [ ] Given an optional phase "Interiors" with no project in it, then there is no Interiors column; given a project whose current phase is Interiors, then an Interiors column appears after the standard ones with that card.
- [ ] Given a project whose current phase is a custom phase "Phase 2A", then its card is in an "Other" column at the end with a "Phase 2A" tag; given no such project, then there is no Other column.
- [ ] Given a closed or pursuit project the user is PM on, then it does not appear.
- [ ] Given a project whose Projects list row shows "20%" billed, then its Home card shows "20% billed"; given a draft invoice of $10,000 on it, then the figure does not change.
- [ ] Given a project with 412 h logged (drafts included) and 600 budget hours, then its card shows "412 of 600 h" with a blue bar; given 650 h logged, then the bar is full and red.
- [ ] Given Blake's week of 2026-10-12 has hours 8, 7.5, 8, 6, 3 with 28 billable, then Your time shows "32.5", "of 40 hours · 86% billable", five bars, and no Sat/Sun bars.
- [ ] Given 4 hours logged on Saturday, then a Sat bar appears.
- [ ] Given the current timesheet is draft and the due day is Monday, then the status reads "Not submitted · due Mon Oct 19".
- [ ] Given the timesheet is returned with note "Split CA hours by phase", then the status reads "Returned: Split CA hours by phase" in orange.
- [ ] Given last week's timesheet is still draft after its due date and time, then the orange banner links to that week.
- [ ] Given DS submitted week of Oct 12 and the sheet's current step waits on JR as Principal in Charge, then JR's Waiting on you card lists DS with the total hours and "Principal in Charge"; JR's own submitted timesheet is not listed for JR.
- [ ] Given any approver, then the card's count equals the count on `/app/time/approvals`, and the user's own timesheet never appears.
- [ ] Given a staff member who leads a team, then the Waiting on you card is rendered.
- [ ] Given KL's sheet has 2 Principals in Charge and one already approved, then KL's row shows "Partly approved" for the other; when every step is approved, then KL is no longer listed.
- [ ] Given a user who cannot open the Approvals tab, then the Waiting on you card is not rendered and no queue query runs.
- [ ] Given open invoices of $19,000 (due 2026-08-17) and $11,160 (due 2026-10-30), on 2026-10-18, then total shows "$30,160", "2 open invoices · 1 over 60 days", the 61–90 cell "$19,000", Current "$11,160", and the first list row is 2026-118 flagged "62 days past due".
- [ ] Given a `paid`, `void`, `draft`, `in_review` or `written_off` invoice, then it is excluded from Invoices outstanding.
- [ ] Given the invoices query throws, then only the Invoices outstanding card shows "Invoices not loaded." with Retry, and the other widgets render.
- [ ] Given a user of firm B, then no projects, timesheets or invoices of firm A appear in any widget.

## Open questions
1. ~~Approval model~~ Resolved: review route (#3 b, #23). Home reuses the Approvals tab queue.
2. ~~Per-entry approval fields~~ Resolved: not needed. Review is per step (`timesheet_review_steps`).
3. ~~`projects.scope_kind`~~ Resolved: the column exists. Cards show "{scope kind} · {project_type}".
4. ~~Route prefix~~ Resolved: `/app/...`.
5. Should drag-to-change-phase on the board come back in a later release, and what should it do (mark the old phase complete and the new one current)?
6. Should PMs see an "Invoices outstanding" card limited to their own projects?
7. Should the board also show `pursuit` projects (in a "Pursuit" column) once Marketing (Release 3) exists?
8. **Text rules vs. existing labels.** `TEXT_RULES.md` §4 says "Create" (not "New") and "Reject" (not "Return"). The app already uses "New project" and "Return timesheet" / "Returned" everywhere. Home keeps the app's current words to match. Rename app-wide in a separate change?
