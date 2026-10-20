# Spec: Home (Release 1 dashboard)

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app` (signed-in landing page) |
| **Mockup** | `mockup/Home.dc.html` |
| **Status** | Draft |

## Purpose
The page everyone lands on after signing in. In Release 1 it answers four questions using only Release 1 data: *Where is my time this week? Which projects am I on and where are they? What is waiting for my approval? (owner/admin) What money is owed to us?* Everything else in the mockup is deferred (see Out of scope).

## Who can see it
| Role | Access |
|---|---|
| Owner | All four widgets; "Mine / All" toggle on My projects; billed % on cards. |
| Admin | Same as Owner. |
| Project manager | Your time, My projects (with billed %), Awaiting your approval. No Invoices outstanding. |
| Staff | Your time, My projects (no billed %). |
| Client (portal) | None. |

## Layout
`AppShell` with "HOME" crumb. The mockup's top-bar search and notification bell are **not** rendered in R1. Top to bottom:
1. **PageHeader** (white band)
   - Eyebrow (mono, uppercase): "{Weekday}, {Month} {D}, {YYYY} · {n} active projects" — e.g. "SUNDAY, OCTOBER 18, 2026 · 10 ACTIVE PROJECTS".
   - H1: "Good {morning|afternoon|evening}, {first name}".
   - Actions: `Log time` (secondary, clock icon → `/app/time`), `+ New project` (primary → `/app/projects/new`, owner/admin/PM only). The mockup's `New document` button is not rendered.
   - The mockup's "Firm health" KPI strip is **not** rendered in R1.
2. **My projects** section (full width) — `SectionHeader` "My projects", owner/admin `SegmentedFilter` Mine | All firm, link "All projects" → `/app/projects`. Below: horizontally scrolling **phase board** — one read-only column per phase (`grid-auto-columns: minmax(176px, 1fr)`, column bg `#E6E6E6`, min-height 150px), column header = phase name (uppercase) + count (mono). `ProjectCard`s inside (white, 1px `#DCDCDC` border): project name (600 weight), "{project_type}" grey line, PM avatar 22px, billed bar (5px, fill `#2F5BAA`) + "{n}% billed" (mono). Cards are links, **not draggable**.
3. Two-column row (`flex-wrap`, gap 24px):
   - **Left column** (`flex: 999 1 460px`), stacked: **Awaiting your approval** card (owner/admin/PM only) then **Invoices outstanding** card (owner/admin only). If both are hidden, the left column is not rendered and Your time takes the row at max-width 560px.
   - **Right column** (`flex: 1 1 400px`): **Your time** card.

### Your time card
Header "Your time", sub "Week of {Mon D}", status pill, link "Open timesheet" → `/app/time/week/{week_start}`. Big number = total hours (26px) + "of {capacity} hours · {b}% billable". Bar chart 116px high: one bar per weekday (Mon–Fri always; Sat/Sun only when they have hours), hours label above each bar, day label under. Under the chart, a one-line status message (rule 3). If last week needs attention, an orange banner above the chart (rule 4).

### Awaiting your approval card
Header "Awaiting your approval" + count (mono) + link "Review all" → `/app/time/approvals` (queue in `timesheet-approval.md`). Up to 8 rows: avatar 28, name, "Week of {Mon D}", total hours (mono), "{h} h for you" (hours of "my lines", mono), billable %, pill "Partly approved" (`#E4EBF8/#1E3F7A`) when another approver already approved some entries, chevron. Row links to `/app/time/approvals/<timesheetId>`. If more than 8: footer "+{n} more".

