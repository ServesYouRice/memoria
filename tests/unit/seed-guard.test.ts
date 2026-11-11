import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "../../prisma/seed-guard";

describe("seed guard", () => {
  it("refuses to seed when NODE_ENV is production", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  it.each([["development"], ["test"], [undefined]])(
    "allows seeding when NODE_ENV is %s",
    (NODE_ENV) => {
      expect(() => assertSeedAllowed({ NODE_ENV })).not.toThrow();
    },
  );

  it("stops the seed script before it touches the database in production", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        // Nothing listens here: reaching the database would fail differently.
        DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/none",
      },
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(
      /Refusing to seed.*production/,
    );
    expect(result.stdout).not.toContain("Creating test users");
  }, 60_000);
});
