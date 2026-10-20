# Spec: QuickBooks Online sync (one-way push)

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app/settings/integrations` (card list) · `/app/settings/integrations/quickbooks` (`?tab=setup\|customers\|log`) · `/api/integrations/quickbooks/connect` · `/api/integrations/quickbooks/callback` · `/api/integrations/quickbooks/customers?q=` (combobox search) · `/api/cron/qbo-sync` (Vercel Cron, hourly) |
| **Mockup** | `mockup/Settings.dc.html` (Integrations section, QuickBooks card), `mockup/Accounting.dc.html` (header line "SYNCED WITH QUICKBOOKS ONLINE · 6 MIN AGO") |
| **Status** | Draft |

## Purpose
An Owner/Admin connects the firm's QuickBooks Online (QBO) company once, links ArchiTrac clients to QBO customers, and from then on every **sent** invoice, payment, payment deletion and void is pushed to QBO automatically, with a log showing what synced and a Retry for what didn't. ArchiTrac is the source of truth for invoices and payments; nothing is read back from QBO in Release 1 except lookups (customers, items, accounts).

## Who can see it
| Role | Access |
|---|---|
| Owner | Full: connect, disconnect, settings, mapping, log, retry |
| Admin | Full (ARCHITECTURE §5: integrations and QuickBooks sync are Owner/Admin) |
| Project manager | none (sees only the sync icon on invoices they can view, no Retry) |
| Staff | none |
| Client (portal) | none |

## Layout
**Settings → Integrations** (`/app/settings/integrations`): grid of `<Card>`s as in the mockup. QuickBooks card: mono "QB" tile, name, "Accounting", description, status `<Badge>` (Connected · Needs reconnect · Not connected), button **Connect** (primary) or **Manage** (secondary). Other cards (Stripe, Plaid, email, calendar, files) render with a "Coming later" badge and no button.

**QuickBooks page** (`/app/settings/integrations/quickbooks`), `<PageHeader>` meta line `CONNECTED TO {company name} · REALM {realmId} · {SANDBOX|PRODUCTION}`, actions **Disconnect** (danger). Tabs:
1. **Setup** — Setup checklist (each item ✔/✖ with fix link): Connected · Custom transaction numbers on in QBO · Items mapped · Deposit account chosen · All clients with sent invoices linked. Then forms: Customer mode (radio), Item mapping (4 selects), Deposit-to account (select), Payment method mapping (4 selects, optional), Sync start date (date). **Save**.
2. **Customers** — table: ArchiTrac client · Projects (count) · QuickBooks customer (`<Combobox>` searching QBO) · Status badge (Linked · Suggested · Not linked) · actions **Create in QuickBooks**. Button **Accept all suggestions**. When Customer mode = sub-customer, each client row expands to its projects with the same controls.
3. **Sync log** — filters (Status: Needs attention [default] · All · Pending · Synced; date range), **Retry all failed**, table: Time · Record · Operation · Status · Attempts · Message · QuickBooks link · Retry.

**Elsewhere:** invoice list shows a sync icon per row; invoice detail has a "QuickBooks" panel (status, last attempt, message, **Retry**, "Open in QuickBooks"); Invoices page header shows the sync status line (rule 12).

## Data shown
| UI element | Source | Notes / format |
|---|---|---|
| Connection status | `integrations.status` where `provider='quickbooks'` | `connected` · `needs_reauth` · `disconnected` |
| Company name / realm | `integrations.settings->>'company_name'`, `integrations.external_account_id` | |
| Environment | env `QBO_ENVIRONMENT` | SANDBOX shown in orange badge |
| Last synced | `integrations.last_synced_at` | relative: "6 min ago" |
| Customer link | `companies.quickbooks_customer_id` / `projects.quickbooks_customer_id` | name fetched from QBO, cached on page load |
| Suggested match | rule 4 | |
| Log rows | `integration_sync_jobs` (see Open questions) | newest first, 50 per page |
| QBO link | `https://app.qbo.intuit.com/app/{invoice\|recvpayment}?txnId={id}` (sandbox: `app.sandbox.qbo.intuit.com`) | opens new tab |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Connect | Rule 1 | No other firm holds a `connected` row for the same realm | Owner, Admin |
| Disconnect | Confirm dialog → rule 3 | — | Owner, Admin |
| Reconnect | Same as Connect; same realm keeps all links | Different realm → rule 1e | Owner, Admin |
| Save setup | Validates and stores `integrations.settings` | Zod: item IDs non-empty, deposit account set | Owner, Admin |
| Create default items | Creates 4 Service items in QBO (rule 6) with chosen income account | income account chosen | Owner, Admin |
| Link customer | Sets `quickbooks_customer_id`; resets this client's `failed` jobs with code `CUSTOMER_UNMAPPED` to `pending` | QBO customer active | Owner, Admin |
| Create in QuickBooks | `POST /customer` (rule 5); stores returned Id | billing contact email optional | Owner, Admin |
| Unlink | Clears `quickbooks_customer_id` | Blocked if any of its invoices have a `quickbooks_invoice_id` | Owner, Admin |
| Retry / Retry all failed | Job → `pending`, `next_attempt_at = now()`, `attempts` kept, same `request_id`; runs immediately via `after()` | job `failed` | Owner, Admin |

