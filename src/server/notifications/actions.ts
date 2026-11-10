"use server";

import { requireSession } from "@/lib/auth/session";
import { type Me, listNotificationsCore, markAllReadCore, markReadCore, unreadCountCore } from "./inbox";

// The bell's server actions. The recipient always comes from the session.

const me = async (): Promise<Me> => {
  const { firm, membership } = await requireSession();
  return { firmId: firm.id, membershipId: membership.id, active: membership.active };
};

export async function getUnreadCount() {
  return unreadCountCore(await me());
}
export async function getNotifications(input: unknown) {
  return listNotificationsCore(await me(), input);
}
export async function markNotificationRead(input: unknown) {
  return markReadCore(await me(), input);
}
export async function markAllNotificationsRead() {
  return markAllReadCore(await me());
}
