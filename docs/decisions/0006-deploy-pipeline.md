# ADR 0006: Deploy pipeline (GitHub Actions → Neon branch → Vercel) and Sentry

- **Status:** Accepted
- **Date:** 2026-10-29

## Decision
1. **GitHub Actions does every deploy.** Vercel's own Git deploys are off (`vercel.json` → `git.deploymentEnabled: false`). Workflows build with the Vercel CLI (`vercel build`) and upload with `vercel deploy --prebuilt`.
2. **CI** (`.github/workflows/ci.yml`, every pull request): lint and typecheck; then a throwaway Neon branch `ci/pr-<n>-run-<id>` copied from `main`, migrated, used by `pnpm test` and `pnpm test:e2e`, and deleted afterwards. It expires after 2 hours anyway, in case the delete step never runs.
3. **Preview** (`preview.yml`, every pull request): Neon branch `preview/pr-<n>` copied from `main` (reused on later pushes), migrated, deployed, and the link posted on the pull request. Deleted when the pull request closes.
4. **Production** (`production.yml`, push to `main`): migrate Neon `main`, then deploy with `--prod`.
5. **The app always connects as `architrac_app`.** `scripts/ci/neon-branch.sh` takes the owner's pooled URL from `neonctl` and swaps in the app login. The password comes from the `NEON_APP_ROLE_PASSWORD` secret, because Neon can't show passwords for roles created by SQL. `DATABASE_URL` is passed to each deployment with `--env`; it is not stored in Vercel's settings.
6. **Sentry** (`@sentry/nextjs`) covers the browser, the server and the proxy. It is on only when `NEXT_PUBLIC_SENTRY_DSN` is set, and is tagged with `NEXT_PUBLIC_APP_ENV` (production / preview). `sendDefaultPii: false`, and `scrub()` removes request bodies, cookies, headers and query strings. There is no session replay. Source maps are uploaded at build time and then deleted from the deployment.

## Why
- Vercel's Neon integration connects previews as the database owner, which would skip row-level security on every preview (ADR 0005). Building the URL ourselves keeps previews identical to production.
- Running migrations before the deploy means new code never runs against an old schema.
- Some unit tests (`*.db.test.ts`) need a real database. A fresh branch per run keeps CI away from the dev branch.

## Consequences
- **Migrations must be backward compatible.** For about a minute after a migration, the old code is still serving requests against the new schema. Add first, remove in a later release.
- Browser tests share the Clerk development instance. CI runs them one at a time (`concurrency: clerk-e2e`). Running `pnpm test:e2e` locally while CI is running can make either run fail.
- Branches copy `main`'s data. Once real firm data lives in `main`, preview and CI branches will hold copies of it. Revisit then (Neon schema-only branches, or a seeded parent branch).
- Secrets and settings live in GitHub (Actions secrets and variables) and Vercel (project environment variables). The list is in `docs/DEPLOY.md`.

## Open questions
- **Clerk production instance:** this needs a real domain. Until then, production uses the Clerk development keys.
- **Clerk webhook on previews:** the webhook points at one URL. Creating a new firm through the browser on a preview won't write the firm row. Signing in as an existing user works.
- **Invite links on previews:** `NEXT_PUBLIC_APP_URL` is the production URL, so invitation emails sent from a preview link to production.
