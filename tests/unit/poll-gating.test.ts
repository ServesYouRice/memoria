import { ItemType } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
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
        detail: "Polls are disabled until voting is server-authoritative.",
      }),
    );
  });
});
