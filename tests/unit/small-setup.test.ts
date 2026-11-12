/**
 * IMP-100: the small set-up (one replica of each needed process, uploads on
 * disk) and the set-up check that names a fix for every failure.
 */

import { readFileSync } from "fs";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "../../");

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { count: vi.fn() },
}));
const redisMock = vi.hoisted(() => ({ ping: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/cache/redis-client", () => ({
  getRedisClient: () => redisMock,
}));

import { runSetupChecks } from "@/lib/operations/setup-check";
import { SETUP_CHECKS } from "@/lib/operations/setup-fixes.mjs";
import {
  checkPrivateUploadStorage,
  localUploadRoot,
  localUploadsAllowed,
} from "@/lib/uploads/private-storage";
import { GET as setupCheckRoute } from "@/app/api/setup/check/route";

function services(file: string) {
  const content = `\n${readFileSync(path.join(rootDir, file), "utf8")}`;
  const block = content.slice(content.indexOf("\nservices:\n") + 1);
  const end = block.slice(1).search(/\n[a-z]/);
  const body = end === -1 ? block : block.slice(0, end + 1);
  return [...body.matchAll(/\n {2}([a-z0-9-]+):\n/g)].map((m) => m[1]);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("small set-up file (IMP-100)", () => {
  it("runs only the parts the product needs, and the full set-up is unchanged", () => {
    expect(services("docker-compose.small.yml").sort()).toEqual([
      "app",
      "migrate",
      "outbox-worker",
      "postgres",
      "redis",
      "scheduler",
      "sync",
    ]);
    const full = services("docker-compose.yml");
    for (const name of ["gateway", "minio", "backup", "backup-monitor"])
      expect(full).toContain(name);
  });

  it("keeps uploads on a shared disk volume and says what it leaves out", () => {
    const small = readFileSync(
      path.join(rootDir, "docker-compose.small.yml"),
      "utf8",
    );
    expect(small).toContain("UPLOAD_STORAGE: local");
    expect(small).toContain("UPLOAD_LOCAL_DIR: /data/uploads");
    expect(small.match(/- uploads_data:\/data\/uploads/g)).toHaveLength(2);
    expect(small).toContain("127.0.0.1:${APP_HOST_PORT:-3000}:3000");
    for (const leftOut of ["object storage", "backup", "gateway"])
      expect(small).toContain(leftOut);
    const setup = readFileSync(path.join(rootDir, "scripts/setup.mjs"), "utf8");
    expect(setup).toContain("'172.29.48.1/32'");
    expect(small).toContain("gateway: 172.29.48.1");
  });
});

describe("uploads on disk in production (IMP-100)", () => {
  it("are allowed only when a folder is named for them", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPLOAD_LOCAL_DIR", "");
    expect(localUploadsAllowed()).toBe(false);
    vi.stubEnv("UPLOAD_LOCAL_DIR", "/data/uploads");
    expect(localUploadsAllowed()).toBe(true);
    expect(localUploadRoot()).toBe("/data/uploads");
  });

  it("fails the storage check when the folder cannot be written, and leaves no probe behind", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPLOAD_STORAGE", "local");
    vi.stubEnv("UPLOAD_LOCAL_DIR", "");
    await expect(checkPrivateUploadStorage()).rejects.toThrow();

    const dir = mkdtempSync(path.join(tmpdir(), "memoria-uploads-"));
    try {
      vi.stubEnv("UPLOAD_LOCAL_DIR", dir);
      await expect(checkPrivateUploadStorage()).resolves.toBeUndefined();
      expect(readdirSync(dir)).toEqual([]);
      vi.stubEnv("UPLOAD_LOCAL_DIR", "/proc/memoria-cannot-write-here");
      await expect(checkPrivateUploadStorage()).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function healthy() {
  prismaMock.$queryRaw.mockResolvedValue([]);
  redisMock.ping.mockResolvedValue("PONG");
  vi.stubEnv("UPLOAD_STORAGE", "local");
  vi.stubEnv("UPLOAD_LOCAL_DIR", "");
  vi.stubEnv("NODE_ENV", "test");
}

describe("set-up check (IMP-100)", () => {
  it("reports every part working", async () => {
    healthy();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const checks = await runSetupChecks({ fetchImpl: fetchImpl as never });
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ["database", true],
      ["migrations", true],
      ["redis", true],
      ["storage", true],
      ["sync-server", true],
    ]);
    expect(checks.every((c) => c.fix === undefined)).toBe(true);
  });

  it("names the fix in plain words when the sync server is stopped", async () => {
    healthy();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const checks = await runSetupChecks({ fetchImpl: fetchImpl as never });
    const sync = checks.find((c) => c.name === "sync-server")!;
    expect(sync.ok).toBe(false);
    expect(sync.fix).toBe(SETUP_CHECKS["sync-server"].fix);
    expect(sync.fix).toContain("edits will not save");
  });

  it("names the fix for a database or Redis that does not answer", async () => {
    healthy();
    prismaMock.$queryRaw.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5"));
    redisMock.ping.mockRejectedValue(new Error("NOAUTH"));
    const checks = await runSetupChecks({
      fetchImpl: (async () => new Response("{}")) as never,
    });
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName.database!.fix).toContain("DATABASE_URL");
    expect(byName.redis!.fix).toContain("REDIS_URL");
    // No internal error text reaches the result.
    expect(JSON.stringify(checks)).not.toContain("10.0.0.5");
  });

  it("answers on the first-run page only until the first account exists", async () => {
    healthy();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    try {
      prismaMock.user.count.mockResolvedValue(0);
      const open = await setupCheckRoute();
      expect(open.status).toBe(200);
      expect((await open.json()).ok).toBe(true);

      prismaMock.user.count.mockResolvedValue(1);
      expect((await setupCheckRoute()).status).toBe(404);

      // Without the database nothing else is said.
      prismaMock.$queryRaw.mockRejectedValue(new Error("down"));
      const down = await setupCheckRoute();
      const body = await down.json();
      expect(body.checks.map((c: { name: string }) => c.name)).toEqual([
        "database",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
