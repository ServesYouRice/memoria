import { describe, expect, it } from "vitest";
import * as redirect from "@/lib/auth/redirect";

const { safeAuthCallbackUrl } = redirect;

describe("safeAuthCallbackUrl", () => {
  const origin = "https://memoria.example";

  it.each([
    [
      "/canvases/one?focus=item",
      "https://memoria.example/canvases/one?focus=item",
    ],
    ["https://memoria.example/settings", "https://memoria.example/settings"],
    ["https://attacker.example/phish", origin],
    ["//attacker.example/phish", origin],
    ["javascript:alert(1)", origin],
    ["%%%", "https://memoria.example/%%%"],
  ])("validates %s", (input, expected) => {
    expect(safeAuthCallbackUrl(input, origin)).toBe(expected);
  });
});

describe("toSafeCallbackPath", () => {
  const origin = "https://memoria.example";
  const fallback = "/dashboard";

  it.each([
    ["https://memoria.example//attacker.example/phish", fallback],
    ["https://memoria.example/\\attacker.example/phish", fallback],
    ["/\\attacker.example/phish", fallback],
    ["/canvas/abc?item=1#x", "/canvas/abc?item=1#x"],
    ["https://memoria.example/canvas/abc?item=1#x", "/canvas/abc?item=1#x"],
    ["https://attacker.example/phish", fallback],
    ["//attacker.example/phish", fallback],
    [null, fallback],
  ])("maps %s to %s", (input, expected) => {
    expect(typeof redirect.toSafeCallbackPath).toBe("function");
    const path = redirect.toSafeCallbackPath(input, origin, fallback);
    expect(path).toBe(expected);
    expect(path.startsWith("//")).toBe(false);
    expect(new URL(path, origin).origin).toBe(origin);
  });
});
