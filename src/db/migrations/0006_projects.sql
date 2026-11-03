CREATE TYPE "public"."phase_status" AS ENUM('upcoming', 'current', 'complete', 'closed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('pursuit', 'active', 'on_hold', 'closed');--> statement-breakpoint
CREATE TYPE "public"."scope_kind" AS ENUM('ground_up', 'tenant_upfit', 'shell');--> statement-breakpoint
CREATE TABLE "project_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_role" text NOT NULL,
	"bill_rate_override_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" smallint NOT NULL,
	"fee_type" "fee_type" NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"budget_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"status" "phase_status" DEFAULT 'upcoming' NOT NULL,
	"start_date" date,
	"end_date" date,
	"percent_complete_bp" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_phases_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "project_phases_fee_nonneg" CHECK ("project_phases"."fee_cents" >= 0),
	CONSTRAINT "project_phases_hours_nonneg" CHECK ("project_phases"."budget_hours" >= 0),
	CONSTRAINT "project_phases_pct_range" CHECK ("project_phases"."percent_complete_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"client_company_id" uuid NOT NULL,
	"client_contact_id" uuid,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"project_type" text NOT NULL,
	"scope_kind" "scope_kind",
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"square_feet" integer,
	"construction_cost_cents" bigint,
	"principal_membership_id" uuid NOT NULL,
	"pm_membership_id" uuid NOT NULL,
	"start_date" date,
	"target_end_date" date,
	"closed_on" date,
	"quickbooks_customer_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "projects_square_feet_positive" CHECK ("projects"."square_feet" is null or "projects"."square_feet" > 0),
	CONSTRAINT "projects_construction_cost_nonneg" CHECK ("projects"."construction_cost_cents" is null or "projects"."construction_cost_cents" >= 0),
	CONSTRAINT "projects_dates_in_order" CHECK ("projects"."start_date" is null or "projects"."target_end_date" is null or "projects"."target_end_date" >= "projects"."start_date")
);
--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_company_same_firm_fk" FOREIGN KEY ("firm_id","company_id") REFERENCES "public"."companies"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_contact_same_firm_fk" FOREIGN KEY ("firm_id","contact_id") REFERENCES "public"."contacts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_same_firm_fk" FOREIGN KEY ("firm_id","client_company_id") REFERENCES "public"."companies"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_contact_same_firm_fk" FOREIGN KEY ("firm_id","client_contact_id") REFERENCES "public"."contacts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_principal_same_firm_fk" FOREIGN KEY ("firm_id","principal_membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pm_same_firm_fk" FOREIGN KEY ("firm_id","pm_membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_contacts_company_idx" ON "project_contacts" USING btree ("firm_id","company_id");--> statement-breakpoint
CREATE INDEX "project_contacts_project_idx" ON "project_contacts" USING btree ("firm_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_one_active" ON "project_members" USING btree ("project_id","membership_id") WHERE "project_members"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "project_members_membership_idx" ON "project_members" USING btree ("firm_id","membership_id");--> statement-breakpoint
CREATE INDEX "project_phases_project_idx" ON "project_phases" USING btree ("firm_id","project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_firm_number_unique" ON "projects" USING btree ("firm_id",lower("number"));--> statement-breakpoint
CREATE INDEX "projects_firm_client_idx" ON "projects" USING btree ("firm_id","client_company_id");--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security for projects (same rule as 0001).
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "projects"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "project_phases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_phases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "project_phases"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "project_members"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "project_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "project_contacts"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
