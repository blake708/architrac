# Open Decisions

Decisions Blake needs to make. Each has a recommendation; the specs currently follow the recommendation unless noted. When you decide, change "Decision" and tell Claude Code to update the affected specs.

## Needed before Release 0

| # | Question | Recommendation | Affects | Decision |
|---|---|---|---|---|
| 1 | Login provider: Clerk or WorkOS? | Clerk (Organizations map to firms; easiest setup). Confirm with the reviewing developer | ADR 0002, app-shell | |
| 2 | Turned-off add-on modules in the menu: hidden, or shown dimmed with an "ADD" badge (as in the mockup)? | Hidden for staff and PMs; shown dimmed with "ADD" for owners/admins only, linking to Settings → Modules | app-shell, settings-firm | |

## Needed before Release 1

| # | Question | Recommendation | Affects | Decision |
|---|---|---|---|---|
| 3 | **Who approves timesheets?** (a) Each project's PM approves that project's lines; owner/admin approve overhead and leave. (b) The person's team leader approves the whole sheet, then a principal (mockup). | (a): hours are checked by the person who knows the project and budget. At TMG team leaders are PMs, so in practice it's mostly the same people. Specs follow (a) | timesheet, timesheet-approval, team, home | |
| 4 | PMs see **bill** rates on invoice lines they prepare? (Cost rates and profit stay hidden.) | Yes: bill rates print on the client's invoice anyway | invoicing, CLAUDE.md rule 4 | |
| 5 | Invoice numbering at year end: does the prefix change to "2027-" automatically, and does the counter reset to 1? | Prefix rolls over automatically; counter keeps counting (no reset), which avoids duplicate-looking numbers | invoicing | |
| 6 | Email provider: Postmark or Resend? | Postmark: best deliverability for invoices | invoicing, ARCHITECTURE | |
| 7 | Must phase fee shares total 100% before a phase template can be saved? (The mockup only warns.) | Yes, block saving | settings-rates-phases | |
| 8 | Project profit to date: based on **billed** (mockup) or **earned** (% complete × fee)? | Show both in Release 2: earned for profitability, billed for cash. Release 1 has no profit display | project-snapshot | |
| 9 | Project health: does a phase that finished over budget keep the project "At risk" until it closes? | No: flag it at phase level only; project health looks at open phases | projects-list | |
| 10 | A firm with one owner: who approves that person's overhead time? | A firm setting "allow self-approval of own time" (off by default) | timesheet-approval | |
| 11 | Do contractors get missing-timesheet reminders? | Yes, if their membership is active | timesheet-approval | |
| 12 | Retainers in Release 1 handled as a negative adjustment line on an invoice? | Yes, until Accounting (Release 2) adds proper retainer tracking | invoicing | |
| 13 | Historical invoices (e.g. 2026-097, 2026-109, 2026-121): how do they get in so "previously billed" is right? | Import them from Bubble as `sent`/`paid` invoices with lines by phase, during milestone 1.11 | invoicing, migration | |
| 14 | QuickBooks: confirm TMG's setup (customers = clients with jobs, not QBO Projects), the sync start date, income accounts/items, and whether "custom transaction numbers" is on | Clients mode; start at cut-over month | quickbooks-sync | |
| 15 | Show Close Out phase ($0 fee) in the snapshot? | Show it; hours on Close Out are real cost | project-snapshot | |
| 16 | Over-hours flag on timesheets at 44 h (40 + 4): fixed or a firm setting? | Firm setting, default 44 | timesheet | |
| 17 | Are notes required on billable time? | Optional in Release 1 | timesheet | |
