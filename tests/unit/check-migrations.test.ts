/**
 * IMP-150 (handbook ME-04): new migrations are expand-only unless marked as
 * the contract step of an earlier release.
 */
import { describe, expect, it } from "vitest";
import {
  checkMigrations,
  checkMigrationSql,
} from "../../scripts/check-migrations.mjs";

describe("migration expand/contract rule", () => {
  it("passes on the repository's migrations", () => {
    expect(checkMigrations()).toEqual([]);
  });

  it("accepts expand-only changes", () => {
    expect(
      checkMigrationSql(`
        CREATE TABLE "Invite" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));
        ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
        ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
        CREATE INDEX "User_plan_idx" ON "User"("plan");
      `),
    ).toEqual([]);
  });

  it.each([
    [`ALTER TABLE "User" DROP COLUMN "name";`, "drops a column"],
    [`DROP TABLE "Old";`, "drops a table"],
    [`ALTER TABLE "User" RENAME COLUMN "a" TO "b";`, "renames a column"],
    [`ALTER TABLE "Old" RENAME TO "New";`, "renames a table"],
    [
      `ALTER TABLE "User" ALTER COLUMN "a" SET DATA TYPE INTEGER;`,
      "changes a column type",
    ],
    [
      `ALTER TABLE "User" ALTER COLUMN "a" SET NOT NULL;`,
      "makes a column required",
    ],
    [
      `ALTER TABLE "User" ADD COLUMN "b" TEXT NOT NULL;`,
      "adds a required column without a default",
    ],
  ])("flags %s", (sql, reason) => {
    expect(checkMigrationSql(sql)).toContain(reason);
  });

  it("allows a marked contract step and ignores commented-out SQL", () => {
    expect(
      checkMigrationSql(
        `-- contract: release 2026-12 stopped reading "name"\nALTER TABLE "User" DROP COLUMN "name";`,
      ),
    ).toEqual([]);
    expect(checkMigrationSql(`-- DROP TABLE "Old";`)).toEqual([]);
  });
});
