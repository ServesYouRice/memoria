import { describe, expect, it } from "vitest";
import { checkImageBounds } from "@/lib/uploads/image-bounds";

interface Frame {
  left?: number;
  top?: number;
  width: number;
  height: number;
  localTableBits?: number; // size exponent - 1, sets the local table flag
}

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function gif(
  screen: [number, number],
  frames: Frame[],
  options: { version?: string; globalTableBits?: number } = {},
): Buffer {
  const bytes: number[] = [
    ...Buffer.from(options.version ?? "GIF89a", "ascii"),
    ...u16(screen[0]),
    ...u16(screen[1]),
    options.globalTableBits === undefined ? 0 : 0x80 | options.globalTableBits,
    0,
    0,
  ];
  if (options.globalTableBits !== undefined) {
    bytes.push(...new Array(3 * 2 ** (options.globalTableBits + 1)).fill(0));
  }
  for (const frame of frames) {
    // Graphic control extension before each frame.
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    bytes.push(
      0x2c,
      ...u16(frame.left ?? 0),
      ...u16(frame.top ?? 0),
      ...u16(frame.width),
      ...u16(frame.height),
      frame.localTableBits === undefined ? 0 : 0x80 | frame.localTableBits,
    );
    if (frame.localTableBits !== undefined) {
      bytes.push(...new Array(3 * 2 ** (frame.localTableBits + 1)).fill(0));
    }
    bytes.push(2, 1, 0x44, 0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

describe("GIF image descriptor bounds", () => {
  it("rejects a 1x1 screen hiding a 65535x65535 frame", () => {
    const result = checkImageBounds(
      gif([1, 1], [{ width: 65535, height: 65535 }]),
      "image/gif",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a frame offset that pushes the canvas over the edge limit", () => {
    const result = checkImageBounds(
      gif([100, 100], [{ left: 9_990, width: 20, height: 20 }]),
      "image/gif",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects frames whose effective canvas exceeds the pixel budget", () => {
    const result = checkImageBounds(
      gif([10, 10], [{ width: 9_000, height: 9_000 }]),
      "image/gif",
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a valid two-frame GIF with a local color table", () => {
    const result = checkImageBounds(
      gif(
        [64, 48],
        [
          { width: 64, height: 48, localTableBits: 1 },
          { left: 10, top: 10, width: 20, height: 20 },
        ],
        { globalTableBits: 2 },
      ),
      "image/gif",
    );
    expect(result).toEqual({
      ok: true,
      info: { width: 64, height: 48, frames: 2 },
    });
  });

  it("checks GIF87a frames the same way", () => {
    expect(
      checkImageBounds(
        gif([1, 1], [{ width: 65535, height: 65535 }], { version: "GIF87a" }),
        "image/gif",
      ).ok,
    ).toBe(false);
    expect(
      checkImageBounds(
        gif([32, 32], [{ width: 32, height: 32 }], { version: "GIF87a" }),
        "image/gif",
      ).ok,
    ).toBe(true);
  });

  it("rejects a truncated image descriptor or data block", () => {
    const whole = gif([32, 32], [{ width: 32, height: 32 }]);
    const descriptorStart = whole.indexOf(0x2c);
    expect(
      checkImageBounds(whole.subarray(0, descriptorStart + 5), "image/gif").ok,
    ).toBe(false);
    const dataStart = descriptorStart + 10;
    expect(
      checkImageBounds(whole.subarray(0, dataStart + 2), "image/gif").ok,
    ).toBe(false);
  });
});
