/**
 * Verifies that the pgvector extension is installed in the target database.
 *
 * Run with `pnpm exec tsx scripts/vector-check.ts`.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const result = await prisma.$queryRaw`
    SELECT extname
    FROM pg_extension
    WHERE extname = 'vector'
  `;

  if (!Array.isArray(result) || result.length === 0) {
    throw new Error(
      "pgvector extension is not installed in the target database.",
    );
  }

  console.log("pgvector extension is available.");
} finally {
  await prisma.$disconnect();
}
