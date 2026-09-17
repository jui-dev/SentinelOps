import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/", "/orgs", "/orgs/acme/settings?tab=1#x"])(
    "accepts the same-origin path %j",
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "orgs",
    "//evil.example",
    "//evil.example/orgs",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
  ])("falls back for %j", (value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("//x", "/orgs")).toBe("/orgs");
  });
});
