# ADR 0003: Multi-tenancy with shared tables and row-level security

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision
One database, shared tables, `firm_id` on every firm-owned row. PostgreSQL RLS policies compare `firm_id` to `current_setting('app.firm_id')`, which `withFirm()` sets per transaction. The app's DB role cannot bypass RLS.

## Why
Simple to operate (one schema, one migration path) while giving a second, database-level guard against cross-firm leaks.

## Consequences
- Every new table needs a policy and a cross-firm test (enforced in code review).
- Background jobs must call `withFirm` per firm; there is no "all firms" query except in owner-role admin scripts.
