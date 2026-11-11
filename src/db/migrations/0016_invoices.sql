CREATE TYPE "public"."invoice_line_type" AS ENUM('phase_fee', 'hourly', 'consultant', 'expense', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'in_review', 'sent', 'partially_paid', 'paid', 'void', 'written_off');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('check', 'ach', 'card', 'other');--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"project_phase_id" uuid,
	"line_type" "invoice_line_type" NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"rate_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"percent_complete_bp" integer,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"phase_fee_cents" bigint,
	"prior_billed_cents" bigint,
	"consultant_id" uuid,
	"cost_cents" bigint,
	"markup_bp" integer,
	"vendor_invoice_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "invoice_lines_percent_range" CHECK ("invoice_lines"."percent_complete_bp" is null or "invoice_lines"."percent_complete_bp" between 0 and 10000),
	CONSTRAINT "invoice_lines_markup_range" CHECK ("invoice_lines"."markup_bp" is null or "invoice_lines"."markup_bp" between 0 and 10000),
	CONSTRAINT "invoice_lines_cost_nonneg" CHECK ("invoice_lines"."cost_cents" is null or "invoice_lines"."cost_cents" >= 0),
	CONSTRAINT "invoice_lines_description" CHECK (char_length(trim("invoice_lines"."description")) between 1 and 500),
	CONSTRAINT "invoice_lines_phase_fee_has_phase" CHECK ("invoice_lines"."line_type" <> 'phase_fee' or "invoice_lines"."project_phase_id" is not null),
	CONSTRAINT "invoice_lines_consultant_has_consultant" CHECK ("invoice_lines"."line_type" <> 'consultant' or "invoice_lines"."consultant_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"client_company_id" uuid NOT NULL,
	"bill_to_contact_id" uuid,
	"number" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"period_start" date,
	"period_end" date NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"amount_paid_cents" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"sent_to" text[],
	"include_time_detail" boolean DEFAULT true NOT NULL,
	"quickbooks_invoice_id" text,
	"pdf_url" text,
	"sent_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "invoices_firm_id_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "invoices_number_when_sent" CHECK ("invoices"."status" in ('draft', 'in_review') or "invoices"."number" is not null),
	CONSTRAINT "invoices_void_reason" CHECK ("invoices"."status" <> 'void' or "invoices"."void_reason" is not null),
	CONSTRAINT "invoices_paid_range" CHECK ("invoices"."amount_paid_cents" >= 0 and "invoices"."amount_paid_cents" <= greatest("invoices"."total_cents", 0)),
	CONSTRAINT "invoices_tax_nonneg" CHECK ("invoices"."tax_cents" >= 0),
	CONSTRAINT "invoices_total_adds_up" CHECK ("invoices"."total_cents" = "invoices"."subtotal_cents" + "invoices"."tax_cents"),
	CONSTRAINT "invoices_due_after_issue" CHECK ("invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_period_in_order" CHECK ("invoices"."period_start" is null or "invoices"."period_end" >= "invoices"."period_start"),
	CONSTRAINT "invoices_memo_length" CHECK ("invoices"."memo" is null or char_length("invoices"."memo") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"quickbooks_payment_id" text,
	"stripe_payment_intent_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_reference_length" CHECK ("payments"."reference" is null or char_length("payments"."reference") <= 100)
);
--> statement-breakpoint
CREATE TABLE "invoice_excluded_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
-- Firm-scoped keys so invoice lines and excluded entries can point at them
-- (must exist before the foreign keys below).
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_firm_id_id_unique" UNIQUE("firm_id","id");--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "invoice_number_format" text DEFAULT '{YYYY}-{###}' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "project_number_format" text DEFAULT '{YYYY}-{###}' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "invoice_remittance_text" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_invoice_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_same_firm_fk" FOREIGN KEY ("firm_id","invoice_id") REFERENCES "public"."invoices"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_phase_same_firm_fk" FOREIGN KEY ("firm_id","project_phase_id") REFERENCES "public"."project_phases"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_consultant_same_firm_fk" FOREIGN KEY ("firm_id","consultant_id") REFERENCES "public"."consultants"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_same_firm_fk" FOREIGN KEY ("firm_id","client_company_id") REFERENCES "public"."companies"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bill_to_same_firm_fk" FOREIGN KEY ("firm_id","bill_to_contact_id") REFERENCES "public"."contacts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_same_firm_fk" FOREIGN KEY ("firm_id","invoice_id") REFERENCES "public"."invoices"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_excluded_entries" ADD CONSTRAINT "invoice_excluded_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_excluded_entries" ADD CONSTRAINT "invoice_excluded_entries_invoice_same_firm_fk" FOREIGN KEY ("firm_id","invoice_id") REFERENCES "public"."invoices"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_excluded_entries" ADD CONSTRAINT "invoice_excluded_entries_entry_same_firm_fk" FOREIGN KEY ("firm_id","time_entry_id") REFERENCES "public"."time_entries"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("firm_id","invoice_id","sort_order");--> statement-breakpoint
CREATE INDEX "invoice_lines_phase_idx" ON "invoice_lines" USING btree ("firm_id","project_phase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_firm_number_unique" ON "invoices" USING btree ("firm_id","number") WHERE "invoices"."number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_open_draft" ON "invoices" USING btree ("project_id") WHERE "invoices"."status" in ('draft', 'in_review') and "invoices"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("firm_id","project_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("firm_id","status","due_date");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("firm_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("firm_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_excluded_entries_unique" ON "invoice_excluded_entries" USING btree ("invoice_id","time_entry_id") WHERE "invoice_excluded_entries"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_same_firm_fk" FOREIGN KEY ("firm_id","invoice_id") REFERENCES "public"."invoices"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_invoice_idx" ON "time_entries" USING btree ("firm_id","invoice_id");--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_next_invoice_number_min" CHECK ("firm_settings"."next_invoice_number" >= 1);--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_payment_terms_range" CHECK ("firm_settings"."default_payment_terms_days" between 0 and 365);--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_remittance_length" CHECK ("firm_settings"."invoice_remittance_text" is null or char_length("firm_settings"."invoice_remittance_text") <= 500);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_next_invoice_seq_min" CHECK ("projects"."next_invoice_seq" >= 1);--> statement-breakpoint
-- Existing firms: turn the old fixed prefix into a number format
-- (decision #5). "2026-" style year prefixes become {YYYY}-{###}, so they
-- roll over each January; any other prefix is kept as typed.
UPDATE "firm_settings" SET "invoice_number_format" = CASE
  WHEN "invoice_prefix" = '' OR "invoice_prefix" ~ '^[0-9]{4}-$' THEN '{YYYY}-{###}'
  WHEN "invoice_prefix" ~ '^[A-Za-z0-9._ -]{1,30}$' THEN "invoice_prefix" || '{###}'
  ELSE '{YYYY}-{###}'
END;--> statement-breakpoint
-- Row security: a firm only sees its own invoices, lines, payments and
-- excluded entries.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "invoices"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "invoice_lines"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "payments"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invoice_excluded_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_excluded_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "invoice_excluded_entries"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
-- Time locking (invoicing rule 13): once an entry is reserved on a draft or
-- billed, its hours, date, project, phase, rate, billable flag and
-- archived_at can't change. Clearing invoice_id (void, delete draft,
-- untick) is allowed in the same statement only when nothing else changes.
CREATE FUNCTION "public"."time_entries_invoice_lock"()
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
    OR NEW.billable IS DISTINCT FROM OLD.billable
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'time_entry_locked: time entry % is on an invoice', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "time_entries_invoice_lock"
  BEFORE UPDATE ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION "public"."time_entries_invoice_lock"();--> statement-breakpoint
-- A timesheet with billed or reserved time can't leave "approved" (reopen,
-- return). Release the time from the invoice first.
CREATE FUNCTION "public"."timesheets_invoice_lock"()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM OLD.status AND EXISTS (
    SELECT 1 FROM public.time_entries e
    WHERE e.timesheet_id = OLD.id AND e.invoice_id IS NOT NULL AND e.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'time_entry_locked: timesheet % has time on an invoice', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "timesheets_invoice_lock"
  BEFORE UPDATE OF "status" ON "timesheets"
  FOR EACH ROW EXECUTE FUNCTION "public"."timesheets_invoice_lock"();
