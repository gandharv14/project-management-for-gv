import { describe, expect, it } from "vitest";

import { httpUrlSchema, isHttpUrl } from "@/lib/validation";

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("https://example.com/tasks/1?x=2#frag")).toBe(true);
  });

  it("rejects dangerous and non-http schemes", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isHttpUrl("ftp://example.com/file")).toBe(false);
  });

  it("rejects strings that are not URLs", () => {
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("httpUrlSchema", () => {
  it("parses a valid https URL", () => {
    expect(httpUrlSchema.parse("https://example.com/tasks/flagged-user")).toBe(
      "https://example.com/tasks/flagged-user",
    );
  });

  it("rejects a javascript: URL", () => {
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(httpUrlSchema.safeParse("data:text/html,<script>alert(1)</script>").success).toBe(false);
  });
});
