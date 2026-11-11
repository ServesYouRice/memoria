/**
 * TASK-235 — the proxy request logs never carry the share, embed or
 * invitation bearer token from the path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as LoggerModule from "@/lib/logger";

const logs = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  const record = (...args: unknown[]) => {
    logs.entries.push(args);
  };
  return {
    ...actual,
    createRequestLogger: () => ({
      info: record,
      warn: record,
      error: record,
      debug: record,
    }),
  };
});
vi.mock("@/lib/db", () => ({
  prisma: { canvasEmbed: { findUnique: vi.fn(async () => null) } },
}));

import { redactTokenPath } from "@/lib/logger";
import { proxy } from "@/proxy";

const TOKEN = "tok_Secret-Value_1234567890abcdef";

beforeEach(() => {
  logs.entries = [];
});

describe("redactTokenPath", () => {
  it.each([
    ["/embed/T", "/embed/[redacted]"],
    ["/share/T", "/share/[redacted]"],
    ["/share/T/", "/share/[redacted]/"],
    ["/api/v1/share/T", "/api/v1/share/[redacted]"],
    ["/api/v1/share/T/items", "/api/v1/share/[redacted]/items"],
    ["/share-invitations/T", "/share-invitations/[redacted]"],
    ["/api/v1/share-invitations/T/", "/api/v1/share-invitations/[redacted]/"],
  ])("redacts %s", (path, expected) => {
    expect(redactTokenPath(path.replace("T", TOKEN))).toBe(expected);
  });

  it.each([
    "/shared",
    "/shared/abc",
    "/api/v1/shared-canvases",
    "/api/v1/shared-canvases/abc",
    "/share",
    "/share/",
    "/dashboard",
    "/api/v1/canvases/abc/share/def",
  ])("leaves %s unchanged", (path) => {
    expect(redactTokenPath(path)).toBe(path);
  });
});

describe("proxy request logging", () => {
  it.each([
    `/embed/${TOKEN}`,
    `/share/${TOKEN}`,
    `/api/v1/share/${TOKEN}`,
    `/share-invitations/${TOKEN}`,
    `/api/v1/share-invitations/${TOKEN}`,
  ])("does not log the token for %s", async (path) => {
    await proxy(new NextRequest(`http://localhost:3000${path}`));
    expect(logs.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.entries)).not.toContain(TOKEN);
    expect(JSON.stringify(logs.entries)).toContain("[redacted]");
  });

  it("logs other paths unchanged", async () => {
    await proxy(
      new NextRequest("http://localhost:3000/api/v1/shared-canvases"),
    );
    expect(JSON.stringify(logs.entries)).toContain(
      '"pathname":"/api/v1/shared-canvases"',
    );
  });
});
