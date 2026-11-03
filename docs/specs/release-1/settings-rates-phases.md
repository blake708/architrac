# Spec: Settings — Phases & fees, Roles & rates, Overhead, Timesheet phases & activities

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app/settings/phases`, `/app/settings/rates`, `/app/settings/time` |
| **Mockup** | `mockup/Settings.dc.html` — sections `phases`, `rates` (incl. Overhead rate card), `time` (only the "Timesheet phases & activities" card). JS: `PH`, `ROLES`, `rateKpis`, `oh`, `TS`. Timesheet use of these lists: `mockup/Time.dc.html` (`OPTIONS`, `PHASES`, `ACTS`). |
| **Status** | Built (1.1) |

## Purpose
Owners and admins set the firm's standard project phases and fee split, each billing role's bill and cost rate (effective-dated), the overhead rate used for true profit, and the overhead phases, activities and leave types people pick on timesheets. Time, Accounting, Reports and project profit all read from these.

## Who can see it
| Role | Access |
|---|---|
| Owner | View and edit all three sections |
| Admin | View and edit all three sections |
| Project manager | none — `<AccessDenied>`; server never returns cost rates or overhead to this role |
| Staff | none — `<AccessDenied>` |
| Client (portal) | none |

## Layout
Uses the Settings frame from `release-0/settings-firm.md` (page-header band with Unsaved/Saved/Save changes, section nav, Main). Release 1 adds the **Work** group to the section nav between Firm and Account:

| Group | Section | Route | Eyebrow | Title | Description (exact copy) |
|---|---|---|---|---|---|
| Work | Phases & fees | `/app/settings/phases` | WORK | Phases & fees | The phases every new project starts with and how the fee splits across them. |
| Work | Roles & rates | `/app/settings/rates` | WORK | Roles & rates | Each role's bill rate (what clients pay on hourly work) and cost rate (salary plus burden), plus the firm's overhead rate. Used by Time, Accounting, Reports and project profit. |
| Work | Time & approvals | `/app/settings/time` | WORK | Time & approvals | When timesheets are due, how hours are entered, and who approves them. |

Each section is one form with one Save changes (all-or-nothing, one DB transaction). **Changed 2026-11-02 (Blake): instant saving.** Phases & fees keeps Save changes (shares must total 100%). Roles & rates keeps it for the rates table (each change needs an effective date); the overhead rate, the include-overhead switch and "Use {calc}%" save straight away. Time & approvals has no Save button: every add, remove and rename saves straight away.

**A. Phases & fees** — column, gap 16px, max-width 960px. Two white cards (`overflow-x:auto`) saved by the one Save changes:

1. **Default phases** card:
   - Title row: H2 "Default phases & fee split" (13px/600 uppercase) + hint "New projects and proposals start with these. Each can be changed per project."
   - Table (`min-width:720px`), header 11px `#666666` on `#FAFAFA`. Columns: **Phase** (text input, 500), **Abbrev.** (text input, IBM Plex Mono 12.5px, 72px), **% of fee** (number input 60×32, right-aligned, `min 0 max 100 step 1`, "%" suffix, visually-hidden label "{name} percent of fee"), **Share** (180×8px track `#EBEBEB`, fill `#2F5BAA`), **Order** (▲/▼ icon buttons, `aria-label="Move {name} up|down"`), **Remove** (text button `#B42318`).
   - **(not in mockup)** Under each phase row, a full-width description line (no top border, padding 0 12px 10px): auto-growing textarea (min 1 line, 13px, `#4D4D4D`, placeholder "Default description (optional)", visually-hidden label "{name} description"). Copied to the project's phase when a project is created; editable per project.
   - Total row (600): "Total" · `{sum}%` (Plex Mono 13px) · note. Color `#1D6234` when sum = 100, else `#9A3412`. Optional phases are not counted.
   - Under the table: "+ Add phase" button (32px, border `#D4D4D4`) adds an empty row at the end with focus on its name.
