CREATE TABLE "project_type_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"project_type" text NOT NULL,
	"scope_kind" "scope_kind",
	"cost_per_sf_low_cents" bigint NOT NULL,
	"cost_per_sf_high_cents" bigint NOT NULL,
	"fee_low_bp" integer NOT NULL,
	"fee_high_bp" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_type_benchmarks_cost_range" CHECK ("project_type_benchmarks"."cost_per_sf_low_cents" > 0 and "project_type_benchmarks"."cost_per_sf_high_cents" >= "project_type_benchmarks"."cost_per_sf_low_cents"),
	CONSTRAINT "project_type_benchmarks_fee_range" CHECK ("project_type_benchmarks"."fee_low_bp" > 0 and "project_type_benchmarks"."fee_high_bp" >= "project_type_benchmarks"."fee_low_bp" and "project_type_benchmarks"."fee_high_bp" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "project_type_benchmarks" ADD CONSTRAINT "project_type_benchmarks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_type_benchmarks" ADD CONSTRAINT "project_type_benchmarks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_type_benchmarks_any_scope_unique" ON "project_type_benchmarks" USING btree ("firm_id",lower("project_type")) WHERE "project_type_benchmarks"."archived_at" is null and "project_type_benchmarks"."scope_kind" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_type_benchmarks_scope_unique" ON "project_type_benchmarks" USING btree ("firm_id",lower("project_type"),"scope_kind") WHERE "project_type_benchmarks"."archived_at" is null and "project_type_benchmarks"."scope_kind" is not null;--> statement-breakpoint
-- Hand-written below this line (drizzle-kit doesn't generate these).

-- Row-level security (same rule as 0001).
ALTER TABLE "project_type_benchmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_type_benchmarks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "project_type_benchmarks"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
