# Spec: Contacts

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app/contacts` (tab, filter, search and open drawer live in the URL: `?tab=companies\|people&kind=client&q=palm&company=<id>` or `&contact=<id>`) |
| **Mockup** | `mockup/Contacts.dc.html` |
| **Status** | Draft |

## Purpose
The firm's address book. Everyone uses it to find a client, consultant, contractor, agency or vendor and the people who work there; owners/admins also use it to spot clients with open balances or no billing contact (invoices can't be emailed without one).

## Who can see it
| Role | Access |
|---|---|
| Owner | Full: view, create, edit, archive. Sees money column and the "open balances" KPI. |
| Admin | Same as Owner. |
| Project manager | View, create, edit. Cannot archive. Money column and open-balance KPI hidden. |
| Staff | View only. Can use "Send email". Money column and open-balance KPI hidden. |
| Client (portal) | None. |

## Layout
Uses `AppShell` (menu rail + black top bar, "CONTACTS" crumb). Top to bottom:
1. **PageHeader** — eyebrow `CLIENTS · CONSULTANTS · CONTRACTORS · AGENCIES` (mono), H1 "Contacts". Actions right: `Import` (secondary, see Open questions), `New company` (secondary), `+ New contact` (primary). Hide all three for Staff; hide `Import` until approved.
2. **KpiStrip** — 4 tiles (3 for PM/Staff): Companies, People, Clients with open balances (owner/admin only), Missing billing contact.
3. **TabBar** — `Companies {count}` · `People {count}`. Switching tab closes the drawer.
4. **Toolbar** — `SearchInput` (placeholder "Search companies" / "Search people, titles or tags"), `SegmentedFilter` by kind: All · Clients · Consultants · Contractors · Agencies · Vendors · Other (hide "Other" when count is 0). Right-aligned result note: "`{n}` companies shown" / "`{n}` people shown".
5. **DataTable** (whole row is a button; selected row background `#EAF0FB`):
   - Companies columns: Company (monogram badge 38px + name + description), Type (`TypePill`), Main contact (name + title), Projects (right, mono), Billed / fees (right, mono, owner/admin only), Billing.
   - People columns: Person (round initials badge 36px + full name with designations + title), Company, Type (company's kind), Contact (email over phone, mono), Tags (grey chips).
6. **DetailDrawer** (440px, absolute top-right over the table, close ✕): header badge 48px + title + subtitle + TypePill; a `dl` of rows; "Projects" list; (client companies only) "Send monthly statements" checkbox — see Out of scope; footer buttons: primary + `Edit`.
7. **FormModal** for create/edit company and contact.

TypePill / badge colours (fill, text): client `#E4EBF8 #1E3F7A`; consultant `#EFE7FA #5B2E9E`; contractor `#FCE7DF #9A3412`; agency `#E2F1E6 #1D6234`; vendor and other `#EBEBEB #3A3A3A`.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| KPI Companies | count(companies) not archived | note: "`{c}` clients · `{k}` consultants" |
| KPI People | count(contacts) not archived | note: "Across all companies" |
| KPI Clients with open balances | count of client companies with open > 0 (rule 4) | note: "`$X` outstanding" = Σ open. Owner/admin only. |
| KPI Missing billing contact | count of client companies where rule 6 is true | value orange `#9A3412` when > 0; note "Invoices to these clients can't be emailed" |
| Company monogram | rule 9 on `companies.name` | |
| Company name / description | `companies.name`, `companies.description` | description: **Data model addition needed** |
| Type | `companies.kind` | pill label = kind, uppercase |
| Main contact | `companies.primary_contact_id` → `contacts.first_name last_name`, `contacts.title` | **Data model addition needed**; "—" if null |
| Projects (count) | rule 3 | integer |
| Billed / fees | client: billed (rule 4) over "`$open` open" (orange) or "Paid up"; consultant: fees (rule 5) over "Fees, all projects"; others "—" | `$37,200`, whole dollars |
| Billing | client: billing contact's name; if rule 6 true: "◆ No billing contact" in orange; non-clients "—" | |
| Person name | `contacts.first_name` + `last_name` + (", " + `contacts.designations`) | designations: **Data model addition needed** |
| Person title | `contacts.title` | |
| Person company / type | `contacts.company_id` → `companies.name`, `.kind` | "—" when no company |
| Email / phone | `contacts.email`, `contacts.phone` (fall back to `mobile`) | |
| Tags | `contacts.tags` | chips, in stored order |
| Company drawer rows | Address (`address_line1`, `address_line2`, `city`, `state` `postal_code`), Phone, Website, Main contact, Billing contact (+ email), Copy on letters (count of contacts tagged "Copy on letters"), Billed / open or Fees (owner/admin only), QuickBooks link status (`quickbooks_customer_id` set → "Linked", else "Not linked"; owner/admin only), Notes | missing values show "—" |
| Contact drawer rows | Email, Phone, Mobile, Company, Tags, Notes | |
| Drawer Projects list | rule 3 list: project name (link `/app/projects/<id>`) + note | note: client → current phase name; consultant → `consultants.discipline`; contact → "Client contact" if `projects.client_contact_id` = contact |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Search | Server filters as user types (debounce 250 ms), updates `?q=` | trims whitespace; case-insensitive | all |
| Filter by kind | Sets `?kind=`; applies to both tabs (people via their company's kind) | | all |
| Switch tab | Sets `?tab=`, clears `company`/`contact` param | | all |
| Open row | Sets `?company=<id>` or `?contact=<id>`; drawer opens; row highlighted | | all |
| Close drawer | ✕ or `Esc` removes the param | | all |
| New company | Opens Company form (empty) | see form rules below | owner, admin, PM |
| New contact | Opens Contact form (empty) | see below | owner, admin, PM |
| Drawer primary — client company | "New project" → `/app/projects/new?client=<companyId>` | | owner, admin, PM (hidden for staff) |
| Drawer primary — other company | "Add contact" → Contact form with company prefilled | | owner, admin, PM |
| Drawer primary — contact | "Send email" → `mailto:<email>`; disabled with tooltip "No email on file" if empty | | all |
| Edit | Opens form prefilled; save writes row + `activity_log` (`updated`, before/after) | same as create | owner, admin, PM |
| Archive company | Sets `companies.archived_at`; its contacts stay but show "(archived company)" | blocked if company is `client_company_id` of any project with status `pursuit`, `active` or `on_hold`: "This company is the client on {n} open projects." | owner, admin |
| Archive contact | Sets `contacts.archived_at` | blocked if it is any company's `billing_contact_id`: "Choose another billing contact for {company} first." | owner, admin |

**Company form fields:** name* (≤ 200 chars), kind* (select), description, phone, website (prefix `https://` if no scheme; must parse as URL), address_line1, address_line2, city, state (2 letters, uppercased), postal_code (`^\d{5}(-\d{4})?$`), main contact (select: this company's contacts), billing contact (select: this company's contacts; shown only when kind = client), notes. Create mode cannot pick main/billing contact (no contacts yet) — show hint "Add people, then set the main and billing contact."
Duplicate check: if another non-archived company in the firm has the same name (case-insensitive, trimmed) show inline warning "A company named X already exists" with link; Save still allowed.

**Contact form fields:** first_name* (≤ 100), last_name (≤ 100), designations, title, company (searchable select, optional), email (valid format), phone, mobile, tags (chip input; suggestions: Main contact, Billing, Copy on letters, Site; free text allowed, ≤ 30 chars each, no duplicates), notes. Checkboxes shown when company chosen: "Main contact for {company}" and (client only) "Billing contact for {company}" — on save these set the company's FK in the same transaction.
Duplicate check: same email (case-insensitive) on another contact → warning, Save allowed.

All writes are server actions that set `firm_id` from the session, `created_by`, `updated_at`, and write `activity_log`.

## Business rules
1. Lists exclude `archived_at is not null` rows. Companies sort by `name` (case-insensitive) ascending; people by `last_name`, then `first_name`.
2. Search. Companies match `q` against name, description, main contact's full name. People match against full name, title, email, company name, and any tag. Substring, case-insensitive (`ILIKE '%q%'`).
3. Projects linked to a company: kind client → projects where `projects.client_company_id = company.id`; kind consultant → distinct `consultants.project_id` where `consultants.company_id = company.id`; contractor/agency/vendor/other → none until a link table exists (see Open questions). Archived projects excluded; status `closed` included. Drawer list sorted by project number descending. Contact drawer shows its company's list plus any project where `client_contact_id` = the contact. Empty list shows "No projects yet".
4. Client money. `billed_cents = Σ invoices.total_cents` where `client_company_id = company.id` and `status in (sent, partially_paid, paid, written_off)`. `open_cents = Σ (total_cents − amount_paid_cents)` where `status in (sent, partially_paid)`. Display "`$open` open" in orange if open > 0, else "Paid up". Example: Palmetto Medical Properties has invoices 2026-101 $18,600 paid and 2026-112 $18,600 sent with $7,440 paid → billed $37,200, open $11,160.
5. Consultant fees: `Σ consultants.fee_cents` where `company_id = company.id` and project not archived. Example: Coastal MEP Engineers, MOB $28,500 + Northside $13,800 = $42,300.
6. "Missing billing contact" is true when `kind = client` AND (`billing_contact_id` is null OR that contact is archived OR its `email` is empty). Example seed: Coastal Federal Credit Union and Mill Creek Pediatrics → KPI = 2.
7. KPI open balances: count of client companies with `open_cents > 0`; note = Σ open. Seed data: 9 clients with open balances ($169,450 outstanding).
8. Kind filter on People tab: show contacts whose company has that kind; contacts with no company appear only under "All".
9. Monogram: strip `[` `]`, split on whitespace, keep words starting with a letter, take the first letter of the first two, uppercase. "Palmetto Medical Properties" → "PM". Person badge uses `first_name[0] + last_name[0]` (or first two letters of first_name if no last name), coloured by company kind (vendor colours if no company).
10. Money is formatted in whole dollars with thousands separators (`$37,200`); cents are kept in the database.
11. No pagination in Release 1; server returns at most 1,000 rows per tab ordered as rule 1 (TMG has < 300).
12. Money fields (billed, open, fees, the open-balance KPI) are computed and returned **only** when `can(user, 'contacts.viewMoney')` (owner/admin). For other roles the server query omits them entirely — hiding in the UI is not enough. Every write action calls `requireRole('owner','admin','project_manager')` (archive: `'owner','admin'`).
13. Billed/open/fee sums use shared functions in `src/lib/calc/` (`companyBilled`, `companyOpen`, `consultantFees`) with unit tests on the rule 4–5 examples.

## States
- **Empty (no companies at all):** table area shows "No contacts yet. Add your first client or consultant." with `New company` button (owner/admin/PM).
- **No results:** "No {companies|people} match "{q}"" plus `Clear search and filters` link that resets `q` and `kind`.
- **Loading:** KPI tiles show grey bars; table shows 8 skeleton rows.
- **Error:** inline banner above table "Couldn't load contacts." with `Retry`; KPIs show "—".
- **Drawer for missing/archived id in URL:** drawer shows "This company was archived or doesn't exist." with Close.
- **Permission denied:** n/a for viewing (all roles). Staff hitting a create/edit server action directly gets 403 and toast "You don't have permission to edit contacts."

## Out of scope (for this release)
- **"Send monthly statements"** checkbox in client drawer — statements are an Accounting feature (Release 2); also needs a field (see Open questions). Do not render in R1.
- **"Signature: On file for proposals"** contact row — Release 3 (proposals/signatures).
- **"Spend this year"** for vendors — needs `vendor_bills` (Release 2). Show "—".
- **Client portal access** per contact — Release 2 (`portal_access`).
- **QuickBooks customer sync** (push/pull) — handled by the invoicing/integrations spec; this screen only displays link status.

## Acceptance tests
- [ ] Given the seed firm, when an owner opens `/app/contacts`, then the Companies tab is active, rows are sorted by name, and KPI tiles read Companies 20, People 24, Missing billing contact 2.
- [ ] Given a staff user, when they open `/app/contacts`, then the "Billed / fees" column and "Clients with open balances" tile are not rendered and the `New company`, `New contact` buttons are absent.
- [ ] Given a PM, when the contacts list response is inspected (network/server test), then no billed, open or fee fields are present in the payload.
- [ ] Given a company in firm A, when a user of firm B requests `/app/contacts?company=<id>`, then the drawer shows "doesn't exist" and no data from firm A is returned.
- [ ] Given a PM, when they call the create-company server action, then it succeeds; given staff, then it returns 403 and no row is written.
- [ ] Given the Companies tab, when the user types "palm", then after 250 ms only "Palmetto Medical Properties" is shown and the note reads "1 companies shown" and the URL contains `q=palm`.
- [ ] Given the People tab, when the user types "billing", then contacts tagged "Billing" are shown.
- [ ] Given kind filter "Consultants", when the user switches to People, then only contacts at consultant companies are listed and the filter stays selected.
- [ ] Given a contact with no company, when kind filter is "Clients", then that contact is not listed; when "All", then it is.
- [ ] Given Palmetto has invoices totalling $37,200 (statuses paid and sent) with $11,160 unpaid, when an owner views the row, then Billed shows "$37,200" and "$11,160 open" in orange.
- [ ] Given a client whose invoices are all `paid`, then the note reads "Paid up"; given a `draft` or `void` invoice, then it is not counted in billed.
- [ ] Given Coastal Federal Credit Union has `billing_contact_id` null, then its Billing cell shows "◆ No billing contact" in orange and it is counted in the Missing billing contact KPI.
- [ ] Given a client's billing contact has an empty email, then the client is counted as missing a billing contact.
- [ ] Given Coastal MEP Engineers is consultant on two projects with fees $28,500 and $13,800, then the row shows "$42,300", Projects "2", and the drawer lists both projects with discipline "MEP".
- [ ] Given a row is clicked, then the drawer opens, the row background is `#EAF0FB`, and the URL has `company=<id>`; when the page is reloaded with that URL, then the same drawer is open.
- [ ] Given a client company drawer, when "New project" is clicked, then the browser navigates to `/app/projects/new?client=<id>`.
- [ ] Given the Contact form with company = a client and "Billing contact" checked, when saved, then `companies.billing_contact_id` equals the new contact id and two `activity_log` rows are written.
- [ ] Given the Company form, when postal code "2940" is entered, then Save is disabled with "Enter a 5-digit ZIP or ZIP+4".
- [ ] Given an existing company "Oakmont Health", when a user creates "oakmont health ", then a duplicate warning shows and Save still works.
- [ ] Given a contact is a company's billing contact, when an owner archives it, then the action is blocked with "Choose another billing contact for {company} first."
- [ ] Given a company is client on an active project, when an owner archives it, then the action is blocked; given it is client only on closed projects, then it is archived and disappears from the list.
- [ ] Given a PM, when they open a drawer, then no Archive control is shown.
- [ ] Given a search with no matches, then the empty message and "Clear search and filters" are shown, and clicking it restores the full list.

## Open questions
1. **Data model addition needed:** add `agency` to enum `company_kind` (mockup filter and pill "Agency" for building departments, planning & zoning). Alternative: map to `other` and label it "Agency" — Blake to choose.
2. **Data model addition needed:** `companies.description text` (the grey line under the name, e.g. "Medical developer").
3. **Data model addition needed:** `companies.primary_contact_id uuid fk → contacts null` (the "Main contact" column). If rejected, fallback rule: first non-archived contact (by `created_at`) tagged "Main contact".
4. **Data model addition needed:** `contacts.designations text` ("PE", "PLA", "CPA") shown after the name.
5. **Data model addition needed (Release 2):** `companies.send_statements boolean default false` for the "Send monthly statements" toggle.
6. **Data model addition needed (decide for R1 or later):** a generic link table, e.g. `project_contacts (id, firm_id, project_id, company_id, contact_id null, role text)`, so contractors, agencies and vendors show their projects ("GC", "Permit review", "Zoning letter") as in the mockup. Without it these kinds show "No projects yet".
7. **CSV import (R1 nice-to-have):** proposed: upload CSV with headers `company, kind, first_name, last_name, title, email, phone, mobile, tags (semicolon-separated), address_line1, city, state, postal_code`; preview table with per-row errors; companies matched by exact name (case-insensitive) or created; contacts de-duplicated by email. Build in R1 or defer? Also: import customers from QuickBooks instead/as well?
8. Should PMs see billed/open money for clients (at least on projects they manage)? Spec currently hides it from PM and staff.
9. Should staff be allowed to create/edit contacts (e.g. adding a consultant's new engineer)? Spec currently says view-only.
