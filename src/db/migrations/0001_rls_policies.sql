-- Row-level security: each firm only sees its own rows.
-- withFirm() sets app.firm_id for one transaction; these policies compare against it.
-- nullif(current_setting('app.firm_id', true), '') is NULL when no firm is set, so a
-- query outside withFirm matches no rows (fails closed) instead of erroring.
-- Requires the architrac_app role (src/db/sql/create-app-role.sql) to exist.

-- Firm-owned tables. FORCE applies the rules to the table owner too.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "memberships"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "firm_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firm_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "firm_settings"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "teams"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "activity_log"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

-- firms: the app can only see and change its own firm's row (keyed on id).
-- Not FORCEd, so the owner-run lookup function below can find a firm by Clerk org id.
ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "firms"
  USING (id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

-- The one cross-firm lookup: turn Clerk's active organization into our firm id,
-- so the app knows which firm to pass to withFirm(). Returns only the id.
CREATE FUNCTION "public"."firm_id_for_clerk_org"(p_clerk_org_id text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.firms WHERE clerk_org_id = p_clerk_org_id AND archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."firm_id_for_clerk_org"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."firm_id_for_clerk_org"(text) TO architrac_app;
