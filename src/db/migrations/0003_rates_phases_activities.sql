CREATE TYPE "public"."activity_scope" AS ENUM('project', 'overhead');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('fixed', 'hourly', 'nte');--> statement-breakpoint
CREATE TABLE "firm_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_billable" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "firm_roles_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"applies_to" "activity_scope" NOT NULL,
	"overhead_category_id" uuid,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "activities_scope_category" CHECK (("activities"."applies_to" = 'overhead') = ("activities"."overhead_category_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "overhead_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"is_leave" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_categories_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
CREATE TABLE "phase_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_optional" boolean DEFAULT false NOT NULL,
	"default_fee_type" "fee_type" DEFAULT 'fixed' NOT NULL,
	"default_fee_share_bp" integer DEFAULT 0 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "phase_templates_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "phase_templates_share_range" CHECK ("phase_templates"."default_fee_share_bp" between 0 and 10000),
	CONSTRAINT "phase_templates_optional_no_share" CHECK (not "phase_templates"."is_optional" or "phase_templates"."default_fee_share_bp" = 0)
);
--> statement-breakpoint
CREATE TABLE "rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"firm_role_id" uuid,
	"membership_id" uuid,
	"bill_rate_cents" bigint NOT NULL,
	"cost_rate_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rates_role_xor_membership" CHECK (("rates"."firm_role_id" is null) <> ("rates"."membership_id" is null)),
	CONSTRAINT "rates_amounts_min" CHECK ("rates"."bill_rate_cents" >= 0 and "rates"."cost_rate_cents" >= 0),
	CONSTRAINT "rates_dates_order" CHECK ("rates"."effective_to" is null or "rates"."effective_to" >= "rates"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "firm_roles" ADD CONSTRAINT "firm_roles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_roles" ADD CONSTRAINT "firm_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_category_same_firm_fk" FOREIGN KEY ("firm_id","overhead_category_id") REFERENCES "public"."overhead_categories"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_categories" ADD CONSTRAINT "overhead_categories_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_categories" ADD CONSTRAINT "overhead_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_templates" ADD CONSTRAINT "phase_templates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_templates" ADD CONSTRAINT "phase_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_firm_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "firm_roles_name_unique" ON "firm_roles" USING btree ("firm_id",lower("name")) WHERE "firm_roles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "activities_firm_category_idx" ON "activities" USING btree ("firm_id","overhead_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overhead_categories_code_unique" ON "overhead_categories" USING btree ("firm_id","code") WHERE "overhead_categories"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "phase_templates_code_unique" ON "phase_templates" USING btree ("firm_id",lower("code")) WHERE "phase_templates"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "phase_templates_name_unique" ON "phase_templates" USING btree ("firm_id",lower("name")) WHERE "phase_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "rates_firm_role_idx" ON "rates" USING btree ("firm_id","firm_role_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_firm_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_firm_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security for the new firm-owned tables (same rule as 0001).
ALTER TABLE "firm_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firm_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "firm_roles"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "rates"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "phase_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "phase_templates"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "overhead_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "overhead_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "overhead_categories"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "activities"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

-- A role's (or person's) rate periods never overlap (settings-rates-phases
-- rule 8). daterange(from, to, '[]') with a null "to" runs forever.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_role_no_overlap"
  EXCLUDE USING gist (firm_id WITH =, firm_role_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
  WHERE (firm_role_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_membership_no_overlap"
  EXCLUDE USING gist (firm_id WITH =, membership_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
  WHERE (membership_id IS NOT NULL);--> statement-breakpoint

-- Default setup lists for a new firm (settings-rates-phases, States → Empty
-- state and Seed values): phases, project activities, overhead phases and
-- leave. No roles. Runs as the caller, so row-level security still applies:
-- call it inside withFirm() for that firm.
CREATE FUNCTION "public"."seed_firm_defaults"(p_firm_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  cat_id uuid;
  cat record;
BEGIN
  INSERT INTO phase_templates (firm_id, code, name, default_fee_type, default_fee_share_bp, sort_order)
  VALUES
    (p_firm_id, 'PD',  'Pre-Design',             'fixed',  500, 1),
    (p_firm_id, 'SD',  'Schematic Design',       'fixed', 1500, 2),
    (p_firm_id, 'DD',  'Design Development',     'fixed', 2500, 3),
    (p_firm_id, 'CD',  'Construction Documents', 'fixed', 3500, 4),
    (p_firm_id, 'PRM', 'Permitting',             'fixed',  500, 5),
    (p_firm_id, 'CA',  'Construction Admin',     'fixed', 1500, 6),
    (p_firm_id, 'CO',  'Close Out',              'fixed',    0, 7);

  INSERT INTO activities (firm_id, name, applies_to, sort_order)
  SELECT p_firm_id, a.name, 'project', a.ord
  FROM unnest(ARRAY[
    'Design', 'Drawings & production', 'Coordination', 'Meetings',
    'Code & research', 'Specifications', 'Project management', 'QA/QC review',
    'Permit & agency review', 'Site visit', 'Submittals & RFIs',
    'Pay app review', 'Travel'
  ]) WITH ORDINALITY AS a(name, ord);

  FOR cat IN
    SELECT * FROM (VALUES
      (1,  NULL,  'Marketing',                false, ARRAY['Proposals', 'Client development', 'Website & social', 'Interviews & presentations']),
      (2,  NULL,  'Administration',           false, ARRAY['Admin & IT', 'Accounting & billing', 'Office management']),
      (3,  NULL,  'Professional development', false, ARRAY['Training & CE', 'Licensing exams', 'Conferences']),
      (4,  NULL,  'Firm standards',           false, ARRAY['Standards & templates', 'Revit library', 'Knowledgebase']),
      (10, 'PTO', 'Paid time off',            true,  ARRAY['Vacation', 'Sick', 'Personal']),
      (11, 'HOL', 'Holiday',                  true,  ARRAY['Holiday'])
    ) AS v(ord, code, name, is_leave, acts)
  LOOP
    INSERT INTO overhead_categories (firm_id, code, name, is_leave, sort_order)
    VALUES (p_firm_id, cat.code, cat.name, cat.is_leave, cat.ord)
    RETURNING id INTO cat_id;

    INSERT INTO activities (firm_id, name, applies_to, overhead_category_id, sort_order)
    SELECT p_firm_id, a.name, 'overhead', cat_id, a.ord
    FROM unnest(cat.acts) WITH ORDINALITY AS a(name, ord);
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seed_firm_defaults"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."seed_firm_defaults"(uuid) TO architrac_app;--> statement-breakpoint

-- Give firms that already exist the same defaults (once).
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT id FROM public.firms LOOP
    PERFORM set_config('app.firm_id', f.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM public.phase_templates WHERE firm_id = f.id) THEN
      PERFORM public.seed_firm_defaults(f.id);
    END IF;
  END LOOP;
  PERFORM set_config('app.firm_id', '', true);
END
$$;
