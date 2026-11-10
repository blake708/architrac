import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { notifications } from "@/db/schema";
import { withFirm } from "@/db/tenant";

// The bell (timesheet-approval spec, Layout "Notifications"). Every query is
// limited to the signed-in person's own notifications, on top of the firm's
// row security.

export type Me = { firmId: string; membershipId: string; active: boolean };

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
};

export const PAGE_SIZE = 20;

const mine = (me: Me) => and(eq(notifications.membershipId, me.membershipId), isNull(notifications.archivedAt));

export async function unreadCountCore(me: Me): Promise<number> {
  if (!me.active) return 0;
  return withFirm(me.firmId, async (db) => {
    const [r] = await db.select({ n: count() }).from(notifications).where(and(mine(me), isNull(notifications.readAt)));
    return r?.n ?? 0;
  });
}

const listInput = z.object({ before: z.iso.datetime().optional() });

/** Newest first, 20 at a time; `before` loads older ones. */
export async function listNotificationsCore(me: Me, raw: unknown): Promise<{ items: NotificationItem[]; hasMore: boolean }> {
  if (!me.active) return { items: [], hasMore: false };
  const parsed = listInput.safeParse(raw ?? {});
  const before = parsed.success && parsed.data.before ? new Date(parsed.data.before) : null;
  return withFirm(me.firmId, async (db) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(before ? and(mine(me), lt(notifications.createdAt, before)) : mine(me))
      .orderBy(desc(notifications.createdAt))
      .limit(PAGE_SIZE + 1);
    return {
      hasMore: rows.length > PAGE_SIZE,
      items: rows.slice(0, PAGE_SIZE).map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        createdAt: r.createdAt.toISOString(),
        read: !!r.readAt,
      })),
    };
  });
}

const readInput = z.object({ id: z.uuid() });

/** Opening one marks it read. Someone else's id changes nothing. */
export async function markReadCore(me: Me, raw: unknown, now: Date = new Date()): Promise<{ ok: boolean }> {
  const parsed = readInput.safeParse(raw);
  if (!me.active || !parsed.success) return { ok: false };
  const done = await withFirm(me.firmId, (db) =>
    db
      .update(notifications)
      .set({ readAt: now, updatedAt: now })
      .where(and(eq(notifications.id, parsed.data.id), mine(me), isNull(notifications.readAt)))
      .returning({ id: notifications.id }),
  );
  return { ok: done.length > 0 };
}

export async function markAllReadCore(me: Me, now: Date = new Date()): Promise<{ ok: boolean; count: number }> {
  if (!me.active) return { ok: false, count: 0 };
  const done = await withFirm(me.firmId, (db) =>
    db
      .update(notifications)
      .set({ readAt: now, updatedAt: now })
      .where(and(mine(me), isNull(notifications.readAt)))
      .returning({ id: notifications.id }),
  );
  return { ok: true, count: done.length };
}
