# ArchiTrac Roadmap

Each release ends with the firm using it for real work. Nothing from a later release starts until the current one is done and in use.

| Release | Ships | Done when |
|---|---|---|
| **0. Foundation** | Repo, tooling, database + RLS, Clerk auth & firms, app shell (rail + header), design-system components, Settings shell (firm, users, modules), CI and deploys | A test firm can sign up, invite a user, and see an empty styled app on a live URL; cross-firm tests pass |
| **1. Run the firm** | Roles & rates, phases & activities settings, Contacts, Team, Projects (phases, fees, team, consultants), Timesheets + approvals, Invoicing + payments, QuickBooks sync, Home (R1 widgets), Bubble data import | The firm runs a full month of time and billing only in ArchiTrac |
| **2. Money & clients** | Vendor bills on projects (core, no module, decision #27), Accounting add-on (bill payment, expenses, statements, reminders, retainers, write-offs), Reports, project snapshot with overhead, client portal, Stripe payments | A client pays an invoice through the portal |
| **3. Plan & win work** | Project schedule, Workload (incl. tentative), Marketing leads, New Proposal with fee estimator (comparables by actual hours; builds on 1.5 D's ranges), e-signature | A signed proposal becomes a project automatically |
| **4. Build & Knowledge** | Build tab + CA overview (merge BuildFlow), Knowledgebase | One live CA project fully run in ArchiTrac |
| **5. Grow** | Website, Hiring, AI features, self-serve signup, subscription billing, onboarding import | Three outside firms in a paid beta |

---

## Release 0 — milestones

Work top to bottom. Each line is roughly one Claude Code session (see `docs/PROMPTS.md`).

- [x] **0.1 Project setup** — Next.js + TypeScript + Tailwind + pnpm; ESLint/Prettier; Vitest; Playwright; folder structure from ARCHITECTURE.md; tokens.css wired; fonts loaded.
- [x] **0.2 Database** — Neon connected; Drizzle configured; schema for firms, users, memberships, firm_settings, teams, activity_log; first migration; app vs owner DB roles; RLS policies; `withFirm` helper; cross-firm test.
- [x] **0.3 Auth & firms** — Clerk installed; sign-in/up pages; create-firm onboarding creates firms (webhook syncs users/memberships); `getSession`, `requireRole`, `can` + tests; middleware protecting `(app)` routes.
- [x] **0.4 UI kit** — Button, Input, Select, Textarea, Table, Card, KPI tile, Tabs, Badge, Progress, Avatar, Dialog, Empty state; a `/dev/ui` page showing all of them.
- [x] **0.5 App shell** — Menu rail (collapse remembered), top header, page header; module visibility from `firm_settings.modules_enabled`. Spec: `specs/release-0/app-shell.md`.
- [x] **0.6 Settings shell** — Firm profile, Users & invitations, Modules. Spec: `specs/release-0/settings-firm.md`.
- [x] **0.7 Deploy** — GitHub repo; Vercel project with preview deploys; Neon branch per preview; GitHub Actions running lint/typecheck/tests; Sentry. Live at https://architrac.vercel.app. Setup and settings: `DEPLOY.md`, ADR 0006. Sentry verified with a test error from production.

## Release 1 — milestones

- [x] **1.1 Rates & firm setup** — firm_roles, rates, phase_templates, activities, overhead_categories; Settings screens. Spec: `settings-rates-phases.md`. Calc: rate lookup. Added: optional phases and phase descriptions; Settings save each change instantly except phase splits and rates (decision #18). Verified by Blake.
- [x] **1.2 Contacts** — companies, contacts. Spec: `contacts.md`. Agency is its own type; CSV import deferred to 1.11; staff view only; PMs see no money. Company panels list their people with Add person (Blake, 2026-11-03). Address lookup via Google Places (ADR 0007). Verified by Blake.
- [x] **1.3 Team** — people directory, teams. Spec: `team.md`. Built before 1.2 (Blake's call). Also (Blake, 2026-11-02): someone who signs in with a pending invitation but no invite link (lost email, or a test address) is offered "Join {firm}" instead of Create firm. Utilization hours arrive with timesheets (1.6). Verified by Blake.
- [x] **1.4 Projects** — list + create (phases from template). Spec: `projects-list.md`. Health looks at open phases only; editable phase %, hourly phases at 0%, budget hours from the blended bill rate; grouped New project form with address lookup (Blake, 2026-11-03). Verified by Blake.
- [x] **1.5 Project detail** — overview, phases & fees, team, consultants, hours vs budget. Spec: `project-detail.md`. Calc: `distributeFee`. Two PRs (Blake, 2026-11-03): **A** project page, Overview, Team (with contractors/agencies/vendors), consultants, Edit project; **B** phase editing, redistribute, role mixes per phase (template defaults, side panel; hours = role share of fee ÷ role bill rate on the day of the edit); **C** (Blake, 2026-11-04) the Project snapshot moved up from Release 2: owner/admin see profit by phase with the overhead switch, PMs see Hours vs budget restyled to match, staff see neither; **D** (Blake, 2026-11-04) New project in two steps (details + phase checklist, then estimate, fees, inline roles typed as % or hours, custom phases, consultants) and Settings → Project type ranges (migration 0009). Marked done by Blake, 2026-11-04.
- [x] **1.6 Timesheet** — weekly entry with phase + activity. Spec: `timesheet.md` (revised for decision #3 b, 2026-11-05). Two PRs: **A** migration 0010 (timesheets, rows, entries), the weekly grid with autosave, submit to the team leader (or straight to a principal), recall, History, and logged hours feeding the project page, projects list, snapshot and phase archiving (drafts count, #20); **B** notes, Copy last week, Settings → Timesheets card (due day and time #21, notes rule: optional, hourly phases, or all billable time #17, #24); notes open from an icon under each day. Marked done by Blake, 2026-11-09.
- [x] **1.7 Approvals** — Spec: `timesheet-approval.md` (revised 2026-11-09). Three PRs (Blake, 2026-11-09): **A** review route — Settings step builder (Principal in Charge, Team leader, Any principal, named person; default Principal in Charge; each PIC on a sheet approves; empty steps skip; #23), the sheet's review saved at submit, principals' sheets approved on submit with rates frozen (#22); **B** Approvals tab — queue, detail, approve / return / reopen, rate freezing at the last step, flags, bulk approve; **C** in-app notifications (bell in the header, one `notify()` helper so email can be added later; moved into Release 1, #25), week overview, reminders, nudges, daily cron (Vercel Hobby refuses hourly). Merged in PRs #26–#29; marked done by Blake, 2026-11-11.
- [ ] **1.8 Invoicing** — builder, PDF, send, payments. Spec: `invoicing.md`. Calc: phase billing. Invoicing is core, not the Accounting add-on (#27). Four PRs (Blake, 2026-11-11): **A** data and math — migration (`in_review`, nullable numbers, line snapshots, excluded entries, one open draft per project, invoice number format replacing the prefix with a per-project counter #5, project number format #28), RLS + cross-firm tests, `src/lib/calc/invoice.ts` and `invoice-number.ts`, the time-lock trigger, Settings → Billing & invoices (invoice and project number formats with live examples, payment terms, remittance text); **B** builder — New invoice, fixed / hourly / NTE / consultant / adjustment sections, warnings, totals, submit / return, delete draft; **C** send — numbering, PDF, R2, Postmark email (#6), Send modal with Retry, void, Principal in Charge can send (#26); **D** list and payments — `/app/invoices` (KPIs, tabs, aging), project Invoices tab, detail page, record / delete payments.
- [ ] **1.9 QuickBooks** — connect, customer mapping, push invoices/payments. Spec: `quickbooks-sync.md`.
- [ ] **1.10 Home** — Release 1 dashboard. Spec: `home.md`.
- [ ] **1.11 Import from Bubble** — map, import script, totals check, side-by-side month, cut-over.

`specs/release-2/project-snapshot.md` was built early in 1.5 C (Blake, 2026-11-04). Labor cost, billed and profit to date fill in once timesheets (1.6) and invoices (1.8) exist.