## Business rules
1. **OAuth connect** (OAuth 2.0 authorization-code; implement with plain `fetch` in `src/lib/integrations/quickbooks/oauth.ts`).
   a. `GET /api/integrations/quickbooks/connect`: `requireRole(['owner','admin'])`; create `state` = 32 random bytes (base64url); store `{state, firmId, userId}` in an httpOnly, secure, SameSite=Lax cookie, 10-minute expiry; redirect to `https://appcenter.intuit.com/connect/oauth2?client_id={QBO_CLIENT_ID}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri={QBO_REDIRECT_URI}&state={state}`.
   b. Callback `GET …/callback?code&state&realmId` (or `?error=access_denied`): verify cookie state matches and the session's firm equals the cookie's firm; else 400 page "Connection expired, try again". Delete cookie.
   c. Exchange: `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`, Basic auth `client_id:client_secret`, form `grant_type=authorization_code&code&redirect_uri`. Response: `access_token` (`expires_in` ≈ 3600 s), `refresh_token`, `x_refresh_token_expires_in`.
   d. `GET /v3/company/{realmId}/companyinfo/{realmId}` → `CompanyName`; `GET /v3/company/{realmId}/preferences` → `SalesFormsPrefs.CustomTxnNumbers` (checklist item).
   e. Upsert `integrations` (unique `firm_id, provider`): `external_account_id = realmId`, tokens encrypted (rule 2), `expires_at = now + expires_in`, `refresh_token_expires_at`, `status = 'connected'`, `connected_by`, `connected_at`, `settings.company_name`. **If the existing row has a different realm and any `quickbooks_*_id` is set anywhere in the firm, refuse** with "This is a different QuickBooks company than before. Contact support to switch." (R1).
   f. activity_log `integration.connected`; redirect `/app/settings/integrations/quickbooks?tab=setup&connected=1`.
