CREATE TABLE "phase_template_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"phase_template_id" uuid NOT NULL,
	"firm_role_id" uuid NOT NULL,
	"share_bp" integer NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "phase_template_roles_share_range" CHECK ("phase_template_roles"."share_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "project_phase_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_phase_id" uuid NOT NULL,
	"firm_role_id" uuid NOT NULL,
	"share_bp" integer NOT NULL,
	"rate_cents" bigint DEFAULT 0 NOT NULL,
	"hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_phase_roles_share_range" CHECK ("project_phase_roles"."share_bp" between 0 and 10000),
	CONSTRAINT "project_phase_roles_rate_nonneg" CHECK ("project_phase_roles"."rate_cents" >= 0),
	CONSTRAINT "project_phase_roles_hours_nonneg" CHECK ("project_phase_roles"."hours" >= 0)
);
--> statement-breakpoint
ALTER TABLE "project_phases" ADD COLUMN "budget_hours_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_phases" ADD COLUMN "is_additional_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phase_template_roles" ADD CONSTRAINT "phase_template_roles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_template_roles" ADD CONSTRAINT "phase_template_roles_template_same_firm_fk" FOREIGN KEY ("firm_id","phase_template_id") REFERENCES "public"."phase_templates"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_template_roles" ADD CONSTRAINT "phase_template_roles_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phase_roles" ADD CONSTRAINT "project_phase_roles_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phase_roles" ADD CONSTRAINT "project_phase_roles_phase_same_firm_fk" FOREIGN KEY ("firm_id","project_phase_id") REFERENCES "public"."project_phases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phase_roles" ADD CONSTRAINT "project_phase_roles_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phase_template_roles_one_active" ON "phase_template_roles" USING btree ("phase_template_id","firm_role_id") WHERE "phase_template_roles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "phase_template_roles_template_idx" ON "phase_template_roles" USING btree ("firm_id","phase_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_phase_roles_one_active" ON "project_phase_roles" USING btree ("project_phase_id","firm_role_id") WHERE "project_phase_roles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "project_phase_roles_phase_idx" ON "project_phase_roles" USING btree ("firm_id","project_phase_id");--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security for role mixes (same rule as 0001).
ALTER TABLE "phase_template_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phase_template_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "phase_template_roles"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "project_phase_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_phase_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "project_phase_roles"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
