# ADR 0001: Build ArchiTrac in code, not Bubble

- **Status:** Accepted
- **Date:** 2026-10-20

## Context
ArchiTrac starts from TMG's Bubble app (tmg-intranet) but will be sold to many firms. It handles money, rates and per-firm data, and has heavy calculations (fees, profit, workload).

## Decision
Build a new application in TypeScript/Next.js with PostgreSQL. Keep tmg-intranet running until Release 1 cut-over, then read-only for a year.

## Consequences
- Firm isolation is enforced once in the database (RLS) instead of per-type Bubble privacy rules.
- Business math is unit-tested; code and data are owned and portable.
- Slower to start than Bubble; requires developer review of the foundation.
