import { redirect } from "next/navigation";

export function GET() {
  const params = new URLSearchParams();

  if (process.env.AUTH0_CONNECTION) {
    params.set("connection", process.env.AUTH0_CONNECTION);
  }

  const query = params.toString();
  redirect(query ? `/auth/login?${query}` : "/auth/login");
}
