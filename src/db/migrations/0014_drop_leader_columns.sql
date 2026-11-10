ALTER TABLE "timesheets" DROP CONSTRAINT "timesheets_leader_approved_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "timesheets" DROP CONSTRAINT "timesheets_reviewer_same_firm_fk";
--> statement-breakpoint
ALTER TABLE "timesheets" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "timesheets" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."timesheet_status";--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "timesheets" ALTER COLUMN "status" SET DEFAULT 'draft'::timesheet_status;--> statement-breakpoint
ALTER TABLE "timesheets" ALTER COLUMN "status" SET DATA TYPE timesheet_status USING "status"::timesheet_status;--> statement-breakpoint
ALTER TABLE "timesheets" DROP COLUMN "reviewer_membership_id";--> statement-breakpoint
ALTER TABLE "timesheets" DROP COLUMN "leader_approved_at";--> statement-breakpoint
ALTER TABLE "timesheets" DROP COLUMN "leader_approved_by";