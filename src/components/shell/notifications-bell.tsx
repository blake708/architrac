"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { relativeTime, unreadBadge } from "@/lib/time/notices";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/notifications/actions";
import type { NotificationItem } from "@/server/notifications/inbox";
import { iconProps } from "./icons";

// The bell in the header (timesheet-approval spec, Notifications, decision
// #25). Unread count refreshes on every navigation and every 60 s while the
// tab is visible. No websockets in Release 1.

const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";
const KIND_ICON: Record<string, string> = {
  review_waiting: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  timesheet_approved: "M5 12l5 5L20 7",
  timesheet_returned: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1",
  timesheet_reminder: "M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
  approver_nudge: BELL,
  review_summary: "M4 6h16M4 12h16M4 18h10",
  invoice_review: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  invoice_returned: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1",
};

export function NotificationsBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const refreshCount = useCallback(() => {
    getUnreadCount()
      .then(setCount)
      .catch(() => {});
  }, []);

  // On navigation, and every 60 s while the tab is visible.
  useEffect(() => {
    refreshCount();
  }, [pathname, refreshCount]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshCount();
    }, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  async function load(before?: string) {
    const r = await getNotifications(before ? { before } : {});
    setItems((old) => (before && old ? [...old, ...r.items] : r.items));
    setHasMore(r.hasMore);
  }

  async function openItem(n: NotificationItem) {
    if (!n.read) {
      await markNotificationRead({ id: n.id });
      setCount((c) => Math.max(0, c - 1));
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    await markAllNotificationsRead();
    setCount(0);
    setItems((xs) => xs?.map((x) => ({ ...x, read: true })) ?? null);
  }

  const badge = unreadBadge(count);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
          title="Notifications"
          className="relative inline-flex size-[34px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-chrome-muted hover:text-white focus-visible:outline-2 focus-visible:outline-white"
        >
          <svg {...iconProps(18, 2)}>
            <path d={BELL} />
          </svg>
          {badge && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange px-1 text-[10px] leading-none font-semibold text-white"
            >
              {badge}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent label="Notifications" align="end" className="flex max-h-[480px] w-[360px] flex-col p-0">
        <div className="flex items-center border-b border-line-soft px-4 py-3">
          <h2 className="m-0 text-sm font-semibold">Notifications</h2>
          <button
            type="button"
            onClick={markAll}
            disabled={!count}
            className="ml-auto cursor-pointer rounded-sm border-0 bg-transparent px-2 py-1 text-sm text-ink-2 hover:bg-line-soft disabled:cursor-default disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>
        <div className="overflow-y-auto">
          {items === null ? (
            <p className="m-0 px-4 py-6 text-center text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="m-0 px-4 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((n) => (
                <li key={n.id} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full cursor-pointer gap-3 border-0 px-4 py-3 text-left hover:bg-surface-2",
                      n.read ? "bg-surface" : "bg-blue-tint/40",
                    )}
                  >
                    <svg {...iconProps(16, 2)} className="mt-0.5 shrink-0 text-ink-3">
                      <path d={KIND_ICON[n.kind] ?? BELL} />
                    </svg>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="line-clamp-2 text-xs text-ink-2">{n.body}</span>}
                      <span className="text-2xs text-muted">{relativeTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && items && (
            <div className="border-t border-line-soft p-2 text-center">
              <button
                type="button"
                onClick={() => load(items[items.length - 1].createdAt)}
                className="cursor-pointer rounded-sm border-0 bg-transparent px-3 py-1.5 text-sm text-ink-2 hover:bg-line-soft"
              >
                Load older
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
