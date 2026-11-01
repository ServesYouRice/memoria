import { describe, expect, it } from "vitest";
import { isClientAbortError } from "@/lib/network/client-abort";

function errno(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

describe("isClientAbortError", () => {
  it("recognises Node's aborted-incoming-request error", () => {
    expect(isClientAbortError(errno("aborted", "ECONNRESET"))).toBe(true);
  });

  it("does not hide other failures", () => {
    expect(isClientAbortError(errno("read ECONNRESET", "ECONNRESET"))).toBe(
      false,
    );
    expect(isClientAbortError(errno("aborted", "EPIPE"))).toBe(false);
    expect(isClientAbortError(new Error("aborted"))).toBe(false);
    expect(isClientAbortError(new TypeError("boom"))).toBe(false);
    expect(isClientAbortError("aborted")).toBe(false);
    expect(isClientAbortError(undefined)).toBe(false);
  });
});
