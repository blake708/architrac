import { notifications, type NotificationKind } from "@/db/schema";
import type { TenantDb } from "@/db/tenant";

// The one way the app sends a notification (timesheet-approval spec rule 13,
// decision #25). Writes one row per recipient inside the caller's
// transaction, so a rolled-back action sends nothing. Email is added here
// later, and only here.

export type NotifyInput = {
  firmId: string;
  /** Membership ids. Duplicates and empty ids are dropped. */
  recipients: readonly (string | null | undefined)[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  entity?: { type: string; id: string };
};

export async function notify(db: TenantDb, input: NotifyInput): Promise<number> {
  const to = [...new Set(input.recipients.filter((r): r is string => !!r))];
  if (!to.length) return 0;
  await db.insert(notifications).values(
    to.map((membershipId) => ({
      firmId: input.firmId,
      membershipId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
    })),
  );
  return to.length;
}
