CREATE TYPE "public"."review_row_status" AS ENUM('waiting', 'approved', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."review_step_kind" AS ENUM('principal_in_charge', 'team_leader', 'any_principal', 'person');--> statement-breakpoint
CREATE TABLE "review_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"kind" "review_step_kind" NOT NULL,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "review_steps_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "review_steps_person_has_member" CHECK (("review_steps"."kind" = 'person') = ("review_steps"."membership_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "timesheet_review_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"step_no" smallint NOT NULL,
	"kind" "review_step_kind" NOT NULL,
	"approver_membership_id" uuid,
	"status" "review_row_status" DEFAULT 'waiting' NOT NULL,
	"skip_reason" text,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "timesheet_review_steps_skip_reason" CHECK (("timesheet_review_steps"."status" = 'skipped') = ("timesheet_review_steps"."skip_reason" is not null)),
	CONSTRAINT "timesheet_review_steps_acted" CHECK (("timesheet_review_steps"."status" = 'approved') = ("timesheet_review_steps"."acted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "review_steps" ADD CONSTRAINT "review_steps_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_steps" ADD CONSTRAINT "review_steps_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" ADD CONSTRAINT "timesheet_review_steps_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" ADD CONSTRAINT "timesheet_review_steps_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" ADD CONSTRAINT "timesheet_review_steps_sheet_same_firm_fk" FOREIGN KEY ("firm_id","timesheet_id") REFERENCES "public"."timesheets"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" ADD CONSTRAINT "timesheet_review_steps_approver_same_firm_fk" FOREIGN KEY ("firm_id","approver_membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_steps_firm_order_idx" ON "review_steps" USING btree ("firm_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "review_steps_kind_unique" ON "review_steps" USING btree ("firm_id","kind") WHERE "review_steps"."archived_at" is null and "review_steps"."kind" <> 'person';--> statement-breakpoint
CREATE UNIQUE INDEX "review_steps_person_unique" ON "review_steps" USING btree ("firm_id","membership_id") WHERE "review_steps"."archived_at" is null and "review_steps"."kind" = 'person';--> statement-breakpoint
CREATE INDEX "timesheet_review_steps_sheet_idx" ON "timesheet_review_steps" USING btree ("firm_id","timesheet_id","step_no");--> statement-breakpoint
CREATE INDEX "timesheet_review_steps_approver_idx" ON "timesheet_review_steps" USING btree ("firm_id","approver_membership_id") WHERE "timesheet_review_steps"."archived_at" is null and "timesheet_review_steps"."status" = 'waiting';--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Every firm starts with the default route: Principal in Charge (decision #23).
-- firms is not FORCEd, so the owner role can read every firm here.
INSERT INTO "review_steps" ("firm_id", "sort_order", "kind")
  SELECT "id", 0, 'principal_in_charge' FROM "firms";--> statement-breakpoint

-- Sheets already in review under 1.6 get an equivalent review, so they keep
-- waiting on the same people: the team leader (if any), then any principal.
-- timesheets is FORCEd (rules apply to the owner too), so lift that for the
-- copy and put it back straight after.
ALTER TABLE "timesheets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "timesheet_review_steps"
  ("firm_id", "timesheet_id", "step_no", "kind", "approver_membership_id", "status", "acted_by", "acted_at")
  SELECT "firm_id", "id", 1, 'team_leader', "reviewer_membership_id",
    CASE WHEN "leader_approved_at" IS NULL THEN 'waiting' ELSE 'approved' END::review_row_status,
    "leader_approved_by", "leader_approved_at"
  FROM "timesheets"
  WHERE "status" IN ('submitted', 'leader_approved') AND "reviewer_membership_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "timesheet_review_steps"
  ("firm_id", "timesheet_id", "step_no", "kind", "status")
  SELECT "firm_id", "id", CASE WHEN "reviewer_membership_id" IS NULL THEN 1 ELSE 2 END, 'any_principal', 'waiting'
  FROM "timesheets"
  WHERE "status" IN ('submitted', 'leader_approved');--> statement-breakpoint
UPDATE "timesheets" SET "status" = 'submitted' WHERE "status" = 'leader_approved';--> statement-breakpoint
ALTER TABLE "timesheets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Row-level security for the new tables (same rule as 0001).
ALTER TABLE "review_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "review_steps"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_review_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "timesheet_review_steps"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
--> statement-breakpoint

-- New firms get the default route too: same function as 0003, plus one
-- Principal in Charge step at the end.
CREATE OR REPLACE FUNCTION "public"."seed_firm_defaults"(p_firm_id uuid)
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

  INSERT INTO review_steps (firm_id, sort_order, kind)
  VALUES (p_firm_id, 0, 'principal_in_charge');
END
$$;
