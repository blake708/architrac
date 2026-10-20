# Spec: Invoicing (list, builder, detail, PDF, payments)

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app/invoices` (firm-wide list) · `/app/projects/[projectId]/billing` (project tab labelled "Invoices"; folder name per ARCHITECTURE §3) · `/app/invoices/[invoiceId]/edit` (builder, draft only) · `/app/invoices/[invoiceId]` (detail) · `/api/invoices/[invoiceId]/pdf` (PDF download) |
| **Mockup** | `mockup/Accounting.dc.html` (Receivables tab + invoice drawer), `mockup/Project.dc.html` (Invoices tab, Phases & fees "Billed" column) |
| **Status** | Draft |

## Purpose
Project managers build a progress invoice for one project from phase progress, approved time and consultant pass-through; an Owner/Admin reviews and sends it (PDF + email), records payments as they arrive, and watches receivables aging. Sent invoices and payments push to QuickBooks Online (see `quickbooks-sync.md`).

### Where it lives (recommendation)
Invoicing is **core, not part of the Accounting add-on**. Every firm must bill to get paid, and gating it behind an add-on would make the base product unusable for a firm without Accounting.
- Release 1: a top-level nav item **Invoices** at `/app/invoices` (renders the mockup's Receivables tab content), plus the project's **Invoices** tab (render it **without** the "Accounting" chip shown in the mockup). Neither checks `firm_settings.modules_enabled`.
- Release 2: when `'accounting'` is in `modules_enabled`, `/app/accounting` shows the full tabbed page and its Receivables tab renders the **same** `<InvoiceList>` component; `/app/invoices` then redirects to `/app/accounting?tab=receivables`. Build the list as a reusable component now so nothing is rewritten.

## Who can see it
| Role | Access |
|---|---|
| Owner | Full: view all, create/edit drafts, approve & send, void, record/delete payments |
| Admin | Same as Owner |
| Project manager | View invoices and create/edit drafts **only on projects where they are `pm_membership_id` or `principal_membership_id`**; can submit for review. Cannot send, void or record payments |
| Staff | none (nav item hidden; routes return 403 page) |
| Client (portal) | none (portal invoices are Release 2) |

## Layout
**A. Invoice list `/app/invoices`** (Accounting mockup, Receivables tab)
1. Page header: small mono status line `SYNCED WITH QUICKBOOKS ONLINE · {relative time}` (only when QBO connected; see sync spec), `<h1>Invoices</h1>`, buttons **Record payment** (opens invoice picker → payment modal) and **New invoice** (opens project picker → builder).
2. KPI row (`<KpiTile>` ×4, clickable filters): Receivables · Over 60 days · Drafts & in review · Collected this month.
3. Status tabs: `Open` (default) · `Drafts & review` · `Paid` · `Void` · `All`, with counts.
4. Aging bar (`<AgingBar>`, Open tab only): five segments sized by amount; clicking one filters the table; "Show all" clears.
5. Table: Invoice # (link to detail) · Client / project · Sent · Due · Total · Balance · Aging pill · QBO sync icon. Filter inputs above: project, client, text search on number. Sort default: days past due desc.

**B. Project Invoices tab** (Project mockup): summary line `{billed} billed · {received} received · {outstanding} outstanding`, **New invoice** button, table: Invoice · Date · For (auto-description) · Amount · Status pill.

**C. Builder `/app/invoices/[id]/edit`** (draft only; full page, not a drawer)
1. Header: "Draft invoice · {project number} {project name}", client name, buttons **Preview PDF**, **Submit for review** (PM) / **Send…** (Owner/Admin), overflow menu **Delete draft**.
2. Settings strip: Period through (date), Issue date, Due date (auto, editable), Bill-to contact, Memo to client (textarea, printed on PDF).
3. Warnings panel (`<Callout>`): unapproved time, NTE cap, consultant over fee, missing billing email.
4. Section **Fixed-fee phases**: one row per `fixed` phase: Phase · Fee · Last billed % · **% complete (input)** · Earned to date · Previously billed · This invoice.
5. Section **Hourly & not-to-exceed phases**: one collapsible group per `hourly`/`nte` phase showing grouped lines (role · hours · rate · amount); expand to see individual time entries with an include checkbox each. NTE groups show a cap meter (`billed + this / cap`).
6. Section **Consultants**: lines added via **Add consultant line** (consultant picker, their invoice no., amount invoiced to us; markup and billed amount shown read-only).
7. Section **Adjustments**: free lines (description, amount, may be negative). **Add adjustment**.
8. Totals box: Subtotal · Tax (hidden when 0) · **Total this invoice** · Prior invoices outstanding · Total balance incl. prior.

**D. Detail `/app/invoices/[id]`** (mockup drawer content, as a full page): number, status pill, client/project, sent/due dates, aging pill, lines grouped as on the PDF, totals, **Payments** table (date, method, reference, amount, QBO icon, delete), action buttons by status (below), QBO sync panel, activity timeline from `activity_log`.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Invoice # | `invoices.number` | `null` until sent → show "Draft" |
| Client / project | `companies.name`, `projects.number` + `projects.name` | |
| Sent | `invoices.sent_at` (firm tz) | `Oct 16` |
| Due | `invoices.due_date` | `Nov 15` |
| Total | `invoices.total_cents` | `$11,160` (screen format per DESIGN_SYSTEM: cents only when not whole) |
| Balance | `total_cents − amount_paid_cents` | rule 9 |
| Aging pill | `daysPastDue` + bucket (rule 10) | `Due in 28 d` (neutral) · `1–30 d late` (attention) · `>30 d late` (danger) |
| Status pill | `invoices.status` | draft · in review · sent · partially paid · paid · void |
| KPI Receivables | Σ balance of open invoices | open = status in (`sent`,`partially_paid`) |
| KPI Over 60 days | Σ balance where daysPastDue > 60 | |
| KPI Drafts & in review | count + Σ total_cents where status in (`draft`,`in_review`) | |
| KPI Collected this month | Σ `payments.amount_cents` where `received_on` in current month (firm tz), not archived | |
| Fixed-fee row values | rule 3 | |
| Hourly/NTE groups | rules 4–5 | hours `6.50 h`, rate `$145.00/h` |
| Consultant line | rule 6 | |
| Project summary line | rule 11 | |
| QBO sync icon | latest `integration_sync_jobs` row for the invoice | see sync spec |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| New invoice (project) | If the project has an invoice in `draft`/`in_review`, open it. Otherwise server action `createDraftInvoice(projectId)` builds lines (rules 3–6, period through = last day of current month in firm tz), reserves time (rule 13), redirects to builder | project `status` = `active` or `on_hold`; client company set | Owner, Admin, PM (own projects) |
| Edit % complete | Saves `project_phases.percent_complete_bp` **and** the line; recompute | 0.00–100.00 % (two decimals, stored as bp: 30.25 % → 3025); must be ≥ last billed % (rule 3) | same |
| Toggle a time entry | Include → `time_entries.invoice_id = this`; exclude → `null`; recompute | entry must be approved, billable, unbilled or on this draft | same |
| Recalculate | Re-pulls newly approved unbilled time ≤ period through; never re-includes entries the user excluded in this draft (tracked per open question 5) | — | same |
| Change period through | Releases reserved entries with `work_date >` new date; pulls new ones; recompute | ≥ previous invoice's `period_end` + 1 | same |
| Add / edit / remove consultant line | rule 6 | consultant must have `billed_through = true`; cost > 0 | same |
| Add / edit / remove adjustment | `line_type = adjustment`, `quantity 1`, `rate_cents = amount_cents` | non-zero; description required | same |
| Preview PDF | Renders PDF on the fly with diagonal "DRAFT" watermark; not stored | — | same |
| Submit for review | `draft → in_review`; notify Owners/Admins (in-app) | rule 14 send-checks pass | same |
| Return to draft | `in_review → draft`, required note stored in activity_log | note ≥ 3 chars | Owner, Admin |
| Send… | Opens send modal (To, CC, subject, body, "Email it" / "Mark sent without emailing"). Runs rule 15 | rule 14 | Owner, Admin (allowed from `draft` or `in_review`; sending from draft records the sender as reviewer) |
| Resend email | Emails the stored PDF again; status unchanged | status sent/partially_paid/paid | Owner, Admin |
| Download PDF | `/api/invoices/[id]/pdf` checks permission, then redirects to a 5-minute signed R2 URL | not draft | Owner, Admin, PM (own) |
| Record payment | Modal; rule 9 | amount > 0 and ≤ balance; `received_on` ≤ today; status sent/partially_paid | Owner, Admin |
| Delete payment | Sets `payments.archived_at`; recompute rule 9; queue QBO delete | confirm dialog | Owner, Admin |
| Void | Rule 16 | reason required; no un-archived payments | Owner, Admin |
| Delete draft | `archived_at = now()` on invoice and its lines; release time (`invoice_id = null`) | status `draft` | Owner, Admin, PM (own) |

## Business rules
Money is integer cents; `roundHalfUp(x)` rounds to the nearest cent, .5 up. Put every function below in `src/lib/calc/invoice.ts` with unit tests using these exact examples. Seed: Medical Office Building (MOB), fixed fee $186,000, phases Pre-Design 5 %, SD 15 %, DD 25 %, CD 35 %, Permitting 5 %, CA 15 %. Invoices 2026-097 $9,300 (paid), 2026-109 $16,740 (paid), 2026-121 $11,160 (sent, due Nov 15).

1. **Numbering.** Number is assigned at send (not at draft), inside a transaction:
   `UPDATE firm_settings SET next_invoice_number = next_invoice_number + 1 WHERE firm_id = $1 RETURNING invoice_prefix, next_invoice_number - 1 AS n` → `number = invoice_prefix + String(n).padStart(3, '0')`. Example: prefix `2026-`, next 128 → `2026-128`, next becomes 129. If the unique index `(firm_id, number)` rejects it (number entered by hand in QBO, import), loop: take the next number, max 5 tries, then error. Voided numbers are never reused. Drafts deleted before send consume no number.
2. **Previously billed** for a phase = Σ `invoice_lines.amount_cents` for that `project_phase_id` on invoices with status in (`sent`,`partially_paid`,`paid`,`written_off`), lines and invoices not archived, **excluding the current invoice**. Fixed-fee phases count only `line_type = phase_fee`; hourly/NTE phases count `hourly` and `adjustment` lines.
3. **Fixed-fee line** (`fee_type = fixed`):
   `earnedToDate = roundHalfUp(fee_cents × percent_complete_bp / 10000)`; `thisInvoice = earnedToDate − previouslyBilled`.
   If `thisInvoice = 0` the line is omitted. If `< 0` block save with "% complete is below what's already billed ({lastBilledPct})." Last billed % = `percent_complete_bp` on this phase's most recent counted `phase_fee` line (0 if none). Stored line: `line_type phase_fee`, `quantity 1`, `rate_cents = amount_cents = thisInvoice`, `percent_complete_bp`, description `"{phase name} · {pct}% complete"`.
   - SD (2026-121): SD fee = 18,600,000 × 1500/10000 = 2,790,000. At 100 %: earned 2,790,000; previously billed 1,674,000 (2026-109 at 60 %) → this = **1,116,000 = $11,160** ✓.
   - DD (October draft): DD fee = 18,600,000 × 2500/10000 = 4,650,000. At 30 %: earned 1,395,000; previously billed 0 → **$13,950.00**.
4. **Hourly line(s)** (`fee_type = hourly`). Eligible entries: `time_entries` where `project_phase_id` = phase, `billable = true`, parent `timesheets.status = 'approved'`, `bill_rate_cents is not null`, `archived_at is null`, `work_date ≤ period_end`, and `invoice_id is null` **or** = this invoice (and not excluded). Group by (`firm_roles.name` of the entry's membership, `bill_rate_cents`). Per group: `quantity = Σ hours`; `amount = roundHalfUp(Σ hoursHundredths × bill_rate_cents / 100)` where `hoursHundredths = hours × 100` as an integer. Description `"{phase} · {role} · {hours} h @ {rate}"`. Rates are the **frozen** values on the entry, never re-looked-up.
   - Example (illustrative rates): BM Principal 4.00 h @ 19,500 → 78,000. JR Project Architect 10.50 h + 2.25 h = 12.75 h @ 14,500 → 1275 × 14,500 / 100 = 184,875. Phase total 262,875 = **$2,628.75**.
5. **Not-to-exceed** (`fee_type = nte`, `fee_cents` = cap). Compute hourly lines as rule 4 → `hourlyAmount`. `remainingCap = max(0, fee_cents − previouslyBilled)`. If `hourlyAmount > remainingCap`, add an `adjustment` line on the phase: `amount = −(hourlyAmount − remainingCap)`, description `"{phase} · not-to-exceed limit reached, {hours} h written down"`. Phase net = `min(hourlyAmount, remainingCap)`. Entries stay attached to the invoice (they are consumed, not re-billed later).
   Warnings: `pctOfCap = (previouslyBilled + phaseNet) / fee_cents`. ≥ 90 % → orange "Approaching the {cap} limit ({pct} used)". = 100 % → red "Limit reached; {writeDown} of time not billed." Both appear in the builder and on the Submit/Send modals.
   - Example: Permitting NTE cap 930,000; previously billed 820,000; this period KL 8.00 h @ 11,000 = 88,000 + JR 3.00 h @ 14,500 = 43,500 → 131,500. Remaining 110,000 → adjustment −21,500; phase net **$1,100.00**; red warning "$215.00 of time not billed".
   - If this period were 50,000: net 50,000; (820,000 + 50,000)/930,000 = 93.5 % → orange warning, no adjustment.
6. **Consultant line.** Input: consultant (from `consultants` on this project with `billed_through = true`), consultant invoice no. (text), `costCents` (their bill to us). `amount = roundHalfUp(costCents × (10000 + consultants.markup_bp) / 10000)`. Stored `line_type consultant`, `quantity 1`, `rate_cents = amount`, description `"{discipline} · {company name} · inv {no.}"`. Example: Coastal MEP CME-2291, cost 552,000, markup 1000 bp → 552,000 × 11,000 / 10,000 = **607,200 = $6,072.00**. Warning (not block) when Σ cost billed to date for that consultant > `consultants.fee_cents`.
7. **Totals.** `subtotal_cents = Σ amount_cents` of non-archived lines; `tax_cents = 0` in Release 1 (professional services; field hidden); `total_cents = subtotal + tax`. Recomputed server-side on every builder save; never trust client totals. Example MOB October draft: DD 1,395,000 + MEP 607,200 = **2,002,200 = $20,022.00**.
8. **Dates.** `issue_date` defaults to the draft's creation date (firm tz) and is editable until send; the Send modal pre-fills today and lets the sender keep or change it (due date recomputes). `due_date = issue_date + firm_settings.default_payment_terms_days` unless edited. Example: issue Oct 16 + 30 = **Nov 15**. `period_start` = previous counted invoice's `period_end + 1` for the project, else the project `start_date`. `period_end` = "Period through".
9. **Payments & status.** `amount_paid_cents = Σ payments.amount_cents` (not archived) — recomputed in the same transaction as any payment insert/archive. Status: `paid` if paid = total; `partially_paid` if 0 < paid < total; `sent` if paid = 0. Overpayment blocked in R1. Example: 2026-121 total 1,116,000, paid 0 → sent; record 500,000 → partially_paid, balance 616,000; record 616,000 → paid.
10. **Aging.** `daysPastDue = today(firm tz) − due_date` in whole days. Buckets: Current ≤ 0 · 1–30 · 31–60 · 61–90 · 90+. Only open invoices. Example (today Oct 18, 2026): 2026-121 due Nov 15 → −28 → Current, pill "Due in 28 d"; 2025-188 due Jun 30 → 110 → 90+.
11. **Project summary.** `billed = Σ total_cents` of counted invoices (status sent/partially_paid/paid/written_off); `received = Σ amount_paid_cents` of those; `outstanding = billed − received` (written_off balances excluded in R2). MOB: 930,000 + 1,674,000 + 1,116,000 = **$37,200 billed**; 930,000 + 1,674,000 = **$26,040 received**; **$11,160 outstanding** ✓. Phases & fees "Billed" per phase = Σ line amounts per rule 2 (SD = $27,900).
12. **One open draft per project.** At most one invoice in `draft`/`in_review` per project (enforce with a partial unique index; see open questions).
13. **Time locking.** An entry with `invoice_id` set (draft reservation or billed) cannot be edited, deleted, moved to another phase, or have its timesheet rejected/un-approved. Enforce in the time server actions (`assertTimeEntryUnlocked`) **and** a Postgres trigger that raises on update of `hours`, `work_date`, `project_phase_id`, `bill_rate_cents`, `billable` or `archived_at` when `OLD.invoice_id is not null`. Only invoice server actions may change `invoice_id`. Time UI shows a lock icon with "Billed on {number}" / "On draft invoice".
14. **Send checks** (block with list): total > 0; at least one line; every line has a description; a To address exists (default: project `client_contact_id` email, else company `billing_contact_id` email); no fixed-fee line negative; project's client company still set.
15. **Send sequence** (`sendInvoice` server action, idempotent per invoice):
    a. Tx 1: if `number is null` assign it (rule 1); stamp `reviewed_by/at` if empty.
    b. Generate PDF (rule 17), upload to Cloudflare R2 (private bucket, via `src/lib/integrations/storage/`) at `firms/{firm_id}/invoices/{invoice_id}/{number}.pdf`; set `pdf_url`.
    c. If "Email it": send via `src/lib/integrations/email/` (Postmark or Resend per ARCHITECTURE; From name = firm name, Reply-To = sending user's email, subject default `Invoice {number} · {project name}`, PDF attached as `Invoice-{number}.pdf`). Store recipients.
    d. Tx 2: `status = 'sent'`, `sent_at = now()`; activity_log; enqueue QBO invoice push.
    If b or c fails: status unchanged, number kept (it is used on retry), toast with error and **Retry**. Re-running skips completed steps.
16. **Void.** Allowed on `sent` with no un-archived payments (delete payments first). Tx: `status = 'void'`, store reason/voided_by/voided_at, set `time_entries.invoice_id = null` for its entries, lines stay for history but no longer count in rule 2 (so the next invoice re-bills that % / time). Number is not reused. Queue QBO void. Detail and PDF download show a "VOID" banner (PDF file is not regenerated). Paid invoices: no void in R1.
17. **PDF layout** (US Letter, `@react-pdf/renderer`, server-only, `src/server/invoices/pdf.tsx`):
    - Header: firm logo (`firms.logo_url`) left; firm name, address, phone right. Title **INVOICE**, number, issue date, due date, terms "Net {n}".
    - Two blocks: **Bill to** (company name, billing contact, address) and **Project** (number, name, address, "Services through {period_end}").
    - Memo to client (if any).
    - **Fee** table (fixed phases incl. phases with nothing this period): Phase · Fee · % complete · Earned to date · Previously billed · This invoice; total row.
    - **Hourly services** table: Phase · Role · Hours · Rate · Amount (NTE adjustments shown under their phase).
    - **Consultants** table and **Adjustments** table (omitted when empty).
    - Totals: Subtotal, Tax (omitted if 0), **Amount due this invoice**; then Account summary: prior invoices outstanding (list numbers + balances), **Total balance due**.
    - Optional appendix "Time detail" (date · person · phase · hours · note) when `include_time_detail` is on (default on if any hourly line).
    - Footer every page: remittance text ("Make checks payable to {firm name}…"), "Page x of y".
    - Money right-aligned in IBM Plex Mono; the PDF **always** shows cents (`$11,160.00`) — use `formatMoney(cents, { cents: 'always' })` from `src/lib/format.ts`.
18. **Activity log** rows for: created, line changes (batched per save), submitted, returned, sent, resent, payment recorded/deleted, voided, deleted.

## States
- **Empty:** list — "No invoices yet. Create one from a project." with **New invoice**; project tab — "Nothing billed yet."; builder with no billable items — "Nothing to bill through {date}. Update % complete, approve time, or add a line."
- **Loading:** table skeleton rows (8) and KPI skeletons; builder recompute shows a spinner on the Totals box only.
- **Error:** inline field errors from server validation; send/PDF/email failures show a persistent error callout with **Retry** (rule 15); stale-write conflict (another user edited the draft) → "This draft changed. Reload to see the latest."
- **Permission denied:** shared 403 page; PM opening another project's invoice gets 403 (not 404).

## Out of scope (for this release)
- Ready-to-bill batch run, statements, automatic reminders and "Last reminder" column, Send statements, Export — Release 2 (Accounting add-on).
- Reimbursable expenses (`line_type expense`), vendor bills feeding consultant lines, retainers/prepayment applied, write-offs (`written_off`), credit memos, sales tax — Release 2.
- Stripe online payment / "Pay now" link, client portal invoices — Release 2.
- Editing a sent invoice (void and re-create instead).

## Acceptance tests
- [ ] Given MOB with DD at 0 % and no draft, when a PM on MOB clicks New invoice and sets DD to 30 %, then a draft exists with one `phase_fee` line of 1,395,000 cents and `total_cents` = 1,395,000.
- [ ] Given SD fee 2,790,000 and a counted line of 1,674,000 at 60 %, when SD is set to 100 %, then the SD line = 1,116,000.
- [ ] Given SD last billed at 100 %, when a user enters 90 %, then save is rejected with the "below what's already billed" message.
- [ ] Given a fixed phase at the same % as last billed, when the draft recalculates, then no line is created for it.
- [ ] Given approved billable entries 4.00 h @ 19,500 and 10.50 h + 2.25 h @ 14,500 on an hourly phase, when the draft is built, then two lines exist: 78,000 and 184,875.
- [ ] Given a submitted-not-approved entry on the project dated within the period, when the builder loads, then it is not billed and the unapproved-time warning shows its hours.
- [ ] Given an NTE cap 930,000 with 820,000 previously billed and 131,500 of new time, when built, then an adjustment line of −21,500 exists, phase net = 110,000, and the red cap warning shows $215.00.
- [ ] Given the same phase with 50,000 of new time, then no adjustment line and the orange 93.5 % warning shows.
- [ ] Given consultant MEP with markup 1000 bp, when a consultant line with cost 552,000 is added, then its amount = 607,200.
- [ ] Given entries reserved on a draft, when a user tries to edit one on the timesheet, then the action fails with "On draft invoice" and the DB trigger also rejects a direct update.
- [ ] Given a draft is deleted, then its time entries have `invoice_id = null` and appear on the next new draft.
- [ ] Given a project with a draft, when New invoice is clicked, then the existing draft opens and no second draft is created.
- [ ] Given `invoice_prefix '2026-'` and `next_invoice_number 128`, when a draft is sent, then its number is `2026-128` and next is 129.
- [ ] Given two drafts sent concurrently, then they receive different consecutive numbers.
- [ ] Given issue date Oct 16 and terms 30, then due date is Nov 15.
- [ ] Given the email provider fails during send, then status stays `in_review`/`draft`, the number is kept, and Retry completes without assigning a new number.
- [ ] Given a PM, when they open the Send action, then it is not shown; calling the server action returns 403.
- [ ] Given 2026-121 (total 1,116,000) when a payment of 500,000 is recorded, then status = partially_paid and balance = 616,000; when 616,000 more is recorded, status = paid.
- [ ] Given a payment greater than the balance, then it is rejected.
- [ ] Given a paid invoice, when a payment is deleted, then amount_paid and status recompute and a QBO delete job is queued.
- [ ] Given a sent invoice with no payments, when voided with a reason, then status = void, its time entries are unbilled, and the phase's previously billed excludes it.
- [ ] Given an invoice with a payment, when Void is attempted, then it is blocked with "Delete payments first".
- [ ] Given today Oct 18, 2026, then 2026-121 shows "Due in 28 d" in Current and 2025-188 is in 90+.
- [ ] Given MOB seed, the project Invoices tab shows "$37,200 billed · $26,040 received · $11,160 outstanding".
- [ ] Given a Staff user, when they visit `/app/invoices`, then they get the 403 page and the nav item is hidden.
- [ ] Given `modules_enabled` without `'accounting'`, then `/app/invoices` and the project Invoices tab still work.
- [ ] Given invoices, lines and payments in Firm A and Firm B, when queried as Firm A, then Firm B's rows are invisible and cannot be updated (RLS test per table).
- [ ] Given a PM who is not PM/principal on project X, when they open an invoice on X or call `createDraftInvoice(X)`, then they get 403.
- [ ] Given a draft is sent, then exactly one `invoice/create` QBO job is enqueued in the same transaction as `status = 'sent'` (when QBO is connected).
- [ ] Given an NTE phase whose earlier invoice was voided, when the next draft is built, then previously billed excludes the voided lines and the voided time entries are billable again.
- [ ] Given a sent invoice, the downloaded PDF contains number, bill-to, fee table, totals and "Page 1 of N"; a draft preview carries the DRAFT watermark.

## Open questions
1. **Data model addition needed:** add `in_review` to enum `invoice_status`; add `invoices.reviewed_by uuid null`, `reviewed_at timestamptz null`.
2. **Data model addition needed:** make `invoices.number` nullable (null while draft/in review) with a partial unique index `(firm_id, number) where number is not null`.
3. **Data model addition needed:** `invoices.memo text null` (client-facing), `invoices.sent_to text[]`, `invoices.include_time_detail boolean default true`, `invoices.voided_at timestamptz`, `invoices.voided_by uuid`, `invoices.void_reason text`.
4. **Data model addition needed:** `invoice_lines.sort_order smallint`; `invoice_lines.phase_fee_cents bigint null` and `prior_billed_cents bigint null` (snapshots so detail/PDF stay stable if a phase fee changes later); `invoice_lines.consultant_id uuid null fk consultants`, `cost_cents bigint null`, `markup_bp integer null`, `vendor_invoice_ref text null`.
5. **Data model addition needed:** partial unique index on `invoices (project_id) where status in ('draft','in_review') and archived_at is null` (rule 12), and a way to remember excluded entries on a draft (`invoice_excluded_entries (invoice_id, time_entry_id)` join table, or a `uuid[]` column on invoices).
6. **Data model addition needed:** firm address/phone/email for the PDF header (`firms` or `firm_settings`), and `firm_settings.invoice_remittance_text text`.
7. **Seed inconsistency:** DATA_MODEL shows `next_invoice_number 121`, but 2026-121…2026-127 already exist in the mockup and Settings shows next = 128. Seed should set 128.
8. Prefix rollover: `invoice_prefix` is fixed text ("2026-"). Should the app roll it to "2027-" on Jan 1 (Settings mockup implies a `{YYYY}-{###}` format), and does the counter reset?
9. Email provider: ARCHITECTURE lists "Postmark or Resend" — pick one (ADR). R1 assumption: sent from an ArchiTrac domain with From name = firm and Reply-To = sender; firm-domain sending is Release 2.
10. **Conflict with CLAUDE.md rule 4** (rates only returned to owner/admin): a PM building an invoice sees hourly **bill** rates on lines (they print on the client's PDF anyway). Proposal: bill rates on invoice lines are visible to PMs with access to the project; cost rates, cost and profit are never returned by any invoicing endpoint. Blake to confirm.
11. Should the project's Principal in Charge (if role = project_manager) also be allowed to approve & send?
12. Retainer handling for TMG's "10% on signing" default — R1 workaround is a negative adjustment line; confirm acceptable.
13. Historical invoices (2026-097, -109, -121) need importing so "previously billed" is correct at go-live — CSV import or manual entry as already-sent invoices?
