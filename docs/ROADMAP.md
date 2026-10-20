# ArchiTrac Roadmap

Each release ends with the firm using it for real work. Nothing from a later release starts until the current one is done and in use.

| Release | Ships | Done when |
|---|---|---|
| **0. Foundation** | Repo, tooling, database + RLS, Clerk auth & firms, app shell (rail + header), design-system components, Settings shell (firm, users, modules), CI and deploys | A test firm can sign up, invite a user, and see an empty styled app on a live URL; cross-firm tests pass |
| **1. Run the firm** | Roles & rates, phases & activities settings, Contacts, Team, Projects (phases, fees, team, consultants), Timesheets + approvals, Invoicing + payments, QuickBooks sync, Home (R1 widgets), Bubble data import | The firm runs a full month of time and billing only in ArchiTrac |
| **2. Money & clients** | Accounting (AR/AP, expenses, vendor bills), Reports, project snapshot with overhead, client portal, Stripe payments | A client pays an invoice through the portal |
| **3. Plan & win work** | Project schedule, Workload (incl. tentative), Marketing leads, New Proposal with fee estimator, e-signature | A signed proposal becomes a project automatically |
| **4. Build & Knowledge** | Build tab + CA overview (merge BuildFlow), Knowledgebase | One live CA project fully run in ArchiTrac |
| **5. Grow** | Website, Hiring, AI features, self-serve signup, subscription billing, onboarding import | Three outside firms in a paid beta |

---

## Release 0 — milestones

Work top to bottom. Each line is roughly one Claude Code session (see `docs/PROMPTS.md`).

- [ ] **0.1 Project setup** — Next.js + TypeScript + Tailwind + pnpm; ESLint/Prettier; Vitest; Playwright; folder structure from ARCHITECTURE.md; tokens.css wired; fonts loaded.
- [ ] **0.2 Database** — Neon connected; Drizzle configured; schema for firms, users, memberships, firm_settings, teams, activity_log; first migration; app vs owner DB roles; RLS policies; `withFirm` helper; cross-firm test.
- [ ] **0.3 Auth & firms** — Clerk installed; sign-in/up pages; Clerk webhook creates users/firms/memberships; `getSession`, `requireRole`, `can` + tests; middleware protecting `(app)` routes.
- [ ] **0.4 UI kit** — Button, Input, Select, Textarea, Table, Card, KPI tile, Tabs, Badge, Progress, Avatar, Dialog, Empty state; a `/dev/ui` page showing all of them.
- [ ] **0.5 App shell** — Menu rail (collapse remembered), top header, page header; module visibility from `firm_settings.modules_enabled`. Spec: `specs/release-0/app-shell.md`.
- [ ] **0.6 Settings shell** — Firm profile, Users & invitations, Modules. Spec: `specs/release-0/settings-firm.md`.
- [ ] **0.7 Deploy** — GitHub repo; Vercel project with preview deploys; Neon branch per preview; GitHub Actions running lint/typecheck/tests; Sentry.

## Release 1 — milestones

- [ ] **1.1 Rates & firm setup** — firm_roles, rates, phase_templates, activities, overhead_categories; Settings screens. Spec: `settings-rates-phases.md`. Calc: rate lookup.
- [ ] **1.2 Contacts** — companies, contacts. Spec: `contacts.md`.
- [ ] **1.3 Team** — people directory, teams. Spec: `team.md`.
- [ ] **1.4 Projects** — list + create (phases from template). Spec: `projects-list.md`.
- [ ] **1.5 Project detail** — overview, phases & fees, team, consultants, hours vs budget. Spec: `project-detail.md`. Calc: `distributeFee`.
- [ ] **1.6 Timesheet** — weekly entry with phase + activity. Spec: `timesheet.md`.
- [ ] **1.7 Approvals** — approval queue, rate freezing. Spec: `timesheet-approval.md`.
- [ ] **1.8 Invoicing** — builder, PDF, send, payments. Spec: `invoicing.md`. Calc: phase billing.
- [ ] **1.9 QuickBooks** — connect, customer mapping, push invoices/payments. Spec: `quickbooks-sync.md`.
- [ ] **1.10 Home** — Release 1 dashboard. Spec: `home.md`.
- [ ] **1.11 Import from Bubble** — map, import script, totals check, side-by-side month, cut-over.

`specs/release-2/project-snapshot.md` is written early so the profit math is pinned down; it is built in Release 2.
