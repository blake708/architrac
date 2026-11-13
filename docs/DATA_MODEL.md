# ArchiTrac Data Model

This is the source of truth for the database. Claude Code builds the Drizzle schema (`src/db/schema/*.ts`) from this file. When the schema changes, update this file in the same pull request.

## Global rules (apply to every table)

1. **Primary keys** are `id uuid default gen_random_uuid()`.
2. **Every firm-owned table has `firm_id uuid not null references firms(id)`**, indexed. Row-level security (RLS) policies restrict every query to the current firm (see `docs/ARCHITECTURE.md` → Multi-tenancy).
3. **Timestamps:** `created_at timestamptz default now()`, `updated_at timestamptz` (set by trigger or app), `created_by uuid references users(id)`.
4. **No hard deletes.** Use `archived_at timestamptz null`. Queries filter `archived_at is null` by default.
5. **Money is stored in integer cents** (`bigint`), column names end in `_cents`. Never use float/decimal for money. Format only in the UI.
6. **Hours are stored as `numeric(6,2)`** (quarter-hour resolution is enforced in the app).
7. **Percentages are stored as basis points** (`integer`, 6000 = 60.00%), column names end in `_bp`.
8. **Enums** are Postgres enums defined in `src/db/schema/enums.ts`.
9. **Names:** snake_case tables (plural) and columns. TypeScript types are PascalCase singular (`Project`).
10. Every table that matters for history writes to `activity_log` (see bottom).

---

## Release 0 — Foundation

### firms
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | "The Middleton Group" |
| slug | text unique | used in URLs if needed |
| clerk_org_id | text unique | link to the login provider's organization |
| display_name | text null | shown in the app and on letterhead; null = use `name` (0.6) |
| logo_url | text null | |
| address_line1, address_line2, city | text null | same names as `companies` (0.6) |
| state | text null | 2-letter code (0.6) |
| postal_code | text null | `12345` or `12345-6789` (0.6) |
| phone | text null | stored formatted `(843) 555-0100` (0.6) |
| email | text null | firm's general email; not on the form yet (0.6) |
| website | text null | lowercase, no `https://` or trailing `/` (0.6) |
| license_number | text null | firm license / COA number (0.6) |
| timezone | text | default `America/New_York` |
| fiscal_year_start_month | smallint | 1–12 |
| created_at, updated_at | | |

### users
One row per person who can log in (any firm). Identity comes from the login provider.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| clerk_user_id | text unique | |
| email | citext unique | |
| first_name, last_name | text | |
| initials | text | "BM"; computed on create, editable |
| avatar_url | text null | |

### memberships
A user's role inside a firm. A user can belong to more than one firm (consultants, future).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| firm_id | uuid fk | |
| user_id | uuid fk | |
| app_role | enum `app_role` | `owner`, `admin`, `project_manager`, `staff` |
| title | text | "Principal", "Project Architect" |
| firm_role_id | uuid fk → firm_roles null | billing role, drives default rates |
| team_id | uuid fk → teams null | |
| employment_type | enum | `full_time`, `part_time`, `contract` |
| weekly_capacity_hours | numeric(5,2) | default 40, used by Workload |
| target_utilization_bp | integer | e.g. 8000 = 80% |
| phone | text null | stored formatted "(843) 555-0100" (1.3) |
| license_note | text null | "Licensed architect · SC, NC" (1.3) |
| start_date | date null | "With firm since" (1.3) |
| is_principal | boolean | default false; final timesheet approval, Principal in Charge (1.3) |
| active | boolean | default true |
| unique (firm_id, user_id) | | |

