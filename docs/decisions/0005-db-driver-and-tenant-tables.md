# ADR 0005: Database driver and how tenant isolation is applied

- **Status:** Accepted
- **Date:** 2026-10-22

## Decision
1. **Driver:** Drizzle over Neon's WebSocket `Pool` (`drizzle-orm/neon-serverless`), not the HTTP driver. `withFirm` needs an interactive transaction so `set_config('app.firm_id', …, true)` applies to every query in it. The app connects through Neon's pooled (`-pooler`) host; migrations use the direct host.
2. **Fail closed:** policies use `nullif(current_setting('app.firm_id', true), '')::uuid`, so a query run without a firm returns no rows instead of erroring or leaking.
3. **firms:** RLS keyed on `id`, enabled but not forced. A `security definer` function `firm_id_for_clerk_org(text)` is the single cross-firm lookup (Clerk org → firm id) and returns only an id.
4. **users:** shared identity table, no `firm_id`, no RLS for now.
5. **Same-firm foreign keys:** links between firm-owned rows use composite FKs on `(firm_id, id)`.
6. **App role privileges:** `architrac_app` is created by SQL (`src/db/sql/create-app-role.sql`) with `NOBYPASSRLS` and gets SELECT/INSERT/UPDATE only, no DELETE.

## Why
- A transaction-scoped setting can't leak between requests that share a pooled connection.
- Plain foreign keys are checked without RLS, so without composite keys a row could reference another firm's row.
- Withholding DELETE turns the "no hard deletes" rule into something the database enforces.
- Roles created in the Neon Console join Neon's admin group, so the app role is created by SQL instead.

## Consequences
- Every new firm-owned table needs: `firm_id`, ENABLE + FORCE RLS with the `firm_isolation` policy, composite FKs for links to other firm-owned tables, and cases in `src/db/tenant.db.test.ts`.
- `pnpm test` needs a database (`.env.local` locally; a Neon branch in CI from milestone 0.7).
- Test cleanup and admin scripts use the owner role (`DATABASE_URL_OWNER`), never the app.
- `users` has no row-level protection yet. Flag it for the Release 0 developer review and revisit in 0.3.
