import type { FirmSession } from "@/lib/auth/session";
import type { TimeActor } from "./write";

/** Who is asking and the firm's timesheet rules, from the session. */
export function timeActorFrom({ firm, settings, user, membership }: FirmSession): TimeActor {
  return {
    firmId: firm.id,
    userId: user.id,
    membershipId: membership.id,
    timezone: firm.timezone,
    weekStartsOn: settings.weekStartsOn,
    lockDay: settings.timesheetLockDay,
    dueTime: settings.timesheetDueTime,
    billableNotesRequired: settings.billableNotesRequired,
    member: { appRole: membership.appRole, active: membership.active },
  };
}
