# ArchiTrac Architecture

## 1. The big picture

```
 Browser (React UI)
     │  pages, forms
     ▼
 Next.js app on Vercel
   ├─ Server Components  → read data
   ├─ Server Actions     → create / update data
   ├─ Route handlers     → webhooks (Clerk, Stripe, QuickBooks), PDF, cron
   └─ src/lib            → permissions, calculations, integrations
     │
     ├──► Neon PostgreSQL (all app data, row-level security per firm)
     ├──► Clerk (sign-in, users, organizations = firms)
     ├──► Cloudflare R2 (files: invoice PDFs, documents)   [Release 1+]
     ├──► Postmark or Resend (email)                        [Release 1]
     ├──► QuickBooks Online API                              [Release 1]
     ├──► Stripe (client payments, subscriptions)           [Release 2/5]
     └──► Dropbox Sign (e-signature)                         [Release 3]
```

Plain-language version: the browser shows pages; the Next.js server does all the real work (checking who you are, reading and saving data, doing the math, talking to QuickBooks); the database stores everything; outside services handle logins, email, files and payments.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Catches mistakes before they run |
| Framework | Next.js App Router | UI and server in one project; first-class on Vercel; same as BuildFlow |
| Styling | Tailwind CSS + design tokens | Fast to match the mockup; tokens keep it consistent |
| UI primitives | Radix UI (via shadcn/ui, restyled) | Accessible dropdowns, dialogs, tabs out of the box |
| Database | PostgreSQL on Neon | Reliable, row-level security, branching for test databases |
| ORM | Drizzle | Type-safe queries, readable SQL migrations |
| Auth | Clerk with Organizations | Sign-in, 2FA, invites; one Clerk org = one firm |
| Validation | Zod | Same schema checks forms and server input |
| Tables | TanStack Table | Sorting/filtering for big lists |
| Tests | Vitest + Playwright | Unit tests for math; browser tests for flows |
| Errors | Sentry | Alerts when something breaks |
| Package manager | pnpm | Fast and strict |

## 3. Folder structure

```
architrac/
├─ CLAUDE.md
├─ docs/                     specs, data model, decisions
├─ mockup/                   reference HTML (not part of the app)
├─ seed/                     demo data
├─ src/
│  ├─ app/
│  │  ├─ (auth)/sign-in, sign-up, onboarding
│  │  ├─ (app)/app/          everything behind login, served under the /app URL prefix
│  │  │  ├─ layout.tsx       app shell (rail + header)
│  │  │  ├─ page.tsx         Home dashboard (/app)
│  │  │  ├─ projects/        list, new, [projectId]/(overview|phases|team|billing)
│  │  │  ├─ contacts/
│  │  │  ├─ team/
│  │  │  ├─ time/            week/[weekStart], history, approvals
│  │  │  ├─ invoices/
│  │  │  └─ settings/        firm, users, modules, phases, rates, time, integrations
│  │  └─ api/                webhooks, cron, pdf
│  ├─ components/
│  │  ├─ ui/                 Button, Input, Select, Table, Card, Tabs, Badge, Dialog…
│  │  └─ shell/              MenuRail, TopHeader, PageHeader
│  ├─ db/
│  │  ├─ schema/             one file per area (firms.ts, projects.ts, time.ts…)
│  │  ├─ client.ts           raw client (only used by tenant.ts and migrations)
│  │  ├─ tenant.ts           withFirm(firmId, fn) → scoped transaction
│  │  └─ seed.ts
│  ├─ lib/
│  │  ├─ auth/               getSession(), requireRole(), can()
│  │  ├─ calc/               pure business math + tests
│  │  ├─ format.ts           money, hours, dates
│  │  ├─ crypto.ts           encrypt/decrypt secrets
│  │  └─ integrations/       quickbooks/, email/, storage/
│  ├─ server/                server actions grouped by area
│  └─ styles/tokens.css
└─ tests/e2e/                Playwright
```

## 4. Multi-tenancy (keeping firms apart)

Two layers, so one mistake can't leak data:

1. **App layer:** every server action gets the current firm from the session (Clerk's active organization → `firms.clerk_org_id`) and passes it to `withFirm(firmId, async (db) => …)`.
2. **Database layer:** `withFirm` opens a transaction and runs `select set_config('app.firm_id', $1, true)`. Every firm-owned table has RLS enabled with:
   ```sql
   alter table projects enable row level security;
   alter table projects force row level security;
   create policy firm_isolation on projects
     using (firm_id = current_setting('app.firm_id')::uuid)
     with check (firm_id = current_setting('app.firm_id')::uuid);
   ```
   The app connects as a database role that is **not** the table owner and does not have `bypassrls`. Migrations run as the owner role.

**Required test:** for every table, create rows in Firm A and Firm B, run as Firm A, and assert Firm B's rows are invisible and can't be updated.

## 5. Authentication and permissions

- Clerk handles sign-in, sign-up, password reset, 2FA, and invitations. One Clerk Organization per firm.
- On first sign-in, a Clerk webhook (`/api/webhooks/clerk`) creates the `users` row; creating an org creates `firms`, `firm_settings` and the owner `memberships` row.
- `app_role` lives in our `memberships` table (source of truth), not only in Clerk.

### Permission matrix (Release 1)

| Capability | Owner | Admin | PM | Staff |
|---|---|---|---|---|
| Firm settings, modules, integrations | ✔ | ✔ | | |
| Users & invitations | ✔ | ✔ | | |
| View/edit rates (bill & cost) | ✔ | ✔ | | |
| See cost, profit, overhead | ✔ | ✔ | | |
| Create projects | ✔ | ✔ | ✔ | |
| Edit project phases & fees | ✔ | ✔ | own projects | |
| View projects | all | all | all | assigned |
| Enter own time | ✔ | ✔ | ✔ | ✔ |
| Approve time | all | all | own projects | |
| Create/send invoices | ✔ | ✔ | draft only, own projects | |
| Record payments, QuickBooks sync | ✔ | ✔ | | |
| Contacts | edit | edit | edit | view |
| Delete (archive) firm | ✔ | | | |

Implement as a single `can(session, action, resource?)` function with a unit test per row.

## 6. Data access patterns

- **Read:** Server Components call functions in `src/server/<area>/queries.ts`, which call `withFirm`.
- **Write:** forms call Server Actions in `src/server/<area>/actions.ts`: `requireRole` → Zod parse → `withFirm` transaction → write → `activity_log` → `revalidatePath`.
- Return typed results `{ ok: true, data } | { ok: false, error }`; never throw raw errors to the UI.

## 7. Secrets and environment

- `.env.local` (never committed) holds keys for local development; Vercel project settings hold production values.
- Integration tokens (QuickBooks) are stored in `integrations` encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Only server code decrypts.
- See `.env.example` for the full list.

## 8. Environments

| Environment | Database | URL | Who uses it |
|---|---|---|---|
| Local | Neon dev branch | localhost:3000 | Blake + Claude Code |
| Preview | Neon branch per pull request | vercel preview link | Review before merging |
| Production | Neon main | app domain | TMG (later other firms) |

## 9. Background jobs

Vercel Cron (route handlers under `/api/cron/*`) for: timesheet reminders (weekly), QuickBooks token refresh and retry of failed syncs (hourly). Move to a queue (Inngest or Trigger.dev) if jobs grow.

## 10. Observability and backups

- Sentry for errors (client and server).
- Neon point-in-time restore (check retention on the chosen plan) plus a weekly `pg_dump` to R2. Test a restore once per release.
- `activity_log` for business audit history.
