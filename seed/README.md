# Seed data

`seed-data.json` is demo data for the firm **Demo Architecture Studio** (slug `demo`). It is pulled from the mockup's JS blocks (Settings, Team, Contacts, Projects, Project, Time, Accounting) and from the seed examples in `docs/specs/release-1/*`. `pnpm db:seed` loads it.

## What's in it

One top-level key per Release 0–1 table, in load order. Columns are exactly as written in `docs/DATA_MODEL.md`: money in integer cents, percentages in basis points, hours as plain numbers.

| Table | Rows | Notes |
|---|---|---|
| firms, firm_settings | 1, 1 | overhead 6000 bp, `next_invoice_number` 128, all 7 add-on modules on |
| users, memberships, teams | 14, 14, 4 | Team mockup people (BM … OK); fake names, `@example.com` emails |
| firm_roles, rates | 8, 8 | Settings roles; one role rate each, from 2026-01-01 (BM $95, JR $62, KL $44, AP $52 cost) |
| phase_templates, activities, overhead_categories | 7, 30, 6 | PD/SD/DD/CD/PRM/CA/CO; 13 project activities; Marketing, Administration, Professional development, Firm standards, plus leave categories Paid time off and Holiday |
| companies, contacts | 20, 24 | |
| projects, project_phases, project_members, consultants | 12, 84, 44, 8 | the 10 active and 2 closed projects from the Projects page |
| timesheets, time_entries | 53, 1,596 | see "Time" below |
| invoices, invoice_lines, payments | 32, 59, 19 | includes the MOB draft (DD 30 %, `number` null) |

**Ids** are stable, readable strings that the seed script maps to UUIDs: `firm_demo`, `user_bm`, `mem_bm`, `role_designer`, `team_medical`, `co_palmetto`, `contact_palmetto_ap`, `proj_mob`, `phase_mob_sd`, `pm_mob_kl`, `cons_mob_mep`, `ts_kl_20261012`, `te_kl_20261012_03`, `inv_2026_121`, `inv_mob_draft`, `line_2026_121_1`, `pay_2026_109_1`. Every firm-owned row has `firm_id: "firm_demo"`. `clerk_user_id` / `clerk_org_id` are placeholders (`seed_clerk_bm`, `org_seed_demo`). Link them to your dev Clerk accounts, with BM as the owner.

**Circular references:** `teams.leader_membership_id` ↔ `memberships.team_id` and `companies.billing_contact_id` ↔ `contacts.company_id` point at each other. Insert those rows with the field set to null, then update it.

## Consistency rules checked

A verification script checked all of these and passed:

- Every id is unique, and every foreign key points at an existing row (6,414 references). A project's client contact and a company's billing contact belong to that company.
- Each project's phase fees add up to its mockup fee (MOB $186,000 → 9,300 / 27,900 / 46,500 / 65,100 / 9,300 / 27,900 / 0).
- Each project's billed amount (lines on sent, partially paid and paid invoices) equals the Projects page billed % × fee. For MOB that is $37,200 billed, $26,040 received and $11,160 outstanding on 2026-121.
- Invoice lines add up to the subtotal and total. `amount_paid_cents` equals the sum of payments, and the status matches it. Cumulative billing on a phase never exceeds its fee, a line's `percent_complete_bp` matches the cumulative amount, and a phase's % complete is at least its billed %.
- The open invoices match the Accounting receivables list (after the Pine change below). Contacts billed/open match for all 8 mockup clients, and the clients missing a billing contact are Coastal and Mill Creek (2).
- Time entries: hours are positive quarter hours; each entry has either a phase or an overhead category, never both; the activity matches the entry's scope; the work date falls inside the week and the phase dates; the person is a project member; no day exceeds 24 h. Approved timesheets have frozen role rates; all other entries have null rates. No one approves their own timesheet.
- MOB used hours (submitted + approved) per phase and person match project-detail fixture F2: PD 58, SD 201, DD 64 = 323 h. KL's 8 h draft on DD is not counted.
- Week of Oct 12 matches the Time mockup: BM's draft is 8 / 7.5 / 8 / 6 / 3 = 32.5 h at 86 % billable, and each approvals row has its day totals, billable % and status. CF and NB have no timesheet. BM's History weeks Aug 31 – Oct 5 match their totals and billable hours.
- Project health computes to the mockup labels: MOB At risk, Summerville Over budget, the others On track.
- Settings and Team KPIs: $126 / h blended rate, 2.54× average multiplier, 14 people, 12 billable, 464 h capacity.

## Time

