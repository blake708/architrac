CREATE TYPE "public"."timesheet_row_type" AS ENUM('project', 'overhead', 'leave');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'leader_approved', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"timesheet_row_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"project_id" uuid,
	"project_phase_id" uuid,
	"overhead_category_id" uuid,
	"activity_id" uuid,
	"hours" numeric(5, 2) NOT NULL,
	"note" text,
	"billable" boolean DEFAULT false NOT NULL,
	"bill_rate_cents" bigint,
	"cost_rate_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "time_entries_not_phase_and_category" CHECK ("time_entries"."project_phase_id" is null or "time_entries"."overhead_category_id" is null),
	CONSTRAINT "time_entries_project_xor_category" CHECK ("time_entries"."project_id" is null or "time_entries"."overhead_category_id" is null),
	CONSTRAINT "time_entries_hours_range" CHECK ("time_entries"."hours" > 0 and "time_entries"."hours" <= 24 and ("time_entries"."hours" * 4) = trunc("time_entries"."hours" * 4)),
	CONSTRAINT "time_entries_note_length" CHECK ("time_entries"."note" is null or char_length("time_entries"."note") <= 500),
	CONSTRAINT "time_entries_billable_project_only" CHECK (not "time_entries"."billable" or "time_entries"."project_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "timesheet_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"row_type" timesheet_row_type,
	"project_id" uuid,
	"project_phase_id" uuid,
	"overhead_category_id" uuid,
	"activity_id" uuid,
	"billable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "timesheet_rows_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "timesheet_rows_type_links" CHECK (case "timesheet_rows"."row_type"
        when 'project' then "timesheet_rows"."overhead_category_id" is null
        when 'overhead' then "timesheet_rows"."project_id" is null and "timesheet_rows"."project_phase_id" is null
        when 'leave' then "timesheet_rows"."project_id" is null and "timesheet_rows"."project_phase_id" is null
        else "timesheet_rows"."project_id" is null and "timesheet_rows"."project_phase_id" is null and "timesheet_rows"."overhead_category_id" is null and "timesheet_rows"."activity_id" is null
      end),
	CONSTRAINT "timesheet_rows_billable_project_only" CHECK (not "timesheet_rows"."billable" or "timesheet_rows"."row_type" = 'project')
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewer_membership_id" uuid,
	"leader_approved_at" timestamp with time zone,
	"leader_approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejection_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "timesheets_membership_week_unique" UNIQUE("membership_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "timesheet_due_time" time DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "billable_notes_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timesheet_same_firm_fk" FOREIGN KEY ("firm_id","timesheet_id") REFERENCES "public"."timesheets"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_row_same_firm_fk" FOREIGN KEY ("firm_id","timesheet_row_id") REFERENCES "public"."timesheet_rows"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_phase_same_firm_fk" FOREIGN KEY ("firm_id","project_phase_id") REFERENCES "public"."project_phases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_category_same_firm_fk" FOREIGN KEY ("firm_id","overhead_category_id") REFERENCES "public"."overhead_categories"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activity_same_firm_fk" FOREIGN KEY ("firm_id","activity_id") REFERENCES "public"."activities"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_timesheet_same_firm_fk" FOREIGN KEY ("firm_id","timesheet_id") REFERENCES "public"."timesheets"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_phase_same_firm_fk" FOREIGN KEY ("firm_id","project_phase_id") REFERENCES "public"."project_phases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_category_same_firm_fk" FOREIGN KEY ("firm_id","overhead_category_id") REFERENCES "public"."overhead_categories"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_rows" ADD CONSTRAINT "timesheet_rows_activity_same_firm_fk" FOREIGN KEY ("firm_id","activity_id") REFERENCES "public"."activities"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_leader_approved_by_users_id_fk" FOREIGN KEY ("leader_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_reviewer_same_firm_fk" FOREIGN KEY ("firm_id","reviewer_membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_row_day_unique" ON "time_entries" USING btree ("timesheet_row_id","work_date") WHERE "time_entries"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "time_entries_timesheet_idx" ON "time_entries" USING btree ("firm_id","timesheet_id");--> statement-breakpoint
CREATE INDEX "time_entries_phase_idx" ON "time_entries" USING btree ("firm_id","project_phase_id");--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("firm_id","project_id");--> statement-breakpoint
CREATE INDEX "timesheet_rows_timesheet_idx" ON "timesheet_rows" USING btree ("firm_id","timesheet_id","sort_order");--> statement-breakpoint
CREATE INDEX "timesheets_firm_week_idx" ON "timesheets" USING btree ("firm_id","week_start");--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security for the timesheet tables (same rule as 0001).
ALTER TABLE "timesheets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "timesheets"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "timesheet_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "timesheet_rows"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "time_entries"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
