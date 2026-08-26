#!/usr/bin/env node

/**
 * Pre-push test selector helper (IMP-050).
 *
 * Classifies push diffs and selects tests proportionally and fail-safe:
 * - Global/shared config changes -> full unit/API suite (vitest run)
 * - Documentation-only changes -> skip Vitest (lint + type-check already passed)
 * - Ordinary source/test changes -> vitest related --run <files...>
 * - Unresolvable refs, errors, or selector failures -> fail-safe full suite
 */

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";

export const ACTION_NONE = "NONE";
export const ACTION_FULL_SUITE = "FULL_SUITE";
export const ACTION_RELATED = "RELATED";

const ZERO_SHA = "0000000000000000000000000000000000000000";

const GLOBAL_CONFIG_PATTERNS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig(\..+)?\.json$/,
  /^vitest(\..+)?\.(ts|js|mjs)$/,
  /^tests\/setup(-happy-dom)?\.ts$/,
  /^prisma\//,
  /^generated\//,
  /^\.husky\//,
  /^scripts\/pre-push/,
  /^next\.config\./,
  /^eslint\.config\./,
  /^\.eslintrc/,
  /^server\.ts$/,
];

const DOC_PATTERNS = [
  /\.(md|mdx|txt)$/i,
  /^LICENSE$/i,
  /^\.gitignore$/,
  /^\.prettierrc(\..+)?$/,
  /^\.prettierignore$/,
  /^\.editorconfig$/,
  /^docs\//,
  /^implementation\//,
  /^\.agents\//,
];

/**
 * Classifies a single file path into 'global', 'doc', or 'code'.
 */
export function classifyFilePath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");

  for (const pattern of GLOBAL_CONFIG_PATTERNS) {
    if (pattern.test(normalized)) {
      return "global";
    }
  }

  for (const pattern of DOC_PATTERNS) {
    if (pattern.test(normalized)) {
      return "doc";
    }
  }

  return "code";
}

/**
 * Classifies an array of changed files and determines the test action.
 */
export function determineTestAction(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return { action: ACTION_NONE };
  }

  let hasGlobal = false;
  let hasCode = false;
  const codeFiles = [];

  for (const file of changedFiles) {
    const classification = classifyFilePath(file);
    if (classification === "global") {
      hasGlobal = true;
      break;
    }
    if (classification === "code") {
      hasCode = true;
      codeFiles.push(file);
    }
  }

  if (hasGlobal) {
    return { action: ACTION_FULL_SUITE, reason: "global configuration changed" };
  }

  if (!hasCode) {
    // Only documentation or non-code files changed
    return { action: ACTION_NONE, reason: "documentation-only changes" };
  }

  return { action: ACTION_RELATED, files: codeFiles };
}

/**
 * Parses pre-push stdin lines.
 * Format per line: <local ref> <local sha1> <remote ref> <remote sha1>
 */
export function parsePrePushInput(input) {
  if (!input || typeof input !== "string") return [];
  const lines = input.trim().split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      result.push({
        localRef: parts[0],
        localSha: parts[1],
        remoteRef: parts[2],
        remoteSha: parts[3],
      });
    }
  }
  return result;
}

/**
 * Resolves the comparison base and gets changed files from git.
 */
export function getChangedFilesFromGit(tuple, gitRunner = defaultGitRunner) {
  const { localSha, remoteSha } = tuple;

  if (localSha === ZERO_SHA) {
    // Branch deletion; no changes to test
    return [];
  }

  if (remoteSha && remoteSha !== ZERO_SHA) {
    // Standard push to existing remote ref
    try {
      const output = gitRunner(["diff", "--name-only", remoteSha, localSha]);
      return output
        .split(/\r?\n/)
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      // Remote ref or diff failed; fail safe
      return null;
    }
  }

  // New branch push (remoteSha is ZERO_SHA)
  // Try to find a trustworthy merge-base with origin/main or origin/develop or main
  const candidateBases = ["origin/main", "main", "origin/develop", "develop"];
  let baseFound = null;

  for (const candidate of candidateBases) {
    try {
      const base = gitRunner(["merge-base", candidate, localSha]).trim();
      if (base && base.length === 40) {
        baseFound = base;
        break;
      }
    } catch {
      // candidate does not exist or has no common ancestor
    }
  }

  if (!baseFound) {
    // Unresolvable base; fail safe
    return null;
  }

  try {
    const output = gitRunner(["diff", "--name-only", baseFound, localSha]);
    return output
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function defaultGitRunner(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Runs the selected test action safely using spawnSync without shell string interpolation.
 */
export function executeTestAction(
  testAction,
  runner = defaultCommandRunner,
) {
  if (testAction.action === ACTION_NONE) {
    console.log(
      `ℹ️  Skipping Vitest (${testAction.reason || "no relevant code changes"}).`,
    );
    return 0;
  }

  if (testAction.action === ACTION_RELATED && testAction.files?.length > 0) {
    console.log(
      `🧪 Running related tests for ${testAction.files.length} changed file(s)...`,
    );
    const code = runner("pnpm", [
      "exec",
      "vitest",
      "related",
      "--run",
      ...testAction.files,
    ]);
    if (code === 0) {
      return 0;
    }
    console.warn("⚠️  Related tests failed or errored; falling back to full unit/API suite.");
  }

  console.log("🧪 Running full unit/API test suite...");
  return runner("pnpm", ["run", "test", "--", "--run"]);
}

function defaultCommandRunner(cmd, args) {
  const isWindows = process.platform === "win32";
  const executable = isWindows && !cmd.endsWith(".cmd") && !cmd.endsWith(".exe") ? `${cmd}.cmd` : cmd;
  const proc = spawnSync(executable, args, {
    stdio: "inherit",
    shell: false,
  });
  return proc.status ?? 1;
}

/**
 * CLI Entry point when executed directly.
 */
async function main() {
  let stdin = "";
  try {
    stdin = fs.readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }

  const tuples = parsePrePushInput(stdin);
  if (tuples.length === 0) {
    // No ref tuples passed on stdin (e.g. manual invocation) -> run full suite to be safe
    const exitCode = executeTestAction({ action: ACTION_FULL_SUITE });
    process.exit(exitCode);
  }

  let allFiles = [];
  let unresolvable = false;

  for (const tuple of tuples) {
    const files = getChangedFilesFromGit(tuple);
    if (files === null) {
      unresolvable = true;
      break;
    }
    allFiles.push(...files);
  }

  if (unresolvable) {
    console.log("ℹ️  Could not determine comparison base; running full suite (fail-safe).");
    const exitCode = executeTestAction({ action: ACTION_FULL_SUITE });
    process.exit(exitCode);
  }

  // Deduplicate files
  allFiles = [...new Set(allFiles)];
  const testAction = determineTestAction(allFiles);
  const exitCode = executeTestAction(testAction);
  process.exit(exitCode);
}

if (process.argv[1] && process.argv[1].endsWith("pre-push-test-selector.mjs")) {
  main().catch((err) => {
    console.error("❌ Pre-push test selector error:", err);
    const exitCode = executeTestAction({ action: ACTION_FULL_SUITE });
    process.exit(exitCode);
  });
}
