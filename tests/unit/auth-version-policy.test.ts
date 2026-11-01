import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const dependencies = packageJson.dependencies as Record<string, string>;
const devDependencies = packageJson.devDependencies as Record<string, string>;

describe("auth library version policy (IMP-041)", () => {
  it("exact-pins Better Auth and its passkey plugin to one reviewed release", () => {
    const betterAuth = dependencies["better-auth"];
    expect(betterAuth).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dependencies["@better-auth/passkey"]).toBe(betterAuth);
  });

  it("no longer ships the Auth.js beta or its adapter", () => {
    for (const name of ["next-auth", "@auth/core", "@auth/prisma-adapter"]) {
      expect(dependencies[name], name).toBeUndefined();
      expect(devDependencies[name], name).toBeUndefined();
    }
  });
});