2. **Token storage.** `access_token_enc` / `refresh_token_enc` are `encrypt()` output from `src/lib/crypto.ts` (AES-256-GCM, key `ENCRYPTION_KEY`, random 12-byte IV, stored as `v1.{iv}.{tag}.{ciphertext}` base64). Only `src/lib/integrations/quickbooks/client.ts` (`import 'server-only'`) decrypts. UI queries select an explicit column list without `*_enc`. **Refresh:** before any API call, if `expires_at < now + 5 min`, open a transaction, `select … for update` the integration row, re-check, then `POST` the token endpoint with `grant_type=refresh_token`; always store the **returned** refresh token (it can rotate) and new expiry. `invalid_grant` → `status = 'needs_reauth'`, stop processing jobs for this firm, show banner (rule 12). The hourly cron also refreshes any connection whose last refresh is > 24 h old to keep it alive.
3. **Disconnect.** `POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke` with the refresh token (ignore failure), set tokens to null, `status = 'disconnected'`. Keep all `quickbooks_*_id` values and pending jobs (they resume on reconnect to the same realm). Sending invoices and recording payments still work while disconnected; jobs wait as `pending`.
4. **Customer mapping.** Mode in `settings.customer_mode`: `client` (**default; TMG** — QBO jobs are separated by client, not QBO Projects) or `project_sub_customer`. The invoice's `CustomerRef` = `projects.quickbooks_customer_id` in sub-customer mode, else `companies.quickbooks_customer_id` of `invoices.client_company_id`. Suggested match: QBO active customer whose `DisplayName` or `CompanyName` equals `companies.name` case-insensitively after trimming and collapsing spaces; exactly one match → "Suggested"; 0 or >1 → "Not linked". Search endpoint runs `select Id, DisplayName, FullyQualifiedName, Job from Customer where Active = true and DisplayName like '%{q}%' maxresults 20` (escape `'` and `%` in q; q ≥ 2 chars).
5. **Create customer.** `POST /customer`: `DisplayName = companies.name`, `CompanyName`, `BillAddr` (address fields), `PrimaryEmailAddr` (billing contact email), `PrimaryPhone`. Sub-customer mode, per project: `DisplayName = "{project number} {project name}"`, `Job: true`, `ParentRef = client's Id`, `BillWithParent: true`. QBO error 6240 (duplicate name — QBO names are unique across customers, vendors and employees) → "A QuickBooks name '{name}' already exists. Link it instead."
6. **Items.** Every invoice line needs an `ItemRef`. `settings.item_map`: `{ phase_fee, hourly, consultant, adjustment }` → QBO Service item Ids. "Create default items" creates *Architectural Services – Fee*, *Architectural Services – Hourly*, *Consultant Services*, *Invoice Adjustment* (`Type: 'Service'`, `IncomeAccountRef` = chosen income account).
7. **What triggers a push** (enqueue a job inside the same DB transaction as the business change; then run it right after the response with Next.js `after()`):
   | ArchiTrac event | Job `entity_type / operation` |
   |---|---|
   | Invoice status → `sent` (invoicing rule 15d) and `issue_date ≥ settings.sync_start_date` | `invoice / create` |
   | Payment recorded | `payment / create` |
   | Payment archived | `payment / delete` (if it has a `quickbooks_payment_id`; else cancel its pending create) |
   | Invoice voided | `invoice / void` (if it has a `quickbooks_invoice_id`; else cancel its pending create) |
   Drafts and in-review invoices are never pushed. Sent invoices can't be edited (invoicing spec), so there is no update operation.
8. **Invoice payload** (`POST /v3/company/{realm}/invoice?minorversion={QBO_MINOR_VERSION}&requestid={job.request_id}`; `QBO_MINOR_VERSION` is a constant, set to 75 and verified against Intuit docs at build time):
   ```json
   { "DocNumber": "2026-128", "TxnDate": "2026-10-31", "DueDate": "2026-11-30",
     "CustomerRef": { "value": "58" }, "EmailStatus": "NotSet",
     "CustomerMemo": { "value": "2026-014 Medical Office Building · services through Oct 31, 2026" },
     "PrivateNote": "ArchiTrac invoice 6f1c…",
     "Line": [ { "DetailType": "SalesItemLineDetail", "Amount": 13950.00,
       "Description": "Design Development · 30% complete",
       "SalesItemLineDetail": { "ItemRef": { "value": "21" }, "Qty": 1, "UnitPrice": 13950.00, "TaxCodeRef": { "value": "NON" } } } ] }
   ```
   Money: `amount_cents / 100` as a number with 2 decimals (`centsToQbo()` in `src/lib/calc/qbo.ts`, unit-tested). Line order = `invoice_lines.sort_order`. Hourly lines send `Qty = hours`, `UnitPrice = rate` **only if** `hoursHundredths × rate_cents` is divisible by 100 (exact cents); otherwise `Qty 1`, `UnitPrice = Amount`, hours kept in Description — QBO rejects lines where Amount ≠ Qty × UnitPrice. Negative adjustment lines are sent as negative `Amount`/`UnitPrice`. `EmailStatus: NotSet` so QBO never emails the client (ArchiTrac already did).
   After success: store `Id` in `invoices.quickbooks_invoice_id`; compare response `TotalAmt` with `total_cents/100` — if different (e.g. QBO automated sales tax), mark the job `failed` with code `TOTAL_MISMATCH` and message "QuickBooks total $X differs from ArchiTrac $Y — check tax settings on this invoice in QuickBooks." (keep the Id).
   Example (MOB): DD 30 % `13950.00` + MEP `6072.00` → `TotalAmt 20022.00` ✓.
