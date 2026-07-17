import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("Auth.js version policy", () => {
  it("exact-pins next-auth to the approved beta build", () => {
    expect(packageJson.dependencies["next-auth"]).toBe("5.0.0-beta.31");
  });
});