2. **(not in mockup) Optional phases** card:
   - Title row: H2 "Optional phases" + hint "Phases only some projects need, like interiors or as-built surveys. They aren't added to new projects automatically. Add one from a project's Phases & fees, and set its fee there."
   - Table (`min-width:720px`), same header style. Columns: **Phase**, **Abbrev.** (as above), **Fee type** (select 120×32: Fixed / Hourly / Not to exceed, visually-hidden label "{name} fee type"), **Order** (▲/▼), **Remove**. Same description line under each row. No % or Share column.
   - Empty: "No optional phases yet." (13px `#666666`, padding 16px 20px).
   - Under the table: "+ Add optional phase" button (same style).

**B. Roles & rates** — column, gap 16px, max-width 1040px:
1. **KPI strip** (white card, grid `repeat(auto-fit, minmax(200px,1fr))`, cells padding 16px 20px 18px, right border `#EBEBEB`): label (11px/600 uppercase), value (22px/500, tabular numbers), note (12.5px `#666666`). Four tiles in order: Blended bill rate, Avg. multiplier, Roles flagged, Breakeven (formulas in Business rules 3–6).
2. **Roles & hourly rates** card (`overflow-x:auto`, table `min-width:820px`). Title "Roles & hourly rates" + hint "Bill rate is what clients pay on hourly work. Cost rate is salary plus burden, used for profit and P&L. Changes apply to time logged from the effective date." Columns:
   - **Role**: name (500) with description under it (12px `#666666`).
   - **People** (right, Plex Mono 12.5px).
   - **Bill rate / h** (right): "$" + number input 70×32 `min 0 step 5`, visually-hidden label "{role} bill rate". For non-billable roles: text "Not billable" (12.5px `#666666`).
   - **Cost rate / h** (right): "$" + number input 70×32 `min 0 step 1`, label "{role} cost rate".
   - **Multiplier** (right): pill 24px, Plex Mono 12.5px/600 — flagged: bg `#FCE7DF` text `#9A3412`; ok: bg `#E2F1E6` text `#1D6234`; none: "—" `#666666`.
   - **Effective** (Plex Mono 12.5px `#4D4D4D`): current rate's `effective_from`, "Jan 1, 2026". It is a button that opens a popover listing that role's rate history (from, to, bill, cost), newest first.
   - **⋯** menu: Edit role, Archive role.
   - Footer (padding 12px 20px 16px): hint "Multipliers under 2.5× are flagged. Most firms target 2.8–3.2× on billable roles to cover overhead and profit. People are assigned a role on the Team page." ("Team" links to `/app/team`) and right-aligned "+ Add role" button.
3. **Overhead rate** card (padding 18px 20px 20px). Title "Overhead rate" + hint "The office costs that aren't billed to any project: rent, software, insurance, admin staff, marketing time. Used to show true profit on projects and in Reports." Two columns (`flex-wrap`, gap 24px):
   - Left (`flex:1 1 280px`): field "Overhead rate": number input 96px (`min 0 max 300 step 1`, Plex Mono, right-aligned) + "% of labor cost"; hint "For every $1 spent on project labor, the firm spends {perDollar} on overhead." Then two stat boxes (bg `#FAFAFA`, border `#EBEBEB`, 18px/600 Plex Mono value): "Breakeven multiplier" / `{breakeven}` / "Bill rate ÷ cost rate below this loses money"; "Example · Designer" / `{example} / h` / "{cost} labor + {overhead} overhead = true cost of an hour". Then **(not in mockup)** a switch row: "Include overhead in project profit by default" / hint "Project snapshots start with overhead included. People can switch it off for their view." bound to `include_overhead_default`.
   - Right (`flex:1 1 320px`, dashed border `#C4C4C4`): label "Work it out from last year"; two inputs "Overhead expenses" and "Labor cost on projects" (Plex Mono, money format, empty by default); line "{exp} ÷ {labor} = **{calc}%**"; button "Use {calc}%" (32px, `#141414`, white) — disabled until both inputs > 0. Hint "Your accountant's profit & loss statement has both numbers. Count only time billed to projects as labor; admin and marketing time is overhead. With QuickBooks connected, ArchiTrac fills these in."

