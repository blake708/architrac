# Spec: Projects list + New project

| | |
|---|---|
| **Release** | 1 (milestone 1.4) |
| **Route** | `/app/projects` (list) · `/app/projects/new` (create) |
| **Mockup** | `mockup/Projects.dc.html` (list only; the create flow has no mockup and is defined here) |
| **Status** | Draft |

## Purpose
Everyone at the firm uses this page to find a project and open it. Principals and PMs use the KPI band and health column to see which active work needs attention, and use **New project** to set up a project with its phases, fee type, fee and budget hours generated from the firm's phase templates.

## Who can see it
"Own project" = `projects.pm_membership_id` or `projects.principal_membership_id` equals the viewer's membership id. "Assigned" = the viewer has a `project_members` row on the project with `archived_at is null`. Implement both through `can()` (ARCHITECTURE §5).

| Role | Access |
|---|---|
| Owner | All projects, all columns, KPI band, New project |
| Admin | Same as owner |
| Project manager | All projects. Fee, Billed and Health show only on own projects; other rows show `—` in those cells. No KPI band. Can use New project. |
| Staff | Only assigned projects. Fee, Billed and Health columns and the KPI band are not rendered at all. No New project button. |
| Client (portal) | None |

Server rule: queries strip the hidden values before the data reaches the browser. Hiding a column in the browser is not enough.

## Layout
Inside the app shell (MenuRail with Projects active, TopHeader title "PROJECTS").

1. **PageHeader**
   - Mono meta line: `{n} ACTIVE · {n} CLOSED · LEADS AND PROPOSALS LIVE IN MARKETING`. Counts follow the viewer's visibility.
   - H1 "Projects".
   - Actions on the right: **New project** (primary Button with plus icon). The mockup's **Import** button is not built (see Out of scope).
2. **KPI band** (owner/admin only): four KPI tiles in an auto-fit grid (min 180px), split by 1px lines. They show Active fees, Billed to date, Left to bill and Flagged (orange value).
3. **Status Tabs** (underline Tabs, `role="tablist"`): Active · On hold · Closed · All. Each tab shows a mono count after its label.
4. **Toolbar row**
   - Search Input on the left (max 340px, search icon, placeholder "Search by name, number or client").
   - On the right: **Type** Select, **PM** Select and a **Sort** toggle button.
5. **Project table** (Table component in a Card, horizontal scroll under 1180px). Columns in order:
   No. · Project / client · Type · Phase · PM · Fee · Billed · Constr. est. · Health.
6. Empty / no-match message inside the card (see States).

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| No. | `projects.number` | Mono 12px |
| Project name | `projects.name` | Link to `/app/projects/{id}`; ellipsis on overflow |
| Client (under name) | `companies.name` via `projects.client_company_id` | 12.5px muted |
| Type line 1 | `projects.project_type` | e.g. "Medical office" |
| Type line 2 | *(scope kind: Ground-up / Tenant upfit / Shell building)* | **Data model addition needed** (see Open questions). Leave the line empty until it is added. |
| Phase stepper | `project_phases` of the project (`archived_at is null`), ordered by `sort_order` | One 24×6px segment per phase. `current` = blue #2F5BAA, `complete`/`closed` = light blue #A9BDE3, `upcoming` = grey #E3E3E3. `aria-hidden`; the text line below carries the meaning. |
| Phase text | Rule 4 | 12.5px |
| PM | `users.initials` via `projects.pm_membership_id → memberships.user_id` | 28px Avatar. `title` = "First Last". |
| Fee | `projectFee` (Rule 1) | Money, mono, right-aligned |
| Billed | `projectBilled` and `billedPct` (Rule 2) | 72×6px Progress bar (blue fill, width = min(pct,100)%) followed by "20%". `—` when fee = 0. |
| Constr. est. | `projects.construction_cost_cents` | `formatMoneyShort`: ≥ $1,000,000 → "$6.2M" (1 decimal); else "$640k" (whole thousands, round half away from zero); null → `—`. Add the function to `src/lib/format.ts`. |
| Health | `projectHealth` (Rule 3) | Badge with a shape dot: On track = green circle; At risk = orange diamond; Over budget = red square; On hold / Closed / Pursuit = grey. |
| Tab counts | Count of visible projects per status | Search, Type and PM filters do **not** change the counts |
| KPI Active fees | Σ `projectFee` over visible `status = 'active'` projects | Note: "{n} active projects" |
| KPI Billed to date | Σ `projectBilled` over the same set | Note: "{round(billed/fees×100)}% of active fees" |
| KPI Left to bill | Active fees − Billed to date | Note: "On active projects". Can be negative; format "−$1,200". |
| KPI Flagged | Count of active projects where health ∈ {at_risk, over_budget} | Note: "Active projects at risk or over budget"; value in orange #9A3412 |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Pick status tab | Sets `?status=active\|on_hold\|closed\|all` (default `active`). Active, On hold and Closed match `projects.status`. All shows every status, `pursuit` included. | — | All who can see the page |
| Search | Debounce 250 ms, then set `?q=`. Case-insensitive substring match on `number`, `name` and client company `name`; leading/trailing spaces trimmed. | max 100 chars | All |
| Type filter | `?type=<project_type>`. Options are "All" plus the distinct `project_type` values among visible projects, sorted A–Z. | — | All |
| PM filter | `?pm=<membership_id>`. Options are "Anyone" plus active memberships that are `pm_membership_id` on at least one visible project, sorted by last name. | — | All |
| Sort toggle | Switches `?sort=number` (label "Project number": `number` descending) and `?sort=fee` (label "Largest fee": fee descending, ties by `number` descending). Default `number`. | — | All. Staff get the number sort only, because fee is hidden from them. |
| Open project | Navigate to `/app/projects/{id}` | — | All (staff only reach assigned projects) |
| New project | Navigate to `/app/projects/new` | — | Owner, Admin, PM |
| Save new project | Server action `createProject` (see "New project flow") | Zod schema below | Owner, Admin, PM |

