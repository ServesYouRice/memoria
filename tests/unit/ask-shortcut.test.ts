import { describe, expect, it } from "vitest";
import { SHORTCUTS, matchesShortcut } from "@/lib/keyboard/shortcuts";
import {
  ASK_SHORTCUT,
  isAskShortcut,
} from "@/features/command-palette/ask-shortcut";

function key(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}) {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  } as KeyboardEvent;
}

describe("Ask shortcut (IMP-068)", () => {
  it("opens on Ctrl+J and Cmd+J only", () => {
    expect(isAskShortcut(key({ key: "j", ctrlKey: true }))).toBe(true);
    expect(isAskShortcut(key({ key: "j", metaKey: true }))).toBe(true);
    expect(isAskShortcut(key({ key: "j" }))).toBe(false);
    expect(
      isAskShortcut(key({ key: "j", ctrlKey: true, shiftKey: true })),
    ).toBe(false);
    expect(isAskShortcut(key({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("does not collide with another shortcut", () => {
    const event = key({ key: "j", ctrlKey: true });
    const matches = SHORTCUTS.filter((shortcut) =>
      matchesShortcut(event, shortcut),
    );
    expect(matches.map((shortcut) => shortcut.action)).toEqual(["ask"]);
    expect(ASK_SHORTCUT.action).toBe("ask");
  });
});