### Invoices outstanding card
Header "Invoices outstanding", link "All invoices" → `/app/invoices` (invoicing spec). Big number = total outstanding (26px) + "{n} open invoices · {m} over 60 days". Aging row: 4 cells — Current, 1–30, 31–60, 61+ days past due — each with dollar total (mono); the 61+ cell text `#B42318` when > 0. List of up to 5 open invoices, most days past due first: number (mono), project name, client name, balance (mono, right), and a flag "{d} days past due" in `#B42318` with warning icon when d > 0, else "Due {Mon D}".

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Date line | today in `firms.timezone` | `EEEE, MMMM d, yyyy`, uppercase via CSS |
| Active projects count | count(projects) where `status = active`, not archived, whole firm | |
| Greeting name | `users.first_name` | |
| Greeting period | current hour in `firms.timezone`: 0–11 morning, 12–16 afternoon, 17–23 evening | |
| Board columns | `phase_templates.name` ordered by `sort_order` (+ "Other" column if needed, rule 6) | |
| Card project | `projects.name`, `projects.project_type`, `projects.id` → `/app/projects/<id>` | |
| Card PM avatar | `projects.pm_membership_id` → `users.initials` | Team-page avatar colour rule |
| Card billed % | rule 7 | owner/admin/PM only; omitted from payload for staff |
| Your time week | week containing today, start = `firm_settings.week_starts_on` | |
| Your time hours per day | Σ `time_entries.hours` by `work_date` for my timesheet of that week | 0 if no timesheet |
| Total / capacity | Σ day hours / `memberships.weekly_capacity_hours` | "32.5", "of 40 hours" |
| Billable % | rule 2 | |
| Timesheet status pill | `timesheets.status` (no row → Draft) | Draft grey, Submitted blue, Approved green, Rejected orange |
| Approval rows | rule 5 | |
| Invoice totals / aging / list | `invoices` with `status in (sent, partially_paid)`; balance = `total_cents − amount_paid_cents`; days past due = today − `due_date` | rule 8 |
| Invoice client / project | `invoices.client_company_id` → `companies.name`; `invoices.project_id` → `projects.name` | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Log time | navigate `/app/time` | | all |
| New project | navigate `/app/projects/new` | | owner, admin, PM |
| Mine / All firm toggle | switches board scope; choice remembered in `localStorage` key `architrac.home.projectsScope` (wrapped in try/catch; default Mine) | | owner, admin |
| Click project card | navigate `/app/projects/<id>` | | all |
| Open timesheet | navigate `/app/time/week/<week_start>` | | all |
| Click approval row | navigate `/app/time/approvals/<timesheetId>` (approving happens on the approval screen, not here) | | owner, admin, PM |
| Click invoice row | navigate `/app/invoices/<id>` | | owner, admin |

Home is read-only: no writes, no `activity_log` entries.

