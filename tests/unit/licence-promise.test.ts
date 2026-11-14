/**
 * IMP-112: the published licence and the "always free" promise say the same
 * thing in every place they appear.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  ALWAYS_FREE,
  MEMORIA_LICENCE,
  MEMORIA_LICENCE_NAME,
} from "@/lib/licence/promise";

const root = path.resolve(import.meta.dirname, "../../");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("licence and promise (IMP-112)", () => {
  it("ships the unmodified AGPL-3.0 text", () => {
    const text = read("LICENSE");
    expect(text.split("\n")[0]!.trim()).toBe(
      "GNU AFFERO GENERAL PUBLIC LICENSE",
    );
    // The licence as published by the FSF (agpl-3.0.txt, 661 lines).
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "57c8ff33c9c0cfc3ef00e650a1cc910d7ee479a8bc509f6c9209a7c2a11399d6",
    );
  });

  it("names the same licence in package.json and the README", () => {
    expect(JSON.parse(read("package.json")).license).toBe(MEMORIA_LICENCE);
    const readme = read("README.md");
    expect(readme).toContain("## Licence");
    expect(readme).toContain(MEMORIA_LICENCE);
    expect(MEMORIA_LICENCE_NAME).toContain("Affero");
  });

  it("lists the features promised to stay free in the README and Help", () => {
    expect(ALWAYS_FREE).toEqual([
      "Running Memoria on your own server",
      "Passkeys and two-step codes",
      "Exporting everything you made",
      "AI on your own key",
    ]);
    const readme = read("README.md");
    for (const feature of ALWAYS_FREE) expect(readme).toContain(`- ${feature}`);
    const help = read("src/app/help/page.tsx");
    expect(help).toContain('title="Always free"');
    expect(help).toContain("ALWAYS_FREE.map");
  });
});
