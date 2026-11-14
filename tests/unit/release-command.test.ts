/**
 * IMP-148 (handbook ME-01): the release command builds from a clean commit,
 * stops on a high audit or Trivy finding, and with --push prints the digest.
 */
import { describe, expect, it } from "vitest";
import { parseArgs, release } from "../../scripts/release.mjs";

const REVISION = "0123456789abcdef0123456789abcdef01234567";

type Call = { command: string; args: string[] };

function fakeRun(overrides: Record<string, number> = {}, dirty = "") {
  const calls: Call[] = [];
  const run = (command: string, args: string[]) => {
    calls.push({ command, args });
    const key = `${command} ${args[0]}`;
    if (key === "git status") return { status: 0, stdout: dirty };
    if (key === "git rev-parse") return { status: 0, stdout: `${REVISION}\n` };
    if (key === "docker image")
      return {
        status: 0,
        stdout: JSON.stringify(["ghcr.io/servesyourice/memoria@sha256:abc123"]),
      };
    return { status: overrides[key] ?? 0, stdout: "" };
  };
  return { run, calls };
}

const quiet = () => undefined;

describe("release command", () => {
  it("dry-runs by default: audit, build, scan, no push", () => {
    const { run, calls } = fakeRun();
    const result = release(parseArgs([]), { run, log: quiet });
    expect(result).toMatchObject({
      revision: REVISION,
      tag: "ghcr.io/servesyourice/memoria:0123456789ab",
      digest: null,
    });
    const steps = calls.map((call) => `${call.command} ${call.args[0]}`);
    expect(steps).toEqual([
      "git status",
      "git rev-parse",
      "pnpm audit",
      "docker build",
      "trivy image",
    ]);
  });

  it("pushes and returns the digest with --push", () => {
    const { run, calls } = fakeRun();
    const result = release(parseArgs(["--push"]), { run, log: quiet });
    expect(result.digest).toBe("sha256:abc123");
    expect(calls.some((call) => call.args[0] === "push")).toBe(true);
  });

  it("refuses a dirty worktree", () => {
    const { run, calls } = fakeRun({}, " M server.ts");
    expect(() => release(parseArgs([]), { run, log: quiet })).toThrow(
      /uncommitted/,
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["pnpm audit", "pnpm audit"],
    ["trivy image", "Trivy scan"],
  ])("stops on a high finding from %s, before any push", (key, step) => {
    const { run, calls } = fakeRun({ [key]: 1 });
    expect(() => release(parseArgs(["--push"]), { run, log: quiet })).toThrow(
      step,
    );
    expect(calls.some((call) => call.args[0] === "push")).toBe(false);
  });

  it("rejects unknown options", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown option/);
    expect(parseArgs(["--image", "registry.example/m"]).image).toBe(
      "registry.example/m",
    );
  });
});
