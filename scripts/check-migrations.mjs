#!/usr/bin/env node
// Expand/contract rule for migrations (IMP-150, handbook ME-04).
//
// A rolling update runs the old and the new release side by side, and the
// migration Job runs before the new pods start. So a migration may only
// *expand* the schema (add tables, nullable or defaulted columns, indexes).
// Removing or renaming something (*contract*) is allowed only in a later
// release, once no running release reads it. Mark such a migration with a
// line `-- contract: <why it is safe now>`; DEPLOYMENT.md has the steps.
//
// Migrations up to BASELINE predate the rule and are not checked.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE = "20261114133200_canvas_trash";

const RULES = [
  [/\bDROP\s+TABLE\b/i, "drops a table"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bRENAME\s+COLUMN\b/i, "renames a column"],
  [/\bALTER\s+TABLE\b[^;]*\bRENAME\s+TO\b/i, "renames a table"],
  [/\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i, "changes a column type"],
  [/\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bDROP\s+TYPE\b/i, "drops a type"],
];

const CONTRACT_MARK = /^\s*--\s*contract:\s*\S/im;

/** Findings for one migration's SQL; empty when it is expand-only or marked. */
export function checkMigrationSql(sql) {
  if (CONTRACT_MARK.test(sql)) return [];
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const reasons = RULES.filter(([pattern]) => pattern.test(code)).map(
    ([, reason]) => reason,
  );
  // Old pods do not write a new required column, so it needs a default.
  for (const statement of code.split(";")) {
    for (const column of statement.split(/\bADD\s+COLUMN\b/i).slice(1)) {
      const definition = column.split(/,\s*ADD\b/i)[0];
      if (
        /\bNOT\s+NULL\b/i.test(definition) &&
        !/\bDEFAULT\b/i.test(definition)
      ) {
        reasons.push("adds a required column without a default");
      }
    }
  }
  return [...new Set(reasons)];
}

export function checkMigrations(directory = "prisma/migrations") {
  const problems = [];
  for (const name of readdirSync(directory).sort()) {
    if (name <= BASELINE) continue;
    const file = join(directory, name, "migration.sql");
    if (!existsSync(file)) continue;
    for (const reason of checkMigrationSql(readFileSync(file, "utf8"))) {
      problems.push(`${name}: ${reason}`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = checkMigrations();
  if (problems.length > 0) {
    console.error("Migrations that are not expand-only:");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "Split the change (expand now, contract in a later release) and mark the " +
        'contract migration with "-- contract: <reason>". See DEPLOYMENT.md.',
    );
    process.exit(1);
  }
  console.log("Migration check passed (expand-only since the baseline).");
}
