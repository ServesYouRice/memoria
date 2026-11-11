/**
 * TASK-205 — reading a private upload from S3 passes the caller's abort
 * signal to the GetObject request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/uploads/s3-client.mjs", () => ({
  createS3Client: () => ({ send: s3.send }),
}));

import { readPrivateUploadObject } from "@/lib/uploads/private-storage";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readPrivateUploadObject", () => {
  it("passes the abort signal to S3 GetObject", async () => {
    vi.stubEnv("S3_BUCKET", "uploads");
    vi.stubEnv("S3_REGION", "auto");
    vi.stubEnv("S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
    s3.send.mockResolvedValue({
      Body: { transformToWebStream: () => new ReadableStream() },
      ContentLength: 0,
    });
    const controller = new AbortController();
    await readPrivateUploadObject("s3", "uploads/u/a.png", controller.signal);
    expect(s3.send).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: controller.signal,
    });
  });

  it("refuses a local read once the signal has fired", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      readPrivateUploadObject(
        "local",
        "uploads/u/missing.png",
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
  });
});
