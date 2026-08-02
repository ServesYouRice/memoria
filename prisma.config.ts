/**
 * Prisma CLI configuration.
 *
 * Prisma 7 no longer accepts `datasource.url` in `schema.prisma`. Migrate,
 * studio, and the other CLI commands read the connection URL from here; the
 * application client gets it through the pg driver adapter in `src/lib/db.ts`.
 *
 * @module prisma.config
 */

import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
