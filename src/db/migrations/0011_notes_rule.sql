CREATE TYPE "public"."timesheet_notes_rule" AS ENUM('optional', 'hourly', 'all');--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "timesheet_notes_rule" timesheet_notes_rule DEFAULT 'optional' NOT NULL;--> statement-breakpoint
-- Firms that required billable notes keep that rule (decision #24).
UPDATE "firm_settings" SET "timesheet_notes_rule" = 'all' WHERE "billable_notes_required" = true;
