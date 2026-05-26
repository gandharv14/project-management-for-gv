"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowser } from "@/lib/supabase";

export function RealtimeRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    if (!supabase || tables.length === 0) {
      return;
    }

    const channel = supabase.channel(`realtime-refresh:${tables.join(":")}`);

    for (const table of tables) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
        },
        () => router.refresh(),
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, tables]);

  return null;
}
