import { describe, expect, it } from "vitest";

import { apiError } from "@/test/api";

import { ApiError, fieldErrorsOf, toApiError } from "./errors";

describe("toApiError", () => {
  it("reads the API error contract", async () => {
    const error = await toApiError(
      apiError(400, undefined, {
        message: "Request validation failed",
        details: [{ field: "email", message: "Invalid email address" }],
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 400,
      message: "Request validation failed",
      code: undefined,
      requestId: "req-1",
      details: [{ field: "email", message: "Invalid email address" }],
    });
  });

  it("keeps the code when the API sets one", async () => {
    const error = await toApiError(apiError(403, "PERMISSION_DENIED"));

    expect(error.code).toBe("PERMISSION_DENIED");
    expect(error.details).toEqual([]);
  });

  it("survives a body that is not JSON", async () => {
    const error = await toApiError(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    expect(error).toMatchObject({
      statusCode: 502,
      message: "Bad Gateway",
      requestId: undefined,
    });
  });

  it("survives JSON that is not the contract", async () => {
    const error = await toApiError(
      new Response(JSON.stringify({ oops: true }), { status: 500 }),
    );

    expect(error.statusCode).toBe(500);
    expect(error.message).toBe("Request failed");
  });
});

describe("fieldErrorsOf", () => {
  it("keeps the first message per field", () => {
    const error = new ApiError({
      statusCode: 400,
      message: "Request validation failed",
      details: [
        { field: "password", message: "Too short" },
        { field: "password", message: "Second" },
        { field: "email", message: "Invalid" },
      ],
    });

    expect(fieldErrorsOf(error)).toEqual({
      password: "Too short",
      email: "Invalid",
    });
  });

  it("is empty for anything else", () => {
    expect(fieldErrorsOf(new Error("x"))).toEqual({});
    expect(fieldErrorsOf(null)).toEqual({});
  });
});
