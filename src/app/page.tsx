import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/data";

export default async function HomePage() {
  const user = await getSessionUser();

  if (user) {
    redirect("/today");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Team Management</CardTitle>
          <CardDescription>
            Coordinate projects through tasks, suggestions, and recurring duties.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Sign in with your Labelbox SSO account to access the single-tenant workspace.
          </p>
          <Button asChild>
            <a href="/login">Sign in with Labelbox SSO</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
