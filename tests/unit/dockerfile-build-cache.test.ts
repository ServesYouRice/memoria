/**
 * IMP-144 (handbook RUN-ME-2): the runtime image does not carry webpack's
 * build cache, which doubled the image to about 2 GB.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("drops .next/cache in the build stage before the runtime copy", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    const build = dockerfile.slice(
      dockerfile.indexOf(" AS build"),
      dockerfile.indexOf(" AS runtime"),
    );
    expect(build).toMatch(/pnpm build[\s\S]*rm -rf \.next\/cache/);
  });
});
