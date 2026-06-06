import { NextRequest, NextResponse } from "next/server";

import { clearE2ERole, isE2ERole, setE2ERole } from "@/lib/e2e-session";

function assertE2EAuthEnabled() {
  if (process.env.E2E_AUTH_BYPASS !== "1") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return null;
}

export function GET(request: NextRequest) {
  const disabledResponse = assertE2EAuthEnabled();

  if (disabledResponse) {
    return disabledResponse;
  }

  if (request.nextUrl.searchParams.get("logout") === "1") {
    const redirectTo = request.nextUrl.searchParams.get("redirectTo") ?? "/";
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    clearE2ERole();
    response.cookies.delete("e2e-user");
    response.cookies.delete("e2e-email");
    response.cookies.delete("e2e-name");
    response.cookies.delete("e2e-sub");
    return response;
  }

  const role = request.nextUrl.searchParams.get("role");

  if (!isE2ERole(role)) {
    return Response.json({ error: "Expected role to be manager or member" }, { status: 400 });
  }

  const redirectTo = request.nextUrl.searchParams.get("redirectTo") ?? "/today";
  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  setE2ERole(role);

  response.cookies.set("e2e-user", role, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
  });

  for (const [cookieName, paramName] of [
    ["e2e-email", "email"],
    ["e2e-name", "name"],
    ["e2e-sub", "sub"],
  ] as const) {
    const value = request.nextUrl.searchParams.get(paramName)?.trim();

    if (value) {
      response.cookies.set(cookieName, value, {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        path: "/",
      });
    } else {
      response.cookies.delete(cookieName);
    }
  }

  return response;
}

export function DELETE() {
  const disabledResponse = assertE2EAuthEnabled();

  if (disabledResponse) {
    return disabledResponse;
  }

  const response = NextResponse.json({ ok: true });
  clearE2ERole();
  response.cookies.delete("e2e-user");
  response.cookies.delete("e2e-email");
  response.cookies.delete("e2e-name");
  response.cookies.delete("e2e-sub");
  return response;
}
