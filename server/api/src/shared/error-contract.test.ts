import { describe, expect, it } from "vitest";
import { mapErrorToApiResponse } from "./error-contract.js";

describe("API error contract", () => {
  it.each([
    [{ code: "FST_ERR_VALIDATION", statusCode: 400 }, 400, "VALIDATION_ERROR"],
    [{ statusCode: 401 }, 401, "UNAUTHENTICATED"],
    [{ statusCode: 403 }, 403, "FORBIDDEN"],
    [{ statusCode: 404 }, 404, "NOT_FOUND"],
    [{ statusCode: 409 }, 409, "CONFLICT"],
    [{ statusCode: 429 }, 429, "RATE_LIMITED"],
    [{ statusCode: 503 }, 503, "DEPENDENCY_UNAVAILABLE"],
    [
      { statusCode: 500, message: "database password" },
      500,
      "INTERNAL_SERVER_ERROR",
    ],
  ])(
    "maps errors to a stable response",
    (error, expectedStatus, expectedCode) => {
      const mapped = mapErrorToApiResponse(error, "request-123");

      expect(mapped.statusCode).toBe(expectedStatus);
      expect(mapped.response).toEqual({
        error: {
          code: expectedCode,
          message: expect.any(String),
          requestId: "request-123",
        },
      });
      expect(JSON.stringify(mapped.response)).not.toContain(
        "database password",
      );
    },
  );

  it("does not expose validation details", () => {
    const mapped = mapErrorToApiResponse(
      {
        code: "FST_ERR_VALIDATION",
        statusCode: 400,
        validation: [{ message: "password must not be logged" }],
      },
      "request-456",
    );

    expect(mapped.response.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      requestId: "request-456",
    });
  });

  it("maps unsupported media types to a client error", () => {
    const mapped = mapErrorToApiResponse(
      { code: "FST_ERR_CTP_INVALID_MEDIA_TYPE", statusCode: 415 },
      "request-415",
    );

    expect(mapped).toEqual({
      statusCode: 415,
      response: {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Unsupported request media type",
          requestId: "request-415",
        },
      },
    });
  });

  it("returns an actionable safe message for a duplicate pending invitation", () => {
    const mapped = mapErrorToApiResponse(
      { statusCode: 409, apiReason: "INVITATION_ALREADY_PENDING" },
      "request-invitation-duplicate",
    );

    expect(mapped).toEqual({
      statusCode: 409,
      response: {
        error: {
          code: "CONFLICT",
          message: "An invitation is already pending for this email. Use Resend or wait until it expires.",
          requestId: "request-invitation-duplicate",
        },
      },
    });
  });
});
