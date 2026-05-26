import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type E2ERole = "manager" | "member";
const E2E_ROLE_FILE = join(process.cwd(), "output", "playwright", ".e2e-role");

declare global {
  var __projectManagementE2ERole: E2ERole | undefined;
}

export function isE2EAuthBypassEnabled() {
  return process.env.E2E_AUTH_BYPASS === "1";
}

export function isE2ERole(value: unknown): value is E2ERole {
  return value === "manager" || value === "member";
}

export function getE2ERole() {
  if (!isE2EAuthBypassEnabled()) {
    return null;
  }

  if (globalThis.__projectManagementE2ERole) {
    return globalThis.__projectManagementE2ERole;
  }

  try {
    const role = readFileSync(E2E_ROLE_FILE, "utf8").trim();
    return isE2ERole(role) ? role : null;
  } catch {
    return null;
  }
}

export function setE2ERole(role: E2ERole) {
  if (isE2EAuthBypassEnabled()) {
    globalThis.__projectManagementE2ERole = role;
    mkdirSync(dirname(E2E_ROLE_FILE), { recursive: true });
    writeFileSync(E2E_ROLE_FILE, role, "utf8");
  }
}

export function clearE2ERole() {
  if (isE2EAuthBypassEnabled()) {
    globalThis.__projectManagementE2ERole = undefined;
    rmSync(E2E_ROLE_FILE, { force: true });
  }
}
