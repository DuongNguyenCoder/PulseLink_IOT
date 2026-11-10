import { describe, expect, it } from "vitest";
import { getSafeErrorLogFields } from "./logging.js";

describe("safe error logging", () => {
  it("keeps Prisma diagnostics without serializing arbitrary metadata", () => {
    const fields = getSafeErrorLogFields({
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      message: "Raw query failed",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "42601",
            originalMessage: "syntax error at or near LIMIT",
          },
        },
        query: "SELECT secret_value",
      },
      stack: "PrismaClientKnownRequestError: Raw query failed\n at claim",
    });

    expect(fields).toEqual({
      errorType: "PrismaClientKnownRequestError",
      errorCode: "P2010",
      errorMessage: "Raw query failed",
      errorMetaCode: "42601",
      errorMetaMessage: "syntax error at or near LIMIT",
      errorStack: "PrismaClientKnownRequestError: Raw query failed\n at claim",
    });
    expect(fields).not.toHaveProperty("query");
  });
});
