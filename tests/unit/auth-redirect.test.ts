import { describe, expect, it } from "vitest";
import { safeAuthCallbackUrl } from "@/lib/auth/redirect";

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