## Business rules
1. **My projects scope.** "Mine" = projects with `status in (active, on_hold)`, not archived, where the user's membership is `principal_membership_id`, `pm_membership_id`, or has a `project_members` row. "All firm" = all projects with those statuses. On-hold cards show an "On hold" grey tag under the name. `pursuit` and `closed` are excluded. Within a column, sort by `projects.number` ascending.
2. **Billable %** (Your time) = Σ hours where `billable = true` and `project_id is not null` ÷ Σ all hours for the week, rounded half-up to whole %; "—" when total = 0. Example (mockup): Mon 8, Tue 7.5, Wed 8, Thu 6, Fri 3 = 32.5 h, of which 28 billable → 28 / 32.5 = 86.15% → "32.5 of 40 hours · 86% billable".
3. **Status message** (Your time): Draft → "Not submitted · due {lock day, Mon D}" where the due date is the first `firm_settings.timesheet_lock_day` after the week ends (TMG: Monday → "due Mon Oct 19"); Submitted → "Submitted · waiting on review"; Approved → "Approved"; Rejected → "Returned: {rejection_note}" in `#9A3412`.
4. **Last-week banner:** if the previous week's timesheet is missing, `draft` or `rejected` and today is after its due date, show orange banner "Week of {Mon D} isn't submitted" (or "was returned") with link to `/app/time/week/<prev week_start>`.
5. **Awaiting your approval** = exactly the queue rows of `timesheet-approval.md` — timesheets with "my lines" (the "Ready for you" KPI and Approvals tab count). Home calls the same shared server function, `listTimesheetsAwaitingMe(membershipId)` in `src/lib/approvals/`; it must **not** re-implement routing. In summary (the approval spec's "my lines" definition is authoritative): PM → `submitted` timesheets, not their own, with unapproved entries on projects they run; owner/admin → those with unapproved overhead/leave entries or entries no PM can approve. "{h} h for you" = Σ hours of my lines. Sort by `week_start` ascending, then last name. If Blake chooses the mockup's two-step route instead (Open question 1), only the shared function changes. With nothing waiting, the card shows the empty state.
6. **Board column for a project** = its "current phase": the `project_phases` row with `status = current` and lowest `sort_order`; if none, the lowest-`sort_order` `upcoming` phase; if none, the highest-`sort_order` phase. Place the card in the column whose `phase_templates.code` equals the phase `code`; if no template matches, an "Other" column is appended at the end (hidden when empty). Empty template columns still render with count 0.
7. **Billed %** (card) = Σ `invoice_lines.amount_cents` on the project's invoices with `status not in (draft, void)` ÷ Σ `project_phases.fee_cents` for the project, × 100, rounded down to whole %, capped at 100. Fee total 0 → hide bar, show "No fee set". Example: Medical Office Building fee $186,000, billed lines $37,200 → 20% billed.
8. **Invoices outstanding:** total = Σ balance over open invoices; "over 60 days" counts invoices with days past due > 60. Aging buckets by days past due d: Current (d ≤ 0), 1–30, 31–60, 61+. Example: invoice 2026-118, Coastal Credit Union Branch, due 2026-08-17, balance $19,000; on 2026-10-18 d = 62 → counts in 61+ and "over 60 days", list flag "62 days past due". Use `src/lib/calc/` `invoiceBalance`, `daysPastDue`, `agingBuckets` (pure, unit-tested); money formatted `$184,250`.
9. All widget queries run in parallel in the server component; each widget renders independently (one failing widget shows its own error, the others still render).
10. Invoice data is queried only when the user is owner/admin; for other roles the server never runs or returns it. Billed % is omitted from the payload for staff.

## States
- **Empty — My projects:** "You're not on any active projects yet." (owner/admin get link "Show all firm projects"). With All firm and zero projects: "No active projects. Create your first project." + `New project`.
- **Empty — Your time:** no timesheet this week → 0 hours, all bars 0 height, status "Not started · due {date}".
- **Empty — Awaiting approval:** "Nothing waiting on you." with green check (card is never shown to staff).
- **Empty — Invoices outstanding:** "$0 · No open invoices."
- **Loading:** each widget shows its own skeleton (board: 7 grey columns with 2 card skeletons; cards: grey blocks) via `Suspense` per widget.
- **Error:** per-widget inline message "Couldn't load {widget}." + `Retry` (re-fetches that widget only).
- **Permission denied:** n/a — every signed-in member can view Home; role-restricted widgets are simply not rendered.

## Out of scope (for this release)
| Mockup widget / control | Release | Why |
|---|---|---|
| Firm health strip — Receivables tile | 2 | KPI strip ships with Reports/snapshot; R1 shows receivables inside Invoices outstanding |
| Firm health — Payables tile | 2 | needs `vendor_bills` (Accounting) |
| Firm health — Unbilled work tile | 2 | needs the snapshot's earned-vs-billed calculation and expenses |
| Firm health — Utilization tile (firm-wide) | 2 | belongs to Reports; per-person utilization is on Team in R1 |
| Firm health — Proposals out tile | 3 | needs `proposals` (Marketing) |
| Receivables vs. payables chart/table (12 weekly snapshots) | 2 | needs AP data and weekly AR snapshots |
| Due this week (cross-module list): Build RFIs/submittals | 4 | `rfis`, `submittals` |
| Due this week: Schedule items (e.g. MEP kickoff) | 3 | `tasks` |
| Due this week: Marketing proposal follow-ups | 3 | `proposals`, `leads` |
| Due this week: Accounting invoice follow-ups | 2 | follow-up reminders; R1 shows past-due invoices in Invoices outstanding |
| Due this week: "Submit timesheet" | 1 (covered) | replaced by Your time status + last-week banner |
| Drag a card to move a project to another phase | later / open question | phase status changes happen on the Project page in R1 |
| Card "kind" line (Tenant upfit / Ground-up / Shell) | needs field | see Open questions |
| `New document` button | 2 | `documents` |
| Top-bar "Search everything" | 2 | global search across modules |
| Notifications bell | 2 | no notifications table yet |

## Acceptance tests
- [ ] Given today is 2026-10-18 15:00 America/New_York and the user is Blake, when `/app` loads, then the H1 reads "Good afternoon, Blake" and the eyebrow reads "SUNDAY, OCTOBER 18, 2026 · 10 ACTIVE PROJECTS".
- [ ] Given the same time at 09:00, then the greeting is "Good morning"; at 18:00, "Good evening".
- [ ] Given a staff user, then `+ New project` is not rendered, the Invoices outstanding card is absent, project cards have no billed bar, and the page payload contains no invoice amounts or billed %.
- [ ] Given JR is PM on Medical Office Building (current phase DD), Northside Self-Storage (CA) and Riverside Retail Shell (PD), when JR opens Home, then exactly those 3 cards appear in the Design Development, Construction Admin and Pre-Design columns.
- [ ] Given an owner toggles to "All firm", then all 10 active/on-hold projects appear; when the page is reloaded, then "All firm" is still selected.
- [ ] Given a project with phases PD complete, SD current, DD upcoming, then its card is in the Schematic Design column.
- [ ] Given a project with no `current` phase and SD as the lowest `upcoming`, then its card is in Schematic Design.
- [ ] Given a closed or pursuit project the user is PM on, then it does not appear.
- [ ] Given MOB phase fees total $186,000 and its sent/paid invoice lines total $37,200, then the card shows "20% billed"; given a draft invoice of $10,000, then it does not change.
- [ ] Given Blake's week of 2026-10-12 has hours 8, 7.5, 8, 6, 3 with 28 billable, then Your time shows "32.5", "of 40 hours · 86% billable", five bars, and no Sat/Sun bars.
- [ ] Given 4 hours logged on Saturday, then a Sat bar appears.
- [ ] Given the current timesheet is draft and lock day is Monday, then the status reads "Not submitted · due Mon Oct 19".
- [ ] Given the timesheet is rejected with note "Split CA hours by phase", then the status reads "Returned: Split CA hours by phase" in orange.
- [ ] Given last week's timesheet is still draft after its due date, then the orange banner links to that week.
- [ ] Given JR is PM on Medical Office Building and DS submitted week of Oct 12 with 30 h on MOB and 10 h on another project, then JR's approval card lists DS with "40" total and "30 h for you"; JR's own submitted timesheet is not listed for JR.
- [ ] Given any approver, then the card's count equals the "Ready for you" count on `/app/time/approvals`, and the user's own timesheet never appears.
- [ ] Given another approver already approved part of KL's timesheet, then KL's row shows the "Partly approved" pill; when all of KL's entries are approved, then KL is no longer listed.
- [ ] Given a staff user, then the Awaiting your approval card is not rendered and no approval query is executed.
- [ ] Given open invoices of $19,000 (due 2026-08-17) and $11,160 (due 2026-10-30), on 2026-10-18, then total shows "$30,160", "2 open invoices · 1 over 60 days", 61+ bucket "$19,000", Current "$11,160", and the first list row is 2026-118 flagged "62 days past due".
- [ ] Given a `paid`, `void`, `draft` or `written_off` invoice, then it is excluded from Invoices outstanding.
- [ ] Given the invoices query throws, then only the Invoices outstanding card shows "Couldn't load" with Retry and the other widgets render normally.
- [ ] Given a user of firm B, then no projects, timesheets or invoices of firm A appear in any widget.

## Open questions
1. **Approval model conflict (decide once, for Time, Team and Home):** the mockup (Time and Team screens) routes each timesheet to the person's team leader, then a principal; `timesheet.md` follows the brief "PMs approve their projects, admins approve all" with per-entry approval. This spec defers to `listTimesheetsAwaitingMe` either way. If the two-step route is chosen: **Data model addition needed:** `leader_approved` in enum `timesheet_status` + `timesheets.leader_approved_at/by`, and `memberships.is_principal` (see Team spec).
2. **Data model addition needed (owned by the timesheet/approval specs):** per-entry approval fields on `time_entries` (e.g. `approved_at`, `approved_by`) that `timesheet.md` already relies on; Home's "{h} h for you" and "Partly approved" need them.
3. **Data model addition needed:** `projects.scope_kind` enum (`ground_up`, `tenant_upfit`, `shell_building`, `other`), same as `projects-list.md`, for the card's "Tenant upfit · Medical" line. Without it the card shows only `project_type`.
4. Route prefix: this spec, `invoicing.md` and `timesheet.md` use `/app/...`; `projects-list.md` uses `/projects`. Pick one and align all specs (links here assume `/app/projects/<id>`).
5. Should drag-to-change-phase on the board come back in a later release, and what should it do (mark the old phase complete and the new one current)?
6. Should PMs see an "Invoices outstanding" card limited to their own projects?
7. Should the board also show `pursuit` projects (in a "Pursuit" column) once Marketing (Release 3) exists?