**C. Time & approvals** — this spec covers only the card **"Timesheet phases & activities"** (white, padding 20px 24px 24px, max-width 960px). Intro hint: "Every timesheet row needs a phase and an activity. Project phases come from each project's Phases & fees. Overhead phases, their activities and leave types are set here, so they match how your firm works." Three blocks separated by 1px `#EBEBEB` rules:
1. **Project activities** — label + hint "Used on every project, in any phase". Chips + add control.
2. **Overhead phases** — label + hint "Non-billable time. Each phase has its own activities, and the timesheet only shows the activities for the phase picked." One row per phase (grid `minmax(180px,230px) 1fr auto`, padding 12px 14px, border `#EBEBEB`, bg `#FCFCFC`): name input (32px, 600, visually-hidden label "Overhead phase name") with "{n} activities" under it; its activity chips + add control; "Remove" button (`#B42318`, `aria-label="Remove overhead phase {name}"`). Below all rows: add control with placeholder "New overhead phase…".
3. **Leave types** — label + hint "Shown under PTO. Holidays are set by the firm calendar." Chips + add control.

**Chip** (`<Chip removable>`): 28px, padding 0 4px 0 10px, border `#DCDCDC`, bg `#FAFAFA`, 13px; × button 22px, `aria-label="Remove {label}"` or "Remove {label} from {phase}". **Add control**: input 170×28 dashed border `#AFAFAF` with placeholder ("New activity…", "New leave type…", "New overhead phase…") and visually-hidden label, plus "Add" button (28px, `#141414`, white, 12.5px/600). Enter in the input = Add.

The mockup's other two cards in this section ("Timesheets" rules and "Approval route") are not part of this spec.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Default phase rows | `phase_templates` (`name`, `code`, `description`, `default_fee_share_bp`, `sort_order`) where `is_optional = false` and `archived_at is null` | % = `default_fee_share_bp / 100` |
| Optional phase rows | `phase_templates` (`name`, `code`, `description`, `default_fee_type`, `sort_order`) where `is_optional = true` and `archived_at is null` | `description`, `is_optional` are additions |
| Share bar width | `min(100, pct / 40 × 100)%` | 40% fills the bar (mockup) |
| Role rows | `firm_roles` where `archived_at is null` order by `sort_order` | description, is_billable are additions |
| People | `count(memberships) where firm_role_id = role.id and active` | |
| Bill / cost rate | current `rates` row: `firm_role_id = role.id`, `membership_id is null`, `effective_from <= today` and (`effective_to is null` or `>= today`) | cents ÷ 100, whole dollars in inputs |
| Effective | that row's `effective_from` | "MMM D, YYYY" |
| Multiplier | `bill_rate_cents / cost_rate_cents` | 2 decimals + "×"; "—" if either is 0 |
| Overhead rate | `firm_settings.overhead_rate_bp / 100` | whole % |
| Include overhead switch | `firm_settings.include_overhead_default` | |
| Project activities | `activities` where `applies_to = 'project'` and `active` order by `sort_order` | |
| Overhead phases | `overhead_categories` where `is_leave = false` and `active` order by `sort_order` | |
| Overhead activities | `activities` where `applies_to = 'overhead'` and `overhead_category_id = cat.id` and `active` | |
| Leave types | `activities` where `overhead_category_id` = the leave category with `code = 'PTO'` and `active` | `code` is an addition |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Edit phase name / abbrev / % / description | Form dirty; total and bars update live | name 1–60; code 1–6, `^[A-Z0-9-]+$` (input upper-cases); codes and names unique (case-insensitive) across default **and** optional phases; % integer 0–100; description trimmed, 0–500 chars (empty → null) | owner, admin |
| Edit optional phase fee type | Form dirty | `fixed`, `hourly`, `nte` | owner, admin |
| Move phase up/down | Swap order within its own list; dirty | — | owner, admin |
| Add phase / Add optional phase | New row at end of that list; dirty | as above | owner, admin |
| Remove phase | Row removed from form; on save `archived_at = now()` | at least 1 default phase must remain; optional list may be empty | owner, admin |
| Save (Phases) | Upsert `phase_templates`: default rows `is_optional = false`, `default_fee_share_bp = pct × 100`, new rows `default_fee_type 'fixed'`; optional rows `is_optional = true`, `default_fee_share_bp = 0`, `default_fee_type` from the select; `sort_order` = row index within its list; archive removed; `activity_log` per changed row | Σ % of default phases must equal 100 → else "Phase shares must add up to 100%. Now {sum}%." | owner, admin |
| Edit bill/cost rate | Form dirty; multiplier, KPIs, Designer example update live | integers 0–9,999; billable role bill rate ≥ 1 | owner, admin |
| Save (Rates) with rate changes | Dialog "Apply new rates from" date (default today in firm time zone) listing each changed role "Designer: $115 → $120 bill". Confirm → rule 8 | date ≥ each changed role's current `effective_from` → else "Pick {date} or later — {role}'s current rate starts then." | owner, admin |
| Save overhead (instant) | When the Overhead rate field is left (or Enter), the switch flips, or "Use {calc}%" is clicked: update `firm_settings.overhead_rate_bp`, `include_overhead_default`; `activity_log`. Unsaved rate edits in the table are not sent | rate integer 0–300 | owner, admin |
| Add role | Dialog: Name, Description, Billable (checkbox, on), Bill rate $ (hidden if not billable), Cost rate $, Effective from (default Jan 1 of current year). Saves immediately: insert `firm_roles` (`sort_order` = max+1) + `rates` row. | name 1–60 unique (case-insensitive, non-archived); cost ≥ 0; bill ≥ 1 if billable | owner, admin |
| Edit role | Dialog: Name, Description, Billable. Saves immediately. Turning Billable off sets future bill rate 0 via a new rates row from today. | as Add | owner, admin |
| Archive role | Sets `archived_at`. | blocked if People > 0: "Move the {n} people in {role} to another role on the Team page first." | owner, admin |
| Rate history | Popover list from `rates` for the role | — | owner, admin |
| Type in calculator / Use {calc}% | Sets the Overhead rate to calc and saves it. Calculator inputs are never saved. | both > 0 | owner, admin |
| Add / remove activity chip, add / rename / remove overhead phase, add / remove leave type | Saves straight away (renames when the name field is left). A new overhead phase waits, with the hint "Add an activity to save this phase.", until it has its first activity. Removing the last project activity, last leave type, or last activity of a saved overhead phase is refused with a message | rule 11 | owner, admin |
| Save (Time) | Runs after each change: one transaction applying the lists; `activity_log` per created/updated/archived row | rule 11 | owner, admin |

