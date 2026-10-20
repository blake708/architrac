# ADR 0002: Application stack

- **Status:** Accepted (confirm auth provider and ORM with reviewing developer before Release 0.2)
- **Date:** 2026-10-20

## Decision
Next.js App Router · TypeScript strict · Tailwind CSS v4 · Radix/shadcn primitives · PostgreSQL on Neon · Drizzle ORM · Clerk with Organizations · Zod · Vitest · Playwright · Vercel · pnpm · Sentry.

## Why
Same family as BuildFlow (so Build can merge in Release 4); widely documented, which matters for building with Claude Code; managed services keep operations small.

## Alternatives considered
- **Prisma** instead of Drizzle: more popular, but RLS with per-transaction settings is simpler in Drizzle and its migrations are plain SQL.
- **WorkOS / Auth.js** instead of Clerk: WorkOS is stronger for enterprise SSO (later); Auth.js is free but more to build. Clerk's Organizations map directly to firms.
- **Supabase** instead of Neon + Clerk: viable all-in-one; rejected to stay aligned with BuildFlow.
