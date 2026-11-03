CREATE TABLE "consultants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"discipline" text NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"markup_bp" integer DEFAULT 0 NOT NULL,
	"billed_through" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "consultants_fee_nonneg" CHECK ("consultants"."fee_cents" >= 0),
	CONSTRAINT "consultants_markup_range" CHECK ("consultants"."markup_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "default_consultant_markup_bp" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_project_same_firm_fk" FOREIGN KEY ("firm_id","project_id") REFERENCES "public"."projects"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_company_same_firm_fk" FOREIGN KEY ("firm_id","company_id") REFERENCES "public"."companies"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultants" ADD CONSTRAINT "consultants_contact_same_firm_fk" FOREIGN KEY ("firm_id","contact_id") REFERENCES "public"."contacts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultants_project_idx" ON "consultants" USING btree ("firm_id","project_id");--> statement-breakpoint
CREATE INDEX "consultants_company_idx" ON "consultants" USING btree ("firm_id","company_id");--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_consultant_markup_range" CHECK ("firm_settings"."default_consultant_markup_bp" between 0 and 10000);--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security for consultants (same rule as 0001).
ALTER TABLE "consultants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consultants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "consultants"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