## Business rules
1. All money math in `src/lib/calc/rates.ts` (pure, unit-tested); inputs in cents/bp, output cents/bp or display ratio.
2. **Multiplier** `m = bill_rate_cents / cost_rate_cents` (0 if either is 0). Flag when `0 < m < 2.5` (constant `MULTIPLIER_FLAG = 2.5`). Seed: Principal 18500/9500 = **1.95×** flagged; Project manager 15000/6200 = **2.42×** flagged; Project architect 14500/5800 = **2.50×** ok; Designer 11500/4400 = **2.61×** ok; Interior designer 12000/5200 = **2.31×** flagged; Intern 7500/2400 = **3.13×** ok (3.125 rounds half up); Office manager, Bookkeeper "—".
3. **Blended bill rate** = `round(Σ(bill_cents × people) / Σ people)` over roles with bill > 0, cost > 0 and people > 0; show `$` + whole dollars + " / h"; "—" if Σ people = 0. Seed: (18500×1 + 15000×1 + 14500×2 + 11500×6 + 12000×1 + 7500×1) / 12 = 151,000 / 12 = 12,583 cents → **"$126 / h"**, note "Average across billable staff".
4. **Avg. multiplier** = `Σ(m × people) / Σ people` over the same roles, 2 decimals. Seed: (1.9474 + 2.4194 + 2×2.5 + 6×2.6136 + 2.3077 + 3.125) / 12 = **"2.54×"**, note "Bill rate ÷ cost rate".
5. **Roles flagged** = number of roles (not people) flagged by rule 2. Seed: **3**, note "Multiplier under 2.5×" (or "All roles at 2.5× or higher" when 0).
6. **Breakeven** = `1 + overhead_rate_bp / 10000`, 2 decimals + "×". Seed 6000 → **"1.60×"**, KPI note "Covers labor + 60% overhead, no profit". Per-dollar hint = `overhead_rate_bp / 10000` as money → "$0.60".
7. **Designer example** uses the role named "Designer" (else the first billable role by sort order; label changes to "Example · {role}"): `true_cost = round(cost_cents × (10000 + overhead_bp) / 10000)`; `overhead_part = true_cost − cost_cents`. Seed: 4400 × 16000 / 10000 = 7040 → **"$70.40 / h"**, note "$44 labor + $26.40 overhead = true cost of an hour".
8. **Effective-dated rate change** for role R with new values from date D:
   - Let C be R's current row. If `D = C.effective_from` → update C in place.
   - If `D > C.effective_from` → set `C.effective_to = D − 1 day`, insert new row (`effective_from = D`, `effective_to = null`).
   - If `D < C.effective_from` → reject (see validation).
   - Rows for one role never overlap (DB exclusion constraint or check in the action + test).
   - Time entries already **approved** keep their frozen `bill_rate_cents` / `cost_rate_cents`; unapproved entries dated ≥ D pick up the new rate when approved (rate lookup rule in DATA_MODEL).
   - Example: Designer bill $115 since 2026-01-01; change to $120 from 2026-11-01 → old row `effective_to = 2026-10-31`, new row 12000/4400 from 2026-11-01; Effective column shows "Nov 1, 2026" from that day, and "Jan 1, 2026" until then.
   - Non-billable roles store `bill_rate_cents = 0`.
