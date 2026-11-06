import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

describe("supported Node runtime", () => {
  it("pins the same LTS release in the local gate and both production image stages", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines: { node: string };
    };
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const gate = readFileSync("scripts/gate.mjs", "utf8");

    expect(packageJson.engines.node).toBe(">=26.13.0 <27");
    expect(dockerfile.match(/FROM node:26\.13\.0-alpine/g)).toHaveLength(2);
    expect(gate).toContain("export const NODE_VERSION = '26.13.0';");
  });

  it("pins the same pnpm release in the local gate and package.json", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager: string;
    };
    const gate = readFileSync("scripts/gate.mjs", "utf8");

    expect(packageJson.packageManager).toBe("pnpm@11.13.1");
    expect(gate).toContain("export const PNPM_VERSION = '11.13.1';");
  });

  it("keeps no hosted CI workflow that runs on push", () => {
    expect(existsSync(".github/workflows")).toBe(false);
  });
});

describe("production runtime image contents", () => {
  function scriptFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return scriptFiles(path);
      return /\.(mjs|js)$/.test(entry.name) ? [path] : [];
    });
  }

  it("copies every file outside scripts/ that runtime scripts import", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    const copied = [
      ...runtimeStage.matchAll(/COPY --from=build \S+ \/app\/(\S+)/g),
    ].map((match) => match[1]);
    const missing: string[] = [];

    for (const file of scriptFiles("scripts")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /from\s+['"](\.{1,2}\/[^'"]+)['"]/g,
      )) {
        const target = normalize(join(dirname(file), match[1]));
        if (target.startsWith("scripts/")) continue;
        const shipped = copied.some(
          (path) => target === path || !relative(path, target).startsWith(".."),
        );
        if (!shipped) missing.push(`${file} -> ${target}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
