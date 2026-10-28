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
| active | boolean | default true |
| unique (firm_id, user_id) | | |

### firm_settings
One row per firm.
| column | type | notes |
|---|---|---|
| firm_id | uuid pk fk | |
| overhead_rate_bp | integer | 6000 = 60% (mockup default) |
| include_overhead_default | boolean | default true; the snapshot switch starts here |
| week_starts_on | smallint | 0 = Sunday, 1 = Monday |
| timesheet_increment_minutes | smallint | 15 |
| timesheet_lock_day | smallint | day of week timesheets are due |
| invoice_prefix | text | "2026-" |
| next_invoice_number | integer | 128 in the seed (2026-121 … 2026-127 already exist) |
| default_payment_terms_days | smallint | 30 |
| modules_enabled | text[] | `'{}'` (valid keys: `build`,`workload`,`accounting`,`marketing`,`knowledge`,`code`,`website`,`hiring`) |

### teams
| id | firm_id | name | leader_membership_id | sort_order |

### invitations  (0.6, Settings → Users & access)
Someone invited who hasn't joined yet. They have no `users` row until they accept, so this is its own table and `memberships.user_id` stays required. Clerk sends the email; we keep the app role and title. Rows are never deleted.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| firm_id | uuid fk | RLS |
| email | citext | |
| app_role | app_role | role they get on joining |
| title | text null | |
| firm_role_id | uuid null | FK once `firm_roles` exists (1.1) |
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
- Defaults: `firm_settings.modules_enabled` = `{}` (new firms start with no add-ons), `next_invoice_number` = 1, `invoice_prefix` = `''`. The TMG seed sets its own values.

---

## Release 1 — Run TMG

### firm_roles  (Settings → Roles & rates)
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | "Principal", "Project manager", "Project architect", "Designer"… (see settings spec seed) |
| sort_order | smallint | |

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

**Rate lookup rule:** for a time entry on date D for person P: person override effective on D → else their role's rate effective on D → else error (block approval).

### phase_templates  (Settings → Timesheet phases & activities, project section)
Firm's standard phase list used when creating a project.
| id, firm_id | code text ("SD") | name text ("Schematic Design") | default_fee_type enum | default_fee_share_bp integer | sort_order |

Seed codes: PD, SD, DD, CD, PRM (Permitting), CA, CO (Close Out). Full seed values: `docs/specs/release-1/settings-rates-phases.md` → Seed values.

### activities
Activities a person picks on a timesheet row.
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | "Design", "Drawings & production", "Coordination", "Meetings", "Site visit"… |
| applies_to | enum `activity_scope` | `project`, `overhead` |
| overhead_category_id | uuid fk null | for overhead activities, which category they belong to |
| sort_order, active | | |

### overhead_categories
Non-project "phases" (Settings → overhead section).
| id, firm_id | name ("Marketing", "Administration", "Professional development", "Firm standards"; leave: "Paid time off", "Holiday") | is_leave boolean (Leave: PTO, Holiday, Sick) | sort_order | active |

### companies
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| name | text | |
| kind | enum `company_kind` | `client`, `consultant`, `contractor`, `vendor`, `other` |
| phone, website | text | |
| address_line1, address_line2, city, state, postal_code | text | |
| billing_contact_id | uuid fk → contacts null | |
| quickbooks_customer_id | text null | sync key |
| notes | text | |

### contacts
| id, firm_id | company_id fk null | first_name | last_name | title | email | phone | mobile | tags text[] | notes |

### projects
| column | type | notes |
|---|---|---|
| id, firm_id | | |
| number | text | firm's project number, unique per firm ("2026-014") |
| name | text | "Medical Office Building" |
| client_company_id | uuid fk | |
| client_contact_id | uuid fk null | |
| status | enum `project_status` | `pursuit`, `active`, `on_hold`, `closed` |
| project_type | text | Medical office, Restaurant, Retail, Office |
| address fields | text | |
| square_feet | integer null | |
| construction_cost_cents | bigint null | |
| principal_membership_id | uuid fk | Principal in Charge |
| pm_membership_id | uuid fk | |
| start_date, target_end_date | date | |
| quickbooks_customer_id | text null | sub-customer/job in QuickBooks |
| proposal_id | uuid fk null | set when converted from a won proposal (Release 3) |

### project_phases
The backbone: time, budgets, invoices and the snapshot all hang off this.
| column | type | notes |
|---|---|---|
| id, firm_id, project_id | | |
| code, name | text | copied from template, editable |
| sort_order | smallint | |
| fee_type | enum `fee_type` | `fixed`, `hourly`, `nte` (not-to-exceed) |
| fee_cents | bigint | fixed: the fee; nte: the cap; hourly: estimate (may be 0) |
| budget_hours | numeric(8,2) | |
| status | enum `phase_status` | `upcoming`, `current`, `complete`, `closed` (closed = no new time) |
| start_date, end_date | date null | |
| percent_complete_bp | integer | for fixed-fee billing (PM sets it) |

### project_members
| id, firm_id, project_id, membership_id | project_role text ("PM", "PA", "Designer") | bill_rate_override_cents null |

### consultants  (project's sub-consultants)
| id, firm_id, project_id, company_id | discipline text ("MEP", "Structural", "Civil") | fee_cents | markup_bp | billed_through boolean |

### timesheets
One per person per week.
| column | type | notes |
|---|---|---|
| id, firm_id, membership_id | | |
| week_start | date | unique (membership_id, week_start) |
| status | enum `timesheet_status` | `draft`, `submitted`, `approved`, `rejected` |
| submitted_at, approved_at | timestamptz null | |
| approved_by | uuid fk null | |
| rejection_note | text null | |

