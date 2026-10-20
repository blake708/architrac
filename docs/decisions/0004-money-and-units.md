# ADR 0004: Money, percentages and hours

- **Status:** Accepted
- **Date:** 2026-10-20

## Decision
Money = integer cents (`bigint`, `*_cents`). Percentages = basis points (`integer`, `*_bp`; 6000 = 60%). Hours = `numeric(6,2)` in 0.25 steps. Rates are frozen onto time entries at approval.

## Why
Floating-point math caused rounding errors in the mockup (e.g. phase fees not summing to the total). Frozen rates keep old invoices and reports correct when rates change.

## Consequences
All math goes through `src/lib/calc` with explicit rounding (round half away from zero at the final step); remainders from splitting a total go to the largest unedited part.
