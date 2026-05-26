"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowser } from "@/lib/supabase";

const REFRESH_DEBOUNCE_MS = 500;

export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const tableKey = useMemo(() => [...tables].sort().join(":"), [tables]);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    if (!supabase || tableKey.length === 0) {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase.channel(`realtime-refresh:${tableKey}`);

    for (const table of tableKey.split(":")) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        refresh,
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      void supabase.removeChannel(channel);
    };
  }, [router, tableKey]);

  return null;
}
