# Spec: Project snapshot (profit by phase, overhead switch)

| | |
|---|---|
| **Release** | 2 (written in Release 1 so the math is fixed early) |
| **Route** | Section on the Overview tab: `/app/projects/[projectId]`, anchor `#snapshot` |
| **Mockup** | `mockup/Project.dc.html`: "Project snapshot" section on the Overview tab (JS block "Project snapshot") |
| **Status** | Draft |

## Purpose
Principals use the snapshot to see, phase by phase, how many hours went in, what was billed, what that labor cost and whether the project is making money. They can flip between labor-only cost and true cost with firm overhead. It is the main profitability view for a project.

## Who can see it
| Role | Access |
|---|---|
| Owner | Sees the snapshot (replaces the Release 1 "Hours vs budget" card on Overview) |
| Admin | Same as owner |
| Project manager | **None.** Keeps the Release 1 "Hours vs budget" card (`release-1/project-detail.md`). Cost rates, cost, profit and overhead are never sent to a PM, including in RSC payloads. |
| Staff | None |
| Client (portal) | None |

Server rule (CLAUDE.md rule 4): the snapshot query function begins with `requireRole('owner','admin')`. For other roles the page never calls it.

## Layout
One Card (`<section aria-labelledby="snap-title">`) on the Overview tab, directly under the KPI tiles, horizontal scroll under 1040px.

1. **Card header row**
   - Title "Project snapshot".
   - Muted help text "Hours, billing and profit by phase · click a phase to see who worked on it".
   - Right side: the **Include overhead** switch (`role="switch"`, `aria-checked`). It is labeled "Include overhead" with the caption "60% of labor · Settings", where "Settings" links to `/app/settings/rates`.
   - Then a 1px divider and a text button "Phases & fees" → `/app/projects/{id}/phases`.
2. **Table** (real `<table>`). Header columns, in order:
   - Phase
   - Hours · used / budget (230px)
   - Fee
   - Billed
   - **Labor cost** when the switch is off, or **Cost + overhead** when it is on
   - Profit to date
   - Projected profit
3. **One `<tbody>` per phase**
   - Main row: chevron + phase name button (`aria-expanded`) + status Badge.
   - Hours bar + "58 / 62 h" + "94%". Bar rules are the same as `release-1/project-detail.md` Rule 3.
   - Money cells in mono, right-aligned, with secondary 11.5px notes below the Billed, Profit and Projected values.
   - Clicking the row toggles the **detail row**:
     - A per-person sub-table (Person · Hours · Cost rate · Labor cost / Cost + overhead), max-width 640px.
     - A one-sentence detail note (Rule 12).
4. **Total row** (surface-2 background, weight 600).
5. **Footer**
   - Legend: blue swatch "Hours used", hatched swatch "Over budget".
   - Explanation sentence on the right (Rule 13).
   - When needed, an orange warning "{h} h have no cost rate. Set rates in Settings → Roles & rates."

## Data shown
"Counted entries" for a phase = non-archived `time_entries` with `project_phase_id` = phase whose timesheet `status in ('submitted','approved')`. This is the same set as `release-1/project-detail.md` Rule 2.

| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Phase name / status | `project_phases.name`, `status` | All non-archived phases by `sort_order`, including $0 phases |
| Hours used / budget | `phaseUsedHours`, `budget_hours` | "201 / 186 h", "108%" |
| Fee | `project_phases.fee_cents` | |
| Billed | `phaseBilled` (`release-1/projects-list.md` Rule 2, same as `invoicing.md` Rule 2: sent/partially_paid/paid/written_off) | Note "{pct}% of fee"; "—" when fee = 0 |
| Cost | Rule 3 / Rule 4 | "—" when 0 |
| Profit to date | Rule 5 | Red #B42318 with "−" when negative |
| Projected profit | Rules 6–8 | Note "{m}% margin", plus " · final" for complete/closed |
| Person rows | Counted entries grouped by `membership_id` | Avatar initials + `memberships.title`, hours, rate (Rule 10), cost |
| Overhead rate | `firm_settings.overhead_rate_bp` | "60%" (bp/100, up to 2 decimals, trailing zeros dropped) |
| Switch initial state | `?overhead=on\|off` if present, else `firm_settings.include_overhead_default` | |
| Planned cost rate | `project_phases.planned_cost_rate_cents` (**data model addition needed**) with Rule 9 fallback | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Toggle "Include overhead" | Switches every cost, profit, projected value, rate, column header, detail note and footer text between the two variants. The server already computed both (Rule 14), so the switch is instant. Calls `router.replace` with `?overhead=on\|off` (no scroll, no refetch). Does **not** change the firm default. | — | Owner, admin |
| Expand / collapse phase | Toggles the detail row. Client state only; several rows may be open at once. Keyboard: the name button is focusable and toggles on Enter/Space. | — | Owner, admin |
| Settings link | Navigates to `/app/settings/rates` | — | Owner, admin |
| Phases & fees link | Navigates to the Phases & fees tab | — | Owner, admin |

