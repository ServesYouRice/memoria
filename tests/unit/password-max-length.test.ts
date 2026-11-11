import { beforeEach, describe, expect, it, vi } from "vitest";

const zxcvbn = vi.hoisted(() =>
  vi.fn(() => ({ score: 4, feedback: { warning: "", suggestions: [] } })),
);
vi.mock("zxcvbn", () => ({ default: zxcvbn }));

import { validatePasswordStrength } from "@/lib/validation/password";

describe("validatePasswordStrength length guard", () => {
  beforeEach(() => zxcvbn.mockClear());

  it("rejects over-length input without running zxcvbn", async () => {
    const result = await validatePasswordStrength("a".repeat(129));
    expect(result.isValid).toBe(false);
    expect(result.feedback.warning).toMatch(/at most 128/);
    expect(zxcvbn).not.toHaveBeenCalled();
  });

  it("still analyses a password of exactly 128 characters", async () => {
    const result = await validatePasswordStrength("a".repeat(128));
    expect(result.isValid).toBe(true);
    expect(zxcvbn).toHaveBeenCalledTimes(1);
  });
});
