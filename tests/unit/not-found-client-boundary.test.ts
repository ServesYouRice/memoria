import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function isClientModule(source: string) {
  return /^\s*["']use client["'];?/.test(source);
}

describe("not-found page and the client-only theme module (TASK-057)", () => {
  it("does not read client-only theme exports from a Server Component", () => {
    const theme = readFileSync(path.join(root, "src/lib/theme.ts"), "utf8");
    const notFound = readFileSync(
      path.join(root, "src/app/not-found.tsx"),
      "utf8",
    );
    const importsTheme = /from ["']@\/lib\/theme["']/.test(notFound);
    // On the server, exports of a "use client" module are client references:
    // reading gradients.hero from one in a Server Component does not yield
    // the gradient string. The page must itself be a Client Component then.
    if (importsTheme && isClientModule(theme)) {
      expect(isClientModule(notFound)).toBe(true);
    }
  });
});
