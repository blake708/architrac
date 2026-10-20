# Spec: Project detail (header, Overview, Phases & fees, Team, Consultants)

| | |
|---|---|
| **Release** | 1 (milestone 1.5) |
| **Route** | `/app/projects/[projectId]` (Overview) · `/app/projects/[projectId]/phases` · `/app/projects/[projectId]/team` · `/app/projects/[projectId]/billing` (Invoices tab, see `invoicing.md`). A shared `[projectId]/layout.tsx` renders the header, stepper and tabs |
| **Mockup** | `mockup/Project.dc.html` |
| **Status** | Draft |

## Purpose
The home page of one project. PMs and principals check where the project stands and keep its phases (fee type, fee, budget hours, status, percent complete), project team and consultants correct. Time, invoices and later the profit snapshot all hang off these phases.

## Who can see it
**Financial view** = owner, admin, or a PM whose membership is `projects.pm_membership_id` or `principal_membership_id` ("own project"). Everyone else who can open the project gets the **basic view**.

| Role | Access |
|---|---|
| Owner | Financial view; edits everything; sees bill-rate overrides |
| Admin | Same as owner |
| Project manager | Opens any project. Own projects: financial view, edits phases/fees/team/consultants (ARCHITECTURE §5 "Edit project phases & fees: own projects"); never sees bill-rate overrides or cost. Other projects: basic view, read-only. |
| Staff | Only projects where they are an active `project_members` row (otherwise 404). Basic view, read-only. |
| Client (portal) | None (portal is Release 2) |

Basic view = header (no health badge), stepper, Overview without fee/billed/hours tiles and without the hours table, Team tab without hours column. Phases & fees tab is not rendered. Server queries for the basic view must not select `fee_cents`, invoice amounts, `bill_rate_override_cents` or consultant fees.

## Layout
App shell (rail: Projects active; TopHeader title "PROJECTS"). Then a white band containing:

1. **Project header** (PageHeader variant)
   - Mono meta line: `2026-014 · MEDICAL OFFICE · 20,000 SF` = `number` · `project_type` (uppercase via CSS) · *scope kind once added* · `square_feet` formatted "20,000 SF" (omit parts that are null).
   - H1 `projects.name`.
   - Sub-line: client company name · `address_line1, city, state` (omit empty parts).
   - Right side:
     - Health Badge (financial view only; rule in `projects-list.md` Rule 3).
     - **Edit project** (secondary; owner/admin/own PM).
     - **New** (primary dropdown) with "Log time" → `/app/time?projectId={id}` (everyone with access) and "New invoice" → invoice builder route from `invoicing.md` (owner/admin/own PM). Hide the button if it would have no items.
2. **Phase stepper**: `<ol aria-label="Project phases">`, CSS grid with one column per non-archived phase (min 120px, scroll horizontally). Each `<li>` holds:
   - a 6px bar: current blue #2F5BAA, complete/closed light blue #A9BDE3, upcoming #E3E3E3;
   - a green check icon if complete/closed;
   - the uppercase phase name (bold if current);
   - a 12px note (Rule 9).
   - The first `current` phase gets `aria-current="step"`.
3. **Tabs**: underline Tabs. Tab = link to its route segment (not client state), so tabs are bookmarkable. Tab config (single array `projectTabs` with `release` and `visible(session, project, firm)`):

| # | Label | Route segment | Built in | Release 1 behavior |
|---|---|---|---|---|
| 1 | Overview | (index) | R1; snapshot section R2 | Built (this spec) |
| 2 | Phases & fees | `/phases` | R1 | Built, financial view only |
| 3 | Team | `/team` | R1 | Built |
| 4 | Schedule | `/schedule` | **R3** (mockup `Main.dc.html`) | Not rendered |
| 5 | Build | `/build` | **R4** (mockup `ProjectCA.dc.html`); also needs `'build'` in `firm_settings.modules_enabled` | Not rendered |
| 6 | Billing (mockup label "Invoices") | `/billing` | R1, specified in `invoicing.md` | Rendered once milestone 1.8 ships; financial view only |
| 7 | Documents | `/documents` | **R2** (`documents` table) | Not rendered |
| 8 | Checklist | — | Not on roadmap (see Open questions) | Not rendered |
| 9 | Client portal | `/portal` | **R2** | Not rendered |
| 10 | Code | — | Add-on, not on roadmap | Not rendered |