9. **Payment payload** (`POST /payment?requestid=…`): `CustomerRef` (same rule 4 resolution as its invoice), `TotalAmt`, `TxnDate = received_on`, `PaymentRefNum = reference` (max 21 chars, truncated), `PaymentMethodRef` from `settings.payment_method_map[method]` if set, `DepositToAccountRef = settings.deposit_account_id` (default suggestion: Undeposited Funds), `PrivateNote = "ArchiTrac payment {id}"`, `Line: [{ Amount, LinkedTxn: [{ TxnId: invoice.quickbooks_invoice_id, TxnType: "Invoice" }] }]`. Store `Id` in `payments.quickbooks_payment_id`. **Dependency:** if the invoice has no `quickbooks_invoice_id`, the job stays `pending` with message "Waiting for invoice {number} to sync" and is not counted as an attempt. Example: $11,160 on 2026-121 → `TotalAmt 11160.00` linked to 2026-121's Id.
10. **Void / delete.** Read the object (`GET /invoice/{Id}` or `/payment/{Id}`) for its `SyncToken`, then `POST /invoice?operation=void` with `{Id, SyncToken}` or `POST /payment?operation=delete`. Error 5010 (stale object) → re-read once and retry immediately. Object already voided/deleted in QBO → treat as success.
11. **Idempotency.**
    a. One job row per `(entity_type, entity_id, operation)` while `pending`/`running` (partial unique index); enqueueing a duplicate is a no-op.
    b. Each job gets a `request_id` uuid at enqueue; every retry sends the **same** `requestid`, so QBO returns the original result instead of creating a duplicate.
    c. Before `invoice/create`: `select Id, TotalAmt, CustomerRef from Invoice where DocNumber = '{number}'`. Found with same customer and total → store Id, job status `linked` (this also handles invoices that already exist in QBO from before go-live). Found with different details → `failed`, code `DOCNUMBER_CONFLICT`.
    d. Skip `create` if the entity already has its QBO Id.
    e. Claim jobs with `update … set status='running', locked_at=now() where id = (select id … where status='pending' and next_attempt_at <= now() order by created_at for update skip locked limit 1)`. Jobs `running` > 10 min are reset to `pending`. Process one firm's jobs sequentially, invoices before payments (QBO limit: 500 requests/min per company).
12. **Errors and retry.** Classify each failure:
    - *Retryable* (network, timeout, 429, 5xx): `attempts += 1`, `next_attempt_at = now + [1 h, 1 h, 4 h, 12 h][attempts−1]`; after 5 attempts → `failed`.
    - *Auth* (401 that persists after one refresh, `invalid_grant`): integration → `needs_reauth`; job stays `pending`, no attempt counted.
    - *Needs a person* → `failed` immediately with code + QBO's `Fault.Error[0].Message` and `Detail`: `CUSTOMER_UNMAPPED`, `ITEM_UNMAPPED`, `DOCNUMBER_CONFLICT`, `TOTAL_MISMATCH`, QBO 400 ValidationFault (e.g. 6000 business validation, 610 object not found, 2500 invalid reference).
    Header status line on the Invoices page (Owner/Admin only): no failures → `SYNCED WITH QUICKBOOKS ONLINE · {last_synced_at relative}`; ≥ 1 failed → red `QUICKBOOKS · {n} ITEMS NEED ATTENTION` linking to the log; `needs_reauth` → red banner "QuickBooks disconnected. Reconnect to resume syncing." with **Reconnect**. `last_synced_at` updates on every successful job.
