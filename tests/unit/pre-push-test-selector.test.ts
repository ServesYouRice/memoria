import { describe, expect, it, vi } from "vitest";
import {
  ACTION_FULL_SUITE,
  ACTION_NONE,
  ACTION_RELATED,
  classifyFilePath,
  determineTestAction,
  executeTestAction,
  getChangedFilesFromGit,
  parsePrePushInput,
} from "../../scripts/pre-push-test-selector.mjs";

describe("Pre-push Test Selector (IMP-050)", () => {
  describe("Path Classification", () => {
    it.each([
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "tsconfig.node.json",
      "vitest.config.ts",
      "vitest.routes-coverage.config.ts",
      "tests/setup.ts",
      "tests/setup-happy-dom.ts",
      "prisma/schema.prisma",
      "generated/prisma/client/index.js",
      ".husky/pre-push",
      "scripts/pre-push-test-selector.mjs",
      "next.config.mjs",
      "eslint.config.js",
      ".eslintrc.json",
      "server.ts",
    ])("classifies global configuration file '%s' as 'global'", (file) => {
      expect(classifyFilePath(file)).toBe("global");
    });

    it.each([
      "README.md",
      "docs/architecture.md",
      "implementation/KANBAN.md",
      "implementation/tasks/IMP-050.md",
      "LICENSE",
      ".gitignore",
      ".prettierrc",
      ".prettierignore",
      ".editorconfig",
      ".agents/rules.md",
      "notes.txt",
    ])("classifies documentation/non-code file '%s' as 'doc'", (file) => {
      expect(classifyFilePath(file)).toBe("doc");
    });

    it.each([
      "src/app/api/v1/workspaces/route.ts",
      "src/lib/api/auth.ts",
      "tests/api/tenant-owned-routes.test.ts",
      "tests/unit/client-ip.test.ts",
      "src/components/Canvas.tsx",
      "src/styles/globals.css",
    ])("classifies ordinary code/test file '%s' as 'code'", (file) => {
      expect(classifyFilePath(file)).toBe("code");
    });

    it("handles Windows backslashes in paths safely", () => {
      expect(classifyFilePath("src\\app\\api\\v1\\workspaces\\route.ts")).toBe(
        "code",
      );
      expect(classifyFilePath("implementation\\tasks\\IMP-050.md")).toBe("doc");
      expect(classifyFilePath("tests\\setup.ts")).toBe("global");
    });

    it("handles paths containing spaces and shell metacharacters safely", () => {
      expect(
        classifyFilePath("src/components/My Component with spaces.tsx"),
      ).toBe("code");
      expect(classifyFilePath("docs/specs/v1.0 ($draft & final).md")).toBe(
        "doc",
      );
      expect(classifyFilePath("src/file;rm -rf;.ts")).toBe("code");
    });
  });

  describe("Determine Test Action", () => {
    it("returns ACTION_NONE when file list is empty", () => {
      expect(determineTestAction([])).toEqual({ action: ACTION_NONE });
    });

    it("returns ACTION_NONE for documentation-only changes", () => {
      const result = determineTestAction([
        "README.md",
        "implementation/KANBAN.md",
        ".gitignore",
      ]);
      expect(result.action).toBe(ACTION_NONE);
      expect(result.reason).toMatch(/documentation-only/i);
    });

    it("returns ACTION_FULL_SUITE if any global configuration file is changed", () => {
      const result = determineTestAction([
        "src/lib/api/auth.ts",
        "package.json",
        "README.md",
      ]);
      expect(result.action).toBe(ACTION_FULL_SUITE);
      expect(result.reason).toMatch(/global configuration/i);
    });

    it("returns ACTION_RELATED with only code files when ordinary source/test changes occur", () => {
      const result = determineTestAction([
        "src/lib/api/auth.ts",
        "tests/unit/auth.test.ts",
        "README.md",
      ]);
      expect(result.action).toBe(ACTION_RELATED);
      expect(result.files).toEqual([
        "src/lib/api/auth.ts",
        "tests/unit/auth.test.ts",
      ]);
    });
  });

  describe("Pre-push Input Parsing", () => {
    it("parses valid pre-push stdin tuples", () => {
      const input = `refs/heads/feature 1234567890123456789012345678901234567890 refs/heads/feature abcdef1234567890abcdef1234567890abcdef12\n`;
      const parsed = parsePrePushInput(input);
      expect(parsed).toEqual([
        {
          localRef: "refs/heads/feature",
          localSha: "1234567890123456789012345678901234567890",
          remoteRef: "refs/heads/feature",
          remoteSha: "abcdef1234567890abcdef1234567890abcdef12",
        },
      ]);
    });

    it("returns empty array for empty or whitespace input", () => {
      expect(parsePrePushInput("")).toEqual([]);
      expect(parsePrePushInput("   \n  ")).toEqual([]);
    });
  });

  describe("Git Diff and Base Resolution", () => {
    const zeroSha = "0000000000000000000000000000000000000000";
    const localSha = "1111111111111111111111111111111111111111";
    const remoteSha = "2222222222222222222222222222222222222222";

    it("returns empty array for branch deletion (localSha is zero)", () => {
      const tuple = {
        localRef: "refs/heads/feature",
        localSha: zeroSha,
        remoteRef: "refs/heads/feature",
        remoteSha,
      };
      const files = getChangedFilesFromGit(tuple);
      expect(files).toEqual([]);
    });

    it("diffs against remoteSha when remoteSha is a valid commit", () => {
      const mockGitRunner = vi
        .fn()
        .mockReturnValue("src/lib/api/auth.ts\nREADME.md\n");
      const tuple = {
        localRef: "refs/heads/feature",
        localSha,
        remoteRef: "refs/heads/feature",
        remoteSha,
      };

      const files = getChangedFilesFromGit(tuple, mockGitRunner);
      expect(files).toEqual(["src/lib/api/auth.ts", "README.md"]);
      expect(mockGitRunner).toHaveBeenCalledWith([
        "diff",
        "--name-only",
        remoteSha,
        localSha,
      ]);
    });

    it("resolves merge-base against candidate base when pushing new branch (remoteSha is zero)", () => {
      const mockBase = "3333333333333333333333333333333333333333";
      const mockGitRunner = vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "merge-base") {
          if (args[1] === "origin/main") return `${mockBase}\n`;
          throw new Error("not found");
        }
        if (args[0] === "diff") {
          return "src/components/Button.tsx\n";
        }
        return "";
      });

      const tuple = {
        localRef: "refs/heads/new-feature",
        localSha,
        remoteRef: "refs/heads/new-feature",
        remoteSha: zeroSha,
      };

      const files = getChangedFilesFromGit(tuple, mockGitRunner);
      expect(files).toEqual(["src/components/Button.tsx"]);
      expect(mockGitRunner).toHaveBeenCalledWith([
        "merge-base",
        "origin/main",
        localSha,
      ]);
      expect(mockGitRunner).toHaveBeenCalledWith([
        "diff",
        "--name-only",
        mockBase,
        localSha,
      ]);
    });

    it("returns null (fallback to full suite) when merge-base cannot be resolved for new branch", () => {
      const mockGitRunner = vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "merge-base") {
          throw new Error("no merge base found");
        }
        return "";
      });

      const tuple = {
        localRef: "refs/heads/orphan-branch",
        localSha,
        remoteRef: "refs/heads/orphan-branch",
        remoteSha: zeroSha,
      };

      const files = getChangedFilesFromGit(tuple, mockGitRunner);
      expect(files).toBeNull();
    });

    it("returns null (fallback to full suite) when git diff command throws", () => {
      const mockGitRunner = vi.fn().mockImplementation(() => {
        throw new Error("git error");
      });

      const tuple = {
        localRef: "refs/heads/feature",
        localSha,
        remoteRef: "refs/heads/feature",
        remoteSha,
      };

      const files = getChangedFilesFromGit(tuple, mockGitRunner);
      expect(files).toBeNull();
    });
  });

  describe("Command Execution and Argument Safety", () => {
    it("skips Vitest execution when action is ACTION_NONE", () => {
      const mockRunner = vi.fn();
      const code = executeTestAction({ action: ACTION_NONE }, mockRunner);
      expect(code).toBe(0);
      expect(mockRunner).not.toHaveBeenCalled();
    });

    it("passes files safely as argument array to vitest related without shell string interpolation", () => {
      const mockRunner = vi.fn().mockReturnValue(0);
      const files = [
        "src/file with spaces.ts",
        "src/file;dangerous$(whoami).ts",
      ];

      const code = executeTestAction(
        { action: ACTION_RELATED, files },
        mockRunner,
      );

      expect(code).toBe(0);
      expect(mockRunner).toHaveBeenCalledWith("pnpm", [
        "exec",
        "vitest",
        "related",
        "--run",
        "src/file with spaces.ts",
        "src/file;dangerous$(whoami).ts",
      ]);
    });

    it("falls back to full test suite when vitest related returns non-zero code", () => {
      const mockRunner = vi
        .fn()
        .mockReturnValueOnce(1) // vitest related fails
        .mockReturnValueOnce(0); // fallback full suite passes

      const code = executeTestAction(
        { action: ACTION_RELATED, files: ["src/lib/api/auth.ts"] },
        mockRunner,
      );

      expect(code).toBe(0);
      expect(mockRunner).toHaveBeenNthCalledWith(1, "pnpm", [
        "exec",
        "vitest",
        "related",
        "--run",
        "src/lib/api/auth.ts",
      ]);
      expect(mockRunner).toHaveBeenNthCalledWith(2, "pnpm", [
        "run",
        "test",
        "--",
        "--run",
      ]);
    });

    it("runs full test suite when action is ACTION_FULL_SUITE", () => {
      const mockRunner = vi.fn().mockReturnValue(0);
      const code = executeTestAction({ action: ACTION_FULL_SUITE }, mockRunner);

      expect(code).toBe(0);
      expect(mockRunner).toHaveBeenCalledWith("pnpm", [
        "run",
        "test",
        "--",
        "--run",
      ]);
    });
  });
});
