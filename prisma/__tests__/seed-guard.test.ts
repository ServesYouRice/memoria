import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "../seed-guard";

describe("assertSeedAllowed", () => {
  it("throws in production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  it.each(["development", "test", undefined])("allows NODE_ENV=%s", (value) => {
    expect(() => assertSeedAllowed({ NODE_ENV: value })).not.toThrow();
  });
});