The snapshot is read-only. It writes nothing and adds no `activity_log` rows.

## Business rules
Each formula is a pure function in `src/lib/calc/snapshot.ts` and is unit-tested with the numbers below.

Notation:
- `OH = overhead_rate_bp` (6000 for TMG).
- `F = 10000 + OH` when the switch is on, and `F = 10000` when it is off.
- Rounding `rnd()` = round half away from zero to a whole cent. It is applied **once** at the step marked ⟨round⟩ (ADR 0004).

1. **Entry rate.** Use `time_entries.cost_rate_cents` when it is not null (frozen on approval). Otherwise (submitted, not yet approved) use the rate lookup from DATA_MODEL: the person's override effective on `work_date`, else their role's rate. If neither exists, the entry's hours still count toward hours, but the entry contributes 0 cost and its hours are added to the footer warning (Rule 15).
2. **Hours in integer form.** Store hours as `numeric(…,2)`. Convert each entry to hundredths: `hh = hours × 100` (an integer). Never multiply floats.
3. **Person cost in a phase** ⟨round⟩:
   `personCost(p, phase) = rnd( Σ_entries(hh × rate_cents) × F / (100 × 10000) )`
   Compute it with `bigint`.
4. **Phase cost** = Σ `personCost` over the people in the phase. The person rows therefore always add up to the phase cost exactly. Mapping to DATA_MODEL: when F = 10000 this is `laborCost`, and when F = 10000 + OH it is `laborCostWithOverhead`.
5. **Profit to date** = `phaseBilled − phaseCost`. This is DATA_MODEL `phaseProfit(phase, includeOverhead)`.
   - Display: if `used = 0` and `phaseBilled = 0`, show "—" with the note "Not started".
   - Otherwise show the value. Its note is `"{rnd(profit×100/billed)}% margin"` when billed > 0, or "Work not billed yet" when billed = 0.
6. **Remaining hours** = 0 if status ∈ {complete, closed}. Otherwise it is `max(0, budget_hours − used)`.
7. **Remaining cost** ⟨round⟩ = `rnd( remaining_hh × planned_rate_cents × F / (100 × 10000) )`.
8. **Projected profit** = `fee_cents − (phaseCost + remainingCost)`.
   - Projected margin = `rnd(projected × 100 / fee_cents)`.
   - When `fee_cents = 0`, show "—" for both, with the note "No fee" (e.g. Close Out, or an hourly phase with no estimate).
   - For NTE phases the fee is the cap. For hourly phases it is the estimate.
9. **Planned cost rate** = `project_phases.planned_cost_rate_cents` when it is set. Otherwise fall back, in order:
   - (a) the phase's actual blended rate `laborCost/used` (F = 10000), if used > 0;
   - (b) the project's blended rate Σ laborCost / Σ used, if > 0;
   - (c) the simple mean of current `cost_rate_cents` for active memberships with a rate.
   - In the detail note, a fallback rate is labelled "(estimated)".
10. **Person rate shown.** If every entry for that person in the phase has the same rate `r`, show `rnd(r × F / 10000)` as "$95 / h", or "$99.20 / h" when the rate has cents. If the rates differ, show `rnd(personCost × 100 / hh)` followed by " / h (blended)".
11. **Totals row.**
    - Hours: Σused / Σbudget.
    - Fee, Billed, Cost and Projected: the sum of the rounded phase values. Rows with "—" add 0.
    - Profit: `Σbilled − Σcost`, red when negative.
    - Projected note: `"{rnd(Σprojected×100/Σfee)}% margin"`.
