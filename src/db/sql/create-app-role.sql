-- Run ONCE per Neon project, in the Neon SQL Editor, on the `main` branch
-- (branches created afterwards inherit the role).
--
-- Creates `architrac_app`, the login the app uses (DATABASE_URL).
-- It is deliberately limited:
--   * NOBYPASSRLS: row-level security always applies, so one firm can't read another's rows.
--   * Not the table owner: migrations run as the owner role instead.
--   * No DELETE: rows are archived (archived_at), never deleted.
--
-- Before running: replace CHANGE_ME with a password you generate locally:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- Do not save the real password in this file.

create role architrac_app with login password 'CHANGE_ME'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

grant connect on database architrac to architrac_app;
grant usage on schema public to architrac_app;

-- Tables that already exist (none on a fresh project, but safe to re-run).
grant select, insert, update on all tables in schema public to architrac_app;
grant usage, select on all sequences in schema public to architrac_app;

-- Tables created later by migrations (run as the owner role you are signed in as now).
alter default privileges in schema public
  grant select, insert, update on tables to architrac_app;
alter default privileges in schema public
  grant usage, select on sequences to architrac_app;

-- Check: should return one row with rolbypassrls = false.
select rolname, rolbypassrls, rolsuper from pg_roles where rolname = 'architrac_app';
