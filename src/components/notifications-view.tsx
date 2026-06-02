"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";

import { markAllNotificationsRead, markNotificationRead } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Notification, NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<NotificationType, string> = {
  assignment_created: "Assignment",
  blocker_status_changed: "Blocker",
  recurring_task_created: "Recurring duty",
  recurring_task_missed: "Missed duty",
  suggestion_traction: "Suggestion",
  suggestion_promoted: "Suggestion",
  flag_removal_requested: "Flag",
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function NotificationsView({ notifications }: { notifications: Notification[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const hasMarkedRef = useRef(false);
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  // Opening the page marks every notification as read. Guard against the
  // double-invoke of effects in development/StrictMode.
  useEffect(() => {
    if (hasMarkedRef.current || unreadCount === 0) {
      return;
    }

    hasMarkedRef.current = true;
    void (async () => {
      try {
        await markAllNotificationsRead();
      } catch {
        // The list still renders; the sidebar badge clears on the next refresh.
      }
      router.refresh();
    })();
  }, [router, unreadCount]);

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

  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Bell className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">You&apos;re all caught up</p>
          <p className="text-sm text-muted-foreground">New activity will show up here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {unreadCount > 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4" />
          Marking {unreadCount} unread {unreadCount === 1 ? "notification" : "notifications"} as read…
        </div>
      ) : null}

      {notifications.map((notification) => (
        <button
          type="button"
          key={notification.id}
          onClick={() => openNotification(notification)}
          disabled={isPending}
          className={cn(
            "w-full rounded-lg border bg-card text-left transition hover:bg-accent disabled:opacity-60",
            !notification.read_at && "border-primary/40 bg-accent/40",
          )}
        >
          <div className="flex items-start gap-3 p-4">
            {!notification.read_at ? (
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            ) : (
              <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{notification.title}</span>
                <Badge variant="outline">{TYPE_LABELS[notification.type] ?? "Update"}</Badge>
                {!notification.read_at ? <Badge>New</Badge> : null}
              </div>
              {notification.body ? (
                <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">{formatTimestamp(notification.created_at)}</p>
            </div>
          </div>
        </button>
      ))}

      <div className="pt-2">
        <Button asChild variant="outline" size="sm">
          <a href="/today">Back to Today</a>
        </Button>
      </div>
    </div>
  );
}