12. **Detail note.** "$X" in a note is rounded to whole dollars, because these are "about" amounts.
    - **Complete/closed**, with `over = used − budget > 0`: "Finished {over} h over budget. Those hours cost about {$ rnd(over×planned×F/10000)} in profit." Otherwise: "Finished within budget."
    - **Current, or upcoming with time logged:**
      - If used ≤ budget: "{budget−used} budget hours left. At the planned rate that's about {$ remainingCost} more {labor\|cost} before this phase is billed in full." Use "labor" when the switch is off and "cost" when it is on.
      - If used > budget: "{over} h over budget and still in progress."
    - **Upcoming with no time:** "No time logged yet. Budget: {budget} h at a planned {$ rnd(planned×F/10000)} / h", followed by " with overhead." when the switch is on, or "." when it is off.
13. **Footer sentence**
    - Switch off: "Labor cost = hours × each person's cost rate (Settings → Roles & rates). Overhead isn't included, so true profit is lower. Turn on “Include overhead” to see it."
    - Switch on: "Cost = hours × cost rate × {F/10000 to 2 decimals} (labor plus {OH%} overhead from Settings). Profit shown is true profit. Projected profit = fee − cost so far − remaining budget hours at the planned rate, with overhead."
14. **Server output.**
    - `getProjectSnapshot(projectId)` returns, per phase: `{ hours, budget, fee, billed, people[], laborOnly: {cost, profit, remainingCost, projected, …}, withOverhead: {…} }`, plus totals for both variants.
    - Raw `cost_rate_cents` per entry is not returned. Only the per-person rate and cost are.
    - The query aggregates in SQL (`group by project_phase_id, membership_id, cost_rate`) and does not fetch individual entries.
15. **Missing rates.** The footer warning lists the total hours from Rule 1 that have no rate. A phase with such hours shows its cost with a trailing "*".

### Worked example: Medical Office Building (fixture F2 in `release-1/project-detail.md`)
**Inputs**
- Cost rates: BM 9500, JR 6200, KL 4400, AP 5200 (¢/h). OH = 6000.
- Planned rates (`planned_cost_rate_cents`): PD 7000, SD 5800, DD 5200, CD 5000, Permitting 6000, CA 6600, CO null.
- Close Out has fee 0, so its rate is never used.

**Labor per phase (F = 10000)**
- PD: 24×9500 + 22×6200 + 12×4400 = 228,000 + 136,400 + 52,800 = **417,200¢**
- SD: 14×9500 + 92×6200 + 66×4400 + 29×5200 = 133,000 + 570,400 + 290,400 + 150,800 = **1,144,600¢**
- DD: 4×9500 + 50×6200 + 10×4400 = 38,000 + 310,000 + 44,000 = **392,000¢**

**With overhead (F = 16000)** each figure is multiplied by 1.6:
- PD 667,520
- SD 1,831,360 (BM 212,800 + JR 912,640 + KL 464,640 + AP 241,280)
- DD 627,200

**DD projected, overhead on:**
- remaining = 310 − 64 = 246 h
- remainingCost = rnd(24,600 × 5200 × 16000 / 1,000,000) = 2,046,720
- projected = 4,650,000 − (627,200 + 2,046,720) = **1,976,080¢ ($19,760.80)**
- margin = rnd(42.496) = **42%**

**Switch OFF (labor only)**

| Phase | Hours | Fee | Billed | Labor cost | Profit to date | Projected profit |
|---|---|---|---|---|---|---|
| Pre-Design | 58 / 62 h · 94% | $9,300 | $9,300 · 100% | $4,172 | $5,128 · 55% margin | $5,128 · 55% margin · final |
| Schematic Design | 201 / 186 h · 108% | $27,900 | $27,900 · 100% | $11,446 | $16,454 · 59% margin | $16,454 · 59% margin · final |
| Design Development | 64 / 310 h · 21% | $46,500 | $0 · 0% | $3,920 | −$3,920 · Work not billed yet | $29,788 · 64% margin |
| Construction Documents | 0 / 434 h · 0% | $65,100 | $0 · 0% | — | — · Not started | $43,400 · 67% margin |
| Permitting | 0 / 62 h · 0% | $9,300 | $0 · 0% | — | — · Not started | $5,580 · 60% margin |
| Construction Admin | 0 / 186 h · 0% | $27,900 | $0 · 0% | — | — · Not started | $15,624 · 56% margin |
| Close Out | 0 / 0 h | $0 | $0 · — | — | — · Not started | — · No fee |
| **Total** | 323 / 1,240 h | $186,000 | $37,200 | $19,538 | $17,662 | $115,974 · 62% margin |

