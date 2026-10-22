import { describe, expect, it } from "vitest";
import { normalizePem } from "./pem.js";

describe("normalizePem", () => {
  it("normalizes escaped newlines, CRLF and surrounding whitespace", () => {
    expect(
      normalizePem(
        "  -----BEGIN PUBLIC KEY-----\\r\\n  ABCD  \\n  -----END PUBLIC KEY-----  ",
      ),
    ).toBe("-----BEGIN PUBLIC KEY-----\nABCD\n-----END PUBLIC KEY-----");
  });

  it("removes one surrounding quote pair from secret-manager values", () => {
    expect(
      normalizePem(
        '"-----BEGIN PRIVATE KEY-----\\nABCD\\n-----END PRIVATE KEY-----"',
      ),
    ).toBe("-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----");
  });
});
