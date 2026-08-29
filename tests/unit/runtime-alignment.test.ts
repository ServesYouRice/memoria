import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supported Node runtime", () => {
  it("pins the same LTS release in CI and both production image stages", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines: { node: string };
    };
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(packageJson.engines.node).toBe(">=24.20.0 <25");
    expect(dockerfile.match(/FROM node:24\.20\.0-alpine/g)).toHaveLength(2);
    expect(workflow).toContain("NODE_VERSION: '24.20.0'");
  });
});
