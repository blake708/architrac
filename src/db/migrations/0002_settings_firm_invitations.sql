CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"app_role" "app_role" NOT NULL,
	"title" text,
	"firm_role_id" uuid,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"clerk_invitation_id" text,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_clerk_invitation_id_unique" UNIQUE("clerk_invitation_id")
);
--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "license_number" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" USING btree ("firm_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_firm_status_idx" ON "invitations" USING btree ("firm_id","status");--> statement-breakpoint

-- Hand-written below this line (drizzle-kit doesn't generate these).

-- invitations is firm-owned: same row-level security as the other firm tables
-- (see 0001_rls_policies.sql). FORCE applies the rule to the table owner too.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "invitations"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint

-- Schedule is part of Projects, not a module (decided in 0.6). Remove it from
-- every firm's list. firm_settings has FORCEd row-level security, so select
-- each firm in turn; the firms table itself is readable by the owner.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT id FROM public.firms LOOP
    PERFORM set_config('app.firm_id', f.id::text, true);
    UPDATE public.firm_settings
      SET modules_enabled = array_remove(modules_enabled, 'schedule')
      WHERE firm_id = f.id AND 'schedule' = ANY(modules_enabled);
  END LOOP;
  PERFORM set_config('app.firm_id', '', true);
END
$$;