13. **Sync log.** Every API call made by a job is recorded on the job row: `request_body`/`response_body` jsonb (tokens never included; each body truncated to 20 KB), `qbo_id`, `error_code`, `error_message`, `finished_at`. Rows are kept (no purge in R1). Statuses shown: Pending · Waiting (dependency) · Running · Synced · Linked · Failed · Cancelled.
14. **Cron.** `/api/cron/qbo-sync` (hourly, in `vercel.json`) requires header `Authorization: Bearer {CRON_SECRET}`; for each firm with `status='connected'`: refresh token if needed, process due jobs (max 100 per firm per run).
15. **Environment variables:** `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` (`sandbox` → base `https://sandbox-quickbooks.api.intuit.com`; `production` → `https://quickbooks.api.intuit.com`), `ENCRYPTION_KEY`, `CRON_SECRET`. Add to `.env.example`.
16. **Sandbox for testing.** Create an Intuit Developer account and an app; use its **Development** keys and the free US sandbox company for local and preview environments; production keys only in Vercel Production. Unit tests mock QBO with fixture JSON (no network). Before go-live, run the manual checklist against the sandbox: connect, link a customer, send an invoice, record a payment, delete it, void the invoice, disconnect and reconnect, force a 500 (kill network) and verify retry. Production keys require Intuit's app assessment (privacy policy URL, EULA URL, HTTPS redirect URI, launch/disconnect URLs).

## States
- **Empty:** not connected → QuickBooks page shows one card "Connect QuickBooks Online to push invoices and payments to your books." + **Connect**; Customers tab with no clients → "No clients yet."; Sync log empty → "Nothing has synced yet."
- **Loading:** combobox shows "Searching QuickBooks…"; customers tab skeleton rows while QBO names load (page still renders links by Id if QBO is slow > 5 s, with "Couldn't load names from QuickBooks").
- **Error:** callback failure → Setup tab with red callout and the reason (`access_denied` → "Connection was cancelled in QuickBooks."); `needs_reauth` banner (rule 12); QBO API down while mapping → inline "QuickBooks didn't respond. Try again."
- **Permission denied:** shared 403 page for PM/Staff on all routes above; callback with a non-admin session → 403.

## Out of scope (for this release)
- QBO webhooks (`/api/webhooks/quickbooks`, verify `intuit-signature` HMAC) and Change Data Capture to pull payments/edits made in QBO — Release 2. **R1 rule for users: record payments in ArchiTrac only**; payments or edits entered directly in QBO are not reflected in ArchiTrac.
- Two-way customer sync, vendor bills / expenses / POs to QBO, QBO Projects, classes/locations, sales tax — Release 2+.
- Pulling P&L numbers to fill overhead in Settings (Settings mockup hint) — Release 2.
- Switching to a different QBO company once links exist (support task in R1).