### time_entries
One row per person × day × (project phase or overhead category) × activity.
| column | type | notes |
|---|---|---|
| id, firm_id, timesheet_id | | |
| work_date | date | |
| project_id | uuid fk null | null = overhead |
| project_phase_id | uuid fk null | required when project_id is set |
| overhead_category_id | uuid fk null | required when project_id is null |
| activity_id | uuid fk | required |
| hours | numeric(5,2) | > 0, multiple of 0.25 |
| note | text | |
| billable | boolean | default true for project time |
| bill_rate_cents | bigint null | **frozen on approval** from the rate lookup |
| cost_rate_cents | bigint null | **frozen on approval** |
| invoice_id | uuid fk null | set when billed; billed entries are locked |

Check constraint: exactly one of (`project_phase_id`, `overhead_category_id`) is set.

### invoices
| column | type | notes |
|---|---|---|
| id, firm_id, project_id, client_company_id | | |
| number | text | "2026-121", unique per firm |
| status | enum `invoice_status` | `draft`, `sent`, `partially_paid`, `paid`, `void`, `written_off` |
| issue_date, due_date | date | |
| period_start, period_end | date | time cutoff |
| subtotal_cents, tax_cents, total_cents | bigint | |
| amount_paid_cents | bigint | maintained from payments |
| quickbooks_invoice_id | text null | |
| pdf_url | text null | |
| sent_at | timestamptz null | |

### invoice_lines
| id, firm_id, invoice_id | project_phase_id fk null | line_type enum (`phase_fee`, `hourly`, `consultant`, `expense`, `adjustment`) | description | quantity numeric | rate_cents | amount_cents | percent_complete_bp null (fixed fee lines) |

### payments
| id, firm_id, invoice_id | received_on date | amount_cents | method enum (`check`, `ach`, `card`, `other`) | reference text | quickbooks_payment_id null | stripe_payment_intent_id null |

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
| 1.1 | firm_roles | description text, is_billable boolean | "Not billable" roles (settings-rates-phases) |
| 1.1 | overhead_categories | code text (`PTO`, `HOL`) | Leave codes (settings, timesheet) |
| 1.2 | company_kind enum | add `agency` | Permitting agencies, review boards (contacts) |
| 1.2 | companies | description, primary_contact_id | (contacts) |
| 1.2 | contacts | designations text ("PE, LEED AP") | (contacts) |
| 1.2 | **project_contacts** (new) | id, firm_id, project_id, contact_id, role text | Contractors/agencies/vendors linked to projects (contacts) |
| 1.3 | memberships | phone, license_note, start_date, is_principal boolean | Team profile; Principal in Charge picker (team) |
| 1.4 | projects | scope_kind enum (`ground_up`,`tenant_upfit`,`shell`), closed_on date, stories, building_height_ft, occupancy_group, construction_type, sprinklered, delivery_method, design_review_board; address columns named as in `companies` | (projects-list, project-detail) |
| 1.5 | project_phases | is_additional_service boolean, planned_cost_rate_cents bigint null | Additional-service phases; projected profit (project-detail, timesheet) |
| 1.5 | consultants | contact_id | (project-detail) |
| 1.5 | firm_settings | default_consultant_markup_bp (1000), budget_planning_rate_cents (15000) | Defaults for new projects (project-detail) |
| 1.6 | **timesheet_rows** (new) | id, firm_id, timesheet_id, row_type (`project`/`overhead`/`leave`), project_id, project_phase_id, overhead_category_id, activity_id, billable, sort_order | Rows exist before they have hours ("Add row", "Copy last week") (timesheet) |
| 1.6 | time_entries | timesheet_row_id fk; while the timesheet is `draft`, activity_id may be null and the check becomes "not both phase and overhead category"; submit enforces completeness | (timesheet) |
| 1.6 | firm_settings | timesheet_due_time time (09:00) | Reminder timing (timesheet) |
| 1.7 | time_entries | approved_at, approved_by | Per-line approval by project (timesheet-approval) ⚑ |
| 1.7 | timesheets | rejected_at, rejected_by | "Returned by JR on Oct 20" (timesheet-approval) |
| 1.7 | activity_log | actions `approved`, `reopened`, `reminder_sent` | (timesheet-approval) |
| 1.8 | invoice_status enum | add `in_review`; invoices.reviewed_by, reviewed_at | Review step before sending (invoicing) |
| 1.8 | invoices | number nullable until sent, unique (firm_id, number) where not null; memo, sent_to text[], include_time_detail, voided_at, voided_by, void_reason | Numbers assigned at send, no gaps (invoicing) |
| 1.8 | invoice_lines | sort_order, phase_fee_cents, prior_billed_cents, consultant_id, cost_cents, markup_bp, vendor_invoice_ref | Snapshots keep old invoices unchanged (invoicing) |
| 1.8 | invoices / time_entries | partial unique index: one open draft per project; `invoice_excluded_entries` (invoice_id, time_entry_id) | (invoicing) |
| 1.8 | firm_settings | invoice_remittance_text | PDF footer (invoicing) |
| 1.9 | integrations | status enum (`connected`,`needs_reauth`,`disconnected`), refresh_token_expires_at, settings jsonb, connected_by, connected_at, last_token_refresh_at; unique (firm_id, provider); unique (provider, external_account_id) while connected | (quickbooks-sync) |
| 1.9 | **integration_sync_jobs** (new) | see `quickbooks-sync.md` for columns | Sync queue + log (quickbooks-sync) |