All filters live in the URL so a filtered list can be bookmarked. The page is a Server Component that reads `searchParams`. Only the search box and the create form are client components.

## New project flow (`/app/projects/new`)
*(Changed by Blake, 2026-11-04: two steps.)* A caption shows "Step 1 of 2 · Project and phases" or "Step 2 of 2 · Fees, roles and consultants". The sticky footer holds **Cancel** + **Next: fees** on step 1, and **Back** + **Create project** on step 2. Back keeps everything typed.

**Step 1** has two columns: **Project details** (Card 1 below) on the left, and a **Phases** card on the right. The Phases card is a checklist of every non-archived `phase_templates` row: default phases first and checked, then optional phases (e.g. Additional Services) unchecked with an "Optional" tag. Each item shows code, name and description. **Next** runs the server's own checks on the project fields and needs at least one phase checked ("Include at least one phase"). A field's error clears as soon as it's edited. A server error on a step-1 field (e.g. "Number already used") returns you to step 1.

**Step 2** has, in order: the **Estimate** card, **Phases & fees** (Card 2 below, checked phases only) and **Consultants**. The three cards share one column up to 960px wide. In Phases & fees, a line separates each phase, and its roles sit in a grey area under it (like the project snapshot's detail rows).

### Estimate (step 2)
- Picks ranges for the project's type and scope, in this order:
  1. past projects with the same type and scope;
  2. past projects with the same type;
  3. a Settings range with the same type and scope;
  4. a Settings range for the type, any scope.
- **Past projects** are the firm's non-archived, non-pursuit projects that have square feet, a construction cost and a fee (Σ phase fees). There must be at least 3. The range is the middle half (25th–75th percentile) of cost per SF and of fee ÷ construction; typical is the median. Only the range is sent to the page, never one project's numbers.
- **Settings ranges** come from Settings → Phases → Project type ranges; typical is the midpoint.
- **Construction cost:** low–high = cost/SF × square feet, rounded to $100, shown short ("$5.8M–$6.6M"), then "Typical $6.2M · $290–$330 / SF × 20,000 SF". **Use $6.2M** fills the construction estimate; it's only shown while that field is blank. Without square feet, a note asks for them.
- **Architectural fee:** "2.8%–3.4% of construction", then dollars over the entered construction estimate (or else the typical estimate), rounded to $100: "$174k–$211k · typical $192,200 (3.1% of your $6.2M estimate)". Then "Your total fee is below / within / above the range." **Use $192,200** sets the total fee and clears phase edits, so it spreads by template share.
- No range found: "No ranges for {type} yet. They come from 3 or more similar past projects, or add a range in Settings → Phases." The link is shown to owner/admin only.
- Source line, e.g. "From 4 past ground-up medical office projects (middle half)" or "From Settings → Phases: medical office, any scope".
- Calculation: `src/lib/calc/benchmarks.ts`. Server: `src/server/projects/estimate.ts`.

### Consultants (step 2)
- Rows with: discipline (text with suggestions Civil / Structural / MEP / Landscape), consultant (Contacts companies of kind consultant, plus "+ New consultant…" which adds a company by name inline), contact (that company's people), fee, markup % (defaults to `firm_settings.default_consultant_markup_bp`), "Billed through us", and fee to client (project-detail Rule 7). Plus Remove and **Add consultant**.
- Footer: "Architectural fee $X + consultants $Y = $Z to the client".
- Consultant fees are separate from the architectural fee and the 100% rule.
- Rows are checked on the page and on the server. Errors are keyed `consultants.{row}.{field}` and shown on the row.

### Card 1: Project details
*(Changed by Blake, 2026-11-03.)* Fields are grouped under labeled sections: **Project** (number, name, status, type, scope) · **Client** (client, client contact) · **People** (principal, PM) · **Site address** (street with Google lookup, suite/unit, city, state, ZIP; ADR 0007) · **Size & schedule** (square feet, construction estimate, start, target end).

| Field | Column | Control / rule |
|---|---|---|
| Project number * | `number` | Input, prefilled by Rule 5. Pattern `^[A-Za-z0-9-]{1,20}$`. Unique per firm, compared case-insensitively. |
| Project name * | `name` | Input, 1–200 chars |
| Client * | `client_company_id` | Combobox of `companies` with `kind = 'client'` and not archived. The last option, "+ New client…", opens a Dialog asking for a name only and creates `companies {kind:'client'}`. Prefilled from `?client=<companyId>` (the Contacts drawer links here); ignore the param if that company isn't a client. |
| Client contact | `client_contact_id` | Select of `contacts` where `company_id` = the chosen client. Disabled until a client is picked. |
| Project type * | `project_type` | Select: Medical office, Restaurant, Retail, Office, plus the distinct existing values, plus "Other…" (reveals a text input, 1–60 chars) |
| Status | `status` | Select: Active (default), Pursuit, On hold. Closed is not offered on create. |
| Principal in charge * | `principal_membership_id` | Select of active memberships marked **Principal** on the Team page (`is_principal`); if none are marked, owners and admins (Blake, 2026-11-03) |
| Project manager * | `pm_membership_id` | Select of active memberships with `app_role in ('owner','admin','project_manager')`. Defaults to the viewer when the viewer is a PM. |
| Address | `address_line1`, `address_line2`, `city`, `state`, `postal_code` | See Open questions (column names) |
| Square feet | `square_feet` | Integer > 0, optional |
| Construction estimate | `construction_cost_cents` | Money input, ≥ 0, optional |
| Start date / Target end | `start_date`, `target_end_date` | Date pickers. End must be ≥ start when both are set. |

### Card 2: Phases & fees
- Inputs above the table:
  - **Total fee** * (money, ≥ $0, default $0).
  - **Total budget hours** (≥ 0, multiple of 0.25, default 0).
- *(Changed 2026-11-04.)* The table shows the phases checked on step 1 (template order), then any **custom phases** added with **+ Add custom phase**. A custom phase starts blank (code and name typed, 1–12 / 1–80 chars) at $0 and can be removed. Its fee/% edits count toward 100% like any other. Codes must be unique in the project, ignoring case: "Another phase already uses this code", checked on the page and the server. Each created `project_phases` row copies its template's `description` (settings-rates-phases rule 10a). Custom phases have none.

| Column | Behavior |
|---|---|
| *(Include)* | Moved to step 1's Phases checklist (2026-11-04) |
| Code | Text input, prefilled from `phase_templates.code`, 1–12 chars |
| Name | Text input, prefilled from `phase_templates.name`, 1–80 chars |
| Fee type | Select: Fixed / Hourly / Not-to-exceed. Prefilled from `default_fee_type`. |
| Share | Read-only `default_fee_share_bp` shown as "25%" |
| Fee | Money input. Auto-filled by Rule 6. Typing a value marks the row *fee-edited* (shown as a small blue dot with `aria-label="edited"`). |
| Budget hours | Number input, step 0.25. Auto-filled by Rule 7. Typing marks the row *hours-edited*. |

- Footer row: Σ Fee and Σ Budget hours over the included rows.

*(Changed by Blake, 2026-11-03.)*
- **Share is editable.** Typing a % sets that phase's fee to % × total. Typing a fee shows its new %. Either edit marks the row (blue dot). A %-edited phase keeps its % when the total changes; a fee-edited phase keeps its dollars. Unedited checked phases rebalance by template share, so checked phases total **100%** (footer shows Σ %).
- **Unchecked and hourly phases are 0% and $0.** Hourly phases are billed by the hour: their fee box is disabled and their budget hours are typed in. The server refuses an hourly phase with a fee.
- **Budget hours = phase fee ÷ the firm's blended bill rate** (settings-rates-phases rule 3), rounded to the quarter hour (`hoursFromFee`). Typing a phase's hours overrides it (blue dot). **Total budget hours** is a read-only sum (no longer typed). Without rates set up, hours are typed and a note points to Settings → Rates & roles. Only the blended *bill* rate is sent to the page; PMs may see bill rates (OPEN_DECISIONS #4), never cost.
- **Roles under each phase** *(1.5 B; inline since 2026-11-04)*: rows of role, share %, hours, bill rate, fee, Remove, plus "+ Add role". The template's default mix fills in. Typing a % sets the hours (share × fee ÷ bill rate, quarter hours); typing hours sets the % (hours × bill rate ÷ fee, `shareFromHours`). Shares must total 100% (or no roles); otherwise "Roles add up to X%; they need to make 100%." and Create is disabled. Hourly phases have no roles.
- Link button **Reset to template split**: clears every edited flag and recalculates.
- Help text under the table, by fee type:
  - Fixed: "Fixed: the fee for the phase."
  - Hourly: "Hourly: an estimate; may be $0."
  - Not-to-exceed: "Not-to-exceed: the cap."

### Save (`createProject` server action)
`requireRole(owner|admin|project_manager)` → Zod parse → `withFirm` transaction:
1. Insert `projects` with every Card 1 field.
2. Insert one `project_phases` row per included row:
   - `sort_order` = 1..n in table order.
   - `code`, `name`, `fee_type`, `fee_cents`, `budget_hours` from the row.
   - `percent_complete_bp = 0`, `start_date`/`end_date` null.
   - `status`: when the project status is `active`, the **first** included phase is `current` and the rest are `upcoming`. Otherwise every phase is `upcoming`.
3. Insert `project_members`:
   - The PM, with `project_role = 'PM'`.
   - The principal, with `project_role = 'Principal'`. If the principal and the PM are the same membership, insert one row with `'PM'`.
4. Write one `activity_log` row: `entity_type 'project'`, `action 'created'`, with the phase count and the total fee in `changes`.
5. `revalidatePath('/app/projects')`, redirect to `/app/projects/{id}`, and show the toast "Project 2026-023 created".

Server-side checks (re-run on the server; never trust the browser):
- The number is unique.
- At least one phase is included.
- Σ phase `fee_cents` = Total fee **exactly**.
- Σ phase `budget_hours` = Total budget hours **exactly**.
- Every fee ≥ 0.
- Every Not-to-exceed phase has fee > 0 (the cap).

QuickBooks customer creation is **not** done here. It belongs to `quickbooks-sync.md`, and `quickbooks_customer_id` stays null until then.

## Business rules
These go in `src/lib/calc/` with unit tests. Money is in cents, and rounding is half away from zero at the final step (ADR 0004).

1. **Project fee** `projectFee = Σ project_phases.fee_cents` (`archived_at is null`). There is no stored project-level fee. The total is always the sum of the phases.
   *MOB:* 930,000 + 2,790,000 + 4,650,000 + 6,510,000 + 930,000 + 2,790,000 + 0 (Close Out) = **18,600,000¢ = $186,000**.
2. **Billed**
   - `projectBilled = Σ phaseBilled` over the project's non-archived phases. `phaseBilled` is the "previously billed" sum from `invoicing.md` Rule 2, but with no current invoice excluded:
     - only invoices with status `sent`, `partially_paid`, `paid` or `written_off` count;
     - fixed phases count `phase_fee` lines;
     - hourly and NTE phases count `hourly` + `adjustment` lines.
   - Draft and void invoices are excluded.
   - Consultant and expense lines are excluded, so this is the *architectural fee* billed. That can differ from the invoicing tab's "billed" (invoice totals).
   - `billedPct = round(projectBilled × 100 / projectFee)`, or null when the fee is 0.
   - *MOB:* 930,000 (2026-097) + 1,674,000 (2026-109) + 1,116,000 (2026-121) = 3,720,000¢ = **$37,200**. That is 37,200 / 186,000 = **20%**. The draft DD invoice ($13,950) is excluded.
3. **Health** `projectHealth(project, phases, usedHoursByPhase)`. "Used hours" is defined in `project-detail.md` Rule 2.
   - Status is not `active`: return `on_hold` / `closed` / `pursuit`.
   - Only **open** phases (`current`, `upcoming`) count, plus the project total (decided by Blake, 2026-11-03, OPEN_DECISIONS #9). A phase that finished over budget is flagged on the phase (project-detail), not the project.
   - **over_budget** if Σ used > Σ budget_hours (only when Σ budget > 0), **or** any open phase has used > budget_hours.
   - Else **at_risk** if any open phase with budget > 0 has used ≥ 90% of budget (the design-system orange threshold).
   - Else **on_track**.
   - *MOB:* used 323 h ≤ 1,240 h budgeted, and DD (current) is 64 ≤ 310 h. SD finished at 201 > 186 h, but finished phases don't count, so the result is **On track** (the mockup shows At risk under the old rule).
4. **Phase text**
   - Project `closed`: "Closed out".
   - Project `pursuit`: "Pursuit · not started".
   - Otherwise take the name of the first phase (by `sort_order`) with status `current`. If there is none: "All phases complete" when every phase is complete/closed, or "Not started" when none is. For `on_hold`, prefix "On hold · ".
   - *MOB:* "Design Development".
5. **Suggested project number** (revised 1.8 A, decision #28)
   - The firm's format is `firm_settings.project_number_format` (Settings → Billing & invoices), default `{YYYY}-{###}`. Tokens: `{YYYY}` / `{YY}` = the current year in `firms.timezone`; `{#}`…`{######}` = the counter, zero-padded to the number of `#`; anything else is printed as typed. A format needs exactly one counter, no `{PROJECT}`, and its literal text must fit the project number pattern below.
   - Turn the format into a pattern with this year filled in and the counter as `(\d+)`. Find the highest counter `N` among the firm's projects (archived included) whose number matches. Suggest the format with `N + 1`, or 1 when there is none. With no year token, every project matching the pattern counts, so the counter never restarts.
   - Shared engine with invoice numbers: `formatNumber` / `parseCounter` / `validateNumberFormat` in `src/lib/calc/number-format.ts`; `nextProjectNumber(existing, format, year)` in `src/lib/calc/projects.ts` calls it.
   - *Seed* (`{YYYY}-{###}`): the highest is 2026-022, so suggest **2026-023**. *TMG* (`{YY}{###}`), existing 26029 and 26030, year 2026 → **26031**; in 2027 with no 27xxx yet → **27001**. `P{####}` with P0411 → **P0412**.
   - The server re-checks uniqueness on save; on a race, return the error "Number already used".
6. **Fee split** uses `distributeFee(totalCents, rows, editedIds)` from DATA_MODEL "Key calculations". Precisely:
   - Work only with included rows. `remaining = total − Σ fee of edited rows`. If `remaining < 0`, block with an error.
   - `U` = the unedited rows, `S = Σ default_fee_share_bp` of U. If S = 0, every row in U gets weight 1 (equal split).
   - Each row in U gets `floor(remaining × weight / S)`.
   - `leftover = remaining − Σ floors`. Add the leftover to the U row with the largest weight. On a tie, the first by `sort_order` wins.
   - If U is empty, nothing is distributed. When Σ fees ≠ total, show the error "Phase fees add up to $X; total fee is $Y" with a button **Use $X as total**. Save stays disabled until the sums match.
   - *Example A (MOB, no edits):* total 18,600,000¢, shares 500/1500/2500/3500/500/1500/0 → 930,000 / 2,790,000 / 4,650,000 / 6,510,000 / 930,000 / 2,790,000 / 0. Exact, no leftover.
   - *Example B (remainder):* total 100,001¢ ($1,000.01), same shares → floors 5,000 / 15,000 / 25,000 / 35,000 / 5,000 / 15,000 / 0 = 100,000. The leftover 1¢ goes to CD (largest share) → **35,001**.
   - *Example C (edited):* MOB total with CA edited to 2,000,000¢. remaining = 16,600,000 over PD/SD/DD/CD/Permitting/Close Out (S = 8,500) → 976,470 / 2,929,411 / 4,882,352 / 6,835,294 / 976,470 / 0. The floors sum to 16,599,997, so 3¢ goes to CD → **6,835,297**. The final sum is exactly 18,600,000.
7. **Hours split** uses the same algorithm in **quarter-hour units**: `units = hours × 4`, distribute, then divide by 4. Edits are tracked separately from fee edits.
   - *MOB:* 1,240 h = 4,960 units → 62 / 186 / 310 / 434 / 62 / 186 / 0 h.
8. Unchecking a row clears its edited flags and re-runs Rules 6 and 7. Re-checking it re-adds the row as unedited.
9. Changing a row's fee type does not change its fee.

## States
- **Empty (firm has no projects):**
  - Owner/Admin/PM see the Empty state: "No projects yet" / "Create your first project to start tracking time and fees." / **New project**.
  - Staff see: "You're not on any projects yet" / "Ask your project manager to add you." / no action.
- **No match:** a row inside the card reading `No projects match "{q}".` When there is no `q`, it reads "No projects match these filters." and offers a **Clear filters** link.
- **Loading:** `loading.tsx` shows the header and 8 skeleton rows 58px tall. The KPI tiles show grey bars.
- **Error:** the Card shows "Couldn't load projects. Try again." with a **Retry** button (`router.refresh()`). The error is reported to Sentry.
- **Permission denied:**
  - A staff member opening `/app/projects/new` gets a 403 page: "You don't have access to create projects."
  - A staff member opening an unassigned project's URL gets the 404 page, so the project's existence is not revealed.
- **Create form errors:**
  - Field errors appear under each field (12px red).
  - Server errors appear in a red banner above the footer.
  - Inputs are preserved on error.
  - The submit button shows a spinner and is disabled while saving, to prevent a double submit.

## Out of scope (for this release)
- **Import** button (bulk CSV import). The one-time Bubble migration is milestone 1.11 and is a script, not this button. Hide the button.
- Leads and proposals (Marketing, Release 3). A project created from a won proposal (`proposal_id`) is Release 3.
- "Closed this year" in the meta line: needs a close date (see Open questions). Release 1 shows the total closed count.
- Saved views and column picker.

## Acceptance tests
Fixture **F1** (firm TMG):
- Memberships: BM (owner), JR (project_manager), KL (staff), AP (staff).
- Projects:
  - 2026-014 "Medical Office Building": active, PM JR, principal BM, client "Palmetto Medical Properties", type Medical office, construction 620,000,000¢. Its phases, time and invoices are as in `project-detail.md` fixture F2.
  - 2026-011 "Pine Street Bistro": active, PM BM, principal BM, fee 4,100,000¢ in one Fixed phase (status `current`), budget 300 h, 0 h used, no invoices. KL is a project_member.
  - 2025-004 "Westside Tire & Service": closed, PM JR.

- [x] Given F1 as BM, when I open `/app/projects`, then the Active tab shows 2 rows ordered 2026-014 then 2026-011, and the tabs read Active 2 · On hold 0 · Closed 1 · All 3.
- [ ] Given F1 as BM, then the KPI band shows Active fees $227,000, Billed to date $37,200 with the note "16% of active fees", Left to bill $189,800, and Flagged 1. *(Needs invoices (1.8) and time (1.6). Today: Active fees $227,000, Billed $0, Flagged 0 are tested.)*
- [x] Given F1 as BM, then the 2026-014 row shows Fee $186,000, Billed 20%, Constr. est. $6.2M, Phase text "Design Development", and Health "At risk". *(Fee, Constr. est., phase text checked; Billed and Health need invoices (1.8) and time (1.6). Health is now On track: see Rule 3.)*
- [x] Given F1, when I search "palmetto", then only 2026-014 is listed; when I search "2025-004" on the All tab, then only Westside is listed.
- [x] Given F1, when I search "zzz", then the message `No projects match "zzz".` is shown.
- [x] Given F1, when I toggle sort to "Largest fee", then 2026-014 is listed before 2026-011, and the URL contains `sort=fee`.
- [x] Given F1 as JR (PM), then there is no KPI band, 2026-014 shows its fee and health, and 2026-011 shows `—` for Fee, Billed and Health.
- [x] Given F1 as KL (staff), then only 2026-011 is listed, the Fee/Billed/Health columns are absent, and the page's server response contains no `fee_cents` values.
- [x] Given F1 as KL, when I request `/app/projects/new`, then I get a 403. *(Shown in the shell as an access-denied page, like Settings, rather than an HTTP 403.)*
- [x] Given F1 in 2026, when BM opens `/app/projects/new`, then the number field is prefilled "2026-015".
- [x] Given the seed phase templates and a total fee of $186,000 with 1,240 budget hours, when the form renders, then the phase fees are $9,300 / $27,900 / $46,500 / $65,100 / $9,300 / $27,900 / $0 and the hours are 62 / 186 / 310 / 434 / 62 / 186 / 0.
- [x] Given total $1,000.01 and no edits, then CD = $350.01 and the footer sum = $1,000.01.
- [x] Given total $186,000 and CA edited to $20,000, then CD = $68,352.97 and Σ = $186,000.00.
- [x] Given every included row edited so that Σ = $190,000 against a $186,000 total, then Save is disabled and **Use $190,000 as total** makes Save available. *(Tested by editing CA past the total.)*
- [x] Given a Not-to-exceed row with fee $0, when I click Create, then I see the error "Not-to-exceed phases need a cap" and nothing is saved.
- [x] Given a valid form with Close Out unchecked and status Active, when I click Create, then 6 `project_phases` rows exist with sort_order 1–6, PD is `current` and the rest are `upcoming`, PM and principal `project_members` rows exist, one `activity_log` row exists, and I land on `/app/projects/{id}`.
- [x] Given an existing project 2026-015, when I submit number "2026-015", then the field error "Number already used" is shown.
- [x] Given firm B has projects, when a TMG user loads `/app/projects`, then none of firm B's projects appear (RLS).

## Open questions
1. **Done (1.4):** `projects.scope_kind` enum (`ground_up`, `tenant_upfit`, `shell_building`, `other`). The mockup shows it under Type (e.g. "Ground-up"), and the project header shows it too.
2. **Done (1.4, column only):** `projects.closed_on date null`, set when status becomes `closed`. It is needed for "N CLOSED THIS YEAR" in the meta line and for later reports.
3. **Done (1.4): yes, matching `companies`.** "address fields" on `projects` is not spelled out. This spec assumes `address_line1`, `address_line2`, `city`, `state`, `postal_code`, matching `companies`. Confirm.
4. **Optional data model addition:** `firm_settings.budget_planning_rate_cents`, so budget hours can be suggested as fee ÷ rate. The mockup's numbers imply $150/h ($186,000 ÷ 1,240 h). Without it, the user types the total budget hours.
5. **Decided (Blake, 2026-11-03): open phases only**; no manual override for now. Was: Health rule (Rule 3): a project that finished one phase over budget stays "At risk" until it closes. Is that the intent, or should at_risk only look at current phases? Should a PM be able to set health manually? That would need `projects.health_override`.
6. **Decided (Blake, 2026-11-03): own projects only** (PM or principal). Was: PM visibility: should PMs see fee and billed amounts on projects they don't manage? This spec hides them.
7. Billed follows `invoicing.md` and **includes** `written_off` invoices, so a write-off doesn't lower "billed". Confirm that is wanted for the % billed bar, or whether written-off amounts should be shown separately (Release 2 Accounting).
8. **Decided (Blake, 2026-11-03): yes, checked by default.** Was: Should Close Out (template share 0%) be included by default on new projects?
9. **Decided (Blake, 2026-11-04): New project in two steps**, with an estimate from past projects or Settings ranges, inline roles (type % or hours), custom phases and consultants. The full comparables-based fee estimator stays in Release 3 (New Proposal) and builds on these ranges. Pursuit projects don't count as past projects (they aren't signed). Should closed projects count more than active ones once there's history (after the Bubble import, 1.11)?
