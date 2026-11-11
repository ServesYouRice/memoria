import { describe, expect, it } from "vitest";
import { ItemType } from "@/generated/prisma/client";
import {
  normalizeAgentItemWriteBatch,
  normalizeAgentItemWriteData,
} from "@/lib/agents/service-core";

const geometry = {
  positionX: 0,
  positionY: 0,
  width: 200,
  height: 120,
  zIndex: 0,
};

const poll = {
  ...geometry,
  type: ItemType.POLL,
  content: {
    question: "Lunch?",
    options: [{ id: "a", text: "Pizza", votes: [] }],
  },
};

const featureDisabled = expect.objectContaining({
  status: 404,
  type: "https://memoria.local/errors/feature-disabled",
});

describe("agent item writes and the polls launch gate", () => {
  it("refuses POLL items while polls are disabled", () => {
    expect(() => normalizeAgentItemWriteData(poll)).toThrowError(
      featureDisabled,
    );
    expect(() => normalizeAgentItemWriteBatch([poll])).toThrowError(
      featureDisabled,
    );
  });

  it("still accepts other item types", () => {
    const note = normalizeAgentItemWriteData({
      ...geometry,
      type: ItemType.NOTE,
      content: { text: "<p>Hello</p>" },
    });
    expect(note.type).toBe(ItemType.NOTE);
  });
});
