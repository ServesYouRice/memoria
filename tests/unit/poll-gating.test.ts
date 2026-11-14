import { ItemType } from "@/generated/prisma/client";
import type * as ProductSurfaces from "@/lib/product-surfaces";
import type { LaunchCapability } from "@/lib/product-surfaces";
import { describe, expect, it, vi } from "vitest";

// IMP-104: polls are on; these tests keep the off switch working.
vi.mock("@/lib/product-surfaces", async (importOriginal) => {
  const actual = await importOriginal<typeof ProductSurfaces>();
  return {
    ...actual,
    isLaunchCapabilityEnabled: (capability: string) =>
      capability === "polls"
        ? false
        : actual.isLaunchCapabilityEnabled(capability as LaunchCapability),
  };
});

import { requirePollsEnabled } from "@/lib/polls/availability";

describe("poll launch gate", () => {
  it("allows supported canvas item types", () => {
    expect(() => requirePollsEnabled(ItemType.NOTE)).not.toThrow();
  });

  it("rejects poll creation, reads, and mutations with an explicit problem", () => {
    expect(() => requirePollsEnabled(ItemType.POLL)).toThrowError(
      expect.objectContaining({
        status: 404,
        type: "https://memoria.local/errors/feature-disabled",
        detail: "Polls are switched off.",
      }),
    );
  });
});
