import { describe, expect, it } from "vitest";

import { parsePublicEnv } from "./env";

describe("parsePublicEnv", () => {
  it("derives the API base URL from the origin", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_API_URL: "http://localhost:3001" }),
    ).toEqual({
      apiOrigin: "http://localhost:3001",
      apiBaseUrl: "http://localhost:3001/api/v1",
    });
  });

  it("accepts a trailing slash", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_API_URL: "https://api.example.com/" })
        .apiBaseUrl,
    ).toBe("https://api.example.com/api/v1");
  });

  it.each([
    [undefined],
    [""],
    ["not a url"],
    ["ftp://api.example.com"],
    ["http://localhost:3001/api/v1"],
    ["http://localhost:3001?x=1"],
  ])("rejects %j, naming the variable", (value) => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_API_URL: value })).toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
  });
});
