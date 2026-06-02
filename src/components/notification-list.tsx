"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { markAllNotificationsRead, markNotificationRead } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

export function NotificationList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  function openNotification(notification: Notification) {
    const href = notification.href ?? "/today";

    startTransition(async () => {
      if (!notification.read_at) {
        try {
          await markNotificationRead(notification.id);
        } catch {
          // Navigation should still proceed even if marking read fails.
        }
      }

      router.push(href);
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
      } catch {
        // Ignore; the badge will stay until the next successful refresh.
      }

      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-lg border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link
          href="/notifications"
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground/80"
        >
          <Bell className="h-4 w-4" />
          Notifications
          {unreadCount > 0 ? <Badge>{unreadCount}</Badge> : null}
        </Link>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAll}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Mark all read
          </button>
        ) : null}
      </div>
      <div className="space-y-2">
        {notifications.slice(0, 3).map((notification) => (
          <button
            type="button"
            key={notification.id}
            onClick={() => openNotification(notification)}
            disabled={isPending}
            className={cn(
              "block w-full rounded-md p-2 text-left text-xs hover:bg-accent disabled:opacity-60",
              !notification.read_at && "bg-accent/40",
            )}
          >
            <span className="font-medium">{notification.title}</span>
            {notification.body ? (
              <span className="mt-1 block text-muted-foreground">{notification.body}</span>
            ) : null}
          </button>
        ))}
        {notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notifications yet.</p>
        ) : null}
      </div>
      {notifications.length > 0 ? (
        <Link
          href="/notifications"
          className="mt-2 block text-center text-xs text-muted-foreground hover:text-foreground"
        >
          View all
        </Link>
      ) : null}
    </div>
  );
}
