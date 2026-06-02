import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NotificationsView } from "@/components/notifications-view";
import { getAppContext, listNotifications } from "@/lib/data";

export default async function NotificationsPage() {
  const { profile } = await getAppContext();
  const notifications = await listNotifications(profile.id, { limit: 50 });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <RealtimeRefresh tables={["notifications"]} />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">
          All of your team activity in one place. Opening this page marks everything as read.
        </p>
      </div>

      <NotificationsView notifications={notifications} />
    </div>
  );
}
