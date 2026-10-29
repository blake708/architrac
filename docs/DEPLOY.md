# Deploying ArchiTrac

How code gets from a pull request to the internet, and every setting it needs. Background and reasons: `docs/decisions/0006-deploy-pipeline.md`.

## How it works

| When | Workflow | What happens |
|---|---|---|
| A pull request is opened or updated | `ci.yml` | Lint, typecheck, unit tests and browser tests run against a throwaway Neon branch |
| Same | `preview.yml` | Neon branch `preview/pr-<n>` is created and migrated; a Vercel preview is deployed; the link is posted on the pull request |
| A pull request is closed or merged | `preview.yml` | The preview's Neon branch is deleted |
| A pull request is merged into `main` | `production.yml` | The production database (Neon `main`) is migrated, then production is deployed |

Vercel never deploys by itself (`vercel.json`); only these workflows do.

## Settings

### GitHub → repo → Settings → Secrets and variables → Actions

**Secrets** (hidden):

| Name | Where it comes from |
|---|---|
| `NEON_API_KEY` | Neon → Account settings → API keys |
| `NEON_APP_ROLE_PASSWORD` | The `architrac_app` password: the part between `architrac_app:` and `@` in `DATABASE_URL` in your `.env.local` |
| `CLERK_DEV_SECRET_KEY` | Clerk → development instance → API keys (`sk_test_…`) |
| `VERCEL_TOKEN` | Vercel → Account settings → Tokens |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens (organization token) |

**Variables** (visible, not secret):

| Name | Where it comes from |
|---|---|
| `NEON_PROJECT_ID` | Neon → project → Settings → General |
| `CLERK_DEV_PUBLISHABLE_KEY` | Clerk → development instance → API keys (`pk_test_…`) |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `.vercel/project.json` after `pnpm dlx vercel@65 link` |
| `SENTRY_ORG`, `SENTRY_PROJECT` | The organization and project slugs in your Sentry URL |

### Vercel → project → Settings → Environment Variables

Set each for **Production** and **Preview**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Same as `.env.local` (development keys until there's a domain) |
| `CLERK_SECRET_KEY` | Same as `.env.local` |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk → Webhooks → the endpoint for the production URL |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `ENCRYPTION_KEY` | A **new** key just for production. Never change it later: stored integration tokens couldn't be read anymore |
| `NEXT_PUBLIC_APP_URL` | The production URL, e.g. `https://architrac.vercel.app` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → project → Settings → Client Keys (DSN) |

Don't set `DATABASE_URL` in Vercel. The workflows pass it to each deployment.

## Troubleshooting

- **Preview workflow fails at "Create or reuse preview database branch":** check `NEON_API_KEY` and `NEON_PROJECT_ID`. The Neon free plan limits how many branches you can have, so delete old `preview/*` or `ci/*` branches in the Neon console.
- **The app shows "permission denied" errors on a preview:** `NEON_APP_ROLE_PASSWORD` is wrong, or `architrac_app` was never created on `main` (run `src/db/sql/create-app-role.sql` there).
- **Browser tests fail in CI but pass locally:** download the `playwright-report` artifact from the failed run on GitHub (it contains traces).