Tabs not built yet are **not rendered at all** (no disabled tabs). Later releases flip them on in `projectTabs`.

## Data shown

### Overview tab (Release 1)
| UI element | Source | Notes / format |
|---|---|---|
| KPI "Architectural fee" | `projectFee` (Σ phase `fee_cents`) | Note: fee-type summary (Rule 8) + ` · {fee/construction ×100, 1 decimal}% of construction` when `construction_cost_cents > 0`. MOB: "Fixed fee · 3.0% of construction" |
| KPI "Billed" | `projectBilled` (projects-list Rule 2) | Note: `{billedPct}% of fee · {outstanding} outstanding`. Outstanding = Σ (`invoices.total_cents − amount_paid_cents`) for this project's invoices with status `sent` or `partially_paid`. MOB: "20% of fee · $11,160 outstanding". If 0: "· nothing outstanding" |
| KPI "Hours" | Σ used hours (Rule 2) | Value "323 h". Note: "of 1,240 budgeted", plus ` · {code} ran {n} h over` for the phase with the largest overage (tie → first by sort_order) when any phase is over. MOB: "of 1,240 budgeted · SD ran 15 h over" |
| KPI "Construction estimate" | `construction_cost_cents` | `formatMoneyShort` → "$6.2M". Note: `${round(cost/sf)} / SF · {sf} SF` when SF set. MOB: "$310 / SF · 20,000 SF". All roles see this tile |
| **Hours vs budget** card | Rule 2–4 | Financial view only. Columns: Phase (name + status Badge) · Hours used / budget (bar 230px + "58 / 62 h" left and "94%" right) · Remaining · % complete. Total row. Footer link "Phases & fees" → `/phases` |
| Row expand (chevron, `aria-expanded`) | Counted entries grouped by membership | Sub-table: Avatar + `memberships.title`, hours. **No rates or cost** (that's the R2 snapshot) |
| Project information | `projects` + joins | `<dl>` grid: Client, Client contact ("First Last · title"), Address (full), Building ("20,000 SF"), Start date, Target end, Principal in charge, Project manager. Dates `MMM D, YYYY`. Null → "—" |
| Team (mini card) | `project_members` (active) + used hours per member on this project | Avatar, `memberships.title`, "{h} h logged" (hours hidden in basic view). "View all" → `/team` |
| Recent activity | `activity_log`, newest 10 | Rows where (`entity_type='project'` and `entity_id`=project) or (`entity_type` in `project_phase`,`project_member`,`consultant`,`invoice` and `entity_id` in this project's ids). Mono date "Oct 17", bold actor initials, text from `activityText()` (Rule 10). Basic view omits invoice rows |

### Phases & fees tab
| UI element | Source | Notes / format |
|---|---|---|
| Card title "Architectural fee by phase" + subtitle | Rule 8 | e.g. "Fixed fee · billed by % complete" |
| Phase | `code` (mono) + `name` | |
| Fee type | `fee_type` | "Fixed" / "Hourly" / "NTE" |
| Fee | `fee_cents` | Money, right. Hourly with 0 → "$0 (estimate)" |
| % of total | `round(fee_cents ×100 / projectFee)` | Whole %; total row "100%" (or "—" if fee total 0) |
| Budget hours | `budget_hours` | |
| Hours used / budget | Rule 2 | "201 / 186 h", red #B42318 when used > budget |
| % complete | `percent_complete_bp / 100` | Fixed only; Hourly/NTE show "—" |
| Billed | `phaseBilled` (`projects-list.md` Rule 2, which follows `invoicing.md` Rule 2: sent/partially_paid/paid/written_off; drafts and void excluded) | |
| Left to bill | `fee_cents − phaseBilled` | Negative shown red with "−" |
| Status | `status` | Badge: upcoming "Not started" (hollow grey dot) · current "In progress" (blue half dot) · complete "Complete" (green dot) · closed "Closed" (grey filled) |
| Total row | Σ of each numeric column | Fee total **is** `projectFee`; there is no separately stored total |
| **Consultants** card | `consultants` (active) + `companies.name` | Columns: Discipline · Consultant · Fee · Markup (`markup_bp/100` "10%") · Fee to client (Rule 7; "Not billed through" if `billed_through=false`). Total row Σ Fee, Σ Fee to client |

### Team tab
| UI element | Source | Notes |
|---|---|---|
| "Firm team" list | `project_members` (active) → memberships → users | Avatar, "BM · Principal" (`initials` · `project_role`), sub-line `memberships.title`, right: used hours on this project "42 h" (financial view only). Owner/admin also see "Rate override $185/h" when `bill_rate_override_cents` set. Order: Principal, PM, then others by last name |
| "Client & consultants" list | Client: `client_company_id` + `client_contact_id`; consultants: `consultants` + `companies` + `companies.billing_contact_id → contacts` | Grid: role caption (Client / discipline), company name, contact "First Last · title", action link "Email" (`mailto:`; hidden when no email). No fees here |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Edit project | Drawer with the same fields and Zod schema as `projects-list.md` Card 1, plus status (incl. `closed`). Server action `updateProject`. Changing PM or principal inserts a `project_members` row for the new person if missing ('PM' / 'Principal'); the old person stays a member. `activity_log`: `updated`, or `status_changed` when status changes | As create; number unique | Owner, admin, own PM |
| Close project (status → closed) | Confirm dialog "Close 2026-014? No new time can be logged on this project." Phases are not changed. Blocking new time is enforced in `timesheet.md` | — | Owner, admin, own PM |
| Expand phase row (Overview) | Toggles the per-person sub-table; client state only | — | Financial view |
| Edit phases | Switches the table into edit mode (inputs for code, name, fee type, fee, budget hours, % complete, status, start date, end date; ↑/↓ reorder buttons; archive icon). Footer totals update live. **Save** calls `updatePhases(projectId, rows, loadedAt)`; **Cancel** discards | Rule 5 | Owner, admin, own PM |
| Add phase | Dialog: code, name, fee type (default Fixed), fee, budget hours. Appended (`sort_order = max+1`), status `upcoming`. Dialog shows "Total fee becomes $X" | Rule 5 | Owner, admin, own PM |
| Archive phase | Sets `archived_at`. Only if no `time_entries` and no `invoice_lines` reference the phase; otherwise the icon is disabled with tooltip "Has time or invoices. Set status to Closed instead." | — | Owner, admin, own PM |
| Redistribute fee | Dialog (Rule 6): new total fee, optional new total budget hours, a Lock checkbox per phase, preview "old → new". **Apply** saves through `updatePhases` | Rule 6 | Owner, admin, own PM |
| Add / edit consultant | Dialog: company (combobox of `companies` kind `consultant`, + quick-create by name), discipline (Select: Civil, Structural, MEP, Landscape, Other… text 1–40), fee (≥ 0), markup % (0–100, 2 decimals → bp, default 0%), billed through (checkbox, default on). Actions `createConsultant` / `updateConsultant` | Company required; fee ≥ 0 | Owner, admin, own PM |
| Remove consultant | Confirm, then archive | — | Owner, admin, own PM |
| Add person | Dialog: person (active memberships not already active members), project role (Select: Principal, PM, PA, Designer, Interior designer, Other… text 1–40), bill rate override (money, optional; field rendered **only** for owner/admin). Action `addProjectMember` | Person required; no duplicate active row | Owner, admin, own PM (PM cannot set override) |
| Change role / override | Inline edit in the list | As above | Same |
| Remove person | Archive the `project_members` row. Disabled for the membership that is the project's PM or principal (tooltip "Change the PM in Edit project first"). Logged time is untouched | — | Owner, admin, own PM |

All writes: `requireRole` + `can(session,'project.edit',project)` → Zod → `withFirm` transaction → `activity_log` (with before/after `changes`) → `revalidatePath('/app/projects/{id}', 'layout')` and `/app/projects`.

## Business rules
All math lives in `src/lib/calc/`. Money is in cents; rounding is half away from zero.

1. **Project fee = Σ phase fees.** `projectFee` = Σ `fee_cents` of non-archived phases. The Phases & fees total row, the Overview tile and the list all call the same function. They cannot disagree because no total is stored. MOB: **$186,000**.
2. **Used hours** (`phaseUsedHours`) = Σ `time_entries.hours` where `project_phase_id` = phase, the entry is not archived, and its timesheet `status in ('submitted','approved')`. Draft and rejected time are excluded. Billable and non-billable both count.
   MOB: PD 58, SD 201, DD 64, others 0. Project total **323 h**.
3. **Hours bar.**
   - `over = max(0, used − budget)`, `scale = max(budget, used)`.
   - The solid part has width `min(used,budget)/scale`. Its color is blue, or orange #C2410C when `used/budget ≥ 0.9` and not over.
   - The hatched overage (orange stripes) has width `over/scale` and starts where the solid part ends.
   - `pct = round(used×100/budget)`, shown as "108%". When budget is 0, the text is blank, and if used > 0 the whole bar is hatched.
   - `aria-label` = "Schematic Design: 201 of 186 budgeted hours, 15 over".
   - MOB SD: solid 186/201 = 92.5%, hatch 7.5%, "108%".
4. **Remaining** = `budget − used`. Shown as "4 h", or "15 h over" in red when negative. The total row shows Σbudget − Σused: MOB "917 h".
5. **Phase edit validation** (server re-checks every rule; returns per-row errors):
   - `code` 1–12 chars and `name` 1–80 chars. Codes are unique within the project (case-insensitive).
   - `fee_cents` is an integer ≥ 0. NTE requires > 0 ("Not-to-exceed phases need a cap").
   - For fixed and NTE phases, `fee_cents ≥ phaseBilled`: "Fee can't be less than the $27,900 already billed".
   - `budget_hours` ≥ 0, a multiple of 0.25 ("Use quarter hours"), ≤ 999,999.75.
   - `percent_complete_bp` is an integer 0–10000, editable only when `fee_type = 'fixed'` (otherwise saved unchanged). It must be ≥ the phase's **last billed %** as defined in `invoicing.md` Rule 3 (counted invoices only, so drafts and void don't count): "Already billed through 100%". Use the same function as invoicing (`lastBilledPct`).
   - `fee_type` cannot change once the phase has any non-void invoice line: "Fee type can't change after the phase has been billed".
   - `end_date ≥ start_date` when both are set.
   - Status: any value is allowed, and more than one phase may be `current` (e.g. Permitting overlapping CA). Non-blocking warning: a fixed phase set to `complete` with % complete < 100 shows "SD is complete at 60%. Set to 100%?" with a one-click fix.
   - **Concurrency:** the client sends `loadedAt`. If any phase's `updated_at` is later than that, reject the whole save with "Someone else changed these phases. Reload to see their changes."
   - Save is all-or-nothing in one transaction. Write one `activity_log` row per changed phase, with field-level before/after.
6. **Redistribute fee** uses `distributeFee(newTotal, phases, lockedIds)`:
   - Default locks: phases with `phaseBilled > 0` or status `complete`/`closed`.
   - Weights for unlocked phases = their current `fee_cents`. If those weights sum to 0, use `phase_templates.default_fee_share_bp` matched by `code`. If that also sums to 0, split equally.
   - The algorithm is the same as `projects-list.md` Rule 6: floor each share, and the leftover goes to the largest unlocked weight.
   - Block when `newTotal < Σ locked fees`, or when any unlocked phase's new fee would fall below its `phaseBilled`.
   - Optional new total hours: same algorithm in quarter-hour units, with weights = current `budget_hours` and the same locks.
   - *Example (MOB → $200,000):* PD + SD are locked (billed), 3,720,000¢. Remaining 16,280,000 over DD/CD/Permitting/CA/Close Out, weights 4,650,000 / 6,510,000 / 930,000 / 2,790,000 / 0 (Σ 14,880,000). Result: DD 5,087,500 · CD 7,122,500 · Permitting 1,017,500 · CA 3,052,500 · Close Out 0. There is no leftover, and the new total is exactly 20,000,000¢.
7. **Consultant fee to client** = `round(fee_cents × (10000 + markup_bp) / 10000)` when `billed_through`; otherwise not billed.
   MOB at 10% (1000 bp): Civil 1,450,000 → **1,595,000**; Structural 1,820,000 → 2,002,000; MEP 3,680,000 → 4,048,000; Landscape 640,000 → 704,000. Totals $75,900 → **$83,490**.
8. **Fee-type summary**, used for the subtitle and KPI note:
   - All phases fixed: "Fixed fee · billed by % complete".
   - All hourly: "Hourly · billed by hours worked".
   - All NTE: "Not-to-exceed · hourly up to a cap".
   - Mixed: "Mixed fee types".
   - The KPI note uses only the first two words ("Fixed fee", "Hourly", "Not-to-exceed", "Mixed fee types").
9. **Stepper note** (dates use `MMM D`):
   - complete/closed: "Done · {end}" or "Done".
   - current: "Now · to {end}" or "Now".
   - upcoming with both dates: "{start} – {end}"; with a start only: "From {MMM YYYY}"; otherwise "—".
   - MOB DD with end 2026-11-25: "Now · to Nov 25".
10. **`activityText(row)`** templates:
    - created: "created {entity label}".
    - updated: "updated {label} ({changed field names, max 3})".
    - status_changed: "moved {label} to {new status}".
    - Labels: project → "the project"; project_phase → phase code; project_member → person initials; consultant → discipline; invoice → invoice number.
    - Actor = `users.initials`, or "System" when `actor_user_id` is null.

## States
- **Loading:** `loading.tsx` shows header skeleton (meta line, H1 bar, 7 stepper bars) and a tab-content skeleton (4 KPI tiles, 7 table rows).
- **Not found / no access:** an unknown id, an id from another firm, an archived project, or a staff member not assigned all render the standard 404 page (existence is never revealed).
- **Error:** in-card "Couldn't load this project. Try again." + Retry; report to Sentry.
- **Empty:**
  - Project with no phases (all archived): Phases card shows the Empty state "No phases yet" / "Add the phases this project is billed by." / **Add phase**; stepper hidden.
  - No consultants: "No consultants on this project." + **Add consultant**.
  - No team besides PM: list shows the PM only.
  - No activity: "Nothing yet."
- **Permission denied:** basic-view users requesting `/phases` get 404. Server actions called without permission return `{ ok:false, error:'forbidden' }` and the UI shows "You don't have permission to change this project."
- **Save errors:** row errors appear in red under the input. Edit mode stays open with values kept. A banner summarizes "2 phases need attention".

## Out of scope (for this release)
- **Project snapshot** (hours, billed, cost, profit by phase, overhead switch): **Release 2**, `docs/specs/release-2/project-snapshot.md`. In R2 it replaces the Hours vs budget card for owner/admin; PMs keep the R1 card.
- **Client portal tab**: **Release 2** (portal_access, portal_requests, shared_documents).
- **Documents tab**: **Release 2** (`documents`).
- **Schedule tab** and the Overview "Coming up" card and "Next milestone" KPI: **Release 3** (`tasks`), mockup `Main.dc.html`.
- **Build tab** (RFIs, submittals, field reports, pay apps, contractor invite): **Release 4**, mockup `ProjectCA.dc.html`. This also covers the "Contractor · To be selected" row in Client & consultants.
- **Billing/Invoices tab content**: Release 1 but specified in `invoicing.md`.
- Consultant **Invoiced to us** and **Billed to client** actuals: **Release 2** (vendor_bills; see Open questions on linking invoice lines).
- Checklist tab and Code add-on: not on the roadmap.
- Per-member free-text notes ("Owner meetings, design reviews"): not in the data model.

## Acceptance tests
Fixture **F2**: TMG, overhead 6000 bp. Project 2026-014 "Medical Office Building":
- active; client Palmetto Medical Properties; PM JR; principal BM; type Medical office; 20,000 SF; construction 620,000,000¢; start 2026-08-03.
- Members: BM "Principal", JR "PM", KL "Designer", AP "Interior designer".
- All phases fixed:

| Phase | fee_cents | budget h | status | pct bp | approved hours |
|---|---|---|---|---|---|
| PD Pre-Design | 930,000 | 62 | closed | 10000 | BM 24, JR 22, KL 12 |
| SD Schematic Design | 2,790,000 | 186 | closed | 10000 | BM 14, JR 92, KL 66, AP 29 |
| DD Design Development | 4,650,000 | 310 | current (end 2026-11-25) | 3000 | BM 4, JR 50, KL 10 |
| CD Construction Documents | 6,510,000 | 434 | upcoming | 0 | — |
| PRM Permitting | 930,000 | 62 | upcoming | 0 | — |
| CA Construction Admin | 2,790,000 | 186 | upcoming | 0 | — |
| CO Close Out | 0 | 0 | upcoming | 0 | — |

- Invoices:
  - 2026-097: paid, PD line 930,000 @ 10000 bp.
  - 2026-109: paid, SD line 1,674,000 @ 6000 bp.
  - 2026-121: sent, SD line 1,116,000 @ 10000 bp, total 1,116,000, paid 0.
  - A draft: DD line 1,395,000 @ 3000 bp.
- Consultants, all with 1000 bp markup and billed_through:
  - Civil: Lowcountry Civil Group, 1,450,000.
  - Structural: Tidewater Structural Engineers, 1,820,000.
  - MEP: Coastal MEP Engineers, 3,680,000.
  - Landscape: Greenline Landscape Architecture, 640,000.
- KL also has 8 h in a **draft** timesheet on DD.

- [ ] Given F2 as BM, when I open `/app/projects/{id}`, then the meta line reads "2026-014 · MEDICAL OFFICE · 20,000 SF", the H1 reads "Medical Office Building", and the health badge says "At risk".
- [ ] Given F2, then the stepper has 7 steps, PD and SD show a check and "Done", and DD has `aria-current="step"` with the note "Now · to Nov 25".
- [ ] Given F2 as BM, then the KPIs read: Fee "$186,000" / "Fixed fee · 3.0% of construction"; Billed "$37,200" / "20% of fee · $11,160 outstanding"; Hours "323 h" / "of 1,240 budgeted · SD ran 15 h over"; Construction "$6.2M" / "$310 / SF · 20,000 SF".
- [ ] Given F2, then KL's 8 draft hours are not counted anywhere (DD shows "64 / 310 h").
- [ ] Given F2 as BM on Overview, then Hours vs budget shows SD "201 / 186 h", "108%", Remaining "15 h over" in red, and the total row "323 / 1,240 h", "917 h".
- [ ] Given F2, when I expand SD, then I see BM 14, JR 92, KL 66, AP 29 hours, and the HTML has no "$" amounts in the sub-table.
- [ ] Given F2 as BM on `/phases`, then the rows show fee / % of total / billed / left: PD $9,300 / 5% / $9,300 / $0; SD $27,900 / 15% / $27,900 / $0; DD $46,500 / 25% / $0 / $46,500; CO $0 / 0%. The total row shows $186,000 / 100% / $37,200 / $148,800.
- [ ] Given edit mode, when I change CD's fee to $70,000 and save, then the total row and the Overview fee both read $190,900, and one `activity_log` row records CD fee 6,510,000 → 7,000,000.
- [ ] Given edit mode, when I set SD's fee to $20,000, then saving fails with "Fee can't be less than the $27,900 already billed" and nothing changes.
- [ ] Given edit mode, when I set DD's % complete to 20% and save, then the save succeeds, because DD's only invoice line is on a draft and drafts don't count toward "already billed".
- [ ] Given edit mode, when I set SD's percent to 90%, then saving fails with "Already billed through 100%".
- [ ] Given edit mode, when I change SD's fee type to Hourly, then saving fails with "Fee type can't change after the phase has been billed".
- [ ] Given edit mode, when I set DD's budget hours to 310.3, then I see the error "Use quarter hours".
- [ ] Given two browser sessions, when session A saves phases and then session B saves, then B gets "Someone else changed these phases…" and B's edits are not saved.
- [ ] Given F2, when I Redistribute to $200,000 with the default locks, then the preview shows DD $50,875, CD $71,225, Permitting $10,175, CA $30,525, with PD/SD unchanged, and after Apply the total is $200,000.
- [ ] Given F2, when I try to redistribute to $30,000, then I see "New total is less than the $37,200 in locked phases".
- [ ] Given F2, when I add phase "AS1 Additional Services" fixed $5,000, then it appears last with status Not started and the total becomes $191,000.
- [ ] Given F2, then the archive icon on SD is disabled (it has time), and on CO it is enabled; archiving CO removes it from the stepper.
- [ ] Given F2 on the Consultants card, then Civil shows Fee $14,500, Markup 10%, Fee to client $15,950, and the totals are $75,900 / $83,490.
- [ ] Given F2 as JR (own PM), then the Team tab hides "Rate override", and the Add person dialog has no bill-rate field. A server action call with `bill_rate_override_cents` from JR returns forbidden.
- [ ] Given F2, then "Remove" is disabled for JR (the PM) and BM (the principal), and enabled for KL; removing KL archives the row and keeps KL's time.
- [ ] Given F2 as KL (staff, member), then the tabs are Overview and Team only, there are no fee/billed/hours tiles, there is no health badge, and a request to `/app/projects/{id}/phases` returns 404.
- [ ] Given a staff member who is not a member, when they open `/app/projects/{id}`, then they get a 404.
- [ ] Given a PM who is not on 2026-014, then the page renders the basic view and the Edit project button is absent.
- [ ] Given Edit project, when BM changes the status to Closed and confirms, then the status is closed, the list shows it under Closed, and `activity_log` has `status_changed`.
- [ ] Given Release 1 config, then no Schedule, Build, Documents, Checklist, Client portal or Code tab is rendered.

## Open questions
1. **Data model addition needed:** the "Project information" fields from the mockup:
   - `projects.stories smallint`
   - `projects.building_height_ft numeric`
   - `projects.occupancy_group text`
   - `projects.construction_type text`
   - `projects.sprinklered boolean`
   - `projects.delivery_method` enum (design-bid-build, design-build, CM at risk)
   - `projects.design_review_board text`

   Until these are added, the card shows only modeled fields.
2. **Data model addition needed:** `projects.scope_kind` (Ground-up / Tenant upfit / Shell building) for the meta line. This is the same item as `projects-list.md` Q1.
3. **Data model addition needed:** `consultants.contact_id uuid null → contacts`. The mockup shows a named contact per consultant. This spec falls back to `companies.billing_contact_id`, which may be the wrong person.
4. **Data model addition needed (Release 2):** `invoice_lines.consultant_id uuid null` and `vendor_bill_lines.consultant_id`, so "Invoiced to us" and "Billed to client" can be shown per consultant. (In the mockup, billed to client = invoiced × 1.1.)
5. **Data model addition needed (optional):** `firm_settings.default_consultant_markup_bp`. The mockup implies 10%; this spec defaults to 0%.
6. Should the Checklist tab (per-phase checklist, mockup) be scheduled in a release? It needs a `phase_checklist_items` table.
7. Used hours count `submitted` + `approved` time. Should a PM's hours view also include drafts, to see the current week early?
8. Can a PM edit **fees** (contract amounts) on own projects, or only hours/status/% complete? This spec follows ARCHITECTURE §5 (yes). Restricting fee edits to owner/admin is a one-line change in `can()`.
