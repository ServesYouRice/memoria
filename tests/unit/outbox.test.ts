import { describe, expect, it } from "vitest";
import { assertSafeOutboxPayload } from "@/lib/outbox/enqueue";
import { retryDelayMs } from "@/lib/outbox/repository";

describe("outbox foundation", () => {
  it("rejects plaintext secrets at any payload depth", () => {
    expect(() =>
      assertSafeOutboxPayload({ nested: { apiKey: "secret" } }),
    ).toThrow("may not contain secret field");
  });

  it("allows identifiers and minimized delivery data", () => {
    expect(() =>
      assertSafeOutboxPayload({ userId: "user-1", templateId: "verify" }),
    ).not.toThrow();
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(4)).toBe(8_000);
    expect(retryDelayMs(99)).toBe(3_600_000);
  });
});