9. **Overhead from actuals**: `calc_pct = round(expenses / labor × 100)` (integer %); "Use" sets `overhead_rate_bp = calc_pct × 100`. Example: $612,000 ÷ $1,020,000 = 0.60 → **60%** → 6000. Labor 0 → calc shows "—" and button disabled.
10. **Phase share total** = Σ pct. Note: 100 → "Adds up to the full fee"; < 100 → "{100 − sum}% of the fee is unassigned"; > 100 → "{sum − 100}% over the full fee". Seed: 5+15+25+35+5+15+0 = 100. Example: CD changed to 30 → total 95, "5% of the fee is unassigned", Save blocked (Open Decision #7: block). Optional phases are never in the total. Template changes never alter existing projects' `project_phases` (they were copied at creation).
10a. **Optional phases and descriptions** (added by Blake, 2026-11-02):
    - New projects (projects-list spec) copy only default phases (`is_optional = false`). Optional phases are offered in the project's "Add phase" dialog (project-detail spec), which prefills code, name, description and fee type from the template; the fee is entered there.
    - A phase's `description` is copied to `project_phases.description` when the phase is created on a project, and is editable per project after that. Editing the template never changes existing projects.
    - `default_fee_share_bp` is always 0 for optional phases (check constraint).
    - Moving a phase between the default and optional lists is out of scope; remove it from one list and add it to the other.
11. **Timesheet lists**:
    - Names are trimmed, 1–60 chars. Adding a duplicate (case-insensitive) within the same list shows "Already in the list" under the input and adds nothing. Empty input → Add does nothing.
    - Removing a chip or overhead phase sets `active = false` (never deleted); existing `time_entries` keep their reference and still appear in reports under that name.
    - Adding a name that matches an inactive row in the same list reactivates that row (same id) instead of inserting.
    - Renaming an overhead phase updates `overhead_categories.name`; past entries show the new name.
    - `sort_order` = position in the list at save; new items append at the end.
    - Save is blocked if any list would be empty: Project activities, Leave types, or any overhead phase with 0 activities → "Add at least one activity to {phase}, or remove it." Overhead phase names must be unique and non-empty.
    - Removing an overhead phase that has logged time asks first: "{hours} h are logged to {name}. They stay in reports, but no one can pick {name} on new timesheets."
    - Leave types are activities under the `PTO` leave category. The `HOL` (Holiday) category and its "Holiday" activity are seeded and not editable here.
    - On the timesheet the "project" picker lists projects, then `OH · Overhead`, `PTO · Paid time off`, `HOL · Holiday` (Time spec).
12. Every write goes through `src/db/tenant.ts`; every action calls `requireRole(['owner','admin'])`; cost rates and overhead are never sent to other roles.

## Seed values
TMG seed (from mockup JS). All rates `effective_from = 2026-01-01`, `effective_to = null`, `membership_id = null`.

**firm_roles + rates** (`ROLES`)
| sort | name | description | is_billable | bill_rate_cents | cost_rate_cents | people (TMG) |
|---|---|---|---|---|---|---|
| 1 | Principal | Owners and partners | true | 18500 | 9500 | 1 (BM) |
| 2 | Project manager | Runs projects and leads a team | true | 15000 | 6200 | 1 (JR) |
| 3 | Project architect | Licensed, technical lead | true | 14500 | 5800 | 2 (TC, SG) |
| 4 | Designer | Production and design | true | 11500 | 4400 | 6 (KL, DS, LP, RH, CF, NB) |
| 5 | Interior designer | Finishes, FF&E | true | 12000 | 5200 | 1 (AP) |
| 6 | Intern | Part-time | true | 7500 | 2400 | 1 (EW) |
| 7 | Office manager | Overhead | false | 0 | 3800 | 1 (MW) |
| 8 | Bookkeeper | Overhead · part-time | false | 0 | 4000 | 1 (OK) |

**firm_settings**: `overhead_rate_bp = 6000`, `include_overhead_default = true`. Calculator test inputs (not stored): expenses $612,000, labor $1,020,000.

**phase_templates** (`PH`; `default_fee_type = 'fixed'` for all)
| sort | code | name | default_fee_share_bp | checklist items (mockup, not seeded) |
|---|---|---|---|---|
| 1 | PD | Pre-Design | 500 | 6 |
| 2 | SD | Schematic Design | 1500 | 8 |
| 3 | DD | Design Development | 2500 | 6 |
| 4 | CD | Construction Documents | 3500 | 12 |
| 5 | PRM | Permitting | 500 | 5 |
| 6 | CA | Construction Admin | 1500 | 9 |
| 7 | CO | Close Out | 0 | 7 |

All seeded default phases have `description = null` and `is_optional = false`. No optional phases are seeded; the firm adds its own.

**activities — project** (`TS.project`, in order): Design · Drawings & production · Coordination · Meetings · Code & research · Specifications · Project management · QA/QC review · Permit & agency review · Site visit · Submittals & RFIs · Pay app review · Travel (13).

**overhead_categories (`is_leave = false`) and their activities** (`TS.overhead`)
| sort | name | activities (in order) |
|---|---|---|
| 1 | Marketing | Proposals · Client development · Website & social · Interviews & presentations |
| 2 | Administration | Admin & IT · Accounting & billing · Office management |
| 3 | Professional development | Training & CE · Licensing exams · Conferences |
| 4 | Firm standards | Standards & templates · Revit library · Knowledgebase |

**overhead_categories (`is_leave = true`)** (`Time.dc.html` `OPTIONS`/`ACTS`)
| sort | code | name | activities |
|---|---|---|---|
| 10 | PTO | Paid time off | Vacation · Sick · Personal (= `TS.leave`) |
| 11 | HOL | Holiday | Holiday |

## States
- **Empty state:** a new firm (no seed) gets the phase templates, project activities, overhead categories and leave categories above as defaults, plus no roles. Roles table empty → "No roles yet. Add the roles your firm bills by." with "+ Add role"; KPIs show "—".
- **Loading state:** section skeleton (KPI strip and table rows as grey bars); Save shows "Saving…".
- **Error state:** validation errors inline next to the field or list (`#B42318`, 12.5px) plus a summary banner "Fix the highlighted items, then save." Server failure: "Couldn't save. Nothing was changed." The transaction rolls back.
- **Permission-denied state:** PM/staff → `<AccessDenied>`; direct server-action calls return 403 and write nothing.

## Out of scope (for this release)
- Phase checklist items (mockup "{n} items" links) — needs a checklist table; later release.
- Per-person rate overrides (`rates.membership_id`) — Release 1 Team spec.
- Drag-to-reorder roles — later; new roles append.
- "Timesheets" rules card (week starts, due, increment, reminder) and "Approval route" card with its 4 toggles — separate Release 1 Time & approvals spec.
- QuickBooks auto-fill of the overhead calculator — Release 2.
- Firm holiday calendar — later.

## Acceptance tests

Tests: `src/lib/calc/rates.test.ts`, `src/lib/settings/work-settings.test.ts`, `src/server/settings/work-settings.db.test.ts`, `src/db/tenant.db.test.ts`, `tests/e2e/settings-work.spec.ts`.
- [x] Given the TMG seed, when I open `/app/settings/rates`, then the KPIs read "$126 / h", "2.54×", "3", "1.60×".
- [x] Given the TMG seed, then Principal shows multiplier "1.95×" on an orange pill, Project architect "2.50×" on a green pill, and Office manager shows "Not billable" and "—".
- [x] Given I change Designer cost from 44 to 40, then without saving the Designer multiplier shows "2.88×" and the Designer example shows "$64.00 / h".
- [x] Given I change Designer bill to 120 and save with effective date 2026-11-01, then the 2026-01-01 Designer row has `effective_to = 2026-10-31`, a new row has `bill_rate_cents = 12000`, `cost_rate_cents = 4400`, `effective_from = 2026-11-01`, and an `activity_log` row exists.
- [x] Given Designer's current rate starts 2026-01-01, when I save a change with effective date 2025-12-15, then I see "Pick Jan 1, 2026 or later — Designer's current rate starts then." and nothing is written.
- [x] Given I change a rate and pick the effective date equal to the current row's `effective_from`, then that row is updated and no new row is inserted.
- [ ] Given a Designer time entry approved at $115 before the change, when the rate changes to $120 from 2026-11-01, then that entry's `bill_rate_cents` is still 11500. *(Test in 1.6/1.7 — needs time entries; see open question 11.)*
- [x] Given I enter overhead expenses 612000 and labor 1020000, then the line reads "$612,000 ÷ $1,020,000 = 60%", and clicking "Use 60%" sets the Overhead rate to 60 and saves it.
- [x] Given I set the Overhead rate to 75 and save, then `firm_settings.overhead_rate_bp = 7500` and Breakeven shows "1.75×".
- [x] Given I turn off "Include overhead in project profit by default" and save, then `include_overhead_default = false`.
- [x] Given I add role "Senior designer" (billable, $130 bill, $50 cost, from Jan 1, 2026), then it appears last with multiplier "2.60×" and People 0.
- [x] Given Designer has 6 people, when I choose Archive role, then I see "Move the 6 people in Designer to another role on the Team page first." and it is not archived.
- [x] Given the seed phases, then the total reads "100%" in green with "Adds up to the full fee".
- [x] Given I change CD to 30, then the total reads "95%" with "5% of the fee is unassigned", and Save shows "Phase shares must add up to 100%. Now 95%." and writes nothing.
- [x] Given I rename Permitting's abbreviation to "PRM2" and save, then `phase_templates.code = 'PRM2'` and existing projects' phases are unchanged.
- [x] Given I type "Programming, site analysis and code review" as the Pre-Design description and save, then that `phase_templates.description` is stored, and clearing it and saving stores null.
- [x] Given I add optional phase "INT Interior Design" with fee type Hourly and save, then a `phase_templates` row exists with `is_optional = true`, `default_fee_type = 'hourly'`, `default_fee_share_bp = 0`, and the default total still reads "100%".
- [x] Given optional phase "INT" exists, when I add a default phase with abbreviation "int", then I see an "already used" error on the abbreviation and Save writes nothing.
- [x] Given I remove every optional phase and save, then the save succeeds and the card shows "No optional phases yet."
- [ ] *(Test in 1.4)* Given optional phase "INT" exists, when I create a project, then its phases are the 7 default phases only, each with the template's description.
- [x] Given I type "travel" in New activity and click Add, then I see "Already in the list" and no chip is added.
- [x] Given I add "Punch walk" to Project activities and save, then an `activities` row (`applies_to 'project'`, `sort_order 14`, active) exists.
- [ ] Given I remove "Travel" and save, then its row has `active = false`, it still exists, and time entries that used it still show "Travel" in reports. *(Test in 1.6/1.7 — needs time entries; see open question 11.)*
- [x] Given "Travel" is inactive, when I add "Travel" again and save, then the same row is reactivated (same id).
- [x] Given I add overhead phase "IT" with no activities, then it isn't saved and shows "Add an activity to save this phase."; adding "Help desk" saves both. (Server still refuses a phase with no activities: "Add at least one activity to IT, or remove it.")
- [x] Given I rename overhead phase "Firm standards" to "Standards" and save, then the `overhead_categories` row keeps its id and its name is "Standards".
- [ ] Given Marketing has 12 h logged, when I click Remove on Marketing, then I see "12 h are logged to Marketing…" before it is staged for removal. *(Test in 1.6/1.7 — needs time entries; see open question 11.)*
- [x] Given I add leave type "Bereavement" and save, then an `activities` row under the `PTO` category exists, and the Holiday category is unchanged.
- [x] Given I am a project manager, when I call the rates server action or open `/app/settings/rates`, then I get access denied and no cost rate appears in the response.
- [x] Given firm B, when firm A's admin saves rates, then no firm B `rates` rows change (RLS test).

- [x] *(Added Blake, 2026-11-03)* Given a saved default phase, when I click **Roles**, then a side panel sets its role mix (role, % of the phase fee, the role's bill rate). Shares must add up to exactly 100% (or no roles). It saves right away, and new projects start with that mix; hours = share × fee ÷ the role's bill rate.

## Open questions
1. **Done in 1.1.** *Data model addition needed:* `firm_roles.description text null` (mockup role note) and `firm_roles.is_billable boolean default true` (mockup shows "Not billable"; storing 0 bill rate alone is ambiguous).
2. **Done in 1.1.** *Data model addition needed:* `overhead_categories.code text null`, unique per firm when set (`PTO`, `HOL`), so the app can tell the PTO category (holds leave types) from Holiday. The Time mockup also uses `OH` as the overhead group code (not a row).
3. *Data model addition needed (later):* phase checklist table (mockup counts 6/8/6/12/5/9/7 items) — confirm release.
4. **Done in 1.1** (DATA_MODEL now points to this spec's seed). DATA_MODEL seed notes disagree with the mockup; this spec uses the mockup values. Update DATA_MODEL: phase codes `PRM`/`CO` (not "Permitting"/"Close Out"); 8 roles (not "Principal, Project Architect, Designer, Admin"); overhead categories Marketing / Administration / Professional development / Firm standards (not "Admin, Marketing, Professional development, IT"); leave as PTO + Holiday categories with Vacation/Sick/Personal activities; project activity list of 13.
5. ~~`phase_templates.default_fee_type` is not in the mockup.~~ **Answered (Blake, 2026-11-02):** default phases are all `fixed` and fee type isn't shown for them; optional phases have an editable fee type.
6. ~~Should the 2.5× flag threshold be a firm setting?~~ **Answered:** constant `MULTIPLIER_FLAG = 2.5` for now.
7. ~~Should the overhead calculator inputs be saved?~~ **Answered:** no.
8. ~~Overhead rate decimals?~~ **Answered:** whole percents only.
9. ~~Block save when shares ≠ 100%?~~ **Answered:** yes, block (Open Decision #7).
10. **phase_templates part done in 1.1; project_phases in 1.4.** *Data model addition (Blake, 2026-11-02):* `phase_templates.description text null`, `phase_templates.is_optional boolean not null default false`; `project_phases.description text null` (added in 1.4 when that table is created).
11. Time-entry acceptance tests (approved entry keeps its rate; "12 h are logged to Marketing"; removed "Travel" still shows in reports) can't run until `time_entries` exists. 1.1 builds the hooks (the logged-hours check returns 0 until then); the tests are written in 1.6 / 1.7.
