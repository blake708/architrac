ALTER TABLE "time_entries" ADD COLUMN "firm_role_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing approved time: the person's current role is the role they had
-- (decision #30; no invoices exist yet).
UPDATE "time_entries" e SET "firm_role_id" = m."firm_role_id"
FROM "timesheets" t
JOIN "memberships" m ON m."id" = t."membership_id"
WHERE e."timesheet_id" = t."id"
  AND t."status" = 'approved'
  AND e."bill_rate_cents" IS NOT NULL;--> statement-breakpoint
-- The invoice lock now covers the frozen role too.
CREATE OR REPLACE FUNCTION "public"."time_entries_invoice_lock"()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL AND (
    NEW.hours IS DISTINCT FROM OLD.hours
    OR NEW.work_date IS DISTINCT FROM OLD.work_date
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.project_phase_id IS DISTINCT FROM OLD.project_phase_id
    OR NEW.bill_rate_cents IS DISTINCT FROM OLD.bill_rate_cents
    OR NEW.firm_role_id IS DISTINCT FROM OLD.firm_role_id
    OR NEW.billable IS DISTINCT FROM OLD.billable
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'time_entry_locked: time entry % is on an invoice', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
