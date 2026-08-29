import { readFileSync } from "fs";
import { spawnSync } from "child_process";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for schema drift checks");
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm");

const result = spawnSync(
  process.execPath,
  [
    pnpmCli,
    "exec",
    "prisma",
    "migrate",
    "diff",
    // Prisma 7 removed `--from-url` and `--to-schema-datamodel`.
    // `--from-config-datasource` reads the datasource out of prisma.config.ts,
    // which resolves `env("DATABASE_URL")` — the same URL this script asserts.
    "--from-config-datasource",
    "--to-schema",
    "prisma/schema.prisma",
    "--script",
  ],
  { encoding: "utf8", env: process.env, shell: false },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

const statements = result.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("--"));
if (statements.length === 0) {
  console.log("Schema drift check passed");
  process.exit(0);
}

const exceptions = JSON.parse(
  readFileSync("implementation/schema-drift-exceptions.json", "utf8"),
);
const today = new Date().toISOString().slice(0, 10);
for (const statement of statements) {
  const exception = exceptions.find((entry) => entry.sql === statement);
  if (!exception || exception.expires < today) {
    console.error(`Unapproved schema drift: ${statement}`);
    process.exit(1);
  }
  console.warn(
    `Approved schema drift ${exception.id} (expires ${exception.expires}): ${exception.reason}`,
  );
}
