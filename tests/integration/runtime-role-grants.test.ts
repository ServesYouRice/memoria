/**
 * IMP-149 (handbook ME-02): where the "memoria_app" role exists, the grants
 * migration lets it read and write rows but not change the schema. Without
 * the role (most local databases) there is nothing to check.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

afterAll(() => prisma.$disconnect());

describe("runtime role grants", () => {
  it("gives memoria_app data access and no schema rights", async () => {
    const [role] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memoria_app') AS exists`;
    if (!role?.exists) return;
    const [rights] = await prisma.$queryRaw<
      {
        write: boolean;
        createInSchema: boolean;
        writeHistory: boolean;
        readHistory: boolean;
      }[]
    >`
      SELECT
        has_table_privilege('memoria_app', '"User"', 'SELECT, INSERT, UPDATE, DELETE') AS "write",
        has_schema_privilege('memoria_app', 'public', 'CREATE') AS "createInSchema",
        has_table_privilege('memoria_app', '_prisma_migrations', 'INSERT') AS "writeHistory",
        has_table_privilege('memoria_app', '_prisma_migrations', 'SELECT') AS "readHistory"`;
    expect(rights).toEqual({
      write: true,
      createInSchema: false,
      writeHistory: false,
      readHistory: true,
    });
  });
});
