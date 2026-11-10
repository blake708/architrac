CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"entity_type" text,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_membership_same_firm_fk" FOREIGN KEY ("firm_id","membership_id") REFERENCES "public"."memberships"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("firm_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("firm_id","membership_id") WHERE "notifications"."read_at" is null and "notifications"."archived_at" is null;--> statement-breakpoint
-- Row security: a firm only sees its own notifications. The server also
-- filters to the signed-in person's own rows.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "notifications"
  USING (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  WITH CHECK (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);--> statement-breakpoint
-- The hourly reminder job (/api/cron/timesheet-reminders) works firm by firm.
-- It needs the list of active firm ids before any firm is selected; this
-- returns only the ids, nothing else.
CREATE FUNCTION "public"."active_firm_ids"()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.firms WHERE archived_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."active_firm_ids"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."active_firm_ids"() TO architrac_app;
