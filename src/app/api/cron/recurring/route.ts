import { generateRecurringInstances } from "@/app/actions";

export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  const actualHeader = request.headers.get("authorization");

  if (!expectedSecret || actualHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const generated = await generateRecurringInstances();
  return Response.json({ generated });
}
