"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 15000;

/**
 * Periodically refreshes server components so collaborative changes show up
 * without a manual reload. This used to subscribe to Supabase Realtime with the
 * public anon key, but that key is no longer shipped to the browser now that
 * Row Level Security denies anon access. The `tables` prop is retained for
 * call-site compatibility; any change to the subscribed data is picked up on
 * the next poll.
 */
export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  // Retained only so a changed set of watched tables restarts the poll loop;
  // the actual refresh re-fetches all server data for the route regardless.
  const pollKey = useMemo(() => [...tables].sort().join(":"), [tables]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        if (!document.hidden) {
          router.refresh();
        }
      }, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Refresh immediately when returning to the tab, then resume polling.
        router.refresh();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router, pollKey]);

  return null;
}
