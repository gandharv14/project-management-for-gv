import { z } from "zod";

/**
 * True only for absolute http:// or https:// URLs. Zod's `.url()` also accepts
 * dangerous schemes such as `javascript:` and `data:`, which must never be
 * stored and later rendered as a clickable link.
 */
export function isHttpUrl(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export const httpUrlSchema = z
  .string()
  .url()
  .refine(isHttpUrl, { message: "Link must start with http:// or https://" });
