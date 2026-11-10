import { NextResponse } from "next/server";
import { cronAuthorized } from "@/server/time/cron-auth";
import { runTimesheetReminders } from "@/server/time/reminders";

// Daily for now (vercel.json; Hobby plan limit), hourly on Pro: automatic timesheet reminders and reviewer summaries
// (timesheet-approval spec, rule 10). Not behind sign-in; it proves itself
// with CRON_SECRET instead.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runTimesheetReminders());
}
