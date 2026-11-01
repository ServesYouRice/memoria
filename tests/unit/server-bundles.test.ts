/**
 * The app server, outbox worker and sync server run the esbuild bundles from
 * `scripts/build-server.mjs`. They keep packages external, so Node's ESM
 * loader resolves and links every package import when the process starts.
 * Vitest and tsx resolve more loosely (extension search, CommonJS interop):
 * `next/server` passed every other test and only crashed the sync container.
 * Build the bundles and link their package imports as Node does, without
 * running the bundles.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BUNDLES = ["server.mjs", "outbox-worker.mjs", "sync-server.mjs"];

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "memoria-server-bundles-"));
  execFileSync(process.execPath, ["scripts/build-server.mjs"], {
    env: { ...process.env, SERVER_BUNDLE_OUT_DIR: outDir },
    stdio: "pipe",
  });
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

/** The bundle's import statements and literal dynamic imports. */
function packageImports(source: string): string[] {
  const statements =
    source.match(/^import\s[^;]*?from\s*"[^"]+";|^import\s*"[^"]+";/gm) ?? [];
  const dynamic = [...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map(
    ([, specifier]) => `await import(${JSON.stringify(specifier)});`,
  );
  return [...statements, ...dynamic];
}

describe("production server bundles", () => {
  it.each(BUNDLES)(
    "%s links its package imports under Node's ESM loader",
    (bundle) => {
      const imports = packageImports(
        readFileSync(join(outDir, bundle), "utf8"),
      );
      expect(imports.length).toBeGreaterThan(0);
      // Evaluated from the project root, where dist/ resolves node_modules.
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          [...imports, 'console.log("linked");'].join("\n"),
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(output.trim()).toBe("linked");
    },
    60_000,
  );
});
