# Claude Code Prompts, in Order

Paste these into Claude Code (the panel inside VS Code) one at a time. Start each in a **fresh conversation** so Claude reads `CLAUDE.md` cleanly. Wait for each to finish, try the result, and commit before moving on.

**The rhythm for every prompt:**
1. Paste the prompt.
2. Claude replies with a plan. Read it. If something looks off, say so. Then type `go`.
3. When it finishes, run what it tells you to try (usually `pnpm dev`, then open the browser).
4. Ask "run lint, typecheck and tests" if it didn't already.
5. Commit (Claude can do it: "commit this with a clear message").

> Tip: press **Shift+Tab** in Claude Code to switch to *plan mode* before pasting a big prompt. Claude then plans without touching files until you approve.

---

## Release 0

### 0.1 Project setup
```
Read CLAUDE.md, docs/ARCHITECTURE.md and docs/DESIGN_SYSTEM.md.
Set up this repository as a Next.js App Router project with TypeScript (strict), Tailwind CSS v4, ESLint, Prettier, Vitest and Playwright, using pnpm.
Keep the existing CLAUDE.md, docs/, mockup/, seed/ and src/styles/tokens.css. Wire tokens.css into globals.css. Load Barlow and IBM Plex Mono with next/font.
Create the folder structure from ARCHITECTURE.md section 3 (empty folders get a .gitkeep).
Add the package.json scripts listed in CLAUDE.md (db scripts can be placeholders for now).
Make the home route show "ArchiTrac" in the brand font so I can see it works.
Explain each step as you go — I'm new to this.
```

### 0.2 Database
```
Read docs/DATA_MODEL.md (Global rules and Release 0), docs/ARCHITECTURE.md section 4, and docs/decisions/0003 and 0004.
Set up Drizzle with Neon using DATABASE_URL (app role) and DATABASE_URL_OWNER (migrations).
Create the Release 0 tables: firms, users, memberships, firm_settings, teams, activity_log, with enums.
Write the migration, including RLS policies for firm-owned tables, and a SQL script I can run once in Neon to create the architrac_app role without BYPASSRLS.
Build src/db/tenant.ts with withFirm(firmId, fn).
Write a Vitest integration test proving Firm A cannot read or update Firm B's rows.
Walk me through creating the Neon project and filling .env.local before you run anything.
```

### 0.3 Auth and firms
```
Read docs/ARCHITECTURE.md section 5 and docs/specs/release-0/app-shell.md (sign-in and onboarding parts).
Install Clerk with Organizations. Add sign-in, sign-up and create-firm onboarding.
Add a Clerk webhook route that creates users, firms, firm_settings and the owner membership.
Build src/lib/auth: getSession(), requireRole(), can() implementing the permission matrix, with a unit test for every row of the matrix.
Protect everything under the (app) route group with middleware.
Tell me exactly what to click in the Clerk dashboard.
```

### 0.4 UI kit
```
Read docs/DESIGN_SYSTEM.md and open mockup/Projects.dc.html and mockup/Project.dc.html to see the components in use.
Build the components in the "Components" table in src/components/ui using Radix primitives where useful, styled only with our tokens.
Create /dev/ui that shows every component and variant. Match the mockup closely: 2px radius, uppercase captions, mono numbers.
```

### 0.5 App shell
```
Build docs/specs/release-0/app-shell.md. Use mockup/Home.dc.html as the visual reference.
Follow the spec's acceptance tests and implement them as Playwright tests.
```

### 0.6 Settings shell
```
Build docs/specs/release-0/settings-firm.md. Visual reference: mockup/Settings.dc.html.
Implement the acceptance tests.
```

### 0.7 Deploy
```
Help me put this project on GitHub and deploy it to Vercel with a preview deployment for every pull request and a Neon database branch per preview.
Add a GitHub Actions workflow that runs lint, typecheck, unit tests and Playwright on every pull request.
Add Sentry. Give me the steps I need to do in each website, one at a time.
```

---

## Release 1

Use the same pattern for every screen:

```
Build docs/specs/release-1/<SPEC FILE>.md.
Visual reference: mockup/<MOCKUP FILE>.dc.html.
First list any tables or columns you need to add (check docs/DATA_MODEL.md), and any open questions in the spec. Wait for my answers.
Put all calculations in src/lib/calc with unit tests using the numbers in the spec.
Implement every acceptance test. Update docs/DATA_MODEL.md if the schema changes.
```

| Milestone | Spec file | Mockup file |
|---|---|---|
| 1.1 | settings-rates-phases | Settings |
| 1.2 | contacts | Contacts |
| 1.3 | team | Team |
| 1.4 | projects-list | Projects |
| 1.5 | project-detail | Project |
| 1.6 | timesheet | Time |
| 1.7 | timesheet-approval | Time |
| 1.8 | invoicing | Accounting |
| 1.9 | quickbooks-sync | (none — Settings → Integrations) |
| 1.10 | home | Home |

Before 1.4, run this once:
```
Write src/db/seed.ts that loads seed/seed-data.json into the dev database (read seed/README.md for the id convention), and the pnpm db:seed script. It must be safe to run twice.
```

---

## Useful prompts any time

- **"Explain what this file does, line by line, in plain language."**
- **"Something's broken: <paste the error>. Find the cause before changing anything."**
- **"Review the changes on this branch against CLAUDE.md's non-negotiable rules."**
- **"Does this screen match the mockup? Compare and list differences."**
- **"Update the spec's Status to Built and tick the acceptance tests that pass."**
