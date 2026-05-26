import type React from "react";

import { AppShell } from "@/components/app-shell";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { getAppContext } from "@/lib/data";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { profile, projects, notifications } = await getAppContext();

  return (
    <AppShell profile={profile} projects={projects} notifications={notifications}>
      <RealtimeRefresh tables={["notifications"]} />
      {children}
    </AppShell>
  );
}