### firm_settings
One row per firm.
| column | type | notes |
|---|---|---|
| firm_id | uuid pk fk | |
| overhead_rate_bp | integer | 6000 = 60% (mockup default) |
| default_consultant_markup_bp | integer | 1000 = 10%; new consultants start here (1.5) |
| include_overhead_default | boolean | default true; the snapshot switch starts here |
| week_starts_on | smallint | 0 = Sunday, 1 = Monday |
| timesheet_increment_minutes | smallint | 15 |
| timesheet_lock_day | smallint | day of week timesheets are due (the first one on or after the week's 5th day) |
| timesheet_due_time | time | 09:00; time of day they're due, firm time zone (1.6, decision #21) |
| timesheet_notes_rule | enum `timesheet_notes_rule` | `optional` (default), `hourly` (billable days on `hourly`/`nte` phases need a note to submit), `all` (every billable day with hours does). 1.6, decisions #17 and #24; replaced `billable_notes_required` (migrations 0011–0012) |
| invoice_number_format | text | `{YYYY}-{###}` (default). Tokens `{YYYY}` `{YY}` `{PROJECT}` and a counter `{#}`…`{######}`; must contain exactly one counter. Replaces `invoice_prefix` in 1.8 A (decision #5) |
| next_invoice_number | integer | firm-wide counter, used when the format has no `{PROJECT}`. 128 in the seed (2026-121 … 2026-127 already exist) |
| project_number_format | text | `{YYYY}-{###}` (default; TMG uses `{YY}{###}` → `26031`). Tokens `{YYYY}` `{YY}` and one counter `{#}`…`{######}`; drives the suggested number on New project (1.8 A, decision #28) |
| default_payment_terms_days | smallint | 30 |
| modules_enabled | text[] | `'{}'` (valid keys: `build`,`workload`,`accounting`,`marketing`,`knowledge`,`code`,`website`,`hiring`) |

### teams
| id | firm_id | name | leader_membership_id | sort_order |

### invitations  (0.6, Settings → Users & access)
Someone invited who hasn't joined yet. They have no `users` row until they accept, so this is its own table and `memberships.user_id` stays required. Clerk sends the email; we keep the app role, title and (1.3) the Team profile, copied to the membership on acceptance. Rows are never deleted.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| firm_id | uuid fk | RLS |
| email | citext | |
| app_role | app_role | role they get on joining |
| title | text null | |
| firm_role_id | uuid null | same-firm FK → firm_roles (1.1) |
| first_name, last_name | text null | shown while invited (1.3, Team → Invite person) |
| team_id | uuid null | same-firm FK → teams (1.3) |
| employment_type | enum null | (1.3) |
| weekly_capacity_hours | numeric(5,2) null | (1.3) |
| target_utilization_bp | integer null | (1.3) |
| status | enum `invitation_status` | `pending`, `accepted`, `revoked`, `expired` |
| clerk_invitation_id | text unique null | null only if the Clerk call failed |
| invited_by | uuid fk → users | |
| invited_at | timestamptz | reset by Resend |
| accepted_at | timestamptz null | |
| membership_id | uuid null | same-firm FK `(firm_id, membership_id) → memberships (firm_id, id)` |
| created_at, updated_at | | |
| unique (firm_id, email) where status = 'pending' | | one open invite per email |

### Release 0 implementation notes (milestone 0.2)
- Schema lives in `src/db/schema/` (`firms.ts`, `people.ts` = users + memberships + teams, `activity-log.ts`, `enums.ts`). Migrations in `src/db/migrations/`.
- Added per the global rules: `created_at`/`updated_at` on every table; `archived_at` on firms, users, memberships, teams; `created_by` on memberships and teams. `activity_log` is append-only (`created_at` only).
- **Row-level security:** memberships, firm_settings, teams, activity_log, invitations (ENABLE + FORCE, keyed on `firm_id`); firms (ENABLE, keyed on `id`; not FORCEd so the owner-run lookup below works). Outside `withFirm` these tables return no rows.
- **users** has no `firm_id` and no RLS (a person can belong to several firms). Reach users through memberships. Revisit in 0.3.
- **Same-firm foreign keys:** `memberships (firm_id, team_id) → teams (firm_id, id)` and `teams (firm_id, leader_membership_id) → memberships (firm_id, id)`. Plain FKs ignore RLS; these stop a row pointing at another firm's row. Use the same pattern for every new firm-to-firm link.
- `memberships.firm_role_id` has no FK until `firm_roles` exists (1.1).
- `firm_id_for_clerk_org(text) → uuid`: security-definer function, the only cross-firm lookup; maps Clerk's active org to a firm id before `withFirm`.
- The app role (`architrac_app`) has SELECT/INSERT/UPDATE only. No DELETE, so "no hard deletes" is enforced by the database.
- Defaults: `firm_settings.modules_enabled` = `{}` (new firms start with no add-ons), `next_invoice_number` = 1, `invoice_number_format` = `{YYYY}-{###}`. The TMG seed sets its own values.

---

## Release 1 — Run TMG

### firm_roles  (Settings → Roles & rates)
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | "Principal", "Project manager", "Project architect", "Designer"… (see settings spec seed). Unique per firm (ignoring case) among non-archived roles |
| description | text null | note under the name ("Owners and partners") |
| is_billable | boolean | default true; false = overhead role, bill rate always 0 |
| sort_order | smallint | |
| archived_at | timestamptz null | |

`memberships.firm_role_id` and `invitations.firm_role_id` point here (same-firm composite FK, 1.1).

### rates
Effective-dated so old time keeps the rate in force when it was worked.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| firm_role_id | uuid fk null | role default rate |
| membership_id | uuid fk null | per-person override; exactly one of role/membership is set |
| bill_rate_cents | bigint | hourly billing rate |
| cost_rate_cents | bigint | hourly cost (BM 9500, JR 6200, KL 4400, AP 5200) |
| effective_from | date | |
| effective_to | date null | null = current |

Constraints (1.1): one role's (or one person's) periods never overlap (`EXCLUDE USING gist`, needs `btree_gist`); `effective_to ≥ effective_from`; amounts ≥ 0. A change from date D closes the current row on D − 1 and inserts a new one (settings-rates-phases rule 8).

**Rate lookup rule** (ADR 0008, `resolveRate`): for a time entry on date D for person P on project X:
- **Bill:** P's `project_members.bill_rate_override_cents` on X → the rate of P's role on X (`project_members.firm_role_id`) effective on D → P's person override → P's own role.
- **Cost:** P's pay effective on D (`membership_pay`) → P's person override → P's own role.
- Either missing → error (block approval). The role frozen on the entry is P's role on X, else their own.

### membership_pay  (Team drawer → Pay, ADR 0008; owner/admin only)
Effective-dated like rates. A person's hourly cost is worked out from it and replaces their role's cost rate.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| membership_id | uuid fk | same-firm composite FK |
| pay_type | enum pay_type | `salary` | `hourly` |
| amount_cents | bigint | annual salary, or hourly wage |
| burden_bp | integer | taxes and benefits on top, 0–20000 (2500 = 25%) |
| effective_from | date | |
| effective_to | date null | null = current |
| created_by, created_at, updated_at | | |

Constraints: one person's periods never overlap (`EXCLUDE USING gist`); dates in order; amount ≥ 0. A change from date D closes the current row on D − 1 and inserts a new one, like rates. Cost/hour: salary ÷ (weekly hours × 52) × (1 + burden), or wage × (1 + burden), rounded half up (`hourlyCostCents`). The activity log says pay changed, never the amounts.

### phase_templates  (Settings → Phases & fees)
Firm's standard phase list. Default phases are copied to every new project; optional phases are offered when adding a phase to a project.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| code | text | "SD"; unique per firm (ignoring case) among non-archived rows, across both lists |
| name | text | "Schematic Design"; unique like code |
| description | text null | copied to `project_phases.description` when the phase is created on a project |
| is_optional | boolean | default false. Optional ⇒ `default_fee_share_bp = 0` (check) |
| default_fee_type | enum `fee_type` | `fixed`, `hourly`, `nte`. Default phases: fixed |
| default_fee_share_bp | integer | 0–10000. Default phases add up to 10000 (checked on save) |
| sort_order | smallint | within its own list |
| archived_at | timestamptz null | |

Seed codes: PD, SD, DD, CD, PRM (Permitting), CA, CO (Close Out). Full seed values: `docs/specs/release-1/settings-rates-phases.md` → Seed values.

### project_type_benchmarks  (Settings → Phases → Project type ranges; 1.5 D)
Ranges New project's estimate uses when the firm has fewer than 3 similar past projects.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| project_type | text | matched to `projects.project_type` ignoring case |
| scope_kind | enum `scope_kind` null | null = any scope |
| cost_per_sf_low_cents, cost_per_sf_high_cents | bigint | low > 0, high ≥ low |
| fee_low_bp, fee_high_bp | integer | fee as a share of construction cost; 300 = 3%; low > 0, high ≥ low, ≤ 10000 |
| created_by | uuid fk users null | |
| created_at, updated_at, archived_at | timestamptz | |

Unique among non-archived rows: (firm, lower(type)) where scope is null, and (firm, lower(type), scope) where it isn't.

### activities
Activities a person picks on a timesheet row.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | "Design", "Drawings & production", "Coordination", "Meetings", "Site visit"… |
| applies_to | enum `activity_scope` | `project`, `overhead` |
| overhead_category_id | uuid fk null | for overhead activities, which category they belong to |
| sort_order, active | | removed = `active false`; adding the same name back reactivates the row |

Check: `applies_to = 'overhead'` exactly when `overhead_category_id` is set. Leave types are overhead activities under the `PTO` category.

### overhead_categories
Non-project "phases" (Settings → Time & approvals).
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| code | text null | `PTO`, `HOL` for the leave categories; unique per firm when set |
| name | text | "Marketing", "Administration", "Professional development", "Firm standards"; leave: "Paid time off", "Holiday" |
| is_leave | boolean | |
| sort_order, active | | |

New firms get the default phases, activities and categories from the database function `seed_firm_defaults(firm_id)` (migration 0003), called by createFirm. No roles.

### companies
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | |
| kind | enum `company_kind` | `client`, `consultant`, `contractor`, `agency` (1.2), `vendor`, `other` |
| description | text null | "Medical developer" (1.2) |
| phone, website | text | website stored with its scheme ("https://…") |
| address_line1, address_line2, city, state, postal_code | text | |
| primary_contact_id | uuid null | main contact; same-firm FK → contacts (1.2) |
| billing_contact_id | uuid null | same-firm FK → contacts; clients only |
| billing_email | text null | clients: shared AP address for invoices, e.g. ap@client.com (1.8 B, decision #32) |
| quickbooks_customer_id | text null | sync key |
| notes | text | |
| archived_at | timestamptz null | |

### contacts
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| company_id | uuid null | same-firm FK → companies |
| first_name | text | required |
| last_name | text | default "" |
| designations | text null | "PE", "LEED AP": shown after the name (1.2) |
| title, email, phone, mobile | text null | email stored lower-case |
| tags | text[] | default '{}'; no duplicates (ignoring case) |
| notes | text null | |
| archived_at | timestamptz null | |

### projects
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| number | text | firm's project number, unique per firm ignoring case ("2026-014") |
| name | text | "Medical Office Building" |
| client_company_id | uuid fk | |
| client_contact_id | uuid fk null | |
| status | enum `project_status` | `pursuit`, `active`, `on_hold`, `closed` |
| project_type | text | Medical office, Restaurant, Retail, Office, or the firm's own |
| scope_kind | enum `scope_kind` null | `ground_up`, `tenant_upfit`, `shell` (shown under the type) |
| address_line1, address_line2, city, state, postal_code | text null | as in `companies` |
| square_feet | integer null | |
| construction_cost_cents | bigint null | |
| principal_membership_id | uuid fk | Principal in Charge |
| pm_membership_id | uuid fk | |
| start_date, target_end_date | date null | end ≥ start |
| closed_on | date null | set when status becomes `closed` |
| quickbooks_customer_id | text null | sub-customer/job in QuickBooks |
| proposal_id | uuid fk null | set when converted from a won proposal (Release 3) |
| next_invoice_seq | integer | 1; per-project invoice counter, used when the number format has `{PROJECT}` (1.8 A, decision #5) |

### project_phases
The backbone: time, budgets, invoices and the snapshot all hang off this.
| column | type | notes |
|---|---|---|
| id, firm_id, project_id | | |
| code, name | text | copied from template, editable |
| description | text null | copied from the template, editable |
| sort_order | smallint | |
| fee_type | enum `fee_type` | `fixed`, `hourly`, `nte` (not-to-exceed) |
| fee_cents | bigint | fixed: the fee; nte: the cap; hourly: estimate (may be 0) |
| budget_hours | numeric(8,2) | |
| status | enum `phase_status` | `upcoming`, `current`, `complete`, `closed` (closed = no new time) |
| start_date, end_date | date null | |
| percent_complete_bp | integer | for fixed-fee billing (PM sets it) |
| budget_hours_manual | boolean | hours were typed in; fee changes and role mixes leave them alone (1.5) |
| is_additional_service | boolean | beyond the base contract; invoices can group these (1.5) |
| archived_at | timestamptz null | |

### phase_template_roles  (a default phase's role mix, Settings → Phases & fees)
| id, firm_id, phase_template_id, firm_role_id | share_bp (of the phase fee; a mix adds up to exactly 10000) | sort_order | archived_at; one active row per role per template |

### project_phase_roles  (a project phase's role mix)
| id, firm_id, project_phase_id, firm_role_id | share_bp | rate_cents (the role's **bill** rate on the day of the edit) | hours (share × phase fee ÷ rate, to the quarter hour) | sort_order | archived_at |

Phase budget hours = Σ role hours unless `budget_hours_manual`. A phase with no mix uses the firm's blended bill rate. Changing a phase's fee recalculates its role hours at that day's rates (Blake, 2026-11-03).

### project_members
| id, firm_id, project_id, membership_id | firm_role_id uuid fk null (their billing role on this project; defaults to their own role, ADR 0008) | bill_rate_override_cents null | archived_at; one active row per person per project |

`project_role` (free text) was replaced by `firm_role_id` in migrations 0022–0023. PM and Principal labels come from `projects.pm_membership_id` / `principal_membership_id`.

### project_contacts  (contractors, agencies, vendors on a project)
| id, firm_id, project_id, company_id | contact_id null | role text null ("General contractor") | archived_at |

### consultants  (project's sub-consultants)
| id, firm_id, project_id, company_id (kind consultant) | contact_id null (falls back to the company's billing contact) | discipline text ("MEP", "Structural", "Civil") | fee_cents ≥ 0 | markup_bp 0–10000 (new ones start at `firm_settings.default_consultant_markup_bp`) | billed_through boolean | percent_complete_bp 0–10000 (progress billing, 1.8 B, decision #31) | archived_at |

### timesheets  (1.6)
One per person per week. Created on the first write for that week, never on view.
| column | type | notes |
|---|---|---|
| id, firm_id, membership_id | | |
| week_start | date | unique (membership_id, week_start) |
| status | enum `timesheet_status` | `draft`, `submitted` (in review: who it waits on comes from `timesheet_review_steps`), `approved`, `rejected` (returned). `leader_approved` was removed in 1.7 A |
| submitted_at | timestamptz null | |
| approved_at, approved_by | timestamptz / uuid fk users, null | final approval, or the principal at submit (decision #22) |
| rejected_at, rejected_by, rejection_note | null | written by 1.7 |

### review_steps  (1.7 A)
The firm's review route (decision #23). One route per firm; at least one non-archived step.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| sort_order | smallint | order of the steps |
| kind | enum `review_step_kind` | `principal_in_charge`, `team_leader`, `any_principal`, `person` |
| membership_id | uuid fk null | required when kind = `person`, null otherwise (check); same-firm FK |
| archived_at | | removed steps |

Unique while not archived: (firm_id, kind) for the three non-person kinds; (firm_id, membership_id) for `person`. New firms get one `principal_in_charge` step.

### timesheet_review_steps  (1.7 A)
One sheet's copy of the route, made at submit: one row per **required approver** per step (two PICs = two rows; `any_principal` = one row; a skipped step = one row).
| column | type | notes |
|---|---|---|
| id, firm_id, timesheet_id | | |
| step_no | smallint | 1, 2, … in route order |
| kind | enum `review_step_kind` | copied from the route |
| approver_membership_id | uuid fk null | who must approve; null for an `any_principal` row until a principal acts, and for skipped rows |
| status | enum `review_row_status` | `waiting`, `approved`, `skipped` |
| skip_reason | text null | `no_team`, `no_projects`, `is_submitter`, `inactive`, `already_reviewing`, `principal_already_approved` |
| acted_by, acted_at | uuid fk users / timestamptz null | who approved and when |
| on_behalf | boolean | default false; true when an owner/admin approved for the named approver |
| archived_at | | set on Recall and Return; resubmit builds a new set |

Current step = lowest `step_no` with a `waiting` row. Same-firm FKs to timesheets and memberships.

### timesheet_rows  (1.6)
A line on the weekly grid; exists before it has hours.
| column | type | notes |
|---|---|---|
| id, firm_id, timesheet_id | | |
| sort_order | smallint | |
| row_type | enum `timesheet_row_type` null | `project`, `overhead`, `leave`; null = not picked yet |
| project_id, project_phase_id | uuid fk null | project rows |
| overhead_category_id | uuid fk null | overhead and leave rows |
| activity_id | uuid fk null | |
| billable | boolean | project rows only |
| archived_at | | removed rows, and empty rows on submit |

### time_entries  (1.6)
One per row per day. Copies the row's selection so reports read this table alone.
| column | type | notes |
|---|---|---|
| id, firm_id, timesheet_id, timesheet_row_id | | unique (timesheet_row_id, work_date) while not archived |
| work_date | date | |
| project_id, project_phase_id | uuid fk null | |
| overhead_category_id | uuid fk null | |
| activity_id | uuid fk null | may be empty on a draft (decision #19); submit requires it |
| hours | numeric(5,2) | > 0, ≤ 24, multiple of 0.25 (check constraint) |
| note | text null | ≤ 500 chars |
| billable | boolean | only with a project |
| bill_rate_cents, cost_rate_cents | bigint null | **frozen on approval** (1.7) |
| firm_role_id | uuid fk null | the person's role, **frozen on approval** with the rates and cleared with them (1.8 B, decision #30); invoices group hourly lines by it |
| archived_at | | cleared days and removed rows |
| invoice_id | uuid fk null | the invoice it's reserved on (draft) or billed on (1.8). While set, a trigger locks hours, date, project, phase, rate, billable and archived_at, and its approved timesheet can't be reopened |

Checks: not both phase and overhead category; not both project and overhead category. Drafts count in hours used everywhere (decision #20).

### invoices
| column | type | notes |
|---|---|---|
| id, firm_id, project_id, client_company_id | | composite keys keep every link inside the firm |
| bill_to_contact_id | uuid fk null | defaults to the project's client contact, else the company's billing contact |
| number | text null | null while draft / in review; assigned at send from the number format; unique per firm (partial index), never reused |
| status | enum `invoice_status` | `draft`, `in_review`, `sent`, `partially_paid`, `paid`, `void`, `written_off`. One `draft`/`in_review` per project (partial unique index) |
| issue_date, due_date | date | |
| period_start, period_end | date | time cutoff |
| subtotal_cents, tax_cents, total_cents | bigint | |
| amount_paid_cents | bigint | maintained from payments |
| quickbooks_invoice_id | text null | |
| pdf_url | text null | storage key of the sent PDF |
| sent_at | timestamptz null | |
| emailed_at | timestamptz null | when the send email went out; a retry never emails twice (1.8 C) |
| memo, sent_to text[], include_time_detail | | 1.8 |
| reviewed_by, reviewed_at, voided_at, voided_by, void_reason, created_by, archived_at | | 1.8; checks: sent needs a number, void needs a reason, 0 ≤ paid ≤ total |

### invoice_lines
| id, firm_id, invoice_id | project_phase_id fk null | line_type enum (`phase_fee`, `hourly`, `consultant`, `expense`, `adjustment`) | description | quantity numeric | rate_cents | amount_cents | percent_complete_bp null (fixed fee lines) | sort_order | snapshots: phase_fee_cents, prior_billed_cents | consultant_id fk, cost_cents, markup_bp, vendor_invoice_ref | archived_at |

### invoice_excluded_entries  (1.8)
| id, firm_id, invoice_id, time_entry_id | archived_at; one active row per invoice and entry. Entries someone unticked on a draft, so Recalculate leaves them out |

### payments
| id, firm_id, invoice_id | received_on date | amount_cents > 0 | method enum (`check`, `ach`, `card`, `other`) | reference text | quickbooks_payment_id null | stripe_payment_intent_id null | created_by | archived_at (delete = archive) |

### integrations
Per-firm connection credentials. **Secrets encrypted at rest** (see ARCHITECTURE → Secrets); never selected by client-side code.
| id, firm_id | provider enum (`quickbooks`, `stripe`, `dropbox_sign`) | external_account_id (QuickBooks realmId) | access_token_enc | refresh_token_enc | expires_at | status | last_synced_at |

---

## Later releases (create tables when that release starts)

| Release | Tables |
|---|---|
| 2 — Money & clients | expenses, expense_categories, vendor_bills, vendor_bill_lines, portal_access (contact ↔ project), portal_requests, shared_documents, documents (file metadata) |
| 3 — Plan & win work | tasks (project_phase_id, assignee membership_id, hours, start/end), pursuits (tentative work: name, win_probability_bp, start, hours by role), leads, proposals, proposal_phases (fee_type, fee_cents, edited flag), proposal_consultants (fee_cents, markup_bp), signatures |
| 4 — Build & Knowledge | rfis, submittals, field_reports, issues (punch), change_orders, pay_apps, articles, article_categories |
| 5 — Grow | website_pages, openings, candidates, candidate_notes, subscriptions (firm billing) |

## Always present

### activity_log
| id, firm_id | actor_user_id | entity_type text | entity_id uuid | action text (`created`, `updated`, `status_changed`, `deleted`) | changes jsonb (before/after for changed fields) | created_at |

Write from the server action layer, not database triggers, so the actor is known.

---

## Relationships at a glance

```
firms ─┬─ memberships ── users
       ├─ firm_settings
       ├─ firm_roles ── rates
       ├─ companies ── contacts
       └─ projects ─┬─ project_phases ─┬─ time_entries ── timesheets
                    │                  └─ invoice_lines ── invoices ── payments
                    ├─ project_members
                    └─ consultants
```

## Key calculations (shared library `src/lib/calc/`)

All take cents and hours and return cents. Each has unit tests using the seed numbers.

| Function | Formula |
|---|---|
| `laborCost(entries)` | Σ hours × cost_rate_cents |
| `laborCostWithOverhead(entries, overhead_bp)` | laborCost × (1 + overhead_bp / 10000) |
| `phaseEarned(phase, entries)` | fixed: fee × percent_complete; hourly: Σ hours × bill_rate; nte: min(hourly earned, fee) |
| `phaseProfit(phase, includeOverhead)` | billed − (includeOverhead ? laborCostWithOverhead : laborCost) |
| `distributeFee(totalCents, phases, editedIds)` | split total by default shares; edited phases keep their amount; **rounding remainder goes to the largest unedited phase** so the sum equals the total exactly |
| `invoiceTotal(lines)` | Σ amount_cents |

---

## Schema additions requested by the specs

The screen specs found fields the model above doesn't have yet. **Add each one when building the milestone that needs it** (not all up front), and move it into the tables above in the same pull request. Items marked ⚑ depend on a decision in `docs/OPEN_DECISIONS.md`.

| Milestone | Table | Addition | Why (spec) |
|---|---|---|---|
| 0.5 | users | preferences jsonb (menu rail collapsed, etc.) | Rail state follows the person across devices (app-shell) |
| Code module (later) | projects | stories, building_height_ft, occupancy_group, construction_type, sprinklered, delivery_method, design_review_board | Building facts; added with the building code add-on and shown only when it is on (Blake, 2026-11-03). Not in 1.5 |
| 2 | project_phases | planned_cost_rate_cents bigint null | Projected profit (project-snapshot). Moved from 1.5 (Blake, 2026-11-03) |
| 1.6 ✓ | **timesheet_rows** (new) | id, firm_id, timesheet_id, row_type (`project`/`overhead`/`leave`), project_id, project_phase_id, overhead_category_id, activity_id, billable, sort_order | Rows exist before they have hours ("Add row", "Copy last week") (timesheet) |
| 1.6 ✓ | time_entries | timesheet_row_id fk; while the timesheet is `draft`, activity_id may be null and the check becomes "not both phase and overhead category"; submit enforces completeness | (timesheet) |
| 1.6 ✓ | firm_settings | timesheet_due_time time (09:00); timesheet_notes_rule enum (optional), replacing billable_notes_required (#24) | Due time (#21), required notes (#17) (timesheet) |
| 1.7 | time_entries | ~~approved_at, approved_by~~ not needed: decision #3 is (b), approval is per timesheet (Blake, 2026-11-02) | (timesheet-approval) |
| 1.6 ✓ | timesheet_status enum, timesheets | add `leader_approved`; `reviewer_membership_id` (team leader at submission), `leader_approved_at`, `leader_approved_by` | Two-step approval, decision #3 (b) (Blake, 2026-11-02) |
| 1.6 ✓ | timesheets | rejected_at, rejected_by (added early; written by 1.7) | "Returned by JR on Oct 20" (timesheet-approval) |
| 1.7 A | **review_steps**, **timesheet_review_steps** (new); enums `review_step_kind`, `review_row_status` | see tables above | Custom review route (#23) (timesheet-approval) |
| 1.7 A | timesheet_status enum, timesheets | remove `leader_approved`; drop `reviewer_membership_id`, `leader_approved_at`, `leader_approved_by` (existing sheets get an equivalent review in the migration) | Replaced by `timesheet_review_steps` (#23) |
| 1.7 C | **notifications** (new) | id, firm_id, membership_id (recipient), kind text, title, body, link, entity_type, entity_id, read_at null, created_at; RLS by firm and the server only returns the caller's own | In-app notifications (#25) (timesheet-approval) |
| 1.7 | activity_log | actions `approved`, `reopened`, `reminder_sent`, `nudged`, `review_summary_sent` (entity_type `membership` for reminders, nudges and summaries) | (timesheet-approval) |
| 1.8 A ✓ | invoice_status enum | add `in_review`; invoices.reviewed_by, reviewed_at | Review step before sending (invoicing) |
| 1.8 A ✓ | invoices | number nullable until sent, unique (firm_id, number) where not null; memo, sent_to text[], include_time_detail, voided_at, voided_by, void_reason | Numbers assigned at send, no gaps (invoicing) |
| 1.8 A ✓ | invoice_lines | sort_order, phase_fee_cents, prior_billed_cents, consultant_id, cost_cents, markup_bp, vendor_invoice_ref | Snapshots keep old invoices unchanged (invoicing) |
| 1.8 A ✓ | invoices / time_entries | partial unique index: one open draft per project; `invoice_excluded_entries` (invoice_id, time_entry_id) | (invoicing) |
| 1.8 A ✓ | firm_settings | invoice_remittance_text | PDF footer (invoicing) |
| 1.8 A ✓ | firm_settings / projects | `invoice_number_format` replaces `invoice_prefix` (migrated: `'2026-'`-style year prefixes become `{YYYY}-{###}`, any other prefix becomes `{prefix}{###}`); `projects.next_invoice_seq` integer default 1 | Firm-built invoice numbering, decision #5 (invoicing) |
| 1.8 A ✓ | firm_settings | `project_number_format` text default `{YYYY}-{###}` | Firm-built project numbering, decision #28 (projects-list) |
| 1.8 B ✓ | time_entries | `firm_role_id` uuid null fk firm_roles (same firm), frozen at approval; backfilled from memberships for approved sheets; covered by the invoice lock trigger | Group hours by the role at the time (decision #30) |
| 1.8 B ✓ | consultants | `percent_complete_bp` integer default 0, 0–10000 | Consultants billed by % complete of their fee (decision #31) |
| 1.8 C ✓ | invoices | `emailed_at` timestamptz null | Send retries skip an email that already went out (rule 15) |
| 1.8 B ✓ | companies | `billing_email` text null (≤ 254, lowercase, clients only) | Shared AP address invoices are emailed to, copying the billing contact (decision #32) |
| 1.9 | integrations | status enum (`connected`,`needs_reauth`,`disconnected`), refresh_token_expires_at, settings jsonb, connected_by, connected_at, last_token_refresh_at; unique (firm_id, provider); unique (provider, external_account_id) while connected | (quickbooks-sync) |
| 1.9 | **integration_sync_jobs** (new) | see `quickbooks-sync.md` for columns | Sync queue + log (quickbooks-sync) |