The request was "two weeks for a few people". The specs need more than that, so the seed has more:

- BM, JR, KL and AP have approved weeks from Aug 3 to Oct 5. That is the only way MOB's PD and SD hours (58 h and 201 h) can come from real entries.
- Everyone who appears in the approvals list has their week of Oct 12.
- KL has an 8 h draft for Oct 19 (fixture F2).
- Holidays: Labor Day for JR, KL and AP. AP also has one vacation day.

## Mockup numbers I adjusted, and why

| What | Mockup | Seed | Why |
|---|---|---|---|
| Pine Street Bistro invoices | 2026-104 $14,800 + 2026-127 $12,710 = $27,510 billed | 2026-104 **$8,200** (PD + SD), 2026-127 **$4,510** (DD 44 %), so $12,710 billed and open | $27,510 is more than the whole fee through DD ($18,450) and contradicts Projects "31 %". The Projects page wins. Accounting receivables total becomes $169,450. |
| Companies / people count | 16 / 17 (contacts.md acceptance test) | 20 / 24 | Harbor View Dental Group, Riverside Partners LLC, Ashley River Dental and Westside Auto Group are project clients that are missing from Contacts. Pine, Grove and Oakmont say "billing contact set" but list no one. Clients with open balances becomes 9, because Westside has the open 2025-188. |
| Placeholder companies | `[General contractor]`, `[County] …`, `[Print shop]` | Marsh Point Builders, Demo County Building Department / Planning & Zoning, Harbor Reprographics | They need real names. Agencies use kind `other` until `agency` is added (milestone 1.2). |
| Consultant fees | LCG $23,200 total, TSE $18,200 total | Riverside civil $12,000, Oakmont civil $6,500, Summerville structural $16,500 | The Payables bills (LCG-1138 $8,900 on Riverside, TS-0874 $4,180 on Summerville) don't fit those totals. MOB's consultant fees ($75,900) are unchanged. |
| MOB PD / SD status | F2 says `complete` | `closed` | `timesheet.md` expects "Schematic Design · closed" (it can't take time). The stepper shows both statuses as "Done". |
| Northside CA | fee type not shown | `hourly`, $14,700 estimate | Ready to bill shows "CA · hourly". 2026-125 bills JR 15 h and KL 6 h of approved CA time (Sep 16–30), and those entries carry `invoice_id`. |
| Utilization (Team) | 46–90 % for everyone | BM 86 %, JR 67 %, KL 88 %, AP 71 %, others 0 % | Only four people have history before Oct 12. BM follows the Time History (84–88 % billable), not the Team mockup's 46 %. Full-time history for everyone would push every project over its fee-based budget. |
| October collections | $54,940 (5 receipts) | $51,840 (4) | The Bayside PT $3,100 retainer has no invoice, and Bayside is a pursuit (Marketing, Release 3). |
| Pipeline projects, AS-01, 2026-119 | shown | omitted | Bayside and Lakeview belong in Marketing. Adding the $3,200 AS-01 additional service would change MOB's $186,000. 2026-119 would bill Riverside, which is 0 % billed. |
| Ready to bill, invoice drawer split | dollar amounts, 80/16/4 split | not seeded | They are computed in the app. Release 1 invoices use phase-fee lines only, plus Northside's hourly lines. |
| `next_invoice_number` | DATA_MODEL says 121 | 128 | 2026-121 to 2026-127 already exist (invoicing.md open question 7). |
| `modules_enabled` | Settings mockup includes Schedule | the 7 add-ons | Per DATA_MODEL "Schema additions" (0.5). |
| NB (invited) | no login yet | user + membership with `clerk_user_id` null | This keeps the 14 people and 12 billable staff that Team expects. Move NB to `invitations` when that table arrives (0.6). |

Other choices:

- **Invented data:** past invoices, their dates and payments, phase dates outside MOB, addresses and square footage are made up. They are consistent with each other and with the totals above.
- **Budgets and line percentages:** budget hours are phase fee ÷ $150, which is MOB's ratio. Grove's $0 Close Out gets 16 h so its health stays On track. Some historical lines have uneven percentages (for example DD 47.92 %); `amount_cents` is the source of truth there.
- **Fields not seeded:** scope kind (Ground-up / Tenant upfit / Shell), contact designations, company descriptions, role descriptions and `is_billable`, PTO/HOL codes, per-entry approvals, and timesheet rows. They are not in DATA_MODEL yet. Designations and descriptions are kept in each row's `notes`.
- **Two-step approval:** the mockup's leader-then-principal steps both map to `submitted`.
