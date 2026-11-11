import { describe, expect, it } from "vitest";
import { resolveCanvasCapabilities } from "@/types/canvas";
import { resolveBoardCapabilities } from "@/features/canvas/hooks/time-machine-capabilities";

describe("time-machine preview capabilities", () => {
  it("turns off every item write while previewing a version", () => {
    const { capabilities, canRestore } = resolveBoardCapabilities(
      resolveCanvasCapabilities("EDIT"),
      true,
    );
    expect(capabilities).toMatchObject({
      canMoveItems: false,
      canResizeItems: false,
      canEditItems: false,
      canCreateItems: false,
      canDeleteItems: false,
    });
    // Viewing and copying historical items still works.
    expect(capabilities.canCopyItems).toBe(true);
    // An editor can still restore the version being previewed.
    expect(canRestore).toBe(true);
  });

  it("keeps capabilities unchanged outside the time machine", () => {
    for (const level of ["OWNER", "EDIT", "COMMENT", "VIEW"] as const) {
      const base = resolveCanvasCapabilities(level);
      const { capabilities, canRestore } = resolveBoardCapabilities(
        base,
        false,
      );
      expect(capabilities).toEqual(base);
      expect(canRestore).toBe(base.canEditItems);
    }
  });

  it("never offers restore to viewers", () => {
    expect(
      resolveBoardCapabilities(resolveCanvasCapabilities("VIEW"), true)
        .canRestore,
    ).toBe(false);
  });
});
