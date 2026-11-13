# ADR 0008: Hourly cost comes from each person's pay; bill rate from their role on the project

- **Status:** Accepted
- **Date:** 2026-11-13
- **Decided by:** Blake

## Decision
1. **Cost is per person, from their pay.** Owners and admins enter pay in the Team drawer: salary or hourly, the amount, a burden % (taxes and benefits, set per person), and the date it starts. It's stored in `membership_pay`, effective-dated like `rates`.
   - Salaried: cost/hour = salary ÷ (weekly hours × 52) × (1 + burden).
   - Hourly: cost/hour = wage × (1 + burden).
   - Rounded half up to the cent (`hourlyCostCents` in `src/lib/calc/pay.ts`).
2. **No pay entered → the old rule.** Cost falls back to the person's override, then their role's cost rate, so firms can fill pay in over time.
3. **A person's role on a project is a real firm role.** `project_members.firm_role_id` replaces the free-text `project_role`. It defaults to the person's own role when they're added (including the PM and principal added automatically) and can be changed per project.
4. **Which rates an hour gets** (`resolveRate`, `src/lib/calc/pay.ts`), worked out by one rate book (`src/server/time/rate-book.ts`) for approval, the approval and week screens, invoices and project profit:
   - **Bill:** the project's bill override for that person → the rate of their role on the project → their own override → their own role.
   - **Cost:** their pay → their own override → their own role. **Never** the project role: a PM helping as a Designer bills at the Designer rate but still costs what the PM is paid.
   - The role frozen on the time entry at approval is their role on the project, so invoices group the hours under it.
5. **Pay is owner/admin only** (CLAUDE.md rule 4). The server leaves it out for everyone else. The activity log records that pay changed and when, never the amounts.

## Why
A role's cost rate is an average. Two designers with different salaries really cost different amounts, and phase profit should show that. Billing follows the work being done on that project (the client pays the Designer rate for design work), while cost follows the person.

## Consequences
- Salaried cost uses the person's **current** weekly hours, since weekly hours have no history. Approved time is unaffected, because its rates are frozen at approval. Unapproved time and the Team page recalculate when weekly hours change.
- A salary with 0 weekly hours has no hourly cost, so it falls back to the role's cost rate.
- Pay alone doesn't give a bill rate. Someone with pay but no role on the project or of their own still blocks approval ("No rate for …").
- Migration 0022 matched existing team labels to roles by name ("PM" → Project manager, "PA" → Project architect), else used the person's own role. Migration 0023 dropped `project_role`.
- Per-person rows in `rates` (`membership_id`) still work and still have no screen. Pay covers the cost side of what they were for.