How the projected values were reached (off):
- DD: 4,650,000 − (392,000 + 246×5200 = 1,279,200) = 2,978,800
- CD: 6,510,000 − 434×5000 = 4,340,000
- Permitting: 930,000 − 62×6000 = 558,000
- CA: 2,790,000 − 186×6600 = 1,562,400

**Switch ON (cost + overhead, factor 1.60)**

| Phase | Cost + overhead | Profit to date | Projected profit |
|---|---|---|---|
| Pre-Design | $6,675.20 | $2,624.80 · 28% margin | $2,624.80 · 28% margin · final |
| Schematic Design | $18,313.60 | $9,586.40 · 34% margin | $9,586.40 · 34% margin · final |
| Design Development | $6,272 | −$6,272 · Work not billed yet | $19,760.80 · 42% margin |
| Construction Documents | — | — · Not started | $30,380 · 47% margin |
| Permitting | — | — · Not started | $3,348 · 36% margin |
| Construction Admin | — | — · Not started | $8,258.40 · 30% margin |
| Close Out | — | — · Not started | — · No fee |
| **Total** | $31,260.80 | $5,939.20 | $73,958.40 · 40% margin |

(Hours, Fee and Billed are unchanged from the table above.)

**Expanded SD, switch on:**

| Person | Hours | Rate | Cost |
|---|---|---|---|
| BM | 14 | $152 / h | $2,128 |
| JR | 92 | $99.20 / h | $9,126.40 |
| KL | 66 | $70.40 / h | $4,646.40 |
| AP | 29 | $83.20 / h | $2,412.80 |

Σ = $18,313.60. Note: "Finished 15 h over budget. Those hours cost about $1,392 in profit." (15 × 5800 × 1.6 = 139,200¢.) With the switch off, the same note says "$870".

**Other notes**
- DD, off: "246 budget hours left. At the planned rate that's about $12,792 more labor before this phase is billed in full."
- DD, on: "…about $20,467 more cost…"
- CD, off: "No time logged yet. Budget: 434 h at a planned $50 / h."
- CD, on: "…a planned $80 / h with overhead."

**Rounding example (Rule 3)**
- 0.25 h at 4401¢: hh = 25, 25 × 4401 = 110,025, then / 100 = 1,100.25 → **1,100¢** off.
- On: 110,025 × 16000 / 1,000,000 = 1,760.4 → **1,760¢**.
- A negative midpoint rounds away from zero: −2.5 → −3 (unlike JS `Math.round`, which gives −2).

## States
- **Empty** (project has phases but no counted time and no billing): the table still renders every row with "—" costs. Projected values use planned rates. The footer adds "No time logged yet."
- **No phases:** the card shows the Empty state "No phases yet" with a link to Phases & fees.
- **Loading:** a skeleton card with header and 7 row bars, streamed via `<Suspense>` so the KPI tiles render first.
- **Error:** in-card "Couldn't load the snapshot. Try again." with Retry; Sentry report. The rest of Overview still renders.
- **Permission denied:** for PM and staff the section is not rendered, and the Release 1 Hours vs budget card shows for PMs. A direct call to `getProjectSnapshot` as a PM throws `forbidden`, which is caught and logged and never rendered.
- **Overhead rate 0:** the switch still works, and both variants are equal. The caption reads "0% of labor".

## Out of scope (for this release)
- **Earned value / WIP column** (`phaseEarned`: fixed → fee × % complete; hourly → hours × bill rate; NTE → min(hourly earned, cap)). This belongs in Reports, Release 2, and could be added here later.
- **Expenses and consultant costs in profit.** Only labor (± overhead) is cost here. Adding `expenses` and `vendor_bills` is an Accounting decision, also Release 2 (see Open questions).
- **Per-project overhead rate overrides.**
- **Editing planned rates from the snapshot.** They are edited on the Phases & fees tab once the column exists.
- **Export to CSV/PDF.**

## Acceptance tests
Unit tests (`src/lib/calc/snapshot.test.ts`) use fixture F2 from `release-1/project-detail.md`, plus `planned_cost_rate_cents` PD 7000, SD 5800, DD 5200, CD 5000, Permitting 6000, CA 6600.

