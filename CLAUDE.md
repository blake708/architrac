# CLAUDE.md — ArchiTrac

Claude Code reads this file at the start of every session. Keep it short and current. If a rule here conflicts with a spec, stop and ask.

## What this is
ArchiTrac is a multi-firm SaaS for small architecture firms: projects, phases & fees, time, invoicing, and add-on modules (Build/CA, Workload, Accounting, Marketing, Knowledge, Website, Hiring). The first customer is the owner's own firm. The builder (Blake) is new to coding: **explain what you're doing in plain language, one step at a time, and say why.**

## Where things are
- `docs/ROADMAP.md` — releases and what's in each. **Only build what's in the current release.**
- `docs/DATA_MODEL.md` — tables and columns. Source of truth for the schema. The "Schema additions requested by the specs" table lists fields to add per milestone.
- `docs/OPEN_DECISIONS.md` — unresolved product decisions. If a task depends on one without a recorded decision, ask Blake first.
- `docs/ARCHITECTURE.md` — stack, folders, multi-tenancy, auth, secrets.
- `docs/DESIGN_SYSTEM.md` + `src/styles/tokens.css` — colors, type, spacing, components.
- `docs/specs/release-N/*.md` — one spec per screen. A screen is "done" when every acceptance test in its spec passes.
- `docs/decisions/` — architecture decision records (ADRs). Add one when making a choice that's hard to undo.
- `mockup/*.dc.html` — the clickable design mockup. **Reference for layout and look only.** Do not copy its code structure (it's a prototype format with fake data). Read the markup for layout and the JS block at the bottom of each file for data and rules. The rendered version is at https://claude.ai/artifact/F7g4PL5cpRbcxRK9RRKggs (Blake can screenshot a page for you).
- `seed/seed-data.json` — demo data matching the mockup.

## Stack (do not change without an ADR)
Next.js (App Router) · TypeScript (strict) · Tailwind CSS · PostgreSQL on Neon · Drizzle ORM · Clerk (auth + organizations) · Zod (validation) · Vitest (unit) · Playwright (end-to-end) · Vercel (hosting) · pnpm.

## Non-negotiable rules
1. **Tenant isolation.** Every firm-owned table has `firm_id`. Every query goes through the tenant-scoped db helper (`src/db/tenant.ts`), which sets the firm for row-level security. Never query a firm-owned table with the raw client. Every new table gets an RLS policy and a cross-firm test.
2. **Money in integer cents** (`*_cents`, `bigint`), percentages in basis points (`*_bp`). Never floats for money. Format only at display time with `src/lib/format.ts`.
3. **Server-side permission checks.** Hiding a button is not security. Every server action and route handler calls `requireRole(...)` / `can(...)` from `src/lib/auth/permissions.ts`.
4. **Rates, cost, profit and salaries** are only returned to owner/admin. Strip them on the server, not in the UI.
5. **Validate all input with Zod** on the server.
6. **No hard deletes.** Set `archived_at`.
7. **Write to `activity_log`** for creates, updates, status changes on business records.
8. **Secrets never reach the browser.** Integration tokens are encrypted (`src/lib/crypto.ts`) and only read in server code.
9. **Calculations live in `src/lib/calc/`** as pure functions with unit tests. UI and server code call them; never re-implement math inline.
10. **Tests ship with the feature.** Each spec's acceptance tests become Vitest or Playwright tests in the same pull request.

## How to work
- Start each task by reading the relevant spec and restating the plan in a short checklist. Wait for "go" before writing code if the task touches the schema, auth, or money.
- Work on a git branch named `feat/<short-name>`. Small commits with clear messages.
- After changes: run `pnpm lint && pnpm typecheck && pnpm test`. Fix failures before saying you're done.
- Database changes: edit `src/db/schema/*`, run `pnpm db:generate`, review the SQL migration, then `pnpm db:migrate`. Never edit an applied migration.
- If something in a spec is unclear or contradicts the data model, ask; don't guess. Add the question to the spec's "Open questions".
- When you finish, summarize: what changed, how to try it, what tests cover it, anything left open.

## Commands
| Command | What it does |
|---|---|
| `pnpm dev` | Run the app locally at http://localhost:3000 |
| `pnpm lint` / `pnpm typecheck` | Code style and type checks |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | Browser tests (Playwright) |
| `pnpm db:generate` | Create a migration from schema changes |
| `pnpm db:migrate` | Apply migrations to the database in `.env.local` |
| `pnpm db:seed` | Load `seed/seed-data.json` into the dev database |
| `pnpm db:studio` | Browse the database in the browser |

## Style
- Components: function components, named exports, files in kebab-case (`project-header.tsx`).
- Server first: use React Server Components for reading data, Server Actions for writes. Client components only where interaction needs it.
- UI copy: sentence case in body text; table headers and section labels are uppercase via CSS (not typed in caps).
- Use the shared components in `src/components/ui/` before creating new ones.
