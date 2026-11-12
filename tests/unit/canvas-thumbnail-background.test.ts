// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type Konva from "konva";
import { thumbnailDataUrl } from "@/features/canvas/lib/thumbnail";

describe("canvas thumbnail (IMP-083)", () => {
  it("paints the canvas background under the transparent stage", () => {
    const calls: string[] = [];
    const context = {
      set fillStyle(value: string) {
        calls.push(`fill:${value}`);
      },
      fillRect: vi.fn(() => calls.push("fillRect")),
      drawImage: vi.fn(() => calls.push("drawImage")),
    };
    const output = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: vi.fn(() => "data:image/jpeg;base64,AAAA"),
    };
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValueOnce(output as unknown as HTMLCanvasElement);
    const source = { width: 120, height: 80 };
    const stage = {
      toCanvas: vi.fn(() => source),
      toDataURL: vi.fn(),
    } as unknown as Konva.Stage;

    expect(thumbnailDataUrl(stage, "#f8fafc")).toBe(
      "data:image/jpeg;base64,AAAA",
    );
    expect(calls).toEqual(["fill:#f8fafc", "fillRect", "drawImage"]);
    expect([output.width, output.height]).toEqual([120, 80]);
    expect(output.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.6);
    expect(stage.toDataURL).not.toHaveBeenCalled();
    create.mockRestore();
  });
});