- [ ] Given F2 with the switch off, when the snapshot is computed, then the phase costs are 417,200 / 1,144,600 / 392,000 / 0 / 0 / 0 / 0, and the total cost is 1,953,800.
- [ ] Given F2 with the switch on (OH 6000), then the phase costs are 667,520 / 1,831,360 / 627,200 and the total cost is 3,126,080.
- [ ] Given F2 with the switch off, then profit to date is PD 512,800 (55%), SD 1,645,400 (59%), DD −392,000 ("Work not billed yet"), and CD "Not started"; the total profit is 1,766,200.
- [ ] Given F2 with the switch on, then profit to date is PD 262,480 (28%), SD 958,640 (34%), DD −627,200; the total profit is 593,920.
- [ ] Given F2 with the switch off, then projected is PD 512,800 final, SD 1,645,400 final, DD 2,978,800 (64%), CD 4,340,000 (67%), Permitting 558,000 (60%), CA 1,562,400 (56%), CO "—"; the total is 11,597,400 (62%).
- [ ] Given F2 with the switch on, then projected is DD 1,976,080 (42%), CD 3,038,000 (47%), Permitting 334,800 (36%), CA 825,840 (30%); the total is 7,395,840 (40%).
- [ ] Given F2, then for SD the person costs sum exactly to the phase cost in both modes.
- [ ] Given F2, then the SD remaining hours are 0 even though used > budget, because the phase is complete.
- [ ] Given DD changed to 320 h used (over its 310 h budget) and still current, then remaining = 0 and the note reads "10 h over budget and still in progress."
- [ ] Given one entry of 0.25 h at 4401¢, then the cost is 1,100 off and 1,760 on.
- [ ] Given `rnd(-2.5)`, then the result is −3.
- [ ] Given DD has `planned_cost_rate_cents = null`, then the planned rate falls back to 392,000 / 64 = 6,125¢, and the note says "(estimated)".
- [ ] Given a submitted (unapproved) 2 h entry by KL on DD with no frozen rate, then the cost uses KL's rate effective on the work date (4400) and DD's cost becomes 400,800 off.
- [ ] Given a submitted entry whose person has no rate, then its hours count, its cost is 0, and the footer warns "2 h have no cost rate".

End-to-end (Playwright):
- [ ] Given F2 and `include_overhead_default = true`, when BM opens Overview, then the switch is on, the column header reads "Cost + overhead", and the SD cost reads "$18,313.60".
- [ ] Given that state, when BM turns the switch off, then the header reads "Labor cost", SD reads "$11,446", the total projected reads "$115,974" with "62% margin", the URL has `overhead=off`, and no network request for snapshot data is made.
- [ ] Given F2, when BM clicks "Schematic Design", then the detail row shows 4 people, and with the switch on, JR's rate reads "$99.20 / h".
- [ ] Given F2 as JR (PM), when JR opens Overview, then there is no snapshot section, the Hours vs budget card is shown, and the page HTML/RSC payload contains none of the strings "Cost + overhead", "Labor cost", "11,446" or "Profit".
- [ ] Given F2 as KL (staff), then no snapshot section and no Hours vs budget card render.
- [ ] Given F2, then the Close Out row is shown with Fee $0 and Projected "—", and the totals still equal the table above.

## Open questions
1. **Data model addition needed:** `project_phases.planned_cost_rate_cents bigint null`. The mockup uses a "planned blended cost rate for remaining hours" (PLAN_RATE) per phase. Confirm the fallback order in Rule 9, or whether to require the field.
2. Should profit to date use **billed**, as the mockup does (which makes DD look −$6,272 until it is invoiced), or **earned** (fixed: fee × % complete)? Earned gives DD at 30% = $13,950 earned, so a +$7,678 profit with overhead. This spec follows the mockup and uses billed.
3. Should snapshot cost include project expenses and consultant (vendor bill) costs once Accounting exists, or stay labor-only?
4. Should the overhead switch remember each user's last choice (`memberships` preference), or always start at the firm default? This spec uses the firm default plus the URL.
5. Written-off invoices count as billed (matching `invoicing.md`), which overstates profit when a write-off happens. Should a written-off balance be subtracted from billed in the snapshot? This ties to Release 2 Accounting write-off handling.
6. The mockup hides Close Out ($0, 0 h); this spec shows every phase. Should phases with fee 0, budget 0 and no hours be hidden?
