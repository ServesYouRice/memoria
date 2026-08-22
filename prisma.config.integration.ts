/**
 * Prisma CLI configuration for the integration suite.
 *
 * Identical to `prisma.config.ts` except that it declares no seed command.
 * `scripts/test-integration.mjs` resets the test database before every run and
 * the suite builds its own fixtures, so seeding would both slow the run and
 * leave rows the assertions do not expect.
 *
 * Prisma 6 expressed this as `prisma migrate reset --skip-seed`. Prisma 7
 * removed that flag, and omitting the `migrations.seed` entry is the
 * replacement.
 *
 * @module prisma.config.integration
 */

import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
