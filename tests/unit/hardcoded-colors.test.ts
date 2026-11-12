import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * IMP-080: screens take colours from the theme (src/lib/theme.ts) or the
 * shared canvas palette (src/features/canvas/lib/canvas-palette.ts), so light
 * and dark mode stay in step. A new hand-typed hex or rgb() colour in a
 * screen file fails this test.
 */

const ROOTS = ["src/app", "src/features", "src/components"];

/** Files that may keep literal colours, and why. */
const ALLOWED = new Set([
  // The logo artwork is fixed brand art, the same in both modes.
  "src/components/MemoriaLogo.tsx",
  // Renders when the whole app (theme included) has crashed.
  "src/app/global-error.tsx",
  // Server-rendered marketing page; its fixed colours have contrast tests.
  "src/app/page.tsx",
  // Pen and highlighter presets are colours the user picks and stores.
  "src/features/canvas/components/DrawingToolbar.tsx",
]);

const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(/i;

function screenFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return screenFiles(full);
    if (!/\.(tsx|css)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }
    return [full];
  });
}

export function findHardCodedColors(source: string): string[] {
  return source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => COLOR.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}

describe("screen colours come from the theme", () => {
  it("finds hex and rgb() colours", () => {
    expect(findHardCodedColors('fill="#2196F3"')).toHaveLength(1);
    expect(findHardCodedColors("color: rgba(0, 0, 0, 0.6);")).toHaveLength(1);
    expect(findHardCodedColors('fill={palette.surface} id="a1"')).toEqual([]);
  });

  it("has no hand-typed colours outside the allowlist", () => {
    const offenders = ROOTS.flatMap((root) =>
      screenFiles(path.join(process.cwd(), root)),
    )
      .map((file) =>
        path.relative(process.cwd(), file).split(path.sep).join("/"),
      )
      .filter((file) => !ALLOWED.has(file))
      .flatMap((file) =>
        findHardCodedColors(readFileSync(file, "utf8")).map(
          (hit) => `${file}:${hit}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
