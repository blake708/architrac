import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { weekStartOf } from "@/lib/calc/timesheet";
import { todayIn } from "@/lib/format";

// /app/time → this week, in the firm's time zone (timesheet spec, Route).
export default async function TimePage() {
  const { firm, settings } = await requireSession();
  redirect(`/app/time/week/${weekStartOf(todayIn(firm.timezone), settings.weekStartsOn)}`);
}
