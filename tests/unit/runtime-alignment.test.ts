import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supported Node runtime", () => {
  it("pins the same LTS release in the local gate and both production image stages", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines: { node: string };
    };
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const gate = readFileSync("scripts/gate.mjs", "utf8");

    expect(packageJson.engines.node).toBe(">=24.20.0 <25");
    expect(dockerfile.match(/FROM node:24\.20\.0-alpine/g)).toHaveLength(2);
    expect(gate).toContain("export const NODE_VERSION = '24.20.0';");
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
