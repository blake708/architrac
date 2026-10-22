-- citext = case-insensitive text, used for users.email. Must exist before the users table.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('owner', 'admin', 'project_manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract');--> statement-breakpoint
CREATE TABLE "firm_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"overhead_rate_bp" integer DEFAULT 6000 NOT NULL,
	"include_overhead_default" boolean DEFAULT true NOT NULL,
	"week_starts_on" smallint DEFAULT 1 NOT NULL,
	"timesheet_increment_minutes" smallint DEFAULT 15 NOT NULL,
	"timesheet_lock_day" smallint DEFAULT 1 NOT NULL,
	"invoice_prefix" text DEFAULT '' NOT NULL,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"default_payment_terms_days" smallint DEFAULT 30 NOT NULL,
	"modules_enabled" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_settings_week_starts_on_range" CHECK ("firm_settings"."week_starts_on" between 0 and 6),
	CONSTRAINT "firm_settings_timesheet_lock_day_range" CHECK ("firm_settings"."timesheet_lock_day" between 0 and 6),
	CONSTRAINT "firm_settings_overhead_rate_bp_min" CHECK ("firm_settings"."overhead_rate_bp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"clerk_org_id" text NOT NULL,
	"logo_url" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "firms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "firms_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "firms_fiscal_year_start_month_range" CHECK ("firms"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"app_role" "app_role" DEFAULT 'staff' NOT NULL,
	"title" text,
	"firm_role_id" uuid,
	"team_id" uuid,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"weekly_capacity_hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"target_utilization_bp" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "memberships_firm_user_unique" UNIQUE("firm_id","user_id"),
	CONSTRAINT "memberships_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "memberships_target_utilization_bp_range" CHECK ("memberships"."target_utilization_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"leader_membership_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "teams_firm_id_id_unique" UNIQUE("firm_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"initials" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_same_firm_fk" FOREIGN KEY ("firm_id","team_id") REFERENCES "public"."teams"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_same_firm_fk" FOREIGN KEY ("firm_id","leader_membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("firm_id","entity_type","entity_id");