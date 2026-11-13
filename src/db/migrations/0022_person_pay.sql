CREATE TYPE "public"."pay_type" AS ENUM('salary', 'hourly');--> statement-breakpoint
CREATE TABLE "membership_pay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"pay_type" "pay_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"burden_bp" integer DEFAULT 0 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_pay_amount_min" CHECK ("membership_pay"."amount_cents" >= 0),
	CONSTRAINT "membership_pay_burden_range" CHECK ("membership_pay"."burden_bp" between 0 and 20000),
	CONSTRAINT "membership_pay_dates_order" CHECK ("membership_pay"."effective_to" is null or "membership_pay"."effective_to" >= "membership_pay"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN "firm_role_id" uuid;--> statement-breakpoint
ALTER TABLE "membership_pay" ADD CONSTRAINT "membership_pay_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_pay" ADD CONSTRAINT "membership_pay_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_pay" ADD CONSTRAINT "membership_pay_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "membership_pay_membership_idx" ON "membership_pay" USING btree ("firm_id","membership_id");--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_role_same_firm_fk" FOREIGN KEY ("firm_id","firm_role_id") REFERENCES "public"."firm_roles"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Row security: a firm only sees its own people's pay. The server also
-- returns it to owners and admins only (CLAUDE.md rule 4).
ALTER TABLE "membership_pay" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_pay" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "membership_pay"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
-- A person's pay periods never overlap (same rule as rates).
ALTER TABLE "membership_pay" ADD CONSTRAINT "membership_pay_no_overlap"
  EXCLUDE USING gist (firm_id WITH =, membership_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&);--> statement-breakpoint
-- Project team roles were free text. Match them to the firm's roles by name
-- ("PM" and "PA" are short for Project manager / Project architect), else
-- use the person's own role.
UPDATE "project_members" pm SET "firm_role_id" = coalesce(
  (SELECT r."id" FROM "firm_roles" r
    WHERE r."firm_id" = pm."firm_id" AND r."archived_at" IS NULL
      AND lower(r."name") = lower(CASE pm."project_role"
        WHEN 'PM' THEN 'Project manager'
        WHEN 'PA' THEN 'Project architect'
        ELSE pm."project_role" END)),
  (SELECT m."firm_role_id" FROM "memberships" m WHERE m."id" = pm."membership_id"));
