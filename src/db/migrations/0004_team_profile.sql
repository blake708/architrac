ALTER TABLE "memberships" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "license_note" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "is_principal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "weekly_capacity_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "target_utilization_bp" integer;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_team_same_firm_fk" FOREIGN KEY ("firm_id","team_id") REFERENCES "public"."teams"("firm_id","id") ON DELETE no action ON UPDATE no action;