## Acceptance tests
- [ ] Given an Owner, when they click Connect, then they are redirected to Intuit with `scope=com.intuit.quickbooks.accounting` and a `state` matching the cookie.
- [ ] Given a callback whose `state` doesn't match the cookie, then no integration row is written and the "Connection expired" page shows.
- [ ] Given a valid callback, then `integrations` has `status='connected'`, `external_account_id = realmId`, and both token columns start with `v1.` and do not equal the raw tokens.
- [ ] Given any page or API response sent to the browser, then it contains no `access_token_enc`/`refresh_token_enc` values (test the integration queries' column list).
- [ ] Given a PM, when they request any `/app/settings/integrations/*` route or the connect endpoint, then they get 403.
- [ ] Given `expires_at` in 2 minutes, when a job runs, then the token is refreshed first and the new refresh token is stored.
- [ ] Given the refresh call returns `invalid_grant`, then status = `needs_reauth`, pending jobs remain `pending`, and the reconnect banner shows.
- [ ] Given client "Palmetto Medical Properties" and exactly one QBO customer "palmetto medical  properties", then the Customers tab shows it as Suggested.
- [ ] Given customer mode `client`, when invoice 2026-128 for MOB is sent, then one `invoice/create` job is enqueued and the payload `CustomerRef` = the company's QBO Id, `DocNumber` = "2026-128", `EmailStatus` = "NotSet".
- [ ] Given a draft or in-review invoice, then no job is enqueued.
- [ ] Given an invoice with `issue_date` before `sync_start_date`, then no job is enqueued.
- [ ] Given the MOB October invoice (1,395,000 + 607,200), then the payload has Lines `13950.00` and `6072.00` and the job succeeds when QBO returns `TotalAmt 20022.00`.
- [ ] Given an hourly line 0.25 h @ 14,533 cents, then that line is sent as `Qty 1`, `UnitPrice 36.33`.
- [ ] Given QBO returns `TotalAmt` different from `total_cents/100`, then the job is `failed` with `TOTAL_MISMATCH` and the Id is still stored.
- [ ] Given QBO already has DocNumber 2026-121 with the same customer and total 11160.00, then the job ends `linked` with that Id and no POST /invoice is made.
- [ ] Given a timeout on the first create attempt and success on retry, then both requests carry the same `requestid` and exactly one Id is stored.
- [ ] Given a client with no QBO link, when its invoice job runs, then it fails with `CUSTOMER_UNMAPPED`; when the client is then linked, the job returns to `pending` and succeeds.
- [ ] Given a payment recorded on an invoice whose create job is still pending, then the payment job shows "Waiting for invoice 2026-121 to sync" and runs after the invoice job succeeds.
- [ ] Given a synced payment is deleted in ArchiTrac, then a `payment/delete` job calls `operation=delete` with the current `SyncToken`.
- [ ] Given a synced invoice is voided, then `operation=void` is called; given 5010 on the first try, then it re-reads and succeeds.
- [ ] Given 5 retryable failures, then the job is `failed`, shows in "Needs attention", and Retry sets it back to `pending` keeping its `request_id`.
- [ ] Given a cron request without the correct `CRON_SECRET`, then it returns 401 and processes nothing.
- [ ] Given two firms, then Firm A's sync jobs and integration row are invisible to Firm B (RLS test).
- [ ] Given Disconnect, then the revoke endpoint is called, tokens are null, status = `disconnected`, and existing `quickbooks_invoice_id` values are kept.

## Open questions
1. **Data model addition needed:** new table `integration_sync_jobs` — `id, firm_id, integration_id fk, entity_type text ('invoice','payment','customer'), entity_id uuid, operation text ('create','void','delete'), status enum ('pending','running','succeeded','linked','failed','cancelled'), request_id uuid, attempts smallint default 0, next_attempt_at timestamptz, locked_at timestamptz null, qbo_id text null, error_code text null, error_message text null, request_body jsonb null, response_body jsonb null, created_at, finished_at`; partial unique index `(entity_type, entity_id, operation) where status in ('pending','running')`; RLS policy.
2. **Data model addition needed:** `integrations.status` as enum `integration_status` (`connected`, `needs_reauth`, `disconnected`); add `refresh_token_expires_at timestamptz`, `settings jsonb` (company_name, customer_mode, item_map, deposit_account_id, payment_method_map, sync_start_date), `connected_by uuid`, `connected_at timestamptz`, `last_token_refresh_at timestamptz`; unique `(firm_id, provider)`; unique `(provider, external_account_id) where status = 'connected'` so two firms can't connect the same QBO company.
3. Confirm TMG's customer mode is `client` (memory: TMG doesn't use QBO Projects; jobs are separated by client). Do TMG's QBO customers already exist under names that match ArchiTrac company names?
4. What `sync_start_date` should TMG use at cut-over? Invoices issued earlier are imported (invoicing open question 13) and linked by DocNumber, not created.
5. Which QBO income account(s) and items does TMG's accountant want for fees vs consultant pass-through? (Affects item mapping defaults.)
6. Is "Custom transaction numbers" already on in TMG's QBO? If off, QBO assigns its own numbers and rule 11c can't match.
