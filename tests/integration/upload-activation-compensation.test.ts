import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import type * as Lifecycle from "@/lib/uploads/lifecycle";

const mocks = vi.hoisted(() => ({
  userId: "",
  activationError: null as Error | null,
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireAuth: async () => ({ userId: mocks.userId, email: "u@example.com" }),
  requireCanvasAccess: async () => "OWNER",
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/api/route-handler", () => ({
  withApiHandler: (handler: unknown) => handler,
  runIdempotent: async (
    _request: unknown,
    _userId: string,
    handler: () => Promise<Response>,
  ) => handler(),
}));
vi.mock("@/lib/cache/redis-client", () => ({ getRedisClient: () => null }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  return {
    prisma: new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    }),
  };
});
vi.mock("@/lib/uploads/lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof Lifecycle>();
  return {
    ...actual,
    activateUploadAsset: async (
      ...args: Parameters<typeof actual.activateUploadAsset>
    ) => {
      if (mocks.activationError) throw mocks.activationError;
      return actual.activateUploadAsset(...args);
    },
  };
});
vi.mock("fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));
vi.mock("@/lib/uploads/s3-client.mjs", () => ({
  createS3Client: () => ({ send: mocks.s3Send }),
}));

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/v1/upload/route";
import { pngBytes } from "../helpers/image-fixtures";

const upload = POST as unknown as (request: NextRequest) => Promise<Response>;

async function request(canvasId: string) {
  const form = new FormData();
  form.append("canvasId", canvasId);
  form.append(
    "file",
    new Blob([new Uint8Array(pngBytes(16, 16))], { type: "image/png" }),
    "a.png",
  );
  const encoded = new Response(form);
  return new NextRequest("http://localhost/api/v1/upload", {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type") as string,
    },
    body: Buffer.from(await encoded.arrayBuffer()),
  });
}

async function attempt(canvasId: string) {
  try {
    return { status: (await upload(await request(canvasId))).status };
  } catch (error) {
    return { status: (error as { status?: number }).status ?? 500, error };
  }
}

let counter = 0;
async function setup() {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `upload-comp-${Date.now()}-${counter}@example.com` },
  });
  const canvas = await prisma.canvas.create({
    data: { name: "Uploads", userId: user.id },
  });
  mocks.userId = user.id;
  return { user, canvas };
}

async function state(userId: string) {
  const assets = await prisma.uploadAsset.findMany({ where: { userId } });
  const quota = await prisma.uploadQuota.findUnique({ where: { userId } });
  const jobs = await prisma.outboxJob.findMany({
    where: {
      type: "upload.delete",
      payload: { path: ["userId"], equals: userId },
    },
  });
  return {
    assets,
    quota: quota
      ? { count: quota.assetCount, bytes: Number(quota.totalBytes) }
      : null,
    jobs,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activationError = null;
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.s3Send.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe.each(["local", "s3"] as const)(
  "upload activation failure after a %s write",
  (mode) => {
    beforeEach(() => {
      vi.stubEnv("UPLOAD_STORAGE", mode);
      vi.stubEnv("S3_BUCKET", "bucket");
      // The client itself is mocked; these only pass the config check.
      vi.stubEnv("S3_REGION", "auto");
      vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
      vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
    });

    it("fails the asset, releases quota once and queues object cleanup", async () => {
      const { user, canvas } = await setup();
      mocks.activationError = new Error("database went away");

      const result = await attempt(canvas.id);
      expect(result.status).toBe(500);
      expect(result.error).toBe(mocks.activationError);
      const written =
        mode === "s3" ? mocks.s3Send.mock.calls : mocks.writeFile.mock.calls;
      expect(written).toHaveLength(1);

      const { assets, quota, jobs } = await state(user.id);
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({
        status: "FAILED",
        lastError: "activation_failed",
      });
      expect(quota).toEqual({ count: 0, bytes: 0 });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.dedupeKey).toBe(
        `upload.delete.compensate:${assets[0]!.id}`,
      );
      expect(jobs[0]!.payload).toMatchObject({
        assetId: assets[0]!.id,
        storageMode: mode,
        storageKey: assets[0]!.storageKey,
        quotaCharged: false,
      });
    });

    it("keeps the write-failure behaviour (no cleanup job)", async () => {
      const { user, canvas } = await setup();
      const writeError = new Error("disk full");
      if (mode === "s3") mocks.s3Send.mockRejectedValue(writeError);
      else mocks.writeFile.mockRejectedValue(writeError);

      const result = await attempt(canvas.id);
      expect(result.error).toBe(writeError);
      const { assets, quota, jobs } = await state(user.id);
      expect(assets[0]).toMatchObject({
        status: "FAILED",
        lastError: "object_write_failed",
      });
      expect(quota).toEqual({ count: 0, bytes: 0 });
      expect(jobs).toHaveLength(0);
    });

    it("queues cleanup when the asset was deleted with its canvas mid-upload", async () => {
      const { user, canvas } = await setup();
      const deleteCanvas = async () => {
        const { releaseCanvasUploads } =
          await import("@/lib/uploads/lifecycle");
        await prisma.$transaction(async (tx) => {
          await releaseCanvasUploads(tx, canvas.id);
          await tx.canvas.delete({ where: { id: canvas.id } });
        });
      };
      const write = mode === "s3" ? mocks.s3Send : mocks.writeFile;
      write.mockImplementation(async () => {
        await deleteCanvas();
        // The canvas's delete job ran before the object existed.
        await prisma.outboxJob.updateMany({
          where: { payload: { path: ["userId"], equals: user.id } },
          data: { status: "COMPLETED" },
        });
        return {};
      });

      const result = await attempt(canvas.id);
      expect(result.status).toBeGreaterThanOrEqual(400);
      const { assets, quota, jobs } = await state(user.id);
      expect(assets).toHaveLength(0);
      expect(quota).toEqual({ count: 0, bytes: 0 });
      const pending = jobs.filter((job) => job.status !== "COMPLETED");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.dedupeKey).toMatch(/^upload\.delete\.compensate:/);
    });
  },
);
