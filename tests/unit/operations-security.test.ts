import { describe, expect, it, vi } from "vitest";
import { SECURITY_HEADERS } from "@/lib/security/headers";
import { sanitizeLogValue } from "@/lib/logger";
import { hasInternalOperationsAccess } from "@/lib/operations/internal-auth";

describe("operations security", () => {
  it("uses CSP-era legacy XSS behavior", () => {
    expect(SECURITY_HEADERS["X-XSS-Protection"]).toBe("0");
  });

  it("requires a timing-safe internal bearer token", () => {
    vi.stubEnv("INTERNAL_OPERATIONS_TOKEN", "a".repeat(32));
    expect(
      hasInternalOperationsAccess(
        new Request("http://localhost/api/ready", {
          headers: { authorization: `Bearer ${"a".repeat(32)}` },
        }),
      ),
    ).toBe(true);
    expect(
      hasInternalOperationsAccess(new Request("http://localhost/api/ready")),
    ).toBe(false);
  });

  it("recursively scrubs capitalized, nested, error, and stringified secrets", () => {
    const scrubbed = sanitizeLogValue({
      nested: { Password: "hidden", TOKEN: "hidden" },
      error: new Error("authorization=hidden"),
      json: JSON.stringify({ apiKey: "hidden" }),
    });
    expect(JSON.stringify(scrubbed)).not.toContain("hidden");
    expect(JSON.stringify(scrubbed)).toContain("[REDACTED]");
  });
});
